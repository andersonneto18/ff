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
  console.log('  • Desligar todos os jogadores de qualquer influenciador (referredBy)')
  console.log('  • Apagar todas as transações e comissões')
  console.log('  • Apagar todas as salas, denúncias e mensagens')
  console.log('  • Apagar todos os levantamentos e pedidos MB WAY')
  console.log('  • Apagar todos os torneios, partidas e inscrições')
  console.log('  • Apagar TODOS os influenciadores e as suas comissões/levantamentos')
  console.log('  • Apagar todo o histórico de suporte e o log de auditoria')
  console.log('  • Apagar todas as notificações')
  console.log('  • NÃO apaga contas de utilizador nem sessões (ninguém precisa de voltar a fazer login)')
  console.log('  • NÃO apaga configurações da plataforma (MB WAY, IBAN, comissão, toggles)\n')

  const ok = await confirm('Tens a certeza que queres continuar? Isto é IRREVERSÍVEL')
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

  // 1. Zero all player stats and balances, and unlink any referral attribution
  const [usersResult] = await pool.query(
    `UPDATE users SET balanceCents=0, pendingCents=0, totalEarningsCents=0, wins=0, losses=0, referredBy=NULL WHERE isAdmin=0`
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

  // 8. Delete all tournaments and related data
  const [tmResult] = await pool.query(`DELETE FROM tournament_matches`)
  console.log(`✅ Partidas de torneio apagadas: ${tmResult.affectedRows}`)
  const [tpResult] = await pool.query(`DELETE FROM tournament_participants`)
  console.log(`✅ Inscrições em torneios apagadas: ${tpResult.affectedRows}`)
  const [tResult] = await pool.query(`DELETE FROM tournaments`)
  console.log(`✅ Torneios apagados: ${tResult.affectedRows}`)

  // 9. Delete all influencers and their data
  const [itResult] = await pool.query(`DELETE FROM influencer_transactions`)
  console.log(`✅ Comissões de influenciadores apagadas: ${itResult.affectedRows}`)
  const [iwResult] = await pool.query(`DELETE FROM influencer_withdrawals`)
  console.log(`✅ Levantamentos de influenciadores apagados: ${iwResult.affectedRows}`)
  const [isResult] = await pool.query(`DELETE FROM influencer_sessions`)
  console.log(`✅ Sessões de influenciadores apagadas: ${isResult.affectedRows}`)
  const [infResult] = await pool.query(`DELETE FROM influencers`)
  console.log(`✅ Influenciadores apagados: ${infResult.affectedRows}`)

  // 10. Delete support/audit history
  const [supResult] = await pool.query(`DELETE FROM support_messages`)
  console.log(`✅ Mensagens de suporte apagadas: ${supResult.affectedRows}`)
  const [auditResult] = await pool.query(`DELETE FROM audit_log`)
  console.log(`✅ Log de auditoria apagado: ${auditResult.affectedRows}`)

  // 11. Keep platform_settings, users and sessions intact
  console.log('\n✅ Configurações da plataforma mantidas (MB WAY, IBAN, toggles, comissão)')
  console.log('✅ Contas de utilizadores mantidas (emails, passwords, nicknames)')
  console.log('✅ Sessões mantidas — ninguém precisa de voltar a iniciar sessão')

  console.log('\n🎉 Reset completo! A plataforma está limpa e pronta a usar.\n')

  await pool.end()
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
