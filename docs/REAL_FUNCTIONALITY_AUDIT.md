# LifeLink 2.0 — Real Functionality Recovery Audit Report
**Date:** 2026-10-27  
**Author:** Principal Full-Stack & Database Reliability Engineering Team  
**Scope:** Root-to-Leaf Audit of Frontend, Backend, Database Adapters, Network Protocols, and Nagpur Pilot Integration  

---

## 1. Executive Summary & Diagnostic Verdict

An exhaustive, line-by-line inspection of the LifeLink repository was conducted across frontend components, backend controllers, Prisma schemas, in-memory/PostgreSQL database adapters, Socket.IO channels, and all 25 automated test suites (comprising 365+ assertions). 

The automated test suites in `backend/tests` all pass (exit code 0 across 25 suites), confirming that backend algorithmic business rules (dispatch candidate ranking, DPDP redaction, Haversine bounds, token hashing, and audit logging) are implemented correctly. However, **end-to-end user-facing functionality in the browser was broken due to critical disconnects between the frontend and backend, seed data omissions, and missing environment configuration.**

### Authoritative Architecture & Data Mode Classification
The application operates in **Category F (A Mixture of Persistent Database & In-Memory Development Adapter with Unconnected Frontend Handlers)**:
- **Backend Architecture:** Express + Prisma ORM with a dynamic proxy in `backend/src/db.ts` that automatically falls back to `InMemoryDatabase` when PostgreSQL is not connected or when `USE_IN_MEMORY_DB="true"`.
- **Frontend Architecture:** React 19 + Vite 8 + Leaflet + TailwindCSS + Socket.IO client.
- **The Core Disconnect:** The backend works in isolation during unit/integration tests, but real browser execution failed because:
  1. Frontend lacked `frontend/.env` and `vite.config.ts` lacked API reverse proxy rules.
  2. Public/shared pages (`PublicEmergencyMedicalId.tsx`, `PublicTripShare.tsx`) attempted relative `fetch('/api/v1/...')` calls against port 5173 instead of port 5000.
  3. API payload shape mismatches (e.g. `GET /api/ambulances/nearby` returns `Array`, but frontend checked `res.ambulances`).
  4. Seed data omissions in `seedDefaultDevData()` (`isActive` missing on Doctor, zero DoctorSlots, missing `driverId` on Ambulance models, bed count mismatches).

---

## 2. Granular Defect Analysis by Functional Area

### A. Doctor Appointments & OPD Scheduling
- **Observed Behavior:** Patient clicks "Book Doctor Appointment", selects a hospital in Nagpur, but "No doctors listed for the selected hospital" is permanently shown. Even if a doctor were found, no slots could be booked.
- **Root Cause & Exact File Locations:**
  1. `backend/src/db.ts` (lines 330–345): The only seeded doctor (`Dr. Rajesh Sharma` at GMCH) was created with `isAvailable: true` instead of `isActive: true`. In `backend/src/routes/doctors.ts` (line 37), the query filters with `where: { isActive: true }`. Because `isActive` was undefined on the in-memory record, he was filtered out.
  2. `backend/src/db.ts` (lines 70–350): No doctors were seeded for Mayo Hospital (`hosp-mayo-nagpur`) or any other Nagpur medical centers.
  3. `backend/src/db.ts`: **Zero `DoctorSlot` records were ever seeded** in `seedDefaultDevData()`. Thus, even if a doctor was returned, `GET /api/doctors/:id/slots` returned `slots: []`, preventing slot selection and token generation.
- **Impact:** Critical blocker for the entire appointment booking and OPD consultation workflow.

---

### B. Emergency SOS & Ambulance Dispatch Lifecycle
- **Observed Behavior:** Triggering Emergency SOS stays indefinitely in "Searching for nearest ambulance..." or fails with watchdog timeout ("Server did not confirm emergency dispatch within 8 seconds").
- **Root Cause & Exact File Locations:**
  1. `backend/src/db.ts` (lines 198–231): In `seedDefaultDevData()`, `ambGmch` and `ambApex` did not have `driverId` set on the `Ambulance` records (only a separate `driverVehicleAssignments` record was created).
  2. `backend/src/socket.ts` (lines 562–574): The socket handler for `sos:trigger` extracted candidate drivers via:
     ```ts
     const candidateDriverIds = sortedNearbyDrivers
       .map((item: any) => item.amb.driverId)
       .filter((id: any): id is string => !!id);
     ```
     Because `amb.driverId` was undefined on the seeded ambulances, `candidateDriverIds` was always `[]` (empty array). No offers were ever dispatched to any driver.
  3. `backend/src/routes/sos.ts` (lines 54–67): Out-of-area checks strictly require coordinates within 30km of Nagpur Pilot Zone (21.1458, 79.0882). When users outside Nagpur test the app, they receive `OUTSIDE_SERVICE_AREA`. An explicit manual pin/Nagpur pilot coordinate selector and an isolated, transparent simulation mode are needed.

---

### C. Live Maps & GPS Telemetry Display
- **Observed Behavior:** Patient map displays no nearby ambulances.
- **Root Cause & Exact File Locations:**
  1. `backend/src/routes/ambulances.ts` (lines 411–446): `GET /api/ambulances/nearby` returns `res.json(nearby)` (a JSON array `[...]`).
  2. `frontend/src/pages/PatientDashboard.tsx` (line 497): Frontend expects `{ ambulances: [...] }`:
     ```ts
     const res = await apiFetch(`/ambulances/nearby?lat=${lat}&lng=${lng}&radiusKm=35`);
     setNearbyAmbulances(res.ambulances || []);
     ```
     Because `res` is an array, `res.ambulances` is `undefined`, and `nearbyAmbulances` is permanently set to `[]`.
  3. `frontend/src/pages/PatientDashboard.tsx` (line 1740): The map only passed `ambulances={hospitalAmbulances}`. Before a specific hospital is selected, `hospitalAmbulances` is `[]`, completely ignoring `nearbyAmbulances`.
  4. `frontend/src/pages/PublicEmergencyMedicalId.tsx` (line 49) & `frontend/src/pages/PublicTripShare.tsx` (line 164): Relative `fetch('/api/v1/...')` calls were made without routing through `API_URL` or a Vite dev proxy, failing against port 5173.

---

### D. Hospital Bed Capacities & Freshness
- **Observed Behavior:** Hospital bed cards display stale warnings or 0 available beds.
- **Root Cause & Exact File Locations:**
  1. `backend/src/db.ts` (lines 118–120): GMCH was declared with `availableBeds: 45, totalBeds: 150`, but only 5 bed records (`ER-01`, `ER-02`, `ICU-01`, `TR-01`, `GW-101`) were seeded in `hospitalBeds`. Mayo Hospital had `totalBeds: 100, availableBeds: 28` but 0 bed records.
  2. `backend/src/routes/hospitals.ts` (lines 680–686): In `calculateHospitalCapacityPayload()`, if `beds.length === 0`, `availableBeds` was computed from `beds.filter(b => b.status === BedStatus.AVAILABLE).length`, producing `0`, overriding the hospital model counts.
  3. `backend/src/routes/hospitals.ts` (lines 26–131): `ensureHospitalBeds()` existed to seed realistic wards (ICU, Trauma, General, Pediatric, Surgical), but was never called in `GET /capacities`.
  4. Static timestamp: `capacityLastUpdated: new Date()` at server startup meant that after 30 minutes of runtime, all records became `isStale: true` without an authorized one-tap refresh mechanism.

---

### E. Patient Medical Profile & Emergency Medical ID
- **Observed Behavior:** Public QR safety card fails to load patient data or throws JSON parsing errors.
- **Root Cause & Exact File Locations:**
  1. `frontend/src/pages/PublicEmergencyMedicalId.tsx` (line 49): `fetch('/api/v1/emergency-profile/qr-card/${token}')` attempted relative fetch on Vite server (5173) instead of Express (5000).
  2. `frontend/src/pages/PublicEmergencyMedicalId.tsx` (line 75): Used `localStorage.getItem('token')` instead of the application's standard `'lifelink_token'`.
  3. DPDP consent withdrawal: Missing synchronized client state update when consent is revoked.

---

### F. Clinical Report Analyzer & Specialist Queue
- **Observed Behavior:** Report analysis does not clearly indicate whether it is rule-based or AI-driven; queue registration allows multiple entries for the same specialty without a distinct queue token.
- **Root Cause & Exact File Locations:**
  1. `backend/src/routes/health.ts` (lines 50–180): Uses clinical regex extractors with physiological bounds, but lacks clear UI provenance badges distinguishing rule-based extraction from Google Gemini models.
  2. `backend/src/routes/queue.ts` (lines 43–82): Does not check for existing active queue entries for the same patient/hospital/specialty, allowing duplicate clicks to register multiple tokens.

---

### G. Persistent Notifications & Status Indicators
- **Observed Behavior:** "Server Connected" / "Live" badge appears based on default state without verifying connection on mount.
- **Root Cause & Exact File Locations:**
  1. `frontend/src/hooks/useNetworkStatus.ts` (lines 20–21): Initial state `isServerReachable: true` is assumed before `checkConnection()` is ever invoked on component mount.
  2. Missing `checkConnection()` on mount meant disconnected backend states were not immediately surfaced to the user.

---

## 3. Systematic Repair Plan

| Phase | Component | Repair Action | Files to Modify |
|---|---|---|---|
| **Phase 2** | Data Foundation & Config | Add `frontend/.env`, configure Vite proxy in `frontend/vite.config.ts`, seed full doctor roster, slots, and vehicle assignments in `backend/src/db.ts` | `frontend/.env`, `frontend/vite.config.ts`, `backend/src/db.ts` |
| **Phase 3** | SOS & Dispatch | Fix `driverId` assignment on ambulances, ensure candidate drivers receive offers, add explicit Nagpur pilot coordinates picker and simulated dispatch testing mode | `backend/src/socket.ts`, `backend/src/db.ts`, `frontend/src/pages/PatientDashboard.tsx` |
| **Phase 4** | Maps & GPS | Fix `res.ambulances` vs `Array` handling, pass available ambulances to `LeafletMap`, fix relative API fetches in public pages | `frontend/src/pages/PatientDashboard.tsx`, `backend/src/routes/ambulances.ts`, `frontend/src/pages/PublicEmergencyMedicalId.tsx`, `frontend/src/pages/PublicTripShare.tsx` |
| **Phase 5** | Doctor Appointments | Ensure `isActive: true` on doctors, seed realistic OPD slots for today/upcoming dates, link doctors to GMCH & Mayo | `backend/src/db.ts`, `backend/src/routes/doctors.ts`, `frontend/src/components/patient/BookAppointmentSection.tsx` |
| **Phase 6** | Hospital Bed Data | Ensure `GET /capacities` maintains consistent bed totals and ward counts, populate realistic beds for all linked hospitals, add refresh action | `backend/src/routes/hospitals.ts`, `backend/src/db.ts`, `frontend/src/pages/PatientDashboard.tsx` |
| **Phase 7** | Medical Profile & QR ID | Fix auth token keys, route public QR card through API URL, verify DPDP consent | `frontend/src/pages/PublicEmergencyMedicalId.tsx`, `backend/src/routes/emergencyProfile.ts` |
| **Phase 8** | AI Analyzer & Queue | Prevent duplicate queue registrations, add unique queue reference tokens, label analysis provenance | `backend/src/routes/queue.ts`, `frontend/src/pages/PatientDashboard.tsx` |
| **Phase 9** | Status Indicators | Call `checkConnection()` on mount in `useNetworkStatus`, reflect real health probe latency | `frontend/src/hooks/useNetworkStatus.ts`, `frontend/src/components/ui/NetworkStatusIndicator.tsx` |
| **Phase 10 & 11** | Honest Demo Mode | Separate DEMO records from verified live fleet with clear visual badges | Frontend & Backend components |
| **Phase 12** | Verification | Run full test suite, type-check, and document results in `FUNCTIONALITY_REPAIR_MATRIX.md` and `END_TO_END_TEST_RESULTS.md` | `docs/*` |
