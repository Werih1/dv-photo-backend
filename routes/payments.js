// ============================================
// dv-photo-backend/routes/payments.js
// API ЭНДПОИНТЫ ДЛЯ ПЛАТЕЖЕЙ
// ============================================

const express = require('express');
const router = express.Router();
const { TARIFFS, isTariffListed } = require('../tariffs');
const { all, resolveUserSubscription } = require('../db');
const { createInvoiceLinkForUser } = require('../bot');

async function createInvoiceResponse(req, res) {
  try {
    const { telegram_id, tariff, lang } = req.body;
    const language = lang === 'ru' ? 'ru' : 'en';

    console.log(`📦 Invoice link request: user=${telegram_id}, tariff=${tariff}`);

    if (!telegram_id) {
      return res.status(400).json({
        ok: false,
        error: 'telegram_id is required',
      });
    }

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

    const invoice_url = await createInvoiceLinkForUser(telegram_id, tariff, language);
    const tariffData = TARIFFS[tariff];

    res.json({
      ok: true,
      invoice_url,
      tariff,
      price: tariffData.price,
      currency: 'XTR',
      expires_hint: tariffData.expiryType,
    });
  } catch (error) {
    console.error('❌ create-invoice-link error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

router.post('/send-invoice', createInvoiceResponse);
router.post('/create-invoice-link', createInvoiceResponse);

router.get('/history/:telegram_id', async (req, res) => {
  try {
    const { telegram_id } = req.params;

    const history = await all(
      'SELECT * FROM payment_history WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 20',
      [telegram_id]
    );

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

router.get('/tariffs', async (_req, res) => {
  try {
    const tariffs = [];

    for (const [key, data] of Object.entries(TARIFFS)) {
      if (!isTariffListed(data)) {
        continue;
      }

      tariffs.push({
        code: key,
        name_en: data.name_en,
        name_ru: data.name_ru,
        description_en: data.description_en,
        description_ru: data.description_ru,
        price: data.price,
        currency: 'XTR',
        checks: data.unlimited ? 'unlimited' : data.checks,
        unlimited: data.unlimited,
        expiry_type: data.expiryType,
        duration_days: data.durationDays || null,
        duration_seconds: data.durationDays ? data.durationDays * 24 * 60 * 60 : null,
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

router.get('/subscription/:telegram_id', async (req, res) => {
  try {
    const { telegram_id } = req.params;
    const subscription = await resolveUserSubscription(telegram_id);

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
        checks_remaining: subscription.expired ? 0 : subscription.checks_remaining,
        expires_at: subscription.expires_at,
        purchased_at: subscription.purchased_at,
        transaction_id: subscription.transaction_id,
        expired: subscription.expired,
        unlimited: subscription.unlimited,
        status: subscription.status,
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
