import { Router, Response } from "express";
import { Role, AuditAction, AuditSeverity } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { createAuditLog } from "../../lib/audit";
import { getEnrollProTeachers } from "../../lib/enrollproClient";
import { logger } from "../../lib/logger";
import { validate } from "../../middleware/validate";
import {
  userCreateSchema,
  userUpdateSchema,
  userDeleteSchema,
  userSuspendSchema,
} from "../../schemas/admin";
import { requireAdmin } from "./helpers";

export default function (router: Router) {
  // Get all users with filtering
  router.get("/users", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { search, role, status } = req.query;

      const where: any = {};

      if (search) {
        where.OR = [
          { username: { contains: search as string, mode: "insensitive" } },
          { firstName: { contains: search as string, mode: "insensitive" } },
          { lastName: { contains: search as string, mode: "insensitive" } },
          { email: { contains: search as string, mode: "insensitive" } },
        ];
      }

      if (role && role !== "all") {
        where.role = role as Role;
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          firstName: true,
          lastName: true,
          email: true,
          createdAt: true,
          updatedAt: true,
          teacher: {
            select: {
              employeeId: true,
              specialization: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      let enrollProTeachers: any[] = [];
      try {
        enrollProTeachers = await getEnrollProTeachers();
      } catch (err) {
        logger.error("Failed to fetch EnrollPro teachers for user management mapping:", err);
      }

      const usersWithStatus = users.map((user) => {
        let resolvedEmployeeId = user.teacher?.employeeId || user.username;

        if (user.role === "TEACHER" && enrollProTeachers.length > 0) {
          const epTeacher = enrollProTeachers.find((et) => {
            const emailMatch = et.email && user.email && et.email.toLowerCase() === user.email.toLowerCase();
            const nameMatch = et.firstName && et.lastName && user.firstName && user.lastName &&
              et.firstName.toLowerCase().trim() === user.firstName.toLowerCase().trim() &&
              et.lastName.toLowerCase().trim() === user.lastName.toLowerCase().trim();
            const idMatch = String(et.id) === user.username || String(et.id) === user.teacher?.employeeId;
            const empIdMatch = et.employeeId && (et.employeeId === user.teacher?.employeeId || et.employeeId === user.username);
            return emailMatch || nameMatch || idMatch || empIdMatch;
          });

          if (epTeacher?.employeeId) {
            resolvedEmployeeId = epTeacher.employeeId;
          }
        }

        return {
          ...user,
          teacher: user.teacher
            ? { ...user.teacher, employeeId: resolvedEmployeeId }
            : { employeeId: resolvedEmployeeId },
          status: user.status || "Active",
          lastActive: user.updatedAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        };
      });

      res.json({ users: usersWithStatus });
    } catch (error) {
      logger.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Create new user
  router.post("/users", authenticateToken, requireAdmin, validate(userCreateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { username, password, role, firstName, lastName, email, employeeId, specialization } = req.body;

      const existing = await prisma.user.findUnique({
        where: { username },
      });

      if (existing) {
        res.status(400).json({ message: "Username already exists" });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          role: role as Role,
          firstName,
          lastName,
          email,
        },
      });

      if (role === "TEACHER" && employeeId) {
        await prisma.teacher.create({
          data: {
            userId: user.id,
            employeeId,
            specialization,
          },
        });
      }

      await createAuditLog(
        AuditAction.CREATE,
        req.user!,
        "User Account",
        "User",
        `Created new ${role.toLowerCase()} account: ${firstName} ${lastName}`,
        req.ip,
        AuditSeverity.INFO,
        user.id
      );

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        },
      });
    } catch (error) {
      logger.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update user
  router.put("/users/:id", authenticateToken, requireAdmin, validate(userUpdateSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { username, password, role, firstName, lastName, email, employeeId, specialization } = req.body;

      const existingUser = await prisma.user.findUnique({
        where: { id },
        include: { teacher: true },
      });

      if (!existingUser) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      if (username !== existingUser.username) {
        const conflict = await prisma.user.findUnique({
          where: { username },
        });
        if (conflict) {
          res.status(400).json({ message: "Username already taken" });
          return;
        }
      }

      const updateData: any = {
        username,
        role: role as Role,
        firstName,
        lastName,
        email,
      };

      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      const user = await prisma.user.update({
        where: { id },
        data: updateData,
      });

      if (role === "TEACHER") {
        if (existingUser.teacher) {
          await prisma.teacher.update({
            where: { userId: id },
            data: { employeeId, specialization },
          });
        } else if (employeeId) {
          await prisma.teacher.create({
            data: {
              userId: id,
              employeeId,
              specialization,
            },
          });
        }
      } else if (existingUser.teacher) {
        await prisma.teacher.delete({
          where: { userId: id },
        });
      }

      await createAuditLog(
        AuditAction.UPDATE,
        req.user!,
        "User Account",
        "User",
        `Updated user account: ${firstName} ${lastName}`,
        req.ip,
        AuditSeverity.INFO,
        user.id
      );

      res.json({
        message: "User updated successfully",
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        },
      });
    } catch (error) {
      logger.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Delete user
  router.delete("/users/:id", authenticateToken, requireAdmin, validate(userDeleteSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;

      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      if (user.id === req.user!.id) {
        res.status(400).json({ message: "Cannot delete your own account" });
        return;
      }

      await prisma.user.delete({
        where: { id },
      });

      await createAuditLog(
        AuditAction.DELETE,
        req.user!,
        "User Account",
        "User",
        `Deleted user account: ${user.firstName} ${user.lastName} (${user.username})`,
        req.ip,
        AuditSeverity.WARNING,
        id
      );

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      logger.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Suspend user
  router.post("/users/:id/suspend", authenticateToken, requireAdmin, validate(userSuspendSchema), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id);
      const { reason } = req.body;

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      if (user.id === req.user!.id) {
        res.status(400).json({ message: "Cannot suspend your own account" });
        return;
      }

      await prisma.user.update({
        where: { id },
        data: {
          status: 'SUSPENDED',
          suspendedAt: new Date(),
          suspendedBy: req.user!.id,
          suspensionReason: reason || null,
        },
      });

      await prisma.refreshToken.deleteMany({ where: { userId: id } });

      const teacher = await prisma.teacher.findUnique({ where: { userId: id } });
      if (teacher) {
        await prisma.classAssignment.updateMany({
          where: { teacherId: teacher.id, isActive: true },
          data: { isActive: false, archivedAt: new Date(), archivedReason: 'Teacher suspended' },
        });
      }

      await createAuditLog(
        AuditAction.UPDATE,
        req.user!,
        "User Account",
        "User",
        `Suspended user: ${user.firstName} ${user.lastName} (${user.username})${reason ? ` — Reason: ${reason}` : ''}`,
        req.ip,
        AuditSeverity.WARNING,
        id
      );

      res.json({ message: "User suspended successfully" });
    } catch (error) {
      logger.error("Error suspending user:", error);
      res.status(500).json({ message: "Failed to suspend user" });
    }
  });

  // Reactivate user
  router.post("/users/:id/reactivate", authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const id = String(req.params.id);

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      await prisma.user.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          suspendedAt: null,
          suspendedBy: null,
          suspensionReason: null,
        },
      });

      await createAuditLog(
        AuditAction.UPDATE,
        req.user!,
        "User Account",
        "User",
        `Reactivated user: ${user.firstName} ${user.lastName} (${user.username})`,
        req.ip,
        AuditSeverity.INFO,
        id
      );

      res.json({ message: "User reactivated successfully" });
    } catch (error) {
      logger.error("Error reactivating user:", error);
      res.status(500).json({ message: "Failed to reactivate user" });
    }
  });
}
