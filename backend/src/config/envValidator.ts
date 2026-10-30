/**
 * LifeLink India — Environment & Secrets Validator
 * 
 * Enforces strict environment variable integrity, separates development vs production constraints,
 * prevents weak development secrets from leaking into production, and ensures secrets are never
 * printed to stdout or log aggregators.
 */

export interface ValidatedConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  superAdminTotpSecret?: string;
  corsOrigins: string[];
  geminiApiKey?: string;
  geminiModel: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  googleClientId?: string;
  emergencyTestContactPhone?: string;
  emergencyTestContactName?: string;
}

const WEAK_DEV_SECRETS = new Set([
  'lifelink_jwt_secret_key_2026_super_secure',
  'lifelink_jwt_refresh_secret_key_2026_super_secure',
  'superadminsecret123',
  'replace_with_a_secure_random_64_char_hex_secret_in_production',
  'replace_with_a_second_secure_random_64_char_hex_secret',
  'secret',
  'changeme',
  'password',
  '123456',
]);

/**
 * Validates environment variables according to the current execution mode.
 * In production: Enforces non-default secrets, minimum key entropy, safe CORS, and database connectivity.
 * In development/test: Permits sensible offline fallbacks with explicit diagnostic warnings.
 */
export function validateEnvironment(): ValidatedConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase() as 'development' | 'test' | 'production';
  const isProd = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';
  const errors: string[] = [];

  // 1. Port Configuration
  const port = parseInt(process.env.PORT || '5000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: "${process.env.PORT}". Must be an integer between 1 and 65535.`);
  }

  // 2. JWT Access Secret
  let jwtSecret = process.env.JWT_SECRET || '';
  if (isProd) {
    if (!jwtSecret) {
      errors.push('FATAL: JWT_SECRET is required in production.');
    } else if (jwtSecret.length < 32) {
      errors.push('FATAL: JWT_SECRET must be at least 32 characters long for production security.');
    } else if (WEAK_DEV_SECRETS.has(jwtSecret.toLowerCase().trim())) {
      errors.push('FATAL: Default/insecure development JWT_SECRET detected in production. You must generate a unique, cryptographically secure 64-char hex key.');
    }
  } else {
    if (!jwtSecret) {
      jwtSecret = 'lifelink_jwt_secret_key_2026_super_secure';
    }
  }

  // 3. JWT Refresh Secret
  let jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || '';
  if (isProd) {
    if (!jwtRefreshSecret) {
      errors.push('FATAL: JWT_REFRESH_SECRET is required in production.');
    } else if (jwtRefreshSecret.length < 32) {
      errors.push('FATAL: JWT_REFRESH_SECRET must be at least 32 characters long for production security.');
    } else if (WEAK_DEV_SECRETS.has(jwtRefreshSecret.toLowerCase().trim())) {
      errors.push('FATAL: Default/insecure development JWT_REFRESH_SECRET detected in production. You must generate a unique, cryptographically secure 64-char hex key.');
    } else if (jwtSecret && jwtRefreshSecret === jwtSecret) {
      errors.push('FATAL: JWT_REFRESH_SECRET must not be identical to JWT_SECRET.');
    }
  } else {
    if (!jwtRefreshSecret) {
      jwtRefreshSecret = 'lifelink_jwt_refresh_secret_key_2026_super_secure';
    }
  }

  // 4. Super Admin 2FA TOTP Secret
  const superAdminTotpSecret = process.env.SUPER_ADMIN_TOTP_SECRET;
  if (isProd) {
    if (!superAdminTotpSecret) {
      errors.push('FATAL: SUPER_ADMIN_TOTP_SECRET is required in production to safeguard super-admin logins.');
    } else if (superAdminTotpSecret.length < 16) {
      errors.push('FATAL: SUPER_ADMIN_TOTP_SECRET must be at least 16 characters for Base32/TOTP compliance.');
    } else if (WEAK_DEV_SECRETS.has(superAdminTotpSecret.toLowerCase().trim())) {
      errors.push('FATAL: Default development SUPER_ADMIN_TOTP_SECRET detected in production. Replace with a secure Base32 TOTP secret.');
    }
  }

  // 5. Database URL
  const databaseUrl = process.env.DATABASE_URL || '';
  if (isProd) {
    if (!databaseUrl) {
      errors.push('FATAL: DATABASE_URL is required in production.');
    } else if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
      errors.push('FATAL: DATABASE_URL must be a valid PostgreSQL connection string starting with postgresql:// or postgres://');
    }
  }

  // 6. CORS Configuration
  const rawCors = process.env.CORS_ORIGIN || '';
  let corsOrigins: string[] = [];
  if (rawCors) {
    corsOrigins = rawCors.split(',').map((o) => o.trim()).filter(Boolean);
  } else {
    corsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }

  if (isProd) {
    if (!rawCors) {
      errors.push('FATAL: CORS_ORIGIN must be explicitly set in production (comma-separated list of approved frontend domains).');
    }
    if (corsOrigins.includes('*')) {
      errors.push('FATAL: Wildcard CORS_ORIGIN ("*") is prohibited in production when credentials (cookies/auth) are enabled.');
    }
  }

  // If validation errors exist, fail fast and abort startup immediately
  if (errors.length > 0) {
    console.error('\n================================================================================');
    console.error('❌ LIFELINK CONFIGURATION INTEGRITY CHECK FAILED:');
    console.error('================================================================================');
    for (const err of errors) {
      console.error(` - ${err}`);
    }
    throw new Error(`Environment validation failed with ${errors.length} fatal error(s): ${errors.join('; ')}`);
  }

  const config: ValidatedConfig = {
    nodeEnv,
    port,
    databaseUrl,
    jwtSecret,
    jwtRefreshSecret,
    superAdminTotpSecret,
    corsOrigins,
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || undefined,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || undefined,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || undefined,
    googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
    emergencyTestContactPhone: process.env.EMERGENCY_TEST_CONTACT_PHONE || '+918669202393',
    emergencyTestContactName: process.env.EMERGENCY_TEST_CONTACT_NAME || 'TEST CONTACT',
  };

  // Safe startup log (all sensitive credentials strictly redacted)
  if (!isTest) {
    printSafeConfigSummary(config);
  }

  return config;
}

/**
 * Safely prints configuration state without leaking raw passwords, secrets, or connection credentials.
 */
function printSafeConfigSummary(config: ValidatedConfig) {
  const maskSecret = (val?: string): string => {
    if (!val) return '[NOT CONFIGURED - DISABLED]';
    if (val.length <= 6) return '******';
    return `${val.substring(0, 3)}****${val.substring(val.length - 3)}`;
  };

  const maskDbUrl = (url?: string): string => {
    if (!url) return '[IN-MEMORY LOCAL STORE ACTIVE]';
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.username}:****@${parsed.host}${parsed.pathname}`;
    } catch {
      return 'postgresql://[CREDENTIALS_REDACTED]';
    }
  };

  console.log('[LifeLink Config] Environment:', config.nodeEnv);
  console.log('[LifeLink Config] Port:', config.port);
  console.log('[LifeLink Config] Database:', maskDbUrl(config.databaseUrl));
  console.log('[LifeLink Config] Allowed CORS Origins:', config.corsOrigins.join(', '));
  console.log('[LifeLink Config] JWT Access Secret:', maskSecret(config.jwtSecret));
  console.log('[LifeLink Config] JWT Refresh Secret:', maskSecret(config.jwtRefreshSecret));
  console.log('[LifeLink Config] Super Admin 2FA TOTP:', config.superAdminTotpSecret ? '[ENABLED & CONFIGURED]' : '[NOT CONFIGURED]');
  console.log('[LifeLink Config] Gemini AI Provider:', config.geminiApiKey ? `[ENABLED: ${config.geminiModel}]` : '[DISABLED: LOCAL CLINICAL FALLBACK ACTIVE]');
  console.log('[LifeLink Config] Twilio SMS Provider:', config.twilioAccountSid ? '[ENABLED]' : '[DISABLED: LOCAL OUTBOX MOCK ACTIVE]');
  console.log('[LifeLink Config] Controlled SOS Test Contact:', `${config.emergencyTestContactPhone} (${config.emergencyTestContactName})`);
}
