import crypto from 'crypto';
import prisma from '../db';
import { logger } from '../utils/logger';

// -----------------------------------------------------------------------------
// Types & Interfaces
// -----------------------------------------------------------------------------

export interface RawFacilityImportItem {
  id?: string;
  name: string;
  alternateNames?: string[] | string;
  recordType?: string;
  recordStatus?: string;
  facilityType: string;
  ownership: string;
  contactNumber: string;
  alternateNumber?: string;
  address: string;
  locality?: string;
  tehsil?: string;
  coverageGroup?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  coordinateQuality?: string;
  website?: string | null;
  emergencyHelpline?: string | null;
  emergencyPhone?: string | null;
  ambulancePhone?: string | null;
  publicEmail?: string | null;
  specialties?: string[] | string | null;
  emergencyServicesClaimed?: boolean;
  sourceUrl: string;
  sourceType?: string;
  sourceRetrievedAt?: string | Date;
  dataProvenance?: string;
  dataConfidence?: string;
  lastCheckedAt?: string | Date;
  lastVerifiedAt?: string | Date;
  verificationStatus?: string;
  contactVerificationStatus?: string;
  lastContactVerifiedAt?: string | Date | null;
  linkStatus?: string;
  onboardingStatus?: string;
  duplicateGroup?: string | null;
  notes?: string | null;
}

export interface RawAmbulanceImportItem {
  id?: string;
  serviceName: string;
  recordType?: string;
  recordStatus?: string;
  operatorType: string;
  contactNumber: string;
  alternateContact?: string;
  publicBusinessPhone?: string;
  alternatePublicPhone?: string;
  address?: string;
  businessAddress?: string;
  locality?: string;
  tehsil?: string;
  coverageGroup?: string;
  city?: string;
  district?: string;
  state?: string;
  operatingArea?: string;
  serviceArea?: string;
  advertisedServiceTypes?: string[] | string | null;
  advertisedIcuOrVentilatorCapability?: boolean;
  lat?: number | string | null;
  lng?: number | string | null;
  coordinateQuality?: string;
  website?: string | null;
  fleetDescription?: string | null;
  sourceUrl: string;
  sourceType?: string;
  sourceRetrievedAt?: string | Date;
  dataProvenance?: string;
  dataConfidence?: string;
  lastCheckedAt?: string | Date;
  lastVerifiedAt?: string | Date;
  verificationStatus?: string;
  contactVerificationStatus?: string;
  lastContactVerifiedAt?: string | Date | null;
  linkStatus?: string;
  onboardingStatus?: string;
  notes?: string | null;
}

export interface ValidationIssue {
  field: string;
  issue: string;
  severity: 'ERROR' | 'WARNING';
}

export interface ImportPreviewResult<T> {
  total: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  duplicateCount: number;
  validRecords: T[];
  issues: {
    recordIndex: number;
    recordName: string;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    isDuplicate?: boolean;
    duplicateOf?: string;
  }[];
}

// -----------------------------------------------------------------------------
// Nagpur Geographic Boundaries (Nagpur City & Wider District)
// -----------------------------------------------------------------------------

// Nagpur District Boundary: Lat [20.40, 21.80], Lng [78.30, 79.80]
export const NAGPUR_GEO_BOUNDS = {
  minLat: 20.40,
  maxLat: 21.80,
  minLng: 78.30,
  maxLng: 79.80,
};

// Nagpur City Core Boundary: Lat [21.00, 21.25], Lng [78.95, 79.20]
export const NAGPUR_CITY_BOUNDS = {
  minLat: 21.00,
  maxLat: 21.25,
  minLng: 78.95,
  maxLng: 79.20,
};

const KNOWN_DISTRICT_TALUKAS = [
  'KAMPTEE',
  'HINGNA',
  'KATOL',
  'RAMTEK',
  'UMRED',
  'SAONER',
  'NARKHED',
  'MOUDA',
  'PARSEONI',
  'KUHI',
  'BHIWAPUR',
  'KALMESHWAR',
];

// -----------------------------------------------------------------------------
// Normalization & Validation Helper Functions
// -----------------------------------------------------------------------------

/**
 * Normalizes Indian phone number while preserving valid landlines and emergency shortcodes
 */
export function normalizeIndianDirectoryPhone(raw: string): { normalized: string; type: 'LANDLINE' | 'MOBILE' | 'HELPLINE' | 'TOLLFREE' | 'INVALID' } {
  if (!raw || typeof raw !== 'string') {
    return { normalized: '', type: 'INVALID' };
  }

  const cleaned = raw.trim();

  // 1. Emergency shortcodes
  if (['108', '102', '112', '100', '101'].includes(cleaned)) {
    return { normalized: cleaned, type: 'HELPLINE' };
  }

  // 2. Toll-free numbers: 1800-XXX-XXXX
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.startsWith('1800') && digitsOnly.length === 11) {
    return { normalized: `1800-${digitsOnly.slice(4, 7)}-${digitsOnly.slice(7)}`, type: 'TOLLFREE' };
  }

  // 3. Nagpur Landline: STD 0712 + 7-digit landline (e.g. 0712-2744400)
  if (digitsOnly.startsWith('0712') && digitsOnly.length === 11) {
    return { normalized: `0712-${digitsOnly.slice(4)}`, type: 'LANDLINE' };
  }
  if (digitsOnly.startsWith('712') && digitsOnly.length === 10) {
    return { normalized: `0712-${digitsOnly.slice(3)}`, type: 'LANDLINE' };
  }
  if (digitsOnly.startsWith('91712') && digitsOnly.length === 12) {
    return { normalized: `0712-${digitsOnly.slice(5)}`, type: 'LANDLINE' };
  }

  // District Landlines (e.g. 07109 Kamptee, 07104 Hingna, 07112 Katol, 07114 Ramtek, 07116 Umred)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('071')) {
    return { normalized: `${digitsOnly.slice(0, 5)}-${digitsOnly.slice(5)}`, type: 'LANDLINE' };
  }

  // 4. Indian Mobile: 10 digits starting with 6, 7, 8, 9 (or +91 prefix)
  let mobileDigits = digitsOnly;
  if (mobileDigits.startsWith('91') && mobileDigits.length === 12) {
    mobileDigits = mobileDigits.slice(2);
  } else if (mobileDigits.startsWith('0') && mobileDigits.length === 11 && ['6', '7', '8', '9'].includes(mobileDigits[1])) {
    mobileDigits = mobileDigits.slice(1);
  }

  if (mobileDigits.length === 10 && /^[6-9]\d{9}$/.test(mobileDigits)) {
    return { normalized: `+91${mobileDigits}`, type: 'MOBILE' };
  }

  // Fallback: 7 digit local number assumed Nagpur 0712
  if (digitsOnly.length === 7) {
    return { normalized: `0712-${digitsOnly}`, type: 'LANDLINE' };
  }

  return { normalized: cleaned, type: 'INVALID' };
}

/**
 * Validates whether latitude and longitude are within plausible Nagpur boundaries
 */
export function validateNagpurCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined
): { isValid: boolean; isDistrictWide: boolean; issue?: string } {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return { isValid: false, isDistrictWide: false, issue: 'Missing coordinates' };
  }

  if (isNaN(lat) || isNaN(lng)) {
    return { isValid: false, isDistrictWide: false, issue: 'Coordinates are not numeric' };
  }

  if (lat === 0 && lng === 0) {
    return { isValid: false, isDistrictWide: false, issue: 'Null Island (0,0) coordinate rejected' };
  }

  const inDistrict =
    lat >= NAGPUR_GEO_BOUNDS.minLat &&
    lat <= NAGPUR_GEO_BOUNDS.maxLat &&
    lng >= NAGPUR_GEO_BOUNDS.minLng &&
    lng <= NAGPUR_GEO_BOUNDS.maxLng;

  if (!inDistrict) {
    return {
      isValid: false,
      isDistrictWide: false,
      issue: `Coordinates [${lat}, ${lng}] lie outside Nagpur district boundaries [Lat: 20.4-21.8, Lng: 78.3-79.8]`,
    };
  }

  const inCity =
    lat >= NAGPUR_CITY_BOUNDS.minLat &&
    lat <= NAGPUR_CITY_BOUNDS.maxLat &&
    lng >= NAGPUR_CITY_BOUNDS.minLng &&
    lng <= NAGPUR_CITY_BOUNDS.maxLng;

  return { isValid: true, isDistrictWide: !inCity };
}

/**
 * Calculates straight-line distance in km between two coordinates using the Haversine formula
 */
export function calculateHaversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Normalizes text for fuzzy deduplication comparison
 */
export function normalizeTextForMatching(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
    .replace(/\b(hospital|hospitals|centre|center|rugnalaya|institute|research|clinic|medical|and|nagpur)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes Jaccard word-similarity index between two normalized strings
 */
export function calculateNameSimilarity(nameA: string, nameB: string): number {
  const normA = normalizeTextForMatching(nameA);
  const normB = normalizeTextForMatching(nameB);
  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  const setA = new Set(normA.split(' '));
  const setB = new Set(normB.split(' '));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Classifies whether an address or locality belongs to Nagpur City Core vs Wider District
 */
export function classifyAdministrativeScope(locality?: string, address?: string): 'NAGPUR_CITY' | 'NAGPUR_DISTRICT' {
  const combined = `${locality || ''} ${address || ''}`.toUpperCase();
  for (const taluka of KNOWN_DISTRICT_TALUKAS) {
    if (combined.includes(taluka)) {
      return 'NAGPUR_DISTRICT';
    }
  }
  return 'NAGPUR_CITY';
}

// -----------------------------------------------------------------------------
// Facility Validation & Ingestion Pipeline
// -----------------------------------------------------------------------------

export async function validateFacilityBatch(
  records: RawFacilityImportItem[]
): Promise<ImportPreviewResult<any>> {
  const preview: ImportPreviewResult<any> = {
    total: records.length,
    validCount: 0,
    warningCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    validRecords: [],
    issues: [],
  };

  // Retrieve existing facilities for duplicate detection
  const existingFacilities = await prisma.directoryFacility.findMany();

  for (let idx = 0; idx < records.length; idx++) {
    const raw = records[idx];
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // 1. Mandatory Name
    if (!raw.name || raw.name.trim().length < 3) {
      errors.push({ field: 'name', issue: 'Facility name is required (min 3 chars)', severity: 'ERROR' });
    }

    // 2. Mandatory Facility Type
    const validTypes = [
      'GOVERNMENT_HOSPITAL',
      'MEDICAL_COLLEGE',
      'PRIVATE_MULTISPECIALTY',
      'PRIVATE_SPECIALTY',
      'PRIMARY_HEALTH_CENTRE',
      'COMMUNITY_HEALTH_CENTRE',
      'RURAL_HOSPITAL',
      'SUB_DISTRICT_HOSPITAL',
      'MUNICIPAL_HOSPITAL',
      'GOVERNMENT_SPECIALTY',
      'CANCER_CENTRE',
      'CHILDREN_HOSPITAL',
      'MATERNITY_HOSPITAL',
      'EYE_HOSPITAL',
      'MENTAL_HEALTH',
      'TRAUMA_CENTRE',
      'DAYCARE_CLINIC',
      'GENERAL_HOSPITAL',
    ];
    if (!raw.facilityType || !validTypes.includes(raw.facilityType.trim().toUpperCase())) {
      errors.push({
        field: 'facilityType',
        issue: `Invalid facilityType '${raw.facilityType}'. Must be one of: ${validTypes.join(', ')}`,
        severity: 'ERROR',
      });
    }

    // 3. Mandatory Ownership
    const validOwnership = [
      'GOVERNMENT_STATE',
      'GOVERNMENT_CENTRAL',
      'MUNICIPAL',
      'PRIVATE_TRUST',
      'PRIVATE_CORPORATE',
      'UNKNOWN',
    ];
    if (!raw.ownership || !validOwnership.includes(raw.ownership.trim().toUpperCase())) {
      warnings.push({
        field: 'ownership',
        issue: `Unrecognized ownership '${raw.ownership}'. Defaulting to UNKNOWN.`,
        severity: 'WARNING',
      });
    }

    // 4. Contact Number Validation
    const phoneNorm = normalizeIndianDirectoryPhone(raw.contactNumber);
    if (!raw.contactNumber || phoneNorm.type === 'INVALID') {
      errors.push({
        field: 'contactNumber',
        issue: `Invalid Indian contact number '${raw.contactNumber}'. Must be landline (0712-XXXXXXX), 10-digit mobile, or emergency code (108/112).`,
        severity: 'ERROR',
      });
    }

    // 5. Address Validation
    if (!raw.address || raw.address.trim().length < 8) {
      errors.push({ field: 'address', issue: 'Public address is required (min 8 chars)', severity: 'ERROR' });
    }

    // 6. Coordinates Validation
    let parsedLat: number | null = null;
    let parsedLng: number | null = null;
    if (raw.lat !== undefined && raw.lat !== null && raw.lng !== undefined && raw.lng !== null) {
      parsedLat = typeof raw.lat === 'string' ? parseFloat(raw.lat) : raw.lat;
      parsedLng = typeof raw.lng === 'string' ? parseFloat(raw.lng) : raw.lng;
      const coordCheck = validateNagpurCoordinates(parsedLat, parsedLng);
      if (!coordCheck.isValid) {
        errors.push({
          field: 'coordinates',
          issue: coordCheck.issue || 'Invalid geographic coordinates',
          severity: 'ERROR',
        });
      }
    } else {
      warnings.push({
        field: 'coordinates',
        issue: 'Coordinates not provided; facility will require geocoding before map placement.',
        severity: 'WARNING',
      });
    }

    // 7. Source URL Provenance
    if (!raw.sourceUrl || !raw.sourceUrl.startsWith('http')) {
      errors.push({ field: 'sourceUrl', issue: 'Valid source URL provenance required (http/https)', severity: 'ERROR' });
    }

    // 8. Duplicate Detection against existing facilities and preceding batch items
    let isDuplicate = false;
    let duplicateOf: string | undefined;

    const allCandidates = [
      ...existingFacilities,
      ...preview.validRecords.map((r) => ({
        id: r.id || 'batch-item',
        name: r.name,
        contactNumber: r.contactNumber,
        lat: r.lat,
        lng: r.lng,
      })),
    ];

    for (const cand of allCandidates) {
      // Direct name match or high similarity
      const nameSim = calculateNameSimilarity(raw.name, cand.name);
      const isExactPhone = phoneNorm.normalized && phoneNorm.normalized === cand.contactNumber;

      // Coordinate proximity check (< 150 meters)
      let isCoLocated = false;
      if (parsedLat && parsedLng && cand.lat && cand.lng) {
        const distKm = calculateHaversineDistanceKm(parsedLat, parsedLng, cand.lat, cand.lng);
        if (distKm < 0.15) {
          isCoLocated = true;
        }
      }

      if (nameSim >= 0.85 || (nameSim >= 0.6 && (isExactPhone || isCoLocated))) {
        isDuplicate = true;
        duplicateOf = `${cand.name} (${cand.id})`;
        break;
      }
    }

    if (isDuplicate) {
      warnings.push({
        field: 'duplicate',
        issue: `Potential duplicate of existing facility: ${duplicateOf}`,
        severity: 'WARNING',
      });
      preview.duplicateCount++;
    }

    // Summary counts
    if (errors.length > 0) {
      preview.errorCount++;
    } else {
      preview.validCount++;
      if (warnings.length > 0) preview.warningCount++;

      // Build sanitized, normalized record
      const scope = classifyAdministrativeScope(raw.locality, raw.address);
      const isDistrict = scope === 'NAGPUR_DISTRICT' || (raw.tehsil && raw.tehsil !== 'Nagpur Urban');
      const normalizedRecord = {
        id: raw.id || crypto.randomUUID(),
        name: raw.name.trim(),
        alternateNames: Array.isArray(raw.alternateNames)
          ? raw.alternateNames
          : typeof raw.alternateNames === 'string'
          ? [raw.alternateNames]
          : [],
        recordType: raw.recordType || 'HOSPITAL',
        recordStatus: raw.recordStatus || (isDuplicate ? 'DUPLICATE' : 'ACTIVE'),
        facilityType: raw.facilityType.trim().toUpperCase(),
        ownership: (raw.ownership || 'UNKNOWN').trim().toUpperCase(),
        contactNumber: phoneNorm.normalized,
        rawContactNumber: raw.contactNumber,
        alternateNumber: raw.alternateNumber ? raw.alternateNumber.trim() : null,
        address: raw.address.trim(),
        locality: raw.locality ? raw.locality.trim() : null,
        tehsil: raw.tehsil ? raw.tehsil.trim() : (isDistrict ? 'Nagpur Rural' : 'Nagpur Urban'),
        coverageGroup: raw.coverageGroup || (isDistrict ? 'NAGPUR_DISTRICT_RURAL' : 'NAGPUR_CITY'),
        city: raw.city ? raw.city.trim() : 'Nagpur',
        district: raw.district ? raw.district.trim() : 'Nagpur',
        state: raw.state ? raw.state.trim() : 'Maharashtra',
        pincode: raw.pincode ? raw.pincode.trim() : null,
        lat: parsedLat,
        lng: parsedLng,
        isGeocoded: parsedLat !== null && parsedLng !== null,
        coordinateQuality: raw.coordinateQuality || (parsedLat !== null ? 'EXACT_ROOFTOP' : 'UNVERIFIED'),
        website: raw.website ? raw.website.trim() : null,
        emergencyHelpline: raw.emergencyPhone || raw.emergencyHelpline || null,
        emergencyPhone: raw.emergencyPhone || raw.emergencyHelpline || null,
        ambulancePhone: raw.ambulancePhone ? raw.ambulancePhone.trim() : null,
        publicEmail: raw.publicEmail ? raw.publicEmail.trim() : null,
        specialties: raw.specialties || null,
        emergencyServicesClaimed: raw.emergencyServicesClaimed === true || Boolean(raw.emergencyPhone),
        sourceUrl: raw.sourceUrl.trim(),
        sourceType: raw.sourceType || 'OFFICIAL_GOVERNMENT_PORTAL',
        sourceRetrievedAt: raw.sourceRetrievedAt ? new Date(raw.sourceRetrievedAt) : new Date(),
        dataProvenance: raw.dataProvenance || 'Authoritative public hospital directory candidate.',
        dataConfidence: raw.dataConfidence || 'DIRECTORY_LISTED',
        lastCheckedAt: raw.lastCheckedAt ? new Date(raw.lastCheckedAt) : new Date(),
        lastVerifiedAt: raw.lastVerifiedAt ? new Date(raw.lastVerifiedAt) : new Date(),
        verificationStatus: raw.verificationStatus || 'VERIFIED',
        contactVerificationStatus: raw.contactVerificationStatus || (phoneNorm.type !== 'INVALID' ? 'VERIFIED' : 'NEEDS_VERIFICATION'),
        lastContactVerifiedAt: raw.lastContactVerifiedAt ? new Date(raw.lastContactVerifiedAt) : null,
        linkStatus: raw.linkStatus || 'UNLINKED', // Strictly UNLINKED by default; public records are not approved LifeLink partners
        onboardingStatus: raw.onboardingStatus || 'PUBLIC_DIRECTORY_RECORD',
        linkedHospitalId: null,
        reviewNotes: isDistrict ? 'Wider Nagpur District Facility' : 'Nagpur City Facility',
        isDuplicate,
        duplicateOfId: isDuplicate && duplicateOf ? duplicateOf : null,
        duplicateGroup: raw.duplicateGroup || null,
        notes: raw.notes || null,
      };

      preview.validRecords.push(normalizedRecord);
    }

    if (errors.length > 0 || warnings.length > 0) {
      preview.issues.push({
        recordIndex: idx,
        recordName: raw.name || `Record #${idx + 1}`,
        errors,
        warnings,
        isDuplicate,
        duplicateOf,
      });
    }
  }

  return preview;
}

// -----------------------------------------------------------------------------
// Ambulance Service Validation & Ingestion Pipeline
// -----------------------------------------------------------------------------

export async function validateAmbulanceBatch(
  records: RawAmbulanceImportItem[]
): Promise<ImportPreviewResult<any>> {
  const preview: ImportPreviewResult<any> = {
    total: records.length,
    validCount: 0,
    warningCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    validRecords: [],
    issues: [],
  };

  const existingServices = await prisma.directoryAmbulanceService.findMany();

  for (let idx = 0; idx < records.length; idx++) {
    const raw = records[idx];
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // 1. Mandatory Service Name
    if (!raw.serviceName || raw.serviceName.trim().length < 3) {
      errors.push({ field: 'serviceName', issue: 'Service name is required (min 3 chars)', severity: 'ERROR' });
    }

    // 2. Mandatory Operator Type
    const validTypes = [
      'PUBLIC_EMERGENCY_SERVICE',
      'HOSPITAL_OPERATED',
      'PRIVATE_OPERATOR',
      'CHARITABLE_TRUST',
    ];
    if (!raw.operatorType || !validTypes.includes(raw.operatorType.trim().toUpperCase())) {
      errors.push({
        field: 'operatorType',
        issue: `Invalid operatorType '${raw.operatorType}'. Must be one of: ${validTypes.join(', ')}`,
        severity: 'ERROR',
      });
    }

    // 3. Contact Number Validation
    const phoneNorm = normalizeIndianDirectoryPhone(raw.contactNumber);
    if (!raw.contactNumber || phoneNorm.type === 'INVALID') {
      errors.push({
        field: 'contactNumber',
        issue: `Invalid Indian contact number '${raw.contactNumber}'. Must be valid landline, 10-digit mobile, or emergency shortcode.`,
        severity: 'ERROR',
      });
    }

    // 4. Coordinates Validation (if provided)
    let parsedLat: number | null = null;
    let parsedLng: number | null = null;
    if (raw.lat !== undefined && raw.lat !== null && raw.lng !== undefined && raw.lng !== null) {
      parsedLat = typeof raw.lat === 'string' ? parseFloat(raw.lat) : raw.lat;
      parsedLng = typeof raw.lng === 'string' ? parseFloat(raw.lng) : raw.lng;
      const coordCheck = validateNagpurCoordinates(parsedLat, parsedLng);
      if (!coordCheck.isValid) {
        errors.push({
          field: 'coordinates',
          issue: coordCheck.issue || 'Invalid geographic coordinates',
          severity: 'ERROR',
        });
      }
    }

    // 5. Source URL Provenance
    if (!raw.sourceUrl || !raw.sourceUrl.startsWith('http')) {
      errors.push({ field: 'sourceUrl', issue: 'Valid source URL provenance required (http/https)', severity: 'ERROR' });
    }

    // 6. Duplicate Detection
    let isDuplicate = false;
    let duplicateOf: string | undefined;

    const allCandidates = [
      ...existingServices,
      ...preview.validRecords.map((r) => ({
        id: r.id || 'batch-item',
        serviceName: r.serviceName,
        contactNumber: r.contactNumber,
      })),
    ];

    for (const cand of allCandidates) {
      const nameSim = calculateNameSimilarity(raw.serviceName, cand.serviceName);
      const isExactPhone = phoneNorm.normalized && phoneNorm.normalized === cand.contactNumber;
      if (nameSim >= 0.85 || isExactPhone) {
        isDuplicate = true;
        duplicateOf = `${cand.serviceName} (${cand.id})`;
        break;
      }
    }

    if (isDuplicate) {
      warnings.push({
        field: 'duplicate',
        issue: `Potential duplicate of existing ambulance service: ${duplicateOf}`,
        severity: 'WARNING',
      });
      preview.duplicateCount++;
    }

    if (errors.length > 0) {
      preview.errorCount++;
    } else {
      preview.validCount++;
      if (warnings.length > 0) preview.warningCount++;

      const isHelpline = ['108', '112', '102'].includes(phoneNorm.normalized);
      const scope = classifyAdministrativeScope(raw.locality, raw.address);
      const isDistrict = scope === 'NAGPUR_DISTRICT' || (raw.tehsil && raw.tehsil !== 'Nagpur Urban') || (raw.operatingArea?.toLowerCase().includes('district') ?? false);
      const normalizedRecord = {
        id: raw.id || crypto.randomUUID(),
        serviceName: raw.serviceName.trim(),
        recordType: raw.recordType || (isHelpline ? 'OFFICIAL_EMERGENCY_HELPLINE' : 'AMBULANCE_PROVIDER'),
        recordStatus: raw.recordStatus || (isDuplicate ? 'DUPLICATE' : 'ACTIVE'),
        operatorType: raw.operatorType.trim().toUpperCase(),
        contactNumber: phoneNorm.normalized,
        rawContactNumber: raw.contactNumber,
        alternateContact: raw.alternateContact ? raw.alternateContact.trim() : null,
        publicBusinessPhone: raw.publicBusinessPhone ? raw.publicBusinessPhone.trim() : phoneNorm.normalized,
        alternatePublicPhone: raw.alternatePublicPhone ? raw.alternatePublicPhone.trim() : (raw.alternateContact ? raw.alternateContact.trim() : null),
        address: raw.address ? raw.address.trim() : null,
        businessAddress: raw.businessAddress ? raw.businessAddress.trim() : (raw.address ? raw.address.trim() : null),
        locality: raw.locality ? raw.locality.trim() : null,
        tehsil: raw.tehsil ? raw.tehsil.trim() : (isDistrict ? 'Nagpur Rural' : 'Nagpur Urban'),
        coverageGroup: raw.coverageGroup || (isDistrict ? 'NAGPUR_DISTRICT_RURAL' : 'NAGPUR_CITY'),
        city: raw.city ? raw.city.trim() : 'Nagpur',
        district: raw.district ? raw.district.trim() : 'Nagpur',
        state: raw.state ? raw.state.trim() : 'Maharashtra',
        operatingArea: raw.operatingArea ? raw.operatingArea.trim() : 'Nagpur District Wide',
        serviceArea: raw.serviceArea ? raw.serviceArea.trim() : (raw.operatingArea ? raw.operatingArea.trim() : 'Nagpur District Wide'),
        advertisedServiceTypes: raw.advertisedServiceTypes || (raw.fleetDescription ? [raw.fleetDescription] : ['BASIC_LIFE_SUPPORT']),
        advertisedIcuOrVentilatorCapability: Boolean(raw.advertisedIcuOrVentilatorCapability),
        lat: parsedLat,
        lng: parsedLng,
        isGeocoded: parsedLat !== null && parsedLng !== null,
        coordinateQuality: raw.coordinateQuality || (parsedLat !== null ? 'LOCALITY_APPROXIMATE' : 'UNVERIFIED'),
        website: raw.website ? raw.website.trim() : null,
        fleetDescription: raw.fleetDescription ? raw.fleetDescription.trim() : null,
        sourceUrl: raw.sourceUrl.trim(),
        sourceType: raw.sourceType || (isHelpline ? 'OFFICIAL_GOVERNMENT_PORTAL' : 'COMMERCIAL_DIRECTORY_LISTING'),
        sourceRetrievedAt: raw.sourceRetrievedAt ? new Date(raw.sourceRetrievedAt) : new Date(),
        dataProvenance: raw.dataProvenance || 'Public ambulance listing candidate. Telephone contact only; not enrolled in live dispatch.',
        dataConfidence: raw.dataConfidence || 'DIRECTORY_LISTED',
        lastCheckedAt: raw.lastCheckedAt ? new Date(raw.lastCheckedAt) : new Date(),
        lastVerifiedAt: raw.lastVerifiedAt ? new Date(raw.lastVerifiedAt) : new Date(),
        verificationStatus: raw.verificationStatus || 'VERIFIED',
        contactVerificationStatus: raw.contactVerificationStatus || (phoneNorm.type !== 'INVALID' ? 'VERIFIED' : 'NEEDS_VERIFICATION'),
        lastContactVerifiedAt: raw.lastContactVerifiedAt ? new Date(raw.lastContactVerifiedAt) : null,
        linkStatus: raw.linkStatus || 'UNLINKED',
        onboardingStatus: raw.onboardingStatus || 'PUBLIC_DIRECTORY_RECORD',
        linkedOperatorId: null,
        linkedHospitalId: null,
        reviewNotes: isDuplicate ? `Flagged duplicate of ${duplicateOf}` : (isDistrict ? 'Wider Nagpur District Ambulance' : 'Nagpur City Ambulance'),
        isDuplicate,
        duplicateOfId: isDuplicate && duplicateOf ? duplicateOf : null,
        notes: raw.notes || null,
      };

      preview.validRecords.push(normalizedRecord);
    }

    if (errors.length > 0 || warnings.length > 0) {
      preview.issues.push({
        recordIndex: idx,
        recordName: raw.serviceName || `Record #${idx + 1}`,
        errors,
        warnings,
        isDuplicate,
        duplicateOf,
      });
    }
  }

  return preview;
}

// -----------------------------------------------------------------------------
// Safe Persistence & Execution Engine
// -----------------------------------------------------------------------------

export async function executeFacilityImport(
  records: any[],
  actorId: string = 'system-admin'
): Promise<{ inserted: number; updated: number; issuesRecorded: number }> {
  let inserted = 0;
  let updated = 0;
  let issuesRecorded = 0;

  for (const item of records) {
    // Check if record already exists by ID or exact Name+City
    const existing = await prisma.directoryFacility.findFirst({
      where: { name: item.name, city: item.city },
    });

    if (existing) {
      await prisma.directoryFacility.update({
        where: { id: existing.id },
        data: {
          ...item,
          updatedAt: new Date(),
        },
      });
      updated++;
    } else {
      const created = await prisma.directoryFacility.create({
        data: item,
      });
      inserted++;

      // If item was flagged with duplicate or coordinate warning, record in DirectoryReviewIssue
      if (item.isDuplicate) {
        await prisma.directoryReviewIssue.create({
          data: {
            entityType: 'FACILITY',
            entityId: created.id,
            issueType: 'POTENTIAL_DUPLICATE',
            severity: 'MEDIUM',
            description: `Facility '${item.name}' flagged as potential duplicate of ${item.duplicateOfId}`,
            status: 'OPEN',
            reportedBy: actorId,
          },
        });
        issuesRecorded++;
      }

      if (!item.isGeocoded) {
        await prisma.directoryReviewIssue.create({
          data: {
            entityType: 'FACILITY',
            entityId: created.id,
            issueType: 'MISSING_COORDINATES',
            severity: 'LOW',
            description: `Facility '${item.name}' has no latitude/longitude coordinates and cannot be mapped.`,
            status: 'OPEN',
            reportedBy: actorId,
          },
        });
        issuesRecorded++;
      }
    }
  }

  logger.logOperation('DIRECTORY_IMPORT', `Imported ${inserted} new facilities, updated ${updated}`, 'SUCCESS', {
    metadata: {
      inserted,
      updated,
      issuesRecorded,
      actorId,
    },
  });

  return { inserted, updated, issuesRecorded };
}

export async function executeAmbulanceImport(
  records: any[],
  actorId: string = 'system-admin'
): Promise<{ inserted: number; updated: number; issuesRecorded: number }> {
  let inserted = 0;
  let updated = 0;
  let issuesRecorded = 0;

  for (const item of records) {
    const existing = await prisma.directoryAmbulanceService.findFirst({
      where: { serviceName: item.serviceName, city: item.city },
    });

    if (existing) {
      await prisma.directoryAmbulanceService.update({
        where: { id: existing.id },
        data: {
          ...item,
          updatedAt: new Date(),
        },
      });
      updated++;
    } else {
      await prisma.directoryAmbulanceService.create({
        data: item,
      });
      inserted++;
    }
  }

  logger.logOperation('DIRECTORY_IMPORT', `Imported ${inserted} ambulance services, updated ${updated}`, 'SUCCESS', {
    metadata: {
      inserted,
      updated,
      issuesRecorded,
      actorId,
    },
  });

  return { inserted, updated, issuesRecorded };
}
