import http from 'http';
import https from 'https';
import { prisma } from './prisma';
import {
  getEnrollProSections,
  getEnrollProSectionStudents,
  getEnrollProTeachers,
  resolveEnrollProSchoolYear,
} from './enrollproClient';
import { resolveAtlasSchoolYear, DEFAULT_ATLAS_SCHOOL_YEAR_ID, fetchEffectiveTeachingLoad, ATLAS_SCHOOL_ID } from './sync/httpClient';
import { getCachedEffectiveTeachingLoad } from './syncCache';

import { getAtlasSchoolId } from '../config/schoolEnv';
const ATLAS_BASE_URL = (process.env.ATLAS_URL ?? process.env.ATLAS_BASE_URL ?? 'https://njgrm.buru-degree.ts.net/api/v1').replace(/\/$/, '');
const ATLAS_SCHOOL_ID_LOCAL = getAtlasSchoolId();

export interface TeacherDashboardSnapshot {
  teacher: {
    smartTeacherId: string;
    employeeId: string;
    name: string;
    email: string | null;
  };
  sourceMeta: {
    schoolYearLabel: string;
    enrollproSchoolYearId: number;
    atlasSchoolYearId: number;
    generatedAt: string;
  };
  advisory: {
    section: {
      id: number;
      name: string;
      gradeLevel: string | null;
    } | null;
    students: Array<{
      lrn: string;
      firstName: string;
      lastName: string;
      status: string;
    }>;
  };
  classRecords: Array<{
    recordKey: string;
    source: {
      atlasFacultyId: number | null;
      atlasAssignmentId: string | null;
      enrollproSectionId: number;
    };
    subject: {
      code: string;
      name: string;
      type: string | null;
    };
    section: {
      id: number;
      name: string;
      gradeLevel: string | null;
      schoolYear: string;
    };
    students: Array<{
      lrn: string;
      firstName: string;
      lastName: string;
    }>;
  }>;
  warnings: string[];
}

type AtlasFaculty = {
  id: number;
  externalId?: number | null;
  employeeId?: string | number | null;
  contactInfo?: string | null;
};

type AtlasAssignment = {
  id?: string | number | null;
  subjectCode?: string | null;
  subject?: { code?: string | null; name?: string | null; type?: string | null } | null;
  sectionId?: number | null;
  section?: { id?: number | null; name?: string | null } | null;
  sections?: Array<{ id?: number | null; name?: string | null }> | null;
};

function fetchJSON(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode ?? 0} from ${url}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`JSON parse error from ${url}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.end();
  });
}

async function fetchAtlasFaculty(atlasToken: string): Promise<AtlasFaculty[]> {
  const result = await fetchJSON(`${ATLAS_BASE_URL}/faculty?schoolId=${ATLAS_SCHOOL_ID_LOCAL}`, {
    Authorization: `Bearer ${atlasToken}`,
  });
  return (result?.faculty ?? []) as AtlasFaculty[];
}

async function fetchAtlasAssignments(atlasFacultyId: number, atlasToken: string): Promise<AtlasAssignment[]> {
  try {
    const resolvedAtlasSY = await resolveAtlasSchoolYear();
    const atlasSchoolYearId = resolvedAtlasSY.id;

    // Read from cached effective teaching load (ATLAS contract-compliant)
    let effectiveLoad = getCachedEffectiveTeachingLoad(ATLAS_SCHOOL_ID, atlasSchoolYearId) ?? undefined;
    if (!effectiveLoad) {
      effectiveLoad = (await fetchEffectiveTeachingLoad(atlasSchoolYearId)) ?? undefined;
    }

    if (!effectiveLoad || effectiveLoad.source.state === 'EMPTY') {
      return [];
    }

    // Filter assignments for this faculty member and map to AtlasAssignment format
    const facultyAssignments = effectiveLoad.assignments.filter(
      (a) => Number(a.facultyId) === atlasFacultyId,
    );

    return facultyAssignments.map((a) => ({
      id: null,
      subjectCode: String(a.subjectId),
      subject: { code: String(a.subjectId), name: a.specializationLabel ?? null, type: null },
      sectionId: a.sectionId,
      section: { id: a.sectionId, name: null },
      sections: [{ id: a.sectionId, name: null }],
    }));
  } catch {
    return [];
  }
}

export async function buildTeacherDashboardSnapshot(params: {
  smartTeacherId: string;
  employeeId: string;
  email: string;
}): Promise<TeacherDashboardSnapshot> {
  const atlasToken = process.env.ATLAS_SYSTEM_TOKEN;
  if (!atlasToken) {
    throw new Error('ATLAS_SYSTEM_TOKEN not set');
  }

  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'main' },
    select: { currentSchoolYear: true },
  });
  const resolvedSY = await resolveEnrollProSchoolYear(settings?.currentSchoolYear);
  const resolvedAtlasSY = await resolveAtlasSchoolYear();

  const [epTeachers, epSections, atlasFaculty] = await Promise.all([
    getEnrollProTeachers(),
    getEnrollProSections(),
    fetchAtlasFaculty(atlasToken),
  ]);

  const epTeacher = epTeachers.find((teacher) => teacher.employeeId === params.employeeId);
  const advisorySection = epTeacher
    ? epSections.find((section) => section.advisingTeacher?.id === epTeacher.id)
    : null;

  const [advisoryStudents, atlasFacultyRecord] = await Promise.all([
    advisorySection ? getEnrollProSectionStudents(advisorySection.id, resolvedSY.id) : Promise.resolve([]),
    Promise.resolve(
      atlasFaculty.find(
        (faculty) =>
          String(faculty.employeeId ?? '').trim() === String(params.employeeId).trim() ||
          faculty.externalId === epTeacher?.id ||
          faculty.contactInfo?.toLowerCase() === params.email.toLowerCase(),
      ) ?? null,
    ),
  ]);

  const atlasAssignments = atlasFacultyRecord
    ? await fetchAtlasAssignments(atlasFacultyRecord.id, atlasToken)
    : [];

  const sectionCache = new Map<number, Promise<Awaited<ReturnType<typeof getEnrollProSectionStudents>>>>();
  const classRecords: TeacherDashboardSnapshot['classRecords'] = [];
  const warnings: string[] = [];

  for (const assignment of atlasAssignments) {
    const sectionCandidates = assignment.sections?.length
      ? assignment.sections
      : assignment.sectionId
        ? [{ id: assignment.sectionId, name: assignment.section?.name ?? '' }]
        : [];

    for (const candidate of sectionCandidates) {
      if (!candidate.id) continue;
      if (!sectionCache.has(candidate.id)) {
        sectionCache.set(candidate.id, getEnrollProSectionStudents(candidate.id, resolvedSY.id));
      }

      const roster = await sectionCache.get(candidate.id)!;
      const sourceSection = epSections.find((section) => section.id === candidate.id);
      if (!sourceSection) {
        warnings.push(`EnrollPro section ${candidate.id} not found while stitching ATLAS assignment`);
        continue;
      }

      classRecords.push({
        recordKey: `${params.smartTeacherId}:${atlasFacultyRecord?.id ?? 'na'}:${candidate.id}:${assignment.subject?.code ?? assignment.subjectCode ?? 'unknown'}`,
        source: {
          atlasFacultyId: atlasFacultyRecord?.id ?? null,
          atlasAssignmentId: assignment.id ? String(assignment.id) : null,
          enrollproSectionId: candidate.id,
        },
        subject: {
          code: (assignment.subject?.code ?? assignment.subjectCode ?? '').toUpperCase(),
          name: assignment.subject?.name ?? 'Unknown Subject',
          type: assignment.subject?.type ?? null,
        },
        section: {
          id: sourceSection.id,
          name: sourceSection.name,
          gradeLevel: sourceSection.gradeLevelName,
          schoolYear: resolvedSY.yearLabel,
        },
        students: roster.map((student) => ({
          lrn: student.lrn,
          firstName: student.firstName,
          lastName: student.lastName,
        })),
      });
    }
  }

  return {
    teacher: {
      smartTeacherId: params.smartTeacherId,
      employeeId: params.employeeId,
      name: epTeacher ? `${epTeacher.firstName} ${epTeacher.lastName}`.trim() : params.email,
      email: epTeacher?.email ?? params.email,
    },
    sourceMeta: {
      schoolYearLabel: resolvedSY.yearLabel,
      enrollproSchoolYearId: resolvedSY.id,
      atlasSchoolYearId: resolvedAtlasSY.id,
      generatedAt: new Date().toISOString(),
    },
    advisory: {
      section: advisorySection
        ? { id: advisorySection.id, name: advisorySection.name, gradeLevel: advisorySection.gradeLevelName }
        : null,
      students: advisoryStudents.map((student) => ({
        lrn: student.lrn,
        firstName: student.firstName,
        lastName: student.lastName,
        status: 'ENROLLED',
      })),
    },
    classRecords,
    warnings,
  };
}