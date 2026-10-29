/**
 * India Phone Number Utilities
 * Normalizes Indian mobile phone numbers to standard E.164 (+91XXXXXXXXXX) format.
 * Validates that the number complies with the Indian National Numbering Plan (10-digit mobile starting with 6-9).
 */

export interface PhoneNormalizationResult {
  isValid: boolean;
  normalized?: string;
  error?: string;
}

export function normalizeIndianPhone(rawPhone: string | null | undefined): PhoneNormalizationResult {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { isValid: false, error: 'Phone number is required.' };
  }

  // Remove whitespace, dashes, brackets, and periods
  let cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');

  // Handle leading +
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // Handle leading 0 (trunk prefix e.g. 09876543210)
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }

  // Strip 91 country code prefix if 12 digits e.g. 919876543210
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  }

  // At this point, valid Indian mobile number must be exactly 10 digits
  if (cleaned.length !== 10) {
    return {
      isValid: false,
      error: `Invalid Indian phone number length (${cleaned.length} digits). Standard Indian mobile numbers are 10 digits.`,
    };
  }

  // Standard Indian mobile numbering plan: must start with 6, 7, 8, or 9
  const firstDigit = cleaned[0];
  if (!['6', '7', '8', '9'].includes(firstDigit)) {
    return {
      isValid: false,
      error: `Invalid Indian mobile prefix '${firstDigit}'. Indian mobile numbers must start with 6, 7, 8, or 9.`,
    };
  }

  // Must be strictly numeric
  if (!/^\d{10}$/.test(cleaned)) {
    return {
      isValid: false,
      error: 'Phone number must contain only numeric digits.',
    };
  }

  return {
    isValid: true,
    normalized: `+91${cleaned}`,
  };
}

export interface TrustedContactPhoneResult extends PhoneNormalizationResult {
  isInternational?: boolean;
  countryCode?: string;
}

/**
 * Universal Trusted Contact Phone Normalization
 * Supports standard Indian mobile numbers (+91) as well as normalized international E.164 formats (+1, +44, +61, etc.)
 */
export function normalizeTrustedContactPhone(rawPhone: string | null | undefined): TrustedContactPhoneResult {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { isValid: false, error: 'Phone number is required.' };
  }

  const trimmed = rawPhone.trim();
  const cleaned = trimmed.replace(/[\s\-\(\)\.]/g, '');

  // 1. Explicit International Number (starts with '+' and non-91 country code)
  if (cleaned.startsWith('+')) {
    if (!cleaned.startsWith('+91')) {
      // E.164 International Format: +[1-9][0-9]{6,14} (total 8-15 digits after +)
      const intlRegex = /^\+[1-9]\d{7,14}$/;
      if (!intlRegex.test(cleaned)) {
        return {
          isValid: false,
          error: 'Invalid international phone format. International numbers must follow standard E.164 format (e.g. +14155552671).',
        };
      }
      return {
        isValid: true,
        normalized: cleaned,
        isInternational: true,
      };
    }
  }

  // 2. Default to Indian National Numbering Plan (+91)
  const indianResult = normalizeIndianPhone(rawPhone);
  if (indianResult.isValid) {
    return {
      isValid: true,
      normalized: indianResult.normalized,
      isInternational: false,
      countryCode: '+91',
    };
  }

  return {
    isValid: false,
    error: indianResult.error || 'Invalid phone number. Provide a 10-digit Indian mobile number or an international E.164 number starting with +.',
  };
}

/**
 * Masks phone number for privacy display (e.g. "+91 98*** **210" or "+1 41*** **671")
 */
export function maskPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return 'Unknown';
  const clean = phone.trim();
  if (clean.length < 8) return clean;
  const prefix = clean.slice(0, 5);
  const suffix = clean.slice(-3);
  return `${prefix}*** **${suffix}`;
}
