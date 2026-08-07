# 🎓 SMART: System for Monitoring & Academic Records Tracking

> **An Enterprise Academic Grading System & DepEd K-12 Compliance Platform**
> Integrated with the EnrollPro & ATLAS Microservices Ecosystem over Tailscale.

---

## 🌟 Overview

**SMART** (System for Monitoring & Academic Records Tracking) is a production-grade, full-stack academic grading and record-keeping platform designed for Philippine Secondary Education (DepEd K-12). It provides real-time grade computation, automated Form 137/138 (SF9/SF10) report generation, attendance tracking, and seamless microservice synchronization.

Built for high performance and reliability, SMART operates as the **Grading & Academic Records Engine** within a distributed microservice ecosystem:
- **EnrollPro**: Identity, Enrollment, & Advisory Section Assignment (Single Source of Truth)
- **ATLAS**: Master Scheduling, Faculty Loading, & Room Allocations
- **SMART**: Real-Time Grade Calculation, Attendance Ledger, & Class Records
- **AIMS**: Learning Management & Remediation Analytics
- **MRF**: Facility Maintenance & Operations Tracking

---

## 🏛️ Ecosystem Architecture

```mermaid
flowchart TD
    subgraph Tailnet ["Tailscale Private Network (.ts.net)"]
        EP["EnrollPro (Identity & Enrollment)"]
        ATLAS["ATLAS (Master Scheduling)"]
        SMART["SMART (Grading & Records System)"]
        AIMS["AIMS (LMS & Mastery)"]
    end

    EP -- "Live Auth & Identity (SSOT)" --> SMART
    EP -- "Advisory & Student Masterlists" --> SMART
    ATLAS -- "Teaching Load & Schedules" --> SMART
    SMART -- "Final EOSY Averages" --> EP
    AIMS -- "Remediation & Mastery Signals" --> SMART
```

---

## ✨ Key Features

### 👩‍🏫 Teacher Portal
- **Advisory Class Management**: Instant live sync of advisory section rosters (Grade 7-10) directly from EnrollPro.
- **Transmutation & Grading**: Automated DepEd K-12 grade computation (Written Work, Performance Tasks, Quarterly Assessments) with automatic score transmutation.
- **Attendance Ledger**: Daily student attendance tracking with automatic status aggregation.
- **Real-Time Grade Profile**: Student-by-student academic performance metrics and honors ranking.

### 🛡️ Administrator Portal
- **System Settings & School Year Management**: Active school year control, term management, and automated branding sync.
- **Live Ecosystem Synchronization**: One-click and scheduled synchronization across EnrollPro & ATLAS endpoints.
- **Audit Logging**: Comprehensive activity logs for compliance and security auditing.
- **Template Reindexing**: Automated indexing for SF/ECR official DepEd document templates.

### 📋 Registrar Portal
- **Intake & Admissions Queue**: Real-time integration with EnrollPro intake pipeline.
- **Academic Ledger**: Grade verification, promotion status tracking, and archival records.
- **Export Engine**: Official DepEd School Form generation (SF1, SF5, SF6, SF9, SF10).

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, Lucide Icons |
| **Backend** | Node.js, Express 5, TypeScript, `ts-node-dev` |
| **Database & ORM** | PostgreSQL, Prisma ORM |
| **Authentication** | EnrollPro JIT Authentication over Tailscale, JWT, `bcryptjs` |
| **Live Updates** | Server-Sent Events (SSE) |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.x or higher
- **PostgreSQL**: v14.x or higher
- **npm**: v9.x or higher

### 1. Clone Repository & Install Dependencies

```bash
# Clone the repository
git clone https://github.com/madebyseaan/CapstoneFinal.git
cd CapstoneFinal

# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### 2. Environment Configuration

Create a `.env` file inside the `server/` directory:

```env
# Database Connection
DATABASE_URL="postgresql://postgres:password@localhost:5432/smart_db"

# JWT Secret
JWT_SECRET="your-super-secret-jwt-key"

# Server Port
PORT=5003

# Microservices Integration Over Tailscale
ENROLLPRO_BASE_URL="https://dev-jegs.buru-degree.ts.net/api"
ENROLLPRO_ACCOUNT_NAME="1000001"
ENROLLPRO_PASSWORD="AdminSY2026!"

ATLAS_SYSTEM_TOKEN="your-atlas-system-token"
ATLAS_SYNC_INTERVAL_MINUTES=30
```

### 3. Database Initialization

```bash
cd server

# Apply database migrations
npm run prisma:push

# Generate Prisma Client
npm run prisma:generate

# Seed initial system configuration
npm run prisma:seed

cd ..
```

### 4. Running the Development Stack

Launch both frontend and backend development servers:

```bash
# Terminal 1: Backend Server (Port 5003)
cd server
npm run dev

# Terminal 2: Frontend Client (Port 5173)
npm run dev
```

---

## 🔒 Security & Privacy

- **Identity Ownership**: EnrollPro serves as the sole Single Source of Truth for identity. Credentials are non-persistent and verified live against EnrollPro's authentication API.
- **Audit Trails**: Critical operations (logins, grade modifications, section assignments) log IP addresses, timestamps, and severity levels.
- **Microservice Isolation**: Direct inter-service API calls are restricted to private Tailscale Tailnet IPs with token-based access.

---

## 📄 License

Developed as a Final Senior Capstone Project for Hinigaran National High School Academic Systems Modernization.
All rights reserved.
