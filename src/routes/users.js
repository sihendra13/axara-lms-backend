const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantMiddleware = require('../middleware/tenant');
const { listUsers, getUser, addEmployee, addEmployeesBulk, updateUser, deactivateUser } = require('../controllers/userController');

// All routes require authentication + tenant isolation
router.use(authMiddleware, tenantMiddleware);

router.get('/', listUsers);
router.get('/:id', getUser);
router.post('/employees', addEmployee);
router.post('/employees/bulk', addEmployeesBulk);
router.patch('/:id', updateUser);
router.delete('/:id', deactivateUser);

module.exports = router;
