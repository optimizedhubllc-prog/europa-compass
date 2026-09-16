export const config = { runtime: 'edge' };

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
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !ANON_KEY) return json({ error: 'Database not configured' }, 500);

  const { name } = await req.json();
  if (!name) return json({ error: 'Trip name is required' }, 400);

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ code, name }),
    });
    if (!res.ok) throw new Error(await res.text());
    const [trip] = await res.json();
    return json({ code: trip.code, name: trip.name });
  } catch (err) {
    console.error('Create trip failed:', err);
    return json({ error: 'Failed to create trip' }, 500);
  }
}
