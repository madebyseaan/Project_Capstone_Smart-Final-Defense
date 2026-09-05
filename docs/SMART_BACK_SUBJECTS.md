# SMART Integration: Learner Subject Deficiencies (Back Subjects)

Last reviewed: 2026-09-02

## Overview and Intent

EnrollPro owns learner identity, enrollment, official section placement, and tracks subject deficiencies for learners who have been conditionally promoted. The SMART AI requires visibility into which learners hold active back subjects to correctly ingest and process grades, learning-area results, and outcomes for those specific subjects.

This API contract defines how the SMART system can query EnrollPro to retrieve a comprehensive list of learners who currently possess subject deficiencies.

## API Endpoint (Proposed Contract)

EnrollPro will expose the following endpoint for the SMART system to pull the deficiency list:

```text
GET /api/v1/integration/smart/back-subjects
```

**Query Parameters:**
- `schoolYear` (string, optional): The target school year label (e.g., `2028-2029`). If omitted, EnrollPro defaults to the current active school year.
- `lrn` (string, optional): A 12-digit Learner Reference Number to fetch deficiencies for a specific learner.

## Authentication

SMART must authenticate its request by providing the shared integration key in the HTTP headers:
```text
X-Integration-Key: <configured-smart-integration-key>
```
EnrollPro will reject unauthorized requests with a `401 Unauthorized` status.

## Payload Structure & Exclusions

The response payload provides a list of learners and their respective subject deficiencies.

**Crucial Constraint:** The payload **must explicitly exclude** the `sectionToEnroll` field (or any reference to the class section the learner is assigned to in order to clear the deficiency). The SMART AI only needs to be aware of the learner's identity and the specific subject(s) they failed, not the logistical enrollment details of where they will take the class.

### Example Response Payload

```json
{
  "success": true,
  "data": [
    {
      "lrn": "202700000006",
      "firstName": "LEAH",
      "middleName": "L.",
      "lastName": "BALUYOT",
      "deficiencies": [
        {
          "subjectCode": "FIL7",
          "subjectName": "FILIPINO 7",
          "gradeLevel": "Grade 7",
          "finalRating": 74
        }
      ]
    },
    {
      "lrn": "202600000007",
      "firstName": "MARY GRACE",
      "middleName": "A.",
      "lastName": "CASTILLO",
      "deficiencies": [
        {
          "subjectCode": "MATH8",
          "subjectName": "MATHEMATICS 8",
          "gradeLevel": "Grade 8",
          "finalRating": 72
        },
        {
          "subjectCode": "SCI8",
          "subjectName": "SCIENCE 8",
          "gradeLevel": "Grade 8",
          "finalRating": 74
        }
      ]
    }
  ]
}
```

## Error Handling

- **`400 Bad Request`**: If the `schoolYear` parameter is malformed.
- **`401 Unauthorized`**: If the `X-Integration-Key` header is missing or incorrect.
- **`500 Internal Server Error`**: If EnrollPro encounters a system failure while fetching the data.
