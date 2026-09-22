// Social Import — TikTok link and/or screenshots → structured places.
// Node runtime (same as ask.js) for the 60s budget and image payloads.
export const config = { maxDuration: 60 };

const CATEGORIES = ['food', 'cafe', 'bar', 'attraction', 'park', 'shop', 'hotel', 'viewpoint', 'nightlife', 'other'];
const MAX_IMAGES = 5;
const MAX_IMAGE_B64 = 1_500_000; // client downscales to ~1400px JPEG, well under this

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Cheap abuse gate: only callers holding a real trip code can spend Claude credits.
async function tripExists(code) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Database not configured');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/trips?code=eq.${encodeURIComponent(code)}&select=id`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!r.ok) throw new Error('Trip lookup failed');
  const rows = await r.json();
  return rows.length > 0;
}

async function oembed(url) {
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': UA },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d && (d.title || d.thumbnail_url) ? d : null;
  } catch {
    return null;
  }
}

// Share-sheet links are short links (tiktok.com/t/…, vm.tiktok.com/…).
// If oEmbed rejects one, follow the redirect to the canonical /video/ URL and retry.
async function resolveShortLink(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
    const u = new URL(r.url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

async function readTikTok(url) {
  let d = await oembed(url);
  if (!d) {
    const canonical = await resolveShortLink(url);
    if (canonical && canonical !== url) d = await oembed(canonical);
  }
  return d;
}

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short title for this batch, e.g. "Barcelona food crawl"' },
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          city: { type: 'string' },
          country: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          note: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['name', 'city', 'category', 'note', 'confidence'],
      },
    },
  },
  required: ['title', 'places'],
};

function buildPrompt({ caption, author, imageCount }) {
  return `You extract real, visitable places from travel social media content for a trip-planning app.

${caption ? `Video caption${author ? ` (by @${author})` : ''}:\n"""${caption}"""` : 'No caption available.'}
${imageCount ? `\nThe ${imageCount} attached image(s) are screenshots or the cover frame of the video. Read on-screen text, captions, signs, menus, and map labels.` : ''}

Rules:
- Only include specific, named places someone could look up on a map: restaurants, cafes, bars, shops, hotels, landmarks, museums, parks, viewpoints, markets, neighborhoods.
- Never invent places. If a name is partly visible or ambiguous, include it only if you are fairly confident, and mark confidence "low".
- Infer city and country from context (caption, hashtags, visible text, landmarks). Use the common English city name (e.g. "Seville", not "Sevilla").
- note: one short line on what the creator recommends there (a dish, a tip, a vibe), grounded in the content. Empty string if nothing specific.
- Deduplicate. Keep the order they appear.
- If there are no identifiable places, return an empty list.`;
}

async function callClaude(content) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      tools: [{ name: 'return_places', description: 'Return the extracted places.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'return_places' },
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || 'Anthropic API error');
  const tool = data.content?.find((c) => c.type === 'tool_use');
  if (!tool) throw new Error('AI did not return places');
  return tool.input;
}

async function extract({ caption, author, thumbnailUrl, images }) {
  const imageBlocks = images.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }));
  const thumbBlock = thumbnailUrl ? [{ type: 'image', source: { type: 'url', url: thumbnailUrl } }] : [];

  const run = (blocks) =>
    callClaude([...blocks, { type: 'text', text: buildPrompt({ caption, author, imageCount: blocks.length }) }]);

  try {
    return await run([...imageBlocks, ...thumbBlock]);
  } catch (err) {
    // TikTok's CDN thumbnail URLs are signed and sometimes refuse fetches — retry without it.
    if (thumbBlock.length) return await run(imageBlocks);
    throw err;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'API key not configured' });
      return;
    }

    const { code, url = '', images = [] } = req.body || {};
    if (!code) {
      res.status(400).json({ error: 'Open a shared trip first.' });
      return;
    }
    if (!(await tripExists(code))) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const cleanImages = (Array.isArray(images) ? images : [])
      .filter((b) => typeof b === 'string' && b.length > 0 && b.length <= MAX_IMAGE_B64)
      .slice(0, MAX_IMAGES);

    let caption = '';
    let author = '';
    let thumbnailUrl = '';
    let source = 'screenshots';

    const trimmed = String(url).trim();
    if (trimmed) {
      let host = '';
      try {
        host = new URL(trimmed).hostname.toLowerCase();
      } catch {
        res.status(400).json({ error: "That doesn't look like a link. Paste the full TikTok share link." });
        return;
      }

      if (/(^|\.)instagram\.com$/.test(host)) {
        if (!cleanImages.length) {
          res.status(400).json({ error: "Instagram doesn't share post details. Add 2–3 screenshots of the reel instead." });
          return;
        }
      } else if (/(^|\.)tiktok\.com$/.test(host)) {
        const d = await readTikTok(trimmed);
        if (d) {
          caption = d.title || '';
          author = d.author_unique_id || d.author_name || '';
          thumbnailUrl = d.thumbnail_url || '';
          source = 'tiktok';
        } else if (!cleanImages.length) {
          res.status(422).json({ error: "TikTok didn't share this video's details. Add 2–3 screenshots of it instead." });
          return;
        }
      } else if (!cleanImages.length) {
        res.status(400).json({ error: 'Paste a TikTok link, or add screenshots.' });
        return;
      }
    }

    if (!caption && !thumbnailUrl && !cleanImages.length) {
      res.status(400).json({ error: 'Paste a TikTok link, or add screenshots.' });
      return;
    }

    const out = await extract({ caption, author, thumbnailUrl, images: cleanImages });
    const places = (out.places || [])
      .filter((p) => p && p.name)
      .map((p) => ({
        ...p,
        category: CATEGORIES.includes(p.category) ? p.category : 'other',
      }));

    res.status(200).json({ source, title: out.title || 'Imported spots', author, places });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Import failed' });
  }
}
