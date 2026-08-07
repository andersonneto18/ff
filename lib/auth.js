import crypto from 'crypto'
import { connectDb } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'

export function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, useSalt, 64).toString('hex')
  return { salt: useSalt, hash }
}

export function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(hash, 'hex'))
}

export async function createSession(userId) {
  const db = await connectDb()
  const token = uuidv4() + '.' + crypto.randomBytes(24).toString('hex')
  await db.collection('sessions').insertOne({ token, userId, createdAt: new Date() })
  return token
}

export async function getUserFromRequest(request) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const db = await connectDb()
  const session = await db.collection('sessions').findOne({ token })
  if (!session) return null
  const user = await db.collection('users').findOne({ id: session.userId })
  return user || null
}

export function sanitizeUser(user) {
  if (!user) return null
  const { passwordHash, salt, _id, ...rest } = user
  return rest
}

// ----- Influencer auth (separate identity/session from players — see lib/db.js comment) -----
export async function createInfluencerSession(influencerId) {
  const db = await connectDb()
  const token = uuidv4() + '.' + crypto.randomBytes(24).toString('hex')
  await db.collection('influencer_sessions').insertOne({ token, influencerId, createdAt: new Date() })
  return token
}

export async function getInfluencerFromRequest(request) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const db = await connectDb()
  const session = await db.collection('influencer_sessions').findOne({ token })
  if (!session) return null
  const influencer = await db.collection('influencers').findOne({ id: session.influencerId })
  return influencer || null
}

export function sanitizeInfluencer(influencer) {
  if (!influencer) return null
  const { passwordHash, salt, _id, ...rest } = influencer
  return rest
}

// ----- Maintenance area auth (developer-only, gated by MAINTENANCE_PASSWORD env var — not tied to any user/admin account) -----
export async function createMaintenanceSession() {
  const db = await connectDb()
  const token = uuidv4() + '.' + crypto.randomBytes(24).toString('hex')
  await db.collection('maintenance_sessions').insertOne({ token, createdAt: new Date() })
  return token
}

export async function isMaintenanceAuthed(request) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return false
  const db = await connectDb()
  const session = await db.collection('maintenance_sessions').findOne({ token })
  return !!session
}
