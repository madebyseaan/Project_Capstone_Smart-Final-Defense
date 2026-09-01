import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { verifyAccessToken } from "../lib/tokens";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    email?: string;
    status?: string;
  };
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers["authorization"];
  // Also accept token as query param (needed for EventSource/SSE which can't set headers)
  // Also accept accessToken from cookie (Axios sends cookies via withCredentials)
  const token = (authHeader && authHeader.split(" ")[1])
    || (req.query.token as string | undefined)
    || (req as any).cookies?.accessToken;

  if (!token) {
    res.status(401).json({ message: "Access token required" });
    return;
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    res.status(403).json({ message: "Invalid or expired token" });
    return;
  }

  // Check user status in database — ensures suspended users are blocked immediately
  const dbUser = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, status: true },
  });

  if (!dbUser || dbUser.status !== "ACTIVE") {
    res.status(403).json({ message: "Account is not active. Contact administration." });
    return;
  }

  req.user = { ...decoded, status: dbUser.status };
  next();
};

export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: "Access denied. Insufficient permissions." });
      return;
    }

    next();
  };
};
