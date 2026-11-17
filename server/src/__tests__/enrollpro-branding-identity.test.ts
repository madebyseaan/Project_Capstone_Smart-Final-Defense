import { describe, it, expect } from "vitest";
import { buildSchoolIdentityUpdate } from "../lib/enrollproBrandingSync";
import { formatDivisionLabel, formatRegionLabel, resolveDistrictFallback } from "../lib/schoolIdentityText";

describe("buildSchoolIdentityUpdate", () => {
  it("maps EnrollPro DepEd identity fields into SystemSettings updates", () => {
    expect(
      buildSchoolIdentityUpdate({
        depedSchoolId: "302624",
        region: "REGION VI - WESTERN VISAYAS",
        division: "DIVISION OF NEGROS OCCIDENTAL",
      })
    ).toEqual({
      schoolId: "302624",
      region: "REGION VI - WESTERN VISAYAS",
      division: "DIVISION OF NEGROS OCCIDENTAL",
    });
  });

  it("trims whitespace from EnrollPro values", () => {
    expect(
      buildSchoolIdentityUpdate({
        depedSchoolId: " 302624 ",
        region: " REGION VI ",
        division: " DIVISION OF NEGROS OCCIDENTAL ",
      })
    ).toEqual({
      schoolId: "302624",
      region: "REGION VI",
      division: "DIVISION OF NEGROS OCCIDENTAL",
    });
  });

  it("skips missing or blank fields so older payloads cannot wipe local identity", () => {
    expect(buildSchoolIdentityUpdate({})).toEqual({});
    expect(
      buildSchoolIdentityUpdate({ depedSchoolId: "  ", region: null, division: undefined })
    ).toEqual({});
  });

  it("maps the EnrollPro district when present", () => {
    expect(
      buildSchoolIdentityUpdate({ depedSchoolId: "302651", district: " Hinigaran I " })
    ).toEqual({ schoolId: "302651", district: "Hinigaran I" });
  });
});

describe("resolveDistrictFallback", () => {
  it("maps the documented DepEd school IDs", () => {
    expect(resolveDistrictFallback("302651", null)).toBe("Hinigaran I");
    expect(resolveDistrictFallback("302624", null)).toBe("Pulupandan");
  });

  it("maps by school name when the school ID is unknown", () => {
    expect(resolveDistrictFallback("300847", "Hinigaran National High School")).toBe("Hinigaran I");
    expect(
      resolveDistrictFallback(null, "Enriqueta Montilla De Esteban Memorial High School")
    ).toBe("Pulupandan");
  });

  it("prefers the institution name over a stale school ID", () => {
    expect(resolveDistrictFallback("302624", "Hinigaran National High School")).toBe("Hinigaran I");
  });

  it("returns an empty string for unknown schools", () => {
    expect(resolveDistrictFallback("999999", "Some Other School")).toBe("");
  });
});

describe("school identity form labels", () => {
  it("does not duplicate an existing Region prefix", () => {
    expect(formatRegionLabel("REGION VI - WESTERN VISAYAS")).toBe("REGION VI - WESTERN VISAYAS");
    expect(formatRegionLabel("Region VI")).toBe("Region VI");
  });

  it("adds the Region prefix for bare region names", () => {
    expect(formatRegionLabel("VI - Western Visayas")).toBe("Region VI - Western Visayas");
  });

  it("does not duplicate an existing Division prefix", () => {
    expect(formatDivisionLabel("DIVISION OF NEGROS OCCIDENTAL")).toBe(
      "DIVISION OF NEGROS OCCIDENTAL"
    );
    expect(formatDivisionLabel("Division of Negros Occidental")).toBe(
      "Division of Negros Occidental"
    );
  });

  it("adds the Division prefix for bare division names and keeps fallbacks", () => {
    expect(formatDivisionLabel("Negros Occidental")).toBe("Division of Negros Occidental");
    expect(formatDivisionLabel("")).toBe("");
    expect(formatRegionLabel(null)).toBe("");
  });
});
