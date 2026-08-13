import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { createAuditLog } from "../lib/audit";
import { validateEnrollProTeacherCredentials } from "../lib/enrollproClient";
import { triggerImmediateSync } from "../lib/syncCoordinator";

const router = Router();

// Login route
router.post("/login", async (req: Request, res: Response): Promise<void> => {
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

    // 1. Prioritize live EnrollPro authentication (EnrollPro is SSOT for accounts)
    try {
      epAuthResult = await validateEnrollProTeacherCredentials(email, password);
      isEpServiceReachable = epAuthResult.isReachable;
    } catch (epErr: any) {
      console.warn(`[Auth] EnrollPro auth service unreachable for "${email}":`, epErr.message);
      isEpServiceReachable = false;
    }

    if (isEpServiceReachable) {
      if (epAuthResult?.user) {
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
      } else {
        console.warn(`[Auth] EnrollPro live SSOT rejected login attempt for "${email}".`);
      }
    } else {
      // 2. Offline fallback ONLY if EnrollPro service was unreachable (not for invalid credentials)
      let localUser = null;
      if (!email.includes('@')) {
        const teacher = await prisma.teacher.findUnique({
          where: { employeeId: email },
          include: { user: true },
        });
        localUser = teacher?.user ?? (await prisma.user.findUnique({ where: { username: email } }));
      }
      if (!localUser) {
        localUser = await prisma.user.findFirst({ where: { email } });
      }

      if (localUser) {
        const localMatch = await bcrypt.compare(password, localUser.password);
        if (localMatch) {
          user = localUser;
          isValidPassword = true;
          console.log(`[Auth] Offline fallback authenticated local user "${localUser.username}".`);
        }
      }
    }

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

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET || "fallback-secret",
      { expiresIn: "24h" }
    );

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

    // Live background sync triggers disabled due to external refactoring timeouts


    res.json({
      message: "Login successful",
      token,
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
    console.error("Login error:", error);
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
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(user);
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Logout
router.post("/logout", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
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

export default router;
