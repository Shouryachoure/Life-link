import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import prisma from '../db';

dotenv.config();

/**
 * Super Administrator Secure Bootstrap Script
 * Usage:
 *   BOOTSTRAP_ADMIN_EMAIL="admin@lifelink.org" BOOTSTRAP_ADMIN_PASSWORD="YourStrongPassword123" npm run bootstrap:admin
 * Or:
 *   npx ts-node src/scripts/bootstrapAdmin.ts --email=admin@lifelink.org --password=YourStrongPassword123
 */
async function bootstrapSuperAdmin() {
  console.log('[Bootstrap] Initiating Super Administrator verification...');

  // Parse arguments or environment variables
  const args = process.argv.slice(2);
  const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1];
  const passwordArg = args.find((a) => a.startsWith('--password='))?.split('=')[1];
  const nameArg = args.find((a) => a.startsWith('--name='))?.split('=')[1];

  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || emailArg || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || passwordArg || '';
  const name = (process.env.BOOTSTRAP_ADMIN_NAME || nameArg || 'System Administrator').trim();

  try {
    // 1. Safeguard: Check if any Super Admin already exists
    const existingSuperAdmin = await prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN },
    });

    if (existingSuperAdmin) {
      console.error(
        '[Bootstrap FAILED] A Super Administrator account already exists in this database. For security, initial bootstrap cannot be re-executed.'
      );
      process.exit(1);
    }

    // 2. Validate input credentials
    if (!email || !email.includes('@')) {
      console.error('[Bootstrap FAILED] A valid email address is required. Set BOOTSTRAP_ADMIN_EMAIL or pass --email=...');
      process.exit(1);
    }

    if (!password || password.length < 12) {
      console.error('[Bootstrap FAILED] Password must be at least 12 characters long. Set BOOTSTRAP_ADMIN_PASSWORD or pass --password=...');
      process.exit(1);
    }

    // 3. Hash password using bcrypt (cost factor 12)
    const salt = bcrypt.genSaltSync(12);
    const passwordHash = bcrypt.hashSync(password, salt);

    // 4. Create Super Administrator record
    const createdAdmin = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: Role.SUPER_ADMIN,
        isActive: true,
      },
    });

    // 5. Success confirmation without printing credentials or hashes
    const maskedEmail = email.replace(/(^.{2})(.*)(@.*$)/, '$1***$3');
    console.log(`[Bootstrap SUCCESS] Initial Super Administrator created successfully for email: ${maskedEmail} (ID: ${createdAdmin.id}).`);
    console.log('[Bootstrap] Please store your credentials securely. Initial bootstrap is now permanently locked.');
  } catch (err: any) {
    console.error('[Bootstrap Error] Database error during administrator provisioning:', err?.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  bootstrapSuperAdmin();
}

export { bootstrapSuperAdmin };
