# Project Map & Technical Setup Audit

This file provides a structured layout of the project to enable token-efficient developer workflows, outlining the tech stack, directory structure, and primary files.

## Project Mission & Feature Scope
This Capstone project is a web-based school portal designed to manage academic records, grades, and administrative processes. The application serves three distinct user roles (Administrators, Registrars, and Teachers) to coordinate the electronic encoding, validation, submission, and generation of student grades. It focuses particularly on structured Excel integration for importing/exporting Electronic Class Records (ECR) templates and ensuring strict grade submission timelines.

Core features detected in the project codebase include:
- **Authentication**: Role-based portals (Admin, Registrar, Teacher) with secure login flows.
- **Grade Management**: Electronic Class Record (ECR) template upload/download, components-based grade calculations, and Excel-to-DB syncing.
- **Registrar Operations**: Grade submission locking/unlocking, validation, and generation of student report cards.
- **Attendance & Advisories**: Management of student attendance records and teacher-allocated advisory classes.
- **Admin Management**: School term schedules, grade submission deadlines, and account/class/section allocation controls.

## Tech Stack & Frameworks
- **Frontend**: React 19, Vite (v8), React Router (v7), React Query (@tanstack/react-query v5), Zustand (v5), Tailwind CSS (v4), shadcn/ui.
- **Backend**: Node.js, Express (v5), Prisma ORM (PostgreSQL), ts-node-dev.
- **Language**: TypeScript (explicit types, strictly typed config files).
- **Package Manager**: npm.

---

## Folder Tree Map
```text
SMART-CAPSTONE-master/
├── .github/                   # GitHub workflows and settings
├── dist/                      # Compiled frontend static assets
├── docs/                      # Project documentation files
├── public/                    # Static public assets for frontend
├── server/                    # Backend server root
│   ├── dist/                  # Compiled JS output for production
│   ├── prisma/                # Prisma schema and migration scripts
│   │   ├── schema.prisma      # PostgreSQL database schema definitions
│   │   └── seed.ts            # Database seed script
│   ├── src/                   # Backend TypeScript source files
│   │   ├── index.ts           # Express server entry point
│   │   ├── lib/               # Shared libraries and utilities
│   │   ├── middleware/        # Express request middleware (auth, etc.)
│   │   ├── routes/            # REST API route endpoints
│   │   ├── services/          # Business logic and DB transaction helper files
│   │   └── types/             # Backend TypeScript interfaces
│   ├── package.json           # Backend dependency configuration
│   └── tsconfig.json          # Backend TS settings
├── src/                       # Frontend React source files
│   ├── assets/                # Images, fonts, and styling assets
│   ├── components/            # Reusable UI component modules
│   │   └── ui/                # UI design system components (shadcn)
│   ├── contexts/              # React state contexts
│   ├── hooks/                 # Custom React hooks (e.g. data fetching queries)
│   ├── layouts/               # Dashboard layout designs (sidebar, navbar)
│   ├── lib/                   # Utility methods and API clients (axios setup)
│   ├── pages/                 # Routing pages
│   │   ├── admin/             # Admin portal interface pages
│   │   ├── registrar/         # Registrar dashboard and process pages
│   │   ├── teacher/           # Instructor grades and portal pages
│   │   ├── AdminLoginPage.tsx
│   │   ├── LoginPage.tsx
│   │   └── RegistrarLoginPage.tsx
│   ├── App.css                # Global components override CSS
│   ├── App.tsx                # Frontend Router config and core layout
│   ├── index.css              # Global styles (includes Tailwind imports)
│   └── main.tsx               # Client bootstrap entry point
├── package.json               # Root/Frontend package configuration
├── vite.config.ts             # Vite build & bundler configuration
└── tsconfig.json              # TypeScript root settings
```

---

## Core Coding Files
These are the files where most of our future coding and changes will take place:

### Frontend (User Interface & Interaction)
*   **[App.tsx](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/App.tsx)**: Main routing rules, path mappings, and security shells.
*   **[index.css](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/index.css)**: Central styling tokens, gradients, and custom scrollbar overrides.
*   **[pages/](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/pages)**: Contains login mechanisms and dashboards:
    *   **[LoginPage.tsx](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/pages/LoginPage.tsx)** / **[AdminLoginPage.tsx](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/pages/AdminLoginPage.tsx)** / **[RegistrarLoginPage.tsx](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/pages/RegistrarLoginPage.tsx)**
    *   **[admin/](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/pages/admin)**, **[registrar/](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/pages/registrar)**, and **[teacher/](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/src/pages/teacher)** portals.

### Backend (Server Logic & Database)
*   **[server/prisma/schema.prisma](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/server/prisma/schema.prisma)**: Central data structure declarations and relational mapping.
*   **[server/src/index.ts](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/server/src/index.ts)**: Port setup, global middlewares, route mounts, and bootstrap.
*   **[server/src/routes/](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/server/src/routes)**: Implementation of REST API routes.
*   **[server/src/services/](file:///c:/Users/Sean/Desktop/SMART-CAPSTONE-master/server/src/services)**: Business logic, file processing operations, and data transformations.
