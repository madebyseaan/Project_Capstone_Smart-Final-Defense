/**
 * ocr.ts — tesseract.js wrapper (self-hosted, free). No cloud OCR.
 * English only; returns raw text + overall confidence (0–1).
 */

import { createWorker } from "tesseract.js";

export async function runOcr(buffer: Buffer): Promise<{ text: string; confidence: number }> {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buffer);
    return {
      text: String(data.text ?? ""),
      confidence: (Number(data.confidence) || 0) / 100,
    };
  } finally {
    await worker.terminate();
  }
}
