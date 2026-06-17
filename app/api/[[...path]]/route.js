import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import Stripe from 'stripe'
import { connectDb } from '@/lib/db'
import { hashPassword, verifyPassword, createSession, getUserFromRequest, sanitizeUser } from '@/lib/auth'
import { sendPushToUser, hashEndpoint } from '@/lib/push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
const COMMISSION = parseFloat(process.env.PLATFORM_COMMISSION_PERCENT || '15') / 100
const WITHDRAWAL_TYPES = ['IBAN', 'MBWAY', 'TRANSFERENCIA']

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, stripe-signature')
  return res
}
const J = (data, status = 200) => cors(NextResponse.json(data, { status }))
const ERR = (msg, status = 400) => J({ error: msg }, status)

export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

// ----------------- HELPERS -----------------
const clean = (obj) => { if (!obj) return obj; const { _id, ...r } = obj; return r }

async function createNotification(db, userId, type, title, message, relatedId = null) {
  await db.collection('notifications').insertOne({
    id: uuidv4(), userId, type, title, message: message || '', relatedId,
    isRead: false, createdAt: new Date(),
  })
  try {
    await sendPushToUser(db, userId, { title, body: message || '', url: '/', type, relatedId })
  } catch (err) {
    console.error('Erro ao enviar push notification:', err.message)
  }
}

async function logAudit(db, admin, action, targetType, targetId, details = '') {
  await db.collection('audit_log').insertOne({
    id: uuidv4(), adminId: admin.id, adminName: admin.name || admin.email,
    action, targetType, targetId, details: details || '', createdAt: new Date(),
  })
}

async function autoFinalizeTimeout(db, room) {
  // If only one player responded and the other didn't respond within 24h, auto-confirm the responder's result
  if (room.status !== 'EM_ANDAMENTO') return room
  const claims = room.claims || {}
  const keys = Object.keys(claims)
  if (keys.length !== 1) return room
  const claimerId = keys[0]
  const claim = claims[claimerId]
  const since = room.firstClaimAt ? new Date(room.firstClaimAt).getTime() : 0
  if (Date.now() - since < 24 * 60 * 60 * 1000) return room
  const opponentId = claimerId === room.creatorId ? room.opponentId : room.creatorId
  // Claimer said 'win' -> claimer wins; claimer said 'loss' -> opponent wins
  const winnerId = claim === 'win' ? claimerId : opponentId
  return await finalizeRoom(db, room, winnerId, 'timeout_single_claim')
}

async function finalizeRoom(db, room, winnerId, reason = 'players_agreed') {
  const totalPot = (room.betAmountCents || 0) * 2
  const commissionCents = Math.round(totalPot * COMMISSION)
  const prizeCents = totalPot - commissionCents
  const loserId = winnerId === room.creatorId ? room.opponentId : room.creatorId

  await db.collection('rooms').updateOne({ id: room.id }, {
    $set: {
      status: 'FINALIZADA', winnerId, loserId, finishedAt: new Date(),
      prizeCents, commissionCents, finalizeReason: reason,
    }
  })

  // Credit winner
  const winner = await db.collection('users').findOne({ id: winnerId })
  const newBalance = (winner.balanceCents || 0) + prizeCents
  await db.collection('users').updateOne({ id: winnerId }, {
    $set: { balanceCents: newBalance },
    $inc: { totalEarningsCents: prizeCents, wins: 1 },
  })
  await db.collection('users').updateOne({ id: loserId }, { $inc: { losses: 1 } })
  await db.collection('transactions').insertOne({
    id: uuidv4(), userId: winnerId, type: 'win', amountCents: prizeCents,
    roomId: room.id, balance: newBalance, description: `Vitória sala ${room.id.slice(0,8)}`,
    createdAt: new Date(),
  })
  await db.collection('transactions').insertOne({
    id: uuidv4(), userId: 'PLATFORM', type: 'commission', amountCents: commissionCents,
    roomId: room.id, description: `Comissão ${(COMMISSION*100)}% sala ${room.id.slice(0,8)}`,
    createdAt: new Date(),
  })
  return await db.collection('rooms').findOne({ id: room.id })
}

// ----------------- HANDLERS -----------------
async function handleRoute(request, { params }) {
  const path = (params?.path || []).join('/')
  const route = '/' + path
  const method = request.method

  try {
    const db = await connectDb()

    // ===== HEALTH =====
    if (route === '/' && method === 'GET') return J({ ok: true, app: 'FF Arena' })

    // ===== PLATFORM STATUS (public) =====
    if (route === '/platform-status' && method === 'GET') {
      const rows = await db.collection('platform_settings').find({}).toArray()
      const map = Object.fromEntries(rows.map(s => [s.key, s.value]))
      return J({ topupsEnabled: map.topupsEnabled !== '0', stripeEnabled: map.stripeEnabled !== '0', mbwayPhone: map.mbwayPhone || null, commissionPercent: Math.round(COMMISSION * 100) })
    }

    // ===== AUTH =====
    if (route === '/auth/register' && method === 'POST') {
      const body = await request.json()
      const { email, password, name, ffUid, ffNickname, deviceType } = body
      if (!email || !password || !name || !ffUid || !ffNickname || !deviceType) return ERR('Campos obrigatórios em falta')
      if (!['MOBILE', 'EMULADOR', 'MOBILADOR'].includes(deviceType)) return ERR('Tipo de dispositivo inválido')
      const exists = await db.collection('users').findOne({ email })
      if (exists) return ERR('Email já registado', 409)
      const { salt, hash } = hashPassword(password)
      const user = {
        id: uuidv4(), email, passwordHash: hash, salt, name, ffUid, ffNickname, deviceType,
        balanceCents: 0, pendingCents: 0, totalEarningsCents: 0,
        wins: 0, losses: 0, banned: false, isAdmin: false,
        photoUrl: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(ffNickname)}`,
        createdAt: new Date(),
      }
      await db.collection('users').insertOne(user)
      const token = await createSession(user.id)
      return J({ token, user: sanitizeUser(user) })
    }

    if (route === '/auth/login' && method === 'POST') {
      const { email, password } = await request.json()
      const user = await db.collection('users').findOne({ email })
      if (!user) return ERR('Credenciais inválidas', 401)
      if (!verifyPassword(password, user.salt, user.passwordHash)) return ERR('Credenciais inválidas', 401)
      if (user.banned) return ERR('Conta banida: ' + (user.banReason || ''), 403)
      const token = await createSession(user.id)
      return J({ token, user: sanitizeUser(user) })
    }

    if (route === '/auth/me' && method === 'GET') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      return J({ user: sanitizeUser(user) })
    }

    // ===== ROOMS =====
    if (route === '/rooms' && method === 'GET') {
      const rooms = await db.collection('rooms')
        .find({ status: 'ABERTA' })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray()
      // attach creator info
      const creatorIds = [...new Set(rooms.map(r => r.creatorId))]
      const creators = await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      const cmap = Object.fromEntries(creators.map(u => [u.id, { id: u.id, name: u.name, ffNickname: u.ffNickname, ffUid: u.ffUid, photoUrl: u.photoUrl, wins: u.wins, losses: u.losses, deviceType: u.deviceType || null }]))
      return J({ rooms: rooms.map(r => ({ ...clean(r), creator: cmap[r.creatorId] || null })) })
    }

    if (route === '/rooms' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      if (user.banned) return ERR('Conta banida', 403)
      const b = await request.json()
      const { betEuros, mode, roomType, scheduledTime, server, weapons, platform, notes } = b
      const betEurNum = parseFloat(betEuros)
      if (!betEurNum || betEurNum < 1 || betEurNum > 500) return ERR('Valor de aposta inválido (mínimo 1€, máximo 500€)')
      if (!mode || !server || !weapons || !platform || !roomType) return ERR('Preenche todos os campos obrigatórios')
      const betCents = Math.round(betEurNum * 100)
      // Check internal balance
      const balance = user.balanceCents || 0
      if (balance < betCents) {
        return J({ error: 'Saldo insuficiente', needTopup: true, balanceCents: balance, requiredCents: betCents, missingCents: betCents - balance }, 402)
      }
      // Debit balance and create room as ABERTA
      const newBalance = balance - betCents
      await db.collection('users').updateOne({ id: user.id }, { $set: { balanceCents: newBalance } })
      const room = {
        id: uuidv4(), creatorId: user.id, opponentId: null,
        betAmountCents: betCents,
        mode, roomType, scheduledTime: scheduledTime || null,
        server, weapons, platform, notes: notes || '',
        status: 'ABERTA',
        creatorPaid: true, opponentPaid: false,
        creatorPaidAt: new Date(),
        winnerId: null, loserId: null, claims: {}, firstClaimAt: null,
        createdAt: new Date(), startedAt: null, finishedAt: null,
      }
      await db.collection('rooms').insertOne(room)
      await db.collection('transactions').insertOne({
        id: uuidv4(), userId: user.id, type: 'bet_create', amountCents: -betCents,
        roomId: room.id, balance: newBalance, description: `Aposta criar sala ${room.id.slice(0,8)}`,
        createdAt: new Date(),
      })
      return J({ room: clean(room) })
    }

    if (route === '/rooms/mine' && method === 'GET') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const rooms = await db.collection('rooms')
        .find({ $or: [{ creatorId: user.id }, { opponentId: user.id }] })
        .sort({ createdAt: -1 }).limit(50).toArray()
      return J({ rooms: rooms.map(clean) })
    }

    // /rooms/:id  & /rooms/:id/<action>
    const roomMatch = route.match(/^\/rooms\/([^\/]+)(?:\/(.*))?$/)
    if (roomMatch) {
      const roomId = roomMatch[1]
      const action = roomMatch[2]
      let room = await db.collection('rooms').findOne({ id: roomId })
      if (!room) return ERR('Sala não encontrada', 404)
      // Auto-finalize on read
      if (room.status === 'EM_ANDAMENTO') room = await autoFinalizeTimeout(db, room)

      if (!action && method === 'GET') {
        const ids = [room.creatorId, room.opponentId].filter(Boolean)
        const users = await db.collection('users').find({ id: { $in: ids } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, { id: u.id, name: u.name, ffNickname: u.ffNickname, ffUid: u.ffUid, photoUrl: u.photoUrl, wins: u.wins, losses: u.losses, deviceType: u.deviceType || null }]))
        return J({ room: clean(room), creator: umap[room.creatorId] || null, opponent: umap[room.opponentId] || null })
      }

      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)

      if (action === 'start' && method === 'POST') {
        if (room.creatorId !== user.id) return ERR('Só o criador pode iniciar', 403)
        if (room.status !== 'EMPARELHADA') return ERR('Sala não está emparelhada')
        await db.collection('rooms').updateOne({ id: roomId }, { $set: { status: 'EM_ANDAMENTO', startedAt: new Date() } })
        return J({ ok: true })
      }

      if (action === 'join' && method === 'POST') {
        if (room.status !== 'ABERTA') return ERR('Sala não está aberta')
        if (room.creatorId === user.id) return ERR('Não podes entrar na tua própria sala')
        if (room.opponentId) return ERR('Sala já tem adversário')
        const balance = user.balanceCents || 0
        const betCents = room.betAmountCents
        if (balance < betCents) {
          return J({ error: 'Saldo insuficiente', needTopup: true, balanceCents: balance, requiredCents: betCents, missingCents: betCents - balance }, 402)
        }
        const newBalance = balance - betCents
        await db.collection('users').updateOne({ id: user.id }, { $set: { balanceCents: newBalance } })
        await db.collection('rooms').updateOne({ id: roomId }, {
          $set: { status: 'EMPARELHADA', opponentId: user.id, opponentPaid: true, opponentPaidAt: new Date() }
        })
        await db.collection('transactions').insertOne({
          id: uuidv4(), userId: user.id, type: 'bet_join', amountCents: -betCents,
          roomId: room.id, balance: newBalance, description: `Aposta entrar sala ${room.id.slice(0,8)}`,
          createdAt: new Date(),
        })
        await createNotification(db, room.creatorId, 'room_joined', 'Adversário encontrado',
          `${user.name} entrou na tua sala e a partida está pronta para começar.`, room.id)
        return J({ ok: true, balanceCents: newBalance })
      }

      if (action === 'claim' && method === 'POST') {
        const { result } = await request.json() // 'win' or 'loss'
        if (!['win', 'loss'].includes(result)) return ERR('Resultado inválido')
        if (![user.id].includes(room.creatorId) && room.opponentId !== user.id) return ERR('Não és participante', 403)
        if (room.status !== 'EM_ANDAMENTO') return ERR('Partida não está em curso')
        const claims = { ...(room.claims || {}) }
        claims[user.id] = result
        const update = { claims }
        if (!room.firstClaimAt) update.firstClaimAt = new Date()
        await db.collection('rooms').updateOne({ id: roomId }, { $set: update })
        const updated = await db.collection('rooms').findOne({ id: roomId })

        const aId = updated.creatorId, bId = updated.opponentId
        const cA = updated.claims[aId], cB = updated.claims[bId]
        if (cA && cB) {
          if (cA === 'win' && cB === 'loss') {
            await finalizeRoom(db, updated, aId)
          } else if (cB === 'win' && cA === 'loss') {
            await finalizeRoom(db, updated, bId)
          } else {
            // Both claimed the same result (both 'win' or both 'loss') → conflict, prize locked
            await db.collection('rooms').updateOne({ id: roomId }, { $set: { status: 'EM_CONFLITO' } })
          }
        }
        // Only one claim so far: wait for the other player (or 24h timeout)
        const final = await db.collection('rooms').findOne({ id: roomId })
        return J({ room: clean(final) })
      }

      if (action === 'messages' && method === 'GET') {
        if (room.creatorId !== user.id && room.opponentId !== user.id) return ERR('Não és participante', 403)
        const msgs = await db.collection('room_messages').find({ roomId }).sort({ createdAt: 1 }).limit(500).toArray()
        const ids = [...new Set(msgs.map(m => m.userId))]
        const users = await db.collection('users').find({ id: { $in: ids } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, { name: u.name, ffNickname: u.ffNickname, photoUrl: u.photoUrl }]))
        return J({ messages: msgs.map(m => ({ ...clean(m), sender: umap[m.userId] || null })) })
      }

      if (action === 'messages' && method === 'POST') {
        if (room.creatorId !== user.id && room.opponentId !== user.id) return ERR('Não és participante', 403)
        if (['FINALIZADA', 'CANCELADA'].includes(room.status)) return ERR('O chat está encerrado para esta sala')
        const { message } = await request.json()
        const text = (message || '').trim()
        if (!text) return ERR('Mensagem vazia')
        if (text.length > 1000) return ERR('Mensagem demasiado longa (máx. 1000 caracteres)')
        const doc = { id: uuidv4(), roomId, userId: user.id, message: text, createdAt: new Date() }
        await db.collection('room_messages').insertOne(doc)
        const recipientId = room.creatorId === user.id ? room.opponentId : room.creatorId
        if (recipientId) {
          await createNotification(db, recipientId, 'private_message', 'Nova mensagem',
            `${user.name}: ${text.slice(0, 100)}`, room.id)
        }
        return J({ ok: true, message: clean(doc) })
      }

      if (action === 'report' && method === 'POST') {
        const { reason, videoUrl, screenshots } = await request.json()
        if (room.creatorId !== user.id && room.opponentId !== user.id) return ERR('Não és participante', 403)
        if (!['EM_ANDAMENTO', 'EM_CONFLITO', 'EM_DISPUTA', 'FINALIZADA'].includes(room.status)) return ERR('Estado da sala não permite denúncia')
        // For FINALIZADA: only loser can dispute, within 24h of finish
        if (room.status === 'FINALIZADA') {
          if (room.winnerId === user.id) return ERR('O vencedor não pode denunciar')
          const finishedAgo = Date.now() - new Date(room.finishedAt || 0).getTime()
          if (finishedAgo > 24 * 60 * 60 * 1000) return ERR('Prazo de denúncia expirado (24h)')
        }
        const sc = Array.isArray(screenshots) ? screenshots.filter(Boolean).slice(0, 6) : []
        await db.collection('reports').insertOne({
          id: uuidv4(), roomId: room.id, reporterId: user.id, reason: reason || '',
          videoUrl: videoUrl || '', screenshots: sc, status: 'PENDENTE',
          createdAt: new Date(),
        })
        // Move room to EM_DISPUTA so admin sees it; don't revert payout until admin decides
        await db.collection('rooms').updateOne({ id: roomId }, { $set: { status: 'EM_DISPUTA', previousStatus: room.status } })
        return J({ ok: true })
      }
    }

    // ===== STRIPE TOP-UP =====
    if (route === '/wallet/topup' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      if (user.banned) return ERR('Conta banida', 403)
      const topupSetting = await db.collection('platform_settings').findOne({ key: 'topupsEnabled' })
      if (topupSetting && topupSetting.value === '0') return ERR('Carregamentos desativados. A plataforma está em manutenção.', 503)
      const { amountEuros } = await request.json()
      const cents = Math.round(parseFloat(amountEuros) * 100)
      if (!cents || cents < 500) return ERR('Valor mínimo: 5€')
      if (cents > 500000) return ERR('Valor máximo: 5000€ por transação')

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: { name: `Carregar saldo FF Arena - ${(cents/100).toFixed(2)}€` },
            unit_amount: cents,
          },
          quantity: 1,
        }],
        metadata: { userId: user.id, type: 'topup', amountCents: String(cents) },
        success_url: `${baseUrl}/checkout/success?type=topup&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout/cancel`,
      })
      return J({ id: session.id, url: session.url })
    }

    if (route === '/stripe/webhook' && method === 'POST') {
      const sig = request.headers.get('stripe-signature')
      const raw = await request.text()
      let event
      try {
        event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)
      } catch (e) {
        console.error('Webhook signature failed:', e.message)
        return new NextResponse(`Webhook Error: ${e.message}`, { status: 400 })
      }
      if (event.type === 'checkout.session.completed') {
        await processTopupCompleted(db, event.data.object)
      }
      return new NextResponse(null, { status: 200 })
    }

    // Manual verify fallback - allows frontend to confirm if webhook delayed.
    // Public endpoint (no auth needed) since the sessionId is the proof.
    if (route === '/stripe/verify' && method === 'POST') {
      const { sessionId } = await request.json()
      if (!sessionId) return ERR('sessionId obrigatório')
      const sess = await stripe.checkout.sessions.retrieve(sessionId)
      if (sess.payment_status === 'paid') {
        await processTopupCompleted(db, sess)
      }
      return J({ ok: true, status: sess.payment_status, amountCents: sess.amount_total })
    }

    // Sync all paid Stripe topups for the current user (recovery if webhook missed)
    if (route === '/wallet/sync-topups' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      let credited = 0, alreadyProcessed = 0, totalCentsCredited = 0
      // List recent checkout sessions and process those belonging to this user
      let starting_after = undefined
      let scanned = 0
      const maxScan = 100
      while (scanned < maxScan) {
        const list = await stripe.checkout.sessions.list({ limit: 100, ...(starting_after ? { starting_after } : {}) })
        for (const s of list.data) {
          scanned++
          if (s.metadata?.userId === user.id && s.metadata?.type === 'topup' && s.payment_status === 'paid') {
            const existing = await db.collection('transactions').findOne({ stripeSessionId: s.id })
            if (existing) { alreadyProcessed++; continue }
            await processTopupCompleted(db, s)
            credited++
            totalCentsCredited += s.amount_total
          }
        }
        if (!list.has_more) break
        starting_after = list.data[list.data.length - 1]?.id
      }
      const updated = await db.collection('users').findOne({ id: user.id })
      return J({ credited, alreadyProcessed, totalCentsCredited, balanceCents: updated.balanceCents || 0 })
    }

    // ===== MB WAY TOP-UP (player submits proof) =====
    if (route === '/wallet/topup/mbway' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      if (user.banned) return ERR('Conta banida', 403)
      const topupSetting = await db.collection('platform_settings').findOne({ key: 'topupsEnabled' })
      if (topupSetting && topupSetting.value === '0') return ERR('Carregamentos desativados. A plataforma está em manutenção.', 503)
      const mbwayPhoneSetting = await db.collection('platform_settings').findOne({ key: 'mbwayPhone' })
      if (!mbwayPhoneSetting?.value) return ERR('Carregamento via MB WAY não disponível de momento.', 503)
      const { amountEuros, proofImage } = await request.json()
      const cents = Math.round(parseFloat(amountEuros) * 100)
      if (!cents || cents < 100) return ERR('Valor mínimo: 1€')
      if (cents > 500000) return ERR('Valor máximo: 5000€')
      if (!proofImage) return ERR('Comprovativo de pagamento obrigatório')
      const topup = {
        id: uuidv4(), userId: user.id, amountCents: cents,
        proofImage, status: 'PENDENTE', createdAt: new Date(),
      }
      await db.collection('mbway_topups').insertOne(topup)
      await createNotification(db, user.id, 'topup_pending', 'Comprovativo recebido',
        `O teu comprovativo de carregamento de ${(cents/100).toFixed(2)}€ via MB WAY foi recebido e está a aguardar confirmação pela equipa.`, topup.id)
      return J({ ok: true })
    }

    if (route === '/wallet/mbway-topups' && method === 'GET') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const list = await db.collection('mbway_topups').find({ userId: user.id }).sort({ createdAt: -1 }).limit(20).toArray()
      return J({ topups: list.map(t => { const { proofImage, ...rest } = clean(t); return rest }) })
    }

    // ===== WALLET =====
    if (route === '/wallet' && method === 'GET') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const txns = await db.collection('transactions').find({ userId: user.id }).sort({ createdAt: -1 }).limit(50).toArray()
      const withdrawals = await db.collection('withdrawals').find({ userId: user.id }).sort({ createdAt: -1 }).limit(20).toArray()
      return J({
        balanceCents: user.balanceCents || 0,
        pendingCents: user.pendingCents || 0,
        totalEarningsCents: user.totalEarningsCents || 0,
        transactions: txns.map(clean),
        withdrawals: withdrawals.map(clean),
      })
    }

    // ----- Withdrawal method (player-configured payout details) -----
    if (route === '/wallet/withdrawal-method' && method === 'GET') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const m = await db.collection('withdrawal_methods').findOne({ userId: user.id })
      return J({ method: clean(m) })
    }

    if (route === '/wallet/withdrawal-method' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      if (user.banned) return ERR('Conta banida', 403)
      const { fullName, type, iban, mbway, bank, notes } = await request.json()
      if (!fullName || !fullName.trim()) return ERR('Nome completo é obrigatório')
      if (!WITHDRAWAL_TYPES.includes(type)) return ERR('Tipo de levantamento inválido')
      if (type === 'IBAN' || type === 'TRANSFERENCIA') {
        if (!iban || !iban.trim()) return ERR('IBAN é obrigatório para este tipo de levantamento')
      }
      if (type === 'MBWAY') {
        if (!mbway || !mbway.trim()) return ERR('Número MB WAY é obrigatório')
      }
      const doc = {
        fullName: fullName.trim(),
        type,
        iban: iban ? iban.trim() : null,
        mbway: mbway ? mbway.trim() : null,
        bank: bank ? bank.trim() : null,
        notes: notes ? notes.trim() : null,
      }
      const existing = await db.collection('withdrawal_methods').findOne({ userId: user.id })
      if (existing) {
        await db.collection('withdrawal_methods').updateOne({ userId: user.id }, { $set: doc })
      } else {
        await db.collection('withdrawal_methods').insertOne({ userId: user.id, ...doc, updatedAt: new Date() })
      }
      const saved = await db.collection('withdrawal_methods').findOne({ userId: user.id })
      return J({ method: clean(saved) })
    }

    // ----- Notifications -----
    if (route === '/wallet/notifications' && method === 'GET') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const list = await db.collection('notifications').find({ userId: user.id }).sort({ createdAt: -1 }).limit(50).toArray()
      const unreadCount = await db.collection('notifications').countDocuments({ userId: user.id, isRead: false })
      return J({ notifications: list.map(clean), unreadCount })
    }

    if (route === '/wallet/notifications/read-all' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      await db.collection('notifications').updateOne({ userId: user.id, isRead: false }, { $set: { isRead: true } })
      return J({ ok: true })
    }

    if (route === '/wallet/notifications/clear' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      await db.collection('notifications').deleteMany({ userId: user.id })
      return J({ ok: true })
    }

    const notifReadMatch = route.match(/^\/wallet\/notifications\/([^\/]+)\/read$/)
    if (notifReadMatch && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      await db.collection('notifications').updateOne({ id: notifReadMatch[1], userId: user.id }, { $set: { isRead: true } })
      return J({ ok: true })
    }

    // ----- Web Push notifications -----
    if (route === '/push/vapid-public-key' && method === 'GET') {
      return J({ publicKey: process.env.VAPID_PUBLIC_KEY || null })
    }

    if (route === '/push/subscribe' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const { subscription } = await request.json()
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return ERR('Subscrição inválida')
      }
      const endpointHash = hashEndpoint(subscription.endpoint)
      const existing = await db.collection('push_subscriptions').findOne({ endpointHash })
      if (existing) {
        await db.collection('push_subscriptions').updateOne({ id: existing.id }, {
          $set: { userId: user.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        })
      } else {
        await db.collection('push_subscriptions').insertOne({
          id: uuidv4(), userId: user.id, endpoint: subscription.endpoint, endpointHash,
          p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, createdAt: new Date(),
        })
      }
      return J({ ok: true })
    }

    if (route === '/push/unsubscribe' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const { endpoint } = await request.json()
      if (!endpoint) return ERR('Endpoint inválido')
      await db.collection('push_subscriptions').deleteMany({ endpointHash: hashEndpoint(endpoint), userId: user.id })
      return J({ ok: true })
    }

    if (route === '/push/preference' && method === 'GET') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      return J({ notificationsEnabled: Number(user.notificationsEnabled) !== 0 })
    }

    if (route === '/push/preference' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const { enabled } = await request.json()
      await db.collection('users').updateOne({ id: user.id }, { $set: { notificationsEnabled: !!enabled } })
      return J({ ok: true })
    }

    if (route === '/push/test' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      await sendPushToUser(db, user.id, {
        title: 'FF Arena', body: 'Notificação de teste — está tudo a funcionar!', url: '/',
      })
      return J({ ok: true })
    }

    // ----- Withdrawal request (manual, admin-approved) -----
    if (route === '/wallet/withdraw' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      if (user.banned) return ERR('Conta banida', 403)
      const { amountEuros } = await request.json()
      const cents = Math.round(parseFloat(amountEuros) * 100)
      if (!cents || cents < 200) return ERR('Valor mínimo: 2€')
      if (cents > (user.balanceCents || 0)) return ERR('Saldo insuficiente')

      const method = await db.collection('withdrawal_methods').findOne({ userId: user.id })
      if (!method) return ERR('Configura primeiro o teu método de levantamento')

      const pending = await db.collection('withdrawals').findOne({
        userId: user.id, status: { $in: ['PENDENTE', 'EM_PROCESSAMENTO'] }
      })
      if (pending) return ERR('Já tens um pedido de levantamento em curso. Aguarda que seja processado.')

      const w = {
        id: uuidv4(), userId: user.id, amountCents: cents,
        fullName: method.fullName, withdrawalType: method.type,
        iban: method.iban || null, mbway: method.mbway || null,
        bank: method.bank || null, notes: method.notes || null,
        status: 'PENDENTE', createdAt: new Date(),
      }
      await db.collection('withdrawals').insertOne(w)
      await db.collection('users').updateOne({ id: user.id }, {
        $inc: { balanceCents: -cents, pendingCents: cents }
      })
      await db.collection('transactions').insertOne({
        id: uuidv4(), userId: user.id, type: 'withdrawal_request', amountCents: -cents,
        withdrawalId: w.id, balance: (user.balanceCents || 0) - cents,
        description: 'Pedido de levantamento', createdAt: new Date(),
      })
      return J({ withdrawal: clean(w) })
    }

    // ===== RANKING =====
    if (route === '/ranking' && method === 'GET') {
      const url = new URL(request.url)
      const type = url.searchParams.get('type') || 'wins'
      const sortField = type === 'earnings' ? 'totalEarningsCents' : type === 'rate' ? 'wins' : 'wins'
      const users = await db.collection('users')
        .find({ isAdmin: { $ne: true }, banned: { $ne: true } })
        .project({ passwordHash: 0, salt: 0, email: 0 })
        .sort({ [sortField]: -1 }).limit(20).toArray()
      const ranked = users.map(u => {
        const total = (u.wins || 0) + (u.losses || 0)
        const rate = total > 0 ? (u.wins || 0) / total : 0
        return { ...clean(u), winRate: Math.round(rate * 100) }
      })
      if (type === 'rate') ranked.sort((a, b) => b.winRate - a.winRate)
      return J({ ranking: ranked })
    }

    if (route.startsWith('/profile/') && method === 'GET') {
      const userId = route.split('/')[2]
      const u = await db.collection('users').findOne({ id: userId })
      if (!u) return ERR('Utilizador não encontrado', 404)
      return J({ user: sanitizeUser(u) })
    }

    // ===== ADMIN =====
    if (route.startsWith('/admin/')) {
      const admin = await getUserFromRequest(request)
      if (!admin || !admin.isAdmin) return ERR('Acesso de administrador requerido', 403)

      if (route === '/admin/settings' && method === 'GET') {
        const rows = await db.collection('platform_settings').find({}).toArray()
        const map = Object.fromEntries(rows.map(s => [s.key, s.value]))
        return J({ topupsEnabled: map.topupsEnabled !== '0', stripeEnabled: map.stripeEnabled !== '0', mbwayPhone: map.mbwayPhone || null })
      }

      if (route === '/admin/settings' && method === 'POST') {
        const body = await request.json()
        if (typeof body.topupsEnabled !== 'undefined') {
          const val = body.topupsEnabled ? '1' : '0'
          const existing = await db.collection('platform_settings').findOne({ key: 'topupsEnabled' })
          if (existing) {
            await db.collection('platform_settings').updateOne({ key: 'topupsEnabled' }, { $set: { value: val } })
          } else {
            await db.collection('platform_settings').insertOne({ key: 'topupsEnabled', value: val })
          }
          await logAudit(db, admin, body.topupsEnabled ? 'topups_enabled' : 'topups_disabled', 'platform', 'settings')
        }
        if (typeof body.stripeEnabled !== 'undefined') {
          const val = body.stripeEnabled ? '1' : '0'
          const existing = await db.collection('platform_settings').findOne({ key: 'stripeEnabled' })
          if (existing) {
            await db.collection('platform_settings').updateOne({ key: 'stripeEnabled' }, { $set: { value: val } })
          } else {
            await db.collection('platform_settings').insertOne({ key: 'stripeEnabled', value: val })
          }
          await logAudit(db, admin, body.stripeEnabled ? 'stripe_enabled' : 'stripe_disabled', 'platform', 'settings')
        }
        if (typeof body.mbwayPhone !== 'undefined') {
          const phone = (body.mbwayPhone || '').trim()
          const existing = await db.collection('platform_settings').findOne({ key: 'mbwayPhone' })
          if (existing) {
            await db.collection('platform_settings').updateOne({ key: 'mbwayPhone' }, { $set: { value: phone } })
          } else {
            await db.collection('platform_settings').insertOne({ key: 'mbwayPhone', value: phone })
          }
          await logAudit(db, admin, 'mbway_phone_updated', 'platform', 'settings', phone)
        }
        const updated = await db.collection('platform_settings').find({}).toArray()
        const map = Object.fromEntries(updated.map(s => [s.key, s.value]))
        return J({ success: true, topupsEnabled: map.topupsEnabled !== '0', stripeEnabled: map.stripeEnabled !== '0', mbwayPhone: map.mbwayPhone || null })
      }

      if (route === '/admin/dashboard' && method === 'GET') {
        const [totalUsers, totalRooms, inProgress, finalized, disputes, conflicts, pendingReports, pendingWithdrawals, banned, commissions, topupAgg, withdrawalsPaidAgg, pendingMbwayTopups] = await Promise.all([
          db.collection('users').countDocuments({ isAdmin: { $ne: true } }),
          db.collection('rooms').countDocuments({}),
          db.collection('rooms').countDocuments({ status: 'EM_ANDAMENTO' }),
          db.collection('rooms').countDocuments({ status: 'FINALIZADA' }),
          db.collection('rooms').countDocuments({ status: 'EM_DISPUTA' }),
          db.collection('rooms').countDocuments({ status: 'EM_CONFLITO' }),
          db.collection('reports').countDocuments({ status: 'PENDENTE' }),
          db.collection('withdrawals').countDocuments({ status: { $in: ['PENDENTE', 'EM_PROCESSAMENTO'] } }),
          db.collection('users').countDocuments({ banned: true }),
          db.collection('transactions').aggregate([
            { $match: { type: 'commission' } },
            { $group: { _id: null, total: { $sum: '$amountCents' } } }
          ]).toArray(),
          db.collection('transactions').aggregate([
            { $match: { type: 'topup' } },
            { $group: { _id: null, total: { $sum: '$amountCents' }, count: { $sum: 1 } } }
          ]).toArray(),
          db.collection('withdrawals').aggregate([
            { $match: { status: 'PAGO' } },
            { $group: { _id: null, total: { $sum: '$amountCents' } } }
          ]).toArray(),
          db.collection('mbway_topups').countDocuments({ status: 'PENDENTE' }),
        ])
        const totalTopupsCents = topupAgg[0]?.total || 0
        const topupCount = topupAgg[0]?.count || 0
        const withdrawalsPaidCents = withdrawalsPaidAgg[0]?.total || 0
        const netProfitCents = totalTopupsCents - withdrawalsPaidCents
        return J({
          totalUsers, totalRooms, inProgress, finalized, disputes, conflicts, pendingReports, pendingWithdrawals, banned,
          revenueCents: commissions[0]?.total || 0,
          totalTopupsCents, topupCount, withdrawalsPaidCents, netProfitCents,
          pendingMbwayTopups,
        })
      }

      if (route === '/admin/reports' && method === 'GET') {
        const reports = await db.collection('reports').find({}).sort({ createdAt: -1 }).limit(200).toArray()
        const roomIds = [...new Set(reports.map(r => r.roomId))]
        const userIds = [...new Set(reports.flatMap(r => [r.reporterId]))]
        const rooms = await db.collection('rooms').find({ id: { $in: roomIds } }).toArray()
        for (const r of rooms) { userIds.push(r.creatorId); if (r.opponentId) userIds.push(r.opponentId) }
        const users = await db.collection('users').find({ id: { $in: [...new Set(userIds)] } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))
        const rmap = Object.fromEntries(rooms.map(r => [r.id, clean(r)]))
        return J({ reports: reports.map(r => ({ ...clean(r), reporter: umap[r.reporterId], room: rmap[r.roomId], creator: rmap[r.roomId] ? umap[rmap[r.roomId].creatorId] : null, opponent: rmap[r.roomId]?.opponentId ? umap[rmap[r.roomId].opponentId] : null })) })
      }

      const reportMatch = route.match(/^\/admin\/report\/([^\/]+)$/)
      if (reportMatch && method === 'POST') {
        const reportId = reportMatch[1]
        const { action } = await request.json()
        const report = await db.collection('reports').findOne({ id: reportId })
        if (!report) return ERR('Denúncia não encontrada', 404)
        const room = await db.collection('rooms').findOne({ id: report.roomId })
        if (!room) return ERR('Sala não encontrada', 404)
        if (action === 'accept') {
          // Reporter becomes winner. If room already finalized, reverse and refinalize.
          if (room.status === 'FINALIZADA' && room.winnerId && room.winnerId !== report.reporterId) {
            // Reverse: take prize back from previous winner
            const prevWinner = await db.collection('users').findOne({ id: room.winnerId })
            await db.collection('users').updateOne({ id: room.winnerId }, {
              $inc: { balanceCents: -(room.prizeCents || 0), totalEarningsCents: -(room.prizeCents || 0), wins: -1 }
            })
            await db.collection('users').updateOne({ id: room.loserId }, { $inc: { losses: -1 } })
            await db.collection('transactions').insertOne({
              id: uuidv4(), userId: room.winnerId, type: 'reversal', amountCents: -(room.prizeCents || 0),
              roomId: room.id, balance: (prevWinner?.balanceCents || 0) - (room.prizeCents || 0),
              description: `Reversão prémio (denúncia aceite)`, createdAt: new Date(),
            })
          }
          await finalizeRoom(db, { ...room, status: 'EM_DISPUTA' }, report.reporterId, 'report_accepted')
          await db.collection('reports').updateOne({ id: reportId }, { $set: { status: 'ACEITE', processedAt: new Date() } })
          return J({ ok: true })
        } else if (action === 'reject') {
          await db.collection('reports').updateOne({ id: reportId }, { $set: { status: 'REJEITADA', processedAt: new Date() } })
          // If room is EM_DISPUTA, fall back: finalize with the player who claimed 'win' (not the reporter)
          if (room.status === 'EM_DISPUTA') {
            const claims = room.claims || {}
            const otherId = report.reporterId === room.creatorId ? room.opponentId : room.creatorId
            if (claims[otherId] === 'win') {
              await finalizeRoom(db, room, otherId, 'report_rejected')
            }
            // else leave EM_DISPUTA for manual resolution
          }
          return J({ ok: true })
        }
        return ERR('Ação inválida')
      }

      if (route === '/admin/unban' && method === 'POST') {
        const { userId } = await request.json()
        await db.collection('users').updateOne({ id: userId }, { $set: { banned: false }, $unset: { banReason: '' } })
        await createNotification(db, userId, 'account_update', 'Conta reativada',
          'A tua conta foi reativada e já podes voltar a utilizar a plataforma.')
        return J({ ok: true })
      }

      if (route === '/admin/disputes' && method === 'GET') {
        const rooms = await db.collection('rooms').find({ status: 'EM_DISPUTA' }).sort({ createdAt: -1 }).toArray()
        const reports = await db.collection('reports').find({ roomId: { $in: rooms.map(r => r.id) } }).toArray()
        const rmap = {}
        for (const r of reports) {
          rmap[r.roomId] = rmap[r.roomId] || []
          rmap[r.roomId].push(clean(r))
        }
        const messages = await db.collection('room_messages').find({ roomId: { $in: rooms.map(r => r.id) } }).sort({ createdAt: 1 }).toArray()
        const mmap = {}
        for (const m of messages) {
          mmap[m.roomId] = mmap[m.roomId] || []
          mmap[m.roomId].push(clean(m))
        }
        const ids = rooms.flatMap(r => [r.creatorId, r.opponentId]).filter(Boolean)
        const users = await db.collection('users').find({ id: { $in: ids } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))
        return J({ disputes: rooms.map(r => ({ ...clean(r), reports: rmap[r.id] || [], messages: mmap[r.id] || [], creator: umap[r.creatorId], opponent: umap[r.opponentId] })) })
      }

      const dispMatch = route.match(/^\/admin\/dispute\/([^\/]+)$/)
      if (dispMatch && method === 'POST') {
        const roomId = dispMatch[1]
        const { action, winnerId } = await request.json()
        const room = await db.collection('rooms').findOne({ id: roomId })
        if (!room) return ERR('Sala não encontrada', 404)
        if (action === 'approve_winner') {
          if (!winnerId || ![room.creatorId, room.opponentId].includes(winnerId)) return ERR('Vencedor inválido')
          await finalizeRoom(db, room, winnerId, 'admin_approved')
          await db.collection('reports').updateOne({ roomId, status: 'PENDENTE' }, { $set: { status: 'ACEITE', processedAt: new Date(), resolvedWinnerId: winnerId } })
          return J({ ok: true })
        } else if (action === 'cancel') {
          await refundRoom(db, room, 'admin_cancelled')
          await db.collection('reports').updateOne({ roomId, status: 'PENDENTE' }, { $set: { status: 'REJEITADA', processedAt: new Date() } })
          return J({ ok: true })
        }
        return ERR('Ação inválida')
      }

      if (route === '/admin/withdrawals' && method === 'GET') {
        const url = new URL(request.url)
        const status = url.searchParams.get('status')
        const filter = status && status !== 'all' ? { status } : {}
        const list = await db.collection('withdrawals').find(filter).sort({ createdAt: -1 }).limit(200).toArray()
        const ids = [...new Set(list.map(w => w.userId))]
        const users = await db.collection('users').find({ id: { $in: ids } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, { id: u.id, name: u.name, ffNickname: u.ffNickname, email: u.email }]))
        return J({ withdrawals: list.map(w => ({ ...clean(w), user: umap[w.userId] })) })
      }

      const wdMatch = route.match(/^\/admin\/withdrawal\/([^\/]+)\/(paid|reject|processing)$/)
      if (wdMatch && method === 'POST') {
        const wId = wdMatch[1]
        const wAction = wdMatch[2]
        const w = await db.collection('withdrawals').findOne({ id: wId })
        if (!w) return ERR('Pedido de levantamento não encontrado', 404)
        if (!['PENDENTE', 'EM_PROCESSAMENTO'].includes(w.status)) return ERR('Este pedido já foi processado')

        if (wAction === 'processing') {
          await db.collection('withdrawals').updateOne({ id: wId }, { $set: { status: 'EM_PROCESSAMENTO' } })
          await logAudit(db, admin, 'withdrawal_processing', 'withdrawal', wId, '')
          return J({ ok: true })
        }

        if (wAction === 'paid') {
          await db.collection('withdrawals').updateOne({ id: wId }, {
            $set: { status: 'PAGO', paidAt: new Date(), processedByName: admin.name || admin.email }
          })
          await db.collection('users').updateOne({ id: w.userId }, { $inc: { pendingCents: -w.amountCents } })
          await createNotification(db, w.userId, 'withdrawal_paid', 'Levantamento pago',
            `Informamos que o seu levantamento no valor de ${(w.amountCents/100).toFixed(2)}€ foi processado e pago com sucesso.`, wId)
          await logAudit(db, admin, 'withdrawal_paid', 'withdrawal', wId, `valor=${(w.amountCents/100).toFixed(2)}eur`)
          return J({ ok: true })
        }

        if (wAction === 'reject') {
          const { reason } = await request.json()
          await db.collection('withdrawals').updateOne({ id: wId }, {
            $set: { status: 'REJEITADO', rejectionReason: reason || '', processedByName: admin.name || admin.email, processedAt: new Date() }
          })
          await db.collection('users').updateOne({ id: w.userId }, {
            $inc: { balanceCents: w.amountCents, pendingCents: -w.amountCents }
          })
          await db.collection('transactions').insertOne({
            id: uuidv4(), userId: w.userId, type: 'withdrawal_refund', amountCents: w.amountCents,
            withdrawalId: wId, description: `Levantamento rejeitado: ${reason || 'sem motivo indicado'}`, createdAt: new Date(),
          })
          await createNotification(db, w.userId, 'withdrawal_rejected', 'Levantamento rejeitado',
            `O teu pedido de levantamento de ${(w.amountCents/100).toFixed(2)}€ foi rejeitado. Motivo: ${reason || 'não especificado'}. O valor foi devolvido ao teu saldo.`, wId)
          await logAudit(db, admin, 'withdrawal_rejected', 'withdrawal', wId, reason || '')
          return J({ ok: true })
        }
      }

      if (route === '/admin/audit-log' && method === 'GET') {
        const list = await db.collection('audit_log').find({}).sort({ createdAt: -1 }).limit(200).toArray()
        return J({ log: list.map(clean) })
      }

      // ===== ADMIN: MB WAY TOP-UPS =====
      if (route === '/admin/mbway-topups' && method === 'GET') {
        const url = new URL(request.url)
        const status = url.searchParams.get('status')
        const filter = status && status !== 'all' ? { status } : {}
        const list = await db.collection('mbway_topups').find(filter).sort({ createdAt: -1 }).limit(200).toArray()
        const ids = [...new Set(list.map(t => t.userId))]
        const users = await db.collection('users').find({ id: { $in: ids } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, { id: u.id, name: u.name, ffNickname: u.ffNickname, email: u.email }]))
        return J({ topups: list.map(t => ({ ...clean(t), user: umap[t.userId] })) })
      }

      const mbwayTopupMatch = route.match(/^\/admin\/mbway-topup\/([^\/]+)\/(confirm|reject)$/)
      if (mbwayTopupMatch && method === 'POST') {
        const tId = mbwayTopupMatch[1]
        const tAction = mbwayTopupMatch[2]
        const topup = await db.collection('mbway_topups').findOne({ id: tId })
        if (!topup) return ERR('Pedido de carregamento não encontrado', 404)
        if (topup.status !== 'PENDENTE') return ERR('Este pedido já foi processado')

        if (tAction === 'confirm') {
          const user = await db.collection('users').findOne({ id: topup.userId })
          if (!user) return ERR('Utilizador não encontrado', 404)
          const newBalance = (user.balanceCents || 0) + topup.amountCents
          await db.collection('mbway_topups').updateOne({ id: tId }, {
            $set: { status: 'CONFIRMADO', confirmedAt: new Date(), confirmedByName: admin.name || admin.email }
          })
          await db.collection('users').updateOne({ id: topup.userId }, { $set: { balanceCents: newBalance } })
          await db.collection('transactions').insertOne({
            id: uuidv4(), userId: topup.userId, type: 'topup', amountCents: topup.amountCents,
            balance: newBalance, description: `Carregamento MB WAY confirmado`, createdAt: new Date(),
          })
          await createNotification(db, topup.userId, 'topup_confirmed', 'Carregamento MB WAY confirmado',
            `O teu carregamento de ${(topup.amountCents/100).toFixed(2)}€ via MB WAY foi confirmado e adicionado ao teu saldo.`, tId)
          await logAudit(db, admin, 'mbway_topup_confirmed', 'mbway_topup', tId, `valor=${(topup.amountCents/100).toFixed(2)}eur`)
          return J({ ok: true })
        }

        if (tAction === 'reject') {
          const body = await request.json().catch(() => ({}))
          const reason = body.reason || ''
          await db.collection('mbway_topups').updateOne({ id: tId }, {
            $set: { status: 'REJEITADO', rejectionReason: reason, confirmedByName: admin.name || admin.email, confirmedAt: new Date() }
          })
          await createNotification(db, topup.userId, 'topup_rejected', 'Carregamento MB WAY rejeitado',
            `O teu pedido de carregamento de ${(topup.amountCents/100).toFixed(2)}€ via MB WAY foi rejeitado.${reason ? ` Motivo: ${reason}` : ''}`, tId)
          await logAudit(db, admin, 'mbway_topup_rejected', 'mbway_topup', tId, reason)
          return J({ ok: true })
        }
      }

      if (route === '/admin/ban' && method === 'POST') {
        const { userId, reason } = await request.json()
        await db.collection('users').updateOne({ id: userId }, { $set: { banned: true, banReason: reason || '' } })
        await createNotification(db, userId, 'account_update', 'Conta suspensa',
          `A tua conta foi suspensa.${reason ? ` Motivo: ${reason}` : ''}`)
        return J({ ok: true })
      }

      if (route === '/admin/users' && method === 'GET') {
        const users = await db.collection('users').find({ isAdmin: { $ne: true } })
          .project({ passwordHash: 0, salt: 0 }).sort({ createdAt: -1 }).limit(200).toArray()
        return J({ users: users.map(clean) })
      }

      if (route === '/admin/rooms' && method === 'GET') {
        const rooms = await db.collection('rooms').find({}).sort({ createdAt: -1 }).limit(200).toArray()
        return J({ rooms: rooms.map(clean) })
      }
    }

    return ERR(`Rota ${route} não encontrada`, 404)
  } catch (e) {
    console.error('API Error:', e)
    return ERR('Erro interno: ' + e.message, 500)
  }
}

// Process Stripe checkout.session.completed for top-up
async function processTopupCompleted(db, session) {
  const md = session.metadata || {}
  const { userId, type } = md
  if (type !== 'topup' || !userId) {
    console.warn('Bad topup metadata', md); return
  }
  const user = await db.collection('users').findOne({ id: userId })
  if (!user) { console.warn('User missing for topup', userId); return }
  const cents = session.amount_total
  const newBalance = (user.balanceCents || 0) + cents
  // Idempotency: insertOne is the atomic gate (stripeSessionId has a UNIQUE index).
  // Webhook and manual /stripe/verify can race; only the first insert proceeds to credit the balance.
  try {
    await db.collection('transactions').insertOne({
      id: uuidv4(), userId, type: 'topup', amountCents: cents,
      stripeSessionId: session.id, balance: newBalance,
      description: `Carregamento de saldo (Stripe)`, createdAt: new Date(),
    })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') { console.log('Topup already processed', session.id); return }
    throw e
  }
  await db.collection('users').updateOne({ id: userId }, { $set: { balanceCents: newBalance } })
  await createNotification(db, userId, 'topup_confirmed', 'Carregamento confirmado',
    `O teu carregamento de ${(cents / 100).toFixed(2)}€ foi confirmado e adicionado ao saldo.`, session.id)
}

async function refundRoom(db, room, reason) {
  await db.collection('rooms').updateOne({ id: room.id }, { $set: { status: 'CANCELADA', cancelReason: reason, finishedAt: new Date() } })
  // Refund both players to wallet
  for (const uid of [room.creatorId, room.opponentId].filter(Boolean)) {
    await db.collection('users').updateOne({ id: uid }, { $inc: { balanceCents: room.betAmountCents } })
    const u = await db.collection('users').findOne({ id: uid })
    await db.collection('transactions').insertOne({
      id: uuidv4(), userId: uid, type: 'refund', amountCents: room.betAmountCents,
      roomId: room.id, balance: u.balanceCents,
      description: `Reembolso sala ${room.id.slice(0,8)} (${reason})`,
      createdAt: new Date(),
    })
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
