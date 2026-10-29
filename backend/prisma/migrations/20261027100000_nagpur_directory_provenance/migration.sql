-- AlterTable: DirectoryFacility add provenance and typing fields
ALTER TABLE "DirectoryFacility"
    ADD COLUMN IF NOT EXISTS "recordType" TEXT NOT NULL DEFAULT 'HOSPITAL',
    ADD COLUMN IF NOT EXISTS "recordStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
    ADD COLUMN IF NOT EXISTS "dataProvenance" TEXT,
    ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "contactVerificationStatus" TEXT NOT NULL DEFAULT 'NEEDS_VERIFICATION',
    ADD COLUMN IF NOT EXISTS "lastContactVerifiedAt" TIMESTAMP(3);

-- AlterTable: DirectoryAmbulanceService add provenance, coordinate, and typing fields
ALTER TABLE "DirectoryAmbulanceService"
    ADD COLUMN IF NOT EXISTS "recordType" TEXT NOT NULL DEFAULT 'AMBULANCE_PROVIDER',
    ADD COLUMN IF NOT EXISTS "recordStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "state" TEXT NOT NULL DEFAULT 'Maharashtra',
    ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "isGeocoded" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "coordinateQuality" TEXT,
    ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
    ADD COLUMN IF NOT EXISTS "dataProvenance" TEXT,
    ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "contactVerificationStatus" TEXT NOT NULL DEFAULT 'NEEDS_VERIFICATION',
    ADD COLUMN IF NOT EXISTS "lastContactVerifiedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "duplicateOfId" TEXT;

-- Create Indexes
CREATE INDEX IF NOT EXISTS "DirectoryFacility_recordType_idx" ON "DirectoryFacility"("recordType");
CREATE INDEX IF NOT EXISTS "DirectoryFacility_recordStatus_idx" ON "DirectoryFacility"("recordStatus");
CREATE INDEX IF NOT EXISTS "DirectoryAmbulanceService_recordType_idx" ON "DirectoryAmbulanceService"("recordType");
CREATE INDEX IF NOT EXISTS "DirectoryAmbulanceService_recordStatus_idx" ON "DirectoryAmbulanceService"("recordStatus");
