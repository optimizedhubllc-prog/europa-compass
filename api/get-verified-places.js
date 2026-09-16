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

  const { city } = await req.json();
  if (!city) return json({ error: 'city is required' }, 400);

  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

  try {
    // Case-insensitive partial match on city name, with places embedded
    // via the foreign key (PostgREST nested select).
    const q = `${SUPABASE_URL}/rest/v1/cities?name=ilike.${encodeURIComponent('*' + city + '*')}&select=name,country,places(id,category,name,description,local_tip,address,lat,lng)`;
    const res = await fetch(q, { headers });
    if (!res.ok) throw new Error(await res.text());
    const cities = await res.json();

    const places = [];
    cities.forEach((c) => {
      (c.places || []).forEach((p) => {
        places.push({
          id: p.id,
          name: p.name,
          category: p.category,
          description: p.description,
          local_tip: p.local_tip,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          city: c.name,
          country: c.country,
        });
      });
    });

    return json(places);
  } catch (err) {
    console.error('Get verified places failed:', err);
    return json({ error: 'Failed to load verified places' }, 500);
  }
}
