import { describe, expect, it } from "vitest";
import { validateRotationMetadata } from "../lib/rotationMetadata";

const valid = (fields: Parameters<typeof validateRotationMetadata>[0]) => {
  const result = validateRotationMetadata(fields);
  expect(result.valid).toBe(true);
};

const invalid = (fields: Parameters<typeof validateRotationMetadata>[0], reason: string) => {
  const result = validateRotationMetadata(fields);
  expect(result.valid).toBe(false);
  if (!result.valid) expect(result.reason).toBe(reason);
};

describe("rotation metadata validation", () => {
  it("accepts non-rotating subjects", () => {
    valid({ code: "MATH7", rotationTermGroupId: null, rotationTermRank: null, rotationOutputLabel: null });
  });

  it("accepts valid science and TLE rotation subjects", () => {
    valid({ code: "SCI_BIO7", rotationTermGroupId: "SCIENCE", rotationTermRank: 1, rotationOutputLabel: "SCIENCE" });
    valid({ code: "SCI_CHEM8", rotationTermGroupId: "SCIENCE", rotationTermRank: 2, rotationOutputLabel: "science" });
    valid({ code: "TLE_FCS_EXP8", rotationTermGroupId: "TLE_EXPLORATORY", rotationTermRank: 3, rotationOutputLabel: "TLE" });
  });

  it("rejects Mathematics 10 tagged as a SCIENCE rotation", () => {
    invalid({ code: "MATH10", rotationTermGroupId: "SCIENCE", rotationTermRank: 1, rotationOutputLabel: "SCIENCE" }, "GROUP_CODE_MISMATCH");
  });

  it("rejects a label that does not describe the group", () => {
    invalid({ code: "AP", rotationTermGroupId: "SCIENCE", rotationTermRank: 1, rotationOutputLabel: "AP" }, "LABEL_MISMATCH");
  });

  it("rejects orphan, incomplete and out-of-range rotation fields", () => {
    invalid({ code: "SCI_BIO7", rotationTermGroupId: null, rotationTermRank: 1, rotationOutputLabel: "SCIENCE" }, "ORPHAN_ROTATION_FIELDS");
    invalid({ code: "SCI_BIO7", rotationTermGroupId: "SCIENCE", rotationTermRank: null, rotationOutputLabel: "SCIENCE" }, "MISSING_ROTATION_RANK");
    invalid({ code: "SCI_BIO7", rotationTermGroupId: "SCIENCE", rotationTermRank: 1, rotationOutputLabel: null }, "MISSING_ROTATION_LABEL");
    invalid({ code: "SCI_BIO7", rotationTermGroupId: "SCIENCE", rotationTermRank: 4, rotationOutputLabel: "SCIENCE" }, "INVALID_ROTATION_RANK");
  });

  it("accepts a future group only when the label matches the group", () => {
    valid({ code: "XYZ1", rotationTermGroupId: "XYZ_ROTATION", rotationTermRank: 1, rotationOutputLabel: "XYZ_ROTATION" });
    invalid({ code: "XYZ1", rotationTermGroupId: "XYZ_ROTATION", rotationTermRank: 1, rotationOutputLabel: "XYZ" }, "LABEL_MISMATCH");
  });
});
