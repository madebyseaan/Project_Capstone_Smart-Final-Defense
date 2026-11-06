import { test, expect, type Page } from "@playwright/test";
import { collectProblems, login } from "./fixtures";
import type {
  EosyFinalizationOverview,
  EosyFinalizationSectionStatus,
  EosySectionState,
} from "../src/lib/eosyTypes";

const SCHOOL_YEAR = "2088-2089";

const sectionDefaults: EosyFinalizationSectionStatus = {
  sectionId: "sec-final",
  sectionName: "Status Finalized",
  gradeLevel: "GRADE_7",
  program: "REGULAR",
  sectionStatus: "ACTIVE",
  adviserName: "Adviser Final",
  enrollmentCount: 40,
  withStoredStatus: 40,
  draftBlockerCount: 0,
  finalized: true,
  state: "FINALIZED",
  snapshotGap: false,
  finalizedGradeCount: null,
  snapshotCount: null,
};

function makeSection(
  overrides: Partial<EosyFinalizationSectionStatus> &
    Pick<EosyFinalizationSectionStatus, "sectionId" | "sectionName" | "state">,
): EosyFinalizationSectionStatus {
  return { ...sectionDefaults, ...overrides };
}

function mixedOverview(): EosyFinalizationOverview {
  const sections = [
    makeSection({}),
    makeSection({
      sectionId: "sec-partial",
      sectionName: "Status Partial",
      adviserName: "Adviser Partial",
      enrollmentCount: 40,
      withStoredStatus: 10,
      finalized: false,
      state: "PARTIAL",
    }),
    makeSection({
      sectionId: "sec-not-started",
      sectionName: "Status Not Started",
      adviserName: "Adviser New",
      enrollmentCount: 38,
      withStoredStatus: 0,
      finalized: false,
      state: "NOT_STARTED",
    }),
    makeSection({
      sectionId: "sec-gap",
      sectionName: "Status Snapshot Gap",
      adviserName: "Adviser Gap",
      enrollmentCount: 30,
      withStoredStatus: 30,
      finalized: true,
      state: "FINALIZED",
      snapshotGap: true,
      finalizedGradeCount: 90,
      snapshotCount: 0,
    }),
    makeSection({
      sectionId: "sec-empty",
      sectionName: "Status Empty",
      adviserName: null,
      enrollmentCount: 0,
      withStoredStatus: 0,
      finalized: true,
      state: "EMPTY",
    }),
  ];

  return {
    schoolYear: SCHOOL_YEAR,
    yearFound: true,
    yearStatus: "ACTIVE",
    generatedAt: new Date().toISOString(),
    summary: {
      totalSections: sections.length,
      finalizedSections: sections.filter((section) => section.state === "FINALIZED").length,
      emptySections: sections.filter((section) => section.state === "EMPTY").length,
      partialSections: sections.filter((section) => section.state === "PARTIAL").length,
      notStartedSections: sections.filter((section) => section.state === "NOT_STARTED").length,
      sectionsWithDraftBlockers: 0,
      totalLearners: sections.reduce((sum, section) => sum + section.enrollmentCount, 0),
      learnersWithStoredStatus: sections.reduce(
        (sum, section) => sum + section.withStoredStatus,
        0,
      ),
      totalDraftBlockers: 0,
      snapshotGapSections: sections.filter((section) => section.snapshotGap).length,
      allPromotionsFinalized: false,
      readyForRollover: false,
    },
    sections,
  };
}

function allFinalizedOverview(): EosyFinalizationOverview {
  const mixed = mixedOverview();
  const sections = mixed.sections.map((section) => {
    const state: EosySectionState = section.enrollmentCount === 0 ? "EMPTY" : "FINALIZED";
    return {
      ...section,
      state,
      finalized: true,
      withStoredStatus: section.enrollmentCount,
      draftBlockerCount: 0,
      snapshotGap: false,
      finalizedGradeCount: null,
      snapshotCount: null,
    };
  });

  return {
    ...mixed,
    summary: {
      ...mixed.summary,
      finalizedSections: sections.filter((section) => section.state === "FINALIZED").length,
      emptySections: sections.filter((section) => section.state === "EMPTY").length,
      partialSections: 0,
      notStartedSections: 0,
      learnersWithStoredStatus: sections.reduce(
        (sum, section) => sum + section.withStoredStatus,
        0,
      ),
      snapshotGapSections: 0,
      allPromotionsFinalized: true,
      readyForRollover: true,
    },
    sections,
  };
}

const enrollProSections = [
  { id: 101, name: "Status Finalized", gradeLevel: { name: "Grade 7" } },
  { id: 102, name: "Status Partial", gradeLevel: { name: "Grade 7" } },
  { id: 103, name: "Status Not Started", gradeLevel: { name: "Grade 7" } },
  { id: 104, name: "Status Snapshot Gap", gradeLevel: { name: "Grade 7" } },
  { id: 105, name: "Status Empty", gradeLevel: { name: "Grade 7" } },
];

const localSections = [
  { id: "sec-final", name: "Status Finalized", gradeLevel: "GRADE_7", schoolYear: SCHOOL_YEAR, program: "REGULAR", adviser: "Adviser Final", _count: { enrollments: 40 }, enrollProId: 101 },
  { id: "sec-partial", name: "Status Partial", gradeLevel: "GRADE_7", schoolYear: SCHOOL_YEAR, program: "REGULAR", adviser: "Adviser Partial", _count: { enrollments: 40 }, enrollProId: 102 },
  { id: "sec-not-started", name: "Status Not Started", gradeLevel: "GRADE_7", schoolYear: SCHOOL_YEAR, program: "REGULAR", adviser: "Adviser New", _count: { enrollments: 38 }, enrollProId: 103 },
  { id: "sec-gap", name: "Status Snapshot Gap", gradeLevel: "GRADE_7", schoolYear: SCHOOL_YEAR, program: "REGULAR", adviser: "Adviser Gap", _count: { enrollments: 30 }, enrollProId: 104 },
  { id: "sec-empty", name: "Status Empty", gradeLevel: "GRADE_7", schoolYear: SCHOOL_YEAR, program: "REGULAR", adviser: null, _count: { enrollments: 0 }, enrollProId: 105 },
];

async function mockEosyApis(
  page: Page,
  getMode: () => "mixed" | "all" | "error",
): Promise<void> {
  await page.route(/\/api\/registrar\/eosy\/school-years(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        schoolYears: [{ id: 9001, yearLabel: SCHOOL_YEAR, status: "ACTIVE" }],
        stale: false,
        source: "enrollpro",
      },
    }),
  );

  await page.route(/\/api\/registrar\/eosy\/sections(?:\?|$)/, (route) =>
    route.fulfill({
      json: { sections: enrollProSections, stale: false, source: "enrollpro" },
    }),
  );

  await page.route(/\/api\/registrar\/sections(?:\?|$)/, (route) =>
    route.fulfill({ json: localSections }),
  );

  await page.route(/\/api\/registrar\/eosy\/finalization-status(?:\?|$)/, (route) => {
    const mode = getMode();
    if (mode === "error") {
      return route.fulfill({
        status: 500,
        json: { message: "Failed to load EOSY finalization status" },
      });
    }
    return route.fulfill({
      json: mode === "all" ? allFinalizedOverview() : mixedOverview(),
    });
  });

  await page.route(/\/api\/registrar\/eosy\/sections\/102\/records(?:\?|$)/, (route) =>
    route.fulfill({ json: { records: [], stale: false } }),
  );

  await page.route(/\/api\/registrar\/eosy\/promotion-status\/sec-partial(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        section: {
          id: "sec-partial",
          name: "Status Partial",
          gradeLevel: "GRADE_7",
          schoolYear: SCHOOL_YEAR,
        },
        enrollments: [],
        draftBlockers: [],
      },
    }),
  );

  await page.route(/\/api\/registrar\/finalize-status-all\/sec-partial(?:\?|$)/, (route) =>
    route.fulfill({ json: { sectionId: "sec-partial", subjects: [] } }),
  );
}

test.describe("registrar EOSY finalization status (read-only)", () => {
  test("shows every section, banner, and filters without mutating anything", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "registrar");
    await mockEosyApis(page, () => "mixed");
    await page.goto("/registrar/eosy", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("eosy-finalization-page")).toBeVisible({ timeout: 30_000 });
    const panel = page.getByTestId("eosy-finalization-status");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("eosy-status-banner")).toContainText(
      "2 sections still need finalization",
    );
    await expect(page.getByTestId("eosy-status-section")).toHaveCount(5);
    await expect(page.getByText("Status Snapshot Gap", { exact: true })).toBeVisible();
    await expect(page.getByText("Missing snapshots", { exact: true })).toBeVisible();

    await page.getByTestId("eosy-status-filter").click();
    await page.getByText("Needs attention", { exact: true }).click();
    await expect(page.getByTestId("eosy-status-section")).toHaveCount(3);

    await page.getByTestId("eosy-status-filter").click();
    await page.getByText("Snapshot gaps", { exact: true }).click();
    await expect(page.getByTestId("eosy-status-section")).toHaveCount(1);
    await expect(page.getByText("Status Snapshot Gap", { exact: true })).toBeVisible();

    expect(page.url()).toContain("/registrar/eosy");
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("shows the all-clear banner only when every section is ready", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "registrar");
    await mockEosyApis(page, () => "all");
    await page.goto("/registrar/eosy", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("eosy-status-banner")).toContainText(
      "All sections are finalized — nothing missed.",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("eosy-status-summary")).toContainText("Snapshot Gaps");
    await expect(page.getByText("Missing snapshots", { exact: true })).toHaveCount(0);

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("opens the matching section detail and keeps the board usable", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "registrar");
    await mockEosyApis(page, () => "mixed");
    await page.goto("/registrar/eosy", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("eosy-finalization-status")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Open Status Partial" }).click();

    await expect(page.getByText("EOSY Readiness — Status Partial")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/registrar\/eosy/);

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("recovers from a status API failure via retry", async ({ page }) => {
    const problems = collectProblems(page);
    let mode: "mixed" | "all" | "error" = "error";
    await login(page, "registrar");
    await mockEosyApis(page, () => mode);
    await page.goto("/registrar/eosy", { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/Failed to load EOSY finalization status/)).toBeVisible({
      timeout: 30_000,
    });

    mode = "mixed";
    await page.getByRole("button", { name: /retry/i }).click();
    await expect(page.getByTestId("eosy-status-banner")).toContainText(
      "2 sections still need finalization",
      { timeout: 30_000 },
    );

    const unexpected = problems.filter(
      (problem) =>
        !problem.includes("finalization-status") && !problem.includes("status of 500"),
    );
    expect(unexpected, unexpected.join("\n")).toEqual([]);
  });

  test("does not overflow the page at mobile width", async ({ page }) => {
    const problems = collectProblems(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "registrar");
    await mockEosyApis(page, () => "mixed");
    await page.goto("/registrar/eosy", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("eosy-finalization-status")).toBeVisible({ timeout: 30_000 });

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth > document.body.clientWidth,
      document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(overflow.body, "page body must not scroll horizontally").toBe(false);
    expect(overflow.document, "page document must not scroll horizontally").toBe(false);

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
