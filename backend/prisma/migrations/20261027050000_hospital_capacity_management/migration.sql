-- AlterEnum
ALTER TYPE "BedStatus" ADD VALUE IF NOT EXISTS 'UNAVAILABLE';

-- AlterTable Hospital
ALTER TABLE "Hospital" ADD COLUMN IF NOT EXISTS "totalBeds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Hospital" ADD COLUMN IF NOT EXISTS "capacityLastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Hospital" ADD COLUMN IF NOT EXISTS "configuredCategories" JSONB;

-- AlterTable HospitalBed
ALTER TABLE "HospitalBed" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "HospitalBed" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable HospitalCapacityAuditLog
CREATE TABLE IF NOT EXISTS "HospitalCapacityAuditLog" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedByName" TEXT NOT NULL,
    "changedByRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "category" TEXT,
    "previousAvailable" INTEGER NOT NULL,
    "newAvailable" INTEGER NOT NULL,
    "previousTotal" INTEGER NOT NULL,
    "newTotal" INTEGER NOT NULL,
    "previousOccupied" INTEGER,
    "newOccupied" INTEGER,
    "reason" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HospitalCapacityAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HospitalCapacityAuditLog_hospitalId_timestamp_idx" ON "HospitalCapacityAuditLog"("hospitalId", "timestamp");
CREATE INDEX IF NOT EXISTS "HospitalCapacityAuditLog_changedById_idx" ON "HospitalCapacityAuditLog"("changedById");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'HospitalCapacityAuditLog_hospitalId_fkey'
    ) THEN
        ALTER TABLE "HospitalCapacityAuditLog" ADD CONSTRAINT "HospitalCapacityAuditLog_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'HospitalCapacityAuditLog_changedById_fkey'
    ) THEN
        ALTER TABLE "HospitalCapacityAuditLog" ADD CONSTRAINT "HospitalCapacityAuditLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
