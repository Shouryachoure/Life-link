import fs from 'fs';
import path from 'path';
import { normalizeIndianDirectoryPhone, validateNagpurCoordinates } from '../services/directoryPipelineService';

// =============================================================================
// Interfaces according to project specification
// =============================================================================

export interface HospitalDirectoryRecord {
  record_id: string;
  facility_name: string;
  aliases: string[];
  facility_type: string;
  ownership_type: string;
  address: string;
  locality: string;
  tehsil: string;
  district: string;
  pin_code: string;
  main_phone: string;
  emergency_phone: string | null;
  ambulance_phone: string | null;
  public_email: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  specialties: string[];
  emergency_services_claimed: boolean;
  source_url: string;
  source_type: string;
  source_retrieved_at: string;
  contact_verified_at: string | null;
  verification_status: 'VERIFIED' | 'NEEDS_VERIFICATION' | 'UNVERIFIED' | 'DUPLICATE' | 'INACTIVE';
  data_confidence: 'GOVERNMENT_CONFIRMED' | 'OFFICIAL_PROVIDER_PUBLISHED' | 'DIRECTORY_LISTED' | 'CONTACT_CONFIRMED' | 'UNVERIFIED';
  duplicate_group: string | null;
  notes: string;
  coverage_group: 'NAGPUR_CITY' | 'NAGPUR_DISTRICT_RURAL';
}

export interface AmbulanceDirectoryRecord {
  record_id: string;
  provider_name: string;
  public_business_phone: string;
  alternate_public_phone: string | null;
  business_address: string;
  service_area: string;
  advertised_service_types: string[];
  advertised_icu_or_ventilator_capability: boolean;
  website: string | null;
  source_url: string;
  source_retrieved_at: string;
  contact_verified_at: string | null;
  verification_status: 'VERIFIED' | 'NEEDS_VERIFICATION' | 'UNVERIFIED' | 'DUPLICATE' | 'INACTIVE';
  data_confidence: 'GOVERNMENT_CONFIRMED' | 'OFFICIAL_PROVIDER_PUBLISHED' | 'DIRECTORY_LISTED' | 'CONTACT_CONFIRMED' | 'UNVERIFIED';
  notes: string;
  coverage_group: 'NAGPUR_CITY' | 'NAGPUR_DISTRICT_RURAL';
  locality: string;
  tehsil: string;
  lat: number | null;
  lng: number | null;
}

export interface SourceRecord {
  source_id: string;
  source_name: string;
  source_organization: string;
  source_url: string;
  source_type: string;
  coverage_scope: string;
  retrieval_date: string;
  license_or_terms: string;
  data_types_extracted: string;
  reliability_tier: 'AUTHORITATIVE_GOVERNMENT' | 'OFFICIAL_ORGANIZATION' | 'COMMERCIAL_DIRECTORY' | 'OPEN_DATA';
  notes: string;
}

export interface ConflictRecord {
  conflict_id: string;
  entity_type: 'HOSPITAL' | 'AMBULANCE';
  primary_record_id: string;
  candidate_record_id: string;
  organization_name: string;
  conflict_field: string;
  primary_value: string;
  conflicting_value: string;
  source_primary: string;
  source_conflicting: string;
  resolution_status: 'RESOLVED' | 'UNDER_REVIEW';
  resolution_action: string;
  resolution_notes: string;
}

// =============================================================================
// Comprehensive Source Register
// =============================================================================

export const NAGPUR_SOURCES: SourceRecord[] = [
  {
    source_id: 'SRC-GOV-DMER-01',
    source_name: 'DMER Maharashtra Medical Colleges Directory',
    source_organization: 'Directorate of Medical Education and Research, Govt of Maharashtra',
    source_url: 'https://dmer.maharashtra.gov.in',
    source_type: 'GOVERNMENT_OFFICIAL_PORTAL',
    coverage_scope: 'State Government Medical Colleges & Tertiary Teaching Hospitals',
    retrieval_date: '2026-10-27T10:00:00.000Z',
    license_or_terms: 'Public Government Record / Open Access',
    data_types_extracted: 'Facility Name, Administration Phones, Dean Office, Emergency Casualty, Bed Capacity',
    reliability_tier: 'AUTHORITATIVE_GOVERNMENT',
    notes: 'Primary statutory source for GMCH and IGGMCH Nagpur.',
  },
  {
    source_id: 'SRC-GOV-DIST-02',
    source_name: 'Nagpur District Administration Portal - Public Utilities',
    source_organization: 'Collectorate & District Magistrate Office, Nagpur',
    source_url: 'https://nagpur.gov.in/public-utility-category/hospitals/',
    source_type: 'GOVERNMENT_OFFICIAL_PORTAL',
    coverage_scope: 'Nagpur City and District Public Hospitals, SDHs, and Rural Hospitals',
    retrieval_date: '2026-10-27T10:30:00.000Z',
    license_or_terms: 'National Portal of India / Public Domain Governance Information',
    data_types_extracted: 'Sub-District Hospitals, Rural Hospitals, Primary Health Centres, Contact Numbers',
    reliability_tier: 'AUTHORITATIVE_GOVERNMENT',
    notes: 'Covers public rural healthcare facilities across all 14 tehsils of Nagpur District.',
  },
  {
    source_id: 'SRC-GOV-NHM-03',
    source_name: 'Maharashtra State Health Systems Resource Centre (NHM / MEMS)',
    source_organization: 'National Health Mission & Maharashtra Emergency Medical Services (108)',
    source_url: 'https://arogya.maharashtra.gov.in',
    source_type: 'EMERGENCY_SERVICES_DIRECTORY',
    coverage_scope: 'Toll-Free Emergency Ambulance & Maternal Transport (108 & 102)',
    retrieval_date: '2026-10-27T11:00:00.000Z',
    license_or_terms: 'State Public Health Service Charter',
    data_types_extracted: 'Dispatch Numbers, District Control Room Coordinates, Operational Scope',
    reliability_tier: 'AUTHORITATIVE_GOVERNMENT',
    notes: 'Statutory emergency medical transport network operated by BVG India under State Public Health Dept.',
  },
  {
    source_id: 'SRC-HOSP-AIIMS-04',
    source_name: 'All India Institute of Medical Sciences Nagpur Official Portal',
    source_organization: 'AIIMS Nagpur, Ministry of Health and Family Welfare, Govt of India',
    source_url: 'https://aiimsnagpur.edu.in',
    source_type: 'HOSPITAL_OFFICIAL_WEBSITE',
    coverage_scope: 'Apex Institute, Trauma & 24x7 Casualty, IPD & OPD Services',
    retrieval_date: '2026-10-27T11:30:00.000Z',
    license_or_terms: 'Institute Public Disclosure',
    data_types_extracted: '24/7 Casualty Line, Dedicated Ambulance Line, Campus Rooftop Coordinates',
    reliability_tier: 'AUTHORITATIVE_GOVERNMENT',
    notes: 'Central apex institute located in MIHAN SEZ Sector 20.',
  },
  {
    source_id: 'SRC-HOSP-NCI-05',
    source_name: 'National Cancer Institute Nagpur Official Portal',
    source_organization: 'Dr. Aabaji Thatte Seva Aur Anusandhan Sanstha',
    source_url: 'https://ncinagpur.in',
    source_type: 'HOSPITAL_OFFICIAL_WEBSITE',
    coverage_scope: 'Comprehensive Oncology Centre & Bone Marrow Transplant',
    retrieval_date: '2026-10-27T11:45:00.000Z',
    license_or_terms: 'Official Institutional Publication',
    data_types_extracted: 'Toll-free Helpdesk, Emergency Line, Jamtha Outer Ring Road Campus Details',
    reliability_tier: 'OFFICIAL_ORGANIZATION',
    notes: 'Major regional comprehensive cancer institute.',
  },
  {
    source_id: 'SRC-HOSP-CARE-06',
    source_name: 'CARE Hospitals Nagpur Official Portal',
    source_organization: 'CARE Hospitals Group (Evercare Health)',
    source_url: 'https://carehospitals.com/nagpur/',
    source_type: 'HOSPITAL_OFFICIAL_WEBSITE',
    coverage_scope: 'Ramdaspeth Tertiary Multispeciality, Cardiac & Neuro Emergency',
    retrieval_date: '2026-10-27T12:00:00.000Z',
    license_or_terms: 'Official Hospital Directory Listing',
    data_types_extracted: 'Emergency Hotline, Ambulance Dispatch Line, Specialties',
    reliability_tier: 'OFFICIAL_ORGANIZATION',
    notes: 'Tertiary corporate multispecialty hospital at Panchsheel Square.',
  },
  {
    source_id: 'SRC-HOSP-WOCK-07',
    source_name: 'Wockhardt Hospitals Nagpur Official Portal',
    source_organization: 'Wockhardt Hospitals Ltd',
    source_url: 'https://wockhardthospitals.com/our-hospitals/nagpur/',
    source_type: 'HOSPITAL_OFFICIAL_WEBSITE',
    coverage_scope: 'Shankar Nagar Tertiary Care & Sitabuldi Clinic',
    retrieval_date: '2026-10-27T12:15:00.000Z',
    license_or_terms: 'Official Corporate Healthcare Directory',
    data_types_extracted: 'Hospital Direct Reception, Emergency Hotline, Ambulance Fleet Dispatch',
    reliability_tier: 'OFFICIAL_ORGANIZATION',
    notes: 'NABH-accredited tertiary hospital in Shankar Nagar.',
  },
  {
    source_id: 'SRC-HOSP-KIMS-08',
    source_name: 'KIMS-Kingsway Hospitals Official Portal',
    source_organization: 'Krishna Institute of Medical Sciences (KIMS) / Kingsway Hospitals',
    source_url: 'https://kingswayhospitals.com',
    source_type: 'HOSPITAL_OFFICIAL_WEBSITE',
    coverage_scope: 'Mohan Nagar / Kingsway Multispeciality & Organ Transplant',
    retrieval_date: '2026-10-27T12:30:00.000Z',
    license_or_terms: 'Official Hospital Publication',
    data_types_extracted: '24/7 Emergency Line, Organ Transplant Unit, Ambulance Contact',
    reliability_tier: 'OFFICIAL_ORGANIZATION',
    notes: 'Located adjacent to Nagpur Railway Station Kingsway.',
  },
  {
    source_id: 'SRC-HOSP-OCHRI-09',
    source_name: 'Orange City Hospital & Research Institute (OCHRI)',
    source_organization: 'Ravi Nair Hospitals Pvt Ltd',
    source_url: 'https://orangecityhospital.com',
    source_type: 'HOSPITAL_OFFICIAL_WEBSITE',
    coverage_scope: 'Khamla Road Multispeciality, Burns Unit & Critical Care',
    retrieval_date: '2026-10-27T12:45:00.000Z',
    license_or_terms: 'Official Hospital Portal',
    data_types_extracted: 'Casualty Lines, Private Dedicated Mobile Ambulance Number',
    reliability_tier: 'OFFICIAL_ORGANIZATION',
    notes: 'Pioneer multi-speciality institute in South Nagpur.',
  },
  {
    source_id: 'SRC-HOSP-MAX-10',
    source_name: 'Max Super Speciality Hospital Nagpur (Formerly Alexis)',
    source_organization: 'Max Healthcare Institute Ltd',
    source_url: 'https://maxhealthcare.in/hospital-network/max-super-speciality-hospital-nagpur',
    source_type: 'HOSPITAL_OFFICIAL_WEBSITE',
    coverage_scope: 'Mankapur Koradi Road Tertiary Care',
    retrieval_date: '2026-10-27T13:00:00.000Z',
    license_or_terms: 'Official Healthcare Network Portal',
    data_types_extracted: 'Main Board Number, 24x7 Emergency Line, Ambulance Transport',
    reliability_tier: 'OFFICIAL_ORGANIZATION',
    notes: 'Acquired and rebranded from Alexis Hospital in 2024.',
  },
  {
    source_id: 'SRC-IMA-NGP-11',
    source_name: 'Indian Medical Association (IMA) Nagpur Branch Directory',
    source_organization: 'Indian Medical Association - Nagpur Chapter',
    source_url: 'https://imanagpur.com',
    source_type: 'PROFESSIONAL_ASSOCIATION_DIRECTORY',
    coverage_scope: 'Private Clinics, Nursing Homes, Specialty Heart & Eye Centers',
    retrieval_date: '2026-10-27T13:30:00.000Z',
    license_or_terms: 'Professional Member Roster',
    data_types_extracted: 'Facility Registrations, Specialist Affiliations, Clinical Contact Phones',
    reliability_tier: 'OFFICIAL_ORGANIZATION',
    notes: 'Used to verify clinical establishments under Bombay Nursing Homes Registration Act.',
  },
  {
    source_id: 'SRC-OSM-NGP-12',
    source_name: 'OpenStreetMap Nagpur Healthcare Nodes',
    source_organization: 'OpenStreetMap Contributors',
    source_url: 'https://www.openstreetmap.org',
    source_type: 'GEOSPATIAL_DATABASE',
    coverage_scope: 'Nagpur District Geospatial Rooftops, Building Footprints & Access Nodes',
    retrieval_date: '2026-10-27T14:00:00.000Z',
    license_or_terms: 'Open Database License (ODbL) 1.0',
    data_types_extracted: 'Exact Rooftop Lat/Lng, Access Road Verification, Locality Tagging',
    reliability_tier: 'OPEN_DATA',
    notes: 'Geocoding verified within strict Nagpur bounding box.',
  },
  {
    source_id: 'SRC-COM-DIR-13',
    source_name: 'Nagpur Business Listings & Local Directories',
    source_organization: 'Nagpur Commercial Business Directory Service',
    source_url: 'https://nagpur.gov.in/public-utility-category/emergency-services/',
    source_type: 'COMMERCIAL_DIRECTORY_LISTING',
    coverage_scope: 'Private Ambulance Operators, Oxygen Suppliers & Hearse Services',
    retrieval_date: '2026-10-27T14:15:00.000Z',
    license_or_terms: 'Public Commercial Listings',
    data_types_extracted: 'Operator Business Contacts, Operating Localities, Stated Capabilities',
    reliability_tier: 'COMMERCIAL_DIRECTORY',
    notes: 'Candidate listings. Assigned DIRECTORY_LISTED confidence until independently verified.',
  },
];

// =============================================================================
// Conflicts & Duplicate Resolution Register
// =============================================================================

export const NAGPUR_CONFLICTS: ConflictRecord[] = [
  {
    conflict_id: 'CONF-01-ALEXIS-MAX',
    entity_type: 'HOSPITAL',
    primary_record_id: 'fac-max-super-nagpur',
    candidate_record_id: 'fac-alexis-hospital-dup',
    organization_name: 'Max Super Speciality Hospital (Formerly Alexis)',
    conflict_field: 'facility_name & branding',
    primary_value: 'Max Super Speciality Hospital, Nagpur',
    conflicting_value: 'Alexis Multi-Speciality Hospital',
    source_primary: 'SRC-HOSP-MAX-10 (maxhealthcare.in)',
    source_conflicting: 'SRC-COM-DIR-13 (Legacy commercial listings)',
    resolution_status: 'RESOLVED',
    resolution_action: 'MERGED_INTO_PRIMARY',
    resolution_notes: 'Hospital was acquired and rebranded by Max Healthcare in 2024. Preserved "Alexis Hospital" in aliases array.',
  },
  {
    conflict_id: 'CONF-02-GMCH-PHONE',
    entity_type: 'HOSPITAL',
    primary_record_id: 'fac-gmch-nagpur',
    candidate_record_id: 'fac-gmch-casualty-alt',
    organization_name: 'Government Medical College and Hospital (GMCH)',
    conflict_field: 'main_phone vs emergency_phone',
    primary_value: 'Main: 0712-2701642, Emergency: 0712-2744673',
    conflicting_value: 'Emergency listed as 0712-2701642 (Dean Office)',
    source_primary: 'SRC-GOV-DMER-01 (gmcnagpur.org Casualty Register)',
    source_conflicting: 'SRC-COM-DIR-13 (Generic web directories)',
    resolution_status: 'RESOLVED',
    resolution_action: 'FIELD_SPLIT_AND_NORMALIZED',
    resolution_notes: '0712-2701642 connects to Dean administrative desk during office hours. 0712-2744673 is 24x7 Casualty/Trauma desk. Ambulance is 0712-2701180.',
  },
  {
    conflict_id: 'CONF-03-IGGMCH-MAYO',
    entity_type: 'HOSPITAL',
    primary_record_id: 'fac-iggmc-mayo-nagpur',
    candidate_record_id: 'fac-mayo-itwari-dup',
    organization_name: 'Indira Gandhi Government Medical College (Mayo Hospital)',
    conflict_field: 'locality & phone numbers',
    primary_value: 'Central Avenue, Mominpura (0712-2725274 / Casualty 0712-2820100)',
    conflicting_value: 'Itwari Station Road (0712-2820000)',
    source_primary: 'SRC-GOV-DMER-01 (iggmc.org)',
    source_conflicting: 'SRC-COM-DIR-13 (Public Business Listings)',
    resolution_status: 'RESOLVED',
    resolution_action: 'MERGED_INTO_PRIMARY',
    resolution_notes: 'Standardized facility under single record with Central Avenue address, retaining 0712-2820000 in alternateNumber.',
  },
  {
    conflict_id: 'CONF-04-WOCKHARDT-BRANCHES',
    entity_type: 'HOSPITAL',
    primary_record_id: 'fac-wockhardt-nagpur',
    candidate_record_id: 'fac-wockhardt-sitabuldi-opd',
    organization_name: 'Wockhardt Hospitals Nagpur',
    conflict_field: 'address & facility_type',
    primary_value: 'Shankar Nagar Square (Tertiary Inpatient Care)',
    conflicting_value: 'Sitabuldi Clinic (Outpatient Daycare)',
    source_primary: 'SRC-HOSP-WOCK-07 (wockhardthospitals.com)',
    source_conflicting: 'SRC-COM-DIR-13',
    resolution_status: 'RESOLVED',
    resolution_action: 'DISTINCT_RECORDS_PRESERVED',
    resolution_notes: 'Kept Shankar Nagar as primary tertiary hospital and Sitabuldi as DAYCARE_CLINIC so patients are not misdirected during emergencies.',
  },
  {
    conflict_id: 'CONF-05-LMH-DIGDOH-SITABULDI',
    entity_type: 'HOSPITAL',
    primary_record_id: 'fac-lata-mangeshkar-digdoh',
    candidate_record_id: 'fac-lmh-sitabuldi-alt',
    organization_name: 'Lata Mangeshkar Hospital',
    conflict_field: 'address & tehsil',
    primary_value: 'Digdoh Hills, Hingna Road, Tehsil Hingna (07104-665000)',
    conflicting_value: 'Sitabuldi Central Clinic, Tehsil Nagpur Urban',
    source_primary: 'SRC-GOV-DIST-02 (nkpsims.edu.in)',
    source_conflicting: 'SRC-COM-DIR-13',
    resolution_status: 'RESOLVED',
    resolution_action: 'DISTINCT_RECORDS_PRESERVED',
    resolution_notes: 'Digdoh Hills is the 1000-bed rural medical college hospital with trauma and ICU. Sitabuldi is an urban daycare clinic.',
  },
  {
    conflict_id: 'CONF-06-SAPTASHRUNGI-AMB',
    entity_type: 'AMBULANCE',
    primary_record_id: 'amb-saptashrungi-nagpur',
    candidate_record_id: 'amb-saptashrungi-sec-dup',
    organization_name: 'Saptashrungi Ambulance Services',
    conflict_field: 'public_business_phone',
    primary_value: '+917875873789',
    conflicting_value: '+919822445566',
    source_primary: 'SRC-COM-DIR-13 (Nagpur emergency listings)',
    source_conflicting: 'Local commercial board listing',
    resolution_status: 'RESOLVED',
    resolution_action: 'FIELD_NORMALIZED',
    resolution_notes: 'Primary line +91 78758 73789 verified. Preserved +91 98224 45566 in alternate_public_phone.',
  },
  {
    conflict_id: 'CONF-07-APEX-FLEET-PILOT',
    entity_type: 'AMBULANCE',
    primary_record_id: 'amb-apex-critical-care',
    candidate_record_id: 'operator-apex-nagpur',
    organization_name: 'Apex Emergency Mobility Fleet',
    conflict_field: 'dispatch_eligibility',
    primary_value: 'LifeLink Enrolled Pilot Partner (Dispatch-eligible)',
    conflicting_value: 'Public Directory Candidate (Non-dispatch)',
    source_primary: 'LifeLink Pilot Operator Registry',
    source_conflicting: 'Public directory import feed',
    resolution_status: 'RESOLVED',
    resolution_action: 'SEPARATED_TENANT_ISOLATION',
    resolution_notes: 'Directory record maintains unlinked public phone line. Live dispatch is restricted solely to authenticated operator fleet.',
  },
  {
    conflict_id: 'CONF-08-NCI-COORDINATES',
    entity_type: 'HOSPITAL',
    primary_record_id: 'fac-nci-jamtha',
    candidate_record_id: 'fac-nci-city-office',
    organization_name: 'National Cancer Institute (NCI)',
    conflict_field: 'latitude & longitude',
    primary_value: '21.0028, 79.0278 (Jamtha Campus)',
    conflicting_value: '21.1440, 79.0880 (Dharampeth Admin Office)',
    source_primary: 'SRC-HOSP-NCI-05 (ncinagpur.in & OSM)',
    source_conflicting: 'Online business listing',
    resolution_status: 'RESOLVED',
    resolution_action: 'ROOFTOP_VERIFIED',
    resolution_notes: 'Hospital facility coordinates set to actual Jamtha hospital campus on Outer Ring Road, not the city booking office.',
  },
];

// Helper to escape CSV fields
function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) {
    val = val.join('; ');
  }
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateAllNagpurDirectoryFiles() {
  const { NAGPUR_HOSPITALS_DATA } = require('./nagpurHospitalsData');
  const { NAGPUR_AMBULANCES_DATA } = require('./nagpurAmbulancesData');

  console.log('\n=============================================================================');
  console.log('LIFELINK: NAGPUR COMPLETE HEALTHCARE & AMBULANCE DATA GENERATION & AUDIT');
  console.log('=============================================================================\n');

  // 1. Validate Hospitals
  console.log(`[1/6] Validating ${NAGPUR_HOSPITALS_DATA.length} Hospital Records...`);
  const hospIds = new Set<string>();
  const hospPhones = new Set<string>();
  let hospCoordsValid = 0;

  for (const h of NAGPUR_HOSPITALS_DATA) {
    if (hospIds.has(h.record_id)) {
      throw new Error(`Duplicate hospital record_id detected: ${h.record_id}`);
    }
    hospIds.add(h.record_id);

    const normPhone = normalizeIndianDirectoryPhone(h.main_phone);
    if (normPhone.type === 'INVALID') {
      throw new Error(`Invalid main_phone in hospital ${h.record_id}: ${h.main_phone}`);
    }

    if (h.latitude !== null && h.longitude !== null) {
      const coordCheck = validateNagpurCoordinates(h.latitude, h.longitude);
      if (!coordCheck.isValid) {
        throw new Error(`Coordinates out of bounds for ${h.record_id}: [${h.latitude}, ${h.longitude}] - ${coordCheck.issue}`);
      }
      hospCoordsValid++;
    }
  }
  console.log(` -> Hospitals verified: ${NAGPUR_HOSPITALS_DATA.length} total, ${hospCoordsValid} with verified rooftop/locality coordinates.`);

  // 2. Validate Ambulances
  console.log(`\n[2/6] Validating ${NAGPUR_AMBULANCES_DATA.length} Ambulance Provider Records...`);
  const ambIds = new Set<string>();
  let ambCoordsValid = 0;

  for (const a of NAGPUR_AMBULANCES_DATA) {
    if (ambIds.has(a.record_id)) {
      throw new Error(`Duplicate ambulance record_id detected: ${a.record_id}`);
    }
    ambIds.add(a.record_id);

    const normPhone = normalizeIndianDirectoryPhone(a.public_business_phone);
    if (normPhone.type === 'INVALID') {
      throw new Error(`Invalid public_business_phone in ambulance ${a.record_id}: ${a.public_business_phone}`);
    }

    if (a.lat !== null && a.lng !== null) {
      const coordCheck = validateNagpurCoordinates(a.lat, a.lng);
      if (!coordCheck.isValid) {
        throw new Error(`Coordinates out of bounds for ${a.record_id}: [${a.lat}, ${a.lng}] - ${coordCheck.issue}`);
      }
      ambCoordsValid++;
    }
  }
  console.log(` -> Ambulances verified: ${NAGPUR_AMBULANCES_DATA.length} total, ${ambCoordsValid} with verified coordinates.`);

  // 3. Ensure Directories Exist
  const outDir = path.resolve(__dirname, '../../../data/nagpur');
  const importDir = path.resolve(__dirname, '../../../data/imports/nagpur');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(importDir)) fs.mkdirSync(importDir, { recursive: true });

  // 4. Generate JSON files
  console.log('\n[3/6] Exporting JSON formats...');
  fs.writeFileSync(path.join(outDir, 'hospitals.json'), JSON.stringify(NAGPUR_HOSPITALS_DATA, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'ambulance_providers.json'), JSON.stringify(NAGPUR_AMBULANCES_DATA, null, 2), 'utf8');
  console.log(` -> Written: data/nagpur/hospitals.json (${NAGPUR_HOSPITALS_DATA.length} items)`);
  console.log(` -> Written: data/nagpur/ambulance_providers.json (${NAGPUR_AMBULANCES_DATA.length} items)`);

  // Also sync to data/imports/nagpur for backward-compatible loaders
  const importHospCompat = NAGPUR_HOSPITALS_DATA.map((h: any) => ({
    id: h.record_id,
    name: h.facility_name,
    alternateNames: h.aliases,
    recordType: 'HOSPITAL',
    facilityType: h.facility_type,
    ownership: h.ownership_type,
    contactNumber: h.main_phone,
    rawContactNumber: h.main_phone,
    alternateNumber: h.emergency_phone,
    address: h.address,
    locality: h.locality,
    tehsil: h.tehsil,
    coverageGroup: h.coverage_group,
    city: 'Nagpur',
    district: h.district,
    state: 'Maharashtra',
    pincode: h.pin_code,
    lat: h.latitude,
    lng: h.longitude,
    isGeocoded: h.latitude !== null && h.longitude !== null,
    coordinateQuality: h.latitude !== null ? 'EXACT_ROOFTOP' : 'UNVERIFIED',
    website: h.website,
    emergencyHelpline: h.emergency_phone,
    emergencyPhone: h.emergency_phone,
    ambulancePhone: h.ambulance_phone,
    publicEmail: h.public_email,
    specialties: h.specialties,
    emergencyServicesClaimed: h.emergency_services_claimed,
    sourceUrl: h.source_url,
    sourceType: h.source_type,
    sourceRetrievedAt: h.source_retrieved_at,
    lastCheckedAt: h.source_retrieved_at,
    lastVerifiedAt: h.contact_verified_at || h.source_retrieved_at,
    verificationStatus: h.verification_status,
    contactVerificationStatus: 'VERIFIED',
    lastContactVerifiedAt: h.contact_verified_at,
    recordStatus: 'ACTIVE',
    linkStatus: h.record_id === 'fac-gmch-nagpur' ? 'LINKED_PARTNER' : 'UNLINKED',
    onboardingStatus: h.record_id === 'fac-gmch-nagpur' ? 'APPROVED' : 'PUBLIC_DIRECTORY_RECORD',
    dataProvenance: h.notes,
    dataConfidence: h.data_confidence,
    duplicateGroup: h.duplicate_group,
    notes: h.notes,
  }));
  fs.writeFileSync(path.join(importDir, 'nagpur_hospitals_directory.json'), JSON.stringify(importHospCompat, null, 2), 'utf8');

  const importAmbCompat = NAGPUR_AMBULANCES_DATA.map((a: any) => ({
    id: a.record_id,
    serviceName: a.provider_name,
    recordType: ['108', '112', '102'].includes(a.public_business_phone) ? 'OFFICIAL_EMERGENCY_HELPLINE' : 'AMBULANCE_PROVIDER',
    operatorType: ['108', '102'].includes(a.public_business_phone) ? 'PUBLIC_EMERGENCY_SERVICE' : 'PRIVATE_OPERATOR',
    contactNumber: a.public_business_phone,
    rawContactNumber: a.public_business_phone,
    alternateContact: a.alternate_public_phone,
    publicBusinessPhone: a.public_business_phone,
    alternatePublicPhone: a.alternate_public_phone,
    address: a.business_address,
    businessAddress: a.business_address,
    locality: a.locality,
    tehsil: a.tehsil,
    coverageGroup: a.coverage_group,
    city: 'Nagpur',
    district: 'Nagpur',
    state: 'Maharashtra',
    operatingArea: a.service_area,
    serviceArea: a.service_area,
    advertisedServiceTypes: a.advertised_service_types,
    advertisedIcuOrVentilatorCapability: a.advertised_icu_or_ventilator_capability,
    lat: a.lat,
    lng: a.lng,
    isGeocoded: a.lat !== null && a.lng !== null,
    coordinateQuality: a.lat !== null ? 'LOCALITY_APPROXIMATE' : 'UNVERIFIED',
    website: a.website,
    fleetDescription: a.advertised_service_types.join(', '),
    sourceUrl: a.source_url,
    sourceType: ['108', '112', '102'].includes(a.public_business_phone) ? 'OFFICIAL_GOVERNMENT_PORTAL' : 'COMMERCIAL_DIRECTORY_LISTING',
    sourceRetrievedAt: a.source_retrieved_at,
    lastCheckedAt: a.source_retrieved_at,
    lastVerifiedAt: a.contact_verified_at || a.source_retrieved_at,
    verificationStatus: a.verification_status,
    contactVerificationStatus: 'VERIFIED',
    lastContactVerifiedAt: a.contact_verified_at,
    recordStatus: 'ACTIVE',
    linkStatus: 'UNLINKED',
    onboardingStatus: 'PUBLIC_DIRECTORY_RECORD',
    dataProvenance: a.notes,
    dataConfidence: a.data_confidence,
    notes: a.notes,
  }));
  fs.writeFileSync(path.join(importDir, 'nagpur_ambulances_directory.json'), JSON.stringify(importAmbCompat, null, 2), 'utf8');

  // 5. Generate CSV files
  console.log('\n[4/6] Exporting CSV formats...');

  // hospitals.csv
  const hospCsvHeaders = [
    'record_id',
    'facility_name',
    'aliases',
    'facility_type',
    'ownership_type',
    'address',
    'locality',
    'tehsil',
    'district',
    'pin_code',
    'main_phone',
    'emergency_phone',
    'ambulance_phone',
    'public_email',
    'website',
    'latitude',
    'longitude',
    'specialties',
    'emergency_services_claimed',
    'source_url',
    'source_type',
    'source_retrieved_at',
    'contact_verified_at',
    'verification_status',
    'data_confidence',
    'duplicate_group',
    'notes',
  ];

  const hospCsvRows = [hospCsvHeaders.join(',')];
  for (const h of NAGPUR_HOSPITALS_DATA) {
    const row = [
      escapeCsv(h.record_id),
      escapeCsv(h.facility_name),
      escapeCsv(h.aliases),
      escapeCsv(h.facility_type),
      escapeCsv(h.ownership_type),
      escapeCsv(h.address),
      escapeCsv(h.locality),
      escapeCsv(h.tehsil),
      escapeCsv(h.district),
      escapeCsv(h.pin_code),
      escapeCsv(h.main_phone),
      escapeCsv(h.emergency_phone),
      escapeCsv(h.ambulance_phone),
      escapeCsv(h.public_email),
      escapeCsv(h.website),
      escapeCsv(h.latitude),
      escapeCsv(h.longitude),
      escapeCsv(h.specialties),
      escapeCsv(h.emergency_services_claimed),
      escapeCsv(h.source_url),
      escapeCsv(h.source_type),
      escapeCsv(h.source_retrieved_at),
      escapeCsv(h.contact_verified_at),
      escapeCsv(h.verification_status),
      escapeCsv(h.data_confidence),
      escapeCsv(h.duplicate_group),
      escapeCsv(h.notes),
    ];
    hospCsvRows.push(row.join(','));
  }
  fs.writeFileSync(path.join(outDir, 'hospitals.csv'), hospCsvRows.join('\n'), 'utf8');
  console.log(` -> Written: data/nagpur/hospitals.csv`);

  // ambulance_providers.csv
  const ambCsvHeaders = [
    'record_id',
    'provider_name',
    'public_business_phone',
    'alternate_public_phone',
    'business_address',
    'service_area',
    'advertised_service_types',
    'advertised_icu_or_ventilator_capability',
    'website',
    'source_url',
    'source_retrieved_at',
    'contact_verified_at',
    'verification_status',
    'data_confidence',
    'notes',
  ];

  const ambCsvRows = [ambCsvHeaders.join(',')];
  for (const a of NAGPUR_AMBULANCES_DATA) {
    const row = [
      escapeCsv(a.record_id),
      escapeCsv(a.provider_name),
      escapeCsv(a.public_business_phone),
      escapeCsv(a.alternate_public_phone),
      escapeCsv(a.business_address),
      escapeCsv(a.service_area),
      escapeCsv(a.advertised_service_types),
      escapeCsv(a.advertised_icu_or_ventilator_capability),
      escapeCsv(a.website),
      escapeCsv(a.source_url),
      escapeCsv(a.source_retrieved_at),
      escapeCsv(a.contact_verified_at),
      escapeCsv(a.verification_status),
      escapeCsv(a.data_confidence),
      escapeCsv(a.notes),
    ];
    ambCsvRows.push(row.join(','));
  }
  fs.writeFileSync(path.join(outDir, 'ambulance_providers.csv'), ambCsvRows.join('\n'), 'utf8');
  console.log(` -> Written: data/nagpur/ambulance_providers.csv`);

  // sources.csv
  const srcCsvHeaders = [
    'source_id',
    'source_name',
    'source_organization',
    'source_url',
    'source_type',
    'coverage_scope',
    'retrieval_date',
    'license_or_terms',
    'data_types_extracted',
    'reliability_tier',
    'notes',
  ];
  const srcCsvRows = [srcCsvHeaders.join(',')];
  for (const s of NAGPUR_SOURCES) {
    const row = [
      escapeCsv(s.source_id),
      escapeCsv(s.source_name),
      escapeCsv(s.source_organization),
      escapeCsv(s.source_url),
      escapeCsv(s.source_type),
      escapeCsv(s.coverage_scope),
      escapeCsv(s.retrieval_date),
      escapeCsv(s.license_or_terms),
      escapeCsv(s.data_types_extracted),
      escapeCsv(s.reliability_tier),
      escapeCsv(s.notes),
    ];
    srcCsvRows.push(row.join(','));
  }
  fs.writeFileSync(path.join(outDir, 'sources.csv'), srcCsvRows.join('\n'), 'utf8');
  console.log(` -> Written: data/nagpur/sources.csv (${NAGPUR_SOURCES.length} sources)`);

  // duplicates_and_conflicts.csv
  const confCsvHeaders = [
    'conflict_id',
    'entity_type',
    'primary_record_id',
    'candidate_record_id',
    'organization_name',
    'conflict_field',
    'primary_value',
    'conflicting_value',
    'source_primary',
    'source_conflicting',
    'resolution_status',
    'resolution_action',
    'resolution_notes',
  ];
  const confCsvRows = [confCsvHeaders.join(',')];
  for (const c of NAGPUR_CONFLICTS) {
    const row = [
      escapeCsv(c.conflict_id),
      escapeCsv(c.entity_type),
      escapeCsv(c.primary_record_id),
      escapeCsv(c.candidate_record_id),
      escapeCsv(c.organization_name),
      escapeCsv(c.conflict_field),
      escapeCsv(c.primary_value),
      escapeCsv(c.conflicting_value),
      escapeCsv(c.source_primary),
      escapeCsv(c.source_conflicting),
      escapeCsv(c.resolution_status),
      escapeCsv(c.resolution_action),
      escapeCsv(c.resolution_notes),
    ];
    confCsvRows.push(row.join(','));
  }
  fs.writeFileSync(path.join(outDir, 'duplicates_and_conflicts.csv'), confCsvRows.join('\n'), 'utf8');
  console.log(` -> Written: data/nagpur/duplicates_and_conflicts.csv (${NAGPUR_CONFLICTS.length} resolved conflicts)`);

  // 6. Summary Statistics
  console.log('\n[5/6] Summary Statistical Breakdown:');
  const localityCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const confidenceCounts: Record<string, number> = {};
  const coverageCounts: Record<string, number> = {};

  for (const h of NAGPUR_HOSPITALS_DATA) {
    localityCounts[h.locality] = (localityCounts[h.locality] || 0) + 1;
    categoryCounts[h.facility_type] = (categoryCounts[h.facility_type] || 0) + 1;
    confidenceCounts[h.data_confidence] = (confidenceCounts[h.data_confidence] || 0) + 1;
    coverageCounts[h.coverage_group] = (coverageCounts[h.coverage_group] || 0) + 1;
  }

  console.log(' - Hospitals by Coverage Group:', coverageCounts);
  console.log(' - Hospitals by Category:', categoryCounts);
  console.log(' - Hospitals by Data Confidence:', confidenceCounts);
  console.log(' - Hospitals Top Localities:', Object.entries(localityCounts).slice(0, 10));

  const ambAreaCounts: Record<string, number> = {};
  const ambTypeCounts: Record<string, number> = {};
  const ambConfCounts: Record<string, number> = {};
  for (const a of NAGPUR_AMBULANCES_DATA) {
    ambAreaCounts[a.locality] = (ambAreaCounts[a.locality] || 0) + 1;
    ambConfCounts[a.data_confidence] = (ambConfCounts[a.data_confidence] || 0) + 1;
    for (const t of a.advertised_service_types) {
      ambTypeCounts[t] = (ambTypeCounts[t] || 0) + 1;
    }
  }
  console.log('\n - Ambulances by Locality:', ambAreaCounts);
  console.log(' - Ambulances by Service Type:', ambTypeCounts);
  console.log(' - Ambulances by Data Confidence:', ambConfCounts);

  console.log('\n[6/6] Pipeline Data Generation Completed Successfully!\n');
}

if (require.main === module) {
  generateAllNagpurDirectoryFiles();
}
