# Teacher Mobile Experience — Research and Redesign Plan

**Status:** Planning / research only. No application files were modified.
**Scope:** Teacher portal (`/teacher/*`), ~375px mobile viewport.
**Constraint:** Presentation-only redesign (JSX and styling). Do not break logic, state handling, or backend API calls. Do not edit `api/`, `services/`, `hooks/`, or `types/`.
**Design and skills:** See Section 0 for the visual direction, mobile design system, installed agent skills, and per-phase skill assignments.

---

## 0. Design direction and skills we will use

### 0.1 Visual direction

**Working direction: "confident institutional, not generic SaaS."**

The teacher portal should feel like a well-designed school operating system: calm, legible, fast, and human. Dense information is acceptable; visual noise is not. It should look intentional at 375px, not like a desktop dashboard squeezed down.

**Principles**
- **Clarity first.** One primary task per screen and one primary action per view.
- **Editorial hierarchy.** Strong type scale, disciplined spacing, clear grouping. Avoid a wall of identical cards.
- **One accent, many neutrals.** Use the school's `--primary` as the single brand accent. Use semantic neutrals for surfaces and text. Status color is for status only.
- **Restrained depth.** Borders and one elevated surface beat a shadow on every card. Avoid the "rounded card kit" look.
- **Real content.** Design with long names, long subject titles, 40+ learners, empty states, and 150% text scale.
- **Mobile-native interaction.** Bottom navigation, full-screen task sheets, sticky actions, tap-first flows, and 44-48px targets.
- **No hover dependency.** Every action must be visible or reachable by tap.
- **One signature per page.** For example: attendance status rail, class-record student focus mode, schedule day timeline. Spend boldness there and keep the rest quiet.

**Avoid**
- Indigo/purple gradient hero as the default.
- Identical `rounded-2xl` cards with the same shadow everywhere.
- Emoji as icons.
- 8-10px text for readable content.
- `font-black` and all-caps labels on body content.
- Raw palette colors (`text-slate-*`, `bg-blue-600`) for UI chrome.
- Hover-only actions, tooltips as the only label, or icon-only buttons without `aria-label`.

### 0.2 Mobile design system

**Spacing (4pt base):** `4, 8, 12, 16, 20, 24, 32, 40, 48`

- Screen edge: 16px.
- Card padding: 16px (compact) or 20px (comfortable); never 32px on phone.
- Section gap: 20-24px.
- Inline gap: 8-12px.
- Sticky bottom bar: 12-16px plus safe area.

**Typography**

| Role | Mobile |
|---|---|
| Page title | 24px / 32px, 600 |
| Section title | 18px / 26px, 600 |
| Card title | 16px / 24px, 600 |
| Body | 14-16px / 22-24px, 400 |
| Caption / meta | 12px / 16px, 500 |
| Table header | 11px uppercase, tracking wide |
| Input text | >=16px (prevents iOS zoom) |

Use the existing DM Sans. Prefer weight, size, and spacing over color for hierarchy. Do not use `font-black`.

**Shape and depth**
- Buttons and inputs: 12px radius.
- Cards: 16px radius.
- Sheets/modals: 20-24px top radius; full-screen on phone.
- Use one elevated surface per screen; otherwise use border plus flat surface.
- Avoid mixing three or four radii on the same screen.

**Color**
- Surfaces: `bg-background`, `bg-card`, `bg-muted`.
- Text: `text-foreground`, `text-muted-foreground`.
- Brand: `bg-primary`, `text-primary`, `border-primary`.
- Status: `text-destructive`, plus the ledger tokens for WW/PT/TA/grade.
- Dark mode: verify every touched page under `.dark`; no hardcoded `bg-white`.
- Contrast: 4.5:1 for body text, 3:1 for large text and icons.

**Touch and feedback**
- Minimum 44x44px; prefer 48x48px for primary controls.
- At least 8px between adjacent targets.
- Every row or card that navigates is a full-row target.
- States: default, pressed, focus-visible, disabled, loading, empty, error, offline.
- Press feedback: `active:scale-[0.98]` or a background shift, 120-160ms.
- No hover-only reveal. No `title` as the only label.

**Motion**
- Micro-interactions: 120-200ms ease-out.
- Sheets and page transitions: 200-300ms ease-out.
- Respect `prefers-reduced-motion`.
- No cascade of fade-and-slide on every section.

**Navigation**
- Bottom navigation: four primary destinations plus "More."
- Active state: pill, label, and icon color.
- Keep labels visible; do not use unlabeled icons.
- Safe area: `env(safe-area-inset-bottom)` and `100dvh`, not `100vh`.
- Secondary pages use a back affordance in the header.

**Content patterns**
- Lists and cards for single-record tasks.
- Tables only for comparison; if a table stays, use a sticky header, sticky first column, and a visible horizontal-scroll cue.
- Forms: visible labels, correct `inputMode`, inline errors, sticky save.
- Long rosters: search, section grouping, and sticky date/term context.
- Destructive actions: bottom sheet or full-screen confirmation, never a hover-only trash icon.

### 0.3 Skills we will use

These are installed globally under `~/.agents/skills/` (on this machine: `C:\Users\Sean\.agents\skills\`):

| Skill | Role in this redesign | Load when |
|---|---|---|
| **`ui-ux-pro-max`** | Design intelligence: design-system generation, 119 UX rules, styles/palettes/typography, React/Tailwind/shadcn stack guidance | Start of each phase; UX audit; visual direction; component polish |
| **`pixel-perfect-mobile`** | Mobile component specs, 4pt grid, tokens, touch sizes, iOS/Material patterns | Building or reviewing any mobile component |
| **`doesntbreak`** | Responsive guardrails: 320px-first, no horizontal scroll, `dvh`, safe areas, 44px targets, `min-width: 0` | Before and after writing layout code; mobile QA |
| **`frontend-design`** | Distinctive visual direction, typography, anti-generic review, restraint | Visual direction and final "does this look real?" review |
| **`ui-design`** (existing) | SMART repo-specific tokens, design principles, audit checklist | Any SMART styling work |
| **`accessibility`** (existing) | WCAG 2.2 AA, focus, contrast, screen-reader patterns | Forms, sheets, navigation, interactive states |
| **`e2e-testing`** (existing) | Playwright verification and screenshot capture | Visual QA at 375/390/430 and regression checks |

**Primary combo for this project:** `ui-ux-pro-max` + `pixel-perfect-mobile` + `doesntbreak` + `frontend-design`, with `ui-design` and `accessibility` as repository/accessibility guards.

**Notes**
- Start a new OpenCode session after installing global skills so they are discovered.
- The `ui-ux-pro-max` search script is invoked from `~/.agents/skills/ui-ux-pro-max/scripts/search.py` (path corrected for OpenCode).
- Skills are advisory: repository rules, existing tokens, and the "no logic changes" constraint always win.

**Skill usage protocol**
1. Before a phase, load `ui-ux-pro-max` and query the design system for the page type, e.g. `"school management teacher mobile attendance" --design-system --density 7`.
2. Use `pixel-perfect-mobile` for exact component specs and touch sizes.
3. Write mobile-first JSX/Tailwind; run `doesntbreak` checks before calling it done.
4. Use `frontend-design` to challenge generic layouts, typography, and motion.
5. Verify with `e2e-testing` screenshots at 375px and 430px, plus 150% text scale and dark mode.
6. Do not change API/service/hook/type files. If a pattern needs logic changes, stop and ask.

**Skill assignment by phase**

| Phase | Primary | Supporting |
|---|---|---|
| P0 shell + attendance | `pixel-perfect-mobile` | `doesntbreak`, `frontend-design`, `ui-design` |
| P1 class record focus mode | `ui-ux-pro-max` | `pixel-perfect-mobile`, `doesntbreak`, `accessibility` |
| P1 schedule | `doesntbreak` | `pixel-perfect-mobile` |
| P2 class list + dashboard | `frontend-design` | `ui-ux-pro-max`, `ui-design` |
| P2 advisory + student profile | `pixel-perfect-mobile` | `ui-design`, `accessibility` |
| P3 attendance reports | `ui-ux-pro-max` | `doesntbreak` |
| QA every phase | `doesntbreak` | `accessibility`, `e2e-testing` |

### 0.4 Definition of done for every redesigned page

- No page-level horizontal scroll at 320, 375, 390, or 430px.
- All interactive targets at least 44x44px, with 8px spacing.
- No hover-only action; no icon-only button without `aria-label`.
- One clear primary action; sticky where the task is long.
- Works at 150% text scale without clipping.
- Dark mode passes contrast on every touched surface.
- Safe-area insets respected; the bottom bar does not cover content.
- Real content tested: long names, 40+ learners, empty/loading/error states.
- Screenshot review at 375px and 430px before merge.
- `pnpm run build` and `pnpm run lint` pass.

---

## 1. Teacher route and component map

| Route | Component(s) | Main teacher task |
|---|---|---|
| `/teacher` | `Dashboard.tsx` | Morning triage: today's classes, grading progress, at-risk students, honors |
| `/teacher/schedule` | `Schedule.tsx`, `ScheduleDraftPanel.tsx` | Check weekly timetable and today's classes; refresh ATLAS schedule; preview draft |
| `/teacher/classes`, `/teacher/records` | `ClassRecordsList.tsx` | Find/open a class record; filter by term; manage archived records; connect AIMS |
| `/teacher/records/:classAssignmentId` | `ClassRecordView.tsx` + `ClassRecordHero`, `ClassRecordMobileList`, `ClassRecordTable`, `GradeEditModal`, `AssessmentHeader`, `ClassRecordHeroTools`, `EditRequestModal`, `ClassRecordTour`, banners | Enter/edit WW/PT/TA scores; manage assessment columns/HPS; Excel import/export; AIMS; request past-term edit |
| `/teacher/attendance` | `Attendance.tsx` (wrapped by `RequireAdvisory`) | Take daily attendance; mark present/absent/late/excused; remarks; save and next day |
| `/teacher/attendance-reports` | `AttendanceReports.tsx` (wrapped by `RequireAdvisory`) | View monthly SF2 attendance matrix; download Excel |
| `/teacher/advisory` | `MyAdvisory.tsx` | View/search advisory roster; split by gender; open student profile; sync from EnrollPro |
| `/teacher/advisory/student/:studentId` | `StudentGradeProfile.tsx` | View student information, term grades, final grades, promotion/honors |
| `/teacher/*` shell | `TeacherLayout.tsx`, `RequireAdvisory` | Navigation, notifications, text size, school year, logout |

`/login` is shared across roles and sits outside the teacher shell, so it is treated as out of scope.

---

## 2. Page-by-page mobile audit at ~375px

| Page | What breaks or is hard to use | Recommended mobile pattern | Difficulty | API hooks / calls (list only) |
|---|---|---|---|---|
| **Teacher shell** `/teacher/*` — `TeacherLayout` | 280px drawer on a 375px screen; header icon buttons and sidebar rows are ~36px; no bottom navigation; no safe-area handling; no `dvh`; `main p-4` plus ClassRecordView `px-6` leaves ~295px; fixed heights clip at 150% text scale | Bottom navigation with 4 primary destinations + "More"; 48px targets; compact sticky header; `100dvh`; `env(safe-area-inset-bottom)`; preserve advisory-only filtering | Medium | `useTheme`, `useSyncStream`, `useHasAdvisory`, `useNotifications`, `useTextScale` |
| **Dashboard** `/teacher` | Honors table is inside `overflow-hidden`, so it clips rather than scrolls; fixed select widths 115/135/185px; 320px chart with five 10px labels; nested `ScrollArea h-[350px]`; 32px card padding; single-column stat cards create a very long page | Mobile "pulse" view: next class, deadline, 2x2 stats, at-risk/honors as cards; collapse or hide secondary analytics; full-width filters | Medium | `gradesApi.getDashboard`, `getDashboardStats`, `getMasteryDistribution`, `getAdvisoryHonors`, `scheduleApi.getMySchedule`, `useSyncStream` |
| **Schedule** `/teacher/schedule` | Weekly grid has `min-w-[750px]`, so only ~1.5 days are visible; "Today's Classes" sits below the wide grid; draft rows use `whitespace-nowrap` and overflow at 279px inner width; term chips wrap | Default to a "Today" agenda with a Mon-Fri day switcher; keep the week grid as a secondary view with sticky time column; stack draft rows vertically | Low | `scheduleApi.getMySchedule`, `refreshSchedule`, `getMyDraft`, `useSyncStream` |
| **Class Records list** `/teacher/classes` | Toolbar needs ~296px but only has ~279px inside the `p-8` card; delete controls are `opacity-0 group-hover:opacity-100`, so touch users cannot discover them; archived cards are fixed 320px carousel items; AIMS chip is ~24px high; large `p-8` dialogs | Full-width search/filter stack; class cards; always-visible actions; archived accordion; bottom-sheet confirmation | Low | `gradesApi.getMyClasses`, `getDeadlineStatus`, `publicSettingsApi.getSettings`, `advisoryApi.syncFromEnrollPro`, `deleteClassAssignment`, `deleteAllArchivedClassAssignments`, `useSyncStream` |
| **Class Record View** `/teacher/records/:id` | Outer `px-6` leaves ~295px; term chips are 24px and tools 32px; mobile grade editor is a centered `max-h-[85vh]` dialog with "Done" at the bottom; inputs commit on blur; no EX sub-test editing; column description/date are edited per student but apply class-wide; view-only terms cannot open student detail; desktop ledger remains mounted but hidden | Student-first focus mode: tap a student -> full-screen sheet with WW/PT/TA tabs, large numeric inputs, sticky Save/Done, previous/next student; move class-level assessment settings to a separate sheet; keep ledger desktop-only | **High** | `useClassRecordQuery`, `useTransmutationTable`, `useEditAccess`, `useAssessmentMeta`, `useMobileEditor`, `useScoreWriteQueue`, `useAimsData`, `useStickyLayout`; `gradesApi.*`, `publicSettingsApi.getSettings` |
| **Attendance** `/teacher/attendance` | Four-column table is ~700px+ wide and horizontally scrolls; status buttons are 32px symbol-only controls; remarks input lives inside the scrolled table; Save actions are at the top, so long rosters require scrolling back; no search; dynamic `bg-${status}-600` classes are fragile; monthly stats do N+1 student requests | Roster list with 44-48px P/A/L/E segmented control per student; sticky bottom "Save & Next Day"; expandable remarks; search; sticky date header | Medium | `GET /api/advisory/my-advisory`, `GET /api/attendance/section/:id`, `GET /api/attendance/summary/:id`, `GET /api/attendance/student/:id`, `POST /api/attendance/bulk`, `POST /api/attendance/clear` |
| **Attendance Reports** `/teacher/attendance-reports` | 20+ day columns plus summary columns make a ~1,500px matrix; day cells are 40px and text is 8-10px; first/name column is not sticky; date is only in a hover `title`; the matrix is a report task, not a phone task | Month summary first; per-student attendance cards; tap student -> daily marks sheet; full SF2 grid behind "View full grid" with sticky first column; keep Excel download prominent | Medium | `advisoryApi.getMyAdvisory`, `api.get('/attendance/sf2/:id')`, `api.get('/attendance/export/:id')` |
| **My Advisory** `/teacher/advisory` | Six-column table scrolls horizontally; long guardian column; `p-8` header; hover-only styling; small profile action | Search + gender toggle + student cards showing name, LRN, gender, guardian; tap card -> profile | Low | `advisoryApi.getMyAdvisory`, `syncFromEnrollPro`, `useSyncStream` |
| **Student Grade Profile** `/teacher/advisory/student/:id` | Six-column grade table is ~700px wide; many 9-10px labels; 32px icon-only back button; dense information card | Sticky student summary; subject cards showing T1/T2/T3/final/remarks; keep the table on desktop | Low | `advisoryApi.getStudentGrades` |

---

## 3. Styling system to stay consistent with

- **Tailwind CSS v4** via `@tailwindcss/vite`; no `tailwind.config.*`. Theme is CSS-first in `src/index.css` using `@theme inline`.
- **Breakpoints:** Tailwind defaults: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px. The teacher product currently uses `lg` as the main mobile/desktop switch (`TeacherLayout` sidebar and `ClassRecordTable`).
- **UI library:** shadcn/ui primitives built on `@base-ui/react`, in `src/components/ui/` — `Card`, `Button`, `Dialog`, `Select`, `Table`, `Badge`, `Input`.
- **Shared layout:** `PageHeader`, `StatCard`, and the `DataTable` family. Teacher pages currently use raw `Table` rather than `DataTable`.
- **Tokens:** semantic `--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--primary`, `--destructive`, `--ring`; runtime school branding via `--theme-primary` / `--theme-primary-text`; ledger tokens `--ledger-ww`, `--ledger-pt`, `--ledger-ta`, `--ledger-grade`, `--ledger-aims` and their backgrounds; dark mode under `.dark`.
- **Typography:** DM Sans; root `16px` normally, `15px` at <=640px; accessibility text scale `--text-scale` from 90% to 150%.
- **Rules from `AGENTS.md`:** use semantic tokens, not `text-gray-*`/`text-slate-*` for chrome; no `font-black`; no inline color styles except ThemeContext; page root `space-y-6`; use `PageHeader`. Several teacher pages currently violate these, so touched files should be normalized.
- **Important global constraint:** `Button` default height is 32px (`src/components/ui/button.tsx`). Do not change it globally; use per-page `h-11`/`h-12`/`h-14` mobile classes.

---

## 4. Research-backed UX approach

The core decision is: **do not make teachers pinch, pan, or horizontally scroll to complete a primary task.** Tables are appropriate for comparison, but single-record work should become a focused list/card or sheet. NN/g recommends sticky headers, a locked first column, and clear horizontal-scroll affordances when a table must stay wide; it also notes that editing a single record is better handled as a full record view than a wide table row.

- [NN/g — Mobile Tables: Comparisons and Other Data Tables](https://www.nngroup.com/articles/mobile-tables/)
- [NN/g — Data Tables: Four Major User Tasks](https://www.nngroup.com/articles/data-tables/)

### Attendance

Use a roster list, not a table. Each student gets one row with name/LRN and a 44-48px status control. Use a sticky bottom action bar for "Save & Next Day." This keeps the daily task one-handed and avoids the 700px table. Material recommends 48dp targets; Apple recommends 44pt; WCAG 2.2 sets the legal minimum at 24x24 CSS px, which is too small for frequent data entry.

- [Material Design 3 — Touch targets](https://m3.material.io/foundations/designing/structure)
- [Apple — UI Design Dos and Don'ts](https://developer.apple.com/design/tips/)
- [W3C — WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)

### Grade entry

Keep the existing student list, but turn the editor into a **full-screen focus mode** with large numeric inputs and sticky Save. Material recommends full-screen dialogs for keyboard-heavy, multi-step tasks; bottom sheets are better for lightweight actions.

- [Material Design 3 — Dialogs](https://m3.material.io/components/dialogs/guidelines)
- [Material Design 3 — Bottom sheets](https://m3.material.io/components/bottom-sheets/guidelines)

### Class records, schedule, advisory, student profile

Use cards for browsing and single-record viewing; reserve tables for desktop comparison. NN/g notes card views are visually engaging and good for grouping, while lists are more space-efficient; mobile tables work best when users can select the subset of data they need.

- [NN/g — Card View vs. List View](https://www.nngroup.com/videos/card-view-vs-list-view/)
- [NN/g — Mobile Tables](https://www.nngroup.com/articles/mobile-tables/)

### Navigation

A bottom navigation bar is appropriate for 3-5 top-level destinations on compact screens; keep labels and icons. The teacher shell currently has six destinations, so use four primary destinations plus "More."

- [Material Design 3 — Navigation bar](https://m3.material.io/components/navigation-bar)
- [NN/g — Basic Patterns for Mobile Navigation](https://www.nngroup.com/articles/mobile-navigation-patterns/)

### Overlays

Avoid stacked dialogs. NN/g recommends supporting both a visible Close button and the Back gesture/button for overlays; do not stack bottom sheets.

- [NN/g — Bottom Sheets: Definition and UX Guidelines](https://www.nngroup.com/articles/bottom-sheet/)
- [NN/g — Accidental Dismissal of Overlays](https://www.nngroup.com/articles/accidental-overlay-dismissal/)

### Numeric input

`GradeEditModal` already uses `inputMode="decimal"`, which is correct. Keep it, add `enterKeyHint`, and avoid unnecessary typing.

- [web.dev — Form attributes in depth](https://web.dev/learn/forms/attributes)
- [MDN — Mobile accessibility](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/Mobile)

### Safe areas

If you add a bottom bar, add `viewport-fit=cover` to `index.html` and use `env(safe-area-inset-bottom)` plus `100dvh`; `100vh` is unreliable on mobile Safari.

- [MDN — env()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)

---

## 5. Prioritized redesign plan

### P0 — Foundation and daily attendance

1. **Teacher shell + mobile primitives.** Add bottom navigation (4 + More), 48px targets, safe-area support, compact header, and reusable `MobileListRow` / `FullScreenSheet` / `StickyActionBar`. This affects every page, so do it first. Preserve `useHasAdvisory` filtering.
2. **Attendance.** Highest-frequency daily task and currently the worst table experience. Reuse the existing state handlers; no API changes.

### P1 — Core grading

3. **Class Record View mobile focus mode.** Improve the existing `ClassRecordMobileList` + `GradeEditModal` rather than replacing the ledger. This is the highest-risk page; do it only after agreeing on save semantics.
4. **Schedule.** Promote today's agenda to the default mobile view; keep the week grid secondary. Low risk and quick win.

### P2 — Browse and insight

5. **Class Records list.** Fix filter overflow and replace hover-only delete controls; keep the existing card grid. Quick win.
6. **Dashboard.** Build a compact mobile pulse; convert honors table to cards, hide or simplify the chart, and make filters full-width.
7. **My Advisory + Student Grade Profile.** Convert tables to cards; keep search, gender split, and summary values.

### P3 — Reports

8. **Attendance Reports.** Summary + per-student detail first; full SF2 matrix behind a "View full grid" toggle with sticky first column. Keep Excel download primary.

Each phase can ship independently. No backend, API, service, or hook changes are required for the recommended patterns.

---

## 6. Risks: where layout is tightly coupled to logic

- **`ClassRecordTable` / `ClassRecordView` ledger.** The desktop table uses sticky header measurement, synchronized header/body horizontal scrolling, fixed column widths, keyboard navigation, HPS editing, add/remove tasks, AIMS columns, cell validation, and a score write queue. `ClassRecordTable.tsx:296` hides itself with `hidden lg:block`, but it is still mounted. Do not restructure its JSX without a dedicated regression pass.
- **`useStickyLayout` hardcodes `topNavHeight = 64` (`useStickyLayout.ts:20`).** If you change the desktop header height, ledger sticky offsets break. Keep the desktop header at 64px or treat the hook as a logic change.
- **`useMobileEditor`.** `openMobileEditor` early-returns when `isViewOnly` (`useMobileEditor.ts:31`), and score commits happen on blur (`useMobileEditor.ts:62`). An explicit Save button, previous/next student flow, or read-only detail view changes behavior. Flag and confirm before implementing.
- **`useScoreWriteQueue`.** Mobile "Done" and navigation must flush pending scores (`flushNow()`), or edits can be lost. The current editor commits on blur; a new sticky Save must coordinate with the queue.
- **Attendance save flow.** `saveAndNextDay` advances the date even if the save failed (`Attendance.tsx:327`), and `confirmClear` resets the UI even if the delete request fails (`Attendance.tsx:267`). These are existing logic bugs; do not fix them silently during a presentation-only redesign.
- **Attendance monthly stats.** `fetchMonthlySF2Stats` makes one `/attendance/student/:id` request per absentee (`Attendance.tsx:122-159`). A mobile redesign should not add more requests; if anything, this needs a backend aggregation change later.
- **Schedule contract.** `getTimeSlots` builds rows from `entries`, `specialEvents`, and `timeSlots` (`Schedule.tsx:204`). Use the existing `byDay` data for a day agenda; do not reimplement contract semantics.
- **Advisory grouping.** `separateByGender` changes the table structure and uses `colSpan={6}` (`MyAdvisory.tsx:428`). If you switch to cards, preserve the grouping and sorting.
- **Class Records list state.** `termFilteredClasses`, archived/transferred detection, off-term rotation, and delete handlers are intertwined. Keep the handlers and change only the card/action presentation.
- **Text scale and dark mode.** Fixed `h-*`, `text-[8px]`-`text-[10px]`, `bg-white`, and `text-slate-*` are widespread. At 150% text scale, fixed-height rows and the 64px header will clip. The redesign should use `min-h`, wrapping, and semantic tokens.
- **Dynamic Tailwind classes.** Attendance uses `` bg-${option.color}-600 `` (`Attendance.tsx:548`) and Dashboard uses similar dynamic classes. Tailwind v4 will not reliably emit these. Replace with explicit maps.
- **Stacked overlays.** AIMS and Excel tools already open dialogs inside the class record page. A new mobile sheet must not stack on top of those; use one overlay at a time.
- **Safe area.** `index.html:7` currently has `width=device-width, initial-scale=1.0` without `viewport-fit=cover`. A fixed bottom bar will sit under the iOS home indicator until that changes.
- **Global primitives.** Changing `Button` default height or `Table` overflow globally would affect admin and registrar portals. Keep mobile sizing local to teacher pages.

---

## 7. Existing mobile work worth reusing

- `ClassRecordMobileList.tsx` already implements a student-card list with grade and WW/PT/TA totals.
- `useMobileEditor.ts` already manages mobile drafts, validation, and commit behavior.
- `GradeEditModal.tsx` already uses `inputMode="decimal"` and large inputs.
- `Schedule.tsx` already renders "Today's Classes" cards.
- `ClassRecordsList.tsx` already has a responsive grid/list toggle.
- `PageHeader`, `DataTable`, `TableStates`, and the Base UI `Dialog` can provide consistency; do not replace them wholesale.

---

## 8. Open questions

1. **Bottom navigation destinations:** default proposal is Dashboard, Class Records, Attendance, Schedule, with Advisory and Reports under "More." Is that the right priority order?
2. **Grade entry save semantics:** keep the current commit-on-blur behavior, or switch to explicit Save with a dirty indicator? The latter is safer on mobile but changes state behavior.
3. **EX sub-test scores:** should mobile grade entry support the exam sub-tests, or is WW/PT/TA only intentional? The current mobile editor does not expose EX.
4. **Read-only mobile detail:** should teachers be able to open a student's score detail on a locked/past term? Currently `openMobileEditor` blocks that.
5. **Attendance behavior:** should the redesign add a dirty-state warning or auto-save? Also, should "Save & Next Day" stop advancing when the save fails?
6. **Offline use:** is taking attendance in weak-signal classrooms a requirement? If yes, that is an architecture change, not a presentation change.
7. **Device targets:** Android Chrome only, or iOS Safari too? Minimum width 360px or 375px? Are tablets in scope?
8. **Scope of cleanup:** should the redesign also fix dark mode and 150% text scale on these pages, or stay focused on layout at 100%?
9. **Attendance Reports:** is a mobile summary + per-student detail acceptable, or must the full DepEd SF2 matrix be readable on the phone?
10. **Screenshot pass:** both dev servers are running, and Playwright is available, but a teacher test account is needed. With credentials (or approval to run the offline E2E rig), a 375px screenshot audit can be done before implementation.

---

## 9. Sources

- [NN/g — Mobile Tables: Comparisons and Other Data Tables](https://www.nngroup.com/articles/mobile-tables/)
- [NN/g — Data Tables: Four Major User Tasks](https://www.nngroup.com/articles/data-tables/)
- [NN/g — Basic Patterns for Mobile Navigation](https://www.nngroup.com/articles/mobile-navigation-patterns/)
- [NN/g — Bottom Sheets: Definition and UX Guidelines](https://www.nngroup.com/articles/bottom-sheet/)
- [NN/g — Accidental Dismissal of Overlays](https://www.nngroup.com/articles/accidental-overlay-dismissal/)
- [NN/g — Card View vs. List View](https://www.nngroup.com/videos/card-view-vs-list-view/)
- [Material Design 3 — Navigation bar](https://m3.material.io/components/navigation-bar)
- [Material Design 3 — Touch targets](https://m3.material.io/foundations/designing/structure)
- [Material Design 3 — Bottom sheets](https://m3.material.io/components/bottom-sheets/guidelines)
- [Material Design 3 — Dialogs](https://m3.material.io/components/dialogs/guidelines)
- [W3C — WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [Apple — UI Design Dos and Don'ts](https://developer.apple.com/design/tips/)
- [web.dev — Form attributes in depth](https://web.dev/learn/forms/attributes)
- [MDN — Mobile accessibility](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/Mobile)
- [MDN — env()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
