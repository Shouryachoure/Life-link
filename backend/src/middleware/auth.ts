import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../db';
import { verifySupabaseToken, isSupabaseServerConfigured } from '../utils/supabaseClient';

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'lifelink_jwt_secret_key_2026_super_secure');

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  name: string;
  hospitalId?: string;
  operatorId?: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * Normalizes role aliases between prompt specification and Prisma schema.
 */
export function normalizeRole(role: string): string {
  if (role === 'AMBULANCE_DRIVER' || role === 'DRIVER') return Role.DRIVER;
  if (role === 'HOSPITAL_ADMIN' || role === 'ADMIN_HOSPITAL') return Role.ADMIN_HOSPITAL;
  if (role === 'PRIVATE_OPERATOR_ADMIN' || role === 'OPERATOR_ADMIN' || role === 'ADMIN_OPERATOR') return Role.OPERATOR_ADMIN;
  if (role === 'SUPER_ADMIN') return Role.SUPER_ADMIN;
  if (role === 'VERIFICATION_ADMIN') return 'VERIFICATION_ADMIN';
  if (role === 'PATIENT') return Role.PATIENT;
  return role;
}

/**
 * Authentication middleware: Validates JWT access token from Authorization header.
 * Fails closed with 401 if token is missing, expired, or invalid.
 * Fails closed with 403 if account is suspended or deactivated.
 */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'fail', message: 'Authorization token required.' });
  }

  const token = authHeader.split(' ')[1];

  // 1. Supabase Token Verification (if Supabase credentials are configured)
  if (isSupabaseServerConfigured()) {
    try {
      const { user: supabaseUser, error: sbError } = await verifySupabaseToken(token);
      if (supabaseUser && supabaseUser.id && supabaseUser.email) {
        // Find existing user by supabaseId or email
        let userRecord = await prisma.user.findUnique({
          where: { supabaseId: supabaseUser.id },
          include: { patientProfile: true },
        });

        if (!userRecord) {
          userRecord = await prisma.user.findUnique({
            where: { email: supabaseUser.email.toLowerCase().trim() },
            include: { patientProfile: true },
          });

          if (userRecord && !userRecord.supabaseId) {
            try {
              userRecord = await prisma.user.update({
                where: { id: userRecord.id },
                data: {
                  supabaseId: supabaseUser.id,
                  isEmailVerified: true,
                  verificationMethod: 'SUPABASE_EMAIL_OTP',
                },
                include: { patientProfile: true },
              });
            } catch {
              // Ignore update conflict
            }
          }
        }

        // Idempotently initialize patient record if not found
        if (!userRecord) {
          const metadata = supabaseUser.user_metadata || {};
          const userName = metadata.name || metadata.full_name || 'Patient';
          userRecord = await prisma.user.create({
            data: {
              name: userName,
              email: supabaseUser.email.toLowerCase().trim(),
              passwordHash: 'SUPABASE_MANAGED_AUTH',
              role: Role.PATIENT,
              isEmailVerified: true,
              verificationMethod: 'SUPABASE_EMAIL_OTP',
              supabaseId: supabaseUser.id,
              patientProfile: {
                create: {
                  bloodGroup: metadata.bloodGroup || 'O+',
                  allergies: metadata.allergies || null,
                },
              },
            },
            include: { patientProfile: true },
          });
        }

        if (userRecord.isSuspended) {
          return res.status(403).json({
            status: 'fail',
            message: 'Account suspended. Please contact administrator.',
          });
        }
        if (!userRecord.isActive) {
          return res.status(403).json({
            status: 'fail',
            message: 'Account deactivated.',
          });
        }

        req.user = {
          id: userRecord.id,
          email: userRecord.email,
          role: normalizeRole(userRecord.role),
          name: userRecord.name,
          hospitalId: userRecord.hospitalId || undefined,
          operatorId: userRecord.operatorId || undefined,
        };
        return next();
      }
    } catch (sbEx) {
      // Supabase verification error, proceed to fallback JWT verification
    }
  }

  // 2. Legacy / Local LifeLink JWT verification fallback
  if (!JWT_SECRET) {
    return res.status(500).json({ status: 'error', message: 'Authentication service configuration error.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded || !decoded.id || !decoded.role) {
      return res.status(401).json({ status: 'fail', message: 'Malformed authorization token.' });
    }

    // Verify account is not suspended or deactivated
    const userRecord = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (userRecord) {
      if (userRecord.isSuspended) {
        return res.status(403).json({
          status: 'fail',
          message: 'Account suspended. Please contact administrator.',
        });
      }
      if (!userRecord.isActive) {
        return res.status(403).json({
          status: 'fail',
          message: 'Account deactivated.',
        });
      }
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: normalizeRole(decoded.role),
      name: decoded.name,
      hospitalId: userRecord?.hospitalId || decoded.hospitalId,
      operatorId: userRecord?.operatorId || decoded.operatorId,
    };
    next();
  } catch (error: any) {
    return res.status(401).json({ status: 'fail', message: 'Invalid or expired authorization token.' });
  }
}

/**
 * Centralized authorization middleware: Enforces role-based permissions.
 * Rejects unauthorized users with HTTP 403.
 */
export function authorize(allowedRoles: (Role | string)[]) {
  const normalizedAllowed = new Set(allowedRoles.map((r) => normalizeRole(String(r))));

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ status: 'fail', message: 'Authentication required.' });
    }

    const userRole = normalizeRole(req.user.role);
    if (!normalizedAllowed.has(userRole)) {
      return res.status(403).json({
        status: 'fail',
        message: 'Forbidden: Insufficient privileges for this role.',
      });
    }

    next();
  };
}

/**
 * Horizontal privilege protection: Ensures a user can only view or modify their own resource,
 * unless granted SUPER_ADMIN privileges.
 */
export function requireSelfOrAdmin(targetUserIdParam = 'userId') {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ status: 'fail', message: 'Authentication required.' });
    }

    const targetUserId = req.params[targetUserIdParam] || req.body[targetUserIdParam] || req.query[targetUserIdParam];
    if (req.user.role === Role.SUPER_ADMIN || req.user.id === targetUserId) {
      return next();
    }

    return res.status(403).json({
      status: 'fail',
      message: 'Forbidden: You do not have permission to access another user\'s records.',
    });
  };
}

/**
 * Hospital isolation middleware: Restricts hospital administrators to operations
 * within their assigned hospital facility.
 */
export function requireHospitalScope(hospitalIdParam = 'hospitalId') {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ status: 'fail', message: 'Authentication required.' });
    }

    // Super admin has global hospital management scope
    if (req.user.role === Role.SUPER_ADMIN) {
      return next();
    }

    const targetHospitalId =
      req.params[hospitalIdParam] || req.body[hospitalIdParam] || req.query[hospitalIdParam];

    if (req.user.role === Role.ADMIN_HOSPITAL) {
      if (req.user.hospitalId && req.user.hospitalId === targetHospitalId) {
        return next();
      }
    }

    return res.status(403).json({
      status: 'fail',
      message: 'Forbidden: You are not authorized to manage operations for another hospital facility.',
    });
  };
}

/**
 * Private Operator isolation middleware: Restricts operator administrators to operations
 * within their assigned private ambulance operator organization.
 */
export function requireOperatorScope(operatorIdParam = 'operatorId') {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ status: 'fail', message: 'Authentication required.' });
    }

    if (req.user.role === Role.SUPER_ADMIN) {
      return next();
    }

    const targetOperatorId =
      req.params[operatorIdParam] || req.body[operatorIdParam] || req.query[operatorIdParam];

    if (req.user.role === Role.OPERATOR_ADMIN) {
      if (req.user.operatorId && req.user.operatorId === targetOperatorId) {
        return next();
      }
    }

    return res.status(403).json({
      status: 'fail',
      message: 'Forbidden: You are not authorized to manage operations for another private ambulance operator.',
    });
  };
}
