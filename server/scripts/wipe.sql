INSERT INTO "SystemSettings" ("id", "schoolName", "schoolId", "division", "region", "currentSchoolYear", "currentTerm", "gradeLock", "transitionLock")
VALUES ('main', 'Hinigaran National High School', '300847', 'Division of Negros Occidental', 'Region VI - Western Visayas', '2025-2026', 'T1', false, false)
ON CONFLICT ("id") DO UPDATE SET
  "currentSchoolYear" = '2025-2026',
  "schoolYearId" = NULL,
  "currentTerm" = 'T1',
  "gradeLock" = false,
  "transitionLock" = false,
  "enrollproUrl" = NULL,
  "enrollproAccountName" = NULL,
  "enrollproPassword" = NULL,
  "enrollproIntegrationKey" = NULL;

SELECT count(*) AS user_count FROM "User";
SELECT count(*) AS settings_count FROM "SystemSettings";
