// Remove test players and tournaments created by seed-tournament-test.js
// Run: node scripts/cleanup-test-data.js
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]
}

async function main() {
  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'ffarena',
    connectionLimit: 2,
  })

  // Remove test tournaments
  const [tours] = await pool.query("SELECT id FROM tournaments WHERE name LIKE 'Torneio Teste%'")
  if (tours.length) {
    const tIds = tours.map(t => t.id)
    await pool.query('DELETE FROM tournament_matches WHERE tournamentId IN (?)', [tIds])
    await pool.query('DELETE FROM tournament_participants WHERE tournamentId IN (?)', [tIds])
    await pool.query('DELETE FROM tournaments WHERE id IN (?)', [tIds])
    console.log(`✅ Removidos ${tIds.length} torneio(s) de teste`)
  } else {
    console.log('↩  Sem torneios de teste para remover')
  }

  // Remove test players
  const emails = [
    'test1@ff.test','test2@ff.test','test3@ff.test','test4@ff.test',
    'test5@ff.test','test6@ff.test','test7@ff.test','test8@ff.test',
  ]
  const [users] = await pool.query('SELECT id FROM users WHERE email IN (?)', [emails])
  if (users.length) {
    const ids = users.map(u => u.id)
    await pool.query('DELETE FROM tournament_participants WHERE userId IN (?)', [ids])
    await pool.query('DELETE FROM transactions WHERE userId IN (?)', [ids])
    await pool.query('DELETE FROM notifications WHERE userId IN (?)', [ids])
    await pool.query('DELETE FROM sessions WHERE userId IN (?)', [ids])
    await pool.query('DELETE FROM users WHERE id IN (?)', [ids])
    console.log(`✅ Removidos ${ids.length} jogadores de teste`)
  } else {
    console.log('↩  Sem jogadores de teste para remover')
  }

  await pool.end()
  console.log('Concluído.')
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
