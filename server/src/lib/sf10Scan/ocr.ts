/**
 * ocr.ts — tesseract.js wrapper (self-hosted, free). No cloud OCR.
 *
 * Table documents (SF10/SF9) are read with SPARSE_TEXT and the word bounding
 * boxes are re-clustered into rows by their Y position, so a subject and its
 * term ratings end up on one line ("Filipino 84 85 86 85"). Returns the
 * reconstructed text + overall confidence (0–1).
 */

import { createWorker, PSM } from "tesseract.js";

export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Parses tesseract TSV output (level 5 = word) into positioned words. */
export function wordsFromTsv(tsv: string): OcrWord[] {
  const words: OcrWord[] = [];
  for (const line of String(tsv ?? "").split("\n")) {
    const c = line.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const text = c[11].trim();
    if (!text) continue;
    words.push({ left: +c[6], top: +c[7], width: +c[8], height: +c[9], text });
  }
  return words;
}

/** Groups words sharing a Y-band into ordered text rows (left → right). */
export function rowsFromWords(words: OcrWord[], tolerance = 14): string[] {
  const rows: Array<{ y: number; words: OcrWord[] }> = [];
  for (const w of [...words].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const center = w.top + w.height / 2;
    const row = rows.find((r) => Math.abs(r.y - center) <= tolerance);
    if (row) {
      row.words.push(w);
    } else {
      rows.push({ y: center, words: [w] });
    }
  }
  return rows
    .sort((a, b) => a.y - b.y)
    .map((r) =>
      r.words
        .sort((a, b) => a.left - b.left)
        .map((w) => w.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

export async function runOcr(buffer: Buffer): Promise<{ text: string; confidence: number }> {
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(buffer, {}, { tsv: true });
    const tsv = (data as unknown as { tsv?: string }).tsv ?? "";
    const rows = rowsFromWords(wordsFromTsv(tsv));
    const text = rows.length > 0 ? rows.join("\n") : String(data.text ?? "");
    return {
      text,
      confidence: (Number(data.confidence) || 0) / 100,
    };
  } finally {
    await worker.terminate();
  }
}
