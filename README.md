# LifeLink 2.0 — Real-Time Emergency Response & Hospital Telemetry Platform

<div align="center">

![LifeLink Banner](frontend/public/splash_hero.png)

[![React](https://img.shields.io/badge/React-19.0.0-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%26%20Realtime-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.10-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Leaflet](https://img.shields.io/badge/Maps-Leaflet_%2B_OpenStreetMap-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A high-reliability emergency healthcare platform connecting patients, ambulance operators, and hospital emergency wards in real time.**

*Operational Focus: Nagpur Pilot Zone (Maharashtra, India) — 30km operational coverage across GMCH, Mayo, AIIMS Nagpur, Max Super Speciality, Kingsway, and Wockhardt hospitals.*

[Key Features](#-key-features) • [System Architecture](#-system-architecture) • [Getting Started](#-getting-started) • [Verified Datasets](#-verified-nagpur-datasets) • [Default Test Accounts](#-default-test-accounts) • [Deployment](#-deployment) • [Automated Tests](#-automated-testing)

</div>

---

## 🌟 Overview

In medical emergencies, every second counts. LifeLink bridges the gap between distress calls and hospital admissions by eliminating phone queues, blind ambulance dispatching, and overcrowded emergency room uncertainty.

Built from the ground up for India's healthcare landscape, LifeLink combines **₹0 open-source mapping (Leaflet + OpenStreetMap + OSRM)**, **centralized PostgreSQL data persistence (Supabase)**, **dual-engine real-time synchronization (Socket.IO + Supabase Realtime)**, and an **offline-resilient Progressive Web App (PWA)** that functions reliably across desktop PC command centers and mobile smartphones.

---

## 🚀 Key Features

### 1. 🚨 One-Touch Emergency SOS & Intelligent Dispatch
- **10-Second Delay Safeguard**: Emergency requests initiate a 10-second countdown allowing patients or family members to cancel false alarms before ambulance fleet alerts are triggered.
- **Smart Fleet Ranking**: Multi-variable dispatch algorithm factors in distance (Haversine + OSRM road routing), operational vehicle readiness, equipment tier, and hospital affiliations.
- **Multi-Tier Support**: Advanced Life Support (ALS with ventilators), Basic Life Support (BLS), and dedicated Oxygen ambulances.
- **Live Vehicle Telemetry**: Real-time vehicle location pings stream simultaneously to the patient's phone, receiving hospital, and central command center.
- **National 112 / 108 Direct Integration**: Instant fallbacks to official emergency numbers if vehicle capacity is constrained.

### 2. 🗺️ Verified Nagpur Healthcare & Ambulance Directory
- **57 Verified Medical Facilities**: Complete coverage of government medical colleges (GMCH, IGGMC Mayo), central institutions (AIIMS Nagpur), private multispecialties (Max, Kingsway, Wockhardt, CIIMS, Arneja Heart), and rural sub-district hospitals (Katol, Umred, Saoner, Ramtek).
- **30 Verified Ambulance Providers**: Statutory Maharashtra Emergency Medical Services (MEMS 108 nodes), hospital-dedicated critical care fleets, and verified private 24x7 ambulance rigs.
- **Interactive OpenStreetMap Map**: Filter by hospital type, ownership (Government vs. Private), emergency capabilities, and view exact distances calculated from the user's live coordinates.

### 3. 🏥 Live Hospital Bed Availability & Ward Telemetry
- **Accurate Capacity Tracking**: Real-time tracking of beds across `ICU`, `EMERGENCY_ER`, `TRAUMA`, `GENERAL_WARD`, and `PEDIATRIC` wards.
- **Data Provenance & Freshness**: Distinguishes between ward-desk verified counts, hospital-reported telemetry, and historical baselines with human-readable timestamps (e.g., *"Updated 12m ago"*).
- **Emergency Bed Reservation**: Direct hospital admission bookings from authorized emergency dispatchers.

### 4. 👨‍⚕️ Verified Doctor Directory & Digital OPD Appointments
- **143 Verified Nagpur Specialists**: Genuine public physician records linked to verified hospital affiliations (primary departments & visiting consultants).
- **Digital Token Roster**: Book OPD consultation slots, receive digital appointment tokens, and reschedule or cancel with audit trail preservation.

### 5. 🤖 NANI — Clinical Conversational Assistant
- **Emergency Triage Support**: Domain-specific medical guidance calibrated for Indian healthcare emergencies.
- **Dual-Engine AI**: Supports cloud inference via Google Gemini API and hosted Groq endpoints, with an instant offline clinical rules fallback requiring zero API keys.
- **Offline First-Aid Guides**: Built-in instructions for CPR, severe bleeding, burns, poisoning, stroke signs (FAST), and fractures.

### 6. 📱 Multi-Device Shared Experience & PWA
- **Installable PWA**: Add LifeLink to any Android or iOS home screen without app store approval.
- **Cross-Device State Sync**: Log into your account on a PC or mobile phone; active emergency trips, bed reservations, and doctor appointments stay synchronized in real time.
- **Dynamic LAN & Cloud Routing**: Automatically detects whether clients connect via local Wi-Fi LAN (`192.168.x.x`), desktop `localhost`, or public cloud hosting (`*.vercel.app`).

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Clients["Authorized Client Devices"]
        Mobile["📱 Mobile Smartphone (PWA / Web)<br/>Patient & Driver App"]
        Desktop["💻 Desktop PC / Workstation<br/>Hospital Ward Desk & Super Admin"]
    end

    subgraph Hosting["Production Cloud Infrastructure"]
        Vercel["⚡ Vercel Edge CDN<br/>React 19 / Vite Static Frontend<br/>vercel.json"]
        Render["🚀 Render Cloud Host (Singapore)<br/>Node.js / Express API & Socket.IO<br/>render.yaml"]
    end

    subgraph CorePersistence["Central Source of Truth"]
        SupabaseAuth["🔐 Supabase Auth (OTP / Passwordless)<br/>https://newrxpzszdgroyqfffaa.supabase.co"]
        PostgresDB["🗄️ PostgreSQL Database (Port 5432 / 6543)<br/>Prisma Client ORM — 38 Models"]
        RealtimeBus["⚡ Dual Realtime Bus<br/>Socket.IO Rooms + Supabase postgres_changes"]
    end

    Mobile -->|HTTPS / WSS| Vercel
    Desktop -->|HTTPS / WSS| Vercel
    Vercel -->|REST API Proxy| Render
    Mobile -.->|Direct WebSocket & REST| Render
    Desktop -.->|Direct WebSocket & REST| Render
    Render -->|Prisma Connection Pooler| PostgresDB
    Render -->|Token Verification| SupabaseAuth
    PostgresDB -->|postgres_changes| RealtimeBus
    Render -->|Room Broadcasts| RealtimeBus
    RealtimeBus -->|Push State Updates| Mobile
    RealtimeBus -->|Push State Updates| Desktop
```

### Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite v8, Tailwind CSS v4, Lucide Icons, Canvas QR Code |
| **Mapping & Routing** | Leaflet, OpenStreetMap Standard Tiles, Open Source Routing Machine (OSRM), Nominatim Geocoder |
| **Backend & APIs** | Node.js, Express 4, TypeScript, Socket.IO v4, Bcrypt, JWT, Cookie-Parser, Helmet Headers |
| **Database & ORM** | PostgreSQL 15+, Prisma ORM v5, Supabase Connection Pooler (PgBouncer) |
| **Authentication** | Supabase Auth (Email 6-digit OTP & Passwordless), Local Role-based JWTs, TOTP 2FA for Super Admin |
| **Realtime** | Socket.IO room segmentation (`patient:`, `driver:`, `hospital:`) + Supabase Realtime Channels |
| **Mobile Architecture** | Progressive Web App (PWA), Service Worker offline cache, Web App Manifest |

---

## 📂 Repository Structure

```
life-link/
├── backend/
│   ├── prisma/
│   │   ├── migrations/             # 8 Production Prisma SQL migrations
│   │   ├── schema.prisma           # 38 Prisma relational models
│   │   └── seed.ts                 # Idempotent Nagpur healthcare seed script
│   ├── src/
│   │   ├── config/                 # Environment validation & secrets enforcement
│   │   ├── middleware/             # Dual auth (Supabase/JWT), RBAC, rate-limiting
│   │   ├── routes/                 # Express REST endpoints (directory, beds, sos, doctors)
│   │   ├── scripts/                # CLI import pipelines (ambulances, doctors)
│   │   ├── services/               # Dispatch engine, NANI clinical AI, notifications
│   │   ├── utils/                  # Indian phone normalizer, OTP, Supabase client
│   │   ├── app.ts                  # Express server & CORS configuration
│   │   ├── db.ts                   # Central Prisma Client database proxy
│   │   ├── server.ts               # HTTP & Socket.IO server startup
│   │   └── socket.ts               # Realtime rooms, event dispatch, & connection auth
│   └── tests/                      # 30+ automated integration and unit test suites
├── data/
│   └── nagpur/                     # Genuine Nagpur datasets
│       ├── ambulance_providers.json # 30 verified Nagpur ambulance services
│       ├── doctors.json            # 143 verified specialists & hospital affiliations
│       └── hospitals.json          # 57 verified facilities (GMCH, Mayo, AIIMS, etc.)
├── frontend/
│   ├── public/                     # PWA icons, manifest.json, sw.js, hospital heroes
│   ├── src/
│   │   ├── components/             # LeafletMap, Emergency SOS, Bed Availability, Directory
│   │   ├── config/                 # apiConfig.ts (dynamic LAN & cloud resolver)
│   │   ├── context/                # AuthContext (Supabase sync), SocketContext, ThemeContext
│   │   ├── hooks/                  # useSharedRealtime, useNetworkStatus
│   │   ├── pages/                  # Patient, Hospital, Driver, Operator, Admin dashboards
│   │   └── utils/                  # Indian phone & date formatting, geocoding adapter
│   └── vercel.json                 # Vercel SPA routing & security headers
├── deploy/                         # Systemd service unit & database backup scripts
├── docs/                           # Architecture, audit, and verification reports
├── render.yaml                     # Render Blueprint for Singapore Node.js deployment
├── vercel.json                     # Root Vercel monorepo configuration
└── package.json                    # Workspace orchestration scripts
```

---

## ⚡ Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **PostgreSQL**: Local instance running on port `5432` OR a free [Supabase](https://supabase.com) project

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/Shouryachoure/Life-link.git
cd Life-link
```

### Step 2: Install Dependencies
```bash
# Installs backend, frontend, and root dependencies in one step
npm run install:all
```

### Step 3: Configure Environment Variables
Copy the example environment blueprints:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**Backend Configuration (`backend/.env`):**
```env
PORT=5001
NODE_ENV="development"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lifelink?schema=public"
USE_IN_MEMORY_DB="false"
CORS_ORIGIN="http://localhost:5173,http://127.0.0.1:5173"
JWT_SECRET="lifelink_jwt_secret_key_2026_super_secure"
JWT_REFRESH_SECRET="lifelink_jwt_refresh_secret_key_2026_super_secure"
SUPER_ADMIN_TOTP_SECRET="SUPERADMINSECRET123"
VITE_SUPABASE_URL="https://newrxpzszdgroyqfffaa.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_YbvJcYIqDoz9Fd-yxbOoPw_-0sPlLrN"
```

**Frontend Configuration (`frontend/.env`):**
```env
VITE_API_URL="/api"
VITE_WS_URL=""
VITE_SUPABASE_URL="https://newrxpzszdgroyqfffaa.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_YbvJcYIqDoz9Fd-yxbOoPw_-0sPlLrN"
```

---

### Step 4: Initialize the Database & Seed Nagpur Data
```bash
# 1. Sync Prisma schema to PostgreSQL
npm run prisma:generate --prefix backend
npx prisma db push --schema=backend/prisma/schema.prisma

# 2. Seed verified Nagpur hospitals, doctors, ambulances, and bed wards
npm run prisma:seed --prefix backend
```

---

### Step 5: Start the Development Servers
```bash
# Runs backend on port 5001 and frontend on port 5173 simultaneously
npm run dev
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:5001/api/v1/health](http://localhost:5001/api/v1/health)
- **Database Readiness**: [http://localhost:5001/api/v1/health/ready](http://localhost:5001/api/v1/health/ready)

---

### Step 6: Open on Your Mobile Phone (Same Wi-Fi)
1. Find your computer's local IP address (`ipconfig` on Windows or `ifconfig` on Mac/Linux, e.g., `192.168.1.10`).
2. Open **`http://192.168.1.10:5173`** in your smartphone browser.
3. Tap **"Install LifeLink"** or **"Add to Home Screen"** to launch it as a full-screen PWA.
4. Updates made on your computer (bed changes, dispatches) will sync to your phone in real time!

---

## 👥 Default Test Accounts

All accounts use the default password: **`password123`**

| Role | Email | Purpose / Operational Scope |
| :--- | :--- | :--- |
| **Super Admin** | `superadmin@lifelink.com` | Operations control room, directory management, system telemetry *(2FA TOTP: `SUPERADMINSECRET123`)* |
| **Hospital Admin (GMCH)** | `admin.gmch@lifelink.com` | Ward bed manager for GMCH Trauma Center Nagpur (Medical Square) |
| **Hospital Admin (Mayo)** | `admin.mayo@lifelink.com` | Ward manager for Indira Gandhi GMC Mayo Hospital (Mominpura) |
| **Hospital Admin (Max)** | `admin.max@lifelink.com` | Bed manager for Max Super Speciality Hospital (Mankapur Square) |
| **Ambulance Operator** | `admin.apex@lifelink.com` | Fleet manager for Apex Emergency Mobility Private Fleet |
| **Ambulance Driver** | `driver.anil@lifelink.com` | Verified driver for GMCH Advanced Life Support Ambulance (`MH-31-AN-1001`) |
| **Patient / Public** | `patient.john@gmail.com` | Patient emergency dashboard, SOS dispatch, OPD appointment booking |

---

## 📊 Verified Nagpur Datasets

LifeLink ships with curated, geocoded, and phone-normalized healthcare datasets for Nagpur District in [`data/nagpur/`](data/nagpur/):

| Dataset | Records | Sources | Primary Locations |
| :--- | :--- | :--- | :--- |
| **Registered Hospitals** | 57 | Government Health Portals, Official Hospital Directories, Municipal Records | Medical Square, Dhantoli, Ramdaspeth, Mankapur, MIHAN, Central Avenue, Katol, Umred, Saoner |
| **Ambulance Providers** | 30 | Statutory MEMS 108, Red Cross Nagpur, Hospital Fleets, 24x7 Private Providers | Nagpur Central Dispatch, Ganeshpeth, Dharampeth, Medical Square |
| **Verified Doctors** | 143 | Maharashtra Medical Council records, Max Healthcare, GMCH Clinical Staff | Cardiology, Neurosurgery, Critical Care, Trauma, Orthopedics, Pediatrics, Oncology |

---

## 🧪 Automated Testing

LifeLink includes automated test suites covering authentication, geospatial logic, dispatch ranking, and multi-device synchronization:

```bash
# Run multi-device shared architecture suite (8/8 tests)
npm run test:shared-architecture --prefix backend

# Run ambulance provider import & map verification (17/17 tests)
npm run test:ambulance-providers --prefix backend

# Run Supabase authentication & token verification (8/8 tests)
npm run test:supabase --prefix backend

# Run hospital capacity & bed management tests
npm run test:capacity --prefix backend

# Run dispatch engine & service area geofence tests
npm run test:dispatch --prefix backend

# Type check entire codebase (TypeScript strict mode)
npm run type-check
```

---

## ☁️ Deployment

LifeLink is pre-configured for free-tier cloud deployment:

### Frontend on Vercel
1. Import the repository into [Vercel](https://vercel.com).
2. Set root directory to `frontend`.
3. Configure environment variables (`VITE_API_URL`, `VITE_WS_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
4. Vercel automatically applies [`frontend/vercel.json`](frontend/vercel.json) for Single-Page Application rewrites.

### Backend on Render
1. Create a new **Blueprint** service on [Render](https://render.com).
2. Connect your repository — Render automatically detects [`render.yaml`](render.yaml).
3. Connect your Supabase PostgreSQL connection pooler URI as `DATABASE_URL`.
4. Render deploys the Node.js API container in the low-latency Singapore region.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
Built with dedication for India's emergency response ecosystem.
</div>
