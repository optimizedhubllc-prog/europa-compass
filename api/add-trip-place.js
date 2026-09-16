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

  const { code, name, city, icon, addedBy, lat, lng } = await req.json();
  if (!code || !name || !city) return json({ error: 'Code, name, and city are required' }, 400);

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const tripRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trips?code=eq.${encodeURIComponent(code)}&select=id`,
      { headers }
    );
    if (!tripRes.ok) throw new Error(await tripRes.text());
    const [trip] = await tripRes.json();
    if (!trip) return json({ error: 'Trip not found' }, 404);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/trip_places`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        trip_id: trip.id,
        name,
        city,
        icon: icon || '📍',
        added_by: addedBy || 'Me',
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
      }),
    });
    if (!res.ok) throw new Error(await res.text());

    return json({ success: true });
  } catch (err) {
    console.error('Add trip place failed:', err);
    return json({ error: 'Failed to add place' }, 500);
  }
}
