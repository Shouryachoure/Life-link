-- AlterEnum: Add new appointment statuses
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CHECKED_IN';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'IN_CONSULTATION';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'RESCHEDULED';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';

-- AlterTable: Doctor
ALTER TABLE "Doctor" 
  ADD COLUMN IF NOT EXISTS "unavailableDates" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "defaultSlotDuration" INTEGER DEFAULT 15;

-- AlterTable: DoctorSlot
ALTER TABLE "DoctorSlot" 
  ADD COLUMN IF NOT EXISTS "slotDurationMinutes" INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "blockedReason" TEXT;

-- AlterTable: Appointment
ALTER TABLE "Appointment" 
  ADD COLUMN IF NOT EXISTS "rescheduledFromSlotId" TEXT,
  ADD COLUMN IF NOT EXISTS "rescheduledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- CreateTable: AppointmentAuditLog
CREATE TABLE IF NOT EXISTS "AppointmentAuditLog" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "doctorId" TEXT,
  "patientId" TEXT,
  "action" TEXT NOT NULL,
  "previousStatus" TEXT,
  "newStatus" TEXT,
  "actorId" TEXT,
  "actorRole" TEXT,
  "actorName" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppointmentAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentAuditLog_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "AppointmentAuditLog_appointmentId_idx" ON "AppointmentAuditLog"("appointmentId");
CREATE INDEX IF NOT EXISTS "AppointmentAuditLog_hospitalId_idx" ON "AppointmentAuditLog"("hospitalId");
CREATE INDEX IF NOT EXISTS "AppointmentAuditLog_doctorId_idx" ON "AppointmentAuditLog"("doctorId");
CREATE INDEX IF NOT EXISTS "AppointmentAuditLog_action_idx" ON "AppointmentAuditLog"("action");
CREATE INDEX IF NOT EXISTS "AppointmentAuditLog_timestamp_idx" ON "AppointmentAuditLog"("timestamp");
CREATE INDEX IF NOT EXISTS "Appointment_status_idx" ON "Appointment"("status");
