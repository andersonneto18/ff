import webpush from 'web-push'
import crypto from 'crypto'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

let configured = false
function ensureConfigured() {
  if (configured) return true
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  configured = true
  return true
}

export function hashEndpoint(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex')
}

// Sends a Web Push notification to every subscription registered for a user.
// Respects users.notificationsEnabled and silently prunes expired/invalid subscriptions.
export async function sendPushToUser(db, userId, payload) {
  if (!ensureConfigured()) return

  const user = await db.collection('users').findOne({ id: userId })
  if (!user || Number(user.notificationsEnabled) === 0) return

  const subs = await db.collection('push_subscriptions').find({ userId }).toArray()
  if (!subs.length) return

  const body = JSON.stringify(payload)

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, body)
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.collection('push_subscriptions').deleteMany({ id: sub.id })
      } else {
        console.error('Erro ao enviar push notification:', err.message)
      }
    }
  }))
}
