// Buat akun trial untuk calon klien: tenant baru (paket Business, 7 hari) + admin HRD.
//
// Pemakaian:
//   node scripts/create-trial.js "PT Nama Klien" "Nama Admin" admin@klien.com
//
// Password sementara dicetak sekali di terminal — kirimkan ke klien bersama link dashboard.
require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const TRIAL_DAYS = 7;
const TRIAL_PLAN = 'business';

const [companyName, adminName, rawEmail] = process.argv.slice(2);
if (!companyName || !adminName || !rawEmail) {
  console.error('Pemakaian: node scripts/create-trial.js "PT Nama Klien" "Nama Admin" email@klien.com');
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Password sementara yang mudah dibaca (tanpa karakter ambigu)
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12), b => chars[b % chars.length]).join('');
}

async function main() {
  const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (existing) throw new Error(`Email ${email} sudah terdaftar sebagai user.`);

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({ name: companyName, plan: TRIAL_PLAN, status: 'active', trial_ends_at: trialEndsAt })
    .select('id, name')
    .single();
  if (tenantError) throw tenantError;

  try {
    const password = tempPassword();
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'admin', tenant_id: tenant.id, name: adminName, dept: 'HRD' },
    });
    if (authError) throw authError;

    // Trigger handle_new_user biasanya sudah membuat baris users — upsert untuk memastikan lengkap
    const { error: userError } = await supabase.from('users').upsert({
      id: authData.user.id,
      tenant_id: tenant.id,
      email,
      name: adminName,
      role: 'admin',
      dept: 'HRD',
      status: 'active',
      avatar: adminName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
    }, { onConflict: 'id' });
    if (userError) throw userError;

    const { error: settingsError } = await supabase.from('tenant_settings').upsert(
      { tenant_id: tenant.id, passing_score: 80, validity_months: 12 },
      { onConflict: 'tenant_id' }
    );
    if (settingsError) console.warn('Peringatan: gagal membuat tenant_settings:', settingsError.message);

    console.log('\nAkun trial berhasil dibuat');
    console.log('────────────────────────────────────────');
    console.log('Perusahaan   :', tenant.name);
    console.log('Tenant ID    :', tenant.id);
    console.log('Admin        :', adminName);
    console.log('Email login  :', email);
    console.log('Password     :', password);
    console.log('Paket        :', TRIAL_PLAN);
    console.log('Trial sampai :', new Date(trialEndsAt).toLocaleString('id-ID'));
    console.log('────────────────────────────────────────');
    console.log('Minta klien mengganti password setelah login pertama.\n');
  } catch (err) {
    // Jangan tinggalkan tenant tanpa admin
    await supabase.from('tenants').delete().eq('id', tenant.id);
    throw err;
  }
}

main().catch(err => {
  console.error('Gagal membuat akun trial:', err.message || err);
  process.exit(1);
});
