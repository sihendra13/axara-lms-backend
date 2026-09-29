// Tenant isolation middleware
// Ensures user can only access data from their tenant

const { supabaseAdmin } = require('../config/database');

const tenantMiddleware = async (req, res, next) => {
  if (!req.user || !req.user.tenant_id) {
    return res.status(401).json({ error: 'Tenant information missing' });
  }

  // Tolak akses tenant yang masa trial-nya sudah berakhir
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('trial_ends_at')
    .eq('id', req.user.tenant_id)
    .maybeSingle();
  if (tenant?.trial_ends_at && new Date(tenant.trial_ends_at) <= new Date()) {
    return res.status(403).json({ error: 'Masa trial telah berakhir. Hubungi tim Axara untuk melanjutkan.' });
  }

  // Attach tenant_id to request for use in controllers
  req.tenant_id = req.user.tenant_id;
  next();
};

module.exports = tenantMiddleware;
