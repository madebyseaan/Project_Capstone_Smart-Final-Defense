import { describe, it, expect } from "vitest";
import { rowsFromWords, wordsFromTsv, type OcrWord } from "../lib/sf10Scan/ocr";

describe("sf10Scan ocr row reconstruction", () => {
  it("groups words on the same Y band and orders them by X", () => {
    const words: OcrWord[] = [
      { text: "84", left: 300, top: 100, width: 20, height: 18 },
      { text: "Filipino", left: 40, top: 102, width: 80, height: 18 },
      { text: "85", left: 330, top: 100, width: 20, height: 18 },
      { text: "English", left: 40, top: 140, width: 70, height: 18 },
      { text: "88", left: 300, top: 138, width: 20, height: 18 },
    ];
    expect(rowsFromWords(words)).toEqual(["Filipino 84 85", "English 88"]);
  });

  it("parses tesseract TSV level-5 word rows", () => {
    const tsv = [
      "5\t1\t1\t1\t1\t1\t40\t100\t80\t18\t96.5\tFilipino",
      "5\t1\t1\t1\t1\t2\t300\t100\t20\t18\t95.0\t84",
      "4\t1\t1\t1\t1\t0\t40\t100\t280\t18\t-1\t",
    ].join("\n");
    expect(wordsFromTsv(tsv)).toEqual([
      { text: "Filipino", left: 40, top: 100, width: 80, height: 18 },
      { text: "84", left: 300, top: 100, width: 20, height: 18 },
    ]);
  });

  it("keeps header lines intact", () => {
    const words: OcrWord[] = [
      { text: "School", left: 40, top: 50, width: 60, height: 18 },
      { text: "Name:", left: 110, top: 50, width: 55, height: 18 },
      { text: "Montevista", left: 175, top: 50, width: 90, height: 18 },
    ];
    expect(rowsFromWords(words)).toEqual(["School Name: Montevista"]);
  });
});
