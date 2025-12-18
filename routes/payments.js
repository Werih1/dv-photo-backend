const express = require('express');
const router = express.Router();
const axios = require('axios');

// Цены тарифов в звёздах
const PLAN_PRICES = {
    'LITE': 1,      // Для тестирования (потом 100)
    'MAX': 1,       // Для тестирования (потом 500)
    'ULTRA': 1      // Для тестирования (потом 2500)
};

const PLAN_DESCRIPTIONS = {
    'LITE': 'Тариф LITE - 10 проверок фото для DV-Lottery',
    'MAX': 'Тариф MAX - Безлимит на 48 часов для DV-Lottery',
    'ULTRA': 'Тариф ULTRA - Безлимит на 6 месяцев для DV-Lottery'
};

// ===== POST /api/payments/send-invoice =====
// Получает данные от фронтенда (Web App) и отправляет счет пользователю
router.post('/send-invoice', async (req, res) => {
    try {
        const { telegram_id, plan } = req.body;

        console.log(`🛒 Запрос на платёж: user=${telegram_id}, plan=${plan}`);

        // Проверяем что план существует
        if (!PLAN_PRICES[plan]) {
            return res.status(400).json({ 
                ok: false, 
                error: `Неизвестный тариф: ${plan}` 
            });
        }

        const price = PLAN_PRICES[plan];
        const description = PLAN_DESCRIPTIONS[plan];
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        if (!botToken) {
            console.error('❌ TELEGRAM_BOT_TOKEN не установлен в .env');
            return res.status(500).json({ 
                ok: false, 
                error: 'Ошибка конфигурации сервера' 
            });
        }

        // Формируем данные инвойса для Telegram API
        const invoiceData = {
            chat_id: telegram_id,
            title: `DV-Lottery Photo Check - ${plan}`,
            description: description,
            payload: `plan_${plan}_${telegram_id}_${Date.now()}`,
            currency: 'XTR',  // XTR = Telegram Stars
            prices: [
                {
                    label: `${plan} Subscription`,
                    amount: price
                }
            ]
        };

        console.log(`📤 Отправляем инвойс: ${JSON.stringify(invoiceData)}`);

        // Отправляем счет через Telegram Bot API
        const response = await axios.post(
            `https://api.telegram.org/bot${botToken}/sendInvoice`,
            invoiceData
        );

        if (response.data.ok) {
            console.log(`✅ Инвойс успешно отправлен пользователю ${telegram_id}`);
            return res.json({ 
                ok: true, 
                message: 'Invoice sent successfully',
                invoice_id: response.data.result.message_id
            });
        } else {
            console.error(`❌ Ошибка Telegram API: ${response.data.description}`);
            return res.status(400).json({ 
                ok: false, 
                error: response.data.description 
            });
        }

    } catch (error) {
        console.error(`❌ Ошибка при отправке инвойса: ${error.message}`);
        res.status(500).json({ 
            ok: false, 
            error: error.message 
        });
    }
});


// ===== POST /api/payments/success =====
// Вебхук для обработки успешного платежа
// Telegram отправляет сюда уведомление о успешном платеже
router.post('/success', async (req, res) => {
    try {
        const { telegram_id, plan, amount, payload } = req.body;

        console.log(`✅ ПЛАТЁЖ УСПЕШЕН!`);
        console.log(`   User: ${telegram_id}`);
        console.log(`   Plan: ${plan}`);
        console.log(`   Amount: ${amount} XTR`);

        // === ЗДЕСЬ ДОБАВЛЯЕМ ЛОГИКУ АКТИВАЦИИ ТАРИФА ===
        // Сохраняем информацию о покупке в БД
        // Примеры:
        // 1. await User.updateOne({ telegram_id }, { subscription: plan, ... })
        // 2. await Subscription.create({ telegram_id, plan, amount, date: new Date() })

        // Для тестирования просто логируем
        console.log(`💾 Сохраняем подписку в БД: ${telegram_id} -> ${plan}`);

        // Отправляем успешный ответ
        res.json({ 
            ok: true, 
            message: `Тариф ${plan} активирован` 
        });

    } catch (error) {
        console.error(`❌ Ошибка при обработке платежа: ${error.message}`);
        res.status(500).json({ 
            ok: false, 
            error: error.message 
        });
    }
});


// ===== POST /api/payments/webhook =====
// Основной вебхук для обработки обновлений от Telegram
// (если у вас настроен webhook вместо polling)
router.post('/webhook', async (req, res) => {
    try {
        const update = req.body;

        // Проверяем это ли это успешный платёж
        if (update.message && update.message.successful_payment) {
            const payment = update.message.successful_payment;
            const user_id = update.message.from.id;
            const payload = payment.invoice_payload;

            console.log(`✅ Webhook: Платёж получен от ${user_id}`);
            console.log(`   Payload: ${payload}`);
            console.log(`   Amount: ${payment.total_amount} ${payment.currency}`);

            // Извлекаем название плана из payload
            // Формат payload: plan_LITE_123456_1703001234
            const parts = payload.split('_');
            const plan = parts[1];

            // === АКТИВИРУЕМ ТАРИФ ===
            console.log(`💾 Активируем тариф ${plan} для пользователя ${user_id}`);

            // Добавьте здесь сохранение в БД:
            // await User.updateOne(
            //     { telegram_id: user_id },
            //     { 
            //         subscription: plan,
            //         subscription_date: new Date(),
            //         subscription_active: true
            //     }
            // );
        }

        // Обязательно возвращаем успешный ответ Telegram
        res.json({ ok: true });

    } catch (error) {
        console.error(`❌ Ошибка в webhook: ${error.message}`);
        res.status(500).json({ ok: false, error: error.message });
    }
});


module.exports = router;