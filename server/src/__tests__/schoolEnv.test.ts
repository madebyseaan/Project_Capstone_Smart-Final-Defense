/**
 * schoolEnv.test.ts — Tests for the fail-fast environment variable helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnrollProSchoolYearId, getAtlasSchoolId, getAtlasSchoolYearId } from "../config/schoolEnv";

describe("schoolEnv helpers", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    // Restore original env
    process.env = { ...ORIGINAL_ENV };
  });

  describe("getEnrollProSchoolYearId", () => {
    it("returns the env value when set", () => {
      process.env.ENROLLPRO_SCHOOL_YEAR_ID = "42";
      expect(getEnrollProSchoolYearId()).toBe(42);
    });

    it("returns default 38 in development when not set", () => {
      delete process.env.ENROLLPRO_SCHOOL_YEAR_ID;
      process.env.NODE_ENV = "development";
      expect(getEnrollProSchoolYearId()).toBe(38);
    });

    it("throws in production when not set", () => {
      delete process.env.ENROLLPRO_SCHOOL_YEAR_ID;
      process.env.NODE_ENV = "production";
      expect(() => getEnrollProSchoolYearId()).toThrow(/FATAL.*ENROLLPRO_SCHOOL_YEAR_ID/);
    });

    it("throws when value is not a number", () => {
      process.env.ENROLLPRO_SCHOOL_YEAR_ID = "not-a-number";
      expect(() => getEnrollProSchoolYearId()).toThrow(/not a valid number/);
    });
  });

  describe("getAtlasSchoolId", () => {
    it("returns the env value when set", () => {
      process.env.ATLAS_SCHOOL_ID = "7";
      expect(getAtlasSchoolId()).toBe(7);
    });

    it("returns default 1 in development when not set", () => {
      delete process.env.ATLAS_SCHOOL_ID;
      process.env.NODE_ENV = "development";
      expect(getAtlasSchoolId()).toBe(1);
    });

    it("throws in production when not set", () => {
      delete process.env.ATLAS_SCHOOL_ID;
      process.env.NODE_ENV = "production";
      expect(() => getAtlasSchoolId()).toThrow(/FATAL.*ATLAS_SCHOOL_ID/);
    });
  });

  describe("getAtlasSchoolYearId", () => {
    it("returns the env value when set", () => {
      process.env.ATLAS_SCHOOL_YEAR_ID = "5";
      expect(getAtlasSchoolYearId()).toBe(5);
    });

    it("returns default 3 in development when not set", () => {
      delete process.env.ATLAS_SCHOOL_YEAR_ID;
      process.env.NODE_ENV = "development";
      expect(getAtlasSchoolYearId()).toBe(3);
    });

    it("throws in production when not set", () => {
      delete process.env.ATLAS_SCHOOL_YEAR_ID;
      process.env.NODE_ENV = "production";
      expect(() => getAtlasSchoolYearId()).toThrow(/FATAL.*ATLAS_SCHOOL_YEAR_ID/);
    });
  });
});
