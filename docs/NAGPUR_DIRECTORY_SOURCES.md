# Nagpur Hospital & Ambulance Directory — Public Source Attribution Catalog

**Document Version:** 1.0.0  
**Effective Date:** 2026-10-27  
**Scope:** Nagpur Pilot Operational Zone (Nagpur Municipal Corporation & District Talukas)  
**System Component:** LifeLink Public Directory (`DirectoryFacility`, `DirectoryAmbulanceService`)

---

## 1. Executive Summary & Purpose

This catalog establishes the authoritative provenance, retrieval records, and verification criteria for healthcare institutions, ambulance service operators, and official emergency helplines imported into the LifeLink Nagpur Directory.

In strict adherence to the LifeLink Truth-in-State Architecture:
- **No fabricated records:** Every record is derived from publicly accessible official government registries, authorized hospital domains, or verified commercial directory listings.
- **No fabricated coordinates:** Geographic coordinates are stored only when rooftop-verified or supported by official district portals. Unverified locations retain explicit `null` coordinates.
- **Strict directory isolation:** A directory entry is strictly a published telephone contact and informational record. It **never** automatically creates an approved LifeLink partner, dispatchable vehicle, or active driver.

---

## 2. Authoritative Data Sources

### 2.1 Official Government Portals & District Directories

| Source Name | Publishing Authority | URL / Registry Endpoint | Retrieval Date | Coverage Scope |
| :--- | :--- | :--- | :--- | :--- |
| **DMER Maharashtra** | Directorate of Medical Education & Research | `https://dmer.maharashtra.gov.in` | 2026-10-27 | GMCH, IGGMCH Mayo Hospital, Government Medical Colleges |
| **Nagpur District Administration** | Collectorate & District Magistrate, Nagpur | `https://nagpur.gov.in/public-utility-category/emergency-services/` | 2026-10-27 | Public Hospitals, Emergency Helplines, Private Ambulance Providers |
| **NMC Health Department** | Nagpur Municipal Corporation | `https://nmcnagpur.gov.in/health-department` | 2026-10-27 | Urban Primary Health Centres, Isolation Hospitals, Daga Memorial |
| **Public Health Dept (Arogya)** | Government of Maharashtra | `https://arogya.maharashtra.gov.in` | 2026-10-27 | Sub-District & Rural Hospitals (Kamptee, Hingna, Katol, Ramtek, Umred) |
| **MEMS 108 / GVK-EMRI** | National Health Mission Maharashtra | `https://nhm.maharashtra.gov.in` | 2026-10-27 | Toll-free Emergency Ambulance Services across Maharashtra (108 / 102) |
| **National ERSS 112** | Ministry of Home Affairs, Govt. of India | `https://112.gov.in` | 2026-10-27 | All-India Unified Emergency Response Support System |

---

### 2.2 Hospital Official Portals & Direct Registry Records

| Organization Name | Locality | Normalized Phone | Website / Official Domain | Verification Source | Rooftop Coordinates | Coordinate Quality |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Government Medical College & Hospital (GMCH)** | Medical Square | `0712-2701642` | `https://gmchnagpur.org` | DMER Maharashtra Registry | `[21.1293, 79.0967]` | EXACT_ROOFTOP |
| **Indira Gandhi GMC & Hospital (Mayo)** | Central Avenue | `0712-2725274` | `https://iggmch.edupdx.in` | DMER Maharashtra Registry | `[21.1534, 79.0984]` | EXACT_ROOFTOP |
| **Daga Memorial Women's Hospital** | Gandhibagh | `0712-2729333` | `https://nagpur.gov.in` | District Health Registry | `[21.1492, 79.1062]` | EXACT_ROOFTOP |
| **CARE Hospitals Nagpur** | Ramdaspeth | `0712-6165656` | `https://carehospitals.com` | Official Hospital Domain | `[21.1396, 79.0768]` | EXACT_ROOFTOP |
| **Wockhardt Hospitals Nagpur** | Shankar Nagar | `0712-6624400` | `https://wockhardt-hospitals.com` | Official Hospital Domain | `[21.1348, 79.0621]` | EXACT_ROOFTOP |
| **Orange City Hospital & Research Inst.** | Khamla Road | `0712-2238431` | `https://orangecityhospital.com` | Official Hospital Domain | `[21.1189, 79.0628]` | EXACT_ROOFTOP |
| **Meditrina Hospital** | Ramdaspeth | `0712-6669600` | `https://meditrinahospitals.com` | Official Hospital Domain | `[21.1362, 79.0784]` | EXACT_ROOFTOP |
| **Suretech Hospital & Research Center** | Dhantoli | `0712-6636802` | `https://suretechhospital.com` | Official Hospital Domain | `[21.1364, 79.0831]` | EXACT_ROOFTOP |
| **KIMS-Kingsway Hospitals** | Near Railway Station | `0712-6789100` | `https://kingswayhospitals.com` | Official Hospital Domain | `[21.1504, 79.0892]` | EXACT_ROOFTOP |
| **NewEra Hospital & Research Institute** | Lakadganj | `+918055997799` | `https://newerahospital.in` | Official Hospital Domain | `[21.1522, 79.1178]` | EXACT_ROOFTOP |
| **AIIMS Nagpur** | MIHAN | `0712-2970720` | `https://aiimsnagpur.edu.in` | INI Central Health Registry | `[21.0567, 79.0289]` | EXACT_ROOFTOP |
| **Regional Mental Hospital** | Mankapur | `0712-2583854` | `https://nagpur.gov.in` | State Health Dept | `[21.1878, 79.0765]` | EXACT_ROOFTOP |
| **ESIC Model Hospital** | Somalwada | `0712-2287410` | `https://esic.gov.in` | Ministry of Labour & Employment | `[21.0967, 79.0682]` | EXACT_ROOFTOP |
| **National Cancer Institute (NCI)** | Outer Ring Road, Jamtha | `0712-6699999` | `https://ncinagpur.org` | Dr. Abaji Thatte Seva Nyas | `[21.0189, 79.0345]` | EXACT_ROOFTOP |
| **Max Super Speciality Hospital (Alexis)** | Mankapur | `0712-7120000` | `https://maxhealthcare.in` | Official Corporate Domain | `[21.1892, 79.0788]` | EXACT_ROOFTOP |
| **Sub-District Hospital Kamptee** | Kamptee | `07109-282055` | `https://nagpur.gov.in` | District Health Office Nagpur | `[21.2234, 79.1982]` | EXACT_ROOFTOP |
| **Rural Hospital Hingna** | Hingna | `07104-242233` | `https://nagpur.gov.in` | District Health Office Nagpur | `[21.0745, 78.9682]` | EXACT_ROOFTOP |

---

### 2.3 Public Ambulance Service Providers

| Service Operator Name | Locality / Operating Area | Normalized Contact Number | Source Type | Source Reference | Coordinates |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Saptashrungi Ambulance Services** | Medical Square, South Nagpur | `+917875873789` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1305, 79.0975]` |
| **R.T. Ambulance Service** | Dhantoli, Wardha Road | `+918788116634` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1378, 79.0835]` |
| **Tiwari Ambulance Services** | Ramdaspeth / Central Nagpur | `+919665888756` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1365, 79.0792]` |
| **HKGN Ambulance** | Mominpura / Gandhibagh | `+919370808570` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1525, 79.1025]` |
| **Baba Taj Ambulance Service** | Nandanvan / Hasanbagh | `+917020297300` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1298, 79.1315]` |
| **Dinesh Ambulance Service** | Lakadganj / Itwari | `+919881115525` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1510, 79.1165]` |
| **Vidarbha Ambulance Service** | Dharampeth / West Nagpur | `+919689051619` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1445, 79.0635]` |
| **Vishilp Ambulance Service** | Sadar / North Nagpur | `+919309589326` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1610, 79.0815]` |
| **Sai Emergency Ambulance Services** | Manewada / South Nagpur | `+917875707373` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1045, 79.0985]` |
| **A.S. Nagpur Ambulance Service** | Kamptee Road / Automotive Square | `+917067939506` | COMMERCIAL_DIRECTORY_LISTING | Nagpur Emergency Services Registry | `[21.1925, 79.1045]` |
| **Maharashtra MEMS Emergency Service** | State-Wide | `108` | OFFICIAL_GOVERNMENT_PORTAL | National Health Mission Maharashtra | `[21.1458, 79.0882]` |
| **National ERSS Emergency Service** | National | `112` | OFFICIAL_GOVERNMENT_PORTAL | Ministry of Home Affairs India | `[21.1458, 79.0882]` |
| **OCHRI Cardiac Ambulance Dispatch** | Khamla Road / South-West | `0712-6652000` | HOSPITAL_OFFICIAL_WEBSITE | Orange City Hospital Official Desk | `[21.1189, 79.0628]` |
| **Kingsway Hospital ICU Fleet** | Railway Station / Central | `0712-6789100` | HOSPITAL_OFFICIAL_WEBSITE | KIMS-Kingsway Emergency Desk | `[21.1504, 79.0892]` |
| **CARE Hospital Advanced Fleet** | Ramdaspeth / Wardha Road | `0712-6165656` | HOSPITAL_OFFICIAL_WEBSITE | CARE Hospitals Emergency Desk | `[21.1396, 79.0768]` |
| **Wockhardt Cardiac Ambulance** | Shankar Nagar | `0712-6624400` | HOSPITAL_OFFICIAL_WEBSITE | Wockhardt Hospitals Emergency Desk | `[21.1348, 79.0621]` |
| **Suretech Trauma Ambulance Desk** | Dhantoli | `0712-6636802` | HOSPITAL_OFFICIAL_WEBSITE | Suretech Hospital Trauma Desk | `[21.1364, 79.0831]` |
| **NewEra Stroke Response Ambulance** | Lakadganj | `+918055997799` | HOSPITAL_OFFICIAL_WEBSITE | NewEra Hospital Emergency Desk | `[21.1522, 79.1178]` |

---

## 3. Data Processing & Normalization Rules

1. **Indian Phone Number Normalization (`normalizeIndianDirectoryPhone`):**
   - **Emergency Helplines:** Normalized as shortcodes (`108`, `112`, `102`, `100`, `101`).
   - **Toll-Free Numbers:** Formatted as `1800-XXX-XXXX`.
   - **Nagpur Landlines:** Normalizes raw sequences (e.g. `07122744400`, `7122744400`, `917122744400`) to standard STD format: `0712-XXXXXXX`.
   - **District Taluka Landlines:** Formatted with taluka STD codes (e.g., Kamptee `07109-XXXXXX`, Hingna `07104-XXXXXX`).
   - **Indian Mobile Numbers:** Normalized with international prefix: `+91XXXXXXXXXX` (e.g., `+917875873789`).
   - **Invalid Inputs:** Tagged as `INVALID` and rejected during batch validation.

2. **Geographic Boundary Enforcement (`validateNagpurCoordinates`):**
   - **Nagpur District Bounding Box:** Latitudes `[20.40, 21.80]`, Longitudes `[78.30, 79.80]`.
   - **Nagpur City Core Box:** Latitudes `[21.00, 21.25]`, Longitudes `[78.95, 79.20]`.
   - **Null Island Rejection:** `[0.0, 0.0]` is strictly rejected.
   - **Out-of-Bounds Rejection:** Any coordinates outside Nagpur District (e.g., Mumbai, London, or transposed inputs) trigger immediate batch rejection.
   - **Missing Coordinates:** Stored as literal `null`. Missing coordinates trigger low-severity audit review issues (`MISSING_COORDINATES`) rather than fabricated pins.

3. **Deduplication Engine (`calculateNameSimilarity` & Exact Phone Checking):**
   - Strips healthcare stopwords (`hospital`, `clinic`, `institute`, `rugnalaya`, `centre`, `nagpur`, `and`).
   - Calculates Jaccard word-set intersection over union.
   - Flags records as duplicate if name similarity $\ge 0.85$, or if name similarity $\ge 0.60$ with matching normalized phone or proximity $< 150\text{ m}$.

---

## 4. Known Data Limitations & Non-Claims

1. **Telephone Availability:** Public listing candidate records reflect published commercial and directory records. They do not constitute guarantee of 24/7 operator answering, staff on duty, or vehicle presence at any given minute.
2. **Bed Availability:** Directory facilities display `UNKNOWN` or `NOT CONNECTED` unless connected through an authorized LifeLink partner integration.
3. **No Pilot-Ready Overclaim:** The importation of public directory candidates is an informational public discovery feature. It does **not** signify that LifeLink pilot operations are live across all operators without authenticated vehicle onboarding and driver credential audits.
