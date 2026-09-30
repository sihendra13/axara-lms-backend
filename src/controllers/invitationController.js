const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/database');

const SALT_ROUNDS = 12;
const INVITATION_EXPIRES_DAYS = 7;

// POST /api/v1/invitations
// HRD buat undangan untuk supervisor/lead → dapat link yang bisa di-share via WhatsApp
async function createInvitation(req, res) {
  const { email, role, name, dept } = req.body;

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
        dept: dept || null,
        token,
        invited_by: req.user.user_id,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
      })
      .select('id, email, role, invited_name, token, expires_at')
      .single();

    if (error) throw error;

    // Link yang di-share ke supervisor via WhatsApp
    const frontendUrl = process.env.FRONTEND_URL || 'https://hr.myaxara.com';
    const invitationLink = `${frontendUrl}/accept-invitation?token=${token}`;

    res.status(201).json({
      message: 'Invitation created',
      invitation: {
        id: invitation.id,
        email: invitation.email,
        expires_at: invitation.expires_at,
      },
      invitationLink,
      whatsappMessage: `Anda diundang dalam platform myAxara untuk mereview staf divisi ${dept || role} Anda. Klik link berikut untuk membuat akun:\n${invitationLink}`,
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
      .select('id, email, role, invited_name, dept, tenant_id, expires_at, accepted_at')
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
        dept: data.dept,
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
      .select('id, email, role, invited_name, dept, tenant_id, expires_at, accepted_at')
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

    // Buat Supabase Auth user agar bisa login via LMS Admin login page
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: {
        role: invitation.role,
        tenant_id: invitation.tenant_id,
        name,
      },
    });
    if (authError) throw authError;

    // Trigger handle_new_user sudah insert ke public.users — update dept yang belum ada
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .update({ name, dept: invitation.dept, password_hash: passwordHash })
      .eq('id', authData.user.id)
      .select('id, name, email, role, tenant_id, dept')
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
      dept: user.dept,
    };

    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '8h' });
    const refreshToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      message: 'Account created successfully! Welcome to Axara LMS.',
      user: { id: user.id, name: user.name, email: user.email, role: user.role, dept: user.dept },
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

// POST /api/v1/invitations/bulk
async function findAuthUserByEmail(email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find(u => u.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

// Karyawan yang sudah diundang tapi belum pernah membuat password (link kedaluwarsa /
// tidak dibuka) tidak bisa diundang ulang oleh Supabase ("already registered").
// Hapus akun yang belum aktif itu lalu undang ulang. Hanya untuk role employee di tenant
// yang sama — akun yang sudah aktif (password_set) tidak pernah disentuh.
// Return true jika terkirim ulang, atau string alasan jika dilewati.
async function resendExpiredInvite(emp, tenantId, frontendUrl) {
  const user = await findAuthUserByEmail(emp.email);
  if (!user) return 'Already registered';
  const meta = user.user_metadata || {};
  if (meta.password_set) return 'Sudah aktif (sudah membuat password)';
  if (meta.role && meta.role !== 'employee') return 'Akun bukan karyawan';
  if (meta.tenant_id && meta.tenant_id !== tenantId) return 'Terdaftar di perusahaan lain';

  const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  if (delError) return `Gagal menghapus undangan lama: ${delError.message}`;

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(emp.email.toLowerCase(), {
    data: { name: emp.name || emp.email, role: 'employee', tenant_id: tenantId, dept: emp.dept || null },
    redirectTo: frontendUrl,
  });
  if (error) return `Gagal mengirim ulang: ${error.message}`;
  console.log('[bulkInvite] resent expired invite to:', emp.email);
  return true;
}

// Admin kirim undangan ke banyak karyawan sekaligus (setelah import Excel)
async function bulkInvite(req, res) {
  const { employees } = req.body;
  console.log('[bulkInvite] request received, employees:', employees?.length, 'tenant:', req.tenant_id);

  if (!employees || !Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ error: 'employees array is required' });
  }

  const results = { sent: [], failed: [], skipped: [] };
  const frontendUrl = process.env.FRONTEND_URL || 'https://learn.myaxara.com';

  for (const emp of employees) {
    if (!emp.email) {
      results.skipped.push({ name: emp.name, reason: 'No email' });
      continue;
    }

    try {
      console.log('[bulkInvite] inviting:', emp.email);
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        emp.email.toLowerCase(),
        {
          data: {
            name: emp.name || emp.email,
            role: emp.role || 'employee',
            tenant_id: req.tenant_id,
            dept: emp.dept || null,
          },
          redirectTo: frontendUrl,
        }
      );

      if (error) {
        console.error('[bulkInvite] error for', emp.email, ':', error.message, error.status, error.code);
        if (error.message?.includes('already been registered') || error.message?.includes('already exists')) {
          // Undangan sebelumnya kedaluwarsa & karyawan belum pernah membuat password → kirim ulang
          const resent = await resendExpiredInvite(emp, req.tenant_id, frontendUrl);
          if (resent === true) {
            results.sent.push({ email: emp.email, name: emp.name, resent: true });
          } else {
            results.skipped.push({ email: emp.email, name: emp.name, reason: resent || 'Already registered' });
          }
        } else {
          results.failed.push({ email: emp.email, name: emp.name, reason: error.message });
        }
      } else {
        console.log('[bulkInvite] sent to:', emp.email);
        results.sent.push({ email: emp.email, name: emp.name });
      }
    } catch (err) {
      console.error('[bulkInvite] exception for', emp.email, ':', err.message);
      results.failed.push({ email: emp.email, name: emp.name, reason: err.message });
    }
  }

  res.json({
    message: `Bulk invite complete: ${results.sent.length} sent, ${results.skipped.length} skipped, ${results.failed.length} failed`,
    total: employees.length,
    ...results,
  });
}

module.exports = { createInvitation, listInvitations, validateInvitation, acceptInvitation, revokeInvitation, bulkInvite };
