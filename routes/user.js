const express = require('express');
const router = express.Router();
const { getUser, resolveUserSubscription } = require('../db');

router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const subscription = await resolveUserSubscription(userId);
    const user = await getUser(userId);

    let tries = user ? user.checks_remaining : 3;
    let plan = 'none';
    let expiresAt = null;
    let expired = false;

    if (subscription && !subscription.expired) {
      tries = subscription.checks_remaining;
      plan = subscription.tariff;
      expiresAt = subscription.expires_at;
    } else if (subscription && subscription.expired) {
      tries = 0;
      plan = 'none';
      expiresAt = subscription.expires_at;
      expired = true;
    }

    res.json({
      userId,
      tries,
      plan,
      expiresAt,
      expired,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
