# ECR Export/Import Removal Plan

## Goal
Surgically remove all ECR (Electronic Class Record) export and import functionality to start fresh with a new data mapping approach.

## Critical: Shared Utilities (DO NOT DELETE)
- `resolveEffectiveWeightsForClassAssignment()` in grades.ts — used by non-ECR grade routes
- `isHomeroomGuidanceSubjectCode()` in grades.ts and registrar.ts — used by non-ECR routes
- `calculateGrades()` in grades.ts — used by non-ECR grade saving logic
- `multer` and `XLSX` imports in other files (templates.ts, admin.ts, registrar.ts) — used by non-ECR features

---

## DB Push Protocol
When pushing schema changes to the database, ALWAYS follow this sequence:
```bash
# 1. Stop server (prevents migration lock conflicts)
pm2 stop server

# 2. Push schema changes (pick ONE method)
# Option A: Interactive migration (creates migration file)
cd server && npx prisma migrate dev --name <migration_name>
# Option B: Direct push (no migration file, dev only)
cd server && npx prisma db push

# 3. Regenerate Prisma Client
npx prisma generate

# 4. Restart server
pm2 restart server

# 5. Verify no errors
pm2 logs server --lines 10 --nostream
```

**Why stop first?** Prisma needs a migration lock on the database. If the server is running, it holds a connection pool that can block the migration.

---

## Phase 1: Delete Entirely ECR-Only Files
**Goal:** Remove files that are 100% ECR-related with no shared code.

### 1a. Server files to delete:
- `server/src/routes/ecrTemplates.ts` (entire file — 1275 lines)
- `server/src/lib/ecrSubjectMapping.ts` (entire file — 121 lines)

### 1b. Frontend files to delete:
- `src/pages/admin/ECRTemplateManager.tsx` (entire file — 971 lines)
- `src/pages/teacher/components/EcrGenerationDialog.tsx` (entire file — 55 lines)

### 1c. Static files to delete:
- `server/uploads/ecr-templates/` (entire directory — 2 .xlsx files)
- `server/uploads/ECR_Import_System_Documentation.docx`
- `docs/ECR_SUBJECT_MAPPING_PLAN.md`

### 1d. Unused files to delete:
- `(unused files)/server/scripts/list-ecr-templates.cjs`
- `(unused files)/server/scripts/check-villanueva-ecr.ts`
- `(unused files)/server/scripts/check-ecr-debug.ts`
- `(unused files)/server/scripts/testEcr.ts`
- `(unused files)/root/scan-ecr.cjs`
- `(unused files)/root/scan-ecr2.cjs`
- `(unused files)/root/scan-ecr3.cjs`
- `(unused files)/root/unused_docs/ECR_SYSTEM_GUIDE.md`

### Post-Phase 1 Verification:
- [ ] `npm run build` (server) — should pass
- [ ] `npm run build` (client) — should pass
- [ ] `pm2 restart all` — no crashes
- [ ] `pm2 logs` — no new errors

---

## Phase 2: Remove Server Route Mount + Import
**Goal:** Disconnect ECR routes from the server.

### File: `server/src/index.ts`
- **Line 34:** Remove `import ecrTemplatesRoutes from "./routes/ecrTemplates";`
- **Line 66:** Remove `app.use("/api/ecr-templates", ecrTemplatesRoutes);`

### Post-Phase 2 Verification:
- [ ] `npm run build` (server) — should pass
- [ ] `pm2 restart all` — server starts clean
- [ ] `pm2 logs` — no import errors

---

## Phase 3: Remove ECR Routes from grades.ts
**Goal:** Remove ~700 lines of ECR import/preview/status code from grades.ts.

### File: `server/src/routes/grades.ts`

#### 3a. Remove ECR-only imports:
- **Line 7:** Remove `import multer from "multer";` (only used by ecrUpload)
- **Line 8:** Remove `import * as XLSX from "xlsx";` (only used by parseECRFile)

#### 3b. Remove ECR multer config:
- **Lines 12-30:** Remove the entire `ecrUpload` multer configuration block

#### 3c. Remove ECR interfaces and helpers:
- **Lines 1658-1989:** Remove:
  - `ECRStudentData` interface
  - `ECRQuarterData` interface
  - `parseECRFile()` function
  - `normalizeName()` function
  - `stripExtensions()` function
  - `matchStudent()` function

#### 3d. Remove ECR routes:
- **Lines 1992-2106:** Remove `POST /ecr/preview` route
- **Lines 2108-2306:** Remove `POST /ecr/import` route
- **Lines 2308-2358:** Remove `GET /ecr/status/:classAssignmentId` route

### Post-Phase 3 Verification:
- [ ] `npm run build` (server) — should pass
- [ ] `pm2 restart all` — server starts clean
- [ ] `pm2 logs` — no import errors
- [ ] Verify grades.ts still has `calculateGrades`, `resolveEffectiveWeightsForClassAssignment`, `isHomeroomGuidanceSubjectCode`

---

## Phase 4: Remove ECR from admin.ts Reindex Route
**Goal:** Remove ECR portion of the reindex endpoint.

### File: `server/src/routes/admin.ts`

#### 4a. Remove ECR helper functions:
- **Lines 102-117:** Remove `deriveEcrSubjectName()` function
- **Lines 119-139:** Remove `inferEcrSubjectType()` function

#### 4b. Clean up reindex route:
- **Line 1372:** Remove `const includeEcr = target === "all" || target === "ecr";`
- **Lines 1382-1387:** Remove `ecr: { ... }` from result object
- **Lines 1448-1508:** Remove entire `if (includeEcr) { ... }` block
- **Line 1521-1528:** Remove `ecr` from the audit log result if present

### Post-Phase 4 Verification:
- [ ] `npm run build` (server) — should pass
- [ ] `pm2 restart all` — server starts clean

---

## Phase 5: Update Prisma Schema + Migration
**Goal:** Remove ECR database tables and fields.

### File: `server/prisma/schema.prisma`

#### 5a. Remove User model relation:
- **Line 27:** Remove `uploadedEcrTemplates ECRTemplate[] @relation("ECRTemplateUploader")`

#### 5b. Remove ClassAssignment ECR fields:
- **Line 133:** Remove `ecrFileName String?`
- **Line 134:** Remove `ecrLastSyncedAt DateTime?`

#### 5c. Remove ECRTemplate model:
- **Lines 384-404:** Remove entire `model ECRTemplate { ... }`

#### 5d. Push schema changes to database:
```bash
# Stop server first
pm2 stop server
# Create migration + push
cd server && npx prisma migrate dev --name remove_ecr_tables
# Regenerate Prisma Client
npx prisma generate
# Restart server
pm2 restart server
# Verify
pm2 logs server --lines 10 --nostream
```

#### 5e. Update seed file:
- **File:** `server/prisma/seed.ts`
- **Line 26:** Remove `await prisma.eCRTemplate.deleteMany({});`

### Post-Phase 5 Verification:
- [ ] `pm2 stop server`
- [ ] `npx prisma migrate dev --name remove_ecr_tables` — migration created
- [ ] `npx prisma generate` — should pass
- [ ] `pm2 restart server`
- [ ] `pm2 logs server --lines 10 --nostream` — no errors
- [ ] `npm run build` (server) — should pass

---

## Phase 6: Remove Frontend ECR Code
**Goal:** Remove all ECR-related frontend code.

### 6a. API client:
**File: `src/lib/api.ts`**
- **Line 149:** Remove `hasExactEcrTemplate: boolean;`
- **Lines 151-153:** Remove `ecrLastSyncedAt?: string | null;` and `ecrFileName?: string | null;`
- **Line 268:** Remove `hasExactEcrTemplate: boolean;`
- **Lines 320-401:** Remove all ECR API functions: `getEcrStatus`, `ecrGenerate`, `previewEcr`, `importEcr`

### 6b. ClassRecordView:
**File: `src/pages/teacher/ClassRecordView.tsx`**
- **Line 22:** Remove `import { EcrGenerationDialog } ...`
- **Line 65:** Remove `hasExactEcrTemplate: boolean;` from state type
- **Line 89:** Remove `const ecrFileInputRef = useRef<HTMLInputElement>(null);`
- **Lines 432-436:** Remove useEffect that calls `fetchEcrStatus()`
- **Lines 545-572:** Remove `fetchEcrStatus()`, `handleEcrFileSelect()`, `handleEcrImport()`
- **Lines 816-858:** Remove ECR state variables and `downloadECR()` function
- **Line 900:** Remove `onExportEcr={downloadECR}` prop
- **Line 901:** Remove `onOpenImport={() => ecrFileInputRef.current?.click()}`
- **Line 902:** Remove `onImportSelect={handleEcrFileSelect}`
- **Line 903:** Remove `fileInputRef={ecrFileInputRef}`
- **Lines 1046-1050:** Remove `<EcrGenerationDialog>` JSX

### 6c. ClassRecordHero:
**File: `src/pages/teacher/components/ClassRecordHero.tsx`**
- **Lines 30-33:** Remove ECR props: `onExportEcr`, `onOpenImport`, `onImportSelect`, `fileInputRef`
- **Line 41:** Remove `onExportEcr,` from destructured props
- **Line 43:** Remove `onImportSelect,`
- **Line 44:** Remove `fileInputRef,`
- **Lines 101-117:** Remove the entire `tutorial-ecr-actions` div (EXPORT ECR + IMPORT ECR buttons + hidden file input)

### 6d. App routes:
**File: `src/App.tsx`**
- **Line 44:** Remove `const ECRTemplateManager = lazy(...)`
- **Line 102:** Remove `<Route path="ecr-templates" ...>`

### 6e. Admin layout:
**File: `src/layouts/AdminLayout.tsx`**
- **Line 67:** Remove `{ name: "ECR Templates", href: "/admin/ecr-templates", icon: BookOpen },`

### 6f. Tour:
**File: `src/pages/teacher/components/ClassRecordTour.tsx`**
- **Lines 65-78:** Remove the `"ecr-actions"` tour step
- **Line 122:** Remove ECR mention from content
- **Line 143:** Remove ECR mention from notes

### Post-Phase 6 Verification:
- [ ] `npm run build` (client) — should pass
- [ ] `pm2 restart all` — full system starts clean
- [ ] `pm2 logs` — no errors
- [ ] Navigate to teacher class record page — should load without errors
- [ ] Navigate to admin page — no ECR Templates link
- [ ] Verify no ECR buttons visible on class record page

---

## Phase 7: Final Integration Test
**Goal:** Verify the entire system works after all removals.

### Tests:
- [ ] Server starts without crashes
- [ ] Frontend builds without errors
- [ ] Teacher login works
- [ ] Class record page loads (no ECR buttons)
- [ ] Grade entry still works (WW, PT, QA scores)
- [ ] Grade saving still works
- [ ] Admin page loads (no ECR Templates nav)
- [ ] SF template features still work (reindex, upload, etc.)
- [ ] Attendance features still work
- [ ] No 404 errors for removed ECR routes
- [ ] No console errors in browser

---

## Summary

| Phase | Files Deleted | Files Edited | Lines Removed |
|-------|--------------|-------------|---------------|
| 1 | 11 files | 0 | ~2,500 |
| 2 | 0 | 1 | 2 |
| 3 | 0 | 1 | ~700 |
| 4 | 0 | 1 | ~100 |
| 5 | 0 | 2 | ~25 |
| 6 | 0 | 6 | ~150 |
| **Total** | **11 files** | **11 files** | **~3,477** |
