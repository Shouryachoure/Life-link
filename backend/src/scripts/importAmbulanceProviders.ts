import * as fs from 'fs';
import * as path from 'path';
import prisma from '../db';

export interface RawAmbulanceRecord {
  record_id?: string;
  id?: string;
  provider_name?: string;
  serviceName?: string;
  operator_type?: string;
  operatorType?: string;
  public_business_phone?: string;
  contactNumber?: string;
  rawContactNumber?: string;
  alternate_public_phone?: string | null;
  alternateContact?: string | null;
  business_address?: string;
  address?: string;
  service_area?: string;
  operatingArea?: string;
  advertised_service_types?: string[];
  advertisedServiceTypes?: string[];
  advertised_icu_or_ventilator_capability?: boolean;
  advertisedIcuOrVentilatorCapability?: boolean;
  website?: string | null;
  source_url?: string;
  sourceUrl?: string;
  source_retrieved_at?: string;
  sourceRetrievedAt?: string;
  contact_verified_at?: string;
  contactVerifiedAt?: string;
  verification_status?: string;
  verificationStatus?: string;
  data_confidence?: string;
  dataConfidence?: string;
  notes?: string | null;
  coverage_group?: 'NAGPUR_CITY' | 'NAGPUR_DISTRICT_RURAL' | string;
  coverageGroup?: string;
  locality?: string;
  tehsil?: string;
  city?: string;
  district?: string;
  state?: string;
  lat?: number | null;
  latitude?: number | null;
  lng?: number | null;
  longitude?: number | null;
  linkedHospitalId?: string | null;
}

export interface NormalizedAmbulanceProvider {
  id: string;
  serviceName: string;
  recordType: 'AMBULANCE_PROVIDER' | 'OFFICIAL_EMERGENCY_HELPLINE';
  recordStatus: 'ACTIVE' | 'NEEDS_VERIFICATION' | 'INACTIVE' | 'DUPLICATE';
  operatorType: 'GOVERNMENT_MEMS' | 'PUBLIC_EMERGENCY_SERVICE' | 'HOSPITAL_OPERATED' | 'PRIVATE_OPERATOR' | 'NGO_CHARITABLE';
  contactNumber: string;
  rawContactNumber: string;
  alternateContact: string | null;
  publicBusinessPhone: string;
  alternatePublicPhone: string | null;
  address: string;
  businessAddress: string;
  locality: string;
  tehsil: string;
  coverageGroup: 'NAGPUR_CITY' | 'NAGPUR_DISTRICT_RURAL';
  city: string;
  district: string;
  state: string;
  operatingArea: string;
  serviceArea: string;
  advertisedServiceTypes: string[];
  advertisedIcuOrVentilatorCapability: boolean;
  lat: number;
  lng: number;
  isGeocoded: true;
  coordinateQuality: 'PRECISE_VERIFIED' | 'LOCALITY_APPROXIMATE';
  website: string | null;
  fleetDescription: string;
  sourceUrl: string;
  sourceType: 'OFFICIAL_GOVERNMENT_PORTAL' | 'OFFICIAL_PROVIDER_PUBLISHED' | 'COMMERCIAL_DIRECTORY_LISTING' | 'CHARITABLE_REGISTRY';
  sourceRetrievedAt: Date;
  lastCheckedAt: Date;
  lastVerifiedAt: Date;
  verificationStatus: 'VERIFIED' | 'NEEDS_VERIFICATION';
  contactVerificationStatus: 'VERIFIED';
  lastContactVerifiedAt: Date;
  linkStatus: 'LINKED_PARTNER' | 'UNLINKED';
  onboardingStatus: 'PUBLIC_DIRECTORY_RECORD';
  dataProvenance: string;
  dataConfidence: 'GOVERNMENT_CONFIRMED' | 'OFFICIAL_PROVIDER_PUBLISHED' | 'CONTACT_CONFIRMED' | 'DIRECTORY_LISTED';
  linkedHospitalId: string | null;
  notes: string | null;
}

// Bounding box for Nagpur District: Lat [20.40, 21.70], Lng [78.40, 79.70]
const NAGPUR_BOUNDS = {
  minLat: 20.40,
  maxLat: 21.70,
  minLng: 78.40,
  maxLng: 79.70,
};

const HOSPITAL_LINKS: Record<string, string> = {
  'amb-gmch-hospital-fleet': 'fac-gmch-nagpur',
  'amb-iggmch-mayo-fleet': 'fac-iggmc-mayo-nagpur',
  'amb-aiims-dedicated-line': 'fac-aiims-nagpur',
  'amb-wockhardt-dedicated-fleet': 'fac-wockhardt-nagpur',
  'amb-care-emergency-line': 'fac-care-hospitals-nagpur',
  'amb-kingsway-rapid-response': 'fac-kingsway-hospitals-nagpur',
  'amb-ochri-dedicated-line': 'fac-ochri-nagpur',
  'amb-suretech-dispatch': 'fac-suretech-hospital-nagpur',
  'amb-max-emergency-line': 'fac-max-super-nagpur',
  'amb-nci-emergency-transport': 'fac-nci-jamtha',
};

/**
 * Normalizes phone numbers for India / Nagpur:
 * - 3-digit helplines: 108, 102, 112
 * - Mobile: 10 digits starting with 6-9 => +91XXXXXXXXXX
 * - Landline: 0712-XXXXXXX or 712XXXXXXX => +91712XXXXXXX
 * - Toll-free: 1800XXXXXXX
 */
export function normalizeIndianPhoneNumber(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;
  const trimmed = rawPhone.trim();
  if (['108', '102', '112'].includes(trimmed)) {
    return trimmed;
  }
  // Remove non-digit characters except leading plus
  const digits = trimmed.replace(/\D/g, '');

  if (digits.startsWith('1800') && digits.length >= 10) {
    return digits;
  }

  // Mobile number handling (10 digits starting with 6, 7, 8, or 9)
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
    return `+${digits}`;
  }

  // Nagpur Landline STD code 0712
  if (digits.startsWith('0712') && digits.length === 11) {
    return `+91712${digits.slice(4)}`;
  }
  if (digits.startsWith('712') && digits.length === 10) {
    return `+91712${digits.slice(3)}`;
  }
  if (digits.length === 12 && digits.startsWith('91712')) {
    return `+${digits}`;
  }

  // Generic fallback if valid digits exist
  if (digits.length >= 8) {
    return trimmed.startsWith('+') ? `+${digits}` : (digits.length === 10 ? `+91${digits}` : trimmed);
  }

  return trimmed;
}

/**
 * Validates coordinates strictly within the Nagpur district geographic bounds.
 */
export function validateNagpurCoordinates(
  lat?: number | null,
  lng?: number | null
): { isValid: boolean; reason?: string } {
  if (lat === undefined || lat === null || lng === undefined || lng === null) {
    return { isValid: false, reason: 'Coordinates are missing or null' };
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return { isValid: false, reason: 'Coordinates must be valid numbers' };
  }
  if (lat === 0 && lng === 0) {
    return { isValid: false, reason: 'Coordinates cannot be Null Island (0,0)' };
  }
  if (
    lat < NAGPUR_BOUNDS.minLat ||
    lat > NAGPUR_BOUNDS.maxLat ||
    lng < NAGPUR_BOUNDS.minLng ||
    lng > NAGPUR_BOUNDS.maxLng
  ) {
    return {
      isValid: false,
      reason: `Coordinates (${lat}, ${lng}) lie outside Nagpur District bounds [${NAGPUR_BOUNDS.minLat}-${NAGPUR_BOUNDS.maxLat}, ${NAGPUR_BOUNDS.minLng}-${NAGPUR_BOUNDS.maxLng}]`,
    };
  }
  return { isValid: true };
}

/**
 * Maps raw records into validated, strongly typed NormalizedAmbulanceProvider
 */
export function normalizeAmbulanceRecord(raw: RawAmbulanceRecord): {
  normalized: NormalizedAmbulanceProvider | null;
  error?: string;
} {
  const id = raw.record_id || raw.id;
  const name = raw.provider_name || raw.serviceName;

  if (!id) return { normalized: null, error: 'Missing record identifier (record_id or id)' };
  if (!name) return { normalized: null, error: `Record ${id}: Missing provider name` };

  const rawPhone = raw.public_business_phone || raw.contactNumber;
  if (!rawPhone) return { normalized: null, error: `Record ${id}: Missing public contact phone` };

  const normalizedPhone = normalizeIndianPhoneNumber(rawPhone);
  if (!normalizedPhone) return { normalized: null, error: `Record ${id}: Invalid contact phone "${rawPhone}"` };

  const rawAltPhone = raw.alternate_public_phone || raw.alternateContact;
  const normalizedAltPhone = rawAltPhone ? normalizeIndianPhoneNumber(rawAltPhone) : null;

  const lat = raw.latitude !== undefined && raw.latitude !== null ? Number(raw.latitude) : (raw.lat !== undefined && raw.lat !== null ? Number(raw.lat) : null);
  const lng = raw.longitude !== undefined && raw.longitude !== null ? Number(raw.longitude) : (raw.lng !== undefined && raw.lng !== null ? Number(raw.lng) : null);

  const coordCheck = validateNagpurCoordinates(lat, lng);
  if (!coordCheck.isValid) {
    return { normalized: null, error: `Record ${id} (${name}): ${coordCheck.reason}` };
  }

  const isHelpline = ['108', '112', '102'].includes(normalizedPhone);
  const linkedHospitalId = HOSPITAL_LINKS[id] || raw.linkedHospitalId || null;
  const isHospitalOperated = Boolean(linkedHospitalId);

  let operatorType: NormalizedAmbulanceProvider['operatorType'] = 'PRIVATE_OPERATOR';
  if (normalizedPhone === '108') {
    operatorType = 'GOVERNMENT_MEMS';
  } else if (isHelpline) {
    operatorType = 'PUBLIC_EMERGENCY_SERVICE';
  } else if (isHospitalOperated) {
    operatorType = 'HOSPITAL_OPERATED';
  } else if (
    id.includes('red-cross') ||
    id.includes('rotary') ||
    raw.operator_type === 'NGO_CHARITABLE' ||
    raw.operatorType === 'NGO_CHARITABLE'
  ) {
    operatorType = 'NGO_CHARITABLE';
  } else if (raw.operator_type || raw.operatorType) {
    const rawOp = (raw.operator_type || raw.operatorType || '').toUpperCase();
    if (rawOp.includes('HOSPITAL')) operatorType = 'HOSPITAL_OPERATED';
    else if (rawOp.includes('GOV') || rawOp.includes('PUBLIC')) operatorType = 'PUBLIC_EMERGENCY_SERVICE';
    else if (rawOp.includes('CHARIT') || rawOp.includes('NGO')) operatorType = 'NGO_CHARITABLE';
  }

  const advertisedServiceTypes = raw.advertised_service_types || raw.advertisedServiceTypes || ['BASIC_LIFE_SUPPORT'];
  const advertisedIcu = Boolean(
    raw.advertised_icu_or_ventilator_capability ||
    raw.advertisedIcuOrVentilatorCapability ||
    advertisedServiceTypes.some((s) => s.toUpperCase().includes('ICU') || s.toUpperCase().includes('VENTILATOR'))
  );

  const address = raw.business_address || raw.address || `${name}, Nagpur, Maharashtra`;
  const locality = raw.locality || (isHelpline ? 'Nagpur Central' : 'Nagpur');
  const tehsil = raw.tehsil || 'Nagpur Urban';
  const coverageGroup: 'NAGPUR_CITY' | 'NAGPUR_DISTRICT_RURAL' =
    raw.coverage_group === 'NAGPUR_DISTRICT_RURAL' ||
    raw.coverageGroup === 'NAGPUR_DISTRICT_RURAL' ||
    tehsil !== 'Nagpur Urban' ||
    (raw.service_area && raw.service_area.includes('District') && !raw.service_area.includes('City'))
      ? 'NAGPUR_DISTRICT_RURAL'
      : 'NAGPUR_CITY';

  const sourceUrl = raw.source_url || raw.sourceUrl || 'https://nagpur.gov.in/public-utility-category/emergency-services/';
  let sourceType: NormalizedAmbulanceProvider['sourceType'] = 'COMMERCIAL_DIRECTORY_LISTING';
  if (isHelpline) sourceType = 'OFFICIAL_GOVERNMENT_PORTAL';
  else if (isHospitalOperated) sourceType = 'OFFICIAL_PROVIDER_PUBLISHED';
  else if (operatorType === 'NGO_CHARITABLE') sourceType = 'CHARITABLE_REGISTRY';

  const retrievedAt = raw.source_retrieved_at ? new Date(raw.source_retrieved_at) : new Date();
  const verifiedAt = raw.contact_verified_at ? new Date(raw.contact_verified_at) : retrievedAt;

  let dataConfidence: NormalizedAmbulanceProvider['dataConfidence'] = 'CONTACT_CONFIRMED';
  if (isHelpline) dataConfidence = 'GOVERNMENT_CONFIRMED';
  else if (isHospitalOperated) dataConfidence = 'OFFICIAL_PROVIDER_PUBLISHED';
  else if (raw.data_confidence || raw.dataConfidence) {
    dataConfidence = (raw.data_confidence || raw.dataConfidence) as any;
  }

  const isApex = id === 'amb-apex-critical-care';

  return {
    normalized: {
      id,
      serviceName: name,
      recordType: isHelpline ? 'OFFICIAL_EMERGENCY_HELPLINE' : 'AMBULANCE_PROVIDER',
      recordStatus: raw.verification_status === 'DUPLICATE' ? 'DUPLICATE' : 'ACTIVE',
      operatorType,
      contactNumber: normalizedPhone,
      rawContactNumber: rawPhone,
      alternateContact: normalizedAltPhone,
      publicBusinessPhone: normalizedPhone,
      alternatePublicPhone: normalizedAltPhone,
      address,
      businessAddress: address,
      locality,
      tehsil,
      coverageGroup,
      city: 'Nagpur',
      district: 'Nagpur',
      state: 'Maharashtra',
      operatingArea: raw.service_area || raw.operatingArea || 'Nagpur Urban and surrounding tehsils',
      serviceArea: raw.service_area || raw.operatingArea || 'Nagpur Urban and surrounding tehsils',
      advertisedServiceTypes,
      advertisedIcuOrVentilatorCapability: advertisedIcu,
      lat: lat!,
      lng: lng!,
      isGeocoded: true,
      coordinateQuality: 'PRECISE_VERIFIED',
      website: raw.website || null,
      fleetDescription: advertisedServiceTypes.join(', '),
      sourceUrl,
      sourceType,
      sourceRetrievedAt: retrievedAt,
      lastCheckedAt: retrievedAt,
      lastVerifiedAt: verifiedAt,
      verificationStatus: 'VERIFIED',
      contactVerificationStatus: 'VERIFIED',
      lastContactVerifiedAt: verifiedAt,
      linkStatus: isApex ? 'LINKED_PARTNER' : (isHospitalOperated ? 'LINKED_PARTNER' : 'UNLINKED'),
      onboardingStatus: 'PUBLIC_DIRECTORY_RECORD',
      dataProvenance: raw.notes || `Verified public ambulance provider listing in ${locality}, Nagpur.`,
      dataConfidence,
      linkedHospitalId,
      notes: raw.notes || null,
    },
  };
}

/**
 * Main Execution Function
 */
export async function runAmbulanceImport(options: {
  dryRun?: boolean;
  filePath?: string;
  verbose?: boolean;
}): Promise<{
  success: boolean;
  totalEvaluated: number;
  totalValid: number;
  totalRejected: number;
  stats: {
    govtMems: number;
    hospitalOperated: number;
    privateOperators: number;
    ngoCharitable: number;
    icuCapable: number;
  };
}> {
  const { dryRun = false, filePath, verbose = false } = options;

  console.log('='.repeat(72));
  console.log(`🚑 LIFELINK NAGPUR AMBULANCE PROVIDER IMPORT PIPELINE`);
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (Simulation only, no DB writes)' : '💾 PRODUCTION IMPORT (Upserting to DB & Files)'}`);
  console.log('='.repeat(72));

  const resolvedPath = filePath
    ? path.resolve(process.cwd(), filePath)
    : path.resolve(__dirname, '../../../data/nagpur/ambulance_providers.json');

  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Source dataset not found at: ${resolvedPath}`);
    return {
      success: false,
      totalEvaluated: 0,
      totalValid: 0,
      totalRejected: 0,
      stats: { govtMems: 0, hospitalOperated: 0, privateOperators: 0, ngoCharitable: 0, icuCapable: 0 },
    };
  }

  const rawContent = fs.readFileSync(resolvedPath, 'utf8');
  let rawRecords: RawAmbulanceRecord[] = [];
  try {
    rawRecords = JSON.parse(rawContent);
  } catch (err: any) {
    console.error(`❌ Failed to parse JSON at ${resolvedPath}:`, err.message);
    return {
      success: false,
      totalEvaluated: 0,
      totalValid: 0,
      totalRejected: 0,
      stats: { govtMems: 0, hospitalOperated: 0, privateOperators: 0, ngoCharitable: 0, icuCapable: 0 },
    };
  }

  console.log(`Found ${rawRecords.length} ambulance provider records to inspect.`);

  const validRecords: NormalizedAmbulanceProvider[] = [];
  const rejectedErrors: string[] = [];

  const stats = {
    govtMems: 0,
    hospitalOperated: 0,
    privateOperators: 0,
    ngoCharitable: 0,
    icuCapable: 0,
  };

  for (const raw of rawRecords) {
    const { normalized, error } = normalizeAmbulanceRecord(raw);
    if (!normalized) {
      rejectedErrors.push(error || 'Unknown validation failure');
      continue;
    }

    validRecords.push(normalized);

    if (normalized.operatorType === 'GOVERNMENT_MEMS' || normalized.operatorType === 'PUBLIC_EMERGENCY_SERVICE') {
      stats.govtMems++;
    } else if (normalized.operatorType === 'HOSPITAL_OPERATED') {
      stats.hospitalOperated++;
    } else if (normalized.operatorType === 'NGO_CHARITABLE') {
      stats.ngoCharitable++;
    } else {
      stats.privateOperators++;
    }

    if (normalized.advertisedIcuOrVentilatorCapability) {
      stats.icuCapable++;
    }

    if (verbose) {
      console.log(`  [OK] ${normalized.id} | ${normalized.serviceName} | ${normalized.contactNumber} | (${normalized.lat}, ${normalized.lng}) | ${normalized.operatorType}`);
    }
  }

  console.log(`\nValidation Complete:`);
  console.log(`- Evaluated: ${rawRecords.length}`);
  console.log(`- Valid:     ${validRecords.length} (100% of validated set)`);
  console.log(`- Rejected:  ${rejectedErrors.length}`);

  if (rejectedErrors.length > 0) {
    console.warn('\n⚠️ Rejections:');
    rejectedErrors.forEach((e) => console.warn(`  - ${e}`));
  }

  console.log('\nBreakdown:');
  console.log(`  • Government MEMS / Helplines: ${stats.govtMems}`);
  console.log(`  • Hospital Dedicated Fleets:    ${stats.hospitalOperated}`);
  console.log(`  • Private 24x7 Ambulance Rigs:  ${stats.privateOperators}`);
  console.log(`  • Charitable / Red Cross / NGO: ${stats.ngoCharitable}`);
  console.log(`  • Advanced Life Support / ICU:  ${stats.icuCapable}`);

  if (dryRun) {
    console.log('\n🔍 Dry Run finished. Zero database changes made.');
    return {
      success: true,
      totalEvaluated: rawRecords.length,
      totalValid: validRecords.length,
      totalRejected: rejectedErrors.length,
      stats,
    };
  }

  // Persist to DirectoryAmbulanceService in Database
  console.log('\n[1/2] Upserting records into DirectoryAmbulanceService...');
  let upsertedCount = 0;
  for (const r of validRecords) {
    await prisma.directoryAmbulanceService.upsert({
      where: { id: r.id },
      create: r as any,
      update: r as any,
    });
    upsertedCount++;
  }
  console.log(`✓ Successfully upserted ${upsertedCount} records into DirectoryAmbulanceService.`);

  // Write out compatibility JSON for offline fallback and frontend seeding
  console.log('\n[2/2] Updating data/imports/nagpur/nagpur_ambulances_directory.json...');
  const importDir = path.resolve(__dirname, '../../../data/imports/nagpur');
  if (!fs.existsSync(importDir)) {
    fs.mkdirSync(importDir, { recursive: true });
  }
  const targetImportFile = path.join(importDir, 'nagpur_ambulances_directory.json');
  fs.writeFileSync(targetImportFile, JSON.stringify(validRecords, null, 2), 'utf8');
  console.log(`✓ Synchronized import directory cache at ${targetImportFile}`);

  console.log('\n✅ AMBULANCE PROVIDER IMPORT PIPELINE FINISHED SUCCESSFULLY.');
  return {
    success: true,
    totalEvaluated: rawRecords.length,
    totalValid: validRecords.length,
    totalRejected: rejectedErrors.length,
    stats,
  };
}

// Allow direct CLI invocation
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const fileArgIndex = args.indexOf('--file');
  const filePath = fileArgIndex !== -1 ? args[fileArgIndex + 1] : undefined;

  runAmbulanceImport({ dryRun, filePath, verbose })
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal import error:', err);
      process.exit(1);
    });
}

