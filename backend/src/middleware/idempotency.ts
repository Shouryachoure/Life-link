import { Request, Response, NextFunction } from 'express';

interface CachedResponse {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  createdAt: number;
  inFlight: boolean;
}

// In-memory cache for idempotency keys with 15-minute TTL
const idempotencyStore = new Map<string, CachedResponse>();
const TTL_MS = 15 * 60 * 1000; // 15 minutes

// Periodic garbage collection every 5 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of idempotencyStore.entries()) {
    if (now - record.createdAt > TTL_MS) {
      idempotencyStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Prevent cleanup interval from holding process open in test runners
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

/**
 * Express middleware for atomic request idempotency on critical mutations
 * (e.g. SOS dispatch, appointment bookings, bed admissions, offer acceptance).
 */
export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only apply to mutating HTTP methods
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Extract idempotency key from header or body
  const rawKey =
    req.headers['idempotency-key'] ||
    req.headers['x-idempotency-key'] ||
    (req.body && typeof req.body === 'object' ? req.body.idempotencyKey : undefined);

  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
    // No idempotency key provided; proceed normally
    return next();
  }

  const key = rawKey.trim();
  const now = Date.now();
  const existing = idempotencyStore.get(key);

  if (existing) {
    // If expired, remove and treat as new
    if (now - existing.createdAt > TTL_MS) {
      idempotencyStore.delete(key);
    } else if (existing.inFlight) {
      // In-flight concurrent tap detected
      res.status(409).json({
        message: 'A request with this idempotency key is currently processing. Please do not submit duplicate taps.',
        code: 'IDEMPOTENT_OPERATION_IN_FLIGHT',
        idempotencyKey: key,
      });
      return;
    } else {
      // Return cached idempotent response
      res.setHeader('X-Idempotent-Replay', 'true');
      res.setHeader('X-Idempotent-Key', key);
      res.status(existing.statusCode).json(existing.body);
      return;
    }
  }

  // Mark key as in-flight
  idempotencyStore.set(key, {
    statusCode: 200,
    body: null,
    headers: {},
    createdAt: now,
    inFlight: true,
  });

  // Capture original res.json and res.send
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = function (body: any): Response {
    if (res.statusCode < 500) {
      idempotencyStore.set(key, {
        statusCode: res.statusCode,
        body,
        headers: { 'Content-Type': 'application/json' },
        createdAt: Date.now(),
        inFlight: false,
      });
    } else {
      // On 5xx server error, remove key so client can safely retry
      idempotencyStore.delete(key);
    }
    res.setHeader('X-Idempotent-Key', key);
    return originalJson(body);
  };

  res.send = function (body: any): Response {
    if (res.statusCode < 500) {
      let parsed = body;
      try {
        if (typeof body === 'string') parsed = JSON.parse(body);
      } catch {
        // keep as string
      }
      idempotencyStore.set(key, {
        statusCode: res.statusCode,
        body: parsed,
        headers: {},
        createdAt: Date.now(),
        inFlight: false,
      });
    } else {
      idempotencyStore.delete(key);
    }
    res.setHeader('X-Idempotent-Key', key);
    return originalSend(body);
  };

  next();
}

/**
 * Manually retrieve an idempotency cache record (for testing and verification)
 */
export function getIdempotencyRecord(key: string): CachedResponse | undefined {
  return idempotencyStore.get(key);
}

/**
 * Manually clear the idempotency store (for test suite isolation)
 */
export function resetIdempotencyCache(): void {
  idempotencyStore.clear();
}
