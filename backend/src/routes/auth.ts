import { Router, Response } from 'express';
import crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { Role, AmbulanceType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { authenticate, AuthRequest, normalizeRole } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { verifyTOTP } from '../utils/totp';
import prisma from '../db';
import {
  generateTokens,
  verifyAndRotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from '../services/tokenService';
import { logSecurityEvent } from '../utils/securityLogger';
import { normalizeIndianPhone } from '../utils/phoneUtils';
import {
  sendPhoneOTP,
  verifyPhoneOTP,
  requestOtp,
  verifyOtp,
  normalizeOtpIdentifier,
  OTP_CONFIG,
  OtpChannel,
  OtpPurpose,
} from '../utils/otpService';
import { evaluateDriverDispatchEligibility } from '../services/dispatchEligibility';
import { VerificationState } from '@prisma/client';

const router = Router();

const JWT_SECRET =
  process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'lifelink_jwt_secret_key_2026_super_secure');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SUPER_ADMIN_TOTP_SECRET =
  process.env.SUPER_ADMIN_TOTP_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'SUPERADMINSECRET123');

const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Failed login attempt tracking (throttles repeated brute force attempts)
interface FailedAttemptRecord {
  count: number;
  lockedUntil?: number;
}
const failedLoginTracker = new Map<string, FailedAttemptRecord>();

// Cleanup failed tracker entries after 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of failedLoginTracker.entries()) {
    if (record.lockedUntil && now > record.lockedUntil) {
      failedLoginTracker.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

// Helper to set refresh token in secure httpOnly cookie
function setRefreshTokenCookie(res: Response, token: string) {
  res.cookie('lifelink_refresh_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}

// -----------------------------------------------------------------------------
// 1. PUBLIC REGISTRATION (Patient Accounts Only)
// -----------------------------------------------------------------------------
router.post('/register', rateLimiter(5, 60 * 1000), async (req, res) => {
  const {
    name,
    email,
    password,
    confirmPassword,
    phone,
    role,
    acceptedTerms,
    // Patient Profile details
    bloodGroup,
    allergies,
    emergencyContactName,
    emergencyContactPhone,
    medicalNotes,
  } = req.body;

  // 1. Input presence validation
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ status: 'fail', message: 'Full name is required (minimum 2 characters).' });
  }

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ status: 'fail', message: 'Valid email address is required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ status: 'fail', message: 'Invalid email address format.' });
  }

  // 2. Password policy validation (Minimum 12 characters)
  if (!password || typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({
      status: 'fail',
      message: 'Password must be at least 12 characters long.',
    });
  }

  if (confirmPassword !== undefined && password !== confirmPassword) {
    return res.status(400).json({ status: 'fail', message: 'Password confirmation does not match.' });
  }

  // Phone number normalization (+91 standard E.164)
  let normalizedPhone: string | null = null;
  if (phone && typeof phone === 'string' && phone.trim().length > 0) {
    const phoneRes = normalizeIndianPhone(phone);
    if (!phoneRes.isValid) {
      return res.status(400).json({ status: 'fail', message: phoneRes.error });
    }
    normalizedPhone = phoneRes.normalized!;
  }

  // 3. Accepted terms acknowledgement
  if (acceptedTerms === false) {
    return res.status(400).json({ status: 'fail', message: 'You must acknowledge and accept the terms of service.' });
  }

  // 4. PUBLIC REGISTRATION SECURITY: Only PATIENT accounts are permitted for public signup
  if (role && normalizeRole(String(role)) !== Role.PATIENT) {
    await logSecurityEvent('PRIVILEGE_ESCALATION_ATTEMPT', undefined, {
      attemptedRole: role,
      email: normalizedEmail,
      ip: req.ip,
    });
    return res.status(400).json({
      status: 'fail',
      message: 'Public registration is restricted to PATIENT accounts only. Administrative and driver accounts must be provisioned.',
    });
  }

  try {
    // 5. Unique email check
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      await logSecurityEvent('REGISTRATION_DUPLICATE_ATTEMPT', existingUser.id, {
        email: normalizedEmail,
        ip: req.ip,
      });
      return res.status(400).json({ status: 'fail', message: 'An account with this email address already exists.' });
    }

    // 6. Secure password hashing with bcrypt (cost factor 12)
    const salt = bcrypt.genSaltSync(12);
    const passwordHash = bcrypt.hashSync(password, salt);

    // 7. Create user and patient profile atomically
    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          name: name.trim(),
          phone: normalizedPhone,
          isPhoneVerified: false, // Never claim verified without OTP verification
          role: Role.PATIENT,
        },
      });

      await tx.patientProfile.create({
        data: {
          userId: created.id,
          bloodGroup: bloodGroup || 'UNKNOWN',
          bloodGroupProvenance: bloodGroup && bloodGroup !== 'UNKNOWN' ? 'PATIENT_REPORTED' : 'UNKNOWN',
          allergies: allergies || '',
          allergiesProvenance: allergies ? 'PATIENT_REPORTED' : 'PATIENT_REPORTED',
          emergencyContactName: emergencyContactName || 'Emergency Contact',
          emergencyContactPhone: emergencyContactPhone || normalizedPhone || '',
          medicalNotes: medicalNotes || '',
        },
      });

      return created;
    });

    const freshUser = await prisma.user.findUnique({
      where: { id: newUser.id },
      include: { patientProfile: true },
    });

    if (!freshUser) {
      return res.status(500).json({ status: 'error', message: 'User registration failed.' });
    }

    // 8. Generate session tokens & cookie
    const { accessToken, refreshToken } = generateTokens({
      id: freshUser.id,
      email: freshUser.email,
      role: freshUser.role,
      name: freshUser.name,
    });

    setRefreshTokenCookie(res, refreshToken);

    await logSecurityEvent('USER_REGISTERED', freshUser.id, {
      role: freshUser.role,
      email: normalizedEmail,
      ip: req.ip,
    });

    const { passwordHash: _, ...safeUser } = freshUser;
    return res.status(201).json({
      status: 'success',
      token: accessToken,
      user: safeUser,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// 2. UNIFIED USER LOGIN
// -----------------------------------------------------------------------------
router.post('/login', rateLimiter(10, 60 * 1000), async (req, res) => {
  const { email, phone, password } = req.body;
  const rawIdentifier = (email || phone || '').trim();

  if (!rawIdentifier || !password || typeof password !== 'string') {
    return res.status(400).json({ status: 'fail', message: 'Email or phone and password are required.' });
  }

  let userWhere: any;
  let normalizedIdentifier: string;

  if (rawIdentifier.includes('@')) {
    normalizedIdentifier = rawIdentifier.toLowerCase();
    userWhere = { email: normalizedIdentifier };
  } else {
    const phoneRes = normalizeIndianPhone(rawIdentifier);
    if (!phoneRes.isValid) {
      return res.status(400).json({ status: 'fail', message: phoneRes.error });
    }
    normalizedIdentifier = phoneRes.normalized!;
    userWhere = { phone: normalizedIdentifier };
  }

  const clientKey = `${req.ip}:${normalizedIdentifier}`;
  const now = Date.now();

  // Check temporary failed login throttling
  const attempt = failedLoginTracker.get(clientKey);
  if (attempt && attempt.lockedUntil && now < attempt.lockedUntil) {
    const remainingMins = Math.ceil((attempt.lockedUntil - now) / 60000);
    return res.status(429).json({
      status: 'fail',
      message: `Too many failed login attempts. Please wait ${remainingMins} minute(s) before trying again.`,
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: userWhere,
      include: {
        patientProfile: true,
        driverProfile: true,
        ambulance: true,
        hospital: true,
        managedOperator: true,
      },
    });

    if (!user) {
      // Record failed attempt
      const current = attempt ? attempt.count + 1 : 1;
      const lockedUntil = current >= 5 ? now + 15 * 60 * 1000 : undefined;
      failedLoginTracker.set(clientKey, { count: current, lockedUntil });

      await logSecurityEvent('LOGIN_FAILED_UNKNOWN_USER', undefined, { identifier: normalizedIdentifier, ip: req.ip });
      return res.status(401).json({ status: 'fail', message: 'Invalid email or password.' });
    }

    if (user.isSuspended) {
      await logSecurityEvent('LOGIN_SUSPENDED_USER', user.id, { identifier: normalizedIdentifier, ip: req.ip });
      return res.status(403).json({
        status: 'fail',
        message: 'Your account has been suspended. Please contact an administrator.',
      });
    }

    if (!user.isActive) {
      await logSecurityEvent('LOGIN_DEACTIVATED_USER', user.id, { identifier: normalizedIdentifier, ip: req.ip });
      return res.status(403).json({
        status: 'fail',
        message: 'Your account has been deactivated. Please contact an administrator.',
      });
    }

    const isValidPassword = bcrypt.compareSync(password, user.passwordHash);
    if (!isValidPassword) {
      const current = attempt ? attempt.count + 1 : 1;
      const lockedUntil = current >= 5 ? now + 15 * 60 * 1000 : undefined;
      failedLoginTracker.set(clientKey, { count: current, lockedUntil });

      await logSecurityEvent('LOGIN_FAILED_BAD_PASSWORD', user.id, { identifier: normalizedIdentifier, ip: req.ip });
      return res.status(401).json({ status: 'fail', message: 'Invalid email or password.' });
    }

    // Reset failed counter on successful authentication
    failedLoginTracker.delete(clientKey);

    const { accessToken, refreshToken } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    setRefreshTokenCookie(res, refreshToken);

    await logSecurityEvent('LOGIN_SUCCESS', user.id, { role: user.role, identifier: normalizedIdentifier, ip: req.ip });

    const { passwordHash: _, ...safeUser } = user;
    return res.status(200).json({
      status: 'success',
      token: accessToken,
      accessToken,
      refreshToken,
      tokens: { accessToken, refreshToken },
      user: safeUser,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// 2B. GOOGLE OAUTH IDENTITY GATEWAY (Module I3 & I4)
// -----------------------------------------------------------------------------
router.post('/google', rateLimiter(10, 60 * 1000), async (req, res) => {
  const { credential, idToken } = req.body;
  const tokenToVerify = credential || idToken;

  if (!tokenToVerify) {
    return res.status(400).json({
      status: 'fail',
      code: 'MISSING_GOOGLE_CREDENTIAL',
      message: 'Google ID token or credential is required.',
    });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(400).json({
      status: 'fail',
      code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
      message: 'Google OAuth Client ID is not configured on the backend server. Please configure GOOGLE_CLIENT_ID in backend/.env.',
      instructions: [
        'Navigate to Google Cloud Console (https://console.cloud.google.com/) -> APIs & Services -> Credentials',
        'Create an OAuth 2.0 Client ID for Web application',
        'Configure authorized JavaScript origins (e.g. http://localhost:5173)',
        'Define GOOGLE_CLIENT_ID in backend/.env and VITE_GOOGLE_CLIENT_ID in frontend/.env',
      ],
      setupGuide: {
        step1: 'Navigate to Google Cloud Console (https://console.cloud.google.com/) -> APIs & Services -> Credentials',
        step2: 'Create an OAuth 2.0 Client ID for Web application',
        step3: 'Configure authorized JavaScript origins (e.g. http://localhost:5173)',
        step4: 'Define GOOGLE_CLIENT_ID in backend/.env and VITE_GOOGLE_CLIENT_ID in frontend/.env',
      },
    });
  }

  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken: tokenToVerify,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(401).json({
        status: 'fail',
        code: 'INVALID_GOOGLE_TOKEN',
        message: 'Could not verify Google identity or extract email from token.',
      });
    }

    const email = payload.email.toLowerCase().trim();
    const name = payload.name || payload.given_name || 'Google User';

    let user = await prisma.user.findUnique({
      where: { email },
      include: { patientProfile: true },
    });

    if (user) {
      if (user.isSuspended) {
        return res.status(403).json({
          status: 'fail',
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been administratively suspended.',
        });
      }
      if (!user.isActive) {
        return res.status(403).json({
          status: 'fail',
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Your account has been deactivated.',
        });
      }
    } else {
      // Safe auto-provisioning for public Google OAuth: strictly PATIENT role only (mitigate privilege escalation)
      const randomPassword = crypto.randomUUID();
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(randomPassword, salt);

      user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: Role.PATIENT,
          isActive: true,
          isPhoneVerified: false,
        },
        include: { patientProfile: true },
      });

      await prisma.patientProfile.create({
        data: {
          userId: user.id,
          bloodGroup: 'UNKNOWN',
          emergencyContactName: 'Primary Emergency Contact',
          emergencyContactPhone: '',
        },
      });
    }

    const { accessToken, refreshToken } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    setRefreshTokenCookie(res, refreshToken);

    await logSecurityEvent('GOOGLE_LOGIN_SUCCESS', user.id, { email });

    const { passwordHash: _, ...safeUser } = user;
    return res.status(200).json({
      status: 'success',
      token: accessToken,
      user: safeUser,
    });
  } catch (err: any) {
    return res.status(401).json({
      status: 'fail',
      code: 'INVALID_GOOGLE_TOKEN',
      message: 'Google authentication failed: ' + (err.message || 'Invalid token'),
    });
  }
});

// -----------------------------------------------------------------------------
// 2C. SUPABASE IDENTITY & PROFILE SYNCHRONIZATION GATEWAY
// -----------------------------------------------------------------------------
router.post('/supabase/sync', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ status: 'fail', message: 'Authentication required' });
  }

  const { bloodGroup, allergies, emergencyContactName, emergencyContactPhone, medicalNotes } = req.body || {};

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        patientProfile: true,
        driverProfile: true,
        ambulance: true,
        hospital: true,
        managedOperator: true,
      },
    });

    if (!user) {
      return res.status(404).json({ status: 'fail', message: 'User record not found.' });
    }

    // If additional medical profile information was provided, update it idempotently
    if (user.role === Role.PATIENT && (bloodGroup || allergies || emergencyContactName || emergencyContactPhone || medicalNotes)) {
      await prisma.patientProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          bloodGroup: bloodGroup || 'O+',
          allergies: allergies || undefined,
          emergencyContactName: emergencyContactName || undefined,
          emergencyContactPhone: emergencyContactPhone || undefined,
          medicalNotes: medicalNotes || undefined,
        },
        update: {
          bloodGroup: bloodGroup || undefined,
          allergies: allergies || undefined,
          emergencyContactName: emergencyContactName || undefined,
          emergencyContactPhone: emergencyContactPhone || undefined,
          medicalNotes: medicalNotes || undefined,
        },
      });
    }

    // Generate local JWT tokens as well for hybrid compatibility with existing APIs and cookies
    const { accessToken, refreshToken } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    setRefreshTokenCookie(res, refreshToken);

    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        patientProfile: true,
        driverProfile: true,
        ambulance: true,
        hospital: true,
        managedOperator: true,
      },
    });

    const { passwordHash: _, ...safeUser } = updatedUser || user;
    return res.status(200).json({
      status: 'success',
      token: accessToken,
      accessToken,
      refreshToken,
      user: safeUser,
    });
  } catch (error: any) {
    console.error('Supabase sync error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to synchronize Supabase profile.' });
  }
});

// -----------------------------------------------------------------------------
// 3. HOSPITAL ADMIN LOGIN GATEWAY
// -----------------------------------------------------------------------------
router.post('/admin-login', rateLimiter(5, 60 * 1000), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ status: 'fail', message: 'Email and password are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { hospital: true },
    });

    if (!user || user.role !== Role.ADMIN_HOSPITAL) {
      return res.status(401).json({ status: 'fail', message: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ status: 'fail', message: 'Account deactivated.' });
    }

    const isValid = bcrypt.compareSync(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ status: 'fail', message: 'Invalid email or password.' });
    }

    const { accessToken, refreshToken } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    setRefreshTokenCookie(res, refreshToken);
    await logSecurityEvent('HOSPITAL_ADMIN_LOGIN', user.id, { hospitalId: user.hospitalId, ip: req.ip });

    const { passwordHash: _, ...safeUser } = user;
    return res.status(200).json({
      status: 'success',
      token: accessToken,
      user: safeUser,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// 4. SUPER ADMIN LOGIN GATEWAY (With 2FA TOTP Verification)
// -----------------------------------------------------------------------------
router.post('/super-admin-login', rateLimiter(3, 60 * 1000), async (req, res) => {
  const { email, password, totpCode } = req.body;
  if (!email || !password) {
    return res.status(400).json({ status: 'fail', message: 'Email and password are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    if (!SUPER_ADMIN_TOTP_SECRET) {
      return res.status(503).json({
        status: 'error',
        message: 'Super admin two-factor authentication is not configured on this server.',
      });
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || user.role !== Role.SUPER_ADMIN) {
      return res.status(401).json({ status: 'fail', message: 'Invalid credentials.' });
    }

    const isValid = bcrypt.compareSync(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ status: 'fail', message: 'Invalid credentials.' });
    }

    if (!totpCode || !verifyTOTP(SUPER_ADMIN_TOTP_SECRET, String(totpCode))) {
      await logSecurityEvent('SUPER_ADMIN_2FA_FAILED', user.id, { email: normalizedEmail, ip: req.ip });
      return res.status(400).json({ status: 'fail', message: 'Invalid 2FA authentication code.' });
    }

    const { accessToken, refreshToken } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    setRefreshTokenCookie(res, refreshToken);
    await logSecurityEvent('SUPER_ADMIN_LOGIN_SUCCESS', user.id, { ip: req.ip });

    const { passwordHash: _, ...safeUser } = user;
    return res.status(200).json({
      status: 'success',
      token: accessToken,
      user: safeUser,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// 5. SESSION REFRESH (With Token Rotation & Revocation Tracking)
// -----------------------------------------------------------------------------
router.post('/refresh', async (req, res) => {
  const tokenFromCookie = req.cookies?.lifelink_refresh_token;
  const tokenFromBody = req.body?.refreshToken;
  const rawToken = tokenFromCookie || tokenFromBody;

  if (!rawToken || typeof rawToken !== 'string') {
    return res.status(401).json({ status: 'fail', message: 'Session expired. Refresh token required.' });
  }

  try {
    const rotated = await verifyAndRotateRefreshToken(rawToken);
    setRefreshTokenCookie(res, rotated.refreshToken);

    return res.status(200).json({
      status: 'success',
      token: rotated.accessToken,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      tokens: { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken },
      user: rotated.user,
    });
  } catch (err: any) {
    res.clearCookie('lifelink_refresh_token', { path: '/' });
    return res.status(401).json({ status: 'fail', message: err.message || 'Session invalid or expired.' });
  }
});

// -----------------------------------------------------------------------------
// 6. SESSION LOGOUT (Revokes Refresh Token & Clears Cookie)
// -----------------------------------------------------------------------------
router.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.lifelink_refresh_token || req.body?.refreshToken;
  if (rawToken && typeof rawToken === 'string') {
    await revokeRefreshToken(rawToken);
  }

  res.clearCookie('lifelink_refresh_token', { path: '/' });
  await logSecurityEvent('LOGOUT_SUCCESS', undefined, { ip: req.ip });

  return res.status(200).json({ status: 'success', message: 'Logged out successfully.' });
});

// -----------------------------------------------------------------------------
// 7. GET AUTHENTICATED PROFILE (GET /api/v1/auth/me)
// -----------------------------------------------------------------------------
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ status: 'fail', message: 'Unauthorized.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        patientProfile: true,
        ambulance: true,
        hospital: true,
      },
    });

    if (!user) {
      return res.status(404).json({ status: 'fail', message: 'User not found.' });
    }

    const { passwordHash, ...safeUser } = user;
    return res.status(200).json({ status: 'success', user: safeUser });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// 8. UPDATE AUTHENTICATED PROFILE (PATCH /api/v1/auth/me)
// -----------------------------------------------------------------------------
router.patch('/me', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ status: 'fail', message: 'Unauthorized.' });
  }

  // Explicit mass-assignment protection: reject role/id/email changes
  if (req.body.role !== undefined && normalizeRole(req.body.role) !== req.user.role) {
    await logSecurityEvent('PRIVILEGE_ESCALATION_ATTEMPT', req.user.id, {
      attemptedRole: req.body.role,
      ip: req.ip,
    });
    return res.status(403).json({ status: 'fail', message: 'Role modifications are prohibited.' });
  }

  const { name, phone, bloodGroup, allergies, emergencyContactName, emergencyContactPhone, medicalNotes } = req.body;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const userUpdate: any = {};
      if (name !== undefined && typeof name === 'string' && name.trim().length >= 2) {
        userUpdate.name = name.trim();
      }
      if (phone !== undefined) {
        userUpdate.phone = typeof phone === 'string' ? phone.trim() : null;
      }

      const user = await tx.user.update({
        where: { id: req.user!.id },
        data: userUpdate,
      });

      let profile = null;
      if (req.user!.role === Role.PATIENT) {
        profile = await tx.patientProfile.upsert({
          where: { userId: req.user!.id },
          update: {
            bloodGroup: bloodGroup !== undefined ? bloodGroup : undefined,
            allergies: allergies !== undefined ? allergies : undefined,
            emergencyContactName: emergencyContactName !== undefined ? emergencyContactName : undefined,
            emergencyContactPhone: emergencyContactPhone !== undefined ? emergencyContactPhone : undefined,
            medicalNotes: medicalNotes !== undefined ? medicalNotes : undefined,
          },
          create: {
            userId: req.user!.id,
            bloodGroup: bloodGroup || 'O+',
            allergies: allergies || '',
            emergencyContactName: emergencyContactName || 'Emergency Contact',
            emergencyContactPhone: emergencyContactPhone || phone || '',
            medicalNotes: medicalNotes || '',
          },
        });
      }

      return { ...user, patientProfile: profile };
    });

    await logSecurityEvent('PROFILE_UPDATED', req.user.id, { ip: req.ip });

    const { passwordHash: _, ...safeUser } = updated;
    return res.status(200).json({ status: 'success', user: safeUser });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// 9. CHANGE PASSWORD (POST /api/v1/auth/change-password)
// -----------------------------------------------------------------------------
router.post('/change-password', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ status: 'fail', message: 'Unauthorized.' });
  }

  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ status: 'fail', message: 'Current password and new password are required.' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 12) {
    return res.status(400).json({ status: 'fail', message: 'New password must be at least 12 characters long.' });
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return res.status(400).json({ status: 'fail', message: 'New password and confirmation do not match.' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ status: 'fail', message: 'New password cannot be identical to the current password.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ status: 'fail', message: 'User not found.' });
    }

    const isMatch = bcrypt.compareSync(currentPassword, user.passwordHash);
    if (!isMatch) {
      await logSecurityEvent('PASSWORD_CHANGE_BAD_CURRENT_PASSWORD', user.id, { ip: req.ip });
      return res.status(400).json({ status: 'fail', message: 'Current password is incorrect.' });
    }

    // Hash new password with bcrypt (12 rounds)
    const salt = bcrypt.genSaltSync(12);
    const newPasswordHash = bcrypt.hashSync(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash },
    });

    // Invalidate all existing refresh tokens for security
    await revokeAllUserTokens(user.id);
    res.clearCookie('lifelink_refresh_token', { path: '/' });

    await logSecurityEvent('PASSWORD_CHANGED_SUCCESS', user.id, { ip: req.ip });

    return res.status(200).json({ status: 'success', message: 'Password changed successfully. Please log in with your new credentials.' });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// 10. PUBLIC HOSPITAL FACILITY REGISTRATION (Pending Verification)
// -----------------------------------------------------------------------------
router.post('/register-hospital', rateLimiter(5, 60 * 1000), async (req, res) => {
  const { hospitalName, services, contactNumber, address, email, password } = req.body;

  if (!hospitalName || !contactNumber || !email || !password) {
    return res.status(400).json({ status: 'fail', message: 'Hospital name, contact number, email, and password are required.' });
  }

  if (typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ status: 'fail', message: 'Password must be at least 12 characters long.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(400).json({ status: 'fail', message: 'An account with this email address already exists.' });
    }

    const salt = bcrypt.genSaltSync(12);
    const passwordHash = bcrypt.hashSync(password, salt);

    const registration = await prisma.hospitalRegistration.create({
      data: {
        hospitalName: String(hospitalName).trim(),
        services: services || 'Emergency ER, General Medicine',
        contactNumber: String(contactNumber).trim(),
        address: address || '',
        email: normalizedEmail,
        passwordHash,
        status: 'PENDING',
      },
    });

    await logSecurityEvent('HOSPITAL_REGISTRATION_SUBMITTED', undefined, {
      hospitalName,
      email: normalizedEmail,
      ip: req.ip,
    });

    return res.status(201).json({
      status: 'success',
      message: 'Hospital facility registration submitted successfully. Pending administrative review.',
      registrationId: registration.id,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
});

// -----------------------------------------------------------------------------
// 11. PHONE OTP DISPATCH (Development simulation with explicit banner)
// -----------------------------------------------------------------------------
router.post('/send-phone-otp', rateLimiter(5, 60 * 1000), async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ status: 'fail', message: 'Indian phone number is required.' });
  }

  const phoneRes = normalizeIndianPhone(phone);
  if (!phoneRes.isValid) {
    return res.status(400).json({ status: 'fail', message: phoneRes.error });
  }

  const result = await sendPhoneOTP(phoneRes.normalized!);
  return res.status(200).json({
    status: 'success',
    ...result,
  });
});

// -----------------------------------------------------------------------------
// 12. PHONE OTP VERIFICATION (Genuinely updates isPhoneVerified)
// -----------------------------------------------------------------------------
router.post('/verify-phone-otp', rateLimiter(5, 60 * 1000), async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ status: 'fail', message: 'Phone number and 6-digit OTP code are required.' });
  }

  const phoneRes = normalizeIndianPhone(phone);
  if (!phoneRes.isValid) {
    return res.status(400).json({ status: 'fail', message: phoneRes.error });
  }

  const result = verifyPhoneOTP(phoneRes.normalized!, String(code));
  if (!result.verified) {
    return res.status(400).json({ status: 'fail', message: result.message });
  }

  // Update user record if an account exists for this phone
  const user = await prisma.user.findFirst({ where: { phone: phoneRes.normalized! } });
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { isPhoneVerified: true },
    });
    await logSecurityEvent('PHONE_VERIFIED_SUCCESS', user.id, { phone: phoneRes.normalized!, ip: req.ip });
  }

  return res.status(200).json({
    status: 'success',
    verified: true,
    phone: phoneRes.normalized!,
    message: 'Phone number successfully verified.',
  });
});

// -----------------------------------------------------------------------------
// 12A. UNIFIED OTP DISPATCH (Email OTP & Phone OTP)
// -----------------------------------------------------------------------------
router.post('/otp/send', rateLimiter(10, 60 * 1000), async (req, res) => {
  const { identifier, channel, purpose } = req.body;

  if (!identifier || typeof identifier !== 'string') {
    return res.status(400).json({ status: 'fail', message: 'Identifier (email or mobile number) is required.' });
  }

  const validPurposes: OtpPurpose[] = ['REGISTRATION', 'LOGIN', 'PASSWORD_RESET', 'PHONE_VERIFY'];
  const assignedPurpose: OtpPurpose = validPurposes.includes(purpose) ? purpose : 'REGISTRATION';

  const norm = normalizeOtpIdentifier(identifier, channel);
  if (!norm.valid) {
    return res.status(400).json({ status: 'fail', message: norm.error });
  }

  try {
    // Purpose-specific pre-checks
    if (assignedPurpose === 'REGISTRATION') {
      const userWhere = norm.channel === 'EMAIL' ? { email: norm.normalized } : { phone: norm.normalized };
      const existingUser = await prisma.user.findFirst({ where: userWhere });
      if (existingUser) {
        return res.status(400).json({
          status: 'fail',
          message: `An account with this ${norm.channel === 'EMAIL' ? 'email address' : 'phone number'} already exists. Please log in.`,
        });
      }
    } else if (assignedPurpose === 'LOGIN') {
      const userWhere = norm.channel === 'EMAIL' ? { email: norm.normalized } : { phone: norm.normalized };
      const existingUser = await prisma.user.findFirst({ where: userWhere });
      if (!existingUser) {
        return res.status(404).json({
          status: 'fail',
          message: 'No registered LifeLink account found for this recipient. Please create an account.',
        });
      }
      if (existingUser.isSuspended) {
        return res.status(403).json({ status: 'fail', message: 'Your account has been suspended. Please contact an administrator.' });
      }
      if (!existingUser.isActive) {
        return res.status(403).json({ status: 'fail', message: 'Your account has been deactivated. Please contact an administrator.' });
      }
    }

    const result = await requestOtp({
      identifier: norm.normalized,
      channel: norm.channel,
      purpose: assignedPurpose,
    });

    await logSecurityEvent('OTP_DISPATCH_REQUESTED', undefined, {
      channel: result.channel,
      purpose: assignedPurpose,
      ip: req.ip,
    });

    return res.status(200).json({
      status: 'success',
      ...result,
    });
  } catch (error: any) {
    if (error.message?.includes('second(s) before requesting')) {
      return res.status(429).json({ status: 'fail', message: error.message });
    }
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to dispatch verification code.' });
  }
});

// -----------------------------------------------------------------------------
// 12B. UNIFIED OTP VERIFICATION & ACCOUNT ACTIVATION
// -----------------------------------------------------------------------------
router.post('/otp/verify', rateLimiter(15, 60 * 1000), async (req, res) => {
  const { identifier, channel, purpose, code, registrationData } = req.body;

  if (!identifier || !code) {
    return res.status(400).json({ status: 'fail', message: 'Identifier and 6-digit verification code are required.' });
  }

  const validPurposes: OtpPurpose[] = ['REGISTRATION', 'LOGIN', 'PASSWORD_RESET', 'PHONE_VERIFY'];
  const assignedPurpose: OtpPurpose = validPurposes.includes(purpose) ? purpose : 'REGISTRATION';

  const verifyResult = verifyOtp({
    identifier,
    channel,
    purpose: assignedPurpose,
    code: String(code),
  });

  if (!verifyResult.verified) {
    return res.status(400).json({
      status: 'fail',
      message: verifyResult.message,
      remainingAttempts: verifyResult.remainingAttempts,
    });
  }

  try {
    // 1. REGISTRATION VERIFICATION
    if (assignedPurpose === 'REGISTRATION') {
      const regData = registrationData || {};
      const name = (regData.name || '').trim();
      const email = (regData.email || (verifyResult.channel === 'EMAIL' ? verifyResult.identifier : '')).trim().toLowerCase();
      const phone = (regData.phone || (verifyResult.channel === 'PHONE' ? verifyResult.identifier : '')).trim();
      const password = regData.password;
      const confirmPassword = regData.confirmPassword;

      if (!name || name.length < 2) {
        return res.status(400).json({ status: 'fail', message: 'Full legal name is required.' });
      }

      if (!email || !email.includes('@')) {
        return res.status(400).json({ status: 'fail', message: 'A valid email address is required for LifeLink emergency records.' });
      }

      let normalizedPhone: string | null = null;
      if (phone) {
        const phoneRes = normalizeIndianPhone(phone);
        if (!phoneRes.isValid && verifyResult.channel === 'PHONE') {
          return res.status(400).json({ status: 'fail', message: phoneRes.error });
        }
        normalizedPhone = phoneRes.normalized || null;
      }

      // Check duplicates
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) {
        return res.status(400).json({ status: 'fail', message: 'An account with this email address already exists.' });
      }
      if (normalizedPhone) {
        const existingPhone = await prisma.user.findFirst({ where: { phone: normalizedPhone } });
        if (existingPhone) {
          return res.status(400).json({ status: 'fail', message: 'An account with this phone number already exists.' });
        }
      }

      // Password validation (min 12 chars if provided, or generated secure default for passwordless)
      let passwordToHash = password;
      if (!passwordToHash) {
        passwordToHash = crypto.randomBytes(24).toString('base64');
      } else {
        if (passwordToHash.length < 12) {
          return res.status(400).json({ status: 'fail', message: 'Password must be at least 12 characters long.' });
        }
        if (confirmPassword && passwordToHash !== confirmPassword) {
          return res.status(400).json({ status: 'fail', message: 'Password confirmation does not match.' });
        }
      }

      const salt = bcrypt.genSaltSync(12);
      const passwordHash = bcrypt.hashSync(passwordToHash, salt);

      const isEmailVerified = verifyResult.channel === 'EMAIL';
      const isPhoneVerified = verifyResult.channel === 'PHONE';

      const newUser = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            name,
            phone: normalizedPhone,
            isEmailVerified,
            isPhoneVerified,
            verificationMethod: verifyResult.channel,
            role: Role.PATIENT,
          },
        });

        await tx.patientProfile.create({
          data: {
            userId: created.id,
            bloodGroup: regData.bloodGroup || 'UNKNOWN',
            bloodGroupProvenance: regData.bloodGroup && regData.bloodGroup !== 'UNKNOWN' ? 'PATIENT_REPORTED' : 'UNKNOWN',
            allergies: regData.allergies || '',
            allergiesProvenance: regData.allergies ? 'PATIENT_REPORTED' : 'PATIENT_REPORTED',
            emergencyContactName: regData.emergencyContactName || 'Emergency Contact',
            emergencyContactPhone: regData.emergencyContactPhone || normalizedPhone || '',
            medicalNotes: regData.medicalNotes || '',
          },
        });

        return created;
      });

      const freshUser = await prisma.user.findUnique({
        where: { id: newUser.id },
        include: { patientProfile: true },
      });

      if (!freshUser) {
        return res.status(500).json({ status: 'error', message: 'Account activation failed.' });
      }

      const { accessToken, refreshToken } = generateTokens({
        id: freshUser.id,
        email: freshUser.email,
        role: freshUser.role,
        name: freshUser.name,
      });

      setRefreshTokenCookie(res, refreshToken);

      await logSecurityEvent('USER_REGISTERED_VERIFIED', freshUser.id, {
        channel: verifyResult.channel,
        email: freshUser.email,
        ip: req.ip,
      });

      const { passwordHash: _, ...safeUser } = freshUser;
      return res.status(201).json({
        status: 'success',
        token: accessToken,
        user: safeUser,
        verifiedChannel: verifyResult.channel,
        message: 'Account successfully verified and activated.',
      });
    }

    // 2. LOGIN VERIFICATION (Passwordless OTP Login)
    if (assignedPurpose === 'LOGIN') {
      const userWhere =
        verifyResult.channel === 'EMAIL'
          ? { email: verifyResult.identifier }
          : { phone: verifyResult.identifier };

      const user = await prisma.user.findFirst({
        where: userWhere,
        include: {
          patientProfile: true,
          driverProfile: true,
          ambulance: true,
          hospital: true,
          managedOperator: true,
        },
      });

      if (!user) {
        return res.status(404).json({ status: 'fail', message: 'Account not found.' });
      }

      if (user.isSuspended) {
        return res.status(403).json({ status: 'fail', message: 'Your account has been suspended. Please contact an administrator.' });
      }

      if (!user.isActive) {
        return res.status(403).json({ status: 'fail', message: 'Your account has been deactivated. Please contact an administrator.' });
      }

      // Automatically mark verified for this channel
      const updateData: any = {};
      if (verifyResult.channel === 'EMAIL' && !user.isEmailVerified) {
        updateData.isEmailVerified = true;
      }
      if (verifyResult.channel === 'PHONE' && !user.isPhoneVerified) {
        updateData.isPhoneVerified = true;
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }

      const { accessToken, refreshToken } = generateTokens({
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });

      setRefreshTokenCookie(res, refreshToken);

      await logSecurityEvent('USER_LOGIN_OTP_SUCCESS', user.id, {
        channel: verifyResult.channel,
        identifier: verifyResult.identifier,
        ip: req.ip,
      });

      const { passwordHash: _, ...safeUser } = user;
      return res.status(200).json({
        status: 'success',
        token: accessToken,
        user: safeUser,
        message: 'Login successful via OTP verification.',
      });
    }

    // 3. PASSWORD RESET VERIFICATION
    if (assignedPurpose === 'PASSWORD_RESET') {
      const userWhere =
        verifyResult.channel === 'EMAIL'
          ? { email: verifyResult.identifier }
          : { phone: verifyResult.identifier };

      const user = await prisma.user.findFirst({ where: userWhere });
      if (!user) {
        return res.status(404).json({ status: 'fail', message: 'Account not found for password reset.' });
      }

      const resetToken = jwt.sign(
        {
          id: user.id,
          purpose: 'PASSWORD_RESET',
          identifier: verifyResult.identifier,
        },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      return res.status(200).json({
        status: 'success',
        resetToken,
        message: 'OTP verified. You may now reset your password.',
      });
    }

    // 4. PHONE VERIFY
    if (assignedPurpose === 'PHONE_VERIFY') {
      const user = await prisma.user.findFirst({ where: { phone: verifyResult.identifier } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { isPhoneVerified: true },
        });
        await logSecurityEvent('PHONE_VERIFIED_SUCCESS', user.id, { phone: verifyResult.identifier, ip: req.ip });
      }
      return res.status(200).json({
        status: 'success',
        verified: true,
        phone: verifyResult.identifier,
        message: 'Phone number verified successfully.',
      });
    }

    return res.status(200).json({
      status: 'success',
      ...verifyResult,
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Internal server error during verification.' });
  }
});

// -----------------------------------------------------------------------------
// 12C. FORGOT PASSWORD WORKFLOW
// -----------------------------------------------------------------------------
router.post('/forgot-password/request', rateLimiter(5, 60 * 1000), async (req, res) => {
  const { identifier } = req.body;
  if (!identifier || typeof identifier !== 'string') {
    return res.status(400).json({ status: 'fail', message: 'Email or mobile number is required.' });
  }

  const norm = normalizeOtpIdentifier(identifier);
  if (!norm.valid) {
    return res.status(400).json({ status: 'fail', message: norm.error });
  }

  try {
    const userWhere = norm.channel === 'EMAIL' ? { email: norm.normalized } : { phone: norm.normalized };
    const user = await prisma.user.findFirst({ where: userWhere });

    if (!user) {
      return res.status(200).json({
        status: 'success',
        maskedRecipient: norm.channel === 'EMAIL' ? 'recipient@***' : '+91 ***** *****',
        channel: norm.channel,
        deliveryFeedback: 'If an account is associated with this contact, a reset verification code has been dispatched.',
      });
    }

    const result = await requestOtp({
      identifier: norm.normalized,
      channel: norm.channel,
      purpose: 'PASSWORD_RESET',
    });

    return res.status(200).json({
      status: 'success',
      ...result,
    });
  } catch (error: any) {
    if (error.message?.includes('second(s) before requesting')) {
      return res.status(429).json({ status: 'fail', message: error.message });
    }
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to request password reset code.' });
  }
});

router.post('/forgot-password/reset', rateLimiter(5, 60 * 1000), async (req, res) => {
  const { resetToken, newPassword, confirmPassword } = req.body;

  if (!resetToken || !newPassword) {
    return res.status(400).json({ status: 'fail', message: 'Reset token and new password are required.' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 12) {
    return res.status(400).json({ status: 'fail', message: 'Password must be at least 12 characters long.' });
  }

  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ status: 'fail', message: 'Password confirmation does not match.' });
  }

  try {
    let decoded: any;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch {
      return res.status(400).json({ status: 'fail', message: 'Invalid or expired password reset token. Please request a new code.' });
    }

    if (decoded.purpose !== 'PASSWORD_RESET' || !decoded.id) {
      return res.status(400).json({ status: 'fail', message: 'Invalid token purpose.' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(404).json({ status: 'fail', message: 'User account not found.' });
    }

    const salt = bcrypt.genSaltSync(12);
    const passwordHash = bcrypt.hashSync(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await revokeAllUserTokens(user.id);
    await logSecurityEvent('PASSWORD_RESET_SUCCESS', user.id, { ip: req.ip });

    return res.status(200).json({
      status: 'success',
      message: 'Password has been successfully updated. You may now log in with your new password.',
    });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to reset password.' });
  }
});

// -----------------------------------------------------------------------------
// 13. SEPARATE ONBOARDING: DRIVER ONBOARDING
// -----------------------------------------------------------------------------
router.post('/onboard/driver', rateLimiter(5, 60 * 1000), async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    confirmPassword,
    licenseNumber,
    licenseExpiry,
    organizationType,
    organizationId,
  } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ status: 'fail', message: 'Driver full name is required.' });
  }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ status: 'fail', message: 'Valid email address is required.' });
  }
  if (!phone) {
    return res.status(400).json({ status: 'fail', message: 'Indian mobile number is required.' });
  }
  const phoneRes = normalizeIndianPhone(phone);
  if (!phoneRes.isValid) {
    return res.status(400).json({ status: 'fail', message: phoneRes.error });
  }
  if (!password || password.length < 12) {
    return res.status(400).json({ status: 'fail', message: 'Password must be at least 12 characters long.' });
  }
  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ status: 'fail', message: 'Password confirmation does not match.' });
  }
  if (!licenseNumber || licenseNumber.trim().length < 5) {
    return res.status(400).json({ status: 'fail', message: 'Valid driving license number is required.' });
  }
  if (!licenseExpiry) {
    return res.status(400).json({ status: 'fail', message: 'Driving license expiry date is required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(400).json({ status: 'fail', message: 'An account with this email address already exists.' });
  }

  const salt = bcrypt.genSaltSync(12);
  const passwordHash = bcrypt.hashSync(password, salt);

  const newUser = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      phone: phoneRes.normalized!,
      isPhoneVerified: false,
      passwordHash,
      role: Role.DRIVER,
      isActive: true,
      isSuspended: false,
      hospitalId: organizationType === 'HOSPITAL' ? organizationId : null,
      operatorId: organizationType === 'PRIVATE_OPERATOR' ? organizationId : null,
    },
  });

  const driverProfile = await prisma.driverProfile.create({
    data: {
      userId: newUser.id,
      licenseNumber: licenseNumber.trim().toUpperCase(),
      licenseExpiry: new Date(licenseExpiry),
      verificationState: VerificationState.PENDING_REVIEW,
      organizationType: organizationType || 'INDEPENDENT',
      hospitalId: organizationType === 'HOSPITAL' ? organizationId : null,
      operatorId: organizationType === 'PRIVATE_OPERATOR' ? organizationId : null,
      membershipStatus: 'PENDING',
      isDispatchEligible: false,
      isDemo: false,
    },
  });

  const { accessToken, refreshToken } = generateTokens({
    id: newUser.id,
    email: newUser.email,
    role: newUser.role,
    name: newUser.name,
  });

  setRefreshTokenCookie(res, refreshToken);
  await logSecurityEvent('DRIVER_ONBOARDING_SUBMITTED', newUser.id, { email: normalizedEmail, ip: req.ip });

  const { passwordHash: _, ...safeUser } = newUser;
  return res.status(201).json({
    status: 'success',
    message: 'Driver onboarding submitted. Account is pending document verification and organization approval.',
    token: accessToken,
    user: safeUser,
    driverProfile,
    isDispatchEligible: false,
  });
});

// -----------------------------------------------------------------------------
// 14. SEPARATE ONBOARDING: HOSPITAL ONBOARDING
// -----------------------------------------------------------------------------
router.post('/onboard/hospital', rateLimiter(5, 60 * 1000), async (req, res) => {
  const hospitalName = req.body.hospitalName;
  const address = req.body.address;
  const city = req.body.city;
  const state = req.body.state;
  const contactPhone = req.body.contactPhone || req.body.phone;
  const adminName = req.body.adminName || req.body.name;
  const adminEmail = req.body.adminEmail || req.body.email;
  const password = req.body.password;
  const confirmPassword = req.body.confirmPassword;

  if (!hospitalName || !address || !contactPhone || !adminName || !adminEmail || !password) {
    return res.status(400).json({ status: 'fail', message: 'All hospital facility and administrator fields are required.' });
  }

  const phoneRes = normalizeIndianPhone(contactPhone);
  if (!phoneRes.isValid) {
    return res.status(400).json({ status: 'fail', message: phoneRes.error });
  }

  if (password.length < 12) {
    return res.status(400).json({ status: 'fail', message: 'Password must be at least 12 characters long.' });
  }

  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ status: 'fail', message: 'Password confirmation does not match.' });
  }

  const normalizedEmail = adminEmail.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(400).json({ status: 'fail', message: 'An account with this administrator email already exists.' });
  }

  const salt = bcrypt.genSaltSync(12);
  const passwordHash = bcrypt.hashSync(password, salt);

  const user = await prisma.user.create({
    data: {
      name: adminName.trim(),
      email: normalizedEmail,
      phone: phoneRes.normalized!,
      passwordHash,
      role: Role.ADMIN_HOSPITAL,
      isActive: true,
      isSuspended: false,
    },
  });

  const hospLat = req.body.lat !== undefined && !isNaN(parseFloat(req.body.lat)) ? parseFloat(req.body.lat) : 21.1458;
  const hospLng = req.body.lng !== undefined && !isNaN(parseFloat(req.body.lng)) ? parseFloat(req.body.lng) : 79.0882;

  const hospital = await prisma.hospital.create({
    data: {
      name: hospitalName.trim(),
      address: address.trim(),
      contactNumber: phoneRes.normalized!,
      city: city ? city.trim() : 'Nagpur',
      state: state ? state.trim() : 'Maharashtra',
      lat: hospLat,
      lng: hospLng,
      adminUserId: user.id,
      availableBeds: 0,
      verificationState: VerificationState.PENDING_REVIEW,
      isDemo: false,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { hospitalId: hospital.id },
  });

  const { accessToken, refreshToken } = generateTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });

  setRefreshTokenCookie(res, refreshToken);
  await logSecurityEvent('HOSPITAL_ONBOARDING_SUBMITTED', user.id, { hospitalId: hospital.id, ip: req.ip });

  const { passwordHash: _, ...safeUser } = user;
  return res.status(201).json({
    status: 'success',
    message: 'Hospital facility onboarding submitted. Status is pending administrative verification.',
    token: accessToken,
    tokens: { accessToken, refreshToken },
    user: { ...safeUser, hospitalId: hospital.id },
    hospital,
  });
});

// -----------------------------------------------------------------------------
// 15. SEPARATE ONBOARDING: PRIVATE AMBULANCE OPERATOR ONBOARDING
// -----------------------------------------------------------------------------
router.post('/onboard/operator', rateLimiter(5, 60 * 1000), async (req, res) => {
  const operatorName = req.body.operatorName;
  const tradeLicense = req.body.tradeLicense;
  const contactPhone = req.body.contactPhone || req.body.phone;
  const email = req.body.email || req.body.adminEmail;
  const address = req.body.address;
  const city = req.body.city;
  const state = req.body.state;
  const adminName = req.body.adminName || req.body.name;
  const password = req.body.password;
  const confirmPassword = req.body.confirmPassword;

  if (!operatorName || !tradeLicense || !contactPhone || !email || !adminName || !password) {
    return res.status(400).json({ status: 'fail', message: 'All operator organization and administrator fields are required.' });
  }

  const phoneRes = normalizeIndianPhone(contactPhone);
  if (!phoneRes.isValid) {
    return res.status(400).json({ status: 'fail', message: phoneRes.error });
  }

  if (password.length < 12) {
    return res.status(400).json({ status: 'fail', message: 'Password must be at least 12 characters long.' });
  }

  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ status: 'fail', message: 'Password confirmation does not match.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(400).json({ status: 'fail', message: 'An account with this administrator email already exists.' });
  }

  const salt = bcrypt.genSaltSync(12);
  const passwordHash = bcrypt.hashSync(password, salt);

  const user = await prisma.user.create({
    data: {
      name: adminName.trim(),
      email: normalizedEmail,
      phone: phoneRes.normalized!,
      passwordHash,
      role: Role.OPERATOR_ADMIN,
      isActive: true,
      isSuspended: false,
    },
  });

  const operator = await prisma.ambulanceOperator.create({
    data: {
      name: operatorName.trim(),
      tradeLicense: tradeLicense.trim().toUpperCase(),
      contactPhone: phoneRes.normalized!,
      email: normalizedEmail,
      address: address ? address.trim() : (city ? `${city.trim()} Fleet Operations Base` : 'Fleet Operations Yard'),
      city: city ? city.trim() : 'Nagpur',
      state: state ? state.trim() : 'Maharashtra',
      adminUserId: user.id,
      verificationState: VerificationState.PENDING_REVIEW,
      isDemo: false,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { operatorId: operator.id },
  });

  const { accessToken, refreshToken } = generateTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });

  setRefreshTokenCookie(res, refreshToken);
  await logSecurityEvent('OPERATOR_ONBOARDING_SUBMITTED', user.id, { operatorId: operator.id, ip: req.ip });

  const { passwordHash: _, ...safeUser } = user;
  return res.status(201).json({
    status: 'success',
    message: 'Private ambulance operator onboarding submitted. Status is pending administrative verification.',
    token: accessToken,
    tokens: { accessToken, refreshToken },
    user: { ...safeUser, operatorId: operator.id },
    operator,
  });
});

// -----------------------------------------------------------------------------
// 16. ONBOARDING STATUS (Role-Specific Progress & Incomplete Checklist)
// -----------------------------------------------------------------------------
router.get('/onboarding-status', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ status: 'fail', message: 'Unauthorized.' });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      driverProfile: {
        include: { assignments: { where: { isCurrent: true } } },
      },
      hospital: true,
      managedOperator: true,
      patientProfile: true,
    },
  });

  if (!user) {
    return res.status(404).json({ status: 'fail', message: 'User not found.' });
  }

  const missingSteps: string[] = [];

  if (user.role === Role.DRIVER) {
    const dp = user.driverProfile;
    const isVerified = dp?.verificationState === VerificationState.VERIFIED;
    const isMembershipApproved = dp?.membershipStatus === 'APPROVED';
    const hasVehicle = (dp?.assignments?.length || 0) > 0;

    if (!isVerified) missingSteps.push('Official driving license and identity verification pending review.');
    if (!isMembershipApproved) missingSteps.push('Organization (Hospital/Operator) membership approval pending.');
    if (!hasVehicle) missingSteps.push('No verified ambulance vehicle currently assigned.');

    return res.status(200).json({
      status: 'success',
      role: 'DRIVER',
      verificationState: dp?.verificationState || VerificationState.NOT_SUBMITTED,
      membershipStatus: dp?.membershipStatus || 'PENDING',
      isDispatchEligible: isVerified && isMembershipApproved && hasVehicle && !user.isSuspended,
      checklist: {
        accountActive: user.isActive && !user.isSuspended,
        phoneVerified: user.isPhoneVerified,
        licenseSubmitted: !!dp?.licenseNumber,
        driverVerified: isVerified,
        organizationApproved: isMembershipApproved,
        vehicleAssigned: hasVehicle,
      },
      missingSteps,
    });
  }

  if (user.role === Role.ADMIN_HOSPITAL) {
    const hosp = user.hospital;
    const isVerified = hosp?.verificationState === VerificationState.VERIFIED;
    if (!isVerified) missingSteps.push('Hospital establishment registration certificate verification pending.');

    return res.status(200).json({
      status: 'success',
      role: 'ADMIN_HOSPITAL',
      hospitalName: hosp?.name,
      hospital: hosp,
      verificationState: hosp?.verificationState || VerificationState.NOT_SUBMITTED,
      isOperationallyReady: isVerified,
      checklist: {
        accountActive: user.isActive && !user.isSuspended,
        hospitalLinked: !!hosp,
        hospitalVerified: isVerified,
      },
      missingSteps,
    });
  }

  if (user.role === Role.OPERATOR_ADMIN) {
    const op = user.managedOperator;
    const isVerified = op?.verificationState === VerificationState.VERIFIED;
    if (!isVerified) missingSteps.push('Private ambulance operator trade license verification pending.');

    return res.status(200).json({
      status: 'success',
      role: 'OPERATOR_ADMIN',
      operatorName: op?.name,
      operator: op,
      verificationState: op?.verificationState || VerificationState.NOT_SUBMITTED,
      isOperationallyReady: isVerified,
      checklist: {
        accountActive: user.isActive && !user.isSuspended,
        operatorLinked: !!op,
        operatorVerified: isVerified,
      },
      missingSteps,
    });
  }

  // Default: PATIENT
  if (!user.isPhoneVerified) missingSteps.push('Verify Indian phone number via OTP.');
  return res.status(200).json({
    status: 'success',
    role: 'PATIENT',
    isPhoneVerified: user.isPhoneVerified,
    checklist: {
      accountActive: user.isActive && !user.isSuspended,
      phoneVerified: user.isPhoneVerified,
      profileComplete: !!user.patientProfile,
    },
    missingSteps,
  });
});

// -----------------------------------------------------------------------------
// 17. DRIVER DISPATCH ELIGIBILITY CHECK
// -----------------------------------------------------------------------------
router.get('/driver-eligibility/:driverId', authenticate, async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  const result = await evaluateDriverDispatchEligibility(driverId);
  return res.status(200).json({
    status: 'success',
    ...result,
  });
});

export default router;
