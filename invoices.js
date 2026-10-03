const { TARIFFS } = require('./tariffs');

function buildStarsInvoice(telegramId, tariffCode, lang = 'en') {
  const tariff = TARIFFS[tariffCode];
  if (!tariff) {
    throw new Error(`Unknown tariff: ${tariffCode}`);
  }

  const title = lang === 'ru' ? tariff.name_ru : tariff.name_en;
  const description = lang === 'ru' ? tariff.description_ru : tariff.description_en;

  return {
    title: tariff.name_en,
    description,
    payload: `tariff_${tariffCode}_${telegramId}_${Date.now()}`,
    provider_token: '',
    currency: 'XTR',
    prices: [
      {
        label: title,
        amount: tariff.price,
      },
    ],
  };
}

function parseTariffFromPayload(payload) {
  const match = String(payload || '').match(/^tariff_([A-Z]+)_\d+_\d+$/);
  return match ? match[1] : null;
}

function isValidStarsCheckout(query) {
  const tariffCode = parseTariffFromPayload(query.invoice_payload);
  const tariff = tariffCode ? TARIFFS[tariffCode] : null;
  if (!tariff) {
    return { ok: false, error: 'Unknown tariff' };
  }
  if (query.currency !== 'XTR') {
    return { ok: false, error: 'Invalid currency' };
  }
  if (Number(query.total_amount) !== Number(tariff.price)) {
    return { ok: false, error: 'Invalid amount' };
  }
  return { ok: true, tariff: tariffCode };
}

module.exports = {
  buildStarsInvoice,
  parseTariffFromPayload,
  isValidStarsCheckout,
};
