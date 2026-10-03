// ============================================
// SQLite: схема, подписки, срок действия
// ============================================

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const {
  TARIFFS,
  computeExpiresAt,
  isExpired,
  isUnlimitedRow,
  getEffectiveChecks,
  serializeChecks,
} = require('./tariffs');

const dbPath = process.env.DATABASE_PATH || './db/users.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('❌ DB Error:', err);
  else console.log('✅ Database connected');
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function tableHasColumn(table, column) {
  const cols = await all(`PRAGMA table_info(${table})`);
  return cols.some((col) => col.name === column);
}

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    language TEXT DEFAULT 'en',
    checks_remaining INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    tariff TEXT NOT NULL,
    checks_limit INTEGER NOT NULL,
    checks_remaining INTEGER NOT NULL,
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    payment_amount INTEGER DEFAULT 1,
    payment_currency TEXT DEFAULT 'XTR',
    transaction_id TEXT UNIQUE,
    status TEXT DEFAULT 'active',
    unlimited INTEGER DEFAULT 0,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS payment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    tariff TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'XTR',
    transaction_id TEXT UNIQUE,
    status TEXT DEFAULT 'completed',
    payload TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  )`);

  if (!(await tableHasColumn('subscriptions', 'unlimited'))) {
    await run('ALTER TABLE subscriptions ADD COLUMN unlimited INTEGER DEFAULT 0');
  }
  if (!(await tableHasColumn('subscriptions', 'expires_at'))) {
    await run('ALTER TABLE subscriptions ADD COLUMN expires_at TIMESTAMP');
  }
  if (!(await tableHasColumn('users', 'expires_at'))) {
    await run('ALTER TABLE users ADD COLUMN expires_at TIMESTAMP');
  }
  if (!(await tableHasColumn('users', 'tariff'))) {
    await run("ALTER TABLE users ADD COLUMN tariff TEXT DEFAULT 'free'");
  }
}

function publicView(subscription, extra = {}) {
  const expired = extra.expired ?? isExpired(subscription.expires_at);
  const effective = expired ? 0 : getEffectiveChecks(subscription);
  const unlimited = !expired && isUnlimitedRow(subscription);

  return {
    id: subscription.id,
    telegram_id: subscription.telegram_id,
    tariff: subscription.tariff,
    checks_limit: subscription.checks_limit,
    checks_remaining: expired ? 0 : unlimited ? serializeChecks(effective) : effective,
    expires_at: subscription.expires_at,
    purchased_at: subscription.purchased_at,
    transaction_id: subscription.transaction_id,
    status: extra.status || (expired ? 'expired' : subscription.status),
    expired,
    unlimited,
  };
}

/**
 * Если expires_at уже прошёл — баланс 0, статус expired.
 * Обновляет и подписку, и users.checks_remaining.
 */
async function expireSubscriptionIfNeeded(subscription) {
  if (!subscription) {
    return null;
  }

  if (!isExpired(subscription.expires_at)) {
    return publicView(subscription, { expired: false, status: subscription.status });
  }

  await run(
    `UPDATE subscriptions
     SET status = 'expired', checks_remaining = 0
     WHERE id = ? AND status = 'active'`,
    [subscription.id]
  );

  await run(
    `UPDATE users
     SET checks_remaining = 0, tariff = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE telegram_id = ?`,
    [subscription.telegram_id]
  );

  return publicView(subscription, { expired: true, status: 'expired' });
}

async function getLatestSubscription(telegram_id) {
  return get(
    `SELECT * FROM subscriptions
     WHERE telegram_id = ?
     ORDER BY purchased_at DESC, id DESC
     LIMIT 1`,
    [telegram_id]
  );
}

async function getActiveSubscriptionRow(telegram_id) {
  return get(
    `SELECT * FROM subscriptions
     WHERE telegram_id = ? AND status = 'active'
     ORDER BY purchased_at DESC, id DESC
     LIMIT 1`,
    [telegram_id]
  );
}

async function resolveUserSubscription(telegram_id) {
  const active = await getActiveSubscriptionRow(telegram_id);
  if (active) {
    return expireSubscriptionIfNeeded(active);
  }

  const latest = await getLatestSubscription(telegram_id);
  if (!latest) {
    return null;
  }
  return expireSubscriptionIfNeeded(latest);
}

async function getUser(telegram_id) {
  return get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id]);
}

async function createUser(telegram_id, username, first_name, language = 'en') {
  await run(
    'INSERT OR IGNORE INTO users (telegram_id, username, first_name, language, checks_remaining) VALUES (?, ?, ?, ?, ?)',
    [telegram_id, username, first_name, language, 3]
  );
}

async function recordPayment(telegram_id, tariff, amount, transaction_id, payload) {
  const existing = await get(
    'SELECT id FROM payment_history WHERE transaction_id = ?',
    [transaction_id]
  );
  if (existing) {
    return false;
  }

  await run(
    `INSERT INTO payment_history (telegram_id, tariff, amount, currency, transaction_id, status, payload)
     VALUES (?, ?, ?, 'XTR', ?, 'completed', ?)`,
    [telegram_id, tariff, amount, transaction_id, JSON.stringify(payload)]
  );
  return true;
}

async function activateSubscription(telegram_id, tariff, transactionId, paymentAmount) {
  const tariffData = TARIFFS[tariff];
  if (!tariffData) {
    throw new Error(`Unknown tariff: ${tariff}`);
  }

  const existing = await get(
    'SELECT * FROM subscriptions WHERE transaction_id = ?',
    [transactionId]
  );
  if (existing) {
    return new Date(existing.expires_at);
  }

  const expiresAt = computeExpiresAt(tariff);
  const unlimited = tariffData.unlimited ? 1 : 0;
  const checks = tariffData.unlimited ? 0 : tariffData.checks;
  const expiresIso = expiresAt.toISOString();

  await run(
    `UPDATE subscriptions
     SET status = 'superseded'
     WHERE telegram_id = ? AND status = 'active'`,
    [telegram_id]
  );

  await run(
    `INSERT INTO subscriptions (
       telegram_id, tariff, checks_limit, checks_remaining, expires_at,
       transaction_id, status, unlimited, payment_amount, payment_currency
     ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 'XTR')`,
    [
      telegram_id,
      tariff,
      checks,
      checks,
      expiresIso,
      transactionId,
      unlimited,
      paymentAmount || tariffData.price,
    ]
  );

  await run(
    `UPDATE users
     SET checks_remaining = ?, tariff = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE telegram_id = ?`,
    [tariffData.unlimited ? 0 : checks, tariff, expiresIso, telegram_id]
  );

  return expiresAt;
}

initDB().catch((err) => {
  console.error('❌ DB init error:', err);
});

module.exports = {
  db,
  run,
  get,
  all,
  initDB,
  getUser,
  createUser,
  recordPayment,
  activateSubscription,
  resolveUserSubscription,
  expireSubscriptionIfNeeded,
};
