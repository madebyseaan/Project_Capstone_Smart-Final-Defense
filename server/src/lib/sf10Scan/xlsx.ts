/**
 * xlsx.ts — Exact parse of a digital SF10/SF9 workbook (.xlsx).
 *
 * Converts the sheet grid to text lines and reuses the same label-based parser
 * used for OCR, so manual/OCR/Excel all produce one draft shape.
 */

import * as XLSX from "xlsx";
import { parseSf10Years, type Sf10ScanDraft } from "./parser";

export function workbookToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const lines: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    for (const row of rows) {
      const text = (row as unknown[])
        .map((cell) => String(cell ?? "").trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) lines.push(text);
    }
  }
  return lines.join("\n");
}

export function parseSf10Workbook(buffer: Buffer): { drafts: Sf10ScanDraft[]; rawText: string } {
  const rawText = workbookToText(buffer);
  return { drafts: parseSf10Years(rawText), rawText };
}
