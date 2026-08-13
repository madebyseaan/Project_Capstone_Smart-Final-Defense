import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { AuditAction, AuditSeverity, type FormType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticateToken, authorizeRoles, type AuthRequest } from '../middleware/auth';
import templateService from '../services/templateService';
import { createAuditLog } from '../lib/audit';
import { excelStyleParser } from '../services/excelStyleParser';

const router = Router();

const ALL_FORM_TYPES: FormType[] = ['SF1', 'SF2', 'SF3', 'SF4', 'SF5', 'SF6', 'SF7', 'SF8', 'SF9', 'SF10'];
const BUNDLE_SF1_TO_SF7: FormType[] = ['SF1', 'SF2', 'SF3', 'SF4', 'SF5', 'SF6', 'SF7'];
const BUNDLE_SF1_TO_SF10: FormType[] = ['SF1', 'SF2', 'SF3', 'SF4', 'SF5', 'SF6', 'SF7', 'SF8', 'SF9', 'SF10'];

const FORM_LABELS: Record<FormType, string> = {
  SF1: 'School Form 1 - School Register',
  SF2: 'School Form 2 - Daily Attendance',
  SF3: 'School Form 3 - Books Issued and Returned',
  SF4: 'School Form 4 - Monthly Learner Movement and Attendance',
  SF5: 'School Form 5 - Promotion and Proficiency',
  SF6: 'School Form 6 - Summary Promotion Report',
  SF7: 'School Form 7 - School Personnel Profile',
  SF8: "School Form 8 - Learner's Basic Health and Nutrition Report",
  SF9: 'School Form 9 - Progress Report (JHS/SHS)',
  SF10: 'School Form 10 - Permanent Record'
};

const SHEET_MATCHERS: Record<FormType, RegExp[]> = {
  SF1: [/\bsf\s*1\b/i, /school\s*form\s*1/i, /school\s*register/i],
  SF2: [/\bsf\s*2\b/i, /school\s*form\s*2/i, /attendance/i],
  SF3: [/\bsf\s*3\b/i, /school\s*form\s*3/i, /books\s*issued/i],
  SF4: [/\bsf\s*4\b/i, /school\s*form\s*4/i, /movement/i],
  SF5: [/\bsf\s*5\b/i, /school\s*form\s*5/i, /promotion/i],
  SF6: [/\bsf\s*6\b/i, /school\s*form\s*6/i, /summarized\s*report/i],
  SF7: [/\bsf\s*7\b/i, /school\s*form\s*7/i, /personnel/i],
  SF8: [/\bsf\s*8\b/i, /school\s*form\s*8/i, /health/i, /nutrition/i, /nutritional\s*status/i],
  SF9: [/\bsf\s*9\b/i, /school\s*form\s*9/i, /report\s*card/i, /progress\s*report/i, /learner'?s\s*progress/i],
  SF10: [/\bsf\s*10\b/i, /school\s*form\s*10/i, /permanent\s*academic\s*record/i, /permanent\s*record/i, /form\s*137/i, /front/i, /back/i]
};

const LOW_PRIORITY_HELPER_SHEET_HINTS: RegExp[] = [/helper/i, /legend/i, /instruction/i, /tables?/i];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/templates');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const rawKey = (req.body.formType || req.body.uploadMode || 'TEMPLATE') as string;
    const safeKey = rawKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = new Date().toISOString().split('T')[0];
    const uniqueId = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(file.originalname);
    cb(null, `${safeKey}_${timestamp}_${uniqueId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

function isFormType(value: string): value is FormType {
  return ALL_FORM_TYPES.includes(value as FormType);
}

function parseFormTypes(input: unknown): FormType[] {
  if (!input) return [];

  let raw: string[] = [];

  if (Array.isArray(input)) {
    raw = input.map((v) => String(v));
  } else if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        raw = parsed.map((v) => String(v));
      } else {
        raw = input.split(',');
      }
    } catch {
      raw = input.split(',');
    }
  }

  return raw.map((value) => value.trim()).filter((value): value is FormType => isFormType(value));
}

function parseSheetMappings(input: unknown): Partial<Record<FormType, string>> {
  if (!input) return {};

  let parsed: unknown = input;

  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      return {};
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const output: Partial<Record<FormType, string>> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (!isFormType(key) || typeof value !== 'string') {
      continue;
    }

    const cleanSheet = value.trim();
    if (cleanSheet) {
      output[key] = cleanSheet;
    }
  }

  return output;
}

function autoDetectSheetName(formType: FormType, sheetNames: string[]): string | null {
  const patterns = SHEET_MATCHERS[formType];

  for (const pattern of patterns) {
    const foundSheet = sheetNames.find((sheetName) => pattern.test(sheetName));
    if (foundSheet) {
      return foundSheet;
    }
  }

  return null;
}

function getNonEmptySheetNames(filePath: string, sheetNames: string[]): string[] {
  const workbook = XLSX.readFile(filePath);
  return sheetNames.filter((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const ref = worksheet?.['!ref'];

    if (!ref) {
      return false;
    }

    const range = XLSX.utils.decode_range(ref);
    return range.e.r >= range.s.r || range.e.c >= range.s.c;
  });
}

function selectSingleUploadFallbackSheet(formType: FormType, sheetNames: string[]): string | null {
  if (sheetNames.length === 0) {
    return null;
  }

  const scoreSheetName = (sheetName: string, index: number): number => {
    let score = 0;
    const normalizedName = sheetName.toLowerCase();

    if (SHEET_MATCHERS[formType].some((pattern) => pattern.test(sheetName))) {
      score += 10;
    }

    if (/sheet\s*\d+/i.test(sheetName)) {
      score += 1;
    }

    if (/\b(front|back)\b/i.test(sheetName)) {
      score += 2;
    }

    if (/\b(report|record|nutrition|status|progress)\b/i.test(sheetName)) {
      score += 2;
    }

    if (LOW_PRIORITY_HELPER_SHEET_HINTS.some((pattern) => pattern.test(normalizedName))) {
      score -= 5;
    }

    score -= index * 0.1;
    return score;
  };

  const rankedSheets = [...sheetNames].sort((a, b) => {
    const scoreDiff = scoreSheetName(b, sheetNames.indexOf(b)) - scoreSheetName(a, sheetNames.indexOf(a));
    if (scoreDiff !== 0) return scoreDiff;
    return sheetNames.indexOf(a) - sheetNames.indexOf(b);
  });

  return rankedSheets[0] ?? null;
}

function normalizeWorkbookToXlsx(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.xls') {
    return filePath;
  }

  const workbook = XLSX.readFile(filePath, { cellStyles: true, cellNF: true });
  const xlsxPath = filePath.replace(/\.xls$/i, '.xlsx');
  XLSX.writeFile(workbook, xlsxPath, { bookType: 'xlsx' });

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  return xlsxPath;
}

async function deleteFileIfUnreferenced(filePath: string): Promise<void> {
  const activeReferences = await prisma.excelTemplate.count({
    where: { filePath }
  });

  if (activeReferences === 0 && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function buildAuditUser(req: AuthRequest) {
  if (!req.user) {
    throw new Error('Missing authenticated user');
  }

  return {
    id: req.user.id,
    firstName: req.user.username,
    lastName: '',
    role: req.user.role
  };
}

router.use(authenticateToken);

router.get('/', authorizeRoles('ADMIN', 'REGISTRAR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const templates = await prisma.excelTemplate.findMany({
      orderBy: [{ formType: 'asc' }, { updatedAt: 'desc' }]
    });

    res.json({ success: true, data: templates });
  } catch (error: any) {
    console.error('Failed to fetch templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:formType', authorizeRoles('ADMIN', 'REGISTRAR', 'TEACHER'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const formType = req.params.formType as string;

    if (!isFormType(formType)) {
      res.status(400).json({ success: false, error: 'Invalid form type' });
      return;
    }

    const template = await prisma.excelTemplate.findUnique({
      where: { formType }
    });

    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    res.json({ success: true, data: template });
  } catch (error: any) {
    console.error('Failed to fetch template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id/structure', authorizeRoles('ADMIN', 'REGISTRAR'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const template = await prisma.excelTemplate.findUnique({
      where: { id }
    });

    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    if (!fs.existsSync(template.filePath)) {
      res.status(404).json({ success: false, error: 'Template file not found on disk' });
      return;
    }

    const sheetNames = await templateService.getSheetNames(template.filePath);
    const sheetDetails = await Promise.all(
      sheetNames.map(async (sheetName) => {
        const placeholders = await templateService.extractPlaceholders(template.filePath, sheetName);
        const validation = await templateService.validateTemplate(template.filePath, sheetName);

        return {
          sheetName,
          isMappedSheet: template.sheetName === sheetName,
          placeholderCount: placeholders.length,
          placeholderPreview: placeholders.slice(0, 20),
          isStructurallyValid: validation.valid,
          validationError: validation.error || null
        };
      })
    );

    res.json({
      success: true,
      data: {
        templateId: template.id,
        formType: template.formType,
        formName: template.formName,
        fileName: template.fileName,
        mappedSheetName: template.sheetName,
        sheetCount: sheetNames.length,
        sheets: sheetDetails
      }
    });
  } catch (error: any) {
    console.error('Failed to inspect template structure:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to inspect template structure' });
  }
});

router.get('/:id/preview', authorizeRoles('ADMIN', 'REGISTRAR'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const maxRows = Math.min(Math.max(Number(req.query.maxRows) || 120, 20), 300);
    const maxCols = Math.min(Math.max(Number(req.query.maxCols) || 30, 10), 80);

    const template = await prisma.excelTemplate.findUnique({
      where: { id }
    });

    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    if (!fs.existsSync(template.filePath)) {
      res.status(404).json({ success: false, error: 'Template file not found on disk' });
      return;
    }

    const workbook = XLSX.readFile(template.filePath, { cellDates: true });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(worksheet, {
        header: 1,
        raw: false,
        blankrows: true,
        defval: ''
      });

      const trimmedRows = rows.slice(0, maxRows).map((row) => {
        const normalized = Array.isArray(row) ? row.slice(0, maxCols) : [];
        while (normalized.length < maxCols) {
          normalized.push('');
        }
        return normalized.map((value) => (value == null ? '' : String(value)));
      });

      return {
        sheetName,
        isMappedSheet: template.sheetName === sheetName,
        totalRows: rows.length,
        previewRows: trimmedRows
      };
    });

    res.json({
      success: true,
      data: {
        templateId: template.id,
        formType: template.formType,
        formName: template.formName,
        fileName: template.fileName,
        mappedSheetName: template.sheetName,
        maxRows,
        maxCols,
        sheets
      }
    });
  } catch (error: any) {
    console.error('Failed to preview template workbook:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to preview template workbook' });
  }
});

// NEW: Get template with high-fidelity styling for pixel-perfect rendering
router.get('/:id/styled-preview', authorizeRoles('ADMIN', 'REGISTRAR'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const sheetName = req.query.sheet as string | undefined;

    const template = await prisma.excelTemplate.findUnique({
      where: { id }
    });

    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    if (!fs.existsSync(template.filePath)) {
      res.status(404).json({ success: false, error: 'Template file not found on disk' });
      return;
    }

    // Parse Excel with full styling information
    const parsedWorkbook = await excelStyleParser.parseExcelWithStyles(template.filePath);

    // Filter to specific sheet if requested
    let sheets = parsedWorkbook.sheets;
    if (sheetName) {
      sheets = sheets.filter(s => s.name === sheetName);
      if (sheets.length === 0) {
        res.status(404).json({ success: false, error: `Sheet "${sheetName}" not found in template` });
        return;
      }
    } else if (template.sheetName) {
      // Default to mapped sheet if available
      const mappedSheet = sheets.find(s => s.name === template.sheetName);
      if (mappedSheet) {
        sheets = [mappedSheet];
      }
    }

    res.json({
      success: true,
      data: {
        templateId: template.id,
        formType: template.formType,
        formName: template.formName,
        fileName: template.fileName,
        mappedSheetName: template.sheetName,
        parsedStructure: {
          sheets,
          metadata: parsedWorkbook.metadata
        }
      }
    });
  } catch (error: any) {
    console.error('Failed to parse template with styles:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to parse template styles' });
  }
});

router.post('/upload', authorizeRoles('ADMIN'), upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  let normalizedFilePath: string | null = null;

  try {
    const uploadedFile = req.file;
    if (!uploadedFile) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    const { formType, formName, description, instructions, uploadMode } = req.body as {
      formType?: string;
      formName?: string;
      description?: string;
      instructions?: string;
      uploadMode?: string;
    };

    const bundleType = formType === 'SF1_7_BUNDLE' ? 'SF1_7_BUNDLE' : 'SF1_10_BUNDLE';
    const isBundleUpload = uploadMode === 'bundle' || formType === 'SF1_10_BUNDLE' || formType === 'SF1_7_BUNDLE';

    if (!formName || !formName.trim()) {
      if (fs.existsSync(uploadedFile.path)) {
        fs.unlinkSync(uploadedFile.path);
      }
      res.status(400).json({ success: false, error: 'formName is required' });
      return;
    }

    if (!isBundleUpload && (!formType || !isFormType(formType))) {
      if (fs.existsSync(uploadedFile.path)) {
        fs.unlinkSync(uploadedFile.path);
      }
      res.status(400).json({ success: false, error: 'Valid formType is required for single upload' });
      return;
    }

    normalizedFilePath = normalizeWorkbookToXlsx(uploadedFile.path);

    const validation = await templateService.validateTemplate(normalizedFilePath);
    if (!validation.valid) {
      if (fs.existsSync(normalizedFilePath)) {
        fs.unlinkSync(normalizedFilePath);
      }
      res.status(400).json({ success: false, error: `Invalid template: ${validation.error}` });
      return;
    }

    const sheetNames = await templateService.getSheetNames(normalizedFilePath);
    console.log('Found sheets in uploaded file:', sheetNames);

    const targetFormTypes = isBundleUpload
      ? (() => {
          const parsed = parseFormTypes(req.body.formTypes);
          if (parsed.length > 0) return parsed;
          return bundleType === 'SF1_7_BUNDLE' ? BUNDLE_SF1_TO_SF7 : BUNDLE_SF1_TO_SF10;
        })()
      : [formType as FormType];

    const requestedSheetMappings = parseSheetMappings(req.body.sheetMappings);
    const resolvedSheetMappings: Record<FormType, string> = {} as Record<FormType, string>;
    const unresolvedForms: FormType[] = [];
    const nonEmptySheetNames = getNonEmptySheetNames(normalizedFilePath, sheetNames);

    for (const currentFormType of targetFormTypes) {
      const manualSheet = requestedSheetMappings[currentFormType];

      if (manualSheet) {
        if (sheetNames.includes(manualSheet)) {
          resolvedSheetMappings[currentFormType] = manualSheet;
          continue;
        }

        unresolvedForms.push(currentFormType);
        continue;
      }

      const autoSheet = autoDetectSheetName(currentFormType, sheetNames);
      if (!autoSheet) {
        if (!isBundleUpload) {
          const fallbackSheet = selectSingleUploadFallbackSheet(currentFormType, nonEmptySheetNames);
          if (fallbackSheet) {
            console.log(`Using single-upload fallback ${currentFormType} -> ${fallbackSheet}`);
            resolvedSheetMappings[currentFormType] = fallbackSheet;
            continue;
          }
        }

        console.log(`Could not auto-detect sheet for ${currentFormType}`);
        unresolvedForms.push(currentFormType);
        continue;
      }

      console.log(`Auto-detected ${currentFormType} -> ${autoSheet}`);
      resolvedSheetMappings[currentFormType] = autoSheet;
    }

    if (unresolvedForms.length > 0) {
      if (fs.existsSync(normalizedFilePath)) {
        fs.unlinkSync(normalizedFilePath);
      }

      res.status(400).json({
        success: false,
        error: 'Could not map all selected forms to worksheet names',
        missingForms: unresolvedForms,
        availableSheets: sheetNames,
        hint: 'Provide exact sheet mappings via sheetMappings JSON, e.g. {"SF8":"Nutritional Status"}'
      });
      return;
    }

    const existingTemplates = await prisma.excelTemplate.findMany({
      where: {
        formType: {
          in: targetFormTypes
        }
      }
    });

    const existingTemplateMap = new Map<FormType, (typeof existingTemplates)[number]>();
    existingTemplates.forEach((template) => {
      existingTemplateMap.set(template.formType, template);
    });

    const oldFilePaths = new Set<string>();
    const payloads: Array<{
      formType: FormType;
      formName: string;
      placeholders: string[];
      sheetName: string;
    }> = [];

    for (const currentFormType of targetFormTypes) {
      const sheetName = resolvedSheetMappings[currentFormType];
      const sheetValidation = await templateService.validateTemplate(normalizedFilePath, sheetName);
      if (!sheetValidation.valid) {
        if (fs.existsSync(normalizedFilePath)) {
          fs.unlinkSync(normalizedFilePath);
        }
        res.status(400).json({
          success: false,
          error: `Invalid template structure in sheet '${sheetName}' for ${currentFormType}: ${sheetValidation.error}`
        });
        return;
      }

      const placeholders = await templateService.extractPlaceholders(normalizedFilePath, sheetName);
      const existingTemplate = existingTemplateMap.get(currentFormType);

      if (existingTemplate && existingTemplate.filePath !== normalizedFilePath) {
        oldFilePaths.add(existingTemplate.filePath);
      }

      payloads.push({
        formType: currentFormType,
        formName: targetFormTypes.length === 1
          ? formName.trim()
          : `${FORM_LABELS[currentFormType]} (${formName.trim()})`,
        placeholders,
        sheetName
      });
    }

    const uploadedByName = req.user?.username || 'Unknown User';

    const savedTemplates = await prisma.$transaction(
      payloads.map((payload) =>
        prisma.excelTemplate.upsert({
          where: { formType: payload.formType },
          create: {
            formType: payload.formType,
            formName: payload.formName,
            description: description?.trim() || null,
            filePath: normalizedFilePath!,
            fileName: uploadedFile.originalname,
            fileSize: uploadedFile.size,
            placeholders: payload.placeholders,
            instructions: instructions?.trim() || null,
            sheetName: payload.sheetName,
            isActive: true,
            uploadedBy: req.user!.id,
            uploadedByName
          },
          update: {
            formName: payload.formName,
            description: description?.trim() || null,
            filePath: normalizedFilePath!,
            fileName: uploadedFile.originalname,
            fileSize: uploadedFile.size,
            placeholders: payload.placeholders,
            instructions: instructions?.trim() || null,
            sheetName: payload.sheetName,
            uploadedBy: req.user!.id,
            uploadedByName,
            updatedAt: new Date()
          }
        })
      )
    );

    for (const oldPath of oldFilePaths) {
      await deleteFileIfUnreferenced(oldPath);
    }

    const hasExistingTemplates = existingTemplates.length > 0;
    await createAuditLog(
      hasExistingTemplates ? AuditAction.UPDATE : AuditAction.CREATE,
      buildAuditUser(req),
      isBundleUpload ? `${formName.trim()} Bundle` : `${savedTemplates[0].formName} Template`,
      'Template',
      isBundleUpload
        ? `Uploaded bundled template file '${uploadedFile.originalname}' mapped to ${targetFormTypes.join(', ')}`
        : `Uploaded ${targetFormTypes[0]} template: ${savedTemplates[0].formName}`,
      req.ip,
      AuditSeverity.INFO,
      undefined,
      {
        formTypes: targetFormTypes,
        sheetMappings: resolvedSheetMappings,
        fileName: uploadedFile.originalname
      }
    );

    res.json({
      success: true,
      message: isBundleUpload
        ? `Bundle uploaded successfully for ${targetFormTypes.join(', ')}`
        : hasExistingTemplates
          ? 'Template updated successfully'
          : 'Template uploaded successfully',
      data: targetFormTypes.length === 1 ? savedTemplates[0] : savedTemplates,
      meta: {
        uploadMode: isBundleUpload ? 'bundle' : 'single',
        sheetMappings: resolvedSheetMappings,
        availableSheets: sheetNames
      }
    });
  } catch (error: any) {
    console.error('Failed to upload template:', error);

    if (normalizedFilePath && fs.existsSync(normalizedFilePath)) {
      try {
        await deleteFileIfUnreferenced(normalizedFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }

    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // Ignore cleanup errors
      }
    }

    res.status(500).json({ success: false, error: error.message || 'Failed to upload template' });
  }
});

router.delete('/:id', authorizeRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const template = await prisma.excelTemplate.findUnique({
      where: { id }
    });

    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    await prisma.excelTemplate.delete({
      where: { id }
    });

    await deleteFileIfUnreferenced(template.filePath);

    await createAuditLog(
      AuditAction.DELETE,
      buildAuditUser(req),
      `${template.formName} Template`,
      'Template',
      `Deleted ${template.formType} template: ${template.formName}`,
      req.ip,
      AuditSeverity.WARNING,
      id
    );

    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error: any) {
    console.error('Failed to delete template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/toggle', authorizeRoles('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const template = await prisma.excelTemplate.findUnique({
      where: { id }
    });

    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    const updatedTemplate = await prisma.excelTemplate.update({
      where: { id },
      data: { isActive: !template.isActive }
    });

    await createAuditLog(
      AuditAction.CONFIG,
      buildAuditUser(req),
      `${template.formName} Template`,
      'Template',
      `${updatedTemplate.isActive ? 'Activated' : 'Deactivated'} template: ${template.formName}`,
      req.ip,
      AuditSeverity.INFO,
      id
    );

    res.json({ success: true, data: updatedTemplate });
  } catch (error: any) {
    console.error('Failed to toggle template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:formType/download', authorizeRoles('ADMIN', 'REGISTRAR', 'TEACHER'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const formType = req.params.formType as string;

    if (!isFormType(formType)) {
      res.status(400).json({ success: false, error: 'Invalid form type' });
      return;
    }

    const template = await prisma.excelTemplate.findUnique({
      where: { formType }
    });

    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    if (!fs.existsSync(template.filePath)) {
      res.status(404).json({ success: false, error: 'Template file not found on disk' });
      return;
    }

    res.download(template.filePath, template.fileName);
  } catch (error: any) {
    console.error('Failed to download template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
