-- LifeLink: Nagpur Complete Healthcare & Ambulance Data Acquisition Migration
-- Adds tehsil, coverageGroup, publicEmail, specialties, emergencyPhone, ambulancePhone, etc.

ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "tehsil" TEXT DEFAULT 'Nagpur Urban';
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "coverageGroup" TEXT DEFAULT 'NAGPUR_CITY';
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "emergencyPhone" TEXT;
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "ambulancePhone" TEXT;
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "publicEmail" TEXT;
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "specialties" JSONB;
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "emergencyServicesClaimed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "sourceRetrievedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "dataConfidence" TEXT DEFAULT 'DIRECTORY_LISTED';
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "duplicateGroup" TEXT;
ALTER TABLE "DirectoryFacility" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE INDEX IF NOT EXISTS "DirectoryFacility_coverageGroup_idx" ON "DirectoryFacility"("coverageGroup");
CREATE INDEX IF NOT EXISTS "DirectoryFacility_tehsil_idx" ON "DirectoryFacility"("tehsil");

ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "tehsil" TEXT DEFAULT 'Nagpur Urban';
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "coverageGroup" TEXT DEFAULT 'NAGPUR_CITY';
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "publicBusinessPhone" TEXT;
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "alternatePublicPhone" TEXT;
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "businessAddress" TEXT;
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "serviceArea" TEXT;
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "advertisedServiceTypes" JSONB;
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "advertisedIcuOrVentilatorCapability" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "sourceRetrievedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "dataConfidence" TEXT DEFAULT 'DIRECTORY_LISTED';
ALTER TABLE "DirectoryAmbulanceService" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE INDEX IF NOT EXISTS "DirectoryAmbulanceService_coverageGroup_idx" ON "DirectoryAmbulanceService"("coverageGroup");
CREATE INDEX IF NOT EXISTS "DirectoryAmbulanceService_tehsil_idx" ON "DirectoryAmbulanceService"("tehsil");
