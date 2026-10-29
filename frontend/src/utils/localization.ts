/**
 * LifeLink India - Frontend Localization & Multi-City Utility
 *
 * Provides Indian phone formatting, PIN code validation, Indian address formatters,
 * INR currency formatting (Lakh/Crore grouping), Asia/Kolkata (IST) dates and times,
 * facility operational schedules, and bilingual dictionary (English / Hindi / Marathi).
 */

export type SupportedLanguage = 'en' | 'hi' | 'mr';

export interface IndianAddress {
  line1: string;
  line2?: string;
  locality?: string;
  city: string;
  state: string;
  pinCode: string;
}

export interface OperationalSchedule {
  is24x7?: boolean;
  timeZone?: string;
  monday?: { open: string; close: string; closed?: boolean };
  tuesday?: { open: string; close: string; closed?: boolean };
  wednesday?: { open: string; close: string; closed?: boolean };
  thursday?: { open: string; close: string; closed?: boolean };
  friday?: { open: string; close: string; closed?: boolean };
  saturday?: { open: string; close: string; closed?: boolean };
  sunday?: { open: string; close: string; closed?: boolean };
}

// -------------------------------------------------------------
// 1. Phone Formatting & Masking
// -------------------------------------------------------------
export function formatIndianPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const tenDigits = digits.length > 10 ? digits.slice(-10) : digits;

  if (tenDigits.length === 10) {
    return `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;
  }
  return phone;
}

export function maskIndianPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const tenDigits = digits.length > 10 ? digits.slice(-10) : digits;

  if (tenDigits.length === 10) {
    return `+91 ${tenDigits.slice(0, 2)}*** **${tenDigits.slice(7)}`;
  }
  return phone;
}

export function validateIndianPhone(phone: string): { isValid: boolean; normalized?: string; error?: string } {
  if (!phone) return { isValid: false, error: 'Phone number is required' };
  const digits = phone.replace(/\D/g, '');
  const tenDigits = digits.length > 10 ? digits.slice(-10) : digits;

  if (tenDigits.length !== 10) {
    return { isValid: false, error: 'Indian mobile number must be exactly 10 digits' };
  }
  if (!/^[6-9]/.test(tenDigits)) {
    return { isValid: false, error: 'Indian mobile number must begin with digits 6, 7, 8, or 9' };
  }
  return { isValid: true, normalized: `+91${tenDigits}` };
}

// -------------------------------------------------------------
// 2. PIN Code & Address Formatting
// -------------------------------------------------------------
export function validateIndianPinCode(pin: string): { isValid: boolean; error?: string } {
  if (!pin) return { isValid: false, error: 'Postal PIN code is required' };
  const cleanPin = pin.trim();
  if (!/^[1-9][0-9]{5}$/.test(cleanPin)) {
    return { isValid: false, error: 'PIN code must be a 6-digit postal code not starting with 0' };
  }
  return { isValid: true };
}

export function formatIndianAddress(address: IndianAddress): string {
  const parts: string[] = [];
  if (address.line1?.trim()) parts.push(address.line1.trim());
  if (address.line2?.trim()) parts.push(address.line2.trim());
  if (address.locality?.trim()) parts.push(address.locality.trim());
  
  const cityStatePin = [
    address.city?.trim(),
    address.state?.trim(),
    address.pinCode?.trim(),
  ].filter(Boolean).join(', ');

  if (cityStatePin) parts.push(cityStatePin);
  parts.push('India');

  return parts.join(', ');
}

// -------------------------------------------------------------
// 3. Indian Rupee (INR) Currency Formatting
// -------------------------------------------------------------
const inrNumberFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inrNumberFormatterWithPaisa = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(amount: number | null | undefined, options?: { showPaisa?: boolean }): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return '₹0';
  }
  if (options?.showPaisa) {
    return inrNumberFormatterWithPaisa.format(amount);
  }
  return inrNumberFormatter.format(amount);
}

// -------------------------------------------------------------
// 4. Timezone & DateTime Handling (Asia/Kolkata - IST)
// -------------------------------------------------------------
export const INDIA_TIMEZONE = 'Asia/Kolkata';

export function formatIndianDateTime(
  dateInput: Date | string | number | null | undefined,
  options?: { includeSeconds?: boolean; includeTimezone?: boolean }
): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  const dateStr = date.toLocaleDateString('en-IN', {
    timeZone: INDIA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const timeStr = date.toLocaleTimeString('en-IN', {
    timeZone: INDIA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: options?.includeSeconds ? '2-digit' : undefined,
    hour12: true,
  });

  const tzLabel = options?.includeTimezone !== false ? ' IST' : '';
  return `${dateStr}, ${timeStr}${tzLabel}`;
}

export function formatIndianDate(dateInput: Date | string | number | null | undefined): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('en-IN', {
    timeZone: INDIA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatIndianTime(dateInput: Date | string | number | null | undefined): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  return date.toLocaleTimeString('en-IN', {
    timeZone: INDIA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// -------------------------------------------------------------
// 5. Facility Operational Schedules (Configurable per city/facility)
// -------------------------------------------------------------
export function isFacilityOpen(
  schedule?: OperationalSchedule | null,
  referenceDate: Date = new Date()
): { isOpen: boolean; nextStatusChange?: string; scheduleNote?: string } {
  if (!schedule || schedule.is24x7 !== false) {
    return { isOpen: true, scheduleNote: '24x7 Emergency Services Available' };
  }

  const days: Array<'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'> = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];

  const nowIST = new Date(referenceDate.toLocaleString('en-US', { timeZone: schedule.timeZone || INDIA_TIMEZONE }));
  const currentDayIndex = nowIST.getDay();
  const currentDayName = days[currentDayIndex];
  const daySchedule = schedule[currentDayName];

  if (!daySchedule || daySchedule.closed) {
    return { isOpen: false, scheduleNote: `Closed on ${currentDayName.toUpperCase()}` };
  }

  const currentMinutes = nowIST.getHours() * 60 + nowIST.getMinutes();
  const [openHour, openMin] = (daySchedule.open || '00:00').split(':').map((v) => parseInt(v, 10));
  const [closeHour, closeMin] = (daySchedule.close || '23:59').split(':').map((v) => parseInt(v, 10));

  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;

  const isOpen = currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
  return {
    isOpen,
    scheduleNote: isOpen
      ? `Open today: ${daySchedule.open} - ${daySchedule.close}`
      : `Closed (Hours: ${daySchedule.open} - ${daySchedule.close})`,
  };
}

// -------------------------------------------------------------
// 6. Bilingual UI Vocabulary (English / Hindi / Marathi)
// -------------------------------------------------------------
export const VOCABULARY = {
  emergencySos: {
    en: 'Emergency SOS',
    hi: 'आपातकालीन एसओएस',
    mr: 'तात्काळ एसओएस',
  },
  call112: {
    en: 'National Emergency: Dial 112',
    hi: 'राष्ट्रीय आपातकालीन: डायल 112',
    mr: 'राष्ट्रीय आपत्कालीन: डायल 112',
  },
  requestAmbulance: {
    en: 'Request Ambulance',
    hi: 'एम्बुलेंस का अनुरोध करें',
    mr: 'रुग्णवाहिका मागवा',
  },
  availableBeds: {
    en: 'Available Beds',
    hi: 'उपलब्ध बिस्तर',
    mr: 'उपलब्ध खाटा',
  },
  verifiedHospital: {
    en: 'Verified Hospital',
    hi: 'सत्यापित अस्पताल',
    mr: 'प्रमाणित रुग्णालय',
  },
  activeServiceAreas: {
    en: 'Active Service Areas',
    hi: 'सक्रिय सेवा क्षेत्र',
    mr: 'सक्रिय सेवा क्षेत्रे',
  },
  expansionPilot: {
    en: 'Pilot Zone: Nagpur, Maharashtra',
    hi: 'पायलट क्षेत्र: नागपुर, महाराष्ट्र',
    mr: 'पायलट क्षेत्र: नागपूर, महाराष्ट्र',
  },
  locationPermissionPrompt: {
    en: 'Please share your location to find nearest ambulances',
    hi: 'निकटतम एम्बुलेंस खोजने के लिए कृपया अपना स्थान साझा करें',
    mr: 'जवळची रुग्णवाहिका शोधण्यासाठी कृपया आपले स्थान सामायिक करा',
  },
  outsideServiceArea: {
    en: 'Outside active service coverage. Immediate fallback to 112.',
    hi: 'सक्रिय सेवा क्षेत्र से बाहर। तुरंत 112 पर कॉल करें।',
    mr: 'सक्रिय सेवेच्या बाहेर. ताबडतोब 112 वर कॉल करा.',
  },
  plannedExpansion: {
    en: 'Coming soon to this city. Operating fleet verification in progress.',
    hi: 'इस शहर में जल्द आ रहा है। परिचालन बेड़े का सत्यापन जारी है।',
    mr: 'या शहरात लवकरच सुरू होत आहे. वाहनांचे सत्यापन सुरू आहे.',
  },
} as const;

export type TranslationKey = keyof typeof VOCABULARY;

export function t(key: TranslationKey, lang: SupportedLanguage = 'en'): string {
  const entry = VOCABULARY[key];
  if (!entry) return key;
  return entry[lang] || entry['en'] || key;
}
