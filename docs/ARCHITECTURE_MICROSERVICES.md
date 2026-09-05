# EnrollPro Ecosystem Microservices Architecture

## Overview
EnrollPro is part of a distributed microservices system integrated via **Tailscale Tailnet**. Services communicate directly using Tailscale IP addresses and private DNS (Tailscale Funnel). EnrollPro acts as the **Single Source of Truth (SSOT)** for identity and enrollment.

## System Components

### 1. EnrollPro (Enrollment & Identity — SSOT)
- **Role:** Source of truth for student/teacher accounts and enrollment data.
- **Tailscale Host:** `dev-jegs.buru-degree.ts.net` (Local: `100.120.169.123`)
- **Data Responsibility:**
  - **Student Accounts:** LRN, name, sex, birthdate.
  - **Teacher Accounts:** Employee ID, name, email, role.
  - **Enrollment:** Grade level and Section assignment (e.g., "Grade 7 - Rizal").
- **Integration:** External systems (AIMS, ATLAS, SMART) call EnrollPro for identity and context.

### 2. AIMS (Automated Intervention & Mastery System)
- **Role:** LMS, Quiz Generation, Grading, Remediation.
- **Tailscale Host:** `100.92.245.14`
- **Data Responsibility:** Course content, quizzes, student submissions, and mastery analytics.
- **Integration:** Calls EnrollPro to verify student sections and ATLAS for teaching load assignments.

### 3. ATLAS (Scheduling & Teaching Load)
- **Role:** Master Scheduler and Faculty Loading.
- **Tailscale Host:** `100.88.55.125`
- **Data Responsibility:**
  - **Teaching Load:** Which teacher handles which section (e.g., "Teacher 1 -> Grade 7-A, English").
  - **Class Schedule:** Time and Day mapping (e.g., "8-9am, Mon/Wed/Fri").
  - **Campus Map:** Buildings and rooms.
- **Integration:** Consumed by AIMS for course assignment and SMART for class context.

### 4. SMART (Grading & Academic Records)
- **Role:** Grading system and Academic performance tracker.
- **Tailscale Host:** `100.93.66.120` (Port 5003)
- **Data Responsibility:**
  - **Grades:** Quarterly grades, initial grades, remarks.
  - **Attendance:** Section and student-level attendance tracking.
  - **Class Records:** Full historical class records.
- **Integration:** EnrollPro pulls final averages from SMART to finalize EOSY records.

### 5. MRF (Maintenance and Materials Recovery Operations)
- **Role:** Campus maintenance, waste collection, issue reporting, dispatch, and resolution tracking.
- **Data Responsibility:** Maintenance requests, collection records, assigned MRF personnel, work status, and operational analytics.
- **Identity Integration:** MRF consumes DPA-minimized learner and personnel identities from EnrollPro through `GET /api/integration/v1/default/mrf/identities` using an `X-Integration-Key` service credential.
- **Ownership Boundary:** MRF must not become a second source of truth for learner enrollment, section placement, faculty employment, or school-year status. Those records remain owned by EnrollPro.

## Inter-Service Communication Pattern
- **Directional Access:** Subsystems call EnrollPro directly via Tailscale IPs/DNS.
- **Auth:** Services use shared secrets or JWTs as defined in the integration references. The MRF identity feed requires `X-Integration-Key`; existing ATLAS, SMART, and AIMS v1 pull feeds remain read-only and public for compatibility.
- **Discovery:** Use Tailnet private DNS (`.ts.net`) or static Tailscale IPs.

## Context for Agents
When working on the EnrollPro ecosystem:
1. **Never Assume Local Data:** If student section, personnel identity, or school-year context is needed, fetch it from EnrollPro. If a teacher schedule or teaching load is needed, fetch it from ATLAS.
2. **Consult API Docs:** Refer to specific system API references before implementing inter-service calls.
3. **Multi-Tenant Safety:** Ensure `schoolId` context is passed when calling other services to maintain isolation across the tailnet.
