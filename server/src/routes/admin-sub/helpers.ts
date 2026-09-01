import { Router, Response } from "express";
import { AuthRequest } from "../../middleware/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";

export const requireAdmin = (req: AuthRequest, res: Response, next: () => void) => {
  if (!req.user || req.user.role !== "ADMIN") {
    res.status(403).json({ message: "Access denied. Admin only." });
    return;
  }
  next();
};

export const SF_FORM_LABELS: Record<string, string> = {
  SF1: "School Form 1 - School Register",
  SF2: "School Form 2 - Daily Attendance",
  SF3: "School Form 3 - Books Issued and Returned",
  SF4: "School Form 4 - Monthly Learner Movement and Attendance",
  SF5: "School Form 5 - Promotion and Proficiency",
  SF6: "School Form 6 - Summary Promotion Report",
  SF7: "School Form 7 - School Personnel Profile",
  SF8: "School Form 8 - Learner's Basic Health and Nutrition Report",
  SF9: "School Form 9 - Progress Report (JHS/SHS)",
  SF10: "School Form 10 - Permanent Record",
};

export const SF_SHEET_MATCHERS: Record<string, RegExp[]> = {
  SF1: [/\bsf\s*1\b/i, /school\s*form\s*1/i, /school\s*register/i],
  SF2: [/\bsf\s*2\b/i, /school\s*form\s*2/i, /attendance/i],
  SF3: [/\bsf\s*3\b/i, /school\s*form\s*3/i, /books\s*issued/i],
  SF4: [/\bsf\s*4\b/i, /school\s*form\s*4/i, /movement/i],
  SF5: [/\bsf\s*5\b/i, /school\s*form\s*5/i, /promotion/i],
  SF6: [/\bsf\s*6\b/i, /school\s*form\s*6/i, /summarized\s*report/i],
  SF7: [/\bsf\s*7\b/i, /school\s*form\s*7/i, /personnel/i],
  SF8: [/\bsf\s*8\b/i, /school\s*form\s*8/i, /health/i, /nutrition/i, /nutritional\s*status/i],
  SF9: [/\bsf\s*9\b/i, /school\s*form\s*9/i, /report\s*card/i, /progress\s*report/i, /learner'?s\s*progress/i],
  SF10: [/\bsf\s*10\b/i, /school\s*form\s*10/i, /permanent\s*record/i, /form\s*137/i, /front/i, /back/i],
};

export function detectSfSheetMappings(filePath: string): Array<{ formType: string; sheetName: string }> {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetNames = workbook.SheetNames || [];
  const mappings: Array<{ formType: string; sheetName: string }> = [];

  for (const [formType, patterns] of Object.entries(SF_SHEET_MATCHERS)) {
    const sheetName = sheetNames.find((candidate) => patterns.some((pattern) => pattern.test(candidate)));
    if (sheetName) {
      mappings.push({ formType, sheetName });
    }
  }

  return mappings;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo-${Date.now()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype) || file.mimetype === "image/svg+xml";
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});
