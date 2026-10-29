# LIFELINK — ARCHITECTURE & INTEGRATION SPECIFICATION

**System:** LifeLink — Intelligent Emergency Care & Hospital Operating System  
**Architecture Style:** Layered Monolith with Real-Time Event-Driven Subsystems  
**Target Environment:** Local Node.js + Vite / Cloud Container (Docker Compose)  
**Zero-Cost Policy:** ₹0 Mandatory Service Cost (Zero-SaaS Development Baseline)

---

## 1. System Architecture Topology

LifeLink employs a decoupled client-server architecture with dual transport layers (RESTful HTTP/JSON for transactional workflows and WebSockets via Socket.IO for low-latency operational telemetry).

```mermaid
graph TB
    subgraph Client Tier [Frontend Layer (React 19 + Vite 8 + Tailwind CSS)]
        PatientApp[Patient / Citizen Portal]
        DriverApp[Driver Mobile-First Console]
        HospitalApp[Hospital Operations Portal]
        OperatorApp[Private Fleet Console]
        SuperAdminApp[Global Command Center]
    end

    subgraph Gateway Tier [Edge & Security Middleware]
        CORS[Configurable CORS Policy]
        SecHeaders[OWASP Security Headers]
        RateLimit[IP & Token Throttling]
        Idempotency[Idempotency Key Middleware]
        Correlation[Correlation ID Injector]
        AuthGuard[JWT & RBAC Gatekeeper]
    end

    subgraph Application Tier [Backend Core (Node.js + Express 4 + TypeScript)]
        AuthService[Authentication & Session Service]
        DispatchService[Dispatch & Escalation Engine]
        MapService[Geospatial & Service Area Service]
        CapacityService[Hospital Bed & Queue Service]
        AIService[Nani AI Adapter & Fallback Engine]
        NotifService[Notification & SMS Engine]
        AnalyticsService[Operations Analytics Aggregator]
        SocketServer[Socket.IO Real-Time Dispatcher]
    end

    subgraph Data Tier [Persistence & Storage]
        PrismaORM[Prisma Client ORM]
        PostgreSQL[(PostgreSQL Production DB)]
        InMemoryDB[(High-Fidelity Isolated In-Memory DB)]
        SecureUploads[Access-Controlled Document Store]
    end

    subgraph External Adapters [₹0 Swappable Service Adapters]
        GeminiAdapter[Google Gemini 1.5 Flash (Free Tier)]
        TwilioAdapter[Twilio SMS Gateway (Simulated Console Fallback)]
        OAuthAdapter[Google OAuth2 Client (Optional)]
        OSMAdapter[OpenStreetMap / Carto Tiles (Open Source)]
    end

    Client Tier -->|REST API Requests| GatewayTier
    Client Tier <-->|Bidirectional WebSockets| SocketServer
    Gateway Tier --> ApplicationTier
    Application Tier --> PrismaORM
    PrismaORM --> PostgreSQL
    PrismaORM -.->|Zero-Setup Local Dev| InMemoryDB
    Application Tier --> ExternalAdapters
```

---

## 2. Component Inventory & Responsibilities

### 2.1. Backend Service Layer (`backend/src/services/`)
- `dispatchEngine.ts`: Centralized dispatch state machine. Manages candidate ranking, 30-second offer expiry, atomic acceptance lock, trip state transitions, and unserved demand escalation.
- `dispatchEligibility.ts`: Strict multi-rule validator enforcing that drivers, vehicles, and organizations satisfy commercial verification before qualifying for dispatch.
- `aiProvider.ts`: Dual-engine conversational AI adapter. Seamlessly switches between Google Gemini 1.5 Flash API (when key present) and zero-cost in-memory medical keyword rule engine.
- `analyticsService.ts`: Operations analytics aggregator computing 10 operational reports with null-distinction and CWE-1236 formula injection sanitization.
- `notificationService.ts`: Multi-channel notification router supporting in-app persistent notifications, real-time socket events, and simulated SMS dispatching.
- `tokenService.ts`: JWT access token (15 min) and rotating refresh token (7 days) generation and verification.

### 2.2. Real-Time WebSocket Infrastructure (`backend/src/socket.ts`)
Socket.IO runs alongside Express on the same HTTP server port (5000) using rooms for strict multi-tenant channel isolation:

| Room Pattern | Purpose & Access Restriction |
|---|---|
| `hospital:${hospitalId}` | Broadcasts inbound emergency trips, bed allocation requests, and OPD arrivals to authorized hospital staff. |
| `operator:${operatorId}` | Pushes fleet availability, driver statuses, and vehicle assignments to private fleet managers. |
| `driver:${driverId}` | Delivers direct dispatch offers (`dispatch:offer`), timeouts, and route coordinates. |
| `patient:${patientId}` | Streams live ambulance GPS updates (`trip_update`), driver details, and arrival notices. |
| `trip:${tripId}` | Dedicated mission room shared between assigned driver and requesting patient. |
| `trip_share:${token}` | Read-only live tracking channel for trusted family contacts with PIN validation. |
| `super_admin_room` | System-wide incident radar receiving global operational events. |

---

## 3. External Integrations & Zero-Cost Policy

LifeLink strictly adheres to the **₹0 Mandatory Service Cost Policy**. Core functionality never requires paid subscriptions or third-party accounts for local development, CI/CD, or pilot demonstrations.

| Integration | Provider / Protocol | Cost Model | Fallback Implementation when Unconfigured |
|---|---|---|---|
| **Database** | PostgreSQL 15+ / Prisma ORM | Open Source / ₹0 | In-Memory Database (`USE_IN_MEMORY_DB=true`) provides complete relational joins and data persistence during server execution. |
| **Mapping & Tiles** | OpenStreetMap / Carto Dark | Open Source / ₹0 | Standard public OSM / Carto tile URLs; zero proprietary map keys (e.g., Google Maps API) required. |
| **Conversational AI** | Google Gemini 1.5 Flash | Free Tier Eligible | Offline Rule-Based Domain Assistant automatically handles triage and emergency detection if `GEMINI_API_KEY` is omitted. |
| **SMS Notifications** | Twilio Carrier Gateway | Paid (Optional) | Simulated Local Sandbox Dispatcher automatically prints formatted SMS messages to the server terminal with delivery timestamps. |
| **Authentication** | Local JWT + Google OAuth | Open Source / ₹0 | Local password-based authentication with bcrypt remains 100% active; Google OAuth is purely optional. |
| **Document Storage** | Local File System (`uploads/`) | Open Source / ₹0 | Access-controlled local disk serving with authentication gatekeeper (`/api/v1/documents/:filename`). |

---

## 4. Multi-Tenant Data Isolation Model

LifeLink strictly isolates data across different entities:
1. **Patient Data Isolation:** Patients can only access their own profile, emergency requests, appointments, and shared trips. Direct object reference attempts to other patient IDs return `HTTP 403 Forbidden`.
2. **Hospital Data Isolation:** Hospital Admins can only query or update beds, bookings, doctors, and incoming dispatches belonging to their registered hospital ID. Cross-hospital query attempts are blocked at the middleware level.
3. **Operator Fleet Isolation:** Private ambulance operators can only view and manage vehicles and drivers associated with their organization.
4. **De-Identified Public Medical ID:** The public emergency safety QR card exposes only vital clinical facts (blood group, allergies, medications, emergency contacts) with patient consent and zero private home addresses or phone numbers.
