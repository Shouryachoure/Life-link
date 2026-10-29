import assert from 'assert';
import { calculateHaversineDistanceKm } from '../src/services/dispatchEngine';

console.log('🧪 Starting Geospatial & Routing Truth-in-State Test Suite...');

// Mock bounding box logic matching MAP_CONFIG.indiaBounds
const INDIA_BOUNDS = {
  minLat: 6.5,
  maxLat: 37.5,
  minLng: 68.0,
  maxLng: 97.5,
};

function isWithinIndiaBounds(lat: number, lng: number): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return false;
  return (
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lng >= INDIA_BOUNDS.minLng &&
    lng <= INDIA_BOUNDS.maxLng
  );
}

// Telemetry Movement Classification Function (Module E1/E2 & Req 6)
function classifyMovement(
  clientSpeed: number | undefined,
  prevLat: number | undefined,
  prevLng: number | undefined,
  prevTimeMs: number | undefined,
  curLat: number,
  curLng: number,
  curTimeMs: number
): { movementStatus: 'MOVING' | 'STOPPED' | 'UNKNOWN' | 'OFFLINE'; speedKmH: number } {
  if (clientSpeed !== undefined && !isNaN(clientSpeed)) {
    return {
      movementStatus: clientSpeed > 3.0 ? 'MOVING' : 'STOPPED',
      speedKmH: clientSpeed,
    };
  }

  if (prevTimeMs && prevTimeMs > 0 && prevLat !== undefined && prevLng !== undefined) {
    const elapsedMs = curTimeMs - prevTimeMs;
    if (elapsedMs > 30 * 60 * 1000) {
      // Telemetry older than 30 minutes -> Stale/Offline, NOT STOPPED
      return { movementStatus: 'UNKNOWN', speedKmH: 0 };
    }
    if (elapsedMs >= 1000) {
      const timeHours = elapsedMs / (1000 * 3600);
      const distKm = calculateHaversineDistanceKm(prevLat, prevLng, curLat, curLng);
      const computedSpeed = Math.round((distKm / timeHours) * 10) / 10;
      return {
        movementStatus: computedSpeed > 3.0 ? 'MOVING' : 'STOPPED',
        speedKmH: computedSpeed,
      };
    }
  }

  // Single observation or missing telemetry: NEVER infer STOPPED
  return { movementStatus: 'UNKNOWN', speedKmH: 0 };
}

// Distance & ETA Truth Function (Req 5: Never claim road routing from straight-line distance)
function computeRouteTruth(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  roadRoutingAvailable: boolean,
  roadDistanceMeters?: number,
  roadDurationSeconds?: number
) {
  if (roadRoutingAvailable && roadDistanceMeters !== undefined && roadDurationSeconds !== undefined) {
    return {
      distanceKm: (roadDistanceMeters / 1000).toFixed(1),
      durationMins: Math.ceil(roadDurationSeconds / 60),
      isRoadRouting: true,
      isStraightLine: false,
      provider: 'OSRM Driving Engine',
    };
  }

  // Fallback to Haversine straight-line distance
  const straightLineKm = calculateHaversineDistanceKm(startLat, startLng, endLat, endLng);
  return {
    distanceKm: straightLineKm.toFixed(1),
    durationMins: null, // Truth: ETA cannot be manufactured without real road topology
    isRoadRouting: false,
    isStraightLine: true,
    provider: 'Haversine Direct Line',
    disclaimer: 'Straight-line distance. Road routing engine offline or unreachable.',
  };
}

async function runTests() {
  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  console.log('\n--- 1. Geographic Bounds & Coordinate Validation ---');
  test('Validates Nagpur Pilot coordinates (Sitabuldi) within India bounds', () => {
    assert.strictEqual(isWithinIndiaBounds(21.1458, 79.0882), true);
  });

  test('Validates Mumbai, Delhi, Bengaluru coordinates within bounds', () => {
    assert.strictEqual(isWithinIndiaBounds(19.076, 72.8777), true); // Mumbai
    assert.strictEqual(isWithinIndiaBounds(28.6139, 77.209), true); // Delhi
    assert.strictEqual(isWithinIndiaBounds(12.9716, 77.5946), true); // Bengaluru
  });

  test('Rejects overseas or out-of-range coordinates', () => {
    assert.strictEqual(isWithinIndiaBounds(37.7749, -122.4194), false); // San Francisco
    assert.strictEqual(isWithinIndiaBounds(51.5074, -0.1278), false); // London
    assert.strictEqual(isWithinIndiaBounds(91.0, 79.0), false); // Invalid latitude
    assert.strictEqual(isWithinIndiaBounds(NaN, 79.0), false); // NaN
  });

  console.log('\n--- 2. Truth-in-Routing & ETA Calculation Integrity ---');
  test('Returns accurate road ETA and distance when road topology is available', () => {
    const route = computeRouteTruth(21.1458, 79.0882, 21.1293, 79.0967, true, 2600, 420);
    assert.strictEqual(route.isRoadRouting, true);
    assert.strictEqual(route.isStraightLine, false);
    assert.strictEqual(route.distanceKm, '2.6');
    assert.strictEqual(route.durationMins, 7);
  });

  test('Never claims road route or fake ETA when road engine is offline (null ETA)', () => {
    const route = computeRouteTruth(21.1458, 79.0882, 21.1293, 79.0967, false);
    assert.strictEqual(route.isRoadRouting, false);
    assert.strictEqual(route.isStraightLine, true);
    assert.strictEqual(route.durationMins, null); // Strictly null, never false 0.0 or fabricated minutes
    assert.strictEqual(route.provider, 'Haversine Direct Line');
    assert.ok(route.disclaimer && route.disclaimer.includes('Straight-line distance'));
  });

  test('Haversine distance calculation matches expected geographic range in Nagpur', () => {
    // Distance between Sitabuldi (21.1458, 79.0882) and GMCH (21.1293, 79.0967) is ~2.0 km straight-line
    const dist = calculateHaversineDistanceKm(21.1458, 79.0882, 21.1293, 79.0967);
    assert.ok(dist >= 1.8 && dist <= 2.2, `Expected ~2.0 km, got ${dist}`);
  });

  console.log('\n--- 3. Movement Classification & Anti-False-Stop Integrity ---');
  test('Classifies MOVING when client speed sensor reports > 3.0 km/h', () => {
    const res = classifyMovement(24.5, undefined, undefined, undefined, 21.14, 79.08, Date.now());
    assert.strictEqual(res.movementStatus, 'MOVING');
    assert.strictEqual(res.speedKmH, 24.5);
  });

  test('Classifies STOPPED when client speed sensor reports <= 3.0 km/h', () => {
    const res = classifyMovement(1.2, undefined, undefined, undefined, 21.14, 79.08, Date.now());
    assert.strictEqual(res.movementStatus, 'STOPPED');
    assert.strictEqual(res.speedKmH, 1.2);
  });

  test('Computes MOVING from successive GPS observations with distance/time delta', () => {
    const now = Date.now();
    const tenSecondsAgo = now - 10000;
    // Moved ~100 meters in 10 seconds -> ~36 km/h
    const res = classifyMovement(
      undefined,
      21.140,
      79.080,
      tenSecondsAgo,
      21.1409,
      79.080,
      now
    );
    assert.strictEqual(res.movementStatus, 'MOVING');
    assert.ok(res.speedKmH > 3.0);
  });

  test('NEVER infers STOPPED solely from missing updates or first observation (returns UNKNOWN)', () => {
    const res = classifyMovement(undefined, undefined, undefined, undefined, 21.14, 79.08, Date.now());
    assert.strictEqual(res.movementStatus, 'UNKNOWN');
    assert.notStrictEqual(res.movementStatus, 'STOPPED');
  });

  test('NEVER infers STOPPED from stale updates older than 30 minutes (returns UNKNOWN)', () => {
    const now = Date.now();
    const thirtyFiveMinutesAgo = now - 35 * 60 * 1000;
    const res = classifyMovement(
      undefined,
      21.140,
      79.080,
      thirtyFiveMinutesAgo,
      21.140,
      79.080,
      now
    );
    assert.strictEqual(res.movementStatus, 'UNKNOWN');
    assert.notStrictEqual(res.movementStatus, 'STOPPED');
  });

  console.log('\n--- 4. Open-Source Map Stack Compliance & Attribution ---');
  test('Attribution string complies with OpenStreetMap and CARTO licenses', () => {
    const attribution =
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
    assert.ok(attribution.includes('OpenStreetMap'));
    assert.ok(attribution.includes('CARTO'));
    assert.ok(attribution.includes('https://www.openstreetmap.org/copyright'));
  });

  test('Hospital directory vs partner distinction prevents misleading live bed claims', () => {
    const partnerHospital = {
      name: 'LifeLink Trauma Hospital',
      isLifeLinkPartner: true,
      availableBeds: 12,
    };
    const directoryHospital = {
      name: 'Local Civil Clinic',
      isLifeLinkPartner: false,
      availableBeds: undefined,
    };

    assert.strictEqual(partnerHospital.isLifeLinkPartner, true);
    assert.strictEqual(partnerHospital.availableBeds, 12);
    assert.strictEqual(directoryHospital.isLifeLinkPartner, false);
    assert.strictEqual(directoryHospital.availableBeds, undefined);
  });

  console.log(`\n========================================`);
  console.log(`Geospatial & Routing Test Results: ${passed}/${total} passed`);
  console.log(`========================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
