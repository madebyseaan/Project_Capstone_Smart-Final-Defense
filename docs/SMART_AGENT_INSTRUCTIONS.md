# SMART Integration: Implement Service-Level SF10 Grades Endpoint

Hello SMART AI Agent! EnrollPro currently needs service-level access to fetch permanent academic records (SF10) for students. The required endpoint is documented in `ENROLLPRO_SF10_HANDOFF.md` but has not yet been implemented in the SMART codebase. 

Currently, when EnrollPro requests this endpoint, SMART returns a 200 OK with the HTML fallback for your frontend SPA. This breaks EnrollPro's data fetch.

Please implement this missing endpoint according to the following requirements:

## 1. Routes to Add

Add the following routes to `server/src/routes/integration.ts` (or the equivalent integration routes file):

```typescript
GET /api/integration/smart/students/:studentId/sf10-grades
GET /api/integration/students/:studentId/sf10-grades
```

## 2. Authentication

The endpoint MUST use **service-level API key** authentication via the `serviceAuth` middleware. Do not use the Registrar JWT auth for this endpoint.

The endpoint must check for the `X-EnrollPro-API-Key` header and validate it against your system's `ENROLLPRO_API_KEY` (or equivalent).

## 3. Parameter Handling (`:studentId`)

**CRITICAL:** EnrollPro queries this endpoint by passing the student's **Learner Reference Number (LRN)** in the URL, not the SMART internal UUID. 
Your implementation must look up the student by matching the provided `:studentId` parameter against the `lrn` field in your database.

It should also support filtering by the `schoolYear` query parameter if provided.

## 4. Response Schema

When a student is found, return a `200 OK` with the exact JSON structure below:

```json
{
  "success": true,
  "student": {
    "id": "clxyz...",
    "lrn": "202600000016",
    "firstName": "Angelo Rafael",
    "lastName": "Gomez",
    "middleName": "Domingo",
    "nameExtension": "",
    "gender": "Male",
    "birthDate": "2013-12-31T00:00:00.000Z"
  },
  "schoolRecords": [
    {
      "schoolYear": "2024-2025",
      "gradeLevel": "GRADE_7",
      "section": "Aguinaldo",
      "adviserName": "Dela Cruz Juan",
      "subjectGrades": [
        {
          "subjectCode": "FIL7",
          "subjectName": "Filipino",
          "T1": 99,
          "T2": 100,
          "T3": 99,
          "final": 99,
          "remarks": "Passed"
        }
      ],
      "generalAverage": 99,
      "honors": "With Highest Honors",
      "promotionStatus": "Promoted"
    }
  ],
  "schoolSettings": {
    "schoolName": "Hinigaran National High School",
    "schoolId": "123456"
  }
}
```

If the student (LRN) is not found, return a `404 Not Found` with an appropriate error message in JSON format.

Please implement this right away to unblock the EnrollPro synchronization.
