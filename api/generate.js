import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FREE_LIMIT = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ─────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated. Please log in.' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Session expired. Please log in again.' });

  // ── Load profile ─────────────────────────────────────────────
  const { data: profile, error: profileError } = await supabase
    .from('pf_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return res.status(500).json({ error: 'Could not load user profile.' });

  // ── Usage check ───────────────────────────────────────────────
  if (profile.plan === 'free' && profile.emails_used_this_month >= FREE_LIMIT) {
    return res.status(403).json({
      error: 'free_limit_reached',
      message: `You've used all ${FREE_LIMIT} free emails this month. Upgrade to Pro for unlimited access.`,
      used: profile.emails_used_this_month,
      limit: FREE_LIMIT,
    });
  }

  // ── Validate fields ───────────────────────────────────────────
  const { sender, target, offer, cta, tone } = req.body;
  if (!sender || !target || !offer || !cta || !tone) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const toneMap = {
    professional: 'professional and polished, appropriate for senior B2B stakeholders',
    friendly:     'warm and conversational, like reaching out through a mutual connection',
    bold:         'bold, direct, and confident — zero fluff, straight to the value',
    concise:      'ultra-concise (under 75 words total body), every single word earns its place',
  };

  const prompt = `You are a world-class cold email copywriter. Write a cold outreach email:

Sender: ${sender}
Target: ${target}
Value proposition: ${offer}
Desired CTA: ${cta}
Tone: ${toneMap[tone] || toneMap.professional}

Respond ONLY with valid JSON, no markdown, no preamble:
{"subject":"subject line here","body":"email body, use \\n for line breaks"}

Rules: subject under 8 words, no cliche openers, open with something specific inferred from their company/role, max 3 short paragraphs, one clear CTA, natural sign-off using sender's first name.`;

  // ── Call Anthropic ────────────────────────────────────────────
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:    'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || 'AI generation failed.' });
    }

    const aiData  = await anthropicRes.json();
    const rawText = aiData.content?.find(b => b.type === 'text')?.text || '';
    const parsed  = JSON.parse(rawText.replace(/```json|```/g, '').trim());

    // ── Save to history ───────────────────────────────────────────
    const { error: insertError } = await supabase.from('pf_emails').insert({
      user_id: user.id,
      sender, target, offer, cta, tone,
      subject: parsed.subject,
      body:    parsed.body,
    });
    if (insertError) console.error('History save error:', insertError);

    // ── Increment usage (free users only) ─────────────────────────
    if (profile.plan === 'free') {
      await supabase
        .from('pf_profiles')
        .update({ emails_used_this_month: profile.emails_used_this_month + 1, updated_at: new Date().toISOString() })
        .eq('id', user.id);
    }

    return res.status(200).json({
      subject: parsed.subject,
      body:    parsed.body,
      usage: {
        plan:  profile.plan,
        used:  profile.plan === 'free' ? profile.emails_used_this_month + 1 : null,
        limit: profile.plan === 'free' ? FREE_LIMIT : null,
      },
    });

  } catch (e) {
    console.error('Generate error:', e);
    return res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
}
