import { sanitizeForLogging } from './privacyRedactor';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type OperationOutcome = 'SUCCESS' | 'FAILURE' | 'ATTEMPT' | 'DEGRADED';

export interface LogOptions {
  correlationId?: string;
  operationOutcome?: OperationOutcome;
  durationMs?: number;
  metadata?: Record<string, any>;
  error?: Error | any;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  correlationId?: string;
  message: string;
  operationOutcome?: OperationOutcome;
  durationMs?: number;
  metadata?: Record<string, any>;
  error?: {
    code?: string;
    message: string;
    stack?: string;
  };
}

/**
 * Sanitizes location coordinates in metadata to avoid storing exact patient GPS in plain-text logs.
 * Retains 2 decimal places (~1.1 km precision) for operational diagnostics without leaking exact household addresses.
 */
function sanitizeGpsInMetadata(meta?: Record<string, any>): Record<string, any> | undefined {
  if (!meta) return undefined;
  const sanitized = sanitizeForLogging(meta);
  if (typeof sanitized !== 'object' || sanitized === null) return sanitized;

  const out: Record<string, any> = Array.isArray(sanitized) ? [...sanitized] : { ...sanitized };

  for (const [key, value] of Object.entries(out)) {
    const lower = key.toLowerCase();
    if ((lower === 'lat' || lower === 'latitude' || lower === 'lng' || lower === 'longitude') && typeof value === 'number') {
      out[key] = parseFloat(value.toFixed(2));
    } else if (typeof value === 'object' && value !== null) {
      out[key] = sanitizeGpsInMetadata(value);
    }
  }

  return out;
}

class StructuredLogger {
  private formatLog(
    level: LogLevel,
    component: string,
    message: string,
    options?: LogOptions
  ): StructuredLogEntry {
    const isProd = process.env.NODE_ENV === 'production';
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      correlationId: options?.correlationId,
      message,
      operationOutcome: options?.operationOutcome,
      durationMs: options?.durationMs,
      metadata: sanitizeGpsInMetadata(options?.metadata),
    };

    if (options?.error) {
      entry.error = {
        code: options.error.code || options.error.name,
        message: options.error.message || String(options.error),
        stack: !isProd ? options.error.stack : undefined,
      };
    }

    return entry;
  }

  private writeLog(entry: StructuredLogEntry): void {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_TEST_LOGS) {
      return;
    }

    const jsonString = JSON.stringify(entry);

    switch (entry.level) {
      case 'ERROR':
        console.error(jsonString);
        break;
      case 'WARN':
        console.warn(jsonString);
        break;
      case 'DEBUG':
        if (process.env.NODE_ENV !== 'production') {
          console.debug(jsonString);
        }
        break;
      case 'INFO':
      default:
        console.log(jsonString);
        break;
    }
  }

  public info(component: string, message: string, options?: LogOptions): StructuredLogEntry {
    const entry = this.formatLog('INFO', component, message, options);
    this.writeLog(entry);
    return entry;
  }

  public warn(component: string, message: string, options?: LogOptions): StructuredLogEntry {
    const entry = this.formatLog('WARN', component, message, options);
    this.writeLog(entry);
    return entry;
  }

  public error(component: string, message: string, options?: LogOptions): StructuredLogEntry {
    const entry = this.formatLog('ERROR', component, message, options);
    this.writeLog(entry);
    return entry;
  }

  public debug(component: string, message: string, options?: LogOptions): StructuredLogEntry {
    const entry = this.formatLog('DEBUG', component, message, options);
    this.writeLog(entry);
    return entry;
  }

  public logOperation(
    component: string,
    operation: string,
    outcome: OperationOutcome,
    options?: LogOptions
  ): StructuredLogEntry {
    const level: LogLevel = outcome === 'FAILURE' ? 'ERROR' : outcome === 'DEGRADED' ? 'WARN' : 'INFO';
    const message = `Operation ${operation} completed with outcome: ${outcome}`;
    const entry = this.formatLog(level, component, message, {
      ...options,
      operationOutcome: outcome,
    });
    this.writeLog(entry);
    return entry;
  }
}

export const logger = new StructuredLogger();
export default logger;
