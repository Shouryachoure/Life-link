-- CreateTable
CREATE TABLE "DirectoryFacility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alternateNames" JSONB,
    "facilityType" TEXT NOT NULL,
    "ownership" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "rawContactNumber" TEXT,
    "alternateNumber" TEXT,
    "address" TEXT NOT NULL,
    "locality" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Nagpur',
    "district" TEXT NOT NULL DEFAULT 'Nagpur',
    "state" TEXT NOT NULL DEFAULT 'Maharashtra',
    "pincode" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isGeocoded" BOOLEAN NOT NULL DEFAULT false,
    "coordinateQuality" TEXT,
    "website" TEXT,
    "emergencyHelpline" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "linkStatus" TEXT NOT NULL DEFAULT 'UNLINKED',
    "linkedHospitalId" TEXT,
    "reviewNotes" TEXT,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryFacility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryAmbulanceService" (
    "id" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "operatorType" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "rawContactNumber" TEXT,
    "alternateContact" TEXT,
    "address" TEXT,
    "locality" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Nagpur',
    "district" TEXT NOT NULL DEFAULT 'Nagpur',
    "operatingArea" TEXT,
    "website" TEXT,
    "fleetDescription" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "linkStatus" TEXT NOT NULL DEFAULT 'UNLINKED',
    "linkedOperatorId" TEXT,
    "linkedHospitalId" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryAmbulanceService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryReviewIssue" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggestedCorrection" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reportedBy" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectoryReviewIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectoryFacility_city_district_idx" ON "DirectoryFacility"("city", "district");
CREATE INDEX "DirectoryFacility_facilityType_idx" ON "DirectoryFacility"("facilityType");
CREATE INDEX "DirectoryFacility_verificationStatus_idx" ON "DirectoryFacility"("verificationStatus");
CREATE INDEX "DirectoryFacility_linkStatus_idx" ON "DirectoryFacility"("linkStatus");

-- CreateIndex
CREATE INDEX "DirectoryAmbulanceService_city_district_idx" ON "DirectoryAmbulanceService"("city", "district");
CREATE INDEX "DirectoryAmbulanceService_operatorType_idx" ON "DirectoryAmbulanceService"("operatorType");
CREATE INDEX "DirectoryAmbulanceService_verificationStatus_idx" ON "DirectoryAmbulanceService"("verificationStatus");

-- CreateIndex
CREATE INDEX "DirectoryReviewIssue_entityType_entityId_idx" ON "DirectoryReviewIssue"("entityType", "entityId");
CREATE INDEX "DirectoryReviewIssue_status_idx" ON "DirectoryReviewIssue"("status");
CREATE INDEX "DirectoryReviewIssue_issueType_idx" ON "DirectoryReviewIssue"("issueType");
