// Read-only diagnostic script - does NOT create charges, transfers or payouts.
const fs = require('fs')
const path = require('path')
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}
const Stripe = require('stripe')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

async function main() {
  console.log('=== PLATFORM BALANCE ===')
  const platform = await stripe.balance.retrieve()
  console.log('available:', platform.available)
  console.log('pending:', platform.pending)

  const accounts = [
    { label: 'mica', id: 'acct_1TiW1nCQFj1VvWAL' },
    { label: 'mafia_ap', id: 'acct_1TiI4PC3S56WtGqB' },
  ]

  for (const acc of accounts) {
    console.log(`\n=== CONNECT ACCOUNT ${acc.label} (${acc.id}) ===`)
    try {
      const account = await stripe.accounts.retrieve(acc.id)
      console.log('payouts_enabled:', account.payouts_enabled)
      console.log('charges_enabled:', account.charges_enabled)
      console.log('capabilities:', account.capabilities)
      console.log('requirements.disabled_reason:', account.requirements?.disabled_reason)
      console.log('requirements.currently_due:', account.requirements?.currently_due)

      const bal = await stripe.balance.retrieve({ stripeAccount: acc.id })
      console.log('available:', bal.available)
      console.log('pending:', bal.pending)
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
