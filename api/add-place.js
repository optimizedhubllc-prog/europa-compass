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

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const dbUrl = process.env.DATABASE_URL;
  const sharedPassword = process.env.ADD_PLACE_PASSWORD;

  if (!dbUrl) {
    return new Response(JSON.stringify({ error: 'Database not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const body = await req.json();
  const { password, city, country, category, name, description, localTip, address } = body;

  // Simple shared-password gate. Not meant to be sophisticated —
  // just enough friction to keep an unlisted form from being
  // writable by anyone who happens to find the URL.
  if (!sharedPassword || password !== sharedPassword) {
    return new Response(JSON.stringify({ error: 'Incorrect password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  if (!city || !category || !name) {
    return new Response(JSON.stringify({ error: 'City, category, and name are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return new Response(JSON.stringify({ error: 'Invalid category' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(dbUrl);

    // Find or create the city. ON CONFLICT handles the case where
    // the city already exists (matches the UNIQUE(name, country)
    // constraint from the schema) without erroring.
    const cityRows = await sql`
      INSERT INTO cities (name, country)
      VALUES (${city}, ${country || 'Unknown'})
      ON CONFLICT (name, country) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    const cityId = cityRows[0].id;

    await sql`
      INSERT INTO places (city_id, category, name, description, local_tip, address, source, verified)
      VALUES (${cityId}, ${category}, ${name}, ${description || null}, ${localTip || null}, ${address || null}, 'pedro_janice_verified', true)
    `;

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    console.error('Database write failed:', err);
    return new Response(JSON.stringify({ error: 'Failed to save place' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
