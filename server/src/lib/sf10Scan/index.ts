/**
 * index.ts — SF10/SF9 scan orchestration.
 *
 * Single-item queue (one OCR at a time) to protect the server, plus fail-soft
 * behaviour: on any failure the caller gets an empty draft + reason and the UI
 * falls back to manual entry.
 *
 * No image is persisted (D9 in docs/REGISTRAR/SF10_SF9_IMPORT_PLAN.md).
 */

import { preprocessImage } from "./preprocess";
import { runOcr } from "./ocr";
import { parseSf10Workbook } from "./xlsx";
import { parseSf10Text, type Sf10ScanDraft } from "./parser";

export interface ScanResult {
  draft: Sf10ScanDraft;
  rawText: string;
  confidence: number;
  reason?: string;
  method?: "ocr" | "xlsx";
}

function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export async function scanSf10Document(buffer: Buffer, mimetype?: string): Promise<ScanResult> {
  const isSpreadsheet =
    !!mimetype &&
    (mimetype.includes("spreadsheetml") || mimetype.includes("ms-excel")) ||
    looksLikeZip(buffer);

  if (isSpreadsheet) {
    try {
      const { draft, rawText } = parseSf10Workbook(buffer);
      return { draft, rawText, confidence: draft.confidence, method: "xlsx" };
    } catch (err: any) {
      return {
        draft: parseSf10Text(""),
        rawText: "",
        confidence: 0,
        method: "xlsx",
        reason: `Spreadsheet parse failed: ${err?.message ?? "unknown error"}`,
      };
    }
  }

  try {
    return await serialize(async () => {
      const preprocessed = await preprocessImage(buffer);
      const { text, confidence } = await runOcr(preprocessed);
      const draft = parseSf10Text(text);
      return { draft, rawText: text, confidence, method: "ocr" as const };
    });
  } catch (err: any) {
    return {
      draft: parseSf10Text(""),
      rawText: "",
      confidence: 0,
      method: "ocr",
      reason: `OCR unavailable: ${err?.message ?? "unknown error"}`,
    };
  }
}

export type { Sf10ScanDraft };
