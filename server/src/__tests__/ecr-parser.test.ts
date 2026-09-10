/**
 * ecr-parser.test.ts — Pure unit tests for the E-Class-Record parser.
 * No DB, no mocks. Builds minimal workbooks with the exact template layout.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseEcrWorkbook, EcrParseError } from "../lib/ecrParser";

type Sheet = XLSX.WorkSheet;

function makeSheet(): Sheet {
  const ws = { "!ref": "A1:AF120" } as unknown as Sheet;
  ws["B15"] = { t: "s", v: "HIGHEST POSSIBLE SCORE" };
  ws["B16"] = { t: "s", v: "LEARNERS' NAMES" };
  ws["B17"] = { t: "s", v: "MALE" };
  ws["B68"] = { t: "s", v: "FEMALE" };
  return ws;
}

function setHps(ws: Sheet, { ww, pt, st1, st2, te }: { ww: number[]; pt: number[]; st1: number; st2: number; te: number }): void {
  const wwCols = ["F", "G", "H", "I", "J"];
  const ptCols = ["N", "O", "P"];
  wwCols.forEach((c, i) => { if (ww[i] > 0) ws[`${c}15`] = { t: "n", v: ww[i] }; });
  ptCols.forEach((c, i) => { if (pt[i] > 0) ws[`${c}15`] = { t: "n", v: pt[i] }; });
  if (st1 > 0) ws["T15"] = { t: "n", v: st1 };
  if (st2 > 0) ws["U15"] = { t: "n", v: st2 };
  if (te > 0) ws["V15"] = { t: "n", v: te };
}

function makeWorkbook(sheets: Record<string, Sheet>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const FULL_HPS = { ww: [10, 10, 10, 10, 10], pt: [20, 20, 20], st1: 30, st2: 30, te: 40 };

describe("parseEcrWorkbook", () => {
  it("parses names, gender split, HPS and scores", () => {
    const ws = makeSheet();
    setHps(ws, FULL_HPS);
    ws["C18"] = { t: "s", v: "CRUZ, JUAN" };
    ws["C19"] = { t: "s", v: "DELA CRUZ, MARIA" }; // male block
    ws["C69"] = { t: "s", v: "SANTOS, ANA" };      // female block
    ws["F18"] = { t: "n", v: 8 };
    ws["N18"] = { t: "n", v: 15 };
    ws["T18"] = { t: "n", v: 25 };
    ws["U18"] = { t: "n", v: 28 };
    ws["V18"] = { t: "n", v: 35 };

    const buf = makeWorkbook({ "TERM 1": ws });
    const data = parseEcrWorkbook(buf, "T1");

    expect(data.termSheet).toBe("TERM 1");
    expect(data.hps.ww).toEqual([10, 10, 10, 10, 10]);
    expect(data.hps.pt).toEqual([20, 20, 20]);
    expect(data.hps).toMatchObject({ st1: 30, st2: 30, te: 40 });

    expect(data.rows).toHaveLength(3);
    expect(data.rows[0]).toMatchObject({ name: "CRUZ, JUAN", gender: "MALE", row: 18 });
    expect(data.rows[0].ww[0]).toEqual({ score: 8, maxScore: 10 });
    expect(data.rows[0].pt[0]).toEqual({ score: 15, maxScore: 20 });
    expect(data.rows[0].exams).toEqual({ st1: 25, st2: 28, te: 35 });
    expect(data.rows[1]).toMatchObject({ name: "DELA CRUZ, MARIA", gender: "MALE", row: 19 });
    expect(data.rows[2]).toMatchObject({ name: "SANTOS, ANA", gender: "FEMALE", row: 69 });
  });

  it("resolves TERM 2 and TERM 3 sheets", () => {
    const t2 = makeSheet();
    t2["C18"] = { t: "s", v: "REYES, PEDRO" };
    const t3 = makeSheet();
    t3["C69"] = { t: "s", v: "GARCIA, LUZ" };
    const buf = makeWorkbook({ "TERM 2": t2, "TERM 3": t3 });

    expect(parseEcrWorkbook(buf, "T2").rows[0].name).toBe("REYES, PEDRO");
    expect(parseEcrWorkbook(buf, "T3").rows[0].gender).toBe("FEMALE");
  });

  it("skips empty name slots", () => {
    const ws = makeSheet();
    setHps(ws, FULL_HPS);
    ws["C18"] = { t: "s", v: "ONLY, STUDENT" };
    ws["C19"] = { t: "s", v: "   " }; // whitespace-only
    const buf = makeWorkbook({ "TERM 1": ws });
    expect(parseEcrWorkbook(buf, "T1").rows).toHaveLength(1);
  });

  it("returns null scores for blank cells and warns on non-numeric marks", () => {
    const ws = makeSheet();
    setHps(ws, FULL_HPS);
    ws["C18"] = { t: "s", v: "SPECIAL, MARK" };
    ws["F18"] = { t: "s", v: "A" };
    const buf = makeWorkbook({ "TERM 1": ws });
    const data = parseEcrWorkbook(buf, "T1");
    expect(data.rows[0].ww[0].score).toBeNull();
    expect(data.warnings.some((w) => w.includes("non-numeric"))).toBe(true);
  });

  it("throws when a score exceeds its HPS", () => {
    const ws = makeSheet();
    setHps(ws, FULL_HPS);
    ws["C18"] = { t: "s", v: "OVER, MAX" };
    ws["F18"] = { t: "n", v: 11 }; // max 10
    const buf = makeWorkbook({ "TERM 1": ws });
    expect(() => parseEcrWorkbook(buf, "T1")).toThrow(EcrParseError);
  });

  it("throws when the term sheet is missing", () => {
    const ws = makeSheet();
    const buf = makeWorkbook({ "INPUT DATA": ws });
    expect(() => parseEcrWorkbook(buf, "T1")).toThrow(/Could not find sheet/);
  });

  it("falls back to INPUT DATA names when TERM name cells are empty", () => {
    const ws = makeSheet();
    setHps(ws, FULL_HPS);
    // TERM sheet has scores but no name values (formulas cached empty)
    ws["F18"] = { t: "n", v: 7 };
    ws["F69"] = { t: "n", v: 4 };
    // INPUT DATA holds the roster names
    const input = makeSheet();
    input["K11"] = { t: "s", v: "FERNANDEZ, JOHN PAOLO" };
    input["N11"] = { t: "s", v: "FERNANDEZ, JANELLA MARIE" };
    const buf = makeWorkbook({ "INPUT DATA": input, "TERM 1": ws });

    const data = parseEcrWorkbook(buf, "T1");
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).toMatchObject({ name: "FERNANDEZ, JOHN PAOLO", gender: "MALE", row: 18 });
    expect(data.rows[0].ww[0].score).toBe(7);
    expect(data.rows[1]).toMatchObject({ name: "FERNANDEZ, JANELLA MARIE", gender: "FEMALE", row: 69 });
    expect(data.rows[1].ww[0].score).toBe(4);
  });
});
