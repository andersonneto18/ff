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
      return J({ topupsEnabled: map.topupsEnabled !== '0', stripeEnabled: map.stripeEnabled !== '0', bonusEnabled: map.bonusEnabled === '1', mbwayPhone: map.mbwayPhone || null, platformIban: map.platformIban || null, commissionPercent: Math.round(COMMISSION * 100) })
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

      if (action === 'cancel' && method === 'POST') {
        if (room.creatorId !== user.id) return ERR('Só o criador pode cancelar a sala', 403)
        if (room.status !== 'ABERTA') return ERR('Só podes cancelar uma sala que ainda está aberta (sem adversário)')
        await refundRoom(db, room, 'creator_cancelled')
        return J({ ok: true })
      }

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
        // Atomic claim: only succeeds if room is still ABERTA with no opponent
        const claimed = await db.collection('rooms').updateOne(
          { id: roomId, status: 'ABERTA', opponentId: { $isNull: true } },
          { $set: { status: 'EMPARELHADA', opponentId: user.id, opponentPaid: true, opponentPaidAt: new Date() } }
        )
        if (claimed.affectedRows === 0) return ERR('Sala já foi preenchida por outro jogador')
        // Room secured — now debit balance
        const newBalance = balance - betCents
        await db.collection('users').updateOne({ id: user.id }, { $set: { balanceCents: newBalance } })
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
        const { reason, videoData, screenshots } = await request.json()
        if (room.creatorId !== user.id && room.opponentId !== user.id) return ERR('Não és participante', 403)
        if (!['EM_ANDAMENTO', 'EM_CONFLITO', 'EM_DISPUTA', 'FINALIZADA'].includes(room.status)) return ERR('Estado da sala não permite denúncia')
        if (room.status === 'FINALIZADA') {
          if (room.winnerId === user.id) return ERR('O vencedor não pode denunciar')
          const finishedAgo = Date.now() - new Date(room.finishedAt || 0).getTime()
          if (finishedAgo > 24 * 60 * 60 * 1000) return ERR('Prazo de denúncia expirado (24h)')
        }
        const sc = Array.isArray(screenshots) ? screenshots.filter(Boolean).slice(0, 6) : []
        await db.collection('reports').insertOne({
          id: uuidv4(), roomId: room.id, reporterId: user.id, reason: reason || '',
          videoData: videoData || null, screenshots: sc, status: 'PENDENTE',
          createdAt: new Date(),
        })
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

    // ===== TOURNAMENTS =====
    if (route === '/tournaments' && method === 'GET') {
      const user = await getUserFromRequest(request)
      const list = await db.collection('tournaments').find({ status: { $in: ['ABERTO', 'EM_ANDAMENTO'] } }).sort({ createdAt: -1 }).limit(20).toArray()
      if (user) {
        const tIds = list.map(t => t.id)
        const joined = tIds.length ? await db.collection('tournament_participants').find({ tournamentId: { $in: tIds }, userId: user.id }).toArray() : []
        const joinedSet = new Set(joined.map(j => j.tournamentId))
        return J({ tournaments: list.map(t => ({ ...clean(t), isJoined: joinedSet.has(t.id) })) })
      }
      return J({ tournaments: list.map(clean) })
    }

    const tourMatch = route.match(/^\/tournaments\/([^\/]+)(?:\/(.*))?$/)
    if (tourMatch && !route.startsWith('/admin/')) {
      const tId = tourMatch[1]; const tAction = tourMatch[2]
      const tournament = await db.collection('tournaments').findOne({ id: tId })
      if (!tournament) return ERR('Torneio não encontrado', 404)

      if (!tAction && method === 'GET') {
        const participants = await db.collection('tournament_participants').find({ tournamentId: tId }).toArray()
        const userIds = participants.map(p => p.userId)
        const users = await db.collection('users').find({ id: { $in: userIds } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, { id: u.id, name: u.name, ffNickname: u.ffNickname, photoUrl: u.photoUrl, wins: u.wins, losses: u.losses }]))
        const matches = await db.collection('tournament_matches').find({ tournamentId: tId }).sort({ round: 1 }).toArray()
        return J({ tournament: clean(tournament), participants: participants.map(p => ({ ...clean(p), user: umap[p.userId] })), matches: matches.map(clean), umap })
      }

      if (tAction === 'join' && method === 'POST') {
        const user = await getUserFromRequest(request)
        if (!user) return ERR('Não autenticado', 401)
        if (user.banned) return ERR('Conta banida', 403)
        if (tournament.status !== 'ABERTO') return ERR('Torneio não está aberto para inscrições')
        if (tournament.currentPlayers >= tournament.maxPlayers) return ERR('Torneio já está cheio')
        const already = await db.collection('tournament_participants').findOne({ tournamentId: tId, userId: user.id })
        if (already) return ERR('Já estás inscrito neste torneio')
        const fee = tournament.entryFeeCents || 0
        if ((user.balanceCents || 0) < fee) return J({ error: 'Saldo insuficiente', needTopup: true, balanceCents: user.balanceCents, requiredCents: fee }, 402)
        const newBalance = (user.balanceCents || 0) - fee
        await db.collection('users').updateOne({ id: user.id }, { $set: { balanceCents: newBalance } })
        await db.collection('tournament_participants').insertOne({ id: uuidv4(), tournamentId: tId, userId: user.id, eliminatedRound: null, createdAt: new Date() })
        await db.collection('tournaments').updateOne({ id: tId }, { $inc: { currentPlayers: 1 } })
        if (fee > 0) await db.collection('transactions').insertOne({ id: uuidv4(), userId: user.id, type: 'tournament_entry', amountCents: -fee, balance: newBalance, description: `Inscrição torneio: ${tournament.name}`, createdAt: new Date() })
        await createNotification(db, user.id, 'tournament', '🏆 Inscrição confirmada', `Estás inscrito no torneio "${tournament.name}". Aguarda o início!`)
        return J({ ok: true, balanceCents: newBalance })
      }

      if (tAction === 'leave' && method === 'POST') {
        const user = await getUserFromRequest(request)
        if (!user) return ERR('Não autenticado', 401)
        if (tournament.status !== 'ABERTO') return ERR('Só podes sair antes do torneio começar')
        const participant = await db.collection('tournament_participants').findOne({ tournamentId: tId, userId: user.id })
        if (!participant) return ERR('Não estás inscrito neste torneio')
        await db.collection('tournament_participants').deleteMany({ id: participant.id })
        await db.collection('tournaments').updateOne({ id: tId }, { $inc: { currentPlayers: -1 } })
        const fee = tournament.entryFeeCents || 0
        if (fee > 0) {
          const newBalance = (user.balanceCents || 0) + fee
          await db.collection('users').updateOne({ id: user.id }, { $set: { balanceCents: newBalance } })
          await db.collection('transactions').insertOne({ id: uuidv4(), userId: user.id, type: 'tournament_refund', amountCents: fee, balance: newBalance, description: `Saída do torneio: ${tournament.name}`, createdAt: new Date() })
          await createNotification(db, user.id, 'tournament', 'Saíste do torneio', `A tua inscrição no torneio "${tournament.name}" foi cancelada. Os ${(fee/100).toFixed(2)}€ foram devolvidos ao teu saldo.`)
        }
        return J({ ok: true })
      }

      const matchReportMatch = tAction?.match(/^match\/([^\/]+)\/report$/)
      if (matchReportMatch && method === 'POST') {
        const user = await getUserFromRequest(request)
        if (!user) return ERR('Não autenticado', 401)
        const matchId = matchReportMatch[1]
        const match = await db.collection('tournament_matches').findOne({ id: matchId, tournamentId: tId })
        if (!match) return ERR('Partida não encontrada', 404)
        if (match.player1Id !== user.id && match.player2Id !== user.id) return ERR('Não és participante', 403)
        const { reason, videoData, screenshots } = await request.json()
        const sc = Array.isArray(screenshots) ? screenshots.filter(Boolean).slice(0, 6) : []
        await db.collection('reports').insertOne({
          id: uuidv4(), roomId: null, tournamentId: tId, tournamentMatchId: matchId,
          reporterId: user.id, reason: reason || '', videoData: videoData || null,
          screenshots: sc, status: 'PENDENTE', createdAt: new Date(),
        })
        await db.collection('tournament_matches').updateOne({ id: matchId }, { $set: { status: 'EM_CONFLITO' } })
        return J({ ok: true })
      }

      const matchClaimMatch = tAction?.match(/^match\/([^\/]+)\/claim$/)
      if (matchClaimMatch && method === 'POST') {
        const user = await getUserFromRequest(request)
        if (!user) return ERR('Não autenticado', 401)
        const matchId = matchClaimMatch[1]
        const match = await db.collection('tournament_matches').findOne({ id: matchId, tournamentId: tId })
        if (!match) return ERR('Partida não encontrada', 404)
        if (match.status !== 'PENDENTE') return ERR('Esta partida já foi decidida')
        const isP1 = match.player1Id === user.id, isP2 = match.player2Id === user.id
        if (!isP1 && !isP2) return ERR('Não és participante desta partida', 403)
        const { result } = await request.json()
        if (!['win', 'loss'].includes(result)) return ERR('Resultado inválido')
        const update = isP1 ? { claim1: result } : { claim2: result }
        await db.collection('tournament_matches').updateOne({ id: matchId }, { $set: update })
        const updated = await db.collection('tournament_matches').findOne({ id: matchId })
        if (updated.claim1 && updated.claim2) {
          if (updated.claim1 === 'win' && updated.claim2 === 'loss') {
            await finalizeTournamentMatch(db, tournament, updated, updated.player1Id)
          } else if (updated.claim2 === 'win' && updated.claim1 === 'loss') {
            await finalizeTournamentMatch(db, tournament, updated, updated.player2Id)
          } else {
            await db.collection('tournament_matches').updateOne({ id: matchId }, { $set: { status: 'EM_CONFLITO' } })
          }
        }
        return J({ ok: true })
      }
    }

    // ===== SUPPORT CHAT =====
    if (route === '/support/messages' && method === 'GET') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      const msgs = await db.collection('support_messages').find({ userId: user.id }).sort({ createdAt: 1 }).limit(200).toArray()
      const unread = msgs.filter(m => m.sender === 'admin' && !m.isRead).length
      await db.collection('support_messages').updateOne({ userId: user.id, sender: 'admin', isRead: false }, { $set: { isRead: true } })
      return J({ messages: msgs.map(clean), unread })
    }

    if (route === '/support/messages' && method === 'POST') {
      const user = await getUserFromRequest(request)
      if (!user) return ERR('Não autenticado', 401)
      if (user.banned) return ERR('Conta banida', 403)
      const { message } = await request.json()
      const text = (message || '').trim()
      if (!text) return ERR('Mensagem vazia')
      if (text.length > 1000) return ERR('Mensagem demasiado longa')
      const doc = { id: uuidv4(), userId: user.id, sender: 'player', message: text, isRead: false, createdAt: new Date() }
      await db.collection('support_messages').insertOne(doc)
      return J({ ok: true, message: clean(doc) })
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
        return J({ topupsEnabled: map.topupsEnabled !== '0', stripeEnabled: map.stripeEnabled !== '0', bonusEnabled: map.bonusEnabled === '1', mbwayPhone: map.mbwayPhone || null, platformIban: map.platformIban || null })
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
        if (typeof body.platformIban !== 'undefined') {
          const iban = (body.platformIban || '').trim()
          const existing = await db.collection('platform_settings').findOne({ key: 'platformIban' })
          if (existing) {
            await db.collection('platform_settings').updateOne({ key: 'platformIban' }, { $set: { value: iban } })
          } else {
            await db.collection('platform_settings').insertOne({ key: 'platformIban', value: iban })
          }
          await logAudit(db, admin, 'platform_iban_updated', 'platform', 'settings', iban)
        }
        if (typeof body.bonusEnabled !== 'undefined') {
          const val = body.bonusEnabled ? '1' : '0'
          const existing = await db.collection('platform_settings').findOne({ key: 'bonusEnabled' })
          if (existing) {
            await db.collection('platform_settings').updateOne({ key: 'bonusEnabled' }, { $set: { value: val } })
          } else {
            await db.collection('platform_settings').insertOne({ key: 'bonusEnabled', value: val })
          }
          await logAudit(db, admin, body.bonusEnabled ? 'bonus_banner_enabled' : 'bonus_banner_disabled', 'platform', 'settings')
        }
        const updated = await db.collection('platform_settings').find({}).toArray()
        const map = Object.fromEntries(updated.map(s => [s.key, s.value]))
        return J({ success: true, topupsEnabled: map.topupsEnabled !== '0', stripeEnabled: map.stripeEnabled !== '0', bonusEnabled: map.bonusEnabled === '1', mbwayPhone: map.mbwayPhone || null, platformIban: map.platformIban || null })
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
          await db.collection('reports').updateOne({ id: reportId }, { $set: { status: 'ACEITE', processedAt: new Date(), videoData: null, screenshots: [] } })
          return J({ ok: true })
        } else if (action === 'reject') {
          await db.collection('reports').updateOne({ id: reportId }, { $set: { status: 'REJEITADA', processedAt: new Date(), videoData: null, screenshots: [] } })
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

      // ===== ADMIN TOURNAMENTS =====
      if (route === '/admin/tournaments' && method === 'GET') {
        const list = await db.collection('tournaments').find({}).sort({ createdAt: -1 }).limit(50).toArray()
        const withCounts = await Promise.all(list.map(async t => {
          const count = await db.collection('tournament_participants').countDocuments({ tournamentId: t.id })
          return { ...clean(t), currentPlayers: count }
        }))
        return J({ tournaments: withCounts })
      }

      if (route === '/admin/tournaments' && method === 'POST') {
        const b = await request.json()
        const { name, description, entryFeeEuros, maxPlayers, mode, server, weapons, platform, rules } = b
        if (!name?.trim()) return ERR('Nome obrigatório')
        const fee = Math.round(parseFloat(entryFeeEuros || 0) * 100)
        const max = parseInt(maxPlayers) || 8
        if (max < 2 || max > 64) return ERR('Máximo de jogadores deve ser entre 2 e 64')
        const t = { id: uuidv4(), name: name.trim(), description: description?.trim() || '', entryFeeCents: fee, maxPlayers: max, currentPlayers: 0, status: 'RASCUNHO', currentRound: 0, winnerId: null, prizeFirstCents: null, prizeSecondCents: null, commissionCents: null, mode: mode?.trim() || null, server: server?.trim() || null, weapons: weapons?.trim() || null, platform: platform?.trim() || null, rules: rules?.trim() || null, createdAt: new Date(), startedAt: null, finishedAt: null }
        await db.collection('tournaments').insertOne(t)
        await logAudit(db, admin, 'tournament_created', 'tournament', t.id, name)
        return J({ tournament: clean(t) })
      }

      const adminTourMatch = route.match(/^\/admin\/tournaments\/([^\/]+)(?:\/(.*))?$/)
      if (adminTourMatch) {
        const tId = adminTourMatch[1]; const tAction = adminTourMatch[2]
        const tournament = await db.collection('tournaments').findOne({ id: tId })
        if (!tournament) return ERR('Torneio não encontrado', 404)

        if (!tAction && method === 'PUT') {
          const b = await request.json()
          const upd = {}
          if (b.name !== undefined) upd.name = b.name.trim()
          if (b.description !== undefined) upd.description = b.description.trim()
          if (b.entryFeeEuros !== undefined) upd.entryFeeCents = Math.round(parseFloat(b.entryFeeEuros) * 100)
          if (b.maxPlayers !== undefined) upd.maxPlayers = parseInt(b.maxPlayers)
          if (b.status !== undefined && ['RASCUNHO','ABERTO','CANCELADO'].includes(b.status)) upd.status = b.status
          if (Object.keys(upd).length) await db.collection('tournaments').updateOne({ id: tId }, { $set: upd })
          await logAudit(db, admin, 'tournament_updated', 'tournament', tId, JSON.stringify(upd))
          return J({ ok: true })
        }

        if (tAction === 'start' && method === 'POST') {
          if (tournament.status !== 'ABERTO') return ERR('Torneio não está aberto')
          const participants = await db.collection('tournament_participants').find({ tournamentId: tId }).toArray()
          if (participants.length < 2) return ERR('Mínimo 2 jogadores para iniciar')
          // Shuffle participants
          const shuffled = participants.sort(() => Math.random() - 0.5)
          const totalPot = tournament.entryFeeCents * shuffled.length
          const commission = Math.round(totalPot * COMMISSION)
          const prizeFirst = Math.round((totalPot - commission) * 0.875)
          const prizeSecond = totalPot - commission - prizeFirst
          await db.collection('tournaments').updateOne({ id: tId }, { $set: { status: 'EM_ANDAMENTO', currentRound: 1, startedAt: new Date(), prizeFirstCents: prizeFirst, prizeSecondCents: prizeSecond, commissionCents: commission } })
          await generateRoundMatches(db, tId, shuffled.map(p => p.userId), 1, tournament.name)
          for (const p of shuffled) await createNotification(db, p.userId, 'tournament', '🏆 Torneio iniciado!', `O torneio "${tournament.name}" começou! Verifica o teu duelo na tab Torneios.`)
          await logAudit(db, admin, 'tournament_started', 'tournament', tId, '')
          return J({ ok: true })
        }

        if (tAction === 'cancel' && method === 'POST') {
          await db.collection('tournaments').updateOne({ id: tId }, { $set: { status: 'CANCELADO', finishedAt: new Date() } })
          // Refund all participants
          const parts = await db.collection('tournament_participants').find({ tournamentId: tId }).toArray()
          for (const p of parts) {
            if (tournament.entryFeeCents > 0) {
              const u = await db.collection('users').findOne({ id: p.userId })
              const nb = (u?.balanceCents || 0) + tournament.entryFeeCents
              await db.collection('users').updateOne({ id: p.userId }, { $set: { balanceCents: nb } })
              await db.collection('transactions').insertOne({ id: uuidv4(), userId: p.userId, type: 'tournament_refund', amountCents: tournament.entryFeeCents, balance: nb, description: `Reembolso torneio cancelado: ${tournament.name}`, createdAt: new Date() })
              await createNotification(db, p.userId, 'tournament', 'Torneio cancelado', `O torneio "${tournament.name}" foi cancelado. A tua inscrição foi reembolsada.`)
            }
          }
          await logAudit(db, admin, 'tournament_cancelled', 'tournament', tId, '')
          return J({ ok: true })
        }

        const adminMatchResolve = tAction?.match(/^match\/([^\/]+)\/resolve$/)
        if (adminMatchResolve && method === 'POST') {
          const matchId = adminMatchResolve[1]
          const { winnerId } = await request.json()
          const match = await db.collection('tournament_matches').findOne({ id: matchId, tournamentId: tId })
          if (!match) return ERR('Partida não encontrada', 404)
          if (![match.player1Id, match.player2Id].includes(winnerId)) return ERR('Vencedor inválido')
          await finalizeTournamentMatch(db, tournament, match, winnerId)
          await logAudit(db, admin, 'tournament_match_resolved', 'tournament', tId, `matchId=${matchId} winner=${winnerId}`)
          return J({ ok: true })
        }
      }

      if (route === '/admin/bonus-eligible' && method === 'GET') {
        // First 3 unique players (creators) whose rooms were finalized, ordered by finishedAt
        const finalized = await db.collection('rooms')
          .find({ status: 'FINALIZADA' })
          .sort({ finishedAt: 1 })
          .limit(200)
          .toArray()
        const seen = []
        for (const r of finalized) {
          if (!seen.find(s => s.userId === r.creatorId)) {
            seen.push({ userId: r.creatorId, roomId: r.id, finishedAt: r.finishedAt })
          }
          if (seen.length === 3) break
        }
        const ids = seen.map(s => s.userId)
        const users = await db.collection('users').find({ id: { $in: ids } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, u]))
        return J({ eligible: seen.map(s => ({ ...s, user: sanitizeUser(umap[s.userId]) })) })
      }

      if (route === '/admin/bonus-credit' && method === 'POST') {
        const { userId, amountCents } = await request.json()
        if (!userId || !amountCents) return ERR('userId e amountCents obrigatórios')
        const target = await db.collection('users').findOne({ id: userId })
        if (!target) return ERR('Utilizador não encontrado', 404)
        const newBalance = (target.balanceCents || 0) + amountCents
        await db.collection('users').updateOne({ id: userId }, { $set: { balanceCents: newBalance } })
        await db.collection('transactions').insertOne({
          id: uuidv4(), userId, type: 'bonus', amountCents,
          balance: newBalance, description: `Bónus de boas-vindas`, createdAt: new Date(),
        })
        await createNotification(db, userId, 'bonus', '🎁 Bónus creditado!',
          `Parabéns! Recebeste um bónus de ${(amountCents/100).toFixed(2)}€ na tua conta.`)
        await logAudit(db, admin, 'bonus_credited', 'user', userId, `${(amountCents/100).toFixed(2)}eur`)
        return J({ ok: true, newBalance })
      }

      if (route === '/admin/support' && method === 'GET') {
        const msgs = await db.collection('support_messages').find({}).sort({ createdAt: -1 }).limit(500).toArray()
        const userIds = [...new Set(msgs.map(m => m.userId))]
        const users = await db.collection('users').find({ id: { $in: userIds } }).toArray()
        const umap = Object.fromEntries(users.map(u => [u.id, { id: u.id, name: u.name, ffNickname: u.ffNickname, email: u.email, photoUrl: u.photoUrl }]))
        const chats = {}
        for (const m of msgs) {
          if (!chats[m.userId]) chats[m.userId] = { user: umap[m.userId] || { id: m.userId }, messages: [], unread: 0 }
          chats[m.userId].messages.unshift(clean(m))
          if (m.sender === 'player' && !m.isRead) chats[m.userId].unread++
        }
        return J({ chats: Object.values(chats).sort((a, b) => {
          const aLast = a.messages[a.messages.length - 1]?.createdAt || 0
          const bLast = b.messages[b.messages.length - 1]?.createdAt || 0
          return new Date(bLast) - new Date(aLast)
        })})
      }

      const supportReplyMatch = route.match(/^\/admin\/support\/([^\/]+)$/)
      if (supportReplyMatch && method === 'POST') {
        const targetUserId = supportReplyMatch[1]
        const { message } = await request.json()
        const text = (message || '').trim()
        if (!text) return ERR('Mensagem vazia')
        const doc = { id: uuidv4(), userId: targetUserId, sender: 'admin', message: text, isRead: false, createdAt: new Date() }
        await db.collection('support_messages').insertOne(doc)
        await db.collection('support_messages').updateOne({ userId: targetUserId, sender: 'player', isRead: false }, { $set: { isRead: true } })
        await createNotification(db, targetUserId, 'support', 'Resposta do suporte', text.slice(0, 100))
        return J({ ok: true, message: clean(doc) })
      }

      if (route === '/admin/support/clear' && method === 'POST') {
        const { userId } = await request.json()
        if (userId) {
          await db.collection('support_messages').deleteMany({ userId })
        } else {
          await db.collection('support_messages').deleteMany({})
        }
        return J({ ok: true })
      }

      if (route === '/admin/reports/clear' && method === 'POST') {
        await db.collection('reports').deleteMany({ status: { $in: ['ACEITE', 'REJEITADA'] } })
        await logAudit(db, admin, 'reports_cleared', 'reports', null, 'all processed reports deleted')
        return J({ ok: true })
      }

      if (route === '/admin/mbway-topups/clear' && method === 'POST') {
        await db.collection('mbway_topups').deleteMany({ status: { $in: ['CONFIRMADO', 'REJEITADO'] } })
        await logAudit(db, admin, 'mbway_topups_cleared', 'mbway_topups', null, 'all processed topups deleted')
        return J({ ok: true })
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

async function generateRoundMatches(db, tournamentId, playerIds, round, tournamentName) {
  for (let i = 0; i + 1 < playerIds.length; i += 2) {
    await db.collection('tournament_matches').insertOne({ id: uuidv4(), tournamentId, round, player1Id: playerIds[i], player2Id: playerIds[i + 1], claim1: null, claim2: null, winnerId: null, status: 'PENDENTE', createdAt: new Date(), finishedAt: null })
  }
  // Bye for odd player — advances automatically
  if (playerIds.length % 2 === 1) {
    const byePlayer = playerIds[playerIds.length - 1]
    await db.collection('tournament_matches').insertOne({ id: uuidv4(), tournamentId, round, player1Id: byePlayer, player2Id: 'BYE', claim1: null, claim2: null, winnerId: byePlayer, status: 'BYE', createdAt: new Date(), finishedAt: new Date() })
    await createNotification(db, byePlayer, 'tournament', '⚡ Avanças automaticamente!', `Na ronda ${round} do torneio "${tournamentName}" não tinhas adversário — avançaste sem jogar!`)
  }
}

async function finalizeTournamentMatch(db, tournament, match, winnerId) {
  const loserId = match.player2Id === 'BYE' ? null : (winnerId === match.player1Id ? match.player2Id : match.player1Id)
  await db.collection('tournament_matches').updateOne({ id: match.id }, { $set: { status: 'FINALIZADA', winnerId, finishedAt: new Date() } })
  if (loserId) await db.collection('tournament_participants').updateOne({ tournamentId: tournament.id, userId: loserId }, { $set: { eliminatedRound: match.round } })

  const tFresh = await db.collection('tournaments').findOne({ id: tournament.id })
  const roundMatches = await db.collection('tournament_matches').find({ tournamentId: tournament.id, round: match.round }).toArray()
  const allDone = roundMatches.every(m => ['FINALIZADA', 'BYE'].includes(m.status) || m.id === match.id)
  if (!allDone) return

  const winners = roundMatches.map(m => m.id === match.id ? winnerId : m.winnerId).filter(Boolean)

  if (winners.length === 1) {
    // Tournament over — distribute prizes
    const prize1 = tFresh.prizeFirstCents || 0
    const prize2 = tFresh.prizeSecondCents || 0
    const finalWinner = winners[0]
    const finalLoser = loserId
    const wu = await db.collection('users').findOne({ id: finalWinner })
    const nb1 = (wu?.balanceCents || 0) + prize1
    await db.collection('users').updateOne({ id: finalWinner }, { $set: { balanceCents: nb1 }, $inc: { totalEarningsCents: prize1 } })
    await db.collection('transactions').insertOne({ id: uuidv4(), userId: finalWinner, type: 'tournament_prize', amountCents: prize1, balance: nb1, description: `1º lugar torneio: ${tFresh.name}`, createdAt: new Date() })
    if (prize2 > 0 && finalLoser) {
      const lu = await db.collection('users').findOne({ id: finalLoser })
      const nb2 = (lu?.balanceCents || 0) + prize2
      await db.collection('users').updateOne({ id: finalLoser }, { $set: { balanceCents: nb2 }, $inc: { totalEarningsCents: prize2 } })
      await db.collection('transactions').insertOne({ id: uuidv4(), userId: finalLoser, type: 'tournament_prize', amountCents: prize2, balance: nb2, description: `2º lugar torneio: ${tFresh.name}`, createdAt: new Date() })
      await createNotification(db, finalLoser, 'tournament', '🥈 2º lugar!', `Ficaste em 2º lugar no torneio "${tFresh.name}" e recebeste ${(prize2/100).toFixed(2)}€!`)
    }
    await db.collection('tournaments').updateOne({ id: tournament.id }, { $set: { status: 'FINALIZADO', winnerId: finalWinner, finishedAt: new Date() } })
    await createNotification(db, finalWinner, 'tournament', '🏆 Campeão!', `Parabéns! Ganhaste o torneio "${tFresh.name}" e recebeste ${(prize1/100).toFixed(2)}€!`)
  } else {
    // Generate next round (with automatic bye if odd number of winners)
    const nextRound = match.round + 1
    await db.collection('tournaments').updateOne({ id: tournament.id }, { $set: { currentRound: nextRound } })
    await generateRoundMatches(db, tournament.id, winners, nextRound, tFresh.name)
    const activeParts = await db.collection('tournament_participants').find({ tournamentId: tournament.id, eliminatedRound: null }).toArray()
    for (const p of activeParts) await createNotification(db, p.userId, 'tournament', `🏆 Ronda ${nextRound}`, `A ronda ${nextRound} do torneio "${tFresh.name}" começou! Verifica o teu duelo.`)
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
