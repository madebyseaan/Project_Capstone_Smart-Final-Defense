import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { createAuditLog } from "../lib/audit";
import { getEnrollProTeachers, validateEnrollProTeacherCredentials } from "../lib/enrollproClient";
import { syncTeacherOnLogin } from "../lib/teacherSync";
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
    let epAuthResult = null; // Store EnrollPro auth result if obtained during JIT provisioning

    // If the identifier looks like an employee ID (no @ sign), try teacher lookup first,
    // then username (admin / registrar use their employee ID as username)
    if (!email.includes('@')) {
      const teacher = await prisma.teacher.findUnique({
        where: { employeeId: email },
        include: { user: true },
      });
      user = teacher?.user ?? null;

      if (!user) {
        user = await prisma.user.findUnique({
          where: { username: email },
        });
      }
    }

    // Fall back to email lookup
    if (!user) {
      user = await prisma.user.findFirst({
        where: { email },
      });
    }

    // JIT Provisioning: If user not found but identifier looks like an employee ID,
    // check EnrollPro. If valid, create the account on-the-fly.
    if (!user && !email.includes("@")) {
      try {
        epAuthResult = await validateEnrollProTeacherCredentials(email, password);
        if (epAuthResult && epAuthResult.user) {
          const epRole = epAuthResult.user.role;
          const isStaff =
            epRole === "TEACHER" ||
            epRole === "SYSTEM_ADMIN" ||
            epRole === "HEAD_REGISTRAR";

          if (isStaff) {
            let smartRole: any = "TEACHER";
            if (epRole === "SYSTEM_ADMIN") smartRole = "ADMIN";
            else if (epRole === "HEAD_REGISTRAR") smartRole = "REGISTRAR";

            // Provision account
            const fallbackPasswordHash = await bcrypt.hash(
              crypto.randomBytes(32).toString("hex"),
              10
            );

            user = await prisma.user.create({
              data: {
                username: email,
                password: fallbackPasswordHash,
                role: smartRole,
                firstName: epAuthResult.user.firstName,
                lastName: epAuthResult.user.lastName,
                email: epAuthResult.user.email,
                ...(smartRole === "TEACHER"
                  ? {
                      teacher: {
                        create: {
                          employeeId: epAuthResult.user.employeeId || email,
                        },
                      },
                    }
                  : {}),
              },
              include: { teacher: true },
            });

            await createAuditLog(
              AuditAction.LOGIN,
              {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
              },
              `JIT Provisioning: ${email}`,
              "Auth",
              `${smartRole} account provisioned on-the-fly from EnrollPro for ${user.firstName} ${user.lastName}`,
              ipAddress,
              AuditSeverity.INFO
            );
          }
        }
      } catch (err) {
        console.error("[Auth] JIT provisioning error:", err);
        // Fall through to "Invalid username or password"
      }
    }

    if (!user) {
      // Log failed login attempt (unknown user)
      await createAuditLog(
        AuditAction.LOGIN,
        { firstName: email, lastName: null, role: "UNKNOWN" },
        `Login attempt: ${email}`,
        "Auth",
        `Failed login attempt for email: ${email} — user not found`,
        ipAddress,
        AuditSeverity.WARNING
      );
      res.status(401).json({ message: "Invalid username or password" });
      return;
    }

    const teacher = user.role === 'TEACHER'
      ? await prisma.teacher.findUnique({
          where: { userId: user.id },
          include: { user: true },
        })
      : null;

    // Verify password — for accounts linked to EnrollPro (via employeeId or username), 
    // first try EnrollPro credentials
    let isValidPassword = false;

    if (user.role === 'TEACHER' || user.role === 'ADMIN' || user.role === 'REGISTRAR') {
      const loginIdentifier = user.role === 'TEACHER' ? teacher?.employeeId : user.username;
      
      // Only attempt EnrollPro if the identifier looks like an employee ID (numeric-ish)
      const isPossibleEmployeeId = loginIdentifier && /^\d+$/.test(loginIdentifier);

      if (isPossibleEmployeeId) {
        try {
          const epResult = epAuthResult ?? await validateEnrollProTeacherCredentials(loginIdentifier, password);
          if (epResult) {
            // Verify roles match or are compatible
            const epRole = epResult.user.role;
            let roleMatched = false;
            
            if (user.role === 'TEACHER' && epRole === 'TEACHER') roleMatched = true;
            else if (user.role === 'ADMIN' && epRole === 'SYSTEM_ADMIN') roleMatched = true;
            else if (user.role === 'REGISTRAR' && epRole === 'HEAD_REGISTRAR') roleMatched = true;

            if (roleMatched) {
              isValidPassword = true;
            } else {
              console.warn(`[Auth] Role mismatch for ${loginIdentifier}: SMART=${user.role}, EnrollPro=${epRole}`);
              // Continue to local password check as fallback
            }
          }
        } catch (epErr) {
          console.warn('[Auth] EnrollPro unreachable for login:', (epErr as Error).message);
          // If EnrollPro is unreachable, we fall through to local bcrypt check for ADMIN/REGISTRAR
          // but fail-closed for TEACHER (as per existing policy).
          if (user.role === 'TEACHER') {
             res.status(503).json({ message: "EnrollPro is unavailable. Teacher login is temporarily disabled." });
             return;
          }
        }
      }
    }

    if (!isValidPassword) {
      isValidPassword = await bcrypt.compare(password, user.password);
    }

    if (!isValidPassword) {
      // Log failed login (wrong password)
      await createAuditLog(
        AuditAction.LOGIN,
        { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
        `Login attempt: ${email}`,
        "Auth",
        `Failed login attempt for ${user.firstName || ""} ${user.lastName || ""} (${user.role}) — incorrect password`,
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

    // For teachers: fire-and-forget real-time sync from EnrollPro + Atlas
    if (user.role === 'TEACHER') {
      if (teacher?.employeeId && user.email) {
        syncTeacherOnLogin(teacher.id, teacher.employeeId, user.email).catch((e: Error) => {
          console.error('[Auth] Teacher sync error:', e.message);
        });
      }
    }

    // For admins and registrars: trigger non-blocking unified sync so dashboard starts fresh.
    if (user.role === 'ADMIN' || user.role === 'REGISTRAR') {
      triggerImmediateSync(`${user.role.toLowerCase()}_login`);
    }


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
