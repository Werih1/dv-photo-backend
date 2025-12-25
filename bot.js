// ============================================
// dv-photo-backend/bot.js
// ОСНОВНАЯ ЛОГИКА TELEGRAM BOT ДЛЯ ПЛАТЕЖЕЙ
// ============================================

const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
const APP_URL = process.env.APP_URL || 'https://your-app.vercel.app';

const bot = new Telegraf(BOT_TOKEN);

// ============ DATABASE SETUP ============

const db = new sqlite3.Database(process.env.DATABASE_PATH || './db/users.db', (err) => {
  if (err) console.error('❌ DB Error:', err);
  else console.log('✅ Database connected');
});

// Инициализация таблиц
const initDB = () => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    language TEXT DEFAULT 'en',
    checks_remaining INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
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
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payment_history (
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
};

initDB();

// ============ ТАРИФЫ И ЦЕНЫ ============

const TARIFFS = {
  LITE: {
    name_en: 'LITE',
    name_ru: 'ЛАЙТ',
    description_en: '10 photo checks',
    description_ru: '10 проверок фото',
    price: 1, // XTR Stars
    checks: 10,
    duration: null, // Разовая покупка
  },
  MAX: {
    name_en: 'MAX',
    name_ru: 'МАКС',
    description_en: 'Unlimited checks for 48 hours',
    description_ru: 'Безлимитные проверки на 48 часов',
    price: 1, // XTR Stars
    checks: 999, // Символ безлимита
    duration: 172800, // 48 часов в секундах
  },
  ULTRA: {
    name_en: 'ULTRA',
    name_ru: 'УЛЬТРА',
    description_en: 'Unlimited checks for 6 months',
    description_ru: 'Безлимитные проверки на 6 месяцев',
    price: 1, // XTR Stars
    checks: 9999, // Символ безлимита
    duration: 15552000, // 6 месяцев в секундах (180 дней)
  },
};

// ============ HELPER FUNCTIONS ============

const getUser = (telegram_id) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const createUser = (telegram_id, username, first_name, language = 'en') => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR IGNORE INTO users (telegram_id, username, first_name, language, checks_remaining) VALUES (?, ?, ?, ?, ?)',
      [telegram_id, username, first_name, language, 3],
      (err) => {
        if (err) reject(err);
        else resolve(true);
      }
    );
  });
};

const recordPayment = (telegram_id, tariff, amount, transaction_id, payload) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO payment_history (telegram_id, tariff, amount, currency, transaction_id, status, payload)
       VALUES (?, ?, ?, 'XTR', ?, 'completed', ?)`,
      [telegram_id, tariff, amount, transaction_id, JSON.stringify(payload)],
      (err) => {
        if (err) reject(err);
        else resolve(true);
      }
    );
  });
};

const activateSubscription = (telegram_id, tariff, transactionId) => {
  return new Promise((resolve, reject) => {
    const tariffData = TARIFFS[tariff];
    const expiresAt = tariffData.duration
      ? new Date(Date.now() + tariffData.duration * 1000)
      : null;

    db.run(
      `INSERT INTO subscriptions (telegram_id, tariff, checks_limit, checks_remaining, expires_at, transaction_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [telegram_id, tariff, tariffData.checks, tariffData.checks, expiresAt, transactionId],
      (err) => {
        if (err) reject(err);
        else resolve(expiresAt);
      }
    );
  });
};

const sendNotification = async (ctx, telegram_id, message, keyboard = null) => {
  try {
    const options = keyboard ? { reply_markup: keyboard } : {};
    await ctx.telegram.sendMessage(telegram_id, message, {
      parse_mode: 'HTML',
      ...options,
    });
  } catch (error) {
    console.error(`❌ Notification error for ${telegram_id}:`, error.message);
  }
};

// ============ BOT HANDLERS ============

// /start command
bot.command('start', async (ctx) => {
  const { id: telegram_id, first_name, username, language_code } = ctx.from;
  
  const lang = language_code === 'ru' ? 'ru' : 'en';
  
  // Создаем/обновляем пользователя
  await createUser(telegram_id, username || 'Unknown', first_name, lang);

  const message =
    lang === 'ru'
      ? `👋 Привет, ${first_name}!\n\n` +
        `Добро пожаловать в DV-Lottery Photo Checker!\n\n` +
        `🎯 Доступные команды:\n` +
        `/tariffs - Просмотр и покупка тарифов\n` +
        `/myplan - Информация о вашей подписке\n` +
        `/history - История платежей\n\n` +
        `🔗 Откройте Web App: /app`
      : `👋 Hello, ${first_name}!\n\n` +
        `Welcome to DV-Lottery Photo Checker!\n\n` +
        `🎯 Available commands:\n` +
        `/tariffs - View and buy tariffs\n` +
        `/myplan - Your subscription info\n` +
        `/history - Payment history\n\n` +
        `🔗 Open Web App: /app`;

  await ctx.reply(message);
});

// /tariffs command - показать доступные тарифы
bot.command('tariffs', async (ctx) => {
  const { id: telegram_id, language_code } = ctx.from;
  const lang = language_code === 'ru' ? 'ru' : 'en';

  let message = lang === 'ru' ? '💳 **ДОСТУПНЫЕ ТАРИФЫ**\n\n' : '💳 **AVAILABLE TARIFFS**\n\n';

  const keyboard = Markup.inlineKeyboard([]);

  for (const [key, tariff] of Object.entries(TARIFFS)) {
    const name = lang === 'ru' ? tariff.name_ru : tariff.name_en;
    const description = lang === 'ru' ? tariff.description_ru : tariff.description_en;

    message +=
      lang === 'ru'
        ? `✨ **${name}** (${tariff.price} ⭐)\n${description}\n\n`
        : `✨ **${name}** (${tariff.price} ⭐)\n${description}\n\n`;

    const buttonText = lang === 'ru' ? `💳 Купить ${name}` : `💳 Buy ${name}`;
    keyboard.inline_keyboard.push([
      Markup.button.callback(buttonText, `buy_${key}`, false),
    ]);
  }

  await ctx.reply(message, keyboard);
});

// Callback для кнопок покупки
bot.action(/buy_(.+)/, async (ctx) => {
  const tariff = ctx.match[1]; // LITE, MAX или ULTRA
  const { id: telegram_id } = ctx.from;
  const lang = ctx.from.language_code === 'ru' ? 'ru' : 'en';

  if (!TARIFFS[tariff]) {
    await ctx.answerCbQuery(lang === 'ru' ? 'Неизвестный тариф' : 'Unknown tariff', true);
    return;
  }

  const tariffData = TARIFFS[tariff];

  try {
    const message =
      lang === 'ru'
        ? `Инициирую платеж для тарифа ${tariffData.name_ru}...\n` +
          `💫 Цена: ${tariffData.price} звезда\n` +
          `📦 Включено: ${
            tariffData.checks === 999 || tariffData.checks === 9999
              ? 'Безлимит'
              : tariffData.checks + ' проверок'
          }\n\n` +
          `⏳ Ожидайте диалога оплаты...`
        : `Initiating payment for ${tariffData.name_en}...\n` +
          `💫 Price: ${tariffData.price} star\n` +
          `📦 Includes: ${
            tariffData.checks === 999 || tariffData.checks === 9999
              ? 'Unlimited'
              : tariffData.checks + ' checks'
          }\n\n` +
          `⏳ Waiting for payment dialog...`;

    await ctx.editMessageText(message);

    // Отправляем инвойс
    const payload = `tariff_${tariff}_${telegram_id}_${Date.now()}`;

    await ctx.telegram.sendInvoice(
      telegram_id,
      tariffData.name_en, // title (англ)
      lang === 'ru' ? tariffData.description_ru : tariffData.description_en, // description
      payload, // payload
      '', // provider_token (пусто для Stars)
      'XTR', // currency (XTR = Telegram Stars)
      [
        {
          label: lang === 'ru' ? tariffData.name_ru : tariffData.name_en,
          amount: tariffData.price,
        },
      ]
    );

    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Invoice error:', error.message);
    await ctx.answerCbQuery(
      lang === 'ru' ? 'Ошибка при отправке платежа' : 'Payment error',
      true
    );
  }
});

// Обработка успешного платежа
bot.on('successful_payment', async (ctx) => {
  const { id: telegram_id, first_name, language_code } = ctx.from;
  const payment = ctx.message.successful_payment;
  const lang = language_code === 'ru' ? 'ru' : 'en';

  console.log('✅ ПЛАТЕЖ ПОЛУЧЕН:', {
    user: telegram_id,
    payload: payment.invoice_payload,
    amount: payment.total_amount,
  });

  try {
    // Парсим тариф из payload
    const parts = payment.invoice_payload.split('_');
    const tariff = parts[1]; // LITE, MAX, ULTRA
    const tariffData = TARIFFS[tariff];

    if (!tariffData) {
      throw new Error(`Unknown tariff: ${tariff}`);
    }

    // Записываем платеж в историю
    await recordPayment(telegram_id, tariff, payment.total_amount, payment.telegram_payment_charge_id, payment);

    // Активируем подписку
    const expiresAt = await activateSubscription(
      telegram_id,
      tariff,
      payment.telegram_payment_charge_id
    );

    // Отправляем уведомление в бот-чат
    const notificationMsg =
      lang === 'ru'
        ? `✅ <b>Платеж успешно обработан!</b>\n\n` +
          `💳 Тариф: <b>${tariffData.name_ru}</b>\n` +
          `💫 Цена: ${payment.total_amount} ⭐\n` +
          `📦 Проверок: ${
            tariffData.checks === 999 || tariffData.checks === 9999
              ? 'Безлимит'
              : tariffData.checks
          }\n` +
          (expiresAt
            ? `⏰ Срок действия: ${expiresAt.toLocaleString('ru-RU')}\n`
            : `⏰ Действителен: Постоянно\n`) +
          `\nСпасибо за покупку! 🎉`
        : `✅ <b>Payment processed successfully!</b>\n\n` +
          `💳 Tariff: <b>${tariffData.name_en}</b>\n` +
          `💫 Price: ${payment.total_amount} ⭐\n` +
          `📦 Checks: ${
            tariffData.checks === 999 || tariffData.checks === 9999
              ? 'Unlimited'
              : tariffData.checks
          }\n` +
          (expiresAt
            ? `⏰ Valid until: ${expiresAt.toLocaleString('en-US')}\n`
            : `⏰ Valid: Permanently\n`) +
          `\nThank you for your purchase! 🎉`;

    await ctx.reply(notificationMsg, { parse_mode: 'HTML' });

    // Синхронизируем с Python backend
    try {
      await axios.post(`${PYTHON_API_URL}/api/user/${telegram_id}/subscription`, {
        tariff: tariff,
        checks_limit: tariffData.checks,
        checks_remaining: tariffData.checks,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        transaction_id: payment.telegram_payment_charge_id,
      });
      console.log(`✅ Subscription synced to Python API for user ${telegram_id}`);
    } catch (syncError) {
      console.error('⚠️ Sync error:', syncError.message);
      // Не блокируем процесс если Python API недоступен
    }
  } catch (error) {
    console.error('❌ Payment processing error:', error.message);
    const errorMsg =
      lang === 'ru'
        ? '❌ Ошибка при обработке платежа. Пожалуйста, обратитесь в поддержку.'
        : '❌ Error processing payment. Please contact support.';
    await ctx.reply(errorMsg);
  }
});

// /myplan command - информация о текущей подписке
bot.command('myplan', async (ctx) => {
  const { id: telegram_id, language_code } = ctx.from;
  const lang = language_code === 'ru' ? 'ru' : 'en';

  try {
    const user = await getUser(telegram_id);
    if (!user) {
      const msg = lang === 'ru' ? '❌ Пользователь не найден' : '❌ User not found';
      await ctx.reply(msg);
      return;
    }

    // Получаем активную подписку из БД
    const subscription = await new Promise((resolve) => {
      db.get(
        'SELECT * FROM subscriptions WHERE telegram_id = ? AND status = ? ORDER BY purchased_at DESC LIMIT 1',
        [telegram_id, 'active'],
        (err, row) => resolve(row)
      );
    });

    if (!subscription) {
      const msg =
        lang === 'ru'
          ? '📭 У вас нет активной подписки.\n\nИспользуйте /tariffs для покупки тарифа.'
          : '📭 You have no active subscription.\n\nUse /tariffs to buy a plan.';
      await ctx.reply(msg);
      return;
    }

    const tariffData = TARIFFS[subscription.tariff];
    const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;
    const now = new Date();
    const timeLeft = expiresAt ? expiresAt - now : null;

    const message =
      lang === 'ru'
        ? `📊 <b>Ваша подписка</b>\n\n` +
          `💳 Тариф: <b>${tariffData.name_ru}</b>\n` +
          `📦 Проверок осталось: <b>${
            subscription.checks_remaining === 999 || subscription.checks_remaining === 9999
              ? 'Безлимит'
              : subscription.checks_remaining
          }</b>\n` +
          (expiresAt
            ? `⏰ Истекает: <b>${expiresAt.toLocaleString('ru-RU')}</b>\n` +
              `⌛ Осталось: <b>${Math.ceil(timeLeft / (1000 * 60 * 60))} часов</b>\n`
            : `⏰ Действителен: <b>Постоянно</b>\n`) +
          `📅 Куплен: ${new Date(subscription.purchased_at).toLocaleString('ru-RU')}`
        : `📊 <b>Your Subscription</b>\n\n` +
          `💳 Tariff: <b>${tariffData.name_en}</b>\n` +
          `📦 Checks left: <b>${
            subscription.checks_remaining === 999 || subscription.checks_remaining === 9999
              ? 'Unlimited'
              : subscription.checks_remaining
          }</b>\n` +
          (expiresAt
            ? `⏰ Expires: <b>${expiresAt.toLocaleString('en-US')}</b>\n` +
              `⌛ Time left: <b>${Math.ceil(timeLeft / (1000 * 60 * 60))} hours</b>\n`
            : `⏰ Valid: <b>Permanently</b>\n`) +
          `📅 Purchased: ${new Date(subscription.purchased_at).toLocaleString('en-US')}`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('❌ myplan error:', error);
    const msg = lang === 'ru' ? '❌ Ошибка' : '❌ Error';
    await ctx.reply(msg);
  }
});

// /history command - история платежей
bot.command('history', async (ctx) => {
  const { id: telegram_id, language_code } = ctx.from;
  const lang = language_code === 'ru' ? 'ru' : 'en';

  try {
    const history = await new Promise((resolve) => {
      db.all(
        'SELECT * FROM payment_history WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 10',
        [telegram_id],
        (err, rows) => resolve(rows || [])
      );
    });

    if (history.length === 0) {
      const msg = lang === 'ru' ? '📭 История платежей пуста' : '📭 No payment history';
      await ctx.reply(msg);
      return;
    }

    let message = lang === 'ru' ? '📜 <b>История платежей</b>\n\n' : '📜 <b>Payment History</b>\n\n';

    history.forEach((payment, index) => {
      const date = new Date(payment.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US');
      message +=
        lang === 'ru'
          ? `${index + 1}. ${payment.tariff} • ${payment.amount} ⭐\n` +
            `   📅 ${date}\n` +
            `   ID: \`${payment.transaction_id}\`\n\n`
          : `${index + 1}. ${payment.tariff} • ${payment.amount} ⭐\n` +
            `   📅 ${date}\n` +
            `   ID: \`${payment.transaction_id}\`\n\n`;
    });

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('❌ history error:', error);
    const msg = lang === 'ru' ? '❌ Ошибка' : '❌ Error';
    await ctx.reply(msg);
  }
});

module.exports = { bot, TARIFFS };
