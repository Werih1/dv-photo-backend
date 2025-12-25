// ============================================
// dv-photo-backend/routes/payments.js
// API ЭНДПОИНТЫ ДЛЯ ПЛАТЕЖЕЙ
// ============================================

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const { TARIFFS } = require('../bot');

const db = new sqlite3.Database(process.env.DATABASE_PATH || './db/users.db');

// ============ POST /api/payments/send-invoice ============
// Вызывается из Web App при нажатии "Купить"
// Отправляет инвойс пользователю

router.post('/send-invoice', async (req, res) => {
  try {
    const { telegram_id, tariff } = req.body;

    console.log(`📦 Send invoice request: user=${telegram_id}, tariff=${tariff}`);

    if (!TARIFFS[tariff]) {
      return res.status(400).json({
        ok: false,
        error: `Unknown tariff: ${tariff}`,
      });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('❌ TELEGRAM_BOT_TOKEN not set');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error',
      });
    }

    // Инвойс будет отправлен через bot.js (обработчик buy_ callback)
    // Этот endpoint просто логирует запрос и подтверждает получение

    res.json({
      ok: true,
      message: `Invoice request accepted for ${tariff}`,
      tariff: tariff,
    });
  } catch (error) {
    console.error('❌ send-invoice error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ============ GET /api/payments/history/:telegram_id ============
// Получить историю платежей пользователя

router.get('/history/:telegram_id', async (req, res) => {
  try {
    const { telegram_id } = req.params;

    const history = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM payment_history WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 20',
        [telegram_id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    res.json({
      ok: true,
      data: history,
    });
  } catch (error) {
    console.error('❌ history error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ============ GET /api/payments/tariffs ============
// Получить список доступных тарифов с ценами

router.get('/tariffs', async (req, res) => {
  try {
    const tariffs = [];

    for (const [key, data] of Object.entries(TARIFFS)) {
      tariffs.push({
        code: key,
        name_en: data.name_en,
        name_ru: data.name_ru,
        description_en: data.description_en,
        description_ru: data.description_ru,
        price: data.price,
        currency: 'XTR',
        checks:
          data.checks === 999 || data.checks === 9999
            ? 'unlimited'
            : data.checks,
        duration_seconds: data.duration,
      });
    }

    res.json({
      ok: true,
      data: tariffs,
    });
  } catch (error) {
    console.error('❌ tariffs error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ============ GET /api/payments/subscription/:telegram_id ============
// Получить информацию об активной подписке

router.get('/subscription/:telegram_id', async (req, res) => {
  try {
    const { telegram_id } = req.params;

    const subscription = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM subscriptions WHERE telegram_id = ? AND status = ? ORDER BY purchased_at DESC LIMIT 1',
        [telegram_id, 'active'],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!subscription) {
      return res.json({
        ok: true,
        data: null,
        message: 'No active subscription',
      });
    }

    res.json({
      ok: true,
      data: {
        id: subscription.id,
        tariff: subscription.tariff,
        checks_remaining: subscription.checks_remaining,
        expires_at: subscription.expires_at,
        purchased_at: subscription.purchased_at,
        transaction_id: subscription.transaction_id,
      },
    });
  } catch (error) {
    console.error('❌ subscription error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

module.exports = router;
