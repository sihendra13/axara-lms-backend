const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const { sendPush, notifySpvEmail } = require('../controllers/notificationController');

router.use(authMiddleware, tenantMiddleware);
router.post('/push', sendPush);
router.post('/email-spv', notifySpvEmail);

module.exports = router;
