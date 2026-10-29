/**
 * LifeLink India — Patient Privacy & PII Redactor
 * 
 * Complies with India Digital Personal Data Protection Act (DPDP 2023) and healthcare privacy standards.
 * Ensures that patient identifiers, phone numbers, Aadhaar/identity records, and clinical observations
 * are masked before being emitted to application logs, APMs, or stdout.
 */

// Matches Indian mobile numbers with or without +91 prefix
const INDIAN_PHONE_REGEX = /(?:\+91|91)?[-.\s]?([6-9]\d{1})\d{4}(\d{4})/g;

// Matches email addresses
const EMAIL_REGEX = /([a-zA-Z0-9_\-.+]+)@([a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,})/g;

// Matches Bearer JWT tokens
const JWT_REGEX = /Bearer\s+[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/gi;

// Sensitive keys whose values must be entirely masked
const SENSITIVE_PROPERTY_NAMES = new Set([
  'password',
  'passwordhash',
  'token',
  'refreshtoken',
  'accesstoken',
  'totpcode',
  'secret',
  'cookie',
  'authorization',
  'credentials',
  'allergies',
  'symptoms',
  'medicalnotes',
  'bloodgroup',
  'diagnosis',
]);

/**
 * Masks Indian phone numbers, keeping the first 2 and last 4 digits visible.
 * Example: +919876543210 -> +9198****3210
 */
export function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(INDIAN_PHONE_REGEX, (_match, prefix, suffix) => {
    return `+91${prefix}****${suffix}`;
  });
}

/**
 * Masks email addresses.
 * Example: rohan.sharma@lifelink.in -> r****a@lifelink.in
 */
export function maskEmail(email?: string | null): string {
  if (!email) return '';
  return email.replace(EMAIL_REGEX, (_match, user, domain) => {
    if (user.length <= 2) return `${user[0]}****@${domain}`;
    return `${user[0]}****${user[user.length - 1]}@${domain}`;
  });
}

// Matches Indian Aadhaar numbers (12 digits, often formatted as 4-4-4 or continuous)
const AADHAAR_REGEX = /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g;

/**
 * Redacts arbitrary text strings containing JWTs, phone numbers, emails, or Aadhaar numbers.
 */
export function redactSensitiveString(text: string): string {
  if (!text) return '';
  return text
    .replace(JWT_REGEX, 'Bearer [REDACTED_JWT]')
    .replace(INDIAN_PHONE_REGEX, '+91$1****$2')
    .replace(AADHAAR_REGEX, '[REDACTED_AADHAAR]')
    .replace(EMAIL_REGEX, (_match, user, domain) => `${user[0]}****@${domain}`);
}

/**
 * Deeply sanitizes JSON-serializable objects, redacting sensitive property names
 * and masking PII in string values.
 */
export function sanitizeForLogging(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactSensitiveString(obj);
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForLogging(item));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_PROPERTY_NAMES.has(lowerKey)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeForLogging(value);
    } else if (typeof value === 'string') {
      result[key] = redactSensitiveString(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
