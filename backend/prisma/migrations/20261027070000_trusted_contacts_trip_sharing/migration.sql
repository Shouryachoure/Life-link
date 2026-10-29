-- AlterTable EmergencyContact
ALTER TABLE "EmergencyContact" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "EmergencyContact" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmergencyContact" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "EmergencyContact" ADD COLUMN IF NOT EXISTS "canReceiveTripUpdates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "EmergencyContact" ADD COLUMN IF NOT EXISTS "notifyOnSos" BOOLEAN NOT NULL DEFAULT true;

-- AlterEnum NotificationStatus
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'ATTEMPTED';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';

-- CreateTable EmergencyTripShare
CREATE TABLE IF NOT EXISTS "EmergencyTripShare" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tripId" TEXT,
    "patientId" TEXT NOT NULL,
    "contactId" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "recipientEmail" TEXT,
    "shareToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "allowLiveLocation" BOOLEAN NOT NULL DEFAULT true,
    "allowDestinationHospital" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyTripShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable EmergencyTripShareAuditLog
CREATE TABLE IF NOT EXISTS "EmergencyTripShareAuditLog" (
    "id" TEXT NOT NULL,
    "shareId" TEXT,
    "shareToken" TEXT,
    "requestId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "actorName" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyTripShareAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmergencyTripShare_shareToken_key" ON "EmergencyTripShare"("shareToken");
CREATE INDEX IF NOT EXISTS "EmergencyTripShare_requestId_idx" ON "EmergencyTripShare"("requestId");
CREATE INDEX IF NOT EXISTS "EmergencyTripShare_patientId_idx" ON "EmergencyTripShare"("patientId");
CREATE INDEX IF NOT EXISTS "EmergencyTripShare_shareToken_idx" ON "EmergencyTripShare"("shareToken");
CREATE INDEX IF NOT EXISTS "EmergencyTripShare_status_idx" ON "EmergencyTripShare"("status");

CREATE INDEX IF NOT EXISTS "EmergencyTripShareAuditLog_requestId_timestamp_idx" ON "EmergencyTripShareAuditLog"("requestId", "timestamp");
CREATE INDEX IF NOT EXISTS "EmergencyTripShareAuditLog_patientId_idx" ON "EmergencyTripShareAuditLog"("patientId");
CREATE INDEX IF NOT EXISTS "EmergencyTripShareAuditLog_shareId_idx" ON "EmergencyTripShareAuditLog"("shareId");
CREATE INDEX IF NOT EXISTS "EmergencyTripShareAuditLog_action_idx" ON "EmergencyTripShareAuditLog"("action");

-- AddForeignKey
ALTER TABLE "EmergencyTripShare" ADD CONSTRAINT "EmergencyTripShare_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EmergencyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyTripShare" ADD CONSTRAINT "EmergencyTripShare_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyTripShare" ADD CONSTRAINT "EmergencyTripShare_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "EmergencyContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmergencyTripShareAuditLog" ADD CONSTRAINT "EmergencyTripShareAuditLog_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "EmergencyTripShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
