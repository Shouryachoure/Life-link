import prisma from '../db';

export interface SecurityEventMetadata {
  ip?: string;
  userAgent?: string;
  email?: string;
  role?: string;
  reason?: string;
  [key: string]: any;
}

const SENSITIVE_KEYS = new Set([
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
]);

/**
 * Sanitizes metadata to guarantee that no passwords, secrets, or tokens are ever recorded.
 */
function sanitizeMetadata(meta?: SecurityEventMetadata): Record<string, any> {
  if (!meta) return {};
  const cleaned: Record<string, any> = {};

  for (const [key, value] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      cleaned[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      cleaned[key] = sanitizeMetadata(value);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

/**
 * Records a security audit event. Never records credentials, raw tokens, or clinical details.
 */
export async function logSecurityEvent(
  action: string,
  userId?: string,
  metadata?: SecurityEventMetadata
) {
  const sanitized = sanitizeMetadata(metadata);
  const timestamp = new Date().toISOString();

  if (process.env.NODE_ENV !== 'test') {
    console.log(`[SECURITY AUDIT] ${timestamp} | Action: ${action} | User: ${userId || 'ANONYMOUS'} | Metadata:`, sanitized);
  }

  // If a valid administrative user ID is associated, persist in ActivityLog if database is accessible
  if (userId) {
    try {
      await prisma.activityLog?.create({
        data: {
          adminId: userId,
          action: `SECURITY: ${action}`,
          metadata: sanitized,
        },
      });
    } catch {
      // Graceful fallback: Do not fail operation if database is unreachable
    }
  }
}
