import mysql from 'mysql2/promise'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

let pool = null
let dbInstance = null
let connectingPromise = null

// Fields stored as JSON columns and (de)serialized transparently
const JSON_FIELDS = { claims: 'object', screenshots: 'array' }

function isIdentifier(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Identificador inválido: ${name}`)
  return name
}

function serializeValue(key, value) {
  if (value === undefined) return null
  if (key in JSON_FIELDS) {
    const v = value == null ? (JSON_FIELDS[key] === 'array' ? [] : {}) : value
    return JSON.stringify(v)
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  // datetime-local inputs ("2024-01-01T10:00") -> MySQL DATETIME format
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.replace('T', ' ')
  return value
}

function rowToDoc(row) {
  if (!row) return null
  const doc = { ...row }
  for (const key of Object.keys(JSON_FIELDS)) {
    if (key in doc && typeof doc[key] === 'string') {
      try { doc[key] = JSON.parse(doc[key]) } catch { /* leave as-is */ }
    }
  }
  return doc
}

// Translates a small subset of MongoDB-style filters ($or, $in, $ne) to SQL
function buildWhere(filter = {}) {
  const clauses = []
  const params = []
  for (const [key, val] of Object.entries(filter || {})) {
    if (key === '$or') {
      const parts = val.map((sub) => {
        const r = buildWhere(sub)
        params.push(...r.params)
        return '(' + r.clause + ')'
      })
      clauses.push('(' + parts.join(' OR ') + ')')
      continue
    }
    const col = isIdentifier(key)
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      if ('$in' in val) {
        const arr = val.$in || []
        if (!arr.length) { clauses.push('1=0'); continue }
        clauses.push(`\`${col}\` IN (${arr.map(() => '?').join(',')})`)
        params.push(...arr)
        continue
      }
      if ('$ne' in val) {
        const v = val.$ne
        clauses.push(`\`${col}\` != ?`)
        params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
        continue
      }
      if ('$isNull' in val) {
        clauses.push(`\`${col}\` IS ${val.$isNull ? '' : 'NOT '}NULL`)
        continue
      }
      throw new Error(`Operador de filtro não suportado em ${key}`)
    }
    clauses.push(`\`${col}\` = ?`)
    params.push(typeof val === 'boolean' ? (val ? 1 : 0) : val)
  }
  return { clause: clauses.length ? clauses.join(' AND ') : '1=1', params }
}

function buildOrderBy(sort) {
  if (!sort) return ''
  const [[field, dir]] = Object.entries(sort)
  return ` ORDER BY \`${isIdentifier(field)}\` ${dir === -1 ? 'DESC' : 'ASC'}`
}

class Collection {
  constructor(table) { this.table = isIdentifier(table) }

  async findOne(filter = {}) {
    const { clause, params } = buildWhere(filter)
    const [rows] = await pool.query(`SELECT * FROM \`${this.table}\` WHERE ${clause} LIMIT 1`, params)
    return rowToDoc(rows[0])
  }

  find(filter = {}) {
    const table = this.table
    const state = { sort: null, limit: null, project: null }
    return {
      sort(s) { state.sort = s; return this },
      limit(n) { state.limit = n; return this },
      project(p) { state.project = p; return this },
      async toArray() {
        const { clause, params } = buildWhere(filter)
        let sql = `SELECT * FROM \`${table}\` WHERE ${clause}` + buildOrderBy(state.sort)
        if (state.limit) sql += ` LIMIT ${Number(state.limit)}`
        const [rows] = await pool.query(sql, params)
        return rows.map(rowToDoc).map((doc) => {
          if (!state.project) return doc
          const out = { ...doc }
          for (const [k, v] of Object.entries(state.project)) if (v === 0) delete out[k]
          return out
        })
      },
    }
  }

  async insertOne(doc) {
    const cols = Object.keys(doc)
    const vals = cols.map((c) => serializeValue(c, doc[c]))
    const sql = `INSERT INTO \`${this.table}\` (${cols.map((c) => `\`${isIdentifier(c)}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
    await pool.query(sql, vals)
    return { insertedId: doc.id }
  }

  async updateOne(filter, update) {
    const sets = []
    const params = []
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        sets.push(`\`${isIdentifier(k)}\` = ?`)
        params.push(serializeValue(k, v))
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        const col = isIdentifier(k)
        sets.push(`\`${col}\` = \`${col}\` + ?`)
        params.push(v)
      }
    }
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) sets.push(`\`${isIdentifier(k)}\` = NULL`)
    }
    if (!sets.length) return { affectedRows: 0 }
    const { clause, params: whereParams } = buildWhere(filter)
    const [result] = await pool.query(`UPDATE \`${this.table}\` SET ${sets.join(', ')} WHERE ${clause}`, [...params, ...whereParams])
    return { affectedRows: result.affectedRows || 0 }
  }

  async countDocuments(filter = {}) {
    const { clause, params } = buildWhere(filter)
    const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${this.table}\` WHERE ${clause}`, params)
    return Number(rows[0].cnt)
  }

  async deleteMany(filter = {}) {
    const { clause, params } = buildWhere(filter)
    await pool.query(`DELETE FROM \`${this.table}\` WHERE ${clause}`, params)
  }

  // Supports the single aggregation shape used in this app:
  // [{ $match: {...} }, { $group: { _id: null, total: { $sum: '$field' } } }]
  aggregate(pipeline) {
    const table = this.table
    return {
      async toArray() {
        const matchStage = pipeline.find((s) => s.$match)
        const groupStage = pipeline.find((s) => s.$group)?.$group
        const { clause, params } = buildWhere(matchStage?.$match || {})
        if (groupStage?.total?.$sum) {
          const field = isIdentifier(String(groupStage.total.$sum).replace('$', ''))
          const [rows] = await pool.query(`SELECT SUM(\`${field}\`) AS total FROM \`${table}\` WHERE ${clause}`, params)
          return [{ total: Number(rows[0].total || 0) }]
        }
        return []
      },
    }
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    passwordHash VARCHAR(255) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    ffUid VARCHAR(60) NOT NULL,
    ffNickname VARCHAR(60) NOT NULL,
    photoUrl TEXT,
    balanceCents INT NOT NULL DEFAULT 0,
    pendingCents INT NOT NULL DEFAULT 0,
    totalEarningsCents INT NOT NULL DEFAULT 0,
    wins INT NOT NULL DEFAULT 0,
    losses INT NOT NULL DEFAULT 0,
    banned TINYINT(1) NOT NULL DEFAULT 0,
    banReason TEXT,
    isAdmin TINYINT(1) NOT NULL DEFAULT 0,
    stripeAccountId VARCHAR(255) NULL,
    payoutsEnabled TINYINT(1) NOT NULL DEFAULT 0,
    deviceType VARCHAR(20) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(120) NOT NULL PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_sessions_userId (userId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS rooms (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    creatorId VARCHAR(36) NOT NULL,
    opponentId VARCHAR(36) NULL,
    betAmountCents INT NOT NULL,
    mode VARCHAR(60) NOT NULL,
    roomType VARCHAR(60) NOT NULL,
    scheduledTime DATETIME NULL,
    server VARCHAR(60) NOT NULL,
    weapons VARCHAR(190) NOT NULL,
    platform VARCHAR(60) NOT NULL,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ABERTA',
    creatorPaid TINYINT(1) NOT NULL DEFAULT 0,
    opponentPaid TINYINT(1) NOT NULL DEFAULT 0,
    creatorPaidAt DATETIME NULL,
    opponentPaidAt DATETIME NULL,
    winnerId VARCHAR(36) NULL,
    loserId VARCHAR(36) NULL,
    claims JSON NULL,
    firstClaimAt DATETIME NULL,
    prizeCents INT NULL,
    commissionCents INT NULL,
    finalizeReason VARCHAR(60) NULL,
    previousStatus VARCHAR(20) NULL,
    cancelReason VARCHAR(60) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    startedAt DATETIME NULL,
    finishedAt DATETIME NULL,
    KEY idx_rooms_status_created (status, createdAt),
    KEY idx_rooms_creator (creatorId),
    KEY idx_rooms_opponent (opponentId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    type VARCHAR(40) NOT NULL,
    amountCents INT NOT NULL,
    roomId VARCHAR(36) NULL,
    withdrawalId VARCHAR(36) NULL,
    stripeSessionId VARCHAR(190) NULL,
    balance INT NULL,
    description TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_transactions_userId (userId),
    UNIQUE KEY uniq_transactions_stripeSession (stripeSessionId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS withdrawals (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    amountCents INT NOT NULL,
    fullName VARCHAR(190) NULL,
    iban VARCHAR(60) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    stripeTransferId VARCHAR(255) NULL,
    stripePayoutId VARCHAR(255) NULL,
    failureReason TEXT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processedAt DATETIME NULL,
    KEY idx_withdrawals_userId (userId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS reports (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    roomId VARCHAR(36) NOT NULL,
    reporterId VARCHAR(36) NOT NULL,
    reason TEXT,
    videoUrl TEXT,
    screenshots JSON NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    resolvedWinnerId VARCHAR(36) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processedAt DATETIME NULL,
    KEY idx_reports_roomId (roomId),
    KEY idx_reports_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS room_messages (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    roomId VARCHAR(36) NOT NULL,
    userId VARCHAR(36) NOT NULL,
    message TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_room_messages_room (roomId, createdAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS withdrawal_methods (
    userId VARCHAR(36) NOT NULL PRIMARY KEY,
    fullName VARCHAR(190) NOT NULL,
    type VARCHAR(20) NOT NULL,
    iban VARCHAR(60) NULL,
    mbway VARCHAR(20) NULL,
    bank VARCHAR(120) NULL,
    notes TEXT NULL,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(190) NOT NULL,
    message TEXT NULL,
    relatedId VARCHAR(36) NULL,
    isRead TINYINT(1) NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notifications_userId (userId, createdAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    adminId VARCHAR(36) NOT NULL,
    adminName VARCHAR(120) NULL,
    action VARCHAR(60) NOT NULL,
    targetType VARCHAR(40) NOT NULL,
    targetId VARCHAR(36) NULL,
    details TEXT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_log_created (createdAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    endpoint TEXT NOT NULL,
    endpointHash CHAR(64) NOT NULL,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(255) NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_push_subscriptions_userId (userId),
    UNIQUE KEY uniq_push_subscriptions_endpointHash (endpointHash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS platform_settings (
    \`key\` VARCHAR(60) NOT NULL PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS tournaments (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(190) NOT NULL,
    description TEXT NULL,
    entryFeeCents INT NOT NULL DEFAULT 500,
    maxPlayers INT NOT NULL DEFAULT 8,
    currentPlayers INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
    currentRound INT NOT NULL DEFAULT 0,
    winnerId VARCHAR(36) NULL,
    prizeFirstCents INT NULL,
    prizeSecondCents INT NULL,
    commissionCents INT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    startedAt DATETIME NULL,
    finishedAt DATETIME NULL,
    KEY idx_tournaments_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS tournament_participants (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tournamentId VARCHAR(36) NOT NULL,
    userId VARCHAR(36) NOT NULL,
    eliminatedRound INT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_tp_tournament (tournamentId),
    UNIQUE KEY uniq_tp_user (tournamentId, userId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS tournament_matches (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tournamentId VARCHAR(36) NOT NULL,
    round INT NOT NULL,
    player1Id VARCHAR(36) NOT NULL,
    player2Id VARCHAR(36) NOT NULL,
    claim1 VARCHAR(10) NULL,
    claim2 VARCHAR(10) NULL,
    winnerId VARCHAR(36) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finishedAt DATETIME NULL,
    KEY idx_tm_tournament (tournamentId, round)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS support_messages (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    sender VARCHAR(10) NOT NULL,
    message TEXT NOT NULL,
    isRead TINYINT(1) NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_support_messages_userId (userId, createdAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS mbway_topups (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    amountCents INT NOT NULL,
    proofImage LONGTEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    rejectionReason TEXT NULL,
    confirmedByName VARCHAR(120) NULL,
    confirmedAt DATETIME NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_mbway_topups_userId (userId),
    KEY idx_mbway_topups_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]

// Idempotent migrations for databases created before a column/constraint existed
// MySQL 5.7 compatible migrations (no IF NOT EXISTS on ALTER — errors are caught in runner)
const MIGRATIONS = [
  `ALTER TABLE users ADD COLUMN stripeAccountId VARCHAR(255) NULL`,
  `ALTER TABLE users ADD COLUMN payoutsEnabled TINYINT(1) NOT NULL DEFAULT 0`,
  `ALTER TABLE withdrawals ADD COLUMN stripeTransferId VARCHAR(255) NULL`,
  `ALTER TABLE withdrawals ADD COLUMN stripePayoutId VARCHAR(255) NULL`,
  `ALTER TABLE withdrawals ADD COLUMN failureReason TEXT NULL`,
  `ALTER TABLE withdrawals MODIFY fullName VARCHAR(190) NULL`,
  `ALTER TABLE withdrawals MODIFY iban VARCHAR(60) NULL`,
  `ALTER TABLE reports ADD COLUMN resolvedWinnerId VARCHAR(36) NULL`,
  `ALTER TABLE transactions ADD COLUMN stripeAccountId VARCHAR(255) NULL`,
  `ALTER TABLE withdrawals ADD COLUMN withdrawalType VARCHAR(20) NULL`,
  `ALTER TABLE withdrawals ADD COLUMN mbway VARCHAR(20) NULL`,
  `ALTER TABLE withdrawals ADD COLUMN bank VARCHAR(120) NULL`,
  `ALTER TABLE withdrawals ADD COLUMN notes TEXT NULL`,
  `ALTER TABLE withdrawals ADD COLUMN paidAt DATETIME NULL`,
  `ALTER TABLE withdrawals ADD COLUMN processedByName VARCHAR(120) NULL`,
  `ALTER TABLE withdrawals ADD COLUMN rejectionReason TEXT NULL`,
  `ALTER TABLE users ADD COLUMN notificationsEnabled TINYINT(1) NOT NULL DEFAULT 1`,
  `ALTER TABLE users ADD COLUMN deviceType VARCHAR(20) NULL`,
  `ALTER TABLE reports ADD COLUMN videoData LONGTEXT NULL`,
  `ALTER TABLE reports MODIFY COLUMN videoUrl TEXT NULL`,
  `ALTER TABLE rooms ADD COLUMN loserId VARCHAR(36) NULL`,
  `ALTER TABLE reports ADD COLUMN tournamentMatchId VARCHAR(36) NULL`,
  `ALTER TABLE reports ADD COLUMN tournamentId VARCHAR(36) NULL`,
  `ALTER TABLE push_subscriptions DROP INDEX uniq_push_subscriptions_endpoint`,
  `ALTER TABLE push_subscriptions ADD COLUMN endpointHash CHAR(64) NOT NULL DEFAULT ''`,
  `ALTER TABLE push_subscriptions MODIFY COLUMN endpoint TEXT NOT NULL`,
  `ALTER TABLE push_subscriptions ADD UNIQUE KEY uniq_push_subscriptions_endpointHash (endpointHash)`,
]

async function initDb() {
  const host = process.env.MYSQL_HOST || 'localhost'
  const port = Number(process.env.MYSQL_PORT || 3306)
  const user = process.env.MYSQL_USER || 'root'
  const password = process.env.MYSQL_PASSWORD || ''
  const database = process.env.MYSQL_DATABASE || 'ff_arena'

  // Try to create the database (may fail on managed hosts like Hostinger where DB already exists)
  try {
    const root = await mysql.createConnection({ host, port, user, password })
    await root.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await root.end()
  } catch (_) { /* Database already exists on managed host — skip */ }

  // Limit connections to avoid exhausting managed MySQL on serverless environments
  const connectionLimit = process.env.MYSQL_CONNECTION_LIMIT ? Number(process.env.MYSQL_CONNECTION_LIMIT) : 5
  pool = mysql.createPool({ host, port, user, password, database, waitForConnections: true, connectionLimit })

  for (const stmt of SCHEMA) await pool.query(stmt)
  // MySQL 5.7 doesn't support ADD COLUMN IF NOT EXISTS — ignore duplicate column/key errors
  for (const stmt of MIGRATIONS) {
    try {
      await pool.query(stmt)
    } catch (e) {
      const ignorable = [1060, 1061, 1091, 1068] // dup column, dup key, can't drop, multiple PK
      if (!ignorable.includes(e.errno)) throw e
    }
  }

  dbInstance = { collection: (name) => new Collection(name) }

  // Bootstrap admin
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPwd = process.env.ADMIN_PASSWORD
  if (adminEmail && adminPwd) {
    const existing = await dbInstance.collection('users').findOne({ email: adminEmail })
    if (!existing) {
      const salt = crypto.randomBytes(16).toString('hex')
      const hash = crypto.scryptSync(adminPwd, salt, 64).toString('hex')
      try {
        await dbInstance.collection('users').insertOne({
          id: uuidv4(), email: adminEmail, passwordHash: hash, salt,
          name: 'Admin', ffUid: 'ADMIN', ffNickname: 'Admin',
          balanceCents: 0, pendingCents: 0, totalEarningsCents: 0,
          wins: 0, losses: 0, banned: false, isAdmin: true,
          photoUrl: null, createdAt: new Date(),
        })
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e
      }
    }
  }

  return dbInstance
}

export async function connectDb() {
  if (dbInstance) return dbInstance
  if (!connectingPromise) connectingPromise = initDb().catch((e) => { connectingPromise = null; throw e })
  return connectingPromise
}
