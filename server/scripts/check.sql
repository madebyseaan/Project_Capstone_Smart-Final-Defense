-- 1. Grading configs
SELECT "subjectType", "writtenWorkWeight", "performanceTaskWeight", "quarterlyAssessWeight" FROM "GradingConfig";

-- 2. Transmutation table
SELECT "minGrade", "maxGrade", "transmutedGrade" FROM "TransmutationEntry" ORDER BY "minGrade" DESC;

-- 3. All G7 students with their enrollments
SELECT st.id AS student_id, st."firstName", st."lastName", st.lrn,
       s.id AS section_id, s.name AS section_name, e.id AS enrollment_id
FROM "Student" st
JOIN "Enrollment" e ON st.id = e."studentId"
JOIN "Section" s ON e."sectionId" = s.id
WHERE s."schoolYear" = '2027-2028' AND s."gradeLevel" = 'GRADE_7'
ORDER BY s.name, st."lastName";

-- 4. All G8 students with their enrollments
SELECT st.id AS student_id, st."firstName", st."lastName", st.lrn,
       s.id AS section_id, s.name AS section_name, e.id AS enrollment_id
FROM "Student" st
JOIN "Enrollment" e ON st.id = e."studentId"
JOIN "Section" s ON e."sectionId" = s.id
WHERE s."schoolYear" = '2027-2028' AND s."gradeLevel" = 'GRADE_8'
ORDER BY s.name, st."lastName";

-- 5. Class assignments for G7 (teacher -> subject -> section mapping)
SELECT ca.id AS ca_id, ca."schoolYear",
       s.id AS section_id, s.name AS section_name, s."gradeLevel",
       sub.id AS subject_id, sub.name AS subject_name, sub.code AS subject_code,
       t.id AS teacher_id, u."firstName" || ' ' || u."lastName" AS teacher_name
FROM "ClassAssignment" ca
JOIN "Section" s ON ca."sectionId" = s.id
JOIN "Subject" sub ON ca."subjectId" = sub.id
JOIN "Teacher" t ON ca."teacherId" = t.id
JOIN "User" u ON t."userId" = u.id
WHERE ca."schoolYear" = '2027-2028' AND s."gradeLevel" = 'GRADE_7'
ORDER BY s.name, sub.name;

-- 6. Class assignments for G8
SELECT ca.id AS ca_id, ca."schoolYear",
       s.id AS section_id, s.name AS section_name, s."gradeLevel",
       sub.id AS subject_id, sub.name AS subject_name, sub.code AS subject_code,
       t.id AS teacher_id, u."firstName" || ' ' || u."lastName" AS teacher_name
FROM "ClassAssignment" ca
JOIN "Section" s ON ca."sectionId" = s.id
JOIN "Subject" sub ON ca."subjectId" = sub.id
JOIN "Teacher" t ON ca."teacherId" = t.id
JOIN "User" u ON t."userId" = u.id
WHERE ca."schoolYear" = '2027-2028' AND s."gradeLevel" = 'GRADE_8'
ORDER BY s.name, sub.name;

-- 7. Subjects list
SELECT id, name, code FROM "Subject" ORDER BY name;
