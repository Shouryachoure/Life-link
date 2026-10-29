/**
 * LifeLink India — Multi-City Localization & Geographic Formatting Utilities
 * 
 * Provides robust helpers for:
 * 1. Indian telephone number normalization, formatting (+91 XXXXX XXXXX), and masking
 * 2. Standard Indian address formatting, postal code (PIN Code) validation
 * 3. Currency formatting in Indian Rupees (INR / ₹) with Lakh/Crore grouping
 * 4. India-local timezone handling (Asia/Kolkata - IST, UTC+5:30) and timestamp formatting
 * 5. Configurable operational schedules per city and hospital facility
 * 6. Multi-language domain vocabulary dictionary (English, Hindi, Marathi)
 */

import { normalizeIndianPhone } from './phoneUtils';

// -------------------------------------------------------------
// 1. Telephone Number Formatting & Masking
// -------------------------------------------------------------

export type PhoneFormatStyle = 'STANDARD' | 'DASH' | 'COMPACT' | 'E164';

/**
 * Formats an Indian phone number into standard national or international formats.
 * Example: '9876543210' -> '+91 98765 43210' (STANDARD) or '+91-98765-43210' (DASH)
 */
export function formatIndianPhone(
  rawPhone: string | null | undefined,
  style: PhoneFormatStyle = 'STANDARD'
): string {
  const norm = normalizeIndianPhone(rawPhone);
  if (!norm.isValid || !norm.normalized) {
    return rawPhone ? String(rawPhone).trim() : '';
  }

  // norm.normalized is always +91XXXXXXXXXX (13 chars)
  const digits = norm.normalized.slice(3); // 10 digits
  const part1 = digits.slice(0, 5);
  const part2 = digits.slice(5);

  switch (style) {
    case 'STANDARD':
      return `+91 ${part1} ${part2}`;
    case 'DASH':
      return `+91-${part1}-${part2}`;
    case 'COMPACT':
      return `0${digits}`;
    case 'E164':
    default:
      return norm.normalized;
  }
}

/**
 * Masks an Indian mobile number, concealing sensitive middle digits for DPDP compliance.
 * Example: '+919876543210' -> '+91 98*** **210'
 */
export function maskIndianPhone(rawPhone: string | null | undefined): string {
  const norm = normalizeIndianPhone(rawPhone);
  if (!norm.isValid || !norm.normalized) {
    return rawPhone ? String(rawPhone).trim() : '';
  }

  const digits = norm.normalized.slice(3); // 10 digits
  const prefix = digits.slice(0, 2);
  const suffix = digits.slice(6);
  return `+91 ${prefix}*** **${suffix.slice(1)}`;
}

// -------------------------------------------------------------
// 2. Indian Address Formatting & PIN Code Validation
// -------------------------------------------------------------

export interface IndianAddress {
  line1: string;          // Building, Flat, House Number, Street
  line2?: string;         // Locality, Sector, Landmark, Mohalla
  locality?: string;      // Locality alias for line2
  city: string;           // City/Town (e.g. Nagpur, Pune, Mumbai)
  district?: string;      // District (e.g. Nagpur District)
  state: string;          // State (e.g. Maharashtra, Karnataka)
  pincode?: string;       // 6-digit Postal Index Number (PIN Code)
  pinCode?: string;       // Alias for pincode
  country?: string;       // Default: India
}

// Indian PIN Code regex: 6 digits, first digit cannot be 0 (1-9)
const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;

/**
 * Validates standard Indian Postal Index Number (PIN Code).
 */
export function isValidIndianPincode(pincode: string | null | undefined): boolean {
  if (!pincode || typeof pincode !== 'string') return false;
  return INDIAN_PINCODE_REGEX.test(pincode.trim());
}

/**
 * Formats a structured Indian address into a clean, standardized single-line or multi-line string.
 */
export function formatIndianAddress(
  addr: Partial<IndianAddress>,
  options?: { multiLine?: boolean }
): string {
  if (!addr) return '';

  const parts: string[] = [];
  if (addr.line1?.trim()) parts.push(addr.line1.trim());
  if (addr.line2?.trim()) parts.push(addr.line2.trim());
  if (addr.locality?.trim() && addr.locality.trim() !== addr.line2?.trim()) parts.push(addr.locality.trim());
  if (addr.city?.trim()) parts.push(addr.city.trim());
  if (addr.district?.trim() && addr.district.trim().toLowerCase() !== addr.city?.trim().toLowerCase()) {
    parts.push(addr.district.trim());
  }

  let stateAndPin = '';
  if (addr.state?.trim()) stateAndPin += addr.state.trim();
  const pin = addr.pincode?.trim() || addr.pinCode?.trim();
  if (pin) {
    stateAndPin += (stateAndPin ? ', ' : '') + pin;
  }
  if (stateAndPin) parts.push(stateAndPin);

  const country = addr.country?.trim() || 'India';
  parts.push(country);

  const separator = options?.multiLine ? '\n' : ', ';
  return parts.join(separator);
}

/**
 * Validates mandatory fields and PIN code for an Indian address record.
 */
export function validateIndianAddress(addr: Partial<IndianAddress>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!addr.line1 || !addr.line1.trim()) {
    errors.push('Address Line 1 is required.');
  }
  if (!addr.city || !addr.city.trim()) {
    errors.push('City is required.');
  }
  if (!addr.state || !addr.state.trim()) {
    errors.push('State is required.');
  }
  if (!addr.pincode || !addr.pincode.trim()) {
    errors.push('PIN code is required.');
  } else if (!isValidIndianPincode(addr.pincode)) {
    errors.push('Invalid Indian PIN code. Must be exactly 6 digits starting with 1-9.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// -------------------------------------------------------------
// 3. Indian Currency Formatting (INR / ₹)
// -------------------------------------------------------------

/**
 * Formats monetary amounts in Indian Rupees (INR / ₹) adhering to the Indian Numbering System
 * (Lakhs and Crores e.g. ₹1,50,000 instead of international ₹150,000).
 */
export function formatCurrencyINR(
  amount: number,
  options?: { showPaisa?: boolean; symbol?: boolean }
): string {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return '₹0';
  }

  const showPaisa = options?.showPaisa ?? false;
  const includeSymbol = options?.symbol ?? true;

  try {
    const formatter = new Intl.NumberFormat('en-IN', {
      style: includeSymbol ? 'currency' : 'decimal',
      currency: 'INR',
      minimumFractionDigits: showPaisa ? 2 : 0,
      maximumFractionDigits: showPaisa ? 2 : 0,
    });

    return formatter.format(amount);
  } catch {
    // Graceful fallback if Intl runtime is limited
    const sign = amount < 0 ? '-' : '';
    const abs = Math.abs(amount).toFixed(showPaisa ? 2 : 0);
    return `${sign}${includeSymbol ? '₹' : ''}${abs}`;
  }
}

// -------------------------------------------------------------
// 4. India-Local Dates, Times & Timezone Handling (Asia/Kolkata / IST)
// -------------------------------------------------------------

export const INDIAN_TIMEZONE = 'Asia/Kolkata';

/**
 * Formats a Date or UTC ISO timestamp into India Standard Time (IST) date string (DD/MM/YYYY).
 */
export function formatDateIST(dateInput: Date | string | number): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIAN_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Formats a Date or UTC ISO timestamp into India Standard Time (IST) time string (hh:mm A IST).
 */
export function formatTimeIST(dateInput: Date | string | number): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';

  const timeStr = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIAN_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);

  return `${timeStr} IST`;
}

/**
 * Formats a Date or UTC ISO timestamp into full localized India Standard Time (DD/MM/YYYY, hh:mm A IST).
 */
export function formatDateTimeIST(dateInput: Date | string | number): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';

  const datePart = formatDateIST(d);
  const timePart = formatTimeIST(d);
  return `${datePart}, ${timePart}`;
}

/**
 * Returns current date string in Asia/Kolkata (YYYY-MM-DD).
 */
export function getTodayDateStringIST(referenceDate?: Date): string {
  const d = referenceDate || new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIAN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

/**
 * Parses date string (YYYY-MM-DD) and time string (HH:MM) as Asia/Kolkata (IST, UTC+5:30) Date.
 */
export function parseSlotISTDateTime(dateStr: string, timeStr: string): Date {
  const cleanDate = dateStr.trim();
  const cleanTime = timeStr.trim().length === 5 ? timeStr.trim() : timeStr.trim().padStart(5, '0');
  return new Date(`${cleanDate}T${cleanTime}:00+05:30`);
}

/**
 * Checks whether a slot in Asia/Kolkata is in the past relative to current time.
 */
export function isSlotInPastIST(dateStr: string, timeStr: string, referenceDate?: Date): boolean {
  const slotInstant = parseSlotISTDateTime(dateStr, timeStr);
  const now = referenceDate || new Date();
  return slotInstant.getTime() < now.getTime();
}

/**
 * Generates discrete time slots between startTime and endTime with specified duration in minutes.
 */
export function generateTimeSlots(
  startTime: string,
  endTime: string,
  durationMinutes: number = 15
): { startTime: string; endTime: string }[] {
  const parseMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const formatMinutes = (m: number) => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };

  const startMin = parseMinutes(startTime);
  const endMin = parseMinutes(endTime);
  const duration = Math.max(5, Math.min(180, durationMinutes));

  const slots: { startTime: string; endTime: string }[] = [];
  let curr = startMin;

  while (curr + duration <= endMin) {
    slots.push({
      startTime: formatMinutes(curr),
      endTime: formatMinutes(curr + duration),
    });
    curr += duration;
  }

  return slots;
}

// -------------------------------------------------------------
// 5. Operational Schedules per City and Facility
// -------------------------------------------------------------

export interface OperationalSchedule {
  city: string;
  facilityName?: string;
  timezone: string;          // Default: 'Asia/Kolkata'
  isEmergency24x7: boolean;   // LifeLink emergency dispatch is typically 24x7
  opdDays: string[];         // Days when OPD operates e.g. ['Monday', 'Tuesday', ...]
  opdHours: {
    startTime: string;       // e.g. '08:30' (24-hour HH:mm)
    endTime: string;         // e.g. '17:00'
  };
  lunchBreak?: {
    startTime: string;       // e.g. '13:00'
    endTime: string;         // e.g. '14:00'
  };
}

/**
 * Default standard schedule for hospital facilities in Indian metropolitan centers.
 */
export const DEFAULT_INDIAN_OPERATIONAL_SCHEDULE: OperationalSchedule = {
  city: 'Nagpur',
  timezone: INDIAN_TIMEZONE,
  isEmergency24x7: true,
  opdDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  opdHours: {
    startTime: '09:00',
    endTime: '17:00',
  },
  lunchBreak: {
    startTime: '13:00',
    endTime: '14:00',
  },
};

/**
 * Evaluates whether a healthcare facility or OPD department is currently open
 * based on its configured city/facility schedule in IST.
 */
export function isFacilityOpen(
  schedule: OperationalSchedule = DEFAULT_INDIAN_OPERATIONAL_SCHEDULE,
  checkTime: Date = new Date()
): {
  isOpen: boolean;
  status: 'EMERGENCY_ONLY_24X7' | 'OPD_OPEN' | 'LUNCH_BREAK' | 'CLOSED';
  message: string;
} {
  // If emergency 24x7 is enabled, the ER is always operational
  const istDateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone || INDIAN_TIMEZONE,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(checkTime);

  // Parse weekday and HH:mm from IST representation
  const parts = istDateStr.split(' ');
  const weekday = parts[0].replace(',', '');
  const timeStr = parts[1] || '00:00';

  const isOpdDay = schedule.opdDays.some((d) => d.toLowerCase() === weekday.toLowerCase());
  if (!isOpdDay) {
    return {
      isOpen: schedule.isEmergency24x7,
      status: schedule.isEmergency24x7 ? 'EMERGENCY_ONLY_24X7' : 'CLOSED',
      message: `OPD closed on ${weekday}. 24x7 Emergency Room remains operational.`,
    };
  }

  // Check lunch break
  if (schedule.lunchBreak) {
    if (timeStr >= schedule.lunchBreak.startTime && timeStr < schedule.lunchBreak.endTime) {
      return {
        isOpen: true,
        status: 'LUNCH_BREAK',
        message: `OPD lunch recess (${schedule.lunchBreak.startTime} - ${schedule.lunchBreak.endTime} IST). ER active.`,
      };
    }
  }

  // Check OPD hours
  if (timeStr >= schedule.opdHours.startTime && timeStr <= schedule.opdHours.endTime) {
    return {
      isOpen: true,
      status: 'OPD_OPEN',
      message: `OPD and Emergency departments are fully operational (${schedule.opdHours.startTime} - ${schedule.opdHours.endTime} IST).`,
    };
  }

  return {
    isOpen: schedule.isEmergency24x7,
    status: schedule.isEmergency24x7 ? 'EMERGENCY_ONLY_24X7' : 'CLOSED',
    message: `OPD hours concluded for today. Emergency Trauma care is open 24x7.`,
  };
}

// -------------------------------------------------------------
// 6. Bilingual Terminology Dictionary (English, Hindi, Marathi)
// -------------------------------------------------------------

export const LOCALIZED_TERMS: Record<string, { en: string; hi: string; mr: string }> = {
  ambulance: {
    en: 'Ambulance',
    hi: 'एम्बुलेंस',
    mr: 'रुग्णवाहिका',
  },
  hospital: {
    en: 'Hospital',
    hi: 'अस्पताल',
    mr: 'रुग्णालय',
  },
  emergency: {
    en: 'Emergency',
    hi: 'आपातकाल',
    mr: 'तातडीची मदत',
  },
  doctor: {
    en: 'Doctor / Specialist',
    hi: 'चिकित्सक / डॉक्टर',
    mr: 'डॉक्टर / तज्ज्ञ',
  },
  bed_available: {
    en: 'Available Beds',
    hi: 'उपलब्ध बेड',
    mr: 'उपलब्ध खाटा',
  },
  service_area: {
    en: 'Service Area',
    hi: 'सेवा क्षेत्र',
    mr: 'कार्यक्षेत्र',
  },
  sos_alert: {
    en: 'SOS Emergency Alert',
    hi: 'आपातकालीन एसओएस चेतावनी',
    mr: 'तातडीचा इशारा',
  },
  emergency_sos: {
    en: 'Emergency SOS',
    hi: 'आपातकालीन एसओएस',
    mr: 'तात्काळ एसओएस',
  },
  call_112: {
    en: 'National Emergency: Dial 112',
    hi: 'राष्ट्रीय आपातकालीन: डायल 112',
    mr: 'राष्ट्रीय आपत्कालीन: डायल 112',
  },
  available_beds: {
    en: 'Available Beds',
    hi: 'उपलब्ध बिस्तर',
    mr: 'उपलब्ध खाटा',
  },
  call112: {
    en: 'National Emergency: Dial 112',
    hi: 'राष्ट्रीय आपातकालीन: डायल 112',
    mr: 'राष्ट्रीय आपत्कालीन: डायल 112',
  },
  emergencysos: {
    en: 'Emergency SOS',
    hi: 'आपातकालीन एसओएस',
    mr: 'तात्काळ एसओएस',
  },
  availablebeds: {
    en: 'Available Beds',
    hi: 'उपलब्ध बिस्तर',
    mr: 'उपलब्ध खाटा',
  },
  national_emergency_112: {
    en: 'National Emergency Service (112)',
    hi: 'राष्ट्रीय आपातकालीन सेवा (112)',
    mr: 'राष्ट्रीय आपत्कालीन सेवा (112)',
  },
};

/**
 * Returns localized term for common healthcare entities.
 */
export function getLocalizedTerm(
  termKey: string,
  lang: 'en' | 'hi' | 'mr' = 'en'
): string {
  const entry = LOCALIZED_TERMS[termKey.toLowerCase()];
  if (!entry) return termKey;
  return entry[lang] || entry.en;
}

// -------------------------------------------------------------
// 7. Convenience Aliases matching Frontend Localization
// -------------------------------------------------------------
export const formatINR = formatCurrencyINR;
export const formatDateIndian = formatDateIST;
export const formatIndianDate = formatDateIST;
export const formatIndianTime = formatTimeIST;
export const formatIndianDateTime = formatDateTimeIST;

export function validateIndianPhone(phone: string): { isValid: boolean; normalized?: string; error?: string } {
  const norm = normalizeIndianPhone(phone);
  if (!norm.isValid) {
    return { isValid: false, error: norm.error || 'Invalid Indian phone number' };
  }
  return { isValid: true, normalized: norm.normalized };
}

export function validateIndianPinCode(pincode: string): { isValid: boolean; error?: string } {
  const isValid = isValidIndianPincode(pincode);
  return {
    isValid,
    error: isValid ? undefined : 'PIN code must be a 6-digit postal code starting with 1-9',
  };
}

export function t(termKey: string, lang: 'en' | 'hi' | 'mr' = 'en'): string {
  const direct = getLocalizedTerm(termKey, lang);
  if (direct !== termKey) return direct;

  const normalizedKey = termKey
    .replace(/([A-Z]|\d+)/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
  const candidate = getLocalizedTerm(normalizedKey, lang);
  if (candidate !== normalizedKey) return candidate;

  return getLocalizedTerm(termKey.toLowerCase().replace(/[^a-z0-9]/g, ''), lang);
}
