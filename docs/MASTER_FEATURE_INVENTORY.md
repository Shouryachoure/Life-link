# LIFELINK — MASTER FEATURE INVENTORY

**Project:** LifeLink — Intelligent Emergency Care & Hospital OS (Midnight Builds)  
**Audit Date:** 2026-10-27  
**Scope:** Complete Codebase Feature Inventory (Sections 3.A to 3.N)  
**Cost Model:** ₹0 Mandatory Service Cost (Zero-SaaS Development Baseline)

---

## 1. Inventory Summary

| Domain | Total Features Tracked | Persisted Backend Models | Frontend Routes / Pages | Implementation Status |
|---|---|---|---|---|
| **A. Authentication & Security** | 9 | `User`, `RefreshToken`, `VerificationAuditLog` | `/login`, `/register`, `/admin/login`, `/super-admin/login` | PASS |
| **B. Patient Portal** | 13 | `User`, `PatientProfile`, `EmergencyRequest`, `EmergencyContact` | `/patient` (Dashboard, Profile, SOS, History) | PASS |
| **C. Maps, GPS & Geospatial** | 14 | `Ambulance`, `Hospital`, `ServiceArea`, `EmergencyTrip` | LeafletMap component, interactive radar | PASS |
| **D. Emergency Dispatch & Trips** | 14 | `EmergencyRequest`, `DispatchAttempt`, `EmergencyTrip` | Patient SOS, Driver Accept, Command Center | PASS |
| **E. Hospital & Doctor Operations** | 11 | `Hospital`, `HospitalBed`, `Doctor`, `DoctorSlot`, `Appointment` | `/hospital` (Floor grid, Bookings, Doctors, Queue) | PASS |
| **F. Ambulance & Operator Management** | 10 | `AmbulanceOperator`, `Ambulance`, `DriverProfile`, `DriverVehicleAssignment` | `/operator`, `/driver`, Super Admin Fleet | PASS |
| **G. Super-Admin Command Center** | 11 | All models + `ActivityLog`, `VerificationAuditLog` | `/super-admin` (Command Center, Telemetry, Seed, Logs) | PASS |
| **H. Nani AI & Conversational Voice** | 10 | Conversation State, Gemini Adapter + Rule-Based Engine | NaniChat floating widget, Audio Synthesis / STT | PASS |
| **I. Notification Engine** | 9 | `Notification` | In-app notification center, SMS/Console dispatcher | PASS |
| **J. Reliability & Observability** | 10 | `ActivityLog`, Correlation middleware, Metrics | `/health`, `/ready`, Structured Logging | PASS |
| **K. Offline Behavior & Resilience** | 9 | LocalStorage cache, sync queues, Idempotency middleware | Offline badges, cache indicators, reconnect logic | PASS |
| **L. Analytics & Operational Reports** | 10 | Derived aggregates from all 10 persisted entities | `AnalyticsReportingView.tsx`, Safe CSV exports | PASS |
| **M. Multi-City & India Localization** | 8 | `ServiceArea`, +91 validation, IST timezones, 112 notices | Phone formatters, localized date-time, 112 dialing | PASS |
| **N. UX & Accessibility** | 7 | Tailwind CSS design system, High contrast, Responsive | Accessible dialogs, keyboard navigation, safe driver UI | PASS |

---

## 2. Detailed Feature Breakdown by Domain

### A. Authentication & Account Security
1. **Patient Registration & Login:** Validates Indian phone number (`+91XXXXXXXXXX`), email normalization, bcrypt salt rounds (10), JWT access token (15m expiry) + HTTP-only refresh token (7d rotation).
   - *Backend Route:* `POST /api/v1/auth/register`, `POST /api/v1/auth/login`
   - *Frontend:* `src/pages/Register.tsx`, `src/pages/Login.tsx`
   - *Prisma Models:* `User`, `PatientProfile`, `RefreshToken`
2. **Session Lifecycle & Silent Refresh:** Rotating refresh tokens, automatic 14-minute interval silent session restore, revocation on logout.
   - *Backend Route:* `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`
   - *Frontend:* `src/context/AuthContext.tsx`
3. **Google OAuth Integration:** Server-side token verification with `google-auth-library` (`OAuth2Client`), creating or binding user accounts safely with zero passwords.
   - *Backend Route:* `POST /api/v1/auth/google`
   - *Frontend:* `src/pages/Login.tsx`
4. **Role-Based Access Control (RBAC):** Strict middleware enforcement of 5 distinct roles: `PATIENT`, `DRIVER`, `ADMIN_HOSPITAL`, `SUPER_ADMIN`, `OPERATOR_ADMIN`.
   - *Backend Middleware:* `src/middleware/auth.ts` (`authenticate`, `authorize`)
5. **Organization Tenancy Scoping:** Hospital Admin is strictly bound to `adminUserId -> hospital.id`; Operator Admin is strictly bound to `adminUserId -> operator.id`.
   - *Backend Middleware:* `src/middleware/auth.ts` (`resolveHospitalScope`, `resolveOperatorScope`)
6. **Driver, Vehicle & Organization Verification:** Multi-state verification workflow (`NOT_SUBMITTED`, `PENDING_REVIEW`, `NEEDS_CORRECTION`, `VERIFIED`, `REJECTED`, `SUSPENDED`).
   - *Backend Route:* `src/routes/verification.ts`, `src/routes/admin.ts`
7. **Super-Admin Secure Bootstrap:** CLI bootstrap script with TOTP two-factor authentication fallback (`SUPER_ADMIN_TOTP_SECRET`).
   - *Backend Script:* `src/scripts/bootstrapAdmin.ts`
   - *Frontend:* `src/pages/SuperAdminLogin.tsx`
8. **Account Suspension & Revocation:** Suspended accounts (`isSuspended: true`) fail closed immediately on token verification across REST and Socket.IO.
9. **Password Security:** Minimum 8 characters, bcrypt hashing, password change verification.

### B. Patient Portal
1. **Patient Dashboard & Profile:** Blood group, allergies, medical conditions, medications, organ donor status, emergency contacts.
   - *Backend Route:* `GET/PUT /api/v1/profile`, `GET/PUT /api/v1/emergency-profile`
   - *Frontend:* `src/pages/PatientDashboard.tsx`
2. **Interactive Radar Map:** Real-time Leaflet map rendering hospitals and nearby ambulances within Nagpur pilot zone.
   - *Frontend:* `src/components/LeafletMap.tsx`
3. **Nearby Hospital Discovery:** Haversine distance ranking with available ICU and General bed metrics.
   - *Backend Route:* `GET /api/v1/hospitals/nearby?lat=...&lng=...&radiusKm=35`
4. **Emergency SOS Request Creation:** Single-tap emergency dispatch with GPS coordinate ingestion, category triage, and duplicate tap suppression.
   - *Backend Route:* `POST /api/v1/sos`
5. **Emergency Contacts Management:** Add, update, delete trusted emergency contacts with SMS notification binding.
   - *Backend Route:* `src/routes/emergencyContacts.ts`
6. **Emergency Medical ID / Safety QR Card:** Public-facing de-identified medical safety card accessible via QR token for first responders without login.
   - *Backend Route:* `GET /api/v1/emergency-profile/public/:token`
   - *Frontend:* `src/pages/PublicEmergencyMedicalId.tsx`
7. **Trusted Contacts Live Trip Sharing:** Shareable tracking link with security PIN protection, expiry window, and live ambulance location streaming.
   - *Backend Route:* `src/routes/tripShare.ts`
   - *Frontend:* `src/pages/PublicTripShare.tsx`
8. **Doctor Search & OPD Appointment Booking:** Filter doctors by specialty, date, and hospital; book specific time slots with unique OPD tokens.
   - *Backend Route:* `src/routes/doctors.ts`, `src/routes/appointments.ts`
   - *Frontend:* `src/components/patient/BookAppointmentSection.tsx`
9. **Notification History:** In-app notification tray with unread badge counter and mark-as-read persistence.
10. **Nani Conversational AI Assistant:** Dual-mode (Gemini 1.5 Flash + Rule-Based Emergency Triage) text and voice assistant.
11. **Manual Location Fallback:** Fallback text address entry if browser geolocation permission is denied.
12. **Offline Resilience:** LocalStorage caching for emergency profile, medical ID, and offline recovery notice.

### C. Maps, GPS & Geospatial Services
1. **Interactive Leaflet Mapping:** OpenStreetMap / Carto dark tiles with zero paid map license requirements.
2. **Authoritative Coordinates:** Nagpur pilot center (`21.1458, 79.0882`) with 30 km operational radius.
3. **Driver GPS Ingestion:** Authenticated driver coordinates streamed via Socket.IO (`driver:location_update`) and persisted to DB.
4. **Signal Freshness Classification:** `LIVE` (<2m), `STALE` (2–5m), `OFFLINE_OUTAGE` (>5m).
5. **No Synthetic Road Travel Extrapolation:** Clear separation between geospatial Haversine straight-line distance and recorded timestamps.
6. **Real-Time Ambulance Tracking:** Socket.IO room broadcast (`trip:${tripId}`) pushing driver updates to patient map.

### D. Emergency Request & Ambulance Dispatch Workflow
1. **SOS Validation & Atomic Persistence:** Validates triage urgency, required ambulance type, and pilot bounds.
2. **Centralized Dispatch Eligibility Engine:** Strict multi-rule verification:
   - Driver verified (`VERIFIED`)
   - Driver active & not suspended
   - Ambulance verified (`VERIFIED`)
   - Ambulance operational & available (`isAvailable: true`)
   - Valid driver-vehicle assignment (`DriverVehicleAssignment.isCurrent: true`)
   - Matching organization tenancy
3. **Dispatch Offer & Escalation Lifecycle:** Sequential candidate offer with 30-second expiry timeout before cascading to the next eligible ambulance.
4. **Atomic Trip Acceptance:** Concurrency lock preventing double-dispatching when multiple drivers respond.
5. **Trip Lifecycle State Transitions:** `ACCEPTED` → `AMBULANCE_ARRIVING` → `PATIENT_PICKED_UP` → `IN_TRANSIT` → `AT_DESTINATION` → `COMPLETED`.
6. **No-Eligible-Ambulance Handling:** Transitions to `NO_ELIGIBLE_AMBULANCE` and displays National Emergency 112 helpline fallback.

### E. Hospital & Doctor Operations
1. **Hospital Onboarding & Approval:** Admin registration, clinical capability config, super-admin verification.
2. **Live Bed Management Grid:** Floor bed management across wards (`ICU`, `EMERGENCY_ER`, `TRAUMA`, `GENERAL_WARD`, `PEDIATRIC`, `SURGICAL`).
3. **Hospital Capacity Auditing:** Immutable audit logging on bed count changes (`HospitalCapacityAuditLog`).
4. **Doctor Scheduling & Slots:** Specialty definition, recurring schedule creation, duration slots, cancellation rules.
5. **OPD Queue & Token System:** Scoped daily tokens (`GMCH-CARD-001`), walk-in queue creation, live status progression.
6. **Incoming Ambulance Visibility:** Emergency ER dashboard displaying inbound ambulances, patient ETA, and trauma bay allocation.

### F. Ambulance & Private Operator Management
1. **Private Fleet Onboarding:** Operator profile, commercial trade license validation, multi-vehicle fleet registry.
2. **Driver Vehicle Assignments:** Authoritative linking of drivers to specific ambulances with expiration handling.
3. **Driver Trip Console:** Mobile-first dashboard for driver location broadcasting, offer slide-to-accept, and lifecycle transitions.
4. **Suspension & Revocation:** Super admin operational action immediately revokes dispatch eligibility and disconnects socket sessions.

### G. Super-Admin Command Center
1. **Live Emergency Radar:** Real-time incident tracking across Nagpur pilot area.
2. **Operational Control Actions:** Approve/suspend/revoke entities with mandatory audit reasoning.
3. **Tracking Outage Monitoring:** Immediate alert on fleet GPS telemetry dropouts >5 minutes.
4. **Activity & Verification Logs:** Comprehensive immutable audit trail (`ActivityLog`, `VerificationAuditLog`).

### H. Nani Conversational AI & Voice
1. **Bilingual Hindi & English Support:** Full voice & text understanding across both languages.
2. **Emergency Triage Guardrails:** Never attempts medical diagnosis; immediately detects life-threatening keywords (chest pain, unconscious, bleeding) and presents the 1-Tap SOS dispatch button.
3. **Zero-Cost Rule-Based Fallback:** If `GEMINI_API_KEY` is absent or unreachable, the system automatically uses an in-memory medical keyword classifier without crashing.

### I. Notification Engine
1. **Persisted In-App Notifications:** Real-time Socket.IO emission + persistent DB storage.
2. **Delivery Mode Fallbacks:** Live carrier delivery via Twilio when configured; simulated zero-cost local console mock when unconfigured.
3. **Idempotent Delivery:** Deduplication suppressing spam notifications during reconnection.

### J. Reliability, Observability & Resilience
1. **Process Liveness & DB Readiness:** `/api/v1/health` and `/api/v1/health/ready` endpoints.
2. **Correlation ID Tracking:** `X-Correlation-Id` propagation across requests, logs, and database metrics.
3. **Idempotency Engine:** `Idempotency-Key` caching preventing duplicate payment, booking, or SOS actions.
4. **Zero PHI Logging:** Sensitive patient data (phone, address, diagnosis) redacted from stdout and server logs.

### K. Offline Behavior
1. **Offline State Indicators:** Persistent banner informing user of connectivity state.
2. **Authoritative Backend Reconciliation:** Local offline state is synchronized with server upon reconnection without overwriting authoritative database state.

### L. Operations Analytics & Reporting
1. **10 Persisted Reporting Modules:** Full operations analytics covering emergency requests, dispatch acceptance/timeout rates, turnaround SLA milestones, unserved demand, fleet GPS freshness, and bed capacity freshness.
2. **Missing Data Distinction:** Returns explicit `null` and `—` when samples are zero, avoiding misleading `0.0 min` metrics.
3. **Spreadsheet Formula Injection Defense (CWE-1236):** Safe CSV export escaping `=`, `+`, `-`, `@`, `\t`, `\r` triggers.

### M. Multi-City & India Localization
1. **Nagpur Pilot Zone:** 30 km operational radius centered on `21.1458, 79.0882`.
2. **Indian Phone Number Validation:** E.164 +91 normalization and Indian 10-digit mobile number parsing.
3. **IST Timezone Consistency:** UTC storage in database; Asia/Kolkata (+05:30) operational rendering.
4. **National Emergency 112 Integration:** Prominent fallback advisory on unserved emergency scenarios.

### N. UX & Accessibility
1. **Responsive Multi-Portal Design:** Tailored portals for Citizen/Patient, Driver, Hospital Admin, Operator, and Super Admin.
2. **Accessible Form Design:** Semantic inputs, color-contrast compliant badges, keyboard navigation support.
3. **Driver Safety Mode:** High-contrast touch targets, slide-to-accept actions minimizing driver distraction.
