// The Nuci · Find nearby veterinarians
// Called from the frontend with the user's coordinates (after they grant location).
// The Google Places API key stays here on the server and is never exposed to the browser.
//
// Netlify env var required: GOOGLE_PLACES_API_KEY
//
// Request:  POST { lat: number, lng: number }
// Response: { vets: [ { name, address, phone, website, rating, open, distance, mapsUrl, lat, lng } ] }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const KEY = process.env.GOOGLE_PLACES_API_KEY;

  // Health check: GET ...find-vets?debug=1
  if (event.httpMethod === 'GET' && /[?&]debug=1/.test(event.rawUrl || event.path || '')) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: !!KEY, keyPresent: !!KEY, note: KEY ? 'Key is set.' : 'GOOGLE_PLACES_API_KEY missing in Netlify env.' }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!KEY) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'not_configured', vets: [] }) };

  let lat, lng;
  try { const b = JSON.parse(event.body || '{}'); lat = Number(b.lat); lng = Number(b.lng); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_json' }) }; }
  if (!isFinite(lat) || !isFinite(lng)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_coords' }) };

  try {
    // 1) Nearby search for veterinary care around the user
    const nearbyUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
      + `?location=${lat},${lng}&rankby=distance&type=veterinary_care&key=${KEY}`;
    const nr = await fetch(nearbyUrl);
    const nd = await nr.json();
    if (nd.status !== 'OK' && nd.status !== 'ZERO_RESULTS') {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'places_' + nd.status, detail: nd.error_message || '', vets: [] }) };
    }
    const top = (nd.results || []).slice(0, 5);

    // 2) For each, fetch details (phone, website, opening hours)
    const vets = [];
    for (const pl of top) {
      let phone = null, website = null, open = null;
      try {
        const detUrl = 'https://maps.googleapis.com/maps/api/place/details/json'
          + `?place_id=${pl.place_id}&fields=formatted_phone_number,website,opening_hours&key=${KEY}`;
        const dr = await fetch(detUrl);
        const dd = await dr.json();
        if (dd.result) {
          phone = dd.result.formatted_phone_number || null;
          website = dd.result.website || null;
          if (dd.result.opening_hours && typeof dd.result.opening_hours.open_now === 'boolean') {
            open = dd.result.opening_hours.open_now;
          }
        }
      } catch (e) { /* details are best-effort */ }

      const plLat = pl.geometry && pl.geometry.location ? pl.geometry.location.lat : null;
      const plLng = pl.geometry && pl.geometry.location ? pl.geometry.location.lng : null;
      const distance = (plLat != null) ? haversine(lat, lng, plLat, plLng) : null;

      vets.push({
        name: pl.name || 'Veterinary clinic',
        address: pl.vicinity || pl.formatted_address || '',
        phone, website,
        rating: pl.rating || null,
        open,
        distanceKm: distance != null ? Math.round(distance * 10) / 10 : null,
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(pl.name || 'vet') + '&query_place_id=' + pl.place_id,
        lat: plLat, lng: plLng
      });
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ vets }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'exception', detail: String(e && e.message || e), vets: [] }) };
  }
};

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
