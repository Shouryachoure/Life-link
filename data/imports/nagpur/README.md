# Nagpur Healthcare & Ambulance Directory Dataset

**Pilot Region:** Nagpur City and Wider Nagpur District, Maharashtra, India  
**Curated Under:** LifeLink Master Prompt 29  
**Last Verified:** 2026-10-27  
**Compliance Standards:** Truth-in-State, No Hallucinated Phone Numbers, Strict Public vs. Partner Segregation, Zero Paid APIs.

---

## 1. Dataset Overview

This dataset collects structured, verified, publicly listed healthcare facilities and ambulance operators across Nagpur City and the wider Nagpur District.

| File Name | Format | Record Count | Description |
|---|---|---|---|
| `nagpur_hospitals_directory.json` | JSON | 25 | Government, municipal, medical college, and leading private hospitals |
| `nagpur_hospitals_directory.csv` | CSV | 25 | CSV export formatted for spreadsheet review (with CWE-1236 escaping) |
| `nagpur_ambulances_directory.json` | JSON | 12 | Public emergency (108/102/112), hospital-operated, and private fleets |
| `nagpur_ambulances_directory.csv` | CSV | 12 | CSV export of ambulance directory |
| `nagpur_directory_review_needed.json` | JSON | 3 | Flagged records requiring field verification or duplicate resolution |

---

## 2. Field Schema & Provenance Guidelines

### 2.1. Hospital Directory Schema (`DirectoryFacility`)
- `id`: Stable internal identifier (e.g. `fac-gmch-nagpur`).
- `name`: Authoritative public institution name.
- `alternateNames`: Array of colloquial names, abbreviations (e.g. `["GMCH", "Mayo Hospital"]`), and historical brand names.
- `facilityType`: Standardized taxonomy:
  - `MEDICAL_COLLEGE`
  - `GOVERNMENT_HOSPITAL`
  - `GOVERNMENT_SPECIALTY`
  - `MUNICIPAL_HOSPITAL`
  - `SUB_DISTRICT_HOSPITAL`
  - `RURAL_HOSPITAL`
  - `PRIMARY_HEALTH_CENTRE`
  - `PRIVATE_MULTISPECIALTY`
  - `PRIVATE_SPECIALTY`
- `ownership`: `GOVERNMENT_STATE`, `GOVERNMENT_CENTRAL`, `MUNICIPAL`, `PRIVATE_TRUST`, `PRIVATE_CORPORATE`, or `UNKNOWN`.
- `contactNumber`: Normalized landline (`0712-XXXXXXX`), mobile (`+91XXXXXXXXXX`), or emergency shortcode (`108`/`112`).
- `address`: Complete postal address including street, landmark, and postal code.
- `locality`: Neighborhood or suburb (e.g. `Hanuman Nagar`, `Dhantoli`, `Ramdaspeth`, `Kamptee`).
- `city`: Municipality (e.g. `Nagpur`, `Kamptee`, `Katol`, `Ramtek`).
- `district`: Administrative district (`Nagpur`).
- `state`: State (`Maharashtra`).
- `lat` / `lng`: Authoritative rooftop or campus entrance coordinates.
- `coordinateQuality`: `EXACT_ROOFTOP`, `LOCALITY_APPROXIMATE`, or `UNVERIFIED`.
- `sourceUrl`: Official provenance URL where the record was retrieved or cross-verified.
- `verificationStatus`: `VERIFIED`, `PENDING_REVIEW`, `FLAGGED`, or `OUTDATED`.
- `linkStatus`: Strictly `UNLINKED` upon import. **Public directory records are NOT approved LifeLink partners and have NO administrative access or live dispatch integration.**

---

## 3. Data Collection Sources & Verification Methodology

Every record was compiled from official government portals or verified healthcare institution sites:
1. **District Administration Nagpur:** `https://nagpur.gov.in/public-utility-category/hospitals/`
2. **Directorate of Medical Education and Research (DMER Maharashtra):** `https://dmer.maharashtra.gov.in`
3. **Public Health Department Maharashtra:** `https://arogya.maharashtra.gov.in`
4. **Nagpur Municipal Corporation (NMC):** `https://nmcnagpur.gov.in`
5. **National Health Mission (NHM Maharashtra):** `https://nhm.gov.in`
6. **Maharashtra Emergency Medical Services (MEMS 108):** `https://mems108.in`
7. **Emergency Response Support System (ERSS 112):** `https://112.gov.in`
8. **Institutional Websites:** `gmchnagpur.org`, `iggmch.edupdx.in`, `aiimsnagpur.edu.in`, `orangecityhospital.com`, `kingswayhospitals.com`, `wockhardthospitals.com`, `carehospitals.com`, `ncinagpur.in`.

---

## 4. Anti-Duplicate & Normalization Policies

1. **Telephone Deduplication:** Facilities sharing a single landline (e.g., extensions on an EPABX) are audited to confirm if they are separate departments of the same medical complex or distinct facilities.
2. **Rebranding / Mergers:** When a hospital changes ownership (e.g. Alexis Hospital acquired by Max Healthcare), the new brand name is adopted as primary, and the historical name is retained in `alternateNames`.
3. **Co-location Check:** Coordinates within 150 meters with matching names are flagged as duplicates for Super-Admin review.
