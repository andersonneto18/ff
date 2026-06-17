// RESET SCRIPT — zeroes all player balances, earnings, wins/losses and clears
// all financial history (transactions, commissions, withdrawals, rooms, reports).
// Run ONLY in a controlled environment. This is irreversible.
//
// Usage: node scripts/reset-platform.js
//        node scripts/reset-platform.js --confirm   (skip interactive prompt)

const fs = require('fs')
const path = require('path')
const readline = require('readline')

// Load .env
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

const mysql = require('mysql2/promise')

async function confirm(question) {
  if (process.argv.includes('--confirm')) return true
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question + ' (sim/nao): ', ans => { rl.close(); resolve(ans.trim().toLowerCase() === 'sim') }))
}

async function main() {
  console.log('\n⚠️  RESET DA PLATAFORMA FF ARENA')
  console.log('='.repeat(50))
  console.log('Isto irá:')
  console.log('  • Zerar saldo, ganhos, vitórias e derrotas de todos os jogadores')
  console.log('  • Apagar todas as transações e comissões')
  console.log('  • Apagar todos os levantamentos e pedidos MB WAY')
  console.log('  • Apagar todas as salas, denúncias e mensagens')
  console.log('  • NÃO apaga utilizadores nem sessões\n')

  const ok = await confirm('Tens a certeza que queres continuar?')
  if (!ok) { console.log('Cancelado.'); process.exit(0) }

  const pool = await mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'ff_arena',
    waitForConnections: true,
    connectionLimit: 3,
  })

  console.log('\n🔄 A resetar...\n')

  // 1. Zero all player stats and balances
  const [usersResult] = await pool.query(
    `UPDATE users SET balanceCents=0, pendingCents=0, totalEarningsCents=0, wins=0, losses=0 WHERE isAdmin=0`
  )
  console.log(`✅ Jogadores resetados: ${usersResult.affectedRows} contas zeradas`)

  // 2. Delete all transactions (commissions, topups, wins, bets...)
  const [txResult] = await pool.query(`DELETE FROM transactions`)
  console.log(`✅ Transações apagadas: ${txResult.affectedRows}`)

  // 3. Delete all rooms and related data
  const [roomsResult] = await pool.query(`DELETE FROM rooms`)
  console.log(`✅ Salas apagadas: ${roomsResult.affectedRows}`)

  const [msgsResult] = await pool.query(`DELETE FROM room_messages`)
  console.log(`✅ Mensagens de salas apagadas: ${msgsResult.affectedRows}`)

  // 4. Delete all reports
  const [reportsResult] = await pool.query(`DELETE FROM reports`)
  console.log(`✅ Denúncias apagadas: ${reportsResult.affectedRows}`)

  // 5. Delete all withdrawals
  const [wdResult] = await pool.query(`DELETE FROM withdrawals`)
  console.log(`✅ Levantamentos apagados: ${wdResult.affectedRows}`)

  // 6. Delete all MB WAY topups
  const [mbwayResult] = await pool.query(`DELETE FROM mbway_topups`)
  console.log(`✅ Carregamentos MB WAY apagados: ${mbwayResult.affectedRows}`)

  // 7. Delete all notifications
  const [notifResult] = await pool.query(`DELETE FROM notifications`)
  console.log(`✅ Notificações apagadas: ${notifResult.affectedRows}`)

  // 8. Keep platform_settings and users intact
  console.log('\n✅ Configurações da plataforma mantidas (MB WAY, IBAN, toggles)')
  console.log('✅ Contas de utilizadores mantidas (emails, passwords, nicknames)')

  console.log('\n🎉 Reset completo! A plataforma está limpa e pronta a usar.\n')

  await pool.end()
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
