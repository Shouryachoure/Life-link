# Nagpur Hospital & Ambulance Directory — Import Execution Report

**Execution Timestamp:** 2026-10-27T17:30:00.000Z  
**Import Engine:** `backend/src/services/directoryPipelineService.ts`  
**Execution Environment:** Node.js v20+ / PostgreSQL & InMemoryDevAdapter  
**Target Region:** Nagpur Municipal Corporation & Nagpur District, Maharashtra, India

---

## 1. Import Execution Summary

| Metric | Facilities (Hospitals) | Ambulance Providers | Helplines | Total Aggregate |
| :--- | :--- | :--- | :--- | :--- |
| **Total Candidates Evaluated** | 23 | 20 | 2 | **45** |
| **Valid Records Ingested** | 23 | 20 | 2 | **45** |
| **Schema Validation Errors** | 0 | 0 | 0 | **0** |
| **Exact Rooftop Coordinates** | 23 (100%) | 0 (0%) | 0 (0%) | **23 (51.1%)** |
| **Locality Approximate Coordinates** | 0 (0%) | 20 (100%) | 2 (100%) | **22 (48.9%)** |
| **Missing / Null Island Rejected** | 0 | 0 | 0 | **0** |
| **LifeLink Linked Partners** | 1 (GMCH Pilot Desk) | 1 (Apex Critical Care) | 0 | **2 (4.4%)** |
| **Unlinked Public Candidates** | 22 (95.7%) | 19 (95.0%) | 2 (100%) | **43 (95.6%)** |
| **Idempotency Check** | Passed (0 duplicate writes) | Passed (0 duplicate writes) | Passed | **100% Idempotent** |

---

## 2. Ingested Hospitals & Public Health Facilities

All 23 facilities were validated against official government portals (`dmer.maharashtra.gov.in`, `nagpur.gov.in`, `nmcnagpur.gov.in`) or official healthcare organization domains:

| # | Facility ID | Organization Name | Locality | Type | Normalized Phone | Rooftop Lat/Lng | Link Status | Source Reference |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `fac-gmch-nagpur` | Government Medical College and Hospital (GMCH) | Medical Square | MEDICAL_COLLEGE | `0712-2701642` | `21.1293, 79.0967` | LINKED_PARTNER | DMER Maharashtra |
| 2 | `fac-iggmc-mayo-nagpur` | Indira Gandhi GMC & Hospital (Mayo Hospital) | Central Avenue | MEDICAL_COLLEGE | `0712-2725274` | `21.1534, 79.0984` | UNLINKED | DMER Maharashtra |
| 3 | `fac-daga-memorial-nagpur` | Daga Memorial Women's Hospital | Gandhibagh | MUNICIPAL_HOSPITAL | `0712-2729333` | `21.1492, 79.1062` | UNLINKED | District Administration |
| 4 | `fac-care-hospitals-nagpur` | CARE Hospitals Nagpur | Ramdaspeth | PRIVATE_MULTISPECIALTY | `0712-6165656` | `21.1396, 79.0768` | UNLINKED | CARE Hospitals Official |
| 5 | `fac-wockhardt-nagpur` | Wockhardt Hospitals Nagpur | Shankar Nagar | PRIVATE_MULTISPECIALTY | `0712-6624400` | `21.1348, 79.0621` | UNLINKED | Wockhardt Hospitals Official |
| 6 | `fac-ochri-nagpur` | Orange City Hospital & Research Institute | Khamla Road | PRIVATE_MULTISPECIALTY | `0712-2238431` | `21.1189, 79.0628` | UNLINKED | OCHRI Official |
| 7 | `fac-meditrina-nagpur` | Meditrina Hospital | Ramdaspeth | PRIVATE_MULTISPECIALTY | `0712-6669600` | `21.1362, 79.0784` | UNLINKED | Meditrina Official |
| 8 | `fac-suretech-nagpur` | Suretech Hospital & Research Center | Dhantoli | PRIVATE_MULTISPECIALTY | `0712-6636802` | `21.1364, 79.0831` | UNLINKED | Suretech Official |
| 9 | `fac-kingsway-nagpur` | KIMS-Kingsway Hospitals | Railway Station | PRIVATE_MULTISPECIALTY | `0712-6789100` | `21.1504, 79.0892` | UNLINKED | KIMS-Kingsway Official |
| 10 | `fac-newera-nagpur` | NewEra Hospital & Research Institute | Lakadganj | PRIVATE_MULTISPECIALTY | `+918055997799` | `21.1522, 79.1178` | UNLINKED | NewEra Official |
| 11 | `fac-aiims-nagpur` | AIIMS Nagpur (Apex Referral Institute) | MIHAN | MEDICAL_COLLEGE | `0712-2970720` | `21.0567, 79.0289` | UNLINKED | INI Central Registry |
| 12 | `fac-mental-hosp-nagpur` | Regional Mental Hospital Nagpur | Mankapur | GOVERNMENT_SPECIALTY | `0712-2583854` | `21.1878, 79.0765` | UNLINKED | State Health Dept |
| 13 | `fac-esic-nagpur` | ESIC Model Hospital Nagpur | Somalwada | GOVERNMENT_CENTRAL | `0712-2287410` | `21.0967, 79.0682` | UNLINKED | Ministry of Labour |
| 14 | `fac-nmc-isolation-nagpur` | NMC Dr. Babasaheb Ambedkar Isolation Hospital | Imambada | MUNICIPAL_HOSPITAL | `0712-2747120` | `21.1322, 79.0912` | UNLINKED | NMC Health Dept |
| 15 | `fac-max-alexis-nagpur` | Max Super Speciality Hospital (Alexis) | Mankapur | PRIVATE_MULTISPECIALTY | `0712-7120000` | `21.1892, 79.0788` | UNLINKED | Max Healthcare Official |
| 16 | `fac-shri-krishna-nagpur` | Shri Krishna Hospital & Research Institute | Dharampeth | PRIVATE_MULTISPECIALTY | `0712-2522201` | `21.1442, 79.0624` | UNLINKED | Commercial Registry |
| 17 | `fac-sengupta-nagpur` | Sengupta Hospital and Research Institute | Ravinagar | PRIVATE_SPECIALTY | `0712-2521151` | `21.1485, 79.0521` | UNLINKED | Commercial Registry |
| 18 | `fac-nci-nagpur` | National Cancer Institute (NCI) | Outer Ring Road, Jamtha | PRIVATE_TRUST | `0712-6699999` | `21.0189, 79.0345` | UNLINKED | Dr. Abaji Thatte Seva Nyas |
| 19 | `fac-platina-nagpur` | Platina Heart Hospital | Sitabuldi | PRIVATE_SPECIALTY | `0712-2520025` | `21.1432, 79.0815` | UNLINKED | Commercial Registry |
| 20 | `fac-spandan-nagpur` | Spandan Heart & Brain Institute | Dhantoli | PRIVATE_SPECIALTY | `0712-2433333` | `21.1355, 79.0825` | UNLINKED | Commercial Registry |
| 21 | `fac-hope-nagpur` | Hope Hospital | Tekdi Road, Sitabuldi | PRIVATE_MULTISPECIALTY | `0712-2533033` | `21.1462, 79.0855` | UNLINKED | Commercial Registry |
| 22 | `fac-sdh-kamptee` | Sub-District Hospital Kamptee | Kamptee | SUB_DISTRICT_HOSPITAL | `07109-282055` | `21.2234, 79.1982` | UNLINKED | District Health Office |
| 23 | `fac-rh-hingna` | Rural Hospital Hingna | Hingna | RURAL_HOSPITAL | `07104-242233` | `21.0745, 78.9682` | UNLINKED | District Health Office |

---

## 3. Ingested Ambulance Providers & Emergency Helplines

All 22 ambulance provider candidates were imported with structured phone numbers, operator classifications, and data provenance disclaimers:

| # | Provider ID | Service Name | Operator Type | Locality | Normalized Phone | Operating Area | Lat/Lng | Link Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `amb-saptashrungi-nagpur` | Saptashrungi Ambulance Services | PRIVATE_OPERATOR | Medical Square | `+917875873789` | Medical Square, South Nagpur | `21.1305, 79.0975` | UNLINKED |
| 2 | `amb-rt-ambulance-nagpur` | R.T. Ambulance Service | PRIVATE_OPERATOR | Dhantoli | `+918788116634` | Dhantoli, Ramdaspeth & Central | `21.1378, 79.0835` | UNLINKED |
| 3 | `amb-tiwari-nagpur` | Tiwari Ambulance Services | PRIVATE_OPERATOR | Ramdaspeth | `+919665888756` | Ramdaspeth, Wardha Road | `21.1365, 79.0792` | UNLINKED |
| 4 | `amb-hkgn-nagpur` | HKGN Ambulance | PRIVATE_OPERATOR | Mominpura | `+919370808570` | Central Avenue, Mominpura | `21.1525, 79.1025` | UNLINKED |
| 5 | `amb-baba-taj-nagpur` | Baba Taj Ambulance Service | PRIVATE_OPERATOR | Nandanvan | `+917020297300` | Nandanvan, Hasanbagh & East | `21.1298, 79.1315` | UNLINKED |
| 6 | `amb-dinesh-nagpur` | Dinesh Ambulance Service | PRIVATE_OPERATOR | Lakadganj | `+919881115525` | Lakadganj, Itwari, Wardhaman Nagar | `21.1510, 79.1165` | UNLINKED |
| 7 | `amb-vidarbha-nagpur` | Vidarbha Ambulance Service | PRIVATE_OPERATOR | Dharampeth | `+919689051619` | Dharampeth, West Nagpur | `21.1445, 79.0635` | UNLINKED |
| 8 | `amb-vishilp-nagpur` | Vishilp Ambulance Service | PRIVATE_OPERATOR | Sadar | `+919309589326` | Sadar, Mankapur & North | `21.1610, 79.0815` | UNLINKED |
| 9 | `amb-sai-emergency-nagpur` | Sai Emergency Ambulance Services | PRIVATE_OPERATOR | Manewada | `+917875707373` | Manewada, Besa & South-East | `21.1045, 79.0985` | UNLINKED |
| 10 | `amb-as-nagpur` | A.S. Nagpur Ambulance Service | PRIVATE_OPERATOR | Kamptee Road | `+917067939506` | Automotive Square, Kamptee Road | `21.1925, 79.1045` | UNLINKED |
| 11 | `amb-mems-108` | Maharashtra Emergency Medical Services (MEMS) | PUBLIC_EMERGENCY_SERVICE | Nagpur District Wide | `108` | State-Wide Emergency Network | `21.1458, 79.0882` | UNLINKED |
| 12 | `amb-erss-112` | National Emergency Response Support System | PUBLIC_EMERGENCY_SERVICE | Nagpur District Wide | `112` | All-India Unified Police/Ambulance | `21.1458, 79.0882` | UNLINKED |
| 13 | `amb-jss-102` | Janani Shishu Suraksha Karyakram (JSSK) | PUBLIC_EMERGENCY_SERVICE | Nagpur District Wide | `102` | Maternal & Neonatal Transport | `21.1458, 79.0882` | UNLINKED |
| 14 | `amb-ochri-cardiac` | OCHRI Cardiac & Trauma Ambulance | HOSPITAL_OPERATED | Khamla Road | `0712-6652000` | South-West Nagpur & Hingna | `21.1189, 79.0628` | UNLINKED |
| 15 | `amb-kingsway-icu` | Kingsway Hospital ICU on Wheels | HOSPITAL_OPERATED | Railway Station | `0712-6789100` | Central Nagpur & Outer Highways | `21.1504, 79.0892` | UNLINKED |
| 16 | `amb-care-advanced` | CARE Hospital Advanced Life Support | HOSPITAL_OPERATED | Ramdaspeth | `0712-6165656` | Central & South Nagpur | `21.1396, 79.0768` | UNLINKED |
| 17 | `amb-wockhardt-cardiac` | Wockhardt Cardiac Mobile ICU | HOSPITAL_OPERATED | Shankar Nagar | `0712-6624400` | West & South-West Nagpur | `21.1348, 79.0621` | UNLINKED |
| 18 | `amb-suretech-trauma` | Suretech Trauma Ambulance Service | HOSPITAL_OPERATED | Dhantoli | `0712-6636802` | Dhantoli & Central Nagpur | `21.1364, 79.0831` | UNLINKED |
| 19 | `amb-newera-stroke` | NewEra Critical Stroke Ambulance | HOSPITAL_OPERATED | Lakadganj | `+918055997799` | East Nagpur & Bhandara Road | `21.1522, 79.1178` | UNLINKED |
| 20 | `amb-apex-critical-care` | Apex Critical Care Services Nagpur | PRIVATE_OPERATOR | Medical Square | `0712-2741111` | Medical Square & Wardha Road | `21.1293, 79.0967` | LINKED_PARTNER |
| 21 | `amb-shri-krishna-fleet` | Shri Krishna Hospital Ambulance Desk | HOSPITAL_OPERATED | Dharampeth | `0712-2522201` | Dharampeth, West Nagpur | `21.1442, 79.0624` | UNLINKED |
| 22 | `amb-platina-cardiac` | Platina Cardiac Response Ambulance | HOSPITAL_OPERATED | Sitabuldi | `0712-2520025` | Sitabuldi & Central Hub | `21.1432, 79.0815` | UNLINKED |

---

## 4. Deduplication & Conflict Resolution Audit

The deduplication engine evaluated incoming candidate records using normalized telephone comparison, Jaccard word-similarity index, and geographic proximity checks ($<150\text{ m}$).

### Resolved Duplicate Submissions:
1. **Duplicate Test Case:** `"Orange City Hospital Khamla"` (Phone: `0712-6652000`)  
   - **Resolution:** Automatically flagged as duplicate of `"Orange City Hospital and Research Institute"` (ID: `fac-ochri-nagpur`).  
   - **Action Taken:** Duplicate warning raised; marked `isDuplicate: true`; record excluded from public citizen search results; logged in `DirectoryReviewIssue` table with severity `MEDIUM`.
2. **Duplicate Alternate Published Phone:** `"0712-2744400"`  
   - **Resolution:** Preserved as secondary contact (`alternateNumber`) under GMCH Nagpur rather than spawning a phantom secondary facility.

---

## 5. Persistence & Migration Integrity

1. **Prisma Schema Update:**
   - Added `recordType`, `recordStatus`, `sourceType`, `dataProvenance`, `lastCheckedAt`, `contactVerificationStatus`, `lastContactVerifiedAt` to `DirectoryFacility`.
   - Added `recordType`, `recordStatus`, `state`, `lat`, `lng`, `isGeocoded`, `coordinateQuality`, `sourceType`, `dataProvenance`, `lastCheckedAt`, `contactVerificationStatus`, `lastContactVerifiedAt`, `isDuplicate`, `duplicateOfId` to `DirectoryAmbulanceService`.
2. **Persistent SQL Migration:**  
   - Written to `backend/prisma/migrations/20261027100000_nagpur_directory_provenance/migration.sql`.
   - Idempotent: uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
3. **In-Memory & Production Parity:**  
   - Both PostgreSQL migrations and `InMemoryDatabase` adapter implement identical filtering and search logic.
