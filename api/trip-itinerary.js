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

// Actions: 'add_day' | 'remove_day' | 'assign_item' | 'unassign_item'
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !ANON_KEY) return json({ error: 'Database not configured' }, 500);

  const { action, code, label, dayId, tripPlaceId } = await req.json();
  if (!action || !code) return json({ error: 'action and code are required' }, 400);

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Every action needs the trip's internal id first.
    const tripRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trips?code=eq.${encodeURIComponent(code)}&select=id`,
      { headers }
    );
    if (!tripRes.ok) throw new Error(await tripRes.text());
    const [trip] = await tripRes.json();
    if (!trip) return json({ error: 'Trip not found' }, 404);

    if (action === 'add_day') {
      if (!label) return json({ error: 'label is required' }, 400);
      const countRes = await fetch(
        `${SUPABASE_URL}/rest/v1/trip_days?trip_id=eq.${trip.id}&select=id`,
        { headers }
      );
      const existing = countRes.ok ? await countRes.json() : [];
      const res = await fetch(`${SUPABASE_URL}/rest/v1/trip_days`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ trip_id: trip.id, label, sort_order: existing.length }),
      });
      if (!res.ok) throw new Error(await res.text());
      const [day] = await res.json();
      return json({ success: true, day });
    }

    if (action === 'remove_day') {
      if (!dayId) return json({ error: 'dayId is required' }, 400);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/trip_days?id=eq.${dayId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error(await res.text());
      return json({ success: true });
    }

    if (action === 'assign_item') {
      if (!dayId || !tripPlaceId) return json({ error: 'dayId and tripPlaceId are required' }, 400);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/trip_day_items`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ trip_day_id: dayId, trip_place_id: tripPlaceId }),
      });
      if (!res.ok) throw new Error(await res.text());
      return json({ success: true });
    }

    if (action === 'unassign_item') {
      if (!dayId || !tripPlaceId) return json({ error: 'dayId and tripPlaceId are required' }, 400);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/trip_day_items?trip_day_id=eq.${dayId}&trip_place_id=eq.${tripPlaceId}`,
        { method: 'DELETE', headers }
      );
      if (!res.ok) throw new Error(await res.text());
      return json({ success: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('Trip itinerary action failed:', err);
    return json({ error: 'Itinerary update failed' }, 500);
  }
}
