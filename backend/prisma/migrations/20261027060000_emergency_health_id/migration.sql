-- CreateEnum
CREATE TYPE "DataProvenance" AS ENUM ('PATIENT_REPORTED', 'VERIFIED_CLINICAL', 'UNKNOWN');
CREATE TYPE "EmergencyAccessType" AS ENUM ('ACTIVE_DISPATCH_TRIAGE', 'BREAK_GLASS_QR', 'PATIENT_DIRECT_VIEW', 'PUBLIC_QR_SAFETY_CARD', 'HOSPITAL_ADMISSION_TRIAGE');

-- AlterTable PatientProfile
ALTER TABLE "PatientProfile" 
    ALTER COLUMN "bloodGroup" DROP NOT NULL,
    ALTER COLUMN "bloodGroup" SET DEFAULT 'UNKNOWN',
    ALTER COLUMN "emergencyContactName" DROP NOT NULL,
    ALTER COLUMN "emergencyContactPhone" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS "bloodGroupProvenance" "DataProvenance" NOT NULL DEFAULT 'PATIENT_REPORTED',
    ADD COLUMN IF NOT EXISTS "allergiesProvenance" "DataProvenance" NOT NULL DEFAULT 'PATIENT_REPORTED',
    ADD COLUMN IF NOT EXISTS "medicalConditions" TEXT,
    ADD COLUMN IF NOT EXISTS "medicalConditionsProvenance" "DataProvenance" NOT NULL DEFAULT 'PATIENT_REPORTED',
    ADD COLUMN IF NOT EXISTS "currentMedications" TEXT,
    ADD COLUMN IF NOT EXISTS "medicationsProvenance" "DataProvenance" NOT NULL DEFAULT 'PATIENT_REPORTED',
    ADD COLUMN IF NOT EXISTS "organDonorStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "preferredHospital" TEXT,
    ADD COLUMN IF NOT EXISTS "consentEmergencySharing" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "emergencyAccessToken" TEXT,
    ADD COLUMN IF NOT EXISTS "tokenGeneratedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "verifiedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateUniqueIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PatientProfile_emergencyAccessToken_key" ON "PatientProfile"("emergencyAccessToken");

-- CreateTable EmergencyHealthAccessLog
CREATE TABLE IF NOT EXISTS "EmergencyHealthAccessLog" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "accessorId" TEXT,
    "accessorRole" TEXT NOT NULL,
    "accessorName" TEXT,
    "organization" TEXT,
    "accessType" "EmergencyAccessType" NOT NULL,
    "accessReason" TEXT,
    "lawfulBasis" TEXT NOT NULL DEFAULT 'CONSENT_DPDP_ACT_2023',
    "fieldsAccessed" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyHealthAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndices for EmergencyHealthAccessLog
CREATE INDEX IF NOT EXISTS "EmergencyHealthAccessLog_patientId_timestamp_idx" ON "EmergencyHealthAccessLog"("patientId", "timestamp");
CREATE INDEX IF NOT EXISTS "EmergencyHealthAccessLog_accessorId_idx" ON "EmergencyHealthAccessLog"("accessorId");
CREATE INDEX IF NOT EXISTS "EmergencyHealthAccessLog_accessType_idx" ON "EmergencyHealthAccessLog"("accessType");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EmergencyHealthAccessLog_patientId_fkey'
    ) THEN
        ALTER TABLE "EmergencyHealthAccessLog" ADD CONSTRAINT "EmergencyHealthAccessLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
