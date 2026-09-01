DELETE FROM "Section" WHERE "gradeLevel" != 'GRADE_7';

-- Also clean up any orphaned enrollments, class assignments, etc.
DELETE FROM "Enrollment" WHERE "sectionId" NOT IN (SELECT id FROM "Section");
DELETE FROM "ClassAssignment" WHERE "sectionId" NOT IN (SELECT id FROM "Section");

SELECT id, name, "gradeLevel", "schoolYear" FROM "Section" ORDER BY name;
