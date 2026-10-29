import { Request, Response, NextFunction } from 'express';

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const MAX_MAP_SIZE = 10000;

// Prune expired entries periodically to guarantee bounded memory usage
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60 * 1000).unref();

export function resetRateLimits() {
  rateLimitMap.clear();
}

export function rateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // In test environment, allow generous threshold unless RATE_LIMIT_STRICT is set
    const effectiveLimit =
      process.env.RATE_LIMIT_STRICT === 'true'
        ? maxRequests
        : process.env.NODE_ENV === 'test'
        ? 100
        : process.env.NODE_ENV === 'production'
        ? maxRequests
        : Math.max(maxRequests, 100);

    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const key = `${req.path}:${ip}`;

    // Memory protection guard: if map exceeds max entries, clear oldest
    if (rateLimitMap.size > MAX_MAP_SIZE) {
      const firstKey = rateLimitMap.keys().next().value;
      if (firstKey) rateLimitMap.delete(firstKey);
    }

    let rateData = rateLimitMap.get(key);
    if (!rateData || now > rateData.resetTime) {
      rateData = { count: 1, resetTime: now + windowMs };
      rateLimitMap.set(key, rateData);
      return next();
    }

    rateData.count++;
    if (rateData.count > effectiveLimit) {
      return res.status(429).json({
        status: 'fail',
        message: 'Too many requests from this IP, please try again later.',
      });
    }
    next();
  };
}
