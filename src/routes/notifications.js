const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const { sendPush, notifyHrdEmail } = require('../controllers/notificationController');

router.use(authMiddleware, tenantMiddleware);
router.post('/push', sendPush);
router.post('/email-hrd', notifyHrdEmail);

module.exports = router;
