const express = require('express');
const router = express.Router();

// GET /api/user/:userId
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // TODO: запрос в MongoDB
    res.json({
      userId: userId,
      tries: 3,
      plan: 'none',
      expiresAt: null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
