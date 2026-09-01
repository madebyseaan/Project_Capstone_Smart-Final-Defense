import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { createAuditLog } from "../lib/audit";
import { validateEnrollProTeacherCredentials } from "../lib/enrollproClient";
import { getCachedEnrollProTeachers } from "../lib/syncCache";
import { triggerImmediateSync } from "../lib/syncCoordinator";
import { logger } from "../lib/logger";
import { validate } from "../middleware/validate";
import { loginSchema } from "../schemas/auth";
import {
  signAccessToken,
  generateRefreshTokenPair,
  REFRESH_COOKIE_OPTIONS,
  ACCESS_COOKIE_OPTIONS,
  hashToken,
} from "../lib/tokens";

const router = Router();

// Rate limiter for login endpoint — prevents brute-force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window per key
  skipSuccessfulRequests: true, // only count failed attempts
  keyGenerator: (req) => {
    const identifier = req.body?.email || req.body?.username || "unknown";
    return `login:${ipKeyGenerator(req.ip || "127.0.0.1")}:${identifier}`;
  },
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

// Login route (rate-limited to prevent brute-force)
router.post("/login", loginLimiter, validate(loginSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    let { email, password } = req.body;
    const ipAddress = req.ip || req.socket.remoteAddress;

    if (!email || !password) {
      res.status(400).json({ message: "Email and password are required" });
      return;
    }

    email = email.trim();

    let user = null;
    let isValidPassword = false;
    let epAuthResult = null;
    let isEpServiceReachable = false;

    // 1. Check local database first (instantly authenticates Developer & local accounts without EnrollPro rejection)
    let localUser = null;
    if (!email.includes('@')) {
      const teacher = await prisma.teacher.findUnique({
        where: { employeeId: email },
        include: { user: true },
      });
      localUser = teacher?.user ?? (await prisma.user.findUnique({ where: { username: email } }));
    }
    if (!localUser) {
      localUser = await prisma.user.findFirst({
        where: { OR: [{ email }, { username: email }] },
      });
    }

    if (localUser) {
      const localMatch = await bcrypt.compare(password, localUser.password);
      if (localMatch) {
        user = localUser;
        isValidPassword = true;
        logger.info(`[Auth] Authenticated local user "${user.username}".`);
      }
    }

    // 1b. Faculty gate for locally-authenticated teachers (5-min staleness closer)
    if (user && isValidPassword && user.role === 'TEACHER') {
      try {
        const epFaculty = await getCachedEnrollProTeachers();
        const employeeId = user.username;
        if (epFaculty.length > 0 && !epFaculty.some((t) => String(t.employeeId ?? '').trim() === employeeId)) {
          await createAuditLog(
            AuditAction.LOGIN,
            { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
            `Login blocked: ${user.username} (not in EnrollPro faculty)`,
            'Auth',
            `Login attempt blocked — teacher not enrolled in EnrollPro for current school year`,
            ipAddress,
            AuditSeverity.WARNING,
          );
          res.status(401).json({ message: 'Account is not enrolled in EnrollPro for the current school year' });
          return;
        }
      } catch {
        // EP unreachable — fall back to local status check only
        logger.warn('[Auth] EP faculty list unreachable during login gate — falling back to local status');
      }
    }

    // 2. If not matched locally, try live EnrollPro authentication (EnrollPro is SSOT for live school accounts)
    if (!user || !isValidPassword) {
      try {
        epAuthResult = await validateEnrollProTeacherCredentials(email, password);
        isEpServiceReachable = epAuthResult.isReachable;
      } catch (epErr: any) {
        logger.warn(`[Auth] EnrollPro auth service unreachable for "${email}":`, epErr.message);
        isEpServiceReachable = false;
      }

      if (isEpServiceReachable && epAuthResult?.user) {
        const epUser = epAuthResult.user;
        const hashedPassword = await bcrypt.hash(password, 10);
        const empId = String(epUser.employeeId ?? epUser.accountName ?? email).trim();
        const userEmail = epUser.email ?? (email.includes('@') ? email : `${empId}@deped.gov.ph`);

        const rolesList: string[] = Array.isArray(epUser.roles) ? epUser.roles : [epUser.role].filter(Boolean);
        const isAdminRole = rolesList.some((r) => ['ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN'].includes(String(r).toUpperCase()));
        const isRegistrarRole = rolesList.some((r) => ['REGISTRAR', 'HEAD_REGISTRAR', 'SCHOOL_REGISTRAR', 'REGISTRATION_OFFICER'].includes(String(r).toUpperCase()));
        const assignedRole = isAdminRole ? 'ADMIN' : (isRegistrarRole ? 'REGISTRAR' : 'TEACHER');

        // Faculty gate: TEACHER must be in EP faculty list
        let isFacultyMember = true;
        if (assignedRole === 'TEACHER') {
          try {
            const epFaculty = await getCachedEnrollProTeachers();
            isFacultyMember = epFaculty.length > 0 && epFaculty.some((t) => String(t.employeeId ?? '').trim() === empId);
          } catch {
            // EP unreachable — for live-auth, allow existing users only
            isFacultyMember = false;
          }
        }

        // Find local user by username or email
        const existingUser = await prisma.user.findFirst({
          where: { OR: [{ username: empId }, { email: userEmail }, { email }] },
        });

        if (!existingUser) {
          if (!isFacultyMember) {
            // Cannot verify membership or not a faculty member — block
            res.status(401).json({
              message: assignedRole === 'TEACHER'
                ? 'Authenticated on EnrollPro but not a current faculty member. Contact your school administrator.'
                : 'Authentication failed.',
            });
            return;
          }
          user = await prisma.user.create({
            data: {
              username: empId,
              email: userEmail,
              password: hashedPassword,
              role: assignedRole,
              firstName: epUser.firstName ?? '',
              lastName: epUser.lastName ?? '',
            },
          });
        } else {
          // Never modify status via live-auth — only prune engine or admin changes status
          if (!isFacultyMember) {
            // Block login if not faculty — but don't touch the existing user
            if (existingUser.status !== 'ACTIVE') {
              res.status(401).json({ message: 'Authentication failed.' });
              return;
            }
            res.status(401).json({
              message: 'Authenticated on EnrollPro but not a current faculty member. Contact your school administrator.',
            });
            return;
          }
          user = await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              username: empId,
              password: hashedPassword,
              role: assignedRole,
              firstName: epUser.firstName ?? existingUser.firstName,
              lastName: epUser.lastName ?? existingUser.lastName,
              // NOTE: status is NEVER modified here — prune engine or admin owns status
            },
          });
        }

        isValidPassword = true;
        logger.info(`[Auth] Authenticated & synced user "${empId}" (${assignedRole}) via EnrollPro live SSOT.`);
      }
    }

    // Ensure teacher profile exists if teacher
    if (user && isValidPassword && user.role === 'TEACHER') {
      const empId = user.username || email;
      try {
        await prisma.teacher.upsert({
          where: { employeeId: empId },
          update: { userId: user.id },
          create: { employeeId: empId, userId: user.id },
        });
        triggerImmediateSync('login');
      } catch (tErr: any) {
        logger.warn(`[Auth] Failed to upsert Teacher record for ${empId}:`, tErr.message);
      }
    }

    if (!user || !isValidPassword) {
      // Log failed login attempt
      await createAuditLog(
        AuditAction.LOGIN,
        { firstName: email, lastName: null, role: "UNKNOWN" },
        `Login attempt: ${email}`,
        "Auth",
        `Failed login attempt for: ${email} — invalid credentials`,
        ipAddress,
        AuditSeverity.WARNING
      );
      res.status(401).json({ message: "Invalid username or password" });
      return;
    }

    // Check user status — suspended/deactivated users cannot log in
    if (user.status !== "ACTIVE") {
      const statusMessage = user.status === "SUSPENDED"
        ? "Your account was removed from EnrollPro and can no longer access SMART."
        : "Your account has been deactivated.";
      await createAuditLog(
        AuditAction.LOGIN,
        { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
        `Login blocked: ${user.username} (status: ${user.status})`,
        "Auth",
        `Login attempt blocked — account is ${user.status.toLowerCase()}`,
        ipAddress,
        AuditSeverity.WARNING
      );
      res.status(403).json({ message: statusMessage });
      return;
    }

    if (user.role === "TEACHER") {
      const sysSettings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      if (sysSettings?.transitionLock) {
        await createAuditLog(
          AuditAction.LOGIN,
          { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
          `Login blocked: ${user.username} (transition lock)`,
          "Auth",
          `Login attempt blocked — school year transition in progress`,
          ipAddress,
          AuditSeverity.WARNING
        );
        res.status(403).json({
          code: "TRANSITION_LOCKED",
          message: sysSettings.transitionNote || "School year transition in progress. Please try again later.",
        });
        return;
      }
    }

    // Issue access + refresh token pair
    const accessToken = signAccessToken({
      id: user.id,
      username: user.username,
      email: user.email ?? undefined,
      role: user.role,
    });

    const { raw: refreshRaw, hashed: refreshHashed, expiresAt, familyId } = generateRefreshTokenPair();

    await prisma.refreshToken.create({
      data: {
        token: refreshHashed,
        userId: user.id,
        familyId,
        expiresAt,
      },
    });

    // Set refresh token as httpOnly cookie
    res.cookie("refreshToken", refreshRaw, REFRESH_COOKIE_OPTIONS);
    // Set access token as cookie (readable by Axios for auth)
    res.cookie("accessToken", accessToken, ACCESS_COOKIE_OPTIONS);

    // Log successful login
    await createAuditLog(
      AuditAction.LOGIN,
      { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
      `Login: ${user.email}`,
      "Auth",
      `${user.firstName || ""} ${user.lastName || ""} (${user.role}) logged in successfully`,
      ipAddress,
      AuditSeverity.INFO
    );

    res.json({
      message: "Login successful",
      token: accessToken,
      refreshToken: refreshRaw,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    logger.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh token endpoint — exchanges refresh token for new access + refresh pair
router.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  try {
    // Accept refresh token from header, body, or cookie (multi-session support)
    const rawToken = (req.headers["x-refresh-token"] as string)
      || req.body?.refreshToken
      || req.cookies?.refreshToken;
    if (!rawToken) {
      res.status(401).json({ message: "Refresh token required" });
      return;
    }

    const hashed = hashToken(rawToken);
    const record = await prisma.refreshToken.findUnique({
      where: { token: hashed },
      include: { user: { select: { id: true, status: true } } },
    });

    // Invalid or expired token
    if (!record || record.expiresAt < new Date()) {
      res.status(401).json({ message: "Invalid refresh token" });
      return;
    }

    // Reuse detection — token was already used
    if (record.revokedAt) {
      // Revoke entire family (stolen token)
      await prisma.refreshToken.updateMany({
        where: { familyId: record.familyId },
        data: { revokedAt: new Date() },
      });
      logger.warn(`[Auth] Refresh token reuse detected for family ${record.familyId} — entire family revoked.`);
      res.status(401).json({ message: "Token reuse detected. Please log in again." });
      return;
    }

    // Check user is still active
    if (!record.user || record.user.status !== "ACTIVE") {
      res.status(403).json({ message: "Account is not active" });
      return;
    }

    // Revoke current token
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    // Issue new pair
    const newAccessToken = signAccessToken({
      id: record.user.id,
      username: record.user.id, // Will be overridden by middleware lookup
      role: "TEACHER", // Will be overridden by middleware lookup
    });

    // Get user data for new tokens
    const dbUser = await prisma.user.findUnique({
      where: { id: record.user.id },
      select: { id: true, username: true, email: true, role: true },
    });

    if (!dbUser) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    const newAccessTokenFinal = signAccessToken({
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email ?? undefined,
      role: dbUser.role,
    });

    const { raw: newRefreshRaw, hashed: newRefreshHashed, expiresAt: newExpiresAt } = generateRefreshTokenPair(record.familyId);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshHashed,
        userId: record.userId,
        familyId: record.familyId,
        expiresAt: newExpiresAt,
      },
    });

    res.cookie("refreshToken", newRefreshRaw, REFRESH_COOKIE_OPTIONS);
    // Set new access token as cookie
    res.cookie("accessToken", newAccessTokenFinal, ACCESS_COOKIE_OPTIONS);
    res.json({ token: newAccessTokenFinal, refreshToken: newRefreshRaw });
  } catch (error) {
    logger.error("Refresh error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get current user (protected route)
router.get("/me", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: {
        id: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(user);
  } catch (error) {
    logger.error("Get user error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Logout — revoke refresh token and clear cookie
router.post("/logout", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;

    // Revoke refresh token from cookie
    const rawToken = req.cookies?.refreshToken;
    if (rawToken) {
      const hashed = hashToken(rawToken);
      await prisma.refreshToken.deleteMany({
        where: { token: hashed },
      });
    }

    // Clear the refresh token cookie
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
    });
    // Clear the access token cookie
    res.clearCookie("accessToken", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    if (req.user) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, username: true, firstName: true, lastName: true, role: true },
      });
      if (user) {
        await createAuditLog(
          AuditAction.LOGOUT,
          { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
          `Logout: ${user.username}`,
          "Auth",
          `${user.firstName || ""} ${user.lastName || ""} (${user.role}) logged out`,
          ipAddress,
          AuditSeverity.INFO
        );
      }
    }
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    logger.error("Logout error:", error);
    res.json({ message: "Logged out successfully" });
  }
});

// Logout all devices — revoke all refresh tokens for this user
router.post("/logout-all", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user) {
      await prisma.refreshToken.deleteMany({
        where: { userId: req.user.id },
      });
    }

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
    });
    res.clearCookie("accessToken", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    res.json({ message: "Logged out from all devices" });
  } catch (error) {
    logger.error("Logout all error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
