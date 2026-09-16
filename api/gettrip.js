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

  const { code } = await req.json();
  if (!code) return json({ error: 'Trip code is required' }, 400);

  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

  try {
    const tripRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trips?code=eq.${encodeURIComponent(code)}&select=*`,
      { headers }
    );
    if (!tripRes.ok) throw new Error(await tripRes.text());
    const [trip] = await tripRes.json();
    if (!trip) return json({ error: 'Trip not found' }, 404);

    const placesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trip_places?trip_id=eq.${trip.id}&select=*&order=created_at.asc`,
      { headers }
    );
    if (!placesRes.ok) throw new Error(await placesRes.text());
    const places = await placesRes.json();

    return json({ code: trip.code, name: trip.name, places });
  } catch (err) {
    console.error('Get trip failed:', err);
    return json({ error: 'Failed to load trip' }, 500);
  }
}
