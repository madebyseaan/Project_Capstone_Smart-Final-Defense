import fs from "fs";
import path from "path";
import { FormType, Role, type PrismaClient } from "@prisma/client";
import templateService from "../services/templateService";

export const SF6_TEMPLATE_PATH = path.join(
  __dirname,
  "../../assets/forms/SF6-Summarized-Report-on-Promotion.xlsx"
);
export const SF6_TEMPLATE_SHEET = "School Form 6 (SF6)";
export const SF6_TEMPLATE_FILE_NAME = path.basename(SF6_TEMPLATE_PATH);

type TemplateDb = Pick<PrismaClient, "user" | "excelTemplate">;

export interface EnsureSf6TemplateResult {
  created: boolean;
  templateId: string;
  placeholderCount: number;
}

export async function ensureSf6Template(db: TemplateDb): Promise<EnsureSf6TemplateResult> {
  if (!fs.existsSync(SF6_TEMPLATE_PATH)) {
    throw new Error(`SF6 template file is missing: ${SF6_TEMPLATE_PATH}`);
  }

  const existing = await db.excelTemplate.findUnique({ where: { formType: FormType.SF6 } });
  if (existing) {
    return {
      created: false,
      templateId: existing.id,
      placeholderCount: Array.isArray(existing.placeholders) ? existing.placeholders.length : 0,
    };
  }

  const admin = await db.user.findFirst({
    where: { role: Role.ADMIN },
    orderBy: { createdAt: "asc" },
    select: { id: true, firstName: true, lastName: true, username: true },
  });

  if (!admin) {
    throw new Error("Cannot register the SF6 template: no ADMIN user exists.");
  }

  const placeholders = await templateService.extractPlaceholders(
    SF6_TEMPLATE_PATH,
    SF6_TEMPLATE_SHEET
  );
  const stats = fs.statSync(SF6_TEMPLATE_PATH);
  const uploadedByName = `${admin.firstName} ${admin.lastName}`.trim() || admin.username;

  const saved = await db.excelTemplate.create({
    data: {
      formType: FormType.SF6,
      formName: "School Form 6 - Summary Promotion Report",
      description:
        "Official DepEd SF6 — Summarized Report on Promotion and Learning Progress & Achievement.",
      filePath: SF6_TEMPLATE_PATH,
      fileName: SF6_TEMPLATE_FILE_NAME,
      fileSize: stats.size,
      placeholders,
      instructions:
        "Placeholders are filled automatically from the registrar SF6 data. Upload a replacement workbook to override this default template.",
      sheetName: SF6_TEMPLATE_SHEET,
      isActive: true,
      uploadedBy: admin.id,
      uploadedByName,
    },
  });

  return {
    created: true,
    templateId: saved.id,
    placeholderCount: placeholders.length,
  };
}
