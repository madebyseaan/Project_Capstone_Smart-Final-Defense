import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { createAuditLog } from "../lib/audit";
import { validateEnrollProTeacherCredentials } from "../lib/enrollproClient";
import { triggerImmediateSync } from "../lib/syncCoordinator";
import { isDevelopment } from "../config/env";
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
router.post("/login", loginLimiter, async (req: Request, res: Response): Promise<void> => {
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
    let isDeveloper = false;
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
        isDeveloper = isDevelopment() && user.username === (process.env.DEV_USERNAME || "999999");
        console.log(`[Auth] Authenticated local user "${user.username}" (isDeveloper: ${isDeveloper}).`);
      }
    }

    // 2. If not matched locally, try live EnrollPro authentication (EnrollPro is SSOT for live school accounts)
    if (!user || !isValidPassword) {
      try {
        epAuthResult = await validateEnrollProTeacherCredentials(email, password);
        isEpServiceReachable = epAuthResult.isReachable;
      } catch (epErr: any) {
        console.warn(`[Auth] EnrollPro auth service unreachable for "${email}":`, epErr.message);
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

        // Find local user by username or email
        let existingUser = await prisma.user.findFirst({
          where: { OR: [{ username: empId }, { email: userEmail }, { email }] },
        });

        if (!existingUser) {
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
          user = await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              username: empId,
              password: hashedPassword,
              role: assignedRole,
              firstName: epUser.firstName ?? existingUser.firstName,
              lastName: epUser.lastName ?? existingUser.lastName,
            },
          });
        }

        isValidPassword = true;
        console.log(`[Auth] Authenticated & synced user "${empId}" (${assignedRole}) via EnrollPro live SSOT.`);
      }
    }

    // Ensure teacher profile exists if teacher or developer
    if (user && isValidPassword && (user.role === 'TEACHER' || isDeveloper)) {
      const empId = user.username || email;
      try {
        await prisma.teacher.upsert({
          where: { employeeId: empId },
          update: { userId: user.id },
          create: { employeeId: empId, userId: user.id },
        });
        if (user.role === 'TEACHER' && !isDeveloper) {
          triggerImmediateSync('login');
        }
      } catch (tErr: any) {
        console.warn(`[Auth] Failed to upsert Teacher record for ${empId}:`, tErr.message);
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
        ? "Your account has been suspended. Contact administration."
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

    // Issue access + refresh token pair
    const accessToken = signAccessToken({
      id: user.id,
      username: user.username,
      email: user.email ?? undefined,
      role: user.role,
      isDeveloper,
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
      `${user.firstName || ""} ${user.lastName || ""} (${isDeveloper ? 'DEVELOPER' : user.role}) logged in successfully`,
      ipAddress,
      AuditSeverity.INFO
    );

    res.json({
      message: "Login successful",
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        isDeveloper,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh token endpoint — exchanges refresh token for new access + refresh pair
router.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  try {
    const rawToken = req.cookies?.refreshToken;
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
      console.warn(`[Auth] Refresh token reuse detected for family ${record.familyId} — entire family revoked.`);
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
      isDeveloper: isDevelopment() && dbUser.username === (process.env.DEV_USERNAME || "999999"),
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
    res.json({ token: newAccessTokenFinal });
  } catch (error) {
    console.error("Refresh error:", error);
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

    const isDeveloper =
      isDevelopment() && user.username === (process.env.DEV_USERNAME || "999999") ||
      Boolean(req.user?.isDeveloper);

    res.json({
      ...user,
      isDeveloper,
    });
  } catch (error) {
    console.error("Get user error:", error);
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
    console.error("Logout error:", error);
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
    console.error("Logout all error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
