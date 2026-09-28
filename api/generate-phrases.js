// api/generate-phrases.js
// Europa Compass — Local Basics phrase generator.
// Calls Claude to produce a structured survival-phrase set for a given
// country/language. Same ANTHROPIC_API_KEY pattern as ask.js.
//
// Edge runtime is fine here (pure text generation, no binary payloads) —
// consistent with ask.js.

export const config = {
  runtime: 'edge',
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

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { country, language } = body || {};
  if (!country || !language) {
    return new Response(
      JSON.stringify({ error: 'Provide "country" and "language", e.g. {"country":"Portugal","language":"European Portuguese"}' }),
      { status: 400 }
    );
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
      return new Response(JSON.stringify({ error: 'Claude request failed', detail: errBody }), { status: claudeRes.status });
    }

    const data = await claudeRes.json();
    const rawText = data?.content?.find((b) => b.type === 'text')?.text || '';

    // Strip stray markdown fences in case the model adds them despite instructions.
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let phrases;
    try {
      phrases = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Could not parse Claude response as JSON', raw: rawText }),
        { status: 502 }
      );
    }

    return new Response(JSON.stringify({ country, language, phrases }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Phrase generation failed', detail: String(err) }), { status: 500 });
  }
}
