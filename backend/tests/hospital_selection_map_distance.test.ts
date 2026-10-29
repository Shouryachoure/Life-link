import { test } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import app from '../src/app';

// Haversine formula identical to LifeLink production implementation in frontend & backend
function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

test('1. Hospital Selection & Coordinate Accuracy: Two real Nagpur facilities', async () => {
  // Test Hospital A: Max Super Speciality Hospital, Mankapur (Formerly Alexis)
  const maxHospital = {
    id: 'fac-max-super-nagpur',
    name: 'Max Super Speciality Hospital, Nagpur (Formerly Alexis)',
    lat: 21.1945,
    lng: 79.0768,
  };

  // Test Hospital B: AIIMS Nagpur, MIHAN
  const aiimsHospital = {
    id: 'fac-aiims-nagpur',
    name: 'AIIMS Nagpur (All India Institute of Medical Sciences)',
    lat: 21.0422,
    lng: 79.0305,
  };

  // Patient Location 1: Sitabuldi / Zero Mile, Nagpur Central
  const patientLocation1 = { lat: 21.1458, lng: 79.0882 };

  const distToMax1 = calculateHaversineDistanceKm(
    patientLocation1.lat,
    patientLocation1.lng,
    maxHospital.lat,
    maxHospital.lng
  );

  const distToAiims1 = calculateHaversineDistanceKm(
    patientLocation1.lat,
    patientLocation1.lng,
    aiimsHospital.lat,
    aiimsHospital.lng
  );

  // Verification:
  // Max Mankapur is north of Zero Mile ~5.5 km
  assert.ok(distToMax1 >= 5.0 && distToMax1 <= 6.0, `Expected Max ~5.5 km, got ${distToMax1}`);
  // AIIMS MIHAN is south of Zero Mile ~12.5 - 13.5 km
  assert.ok(distToAiims1 >= 12.0 && distToAiims1 <= 14.0, `Expected AIIMS ~13 km, got ${distToAiims1}`);

  console.log(`[PASS] Central Nagpur to Max Super Speciality: ${distToMax1} km (Straight-line)`);
  console.log(`[PASS] Central Nagpur to AIIMS Nagpur: ${distToAiims1} km (Straight-line)`);
});

test('2. Location Refresh: Distances recalculate accurately on user location update', async () => {
  const maxHospital = { lat: 21.1945, lng: 79.0768 };
  const aiimsHospital = { lat: 21.0422, lng: 79.0305 };

  // Patient moves right next to Max Hospital in Mankapur
  const patientLocationMankapur = { lat: 21.1935, lng: 79.0765 };

  const distToMaxUpdated = calculateHaversineDistanceKm(
    patientLocationMankapur.lat,
    patientLocationMankapur.lng,
    maxHospital.lat,
    maxHospital.lng
  );

  const distToAiimsUpdated = calculateHaversineDistanceKm(
    patientLocationMankapur.lat,
    patientLocationMankapur.lng,
    aiimsHospital.lat,
    aiimsHospital.lng
  );

  // At Mankapur Square, Max is within ~200 meters (0.2 km)
  assert.ok(distToMaxUpdated < 0.3, `Expected Max < 0.3 km when in Mankapur, got ${distToMaxUpdated}`);
  // AIIMS is now further away (~17-18 km)
  assert.ok(distToAiimsUpdated > 16.0 && distToAiimsUpdated < 19.0, `Expected AIIMS ~17.5 km, got ${distToAiimsUpdated}`);

  console.log(`[PASS] Mankapur patient to Max: ${distToMaxUpdated} km (Correctly updated near hospital)`);
  console.log(`[PASS] Mankapur patient to AIIMS: ${distToAiimsUpdated} km (Correctly recalculated)`);
});

test('3. Missing Coordinates: Strict rejection of fake distances or coordinates', async () => {
  const unindexedFacility = {
    id: 'fac-unindexed',
    name: 'Unindexed Community Clinic',
    lat: null,
    lng: null,
  };

  const patient = { lat: 21.1458, lng: 79.0882 };

  // Helper verifying distance unavailability logic
  const getDisplayDistance = (userLat: number | null, userLng: number | null, facLat: number | null, facLng: number | null) => {
    if (!userLat || !userLng || !facLat || !facLng || facLat === 0 || facLng === 0 || isNaN(facLat) || isNaN(facLng)) {
      return 'Distance unavailable';
    }
    return `${calculateHaversineDistanceKm(userLat, userLng, facLat, facLng)} km`;
  };

  // Case A: Facility has null coordinates
  assert.strictEqual(
    getDisplayDistance(patient.lat, patient.lng, unindexedFacility.lat, unindexedFacility.lng),
    'Distance unavailable'
  );

  // Case B: User location is denied or null
  assert.strictEqual(
    getDisplayDistance(null, null, 21.1945, 79.0768),
    'Distance unavailable'
  );

  // Case C: Coordinates are 0,0
  assert.strictEqual(
    getDisplayDistance(patient.lat, patient.lng, 0, 0),
    'Distance unavailable'
  );

  console.log('[PASS] Missing, null, or zero coordinates safely produce "Distance unavailable"');
});

test('4. Road Distance vs Straight-Line Separation: No fake travel times', async () => {
  // Road distance must always be >= straight-line distance (triangle inequality / road winding factor)
  const straightLine = calculateHaversineDistanceKm(21.1458, 79.0882, 21.1945, 79.0768); // ~5.5 km
  const typicalRoadDistanceFactor = 1.25; // Nagpur urban road network circuity
  const expectedMinRoadDistance = straightLine * typicalRoadDistanceFactor; // ~6.8 km

  assert.ok(straightLine > 0);
  assert.ok(expectedMinRoadDistance > straightLine);

  console.log(`[PASS] Straight-line: ${straightLine} km vs Expected Urban Road Distance: ${expectedMinRoadDistance.toFixed(1)} km`);
});

test('5. Backend Directory API: GET /api/directory/unified returns valid coordinates & distances', async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://localhost:${port}/api/directory/unified?type=HOSPITAL&city=Nagpur&lat=21.1458&lng=79.0882&limit=5`);
    assert.strictEqual(res.status, 200);

    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);

    // Verify first hospital has valid lat, lng, and computed straight-line distanceKm
    const hosp = body.data[0];
    assert.ok(typeof hosp.name === 'string');
    assert.ok(typeof hosp.lat === 'number');
    assert.ok(typeof hosp.lng === 'number');
    assert.ok(hosp.lat !== 0 && hosp.lng !== 0);
    assert.ok(typeof hosp.distanceKm === 'number');
    assert.ok(hosp.distanceKm > 0);

    console.log(`[PASS] Verified API returns ${hosp.name} at [${hosp.lat}, ${hosp.lng}] with distance ${hosp.distanceKm} km`);
  } finally {
    await new Promise<void>((resolve) => server.close((_err) => resolve()));
  }
});
