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
    // Use Places API (New): Nearby Search via POST. More reliable than the legacy endpoint
    // and matches the "Places API (New)" the project has enabled.
    const nbUrl = 'https://places.googleapis.com/v1/places:searchNearby';
    const nbRes = await fetch(nbUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.currentOpeningHours.openNow,places.googleMapsUri'
      },
      body: JSON.stringify({
        includedTypes: ['veterinary_care'],
        maxResultCount: 5,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } }
      })
    });
    const nd = await nbRes.json();
    if (!nbRes.ok) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'places_' + nbRes.status, detail: (nd.error && nd.error.message) || '', vets: [] }) };
    }
    const results = nd.places || [];
    const vets = results.slice(0, 5).map((pl) => {
      const plLat = pl.location ? pl.location.latitude : null;
      const plLng = pl.location ? pl.location.longitude : null;
      const distance = (plLat != null) ? haversine(lat, lng, plLat, plLng) : null;
      return {
        name: (pl.displayName && pl.displayName.text) || 'Veterinary clinic',
        address: pl.formattedAddress || '',
        phone: pl.nationalPhoneNumber || pl.internationalPhoneNumber || null,
        website: pl.websiteUri || null,
        rating: pl.rating || null,
        open: (pl.currentOpeningHours && typeof pl.currentOpeningHours.openNow === 'boolean') ? pl.currentOpeningHours.openNow : null,
        distanceKm: distance != null ? Math.round(distance * 10) / 10 : null,
        mapsUrl: pl.googleMapsUri || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((pl.displayName && pl.displayName.text) || 'vet')),
        lat: plLat, lng: plLng
      };
    });
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
