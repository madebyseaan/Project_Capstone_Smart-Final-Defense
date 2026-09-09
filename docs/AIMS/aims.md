AIMS → SMART: GET /public/courses shipped + integration answers
1. New endpoint: GET /api/v1/public/courses — LIVE in code, needs deploy to verify
Auth: x-api-key: <EXTERNAL_API_KEY> (same requireIntegrationKey middleware as the other /public/* routes — 401 missing/wrong, 503 unconfigured). Tenant-scoped by the server's own SCHOOL_ID via attachSchool; no cross-school access possible.

Request:

GET /api/v1/public/courses?teacherEmail=teacher@gmail.com&schoolYear=2028-2029&includeArchived=true
Param	Required	Behavior
teacherEmail	No	Case-insensitive exact match on the course owner's email. Omit for school-wide list.
schoolYear	No	Exact match on the course's schoolYear label (e.g. 2028-2029).
includeArchived	No	true/1 includes archived courses. Default false (active only).
Response ({ success: true, data: { courses: [...] } }):

{
  "id": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
  "name": "Science - Chemistry - MAKABANSA",
  "code": "EP-2726-SCI_CHEM",
  "subject": "Science - Chemistry",
  "gradeLevel": "Grade 8",
  "sectionName": "MAKABANSA",
  "schoolYear": "2028-2029",
  "teacherEmail": "teacher@gmail.com",
  "teacherName": "Teacher One",
  "archived": false,
  "studentCount": 32
}
Contract notes your agent must encode:

teacherEmail / teacherName are null when the course has no assigned teacher. This is common — bulk-synced STE/special-program subjects and courses whose teacher hasn't logged in yet have teacherId: null. A null teacherEmail means unassigned: never treat it as an ownership match, and never filter client-side with course.teacherEmail === teacherEmail without a null guard.
studentCount counts active enrollments only (archived: false filter in the _count). Removed/transferred students are excluded.
schoolYear = "the year this course was last active" — archival never re-stamps it, so filtering by year is stable across rollovers.
Teacher emails are often null even for assigned teachers. EP publishes no faculty emails, so most JIT-provisioned teacher accounts have email: null. If ownership validation by email fails, fall back to teacherName display + manual confirm — or ask us for a follow-up field (teacherUsername = employee number, always populated).
Read-only, single findMany, no pagination. Payload is one row per course; at school scale this is a few hundred rows max. Cache it on dialog-open, not on a timer.
Files changed (AIMS repo, 3 source files + docs):

server/src/services/public-integration.service.ts — new getPublicCourses() + PublicCourseListItem (mirrors the select patterns of getPublicCourseScores)
server/src/controllers/public.controller.ts — new listCourses (same query-coercion + envelope pattern; schoolId from req.school.id only, never from query)
server/src/routes/public.routes.ts — router.get('/courses', listCourses) mounted under the existing requireIntegrationKey chain; no route conflicts (/courses vs /courses/:courseId/scores are different segment counts)
docs/api/AIMS-PUBLIC-API.md — new section + quick-reference row
PROGRESS.md — one bullet
Verification: npm --prefix server run build → 9 errors before and after (all pre-existing baseline in auth/drive/resource/quiz files; zero in touched files). No migration, no schema change, no sync-path contact — the endpoint is a pure read against Course + User + enrollment counts. Live curl verification is still owed after deploy:

curl -H "x-api-key: <KEY>" "https://<aims-host>/api/v1/public/courses?teacherEmail=<teacher>"
# expect 200 { "success": true, "data": { "courses": [...] } }
2. enrollproId semantics (your §4, blocking) — confirmed with one correction
Not guaranteed to equal the EP learners-feed learner.id. AIMS writes enrollproId from two different EP IDs depending on which path ran last: teacher-sync roster writes the enrollment-record learner.id; first student login writes the auth-account learner.userId (see docs/CLASS-SYNC.md → Identity chain). Both are numeric EP IDs, but they are different namespaces.
Non-null for EP-synced students (JIT create always writes it).
AIMS-native accounts (manual create, Google self-reg) get null — serialized as "enrollproId": null, never 0, never omitted. Your "unmatchable, show name/email" handling is correct.
Yes, reassigned — EP IDs are year-scoped; reseeds and rollovers mint new ones and AIMS rewrites enrollproId on sync (matched by LRN). Re-resolve from the EP feed per school year; never treat it as immutable.
3. Scores clarifications (your §5) — 7 confirmed, 1 nuance, 1 correction
#	Verdict
1, 2, 3, 4, 8, 9	✅ Correct as coded
5	⚠️ Mostly — quizzes order by startedAt, but tasks order by gradedAt and TASK rows always have startedAt: null. Numbering restarts per quiz (keyed userId:quizId), so a remedial quiz restarts at attempt 1
6	❌ Correction — different assessmentId. Remedial quizzes are separate Quiz rows, so rows arrive as QUIZ:<remedialQuizId> vs QUIZ:<sourceQuizId>. Dedup on assessmentId will not collide — link original↔remedial via sourceQuizId + forStudentId (isRemedial: true). The public endpoint returns raw per-attempt rows; AIMS's internal blending rules (HIGHEST/AVERAGE/ORIGINAL/REMEDIAL/CUSTOM_WEIGHT) are not applied here
7	✅ No quarter field; gradedAt is the only anchor. Topic names like "Quarter 1" are free-text teacher labels, not a stable key. Date-binning is correct; per-row topic names are a reasonable future addition
Two more behaviors your agent should know: scores has no teacherId filter (unlike studentGrades, which drops teacher-less courses) — unassigned courses still return rows. And for RETURNED tasks, score is the stored grade passed through un-normalized; GRADED tasks are normalized grade/maxPoints×100.

4. Key rotation + scoping (your §2 question)
No rotation mechanism exists — static env var, restart to rotate. If you need rotation, we add an EXTERNAL_API_KEY_PREVIOUS grace fallback before you cut over; say the word. Per-school scoping is N/A by design: one key exposes exactly one school (this deployment's SCHOOL_ID).

5. Load profile (your §6) — accepted
A few hundred small full-pulls/day is fine. No rate limits on our side; your fail-soft + 3-attempt backoff matches our { success: false, error } envelope. Use from= watermarks once seeded — the endpoint already supports them.

6. Acceptance checklist status
EXTERNAL_API_KEY set (value still needs OOB sharing + your live curl verify)
enrollproId + assumptions answered above
GET /public/courses shipped in code — live curl verify owed after deploy; manual-ID fallback works regardless
Load profile accepted