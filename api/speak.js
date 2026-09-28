// api/speak.js
// Europa Compass — Text-to-Speech endpoint using Gemini's native TTS models.
//
// SETUP:
// 1. Get a Gemini API key at https://aistudio.google.com/apikey (separate from
//    your ANTHROPIC_API_KEY — this is a Google key).
// 2. Add it to Vercel as env var GOOGLE_API_KEY, then redeploy.
// 3. Confirm the exact TTS model ID in AI Studio before going live — Google
//    shipped new TTS models (Gemini 3.8 Flash TTS / Flash-Lite TTS) just days
//    before this was written, and the exact model string can shift. Set it as
//    GEMINI_TTS_MODEL below or via env var; don't hardcode blind.
//
// IMPORTANT: Use the Node.js runtime here, NOT Edge. Edge Functions have
// tighter response-size/duration limits and this returns full audio buffers.
// This is a deliberate split from api/ask.js, which uses Edge.

export const config = {
  runtime: 'nodejs',
};

const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
// ^ Confirmed-working model as of this writing. Swap to the new 3.8 Flash/Flash-Lite
//   TTS model ID once you've verified it in AI Studio — same request shape.

// Wrap raw PCM (24kHz, mono, 16-bit — what Gemini TTS returns) in a WAV header
// so browsers can play it directly via <audio src="..."> with no client-side decoding.
function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitDepth = 16) {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });
    return;
  }

  const { text, voice, languageCode } = req.body || {};
  if (!text || typeof text !== 'string' || text.length > 5000) {
    res.status(400).json({ error: 'Provide "text" (string, max 5000 chars)' });
    return;
  }

  // Prebuilt voice names — pick one persona per language/context and keep it
  // consistent so "Europa" has a recognizable voice. Full list in AI Studio.
  const voiceName = voice || 'Kore';

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              ...(languageCode ? { languageCode } : {}),
            },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      res.status(geminiRes.status).json({ error: 'Gemini TTS request failed', detail: errBody });
      return;
    }

    const data = await geminiRes.json();
    const base64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      res.status(502).json({ error: 'No audio returned', raw: data });
      return;
    }

    const pcmBuffer = Buffer.from(base64Audio, 'base64');
    const wavBuffer = pcmToWav(pcmBuffer);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // safe to cache — same text+voice = same audio
    res.status(200).send(wavBuffer);
  } catch (err) {
    res.status(500).json({ error: 'TTS generation failed', detail: String(err) });
  }
}
