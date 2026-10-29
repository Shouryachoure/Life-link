import crypto from 'crypto';
import { sendEmailOTP } from './emailService';
import { sendSMS, isSmsProviderConfigured } from './smsService';
import { maskEmail, maskPhoneNumber } from './privacyRedactor';
import { normalizeIndianPhone } from './phoneUtils';

export type OtpChannel = 'EMAIL' | 'PHONE';
export type OtpPurpose = 'REGISTRATION' | 'LOGIN' | 'PASSWORD_RESET' | 'PHONE_VERIFY';

export interface StoredOtpRecord {
  code: string;
  identifier: string; // Normalized email or normalized E.164 phone
  channel: OtpChannel;
  purpose: OtpPurpose;
  expiresAt: number;
  attempts: number;
  createdAt: number;
  lastSentAt: number;
}

// In-memory store for OTP records
const otpStore = new Map<string, StoredOtpRecord>();

// Expiration constants
export const OTP_CONFIG = {
  EMAIL_TTL_SECONDS: 10 * 60, // 10 minutes
  PHONE_TTL_SECONDS: 5 * 60, // 5 minutes
  RESEND_COOLDOWN_SECONDS: 60, // 60 seconds
  MAX_VERIFICATION_ATTEMPTS: 3,
};

// Periodic pruner for expired records
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of otpStore.entries()) {
    if (now > record.expiresAt) {
      otpStore.delete(key);
    }
  }
}, 60 * 1000).unref();

function buildStorageKey(identifier: string, channel: OtpChannel, purpose: OtpPurpose): string {
  return `${purpose}:${channel}:${identifier.trim().toLowerCase()}`;
}

export function generateCryptoOtp(): string {
  // Cryptographically secure 6-digit numeric string
  const num = crypto.randomInt(100000, 1000000);
  return String(num);
}

export interface RequestOtpParams {
  identifier: string; // Email or phone
  channel?: OtpChannel; // Optional if auto-detectable
  purpose: OtpPurpose;
}

export interface RequestOtpResult {
  success: boolean;
  channel: OtpChannel;
  identifier: string;
  maskedRecipient: string;
  expiresInSeconds: number;
  cooldownSeconds: number;
  providerConfigured: boolean;
  deliveryFeedback: string;
  mock?: boolean;
  mockCode?: string; // Exposed ONLY in test/development mode for automated verification
}

export interface VerifyOtpParams {
  identifier: string;
  channel?: OtpChannel;
  purpose: OtpPurpose;
  code: string;
}

export interface VerifyOtpResult {
  success: boolean;
  verified: boolean;
  message: string;
  identifier: string;
  channel: OtpChannel;
  remainingAttempts?: number;
}

/**
 * Normalizes an identifier and determines its channel (EMAIL or PHONE).
 */
export function normalizeOtpIdentifier(
  identifier: string,
  preferredChannel?: OtpChannel
): { valid: boolean; normalized: string; channel: OtpChannel; error?: string } {
  const clean = identifier.trim();

  if (preferredChannel === 'EMAIL' || clean.includes('@')) {
    const normalizedEmail = clean.toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return { valid: false, normalized: '', channel: 'EMAIL', error: 'Invalid email address format.' };
    }
    return { valid: true, normalized: normalizedEmail, channel: 'EMAIL' };
  }

  // Treat as phone number
  const phoneRes = normalizeIndianPhone(clean);
  if (!phoneRes.isValid) {
    return {
      valid: false,
      normalized: '',
      channel: 'PHONE',
      error: phoneRes.error || 'Invalid phone number format (+91 format required).',
    };
  }
  return { valid: true, normalized: phoneRes.normalized!, channel: 'PHONE' };
}

/**
 * Requests an OTP to be sent via Email or SMS.
 * Enforces resend cooldown, generates cryptographically secure 6-digit OTP,
 * invalidates previous active OTPs for the same key, and tracks attempt limits.
 */
export async function requestOtp(params: RequestOtpParams): Promise<RequestOtpResult> {
  const norm = normalizeOtpIdentifier(params.identifier, params.channel);
  if (!norm.valid) {
    throw new Error(norm.error || 'Invalid identifier for OTP dispatch.');
  }

  const { normalized, channel } = norm;
  const purpose = params.purpose;
  const storageKey = buildStorageKey(normalized, channel, purpose);
  const now = Date.now();

  // 1. Check Resend Cooldown
  const existing = otpStore.get(storageKey);
  if (existing) {
    const elapsedSeconds = Math.floor((now - existing.lastSentAt) / 1000);
    if (elapsedSeconds < OTP_CONFIG.RESEND_COOLDOWN_SECONDS) {
      const waitTime = OTP_CONFIG.RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      throw new Error(`Please wait ${waitTime} second(s) before requesting a new verification code.`);
    }
  }

  // 2. Generate secure code & TTL
  const code = generateCryptoOtp();
  const ttlSeconds =
    channel === 'EMAIL' ? OTP_CONFIG.EMAIL_TTL_SECONDS : OTP_CONFIG.PHONE_TTL_SECONDS;
  const expiresAt = now + ttlSeconds * 1000;

  // 3. Store record (overwrites prior code, resetting attempt counter)
  otpStore.set(storageKey, {
    code,
    identifier: normalized,
    channel,
    purpose,
    expiresAt,
    attempts: 0,
    createdAt: now,
    lastSentAt: now,
  });

  const maskedRecipient = channel === 'EMAIL' ? maskEmail(normalized) : maskPhoneNumber(normalized);
  const isTestOrDev = process.env.NODE_ENV !== 'production';

  // 4. Dispatch through channel provider
  if (channel === 'EMAIL') {
    const emailRes = await sendEmailOTP(normalized, code, purpose, Math.ceil(ttlSeconds / 60));
    return {
      success: true,
      channel: 'EMAIL',
      identifier: normalized,
      maskedRecipient,
      expiresInSeconds: ttlSeconds,
      cooldownSeconds: OTP_CONFIG.RESEND_COOLDOWN_SECONDS,
      providerConfigured: emailRes.providerConfigured,
      deliveryFeedback: emailRes.providerConfigured
        ? `Verification code dispatched to ${maskedRecipient}. Please check your inbox and spam folder.`
        : `Email provider (SMTP) is not configured in .env. Live email cannot be dispatched. (In local sandbox, code is logged to server console).`,
      mock: !emailRes.providerConfigured,
      mockCode: isTestOrDev ? code : undefined,
    };
  } else {
    // PHONE Channel
    const smsConfigured = isSmsProviderConfigured();
    if (smsConfigured) {
      const smsMessage = `[LifeLink] Your verification code is ${code}. Valid for ${Math.ceil(ttlSeconds / 60)} minutes. Do not share this code.`;
      const smsRes = await sendSMS(normalized, smsMessage);
      return {
        success: smsRes.success,
        channel: 'PHONE',
        identifier: normalized,
        maskedRecipient,
        expiresInSeconds: ttlSeconds,
        cooldownSeconds: OTP_CONFIG.RESEND_COOLDOWN_SECONDS,
        providerConfigured: true,
        deliveryFeedback: `Verification SMS dispatched to ${maskedRecipient}.`,
        mock: false,
        mockCode: isTestOrDev ? code : undefined,
      };
    } else {
      // SMS Provider Not Configured - NEVER claim SMS was sent
      console.log('\n================== [SMS OTP DISPATCH (LOCAL SANDBOX)] ==================');
      console.log(`Phone:               ${normalized}`);
      console.log(`Purpose:             ${purpose}`);
      console.log(`Verification Code:   ${code}`);
      console.log(`Expires in:          ${ttlSeconds} seconds`);
      console.log('NOTICE:              SMS provider (Twilio) is NOT configured in .env. Real carrier SMS could not be sent.');
      console.log('========================================================================\n');

      return {
        success: true,
        channel: 'PHONE',
        identifier: normalized,
        maskedRecipient,
        expiresInSeconds: ttlSeconds,
        cooldownSeconds: OTP_CONFIG.RESEND_COOLDOWN_SECONDS,
        providerConfigured: false,
        deliveryFeedback: `SMS provider (Twilio) is not configured in this environment. To receive real SMS, configure TWILIO_ACCOUNT_SID & TWILIO_PHONE_NUMBER in .env. (In local sandbox, code is logged to server console).`,
        mock: true,
        mockCode: isTestOrDev ? code : undefined,
      };
    }
  }
}

/**
 * Validates a submitted OTP.
 * Invariant:
 * - Fails closed if expired, missing, or mismatched.
 * - Increments attempts counter on failure; destroys record after 3 attempts.
 * - Consumes and destroys record immediately upon successful verification (prevents replay).
 */
export function verifyOtp(params: VerifyOtpParams): VerifyOtpResult {
  const norm = normalizeOtpIdentifier(params.identifier, params.channel);
  if (!norm.valid) {
    return {
      success: false,
      verified: false,
      message: norm.error || 'Invalid identifier format.',
      identifier: params.identifier,
      channel: params.channel || 'EMAIL',
    };
  }

  const { normalized, channel } = norm;
  const storageKey = buildStorageKey(normalized, channel, params.purpose);
  const record = otpStore.get(storageKey);

  if (!record) {
    return {
      success: false,
      verified: false,
      message: 'No active verification code found for this destination. Please request a new code.',
      identifier: normalized,
      channel,
    };
  }

  // Expiration check
  if (Date.now() > record.expiresAt) {
    otpStore.delete(storageKey);
    return {
      success: false,
      verified: false,
      message: 'Verification code has expired. Please request a fresh code.',
      identifier: normalized,
      channel,
    };
  }

  // Attempt limit check
  if (record.attempts >= OTP_CONFIG.MAX_VERIFICATION_ATTEMPTS) {
    otpStore.delete(storageKey);
    return {
      success: false,
      verified: false,
      message: 'Too many incorrect attempts. For security, this verification code has been invalidated. Please request a new one.',
      identifier: normalized,
      channel,
    };
  }

  const submitted = (params.code || '').trim();
  if (record.code !== submitted) {
    record.attempts += 1;
    const remaining = OTP_CONFIG.MAX_VERIFICATION_ATTEMPTS - record.attempts;

    if (remaining <= 0) {
      otpStore.delete(storageKey);
      return {
        success: false,
        verified: false,
        message: 'Invalid code. You have exceeded maximum verification attempts. Please request a fresh code.',
        identifier: normalized,
        channel,
        remainingAttempts: 0,
      };
    }

    return {
      success: false,
      verified: false,
      message: `Invalid verification code. ${remaining} attempt(s) remaining.`,
      identifier: normalized,
      channel,
      remainingAttempts: remaining,
    };
  }

  // SUCCESS: Invalidate / consume code to prevent replay attacks
  otpStore.delete(storageKey);

  return {
    success: true,
    verified: true,
    message: 'Verification code confirmed successfully.',
    identifier: normalized,
    channel,
  };
}

// -----------------------------------------------------------------------------
// Legacy Backwards-Compatible Helpers (Guarantees existing tests remain 100% green)
// -----------------------------------------------------------------------------

export interface SendOTPResult {
  success: boolean;
  phone: string;
  mock: boolean;
  isSimulated: boolean;
  devNotice?: string;
  mockCode?: string;
  expiresInSeconds: number;
}

export interface VerifyOTPResult {
  success: boolean;
  verified: boolean;
  phone: string;
  message: string;
}

export async function sendPhoneOTP(normalizedPhone: string): Promise<SendOTPResult> {
  const res = await requestOtp({
    identifier: normalizedPhone,
    channel: 'PHONE',
    purpose: 'PHONE_VERIFY',
  });

  return {
    success: res.success,
    phone: res.identifier,
    mock: res.mock ?? true,
    isSimulated: res.mock ?? true,
    devNotice: res.deliveryFeedback,
    mockCode: res.mockCode,
    expiresInSeconds: res.expiresInSeconds,
  };
}

export function verifyPhoneOTP(normalizedPhone: string, submittedCode: string): VerifyOTPResult {
  const res = verifyOtp({
    identifier: normalizedPhone,
    channel: 'PHONE',
    purpose: 'PHONE_VERIFY',
    code: submittedCode,
  });

  return {
    success: res.success,
    verified: res.verified,
    phone: res.identifier,
    message: res.message,
  };
}
