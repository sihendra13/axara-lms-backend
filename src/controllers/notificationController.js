const webpush = require('../services/webpush');
const { supabaseAdmin } = require('../config/database');
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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
        await webpush.sendNotification(pushSubscription, payload, {
          urgency: 'high',
          TTL: 86400
        });
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

// POST /api/v1/notifications/email-spv
// Kirim email notifikasi ke SPV via Resend saat staf submit kuis
async function notifySpvEmail(req, res) {
  const { dept, learnerName, videoTitle } = req.body;

  if (!dept || !learnerName || !videoTitle) {
    return res.status(400).json({ error: 'dept, learnerName, and videoTitle are required' });
  }

  if (!resend) {
    return res.status(503).json({ error: 'Resend API key is not configured' });
  }

  try {
    const { data: spvs, error } = await supabaseAdmin
      .from('users')
      .select('email, name')
      .eq('dept', dept)
      .eq('role', 'supervisor')
      .eq('tenant_id', req.tenant_id);

    if (error) throw error;

    if (!spvs || spvs.length === 0) {
      return res.json({ message: 'No supervisor found for this department', sent: 0 });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://hr.myaxara.com';
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@myaxara.com';

    let sentCount = 0;
    for (const spv of spvs) {
      if (!spv.email) continue;
      
      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0f172a; margin-top: 0;">Tugas Review Baru! 📝</h2>
          <p style="color: #334155; font-size: 16px; line-height: 1.5;">
            Halo <strong>${spv.name || 'Supervisor'}</strong>,
          </p>
          <p style="color: #334155; font-size: 16px; line-height: 1.5;">
            Staf Anda di divisi <strong>${dept}</strong> yang bernama <strong>${learnerName}</strong> baru saja menyelesaikan kuis untuk SOP:
          </p>
          <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #3b82f6; margin: 20px 0; font-weight: bold; color: #1e293b;">
            "${videoTitle}"
          </div>
          <p style="color: #334155; font-size: 16px; line-height: 1.5;">
            Hasil ujian saat ini berstatus <strong>Menunggu Review</strong>. Silakan segera berikan penilaian (Rekomendasi / Minta Ulang) sebelum batas waktu eskalasi 3 hari.
          </p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="${frontendUrl}/review-sertifikat" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Review Sekarang di LMS Admin</a>
          </div>
        </div>
      `;

      try {
        await resend.emails.send({
          from: `myAxara LMS <${fromEmail}>`,
          to: spv.email,
          subject: 'Tugas Review: Kuis SOP Menunggu Keputusan Anda',
          html: emailHtml,
        });
        sentCount++;
      } catch (emailErr) {
        console.error('Failed to send email to', spv.email, emailErr);
      }
    }

    res.json({ message: 'Email notification sent to supervisors', sent: sentCount });
  } catch (err) {
    console.error('notifySpvEmail error:', err);
    res.status(500).json({ error: 'Failed to notify supervisor via email' });
  }
}

module.exports = { sendPush, notifySpvEmail };
