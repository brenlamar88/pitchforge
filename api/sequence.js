import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Session expired.' });

  const { data: profile } = await supabase
    .from('pf_profiles').select('plan').eq('id', user.id).single();

  if (!profile) return res.status(500).json({ error: 'Could not load profile.' });

  if (profile.plan === 'free') {
    return res.status(403).json({
      error: 'pro_required',
      message: 'Follow-up sequences are a Pro feature. Upgrade to generate full sequences.',
    });
  }

  const { sender, target, offer, cta, tone, originalSubject, originalBody, emailId } = req.body;
  if (!sender || !target || !offer || !cta || !originalSubject || !originalBody) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const toneMap = {
    professional: 'professional and polished',
    friendly:     'warm and conversational',
    bold:         'bold and direct',
    concise:      'ultra-concise, every word counts',
  };

  const prompt = `You are a world-class cold email copywriter. A prospect was sent the following cold email and has not replied. Write a 3-email follow-up sequence to send over the next two weeks.

ORIGINAL EMAIL SENT:
Subject: ${originalSubject}
Body: ${originalBody}

Context:
Sender: ${sender}
Target: ${target}
Offer: ${offer}
Desired outcome: ${cta}
Tone: ${toneMap[tone] || toneMap.professional}

Write 3 follow-up emails. Each must:
- Reference the previous email without being desperate or pushy
- Offer a fresh angle, new piece of value, or different framing each time
- Be shorter than the original (30-60 words max each)
- Feel human, not automated
- Have a different subject line each time (use RE: sparingly — only on email 1)

Timing:
- Follow-up 1: Day 3 after original (gentle nudge, new angle)
- Follow-up 2: Day 7 after original (provide value — a tip, insight, or relevant stat)
- Follow-up 3: Day 14 after original (the breakup email — give them an easy out)

Respond ONLY with valid JSON, no markdown, no preamble:
{
  "followup1": { "subject": "...", "body": "..." },
  "followup2": { "subject": "...", "body": "..." },
  "followup3": { "subject": "...", "body": "..." }
}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || 'AI generation failed.' });
    }

    const aiData  = await anthropicRes.json();
    const rawText = aiData.content?.find(b => b.type === 'text')?.text || '';
    const parsed  = JSON.parse(rawText.replace(/```json|```/g, '').trim());

    const { error: insertError } = await supabase.from('pf_sequences').insert({
      user_id:             user.id,
      original_email_id:   emailId || null,
      sender, target, offer, cta,
      tone:                tone || 'professional',
      followup_1_subject:  parsed.followup1.subject,
      followup_1_body:     parsed.followup1.body,
      followup_1_day:      3,
      followup_2_subject:  parsed.followup2.subject,
      followup_2_body:     parsed.followup2.body,
      followup_2_day:      7,
      followup_3_subject:  parsed.followup3.subject,
      followup_3_body:     parsed.followup3.body,
      followup_3_day:      14,
    });

    if (insertError) console.error('Sequence save error:', insertError);

    return res.status(200).json({
      followup1: { subject: parsed.followup1.subject, body: parsed.followup1.body, day: 3 },
      followup2: { subject: parsed.followup2.subject, body: parsed.followup2.body, day: 7 },
      followup3: { subject: parsed.followup3.subject, body: parsed.followup3.body, day: 14 },
    });

  } catch (e) {
    console.error('Sequence error:', e);
    return res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
}
