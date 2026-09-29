// Kelola status tenant trial.
//
// Pemakaian:
//   node scripts/manage-tenant.js list                          → daftar tenant + status trial
//   node scripts/manage-tenant.js activate <tenant_id> [plan]   → klien bayar: akhiri trial, data tetap
//   node scripts/manage-tenant.js extend <tenant_id> <hari>     → perpanjang trial
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const PLANS = ['starter', 'business', 'enterprise'];
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const [command, tenantId, arg] = process.argv.slice(2);

async function list() {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, plan, is_demo, trial_ends_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const now = Date.now();
  console.table(data.map(t => ({
    id: t.id,
    nama: t.name,
    paket: t.plan,
    status: t.is_demo ? 'demo'
      : !t.trial_ends_at ? 'aktif (berbayar)'
      : new Date(t.trial_ends_at).getTime() > now
        ? `trial, sisa ${Math.ceil((new Date(t.trial_ends_at).getTime() - now) / 86400000)} hari`
        : `trial berakhir ${new Date(t.trial_ends_at).toLocaleDateString('id-ID')}`,
  })));
}

async function activate() {
  const plan = arg || 'business';
  if (!PLANS.includes(plan)) throw new Error(`Paket harus salah satu dari: ${PLANS.join(', ')}`);
  const { data, error } = await supabase
    .from('tenants')
    .update({ trial_ends_at: null, plan, status: 'active' })
    .eq('id', tenantId)
    .select('name, plan')
    .single();
  if (error) throw error;
  console.log(`${data.name} sekarang aktif berlangganan paket ${data.plan}. Semua data trial tetap tersimpan.`);
}

async function extend() {
  const days = Number(arg);
  if (!days || days <= 0) throw new Error('Jumlah hari harus angka positif.');
  const trialEndsAt = new Date(Date.now() + days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('tenants')
    .update({ trial_ends_at: trialEndsAt })
    .eq('id', tenantId)
    .select('name')
    .single();
  if (error) throw error;
  console.log(`Trial ${data.name} diperpanjang sampai ${new Date(trialEndsAt).toLocaleString('id-ID')}.`);
}

const commands = { list, activate, extend };
if (!commands[command] || (command !== 'list' && !tenantId)) {
  console.error('Pemakaian:\n  node scripts/manage-tenant.js list\n  node scripts/manage-tenant.js activate <tenant_id> [starter|business|enterprise]\n  node scripts/manage-tenant.js extend <tenant_id> <hari>');
  process.exit(1);
}
commands[command]().catch(err => {
  console.error('Gagal:', err.message || err);
  process.exit(1);
});
