import { describe, it, expect } from "vitest";
import { buildSchoolIdentityUpdate } from "../lib/enrollproBrandingSync";
import { formatDivisionLabel, formatRegionLabel } from "../lib/schoolIdentityText";

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
