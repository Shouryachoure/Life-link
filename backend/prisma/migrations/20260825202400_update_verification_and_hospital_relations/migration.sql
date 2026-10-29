-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "Ambulance" DROP CONSTRAINT "Ambulance_driverId_fkey";

-- AlterTable
ALTER TABLE "Ambulance" ADD COLUMN     "hospitalId" TEXT,
ADD COLUMN     "licenseDoc" TEXT,
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "maintenanceStatus" TEXT NOT NULL DEFAULT 'GOOD',
ADD COLUMN     "registrationDoc" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "driverId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hospitalId" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ambulance" ADD CONSTRAINT "Ambulance_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ambulance" ADD CONSTRAINT "Ambulance_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
