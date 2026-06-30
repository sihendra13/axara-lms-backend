const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const { sendPush } = require('../controllers/notificationController');

router.use(authMiddleware, tenantMiddleware);
router.post('/push', sendPush);

module.exports = router;
