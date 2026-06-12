const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/database');

const SALT_ROUNDS = 12;
const INVITATION_EXPIRES_DAYS = 7;

// POST /api/v1/invitations
// HRD buat undangan untuk supervisor/lead → dapat link yang bisa di-share via WhatsApp
async function createInvitation(req, res) {
  const { email, role, name } = req.body;

  if (!email || !role) {
    return res.status(400).json({ error: 'email and role are required' });
  }

  if (!['supervisor', 'lead', 'employee'].includes(role)) {
    return res.status(400).json({ error: 'role must be supervisor, lead, or employee' });
  }

  try {
    // Cek email sudah terdaftar sebagai user
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered as a user' });
    }

    // Cek sudah ada undangan pending untuk email ini
    const { data: existingInvite } = await supabaseAdmin
      .from('supervisor_invitations')
      .select('id')
      .eq('email', email.toLowerCase())
      .eq('tenant_id', req.tenant_id)
      .is('accepted_at', null)
      .single();

    if (existingInvite) {
      return res.status(409).json({ error: 'Invitation already sent to this email' });
    }

    // Generate token unik
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRES_DAYS);

    const { data: invitation, error } = await supabaseAdmin
      .from('supervisor_invitations')
      .insert({
        tenant_id: req.tenant_id,
        email: email.toLowerCase(),
        role,
        invited_name: name || null,
        token,
        invited_by: req.user.user_id,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
      })
      .select('id, email, role, invited_name, token, expires_at')
      .single();

    if (error) throw error;

    // Link yang di-share ke supervisor via WhatsApp
    const frontendUrl = process.env.FRONTEND_URL || 'https://lms-admin-6wg.pages.dev';
    const invitationLink = `${frontendUrl}/accept-invitation?token=${token}`;

    res.status(201).json({
      message: 'Invitation created',
      invitation: {
        id: invitation.id,
        email: invitation.email,
        expires_at: invitation.expires_at,
      },
      invitationLink,
      whatsappMessage: `Halo! Anda diundang sebagai ${role} di platform LMS kami. Klik link berikut untuk membuat akun: ${invitationLink} (berlaku 7 hari)`,
    });
  } catch (err) {
    console.error('createInvitation error:', err);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
}

// GET /api/v1/invitations
// HRD lihat semua undangan yang pernah dikirim
async function listInvitations(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('supervisor_invitations')
      .select('id, email, role, name, expires_at, accepted_at, created_at')
      .eq('tenant_id', req.tenant_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const invitations = data.map(inv => ({
      ...inv,
      status: inv.accepted_at
        ? 'accepted'
        : new Date(inv.expires_at) < new Date()
        ? 'expired'
        : 'pending',
    }));

    res.json({ invitations });
  } catch (err) {
    console.error('listInvitations error:', err);
    res.status(500).json({ error: 'Failed to fetch invitations' });
  }
}

// GET /api/v1/invitations/:token  (PUBLIC — tidak butuh login)
// Supervisor buka link → validasi token
async function validateInvitation(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('supervisor_invitations')
      .select('id, email, role, invited_name, tenant_id, expires_at, accepted_at')
      .eq('token', req.params.token)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Invitation not found or invalid link' });
    }

    if (data.accepted_at) {
      return res.status(409).json({ error: 'Invitation already accepted' });
    }

    if (new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invitation link has expired' });
    }

    // Ambil nama tenant untuk ditampilkan di halaman accept
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('name')
      .eq('id', data.tenant_id)
      .single();

    res.json({
      valid: true,
      invitation: {
        email: data.email,
        role: data.role,
        invited_name: data.invited_name,
        company: tenant?.name,
        expires_at: data.expires_at,
      },
    });
  } catch (err) {
    console.error('validateInvitation error:', err);
    res.status(500).json({ error: 'Failed to validate invitation' });
  }
}

// POST /api/v1/invitations/:token/accept  (PUBLIC — tidak butuh login)
// Supervisor isi nama + password → akun dibuat
async function acceptInvitation(req, res) {
  const { name, password } = req.body;

  if (!name || !password) {
    return res.status(400).json({ error: 'name and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const { data: invitation, error } = await supabaseAdmin
      .from('supervisor_invitations')
      .select('id, email, role, invited_name, tenant_id, expires_at, accepted_at')
      .eq('token', req.params.token)
      .single();

    if (error || !invitation) {
      return res.status(404).json({ error: 'Invalid invitation link' });
    }

    if (invitation.accepted_at) {
      return res.status(409).json({ error: 'Invitation already accepted' });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invitation link has expired' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Buat user baru
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        tenant_id: invitation.tenant_id,
        name,
        email: invitation.email,
        password_hash: passwordHash,
        role: invitation.role,
      })
      .select('id, name, email, role, tenant_id')
      .single();

    if (userError) throw userError;

    // Tandai invitation sudah diterima
    await supabaseAdmin
      .from('supervisor_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    const jwt = require('jsonwebtoken');
    const tokenPayload = {
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      name: user.name,
      email: user.email,
    };

    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '8h' });
    const refreshToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      message: 'Account created successfully! Welcome to Axara LMS.',
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('acceptInvitation error:', err);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
}

// DELETE /api/v1/invitations/:id
// HRD batalkan undangan yang belum diterima
async function revokeInvitation(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('supervisor_invitations')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenant_id)
      .is('accepted_at', null)
      .select('email')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Invitation not found or already accepted' });
    }

    res.json({ message: `Invitation to ${data.email} has been revoked` });
  } catch (err) {
    console.error('revokeInvitation error:', err);
    res.status(500).json({ error: 'Failed to revoke invitation' });
  }
}

module.exports = { createInvitation, listInvitations, validateInvitation, acceptInvitation, revokeInvitation };
