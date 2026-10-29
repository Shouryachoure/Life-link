import prisma from './db';

/**
 * Diagnostic utility to check local PostgreSQL connectivity.
 * Tests if the database defined in DATABASE_URL responds to a simple query.
 */
async function checkDatabaseConnection() {
  const dbUrl = process.env.DATABASE_URL || 'NOT CONFIGURED';
  // Mask password in database URL for safe logging
  const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`[DB Check] Connecting to database at: ${maskedUrl}`);

  try {
    const startTime = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - startTime;
    console.log(`[DB Check] PostgreSQL connection successful! (Latency: ${latency}ms)`);
  } catch (err: any) {
    console.error(`[DB Check] PostgreSQL connection failed: ${err.message}`);
    console.log(`\nTo set up local PostgreSQL for LifeLink:`);
    console.log(`1. Ensure PostgreSQL is installed and the service is running on port 5432.`);
    console.log(`2. Create a database, e.g.: CREATE DATABASE lifelink;`);
    console.log(`3. Set DATABASE_URL in backend/.env: DATABASE_URL="postgresql://user:password@localhost:5432/lifelink"`);
    console.log(`4. Run migrations: npm run prisma:migrate --prefix backend`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  checkDatabaseConnection();
}

export { checkDatabaseConnection };
