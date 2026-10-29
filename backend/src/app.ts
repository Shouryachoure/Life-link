import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import prisma from './db';

// Load env variables
dotenv.config();

// Route imports
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import ambulanceRoutes from './routes/ambulances';
import hospitalRoutes from './routes/hospitals';
import requestRoutes from './routes/requests';
import adminRoutes from './routes/admin';
import healthRoutes from './routes/health';
import queueRoutes from './routes/queue';
import uploadRoutes from './routes/upload';
import chatbotRoutes from './routes/chatbot';
import doctorRoutes from './routes/doctors';
import appointmentRoutes from './routes/appointments';
import emergencyContactRoutes from './routes/emergencyContacts';
import verificationRoutes from './routes/verification';
import sosRoutes from './routes/sos';
import notificationRoutes from './routes/notifications';
import serviceAreaRoutes from './routes/serviceAreas';
import emergencyProfileRoutes from './routes/emergencyProfile';
import tripShareRoutes from './routes/tripShare';
import analyticsRoutes from './routes/analytics';
import directoryRoutes from './routes/directory';
import onboardingRoutes from './routes/onboarding';

import { validateEnvironment } from './config/envValidator';
import { correlationIdMiddleware, CorrelatedRequest } from './middleware/correlationId';
import { idempotencyMiddleware } from './middleware/idempotency';
import { logger } from './utils/logger';
import { metrics } from './utils/metrics';

const app = express();

// Execute environment and secrets validation on startup
export const envConfig = validateEnvironment();

// Correlation ID Tracking Middleware
app.use(correlationIdMiddleware as any);

// Configurable CORS supporting environment origins and local development
const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (envConfig.corsOrigins.includes(origin)) {
    return true;
  }
  // Allow localhost loopback and private LAN origins (RFC 1918) in development or test mode
  if (
    envConfig.nodeEnv !== 'production' &&
    (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
     /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin))
  ) {
    return true;
  }
  return false;
};

export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cookie',
    'Idempotency-Key',
    'idempotency-key',
    'x-idempotency-key',
    'X-Correlation-Id',
  ],
  exposedHeaders: ['X-Idempotent-Replay', 'X-Idempotent-Key', 'X-Correlation-Id'],
};

// Standard Security Headers Middleware (OWASP recommended baseline)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(idempotencyMiddleware as any);

// Access-controlled document serving (eliminates public access to uploaded identity/medical documents)
import { handleSecureDocumentDownload } from './routes/upload';
import { authenticate } from './middleware/auth';
app.get(['/uploads/:filename', '/uploads/*'], authenticate as any, handleSecureDocumentDownload as any);
app.get(['/api/v1/documents/:filename', '/api/v1/documents/*'], authenticate as any, handleSecureDocumentDownload as any);

// Structured Request Logging & Operational Metrics Collection
app.use((req: CorrelatedRequest, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.recordHttpRequest(req.method, req.route?.path || req.path, res.statusCode, duration);

    const outcome = res.statusCode >= 500 ? 'FAILURE' : res.statusCode >= 400 ? 'DEGRADED' : 'SUCCESS';
    logger.logOperation('HTTP_REQUEST', `${req.method} ${req.originalUrl} [${res.statusCode}]`, outcome, {
      correlationId: req.correlationId,
      durationMs: duration,
      metadata: {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      },
    });
  });
  next();
});

// Process Health Endpoint (Process Liveness)
const healthHandler = (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'LifeLink Backend API',
    version: '2.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
};

// Mount health endpoints
app.get(['/api/v1/health', '/api/health', '/health'], healthHandler);

// Database Readiness Endpoint (Infrastructure Readiness)
const readinessHandler = async (_req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    // 3-second timeout promise race for PostgreSQL readiness check
    const queryPromise = prisma.$queryRaw`SELECT 1`;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database query timed out after 3000ms')), 3000)
    );

    await Promise.race([queryPromise, timeoutPromise]);
    const latencyMs = Date.now() - startTime;

    return res.status(200).json({
      status: 'ready',
      service: 'LifeLink Backend API',
      database: {
        status: 'connected',
        type: 'PostgreSQL',
        latencyMs,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    // Fail closed with HTTP 503 without leaking connection strings, secrets, or internal stack traces
    return res.status(503).json({
      status: 'degraded',
      service: 'LifeLink Backend API',
      database: {
        status: 'unavailable',
        message: 'Database connection offline or unreachable. Please verify database connection settings and PostgreSQL service.',
      },
      timestamp: new Date().toISOString(),
    });
  }
};

app.get(['/api/v1/health/ready', '/api/health/ready', '/health/ready', '/ready'], readinessHandler);

// Versioned API Routes (/api/v1/...) with backward-compatible aliases (/api/...)
const registerRoute = (pathSuffix: string, router: express.Router) => {
  app.use(`/api/v1/${pathSuffix}`, router);
  app.use(`/api/${pathSuffix}`, router);
};

registerRoute('auth', authRoutes);
registerRoute('profile', profileRoutes);
registerRoute('ambulances', ambulanceRoutes);
registerRoute('hospitals', hospitalRoutes);
registerRoute('requests', requestRoutes);
registerRoute('admin', adminRoutes);
registerRoute('health-metrics', healthRoutes);
registerRoute('queue', queueRoutes);
registerRoute('upload', uploadRoutes);
registerRoute('chatbot', chatbotRoutes);
registerRoute('doctors', doctorRoutes);
registerRoute('appointments', appointmentRoutes);
registerRoute('emergency-contacts', emergencyContactRoutes);
registerRoute('verification', verificationRoutes);
registerRoute('sos', sosRoutes);
registerRoute('notifications', notificationRoutes);
registerRoute('service-areas', serviceAreaRoutes);
registerRoute('emergency-profile', emergencyProfileRoutes);
registerRoute('trip-share', tripShareRoutes);
registerRoute('emergency-trip-share', tripShareRoutes);
registerRoute('analytics', analyticsRoutes);
registerRoute('directory', directoryRoutes);
registerRoute('onboarding', onboardingRoutes);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'fail',
    message: `Resource not found: ${req.method} ${req.originalUrl}`,
  });
});

// Centralized Error Handling Middleware (Sanitizes stack traces and internal errors)
import { sanitizeForLogging } from './utils/privacyRedactor';

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd && process.env.NODE_ENV !== 'test') {
    console.error(`[Unhandled Error] ${req.method} ${req.originalUrl}:`, sanitizeForLogging(err.message || err));
  }

  res.status(statusCode).json({
    status: 'error',
    message: isProd && statusCode === 500 ? 'An unexpected internal error occurred.' : sanitizeForLogging(err.message || 'Internal server error'),
    ...(isProd ? {} : { stack: err.stack }),
  });
});

export default app;
