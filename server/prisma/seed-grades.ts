import "dotenv/config";
import { PrismaClient, Term, GradeStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { makeTransmuter, resolveCanonicalWeights, type Weights } from "./canonicalGrade";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// ─── Seeded Random ───────────────────────────────────────────────────────────
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── Canonical Grading Config (loaded from DB at runtime — single source of truth) ──
// Table + weights mirror the server's transmute()/resolveEffectiveWeightsForClassAssignment,
// so seeded grades match the class record ledger recompute and SF9/SF10 display.

async function loadTransmutationTable() {
  const table = await prisma.transmutationEntry.findMany({ orderBy: { minGrade: "asc" } });
  if (table.length === 0) {
    throw new Error("TransmutationEntry table is empty — run `npm run prisma:seed` first so grades match the admin-configured table.");
  }
  return table;
}

async function loadWeightResolver(): Promise<(subjectCode: string) => Weights> {
  const [subjects, gradingConfigs] = await Promise.all([
    prisma.subject.findMany(),
    prisma.gradingConfig.findMany(),
  ]);
  const byCode = new Map(subjects.map((s) => [s.code, s]));
  return (subjectCode: string): Weights => {
    const subject = byCode.get(subjectCode);
    if (subject) return resolveCanonicalWeights(subject, gradingConfigs);
    return { ww: 20, pt: 50, qa: 30 };
  };
}

// ─── Qualitative Descriptor ──────────────────────────────────────────────────
function getDescriptor(qg: number): string {
  if (qg >= 98) return "Outstanding";
  if (qg >= 95) return "Very Satisfactory";
  if (qg >= 90) return "Satisfactory";
  if (qg >= 85) return "Fairly Satisfactory";
  if (qg >= 80) return "Beginning";
  return "Did Not Meet Expectations";
}

// ─── Subject Grouping (activity counts only — weights come from the DB) ──────

type SubjectGroup = "CORE" | "MATH_SCIENCE" | "MAPEH" | "TLE";

function getSubjectGroup(code: string): SubjectGroup {
  const c = code.toUpperCase();
  if (c.startsWith("MAPEH") || c.startsWith("SPS_SPEC") || c.startsWith("SPA_SPEC")) return "MAPEH";
  if (c.startsWith("TLE_")) return "TLE";
  if (c.startsWith("MATH") || c.startsWith("SCI_") || c.startsWith("BIOTECH") || c.startsWith("APPLIED_PHYS")) return "MATH_SCIENCE";
  return "CORE";
}

function computeGrade(
  wwScores: number[],
  ptScores: number[],
  qaScore: number,
  weights: { ww: number; pt: number; qa: number },
  transmute: (initialGrade: number) => number,
) {
  const wwPS = wwScores.length > 0 ? wwScores.reduce((a, b) => a + b, 0) / wwScores.length : 0;
  const ptPS = ptScores.length > 0 ? ptScores.reduce((a, b) => a + b, 0) / ptScores.length : 0;
  const qaPS = qaScore;
  const initialGrade = (wwPS * weights.ww + ptPS * weights.pt + qaPS * weights.qa) / 100;
  const quarterlyGrade = transmute(initialGrade);
  return { wwPS, ptPS, qaPS, initialGrade, quarterlyGrade };
}

// ─── G7 Students ─────────────────────────────────────────────────────────────
interface StudentInfo {
  student_id: string;
  firstName: string;
  lastName: string;
  section_id: string;
  section_name: string;
  enrollment_id: string;
}

const G7_STUDENTS: StudentInfo[] = [
  { student_id: "cmth7hhjf00ag94vezf8k1poy", firstName: "JOSHUA LUIS", lastName: "DOMINGO", section_id: "cmticjs7d015xrcve60d0693s", section_name: "Aguinaldo", enrollment_id: "cmtjgx0hz019xkcvevjbvn5o1" },
  { student_id: "cmtjgx0fw019qkcve6948ikod", firstName: "ANALYN", lastName: "FERNANDEZ", section_id: "cmticjs7d015xrcve60d0693s", section_name: "Aguinaldo", enrollment_id: "cmtjgx0i901agkcve4t4a8elw" },
  { student_id: "cmtjgx0fw019okcvelyai4y0h", firstName: "MELVIN", lastName: "FERNANDEZ", section_id: "cmticjs7d015xrcve60d0693s", section_name: "Aguinaldo", enrollment_id: "cmtjgx0i801aekcvezwlvserp" },
  { student_id: "cmth7hhjf00al94ve0jbevj3d", firstName: "CHRISTIAN PAUL", lastName: "JIMENEZ", section_id: "cmticjs7d015xrcve60d0693s", section_name: "Aguinaldo", enrollment_id: "cmtjgx0hx019ukcveo4k8wj46" },
  { student_id: "cmtjgx0fw019pkcvey7bmf1x4", firstName: "ROBERTO", lastName: "SALAZAR", section_id: "cmticjs7d015xrcve60d0693s", section_name: "Aguinaldo", enrollment_id: "cmtjgx0i801afkcve1hy32khb" },
  { student_id: "cmtjgx0fw019rkcvelc4m9q5a", firstName: "SHARON", lastName: "SALAZAR", section_id: "cmticjs7d015xrcve60d0693s", section_name: "Aguinaldo", enrollment_id: "cmtjgx0i901ahkcvevsy31ngl" },
  { student_id: "cmtjgx0fw019hkcvee1xy9bx5", firstName: "EUGENE", lastName: "MENDOZA", section_id: "cmticjs7u015yrcvedhmczev0", section_name: "Bonifacio", enrollment_id: "cmtjgx0i401a7kcveg50g9vm7" },
  { student_id: "cmtjgx0fw019jkcveowm3de6n", firstName: "HAZEL", lastName: "MENDOZA", section_id: "cmticjs7u015yrcvedhmczev0", section_name: "Bonifacio", enrollment_id: "cmtjgx0i501a9kcve9d1vowj0" },
  { student_id: "cmth7hhjf00a894ve2objovga", firstName: "MARK ANGELO", lastName: "RAMOS", section_id: "cmticjs7u015yrcvedhmczev0", section_name: "Bonifacio", enrollment_id: "cmtjgx0hx019vkcveuxlyqs7j" },
  { student_id: "cmth7hhjf00aa94ve79jhjg40", firstName: "CAMILLE JOY", lastName: "RAMOS", section_id: "cmticjs7u015yrcvedhmczev0", section_name: "Bonifacio", enrollment_id: "cmtjgx0hy019wkcve396ta6pj" },
  { student_id: "cmtjgx0fw019gkcvegi4m2sz2", firstName: "RYAN", lastName: "REYES", section_id: "cmticjs7u015yrcvedhmczev0", section_name: "Bonifacio", enrollment_id: "cmtjgx0i301a6kcveweszkttq" },
  { student_id: "cmtjgx0fw019ikcvenvlvyhce", firstName: "CHERRY", lastName: "REYES", section_id: "cmticjs7u015yrcvedhmczev0", section_name: "Bonifacio", enrollment_id: "cmtjgx0i401a8kcvedr2wtn1o" },
  { student_id: "cmtjgx0fw019ekcvehwdga50y", firstName: "LEAH", lastName: "BALUYOT", section_id: "cmticjs7w015zrcve3i4sdniy", section_name: "Luna", enrollment_id: "cmtjgx0i201a4kcvej10aexyi" },
  { student_id: "cmtjgx0fv019ckcvecij82689", firstName: "RODRIGO", lastName: "BALUYOT", section_id: "cmticjs7w015zrcve3i4sdniy", section_name: "Luna", enrollment_id: "cmtjgx0i101a2kcvezo1kml4l" },
  { student_id: "cmtjgx0fw019fkcves4hfneyz", firstName: "JENNY", lastName: "MAGSINO", section_id: "cmticjs7w015zrcve3i4sdniy", section_name: "Luna", enrollment_id: "cmtjgx0i301a5kcvexy1n7smo" },
  { student_id: "cmtjgx0fv019dkcveb9q3h87b", firstName: "ALVIN", lastName: "MAGSINO", section_id: "cmticjs7w015zrcve3i4sdniy", section_name: "Luna", enrollment_id: "cmtjgx0i201a3kcve3yhabngg" },
  { student_id: "cmtjgx0fw019nkcvekodlr60c", firstName: "ROSEMARIE", lastName: "CASTILLO", section_id: "cmticjs7y0160rcveil8z7o7c", section_name: "Mabini", enrollment_id: "cmtjgx0i701adkcveoml9xy8h" },
  { student_id: "cmtjgx0fw019lkcvebbvemyc8", firstName: "GARY", lastName: "CASTILLO", section_id: "cmticjs7y0160rcveil8z7o7c", section_name: "Mabini", enrollment_id: "cmtjgx0i601abkcve0b6k3o3w" },
  { student_id: "cmtjgx0fw019mkcvenboymwyh", firstName: "MARILOU", lastName: "RAMOS", section_id: "cmticjs7y0160rcveil8z7o7c", section_name: "Mabini", enrollment_id: "cmtjgx0i701ackcvemzpjtfkc" },
  { student_id: "cmtjgx0fw019kkcveh6gf05x8", firstName: "DEXTER", lastName: "RAMOS", section_id: "cmticjs7y0160rcveil8z7o7c", section_name: "Mabini", enrollment_id: "cmtjgx0i601aakcve03fieynp" },
  { student_id: "cmth7hhjf00af94ves01cpsto", firstName: "SOFIA ISABEL", lastName: "SALAZAR", section_id: "cmticjs7y0160rcveil8z7o7c", section_name: "Mabini", enrollment_id: "cmtjgx0ha019skcvehyp1tbnd" },
  { student_id: "cmth7hhjf00a494vezzc94cud", firstName: "JUAN MIGUEL", lastName: "REYES", section_id: "cmticjs800161rcveh64ms5kt", section_name: "Rizal", enrollment_id: "cmtjgx0hw019tkcveij3p2oj9" },
  { student_id: "cmtjgx0fv019akcve0n0zdeiz", firstName: "ROWENA", lastName: "ROXAS", section_id: "cmticjs800161rcveh64ms5kt", section_name: "Rizal", enrollment_id: "cmtjgx0i001a0kcvesg9by2k5" },
  { student_id: "cmtjgx0fv0198kcvenac9d3k7", firstName: "ROMEO", lastName: "ROXAS", section_id: "cmticjs800161rcveh64ms5kt", section_name: "Rizal", enrollment_id: "cmtjgx0hz019ykcvet9yi6yhl" },
  { student_id: "cmtjgx0fv0199kcvezahen3gu", firstName: "ARTHUR", lastName: "TAYAG", section_id: "cmticjs800161rcveh64ms5kt", section_name: "Rizal", enrollment_id: "cmtjgx0i0019zkcve9p07a2et" },
  { student_id: "cmtjgx0fv019bkcvehaex5y4n", firstName: "MARICEL", lastName: "TAYAG", section_id: "cmticjs800161rcveh64ms5kt", section_name: "Rizal", enrollment_id: "cmtjgx0i101a1kcve5ow4u3dm" },
];

// ─── G8 Students ─────────────────────────────────────────────────────────────
const G8_STUDENTS: StudentInfo[] = [
  { student_id: "cmth7hhjf00a594ve4ksq5jw3", firstName: "JOSE GABRIEL", lastName: "MENDOZA", section_id: "cmticjs820162rcveqiv186mr", section_name: "Maka-Diyos", enrollment_id: "cmtjgygfo01r8kcve06wyglbk" },
  { student_id: "cmth7hhjf00a794ve84c1cfza", firstName: "ANNA PATRICIA", lastName: "MENDOZA", section_id: "cmticjs820162rcveqiv186mr", section_name: "Maka-Diyos", enrollment_id: "cmtjgygfp01rakcveddnd57ls" },
  { student_id: "cmth7hhjf00a694ve3p0k6wwb", firstName: "MARIA ANGELA", lastName: "REYES", section_id: "cmticjs820162rcveqiv186mr", section_name: "Maka-Diyos", enrollment_id: "cmtjgygfo01r9kcvecu3telkp" },
  { student_id: "cmth7hhjf00aj94veq7o66267", firstName: "BEATRIZ ANNE", lastName: "DEL ROSARIO", section_id: "cmticjs840163rcve66te0w8a", section_name: "Makabansa", enrollment_id: "cmtjgy1tg01lqkcved6o81v2u" },
  { student_id: "cmth7hhjf00ah94vec7i4xfax", firstName: "PAOLO BENJAMIN", lastName: "DEL ROSARIO", section_id: "cmticjs840163rcve66te0w8a", section_name: "Makabansa", enrollment_id: "cmtjgy1tn01lykcve8xskyjjy" },
  { student_id: "cmth7hhjf00ai94veqob7oia5", firstName: "ANGELICA MAE", lastName: "DOMINGO", section_id: "cmticjs840163rcve66te0w8a", section_name: "Makabansa", enrollment_id: "cmtjgy1tr01m6kcve4e7r3ml0" },
  { student_id: "cmth7hhjf00ak94vev5o2tjip", firstName: "ANGELO RAFAEL", lastName: "GOMEZ", section_id: "cmticjs840163rcve66te0w8a", section_name: "Makabansa", enrollment_id: "cmtjgy1tl01lukcvevrtdrhqr" },
  { student_id: "cmth7hhjf00am94vezoqnz2ho", firstName: "CLARISSE JOY", lastName: "GOMEZ", section_id: "cmticjs840163rcve66te0w8a", section_name: "Makabansa", enrollment_id: "cmtjgy1tp01m2kcve2bofnvev" },
  { student_id: "cmth7hhjf00an94vek7qiem7c", firstName: "DANIELA ROSE", lastName: "JIMENEZ", section_id: "cmticjs840163rcve66te0w8a", section_name: "Makabansa", enrollment_id: "cmtjgy1tt01makcveis5gv1mr" },
  { student_id: "cmth7hhjf00ae94vepi4tio1k", firstName: "JANELLA MARIE", lastName: "FERNANDEZ", section_id: "cmticjs850164rcvegihybdp5", section_name: "Makakalikasan", enrollment_id: "cmtjgygfn01r7kcvek2r62w0w" },
  { student_id: "cmth7hhjf00ac94ve9cpno3xu", firstName: "JOHN PAOLO", lastName: "FERNANDEZ", section_id: "cmticjs850164rcvegihybdp5", section_name: "Makakalikasan", enrollment_id: "cmtjgygfm01r5kcvew5sgkbqe" },
  { student_id: "cmth7hhjf00ad94vef73a71n3", firstName: "MIGUEL ANDRE", lastName: "SALAZAR", section_id: "cmticjs850164rcvegihybdp5", section_name: "Makakalikasan", enrollment_id: "cmtjgygfn01r6kcve4cdgehmx" },
  { student_id: "cmth7hhjf00ab94velppag11a", firstName: "MARY GRACE", lastName: "CASTILLO", section_id: "cmticjs870165rcve13nmyffr", section_name: "Makatao", enrollment_id: "cmtjgygfr01rekcveboy3sqrg" },
  { student_id: "cmth7hhjf00a994vepzyl27r4", firstName: "CARLO MIGUEL", lastName: "CASTILLO", section_id: "cmticjs870165rcve13nmyffr", section_name: "Makatao", enrollment_id: "cmtjgygfr01rfkcve892ui8hb" },
];

// ─── G7 Class Assignments (ca_id → subject_code per section) ────────────────
interface ClassAssignment {
  ca_id: string;
  subject_code: string;
  subject_name: string;
}

const G7_ASSIGNMENTS: Record<string, ClassAssignment[]> = {
  "cmticjs7d015xrcve60d0693s": [
    { ca_id: "cmtiw13uw01ow0sveveknern5", subject_code: "AP7", subject_name: "Araling Panlipunan 7" },
    { ca_id: "cmtiw13wm01qa0sveem4u3338", subject_code: "ESP7", subject_name: "Edukasyon sa Pagpapakatao 7" },
    { ca_id: "cmtiw13we01q20sve58tnc17j", subject_code: "ENG7", subject_name: "English 7" },
    { ca_id: "cmtiw13x401qu0sve4h5otixu", subject_code: "FIL7", subject_name: "Filipino 7" },
    { ca_id: "cmtiw13sh01ms0sveqyls16pi", subject_code: "MAPEH7", subject_name: "MAPEH 7" },
    { ca_id: "cmtiw13xl01rc0svesdcl65ws", subject_code: "MATH7", subject_name: "Mathematics 7" },
    { ca_id: "cmtiw13y701rz0svex3qpmhva", subject_code: "SCI_BIO7", subject_name: "Science - Biology 7" },
    { ca_id: "cmtiw13zm01tf0sve6sq2eq5n", subject_code: "SCI_CHEM7", subject_name: "Science - Chemistry 7" },
    { ca_id: "cmtiw13zt01tm0svei0sdxhes", subject_code: "SCI_ES7", subject_name: "Science - Earth Science 7" },
    { ca_id: "cmtiw13t901ni0svewstcha1j", subject_code: "TLE_AFA_EXP7", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 7" },
    { ca_id: "cmtiw13ts01ns0svef6jm7b9k", subject_code: "TLE_FCS_EXP7", subject_name: "TLE Exploratory - Family and Consumer Science 7" },
    { ca_id: "cmtiw13sy01n80sveykd5089n", subject_code: "TLE_ICT_EXP7", subject_name: "TLE Exploratory - ICT 7" },
  ],
  "cmticjs7u015yrcvedhmczev0": [
    { ca_id: "cmtiw13v401p30sveb88k13xg", subject_code: "AP7", subject_name: "Araling Panlipunan 7" },
    { ca_id: "cmtiw13ww01qk0svetngonsr8", subject_code: "ESP7", subject_name: "Edukasyon sa Pagpapakatao 7" },
    { ca_id: "cmtiw13vu01pj0sve3jowjt4u", subject_code: "ENG7", subject_name: "English 7" },
    { ca_id: "cmtiw13y401rx0svedqr9h8fs", subject_code: "STE_ENV_SCI7", subject_name: "Environmental Science 7" },
    { ca_id: "cmtiw13xb01r00sve4lkn3j5h", subject_code: "FIL7", subject_name: "Filipino 7" },
    { ca_id: "cmtiw13st01n20svex1939buf", subject_code: "MAPEH7", subject_name: "MAPEH 7" },
    { ca_id: "cmtiw13xw01rm0sveh06ettcy", subject_code: "MATH7", subject_name: "Mathematics 7" },
    { ca_id: "cmtiw13yu01sl0sveblo5sxpv", subject_code: "STE_RESEARCH7", subject_name: "Research 7" },
    { ca_id: "cmtiw13yw01sn0sve8g30or6f", subject_code: "SCI_BIO7", subject_name: "Science - Biology 7" },
    { ca_id: "cmtiw13ye01s60sve4taylq44", subject_code: "SCI_CHEM7", subject_name: "Science - Chemistry 7" },
    { ca_id: "cmtiw13yj01sd0sve41u6bgoj", subject_code: "SCI_ES7", subject_name: "Science - Earth Science 7" },
    { ca_id: "cmtiw13ub01oc0svegqk7dz7d", subject_code: "TLE_AFA_EXP7", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 7" },
    { ca_id: "cmtiw13un01om0svef8t41pms", subject_code: "TLE_FCS_EXP7", subject_name: "TLE Exploratory - Family and Consumer Science 7" },
    { ca_id: "cmtiw13u201o20svepsjwpsyf", subject_code: "TLE_ICT_EXP7", subject_name: "TLE Exploratory - ICT 7" },
  ],
  "cmticjs7w015zrcve3i4sdniy": [
    { ca_id: "cmtiw13vb01pa0svecxarcy3i", subject_code: "AP7", subject_name: "Araling Panlipunan 7" },
    { ca_id: "cmtiw13wm01qb0sveu9to0o7t", subject_code: "ESP7", subject_name: "Edukasyon sa Pagpapakatao 7" },
    { ca_id: "cmtiw13w501pt0sve321xq0cf", subject_code: "ENG7", subject_name: "English 7" },
    { ca_id: "cmtiw13xg01r60sveuyccb0zq", subject_code: "FIL7", subject_name: "Filipino 7" },
    { ca_id: "cmtiw13si01mt0sveulcwbi2n", subject_code: "MAPEH7", subject_name: "MAPEH 7" },
    { ca_id: "cmtiw13xl01rd0svevw5yhd3y", subject_code: "MATH7", subject_name: "Mathematics 7" },
    { ca_id: "cmtiw13zg01t90svellj3vqjg", subject_code: "SCI_BIO7", subject_name: "Science - Biology 7" },
    { ca_id: "cmtiw13z301su0svecv5zn7bz", subject_code: "SCI_CHEM7", subject_name: "Science - Chemistry 7" },
    { ca_id: "cmtiw13z801t00sve9ez1o833", subject_code: "SCI_ES7", subject_name: "Science - Earth Science 7" },
    { ca_id: "cmtiw13ta01nj0sveaq0ifavf", subject_code: "TLE_AFA_EXP7", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 7" },
    { ca_id: "cmtiw13tt01nt0sveveezyb77", subject_code: "TLE_FCS_EXP7", subject_name: "TLE Exploratory - Family and Consumer Science 7" },
    { ca_id: "cmtiw13sz01n90svev0tgm4d6", subject_code: "TLE_ICT_EXP7", subject_name: "TLE Exploratory - ICT 7" },
  ],
  "cmticjs7y0160rcveil8z7o7c": [
    { ca_id: "cmtiw13ux01ox0svewxhziw0n", subject_code: "AP7", subject_name: "Araling Panlipunan 7" },
    { ca_id: "cmtiw13vr01pg0svev4glr3ab", subject_code: "DEVL_READING7", subject_name: "Developmental Reading 7" },
    { ca_id: "cmtiw13wy01ql0svezamr1hvf", subject_code: "ESP7", subject_name: "Edukasyon sa Pagpapakatao 7" },
    { ca_id: "cmtiw13wf01q30svea3vmvh45", subject_code: "ENG7", subject_name: "English 7" },
    { ca_id: "cmtiw13wa01pz0sveee0t5qwr", subject_code: "FIL7", subject_name: "Filipino 7" },
    { ca_id: "cmtiw13su01n30svepeifa0s7", subject_code: "MAPEH7", subject_name: "MAPEH 7" },
    { ca_id: "cmtiw13xx01rn0svedz1ueujs", subject_code: "MATH7", subject_name: "Mathematics 7" },
    { ca_id: "cmtiw13y801s00svewgg8xbwb", subject_code: "SCI_BIO7", subject_name: "Science - Biology 7" },
    { ca_id: "cmtiw13zn01tg0sveznus63sg", subject_code: "SCI_CHEM7", subject_name: "Science - Chemistry 7" },
    { ca_id: "cmtiw13zt01tn0sve06jhe3q9", subject_code: "SCI_ES7", subject_name: "Science - Earth Science 7" },
    { ca_id: "cmtiw13sf01mq0sve84sv7xgj", subject_code: "SPS_SPEC7", subject_name: "Special Program in Sports: Specialization 7" },
    { ca_id: "cmtiw13uc01od0sveqelw3frs", subject_code: "TLE_AFA_EXP7", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 7" },
    { ca_id: "cmtiw13uo01on0sve9iuu1tbx", subject_code: "TLE_FCS_EXP7", subject_name: "TLE Exploratory - Family and Consumer Science 7" },
    { ca_id: "cmtiw13u301o30sve2tdhhwg9", subject_code: "TLE_ICT_EXP7", subject_name: "TLE Exploratory - ICT 7" },
  ],
  "cmticjs800161rcveh64ms5kt": [
    { ca_id: "cmtiw13v501p40sve5k1awi0g", subject_code: "AP7", subject_name: "Araling Panlipunan 7" },
    { ca_id: "cmtiw13w201pq0svee10xckb5", subject_code: "DEVL_READING7", subject_name: "Developmental Reading 7" },
    { ca_id: "cmtiw13wn01qc0svefe2xh32j", subject_code: "ESP7", subject_name: "Edukasyon sa Pagpapakatao 7" },
    { ca_id: "cmtiw13vv01pk0sveqe2yyb7g", subject_code: "ENG7", subject_name: "English 7" },
    { ca_id: "cmtiw13wl01q90sve8ajjjwwl", subject_code: "FIL7", subject_name: "Filipino 7" },
    { ca_id: "cmtiw13si01mu0svels6my31g", subject_code: "MAPEH7", subject_name: "MAPEH 7" },
    { ca_id: "cmtiw13xm01re0sve3x5dku1g", subject_code: "MATH7", subject_name: "Mathematics 7" },
    { ca_id: "cmtiw13yx01so0svefxk0qnbt", subject_code: "SCI_BIO7", subject_name: "Science - Biology 7" },
    { ca_id: "cmtiw13yf01s70sve4w7mksxk", subject_code: "SCI_CHEM7", subject_name: "Science - Chemistry 7" },
    { ca_id: "cmtiw13yl01se0sve96c7yp2s", subject_code: "SCI_ES7", subject_name: "Science - Earth Science 7" },
    { ca_id: "cmtiw13rv01mo0sve2zb4vc8r", subject_code: "SPA_SPEC7", subject_name: "Special Program in the Arts: Specialization 7" },
    { ca_id: "cmtiw13tb01nk0svezl001ucg", subject_code: "TLE_AFA_EXP7", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 7" },
    { ca_id: "cmtiw13tu01nu0svez1wkgqwc", subject_code: "TLE_FCS_EXP7", subject_name: "TLE Exploratory - Family and Consumer Science 7" },
    { ca_id: "cmtiw13t001na0svec64eelum", subject_code: "TLE_ICT_EXP7", subject_name: "TLE Exploratory - ICT 7" },
  ],
};

// ─── G8 Class Assignments (generated per-section) ────────────────────────────
// Each G8 section has ~14-15 subjects. These ca_ids are synthetic but follow the
// same cmtiw prefix pattern. They must be present in the ClassAssignment table
// before running this script (the G8 seed or EnrollPro sync creates them).
// If your G8 ca_ids differ, replace them here.
const G8_ASSIGNMENTS: Record<string, ClassAssignment[]> = {
  "cmticjs820162rcveqiv186mr": [
    { ca_id: "cmtiw13vn01pb0svenp98pzmn", subject_code: "AP8", subject_name: "Araling Panlipunan 8" },
    { ca_id: "cmtiw13wc01q00sveuvfqufiq", subject_code: "DEVL_READING8", subject_name: "Developmental Reading 8" },
    { ca_id: "cmtiw13wz01qm0sveyf93vn9n", subject_code: "ESP8", subject_name: "Edukasyon sa Pagpapakatao 8" },
    { ca_id: "cmtiw13w501pu0sveysxu1v13", subject_code: "ENG8", subject_name: "English 8" },
    { ca_id: "cmtiw13x501qv0sveojhsq1op", subject_code: "FIL8", subject_name: "Filipino 8" },
    { ca_id: "cmtiw13sv01n40svevir901f9", subject_code: "MAPEH8", subject_name: "MAPEH 8" },
    { ca_id: "cmtiw13xx01ro0sveugg3sjw3", subject_code: "MATH8", subject_name: "Mathematics 8" },
    { ca_id: "cmtiw13zh01ta0sveftmc7v04", subject_code: "SCI_BIO8", subject_name: "Science - Biology 8" },
    { ca_id: "cmtiw13z401sv0svejz5zrija", subject_code: "SCI_CHEM8", subject_name: "Science - Chemistry 8" },
    { ca_id: "cmtiw13za01t10sveukpscg6u", subject_code: "SCI_ES8", subject_name: "Science - Earth Science 8" },
    { ca_id: "cmtiw13so01my0sveyot0ce7o", subject_code: "SPA_SPEC8", subject_name: "Special Program in the Arts: Specialization 8" },
    { ca_id: "cmtiw13ud01oe0sveuc1sddra", subject_code: "TLE_AFA_EXP8", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 8" },
    { ca_id: "cmtiw13up01oo0svecivfdyfs", subject_code: "TLE_FCS_EXP8", subject_name: "TLE Exploratory - Family and Consumer Science 8" },
    { ca_id: "cmtiw13u401o40svettpk4rjb", subject_code: "TLE_ICT_EXP8", subject_name: "TLE Exploratory - ICT 8" },
  ],
  "cmticjs840163rcve66te0w8a": [
    { ca_id: "cmtiw13uy01oy0svew4luyudv", subject_code: "AP8", subject_name: "Araling Panlipunan 8" },
    { ca_id: "cmtiw13wo01qd0sve9bljge0k", subject_code: "ESP8", subject_name: "Edukasyon sa Pagpapakatao 8" },
    { ca_id: "cmtiw13wh01q40sve96crydfg", subject_code: "ENG8", subject_name: "English 8" },
    { ca_id: "cmtiw13xc01r10sve55ii8182", subject_code: "FIL8", subject_name: "Filipino 8" },
    { ca_id: "cmtiw13sk01mv0sve964gxwft", subject_code: "MAPEH8", subject_name: "MAPEH 8" },
    { ca_id: "cmtiw13xo01rf0svegf3tkzvo", subject_code: "MATH8", subject_name: "Mathematics 8" },
    { ca_id: "cmtiw13y901s10svep05f1xvz", subject_code: "SCI_BIO8", subject_name: "Science - Biology 8" },
    { ca_id: "cmtiw13zo01th0sve3yq9buy6", subject_code: "SCI_CHEM8", subject_name: "Science - Chemistry 8" },
    { ca_id: "cmtiw13zu01to0svezalhycu9", subject_code: "SCI_ES8", subject_name: "Science - Earth Science 8" },
    { ca_id: "cmtiw13tc01nl0sve0pj4cnfm", subject_code: "TLE_AFA_EXP8", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 8" },
    { ca_id: "cmtiw13tu01nv0sveukkhej89", subject_code: "TLE_FCS_EXP8", subject_name: "TLE Exploratory - Family and Consumer Science 8" },
    { ca_id: "cmtiw13t201nb0sve1vmxq1yq", subject_code: "TLE_ICT_EXP8", subject_name: "TLE Exploratory - ICT 8" },
  ],
  "cmticjs850164rcvegihybdp5": [
    { ca_id: "cmtiw13v701p50sve8olunho6", subject_code: "AP8", subject_name: "Araling Panlipunan 8" },
    { ca_id: "cmtiw13vr01ph0svek6nesctb", subject_code: "DEVL_READING8", subject_name: "Developmental Reading 8" },
    { ca_id: "cmtiw13x001qn0sve3f7izak5", subject_code: "ESP8", subject_name: "Edukasyon sa Pagpapakatao 8" },
    { ca_id: "cmtiw13vw01pl0sveh0re08i4", subject_code: "ENG8", subject_name: "English 8" },
    { ca_id: "cmtiw13xh01r70svep3f47dbn", subject_code: "FIL8", subject_name: "Filipino 8" },
    { ca_id: "cmtiw13sw01n50sve6j9yd42f", subject_code: "MAPEH8", subject_name: "MAPEH 8" },
    { ca_id: "cmtiw13xy01rp0svemxgqtmev", subject_code: "MATH8", subject_name: "Mathematics 8" },
    { ca_id: "cmtiw13yy01sp0svetzwvo1l4", subject_code: "SCI_BIO8", subject_name: "Science - Biology 8" },
    { ca_id: "cmtiw13yf01s80svevwn8zjr4", subject_code: "SCI_CHEM8", subject_name: "Science - Chemistry 8" },
    { ca_id: "cmtiw13ym01sf0svek9d5npv1", subject_code: "SCI_ES8", subject_name: "Science - Earth Science 8" },
    { ca_id: "cmtiw13ss01n00sveihjs2jp4", subject_code: "SPS_SPEC8", subject_name: "Special Program in Sports: Specialization 8" },
    { ca_id: "cmtiw13ue01of0sved25shnhv", subject_code: "TLE_AFA_EXP8", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 8" },
    { ca_id: "cmtiw13up01op0sve7z2xbaa5", subject_code: "TLE_FCS_EXP8", subject_name: "TLE Exploratory - Family and Consumer Science 8" },
    { ca_id: "cmtiw13u601o50sve0w8l591m", subject_code: "TLE_ICT_EXP8", subject_name: "TLE Exploratory - ICT 8" },
  ],
  "cmticjs870165rcve13nmyffr": [
    { ca_id: "cmtiw13vo01pc0svep0cx7vp0", subject_code: "AP8", subject_name: "Araling Panlipunan 8" },
    { ca_id: "cmtiw13ze01t60sveribjhhxh", subject_code: "BIOTECH8", subject_name: "Biotechnology 8" },
    { ca_id: "cmtiw13wp01qe0svevrbffq6o", subject_code: "ESP8", subject_name: "Edukasyon sa Pagpapakatao 8" },
    { ca_id: "cmtiw13w601pv0sveoyq9mi2w", subject_code: "ENG8", subject_name: "English 8" },
    { ca_id: "cmtiw13x701qw0sveeqgc6d8b", subject_code: "FIL8", subject_name: "Filipino 8" },
    { ca_id: "cmtiw13sm01mw0sveaxebafy5", subject_code: "MAPEH8", subject_name: "MAPEH 8" },
    { ca_id: "cmtiw13xp01rg0sverf8h8tjv", subject_code: "MATH8", subject_name: "Mathematics 8" },
    { ca_id: "cmtiw13ze01t70svemtbftoac", subject_code: "STE_RESEARCH8", subject_name: "Research 8" },
    { ca_id: "cmtiw13zi01tb0svej4cm6fkv", subject_code: "SCI_BIO8", subject_name: "Science - Biology 8" },
    { ca_id: "cmtiw13z501sw0svebpi9vcew", subject_code: "SCI_CHEM8", subject_name: "Science - Chemistry 8" },
    { ca_id: "cmtiw13za01t20svez7x6sztc", subject_code: "SCI_ES8", subject_name: "Science - Earth Science 8" },
    { ca_id: "cmtiw13tm01nm0svesq6wpjz5", subject_code: "TLE_AFA_EXP8", subject_name: "TLE Exploratory - Agriculture and Fishery Arts 8" },
    { ca_id: "cmtiw13tv01nw0svezb7m3r4y", subject_code: "TLE_FCS_EXP8", subject_name: "TLE Exploratory - Family and Consumer Science 8" },
    { ca_id: "cmtiw13t301nc0sve87vtwdid", subject_code: "TLE_ICT_EXP8", subject_name: "TLE Exploratory - ICT 8" },
  ],
};

// ─── Remedial & Retained Students ────────────────────────────────────────────
interface SpecialStudent {
  student_id: string;
  name: string;
  section_name: string;
  failedSubjectCodes: string[];
  type: "remedial" | "retained";
}

const REMEDIAL_STUDENTS: SpecialStudent[] = [
  { student_id: "cmtjgx0fw019okcvelyai4y0h", name: "MELVIN FERNANDEZ", section_name: "Aguinaldo", failedSubjectCodes: ["MATH7", "SCI_BIO7"], type: "remedial" },
  { student_id: "cmth7hhjf00a894ve2objovga", name: "MARK ANGELO RAMOS", section_name: "Bonifacio", failedSubjectCodes: ["ENG7", "MATH7"], type: "remedial" },
  { student_id: "cmtjgx0fv019ckcvecij82689", name: "RODRIGO BALUYOT", section_name: "Luna", failedSubjectCodes: ["FIL7", "TLE_ICT_EXP7"], type: "remedial" },
  { student_id: "cmtjgx0fw019kkcveh6gf05x8", name: "DEXTER RAMOS", section_name: "Mabini", failedSubjectCodes: ["MATH7", "SCI_CHEM7"], type: "remedial" },
];

const RETAINED_STUDENTS: SpecialStudent[] = [
  { student_id: "cmth7hhjf00al94ve0jbevj3d", name: "CHRISTIAN PAUL JIMENEZ", section_name: "Aguinaldo", failedSubjectCodes: ["MATH7", "SCI_BIO7", "SCI_CHEM7"], type: "retained" },
  { student_id: "cmtjgx0fw019ikcvenvlvyhce", name: "CHERRY REYES", section_name: "Bonifacio", failedSubjectCodes: ["ENG7", "MATH7", "SCI_ES7"], type: "retained" },
  { student_id: "cmtjgx0fv019dkcveb9q3h87b", name: "ALVIN MAGSINO", section_name: "Luna", failedSubjectCodes: ["FIL7", "MATH7", "TLE_AFA_EXP7"], type: "retained" },
  { student_id: "cmtjgx0fv0198kcvenac9d3k7", name: "ROMEO ROXAS", section_name: "Rizal", failedSubjectCodes: ["MATH7", "SCI_BIO7", "SCI_CHEM7", "SCI_ES7"], type: "retained" },
];

const ALL_SPECIAL = [...REMEDIAL_STUDENTS, ...RETAINED_STUDENTS];

// ─── Score Generation ────────────────────────────────────────────────────────
function generateScores(
  rand: () => number,
  baseAbility: number,
  variance: number,
  wwCount: number,
  ptCount: number,
  isFailed: boolean,
  termIdx: number,
): { wwScores: number[]; ptScores: number[]; qaScore: number } {
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const wobble = () => (rand() - 0.5) * variance;

  let ability = baseAbility;
  if (isFailed) {
    ability = 40 + rand() * 30; // 40-70 range for failed subjects
    // Add slight downward trend across terms
    ability -= termIdx * 2;
  }

  const wwScores = Array.from({ length: wwCount }, () => clamp(ability + wobble()));
  const ptScores = Array.from({ length: ptCount }, () => clamp(ability + wobble()));
  const qaScore = clamp(ability + wobble() * 0.5);

  return { wwScores, ptScores, qaScore };
}

// ─── Term Dates ──────────────────────────────────────────────────────────────
function termDate(term: Term, createdAt: boolean): Date {
  if (createdAt) {
    if (term === "T1") return new Date("2027-10-15T08:00:00Z");
    if (term === "T2") return new Date("2028-01-20T08:00:00Z");
    return new Date("2028-04-20T08:00:00Z");
  }
  if (term === "T1") return new Date("2027-12-20T17:00:00Z");
  if (term === "T2") return new Date("2028-03-20T17:00:00Z");
  return new Date("2028-06-20T17:00:00Z");
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log("=== SMART Grade Seed Script (G7 + G8) ===\n");

  const terms: Term[] = ["T1", "T2", "T3"];
  let totalInserted = 0;
  let totalRemedial = 0;
  let totalRetained = 0;

  // Load canonical grading config from the DB so seeded grades match what the
  // app computes (class record ledger recompute + SF9/SF10 display)
  const transmute = makeTransmuter(await loadTransmutationTable());
  const resolveWeights = await loadWeightResolver();

  // Build lookup: student_id → special info
  const specialLookup = new Map<string, SpecialStudent>();
  for (const s of ALL_SPECIAL) specialLookup.set(s.student_id, s);

  // Combine all students
  const allStudents = [...G7_STUDENTS, ...G8_STUDENTS];
  // Section → assignments lookup
  const allAssignments: Record<string, ClassAssignment[]> = {
    ...G7_ASSIGNMENTS,
    ...G8_ASSIGNMENTS,
  };

  for (const term of terms) {
    console.log(`\n--- Seeding ${term} grades ---`);

    const termGrades: {
      studentId: string;
      classAssignmentId: string;
      term: Term;
      writtenWorkScores: Array<{ name: string; score: number; maxScore: number }>;
      perfTaskScores: Array<{ name: string; score: number; maxScore: number }>;
      quarterlyAssessScore: number;
      quarterlyAssessMax: number;
      writtenWorkPS: number;
      perfTaskPS: number;
      quarterlyAssessPS: number;
      initialGrade: number;
      quarterlyGrade: number;
      qualitativeDescriptor: string;
      remarks: string | null;
      status: GradeStatus;
      finalizedAt: Date;
      createdAt: Date;
      updatedAt: Date;
    }[] = [];

    for (const student of allStudents) {
      const assignments = allAssignments[student.section_id];
      if (!assignments) {
        console.warn(`  WARNING: No assignments found for section ${student.section_id} (${student.section_name})`);
        continue;
      }

      const special = specialLookup.get(student.student_id);

      // Deterministic seed per student + term
      const seedBase = hashString(student.student_id);
      const rand = seededRandom(seedBase + terms.indexOf(term) * 1000 + 7);

      // Base ability per student (deterministic from name)
      const nameHash = hashString(student.student_id + student.firstName);
      const baseAbility = 70 + (nameHash % 25); // 70-95 range

      for (const ca of assignments) {
        const subjectGroup = getSubjectGroup(ca.subject_code);
        const weights = resolveWeights(ca.subject_code);
        const isFailed = special?.failedSubjectCodes.includes(ca.subject_code) ?? false;

        const { wwScores, ptScores, qaScore } = generateScores(
          rand,
          baseAbility,
          isFailed ? 15 : 10,
          subjectGroup === "MAPEH" || subjectGroup === "TLE" ? 5 : 4,
          subjectGroup === "MAPEH" || subjectGroup === "TLE" ? 4 : 3,
          isFailed,
          terms.indexOf(term),
        );

        const { wwPS, ptPS, qaPS, initialGrade, quarterlyGrade } = computeGrade(
          wwScores,
          ptScores,
          qaScore,
          weights,
          transmute,
        );

        let remarks: string | null = null;
        if (quarterlyGrade < 75) {
          if (special?.type === "remedial") {
            remarks = "Remedial Class";
            totalRemedial++;
          } else if (special?.type === "retained") {
            remarks = "Retained";
            totalRetained++;
          } else {
            remarks = "Failed";
          }
        }

        termGrades.push({
          studentId: student.student_id,
          classAssignmentId: ca.ca_id,
          term,
          // Object form with maxScore 100 — the app's ledger expects {name, score, maxScore}
          writtenWorkScores: wwScores.map((score, i) => ({ name: `WW ${i + 1}`, score, maxScore: 100 })),
          perfTaskScores: ptScores.map((score, i) => ({ name: `PT ${i + 1}`, score, maxScore: 100 })),
          quarterlyAssessScore: qaScore,
          quarterlyAssessMax: 100,
          writtenWorkPS: Math.round(wwPS * 100) / 100,
          perfTaskPS: Math.round(ptPS * 100) / 100,
          quarterlyAssessPS: Math.round(qaPS * 100) / 100,
          initialGrade: Math.round(initialGrade * 100) / 100,
          quarterlyGrade,
          qualitativeDescriptor: getDescriptor(quarterlyGrade),
          remarks,
          status: "FINALIZED",
          finalizedAt: termDate(term, false),
          createdAt: termDate(term, true),
          updatedAt: termDate(term, false),
        });
      }
    }

    if (termGrades.length === 0) {
      console.log(`  No grades to insert for ${term}.`);
      continue;
    }

    // Batch insert with upsert (skip if exists)
    let inserted = 0;
    const BATCH_SIZE = 100;
    for (let i = 0; i < termGrades.length; i += BATCH_SIZE) {
      const batch = termGrades.slice(i, i + BATCH_SIZE);
      const result = await prisma.grade.createMany({
        data: batch.map((g) => ({
          studentId: g.studentId,
          classAssignmentId: g.classAssignmentId,
          term: g.term,
          writtenWorkScores: g.writtenWorkScores,
          perfTaskScores: g.perfTaskScores,
          quarterlyAssessScore: g.quarterlyAssessScore,
          quarterlyAssessMax: g.quarterlyAssessMax,
          writtenWorkPS: g.writtenWorkPS,
          perfTaskPS: g.perfTaskPS,
          quarterlyAssessPS: g.quarterlyAssessPS,
          initialGrade: g.initialGrade,
          quarterlyGrade: g.quarterlyGrade,
          qualitativeDescriptor: g.qualitativeDescriptor,
          remarks: g.remarks,
          status: g.status,
          finalizedAt: g.finalizedAt,
          createdAt: g.createdAt,
          updatedAt: g.updatedAt,
        })),
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    totalInserted += inserted;
    console.log(`  ${term}: ${inserted} grades inserted (${termGrades.length} attempted)`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total grades inserted: ${totalInserted}`);
  console.log(`Remedial records (failed subjects): ${totalRemedial}`);
  console.log(`Retained records (failed subjects): ${totalRetained}`);
  console.log(`Duration: ${duration}s`);
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

main()
  .catch((e) => {
    console.error("Error during grade seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
