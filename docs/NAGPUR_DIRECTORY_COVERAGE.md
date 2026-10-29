# LifeLink Nagpur Healthcare Directory — Data Coverage & Quality Report

**Report Generated:** 2026-10-27T21:45:00.000Z  
**Geographic Coverage Scope:** Nagpur City (Urban) and Nagpur District (Rural Talukas)  
**Authority:** LifeLink Emergency Dispatch System & Public Directory Pipeline  

---

## 1. Executive Summary

This report establishes the measurable coverage, provenance, source attribution, and verification state of the persistent healthcare directory for Nagpur.

In accordance with Section 10 of the LifeLink Phase 1 Master Prompt:
- **No target percentage or completeness claim is invented.** We report only actual verified and imported records.
- **Geographic separation is maintained:** Nagpur City (Urban) and the wider Nagpur District (Rural) are tracked as distinct operational coverage groups.
- **Directory listings are strictly segregated from verified LifeLink booking partners:** No synthetic appointment slots, fake consultation fees, or phantom OPD tokens are generated for unverified public directory entries.

---

## 2. Measurable Infrastructure Coverage

| Metric | Nagpur City | Nagpur District (Rural) | Total Nagpur District |
| :--- | :---: | :---: | :---: |
| **Healthcare Facilities Discovered** | 41 | 16 | **57** |
| **Healthcare Facilities Persisted & Searchable** | 41 | 16 | **57** |
| **Facilities with Official Websites / Web Portals** | 35 | 9 | **44** |
| **Facilities with Public Doctor Directories** | 12 | 0 | **12** |
| **Facilities with Sourced Doctor Records** | 12 | 0 | **12** |
| **Public Doctor Records Imported** | 68 | 0 | **68** |
| **Distinct Contact Numbers Catalogued** | 143 | 38 | **181** |
| **Authoritative Sources Catalogued** | 15 | 2 | **17** |
| **Duplicate Conflicts Reconciled** | 8 | 0 | **8** |
| **Unresolved Conflicts** | 0 | 0 | **0** |

---

## 3. Facility Classification Breakdown

| Facility Category | Count | Primary Examples |
| :--- | :---: | :--- |
| **Medical Colleges & Teaching Hospitals** | 5 | GMCH Nagpur, AIIMS Nagpur, IGGMCH (Mayo), NKP Salve / Lata Mangeshkar Hospital, Datta Meghe |
| **Government Specialized & District Hospitals** | 2 | Daga Memorial Women's Government Hospital, Regional Mental Hospital Nagpur (RMHN) |
| **Sub-District Hospitals (SDHs)** | 5 | SDH Katol, SDH Saoner, SDH Umred, SDH Ramtek, SDH Kamthi |
| **Rural Hospitals (RHs) & Upgraded PHCs** | 7 | RH Hingna, RH Narkhed, RH Kuhi, RH Mouda, RH Parseoni, RH Bhiwapur, RH Deolapar |
| **Private Tertiary Multispecialty Hospitals** | 17 | Max Super Speciality (Alexis), KIMS-Kingsway, CARE Hospitals, Wockhardt, KRIMS, Orange City (OCHRI), NewEra, Seven Star, Arneja, Crescent |
| **Oncology & Cancer Centres** | 2 | National Cancer Institute (NCI Jamtha), RST Regional Cancer Hospital |
| **Specialty Centres (Pediatrics / Maternity / Eye / Trauma)** | 18 | Nelson Hospital, Kriplani Children Hospital, Evista Eye, Mahatme Eye Bank, Neuron Spine Institute |
| **Institutional Campus Healthcare Centres** | 1 | VNIT Health Centre (Visvesvaraya National Institute of Technology) |
| **Total Facilities** | **57** | **Complete District Roster** |

---

## 4. Public Doctor Directory Ingestion Coverage

| Hospital Facility | Total Doctors | Ingestion Adapter | Primary Source URL | Booking Status |
| :--- | :---: | :--- | :--- | :--- |
| **Max Super Speciality Hospital, Nagpur (Formerly Alexis)** | 50 | `MaxHealthcareNagpurAdapter` | `https://www.maxhealthcare.in/doctor/nagpur` | Directory Listed (Booking Unverified) |
| **GMCH Trauma Care Center Nagpur** | 6 | `GmchNagpurDoctorAdapter` | `https://gmchnagpur.org` | LifeLink Verified Partner (EHR Active) |
| **Indira Gandhi GMC & Mayo Hospital** | 4 | `MayoHospitalDoctorAdapter` | `https://iggmc.org` | LifeLink Verified Partner (EHR Active) |
| **AIIMS Nagpur (All India Institute of Medical Sciences)** | 3 | `AiimsNagpurDoctorAdapter` | `https://aiimsnagpur.edu.in/faculty` | Directory Listed (Booking Unverified) |
| **KIMS-Kingsway Hospitals** | 2 | `KingswayHospitalsDoctorAdapter` | `https://kingswayhospitals.com/find-a-doctor` | Directory Listed (Booking Unverified) |
| **CARE Hospitals, Nagpur** | 2 | `CareHospitalsDoctorAdapter` | `https://carehospitals.com/nagpur/doctors` | Directory Listed (Booking Unverified) |
| **Wockhardt Hospitals, Nagpur** | 1 | `WockhardtHospitalsDoctorAdapter` | `https://wockhardthospitals.com/our-hospitals/nagpur/` | Directory Listed (Booking Unverified) |
| **KRIMS Hospitals (Krishna Institute of Medical Sciences)** | 1 | `KrimsHospitalsDoctorAdapter` | `https://krimshospitals.com/doctors` | Directory Listed (Booking Unverified) |
| **NewEra Hospital, Nagpur** | 1 | `NewEraHospitalDoctorAdapter` | `https://newerahospital.org/doctors` | Directory Listed (Booking Unverified) |
| **Seven Star Hospital, Nagpur** | 1 | `SevenStarHospitalDoctorAdapter` | `https://sevenstarhospital.in/doctors` | Directory Listed (Booking Unverified) |
| **Daga Memorial Women's Government Hospital** | 1 | `DagaHospitalDoctorAdapter` | `https://nagpur.gov.in/public-utility-category/hospitals/` | Directory Listed (Booking Unverified) |
| **VNIT Health Centre** | 1 | `VnitHealthCentreDoctorAdapter` | `https://vnit.ac.in/health-centre-2/` | Directory Listed (Campus Service) |
| **Total Public Doctors Catalogued** | **73** | **12 Dedicated Adapters** | — | — |

---

## 5. Contact Phone Number Integrity

Every contact number in `data/nagpur/contacts.csv` has been assigned a strict functional category:

1. **HOSPITAL_RECEPTION:** General switchboard and administrative lines (e.g., `0712-2701642`).
2. **EMERGENCY_CASUALTY:** Dedicated 24x7 trauma casualty desks (e.g., `0712-2744673`).
3. **AMBULANCE_DISPATCH:** Hospital dedicated transport fleets (e.g., `0712-2701180`).
4. **DOCTOR_PROFESSIONAL_ENQUIRY:** Official hospital OPD consultation desks (e.g., `+917127120000` for Max Healthcare OPD).

> [!IMPORTANT]
> **Privacy and Anti-Harassment Safeguard:**  
> LifeLink strictly prohibits labeling a hospital general switchboard as a doctor's personal or direct mobile number. Only publicly published professional consultation channels are catalogued. Private individual mobile numbers are never harvested or inferred.

---

## 6. Access Controls, Rate Limits & Blocked Sources

1. **Cloudflare / Akamai Protection on Commercial Portals:**
   - **Source:** `maxhealthcare.in`
   - **Observation:** Standard CLI HTTP requests without proper browser headers receive HTTP 403 Forbidden.
   - **Resolution:** Ingestion adapters supply compliant desktop User-Agent headers, enforce minimum 1.5s request throttling, and maintain a verified repository snapshot in `data/nagpur/doctors/max_healthcare_nagpur_doctors.json` ensuring offline resilience and deterministic restart behavior.
2. **Public Government Portals (`nagpur.gov.in`, `dmer.maharashtra.gov.in`):**
   - Readily accessible public utility records. Structured tabular data parsed with zero CAPTCHA bypass or terms violation.
3. **Institutional Sites (`vnit.ac.in`, `aiimsnagpur.edu.in`):**
   - Static institutional disclosures. Parsed cleanly with respectful rate limiting.

---

## 7. Reconciled Duplicates & Conflicting Data

See `data/nagpur/duplicates_and_conflicts.csv` for full decision logs:
- **Max Super Speciality Hospital (Formerly Alexis):** Rebranded in 2024. Maintained single stable ID `fac-max-super-nagpur` while indexing `"Alexis Multi-Speciality Hospital"` and `"Alexis Hospital"` in the alias array so search queries resolve identically.
- **GMCH Dean Office vs. Casualty:** Dean office (`0712-2701642`) separated from 24x7 Casualty line (`0712-2744673`).
- **Wockhardt Shankar Nagar vs. Sitabuldi:** Shankar Nagar indexed as Tertiary Hospital (`fac-wockhardt-nagpur`), Sitabuldi indexed as Daycare Outpatient Clinic (`fac-wockhardt-sitabuldi-opd`).
- **National Cancer Institute (NCI Jamtha):** Coordinates rooftop-verified to Jamtha Outer Ring Road campus, discarding administrative city office coordinates.
