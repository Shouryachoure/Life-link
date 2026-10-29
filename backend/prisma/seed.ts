import { PrismaClient, Role, AmbulanceType, VerificationState, WardType, BedStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('[LifeLink Seed] Starting comprehensive Nagpur dataset seed for PostgreSQL...');

  const salt = bcrypt.genSaltSync(10);
  const commonPasswordHash = bcrypt.hashSync('password123', salt);

  // 1. Seed Service Area (Nagpur Pilot Zone)
  console.log('[LifeLink Seed] Seeding Nagpur pilot service area...');
  const serviceArea = await prisma.serviceArea.upsert({
    where: { id: 'nagpur-pilot-service-area' },
    update: {
      name: 'Nagpur Pilot Zone',
      city: 'Nagpur',
      state: 'Maharashtra',
      country: 'India',
      centerLat: 21.1458,
      centerLng: 79.0882,
      radiusKm: 30.0,
      isActive: true,
      isPilot: true,
      metadata: JSON.stringify({ description: 'Nagpur Pilot Zone - 30km operational radius' }),
    },
    create: {
      id: 'nagpur-pilot-service-area',
      name: 'Nagpur Pilot Zone',
      city: 'Nagpur',
      state: 'Maharashtra',
      country: 'India',
      centerLat: 21.1458,
      centerLng: 79.0882,
      radiusKm: 30.0,
      isActive: true,
      isPilot: true,
      metadata: JSON.stringify({ description: 'Nagpur Pilot Zone - 30km operational radius' }),
    },
  });
  console.log(`[LifeLink Seed] -> Service Area: ${serviceArea.name}`);

  // 2. Seed Super Admin User
  console.log('[LifeLink Seed] Seeding core platform users...');
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@lifelink.com' },
    update: {
      name: 'Super Admin',
      passwordHash: commonPasswordHash,
      role: Role.SUPER_ADMIN,
      phone: '+919876543200',
      isPhoneVerified: true,
      isActive: true,
    },
    create: {
      id: 'user-superadmin-dev',
      name: 'Super Admin',
      email: 'superadmin@lifelink.com',
      passwordHash: commonPasswordHash,
      role: Role.SUPER_ADMIN,
      phone: '+919876543200',
      isPhoneVerified: true,
      isActive: true,
    },
  });

  // Demo Patient User & Profile
  const patient = await prisma.user.upsert({
    where: { email: 'patient.john@gmail.com' },
    update: {
      name: 'John Doe',
      passwordHash: commonPasswordHash,
      role: Role.PATIENT,
      phone: '+919876543210',
      isPhoneVerified: true,
      isActive: true,
    },
    create: {
      id: 'user-patient-john-dev',
      name: 'John Doe',
      email: 'patient.john@gmail.com',
      passwordHash: commonPasswordHash,
      role: Role.PATIENT,
      phone: '+919876543210',
      isPhoneVerified: true,
      isActive: true,
    },
  });

  await prisma.patientProfile.upsert({
    where: { userId: patient.id },
    update: {
      bloodGroup: 'O+',
      allergies: 'Penicillin',
      medicalConditions: 'Mild Hypertension',
      emergencyContactName: 'Jane Doe',
      emergencyContactPhone: '+919876543211',
    },
    create: {
      userId: patient.id,
      bloodGroup: 'O+',
      allergies: 'Penicillin',
      medicalConditions: 'Mild Hypertension',
      emergencyContactName: 'Jane Doe',
      emergencyContactPhone: '+919876543211',
    },
  });

  // 3. Load Directory Facilities (Hospitals) from data/nagpur/hospitals.json
  const hospitalsJsonPath = path.resolve(__dirname, '../../data/nagpur/hospitals.json');
  let rawHospitals: any[] = [];
  if (fs.existsSync(hospitalsJsonPath)) {
    rawHospitals = JSON.parse(fs.readFileSync(hospitalsJsonPath, 'utf8'));
    console.log(`[LifeLink Seed] Loaded ${rawHospitals.length} facilities from data/nagpur/hospitals.json`);
  }

  // Define partner hospitals that will have linked Hospital records and beds
  const partnerHospitalIds = new Set([
    'hosp-gmch-nagpur',
    'fac-gmch-nagpur',
    'hosp-mayo-nagpur',
    'fac-mayo-hospital-nagpur',
    'fac-max-super-nagpur',
    'fac-aiims-nagpur',
    'fac-kingsway-hospitals-nagpur',
    'fac-wockhardt-nagpur',
    'fac-ciims-nagpur',
    'fac-arneja-heart-nagpur',
    'fac-care-hospitals-nagpur',
    'fac-krims-hospitals-nagpur',
    'fac-seven-star-nagpur',
    'fac-ochri-nagpur',
    'fac-newera-hospital-nagpur',
    'fac-daga-hospital-nagpur',
    'fac-nci-jamtha',
    'fac-platina-heart-nagpur',
    'fac-sengupta-hospital-nagpur',
    'fac-mahatme-eye-nagpur',
    'fac-nelson-hospital-nagpur',
    'fac-vnit-health-centre',
    'fac-sdh-katol',
    'fac-sdh-umred',
    'fac-sdh-ramtek',
    'fac-sdh-kamptee',
  ]);

  // Upsert DirectoryFacility records and corresponding Hospital records
  for (const h of rawHospitals) {
    const recId = h.record_id || h.id;
    const lat = h.latitude !== null && h.latitude !== undefined ? Number(h.latitude) : 21.1458;
    const lng = h.longitude !== null && h.longitude !== undefined ? Number(h.longitude) : 79.0882;
    const phone = h.main_phone || '07122744400';

    await prisma.directoryFacility.upsert({
      where: { id: recId },
      update: {
        name: h.facility_name,
        alternateNames: h.aliases || [],
        facilityType: h.facility_type || 'GENERAL_HOSPITAL',
        ownership: h.ownership_type || 'UNKNOWN',
        contactNumber: phone,
        rawContactNumber: phone,
        address: h.address,
        locality: h.locality || null,
        tehsil: h.tehsil || 'Nagpur Urban',
        coverageGroup: h.coverage_group || 'NAGPUR_CITY',
        city: 'Nagpur',
        district: 'Nagpur',
        state: 'Maharashtra',
        pincode: h.pin_code || null,
        lat: h.latitude ? Number(h.latitude) : null,
        lng: h.longitude ? Number(h.longitude) : null,
        isGeocoded: h.latitude !== null && h.longitude !== null,
        website: h.website || null,
        emergencyHelpline: h.emergency_phone || null,
        emergencyPhone: h.emergency_phone || null,
        ambulancePhone: h.ambulance_phone || null,
        publicEmail: h.public_email || null,
        specialties: h.specialties || [],
        emergencyServicesClaimed: Boolean(h.emergency_services_claimed),
        sourceUrl: h.source_url || 'https://nagpur.gov.in',
        sourceType: h.source_type || 'OFFICIAL_GOVERNMENT_PORTAL',
        dataConfidence: h.data_confidence || 'DIRECTORY_LISTED',
        verificationStatus: h.verification_status || 'VERIFIED',
        linkStatus: partnerHospitalIds.has(recId) ? 'LINKED_PARTNER' : 'UNLINKED',
        linkedHospitalId: partnerHospitalIds.has(recId) ? recId : null,
      },
      create: {
        id: recId,
        name: h.facility_name,
        alternateNames: h.aliases || [],
        facilityType: h.facility_type || 'GENERAL_HOSPITAL',
        ownership: h.ownership_type || 'UNKNOWN',
        contactNumber: phone,
        rawContactNumber: phone,
        address: h.address,
        locality: h.locality || null,
        tehsil: h.tehsil || 'Nagpur Urban',
        coverageGroup: h.coverage_group || 'NAGPUR_CITY',
        city: 'Nagpur',
        district: 'Nagpur',
        state: 'Maharashtra',
        pincode: h.pin_code || null,
        lat: h.latitude ? Number(h.latitude) : null,
        lng: h.longitude ? Number(h.longitude) : null,
        isGeocoded: h.latitude !== null && h.longitude !== null,
        website: h.website || null,
        emergencyHelpline: h.emergency_phone || null,
        emergencyPhone: h.emergency_phone || null,
        ambulancePhone: h.ambulance_phone || null,
        publicEmail: h.public_email || null,
        specialties: h.specialties || [],
        emergencyServicesClaimed: Boolean(h.emergency_services_claimed),
        sourceUrl: h.source_url || 'https://nagpur.gov.in',
        sourceType: h.source_type || 'OFFICIAL_GOVERNMENT_PORTAL',
        dataConfidence: h.data_confidence || 'DIRECTORY_LISTED',
        verificationStatus: h.verification_status || 'VERIFIED',
        linkStatus: partnerHospitalIds.has(recId) ? 'LINKED_PARTNER' : 'UNLINKED',
        linkedHospitalId: partnerHospitalIds.has(recId) ? recId : null,
      },
    });

    // If it's a partner facility or doctor affiliate, ensure a Hospital record exists
    if (partnerHospitalIds.has(recId)) {
      const adminEmail = `admin.${recId.replace(/[^a-zA-Z0-9]/g, '')}@lifelink.com`;
      const hospAdmin = await prisma.user.upsert({
        where: { email: adminEmail },
        update: {
          name: `${h.facility_name} Admin`,
          role: Role.ADMIN_HOSPITAL,
          isActive: true,
        },
        create: {
          email: adminEmail,
          name: `${h.facility_name} Admin`,
          passwordHash: commonPasswordHash,
          role: Role.ADMIN_HOSPITAL,
          phone: phone,
          isActive: true,
          isPhoneVerified: true,
        },
      });

      await prisma.hospital.upsert({
        where: { id: recId },
        update: {
          name: h.facility_name,
          address: h.address,
          contactNumber: phone,
          city: 'Nagpur',
          state: 'Maharashtra',
          lat: lat,
          lng: lng,
          locality: h.locality || null,
          aliases: h.aliases || [],
          specialties: h.specialties || [],
          verificationState: VerificationState.VERIFIED,
        },
        create: {
          id: recId,
          name: h.facility_name,
          address: h.address,
          contactNumber: phone,
          city: 'Nagpur',
          state: 'Maharashtra',
          lat: lat,
          lng: lng,
          adminUserId: hospAdmin.id,
          availableBeds: 25,
          totalBeds: 100,
          locality: h.locality || null,
          aliases: h.aliases || [],
          specialties: h.specialties || [],
          verificationState: VerificationState.VERIFIED,
        },
      });
    }
  }

  // Also ensure 'hosp-gmch-nagpur' exists (alias of fac-gmch-nagpur)
  const gmchUser = await prisma.user.upsert({
    where: { email: 'admin.gmch@lifelink.com' },
    update: { role: Role.ADMIN_HOSPITAL, isActive: true },
    create: {
      id: 'user-admin-gmch-dev',
      name: 'GMCH Nagpur Admin',
      email: 'admin.gmch@lifelink.com',
      passwordHash: commonPasswordHash,
      role: Role.ADMIN_HOSPITAL,
      phone: '07122744400',
      isActive: true,
    },
  });

  await prisma.hospital.upsert({
    where: { id: 'hosp-gmch-nagpur' },
    update: {
      name: 'GMCH Trauma Care Center Nagpur',
      address: 'Medical Square, Hanuman Nagar, Nagpur',
      contactNumber: '07122744400',
      lat: 21.1293,
      lng: 79.0967,
      locality: 'Medical Square',
      availableBeds: 45,
      totalBeds: 150,
      verificationState: VerificationState.VERIFIED,
    },
    create: {
      id: 'hosp-gmch-nagpur',
      name: 'GMCH Trauma Care Center Nagpur',
      address: 'Medical Square, Hanuman Nagar, Nagpur',
      contactNumber: '07122744400',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1293,
      lng: 79.0967,
      adminUserId: gmchUser.id,
      availableBeds: 45,
      totalBeds: 150,
      locality: 'Medical Square',
      aliases: ['GMCH', 'Government Medical College Nagpur'],
      specialties: ['Trauma Care', 'Cardiology', 'Neurology', 'General Surgery'],
      verificationState: VerificationState.VERIFIED,
    },
  });

  // Seed sample Hospital Beds for GMCH
  const gmchBeds = [
    { num: 'ER-01', ward: 'EMERGENCY_ER', cat: 'EMERGENCY', status: 'AVAILABLE' },
    { num: 'ER-02', ward: 'EMERGENCY_ER', cat: 'EMERGENCY', status: 'AVAILABLE' },
    { num: 'ER-03', ward: 'EMERGENCY_ER', cat: 'EMERGENCY', status: 'OCCUPIED' },
    { num: 'TR-01', ward: 'TRAUMA', cat: 'EMERGENCY', status: 'AVAILABLE' },
    { num: 'ICU-01', ward: 'ICU', cat: 'ICU', status: 'AVAILABLE' },
    { num: 'ICU-02', ward: 'ICU', cat: 'ICU', status: 'AVAILABLE' },
    { num: 'ICU-03', ward: 'ICU', cat: 'ICU', status: 'OCCUPIED' },
    { num: 'GW-101', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'AVAILABLE' },
    { num: 'GW-102', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'AVAILABLE' },
    { num: 'GW-103', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'OCCUPIED' },
    { num: 'PED-01', ward: 'PEDIATRIC', cat: 'PEDIATRIC', status: 'AVAILABLE' },
    { num: 'PED-02', ward: 'PEDIATRIC', cat: 'PEDIATRIC', status: 'AVAILABLE' },
  ];
  for (const b of gmchBeds) {
    const bedId = `bed-gmch-${b.num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    await prisma.hospitalBed.upsert({
      where: { id: bedId },
      update: {
        bedNumber: b.num,
        ward: b.ward as WardType,
        category: b.cat,
        status: b.status as BedStatus,
      },
      create: {
        id: bedId,
        hospitalId: 'hosp-gmch-nagpur',
        bedNumber: b.num,
        ward: b.ward as WardType,
        category: b.cat,
        status: b.status as BedStatus,
      },
    });
  }

  // 4. Seed Verified Ambulance Providers from data/nagpur/ambulance_providers.json
  const ambulanceJsonPath = path.resolve(__dirname, '../../data/nagpur/ambulance_providers.json');
  if (fs.existsSync(ambulanceJsonPath)) {
    const rawAmbs = JSON.parse(fs.readFileSync(ambulanceJsonPath, 'utf8'));
    console.log(`[LifeLink Seed] Seeding ${rawAmbs.length} ambulance providers...`);

    for (const a of rawAmbs) {
      const recId = a.record_id || a.id;
      const isHelpline = ['108', '112', '102'].includes(String(a.public_business_phone || a.contactNumber || ''));
      const phone = a.public_business_phone || a.contactNumber || '108';
      const lat = a.latitude !== null && a.latitude !== undefined ? Number(a.latitude) : (a.lat ? Number(a.lat) : 21.1458);
      const lng = a.longitude !== null && a.longitude !== undefined ? Number(a.longitude) : (a.lng ? Number(a.lng) : 79.0882);

      await prisma.directoryAmbulanceService.upsert({
        where: { id: recId },
        update: {
          serviceName: a.provider_name || a.serviceName,
          recordType: isHelpline ? 'OFFICIAL_EMERGENCY_HELPLINE' : 'AMBULANCE_PROVIDER',
          operatorType: isHelpline ? 'PUBLIC_EMERGENCY_SERVICE' : 'PRIVATE_OPERATOR',
          contactNumber: phone,
          rawContactNumber: phone,
          address: a.business_address || a.address || 'Nagpur, Maharashtra',
          locality: a.locality || null,
          tehsil: a.tehsil || 'Nagpur Urban',
          city: 'Nagpur',
          district: 'Nagpur',
          state: 'Maharashtra',
          lat: lat,
          lng: lng,
          isGeocoded: true,
          operatingArea: a.service_area || a.operatingArea || 'Nagpur Urban',
          advertisedServiceTypes: a.advertised_service_types || ['BASIC_LIFE_SUPPORT'],
          advertisedIcuOrVentilatorCapability: Boolean(a.advertised_icu_or_ventilator_capability),
          website: a.website || null,
          sourceUrl: a.source_url || 'https://nagpur.gov.in',
          verificationStatus: a.verification_status || 'VERIFIED',
          dataConfidence: a.data_confidence || 'DIRECTORY_LISTED',
        },
        create: {
          id: recId,
          serviceName: a.provider_name || a.serviceName,
          recordType: isHelpline ? 'OFFICIAL_EMERGENCY_HELPLINE' : 'AMBULANCE_PROVIDER',
          operatorType: isHelpline ? 'PUBLIC_EMERGENCY_SERVICE' : 'PRIVATE_OPERATOR',
          contactNumber: phone,
          rawContactNumber: phone,
          address: a.business_address || a.address || 'Nagpur, Maharashtra',
          locality: a.locality || null,
          tehsil: a.tehsil || 'Nagpur Urban',
          city: 'Nagpur',
          district: 'Nagpur',
          state: 'Maharashtra',
          lat: lat,
          lng: lng,
          isGeocoded: true,
          operatingArea: a.service_area || a.operatingArea || 'Nagpur Urban',
          advertisedServiceTypes: a.advertised_service_types || ['BASIC_LIFE_SUPPORT'],
          advertisedIcuOrVentilatorCapability: Boolean(a.advertised_icu_or_ventilator_capability),
          website: a.website || null,
          sourceUrl: a.source_url || 'https://nagpur.gov.in',
          verificationStatus: a.verification_status || 'VERIFIED',
          dataConfidence: a.data_confidence || 'DIRECTORY_LISTED',
        },
      });
    }
  }

  // 5. Seed Operators and Registered Ambulances
  const apexUser = await prisma.user.upsert({
    where: { email: 'admin.apex@lifelink.com' },
    update: { role: Role.OPERATOR_ADMIN, isActive: true },
    create: {
      id: 'user-admin-apex-dev',
      name: 'Apex Fleet Director',
      email: 'admin.apex@lifelink.com',
      passwordHash: commonPasswordHash,
      role: Role.OPERATOR_ADMIN,
      phone: '+919876543203',
      isActive: true,
    },
  });

  const apexOperator = await prisma.ambulanceOperator.upsert({
    where: { id: 'operator-apex-nagpur' },
    update: {
      name: 'Apex Emergency Mobility Fleet',
      tradeLicense: 'MH-NGP-2024-OP-01',
      contactPhone: '+919876500000',
      email: 'apex.fleet@lifelink.org',
      city: 'Nagpur',
      state: 'Maharashtra',
      address: 'Dharampeth, Nagpur',
      verificationState: VerificationState.VERIFIED,
    },
    create: {
      id: 'operator-apex-nagpur',
      name: 'Apex Emergency Mobility Fleet',
      tradeLicense: 'MH-NGP-2024-OP-01',
      contactPhone: '+919876500000',
      email: 'apex.fleet@lifelink.org',
      city: 'Nagpur',
      state: 'Maharashtra',
      address: 'Dharampeth, Nagpur',
      verificationState: VerificationState.VERIFIED,
      adminUserId: apexUser.id,
    },
  });

  // Demo Driver User & Profile
  const driverUser = await prisma.user.upsert({
    where: { email: 'driver.anil@lifelink.com' },
    update: { role: Role.DRIVER, isActive: true },
    create: {
      id: 'user-driver-anil-dev',
      name: 'Anil Patil',
      email: 'driver.anil@lifelink.com',
      passwordHash: commonPasswordHash,
      role: Role.DRIVER,
      phone: '+919876543204',
      isActive: true,
    },
  });

  const driverProfile = await prisma.driverProfile.upsert({
    where: { userId: driverUser.id },
    update: {
      licenseNumber: 'MH-31-2020-0098765',
      verificationState: VerificationState.VERIFIED,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      hospitalId: 'hosp-gmch-nagpur',
    },
    create: {
      id: 'dp-driver-anil-dev',
      userId: driverUser.id,
      licenseNumber: 'MH-31-2020-0098765',
      verificationState: VerificationState.VERIFIED,
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      hospitalId: 'hosp-gmch-nagpur',
    },
  });

  // Seed Registered Vehicles
  await prisma.ambulance.upsert({
    where: { id: 'amb-gmch-als-1' },
    update: {
      vehicleNumber: 'MH-31-AN-1001',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      hospitalId: 'hosp-gmch-nagpur',
      isAvailable: true,
      currentLat: 21.1293,
      currentLng: 79.0967,
      verificationState: VerificationState.VERIFIED,
    },
    create: {
      id: 'amb-gmch-als-1',
      vehicleNumber: 'MH-31-AN-1001',
      ambulanceType: AmbulanceType.ADVANCED_LIFE_SUPPORT,
      hospitalId: 'hosp-gmch-nagpur',
      driverId: driverUser.id,
      isAvailable: true,
      currentLat: 21.1293,
      currentLng: 79.0967,
      verificationState: VerificationState.VERIFIED,
    },
  });

  // Active Vehicle Assignment for Dispatch Engine
  await prisma.driverVehicleAssignment.upsert({
    where: { id: 'dva-anil-gmch-dev' },
    update: {
      driverId: driverProfile.id,
      ambulanceId: 'amb-gmch-als-1',
      isCurrent: true,
    },
    create: {
      id: 'dva-anil-gmch-dev',
      driverId: driverProfile.id,
      ambulanceId: 'amb-gmch-als-1',
      isCurrent: true,
    },
  });

  await prisma.ambulance.upsert({
    where: { id: 'amb-apex-bls-1' },
    update: {
      vehicleNumber: 'MH-31-AN-2002',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      operatorId: apexOperator.id,
      isAvailable: true,
      currentLat: 21.147,
      currentLng: 79.089,
      verificationState: VerificationState.VERIFIED,
    },
    create: {
      id: 'amb-apex-bls-1',
      vehicleNumber: 'MH-31-AN-2002',
      ambulanceType: AmbulanceType.BASIC_LIFE_SUPPORT,
      operatorId: apexOperator.id,
      isAvailable: true,
      currentLat: 21.147,
      currentLng: 79.089,
      verificationState: VerificationState.VERIFIED,
    },
  });

  // 6. Seed Real Doctors from data/nagpur/doctors.json
  const doctorsJsonPath = path.resolve(__dirname, '../../data/nagpur/doctors.json');
  if (fs.existsSync(doctorsJsonPath)) {
    const rawDoctors = JSON.parse(fs.readFileSync(doctorsJsonPath, 'utf8'));
    console.log(`[LifeLink Seed] Seeding ${rawDoctors.length} verified Nagpur doctors...`);

    for (const doc of rawDoctors) {
      const primaryHospitalId = doc.hospitalId || 'fac-max-super-nagpur';

      // Ensure hospital exists
      const hospExists = await prisma.hospital.findUnique({ where: { id: primaryHospitalId } });
      if (!hospExists) {
        continue;
      }

      await prisma.doctor.upsert({
        where: { id: doc.id },
        update: {
          hospitalId: primaryHospitalId,
          name: doc.name,
          specialization: doc.specialization,
          qualifications: doc.qualifications || null,
          experienceYears: doc.experienceYears || 0,
          consultationFee: doc.consultationFee || 500,
          isActive: true,
          designation: doc.designation || null,
          profileUrl: doc.profileUrl || null,
          imageUrl: doc.imageUrl || null,
          sourceUrl: doc.sourceUrl || null,
          verificationStatus: doc.verificationStatus || 'VERIFIED_PARTNER',
          bookingEnabled: doc.bookingEnabled !== undefined ? doc.bookingEnabled : true,
          specialtiesList: doc.specialtiesList || [doc.specialization],
          registrationNumber: doc.registrationNumber || null,
        },
        create: {
          id: doc.id,
          hospitalId: primaryHospitalId,
          name: doc.name,
          specialization: doc.specialization,
          qualifications: doc.qualifications || null,
          experienceYears: doc.experienceYears || 0,
          consultationFee: doc.consultationFee || 500,
          isActive: true,
          designation: doc.designation || null,
          profileUrl: doc.profileUrl || null,
          imageUrl: doc.imageUrl || null,
          sourceUrl: doc.sourceUrl || null,
          verificationStatus: doc.verificationStatus || 'VERIFIED_PARTNER',
          bookingEnabled: doc.bookingEnabled !== undefined ? doc.bookingEnabled : true,
          specialtiesList: doc.specialtiesList || [doc.specialization],
          registrationNumber: doc.registrationNumber || null,
        },
      });

      // Hospital affiliation
      const affId = `aff-${primaryHospitalId}-${doc.id}`;
      await prisma.hospitalDoctor.upsert({
        where: { id: affId },
        update: {
          hospitalId: primaryHospitalId,
          doctorId: doc.id,
          affiliationStatus: doc.bookingEnabled ? 'VERIFIED_PARTNER' : 'AFFILIATED',
          sourceUrl: doc.sourceUrl || null,
        },
        create: {
          id: affId,
          hospitalId: primaryHospitalId,
          doctorId: doc.id,
          affiliationStatus: doc.bookingEnabled ? 'VERIFIED_PARTNER' : 'AFFILIATED',
          sourceUrl: doc.sourceUrl || null,
        },
      });
    }
  }

  console.log('[LifeLink Seed] Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('[LifeLink Seed Error]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
