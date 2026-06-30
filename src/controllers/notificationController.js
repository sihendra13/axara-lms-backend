const webpush = require('../services/webpush');
const { supabaseAdmin } = require('../config/database');

// POST /api/v1/notifications/push
// Kirim push notification ke daftar email karyawan. Dipanggil setelah SOP baru
// ditugaskan, sertifikat di-approve, dll. Gagal kirim ke satu subscriber tidak
// boleh menggagalkan request — selalu best-effort.
async function sendPush(req, res) {
  const { emails, title, body, url } = req.body;

  if (!Array.isArray(emails) || emails.length === 0 || !title || !body) {
    return res.status(400).json({ error: 'emails (array), title, and body are required' });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(503).json({ error: 'Push notifications not configured (missing VAPID keys)' });
  }

  try {
    const { data: subs, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, user_email, endpoint, keys_p256dh, keys_auth')
      .in('user_email', emails.map(e => e.toLowerCase()));

    if (error) throw error;
    if (!subs || subs.length === 0) {
      return res.json({ message: 'No subscriptions found for given emails', sent: 0, failed: 0 });
    }

    const payload = JSON.stringify({ title, body, url: url || '/' });
    let sent = 0;
    let failed = 0;
    const staleIds = [];

    await Promise.all(subs.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      };
      try {
        await webpush.sendNotification(pushSubscription, payload);
        sent++;
      } catch (err) {
        failed++;
        // 404/410 = subscription expired/revoked by browser, safe to remove
        if (err.statusCode === 404 || err.statusCode === 410) {
          staleIds.push(sub.id);
        }
      }
    }));

    if (staleIds.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('id', staleIds);
    }

    res.json({ message: 'Push notifications processed', sent, failed });
  } catch (err) {
    console.error('sendPush error:', err);
    res.status(500).json({ error: 'Failed to send push notifications' });
  }
}

module.exports = { sendPush };
