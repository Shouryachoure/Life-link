-- Migration: 20261028000000_doctor_hospital_affiliations
-- LifeLink: Real Nagpur Doctor Dataset Acquisition & Hospital Affiliations

-- AlterTable: Doctor
ALTER TABLE "Doctor"
  ADD COLUMN IF NOT EXISTS "registrationNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "registrationAuthority" TEXT DEFAULT 'Maharashtra Medical Council',
  ADD COLUMN IF NOT EXISTS "specialtiesList" JSONB;

-- CreateTable: HospitalDoctor
CREATE TABLE IF NOT EXISTS "HospitalDoctor" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "affiliationStatus" TEXT NOT NULL DEFAULT 'AFFILIATED',
  "affiliationSource" TEXT NOT NULL DEFAULT 'OFFICIAL_HOSPITAL_DIRECTORY',
  "sourceUrl" TEXT,
  "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HospitalDoctor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HospitalDoctor_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "HospitalDoctor_hospitalId_doctorId_key" ON "HospitalDoctor"("hospitalId", "doctorId");
CREATE INDEX IF NOT EXISTS "HospitalDoctor_hospitalId_idx" ON "HospitalDoctor"("hospitalId");
CREATE INDEX IF NOT EXISTS "HospitalDoctor_doctorId_idx" ON "HospitalDoctor"("doctorId");

