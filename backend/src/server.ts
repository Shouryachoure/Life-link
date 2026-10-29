import http from 'http';
import { Server } from 'socket.io';
import app, { corsOptions } from './app';
import { setupSocketHandlers } from './socket';
import prisma from './db';
import { recoverInterruptedDispatches } from './services/dispatchEngine';
import { processOutboxRetries, expireObsoleteOffers } from './services/notificationService';

const server = http.createServer(app);

// Setup socket.io with shared cors configuration
const io = new Server(server, {
  cors: corsOptions,
});

setupSocketHandlers(io);

const PORT = Number(process.env.PORT) || 5000;

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[LifeLink] Backend Server running on port ${PORT} (0.0.0.0)`);
  console.log(`[LifeLink] Health check available at: http://localhost:${PORT}/api/v1/health`);
  console.log(`[LifeLink] DB Readiness check at: http://localhost:${PORT}/api/v1/health/ready`);

  // System Startup Recovery
  try {
    const dispatchRecovery = await recoverInterruptedDispatches();
    const outboxRecovery = await processOutboxRetries();
    const expiredOffers = await expireObsoleteOffers();
    console.log(
      `[LifeLink Recovery] Startup recovery complete: ${dispatchRecovery.expiredCount} stale dispatch offer(s) expired, ${outboxRecovery.delivered} pending notification(s) delivered, ${expiredOffers} obsolete notification(s) expired.`
    );
  } catch (err: any) {
    console.warn('[LifeLink Recovery] Startup recovery notice:', err?.message);
  }

  // Periodic Background Workers (Active in development/production, disabled in isolated test mode)
  if (process.env.NODE_ENV !== 'test') {
    setInterval(async () => {
      try {
        await processOutboxRetries();
        await expireObsoleteOffers();
      } catch {
        // Background worker silent retry
      }
    }, 60 * 1000).unref();
  }
});

// Graceful shutdown management
const gracefulShutdown = async (signal: string) => {
  console.log(`\n[LifeLink] Received ${signal}. Starting graceful shutdown...`);

  // Close HTTP and Socket connections
  server.close(async () => {
    console.log('[LifeLink] Closed remaining HTTP/Socket connections.');
    try {
      await prisma.$disconnect();
      console.log('[LifeLink] Disconnected Prisma database client.');
    } catch (err: any) {
      console.error('[LifeLink] Error disconnecting Prisma client:', err?.message);
    }
    process.exit(0);
  });

  // Force shutdown after 10s if connections remain open
  setTimeout(() => {
    console.error('[LifeLink] Forcing shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { server, io };
