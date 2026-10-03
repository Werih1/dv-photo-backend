// ============================================
// Каталог тарифов и расчёт срока действия
// ============================================

require('dotenv').config();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TARIFFS = {
  LITE: {
    name_en: 'LITE',
    name_ru: 'ЛАЙТ',
    description_en: '10 photo checks, valid until 30 August',
    description_ru: '10 проверок фото, действует до 30 августа',
    price: 100,
    checks: 10,
    unlimited: false,
    expiryType: 'next_august_30',
    public: true,
  },
  FAMILY: {
    name_en: 'FAMILY',
    name_ru: 'СЕМЕЙНЫЙ',
    description_en: '40 photo checks, valid until 30 August',
    description_ru: '40 проверок фото, действует до 30 августа',
    price: 250,
    checks: 40,
    unlimited: false,
    expiryType: 'next_august_30',
    public: true,
  },
  ULTRA: {
    name_en: 'ULTRA',
    name_ru: 'УЛЬТРА',
    description_en: 'Unlimited checks for 60 days from purchase',
    description_ru: 'Безлимитные проверки на 60 дней с момента покупки',
    price: 1000,
    checks: 0,
    unlimited: true,
    expiryType: 'duration_days',
    durationDays: 60,
    public: true,
  },
  TEST: {
    name_en: 'TEST',
    name_ru: 'ТЕСТ',
    description_en: '1 photo check, valid for 1 day (development)',
    description_ru: '1 проверка фото, действует 1 день (для разработки)',
    price: 1,
    checks: 1,
    unlimited: false,
    expiryType: 'duration_days',
    durationDays: 1,
    public: true,
    devOnly: true,
  },
};

function isTariffListed(tariff) {
  if (!tariff) return false;
  if (tariff.devOnly && process.env.NODE_ENV === 'production') {
    return false;
  }
  return tariff.public !== false;
}

function endOfAugust30Utc(year) {
  return new Date(Date.UTC(year, 7, 30, 23, 59, 59, 999));
}

/** Ближайшая ещё не прошедшая дата 30 августа (включая сегодняшний 30 августа). */
function getNextAugust30(fromDate = new Date()) {
  const year = fromDate.getUTCFullYear();
  const thisYear = endOfAugust30Utc(year);
  if (fromDate.getTime() <= thisYear.getTime()) {
    return thisYear;
  }
  return endOfAugust30Utc(year + 1);
}

function computeExpiresAt(tariffCode, fromDate = new Date()) {
  const tariff = TARIFFS[tariffCode];
  if (!tariff) {
    throw new Error(`Unknown tariff: ${tariffCode}`);
  }

  if (tariff.expiryType === 'next_august_30') {
    return getNextAugust30(fromDate);
  }

  if (tariff.expiryType === 'duration_days') {
    return new Date(fromDate.getTime() + tariff.durationDays * MS_PER_DAY);
  }

  throw new Error(`Unknown expiry type for tariff ${tariffCode}`);
}

function isExpired(expiresAt, now = new Date()) {
  if (!expiresAt) {
    return true;
  }
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    return true;
  }
  return now.getTime() > expiry.getTime();
}

function isUnlimitedRow(subscription) {
  if (!subscription) return false;
  if (Number(subscription.unlimited) === 1 || subscription.unlimited === true) {
    return true;
  }
  const tariff = TARIFFS[subscription.tariff];
  return Boolean(tariff && tariff.unlimited);
}

function getEffectiveChecks(subscription, now = new Date()) {
  if (!subscription) {
    return 0;
  }
  if (isExpired(subscription.expires_at, now)) {
    return 0;
  }
  if (isUnlimitedRow(subscription)) {
    return Number.POSITIVE_INFINITY;
  }
  const remaining = Number(subscription.checks_remaining) || 0;
  return remaining > 0 ? remaining : 0;
}

function serializeChecks(effectiveChecks) {
  if (effectiveChecks === Number.POSITIVE_INFINITY) {
    return 'unlimited';
  }
  return effectiveChecks;
}

module.exports = {
  TARIFFS,
  isTariffListed,
  computeExpiresAt,
  getNextAugust30,
  isExpired,
  isUnlimitedRow,
  getEffectiveChecks,
  serializeChecks,
};
