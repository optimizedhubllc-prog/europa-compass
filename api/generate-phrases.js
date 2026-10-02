// api/generate-phrases.js
// Europa Compass — Local Basics phrase generator.
// Calls Claude to produce a structured survival-phrase set for a given
// country/language. Same ANTHROPIC_API_KEY pattern as ask.js.
//
// RUNTIME NOTE: this must run on the Node.js runtime, NOT Edge. The Claude
// call takes ~20-30s, which exceeds the Edge function's execution limit and
// caused silent timeouts (HTTP 504, "Something went wrong generating phrases").
// ask.js uses Node + maxDuration 60 for the same reason.

export const config = {
  maxDuration: 60,
};

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const CATEGORIES = [
  'greetings',
  'politeness',
  'ordering food and drink',
  'directions and transport',
  'shopping and money',
  'emergencies and help',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  // Vercel's Node runtime auto-parses a JSON request body into req.body —
  // there is no req.json() here (that's an Edge-only API).
  const { country, language } = req.body || {};
  if (!country || !language) {
    res.status(400).json({
      error: 'Provide "country" and "language", e.g. {"country":"Portugal","language":"European Portuguese"}',
    });
    return;
  }

  const prompt = `Generate a survival phrase set for a traveler visiting ${country}, in ${language}.

Cover these categories: ${CATEGORIES.join(', ')}.
3-5 phrases per category. For each phrase, give:
- "phrase": the native-language text, natural and commonly used (not textbook-stiff)
- "translation": plain English meaning
- "phonetic": an English-reader-friendly phonetic spelling (not IPA — something a non-linguist can sound out)
- "category": one of the categories above

Respond with ONLY a JSON array of objects with those four keys. No preamble, no markdown fences, no commentary — just the JSON array.`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      res.status(claudeRes.status).json({ error: 'Claude request failed', detail: errBody });
      return;
    }

    const data = await claudeRes.json();
    const rawText = data?.content?.find((b) => b.type === 'text')?.text || '';

    // Strip stray markdown fences in case the model adds them despite instructions.
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let phrases;
    try {
      phrases = JSON.parse(cleaned);
    } catch {
      res.status(502).json({ error: 'Could not parse Claude response as JSON', raw: rawText });
      return;
    }

    res.status(200).json({ country, language, phrases });
  } catch (err) {
    res.status(500).json({ error: 'Phrase generation failed', detail: String(err) });
  }
}
