import { describe, it, expect, afterEach } from "vitest";
import { settingsUpdateSchema } from "../schemas/admin";
import { validatePasswordPolicy, setSecurityPolicy } from "../lib/securityPolicy";

describe("settingsUpdateSchema", () => {
  const parse = (body: unknown) => settingsUpdateSchema.safeParse({ body });

  it("accepts blank and null optional text fields (never blocks a save)", () => {
    const res = parse({
      schoolHeadName: "",
      address: null,
      contactNumber: "",
      email: "",
    });
    expect(res.success).toBe(true);
  });

  it("accepts a valid email", () => {
    expect(parse({ email: "head@deped.gov.ph" }).success).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(parse({ email: "not-an-email" }).success).toBe(false);
  });

  it("accepts editable local identity fields", () => {
    const res = parse({ schoolId: "123456", division: "Division of X", region: "Region Y" });
    expect(res.success).toBe(true);
  });
});

describe("security policy", () => {
  afterEach(() => setSecurityPolicy({ maxLoginAttempts: 5, passwordMinLength: 6, requireSpecialChar: false }));

  it("enforces minimum password length", () => {
    setSecurityPolicy({ passwordMinLength: 8, requireSpecialChar: false });
    expect(validatePasswordPolicy("short")).toMatch(/at least 8/);
    expect(validatePasswordPolicy("longenough")).toBeNull();
  });

  it("enforces special characters when enabled", () => {
    setSecurityPolicy({ passwordMinLength: 6, requireSpecialChar: true });
    expect(validatePasswordPolicy("longenough")).toMatch(/special character/);
    expect(validatePasswordPolicy("longenough!")).toBeNull();
  });
});
