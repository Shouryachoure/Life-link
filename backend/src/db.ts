import { PrismaClient, Role, User, PatientProfile, RefreshToken } from '@prisma/client';
import crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

// In-memory collections for isolated test runs and offline local development
class InMemoryDatabase {
  users = new Map<string, any>();
  patientProfiles = new Map<string, any>();
  driverProfiles = new Map<string, any>();
  ambulanceOperators = new Map<string, any>();
  driverVehicleAssignments = new Map<string, any>();
  verificationAuditLogs = new Map<string, any>();
  refreshTokens = new Map<string, any>();
  hospitalRegistrations = new Map<string, any>();
  hospitals = new Map<string, any>();
  ambulances = new Map<string, any>();
  healthMetrics = new Map<string, any>();
  emergencyRequests = new Map<string, any>();
  serviceAreas = new Map<string, any>();
  dispatchAttempts = new Map<string, any>();
  emergencyTrips = new Map<string, any>();
  emergencyEvents = new Map<string, any>();
  doctors = new Map<string, any>();
  hospitalDoctors = new Map<string, any>();
  doctorSlots = new Map<string, any>();
  appointments = new Map<string, any>();
  hospitalBeds = new Map<string, any>();
  hospitalBookings = new Map<string, any>();
  hospitalCapacityAuditLogs = new Map<string, any>();
  queueEntries = new Map<string, any>();
  emergencyContacts = new Map<string, any>();
  activityLogs = new Map<string, any>();
  notifications = new Map<string, any>();
  emergencyHealthAccessLogs = new Map<string, any>();
  emergencyTripShares = new Map<string, any>();
  emergencyTripShareAuditLogs = new Map<string, any>();
  appointmentAuditLogs = new Map<string, any>();
  directoryFacilities = new Map<string, any>();
  directoryAmbulanceServices = new Map<string, any>();
  directoryReviewIssues = new Map<string, any>();
  hospitalOnboardingApplications = new Map<string, any>();
  operatorOnboardingApplications = new Map<string, any>();
  driverVerificationApplications = new Map<string, any>();
  pilotActivationChecklists = new Map<string, any>();

  constructor() {
    this.seedDefaultServiceArea();
    if (process.env.NODE_ENV !== 'test') {
      this.seedDefaultDevData();
    }
  }

  seedDefaultServiceArea() {
    const nagpur = {
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.serviceAreas.set(nagpur.id, nagpur);
  }

  seedDefaultDevData() {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password123', salt);

    // 1. Super Admin
    const superAdmin = {
      id: 'user-superadmin-dev',
      name: 'Lead Operations Director',
      email: 'superadmin@lifelink.com',
      passwordHash: hash,
      role: Role.SUPER_ADMIN,
      phone: '+919876543200',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(superAdmin.id, superAdmin);

    // 2. Hospital 1: GMCH Nagpur
    const gmchAdmin = {
      id: 'user-admin-gmch-dev',
      name: 'Dr. Suresh Deshpande',
      email: 'admin.gmch@lifelink.com',
      passwordHash: hash,
      role: Role.ADMIN_HOSPITAL,
      phone: '+919876543201',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      hospitalId: 'hosp-gmch-nagpur',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(gmchAdmin.id, gmchAdmin);

    const gmch = {
      id: 'hosp-gmch-nagpur',
      name: 'GMCH Trauma Care Center Nagpur',
      address: 'Medical Square, Hanuman Nagar, Nagpur',
      locality: 'Medical Square',
      aliases: [
        'Government Medical College and Hospital',
        'GMCH Nagpur',
        'GMC Nagpur',
        'GMCH',
        'Government Medical College',
      ],
      alternateNames: ['GMC Nagpur', 'Government Medical College Hospital'],
      specialties: ['Trauma Care', 'Cardiology', 'Neurology', 'General Medicine', 'General Surgery', 'Emergency Medicine'],
      contactNumber: '07122744400',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1293,
      lng: 79.0967,
      adminUserId: gmchAdmin.id,
      availableBeds: 45,
      totalBeds: 150,
      capacityLastUpdated: new Date(),
      verificationState: 'VERIFIED',
      website: 'https://gmchnagpur.org',
      sourceUrl: 'https://gmchnagpur.org',
      isDemo: false,
      createdAt: new Date(),
    };
    this.hospitals.set(gmch.id, gmch);

    // Hospital 2: Mayo Hospital Nagpur
    const mayoAdmin = {
      id: 'user-admin-mayo-dev',
      name: 'Dr. Ananya Deshmukh',
      email: 'admin.mayo@lifelink.com',
      passwordHash: hash,
      role: Role.ADMIN_HOSPITAL,
      phone: '+919876543202',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      hospitalId: 'hosp-mayo-nagpur',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(mayoAdmin.id, mayoAdmin);

    const mayo = {
      id: 'hosp-mayo-nagpur',
      name: 'Indira Gandhi GMC & Mayo Hospital',
      address: 'Central Avenue, Mominpura, Nagpur',
      locality: 'Mominpura',
      aliases: [
        'Indira Gandhi Government Medical College',
        'IGGMC Nagpur',
        'Mayo Hospital',
        'Mayo Nagpur',
        'IGGMC',
      ],
      alternateNames: ['IGGMC', 'Mayo Hospital'],
      specialties: ['Orthopedics', 'Pediatrics', 'Obstetrics & Gynecology', 'General Medicine', 'Ophthalmology'],
      contactNumber: '07122725423',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1534,
      lng: 79.0984,
      adminUserId: mayoAdmin.id,
      availableBeds: 28,
      totalBeds: 100,
      capacityLastUpdated: new Date(),
      verificationState: 'VERIFIED',
      website: 'https://iggmc.org',
      sourceUrl: 'https://iggmc.org',
      isDemo: false,
      createdAt: new Date(),
    };
    this.hospitals.set(mayo.id, mayo);

    // Hospital 3: Max Super Speciality Hospital, Nagpur (Formerly Alexis)
    const maxAdmin = {
      id: 'user-admin-max-dev',
      name: 'Dr. Nitin Dambhare',
      email: 'admin.max@lifelink.com',
      passwordHash: hash,
      role: Role.ADMIN_HOSPITAL,
      phone: '+919876543206',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      hospitalId: 'fac-max-super-nagpur',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(maxAdmin.id, maxAdmin);

    const maxHosp = {
      id: 'fac-max-super-nagpur',
      name: 'Max Super Speciality Hospital, Nagpur (Formerly Alexis)',
      address: 'Survey No. 232, House No. 1313, Mankapur Square, Koradi Road, Nagpur, Maharashtra',
      locality: 'Mankapur',
      aliases: [
        'Alexis Multi-Speciality Hospital',
        'Max Hospital Mankapur',
        'Alexis Hospital',
        'Max Super Speciality Hospital',
        'Max Hospital',
        'Alexis',
        'Max Nagpur',
        'Max Super Speciality Hospital Nagpur',
      ],
      alternateNames: ['Alexis Hospital', 'Alexis Multi-Speciality Hospital', 'Max Hospital Mankapur'],
      specialties: [
        'Neurosurgery',
        'Neurosciences',
        'Spine Surgery',
        'Internal Medicine',
        'Cardiology',
        'Oncology',
        'Orthopaedics',
        'Gastroenterology',
        'Urology',
        'Pediatrics',
      ],
      contactNumber: '07127120000',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.1876,
      lng: 79.0812,
      adminUserId: maxAdmin.id,
      availableBeds: 24,
      totalBeds: 200,
      capacityLastUpdated: new Date(),
      verificationState: 'VERIFIED',
      website: 'https://www.maxhealthcare.in/hospital-network/max-super-speciality-hospital-nagpur',
      sourceUrl: 'https://www.maxhealthcare.in/doctor/nagpur',
      isDemo: false,
      createdAt: new Date(),
    };
    this.hospitals.set(maxHosp.id, maxHosp);

    // Hospital 4: AIIMS Nagpur
    const aiimsAdmin = {
      id: 'user-admin-aiims-dev',
      name: 'Dr. AIIMS Director',
      email: 'admin.aiims@lifelink.com',
      passwordHash: hash,
      role: Role.ADMIN_HOSPITAL,
      phone: '+919876543207',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      hospitalId: 'fac-aiims-nagpur',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(aiimsAdmin.id, aiimsAdmin);

    const aiimsHosp = {
      id: 'fac-aiims-nagpur',
      name: 'AIIMS Nagpur (All India Institute of Medical Sciences)',
      address: 'Plot No. 2, Sector 20, MIHAN, Nagpur, Maharashtra',
      locality: 'MIHAN',
      aliases: [
        'All India Institute of Medical Sciences Nagpur',
        'AIIMS MIHAN',
        'AIIMS Hospital Nagpur',
        'AIIMS',
      ],
      alternateNames: ['AIIMS Nagpur', 'AIIMS MIHAN'],
      specialties: [
        'Cardiology',
        'Neurology',
        'Oncology',
        'Pulmonology',
        'Endocrinology',
        'General Medicine',
        'General Surgery',
      ],
      contactNumber: '07122355555',
      city: 'Nagpur',
      state: 'Maharashtra',
      lat: 21.0558,
      lng: 79.0272,
      adminUserId: aiimsAdmin.id,
      availableBeds: 60,
      totalBeds: 500,
      capacityLastUpdated: new Date(),
      verificationState: 'VERIFIED',
      website: 'https://aiimsnagpur.edu.in',
      sourceUrl: 'https://aiimsnagpur.edu.in',
      isDemo: false,
      createdAt: new Date(),
    };
    this.hospitals.set(aiimsHosp.id, aiimsHosp);

    // 3. Private Ambulance Operator: Apex Fleet
    const apexAdmin = {
      id: 'user-admin-apex-dev',
      name: 'Ramesh Joshi',
      email: 'admin.apex@lifelink.com',
      passwordHash: hash,
      role: Role.OPERATOR_ADMIN,
      phone: '+919876543203',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      operatorId: 'operator-apex-nagpur',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(apexAdmin.id, apexAdmin);

    const apexOperator = {
      id: 'operator-apex-nagpur',
      name: 'Apex Emergency Mobility Fleet',
      tradeLicense: 'MH-NGP-2024-OP-01',
      contactPhone: '+919876500000',
      email: 'apex.fleet@lifelink.org',
      city: 'Nagpur',
      state: 'Maharashtra',
      address: 'Dharampeth, Nagpur',
      verificationState: 'VERIFIED',
      adminUserId: apexAdmin.id,
      isDemo: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.ambulanceOperators.set(apexOperator.id, apexOperator);

    // 4. Ambulances
    const ambGmch = {
      id: 'amb-gmch-als-1',
      vehicleNumber: 'MH-31-AN-1001',
      ambulanceType: 'ADVANCED_LIFE_SUPPORT',
      hospitalId: gmch.id,
      driverId: 'user-driver-anil-dev',
      isAvailable: true,
      currentLat: 21.1458,
      currentLng: 79.0882,
      lastUpdated: new Date(),
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: false,
      createdAt: new Date(),
    };
    this.ambulances.set(ambGmch.id, ambGmch);

    const ambApex = {
      id: 'amb-apex-bls-1',
      vehicleNumber: 'MH-31-AN-2002',
      ambulanceType: 'BASIC_LIFE_SUPPORT',
      operatorId: apexOperator.id,
      driverId: 'user-driver-vikram-dev',
      isAvailable: true,
      currentLat: 21.147,
      currentLng: 79.089,
      lastUpdated: new Date(),
      verificationState: 'VERIFIED',
      verificationStatus: 'APPROVED',
      maintenanceStatus: 'OPERATIONAL',
      isDemo: false,
      createdAt: new Date(),
    };
    this.ambulances.set(ambApex.id, ambApex);

    // 5. Driver 1: Anil Patil (GMCH ALS)
    const driverUser = {
      id: 'user-driver-anil-dev',
      name: 'Anil Patil',
      email: 'driver.anil@lifelink.com',
      passwordHash: hash,
      role: Role.DRIVER,
      phone: '+919876543204',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(driverUser.id, driverUser);

    const driverProfile = {
      id: 'dp-driver-anil-dev',
      userId: driverUser.id,
      licenseNumber: 'MH-31-2020-0098765',
      verificationState: 'VERIFIED',
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      hospitalId: gmch.id,
      isDemo: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.driverProfiles.set(driverUser.id, driverProfile);

    const assignmentAnil = {
      id: 'dva-anil-gmch-dev',
      driverId: driverProfile.id,
      ambulanceId: ambGmch.id,
      isCurrent: true,
      assignedAt: new Date(),
    };
    this.driverVehicleAssignments.set(assignmentAnil.id, assignmentAnil);

    // 5b. Driver 2: Vikram Singh (Apex Private Fleet BLS)
    const driverUserVikram = {
      id: 'user-driver-vikram-dev',
      name: 'Vikram Singh',
      email: 'driver.vikram@lifelink.com',
      passwordHash: hash,
      role: Role.DRIVER,
      phone: '+919876543205',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(driverUserVikram.id, driverUserVikram);

    const driverProfileVikram = {
      id: 'dp-driver-vikram-dev',
      userId: driverUserVikram.id,
      licenseNumber: 'MH-31-2021-0045678',
      verificationState: 'VERIFIED',
      membershipStatus: 'APPROVED',
      isDispatchEligible: true,
      operatorId: apexOperator.id,
      isDemo: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.driverProfiles.set(driverUserVikram.id, driverProfileVikram);

    const assignmentVikram = {
      id: 'dva-vikram-apex-dev',
      driverId: driverProfileVikram.id,
      ambulanceId: ambApex.id,
      isCurrent: true,
      assignedAt: new Date(),
    };
    this.driverVehicleAssignments.set(assignmentVikram.id, assignmentVikram);

    // 6. Patient: Pooja Sharma
    const patientUser = {
      id: 'user-patient-pooja-dev',
      name: 'Pooja Sharma',
      email: 'patient.pooja@lifelink.com',
      passwordHash: hash,
      role: Role.PATIENT,
      phone: '+919876543210',
      isPhoneVerified: true,
      isActive: true,
      isSuspended: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(patientUser.id, patientUser);

    const patientProfile = {
      id: 'pp-pooja-dev',
      userId: patientUser.id,
      bloodGroup: 'O_POSITIVE',
      bloodGroupProvenance: 'PATIENT_REPORTED',
      allergies: 'Penicillin',
      allergiesProvenance: 'PATIENT_REPORTED',
      medicalConditions: 'Mild Asthma',
      medicalConditionsProvenance: 'PATIENT_REPORTED',
      currentMedications: 'Albuterol inhaler PRN',
      medicationsProvenance: 'PATIENT_REPORTED',
      organDonorStatus: 'REGISTERED_DONOR',
      emergencyContactName: 'Rajesh Sharma',
      emergencyContactPhone: '+919876543211',
      emergencyAccessToken: 'pooja-emergency-card-token-12345',
      tokenGeneratedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.patientProfiles.set(patientUser.id, patientProfile);

    // 7. Hospital Beds for GMCH (15 Beds)
    const gmchBeds = [
      { num: 'ER-01', ward: 'EMERGENCY_ER', cat: 'EMERGENCY', status: 'AVAILABLE' },
      { num: 'ER-02', ward: 'EMERGENCY_ER', cat: 'EMERGENCY', status: 'AVAILABLE' },
      { num: 'ER-03', ward: 'EMERGENCY_ER', cat: 'EMERGENCY', status: 'OCCUPIED', patientName: 'Sanjay Rao' },
      { num: 'TR-01', ward: 'TRAUMA', cat: 'EMERGENCY', status: 'AVAILABLE' },
      { num: 'ICU-01', ward: 'ICU', cat: 'ICU', status: 'AVAILABLE' },
      { num: 'ICU-02', ward: 'ICU', cat: 'ICU', status: 'AVAILABLE' },
      { num: 'ICU-03', ward: 'ICU', cat: 'ICU', status: 'OCCUPIED', patientName: 'Amit Verma' },
      { num: 'ICU-04', ward: 'ICU', cat: 'ICU', status: 'CLEANING' },
      { num: 'GW-101', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'AVAILABLE' },
      { num: 'GW-102', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'AVAILABLE' },
      { num: 'GW-103', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'AVAILABLE' },
      { num: 'GW-104', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'OCCUPIED', patientName: 'Geeta Nair' },
      { num: 'PED-01', ward: 'PEDIATRIC', cat: 'PEDIATRIC', status: 'AVAILABLE' },
      { num: 'PED-02', ward: 'PEDIATRIC', cat: 'PEDIATRIC', status: 'AVAILABLE' },
      { num: 'SURG-01', ward: 'SURGICAL', cat: 'SURGICAL', status: 'AVAILABLE' },
    ];
    for (const b of gmchBeds) {
      const bedId = `bed-gmch-${b.num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      this.hospitalBeds.set(bedId, {
        id: bedId,
        hospitalId: gmch.id,
        bedNumber: b.num,
        ward: b.ward,
        category: b.cat,
        status: b.status,
        patientName: (b as any).patientName || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const gmchAvailCount = gmchBeds.filter((b) => b.status === 'AVAILABLE').length;
    gmch.availableBeds = gmchAvailCount;
    gmch.totalBeds = gmchBeds.length;
    this.hospitals.set(gmch.id, gmch);

    // 7b. Hospital Beds for Mayo Hospital (12 Beds)
    const mayoBeds = [
      { num: 'MAY-ER-01', ward: 'EMERGENCY_ER', cat: 'EMERGENCY', status: 'AVAILABLE' },
      { num: 'MAY-ER-02', ward: 'EMERGENCY_ER', cat: 'EMERGENCY', status: 'AVAILABLE' },
      { num: 'MAY-TR-01', ward: 'TRAUMA', cat: 'EMERGENCY', status: 'AVAILABLE' },
      { num: 'MAY-ICU-01', ward: 'ICU', cat: 'ICU', status: 'AVAILABLE' },
      { num: 'MAY-ICU-02', ward: 'ICU', cat: 'ICU', status: 'OCCUPIED', patientName: 'Kishore Kumar' },
      { num: 'MAY-ICU-03', ward: 'ICU', cat: 'ICU', status: 'CLEANING' },
      { num: 'MAY-GW-201', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'AVAILABLE' },
      { num: 'MAY-GW-202', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'AVAILABLE' },
      { num: 'MAY-GW-203', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'AVAILABLE' },
      { num: 'MAY-GW-204', ward: 'GENERAL_WARD', cat: 'GENERAL', status: 'OCCUPIED', patientName: 'Sunita Joshi' },
      { num: 'MAY-PED-01', ward: 'PEDIATRIC', cat: 'PEDIATRIC', status: 'AVAILABLE' },
      { num: 'MAY-PED-02', ward: 'PEDIATRIC', cat: 'PEDIATRIC', status: 'AVAILABLE' },
    ];
    for (const b of mayoBeds) {
      const bedId = `bed-mayo-${b.num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      this.hospitalBeds.set(bedId, {
        id: bedId,
        hospitalId: mayo.id,
        bedNumber: b.num,
        ward: b.ward,
        category: b.cat,
        status: b.status,
        patientName: (b as any).patientName || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const mayoAvailCount = mayoBeds.filter((b) => b.status === 'AVAILABLE').length;
    mayo.availableBeds = mayoAvailCount;
    mayo.totalBeds = mayoBeds.length;
    this.hospitals.set(mayo.id, mayo);

    // 8. Doctors & OPD Slots for GMCH & Mayo Hospital
    const devDoctors = [
      {
        id: 'doc-gmch-rajesh-dev',
        hospitalId: gmch.id,
        name: 'Dr. Rajesh Sharma',
        email: 'dr.sharma@gmch.lifelink.org',
        specialization: 'Cardiology',
        qualifications: 'MBBS, MD (Internal Medicine), DM (Cardiology)',
        experienceYears: 14,
        consultationFee: 500,
        roomNumber: 'OPD Room 12',
        isActive: true,
        unavailableDates: [],
        defaultSlotDuration: 15,
      },
      {
        id: 'doc-gmch-priya-dev',
        hospitalId: gmch.id,
        name: 'Dr. Priya Kulkarni',
        email: 'dr.kulkarni@gmch.lifelink.org',
        specialization: 'Neurology',
        qualifications: 'MBBS, MD, DM (Neurology)',
        experienceYears: 11,
        consultationFee: 600,
        roomNumber: 'OPD Room 15',
        isActive: true,
        unavailableDates: [],
        defaultSlotDuration: 15,
      },
      {
        id: 'doc-gmch-arvind-dev',
        hospitalId: gmch.id,
        name: 'Dr. Arvind Verma',
        email: 'dr.verma@gmch.lifelink.org',
        specialization: 'General Medicine',
        qualifications: 'MBBS, MD (General Medicine)',
        experienceYears: 18,
        consultationFee: 300,
        roomNumber: 'OPD Room 04',
        isActive: true,
        unavailableDates: [],
        defaultSlotDuration: 15,
      },
      {
        id: 'doc-mayo-ananya-dev',
        hospitalId: mayo.id,
        name: 'Dr. Ananya Deshmukh',
        email: 'dr.deshmukh@mayo.lifelink.org',
        specialization: 'Orthopedics',
        qualifications: 'MBBS, MS (Orthopedic Surgery)',
        experienceYears: 12,
        consultationFee: 450,
        roomNumber: 'OPD Room 08',
        isActive: true,
        unavailableDates: [],
        defaultSlotDuration: 15,
      },
      {
        id: 'doc-mayo-sameer-dev',
        hospitalId: mayo.id,
        name: 'Dr. Sameer Khan',
        email: 'dr.khan@mayo.lifelink.org',
        specialization: 'Pediatrics',
        qualifications: 'MBBS, MD (Pediatrics), DNB',
        experienceYears: 9,
        consultationFee: 400,
        roomNumber: 'Pediatric OPD 02',
        isActive: true,
        unavailableDates: [],
        defaultSlotDuration: 15,
      },
    ];

    for (const doc of devDoctors) {
      this.doctors.set(doc.id, {
        ...doc,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.hospitalDoctors.set(`aff-${doc.hospitalId}-${doc.id}`, {
        id: `aff-${doc.hospitalId}-${doc.id}`,
        hospitalId: doc.hospitalId,
        doctorId: doc.id,
        affiliationStatus: 'VERIFIED_PARTNER',
        affiliationSource: 'PARTNER_HOSPITAL_ONBOARDING',
        sourceUrl: null,
        lastVerifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Seed slots for today and the next 7 days
      const slotTimes = [
        { start: '09:00', end: '10:00' },
        { start: '10:30', end: '11:30' },
        { start: '14:00', end: '15:00' },
        { start: '15:30', end: '16:30' },
        { start: '17:00', end: '18:00' },
        { start: '18:30', end: '19:30' },
      ];

      for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
        const targetDate = new Date(Date.now() + dayOffset * 86400000);
        const dateStr = targetDate.toISOString().split('T')[0];

        for (const st of slotTimes) {
          const slotId = `slot-${doc.id}-${dateStr}-${st.start.replace(':', '')}`;
          this.doctorSlots.set(slotId, {
            id: slotId,
            doctorId: doc.id,
            date: dateStr,
            startTime: st.start,
            endTime: st.end,
            maxPatients: 5,
            bookedCount: 0,
            slotDurationMinutes: 15,
            isBlocked: false,
            blockedReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
    }

    // 9. Seed Public Doctors Directory (Max Healthcare Nagpur 50 doctors)
    this.seedPublicDoctors();

    // 10. Public Directory Datasets (Nagpur Hospitals & Ambulance Services)
    this.seedDirectoryData(gmch.id, apexOperator.id);
  }

  seedPublicDoctors() {
    try {
      const fs = require('fs');
      const path = require('path');
      const primaryDocPath = path.resolve(__dirname, '../../data/nagpur/doctors.json');
      const fallbackDocPath = path.resolve(__dirname, '../../data/nagpur/doctors/max_healthcare_nagpur_doctors.json');
      const docPath = fs.existsSync(primaryDocPath) ? primaryDocPath : fallbackDocPath;
      if (fs.existsSync(docPath)) {
        const rawDocs = JSON.parse(fs.readFileSync(docPath, 'utf8'));
        for (const doc of rawDocs) {
          const docId = doc.id;
          const primaryHospitalId = doc.hospitalId || 'fac-max-super-nagpur';
          this.doctors.set(docId, {
            id: docId,
            hospitalId: primaryHospitalId,
            name: doc.name,
            specialization: doc.specialization,
            qualifications: doc.qualifications || null,
            experienceYears: doc.experienceYears || 0,
            consultationFee: doc.consultationFee || 0,
            roomNumber: null,
            isActive: true,
            unavailableDates: [],
            defaultSlotDuration: 15,
            designation: doc.designation || null,
            profileUrl: doc.profileUrl || null,
            imageUrl: doc.imageUrl || null,
            sourceUrl: doc.sourceUrl || 'https://www.maxhealthcare.in/doctor/nagpur',
            sourceRetrievedAt: doc.sourceRetrievedAt ? new Date(doc.sourceRetrievedAt) : new Date(),
            verificationStatus: doc.verificationStatus || 'PUBLIC_DIRECTORY_LISTED',
            bookingEnabled: doc.bookingEnabled !== undefined ? doc.bookingEnabled : false,
            specialtiesList: doc.specialtiesList || [doc.specialization],
            registrationNumber: doc.registrationNumber || null,
            registrationAuthority: doc.registrationAuthority || 'Maharashtra Medical Council',
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Seed primary hospital affiliation
          const affId = `aff-${primaryHospitalId}-${docId}`;
          this.hospitalDoctors.set(affId, {
            id: affId,
            hospitalId: primaryHospitalId,
            doctorId: docId,
            affiliationStatus: doc.affiliationStatus || (doc.bookingEnabled ? 'VERIFIED_PARTNER' : 'AFFILIATED'),
            affiliationSource: doc.sourceUrl || 'OFFICIAL_HOSPITAL_DIRECTORY',
            sourceUrl: doc.sourceUrl || null,
            lastVerifiedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Seed secondary affiliations if present (e.g. multi-hospital visiting specialists)
          if (Array.isArray(doc.secondaryHospitalIds)) {
            for (const secHospId of doc.secondaryHospitalIds) {
              const secAffId = `aff-${secHospId}-${docId}`;
              this.hospitalDoctors.set(secAffId, {
                id: secAffId,
                hospitalId: secHospId,
                doctorId: docId,
                affiliationStatus: 'VISITING_CONSULTANT',
                affiliationSource: doc.sourceUrl || 'OFFICIAL_HOSPITAL_DIRECTORY',
                sourceUrl: doc.sourceUrl || null,
                lastVerifiedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('Failed to seed Max Healthcare public doctors:', err.message);
    }
  }

  seedDirectoryData(gmchId: string = 'hosp-gmch-nagpur', apexOperatorId: string = 'op-apex-nagpur') {
    try {
      const fs = require('fs');
      const path = require('path');
      const primaryHospPath = path.resolve(__dirname, '../../data/nagpur/hospitals.json');
      const fallbackHospPath = path.resolve(__dirname, '../../data/imports/nagpur/nagpur_hospitals_directory.json');
      const hospPath = fs.existsSync(primaryHospPath) ? primaryHospPath : fallbackHospPath;
      if (fs.existsSync(hospPath)) {
        const rawHosp = JSON.parse(fs.readFileSync(hospPath, 'utf8'));
        for (const h of rawHosp) {
          const id = h.record_id || h.id;
          const isGmch = id === 'fac-gmch-nagpur';
          const isMax = id === 'fac-max-super-nagpur';
          const isAiims = id === 'fac-aiims-nagpur';
          const latVal = h.latitude !== undefined && h.latitude !== null ? Number(h.latitude) : (h.lat !== undefined && h.lat !== null ? Number(h.lat) : null);
          const lngVal = h.longitude !== undefined && h.longitude !== null ? Number(h.longitude) : (h.lng !== undefined && h.lng !== null ? Number(h.lng) : null);
          this.directoryFacilities.set(id, {
            id,
            name: h.facility_name || h.name,
            alternateNames: h.aliases || h.alternateNames || [],
            recordType: h.recordType || 'HOSPITAL',
            recordStatus: h.verification_status === 'DUPLICATE' ? 'DUPLICATE' : (h.recordStatus || 'ACTIVE'),
            facilityType: h.facility_type || h.facilityType || 'GENERAL_HOSPITAL',
            ownership: h.ownership_type || h.ownership || 'UNKNOWN',
            contactNumber: h.main_phone || h.contactNumber,
            rawContactNumber: h.main_phone || h.rawContactNumber || h.contactNumber,
            alternateNumber: h.alternateNumber || null,
            address: h.address,
            locality: h.locality || null,
            tehsil: h.tehsil || 'Nagpur Urban',
            coverageGroup: h.coverage_group || h.coverageGroup || (h.tehsil && h.tehsil !== 'Nagpur Urban' ? 'NAGPUR_DISTRICT_RURAL' : 'NAGPUR_CITY'),
            city: h.city || 'Nagpur',
            district: h.district || 'Nagpur',
            state: h.state || 'Maharashtra',
            pincode: h.pin_code || h.pincode || null,
            lat: latVal,
            lng: lngVal,
            isGeocoded: latVal !== null && lngVal !== null,
            coordinateQuality: h.coordinateQuality || (latVal !== null ? 'EXACT_ROOFTOP' : 'UNVERIFIED'),
            website: h.website || null,
            emergencyHelpline: h.emergency_phone || h.emergencyHelpline || null,
            emergencyPhone: h.emergency_phone || h.emergencyHelpline || null,
            ambulancePhone: h.ambulance_phone || h.ambulancePhone || null,
            publicEmail: h.public_email || h.publicEmail || null,
            specialties: h.specialties || null,
            emergencyServicesClaimed: Boolean(h.emergency_services_claimed || h.emergencyServicesClaimed),
            sourceUrl: h.source_url || h.sourceUrl,
            sourceType: h.source_type || h.sourceType || 'OFFICIAL_GOVERNMENT_PORTAL',
            sourceRetrievedAt: h.source_retrieved_at ? new Date(h.source_retrieved_at) : (h.sourceRetrievedAt ? new Date(h.sourceRetrievedAt) : new Date()),
            dataProvenance: h.dataProvenance || h.notes || 'Nagpur healthcare directory persistent record.',
            dataConfidence: h.data_confidence || h.dataConfidence || 'DIRECTORY_LISTED',
            lastCheckedAt: new Date(h.lastCheckedAt || h.source_retrieved_at || new Date()),
            lastVerifiedAt: new Date(h.lastVerifiedAt || h.contact_verified_at || new Date()),
            verificationStatus: h.verification_status || h.verificationStatus || 'VERIFIED',
            contactVerificationStatus: h.contactVerificationStatus || 'VERIFIED',
            lastContactVerifiedAt: h.contact_verified_at ? new Date(h.contact_verified_at) : (h.lastContactVerifiedAt ? new Date(h.lastContactVerifiedAt) : null),
            linkStatus: (isGmch || isMax || isAiims) ? 'LINKED_PARTNER' : (h.linkStatus || 'UNLINKED'),
            onboardingStatus: h.onboardingStatus || 'PUBLIC_DIRECTORY_RECORD',
            linkedHospitalId: isGmch ? gmchId : (isMax ? 'fac-max-super-nagpur' : (isAiims ? 'fac-aiims-nagpur' : null)),
            isDuplicate: h.verification_status === 'DUPLICATE' || h.isDuplicate === true,
            duplicateOfId: h.duplicate_group || h.duplicateOfId || null,
            duplicateGroup: h.duplicate_group || null,
            notes: h.notes || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
      const primaryAmbPath = path.resolve(__dirname, '../../data/nagpur/ambulance_providers.json');
      const fallbackAmbPath = path.resolve(__dirname, '../../data/imports/nagpur/nagpur_ambulances_directory.json');
      const ambPath = fs.existsSync(primaryAmbPath) ? primaryAmbPath : fallbackAmbPath;
      if (fs.existsSync(ambPath)) {
        const rawAmb = JSON.parse(fs.readFileSync(ambPath, 'utf8'));
        for (const a of rawAmb) {
          const id = a.record_id || a.id;
          const isApex = id === 'amb-apex-critical-care';
          const latVal = a.latitude !== undefined && a.latitude !== null ? Number(a.latitude) : (a.lat !== undefined && a.lat !== null ? Number(a.lat) : null);
          const lngVal = a.longitude !== undefined && a.longitude !== null ? Number(a.longitude) : (a.lng !== undefined && a.lng !== null ? Number(a.lng) : null);
          const isHelpline = ['108', '112', '102'].includes(String(a.public_business_phone || a.contactNumber || ''));
          const hospitalLinks: Record<string, string> = {
            'amb-gmch-hospital-fleet': 'fac-gmch-nagpur',
            'amb-iggmch-mayo-fleet': 'fac-iggmc-mayo-nagpur',
            'amb-aiims-dedicated-line': 'fac-aiims-nagpur',
            'amb-wockhardt-dedicated-fleet': 'fac-wockhardt-nagpur',
            'amb-care-emergency-line': 'fac-care-hospitals-nagpur',
            'amb-kingsway-rapid-response': 'fac-kingsway-hospitals-nagpur',
            'amb-ochri-dedicated-line': 'fac-ochri-nagpur',
            'amb-suretech-dispatch': 'fac-suretech-hospital-nagpur',
            'amb-max-emergency-line': 'fac-max-super-nagpur',
            'amb-nci-emergency-transport': 'fac-nci-jamtha',
          };
          const linkedHospId = hospitalLinks[id] || a.linkedHospitalId || null;
          const isHospitalOperated = Boolean(linkedHospId);
          this.directoryAmbulanceServices.set(id, {
            id,
            serviceName: a.provider_name || a.serviceName,
            recordType: a.recordType || (isHelpline ? 'OFFICIAL_EMERGENCY_HELPLINE' : 'AMBULANCE_PROVIDER'),
            recordStatus: a.verification_status === 'DUPLICATE' ? 'DUPLICATE' : (a.recordStatus || 'ACTIVE'),
            operatorType: isHospitalOperated ? 'HOSPITAL_OPERATED' : (a.operatorType || (isHelpline ? 'PUBLIC_EMERGENCY_SERVICE' : 'PRIVATE_OPERATOR')),
            contactNumber: a.public_business_phone || a.contactNumber,
            rawContactNumber: a.public_business_phone || a.rawContactNumber || a.contactNumber,
            alternateContact: a.alternate_public_phone || a.alternateContact || null,
            publicBusinessPhone: a.public_business_phone || a.contactNumber,
            alternatePublicPhone: a.alternate_public_phone || a.alternateContact || null,
            address: a.business_address || a.address || null,
            businessAddress: a.business_address || a.address || null,
            locality: a.locality || null,
            tehsil: a.tehsil || 'Nagpur Urban',
            coverageGroup: a.coverage_group || a.coverageGroup || (a.service_area?.includes('District') || (a.tehsil && a.tehsil !== 'Nagpur Urban') ? 'NAGPUR_DISTRICT_RURAL' : 'NAGPUR_CITY'),
            city: a.city || 'Nagpur',
            district: a.district || 'Nagpur',
            state: a.state || 'Maharashtra',
            operatingArea: a.service_area || a.operatingArea || 'Nagpur Urban',
            serviceArea: a.service_area || a.operatingArea || 'Nagpur Urban',
            advertisedServiceTypes: a.advertised_service_types || a.advertisedServiceTypes || (a.fleetDescription ? [a.fleetDescription] : ['BASIC_LIFE_SUPPORT']),
            advertisedIcuOrVentilatorCapability: Boolean(a.advertised_icu_or_ventilator_capability || a.advertisedIcuOrVentilatorCapability),
            lat: latVal,
            lng: lngVal,
            isGeocoded: latVal !== null && lngVal !== null,
            coordinateQuality: a.coordinateQuality || (latVal !== null ? 'LOCALITY_APPROXIMATE' : 'UNVERIFIED'),
            website: a.website || null,
            fleetDescription: a.fleetDescription || null,
            sourceUrl: a.source_url || a.sourceUrl,
            sourceType: a.sourceType || (isHelpline ? 'OFFICIAL_GOVERNMENT_PORTAL' : 'COMMERCIAL_DIRECTORY_LISTING'),
            sourceRetrievedAt: a.source_retrieved_at ? new Date(a.source_retrieved_at) : (a.sourceRetrievedAt ? new Date(a.sourceRetrievedAt) : new Date()),
            dataProvenance: a.dataProvenance || a.notes || 'Public ambulance listing candidate. Telephone contact only.',
            dataConfidence: a.data_confidence || a.dataConfidence || 'DIRECTORY_LISTED',
            lastCheckedAt: new Date(a.lastCheckedAt || a.source_retrieved_at || new Date()),
            lastVerifiedAt: new Date(a.lastVerifiedAt || a.contact_verified_at || new Date()),
            verificationStatus: a.verification_status || a.verificationStatus || 'VERIFIED',
            contactVerificationStatus: a.contactVerificationStatus || 'VERIFIED',
            lastContactVerifiedAt: a.contact_verified_at ? new Date(a.contact_verified_at) : (a.lastContactVerifiedAt ? new Date(a.lastContactVerifiedAt) : null),
            linkStatus: isApex ? 'LINKED_PARTNER' : (a.linkStatus || 'UNLINKED'),
            onboardingStatus: a.onboardingStatus || 'PUBLIC_DIRECTORY_RECORD',
            linkedOperatorId: isApex ? apexOperatorId : null,
            linkedHospitalId: linkedHospId,
            isDuplicate: a.verification_status === 'DUPLICATE' || a.isDuplicate === true,
            duplicateOfId: a.duplicateOfId || null,
            notes: a.notes || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
    } catch {
      // Ignored if file read in isolated sandbox fails
    }
  }

  clear() {
    this.users.clear();
    this.patientProfiles.clear();
    this.driverProfiles.clear();
    this.ambulanceOperators.clear();
    this.driverVehicleAssignments.clear();
    this.verificationAuditLogs.clear();
    this.refreshTokens.clear();
    this.hospitalRegistrations.clear();
    this.hospitals.clear();
    this.ambulances.clear();
    this.healthMetrics.clear();
    this.emergencyRequests.clear();
    this.serviceAreas.clear();
    this.dispatchAttempts.clear();
    this.emergencyTrips.clear();
    this.emergencyEvents.clear();
    this.doctors.clear();
    this.hospitalDoctors.clear();
    this.doctorSlots.clear();
    this.appointments.clear();
    this.hospitalBeds.clear();
    this.hospitalBookings.clear();
    this.hospitalCapacityAuditLogs.clear();
    this.queueEntries.clear();
    this.emergencyContacts.clear();
    this.activityLogs.clear();
    this.notifications.clear();
    this.emergencyHealthAccessLogs.clear();
    this.emergencyTripShares.clear();
    this.emergencyTripShareAuditLogs.clear();
    this.appointmentAuditLogs.clear();
    this.directoryFacilities.clear();
    this.directoryAmbulanceServices.clear();
    this.directoryReviewIssues.clear();
    this.hospitalOnboardingApplications.clear();
    this.operatorOnboardingApplications.clear();
    this.driverVerificationApplications.clear();
    this.pilotActivationChecklists.clear();
    this.seedDefaultServiceArea();
  }

  user = {
    findUnique: async (args: { where: { email?: string; id?: string; phone?: string; supabaseId?: string }; include?: any }) => {
      let found: any = null;
      if (args.where.id) {
        found = this.users.get(args.where.id);
      } else if (args.where.supabaseId) {
        for (const u of this.users.values()) {
          if (u.supabaseId === args.where.supabaseId) {
            found = u;
            break;
          }
        }
      } else if (args.where.email) {
        const normEmail = args.where.email.toLowerCase().trim();
        for (const u of this.users.values()) {
          if (u.email && u.email.toLowerCase().trim() === normEmail) {
            found = u;
            break;
          }
        }
      } else if (args.where.phone) {
        const normPhone = args.where.phone.trim();
        for (const u of this.users.values()) {
          if (u.phone === normPhone) {
            found = u;
            break;
          }
        }
      }
      if (!found) return null;
      const clone = { ...found };
      if (args.include?.patientProfile) {
        clone.patientProfile = this.patientProfiles.get(clone.id) || null;
      }
      if (args.include?.driverProfile) {
        let dp = null;
        for (const p of this.driverProfiles.values()) {
          if (p.userId === clone.id) {
            dp = { ...p };
            if (args.include.driverProfile.include?.hospital && dp.hospitalId) {
              dp.hospital = this.hospitals.get(dp.hospitalId) || null;
            }
            if (args.include.driverProfile.include?.operator && dp.operatorId) {
              dp.operator = this.ambulanceOperators.get(dp.operatorId) || null;
            }
            if (args.include.driverProfile.include?.assignments) {
              dp.assignments = [];
              for (const a of this.driverVehicleAssignments.values()) {
                if (a.driverId === dp.id && a.isCurrent) {
                  const amb = this.ambulances.get(a.ambulanceId);
                  dp.assignments.push({ ...a, ambulance: amb ? { ...amb } : null });
                }
              }
            }
            break;
          }
        }
        clone.driverProfile = dp;
      }
      if (args.include?.hospital) {
        clone.hospital = clone.hospitalId ? this.hospitals.get(clone.hospitalId) || null : null;
      }
      if (args.include?.managedOperator) {
        for (const op of this.ambulanceOperators.values()) {
          if (op.adminUserId === clone.id) {
            clone.managedOperator = { ...op };
            break;
          }
        }
      }
      if (args.include?.ambulance) {
        for (const amb of this.ambulances.values()) {
          if (amb.driverId === clone.id || amb.userId === clone.id) {
            clone.ambulance = amb;
            break;
          }
        }
      }
      if (args.include?.emergencyContacts) {
        clone.emergencyContacts = [];
        for (const ec of this.emergencyContacts.values()) {
          if (ec.patientId === clone.id) {
            clone.emergencyContacts.push({ ...ec });
          }
        }
      }
      if (args.include?.emergencyHealthAccessLogs) {
        clone.emergencyHealthAccessLogs = [];
        for (const log of this.emergencyHealthAccessLogs.values()) {
          if (log.patientId === clone.id) {
            clone.emergencyHealthAccessLogs.push({ ...log });
          }
        }
      }
      return clone;
    },

    findFirst: async (args?: { where?: any; include?: any }) => {
      for (const u of this.users.values()) {
        if (!args?.where) return { ...u };
        let match = true;
        if (args.where.role && u.role !== args.where.role) match = false;
        if (args.where.email && u.email.toLowerCase() !== args.where.email.toLowerCase()) match = false;
        if (args.where.phone && u.phone !== args.where.phone) match = false;
        if (args.where.id && u.id !== args.where.id) match = false;
        if (args.where.isSuspended !== undefined && u.isSuspended !== args.where.isSuspended) match = false;
        if (args.where.isActive !== undefined && u.isActive !== args.where.isActive) match = false;
        if (args.where.operatorId && u.operatorId !== args.where.operatorId) match = false;
        if (args.where.hospitalId && u.hospitalId !== args.where.hospitalId) match = false;
        if (match) return { ...u };
      }
      return null;
    },

    findMany: async (args?: { where?: any }) => {
      const results: any[] = [];
      for (const u of this.users.values()) {
        if (!args?.where) {
          results.push({ ...u });
          continue;
        }
        let match = true;
        if (args.where.role && u.role !== args.where.role) match = false;
        if (args.where.isSuspended !== undefined && u.isSuspended !== args.where.isSuspended) match = false;
        if (args.where.isActive !== undefined && u.isActive !== args.where.isActive) match = false;
        if (match) results.push({ ...u });
      }
      return results;
    },

    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        email: args.data.email.toLowerCase().trim(),
        passwordHash: args.data.passwordHash,
        name: args.data.name,
        phone: args.data.phone || null,
        isPhoneVerified: args.data.isPhoneVerified !== undefined ? args.data.isPhoneVerified : false,
        isEmailVerified: args.data.isEmailVerified !== undefined ? args.data.isEmailVerified : false,
        verificationMethod: args.data.verificationMethod || 'EMAIL',
        role: args.data.role || Role.PATIENT,
        isActive: args.data.isActive !== undefined ? args.data.isActive : true,
        isSuspended: args.data.isSuspended !== undefined ? args.data.isSuspended : false,
        hospitalId: args.data.hospitalId || null,
        operatorId: args.data.operatorId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.set(id, record);
      return { ...record };
    },

    update: async (args: { where: { id?: string; email?: string }; data: any }) => {
      let target: any = null;
      if (args.where.id) {
        target = this.users.get(args.where.id);
      } else if (args.where.email) {
        for (const u of this.users.values()) {
          if (u.email.toLowerCase() === args.where.email!.toLowerCase()) {
            target = u;
            break;
          }
        }
      }
      if (!target) throw new Error('User not found to update');
      const updated = {
        ...target,
        ...args.data,
        updatedAt: new Date(),
      };
      this.users.set(target.id, updated);
      return { ...updated };
    },

    count: async (args?: { where?: any }) => {
      if (!args?.where) return this.users.size;
      let count = 0;
      for (const u of this.users.values()) {
        if (args.where.role && u.role === args.where.role) count++;
      }
      return count;
    },
  };

  patientProfile = {
    findUnique: async (args: { where: { userId?: string; id?: string; emergencyAccessToken?: string } }) => {
      if (args.where.userId) {
        return this.patientProfiles.get(args.where.userId) || null;
      }
      if (args.where.emergencyAccessToken) {
        for (const p of this.patientProfiles.values()) {
          if (p.emergencyAccessToken && p.emergencyAccessToken === args.where.emergencyAccessToken) {
            return { ...p };
          }
        }
        return null;
      }
      for (const p of this.patientProfiles.values()) {
        if (p.id === args.where.id) return { ...p };
      }
      return null;
    },

    findFirst: async (args?: { where?: any }) => {
      for (const p of this.patientProfiles.values()) {
        if (!args?.where) return { ...p };
        let match = true;
        if (args.where.userId && p.userId !== args.where.userId) match = false;
        if (args.where.emergencyAccessToken && p.emergencyAccessToken !== args.where.emergencyAccessToken) match = false;
        if (match) return { ...p };
      }
      return null;
    },

    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        userId: args.data.userId,
        bloodGroup: args.data.bloodGroup || 'UNKNOWN',
        bloodGroupProvenance: args.data.bloodGroupProvenance || 'PATIENT_REPORTED',
        allergies: args.data.allergies || null,
        allergiesProvenance: args.data.allergiesProvenance || 'PATIENT_REPORTED',
        medicalConditions: args.data.medicalConditions || null,
        medicalConditionsProvenance: args.data.medicalConditionsProvenance || 'PATIENT_REPORTED',
        currentMedications: args.data.currentMedications || null,
        medicationsProvenance: args.data.medicationsProvenance || 'PATIENT_REPORTED',
        emergencyContactName: args.data.emergencyContactName || null,
        emergencyContactPhone: args.data.emergencyContactPhone || null,
        medicalNotes: args.data.medicalNotes || null,
        customAlertMessage: args.data.customAlertMessage || null,
        organDonorStatus: args.data.organDonorStatus || 'NOT_SPECIFIED',
        preferredHospital: args.data.preferredHospital || null,
        consentEmergencySharing: args.data.consentEmergencySharing !== undefined ? args.data.consentEmergencySharing : true,
        emergencyAccessToken: args.data.emergencyAccessToken || crypto.randomUUID(),
        tokenGeneratedAt: args.data.tokenGeneratedAt || new Date(),
        verifiedBy: args.data.verifiedBy || null,
        verifiedAt: args.data.verifiedAt || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.patientProfiles.set(args.data.userId, record);
      return { ...record };
    },

    update: async (args: { where: { userId?: string; id?: string }; data: any }) => {
      const key = args.where.userId || args.where.id;
      let existing = key ? this.patientProfiles.get(key) : null;
      if (!existing && args.where.id) {
        for (const p of this.patientProfiles.values()) {
          if (p.id === args.where.id) {
            existing = p;
            break;
          }
        }
      }
      if (!existing) throw new Error('Patient profile not found to update');
      const updated = {
        ...existing,
        ...args.data,
        updatedAt: new Date(),
      };
      this.patientProfiles.set(existing.userId, updated);
      return { ...updated };
    },

    upsert: async (args: { where: { userId: string }; update: any; create: any }) => {
      const existing = this.patientProfiles.get(args.where.userId);
      if (existing) {
        const updated = {
          ...existing,
          ...args.update,
          updatedAt: new Date(),
        };
        this.patientProfiles.set(args.where.userId, updated);
        return { ...updated };
      } else {
        return this.patientProfile.create({ data: args.create });
      }
    },

    delete: async (args: { where: { userId?: string; id?: string } }) => {
      const key = args.where.userId;
      if (key && this.patientProfiles.has(key)) {
        const deleted = this.patientProfiles.get(key);
        this.patientProfiles.delete(key);
        return deleted;
      }
      for (const [uid, p] of this.patientProfiles.entries()) {
        if (p.id === args.where.id) {
          this.patientProfiles.delete(uid);
          return p;
        }
      }
      return null;
    },
  };

  refreshToken = {
    findUnique: async (args: { where: { tokenHash: string } }) => {
      return this.refreshTokens.get(args.where.tokenHash) || null;
    },

    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        userId: args.data.userId,
        tokenHash: args.data.tokenHash,
        expiresAt: args.data.expiresAt,
        isRevoked: args.data.isRevoked || false,
        replacedBy: args.data.replacedBy || null,
        createdAt: new Date(),
      };
      this.refreshTokens.set(args.data.tokenHash, record);
      return { ...record };
    },

    update: async (args: { where: { tokenHash: string }; data: any }) => {
      const existing = this.refreshTokens.get(args.where.tokenHash);
      if (!existing) return null;
      const updated = { ...existing, ...args.data };
      this.refreshTokens.set(args.where.tokenHash, updated);
      return { ...updated };
    },

    updateMany: async (args: { where: { userId: string }; data: any }) => {
      let count = 0;
      for (const [hash, token] of this.refreshTokens.entries()) {
        if (token.userId === args.where.userId) {
          this.refreshTokens.set(hash, { ...token, ...args.data });
          count++;
        }
      }
      return { count };
    },
  };

  hospitalRegistration = {
    findUnique: async (args: { where: { id?: string; email?: string } }) => {
      if (args.where.id) return this.hospitalRegistrations.get(args.where.id) || null;
      if (args.where.email) {
        for (const reg of this.hospitalRegistrations.values()) {
          if (reg.email === args.where.email) return { ...reg };
        }
      }
      return null;
    },
    findMany: async (args?: { where?: any }) => {
      const results: any[] = [];
      for (const reg of this.hospitalRegistrations.values()) {
        if (!args?.where) {
          results.push({ ...reg });
          continue;
        }
        let match = true;
        if (args.where.status && reg.status !== args.where.status) match = false;
        if (match) results.push({ ...reg });
      }
      return results;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        hospitalName: args.data.hospitalName,
        services: args.data.services,
        contactNumber: args.data.contactNumber,
        address: args.data.address || '',
        email: args.data.email,
        passwordHash: args.data.passwordHash,
        status: args.data.status || 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.hospitalRegistrations.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.hospitalRegistrations.get(args.where.id);
      if (!existing) throw new Error('Registration not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.hospitalRegistrations.set(args.where.id, updated);
      return { ...updated };
    },
  };

  hospital = {
    findUnique: async (args: { where: { id?: string; adminUserId?: string }; include?: any }) => {
      let found: any = null;
      if (args.where.id) found = this.hospitals.get(args.where.id) || null;
      if (!found && args.where.adminUserId) {
        for (const h of this.hospitals.values()) {
          if (h.adminUserId === args.where.adminUserId) {
            found = h;
            break;
          }
        }
      }
      if (!found) return null;
      const clone = { ...found };
      if (args?.include?.doctors) {
        clone.doctors = Array.from(this.doctors.values()).filter((d: any) => d.hospitalId === found.id);
      }
      if (args?.include?.beds) {
        clone.beds = Array.from(this.hospitalBeds.values()).filter((b: any) => b.hospitalId === found.id);
      }
      if (args?.include?.capacityAuditLogs) {
        clone.capacityAuditLogs = Array.from(this.hospitalCapacityAuditLogs.values())
          .filter((log: any) => log.hospitalId === found.id)
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      }
      return clone;
    },
    _matchesHospital: (h: any, where?: any): boolean => {
      if (!where) return true;
      if (where.id && h.id !== where.id) return false;
      if (where.verificationState) {
        if (typeof where.verificationState === 'object') {
          if (where.verificationState.notIn && where.verificationState.notIn.includes(h.verificationState)) return false;
          if (where.verificationState.not && where.verificationState.not === h.verificationState) return false;
        } else if (h.verificationState !== where.verificationState) {
          return false;
        }
      }
      if (where.city) {
        const cityFilter = typeof where.city === 'string' ? where.city : (where.city.equals || where.city.contains);
        if (cityFilter && (!h.city || !h.city.toLowerCase().includes(cityFilter.toLowerCase()))) return false;
      }
      if (where.state) {
        const stateFilter = typeof where.state === 'string' ? where.state : (where.state.equals || where.state.contains);
        if (stateFilter && (!h.state || !h.state.toLowerCase().includes(stateFilter.toLowerCase()))) return false;
      }
      if (where.name) {
        const nameFilter = typeof where.name === 'object' && where.name.contains ? where.name.contains : where.name;
        if (typeof nameFilter === 'string') {
          const q = nameFilter.replace(/\s+/g, ' ').trim().toLowerCase();
          const nameMatch = h.name && h.name.toLowerCase().includes(q);
          const aliasMatch = (Array.isArray(h.aliases) && h.aliases.some((a: string) => a.toLowerCase().includes(q))) ||
            (Array.isArray(h.alternateNames) && h.alternateNames.some((a: string) => a.toLowerCase().includes(q))) ||
            (typeof h.aliases === 'string' && h.aliases.toLowerCase().includes(q));
          if (!nameMatch && !aliasMatch) return false;
        }
      }
      if (where.OR && Array.isArray(where.OR)) {
        const orMatch = where.OR.some((cond: any) => {
          if (cond.id && h.id === cond.id) return true;
          if (cond.name?.contains) {
            const q = cond.name.contains.replace(/\s+/g, ' ').trim().toLowerCase();
            if (h.name && h.name.toLowerCase().includes(q)) return true;
            if (Array.isArray(h.aliases) && h.aliases.some((a: string) => a.toLowerCase().includes(q))) return true;
            if (Array.isArray(h.alternateNames) && h.alternateNames.some((a: string) => a.toLowerCase().includes(q))) return true;
            if (typeof h.aliases === 'string' && h.aliases.toLowerCase().includes(q)) return true;
          }
          if (cond.address?.contains) {
            const q = cond.address.contains.replace(/\s+/g, ' ').trim().toLowerCase();
            if (h.address && h.address.toLowerCase().includes(q)) return true;
          }
          if (cond.locality?.contains) {
            const q = cond.locality.contains.replace(/\s+/g, ' ').trim().toLowerCase();
            if (h.locality && h.locality.toLowerCase().includes(q)) return true;
          }
          return false;
        });
        if (!orMatch) return false;
      }
      return true;
    },
    findFirst: async (args?: { where?: any; include?: any }) => {
      for (const h of this.hospitals.values()) {
        if (!this.hospital._matchesHospital(h, args?.where)) continue;
        return this.hospital.findUnique({ where: { id: h.id }, include: args?.include });
      }
      return null;
    },
    findMany: async (args?: { where?: any; include?: any; skip?: number; take?: number; orderBy?: any }) => {
      let results: any[] = [];
      for (const h of this.hospitals.values()) {
        if (!this.hospital._matchesHospital(h, args?.where)) continue;
        const clone = { ...h };
        if (args?.include?.doctors) {
          clone.doctors = Array.from(this.doctors.values()).filter((d: any) => d.hospitalId === h.id);
        }
        if (args?.include?.beds) {
          clone.beds = Array.from(this.hospitalBeds.values()).filter((b: any) => b.hospitalId === h.id);
        }
        results.push(clone);
      }
      if (args?.orderBy?.name === 'asc') {
        results.sort((a, b) => a.name.localeCompare(b.name));
      }
      const skip = args?.skip || 0;
      const take = args?.take;
      return take !== undefined ? results.slice(skip, skip + take) : results.slice(skip);
    },
    count: async (args?: { where?: any }) => {
      let count = 0;
      for (const h of this.hospitals.values()) {
        if (!this.hospital._matchesHospital(h, args?.where)) continue;
        count++;
      }
      return count;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        city: args.data.city || 'Nagpur',
        state: args.data.state || 'Maharashtra',
        verificationState: args.data.verificationState || 'PENDING_REVIEW',
        availableBeds: args.data.availableBeds ?? 0,
        totalBeds: args.data.totalBeds ?? args.data.availableBeds ?? 0,
        capacityLastUpdated: args.data.capacityLastUpdated || new Date(),
        configuredCategories: args.data.configuredCategories || null,
        isDemo: args.data.isDemo || false,
        createdAt: new Date(),
      };
      this.hospitals.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.hospitals.get(args.where.id);
      if (!existing) throw new Error('Hospital not found');
      const updated = {
        ...existing,
        ...args.data,
        capacityLastUpdated: args.data.capacityLastUpdated || (args.data.availableBeds !== undefined || args.data.totalBeds !== undefined ? new Date() : existing.capacityLastUpdated || new Date()),
      };
      this.hospitals.set(args.where.id, updated);
      return { ...updated };
    },
  };

  ambulance = {
    findUnique: async (args: { where: { id?: string; userId?: string; driverId?: string }; include?: any }) => {
      let found: any = null;
      if (args.where.id) found = this.ambulances.get(args.where.id) || null;
      if (!found) {
        for (const amb of this.ambulances.values()) {
          if (amb.driverId === args.where.driverId || amb.userId === args.where.userId) {
            found = { ...amb };
            break;
          }
        }
      }
      if (!found) return null;
      const clone = { ...found };
      if (args.include?.driver && clone.driverId) {
        const u = this.users.get(clone.driverId) || null;
        if (u) {
          const uClone = { ...u };
          if (args.include.driver?.include?.driverProfile) {
            for (const dp of this.driverProfiles.values()) {
              if (dp.userId === uClone.id) {
                uClone.driverProfile = { ...dp };
                break;
              }
            }
          }
          clone.driver = uClone;
        } else {
          clone.driver = null;
        }
      }
      if (args.include?.hospital && clone.hospitalId) {
        clone.hospital = this.hospitals.get(clone.hospitalId) || null;
      }
      if (args.include?.operator && clone.operatorId) {
        clone.operator = this.ambulanceOperators.get(clone.operatorId) || null;
      }
      if (args.include?.assignments) {
        clone.assignments = [];
        for (const a of this.driverVehicleAssignments.values()) {
          if (a.ambulanceId === clone.id) clone.assignments.push({ ...a });
        }
      }
      return clone;
    },
    findFirst: async (args?: { where?: any; include?: any }) => {
      for (const amb of this.ambulances.values()) {
        if (!args?.where) return this.ambulance.findUnique({ where: { id: amb.id }, include: args?.include });
        let match = true;
        if (args.where.isAvailable !== undefined && amb.isAvailable !== args.where.isAvailable) match = false;
        if (args.where.driverId && amb.driverId !== args.where.driverId) match = false;
        if (args.where.hospitalId && amb.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.operatorId && amb.operatorId !== args.where.operatorId) match = false;
        if (args.where.verificationState && amb.verificationState !== args.where.verificationState) match = false;
        if (args.where.isDemo !== undefined && amb.isDemo !== args.where.isDemo) match = false;
        if (match) return this.ambulance.findUnique({ where: { id: amb.id }, include: args?.include });
      }
      return null;
    },
    findMany: async (args?: { where?: any; include?: any }) => {
      const results: any[] = [];
      for (const amb of this.ambulances.values()) {
        if (!args?.where) {
          results.push(await this.ambulance.findUnique({ where: { id: amb.id }, include: args?.include }));
          continue;
        }
        let match = true;
        if (args.where.isAvailable !== undefined && amb.isAvailable !== args.where.isAvailable) match = false;
        if (args.where.verificationState && amb.verificationState !== args.where.verificationState) match = false;
        if (args.where.verificationStatus && amb.verificationStatus !== args.where.verificationStatus) match = false;
        if (args.where.maintenanceStatus && amb.maintenanceStatus !== args.where.maintenanceStatus) match = false;
        if (args.where.driverId && amb.driverId !== args.where.driverId) match = false;
        if (args.where.hospitalId && amb.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.operatorId && amb.operatorId !== args.where.operatorId) match = false;
        if (args.where.isDemo !== undefined && amb.isDemo !== args.where.isDemo) match = false;
        if (match) {
          results.push(await this.ambulance.findUnique({ where: { id: amb.id }, include: args?.include }));
        }
      }
      return results;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        ambulanceType: args.data.ambulanceType || args.data.type || 'BASIC_LIFE_SUPPORT',
        verificationState: args.data.verificationState || 'PENDING_REVIEW',
        verificationStatus: args.data.verificationStatus || (args.data.verificationState === 'VERIFIED' ? 'APPROVED' : 'PENDING'),
        maintenanceStatus: args.data.maintenanceStatus || 'OPERATIONAL',
        isAvailable: args.data.isAvailable !== undefined ? args.data.isAvailable : false,
        isDemo: args.data.isDemo || false,
        createdAt: new Date(),
        lastUpdated: args.data.lastUpdated !== undefined ? args.data.lastUpdated : new Date(),
      };
      this.ambulances.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id?: string; driverId?: string }; data: any }) => {
      let target: any = null;
      if (args.where.id) target = this.ambulances.get(args.where.id);
      if (!target && args.where.driverId) {
        for (const amb of this.ambulances.values()) {
          if (amb.driverId === args.where.driverId) {
            target = amb;
            break;
          }
        }
      }
      if (!target) throw new Error('Ambulance not found');
      const updated = {
        ...target,
        ...args.data,
        lastUpdated: args.data.lastUpdated !== undefined ? args.data.lastUpdated : new Date(),
        updatedAt: args.data.updatedAt !== undefined ? args.data.updatedAt : new Date(),
      };
      this.ambulances.set(target.id, updated);
      return { ...updated };
    },
    count: async (args?: { where?: any }) => {
      let count = 0;
      for (const amb of this.ambulances.values()) {
        if (!args?.where) { count++; continue; }
        let match = true;
        if (args.where.isAvailable !== undefined && amb.isAvailable !== args.where.isAvailable) match = false;
        if (args.where.verificationState && amb.verificationState !== args.where.verificationState) match = false;
        if (args.where.verificationStatus && amb.verificationStatus !== args.where.verificationStatus) match = false;
        if (args.where.maintenanceStatus && amb.maintenanceStatus !== args.where.maintenanceStatus) match = false;
        if (args.where.driverId && amb.driverId !== args.where.driverId) match = false;
        if (args.where.hospitalId && amb.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.operatorId && amb.operatorId !== args.where.operatorId) match = false;
        if (args.where.isDemo !== undefined && amb.isDemo !== args.where.isDemo) match = false;
        if (match) count++;
      }
      return count;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      for (const [id, amb] of Array.from(this.ambulances.entries())) {
        if (!args?.where) { this.ambulances.delete(id); count++; continue; }
        let match = true;
        if (args.where.isDemo !== undefined && amb.isDemo !== args.where.isDemo) match = false;
        if (match) { this.ambulances.delete(id); count++; }
      }
      return { count };
    },
  };

  ambulanceOperator = {
    findUnique: async (args: { where: { id?: string; adminUserId?: string } }) => {
      if (args.where.id) return this.ambulanceOperators.get(args.where.id) || null;
      if (args.where.adminUserId) {
        for (const op of this.ambulanceOperators.values()) {
          if (op.adminUserId === args.where.adminUserId) return { ...op };
        }
      }
      return null;
    },
    findFirst: async (args?: { where?: any }) => {
      for (const op of this.ambulanceOperators.values()) {
        if (!args?.where) return { ...op };
        let match = true;
        if (args.where.verificationState && op.verificationState !== args.where.verificationState) match = false;
        if (match) return { ...op };
      }
      return null;
    },
    findMany: async (args?: { where?: any; skip?: number; take?: number }) => {
      let results: any[] = [];
      for (const op of this.ambulanceOperators.values()) {
        if (args?.where) {
          if (args.where.verificationState && op.verificationState !== args.where.verificationState) continue;
          if (args.where.city) {
            const cityFilter = typeof args.where.city === 'string' ? args.where.city : (args.where.city.equals || args.where.city.contains);
            if (cityFilter && (!op.city || !op.city.toLowerCase().includes(cityFilter.toLowerCase()))) continue;
          }
          if (args.where.state) {
            const stateFilter = typeof args.where.state === 'string' ? args.where.state : (args.where.state.equals || args.where.state.contains);
            if (stateFilter && (!op.state || !op.state.toLowerCase().includes(stateFilter.toLowerCase()))) continue;
          }
        }
        results.push({ ...op });
      }
      const skip = args?.skip || 0;
      const take = args?.take;
      return take !== undefined ? results.slice(skip, skip + take) : results.slice(skip);
    },
    count: async (args?: { where?: any }) => {
      let count = 0;
      for (const op of this.ambulanceOperators.values()) {
        if (args?.where) {
          if (args.where.verificationState && op.verificationState !== args.where.verificationState) continue;
          if (args.where.city) {
            const cityFilter = typeof args.where.city === 'string' ? args.where.city : (args.where.city.equals || args.where.city.contains);
            if (cityFilter && (!op.city || !op.city.toLowerCase().includes(cityFilter.toLowerCase()))) continue;
          }
          if (args.where.state) {
            const stateFilter = typeof args.where.state === 'string' ? args.where.state : (args.where.state.equals || args.where.state.contains);
            if (stateFilter && (!op.state || !op.state.toLowerCase().includes(stateFilter.toLowerCase()))) continue;
          }
        }
        count++;
      }
      return count;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        city: args.data.city || 'Nagpur',
        state: args.data.state || 'Maharashtra',
        verificationState: args.data.verificationState || 'PENDING_REVIEW',
        isDemo: args.data.isDemo || false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.ambulanceOperators.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.ambulanceOperators.get(args.where.id);
      if (!existing) throw new Error('AmbulanceOperator not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.ambulanceOperators.set(args.where.id, updated);
      return { ...updated };
    },
  };

  driverProfile = {
    findUnique: async (args: { where: { id?: string; userId?: string }; include?: any }) => {
      let found: any = null;
      if (args.where.id) found = this.driverProfiles.get(args.where.id);
      if (!found && args.where.userId) {
        for (const dp of this.driverProfiles.values()) {
          if (dp.userId === args.where.userId) {
            found = dp;
            break;
          }
        }
      }
      if (!found) return null;
      const clone = { ...found };
      if (args.include?.hospital && clone.hospitalId) {
        clone.hospital = this.hospitals.get(clone.hospitalId) || null;
      }
      if (args.include?.operator && clone.operatorId) {
        clone.operator = this.ambulanceOperators.get(clone.operatorId) || null;
      }
      if (args.include?.assignments) {
        clone.assignments = [];
        for (const a of this.driverVehicleAssignments.values()) {
          if (a.driverId === clone.id) {
            const amb = this.ambulances.get(a.ambulanceId);
            clone.assignments.push({ ...a, ambulance: amb ? { ...amb } : null });
          }
        }
      }
      return clone;
    },
    findFirst: async (args?: { where?: any }) => {
      for (const dp of this.driverProfiles.values()) {
        if (!args?.where) return { ...dp };
        let match = true;
        if (args.where.userId && dp.userId !== args.where.userId) match = false;
        if (args.where.licenseNumber && dp.licenseNumber !== args.where.licenseNumber) match = false;
        if (match) return { ...dp };
      }
      return null;
    },
    findMany: async (args?: { where?: any }) => {
      const results: any[] = [];
      for (const dp of this.driverProfiles.values()) {
        if (!args?.where) {
          results.push({ ...dp });
          continue;
        }
        let match = true;
        if (args.where.verificationState && dp.verificationState !== args.where.verificationState) match = false;
        if (args.where.hospitalId && dp.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.operatorId && dp.operatorId !== args.where.operatorId) match = false;
        if (args.where.membershipStatus && dp.membershipStatus !== args.where.membershipStatus) match = false;
        if (args.where.isDemo !== undefined && dp.isDemo !== args.where.isDemo) match = false;
        if (match) results.push({ ...dp });
      }
      return results;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        verificationState: args.data.verificationState || 'PENDING_REVIEW',
        membershipStatus: args.data.membershipStatus || 'PENDING',
        isDispatchEligible: args.data.isDispatchEligible !== undefined ? args.data.isDispatchEligible : false,
        isDemo: args.data.isDemo || false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.driverProfiles.set(id, record);
      return { ...record };
    },
    upsert: async (args: { where: { userId?: string; id?: string }; update: any; create: any }) => {
      let existing: any = null;
      if (args.where.userId) {
        for (const dp of this.driverProfiles.values()) {
          if (dp.userId === args.where.userId) {
            existing = dp;
            break;
          }
        }
      } else if (args.where.id) {
        existing = this.driverProfiles.get(args.where.id);
      }
      if (existing) {
        const updated = { ...existing, ...args.update, updatedAt: new Date() };
        this.driverProfiles.set(existing.id, updated);
        return { ...updated };
      } else {
        return this.driverProfile.create({ data: args.create });
      }
    },
    update: async (args: { where: { id?: string; userId?: string }; data: any }) => {
      let target: any = null;
      if (args.where.id) target = this.driverProfiles.get(args.where.id);
      if (!target && args.where.userId) {
        for (const dp of this.driverProfiles.values()) {
          if (dp.userId === args.where.userId) {
            target = dp;
            break;
          }
        }
      }
      if (!target) throw new Error('DriverProfile not found');
      const updated = { ...target, ...args.data, updatedAt: new Date() };
      this.driverProfiles.set(target.id, updated);
      return { ...updated };
    },
    count: async (args?: { where?: any }) => {
      let count = 0;
      for (const dp of this.driverProfiles.values()) {
        if (!args?.where) { count++; continue; }
        let match = true;
        if (args.where.verificationState && dp.verificationState !== args.where.verificationState) match = false;
        if (args.where.isDispatchEligible !== undefined && dp.isDispatchEligible !== args.where.isDispatchEligible) match = false;
        if (args.where.isDemo !== undefined && dp.isDemo !== args.where.isDemo) match = false;
        if (match) count++;
      }
      return count;
    },
  };

  driverVehicleAssignment = {
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        isCurrent: args.data.isCurrent !== undefined ? args.data.isCurrent : true,
        assignedAt: new Date(),
      };
      this.driverVehicleAssignments.set(id, record);
      return { ...record };
    },
    findFirst: async (args?: { where?: any }) => {
      for (const a of this.driverVehicleAssignments.values()) {
        if (!args?.where) return { ...a };
        let match = true;
        if (args.where.driverId && a.driverId !== args.where.driverId) match = false;
        if (args.where.ambulanceId && a.ambulanceId !== args.where.ambulanceId) match = false;
        if (args.where.isCurrent !== undefined && a.isCurrent !== args.where.isCurrent) match = false;
        if (match) return { ...a };
      }
      return null;
    },
    findMany: async (args?: { where?: any }) => {
      const results: any[] = [];
      for (const a of this.driverVehicleAssignments.values()) {
        if (!args?.where) {
          results.push({ ...a });
          continue;
        }
        let match = true;
        if (args.where.driverId && a.driverId !== args.where.driverId) match = false;
        if (args.where.ambulanceId && a.ambulanceId !== args.where.ambulanceId) match = false;
        if (args.where.isCurrent !== undefined && a.isCurrent !== args.where.isCurrent) match = false;
        if (match) results.push({ ...a });
      }
      return results;
    },
  };

  verificationAuditLog = {
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        isSimulated: args.data.isSimulated || false,
        createdAt: new Date(),
      };
      this.verificationAuditLogs.set(id, record);
      return { ...record };
    },
    findFirst: async (args?: { where?: any }) => {
      for (const log of this.verificationAuditLogs.values()) {
        if (!args?.where) return { ...log };
        let match = true;
        if (args.where.action && log.action !== args.where.action) match = false;
        if (args.where.targetEntityType && log.targetEntityType !== args.where.targetEntityType) match = false;
        if (args.where.targetEntityId && log.targetEntityId !== args.where.targetEntityId) match = false;
        if (match) return { ...log };
      }
      return null;
    },
    findMany: async (args?: { where?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const log of this.verificationAuditLogs.values()) {
        if (!args?.where) {
          results.push({ ...log });
          continue;
        }
        let match = true;
        if (args.where.action && log.action !== args.where.action) match = false;
        if (args.where.targetEntityType && log.targetEntityType !== args.where.targetEntityType) match = false;
        if (args.where.targetEntityId && log.targetEntityId !== args.where.targetEntityId) match = false;
        if (match) results.push({ ...log });
      }
      return results;
    },
    count: async (args?: { where?: any }) => {
      const all = await this.verificationAuditLog.findMany(args);
      return all.length;
    },
  };

  healthMetric = {
    findMany: async (args?: { where?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const m of this.healthMetrics.values()) {
        if (!args?.where || m.patientId === args.where.patientId) {
          results.push({ ...m });
        }
      }
      return results;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = { id, ...args.data, recordedAt: new Date() };
      this.healthMetrics.set(id, record);
      return { ...record };
    },
  };

  serviceArea = {
    findUnique: async (args: { where: { id: string } }) => {
      const area = this.serviceAreas.get(args.where.id);
      return area ? { ...area } : null;
    },
    findFirst: async (args?: { where?: any }) => {
      for (const area of this.serviceAreas.values()) {
        if (!args?.where) return { ...area };
        let match = true;
        if (args.where.id && area.id !== args.where.id) match = false;
        if (args.where.isActive !== undefined && area.isActive !== args.where.isActive) match = false;
        if (args.where.isPilot !== undefined && area.isPilot !== args.where.isPilot) match = false;
        if (args.where.city) {
          const expected = typeof args.where.city === 'object' && args.where.city.equals ? args.where.city.equals : args.where.city;
          if (area.city.toLowerCase() !== String(expected).toLowerCase()) match = false;
        }
        if (args.where.state) {
          const expected = typeof args.where.state === 'object' && args.where.state.equals ? args.where.state.equals : args.where.state;
          if (area.state.toLowerCase() !== String(expected).toLowerCase()) match = false;
        }
        if (match) return { ...area };
      }
      return null;
    },
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      const results: any[] = [];
      for (const area of this.serviceAreas.values()) {
        if (!args?.where) {
          results.push({ ...area });
          continue;
        }
        let match = true;
        if (args.where.id && area.id !== args.where.id) match = false;
        if (args.where.isActive !== undefined && area.isActive !== args.where.isActive) match = false;
        if (args.where.isPilot !== undefined && area.isPilot !== args.where.isPilot) match = false;
        if (args.where.city) {
          const expected = typeof args.where.city === 'object' && args.where.city.equals ? args.where.city.equals : args.where.city;
          if (area.city.toLowerCase() !== String(expected).toLowerCase()) match = false;
        }
        if (args.where.state) {
          const expected = typeof args.where.state === 'object' && args.where.state.equals ? args.where.state.equals : args.where.state;
          if (area.state.toLowerCase() !== String(expected).toLowerCase()) match = false;
        }
        if (args.where.country) {
          const expected = typeof args.where.country === 'object' && args.where.country.equals ? args.where.country.equals : args.where.country;
          if ((area.country || 'India').toLowerCase() !== String(expected).toLowerCase()) match = false;
        }
        if (match) results.push({ ...area });
      }
      if (args?.skip && args?.take) {
        return results.slice(args.skip, args.skip + args.take);
      }
      if (args?.take) {
        return results.slice(0, args.take);
      }
      return results;
    },
    count: async (args?: { where?: any }) => {
      const list = await (inMemoryDb || this).serviceArea.findMany(args);
      return list.length;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.serviceAreas.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.serviceAreas.get(args.where.id);
      if (!existing) throw new Error('ServiceArea not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.serviceAreas.set(args.where.id, updated);
      return { ...updated };
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.serviceAreas.get(args.where.id);
      this.serviceAreas.delete(args.where.id);
      return existing || null;
    },
  };

  emergencyRequest = {
    findUnique: async (args: { where: { id: string }; include?: any }) => {
      const req = this.emergencyRequests.get(args.where.id);
      if (!req) return null;
      const clone = { ...req };
      if (args.include?.patient) {
        const u = this.users.get(clone.patientId);
        clone.patient = u ? { ...u, patientProfile: this.patientProfiles.get(u.id) || null } : null;
      }
      if (args.include?.driver && clone.driverId) {
        const u = this.users.get(clone.driverId);
        let amb = null;
        for (const a of this.ambulances.values()) {
          if (a.driverId === clone.driverId) {
            amb = { ...a };
            break;
          }
        }
        clone.driver = u ? { ...u, ambulance: amb } : null;
      }
      if (args.include?.hospital && clone.hospitalId) {
        clone.hospital = this.hospitals.get(clone.hospitalId) || null;
      }
      if (args.include?.ambulance && clone.ambulanceId) {
        clone.ambulance = this.ambulances.get(clone.ambulanceId) || null;
      }
      if (args.include?.operator && clone.operatorId) {
        clone.operator = this.ambulanceOperators.get(clone.operatorId) || null;
      }
      if (args.include?.dispatchAttempts) {
        clone.dispatchAttempts = [];
        for (const da of this.dispatchAttempts.values()) {
          if (da.requestId === clone.id) clone.dispatchAttempts.push({ ...da });
        }
      }
      if (args.include?.trip) {
        for (const tr of this.emergencyTrips.values()) {
          if (tr.requestId === clone.id) {
            clone.trip = await this.emergencyTrip.findUnique({
              where: { id: tr.id },
              include: args.include.trip?.include || (typeof args.include.trip === 'object' ? args.include.trip : undefined),
            });
            break;
          }
        }
      }
      return clone;
    },
    findFirst: async (args?: { where?: any; include?: any }) => {
      for (const req of this.emergencyRequests.values()) {
        if (!args?.where) return this.emergencyRequest.findUnique({ where: { id: req.id }, include: args?.include });
        let match = true;
        if (args.where.patientId && req.patientId !== args.where.patientId) match = false;
        if (args.where.driverId && req.driverId !== args.where.driverId) match = false;
        if (args.where.hospitalId && req.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.operatorId && req.operatorId !== args.where.operatorId) match = false;
        if (args.where.status) {
          if (typeof args.where.status === 'object') {
            if (args.where.status.notIn && args.where.status.notIn.includes(req.status)) match = false;
            if (args.where.status.in && !args.where.status.in.includes(req.status)) match = false;
          } else if (req.status !== args.where.status) {
            match = false;
          }
        }
        if (match) {
          return this.emergencyRequest.findUnique({ where: { id: req.id }, include: args?.include });
        }
      }
      return null;
    },
    findMany: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const req of this.emergencyRequests.values()) {
        if (!args?.where) {
          const hydrated = await this.emergencyRequest.findUnique({ where: { id: req.id }, include: args?.include });
          results.push(hydrated);
          continue;
        }
        let match = true;
        if (args.where.patientId && req.patientId !== args.where.patientId) match = false;
        if (args.where.driverId && req.driverId !== args.where.driverId) match = false;
        if (args.where.hospitalId && req.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.operatorId && req.operatorId !== args.where.operatorId) match = false;
        if (args.where.isDemo !== undefined && req.isDemo !== args.where.isDemo) match = false;
        if (args.where.status) {
          if (typeof args.where.status === 'object') {
            if (args.where.status.notIn && args.where.status.notIn.includes(req.status)) match = false;
            if (args.where.status.in && !args.where.status.in.includes(req.status)) match = false;
          } else if (req.status !== args.where.status) {
            match = false;
          }
        }
        if (match) {
          const hydrated = await this.emergencyRequest.findUnique({ where: { id: req.id }, include: args?.include });
          results.push(hydrated);
        }
      }
      return results;
    },
    create: async (args: { data: any; include?: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        status: args.data.status || 'REQUESTED',
        tripType: args.data.tripType || 'SOS',
        isDemo: args.data.isDemo || false,
        createdAt: args.data.createdAt || new Date(),
        updatedAt: args.data.updatedAt || new Date(),
      };
      this.emergencyRequests.set(id, record);
      return this.emergencyRequest.findUnique({ where: { id }, include: args.include });
    },
    update: async (args: { where: { id: string }; data: any; include?: any }) => {
      const existing = this.emergencyRequests.get(args.where.id);
      if (!existing) throw new Error('EmergencyRequest not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.emergencyRequests.set(args.where.id, updated);
      return this.emergencyRequest.findUnique({ where: { id: args.where.id }, include: args.include });
    },
    count: async (args?: { where?: any }) => {
      const all = await this.emergencyRequest.findMany(args);
      return all.length;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.emergencyRequests.size;
        this.emergencyRequests.clear();
        return { count };
      }
      for (const [id, req] of Array.from(this.emergencyRequests.entries())) {
        let match = true;
        if (args.where.isDemo !== undefined && req.isDemo !== args.where.isDemo) match = false;
        if (args.where.status && req.status !== args.where.status) match = false;
        if (match) {
          this.emergencyRequests.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  dispatchAttempt = {
    findUnique: async (args: { where: { id: string }; include?: any }) => {
      const att = this.dispatchAttempts.get(args.where.id);
      if (!att) return null;
      const clone = { ...att };
      if (args.include?.request) {
        clone.request = await this.emergencyRequest.findUnique({ where: { id: clone.requestId } });
      }
      if (args.include?.ambulance) {
        const amb = this.ambulances.get(clone.ambulanceId) || null;
        if (amb) {
          const ambClone = { ...amb };
          if (args.include.ambulance.include?.hospital && ambClone.hospitalId) {
            ambClone.hospital = this.hospitals.get(ambClone.hospitalId) || null;
          }
          if (args.include.ambulance.include?.operator && ambClone.operatorId) {
            ambClone.operator = this.ambulanceOperators.get(ambClone.operatorId) || null;
          }
          clone.ambulance = ambClone;
        } else {
          clone.ambulance = null;
        }
      }
      if (args.include?.driver) {
        const drv = this.users.get(clone.driverId) || null;
        if (drv) {
          const drvClone = { ...drv };
          if (args.include.driver.include?.driverProfile) {
            for (const dp of this.driverProfiles.values()) {
              if (dp.userId === drvClone.id) {
                drvClone.driverProfile = { ...dp };
                break;
              }
            }
          }
          clone.driver = drvClone;
        } else {
          clone.driver = null;
        }
      }
      return clone;
    },
    findFirst: async (args?: { where?: any; include?: any }) => {
      for (const att of this.dispatchAttempts.values()) {
        if (!args?.where) return this.dispatchAttempt.findUnique({ where: { id: att.id }, include: args?.include });
        let match = true;
        if (args.where.requestId && att.requestId !== args.where.requestId) match = false;
        if (args.where.driverId && att.driverId !== args.where.driverId) match = false;
        if (args.where.ambulanceId && att.ambulanceId !== args.where.ambulanceId) match = false;
        if (args.where.status && att.status !== args.where.status) match = false;
        if (match) {
          return this.dispatchAttempt.findUnique({ where: { id: att.id }, include: args?.include });
        }
      }
      return null;
    },
    findMany: async (args?: { where?: any; include?: any }) => {
      const results: any[] = [];
      for (const att of this.dispatchAttempts.values()) {
        if (!args?.where) {
          results.push(await this.dispatchAttempt.findUnique({ where: { id: att.id }, include: args?.include }));
          continue;
        }
        let match = true;
        if (args.where.requestId && att.requestId !== args.where.requestId) match = false;
        if (args.where.driverId && att.driverId !== args.where.driverId) match = false;
        if (args.where.status && att.status !== args.where.status) match = false;
        if (match) {
          results.push(await this.dispatchAttempt.findUnique({ where: { id: att.id }, include: args?.include }));
        }
      }
      return results;
    },
    create: async (args: { data: any; include?: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        status: args.data.status || 'OFFERED',
        isStraightLine: args.data.isStraightLine !== undefined ? args.data.isStraightLine : true,
        offeredAt: args.data.offeredAt || new Date(),
        createdAt: args.data.createdAt || new Date(),
        updatedAt: args.data.updatedAt || new Date(),
      };
      this.dispatchAttempts.set(id, record);
      return this.dispatchAttempt.findUnique({ where: { id }, include: args.include });
    },
    update: async (args: { where: { id: string }; data: any; include?: any }) => {
      const existing = this.dispatchAttempts.get(args.where.id);
      if (!existing) throw new Error('DispatchAttempt not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.dispatchAttempts.set(args.where.id, updated);
      return this.dispatchAttempt.findUnique({ where: { id: args.where.id }, include: args.include });
    },
    updateMany: async (args: { where?: any; data: any }) => {
      let count = 0;
      for (const [id, att] of this.dispatchAttempts.entries()) {
        let match = true;
        if (args.where?.requestId && att.requestId !== args.where.requestId) match = false;
        if (args.where?.driverId && att.driverId !== args.where.driverId) match = false;
        if (args.where?.ambulanceId && att.ambulanceId !== args.where.ambulanceId) match = false;
        if (args.where?.status && att.status !== args.where.status) match = false;
        if (match) {
          const updated = { ...att, ...args.data, updatedAt: new Date() };
          this.dispatchAttempts.set(id, updated);
          count++;
        }
      }
      return { count };
    },
    count: async (args?: { where?: any }) => {
      let count = 0;
      for (const att of this.dispatchAttempts.values()) {
        if (!args?.where) { count++; continue; }
        let match = true;
        if (args.where.status && att.status !== args.where.status) match = false;
        if (args.where.requestId && att.requestId !== args.where.requestId) match = false;
        if (args.where.ambulanceId && att.ambulanceId !== args.where.ambulanceId) match = false;
        if (args.where.driverId && att.driverId !== args.where.driverId) match = false;
        if (args.where.isDemo !== undefined && att.isDemo !== args.where.isDemo) match = false;
        if (match) count++;
      }
      return count;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.dispatchAttempts.size;
        this.dispatchAttempts.clear();
        return { count };
      }
      for (const [id, att] of Array.from(this.dispatchAttempts.entries())) {
        let match = true;
        if (args.where.isDemo !== undefined && att.isDemo !== args.where.isDemo) match = false;
        if (args.where.requestId && att.requestId !== args.where.requestId) match = false;
        if (args.where.status && att.status !== args.where.status) match = false;
        if (match) {
          this.dispatchAttempts.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  emergencyTrip = {
    findUnique: async (args: { where: { id?: string; requestId?: string }; include?: any }) => {
      let found: any = null;
      if (args.where.id) found = this.emergencyTrips.get(args.where.id);
      if (!found && args.where.requestId) {
        for (const t of this.emergencyTrips.values()) {
          if (t.requestId === args.where.requestId) {
            found = t;
            break;
          }
        }
      }
      if (!found) return null;
      const clone = { ...found };
      if (args.include?.request) {
        clone.request = await this.emergencyRequest.findUnique({ where: { id: clone.requestId } });
      }
      if (args.include?.ambulance) {
        clone.ambulance = this.ambulances.get(clone.ambulanceId) || null;
      }
      if (args.include?.driver) {
        clone.driver = this.users.get(clone.driverId) || null;
      }
      if (args.include?.hospital && clone.hospitalId) {
        clone.hospital = this.hospitals.get(clone.hospitalId) || null;
      }
      if (args.include?.operator && clone.operatorId) {
        clone.operator = this.ambulanceOperators.get(clone.operatorId) || null;
      }
      if (args.include?.events) {
        clone.events = [];
        for (const ev of this.emergencyEvents.values()) {
          if (ev.tripId === clone.id) clone.events.push({ ...ev });
        }
      }
      return clone;
    },
    findFirst: async (args?: { where?: any; include?: any }) => {
      for (const t of this.emergencyTrips.values()) {
        if (!args?.where) return this.emergencyTrip.findUnique({ where: { id: t.id }, include: args?.include });
        let match = true;
        if (args.where.requestId && t.requestId !== args.where.requestId) match = false;
        if (args.where.driverId && t.driverId !== args.where.driverId) match = false;
        if (args.where.ambulanceId && t.ambulanceId !== args.where.ambulanceId) match = false;
        if (args.where.status) {
          if (typeof args.where.status === 'object') {
            if (args.where.status.notIn && args.where.status.notIn.includes(t.status)) match = false;
            if (args.where.status.in && !args.where.status.in.includes(t.status)) match = false;
          } else if (t.status !== args.where.status) {
            match = false;
          }
        }
        if (match) return this.emergencyTrip.findUnique({ where: { id: t.id }, include: args?.include });
      }
      return null;
    },
    findMany: async (args?: { where?: any; include?: any }) => {
      const results: any[] = [];
      for (const t of this.emergencyTrips.values()) {
        if (!args?.where) {
          results.push(await this.emergencyTrip.findUnique({ where: { id: t.id }, include: args?.include }));
          continue;
        }
        let match = true;
        if (args.where.driverId && t.driverId !== args.where.driverId) match = false;
        if (args.where.ambulanceId && t.ambulanceId !== args.where.ambulanceId) match = false;
        if (args.where.hospitalId && t.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.operatorId && t.operatorId !== args.where.operatorId) match = false;
        if (args.where.status && t.status !== args.where.status) match = false;
        if (match) results.push(await this.emergencyTrip.findUnique({ where: { id: t.id }, include: args?.include }));
      }
      return results;
    },
    create: async (args: { data: any; include?: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        status: args.data.status || 'ACCEPTED',
        startedAt: args.data.startedAt || new Date(),
        createdAt: args.data.createdAt || new Date(),
        updatedAt: args.data.updatedAt || new Date(),
      };
      this.emergencyTrips.set(id, record);
      return this.emergencyTrip.findUnique({ where: { id }, include: args.include });
    },
    update: async (args: { where: { id?: string; requestId?: string }; data: any; include?: any }) => {
      let target: any = null;
      if (args.where.id) target = this.emergencyTrips.get(args.where.id);
      if (!target && args.where.requestId) {
        for (const t of this.emergencyTrips.values()) {
          if (t.requestId === args.where.requestId) {
            target = t;
            break;
          }
        }
      }
      if (!target) throw new Error('EmergencyTrip not found');
      const updated = { ...target, ...args.data, updatedAt: new Date() };
      this.emergencyTrips.set(target.id, updated);
      return this.emergencyTrip.findUnique({ where: { id: target.id }, include: args.include });
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.emergencyTrips.size;
        this.emergencyTrips.clear();
        return { count };
      }
      for (const [id, tr] of Array.from(this.emergencyTrips.entries())) {
        let match = true;
        if (args.where.isDemo !== undefined && tr.isDemo !== args.where.isDemo) match = false;
        if (match) {
          this.emergencyTrips.delete(id);
          count++;
        }
      }
      return { count };
    },
    count: async (args?: { where?: any }) => {
      const all = await this.emergencyTrip.findMany(args);
      return all.length;
    },
  };

  trip = this.emergencyTrip;

  emergencyEvent = {
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        timestamp: new Date(),
      };
      this.emergencyEvents.set(id, record);
      return { ...record };
    },
    findMany: async (args?: { where?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const ev of this.emergencyEvents.values()) {
        if (!args?.where) {
          results.push({ ...ev });
          continue;
        }
        let match = true;
        if (args.where.requestId && ev.requestId !== args.where.requestId) match = false;
        if (args.where.tripId && ev.tripId !== args.where.tripId) match = false;
        if (args.where.eventType && ev.eventType !== args.where.eventType) match = false;
        if (match) results.push({ ...ev });
      }
      return results;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.emergencyEvents.size;
        this.emergencyEvents.clear();
        return { count };
      }
      for (const [id, ev] of Array.from(this.emergencyEvents.entries())) {
        let match = true;
        if (args.where.isDemo !== undefined && ev.isDemo !== args.where.isDemo) match = false;
        if (match) {
          this.emergencyEvents.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  doctor = {
    _matchesDoctor: (d: any, where?: any): boolean => {
      if (!where) return true;
      if (where.id && d.id !== where.id) return false;
      if (where.hospitalId) {
        let targetIds: string[] = [];
        if (typeof where.hospitalId === 'string') {
          targetIds = [where.hospitalId];
        } else if (where.hospitalId && typeof where.hospitalId === 'object' && Array.isArray(where.hospitalId.in)) {
          targetIds = where.hospitalId.in;
        }

        const directMatch = targetIds.includes(d.hospitalId);
        const isGmchMatch = targetIds.some((tid) => tid === 'fac-gmch-nagpur' || tid === 'hosp-gmch-nagpur') &&
          (d.hospitalId === 'fac-gmch-nagpur' || d.hospitalId === 'hosp-gmch-nagpur');
        const isMayoMatch = targetIds.some((tid) => tid === 'fac-iggmc-mayo-nagpur' || tid === 'hosp-mayo-nagpur') &&
          (d.hospitalId === 'fac-iggmc-mayo-nagpur' || d.hospitalId === 'hosp-mayo-nagpur');
        const hasAffiliation = Array.from(this.hospitalDoctors.values()).some((a: any) =>
          a.doctorId === d.id && (
            targetIds.includes(a.hospitalId) ||
            (targetIds.some((tid) => tid === 'fac-gmch-nagpur') && a.hospitalId === 'hosp-gmch-nagpur') ||
            (targetIds.some((tid) => tid === 'hosp-gmch-nagpur') && a.hospitalId === 'fac-gmch-nagpur') ||
            (targetIds.some((tid) => tid === 'fac-iggmc-mayo-nagpur') && a.hospitalId === 'hosp-mayo-nagpur') ||
            (targetIds.some((tid) => tid === 'hosp-mayo-nagpur') && a.hospitalId === 'fac-iggmc-mayo-nagpur')
          )
        );

        if (!directMatch && !isGmchMatch && !isMayoMatch && !hasAffiliation) return false;
      }
      if (where.isActive !== undefined && d.isActive !== where.isActive) return false;
      if (where.bookingEnabled !== undefined && d.bookingEnabled !== where.bookingEnabled) return false;
      if (where.verificationStatus && d.verificationStatus !== where.verificationStatus) return false;

      if (where.specialization) {
        const specQuery = typeof where.specialization === 'object' && where.specialization.contains
          ? String(where.specialization.contains).toLowerCase().trim()
          : String(where.specialization).toLowerCase().trim();
        const docSpec = String(d.specialization || '').toLowerCase();
        const docDesig = String(d.designation || '').toLowerCase();
        const docSpecsList = Array.isArray(d.specialtiesList)
          ? d.specialtiesList.map((s: string) => String(s).toLowerCase())
          : [];
        const specMatches = docSpec.includes(specQuery) ||
          docDesig.includes(specQuery) ||
          docSpecsList.some((s: string) => s.includes(specQuery));
        if (!specMatches) return false;
      }

      if (where.name) {
        const nameQuery = typeof where.name === 'object' && where.name.contains
          ? String(where.name.contains).toLowerCase().trim()
          : String(where.name).toLowerCase().trim();
        if (!d.name || !d.name.toLowerCase().includes(nameQuery)) return false;
      }

      if (where.OR && Array.isArray(where.OR)) {
        const orMatches = where.OR.some((cond: any) => {
          if (cond.name?.contains && d.name?.toLowerCase().includes(cond.name.contains.toLowerCase().trim())) return true;
          if (cond.specialization?.contains && d.specialization?.toLowerCase().includes(cond.specialization.contains.toLowerCase().trim())) return true;
          if (cond.designation?.contains && d.designation?.toLowerCase().includes(cond.designation.contains.toLowerCase().trim())) return true;
          if (cond.qualifications?.contains && d.qualifications?.toLowerCase().includes(cond.qualifications.contains.toLowerCase().trim())) return true;
          return false;
        });
        if (!orMatches) return false;
      }

      return true;
    },
    findFirst: async (args?: { where?: any; include?: any }) => {
      for (const d of this.doctors.values()) {
        if (!this.doctor._matchesDoctor(d, args?.where)) continue;
        return this.doctor.findUnique({ where: { id: d.id }, include: args?.include });
      }
      return null;
    },
    findMany: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const d of this.doctors.values()) {
        if (!this.doctor._matchesDoctor(d, args?.where)) continue;
        results.push(await this.doctor.findUnique({ where: { id: d.id }, include: args?.include }));
      }
      if (args?.orderBy?.name === 'asc') {
        results.sort((a, b) => a.name.localeCompare(b.name));
      }
      return results;
    },
    findUnique: async (args: { where: { id: string }; include?: any }) => {
      const d = this.doctors.get(args.where.id);
      if (!d) return null;
      const clone = { ...d };
      if (args.include?.hospital && clone.hospitalId) {
        clone.hospital = this.hospitals.get(clone.hospitalId) || this.directoryFacilities.get(clone.hospitalId) || null;
      }
      if (args.include?.affiliations) {
        clone.affiliations = Array.from(this.hospitalDoctors.values()).filter((a: any) => a.doctorId === d.id);
      }
      return clone;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        unavailableDates: args.data.unavailableDates || [],
        defaultSlotDuration: args.data.defaultSlotDuration !== undefined ? args.data.defaultSlotDuration : 15,
        isActive: args.data.isActive !== undefined ? args.data.isActive : true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.doctors.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.doctors.get(args.where.id);
      if (!existing) throw new Error('Doctor not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.doctors.set(args.where.id, updated);
      return { ...updated };
    },
    count: async (args?: { where?: any }) => {
      const all = await this.doctor.findMany(args);
      return all.length;
    },
  };

  hospitalDoctor = {
    findMany: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      let results = Array.from(this.hospitalDoctors.values());
      if (args?.where) {
        if (args.where.hospitalId) {
          if (typeof args.where.hospitalId === 'string') {
            results = results.filter((a) => a.hospitalId === args.where.hospitalId);
          } else if (args.where.hospitalId && Array.isArray(args.where.hospitalId.in)) {
            results = results.filter((a) => args.where.hospitalId.in.includes(a.hospitalId));
          }
        }
        if (args.where.doctorId) {
          results = results.filter((a) => a.doctorId === args.where.doctorId);
        }
        if (args.where.affiliationStatus) {
          results = results.filter((a) => a.affiliationStatus === args.where.affiliationStatus);
        }
      }
      if (args?.include?.doctor) {
        results = results.map((a) => ({
          ...a,
          doctor: this.doctors.get(a.doctorId) || null,
        }));
      }
      return results;
    },
    findUnique: async (args: { where: any; include?: any }) => {
      let found: any = null;
      if (args.where.id) {
        found = this.hospitalDoctors.get(args.where.id);
      } else if (args.where.hospitalId_doctorId) {
        const { hospitalId, doctorId } = args.where.hospitalId_doctorId;
        for (const a of this.hospitalDoctors.values()) {
          if (a.hospitalId === hospitalId && a.doctorId === doctorId) {
            found = a;
            break;
          }
        }
      }
      if (!found) return null;
      const clone = { ...found };
      if (args.include?.doctor) {
        clone.doctor = this.doctors.get(clone.doctorId) || null;
      }
      return clone;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || `hd-${crypto.randomUUID()}`;
      const record = {
        id,
        ...args.data,
        affiliationStatus: args.data.affiliationStatus || 'AFFILIATED',
        affiliationSource: args.data.affiliationSource || 'OFFICIAL_HOSPITAL_DIRECTORY',
        lastVerifiedAt: args.data.lastVerifiedAt || new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.hospitalDoctors.set(id, record);
      return { ...record };
    },
    upsert: async (args: { where: any; create: any; update: any }) => {
      const existing = await this.hospitalDoctor.findUnique({ where: args.where });
      if (existing) {
        const updated = { ...existing, ...args.update, updatedAt: new Date() };
        this.hospitalDoctors.set(existing.id, updated);
        return { ...updated };
      }
      return this.hospitalDoctor.create({ data: args.create });
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.hospitalDoctors.get(args.where.id);
      if (existing) this.hospitalDoctors.delete(args.where.id);
      return existing;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      for (const [id, a] of Array.from(this.hospitalDoctors.entries())) {
        if (args?.where?.doctorId && a.doctorId !== args.where.doctorId) continue;
        if (args?.where?.hospitalId && a.hospitalId !== args.where.hospitalId) continue;
        this.hospitalDoctors.delete(id);
        count++;
      }
      return { count };
    },
    count: async (args?: { where?: any }) => {
      const res = await this.hospitalDoctor.findMany(args);
      return res.length;
    },
  };

  doctorSlot = {
    findMany: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const s of this.doctorSlots.values()) {
        if (!args?.where) {
          results.push(await this.doctorSlot.findUnique({ where: { id: s.id }, include: args?.include }));
          continue;
        }
        let match = true;
        if (args.where.doctorId && s.doctorId !== args.where.doctorId) match = false;
        if (args.where.date && s.date !== args.where.date) match = false;
        if (args.where.isBlocked !== undefined && s.isBlocked !== args.where.isBlocked) match = false;
        if (args.where.doctor?.hospitalId) {
          const doc = this.doctors.get(s.doctorId);
          if (!doc || doc.hospitalId !== args.where.doctor.hospitalId) match = false;
        }
        if (match) results.push(await this.doctorSlot.findUnique({ where: { id: s.id }, include: args?.include }));
      }
      return results;
    },
    findUnique: async (args: { where: { id?: string; doctorId_date_startTime?: { doctorId: string; date: string; startTime: string } }; include?: any }) => {
      let s: any = null;
      if (args.where.id) s = this.doctorSlots.get(args.where.id);
      if (!s && args.where.doctorId_date_startTime) {
        const { doctorId, date, startTime } = args.where.doctorId_date_startTime;
        for (const slot of this.doctorSlots.values()) {
          if (slot.doctorId === doctorId && slot.date === date && slot.startTime === startTime) {
            s = slot;
            break;
          }
        }
      }
      if (!s) return null;
      const clone = { ...s };
      if (args.include?.doctor) {
        const doc = this.doctors.get(clone.doctorId);
        if (doc) {
          const docClone = { ...doc };
          if (args.include.doctor.include?.hospital) {
            docClone.hospital = this.hospitals.get(docClone.hospitalId) || null;
          }
          clone.doctor = docClone;
        } else {
          clone.doctor = null;
        }
      }
      if (args.include?.appointments) {
        clone.appointments = [];
        for (const apt of this.appointments.values()) {
          if (apt.slotId === clone.id) {
            const hydrated = await this.appointment.findUnique({
              where: { id: apt.id },
              include: args.include.appointments.include,
            });
            if (hydrated) clone.appointments.push(hydrated);
          }
        }
      }
      return clone;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        bookedCount: args.data.bookedCount || 0,
        maxPatients: args.data.maxPatients || 5,
        slotDurationMinutes: args.data.slotDurationMinutes || 15,
        isBlocked: args.data.isBlocked !== undefined ? Boolean(args.data.isBlocked) : false,
        blockedReason: args.data.blockedReason || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.doctorSlots.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.doctorSlots.get(args.where.id);
      if (!existing) throw new Error('Slot not found');
      let newBookedCount = existing.bookedCount;
      if (args.data.bookedCount && typeof args.data.bookedCount === 'object') {
        if (args.data.bookedCount.increment !== undefined) {
          newBookedCount += args.data.bookedCount.increment;
        } else if (args.data.bookedCount.decrement !== undefined) {
          newBookedCount -= args.data.bookedCount.decrement;
        }
      } else if (args.data.bookedCount !== undefined) {
        newBookedCount = args.data.bookedCount;
      }
      const updated = {
        ...existing,
        ...args.data,
        bookedCount: Math.max(0, newBookedCount),
        updatedAt: new Date(),
      };
      this.doctorSlots.set(args.where.id, updated);
      return { ...updated };
    },
    updateMany: async (args: { where: { id: string; bookedCount?: any; isBlocked?: boolean }; data: any }) => {
      const s = this.doctorSlots.get(args.where.id);
      if (!s) return { count: 0 };
      if (s.isBlocked) {
        return { count: 0 };
      }
      if (args.where.bookedCount && args.where.bookedCount.lt !== undefined) {
        if (s.bookedCount >= args.where.bookedCount.lt) {
          return { count: 0 };
        }
      }
      let newBookedCount = s.bookedCount;
      if (args.data.bookedCount && typeof args.data.bookedCount === 'object') {
        if (args.data.bookedCount.increment !== undefined) {
          newBookedCount += args.data.bookedCount.increment;
        } else if (args.data.bookedCount.decrement !== undefined) {
          newBookedCount -= args.data.bookedCount.decrement;
        }
      } else if (args.data.bookedCount !== undefined) {
        newBookedCount = args.data.bookedCount;
      }
      const updated = { ...s, ...args.data, bookedCount: Math.max(0, newBookedCount), updatedAt: new Date() };
      this.doctorSlots.set(s.id, updated);
      return { count: 1 };
    },
    delete: async (args: { where: { id: string } }) => {
      const s = this.doctorSlots.get(args.where.id);
      this.doctorSlots.delete(args.where.id);
      return s || null;
    },
    count: async (args?: { where?: any }) => {
      const all = await this.doctorSlot.findMany(args);
      return all.length;
    },
  };

  appointment = {
    findMany: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const a of this.appointments.values()) {
        if (!args?.where) {
          results.push(await this.appointment.findUnique({ where: { id: a.id }, include: args?.include }));
          continue;
        }
        let match = true;
        if (args.where.patientId && a.patientId !== args.where.patientId) match = false;
        if (args.where.hospitalId && a.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.doctorId && a.doctorId !== args.where.doctorId) match = false;
        if (args.where.slotId && a.slotId !== args.where.slotId) match = false;
        if (args.where.status) {
          if (typeof args.where.status === 'object') {
            if (args.where.status.in && !args.where.status.in.includes(a.status)) match = false;
            if (args.where.status.notIn && args.where.status.notIn.includes(a.status)) match = false;
            if (args.where.status.not && args.where.status.not === a.status) match = false;
          } else if (a.status !== args.where.status) {
            match = false;
          }
        }
        if (args.where.slot?.date) {
          const slot = this.doctorSlots.get(a.slotId);
          if (!slot || slot.date !== args.where.slot.date) match = false;
        }
        if (match) results.push(await this.appointment.findUnique({ where: { id: a.id }, include: args?.include }));
      }
      if (Array.isArray(args?.orderBy)) {
        if (args.orderBy.some((o: any) => o.tokenNumber === 'asc')) {
          results.sort((x, y) => x.tokenNumber - y.tokenNumber);
        }
      } else if (args?.orderBy?.createdAt === 'desc') {
        results.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
      }
      return results;
    },
    findFirst: async (args?: { where?: any; include?: any }) => {
      for (const a of this.appointments.values()) {
        if (!args?.where) return this.appointment.findUnique({ where: { id: a.id }, include: args?.include });
        let match = true;
        if (args.where.slotId && a.slotId !== args.where.slotId) match = false;
        if (args.where.patientId && a.patientId !== args.where.patientId) match = false;
        if (args.where.doctorId && a.doctorId !== args.where.doctorId) match = false;
        if (args.where.hospitalId && a.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.status) {
          if (typeof args.where.status === 'object') {
            if (args.where.status.in && !args.where.status.in.includes(a.status)) match = false;
            if (args.where.status.notIn && args.where.status.notIn.includes(a.status)) match = false;
          } else if (a.status !== args.where.status) {
            match = false;
          }
        }
        if (match) return this.appointment.findUnique({ where: { id: a.id }, include: args?.include });
      }
      return null;
    },
    findUnique: async (args: { where: { id?: string; slotId_tokenNumber?: { slotId: string; tokenNumber: number } }; include?: any }) => {
      let a: any = null;
      if (args.where.id) a = this.appointments.get(args.where.id);
      if (!a && args.where.slotId_tokenNumber) {
        for (const appt of this.appointments.values()) {
          if (appt.slotId === args.where.slotId_tokenNumber.slotId && appt.tokenNumber === args.where.slotId_tokenNumber.tokenNumber) {
            a = appt;
            break;
          }
        }
      }
      if (!a) return null;
      const clone = { ...a };
      if (args.include?.doctor && clone.doctorId) {
        clone.doctor = this.doctors.get(clone.doctorId) || null;
      }
      if (args.include?.slot && clone.slotId) {
        clone.slot = await this.doctorSlot.findUnique({ where: { id: clone.slotId } });
      }
      if (args.include?.hospital && clone.hospitalId) {
        clone.hospital = this.hospitals.get(clone.hospitalId) || null;
      }
      if (args.include?.patient && clone.patientId) {
        const u = this.users.get(clone.patientId);
        clone.patient = u ? { ...u, patientProfile: this.patientProfiles.get(u.id) || null } : null;
      }
      if (args.include?.auditLogs) {
        clone.auditLogs = [];
        for (const log of this.appointmentAuditLogs.values()) {
          if (log.appointmentId === clone.id) clone.auditLogs.push({ ...log });
        }
      }
      return clone;
    },
    create: async (args: { data: any; include?: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        status: args.data.status || 'BOOKED',
        rescheduledFromSlotId: args.data.rescheduledFromSlotId || null,
        rescheduledAt: args.data.rescheduledAt || null,
        cancellationReason: args.data.cancellationReason || null,
        confirmedAt: args.data.confirmedAt || null,
        checkedInAt: args.data.checkedInAt || null,
        completedAt: args.data.completedAt || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.appointments.set(id, record);
      return this.appointment.findUnique({ where: { id }, include: args.include });
    },
    update: async (args: { where: { id: string }; data: any; include?: any }) => {
      const existing = this.appointments.get(args.where.id);
      if (!existing) throw new Error('Appointment not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.appointments.set(args.where.id, updated);
      return this.appointment.findUnique({ where: { id: args.where.id }, include: args.include });
    },
    count: async (args?: { where?: any }) => {
      if (!args?.where) return this.appointments.size;
      let count = 0;
      for (const a of this.appointments.values()) {
        let match = true;
        if (args.where.slotId && a.slotId !== args.where.slotId) match = false;
        if (args.where.hospitalId && a.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.doctorId && a.doctorId !== args.where.doctorId) match = false;
        if (args.where.patientId && a.patientId !== args.where.patientId) match = false;
        if (args.where.status) {
          if (typeof args.where.status === 'object') {
            if (args.where.status.in && !args.where.status.in.includes(a.status)) match = false;
            if (args.where.status.notIn && args.where.status.notIn.includes(a.status)) match = false;
          } else if (a.status !== args.where.status) {
            match = false;
          }
        }
        if (match) count++;
      }
      return count;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.appointments.size;
        this.appointments.clear();
        return { count };
      }
      for (const [id, appt] of Array.from(this.appointments.entries())) {
        let match = true;
        if (args.where.isDemo !== undefined && appt.isDemo !== args.where.isDemo) match = false;
        if (match) {
          this.appointments.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  appointmentAuditLog = {
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        appointmentId: args.data.appointmentId,
        hospitalId: args.data.hospitalId,
        doctorId: args.data.doctorId || null,
        patientId: args.data.patientId || null,
        action: args.data.action,
        previousStatus: args.data.previousStatus || null,
        newStatus: args.data.newStatus || null,
        actorId: args.data.actorId || null,
        actorRole: args.data.actorRole || 'SYSTEM',
        actorName: args.data.actorName || null,
        reason: args.data.reason || null,
        metadata: args.data.metadata || null,
        timestamp: new Date(),
      };
      this.appointmentAuditLogs.set(id, record);
      return { ...record };
    },
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      const results: any[] = [];
      for (const log of this.appointmentAuditLogs.values()) {
        if (!args?.where) {
          results.push({ ...log });
          continue;
        }
        let match = true;
        if (args.where.appointmentId && log.appointmentId !== args.where.appointmentId) match = false;
        if (args.where.hospitalId && log.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.doctorId && log.doctorId !== args.where.doctorId) match = false;
        if (args.where.patientId && log.patientId !== args.where.patientId) match = false;
        if (args.where.action && log.action !== args.where.action) match = false;
        if (match) results.push({ ...log });
      }
      results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },
    count: async (args?: { where?: any }) => {
      const list = await this.appointmentAuditLog.findMany(args);
      return list.length;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.appointmentAuditLogs.size;
        this.appointmentAuditLogs.clear();
        return { count };
      }
      for (const [id, log] of Array.from(this.appointmentAuditLogs.entries())) {
        let match = true;
        if (args.where.appointmentId && log.appointmentId !== args.where.appointmentId) match = false;
        if (args.where.hospitalId && log.hospitalId !== args.where.hospitalId) match = false;
        if (match) {
          this.appointmentAuditLogs.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  hospitalBed = {
    findMany: async (args?: { where?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const b of this.hospitalBeds.values()) {
        if (!args?.where) {
          results.push({ ...b });
          continue;
        }
        let match = true;
        if (args.where.hospitalId && b.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.status && b.status !== args.where.status) match = false;
        if (args.where.ward && b.ward !== args.where.ward) match = false;
        if (args.where.category && b.category !== args.where.category) match = false;
        if (match) results.push({ ...b });
      }
      return results;
    },
    findFirst: async (args?: { where?: any }) => {
      for (const b of this.hospitalBeds.values()) {
        if (!args?.where) return { ...b };
        let match = true;
        if (args.where.hospitalId && b.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.bedNumber && b.bedNumber !== args.where.bedNumber) match = false;
        if (args.where.ward && b.ward !== args.where.ward) match = false;
        if (args.where.category && b.category !== args.where.category) match = false;
        if (args.where.status && b.status !== args.where.status) match = false;
        if (match) return { ...b };
      }
      return null;
    },
    findUnique: async (args: { where: { id: string } }) => {
      const b = this.hospitalBeds.get(args.where.id);
      return b ? { ...b } : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const defaultCategory = args.data.category || (
        args.data.ward === 'ICU' ? 'ICU' :
        args.data.ward === 'EMERGENCY_ER' || args.data.ward === 'TRAUMA' ? 'EMERGENCY' :
        args.data.ward === 'PEDIATRIC' ? 'PEDIATRIC' : 'GENERAL'
      );
      const record = {
        id,
        ...args.data,
        category: defaultCategory,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.hospitalBeds.set(id, record);
      return { ...record };
    },
    createMany: async (args: { data: any[] }) => {
      for (const item of args.data) {
        const id = item.id || crypto.randomUUID();
        const defaultCategory = item.category || (
          item.ward === 'ICU' ? 'ICU' :
          item.ward === 'EMERGENCY_ER' || item.ward === 'TRAUMA' ? 'EMERGENCY' :
          item.ward === 'PEDIATRIC' ? 'PEDIATRIC' : 'GENERAL'
        );
        this.hospitalBeds.set(id, {
          id,
          ...item,
          category: defaultCategory,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return { count: args.data.length };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.hospitalBeds.get(args.where.id);
      if (!existing) throw new Error('Bed not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.hospitalBeds.set(args.where.id, updated);
      return { ...updated };
    },
    count: async (args?: { where?: any }) => {
      if (!args?.where) return this.hospitalBeds.size;
      let count = 0;
      for (const b of this.hospitalBeds.values()) {
        let match = true;
        if (args.where.hospitalId && b.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.status && b.status !== args.where.status) match = false;
        if (args.where.category && b.category !== args.where.category) match = false;
        if (args.where.ward && b.ward !== args.where.ward) match = false;
        if (match) count++;
      }
      return count;
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.hospitalBeds.get(args.where.id);
      if (!existing) throw new Error('Bed not found');
      this.hospitalBeds.delete(args.where.id);
      return { ...existing };
    },
  };

  hospitalCapacityAuditLog = {
    create: async (args: { data: any; include?: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        timestamp: args.data.timestamp || new Date(),
      };
      this.hospitalCapacityAuditLogs.set(id, record);
      return { ...record };
    },
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      let results: any[] = [];
      for (const log of this.hospitalCapacityAuditLogs.values()) {
        if (args?.where) {
          if (args.where.hospitalId && log.hospitalId !== args.where.hospitalId) continue;
          if (args.where.action && log.action !== args.where.action) continue;
          if (args.where.category && log.category !== args.where.category) continue;
          if (args.where.changedById && log.changedById !== args.where.changedById) continue;
        }
        results.push({ ...log });
      }
      results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },
    findFirst: async (args?: { where?: any }) => {
      const matching = await this.hospitalCapacityAuditLog.findMany(args);
      return matching.length > 0 ? matching[0] : null;
    },
    count: async (args?: { where?: any }) => {
      const matching = await this.hospitalCapacityAuditLog.findMany(args);
      return matching.length;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.hospitalCapacityAuditLogs.size;
        this.hospitalCapacityAuditLogs.clear();
        return { count };
      }
      for (const [id, log] of Array.from(this.hospitalCapacityAuditLogs.entries())) {
        if (args.where.hospitalId && log.hospitalId === args.where.hospitalId) {
          this.hospitalCapacityAuditLogs.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  hospitalBooking = {
    findMany: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const bk of this.hospitalBookings.values()) {
        if (!args?.where) {
          results.push({ ...bk });
          continue;
        }
        let match = true;
        if (args.where.hospitalId && bk.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.patientId && bk.patientId !== args.where.patientId) match = false;
        if (match) {
          const clone = { ...bk };
          if (args.include?.hospital && clone.hospitalId) {
            clone.hospital = this.hospitals.get(clone.hospitalId) || null;
          }
          if (args.include?.assignedBed && clone.assignedBedId) {
            clone.assignedBed = this.hospitalBeds.get(clone.assignedBedId) || null;
          }
          results.push(clone);
        }
      }
      return results;
    },
    findUnique: async (args: { where: { id: string } }) => {
      const bk = this.hospitalBookings.get(args.where.id);
      return bk ? { ...bk } : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = { id, ...args.data, createdAt: new Date(), updatedAt: new Date() };
      this.hospitalBookings.set(id, record);
      return { ...record };
    },
    createMany: async (args: { data: any[] }) => {
      for (const item of args.data) {
        const id = item.id || crypto.randomUUID();
        this.hospitalBookings.set(id, { id, ...item, createdAt: new Date(), updatedAt: new Date() });
      }
      return { count: args.data.length };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.hospitalBookings.get(args.where.id);
      if (!existing) throw new Error('Booking not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.hospitalBookings.set(args.where.id, updated);
      return { ...updated };
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.hospitalBookings.get(args.where.id);
      if (existing) {
        this.hospitalBookings.delete(args.where.id);
      }
      return existing || null;
    },
    count: async (args?: { where?: any }) => {
      if (!args?.where) return this.hospitalBookings.size;
      let count = 0;
      for (const bk of this.hospitalBookings.values()) {
        let match = true;
        if (args.where.hospitalId && bk.hospitalId !== args.where.hospitalId) match = false;
        if (match) count++;
      }
      return count;
    },
  };

  queueEntry = {
    findMany: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const results: any[] = [];
      for (const q of this.queueEntries.values()) {
        if (!args?.where) {
          results.push({ ...q });
          continue;
        }
        let match = true;
        if (args.where.hospitalId && q.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.patientId && q.patientId !== args.where.patientId) match = false;
        if (args.where.specialty && q.specialty !== args.where.specialty) match = false;
        if (args.where.status && q.status !== args.where.status) match = false;
        if (match) {
          const clone = { ...q };
          if (args.include?.patient && clone.patientId) {
            clone.patient = this.users.get(clone.patientId) || null;
          }
          if (args.include?.hospital && clone.hospitalId) {
            clone.hospital = this.hospitals.get(clone.hospitalId) || null;
          }
          results.push(clone);
        }
      }
      return results;
    },
    findUnique: async (args: { where: { id: string } }) => {
      const q = this.queueEntries.get(args.where.id);
      return q ? { ...q } : null;
    },
    create: async (args: { data: any; include?: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        status: args.data.status || 'WAITING',
        joinedAt: new Date(),
        updatedAt: new Date(),
      };
      this.queueEntries.set(id, record);
      const clone = { ...record };
      if (args.include?.hospital && clone.hospitalId) {
        clone.hospital = this.hospitals.get(clone.hospitalId) || null;
      }
      if (args.include?.patient && clone.patientId) {
        clone.patient = this.users.get(clone.patientId) || null;
      }
      return clone;
    },
    findFirst: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const results = await this.queueEntry.findMany(args);
      return results.length > 0 ? results[0] : null;
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.queueEntries.get(args.where.id);
      if (!existing) throw new Error('QueueEntry not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.queueEntries.set(args.where.id, updated);
      return { ...updated };
    },
    count: async (args?: { where?: any }) => {
      if (!args?.where) return this.queueEntries.size;
      let count = 0;
      for (const q of this.queueEntries.values()) {
        let match = true;
        if (args.where.hospitalId && q.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.specialty && q.specialty !== args.where.specialty) match = false;
        if (args.where.status && q.status !== args.where.status) match = false;
        if (match) count++;
      }
      return count;
    },
  };

  emergencyContact = {
    findMany: async (args?: { where?: any }) => {
      const results: any[] = [];
      for (const ec of this.emergencyContacts.values()) {
        if (!args?.where || ec.patientId === args.where.patientId) {
          results.push({ ...ec });
        }
      }
      return results;
    },
    findUnique: async (args: { where: { id: string } }) => {
      const ec = this.emergencyContacts.get(args.where.id);
      return ec ? { ...ec } : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = { id, ...args.data, createdAt: new Date(), updatedAt: new Date() };
      this.emergencyContacts.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const ec = this.emergencyContacts.get(args.where.id);
      if (!ec) throw new Error('Emergency contact not found');
      const updated = { ...ec, ...args.data, updatedAt: new Date() };
      this.emergencyContacts.set(args.where.id, updated);
      return { ...updated };
    },
    count: async (args?: { where?: any }) => {
      const list = await this.emergencyContact.findMany(args);
      return list.length;
    },
    delete: async (args: { where: { id: string } }) => {
      const ec = this.emergencyContacts.get(args.where.id);
      this.emergencyContacts.delete(args.where.id);
      return ec || null;
    },
  };

  activityLog = {
    create: async (args: { data: any; include?: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = { id, ...args.data, createdAt: new Date() };
      this.activityLogs.set(id, record);
      const res: any = { ...record };
      if (args.include?.admin && args.data.adminId) {
        const admin = this.users.get(args.data.adminId);
        res.admin = admin ? { ...admin, hospital: admin.hospitalId ? this.hospitals.get(admin.hospitalId) : null } : null;
      }
      return res;
    },
    findMany: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      let results: any[] = [];
      for (const log of this.activityLogs.values()) {
        const item: any = { ...log };
        if (args?.where?.action && log.action !== args.where.action) continue;
        if (args?.where?.adminId && log.adminId !== args.where.adminId) continue;
        if (args?.include?.admin && log.adminId) {
          const admin = this.users.get(log.adminId);
          item.admin = admin ? { ...admin, hospital: admin.hospitalId ? this.hospitals.get(admin.hospitalId) : null } : null;
        }
        results.push(item);
      }
      return results;
    },
    findFirst: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const all = await this.activityLog.findMany(args);
      return all.length > 0 ? all[0] : null;
    },
    count: async (args?: { where?: any }) => {
      const all = await this.activityLog.findMany(args);
      return all.length;
    },
  };

  notification = {
    create: async (args: { data: any }) => {
      if (args.data.idempotencyKey) {
        for (const notif of this.notifications.values()) {
          if (notif.idempotencyKey === args.data.idempotencyKey) {
            return { ...notif };
          }
        }
      }

      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        status: args.data.status || 'PENDING',
        isRead: args.data.isRead !== undefined ? args.data.isRead : false,
        retryCount: args.data.retryCount || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.notifications.set(id, record);
      return { ...record };
    },
    findUnique: async (args: { where: { id?: string; idempotencyKey?: string } }) => {
      if (args.where.id) return this.notifications.get(args.where.id) || null;
      if (args.where.idempotencyKey) {
        for (const notif of this.notifications.values()) {
          if (notif.idempotencyKey === args.where.idempotencyKey) return { ...notif };
        }
      }
      return null;
    },
    findFirst: async (args?: { where?: any; orderBy?: any }) => {
      const results = await this.notification.findMany(args);
      return results.length > 0 ? results[0] : null;
    },
    findMany: async (args?: { where?: any; orderBy?: any; take?: number }) => {
      const results: any[] = [];
      for (const notif of this.notifications.values()) {
        if (!args?.where) {
          results.push({ ...notif });
          continue;
        }
        let match = true;
        if (args.where.recipientId && notif.recipientId !== args.where.recipientId) match = false;
        if (args.where.isRead !== undefined && notif.isRead !== args.where.isRead) match = false;
        if (args.where.status && notif.status !== args.where.status) match = false;
        if (args.where.type && notif.type !== args.where.type) match = false;
        if (args.where.hospitalId && notif.hospitalId !== args.where.hospitalId) match = false;
        if (args.where.operatorId && notif.operatorId !== args.where.operatorId) match = false;
        if (args.where.doctorId && notif.doctorId !== args.where.doctorId) match = false;
        if (args.where.entityId && notif.entityId !== args.where.entityId) match = false;
        if (match) results.push({ ...notif });
      }
      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (args?.take) return results.slice(0, args.take);
      return results;
    },
    count: async (args?: { where?: any }) => {
      const matching = await this.notification.findMany(args);
      return matching.length;
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.notifications.get(args.where.id);
      if (!existing) throw new Error('Notification not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.notifications.set(args.where.id, updated);
      return { ...updated };
    },
    updateMany: async (args: { where: any; data: any }) => {
      let count = 0;
      for (const [id, notif] of this.notifications.entries()) {
        let match = true;
        if (args.where.recipientId && notif.recipientId !== args.where.recipientId) match = false;
        if (args.where.isRead !== undefined && notif.isRead !== args.where.isRead) match = false;
        if (match) {
          this.notifications.set(id, { ...notif, ...args.data, updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.notifications.get(args.where.id);
      this.notifications.delete(args.where.id);
      return existing || null;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.notifications.size;
        this.notifications.clear();
        return { count };
      }
      for (const [id, notif] of Array.from(this.notifications.entries())) {
        let match = true;
        if (args.where.isDemo !== undefined && notif.isDemo !== args.where.isDemo) match = false;
        if (args.where.recipientId && notif.recipientId !== args.where.recipientId) match = false;
        if (match) {
          this.notifications.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  emergencyHealthAccessLog = {
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        patientId: args.data.patientId,
        accessorId: args.data.accessorId || null,
        accessorRole: args.data.accessorRole || 'ANONYMOUS_SCANNER',
        accessorName: args.data.accessorName || null,
        organization: args.data.organization || null,
        accessType: args.data.accessType,
        accessReason: args.data.accessReason || null,
        lawfulBasis: args.data.lawfulBasis || 'CONSENT_DPDP_ACT_2023',
        fieldsAccessed: args.data.fieldsAccessed || null,
        ipAddress: args.data.ipAddress || null,
        userAgent: args.data.userAgent || null,
        timestamp: new Date(),
      };
      this.emergencyHealthAccessLogs.set(id, record);
      return { ...record };
    },

    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      const results: any[] = [];
      for (const log of this.emergencyHealthAccessLogs.values()) {
        if (!args?.where) {
          results.push({ ...log });
          continue;
        }
        let match = true;
        if (args.where.patientId && log.patientId !== args.where.patientId) match = false;
        if (args.where.accessorId && log.accessorId !== args.where.accessorId) match = false;
        if (args.where.accessType && log.accessType !== args.where.accessType) match = false;
        if (match) results.push({ ...log });
      }
      results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },

    count: async (args?: { where?: any }) => {
      const matching = await this.emergencyHealthAccessLog.findMany(args);
      return matching.length;
    },

    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.emergencyHealthAccessLogs.size;
        this.emergencyHealthAccessLogs.clear();
        return { count };
      }
      for (const [id, log] of Array.from(this.emergencyHealthAccessLogs.entries())) {
        if (args.where.patientId && log.patientId === args.where.patientId) {
          this.emergencyHealthAccessLogs.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  emergencyTripShare = {
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        requestId: args.data.requestId,
        tripId: args.data.tripId || null,
        patientId: args.data.patientId,
        contactId: args.data.contactId || null,
        recipientName: args.data.recipientName || null,
        recipientPhone: args.data.recipientPhone || null,
        recipientEmail: args.data.recipientEmail || null,
        shareToken: args.data.shareToken,
        status: args.data.status || 'ACTIVE',
        allowLiveLocation: args.data.allowLiveLocation !== undefined ? args.data.allowLiveLocation : true,
        allowDestinationHospital: args.data.allowDestinationHospital !== undefined ? args.data.allowDestinationHospital : true,
        expiresAt: args.data.expiresAt ? new Date(args.data.expiresAt) : new Date(Date.now() + 2 * 3600 * 1000),
        revokedAt: args.data.revokedAt ? new Date(args.data.revokedAt) : null,
        revokedReason: args.data.revokedReason || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.emergencyTripShares.set(id, record);
      return { ...record };
    },

    findUnique: async (args: { where: { id?: string; shareToken?: string }; include?: any }) => {
      let found: any = null;
      if (args.where.id) {
        found = this.emergencyTripShares.get(args.where.id) || null;
      } else if (args.where.shareToken) {
        for (const item of this.emergencyTripShares.values()) {
          if (item.shareToken === args.where.shareToken) {
            found = item;
            break;
          }
        }
      }
      if (!found) return null;
      const res = { ...found };
      if (args.include?.request) {
        res.request = await this.emergencyRequest.findUnique({
          where: { id: found.requestId },
          include: args.include.request.include,
        });
      }
      if (args.include?.patient) {
        res.patient = await this.user.findUnique({ where: { id: found.patientId } });
      }
      if (args.include?.contact && found.contactId) {
        res.contact = await this.emergencyContact.findUnique({ where: { id: found.contactId } });
      }
      return res;
    },

    findFirst: async (args?: { where?: any; include?: any; orderBy?: any }) => {
      const results = await this.emergencyTripShare.findMany(args);
      return results.length > 0 ? results[0] : null;
    },

    findMany: async (args?: { where?: any; include?: any; orderBy?: any; take?: number; skip?: number }) => {
      const results: any[] = [];
      for (const item of this.emergencyTripShares.values()) {
        if (!args?.where) {
          results.push({ ...item });
          continue;
        }
        let match = true;
        if (args.where.requestId && item.requestId !== args.where.requestId) match = false;
        if (args.where.tripId && item.tripId !== args.where.tripId) match = false;
        if (args.where.patientId && item.patientId !== args.where.patientId) match = false;
        if (args.where.contactId && item.contactId !== args.where.contactId) match = false;
        if (args.where.status && item.status !== args.where.status) match = false;
        if (args.where.shareToken && item.shareToken !== args.where.shareToken) match = false;
        if (match) results.push({ ...item });
      }

      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const skip = args?.skip || 0;
      const sliced = args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);

      if (args?.include) {
        for (let i = 0; i < sliced.length; i++) {
          const it = sliced[i];
          if (args.include.request) {
            it.request = await this.emergencyRequest.findUnique({
              where: { id: it.requestId },
              include: args.include.request.include,
            });
          }
          if (args.include.contact && it.contactId) {
            it.contact = await this.emergencyContact.findUnique({ where: { id: it.contactId } });
          }
        }
      }
      return sliced;
    },

    update: async (args: { where: { id?: string; shareToken?: string }; data: any }) => {
      let targetId = args.where.id;
      if (!targetId && args.where.shareToken) {
        for (const [id, item] of this.emergencyTripShares.entries()) {
          if (item.shareToken === args.where.shareToken) {
            targetId = id;
            break;
          }
        }
      }
      if (!targetId || !this.emergencyTripShares.has(targetId)) {
        throw new Error('EmergencyTripShare not found');
      }
      const existing = this.emergencyTripShares.get(targetId);
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.emergencyTripShares.set(targetId, updated);
      return { ...updated };
    },

    updateMany: async (args: { where: any; data: any }) => {
      let count = 0;
      for (const [id, item] of this.emergencyTripShares.entries()) {
        let match = true;
        if (args.where.requestId && item.requestId !== args.where.requestId) match = false;
        if (args.where.patientId && item.patientId !== args.where.patientId) match = false;
        if (args.where.status && item.status !== args.where.status) match = false;
        if (match) {
          this.emergencyTripShares.set(id, { ...item, ...args.data, updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    },

    count: async (args?: { where?: any }) => {
      const list = await this.emergencyTripShare.findMany(args);
      return list.length;
    },

    delete: async (args: { where: { id: string } }) => {
      const existing = this.emergencyTripShares.get(args.where.id);
      this.emergencyTripShares.delete(args.where.id);
      return existing || null;
    },

    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.emergencyTripShares.size;
        this.emergencyTripShares.clear();
        return { count };
      }
      for (const [id, item] of Array.from(this.emergencyTripShares.entries())) {
        let match = true;
        if (args.where.requestId && item.requestId !== args.where.requestId) match = false;
        if (args.where.patientId && item.patientId !== args.where.patientId) match = false;
        if (match) {
          this.emergencyTripShares.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  emergencyTripShareAuditLog = {
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        shareId: args.data.shareId || null,
        shareToken: args.data.shareToken || null,
        requestId: args.data.requestId,
        patientId: args.data.patientId,
        action: args.data.action,
        actorId: args.data.actorId || null,
        actorRole: args.data.actorRole || 'SYSTEM',
        actorName: args.data.actorName || null,
        ipAddress: args.data.ipAddress || null,
        userAgent: args.data.userAgent || null,
        details: args.data.details || null,
        timestamp: new Date(),
      };
      this.emergencyTripShareAuditLogs.set(id, record);
      return { ...record };
    },

    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      const results: any[] = [];
      for (const item of this.emergencyTripShareAuditLogs.values()) {
        if (!args?.where) {
          results.push({ ...item });
          continue;
        }
        let match = true;
        if (args.where.requestId && item.requestId !== args.where.requestId) match = false;
        if (args.where.patientId && item.patientId !== args.where.patientId) match = false;
        if (args.where.shareId && item.shareId !== args.where.shareId) match = false;
        if (args.where.shareToken && item.shareToken !== args.where.shareToken) match = false;
        if (args.where.action && item.action !== args.where.action) match = false;
        if (match) results.push({ ...item });
      }
      results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },

    count: async (args?: { where?: any }) => {
      const list = await this.emergencyTripShareAuditLog.findMany(args);
      return list.length;
    },

    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.emergencyTripShareAuditLogs.size;
        this.emergencyTripShareAuditLogs.clear();
        return { count };
      }
      for (const [id, item] of Array.from(this.emergencyTripShareAuditLogs.entries())) {
        let match = true;
        if (args.where.requestId && item.requestId !== args.where.requestId) match = false;
        if (args.where.patientId && item.patientId !== args.where.patientId) match = false;
        if (match) {
          this.emergencyTripShareAuditLogs.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  directoryFacility = {
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      let results: any[] = [];
      for (const item of this.directoryFacilities.values()) {
        if (args?.where) {
          let match = true;
          if (args.where.name && item.name !== args.where.name) match = false;
          if (args.where.city && item.city !== args.where.city) match = false;
          if (args.where.district && item.district !== args.where.district) match = false;
          if (args.where.facilityType && item.facilityType !== args.where.facilityType) match = false;
          if (args.where.verificationStatus) {
            if (args.where.verificationStatus.in && Array.isArray(args.where.verificationStatus.in)) {
              if (!args.where.verificationStatus.in.includes(item.verificationStatus)) match = false;
            } else if (typeof args.where.verificationStatus === 'string') {
              if (item.verificationStatus !== args.where.verificationStatus) match = false;
            }
          }
          if (args.where.linkStatus && item.linkStatus !== args.where.linkStatus) match = false;
          if (args.where.isDuplicate !== undefined && item.isDuplicate !== args.where.isDuplicate) match = false;
          if (args.where.locality && item.locality?.toLowerCase() !== args.where.locality.toLowerCase() && item.tehsil?.toLowerCase() !== args.where.locality.toLowerCase()) match = false;
          if (args.where.tehsil && item.tehsil?.toLowerCase() !== args.where.tehsil.toLowerCase()) match = false;
          if (args.where.coverageGroup && item.coverageGroup !== args.where.coverageGroup) match = false;
          if (args.where.dataConfidence && item.dataConfidence !== args.where.dataConfidence) match = false;
          if (args.where.recordType && item.recordType !== args.where.recordType) match = false;
          if (args.where.recordStatus && item.recordStatus !== args.where.recordStatus) match = false;
          if (args.where.search) {
            const term = String(args.where.search).toLowerCase();
            const nameMatch = item.name?.toLowerCase().includes(term);
            const addressMatch = item.address?.toLowerCase().includes(term);
            const localityMatch = item.locality?.toLowerCase().includes(term);
            const tehsilMatch = item.tehsil?.toLowerCase().includes(term);
            const altMatch = Array.isArray(item.alternateNames) && item.alternateNames.some((a: string) => String(a).toLowerCase().includes(term));
            if (!nameMatch && !addressMatch && !localityMatch && !tehsilMatch && !altMatch) match = false;
          }
          if (args.where.OR && Array.isArray(args.where.OR)) {
            const orMatch = args.where.OR.some((cond: any) => {
              if (cond.name?.contains && item.name?.toLowerCase().includes(cond.name.contains.toLowerCase())) return true;
              if (cond.address?.contains && item.address?.toLowerCase().includes(cond.address.contains.toLowerCase())) return true;
              return false;
            });
            if (!orMatch) match = false;
          }
          if (!match) continue;
        }
        results.push({ ...item });
      }
      if (args?.orderBy) {
        const field = Object.keys(args.orderBy)[0];
        const dir = args.orderBy[field];
        results.sort((a, b) => {
          if (dir === 'desc') return (b[field] > a[field] ? 1 : -1);
          return (a[field] > b[field] ? 1 : -1);
        });
      }
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },
    findUnique: async (args: { where: { id: string } }) => {
      const item = this.directoryFacilities.get(args.where.id);
      return item ? { ...item } : null;
    },
    findFirst: async (args?: { where?: any }) => {
      const list = await this.directoryFacility.findMany(args);
      return list.length > 0 ? list[0] : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.directoryFacilities.set(id, record);
      return { ...record };
    },
    createMany: async (args: { data: any[] }) => {
      for (const item of args.data) {
        const id = item.id || crypto.randomUUID();
        this.directoryFacilities.set(id, {
          id,
          ...item,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return { count: args.data.length };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.directoryFacilities.get(args.where.id);
      if (!existing) throw new Error('Facility not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.directoryFacilities.set(args.where.id, updated);
      return { ...updated };
    },
    upsert: async (args: { where: { id: string }; create: any; update: any }) => {
      const existing = this.directoryFacilities.get(args.where.id);
      if (existing) {
        const updated = { ...existing, ...args.update, updatedAt: new Date() };
        this.directoryFacilities.set(args.where.id, updated);
        return { ...updated };
      } else {
        const id = args.where.id || args.create.id || crypto.randomUUID();
        const record = { id, ...args.create, createdAt: new Date(), updatedAt: new Date() };
        this.directoryFacilities.set(id, record);
        return { ...record };
      }
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.directoryFacilities.get(args.where.id);
      if (existing) this.directoryFacilities.delete(args.where.id);
      return existing || null;
    },
    count: async (args?: { where?: any }) => {
      const list = await this.directoryFacility.findMany(args);
      return list.length;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.directoryFacilities.size;
        this.directoryFacilities.clear();
        return { count };
      }
      for (const [id, item] of Array.from(this.directoryFacilities.entries())) {
        let match = true;
        if (args.where.city && item.city !== args.where.city) match = false;
        if (match) {
          this.directoryFacilities.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  directoryAmbulanceService = {
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      let results: any[] = [];
      for (const item of this.directoryAmbulanceServices.values()) {
        if (args?.where) {
          let match = true;
          if (args.where.serviceName && item.serviceName !== args.where.serviceName) match = false;
          if (args.where.city && item.city !== args.where.city) match = false;
          if (args.where.district && item.district !== args.where.district) match = false;
          if (args.where.operatorType && item.operatorType !== args.where.operatorType) match = false;
          if (args.where.verificationStatus) {
            if (args.where.verificationStatus.in && Array.isArray(args.where.verificationStatus.in)) {
              if (!args.where.verificationStatus.in.includes(item.verificationStatus)) match = false;
            } else if (typeof args.where.verificationStatus === 'string') {
              if (item.verificationStatus !== args.where.verificationStatus) match = false;
            }
          }
          if (args.where.linkStatus && item.linkStatus !== args.where.linkStatus) match = false;
          if (args.where.isDuplicate !== undefined && item.isDuplicate !== args.where.isDuplicate) match = false;
          if (args.where.locality && item.locality?.toLowerCase() !== args.where.locality.toLowerCase() && item.tehsil?.toLowerCase() !== args.where.locality.toLowerCase()) match = false;
          if (args.where.tehsil && item.tehsil?.toLowerCase() !== args.where.tehsil.toLowerCase()) match = false;
          if (args.where.coverageGroup && item.coverageGroup !== args.where.coverageGroup) match = false;
          if (args.where.dataConfidence && item.dataConfidence !== args.where.dataConfidence) match = false;
          if (args.where.recordType && item.recordType !== args.where.recordType) match = false;
          if (args.where.recordStatus && item.recordStatus !== args.where.recordStatus) match = false;
          if (args.where.search) {
            const term = String(args.where.search).toLowerCase();
            const nameMatch = item.serviceName?.toLowerCase().includes(term);
            const addressMatch = item.address?.toLowerCase().includes(term);
            const areaMatch = item.operatingArea?.toLowerCase().includes(term);
            const localityMatch = item.locality?.toLowerCase().includes(term);
            const tehsilMatch = item.tehsil?.toLowerCase().includes(term);
            if (!nameMatch && !addressMatch && !areaMatch && !localityMatch && !tehsilMatch) match = false;
          }
          if (!match) continue;
        }
        results.push({ ...item });
      }
      if (args?.orderBy) {
        const field = Object.keys(args.orderBy)[0];
        const dir = args.orderBy[field];
        results.sort((a, b) => {
          if (dir === 'desc') return (b[field] > a[field] ? 1 : -1);
          return (a[field] > b[field] ? 1 : -1);
        });
      }
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },
    findUnique: async (args: { where: { id: string } }) => {
      const item = this.directoryAmbulanceServices.get(args.where.id);
      return item ? { ...item } : null;
    },
    findFirst: async (args?: { where?: any }) => {
      const list = await this.directoryAmbulanceService.findMany(args);
      return list.length > 0 ? list[0] : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.directoryAmbulanceServices.set(id, record);
      return { ...record };
    },
    createMany: async (args: { data: any[] }) => {
      for (const item of args.data) {
        const id = item.id || crypto.randomUUID();
        this.directoryAmbulanceServices.set(id, {
          id,
          ...item,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return { count: args.data.length };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.directoryAmbulanceServices.get(args.where.id);
      if (!existing) throw new Error('Ambulance service not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.directoryAmbulanceServices.set(args.where.id, updated);
      return { ...updated };
    },
    upsert: async (args: { where: { id: string }; create: any; update: any }) => {
      const existing = this.directoryAmbulanceServices.get(args.where.id);
      if (existing) {
        const updated = { ...existing, ...args.update, updatedAt: new Date() };
        this.directoryAmbulanceServices.set(args.where.id, updated);
        return { ...updated };
      } else {
        const id = args.where.id || args.create.id || crypto.randomUUID();
        const record = { id, ...args.create, createdAt: new Date(), updatedAt: new Date() };
        this.directoryAmbulanceServices.set(id, record);
        return { ...record };
      }
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.directoryAmbulanceServices.get(args.where.id);
      if (existing) this.directoryAmbulanceServices.delete(args.where.id);
      return existing || null;
    },
    count: async (args?: { where?: any }) => {
      const list = await this.directoryAmbulanceService.findMany(args);
      return list.length;
    },
    deleteMany: async (args?: { where?: any }) => {
      let count = 0;
      if (!args?.where) {
        count = this.directoryAmbulanceServices.size;
        this.directoryAmbulanceServices.clear();
        return { count };
      }
      for (const [id, item] of Array.from(this.directoryAmbulanceServices.entries())) {
        let match = true;
        if (args.where.city && item.city !== args.where.city) match = false;
        if (match) {
          this.directoryAmbulanceServices.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  directoryReviewIssue = {
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      let results: any[] = [];
      for (const item of this.directoryReviewIssues.values()) {
        if (args?.where) {
          let match = true;
          if (args.where.entityType && item.entityType !== args.where.entityType) match = false;
          if (args.where.entityId && item.entityId !== args.where.entityId) match = false;
          if (args.where.issueType && item.issueType !== args.where.issueType) match = false;
          if (args.where.severity && item.severity !== args.where.severity) match = false;
          if (args.where.status && item.status !== args.where.status) match = false;
          if (!match) continue;
        }
        results.push({ ...item });
      }
      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },
    findUnique: async (args: { where: { id: string } }) => {
      const item = this.directoryReviewIssues.get(args.where.id);
      return item ? { ...item } : null;
    },
    findFirst: async (args?: { where?: any }) => {
      const list = await this.directoryReviewIssue.findMany(args);
      return list.length > 0 ? list[0] : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        createdAt: new Date(),
      };
      this.directoryReviewIssues.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.directoryReviewIssues.get(args.where.id);
      if (!existing) throw new Error('Issue not found');
      const updated = { ...existing, ...args.data };
      this.directoryReviewIssues.set(args.where.id, updated);
      return { ...updated };
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.directoryReviewIssues.get(args.where.id);
      if (existing) this.directoryReviewIssues.delete(args.where.id);
      return existing || null;
    },
    count: async (args?: { where?: any }) => {
      const list = await this.directoryReviewIssue.findMany(args);
      return list.length;
    },
    deleteMany: async () => {
      const count = this.directoryReviewIssues.size;
      this.directoryReviewIssues.clear();
      return { count };
    },
  };

  hospitalOnboardingApplication = {
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      let results: any[] = [];
      for (const item of this.hospitalOnboardingApplications.values()) {
        if (args?.where) {
          let match = true;
          if (args.where.status && item.status !== args.where.status) match = false;
          if (args.where.applicantUserId && item.applicantUserId !== args.where.applicantUserId) match = false;
          if (args.where.directoryFacilityId && item.directoryFacilityId !== args.where.directoryFacilityId) match = false;
          if (args.where.city && item.city !== args.where.city) match = false;
          if (match) results.push({ ...item });
        } else {
          results.push({ ...item });
        }
      }
      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },
    findUnique: async (args: { where: { id: string } }) => {
      const item = this.hospitalOnboardingApplications.get(args.where.id);
      return item ? { ...item } : null;
    },
    findFirst: async (args?: { where?: any }) => {
      const list = await this.hospitalOnboardingApplication.findMany(args);
      return list.length > 0 ? list[0] : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.hospitalOnboardingApplications.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.hospitalOnboardingApplications.get(args.where.id);
      if (!existing) throw new Error('Application not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.hospitalOnboardingApplications.set(args.where.id, updated);
      return { ...updated };
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.hospitalOnboardingApplications.get(args.where.id);
      if (existing) this.hospitalOnboardingApplications.delete(args.where.id);
      return existing || null;
    },
    count: async (args?: { where?: any }) => {
      const list = await this.hospitalOnboardingApplication.findMany(args);
      return list.length;
    },
    deleteMany: async () => {
      const count = this.hospitalOnboardingApplications.size;
      this.hospitalOnboardingApplications.clear();
      return { count };
    },
  };

  operatorOnboardingApplication = {
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      let results: any[] = [];
      for (const item of this.operatorOnboardingApplications.values()) {
        if (args?.where) {
          let match = true;
          if (args.where.status && item.status !== args.where.status) match = false;
          if (args.where.applicantUserId && item.applicantUserId !== args.where.applicantUserId) match = false;
          if (args.where.directoryAmbulanceId && item.directoryAmbulanceId !== args.where.directoryAmbulanceId) match = false;
          if (match) results.push({ ...item });
        } else {
          results.push({ ...item });
        }
      }
      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },
    findUnique: async (args: { where: { id: string } }) => {
      const item = this.operatorOnboardingApplications.get(args.where.id);
      return item ? { ...item } : null;
    },
    findFirst: async (args?: { where?: any }) => {
      const list = await this.operatorOnboardingApplication.findMany(args);
      return list.length > 0 ? list[0] : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.operatorOnboardingApplications.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.operatorOnboardingApplications.get(args.where.id);
      if (!existing) throw new Error('Application not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.operatorOnboardingApplications.set(args.where.id, updated);
      return { ...updated };
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.operatorOnboardingApplications.get(args.where.id);
      if (existing) this.operatorOnboardingApplications.delete(args.where.id);
      return existing || null;
    },
    count: async (args?: { where?: any }) => {
      const list = await this.operatorOnboardingApplication.findMany(args);
      return list.length;
    },
    deleteMany: async () => {
      const count = this.operatorOnboardingApplications.size;
      this.operatorOnboardingApplications.clear();
      return { count };
    },
  };

  driverVerificationApplication = {
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      let results: any[] = [];
      for (const item of this.driverVerificationApplications.values()) {
        if (args?.where) {
          let match = true;
          if (args.where.status && item.status !== args.where.status) match = false;
          if (args.where.driverUserId && item.driverUserId !== args.where.driverUserId) match = false;
          if (args.where.organizationId && item.organizationId !== args.where.organizationId) match = false;
          if (args.where.organizationType && item.organizationType !== args.where.organizationType) match = false;
          if (match) results.push({ ...item });
        } else {
          results.push({ ...item });
        }
      }
      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const skip = args?.skip || 0;
      return args?.take ? results.slice(skip, skip + args.take) : results.slice(skip);
    },
    findUnique: async (args: { where: { id: string } }) => {
      const item = this.driverVerificationApplications.get(args.where.id);
      return item ? { ...item } : null;
    },
    findFirst: async (args?: { where?: any }) => {
      const list = await this.driverVerificationApplication.findMany(args);
      return list.length > 0 ? list[0] : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.driverVerificationApplications.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { id: string }; data: any }) => {
      const existing = this.driverVerificationApplications.get(args.where.id);
      if (!existing) throw new Error('Application not found');
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      this.driverVerificationApplications.set(args.where.id, updated);
      return { ...updated };
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.driverVerificationApplications.get(args.where.id);
      if (existing) this.driverVerificationApplications.delete(args.where.id);
      return existing || null;
    },
    count: async (args?: { where?: any }) => {
      const list = await this.driverVerificationApplication.findMany(args);
      return list.length;
    },
    deleteMany: async () => {
      const count = this.driverVerificationApplications.size;
      this.driverVerificationApplications.clear();
      return { count };
    },
  };

  pilotActivationChecklist = {
    findMany: async (args?: { where?: any; orderBy?: any; take?: number; skip?: number }) => {
      let results: any[] = [];
      for (const item of this.pilotActivationChecklists.values()) {
        if (args?.where) {
          let match = true;
          if (args.where.activationStatus && item.activationStatus !== args.where.activationStatus) match = false;
          if (args.where.organizationType && item.organizationType !== args.where.organizationType) match = false;
          if (args.where.organizationId && item.organizationId !== args.where.organizationId) match = false;
          if (match) results.push({ ...item });
        } else {
          results.push({ ...item });
        }
      }
      return results;
    },
    findUnique: async (args: { where: { organizationId?: string; id?: string } }) => {
      if (args.where.organizationId) {
        for (const item of this.pilotActivationChecklists.values()) {
          if (item.organizationId === args.where.organizationId) return { ...item };
        }
      }
      if (args.where.id) {
        const item = this.pilotActivationChecklists.get(args.where.id);
        return item ? { ...item } : null;
      }
      return null;
    },
    findFirst: async (args?: { where?: any }) => {
      const list = await this.pilotActivationChecklist.findMany(args);
      return list.length > 0 ? list[0] : null;
    },
    create: async (args: { data: any }) => {
      const id = args.data.id || crypto.randomUUID();
      const record = {
        id,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.pilotActivationChecklists.set(id, record);
      return { ...record };
    },
    update: async (args: { where: { organizationId?: string; id?: string }; data: any }) => {
      let target: any = null;
      if (args.where.organizationId) {
        for (const item of this.pilotActivationChecklists.values()) {
          if (item.organizationId === args.where.organizationId) {
            target = item;
            break;
          }
        }
      } else if (args.where.id) {
        target = this.pilotActivationChecklists.get(args.where.id);
      }
      if (!target) throw new Error('Checklist not found');
      const updated = { ...target, ...args.data, updatedAt: new Date() };
      this.pilotActivationChecklists.set(target.id, updated);
      return { ...updated };
    },
    upsert: async (args: { where: { organizationId: string }; create: any; update: any }) => {
      let target: any = null;
      for (const item of this.pilotActivationChecklists.values()) {
        if (item.organizationId === args.where.organizationId) {
          target = item;
          break;
        }
      }
      if (target) {
        const updated = { ...target, ...args.update, updatedAt: new Date() };
        this.pilotActivationChecklists.set(target.id, updated);
        return { ...updated };
      }
      const id = args.create.id || crypto.randomUUID();
      const record = {
        id,
        ...args.create,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.pilotActivationChecklists.set(id, record);
      return { ...record };
    },
    delete: async (args: { where: { id: string } }) => {
      const existing = this.pilotActivationChecklists.get(args.where.id);
      if (existing) this.pilotActivationChecklists.delete(args.where.id);
      return existing || null;
    },
    count: async (args?: { where?: any }) => {
      const list = await this.pilotActivationChecklist.findMany(args);
      return list.length;
    },
    deleteMany: async () => {
      const count = this.pilotActivationChecklists.size;
      this.pilotActivationChecklists.clear();
      return { count };
    },
  };

  $transaction = async (arg: any) => {
    if (typeof arg === 'function') {
      return await arg(this);
    }
    if (Array.isArray(arg)) {
      return await Promise.all(arg);
    }
    return arg;
  };

  $queryRaw = async (..._args: any[]) => {
    if (process.env.TEST_DB_CONNECTED === 'true' || (process.env.TEST_DB_CONNECTED !== 'false' && process.env.USE_IN_MEMORY_DB === 'true')) {
      return [{ '?column?': 1 }];
    }
    throw new Error('Database offline');
  };

  $connect = async () => {};
  $disconnect = async () => {};
}

export const inMemoryDb = new InMemoryDatabase();

let realPrismaInstance: PrismaClient | null = null;
function getRealPrisma(): PrismaClient {
  if (!realPrismaInstance) {
    realPrismaInstance = new PrismaClient();
  }
  return realPrismaInstance;
}

// Dynamic Proxy: seamlessly selects inMemoryDb in test mode or when DB is not configured,
// and delegates to real PrismaClient when running in live database environments.
const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    const isTest = process.env.NODE_ENV === 'test';
    const forceMemory = process.env.USE_IN_MEMORY_DB === 'true';
    const noDbUrl = !process.env.DATABASE_URL;

    if (isTest || forceMemory || noDbUrl) {
      return (inMemoryDb as any)[prop];
    }
    return (getRealPrisma() as any)[prop];
  },
});

export default prisma;

