import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth";
import gradesRoutes from "./routes/grades";
import advisoryRoutes from "./routes/advisory";
import registrarRoutes from "./routes/registrar";
import adminRoutes from "./routes/admin";
import attendanceRoutes from "./routes/attendance";
import templateRoutes from "./routes/templates";
import syncRoutes from "./routes/sync";
import integrationRoutes from "./routes/integration";
import { globalLimiter } from "./middleware/rateLimiter";
import { csrfProtection } from "./middleware/csrf";

const app = express();

app.set("trust proxy", 1);

const defaultOrigins = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"];
const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : [];
const allowedOrigins = envOrigins.length > 0 ? envOrigins : defaultOrigins;

app.use(cookieParser());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());

app.use("/api", globalLimiter);
app.use(csrfProtection);

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/grades", gradesRoutes);
app.use("/api/advisory", advisoryRoutes);
app.use("/api/registrar", registrarRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/integration", integrationRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
