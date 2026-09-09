# Handoff: Align Teacher Portal UI with Registrar Design Language

## 1. Executive Summary & Objective
The goal of this task is to align the **Teacher Portal**'s visual styling, layout hierarchy, and design tokens to match the clean, institutional **Registrar UI Design Language** (established in `src/pages/registrar/Dashboard.tsx` and `src/pages/RegistrarLoginPage.tsx`), while strictly preserving all teacher-specific features, data displays, workflows, and zero backend modifications.

---

## 2. ⚠️ Critical Non-Negotiable Guardrails
1. **STRICT FILE EXEMPTION**:
   - `src/pages/teacher/ClassRecordView.tsx` is **100% OFF-LIMITS**.
   - DO NOT touch, format, refactor, or edit `ClassRecordView.tsx`. The DepEd quarterly grading sheet, calculation formulas, score inputs, and weighting rules must remain completely untouched.
2. **ZERO BACKEND CHANGES**:
   - Do NOT touch any backend code, API routes, controller logic, Prisma models, database queries, or server-side endpoints.
   - All frontend data hooks, handlers, state variables, and `useEffect` blocks must remain fully intact.
3. **PRESERVE ALL TEACHER DATA**:
   - This task is purely visual/CSS/Tailwind alignment. Do NOT remove any existing cards, stats, advisory links, or schedule indicators.

---

## 3. Registrar Reference Design System (The Standard)
Use `src/pages/registrar/Dashboard.tsx` as the source of truth for all styling tokens:

| Element | Registrar Design Standard | Tailwind / CSS Classes |
| :--- | :--- | :--- |
| **Hero Card Container** | Full-width rounded card with primary school color (maroon) | `relative overflow-hidden rounded-2xl p-6 text-white` with `style={{ backgroundColor: colors.primary }}` |
| **Hero PageHeader** | Clean white typography with muted white subtext | `text-white [&_h1]:!text-white [&_p]:!text-white/80` |
| **Hero Action Badges** | Glassmorphic badge pill | `bg-white/20 text-white border-white/20 backdrop-blur-sm font-semibold` |
| **Hero Action Buttons** | Translucent pill button with hover | `bg-white/20 hover:bg-white/30 text-white border-white/20 backdrop-blur-sm font-semibold` |
| **Hero Mini-Stats Grid** | Grid of glassmorphic statistic tiles inside the banner | Container: `grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5`<br>Tile: `bg-white/15 backdrop-blur-sm rounded-xl p-3 border border-white/10` |
| **KPI Metric Cards** | Frosted white card with fine slate border | `border border-slate-200/60 rounded-2xl bg-card/70 backdrop-blur-xl p-4 shadow-md shadow-slate-200/40 hover:shadow-xl transition-all group relative overflow-hidden` |
| **Card Radii** | Standardized radius | `rounded-2xl` (replace any erratic `rounded-[2.5rem]` or `rounded-3xl`) |
| **Inputs / Selects** | Crisp white fill, slate border, primary maroon focus ring | `bg-white border-slate-300 hover:border-slate-400 focus:border-red-700 focus:ring-2 focus:ring-red-100 rounded-xl h-11 transition-all` |
| **Login Card Header** | Seamless modal header with no harsh dividers | `text-center pt-8 pb-3 px-8 bg-transparent border-b-0` |

---

## 4. Implementation Steps by File

### A. Teacher Login Page (`src/pages/LoginPage.tsx`)
Align with `src/pages/RegistrarLoginPage.tsx`:
1. **Remove Divider Line**: In the `CardHeader`, add `border-b-0 bg-transparent` so there is no gray line cutting across the card.
2. **Subheader Typography**: Ensure the subtitle under "Welcome Back" is formatted in regular sentence-case:
   ```tsx
   <CardDescription className="text-slate-500 text-sm font-normal mt-1 leading-relaxed">
     Sign in to your Teacher account to manage classes at <span className="font-semibold text-primary">{acronym}</span>
   </CardDescription>
   ```
3. **Form Fields**: Ensure email and password inputs use clean white background with slate border:
   `className="pl-12 h-11 bg-white border-slate-300 hover:border-slate-400 focus:border-red-700 focus:ring-2 focus:ring-red-100 focus:outline-none rounded-xl transition-all duration-200 placeholder:text-slate-400 text-slate-800 text-sm font-medium"`
4. **Card Corners & Shadow**: Ensure card uses `rounded-2xl` with a soft multi-layered shadow.

---

### B. Teacher Dashboard (`src/pages/teacher/Dashboard.tsx`)
1. **Replace the Hero Section**:
   - Currently, the hero uses an asymmetric skewed white card (`rounded-[2.5rem] bg-white border border-slate-200 ...`).
   - Replace this wrapper with the Registrar's signature maroon hero container:
     ```tsx
     <div
       className="relative overflow-hidden rounded-2xl p-6 text-white animate-in fade-in slide-in-from-bottom-1 duration-300"
       style={{ backgroundColor: colors.primary }}
     >
       <div className="relative">
         <PageHeader
           title={`Good day, Teacher ${data.teacher.name.split(',')[0]}`}
           description={data.stats.totalClasses > 0 ? `Managing ${data.stats.totalStudents} students across ${data.stats.totalClasses} classes \u2022 S.Y. ${data.classAssignments[0]?.schoolYear || ""}` : undefined}
           className="text-white [&_h1]:!text-white [&_p]:!text-white/80"
           actions={
             <div className="flex flex-wrap items-center gap-2">
               <Badge className="bg-white/20 text-white border-white/20 backdrop-blur-sm font-semibold">
                 {data.currentTerm === 'T1' ? 'Term 1' : data.currentTerm === 'T2' ? 'Term 2' : data.currentTerm === 'T3' ? 'Term 3' : 'Active Term'}
               </Badge>
               <Link to="/teacher/advisory">
                 <Button className="bg-white/20 hover:bg-white/30 text-white border-white/20 backdrop-blur-sm font-semibold">
                   <Users className="w-4 h-4 mr-2" />
                   My Advisory
                 </Button>
               </Link>
               <Link to="/teacher/classes">
                 <Button className="bg-white/20 hover:bg-white/30 text-white border-white/20 backdrop-blur-sm font-semibold">
                   <BookOpen className="w-4 h-4 mr-2" />
                   Class Records
                 </Button>
               </Link>
             </div>
           }
         />
       </div>

       {/* Hero Mini-Stats Bar */}
       <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
         <div className="bg-white/15 backdrop-blur-sm rounded-xl p-3 border border-white/10">
           <div className="flex items-center gap-2 mb-1">
             <TrendingUp className="w-3.5 h-3.5 text-white/80" />
             <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Overall Passing</span>
           </div>
           <p className="text-2xl font-bold text-white">{stats?.summary.overallPassingRate.toFixed(0) ?? 0}%</p>
         </div>

         <div className="bg-white/15 backdrop-blur-sm rounded-xl p-3 border border-white/10">
           <div className="flex items-center gap-2 mb-1">
             <FileCheck className="w-3.5 h-3.5 text-white/80" />
             <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">Submission Rate</span>
           </div>
           <p className="text-2xl font-bold text-white">{stats?.summary.gradeSubmissionRate.toFixed(0) ?? 0}%</p>
         </div>

         <div className="bg-white/15 backdrop-blur-sm rounded-xl p-3 border border-white/10 col-span-2 sm:col-span-2">
           <div className="flex items-center gap-2 mb-1">
             <Clock className="w-3.5 h-3.5 text-white/80" />
             <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">
               {classInfo.status === "active" ? "Current Class" : classInfo.status === "next" ? "Next Up" : "Schedule"}
             </span>
           </div>
           <p className="text-sm font-bold text-white truncate">
             {classInfo.status === "active" && classInfo.current
               ? `${classInfo.current.subject.name} (${classInfo.current.section.name})`
               : classInfo.status === "next" && classInfo.next
               ? `${classInfo.next.subject.name} at ${fmtTime12h(classInfo.next.startTime)}`
               : "No more classes today"}
           </p>
         </div>
       </div>
     </div>
     ```

2. **Standardize the 4 Main KPI Cards**:
   - Standardize the card container to match Registrar:
     `className="border border-slate-200/60 rounded-2xl bg-card/70 backdrop-blur-xl p-4 shadow-md shadow-slate-200/40 hover:shadow-xl transition-all group"`
   - Ensure clean title typography (`text-[10px] font-bold text-muted-foreground uppercase tracking-widest`), bold value (`text-2xl font-bold text-foreground mt-0.5`), and clean subtext (`text-[11px] text-muted-foreground`).

3. **Performance Mastery & Needs Attention Cards**:
   - Replace any `rounded-[2.5rem]` with `rounded-2xl border border-slate-200/60 shadow-sm`.
   - Update `CardHeader` styling to `p-6 pb-3 border-b border-slate-100`.

---

### C. Teacher Class Records List (`src/pages/teacher/ClassRecordsList.tsx`)
1. Align the header banner with the Registrar standard.
2. Standardize search inputs, grade level filter buttons/dropdowns to `h-10`/`h-11`, `rounded-xl`, and `border-slate-300`.
3. Standardize the subject/section card grid with `rounded-2xl border border-slate-200/60`.

---

### D. My Advisory Page (`src/pages/teacher/MyAdvisory.tsx`)
1. Ensure the student table container has `rounded-2xl border border-slate-200/60 overflow-hidden shadow-sm`.
2. Standardize student status badges (e.g. Promoted, Retained, Transferred) to match the subtle badge styling used in Registrar (`bg-emerald-500/10 text-emerald-700 border-emerald-200`).

---

## 5. Verification Checklist for the Implementation AI
- [ ] `src/pages/teacher/ClassRecordView.tsx` is completely untouched (check `git status` / `git diff` to ensure 0 changes).
- [ ] No server/API files were touched.
- [ ] Teacher Login card has no gray line under the header and displays clean typography.
- [ ] Teacher Dashboard features the signature primary maroon hero banner with integrated mini-stat widgets.
- [ ] All card corners are uniformly `rounded-2xl` (no oversized `rounded-[2.5rem]` remaining).
- [ ] All Teacher links (My Advisory, Class Records, etc.) and real-time data function without errors.
