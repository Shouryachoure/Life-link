import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface CorrelatedRequest extends Request {
  correlationId?: string;
  startTime?: number;
}

/**
 * Middleware to extract or generate an end-to-end Correlation ID (X-Correlation-ID / X-Request-ID).
 * Attaches the identifier to the request object and echoes it back in the HTTP response headers.
 */
export function correlationIdMiddleware(req: CorrelatedRequest, res: Response, next: NextFunction): void {
  const incomingId =
    req.headers['x-correlation-id'] ||
    req.headers['x-request-id'] ||
    req.headers['correlation-id'];

  const correlationId =
    typeof incomingId === 'string' && incomingId.trim().length > 0
      ? incomingId.trim()
      : `ll-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  req.correlationId = correlationId;
  req.startTime = Date.now();

  // Set outgoing response headers
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Request-ID', correlationId);

  next();
}
