// ============================================
// dv-photo-backend/bot.js
// ОСНОВНАЯ ЛОГИКА TELEGRAM BOT ДЛЯ ПЛАТЕЖЕЙ
// ============================================

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
require('dotenv').config();

const { TARIFFS, isTariffListed } = require('./tariffs');
const { buildStarsInvoice, parseTariffFromPayload, isValidStarsCheckout } = require('./invoices');
const {
  all,
  getUser,
  createUser,
  recordPayment,
  activateSubscription,
  resolveUserSubscription,
} = require('./db');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

const bot = new Telegraf(BOT_TOKEN);

const publicTariffs = () =>
  Object.entries(TARIFFS).filter(([, tariff]) => isTariffListed(tariff));

const formatChecks = (tariffData, lang) => {
  if (tariffData.unlimited) {
    return lang === 'ru' ? 'Безлимит' : 'Unlimited';
  }
  return String(tariffData.checks);
};

const formatExpiryHint = (tariffData, lang) => {
  if (tariffData.expiryType === 'next_august_30') {
    return lang === 'ru' ? 'до 30 августа' : 'until 30 August';
  }
  if (tariffData.durationDays === 1) {
    return lang === 'ru' ? '1 день' : '1 day';
  }
  return lang === 'ru'
    ? `${tariffData.durationDays} дней с покупки`
    : `${tariffData.durationDays} days from purchase`;
};

async function createInvoiceLinkForUser(telegramId, tariffCode, lang = 'en') {
  if (!TARIFFS[tariffCode]) {
    throw new Error(`Unknown tariff: ${tariffCode}`);
  }
  const invoice = buildStarsInvoice(telegramId, tariffCode, lang);
  return bot.telegram.createInvoiceLink(invoice);
}

// ============ BOT HANDLERS ============

bot.command('start', async (ctx) => {
  const { id: telegram_id, first_name, username, language_code } = ctx.from;

  const lang = language_code === 'ru' ? 'ru' : 'en';

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

bot.command('tariffs', async (ctx) => {
  const { language_code } = ctx.from;
  const lang = language_code === 'ru' ? 'ru' : 'en';

  let message = lang === 'ru' ? '💳 **ДОСТУПНЫЕ ТАРИФЫ**\n\n' : '💳 **AVAILABLE TARIFFS**\n\n';

  const keyboard = Markup.inlineKeyboard([]);

  for (const [key, tariff] of publicTariffs()) {
    const name = lang === 'ru' ? tariff.name_ru : tariff.name_en;
    const description = lang === 'ru' ? tariff.description_ru : tariff.description_en;

    message +=
      lang === 'ru'
        ? `✨ **${name}** (${tariff.price} ⭐)\n${description}\n\n`
        : `✨ **${name}** (${tariff.price} ⭐)\n${description}\n\n`;

    const buttonText = lang === 'ru' ? `💳 Купить ${name}` : `💳 Buy ${name}`;
    keyboard.inline_keyboard.push([Markup.button.callback(buttonText, `buy_${key}`, false)]);
  }

  await ctx.reply(message, keyboard);
});

bot.action(/buy_(.+)/, async (ctx) => {
  const tariff = ctx.match[1];
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
          `💫 Цена: ${tariffData.price} ⭐\n` +
          `📦 Включено: ${formatChecks(tariffData, lang)}\n` +
          `⏰ Срок: ${formatExpiryHint(tariffData, lang)}\n\n` +
          `⏳ Ожидайте диалога оплаты...`
        : `Initiating payment for ${tariffData.name_en}...\n` +
          `💫 Price: ${tariffData.price} stars\n` +
          `📦 Includes: ${formatChecks(tariffData, lang)}\n` +
          `⏰ Valid: ${formatExpiryHint(tariffData, lang)}\n\n` +
          `⏳ Waiting for payment dialog...`;

    await ctx.editMessageText(message);

    const invoice = buildStarsInvoice(telegram_id, tariff, lang);
    await ctx.telegram.sendInvoice(
      telegram_id,
      invoice.title,
      invoice.description,
      invoice.payload,
      invoice.provider_token,
      invoice.currency,
      invoice.prices
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

bot.on('pre_checkout_query', async (ctx) => {
  const query = ctx.preCheckoutQuery;
  try {
    const check = isValidStarsCheckout(query);
    if (!check.ok) {
      console.error('❌ Pre-checkout rejected:', check.error, query.invoice_payload);
      await ctx.answerPreCheckoutQuery(false, check.error);
      return;
    }
    await ctx.answerPreCheckoutQuery(true);
  } catch (error) {
    console.error('❌ Pre-checkout error:', error.message);
    try {
      await ctx.answerPreCheckoutQuery(false, 'Payment cannot be processed');
    } catch (replyError) {
      console.error('❌ answerPreCheckoutQuery failed:', replyError.message);
    }
  }
});

bot.on('successful_payment', async (ctx) => {
  const { id: telegram_id, language_code } = ctx.from;
  const payment = ctx.message.successful_payment;
  const lang = language_code === 'ru' ? 'ru' : 'en';

  console.log('✅ ПЛАТЕЖ ПОЛУЧЕН:', {
    user: telegram_id,
    payload: payment.invoice_payload,
    amount: payment.total_amount,
  });

  try {
    const tariff = parseTariffFromPayload(payment.invoice_payload);
    const tariffData = TARIFFS[tariff];

    if (!tariffData) {
      throw new Error(`Unknown tariff: ${tariff}`);
    }

    await recordPayment(
      telegram_id,
      tariff,
      payment.total_amount,
      payment.telegram_payment_charge_id,
      payment
    );

    const expiresAt = await activateSubscription(
      telegram_id,
      tariff,
      payment.telegram_payment_charge_id,
      payment.total_amount
    );

    const notificationMsg =
      lang === 'ru'
        ? `✅ <b>Платеж успешно обработан!</b>\n\n` +
          `💳 Тариф: <b>${tariffData.name_ru}</b>\n` +
          `💫 Цена: ${payment.total_amount} ⭐\n` +
          `📦 Проверок: ${formatChecks(tariffData, lang)}\n` +
          `⏰ Срок действия до: ${expiresAt.toLocaleString('ru-RU')}\n` +
          `\nСпасибо за покупку! 🎉`
        : `✅ <b>Payment processed successfully!</b>\n\n` +
          `💳 Tariff: <b>${tariffData.name_en}</b>\n` +
          `💫 Price: ${payment.total_amount} ⭐\n` +
          `📦 Checks: ${formatChecks(tariffData, lang)}\n` +
          `⏰ Valid until: ${expiresAt.toLocaleString('en-US')}\n` +
          `\nThank you for your purchase! 🎉`;

    await ctx.reply(notificationMsg, { parse_mode: 'HTML' });

    try {
      await axios.post(`${PYTHON_API_URL}/api/user/${telegram_id}/subscription`, {
        tariff,
        checks_limit: tariffData.unlimited ? 0 : tariffData.checks,
        checks_remaining: tariffData.unlimited ? 0 : tariffData.checks,
        unlimited: tariffData.unlimited,
        expires_at: expiresAt.toISOString(),
        transaction_id: payment.telegram_payment_charge_id,
      });
      console.log(`✅ Subscription synced to Python API for user ${telegram_id}`);
    } catch (syncError) {
      console.error('⚠️ Sync error:', syncError.message);
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

    const subscription = await resolveUserSubscription(telegram_id);

    if (!subscription) {
      const msg =
        lang === 'ru'
          ? '📭 У вас нет активной подписки.\n\nИспользуйте /tariffs для покупки тарифа.'
          : '📭 You have no active subscription.\n\nUse /tariffs to buy a plan.';
      await ctx.reply(msg);
      return;
    }

    const tariffData = TARIFFS[subscription.tariff] || {};
    const name =
      lang === 'ru' ? tariffData.name_ru || subscription.tariff : tariffData.name_en || subscription.tariff;
    const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;

    if (subscription.expired) {
      const msg =
        lang === 'ru'
          ? `⌛ <b>Подписка истекла</b>\n\n` +
            `💳 Тариф: <b>${name}</b>\n` +
            `📦 Проверок осталось: <b>0</b>\n` +
            (expiresAt ? `⏰ Истекла: <b>${expiresAt.toLocaleString('ru-RU')}</b>\n` : '') +
            `\nНеиспользованные проверки сгорели. Используйте /tariffs для новой покупки.`
          : `⌛ <b>Subscription expired</b>\n\n` +
            `💳 Tariff: <b>${name}</b>\n` +
            `📦 Checks left: <b>0</b>\n` +
            (expiresAt ? `⏰ Expired: <b>${expiresAt.toLocaleString('en-US')}</b>\n` : '') +
            `\nUnused checks have been forfeited. Use /tariffs to buy a new plan.`;
      await ctx.reply(msg, { parse_mode: 'HTML' });
      return;
    }

    const checksText =
      subscription.unlimited || subscription.checks_remaining === 'unlimited'
        ? lang === 'ru'
          ? 'Безлимит'
          : 'Unlimited'
        : String(subscription.checks_remaining);

    const timeLeft = expiresAt ? expiresAt.getTime() - Date.now() : null;
    const hoursLeft = timeLeft != null ? Math.max(0, Math.ceil(timeLeft / (1000 * 60 * 60))) : null;

    const message =
      lang === 'ru'
        ? `📊 <b>Ваша подписка</b>\n\n` +
          `💳 Тариф: <b>${name}</b>\n` +
          `📦 Проверок осталось: <b>${checksText}</b>\n` +
          (expiresAt
            ? `⏰ Истекает: <b>${expiresAt.toLocaleString('ru-RU')}</b>\n` +
              `⌛ Осталось: <b>${hoursLeft} ч</b>\n`
            : '') +
          `📅 Куплен: ${new Date(subscription.purchased_at).toLocaleString('ru-RU')}`
        : `📊 <b>Your Subscription</b>\n\n` +
          `💳 Tariff: <b>${name}</b>\n` +
          `📦 Checks left: <b>${checksText}</b>\n` +
          (expiresAt
            ? `⏰ Expires: <b>${expiresAt.toLocaleString('en-US')}</b>\n` +
              `⌛ Time left: <b>${hoursLeft} h</b>\n`
            : '') +
          `📅 Purchased: ${new Date(subscription.purchased_at).toLocaleString('en-US')}`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('❌ myplan error:', error);
    const msg = lang === 'ru' ? '❌ Ошибка' : '❌ Error';
    await ctx.reply(msg);
  }
});

bot.command('history', async (ctx) => {
  const { id: telegram_id, language_code } = ctx.from;
  const lang = language_code === 'ru' ? 'ru' : 'en';

  try {
    const history = await all(
      'SELECT * FROM payment_history WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 10',
      [telegram_id]
    );

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

module.exports = { bot, TARIFFS, createInvoiceLinkForUser };
