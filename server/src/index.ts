import dotenv from "dotenv";
import path from "path";

// Load environment variables with explicit path
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import gradesRoutes from "./routes/grades";
import advisoryRoutes from "./routes/advisory";
import registrarRoutes from "./routes/registrar";
import adminRoutes from "./routes/admin";
import attendanceRoutes from "./routes/attendance";
import templateRoutes from "./routes/templates";
import ecrTemplatesRoutes from "./routes/ecrTemplates";
import syncRoutes from "./routes/sync";
import integrationRoutes from "./routes/integration";
import { startUnifiedSyncScheduler } from "./lib/syncCoordinator";

const app = express();
const PORT = process.env.PORT || 5003;

// Middleware
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:3000"],
  credentials: true,
}));
app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/grades", gradesRoutes);
app.use("/api/advisory", advisoryRoutes);
app.use("/api/registrar", registrarRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/ecr-templates", ecrTemplatesRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/integration", integrationRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve React frontend (production build)
const distPath = path.join(__dirname, "../../dist");
app.use(express.static(distPath));
app.get("*splat", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Start unified sync scheduler to periodically sync EnrollPro and ATLAS
  startUnifiedSyncScheduler();
});

