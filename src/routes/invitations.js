const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const { createInvitation, listInvitations, validateInvitation, acceptInvitation, revokeInvitation, bulkInvite } = require('../controllers/invitationController');

// Public routes — tidak butuh login (supervisor belum punya akun)
router.get('/:token/validate', validateInvitation);
router.post('/:token/accept', acceptInvitation);

// Protected routes — HRD only
router.use(authMiddleware, tenantMiddleware);
router.get('/', listInvitations);
router.post('/', createInvitation);
router.post('/bulk', bulkInvite);
router.delete('/:id', revokeInvitation);

module.exports = router;
