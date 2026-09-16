export const config = { runtime: 'edge' };

const ALLOWED_CATEGORIES = [
  'filming_location',
  'rooftop_bar',
  'market',
  'church',
  'photo_spot',
  'food_wine',
  'local_favorite',
  'other'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sharedPassword = process.env.ADD_PLACE_PASSWORD;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Database not configured' }, 500);
  }

  const body = await req.json();
  const { password, city, country, category, name, description, localTip, address } = body;

  // Simple shared-password gate. Not meant to be sophisticated —
  // just enough friction to keep an unlisted form from being
  // writable by anyone who happens to find the URL.
  if (!sharedPassword || password !== sharedPassword) {
    return json({ error: 'Incorrect password' }, 401);
  }

  if (!city || !category || !name) {
    return json({ error: 'City, category, and name are required' }, 400);
  }

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return json({ error: 'Invalid category' }, 400);
  }

  // Service-role key bypasses RLS — required here since cities/places
  // have no public INSERT policy (only this password-gated endpoint
  // is allowed to write to them).
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Upsert the city — mirrors the old ON CONFLICT (name, country) logic.
    const cityRes = await fetch(
      `${SUPABASE_URL}/rest/v1/cities?on_conflict=name,country`,
      {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ name: city, country: country || 'Unknown' }),
      }
    );
    if (!cityRes.ok) throw new Error(await cityRes.text());
    const [cityRow] = await cityRes.json();

    const placeRes = await fetch(`${SUPABASE_URL}/rest/v1/places`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        city_id: cityRow.id,
        category,
        name,
        description: description || null,
        local_tip: localTip || null,
        address: address || null,
        source: 'pedro_janice_verified',
        verified: true,
      }),
    });
    if (!placeRes.ok) throw new Error(await placeRes.text());

    return json({ success: true });
  } catch (err) {
    console.error('Database write failed:', err);
    return json({ error: 'Failed to save place' }, 500);
  }
}
