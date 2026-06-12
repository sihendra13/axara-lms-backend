const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/database');

const SALT_ROUNDS = 12;

// GET /api/v1/users
// HRD lihat semua user dalam tenant (bisa filter by role, status)
async function listUsers(req, res) {
  const { role, status, department_id } = req.query;

  try {
    let query = supabaseAdmin
      .from('users')
      .select('id, name, email, role, status, department_id, position, created_at')
      .eq('tenant_id', req.tenant_id)
      .order('created_at', { ascending: false });

    if (role) query = query.eq('role', role);
    if (status !== undefined) query = query.eq('status', status === 'true');
    if (department_id) query = query.eq('department_id', department_id);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ users: data, total: data.length });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

// GET /api/v1/users/:id
async function getUser(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, status, department_id, position, created_at')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenant_id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'User not found' });

    res.json({ user: data });
  } catch (err) {
    console.error('getUser error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
}

// POST /api/v1/users/employees
// HRD tambah karyawan langsung — generate password sementara
async function addEmployee(req, res) {
  const { name, email, department_id, position } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  try {
    // Check email already exists
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) return res.status(409).json({ error: 'Email already registered' });

    // Generate password sementara — HRD share via WhatsApp
    const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. "A3F9B2C1"
    const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({
        tenant_id: req.tenant_id,
        name,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        role: 'employee',
        status: 'active',
        avatar: name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        department_id: department_id || null,
      })
      .select('id, name, email, role, department_id')
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Employee added successfully',
      user,
      tempPassword, // HRD bagikan ke karyawan via WhatsApp
      note: 'Share this password to the employee. They should change it after first login.',
    });
  } catch (err) {
    console.error('addEmployee error:', err);
    res.status(500).json({ error: 'Failed to add employee' });
  }
}

// POST /api/v1/users/employees/bulk
// HRD tambah banyak karyawan sekaligus
async function addEmployeesBulk(req, res) {
  const { employees } = req.body;

  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ error: 'employees array is required' });
  }

  if (employees.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 employees per bulk import' });
  }

  const results = { success: [], failed: [] };

  for (const emp of employees) {
    if (!emp.name || !emp.email) {
      results.failed.push({ email: emp.email, reason: 'name and email required' });
      continue;
    }

    try {
      const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase();
      const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

      const { data, error } = await supabaseAdmin
        .from('users')
        .insert({
          tenant_id: req.tenant_id,
          name: emp.name,
          email: emp.email.toLowerCase(),
          password_hash: passwordHash,
          role: 'employee',
          status: 'active',
          avatar: emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
          department_id: emp.department_id || null,
        })
        .select('id, name, email')
        .single();

      if (error) throw error;

      results.success.push({ ...data, tempPassword });
    } catch {
      results.failed.push({ email: emp.email, reason: 'Email already exists or invalid' });
    }
  }

  res.status(201).json({
    message: `${results.success.length} employees added, ${results.failed.length} failed`,
    results,
  });
}

// PATCH /api/v1/users/:id
async function updateUser(req, res) {
  const { name, department_id, position, status } = req.body;

  try {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (department_id !== undefined) updates.department_id = department_id;
    if (position !== undefined) updates.position = position;
    if (status !== undefined) updates.status = status;

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenant_id)
      .select('id, name, email, role, status, department_id, position')
      .single();

    if (error || !data) return res.status(404).json({ error: 'User not found' });

    res.json({ message: 'User updated', user: data });
  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
}

// DELETE /api/v1/users/:id  (soft delete — nonaktifkan saja)
async function deactivateUser(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ status: false })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenant_id)
      .neq('role', 'hrd') // HRD tidak bisa didelete dari sini
      .select('id, name, email')
      .single();

    if (error || !data) return res.status(404).json({ error: 'User not found' });

    res.json({ message: `${data.name} has been deactivated` });
  } catch (err) {
    console.error('deactivateUser error:', err);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
}

module.exports = { listUsers, getUser, addEmployee, addEmployeesBulk, updateUser, deactivateUser };
