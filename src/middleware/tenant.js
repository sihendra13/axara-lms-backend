// Tenant isolation middleware
// Ensures user can only access data from their tenant

const tenantMiddleware = (req, res, next) => {
  if (!req.user || !req.user.tenant_id) {
    return res.status(401).json({ error: 'Tenant information missing' });
  }

  // Attach tenant_id to request for use in controllers
  req.tenant_id = req.user.tenant_id;
  next();
};

module.exports = tenantMiddleware;
