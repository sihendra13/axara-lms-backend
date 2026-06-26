const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/database');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Missing token' });
  }

  const token = authHeader.substring(7);

  // Try custom JWT first
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (_) {}

  // Fallback: verify as Supabase JWT
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) throw new Error('Invalid Supabase token');

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('id, name, role, tenant_id')
      .eq('id', user.id)
      .single();

    if (!profile) throw new Error('User profile not found');

    req.user = {
      user_id: profile.id,
      tenant_id: profile.tenant_id,
      role: profile.role,
      name: profile.name,
      email: user.email,
    };
    return next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = authMiddleware;
