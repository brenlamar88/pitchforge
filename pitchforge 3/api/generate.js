import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FREE_LIMIT = 5;

function scoreEmail(subject, body) {
  const scores = {};
  let total = 0;

  const wordCount = body.trim().split(/\s+/).length;
  if (wordCount >= 50 && wordCount <= 100)       scores.length = { pts: 20, label: 'Perfect length', wordCount };
  else if (wordCount > 100 && wordCount <= 125)  scores.length = { pts: 16, label: 'Slightly long', wordCount };
  else if (wordCount > 125 && wordCount <= 175)  scores.length = { pts: 10, label: 'Too long — cut it down', wordCount };
  else if (wordCount < 50 && wordCount >= 30)    scores.length = { pts: 14, label: 'A bit short', wordCount };
  else if (wordCount > 175)                      scores.length = { pts: 4,  label: 'Way too long — readers will bounce', wordCount };
  else                                           scores.length = { pts: 8,  label: 'Too short', wordCount };
  total += scores.length.pts;

  const subjectWords = subject.trim().split(/\s+/).length;
  const subjectSpamWords = ['free','guaranteed','urgent','act now','limited time','winner','congratulations','click here','!!!','$$$'];
  const hasSubjectSpam = subjectSpamWords.some(w => subject.toLowerCase().includes(w));
  if (hasSubjectSpam)                            scores.subject = { pts: 4,  label: 'Spam trigger words in subject line' };
  else if (subjectWords <= 6)                    scores.subject = { pts: 20, label: 'Great subject length', subjectWords };
  else if (subjectWords <= 8)                    scores.subject = { pts: 16, label: 'Good subject length', subjectWords };
  else if (subjectWords <= 10)                   scores.subject = { pts: 10, label: 'Subject a bit long', subjectWords };
  else                                           scores.subject = { pts: 4,  label: 'Subject too long', subjectWords };
  total += scores.subject.pts;

  const cliches = ['i hope this email finds you','i hope this finds you','hope you are doing well','hope you\'re doing well','i am reaching out','i am writing to','my name is','allow me to introduce','i wanted to reach out','touch base','circle back','synergy'];
  const hasCliche = cliches.some(c => body.toLowerCase().includes(c));
  if (!hasCliche) scores.opener = { pts: 20, label: 'Strong, cliche-free opener' };
  else            scores.opener = { pts: 6,  label: 'Cliche opener — readers tune these out' };
  total += scores.opener.pts;

  const questionCount = (body.match(/\?/g) || []).length;
  if (questionCount === 1)      scores.questions = { pts: 15, label: 'Perfect — one clear question', questionCount };
  else if (questionCount === 0) scores.questions = { pts: 10, label: 'No question — add a single CTA question', questionCount };
  else if (questionCount === 2) scores.questions = { pts: 8,  label: 'Two questions — pick one', questionCount };
  else                          scores.questions = { pts: 3,  label: 'Too many questions — pick one', questionCount };
  total += scores.questions.pts;

  const personalizationSignals = [/your (team|company|product|platform|tool|app|service|work|business|role)/i,/you (recently|just|are|have|were)/i,/i noticed/i,/i saw/i,/i read/i,/congrats on/i,/love what you/i];
  const personalizationHits = personalizationSignals.filter(r => r.test(body)).length;
  if (personalizationHits >= 2)      scores.personalization = { pts: 15, label: 'Well personalized' };
  else if (personalizationHits === 1) scores.personalization = { pts: 10, label: 'Some personalization — could go deeper' };
  else                                scores.personalization = { pts: 4,  label: 'Feels generic — add a specific detail' };
  total += scores.personalization.pts;

  const bodySpamWords = ['free','guaranteed','no obligation','risk-free','act now','limited time','click here','buy now','order now','urgent','winner','100%','amazing','incredible','revolutionary','game-changer','game changer','disruptive','best in class'];
  const spamHits = bodySpamWords.filter(w => body.toLowerCase().includes(w));
  if (spamHits.length === 0)      scores.spam = { pts: 10, label: 'Clean — no spam trigger words' };
  else if (spamHits.length === 1) scores.spam = { pts: 6,  label: `Spam word detected: "${spamHits[0]}"`, words: spamHits };
  else                            scores.spam = { pts: 2,  label: `${spamHits.length} spam trigger words detected`, words: spamHits };
  total += scores.spam.pts;

  let grade;
  if (total >= 88)      grade = 'A';
  else if (total >= 75) grade = 'B';
  else if (total >= 60) grade = 'C';
  else if (total >= 45) grade = 'D';
  else                  grade = 'F';

  return { score: total, grade, breakdown: scores };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Session expired. Please log in again.' });

  const { data: profile, error: profileError } = await supabase
    .from('pf_profiles').select('*').eq('id', user.id).single();
  if (profileError || !profile) return res.status(500).json({ error: 'Could not load user profile.' });

  if (profile.plan === 'free' && profile.emails_used_this_month >= FREE_LIMIT) {
    return res.status(403).json({
      error: 'free_limit_reached',
      message: `You've used all ${FREE_LIMIT} free emails this month.`,
      used: profile.emails_used_this_month,
      limit: FREE_LIMIT,
    });
  }

  const { sender, target, offer, cta, tone } = req.body;
  if (!sender || !target || !offer || !cta || !tone) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const toneMap = {
    professional: 'professional and polished, appropriate for senior B2B stakeholders. 60-100 words.',
    friendly:     'warm and conversational, like reaching out through a mutual connection. 60-90 words.',
    bold:         'bold, direct, and confident — zero fluff, straight to the value. 50-80 words.',
    concise:      'ultra-concise and punchy. MUST be 50-75 words total. Every single word earns its place. Short punchy sentences. No filler. Maximum impact minimum words. Think tweet-length paragraphs.',
  };

  const prompt = `You are a world-class cold email copywriter. Write a cold outreach email:

Sender: ${sender}
Target: ${target}
Value proposition: ${offer}
Desired CTA: ${cta}
Tone: ${toneMap[tone] || toneMap.professional}

Respond ONLY with valid JSON, no markdown, no preamble:
{"subject":"subject line here","body":"email body, use \\n for line breaks"}

Rules:
- Subject: under 6 words, specific not clever, no emojis, no spam words
- No cliche openers whatsoever (no "hope this finds you", "I am reaching out", "my name is", etc.)
- Open line must reference something specific about the target company or role
- Maximum 3 short paragraphs
- Exactly one question as your CTA — make it easy to say yes to
- Natural first-name sign-off
- For concise tone: ruthlessly cut every unnecessary word. If a sentence can be shorter, make it shorter.`;

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
        max_tokens: 1000,
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

    const { score, grade, breakdown } = scoreEmail(parsed.subject, parsed.body);

    const { data: savedEmail, error: insertError } = await supabase
      .from('pf_emails')
      .insert({
        user_id: user.id,
        sender, target, offer, cta, tone,
        subject: parsed.subject,
        body:    parsed.body,
        score,
        score_breakdown: breakdown,
      })
      .select('id')
      .single();

    if (insertError) console.error('History save error:', insertError);

    if (profile.plan === 'free') {
      await supabase
        .from('pf_profiles')
        .update({ emails_used_this_month: profile.emails_used_this_month + 1, updated_at: new Date().toISOString() })
        .eq('id', user.id);
    }

    return res.status(200).json({
      subject: parsed.subject,
      body:    parsed.body,
      emailId: savedEmail?.id || null,
      score,
      grade,
      breakdown,
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
