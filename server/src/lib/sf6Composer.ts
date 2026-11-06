import { prisma } from "./prisma";
import { mergeRotationSubjects, PASSING_GRADE, type SubjectTermInput } from "./promotion";
import { getSchoolIdentityForYear, type SchoolIdentity } from "./schoolSettingsSnapshot";

export type Sf6DescriptorKey = "DNME" | "FS" | "S" | "VS" | "O";
export type Sf6StatusKey = "promoted" | "conditional" | "retained" | "noGrades";

export interface Sf6StatusCounts {
  promoted: number;
  conditional: number;
  retained: number;
  noGrades: number;
}

export interface Sf6DescriptorCounts {
  male: number;
  female: number;
  total: number;
}

export type Sf6Descriptors = Record<Sf6DescriptorKey, Sf6DescriptorCounts>;

export interface Sf6SectionResult {
  sectionId: string;
  sectionName: string;
  gradeLevel: string;
  program: string;
  adviser: string | null;
  totalStudents: number;
  promoted: number;
  conditional: number;
  retained: number;
  dropped: number;
  transferred: number;
  noGrades: number;
  promotionRate: number;
  male: Sf6StatusCounts;
  female: Sf6StatusCounts;
  descriptors: Sf6Descriptors;
}

export interface Sf6GradeAggregate {
  total: number;
  promoted: number;
  conditional: number;
  retained: number;
  dropped: number;
  transferred: number;
  noGrades: number;
  male: Sf6StatusCounts;
  female: Sf6StatusCounts;
  descriptors: Sf6Descriptors;
}

export interface Sf6Summary {
  totalStudents: number;
  promoted: number;
  conditional: number;
  retained: number;
  dropped: number;
  transferred: number;
  noGrades: number;
  gradedStudents: number;
  overallPromotionRate: number;
  male: Sf6StatusCounts;
  female: Sf6StatusCounts;
  descriptors: Sf6Descriptors;
}

export interface Sf6Data {
  schoolYear: string;
  schoolSettings: SchoolIdentity;
  sections: Sf6SectionResult[];
  byGradeLevel: Record<string, Sf6GradeAggregate>;
  summary: Sf6Summary;
}

const GRADE_ORDER = ["GRADE_7", "GRADE_8", "GRADE_9", "GRADE_10"];

function createStatusCounts(): Sf6StatusCounts {
  return { promoted: 0, conditional: 0, retained: 0, noGrades: 0 };
}

function createDescriptors(): Sf6Descriptors {
  return {
    DNME: { male: 0, female: 0, total: 0 },
    FS: { male: 0, female: 0, total: 0 },
    S: { male: 0, female: 0, total: 0 },
    VS: { male: 0, female: 0, total: 0 },
    O: { male: 0, female: 0, total: 0 },
  };
}

function addStatusCounts(target: Sf6StatusCounts, source: Sf6StatusCounts): void {
  target.promoted += source.promoted;
  target.conditional += source.conditional;
  target.retained += source.retained;
  target.noGrades += source.noGrades;
}

function addDescriptors(target: Sf6Descriptors, source: Sf6Descriptors): void {
  for (const key of Object.keys(source) as Sf6DescriptorKey[]) {
    target[key].male += source[key].male;
    target[key].female += source[key].female;
    target[key].total += source[key].total;
  }
}

function genderBucket(raw: string | null | undefined): "male" | "female" | "unknown" {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "MALE" || value === "M") return "male";
  if (value === "FEMALE" || value === "F") return "female";
  return "unknown";
}

function descriptorFor(generalAverage: number | null): Sf6DescriptorKey | null {
  if (generalAverage === null) return null;
  if (generalAverage >= 90) return "O";
  if (generalAverage >= 85) return "VS";
  if (generalAverage >= 80) return "S";
  if (generalAverage >= 75) return "FS";
  return "DNME";
}

export async function composeSF6(schoolYear: string): Promise<Sf6Data> {
  const [sections, schoolSettings] = await Promise.all([
    prisma.section.findMany({
      where: { schoolYear },
      include: { adviser: { include: { user: true } } },
      orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
    }),
    getSchoolIdentityForYear(schoolYear),
  ]);

  const sectionResults: Sf6SectionResult[] = [];
  const byGradeLevel: Record<string, Sf6GradeAggregate> = {};

  for (const section of sections) {
    const [enrollments, classAssignments, grades] = await Promise.all([
      prisma.enrollment.findMany({
        where: { sectionId: section.id, schoolYear },
        include: { student: true },
      }),
      prisma.classAssignment.findMany({
        where: { sectionId: section.id, schoolYear },
        include: { subject: true },
      }),
      prisma.grade.findMany({
        where: { classAssignment: { sectionId: section.id, schoolYear } },
        include: { classAssignment: { include: { subject: true } } },
      }),
    ]);

    const statusCounts = createStatusCounts();
    const maleCounts = createStatusCounts();
    const femaleCounts = createStatusCounts();
    const descriptors = createDescriptors();
    let dropped = 0;
    let transferred = 0;

    for (const enrollment of enrollments) {
      if (enrollment.status === "DROPPED") {
        dropped += 1;
        continue;
      }
      if (enrollment.status === "TRANSFERRED") {
        transferred += 1;
        continue;
      }

      const studentGrades = grades.filter((grade) => grade.studentId === enrollment.studentId);

      const rotationInputs: SubjectTermInput[] = classAssignments
        .filter((assignment) => !assignment.subject.code.toUpperCase().startsWith("HG"))
        .map((assignment) => {
          const assignmentGrades = studentGrades.filter(
            (grade) => grade.classAssignmentId === assignment.id
          );
          const terms: Record<string, number | null> = { T1: null, T2: null, T3: null };
          for (const grade of assignmentGrades) {
            if (grade.quarterlyGrade !== null && !terms[grade.term]) {
              terms[grade.term] = grade.quarterlyGrade;
            }
          }
          return {
            subjectCode: assignment.subject.code,
            subjectName: assignment.subject.displayName ?? assignment.subject.name,
            T1: terms.T1,
            T2: terms.T2,
            T3: terms.T3,
            rotationTermGroupId: assignment.subject.rotationTermGroupId ?? null,
            rotationTermRank: assignment.subject.rotationTermRank ?? null,
            rotationOutputLabel: assignment.subject.rotationOutputLabel ?? null,
          };
        });

      const mergedSubjects = mergeRotationSubjects(rotationInputs);
      const subjectFinals: number[] = mergedSubjects
        .map((row) => {
          const termValues = [row.T1, row.T2, row.T3].filter((value): value is number => value !== null);
          return termValues.length > 0
            ? Math.round(termValues.reduce((sum, value) => sum + value, 0) / termValues.length)
            : null;
        })
        .filter((value): value is number => value !== null);

      const failingCount = subjectFinals.filter((value) => value < PASSING_GRADE).length;
      const generalAverage = subjectFinals.length > 0
        ? Math.round(subjectFinals.reduce((sum, value) => sum + value, 0) / subjectFinals.length)
        : null;

      let status: Sf6StatusKey;
      if (subjectFinals.length === 0) {
        status = "noGrades";
      } else if (failingCount === 0) {
        status = "promoted";
      } else if (failingCount <= 2) {
        status = "conditional";
      } else {
        status = "retained";
      }

      statusCounts[status] += 1;

      const profileSnapshot = enrollment.profileSnapshot as { gender?: string } | null;
      const gender = genderBucket(profileSnapshot?.gender ?? enrollment.student.gender);
      if (gender === "male") maleCounts[status] += 1;
      if (gender === "female") femaleCounts[status] += 1;

      const descriptor = descriptorFor(generalAverage);
      if (descriptor) {
        descriptors[descriptor].total += 1;
        if (gender === "male") descriptors[descriptor].male += 1;
        if (gender === "female") descriptors[descriptor].female += 1;
      }
    }

    const totalStudents = enrollments.length;
    const promotionRate = totalStudents > 0
      ? Math.round((statusCounts.promoted / totalStudents) * 100)
      : 0;

    const sectionResult: Sf6SectionResult = {
      sectionId: section.id,
      sectionName: section.name,
      gradeLevel: section.gradeLevel,
      program: section.program || "REGULAR",
      adviser: section.adviser
        ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}`
        : null,
      totalStudents,
      promoted: statusCounts.promoted,
      conditional: statusCounts.conditional,
      retained: statusCounts.retained,
      dropped,
      transferred,
      noGrades: statusCounts.noGrades,
      promotionRate,
      male: maleCounts,
      female: femaleCounts,
      descriptors,
    };

    sectionResults.push(sectionResult);

    const gradeLevel = section.gradeLevel;
    if (!byGradeLevel[gradeLevel]) {
      byGradeLevel[gradeLevel] = {
        total: 0,
        promoted: 0,
        conditional: 0,
        retained: 0,
        dropped: 0,
        transferred: 0,
        noGrades: 0,
        male: createStatusCounts(),
        female: createStatusCounts(),
        descriptors: createDescriptors(),
      };
    }

    const gradeAggregate = byGradeLevel[gradeLevel];
    gradeAggregate.total += totalStudents;
    gradeAggregate.promoted += statusCounts.promoted;
    gradeAggregate.conditional += statusCounts.conditional;
    gradeAggregate.retained += statusCounts.retained;
    gradeAggregate.dropped += dropped;
    gradeAggregate.transferred += transferred;
    gradeAggregate.noGrades += statusCounts.noGrades;
    addStatusCounts(gradeAggregate.male, maleCounts);
    addStatusCounts(gradeAggregate.female, femaleCounts);
    addDescriptors(gradeAggregate.descriptors, descriptors);
  }

  sectionResults.sort((a, b) => {
    const gradeDifference = GRADE_ORDER.indexOf(a.gradeLevel) - GRADE_ORDER.indexOf(b.gradeLevel);
    return gradeDifference !== 0 ? gradeDifference : a.sectionName.localeCompare(b.sectionName);
  });

  const summaryStatus = createStatusCounts();
  const summaryMale = createStatusCounts();
  const summaryFemale = createStatusCounts();
  const summaryDescriptors = createDescriptors();
  let totalStudents = 0;
  let dropped = 0;
  let transferred = 0;

  for (const section of sectionResults) {
    totalStudents += section.totalStudents;
    dropped += section.dropped;
    transferred += section.transferred;
    summaryStatus.promoted += section.promoted;
    summaryStatus.conditional += section.conditional;
    summaryStatus.retained += section.retained;
    summaryStatus.noGrades += section.noGrades;
    addStatusCounts(summaryMale, section.male);
    addStatusCounts(summaryFemale, section.female);
    addDescriptors(summaryDescriptors, section.descriptors);
  }

  const summary: Sf6Summary = {
    totalStudents,
    promoted: summaryStatus.promoted,
    conditional: summaryStatus.conditional,
    retained: summaryStatus.retained,
    dropped,
    transferred,
    noGrades: summaryStatus.noGrades,
    gradedStudents: summaryStatus.promoted + summaryStatus.conditional + summaryStatus.retained,
    overallPromotionRate: totalStudents > 0
      ? Math.round((summaryStatus.promoted / totalStudents) * 100)
      : 0,
    male: summaryMale,
    female: summaryFemale,
    descriptors: summaryDescriptors,
  };

  return {
    schoolYear,
    schoolSettings,
    sections: sectionResults,
    byGradeLevel,
    summary,
  };
}
