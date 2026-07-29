// Seed script: creates 8 test players + 1 open tournament and enrolls all 8
// Run: node scripts/seed-tournament-test.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const mysql = require('mysql2/promise')
const { v4: uuidv4 } = require('uuid')

const PLAYERS = [
  { nick: 'SnipeKing99',   email: 'test1@ff.test', uid: 'FF001' },
  { nick: 'DragonBlaze',   email: 'test2@ff.test', uid: 'FF002' },
  { nick: 'ShadowRush',    email: 'test3@ff.test', uid: 'FF003' },
  { nick: 'IronWolf_PT',   email: 'test4@ff.test', uid: 'FF004' },
  { nick: 'BlazeStorm',    email: 'test5@ff.test', uid: 'FF005' },
  { nick: 'NightHawk_FF',  email: 'test6@ff.test', uid: 'FF006' },
  { nick: 'ProGamer_BR',   email: 'test7@ff.test', uid: 'FF007' },
  { nick: 'AlphaStrike',   email: 'test8@ff.test', uid: 'FF008' },
]

const TOURNAMENT = {
  name: 'Torneio Teste #1',
  description: 'Torneio de teste com 8 jogadores',
  entryFeeCents: 0,
  maxPlayers: 8,
  mode: 'X1',
  server: 'EU',
  weapons: 'Todas',
  platform: 'Misto',
  rules: 'Torneio de teste. Kill cam obrigatória.',
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

async function main() {
  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'ffarena',
    waitForConnections: true,
    connectionLimit: 2,
  })

  console.log('✅ Ligado à base de dados')

  // Create or reuse test players
  const userIds = []
  for (const p of PLAYERS) {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [p.email])
    if (existing.length) {
      console.log(`↩  Jogador já existe: ${p.nick} (${existing[0].id})`)
      userIds.push(existing[0].id)
      continue
    }
    const id = uuidv4()
    const { salt, hash } = hashPassword('teste123')
    await pool.query(
      `INSERT INTO users (id, email, passwordHash, salt, name, ffUid, ffNickname, balanceCents, deviceType, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, p.email, hash, salt, p.nick, p.uid, p.nick, 1000, 'MOBILE']
    )
    console.log(`✅ Criado: ${p.nick} (id=${id})`)
    userIds.push(id)
  }

  // Create tournament
  const [existingT] = await pool.query(
    'SELECT id FROM tournaments WHERE name = ? AND status IN (?,?,?)',
    [TOURNAMENT.name, 'RASCUNHO', 'ABERTO', 'EM_ANDAMENTO']
  )
  let tId
  if (existingT.length) {
    tId = existingT[0].id
    console.log(`↩  Torneio já existe: ${tId}`)
  } else {
    tId = uuidv4()
    await pool.query(
      `INSERT INTO tournaments (id, name, description, entryFeeCents, maxPlayers, currentPlayers, status, currentRound,
        winnerId, prizeFirstCents, prizeSecondCents, commissionCents, mode, server, weapons, platform, rules, createdAt)
       VALUES (?, ?, ?, ?, ?, 0, 'ABERTO', 0, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, NOW())`,
      [tId, TOURNAMENT.name, TOURNAMENT.description, TOURNAMENT.entryFeeCents, TOURNAMENT.maxPlayers,
       TOURNAMENT.mode, TOURNAMENT.server, TOURNAMENT.weapons, TOURNAMENT.platform, TOURNAMENT.rules]
    )
    console.log(`✅ Torneio criado: ${tId}`)
  }

  // Enroll players
  for (const userId of userIds) {
    const [already] = await pool.query(
      'SELECT id FROM tournament_participants WHERE tournamentId = ? AND userId = ?', [tId, userId]
    )
    if (already.length) {
      console.log(`↩  Já inscrito: ${userId}`)
      continue
    }
    await pool.query(
      'INSERT INTO tournament_participants (id, tournamentId, userId, eliminatedRound, createdAt) VALUES (?, ?, ?, NULL, NOW())',
      [uuidv4(), tId, userId]
    )
  }

  // Update player count
  const [cnt] = await pool.query(
    'SELECT COUNT(*) as n FROM tournament_participants WHERE tournamentId = ?', [tId]
  )
  await pool.query('UPDATE tournaments SET currentPlayers = ? WHERE id = ?', [cnt[0].n, tId])

  console.log(`\n🏆 Torneio "${TOURNAMENT.name}" com ${cnt[0].n}/8 jogadores inscritos`)
  console.log(`\n📋 Credenciais de teste (password: teste123):`)
  for (const p of PLAYERS) console.log(`   ${p.nick.padEnd(18)} → ${p.email}`)
  console.log(`\n👉 Vai ao painel admin e clica "▶ Iniciar" no torneio "${TOURNAMENT.name}"`)

  await pool.end()
}

main().catch(e => { console.error('❌ Erro:', e.message); process.exit(1) })
