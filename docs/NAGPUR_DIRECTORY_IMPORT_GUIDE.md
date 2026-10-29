# LifeLink Nagpur Healthcare Directory — Ingestion Pipeline Guide

This guide describes how to operate, extend, and maintain the LifeLink healthcare and public doctor directory ingestion pipeline.

---

## 1. Architectural Overview

The LifeLink Directory Pipeline is designed around three principles:
1. **Idempotence:** Ingesting the same source multiple times produces zero duplicate records and does not create data churn.
2. **Provenance & Attribution:** Every hospital and doctor record stores the exact source URL, retrieval timestamp, and verification status.
3. **Integrity Invariant:** Public directory listings are strictly segregated from verified LifeLink EHR booking integrations. A doctor record in the directory **never generates synthetic slots** or fake appointment tokens.

---

## 2. Directory Adapter Architecture

Every hospital with an accessible public doctor directory is backed by an implementation of `IDoctorDirectoryAdapter` in `backend/src/services/doctorDirectoryPipelineService.ts`:

```typescript
export interface IDoctorDirectoryAdapter {
  hospitalId: string;
  hospitalName: string;
  sourceUrl: string;
  fetchDoctors(): Promise<PublicDoctorRecord[]>;
}
```

### Implementing a New Hospital Adapter
To add a new hospital to the ingestion pipeline:

1. Create a class implementing `IDoctorDirectoryAdapter`:
   ```typescript
   export class ExampleHospitalDoctorAdapter implements IDoctorDirectoryAdapter {
     hospitalId = 'fac-example-hospital-nagpur';
     hospitalName = 'Example Super Speciality Hospital, Nagpur';
     sourceUrl = 'https://examplehospital.in/doctors';

     async fetchDoctors(): Promise<PublicDoctorRecord[]> {
       // 1. Fetch live page with desktop User-Agent and timeout
       // 2. Parse Schema.org JSON-LD or HTML elements
       // 3. Fallback gracefully to offline verified snapshot
       return loadDoctorsFromDataset(this.hospitalId);
     }
   }
   ```
2. Register the adapter in `DoctorDirectoryPipelineService.constructor()`:
   ```typescript
   this.registerAdapter(new ExampleHospitalDoctorAdapter());
   ```

---

## 3. Contact Classification & Safety Rules

Every imported phone number is catalogued in `data/nagpur/contacts.csv` according to its verified operational role:

| Category | Typical Format | Permitted Uses |
| :--- | :--- | :--- |
| **`HOSPITAL_RECEPTION`** | Landline (`0712-XXXXXXX`) | General enquiry, hospital OPD reception |
| **`EMERGENCY_CASUALTY`** | Dedicated line (`0712-2744673`) | Critical 24x7 trauma care dispatch |
| **`AMBULANCE_DISPATCH`** | Transport desk (`+91 94040 44944`) | Direct ambulance dispatch communication |
| **`DOCTOR_PROFESSIONAL_ENQUIRY`** | Official OPD desk (`+91 712 7120000`) | Professional OPD appointment inquiries |

> [!CAUTION]
> **Prohibited Actions:**
> - Never present a hospital reception or emergency landline as a doctor's personal phone number.
> - Never scrape private individual mobile numbers.
> - Never initiate automated phone calls or unsolicited messages as part of data collection.

---

## 4. Execution & Operational Commands

### A. Run Directory Dataset Compilation
To regenerate canonical CSV and JSON datasets from verified sources:
```bash
cd backend
npx ts-node src/scripts/generateNagpurDirectoryArtifacts.ts
```

### B. Trigger Ingestion via Admin API
Authorized administrators (`SUPER_ADMIN` or `ADMIN_HOSPITAL`) can trigger ingestion dynamically:

- **Ingest specific hospital by ID:**
  ```http
  POST /api/doctors/directory/import
  Authorization: Bearer <SUPER_ADMIN_JWT>
  Content-Type: application/json

  {
    "hospitalId": "fac-max-super-nagpur"
  }
  ```
- **Batch import across all registered adapters:**
  ```http
  POST /api/doctors/directory/import
  Authorization: Bearer <SUPER_ADMIN_JWT>
  Content-Type: application/json

  {}
  ```

### C. Query Ingestion Coverage
To inspect live coverage across all Nagpur facilities:
```http
GET /api/doctors/directory/coverage
```

Response format:
```json
{
  "success": true,
  "city": "Nagpur",
  "totalHospitals": 12,
  "totalHospitalsConfigured": 12,
  "totalDoctorsImported": 73,
  "coveredHospitals": 12,
  "coverage": [...]
}
```

---

## 5. Automated Regression Test Suite

Run the dedicated test suite:
```bash
npm run test:hospital-directory
```

Validates:
1. `"max"` returns Max Super Speciality Hospital, Nagpur.
2. Alias searches (`"Alexis"`, `"Alexis Hospital"`, `"Max Hospital"`, `"Mankapur"`) resolve to `fac-max-super-nagpur`.
3. Idempotent ingestion does not duplicate doctors or facilities.
4. Specialty filters match real persisted records (e.g., `Neurosurgery` at Max).
5. Attempting to book a public directory doctor returns HTTP 400 (`BOOKING_NOT_SUPPORTED_FOR_DIRECTORY_LISTING`).
6. Zero synthetic slots are returned for unverified doctors.
7. Simulated database reboots preserve all doctor records and aliases.
