import assert from 'assert';
import {
  runAmbulanceImport,
  normalizeIndianPhoneNumber,
  validateNagpurCoordinates,
  normalizeAmbulanceRecord,
  RawAmbulanceRecord,
} from '../src/scripts/importAmbulanceProviders';
import prisma from '../src/db';

async function runTestSuite() {
  console.log('='.repeat(72));
  console.log('🧪 RUNNING AMBULANCE PROVIDER IMPORT & MAP VERIFICATION TESTS');
  console.log('='.repeat(72));

  let passedTests = 0;
  let totalTests = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    totalTests++;
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            passedTests++;
            console.log(`  ✓ [PASS] ${name}`);
          })
          .catch((err) => {
            console.error(`  ❌ [FAIL] ${name}:`, err.message);
            throw err;
          });
      } else {
        passedTests++;
        console.log(`  ✓ [PASS] ${name}`);
      }
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // 1. Phone Normalization Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 1. Phone Normalization & Validation ---');

  test('Normalize 3-digit emergency helplines (108, 102, 112)', () => {
    assert.strictEqual(normalizeIndianPhoneNumber('108'), '108');
    assert.strictEqual(normalizeIndianPhoneNumber('102'), '102');
    assert.strictEqual(normalizeIndianPhoneNumber('112'), '112');
  });

  test('Normalize 10-digit Indian mobile numbers to +91XXXXXXXXXX', () => {
    assert.strictEqual(normalizeIndianPhoneNumber('7875873789'), '+917875873789');
    assert.strictEqual(normalizeIndianPhoneNumber('+91 78758 73789'), '+917875873789');
    assert.strictEqual(normalizeIndianPhoneNumber('9823055555'), '+919823055555');
  });

  test('Normalize Nagpur landlines (0712 STD code) to +91712XXXXXXX', () => {
    assert.strictEqual(normalizeIndianPhoneNumber('0712-2560108'), '+917122560108');
    assert.strictEqual(normalizeIndianPhoneNumber('07122725274'), '+917122725274');
    assert.strictEqual(normalizeIndianPhoneNumber('7126789108'), '+917126789108');
  });

  test('Handle toll-free numbers properly', () => {
    assert.strictEqual(normalizeIndianPhoneNumber('18002330033'), '18002330033');
  });

  // -------------------------------------------------------------------------
  // 2. Coordinate Boundary Validation Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Nagpur Coordinate Bounds Validation ---');

  test('Accept genuine coordinates within Nagpur district bounding box', () => {
    // Medical Square / GMCH
    const gmch = validateNagpurCoordinates(21.1305, 79.0965);
    assert.strictEqual(gmch.isValid, true);

    // MIHAN / AIIMS Nagpur
    const aiims = validateNagpurCoordinates(21.0347, 79.0264);
    assert.strictEqual(aiims.isValid, true);

    // Dharampeth / West High Court Rd
    const dharampeth = validateNagpurCoordinates(21.1415, 79.0645);
    assert.strictEqual(dharampeth.isValid, true);

    // Rural tehsil: Katol
    const katol = validateNagpurCoordinates(21.2745, 78.5875);
    assert.strictEqual(katol.isValid, true);
  });

  test('Reject null, NaN, and Null Island (0,0) coordinates', () => {
    assert.strictEqual(validateNagpurCoordinates(null, null).isValid, false);
    assert.strictEqual(validateNagpurCoordinates(undefined, 79.0882).isValid, false);
    assert.strictEqual(validateNagpurCoordinates(NaN, 79.0882).isValid, false);
    assert.strictEqual(validateNagpurCoordinates(0, 0).isValid, false);
  });

  test('Reject coordinates far outside Nagpur (e.g. Mumbai, Delhi, London)', () => {
    // Mumbai (18.92, 72.83)
    const mumbai = validateNagpurCoordinates(18.922, 72.834);
    assert.strictEqual(mumbai.isValid, false);
    assert(mumbai.reason?.includes('outside Nagpur District bounds'));

    // New Delhi (28.61, 77.20)
    const delhi = validateNagpurCoordinates(28.6139, 77.209);
    assert.strictEqual(delhi.isValid, false);
  });

  // -------------------------------------------------------------------------
  // 3. Normalization Pipeline & Provenance Tests
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Ingestion & Normalization Contract ---');

  test('Normalize statutory 108 MEMS record with GOVERNMENT_CONFIRMED confidence', () => {
    const raw: RawAmbulanceRecord = {
      record_id: 'amb-mems-108-nagpur',
      provider_name: 'Maharashtra Emergency Medical Services (108 MEMS)',
      public_business_phone: '108',
      business_address: 'GMCH Road, Nagpur - 440003',
      lat: 21.1305,
      lng: 79.0965,
      advertised_service_types: ['ADVANCED_LIFE_SUPPORT', 'BASIC_LIFE_SUPPORT'],
      advertised_icu_or_ventilator_capability: true,
      source_url: 'https://arogya.maharashtra.gov.in/en/emergency-medical-services',
    };
    const { normalized, error } = normalizeAmbulanceRecord(raw);
    assert.strictEqual(error, undefined);
    assert(normalized !== null);
    assert.strictEqual(normalized.recordType, 'OFFICIAL_EMERGENCY_HELPLINE');
    assert.strictEqual(normalized.operatorType, 'GOVERNMENT_MEMS');
    assert.strictEqual(normalized.contactNumber, '108');
    assert.strictEqual(normalized.dataConfidence, 'GOVERNMENT_CONFIRMED');
    assert.strictEqual(normalized.advertisedIcuOrVentilatorCapability, true);
  });

  test('Normalize hospital-affiliated ambulance fleet and link to parent hospital', () => {
    const raw: RawAmbulanceRecord = {
      record_id: 'amb-gmch-hospital-fleet',
      provider_name: 'GMCH Hospital Dedicated Ambulance Helpdesk',
      public_business_phone: '0712-2701180',
      business_address: 'GMCH Campus, Medical Square, Nagpur - 440003',
      lat: 21.1293,
      lng: 79.0967,
      advertised_service_types: ['ADVANCED_LIFE_SUPPORT', 'BASIC_LIFE_SUPPORT'],
      advertised_icu_or_ventilator_capability: true,
    };
    const { normalized, error } = normalizeAmbulanceRecord(raw);
    assert.strictEqual(error, undefined);
    assert(normalized !== null);
    assert.strictEqual(normalized.recordType, 'AMBULANCE_PROVIDER');
    assert.strictEqual(normalized.operatorType, 'HOSPITAL_OPERATED');
    assert.strictEqual(normalized.linkedHospitalId, 'fac-gmch-nagpur');
    assert.strictEqual(normalized.contactNumber, '+917122701180');
  });

  test('Normalize private 24x7 ambulance provider (Saptashrungi)', () => {
    const raw: RawAmbulanceRecord = {
      record_id: 'amb-saptashrungi-nagpur',
      provider_name: 'Saptashrungi Ambulance Services',
      public_business_phone: '+917875873789',
      business_address: 'Near Medical College Square, Hanuman Nagar, Nagpur',
      lat: 21.1305,
      lng: 79.0975,
      advertised_service_types: ['ICU_AMBULANCE', 'VENTILATOR_AMBULANCE'],
      advertised_icu_or_ventilator_capability: true,
    };
    const { normalized, error } = normalizeAmbulanceRecord(raw);
    assert.strictEqual(error, undefined);
    assert(normalized !== null);
    assert.strictEqual(normalized.operatorType, 'PRIVATE_OPERATOR');
    assert.strictEqual(normalized.contactNumber, '+917875873789');
    assert.strictEqual(normalized.advertisedIcuOrVentilatorCapability, true);
  });

  // -------------------------------------------------------------------------
  // 4. Import Pipeline Execution (Dry Run & Persistence)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Import Script Dry-Run & Production Execution ---');

  await test('Run ambulance import in --dry-run mode without mutating data', async () => {
    const result = await runAmbulanceImport({ dryRun: true });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.totalEvaluated, 30);
    assert.strictEqual(result.totalValid, 30);
    assert.strictEqual(result.totalRejected, 0);
    assert.strictEqual(result.stats.govtMems, 3);
    assert.strictEqual(result.stats.hospitalOperated, 10);
    assert.strictEqual(result.stats.privateOperators, 15);
    assert.strictEqual(result.stats.ngoCharitable, 2);
    assert(result.stats.icuCapable >= 10);
  });

  await test('Run ambulance import in live mode and verify persisted records in database', async () => {
    const result = await runAmbulanceImport({ dryRun: false });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.totalValid, 30);

    const count = await prisma.directoryAmbulanceService.count();
    assert.strictEqual(count, 30, `Expected 30 records in DirectoryAmbulanceService, found ${count}`);
  });

  // -------------------------------------------------------------------------
  // 5. Database Query & Specific Provider Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Key Verified Nagpur Providers in Database ---');

  await test('Verify MEMS 108 central node exists with exact emergency phone', async () => {
    const mems = await prisma.directoryAmbulanceService.findUnique({
      where: { id: 'amb-mems-108-nagpur' },
    });
    assert(mems !== null);
    assert.strictEqual(mems.contactNumber, '108');
    assert.strictEqual(mems.recordType, 'OFFICIAL_EMERGENCY_HELPLINE');
    assert(typeof mems.lat === 'number' && typeof mems.lng === 'number');
  });

  await test('Verify Saptashrungi, R.T., Tiwari, and HKGN ambulance providers exist', async () => {
    const targets = [
      'amb-saptashrungi-nagpur',
      'amb-rt-ambulance-nagpur',
      'amb-tiwari-ambulance-nagpur',
      'amb-hkgn-ambulance-nagpur',
      'amb-red-cross-nagpur',
    ];
    for (const id of targets) {
      const record = await prisma.directoryAmbulanceService.findUnique({ where: { id } });
      assert(record !== null, `Provider ${id} was not found in database`);
      assert(record.contactNumber.length >= 8, `Provider ${id} has invalid phone: ${record.contactNumber}`);
      assert(typeof record.lat === 'number' && typeof record.lng === 'number', `Provider ${id} missing coordinates`);
    }
  });

  await test('Verify major hospital-affiliated ambulance dispatch desks exist', async () => {
    const hospFleets = [
      'amb-gmch-hospital-fleet',
      'amb-iggmch-mayo-fleet',
      'amb-aiims-dedicated-line',
      'amb-kingsway-rapid-response',
      'amb-wockhardt-dedicated-fleet',
      'amb-care-emergency-line',
      'amb-ochri-dedicated-line',
      'amb-suretech-dispatch',
      'amb-max-emergency-line',
    ];
    for (const id of hospFleets) {
      const record = await prisma.directoryAmbulanceService.findUnique({ where: { id } });
      assert(record !== null, `Hospital fleet ${id} was not found in database`);
      assert.strictEqual(record.operatorType, 'HOSPITAL_OPERATED');
      assert(record.linkedHospitalId !== null, `Hospital fleet ${id} must have linkedHospitalId`);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Architectural Distinction: Provider Stations vs Physical Vehicle Rigs
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Architectural Distinction: Provider Stations vs Physical Rigs ---');

  await test('Verify DirectoryAmbulanceService stores organization stations, not vehicle chassis', async () => {
    const providers = await prisma.directoryAmbulanceService.findMany();
    assert.strictEqual(providers.length, 30);

    for (const p of providers) {
      // Must have organization properties
      assert(typeof p.serviceName === 'string' && p.serviceName.length > 0);
      assert(typeof p.contactNumber === 'string' && p.contactNumber.length >= 3);
      assert(typeof p.lat === 'number' && typeof p.lng === 'number');
      assert(typeof p.locality === 'string' && p.locality.length > 0);
      assert(typeof p.address === 'string' && p.address.length > 0);
      // Organization provider must NOT have vehicle chassis properties like license plate
      assert.strictEqual((p as any).vehicleNumber, undefined);
    }
  });

  await test('Verify registered vehicles in Ambulance table have vehicle numbers and equipment types', async () => {
    const rigs = await prisma.ambulance.findMany();
    assert(rigs.length >= 2, 'Expected registered ambulance vehicle rigs');
    for (const rig of rigs) {
      assert(typeof rig.vehicleNumber === 'string' && rig.vehicleNumber.startsWith('MH-31'));
      assert(typeof rig.ambulanceType === 'string');
    }
  });

  console.log('\n' + '='.repeat(72));
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('='.repeat(72) + '\n');
}

runTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal test failure:', err);
    process.exit(1);
  });
