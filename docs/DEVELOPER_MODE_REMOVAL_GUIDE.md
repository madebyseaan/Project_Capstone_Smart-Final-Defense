# 🚀 Developer Mode Removal & Production Deployment Guide

This guide details all steps required to clean up, disable, or remove the **Universal Developer Login (`Dev Sean Roma / 999999`)**, developer bypasses, and UI switcher tools before deploying **SMART** to production.

---

## 📑 Summary Checklist

- [ ] **Step 1:** Run Database Cleanup Script (Deletes `Dev Sean Roma` user, teacher profile, and test class assignments).
- [ ] **Step 2:** Remove Server Initialization Hook (`server/src/index.ts`).
- [ ] **Step 3:** Remove Developer Bypass in Middleware (`server/src/middleware/auth.ts`).
- [ ] **Step 4:** Clean Developer Fallback in Auth Route (`server/src/routes/auth.ts`).
- [ ] **Step 5:** Clean Database Seed File (`server/prisma/seed.ts`).
- [ ] **Step 6:** Delete Backend Dev Files (`ensureDevAccount.ts`, `seed-dev.ts`, `test-dev-auth.ts`).
- [ ] **Step 7:** Revert Frontend Login Role Checks (`LoginPage.tsx`, `AdminLoginPage.tsx`, `RegistrarLoginPage.tsx`).
- [ ] **Step 8:** Remove `DevPortalSwitcher` Component & Layout References (`TeacherLayout.tsx`, `AdminLayout.tsx`, `RegistrarLayout.tsx`).
- [ ] **Step 9:** Verify Production Build & Run Final Typecheck (`tsc --noEmit`).

---

## 🗄️ Step 1: Database Cleanup

### Option A: Run Automated Cleanup Script (Recommended)
Run the pre-built removal script inside the `server/` folder:
```bash
cd server
npx ts-node scripts/remove-dev-account.ts
```

### Option B: Manual SQL Cleanup (PostgreSQL)
If connecting directly to your PostgreSQL database (e.g. via pgAdmin or psql):
```sql
-- 1. Delete class assignments linked to dev teacher
DELETE FROM "ClassAssignment"
WHERE "teacherId" IN (
  SELECT id FROM "Teacher" WHERE "employeeId" = '999999'
);

-- 2. Delete teacher profile
DELETE FROM "Teacher" WHERE "employeeId" = '999999';

-- 3. Delete user account
DELETE FROM "User" WHERE "username" = '999999' OR "email" = 'dev.sean@smart.local';
```

---

## 🖥️ Step 2: Remove Server Startup Hook

**File:** [server/src/index.ts](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/server/src/index.ts)

1. Remove import:
   ```diff
   - import { ensureDevAccount } from "./lib/ensureDevAccount";
   ```

2. Remove call in `app.listen`:
   ```diff
    app.listen(PORT, async () => {
      console.log(`Server running on http://localhost:${PORT}`);
   -  // Ensure universal developer account is ready
   -  await ensureDevAccount();
      // Start unified sync scheduler to periodically sync EnrollPro and ATLAS
      startUnifiedSyncScheduler();
    });
   ```

---

## 🔒 Step 3: Remove Developer Bypass in Middleware

**File:** [server/src/middleware/auth.ts](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/server/src/middleware/auth.ts)

1. In `authorizeRoles`, remove the developer superuser bypass:
   ```diff
    export const authorizeRoles = (...allowedRoles: string[]) => {
      return (req: AuthRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
          res.status(401).json({ message: "Authentication required" });
          return;
        }

   -    // Universal developer bypass: Developer account can access all role endpoints
   -    if (req.user.isDeveloper || req.user.role === "DEVELOPER" || req.user.username === "999999") {
   -      return next();
   -    }

        if (!allowedRoles.includes(req.user.role)) {
          res.status(403).json({ message: "Access denied. Insufficient permissions." });
          return;
        }

        next();
      };
    };
   ```

---

## 🔑 Step 4: Clean Developer Fallback in Auth Route

**File:** [server/src/routes/auth.ts](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/server/src/routes/auth.ts)

1. Remove hardcoded developer name / username references (`999999`, `dev.sean@smart.local`, `Dev Sean Roma`).
2. Restore standard login payload without `isDeveloper`:
   ```diff
   - isDeveloper = Boolean(
   -   isDeveloper ||
   -   user.username === "999999" ||
   -   user.email === "dev.sean@smart.local" ||
   -   (user.firstName?.toLowerCase().includes("dev") && user.lastName?.toLowerCase().includes("roma"))
   - );
   ```

---

## 🌱 Step 5: Clean Database Seed File

**File:** [server/prisma/seed.ts](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/server/prisma/seed.ts)

1. Remove Dev Sean Roma seeding block:
   ```diff
   - const devPasswordHash = bcrypt.hashSync("dev123", saltRounds);
   -
   - // 0. Create Dev Sean Roma (Universal Developer Account)
   - console.log("Seeding Dev Sean Roma (Developer User)...");
   - const devUser = await prisma.user.create({ ... });
   - const devTeacher = await prisma.teacher.create({ ... });
   ```

---

## 🗑️ Step 6: Delete Backend Dev Helper Files

Delete the following temporary development files:
- `server/src/lib/ensureDevAccount.ts`
- `server/scripts/seed-dev.ts`
- `server/scripts/test-dev-auth.ts`
- `server/scripts/remove-dev-account.ts`

---

## 🎨 Step 7: Revert Frontend Login Role Checks

In the login pages, restore strict role checks:

### 1. [src/pages/LoginPage.tsx](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/src/pages/LoginPage.tsx)
```diff
- const isDev = Boolean(response.data.user.isDeveloper || response.data.user.username === "999999" || response.data.user.role === "ADMIN");
- if (response.data.user.role !== "TEACHER" && !isDev) {
+ if (response.data.user.role !== "TEACHER") {
    setError("Access denied. This portal is for teachers only.");
    setIsLoading(false);
    return;
  }
```

### 2. [src/pages/AdminLoginPage.tsx](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/src/pages/AdminLoginPage.tsx)
```diff
- const isDev = Boolean(response.data.user.isDeveloper || response.data.user.username === "999999");
- if (response.data.user.role !== "ADMIN" && !isDev) {
+ if (response.data.user.role !== "ADMIN") {
    setError("Access denied. This portal is for administrators only.");
    setIsLoading(false);
    return;
  }
```

### 3. [src/pages/RegistrarLoginPage.tsx](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/src/pages/RegistrarLoginPage.tsx)
```diff
- const isDev = Boolean(response.data.user.isDeveloper || response.data.user.username === "999999" || response.data.user.role === "ADMIN");
- if (response.data.user.role !== "REGISTRAR" && !isDev) {
+ if (response.data.user.role !== "REGISTRAR") {
    setError("Access denied. This portal is for registrars only.");
    setIsLoading(false);
    return;
  }
```

---

## 🧭 Step 8: Remove DevPortalSwitcher & Layout References

1. **Delete file:** `src/components/DevPortalSwitcher.tsx`
2. **In [src/layouts/TeacherLayout.tsx](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/src/layouts/TeacherLayout.tsx):**
   - Remove `import DevPortalSwitcher from "@/components/DevPortalSwitcher";`
   - Remove `<DevPortalSwitcher user={user} />` from the header.
   - Revert `useEffect` check: `if (parsedUser.role !== "TEACHER") navigate("/login");`
3. **In [src/layouts/AdminLayout.tsx](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/src/layouts/AdminLayout.tsx):**
   - Remove `import DevPortalSwitcher from "@/components/DevPortalSwitcher";`
   - Remove `<DevPortalSwitcher user={user} />` from the header.
   - Revert `useEffect` check: `if (parsedUser.role !== "ADMIN") navigate("/login");`
4. **In [src/layouts/RegistrarLayout.tsx](file:///c:/Users/Sean/Desktop/SMART_FINAL_CAPSTONE/src/layouts/RegistrarLayout.tsx):**
   - Remove `import DevPortalSwitcher from "@/components/DevPortalSwitcher";`
   - Remove `<DevPortalSwitcher user={user} />` from the header.
   - Revert `useEffect` check: `if (parsedUser.role !== "REGISTRAR") navigate("/login");`

---

## 🛡️ Step 9: Final Pre-Deployment Security Checks

1. **Change JWT Secret**: Ensure `JWT_SECRET` in `server/.env` is a strong, random 256-bit string.
2. **Check CORS Origins**: Verify `cors` in `server/src/index.ts` only allows the production frontend domain (e.g. your deployed URL).
3. **Reset Default Admin / Registrar Passwords**: Change default passwords (`AdminPassword123!`, `RegistrarPassword123!`) if you seeded them.
4. **Run Build & Typecheck**:
   ```bash
   # In root directory
   npm run build
   npx tsc --noEmit

   # In server directory
   cd server
   npm run build
   npx tsc --noEmit
   ```
