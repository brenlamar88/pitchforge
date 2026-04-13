export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sender, target, offer, cta, tone } = req.body;

  // Validate required fields
  if (!sender || !target || !offer || !cta || !tone) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const toneMap = {
    professional: 'professional and polished, appropriate for senior B2B stakeholders',
    friendly:     'warm and conversational, like reaching out through a mutual connection',
    bold:         'bold, direct, and confident — zero fluff, straight to the value',
    concise:      'ultra-concise (under 75 words total body), every single word earns its place',
  };

  const toneDesc = toneMap[tone] || toneMap.professional;

  const prompt = `You are a world-class cold email copywriter. Write a cold outreach email:

Sender: ${sender}
Target: ${target}
Value proposition: ${offer}
Desired CTA: ${cta}
Tone: ${toneDesc}

Respond ONLY with valid JSON, no markdown fences, no preamble, nothing else:
{"subject":"subject line here","body":"email body here, use \\n for line breaks"}

Rules:
- Subject: under 8 words, intriguing but not clickbait, no emojis
- No "I hope this email finds you well" or any cliche openers
- Open with something specific and relevant inferred from their company or role
- Maximum 3 short paragraphs
- One clear CTA at the end, no alternatives offered
- Natural, human sign-off using the sender's first name`;

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
      return res.status(502).json({ error: err?.error?.message || 'Upstream API error.' });
    }

    const data    = await anthropicRes.json();
    const rawText = data.content?.find(b => b.type === 'text')?.text || '';
    const clean   = rawText.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(clean);

    return res.status(200).json({ subject: parsed.subject, body: parsed.body });

  } catch (e) {
    console.error('Generate error:', e);
    return res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
}
