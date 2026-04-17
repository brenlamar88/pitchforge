import { createClient } from '@supabase/supabase-js';

// This endpoint is read-only and returns only aggregated summary data.
// No user PII is exposed. No secret keys are required by the caller.
// Protected by a simple API token stored as an env variable.

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OPENCLAW_TOKEN = process.env.OPENCLAW_WEBHOOK_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Simple token auth — OpenClaw sends this in the header
  const token = req.headers['x-openclaw-token'];
  if (!OPENCLAW_TOKEN || token !== OPENCLAW_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const yesterday  = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // New signups in last 24h (count only, no emails)
    const { count: newSignups } = await supabase
      .from('pf_profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yesterday);

    // Total users
    const { count: totalUsers } = await supabase
      .from('pf_profiles')
      .select('*', { count: 'exact', head: true });

    // Paid users
    const { count: paidUsers } = await supabase
      .from('pf_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('plan', 'pro');

    // Free users at limit
    const { count: atLimit } = await supabase
      .from('pf_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('plan', 'free')
      .gte('emails_used_this_month', 5);

    // Emails generated today
    const { count: emailsToday } = await supabase
      .from('pf_emails')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yesterday);

    // Emails this month
    const { count: emailsMonth } = await supabase
      .from('pf_emails')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthStart);

    // Total emails all time
    const { count: emailsTotal } = await supabase
      .from('pf_emails')
      .select('*', { count: 'exact', head: true });

    // Sequences generated today
    const { count: seqToday } = await supabase
      .from('pf_sequences')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yesterday);

    // Average email score today
    const { data: scoreData } = await supabase
      .from('pf_emails')
      .select('score')
      .gte('created_at', yesterday)
      .not('score', 'is', null);

    const avgScore = scoreData?.length
      ? Math.round(scoreData.reduce((sum, e) => sum + e.score, 0) / scoreData.length)
      : null;

    const mrr = (paidUsers ?? 0) * 19;

    return res.status(200).json({
      timestamp:    now.toISOString(),
      summary: {
        mrr_usd:          mrr,
        total_users:      totalUsers ?? 0,
        paid_users:       paidUsers  ?? 0,
        free_at_limit:    atLimit    ?? 0,
        new_signups_24h:  newSignups ?? 0,
        emails_today:     emailsToday ?? 0,
        emails_this_month: emailsMonth ?? 0,
        emails_all_time:  emailsTotal ?? 0,
        sequences_today:  seqToday   ?? 0,
        avg_score_today:  avgScore,
      },
      alerts: {
        has_new_signups:    (newSignups ?? 0) > 0,
        users_near_upgrade: (atLimit ?? 0) > 0,
        mrr_updated:        mrr > 0,
      },
      meta: {
        product: 'PitchForge',
        url:     'https://pitchforge.co',
        version: '1.0',
      }
    });

  } catch (e) {
    console.error('Status endpoint error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
