export const FACILITY_TYPE_LABELS: Record<string, string> = {
  MEDICAL_COLLEGE: 'Medical College & Hospital',
  GOVERNMENT_HOSPITAL: 'Government Hospital',
  GOVERNMENT_SPECIALTY: 'Government Specialty Hospital',
  SUB_DISTRICT_HOSPITAL: 'Sub-District Hospital (SDH)',
  RURAL_HOSPITAL: 'Rural Hospital (RH)',
  PRIVATE_MULTISPECIALTY: 'Multispecialty Hospital',
  PRIVATE_SPECIALTY: 'Specialty Hospital',
  CANCER_CENTRE: 'Cancer Hospital & Research',
  CHILDREN_HOSPITAL: "Children's Hospital",
  MATERNITY_HOSPITAL: 'Maternity Hospital',
  EYE_HOSPITAL: 'Eye Hospital',
  TRAUMA_CENTRE: 'Trauma & Critical Care Centre',
  MENTAL_HEALTH: 'Regional Mental Hospital',
  DAYCARE_CLINIC: 'Daycare Clinic & Outpatient',
  INSTITUTIONAL_HEALTH_CENTRE: 'Institutional Health Centre',
  PRIMARY_HEALTH_CENTRE: 'Primary Health Centre (PHC)',
  COMMUNITY_HEALTH_CENTRE: 'Community Health Centre (CHC)',
  GENERAL_HOSPITAL: 'General Hospital',
};

export const AMBULANCE_OPERATOR_LABELS: Record<string, string> = {
  PUBLIC_EMERGENCY_SERVICE: 'Public Emergency Service',
  HOSPITAL_OPERATED: 'Hospital-Operated Fleet',
  PRIVATE_OPERATOR: 'Independent Ambulance Operator',
  CHARITABLE_TRUST: 'Charitable Trust Ambulance',
};

export const AMBULANCE_SERVICE_TYPE_LABELS: Record<string, string> = {
  ADVANCED_LIFE_SUPPORT: 'Advanced Life Support (ALS)',
  BASIC_LIFE_SUPPORT: 'Basic Life Support (BLS)',
  OXYGEN_SUPPORT: 'Medical Oxygen Support',
  ICU_AMBULANCE: 'ICU Ambulance',
  VENTILATOR_AMBULANCE: 'Ventilator Ambulance',
  PATIENT_TRANSPORT: 'Patient Transport',
  ROAD_TRAUMA_RESPONSE: 'Road Trauma Response',
  MATERNITY_TRANSPORT: 'Maternity Transport',
  NEONATAL_TRANSFER: 'Neonatal Transfer',
  POLICE_FIRE_MEDICAL_FIRST_RESPONSE: 'First Response (Police/Fire/Medical)',
  DISASTER_TRIAGE: 'Disaster Triage',
  DEAD_BODY_FREEZER: 'Mortuary Transport',
  OXYGEN_AMBULANCE: 'Oxygen Ambulance',
  CARDIAC_AMBULANCE: 'Cardiac Care Ambulance',
  VENTILATOR_TRANSPORT: 'Ventilator Transport',
  INTERCITY_TRANSIT: 'Intercity Patient Transit',
  ROAD_TRAUMA: 'Road Trauma Care',
  PATIENT_TRANSFER: 'Inter-Facility Transfer',
  EMERGENCY_TRANSFER: 'Emergency Transfer',
  ACCIDENT_RELIEF: 'Accident Relief',
  HIGHWAY_RESPONSE: 'Highway Rapid Response',
  CHARITABLE_PATIENT_TRANSPORT: 'Charitable Patient Transport',
  HOSPITAL_TRANSFER: 'Hospital Transfer Fleet',
  ALS_AMBULANCE: 'ALS Ambulance',
  CRITICAL_INTER_FACILITY: 'Critical Inter-Facility Care',
  ADVANCED_CARDIAC_AMBULANCE: 'Advanced Cardiac Ambulance',
  ICU_VENTILATOR_AMBULANCE: 'ICU Ventilator Ambulance',
  TRAUMA_RETRIEVAL: 'Trauma Retrieval',
  MOBILE_ICU: 'Mobile ICU',
  VENTILATOR_TRANSFER: 'Ventilator Transfer',
  CARDIAC_EMERGENCY: 'Cardiac Emergency Transport',
  ORGAN_RETRIEVAL_TRANSPORT: 'Organ Retrieval Transport',
  CRITICAL_CARE_AMBULANCE: 'Critical Care Ambulance',
  BURNS_PATIENT_TRANSPORT: 'Burns Patient Transport',
  VENTILATOR_SUPPORT: 'Ventilator Support',
  RESPIRATORY_EMERGENCY: 'Respiratory Emergency Care',
  CRITICAL_CARE_MOBILE_ICU: 'Critical Care Mobile ICU',
  STROKE_TRIAGE: 'Stroke Triage Transport',
  PALLIATIVE_TRANSFER: 'Palliative Care Transfer',
};

export const DATA_CONFIDENCE_LABELS: Record<string, { label: string; description: string }> = {
  GOVERNMENT_CONFIRMED: {
    label: 'Government Registry',
    description: 'Verified via Maharashtra State or Municipal health authorities.',
  },
  OFFICIAL_PROVIDER_PUBLISHED: {
    label: 'Official Hospital Portal',
    description: 'Verified directly from the healthcare provider’s official publication.',
  },
  CONTACT_CONFIRMED: {
    label: 'Desk Verified',
    description: 'Direct telephone line verified with facility desk.',
  },
  DIRECTORY_LISTED: {
    label: 'Public Directory',
    description: 'Compiled from authoritative public healthcare directories.',
  },
};

export const COVERAGE_GROUP_LABELS: Record<string, string> = {
  NAGPUR_CITY: 'Nagpur City',
  NAGPUR_DISTRICT_RURAL: 'Nagpur District (Rural Tehsils)',
  ALL: 'Nagpur District (Entire Registry)',
};

export function formatServiceType(raw: string): string {
  if (!raw) return '';
  if (AMBULANCE_SERVICE_TYPE_LABELS[raw]) return AMBULANCE_SERVICE_TYPE_LABELS[raw];
  return raw
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatFacilityCategory(
  rawType?: string | null,
  isHelpline = false,
  isAmbulance = false,
  isHospitalOperated = false
): string {
  if (isHelpline) return 'Official Helpline';
  if (isHospitalOperated) return 'Hospital-Operated Fleet';
  if (isAmbulance) return 'Ambulance Provider';
  if (!rawType) return 'Healthcare Facility';
  if (FACILITY_TYPE_LABELS[rawType]) return FACILITY_TYPE_LABELS[rawType];
  return rawType
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
