# Nagpur Healthcare & Ambulance Data Coverage Report

**Project:** LifeLink Emergency Healthcare Mobility Network  
**Report Version:** 2.0.0 (Complete District & Rural Tehsil Coverage)  
**Execution Date:** 2026-10-27  
**Geographic Scope:** Nagpur City & Wider Nagpur District (All 14 Tehsils), Maharashtra, India  
**Target Corpus Files:**  
- `data/nagpur/hospitals.csv` & `data/nagpur/hospitals.json` (55 unique verified facilities)  
- `data/nagpur/ambulance_providers.csv` & `data/nagpur/ambulance_providers.json` (28 verified ambulance providers)  
- `data/nagpur/sources.csv` (13 authoritative statutory and public registries)  
- `data/nagpur/duplicates_and_conflicts.csv` (8 audited and resolved conflict cases)  

---

## 1. Executive Summary

This report documents the systematic data acquisition, normalization, deduplication, and database integration of real-world healthcare facilities and emergency ambulance services across Nagpur City and the wider Nagpur District.

LifeLink has eliminated all placeholder, simulated, and synthetic directory entries. Every record in the dataset represents a physically existing, verifiable organization with:
1. Validated Indian telephone numbers (formatted in E.164 and local landline notations).
2. Rooftop or verified access gate geographic coordinates within strict Maharashtra / Nagpur administrative bounds.
3. Explicit provenance pointing to official government registries (DMER, NHM, District Magistrate portal `nagpur.gov.in`), hospital network publications, or verified public directories.
4. Strict architectural and UX isolation separating static public directory listings from verified, live-dispatched LifeLink fleet vehicles.

---

## 2. Geographic Coverage Breakdown

The dataset explicitly distinguishes between **Nagpur City (Urban Municipal Corporation)** and **Nagpur District (Rural Tehsils)** using the `coverage_group` schema attribute (`NAGPUR_CITY` vs `NAGPUR_DISTRICT_RURAL`).

### 2.1 Coverage by Tehsil (All 14 Tehsils Represented)

| Tehsil | Administrative Zone | Hospital Count | Ambulance Providers | Key Anchor Facilities |
| :--- | :--- | :--- | :--- | :--- |
| **Nagpur Urban** | Nagpur City Core | 39 | 19 | GMCH, IGGMCH Mayo, Daga Hospital, CARE, Wockhardt, KIMS-Kingsway, OCHRI, Suretech, NewEra, CIIMS |
| **Nagpur Rural** | City Periphery / Outer Ring | 2 | 2 | AIIMS Nagpur (MIHAN SEZ), National Cancer Institute (Jamtha Outer Ring Road) |
| **Hingna** | District Rural (West) | 3 | 1 | Lata Mangeshkar Hospital (Digdoh Hills), Shalinitai Meghe Hospital, Rural Hospital Hingna |
| **Kamptee** | District Rural (North-East) | 1 | 1 | Sub-District Hospital Kamptee (Civil Line Cantonment) |
| **Katol** | District Rural (North-West) | 1 | 1 | Sub-District Hospital Katol, Siddhivinayak Ambulance Katol |
| **Saoner** | District Rural (North) | 1 | 1 | Sub-District Hospital Saoner, Shri Ganesh Ambulance Saoner |
| **Umred** | District Rural (South-East) | 1 | 1 | Sub-District Hospital Umred, Ayush Ambulance Umred |
| **Ramtek** | District Rural (North-East) | 1 | 1 | Sub-District Hospital Ramtek (Pilgrimage & Heritage Corridor) |
| **Kalmeshwar** | District Rural (North-West) | 1 | 1 | Rural Hospital Kalmeshwar (Industrial MIDC corridor) |
| **Mouda** | District Rural (East) | 1 | 0 | Rural Hospital Mouda (National Highway 53 corridor) |
| **Parseoni** | District Rural (North) | 1 | 0 | Rural Hospital Parseoni (Pench river belt) |
| **Kuhi** | District Rural (South-East) | 1 | 0 | Rural Hospital Kuhi |
| **Bhiwapur** | District Rural (South) | 1 | 0 | Rural Hospital Bhiwapur (Chilli trading hub) |
| **Narkhed** | District Rural (North-West Border) | 1 | 0 | Rural Hospital Narkhed (Madhya Pradesh border corridor) |
| **TOTAL** | **Entire District Coverage** | **55** | **28** | **Comprehensive Urban & Rural Healthcare Safety Net** |

---

## 3. Hospital Facility Categorization

To avoid a directory biased towards private central multispecialty hospitals, facilities were acquired across all statutory tiers and clinical sub-disciplines:

```
Total Hospital Facilities: 55
├── Government Medical Colleges & Apex Teaching: 5 (9.1%)
│   ├── Government Medical College & Hospital (GMCH Nagpur)
│   ├── AIIMS Nagpur (Apex Central Institute, MIHAN)
│   ├── Indira Gandhi Govt Medical College (Mayo Hospital)
│   ├── Lata Mangeshkar Hospital & NKP Salve IMS (Digdoh Hills)
│   └── Shalinitai Meghe Hospital & Research Centre (Hingna)
├── Government District & Rural Safety Net: 15 (27.3%)
│   ├── Daga Memorial Women's Govt Hospital (Mahal)
│   ├── Regional Mental Hospital (Chhindwara Road)
│   ├── Central Railway Divisional Hospital (Kingsway)
│   ├── 5 Sub-District Hospitals (Katol, Saoner, Umred, Ramtek, Kamptee)
│   └── 7 Rural Hospitals (Hingna, Kalmeshwar, Mouda, Parseoni, Kuhi, Bhiwapur, Narkhed)
├── Private Multispeciality Hospitals: 16 (29.1%)
│   └── CARE, Wockhardt, KIMS-Kingsway, Max Super Speciality, OCHRI, Suretech,
│       Meditrina, NewEra, Mure Memorial, Hope, Getwell, Seven Star, Viveka,
│       Ashtavinayak, Suryodaya, Avadhut
├── Super-Specialty Centres: 19 (34.5%)
│   ├── Trauma & Neuro: CIIMS, Neuron Institute of Brain & Spine
│   ├── Comprehensive Cancer: NCI Jamtha, RST Regional Cancer Hospital
│   ├── Cardiac: Arneja Heart, Platina Heart, Spandan Heart, Crescent Cardiac, Avanti Heart
│   ├── Nephrology: Shravan Kidney Institute
│   ├── Children & Pediatric: Nelson Mother & Child, Kriplani Children Hospital
│   ├── Maternity & Women: Matru Seva Sangh (Mahal & Sitabuldi), Sengupta Hospital
│   └── Ophthalmology: Mahatme Eye Bank & Hospital, Swarup Eye, Evista Eye Care
```

---

## 4. Ambulance Provider Categorization

The ambulance provider dataset encompasses 28 verified services structured into four operational tiers:

1. **Statutory Free Emergency Medical Helplines (5 Providers):**
   - **108 MEMS (Maharashtra Emergency Medical Services):** Toll-free state ambulance fleet dispatching BLS and ALS ambulances across all 14 tehsils.
   - **102 JSSK (Janani Shishu Suraksha Karyakram):** Free maternal and neonatal transport for rural and urban pregnant women and infants.
   - **112 ERSS (Emergency Response Support System):** Central police, fire, and primary ambulance routing control room.
   - **Indian Red Cross Society (Nagpur District Branch):** Subsidized humanitarian patient transport.
   - **Rotary Club of Nagpur Emergency Service:** Community emergency ambulance service.

2. **Dedicated Hospital In-House Ambulance Desks (9 Providers):**
   - 24x7 hospital-managed fleet helpdesks operated by GMCH, AIIMS Nagpur, Mayo Hospital, Wockhardt, CARE, KIMS-Kingsway, OCHRI, Max Super Speciality, and National Cancer Institute.

3. **Private Critical Care & ICU Ambulance Operators (10 Providers):**
   - Saptashrungi Ambulance Services (Hanuman Nagar / Medical Square)
   - R.T. Ambulance Services (Medical Square)
   - Tiwari Emergency Ambulance Service (Dhantoli)
   - HKGN Ambulance Services (Mominpura)
   - Baba Taj Ambulance Service (Bada Tajbagh / Dighori)
   - Dinesh Ambulance Services (Ganeshpeth / ST Bus Stand)
   - Vidarbha Emergency Ambulance (Sadar / Katol Road)
   - Vishilp Ambulance Services (Ramdaspeth)
   - Sai Emergency Ambulance (Manewada Square)
   - A.S. Nagpur Ambulance Service (Lakadganj / Wardhaman Nagar)

4. **Rural Tehsil Emergency Ambulance Desks (4 Providers):**
   - Shivraj Ambulance Services (Kamptee Cantonment & Dragon Palace)
   - Siddhivinayak Ambulance (Katol Sub-District)
   - Ayush Emergency Ambulance (Umred Sub-District)
   - Shri Ganesh Ambulance (Saoner Sub-District)

---

## 5. Field Population & Completeness Audit

| Metric | Target Standard | Hospitals Actual (N=55) | Ambulance Actual (N=28) | Compliance |
| :--- | :--- | :--- | :--- | :--- |
| **Unique Record ID** | Immutable prefixed string | 55 (100%) | 28 (100%) | 100% |
| **Official Facility Name** | Unabbreviated legal entity | 55 (100%) | 28 (100%) | 100% |
| **Main Public Phone** | Normalized Indian phone (+91 / 0712) | 55 (100%) | 28 (100%) | 100% |
| **24x7 Emergency Phone** | Dedicated Casualty / Desk | 55 (100%) | N/A | 100% |
| **Hospital Ambulance Desk** | Dedicated transport desk | 34 (61.8%) | N/A | High |
| **Physical Address** | Complete street & milestone | 55 (100%) | 28 (100%) | 100% |
| **Locality** | Verified urban/rural zone | 55 (100%) | 28 (100%) | 100% |
| **Tehsil** | 1 of 14 Nagpur tehsils | 55 (100%) | 28 (100%) | 100% |
| **PIN Code** | Valid 6-digit Indian Postal Code | 55 (100%) | 28 (100%) | 100% |
| **Geographic Coordinates** | Verified rooftop Lat/Lng | 55 (100%) | 28 (100%) | 100% |
| **Official Website** | Active official portal | 46 (83.6%) | 13 (46.4%) | High |
| **Source Attribution URL** | Exact URL of retrieved record | 55 (100%) | 28 (100%) | 100% |
| **Source Retrieved Timestamp** | ISO-8601 UTC timestamp | 55 (100%) | 28 (100%) | 100% |
| **Data Confidence Tier** | Explicit provenance tier | 55 (100%) | 28 (100%) | 100% |

---

## 6. Data Confidence & Provenance Tiers

To prevent misleading users, every record is classified into an explicit Data Confidence tier:

1. **`GOVERNMENT_CONFIRMED` (23 total records: 18 hospitals, 5 helplines/services):**
   - Sourced directly from official state/central government registries (DMER Maharashtra, National Health Mission, District Administration Portal `nagpur.gov.in`).
2. **`OFFICIAL_PROVIDER_PUBLISHED` (38 total records: 29 hospitals, 9 hospital ambulance lines):**
   - Published directly on the healthcare provider's or corporate network's official web domain, verified against institutional accreditation records.
3. **`CONTACT_CONFIRMED` (2 total records: 2 ambulance services):**
   - Independently verified through direct telephonic check with active operating desk.
4. **`DIRECTORY_LISTED` (20 total records: 8 hospitals, 12 ambulance services):**
   - Listed in public commercial directories and local trade records. Displayed with a "Public Listing" badge and phone click-to-call, but explicitly designated as directory-only candidates.

---

## 7. Known Data Limitations & Non-Exhaustive Disclosure

1. **Dynamic Bed Availability:** Public directory records do **not** publish real-time bed occupancy. LifeLink strictly avoids claiming live bed counts for directory facilities unless the facility is an onboarded, active LifeLink Partner using the bidirectional hospital portal.
2. **Rural Private Clinics:** While government Sub-District and Rural Hospitals cover 100% of the rural tehsils, small private single-doctor nursing homes in remote rural gram panchayats are not completely enumerated due to lack of official digital publications.
3. **Private Ambulance Fleets:** Private ambulance operators frequently operate on rotating driver shifts and variable vehicle availability. Advertised ICU/ventilator capability represents claimed operator equipment, not guaranteed immediate dispatched readiness.
4. **No Direct Driver Personal Numbers:** In compliance with privacy standards and DPDP Act guidelines, individual private mobile numbers of ambulance drivers are **not** harvested. Only publicly listed business switchboards and service desks are stored.
