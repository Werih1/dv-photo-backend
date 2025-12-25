// ============================================
// dv-photo-backend/server.js
// ОБНОВЛЕННЫЙ ГЛАВНЫЙ СЕРВЕР
// ============================================

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { bot } = require('./bot');

dotenv.config();

const app = express();

// ============ MIDDLEWARE ============

app.use(express.json({ limit: '50mb' }));
app.use(cors({
  origin: process.env.APP_URL || '*',
  credentials: true,
}));

// ============ TELEGRAM BOT WEBHOOK (для продакшена) ============

// Если используете webhook (вместо polling)
const TELEGRAM_WEBHOOK_PATH = `/bot${process.env.TELEGRAM_BOT_TOKEN}`;

app.post(TELEGRAM_WEBHOOK_PATH, (req, res) => {
  bot.handleUpdate(req.body, res);
});

// ============ API ROUTES ============

// User routes
app.use('/api/user', require('./routes/user'));

// Payments routes
app.use('/api/payments', require('./routes/payments'));

// Telegram Bot webhook route (альтернативно)
app.post('/api/webhook/telegram', (req, res) => {
  bot.handleUpdate(req.body);
  res.json({ ok: true });
});

// ============ HEALTH CHECK ============

app.get('/health', (req, res) => {
  res.json({
    status: 'Backend is running! 🚀',
    timestamp: new Date().toISOString(),
    bot: 'Telegram bot polling active',
  });
});

// ============ SERVER START ============

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Bot token: ${process.env.TELEGRAM_BOT_TOKEN.slice(0, 10)}...`);
  console.log(`📱 App URL: ${process.env.APP_URL}`);
});

// Запуск бота в режиме polling
bot.launch({
  polling: {
    interval: 300,
    timeout: 20,
  },
});

console.log('✅ Telegram Bot polling started');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = app;
