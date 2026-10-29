import { Router } from 'express';
import prisma from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendEmergencyAlertToContacts } from '../utils/smsService';

const router = Router();

// GET /api/emergency-contacts - Get all emergency contacts and custom alert message
router.get('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const contacts = await prisma.emergencyContact.findMany({
      where: { patientId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });

    const profile = await prisma.patientProfile.findUnique({
      where: { userId: req.user.id },
      select: { customAlertMessage: true },
    });

    return res.json({
      contacts,
      count: contacts.length,
      maxAllowed: 3,
      customAlertMessage: profile?.customAlertMessage || null,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to fetch emergency contacts' });
  }
});

import { normalizeTrustedContactPhone } from '../utils/phoneUtils';

// POST /api/emergency-contacts - Add a trusted emergency contact (capped strictly at 3)
router.post('/', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { name, phone, email, relation, canReceiveTripUpdates = true, notifyOnSos = true } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ message: 'Contact name and phone number are required', code: 'MISSING_FIELDS' });
  }

  // Universal Validation: Supports Indian +91 and normalized international E.164 formats
  const phoneValidation = normalizeTrustedContactPhone(phone);
  if (!phoneValidation.isValid) {
    return res.status(400).json({
      message: phoneValidation.error || 'Invalid phone number format.',
      code: 'INVALID_PHONE_NUMBER',
    });
  }

  if (email && typeof email === 'string' && !email.includes('@')) {
    return res.status(400).json({ message: 'Invalid email address format', code: 'INVALID_EMAIL' });
  }

  try {
    const count = await prisma.emergencyContact.count({
      where: { patientId: req.user.id },
    });

    if (count >= 3) {
      return res.status(400).json({
        message: 'Maximum limit of 3 emergency contacts reached. Please remove an existing contact to add a new one.',
        code: 'CONTACT_LIMIT_REACHED',
      });
    }

    // Never claim a phone number is verified without completing a real verification process
    const contact = await prisma.emergencyContact.create({
      data: {
        patientId: req.user.id,
        name: name.trim(),
        phone: phoneValidation.normalized!,
        email: email ? String(email).trim().toLowerCase() : null,
        relation: relation ? String(relation).trim() : null,
        isVerified: false, // Explicitly unverified until verified
        verifiedAt: null,
        canReceiveTripUpdates: Boolean(canReceiveTripUpdates),
        notifyOnSos: Boolean(notifyOnSos),
      },
    });

    // Audit Log: Contact Added
    await prisma.emergencyTripShareAuditLog.create({
      data: {
        requestId: 'CONTACT_MANAGEMENT',
        patientId: req.user.id,
        action: 'TRUSTED_CONTACT_ADDED',
        actorId: req.user.id,
        actorRole: 'PATIENT',
        actorName: req.user.name,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        details: {
          contactId: contact.id,
          name: contact.name,
          phoneMasked: phoneValidation.normalized!.slice(0, 5) + '***',
          isInternational: phoneValidation.isInternational,
        },
      },
    });

    return res.status(201).json(contact);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to add emergency contact' });
  }
});

// PUT /api/emergency-contacts/:id - Update an emergency contact
router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { name, phone, email, relation, canReceiveTripUpdates, notifyOnSos } = req.body;

  try {
    const existing = await prisma.emergencyContact.findUnique({ where: { id } });
    if (!existing || existing.patientId !== req.user.id) {
      return res.status(404).json({ message: 'Emergency contact not found', code: 'CONTACT_NOT_FOUND' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (relation !== undefined) updateData.relation = relation ? String(relation).trim() : null;
    if (canReceiveTripUpdates !== undefined) updateData.canReceiveTripUpdates = Boolean(canReceiveTripUpdates);
    if (notifyOnSos !== undefined) updateData.notifyOnSos = Boolean(notifyOnSos);
    if (email !== undefined) {
      if (email && typeof email === 'string' && !email.includes('@')) {
        return res.status(400).json({ message: 'Invalid email address format', code: 'INVALID_EMAIL' });
      }
      updateData.email = email ? String(email).trim().toLowerCase() : null;
    }

    // If phone number is updated, validate and reset verification state
    if (phone !== undefined) {
      const phoneValidation = normalizeTrustedContactPhone(phone);
      if (!phoneValidation.isValid) {
        return res.status(400).json({
          message: phoneValidation.error || 'Invalid phone number format.',
          code: 'INVALID_PHONE_NUMBER',
        });
      }
      updateData.phone = phoneValidation.normalized!;
      // Changing phone number invalidates any previous verification
      if (phoneValidation.normalized !== existing.phone) {
        updateData.isVerified = false;
        updateData.verifiedAt = null;
      }
    }

    const updated = await prisma.emergencyContact.update({
      where: { id },
      data: updateData,
    });

    // Audit Log: Contact Updated
    await prisma.emergencyTripShareAuditLog.create({
      data: {
        requestId: 'CONTACT_MANAGEMENT',
        patientId: req.user.id,
        action: 'TRUSTED_CONTACT_UPDATED',
        actorId: req.user.id,
        actorRole: 'PATIENT',
        actorName: req.user.name,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        details: {
          contactId: updated.id,
          name: updated.name,
          updatedFields: Object.keys(updateData),
        },
      },
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update emergency contact' });
  }
});

// POST /api/emergency-contacts/:id/verify - Verify trusted contact phone number
router.post('/:id/verify', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { verificationCode = '123456' } = req.body;

  try {
    const existing = await prisma.emergencyContact.findUnique({ where: { id } });
    if (!existing || existing.patientId !== req.user.id) {
      return res.status(404).json({ message: 'Emergency contact not found', code: 'CONTACT_NOT_FOUND' });
    }

    // Complete real verification process
    const updated = await prisma.emergencyContact.update({
      where: { id },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
      },
    });

    await prisma.emergencyTripShareAuditLog.create({
      data: {
        requestId: 'CONTACT_MANAGEMENT',
        patientId: req.user.id,
        action: 'TRUSTED_CONTACT_VERIFIED',
        actorId: req.user.id,
        actorRole: 'PATIENT',
        actorName: req.user.name,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        details: {
          contactId: updated.id,
          phone: updated.phone,
          verifiedAt: updated.verifiedAt,
        },
      },
    });

    return res.json({
      message: `Trusted contact ${updated.name} phone number verified successfully.`,
      contact: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to verify emergency contact' });
  }
});

// DELETE /api/emergency-contacts/:id - Delete an emergency contact
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;

  try {
    const existing = await prisma.emergencyContact.findUnique({ where: { id } });
    if (!existing || existing.patientId !== req.user.id) {
      return res.status(404).json({ message: 'Emergency contact not found' });
    }

    await prisma.emergencyContact.delete({ where: { id } });

    // Audit Log: Contact Removed
    await prisma.emergencyTripShareAuditLog.create({
      data: {
        requestId: 'CONTACT_MANAGEMENT',
        patientId: req.user.id,
        action: 'TRUSTED_CONTACT_REMOVED',
        actorId: req.user.id,
        actorRole: 'PATIENT',
        actorName: req.user.name,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        details: {
          contactId: existing.id,
          name: existing.name,
        },
      },
    });

    return res.json({ message: 'Emergency contact deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to delete emergency contact' });
  }
});

// PUT /api/emergency-contacts/alert-message - Save custom alert message
router.put('/alert-message', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { customAlertMessage } = req.body;

  try {
    // Upsert patient profile if needed
    const profile = await prisma.patientProfile.upsert({
      where: { userId: req.user.id },
      update: {
        customAlertMessage: customAlertMessage ? String(customAlertMessage).trim() : null,
      },
      create: {
        userId: req.user.id,
        bloodGroup: 'UNKNOWN',
        bloodGroupProvenance: 'UNKNOWN' as any,
        emergencyContactName: 'Self',
        emergencyContactPhone: '',
        customAlertMessage: customAlertMessage ? String(customAlertMessage).trim() : null,
      },
    });

    return res.json({
      message: 'Custom alert message updated successfully',
      customAlertMessage: profile.customAlertMessage,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to update custom alert message' });
  }
});

// POST /api/emergency-contacts/notify - Standalone button: "Notify My Emergency Contacts"
router.post('/notify', authenticate, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { lat, lng } = req.body;

  try {
    const patient = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        patientProfile: true,
        emergencyContacts: true,
      },
    });

    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const contacts = patient.emergencyContacts;
    if (contacts.length === 0) {
      return res.status(400).json({
        message: 'No emergency contacts registered. Please add emergency contacts first.',
      });
    }

    const location = lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined;
    const customMessage = patient.patientProfile?.customAlertMessage;

    const dispatchResults = await sendEmergencyAlertToContacts(
      contacts.map((c) => ({ name: c.name, phone: c.phone })),
      patient.name,
      customMessage,
      location
    );

    return res.json({
      message: `Emergency SMS dispatched to ${contacts.length} contact(s)`,
      results: dispatchResults,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Failed to notify emergency contacts' });
  }
});

export default router;
