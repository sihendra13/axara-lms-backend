const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/database');

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRES = '8h';
const REFRESH_TOKEN_EXPIRES = '30d';

function generateTokens(payload) {
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
  const refreshToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES });
  return { accessToken, refreshToken };
}

// POST /api/v1/auth/register
// HRD mendaftarkan perusahaan baru (membuat tenant + user HRD)
async function register(req, res) {
  const { company_name, name, email, password } = req.body;

  if (!company_name || !name || !email || !password) {
    return res.status(400).json({ error: 'company_name, name, email, and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Check if email already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create tenant
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert({ name: company_name, plan: 'starter', status: 'active' })
      .select()
      .single();

    if (tenantError) throw tenantError;

    // Create HRD user (role = 'admin' sesuai schema)
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        tenant_id: tenant.id,
        name,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        role: 'admin',
        status: 'active',
        avatar: name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      })
      .select('id, name, email, role, tenant_id')
      .single();

    if (userError) throw userError;

    const tokenPayload = {
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      name: user.name,
      email: user.email,
    };

    const { accessToken, refreshToken } = generateTokens(tokenPayload);

    res.status(201).json({
      message: 'Registration successful',
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: { id: tenant.id, name: tenant.name },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', detail: err.message });
  }
}

// POST /api/v1/auth/login
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, tenant_id, name, email, role, password_hash, status')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const tokenPayload = {
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      name: user.name,
      email: user.email,
    };

    const { accessToken, refreshToken } = generateTokens(tokenPayload);

    res.json({
      message: 'Login successful',
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
}

// POST /api/v1/auth/refresh
async function refresh(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

    // Verify user still exists and is active
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, tenant_id, name, email, role, status')
      .eq('id', decoded.user_id)
      .single();

    if (error || !user || user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const tokenPayload = {
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      name: user.name,
      email: user.email,
    };

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(tokenPayload);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
}

// GET /api/v1/auth/me
async function me(req, res) {
  res.json({
    user: {
      id: req.user.user_id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      tenant_id: req.user.tenant_id,
    },
  });
}

module.exports = { register, login, refresh, me };
