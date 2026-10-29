/**
 * LifeLink India — Operational Metrics Registry
 * 
 * In-memory, zero-dependency, thread-safe operational metrics collector.
 * Derives telemetry strictly from real system activity without manufactured metrics.
 * Supports both JSON API snapshot and Prometheus/OpenMetrics text exposition.
 */

export interface LatencyStats {
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

export interface OperationalMetricsSnapshot {
  timestamp: string;
  uptimeSeconds: number;
  http: {
    totalRequests: number;
    totalErrors: number;
    errorRatePercent: number;
    byStatusCode: Record<string, number>;
    byMethod: Record<string, number>;
    latency: LatencyStats;
  };
  database: {
    totalOperations: number;
    totalFailures: number;
    slowQueriesCount: number;
    latency: LatencyStats;
  };
  dispatch: {
    offersTotal: number;
    acceptancesTotal: number;
    expirationsTotal: number;
    rejectionsTotal: number;
    cancellationsTotal: number;
    noEligibleAmbulanceTotal: number;
  };
  gps: {
    updatesTotal: number;
    staleLocationCount: number;
    freshnessSecondsTotal: number;
    avgFreshnessSeconds: number;
  };
  sockets: {
    activeConnections: number;
    connectsTotal: number;
    disconnectsTotal: number;
  };
  appointments: {
    createdTotal: number;
    cancelledTotal: number;
    rescheduledTotal?: number;
  };
  notifications: {
    dispatchedTotal: number;
    deliveredTotal: number;
    retriedTotal: number;
    failedTotal: number;
    outboxBacklogCount: number;
  };
  workers: {
    runsTotal: number;
    failuresTotal: number;
    lastRunTimestamp?: string;
  };
}

class OperationalMetricsRegistry {
  private startTime: number = Date.now();

  // HTTP
  private httpRequestsTotal: number = 0;
  private httpErrorsTotal: number = 0;
  private httpStatusCodes: Map<string, number> = new Map();
  private httpMethods: Map<string, number> = new Map();
  private httpLatencyTotalMs: number = 0;
  private httpLatencyMinMs: number = Infinity;
  private httpLatencyMaxMs: number = 0;

  // DB
  private dbOperationsTotal: number = 0;
  private dbFailuresTotal: number = 0;
  private dbSlowQueriesCount: number = 0;
  private dbLatencyTotalMs: number = 0;
  private dbLatencyMinMs: number = Infinity;
  private dbLatencyMaxMs: number = 0;

  // Dispatch
  private dispatchOffersTotal: number = 0;
  private dispatchAcceptancesTotal: number = 0;
  private dispatchExpirationsTotal: number = 0;
  private dispatchRejectionsTotal: number = 0;
  private dispatchCancellationsTotal: number = 0;
  private dispatchNoEligibleAmbulanceTotal: number = 0;

  // GPS
  private gpsUpdatesTotal: number = 0;
  private gpsStaleLocationCount: number = 0;
  private gpsFreshnessSecondsTotal: number = 0;

  // Sockets
  private socketActiveConnections: number = 0;
  private socketConnectsTotal: number = 0;
  private socketDisconnectsTotal: number = 0;

  // Appointments
  private appointmentsCreatedTotal: number = 0;
  private appointmentsCancelledTotal: number = 0;
  private appointmentsRescheduledTotal: number = 0;

  // Notifications
  private notificationsDispatchedTotal: number = 0;
  private notificationsDeliveredTotal: number = 0;
  private notificationsRetriedTotal: number = 0;
  private notificationsFailedTotal: number = 0;
  private outboxBacklogCount: number = 0;

  // Workers
  private workerRunsTotal: number = 0;
  private workerFailuresTotal: number = 0;
  private workerLastRunTimestamp?: string;

  // -------------------------------------------------------------
  // Recording Methods
  // -------------------------------------------------------------

  public recordHttpRequest(method: string, _path: string, statusCode: number, durationMs: number): void {
    this.httpRequestsTotal++;
    const codeKey = `${Math.floor(statusCode / 100)}xx`;
    this.httpStatusCodes.set(codeKey, (this.httpStatusCodes.get(codeKey) || 0) + 1);

    const mKey = method.toUpperCase();
    this.httpMethods.set(mKey, (this.httpMethods.get(mKey) || 0) + 1);

    if (statusCode >= 400) {
      this.httpErrorsTotal++;
    }

    this.httpLatencyTotalMs += durationMs;
    if (durationMs < this.httpLatencyMinMs) this.httpLatencyMinMs = durationMs;
    if (durationMs > this.httpLatencyMaxMs) this.httpLatencyMaxMs = durationMs;
  }

  public recordDbOperation(_operation: string, _model: string, success: boolean, durationMs: number): void {
    this.dbOperationsTotal++;
    if (!success) {
      this.dbFailuresTotal++;
    }
    if (durationMs > 200) {
      this.dbSlowQueriesCount++;
    }
    this.dbLatencyTotalMs += durationMs;
    if (durationMs < this.dbLatencyMinMs) this.dbLatencyMinMs = durationMs;
    if (durationMs > this.dbLatencyMaxMs) this.dbLatencyMaxMs = durationMs;
  }

  public recordDispatchOffer(outcome: 'OFFERED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'NO_ELIGIBLE'): void {
    switch (outcome) {
      case 'OFFERED':
        this.dispatchOffersTotal++;
        break;
      case 'ACCEPTED':
        this.dispatchAcceptancesTotal++;
        break;
      case 'REJECTED':
        this.dispatchRejectionsTotal++;
        break;
      case 'EXPIRED':
        this.dispatchExpirationsTotal++;
        break;
      case 'CANCELLED':
        this.dispatchCancellationsTotal++;
        break;
      case 'NO_ELIGIBLE':
        this.dispatchNoEligibleAmbulanceTotal++;
        break;
    }
  }

  public recordGpsUpdate(freshnessSeconds: number, isStale: boolean): void {
    this.gpsUpdatesTotal++;
    this.gpsFreshnessSecondsTotal += freshnessSeconds;
    if (isStale) {
      this.gpsStaleLocationCount++;
    }
  }

  public recordSocketConnect(): void {
    this.socketConnectsTotal++;
    this.socketActiveConnections++;
  }

  public recordSocketDisconnect(): void {
    this.socketDisconnectsTotal++;
    if (this.socketActiveConnections > 0) {
      this.socketActiveConnections--;
    }
  }

  public recordAppointment(action: 'CREATED' | 'CANCELLED' | 'RESCHEDULED'): void {
    if (action === 'CREATED') this.appointmentsCreatedTotal++;
    if (action === 'CANCELLED') this.appointmentsCancelledTotal++;
    if (action === 'RESCHEDULED') this.appointmentsRescheduledTotal++;
  }

  public recordNotification(status: 'DISPATCHED' | 'DELIVERED' | 'RETRIED' | 'FAILED'): void {
    switch (status) {
      case 'DISPATCHED':
        this.notificationsDispatchedTotal++;
        break;
      case 'DELIVERED':
        this.notificationsDeliveredTotal++;
        break;
      case 'RETRIED':
        this.notificationsRetriedTotal++;
        break;
      case 'FAILED':
        this.notificationsFailedTotal++;
        break;
    }
  }

  public setOutboxBacklogCount(count: number): void {
    this.outboxBacklogCount = Math.max(0, count);
  }

  public recordWorkerRun(_workerName: string, success: boolean): void {
    this.workerRunsTotal++;
    if (!success) {
      this.workerFailuresTotal++;
    }
    this.workerLastRunTimestamp = new Date().toISOString();
  }

  // -------------------------------------------------------------
  // Snapshot & Serialization
  // -------------------------------------------------------------

  public getSnapshot(): OperationalMetricsSnapshot {
    const errorRatePercent =
      this.httpRequestsTotal > 0
        ? parseFloat(((this.httpErrorsTotal / this.httpRequestsTotal) * 100).toFixed(2))
        : 0;

    const httpAvg =
      this.httpRequestsTotal > 0
        ? parseFloat((this.httpLatencyTotalMs / this.httpRequestsTotal).toFixed(2))
        : 0;

    const dbAvg =
      this.dbOperationsTotal > 0
        ? parseFloat((this.dbLatencyTotalMs / this.dbOperationsTotal).toFixed(2))
        : 0;

    const gpsAvgFreshness =
      this.gpsUpdatesTotal > 0
        ? parseFloat((this.gpsFreshnessSecondsTotal / this.gpsUpdatesTotal).toFixed(2))
        : 0;

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      http: {
        totalRequests: this.httpRequestsTotal,
        totalErrors: this.httpErrorsTotal,
        errorRatePercent,
        byStatusCode: Object.fromEntries(this.httpStatusCodes),
        byMethod: Object.fromEntries(this.httpMethods),
        latency: {
          count: this.httpRequestsTotal,
          totalMs: this.httpLatencyTotalMs,
          avgMs: httpAvg,
          minMs: this.httpLatencyMinMs === Infinity ? 0 : this.httpLatencyMinMs,
          maxMs: this.httpLatencyMaxMs,
        },
      },
      database: {
        totalOperations: this.dbOperationsTotal,
        totalFailures: this.dbFailuresTotal,
        slowQueriesCount: this.dbSlowQueriesCount,
        latency: {
          count: this.dbOperationsTotal,
          totalMs: this.dbLatencyTotalMs,
          avgMs: dbAvg,
          minMs: this.dbLatencyMinMs === Infinity ? 0 : this.dbLatencyMinMs,
          maxMs: this.dbLatencyMaxMs,
        },
      },
      dispatch: {
        offersTotal: this.dispatchOffersTotal,
        acceptancesTotal: this.dispatchAcceptancesTotal,
        expirationsTotal: this.dispatchExpirationsTotal,
        rejectionsTotal: this.dispatchRejectionsTotal,
        cancellationsTotal: this.dispatchCancellationsTotal,
        noEligibleAmbulanceTotal: this.dispatchNoEligibleAmbulanceTotal,
      },
      gps: {
        updatesTotal: this.gpsUpdatesTotal,
        staleLocationCount: this.gpsStaleLocationCount,
        freshnessSecondsTotal: this.gpsFreshnessSecondsTotal,
        avgFreshnessSeconds: gpsAvgFreshness,
      },
      sockets: {
        activeConnections: this.socketActiveConnections,
        connectsTotal: this.socketConnectsTotal,
        disconnectsTotal: this.socketDisconnectsTotal,
      },
      appointments: {
        createdTotal: this.appointmentsCreatedTotal,
        cancelledTotal: this.appointmentsCancelledTotal,
      },
      notifications: {
        dispatchedTotal: this.notificationsDispatchedTotal,
        deliveredTotal: this.notificationsDeliveredTotal,
        retriedTotal: this.notificationsRetriedTotal,
        failedTotal: this.notificationsFailedTotal,
        outboxBacklogCount: this.outboxBacklogCount,
      },
      workers: {
        runsTotal: this.workerRunsTotal,
        failuresTotal: this.workerFailuresTotal,
        lastRunTimestamp: this.workerLastRunTimestamp,
      },
    };
  }

  /**
   * Generates Prometheus / OpenMetrics text output format for scraping.
   */
  public toPrometheusFormat(): string {
    const snap = this.getSnapshot();
    const lines: string[] = [
      '# HELP lifelink_uptime_seconds Total application process uptime in seconds',
      '# TYPE lifelink_uptime_seconds gauge',
      `lifelink_uptime_seconds ${snap.uptimeSeconds}`,
      '',
      '# HELP lifelink_http_requests_total Total number of HTTP requests processed',
      '# TYPE lifelink_http_requests_total counter',
      `lifelink_http_requests_total ${snap.http.totalRequests}`,
      '',
      '# HELP lifelink_http_errors_total Total number of HTTP 4xx/5xx errors',
      '# TYPE lifelink_http_errors_total counter',
      `lifelink_http_errors_total ${snap.http.totalErrors}`,
      '',
      '# HELP lifelink_http_latency_ms Average HTTP request latency in milliseconds',
      '# TYPE lifelink_http_latency_ms gauge',
      `lifelink_http_latency_ms ${snap.http.latency.avgMs}`,
      '',
      '# HELP lifelink_db_operations_total Total database operations performed',
      '# TYPE lifelink_db_operations_total counter',
      `lifelink_db_operations_total ${snap.database.totalOperations}`,
      '',
      '# HELP lifelink_db_failures_total Total failed database operations',
      '# TYPE lifelink_db_failures_total counter',
      `lifelink_db_failures_total ${snap.database.totalFailures}`,
      '',
      '# HELP lifelink_db_slow_queries_total Queries exceeding 200ms latency',
      '# TYPE lifelink_db_slow_queries_total counter',
      `lifelink_db_slow_queries_total ${snap.database.slowQueriesCount}`,
      '',
      '# HELP lifelink_dispatch_offers_total Total dispatch offers emitted',
      '# TYPE lifelink_dispatch_offers_total counter',
      `lifelink_dispatch_offers_total ${snap.dispatch.offersTotal}`,
      `lifelink_dispatch_acceptances_total ${snap.dispatch.acceptancesTotal}`,
      `lifelink_dispatch_expirations_total ${snap.dispatch.expirationsTotal}`,
      `lifelink_dispatch_rejections_total ${snap.dispatch.rejectionsTotal}`,
      `lifelink_dispatch_cancellations_total ${snap.dispatch.cancellationsTotal}`,
      `lifelink_dispatch_no_eligible_total ${snap.dispatch.noEligibleAmbulanceTotal}`,
      '',
      '# HELP lifelink_gps_updates_total Total GPS pings ingested',
      '# TYPE lifelink_gps_updates_total counter',
      `lifelink_gps_updates_total ${snap.gps.updatesTotal}`,
      `lifelink_gps_stale_count ${snap.gps.staleLocationCount}`,
      '',
      '# HELP lifelink_socket_active_connections Current active WebSocket connections',
      '# TYPE lifelink_socket_active_connections gauge',
      `lifelink_socket_active_connections ${snap.sockets.activeConnections}`,
      `lifelink_socket_connects_total ${snap.sockets.connectsTotal}`,
      `lifelink_socket_disconnects_total ${snap.sockets.disconnectsTotal}`,
      '',
      '# HELP lifelink_notifications_dispatched_total Total notification events dispatched',
      '# TYPE lifelink_notifications_dispatched_total counter',
      `lifelink_notifications_dispatched_total ${snap.notifications.dispatchedTotal}`,
      `lifelink_notifications_delivered_total ${snap.notifications.deliveredTotal}`,
      `lifelink_notifications_retried_total ${snap.notifications.retriedTotal}`,
      `lifelink_notifications_failed_total ${snap.notifications.failedTotal}`,
      `lifelink_outbox_backlog_count ${snap.notifications.outboxBacklogCount}`,
    ];
    return lines.join('\n') + '\n';
  }

  public reset(): void {
    this.startTime = Date.now();
    this.httpRequestsTotal = 0;
    this.httpErrorsTotal = 0;
    this.httpStatusCodes.clear();
    this.httpMethods.clear();
    this.httpLatencyTotalMs = 0;
    this.httpLatencyMinMs = Infinity;
    this.httpLatencyMaxMs = 0;

    this.dbOperationsTotal = 0;
    this.dbFailuresTotal = 0;
    this.dbSlowQueriesCount = 0;
    this.dbLatencyTotalMs = 0;
    this.dbLatencyMinMs = Infinity;
    this.dbLatencyMaxMs = 0;

    this.dispatchOffersTotal = 0;
    this.dispatchAcceptancesTotal = 0;
    this.dispatchExpirationsTotal = 0;
    this.dispatchRejectionsTotal = 0;
    this.dispatchCancellationsTotal = 0;
    this.dispatchNoEligibleAmbulanceTotal = 0;

    this.gpsUpdatesTotal = 0;
    this.gpsStaleLocationCount = 0;
    this.gpsFreshnessSecondsTotal = 0;

    this.socketActiveConnections = 0;
    this.socketConnectsTotal = 0;
    this.socketDisconnectsTotal = 0;

    this.appointmentsCreatedTotal = 0;
    this.appointmentsCancelledTotal = 0;

    this.notificationsDispatchedTotal = 0;
    this.notificationsDeliveredTotal = 0;
    this.notificationsRetriedTotal = 0;
    this.notificationsFailedTotal = 0;
    this.outboxBacklogCount = 0;

    this.workerRunsTotal = 0;
    this.workerFailuresTotal = 0;
    this.workerLastRunTimestamp = undefined;
  }
}

export const metrics = new OperationalMetricsRegistry();
export default metrics;
