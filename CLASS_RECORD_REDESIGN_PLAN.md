# SPECIFICATION: DepEd E-Class-Record UI Redesign & Card Consolidation

> **Target Page:** `src/pages/teacher/ClassRecordView.tsx`  
> **Scope:** 100% Pure UI / Layout Refactoring (Zero Backend, Zero Database, Zero Math/Grading Logic changes)

---

## 1. Context & Objective
In `src/pages/teacher/ClassRecordView.tsx`, the interface is currently fragmented into 5 separate floating cards with excessive padding, pushing the actual grading table ~480px below the viewport fold:
- Floating Hero Card (`ClassRecordHero`)
- 4 separate Stat Cards in a grid (`ClassRecordStats`)
- Full-width AIMS LMS banner card (`AimsPanel`)
- Full-width Official E-Class-Record Excel banner card (`ExcelExchangePanel`)
- Class Ledger table (`ClassRecordTable`)

### The Goal:
Align the top workspace design with the **Official DepEd E-Class-Record (Excel)** layout, while keeping the full interactive web capabilities of the Class Ledger:
1. **Official DepEd Header Grid**:
   - Left Block: **FIRST TERM** (with an interactive term selector).
   - Structured Metadata Cells: **GRADE LEVEL** (`Grade 7`), **SECTION** (`Mabini`), **TEACHER** (`Full Name`), and **SUBJECT** (`Araling Panlipunan 7` + dynamic weights).
2. **Eliminate Card Clutter**:
   - Merge the floating Hero card, 4 separate stat cards, and 2 full-width billboard panels (AIMS & Excel) into a unified, high-density workspace.
3. **Consolidate Tools into an On-Demand Drawer**:
   - AIMS LMS integration and DepEd Excel Export/Import live in a collapsible **"Sync & Tools"** hub, keeping the workspace clutter-free.
4. **Dynamic Subject Weights**:
   - The weights displayed under `SUBJECT` are **100% dynamic** (reading from `activeWeights` / `effectiveWeights` / `classAssignment.subject`).
5. **Zero Functional Regressions**:
   - All 12 interactive tour IDs (`ClassRecordTour`), cell keyboard navigation, HPS row calculation, AIMS sync, Excel import/export, and mobile responsive views remain 100% operational.

---

## 2. Visual Architecture: DepEd Excel Alignment

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP UTILITY BAR (Web Controls):                                                                        │
│ [← Back]  [✨ Tutorial]  [⚡ Sync & Tools (AIMS / Excel)]  [Optional Details]  [Clear Scores]  [Alphabetical|Gendered] │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ OFFICIAL DEPED E-CLASS-RECORD HEADER BLOCK (Excel Grid Aesthetics):                                    │
│ ┌──────────────┬─────────────┬──────────────┬───────────┬──────────────────────────┬─────────┬──────────────┐ │
│ │              │ GRADE LEVEL │ Grade 7      │ TEACHER   │ JANELLA MARIE FERNANDEZ  │ SUBJECT │ Araling      │ │
│ │  FIRST TERM  ├─────────────┼──────────────┤           │                          │         │ Panlipunan 7 │ │
│ │    [T1 ▾]    │ SECTION     │ Mabini       │           │                          │         │ (20%·50%·30%)│ │
│ └──────────────┴─────────────┴──────────────┴───────────┴──────────────────────────┴─────────┴──────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ PERFORMANCE METRICS RIBBON:                                                                            │
│ Class Average: 84.2  │  Passing Rate: 92% (23/25)  │  Highest Grade: 98  │  Lowest Grade: 68           │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▼ COLLAPSIBLE TOOLS HUB (AIMS LMS Sync + DepEd Excel File Exchange - Opens via "Sync & Tools")       │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NOTIFICATION BANNERS (GradeStatusBanner / RotationBanner / InheritedGradesNotice)                     │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CLASS LEDGER SPREADSHEET TABLE:                                                                        │
│ - MAX / HIGHEST POSSIBLE SCORE Row                                                                     │
│ - MALE / FEMALE Section Dividers (when Gendered view is active)                                        │
│ - Written Works (WW) -> Performance Tasks (PT) -> Term Assessment (TA) -> Initial -> Term Grade       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Strict Zero-Regression DOM ID Contract
`ClassRecordTour.tsx` hooks directly into specific DOM IDs. **You MUST preserve all of these IDs in the refactored JSX**:
- `tutorial-hero-info`: Must remain on the DepEd Header container.
- `tutorial-stats-overview`: Must remain on the Performance Metrics Ribbon container.
- `tutorial-gender-toggle`: Must remain on the Alphabetical / Gendered button group.
- `tutorial-optional-details`: Must remain on the "Optional Assessment Details" toggle button.
- `tutorial-period-controls`: Must remain on the Term selector in the DepEd header.
- `tutorial-hps-row`: Must remain on the highest possible score (MAX) row in the ledger table.
- `tutorial-task-controls`: Must remain on the (+) / (-) task buttons.
- `tutorial-aims-group`: Must remain on the cyan AIMS reference columns.
- `tutorial-cell-example`: Must remain on the first student score cell.
- `tutorial-ledger-scores`: Must remain on the ledger input container.

---

## 4. Detailed Component Implementation Steps

### Step 1: Refactor `ClassRecordHero.tsx` into DepEd Header Grid
Replace the generic card in `src/pages/teacher/components/ClassRecordHero.tsx` with the structured DepEd E-Class Record header grid.

#### Props Interface:
```typescript
interface ClassRecordHeroProps {
  classAssignment: ClassAssignment;
  effectiveWeightsSource: "subject-override" | "subject-type" | "generic-fallback" | null;
  activeWeights: { ww: number; pt: number; qa: number };
  onStartTour?: () => void;
  aimsCourseCode?: string | null;
  aimsLastSyncedAt?: string | null;
  onOpenAimsLink?: () => void;
  // Consolidated workspace props:
  selectedTerm: string;
  onTermChange: (term: string) => void;
  lockedTerm: string | null;
  termLabels?: Record<string, string>;
  isToolsOpen: boolean;
  onToggleTools: () => void;
  isViewOnly?: boolean;
  userName: string;
}
```

#### JSX Implementation Details:
1. **Top Accent & Utility Toolbar**:
   - Dark navy top border (`h-1.5 bg-[#0f2b5c] rounded-t-xl`).
   - Clean top action bar:
     - Left: Back button to `/teacher/classes` + badge `"DepEd Form 7-A (E-Class Record)"`.
     - Right:
       - `Sync & Tools` button (with cyan status dot if AIMS is linked).
       - `Tutorial` button (`Sparkles` icon).
       - `Grade Entry Mode` or `View Only` badge.
2. **DepEd Metadata Grid (`id="tutorial-hero-info"`)**:
   - Style: Bordered grid with clean border lines (`border border-slate-300 bg-white`).
   - **Cell 1: Term Box (`id="tutorial-period-controls"`)**:
     - Large bold title:
       - `T1` -> `FIRST TERM`
       - `T2` -> `SECOND TERM`
       - `T3` -> `THIRD TERM`
     - Clean quarter switcher pills or dropdown: `[ T1 | T2 | T3 ]`.
   - **Cell 2 & 3: Grade Level & Section**:
     - `GRADE LEVEL`: `Grade 7` (from `classAssignment.section.gradeLevel`).
     - `SECTION`: `Mabini` (from `classAssignment.section.name`).
   - **Cell 4: Teacher**:
     - `TEACHER`: `userName` (e.g. `JANELLA MARIE FERNANDEZ`) rendered in bold uppercase.
   - **Cell 5: Subject & Dynamic Weights**:
     - `SUBJECT`: `classAssignment.subject.name` (e.g. `Araling Panlipunan 7`).
     - Dynamic weight badge: `WW: {activeWeights.ww}% · PT: {activeWeights.pt}% · QA: {activeWeights.qa}%`.

---

### Step 2: Refactor `ClassRecordStats.tsx` into Performance Ribbon
Replace the 4 bulky card boxes with a 1-row horizontal metrics ribbon directly beneath the DepEd header:
```tsx
<div
  id="tutorial-stats-overview"
  className="flex flex-wrap items-center justify-between border border-slate-200/90 bg-white shadow-xs rounded-xl px-4 py-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100"
>
  {/* Class Average */}
  <div className="flex items-center gap-3 px-3 py-1 flex-1 min-w-[130px]">
    <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
      <Target className="w-4 h-4" />
    </div>
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">Class Average</p>
      <p className="text-base font-bold text-slate-900 mt-1 leading-none">{avg.toFixed(1)}</p>
    </div>
  </div>

  {/* Passing Rate */}
  <div className="flex items-center gap-3 px-3 py-1 flex-1 min-w-[130px]">
    <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
      <TrendingUp className="w-4 h-4" />
    </div>
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">Passing Rate</p>
      <p className="text-base font-bold text-slate-900 mt-1 leading-none">
        {passingRate} <span className="text-xs font-normal text-slate-400">({passed}/{total})</span>
      </p>
    </div>
  </div>

  {/* Highest Grade */}
  <div className="flex items-center gap-3 px-3 py-1 flex-1 min-w-[130px]">
    <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600 shrink-0">
      <Award className="w-4 h-4" />
    </div>
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">Highest Grade</p>
      <p className="text-base font-bold text-slate-900 mt-1 leading-none">{highest}</p>
    </div>
  </div>

  {/* Lowest Grade */}
  <div className="flex items-center gap-3 px-3 py-1 flex-1 min-w-[130px]">
    <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600 shrink-0">
      <TrendingDown className="w-4 h-4" />
    </div>
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">Lowest Grade</p>
      <p className="text-base font-bold text-slate-900 mt-1 leading-none">{lowest}</p>
    </div>
  </div>
</div>
```

---

### Step 3: Create `ClassRecordToolsHub.tsx` (Consolidating AIMS & Excel)
Create `src/pages/teacher/components/ClassRecordToolsHub.tsx`:
- Wraps `AimsPanel` and `ExcelExchangePanel` inside an on-demand collapsible panel.
- Shows when `isToolsOpen` is true.
- Tabbed or side-by-side view (`lg:grid-cols-2 gap-4`):
  - **Left Section**: AIMS LMS Integration (course code, last synced, refresh/sync button, import scores dialog, connect/disconnect).
  - **Right Section**: Official DepEd Excel Exchange (download pre-filled roster, upload filled Excel, preview overwrite report, confirm import).
- Saves ~180px of permanent vertical space when collapsed!

---

### Step 4: Wire in `ClassRecordView.tsx`
Update `src/pages/teacher/ClassRecordView.tsx`:
1. Add state:
   ```typescript
   const [isToolsOpen, setIsToolsOpen] = useState(false);
   ```
2. Render `<ClassRecordHero>` with the new DepEd props, passing `userName` and `activeWeights`.
3. Render `<ClassRecordToolsHub>` controlled by `isToolsOpen`.
4. Render `<ClassRecordStats>` immediately beneath.
5. Render notification banners (`GradeStatusBanner`, `RotationBanner`, `InheritedGradesNotice`) directly above the ledger table.
6. Render `<ClassRecordTable>`:
   - Ensure `CLASS LEDGER` header bar has `Alphabetical`/`Gendered` toggle (`id="tutorial-gender-toggle"`), `Optional Assessment Details` (`id="tutorial-optional-details"`), and `Clear Scores`.

---

## 5. Verification Checklist for Workhorse
1. **Typecheck**:
   ```bash
   npx tsc --noEmit
   ```
   Must pass with 0 type errors.
2. **Visual Check**:
   - Verify the top block matches the DepEd Excel layout: **FIRST TERM**, **GRADE LEVEL**, **SECTION**, **TEACHER**, **SUBJECT**.
   - Verify the Class Ledger spreadsheet is immediately visible without scrolling.
3. **Interactive Tour (`ClassRecordTour`)**:
   - Run the tutorial from step 1 through step 11.
   - Confirm all spotlights attach accurately without console errors.
4. **Functionality**:
   - Switch terms (`T1` -> `T2` -> `T3`); verify title changes to `FIRST TERM`, `SECOND TERM`, `THIRD TERM` and scores update.
   - Open **Sync & Tools** drawer; test AIMS sync and Excel download.
   - Enter scores in the table; verify calculations update in real time.
