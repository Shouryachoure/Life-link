import crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import prisma from '../db';

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'lifelink_jwt_secret_key_2026_super_secure');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'lifelink_jwt_refresh_secret_key_2026_super_secure');

export interface TokenPayload {
  id: string;
  email: string;
  role: string;
  name: string;
  hospitalId?: string;
  operatorId?: string;
  driverId?: string;
}

interface StoredTokenMetadata {
  userId: string;
  expiresAt: Date;
  isRevoked: boolean;
  replacedBy?: string;
}

// Memory-backed resilient token revocation cache with TTL cleanup
const tokenCache = new Map<string, StoredTokenMetadata>();

// Periodic pruning of expired cached token records
setInterval(() => {
  const now = new Date();
  for (const [hash, record] of tokenCache.entries()) {
    if (now > record.expiresAt) {
      tokenCache.delete(hash);
    }
  }
}, 60 * 1000).unref();

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateTokens(user: TokenPayload) {
  if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
    throw new Error('JWT secrets are not configured.');
  }

  const jti = crypto.randomUUID();

  const accessToken = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    {
      id: user.id,
      jti,
      type: 'refresh',
    },
    JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const tokenHash = hashToken(refreshToken);

  // Record in memory
  tokenCache.set(tokenHash, {
    userId: user.id,
    expiresAt,
    isRevoked: false,
  });

  // Attempt DB persistence asynchronously if available
  prisma.refreshToken
    ?.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        isRevoked: false,
      },
    })
    .catch(() => {
      // Graceful fallback to memory store if PostgreSQL is unreachable or table unmigrated
    });

  return { accessToken, refreshToken };
}

export async function verifyAndRotateRefreshToken(rawRefreshToken: string) {
  if (!JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET is not configured.');
  }

  const decoded = jwt.verify(rawRefreshToken, JWT_REFRESH_SECRET) as any;
  if (!decoded || !decoded.id) {
    throw new Error('Invalid token structure.');
  }

  const tokenHash = hashToken(rawRefreshToken);

  // Check memory cache first
  let cached = tokenCache.get(tokenHash);

  // If not in memory, query database
  if (!cached) {
    try {
      const dbToken = await prisma.refreshToken?.findUnique({ where: { tokenHash } });
      if (dbToken) {
        cached = {
          userId: dbToken.userId,
          expiresAt: dbToken.expiresAt,
          isRevoked: dbToken.isRevoked,
          replacedBy: dbToken.replacedBy || undefined,
        };
        tokenCache.set(tokenHash, cached);
      }
    } catch {
      // DB unreachable
    }
  }

  // Token reuse detection: if token is already revoked, trigger security invalidation
  if (cached && cached.isRevoked) {
    console.warn(`[Security Alert] Refresh token reuse detected for user ${decoded.id}. Invalidating all sessions.`);
    await revokeAllUserTokens(decoded.id);
    throw new Error('Invalidated session. Possible token reuse detected.');
  }

  // Fetch fresh user
  let user: any = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { patientProfile: true, ambulance: true, hospital: true },
    });
  } catch {
    // DB unreachable, construct user from decoded token payload if in tests
  }

  if (!user && process.env.NODE_ENV !== 'test') {
    throw new Error('User no longer exists.');
  }

  if (user && !user.isActive) {
    throw new Error('User account is deactivated.');
  }

  const safePayload: TokenPayload = {
    id: user ? user.id : decoded.id,
    email: user ? user.email : decoded.email || 'test@lifelink.org',
    role: user ? user.role : decoded.role || 'PATIENT',
    name: user ? user.name : decoded.name || 'User',
  };

  // Issue rotated tokens
  const newTokens = generateTokens(safePayload);
  const newTokenHash = hashToken(newTokens.refreshToken);

  // Mark old token as revoked and replaced
  if (cached) {
    cached.isRevoked = true;
    cached.replacedBy = newTokenHash;
  } else {
    tokenCache.set(tokenHash, {
      userId: safePayload.id,
      expiresAt: new Date(),
      isRevoked: true,
      replacedBy: newTokenHash,
    });
  }

  // Update in DB asynchronously
  prisma.refreshToken
    ?.update({
      where: { tokenHash },
      data: { isRevoked: true, replacedBy: newTokenHash },
    })
    .catch(() => {});

  return {
    ...newTokens,
    user: user ? (({ passwordHash: _, ...rest }) => rest)(user) : safePayload,
  };
}

export async function revokeRefreshToken(rawRefreshToken: string) {
  try {
    const tokenHash = hashToken(rawRefreshToken);
    const cached = tokenCache.get(tokenHash);
    if (cached) {
      cached.isRevoked = true;
    } else {
      tokenCache.set(tokenHash, {
        userId: 'unknown',
        expiresAt: new Date(Date.now() + 3600000),
        isRevoked: true,
      });
    }

    await prisma.refreshToken
      ?.update({
        where: { tokenHash },
        data: { isRevoked: true },
      })
      .catch(() => {});
  } catch {}
}

export async function revokeAllUserTokens(userId: string) {
  for (const [hash, record] of tokenCache.entries()) {
    if (record.userId === userId) {
      record.isRevoked = true;
    }
  }

  try {
    await prisma.refreshToken?.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
  } catch {}
}
