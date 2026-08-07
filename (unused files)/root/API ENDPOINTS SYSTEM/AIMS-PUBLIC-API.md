# AIMS REST API Reference

**Base URL:** `http://<host>:5000/api/v1`  
**Tailscale host:** `100.92.245.14`  
**Auth:** All protected endpoints require `Authorization: Bearer <token>` — the JWT issued by `POST /auth/login`.  
**Content-Type:** `application/json` (unless noted as `multipart/form-data`)  
**Response envelope:** Every response is wrapped in `{ success: boolean, data: <T> }`. Errors return `{ success: false, error: string }`.  
**Multi-tenant:** All data is scoped to the school configured in the server's `SCHOOL_ID` environment variable. External integrations only see data for their school.

---

## Health

### `GET /health`
Service liveness probe. No auth required.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

```json
{ "success": true, "data": { "status": "ok" } }
```

---

## Authentication

### `POST /auth/register`
Create a new user account. Email verification is sent automatically.

| | |
|---|---|
| **Auth** | None |
| **Success** | `201 Created` |

**Request body:**
```json
{
  "email": "user@school.edu",
  "password": "SecurePass1",
  "firstName": "Juan",
  "lastName": "Dela Cruz",
  "role": "STUDENT"
}
```
> `role` accepts `STUDENT`, `TEACHER`, or `ADMIN`.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Registration successful. Please verify your email."
  }
}
```

---

### `POST /auth/login`
Authenticate and receive access + refresh tokens.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

**Request body:**
```json
{
  "email": "teacher@gmail.com",
  "password": "teacher123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "2001afe4-3ecf-419e-9e60-a5d146ce83da",
      "email": "teacher@gmail.com",
      "firstName": "Teacher",
      "lastName": "One",
      "role": "TEACHER",
      "emailVerified": true,
      "googleSub": null,
      "googleEmail": null,
      "googleName": null,
      "googlePicture": null
    },
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>"
  }
}
```
> `accessToken` expires in 15 minutes. Use `POST /auth/refresh` to rotate.

---

### `POST /auth/refresh`
Exchange a refresh token for a new access token.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

**Request body:**
```json
{ "refreshToken": "<jwt>" }
```

**Response:**
```json
{
  "success": true,
  "data": { "accessToken": "<jwt>" }
}
```

---

### `POST /auth/logout`
Invalidate the current session.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

### `GET /auth/me`
Return the authenticated user's profile.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "2001afe4-3ecf-419e-9e60-a5d146ce83da",
      "email": "teacher@gmail.com",
      "firstName": "Teacher",
      "lastName": "One",
      "role": "TEACHER",
      "emailVerified": true,
      "googleSub": null,
      "googleEmail": null,
      "googleName": null,
      "googlePicture": null
    }
  }
}
```

---

### `GET /auth/verify-email?token=<token>`
Verify email address from the link sent during registration.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` |

---

### `POST /auth/resend-verification`
Resend the email verification link.

| | |
|---|---|
| **Auth** | None |

**Request body:** `{ "email": "user@school.edu" }`

---

## School

### `GET /school`
Get the current school's profile.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "school": {
      "id": "school-a",
      "name": "First School Name",
      "shortName": "FSN",
      "logoUrl": null,
      "primaryColor": "#2563eb",
      "secondaryColor": "#7c3aed",
      "accentColor": "#0891b2",
      "address": null,
      "contactEmail": null,
      "isActive": true,
      "createdAt": "2026-04-12T18:15:13.613Z",
      "updatedAt": "2026-04-12T18:15:13.613Z"
    }
  }
}
```

---

### `PUT /school`
Update school name, address, and contact info.

| | |
|---|---|
| **Auth** | Required — `ADMIN` only |
| **Success** | `200 OK` |

**Request body (all fields optional):**
```json
{
  "name": "Rizal National High School",
  "shortName": "RNHS",
  "address": "Calamba City, Laguna",
  "contactEmail": "info@rnhs.edu.ph"
}
```

---

### `PUT /school/colors`
Update the school's theme colors.

| | |
|---|---|
| **Auth** | Required — `ADMIN` only |
| **Success** | `200 OK` |

**Request body:**
```json
{
  "primaryColor": "#1e40af",
  "secondaryColor": "#6d28d9",
  "accentColor": "#0891b2"
}
```

---

### `POST /school/logo`
Upload or replace the school logo. Max 2 MB; PNG, JPG, JPEG, or WebP.

| | |
|---|---|
| **Auth** | Required — `ADMIN` only |
| **Content-Type** | `multipart/form-data` |
| **Field** | `logo` (file) |
| **Success** | `200 OK` |

---

### `DELETE /school/logo`
Remove the school logo.

| | |
|---|---|
| **Auth** | Required — `ADMIN` only |
| **Success** | `200 OK` |

---

## Courses

### `GET /courses`
List courses for the authenticated user. Teachers see their own courses; students see their enrolled courses.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "courses": [
      {
        "id": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
        "name": "Grade 12 - Mabini",
        "description": "Phase 33 seeded course",
        "code": "AIMS-201",
        "subject": "Animation",
        "subjectType": "TLE",
        "gradeLevel": "Grade 12",
        "schoolYear": "2024-2025",
        "color": "#ca8a04",
        "softLockEnabled": false,
        "passingThreshold": 70,
        "archived": false,
        "schoolId": "school-a",
        "teacherId": "2001afe4-3ecf-419e-9e60-a5d146ce83da",
        "createdAt": "2026-04-12T18:15:15.202Z",
        "updatedAt": "2026-04-22T08:33:15.776Z",
        "studentCount": 2,
        "activeQuizCount": 2
      }
    ]
  }
}
```

---

### `POST /courses`
Create a new course.

| | |
|---|---|
| **Auth** | Required — `TEACHER` or `ADMIN` |
| **Success** | `201 Created` |

**Request body:**
```json
{
  "name": "Grade 10 - Rizal",
  "subject": "Mathematics",
  "subjectType": "CORE",
  "gradeLevel": "Grade 10",
  "schoolYear": "2025-2026",
  "description": "Optional. Supports weight tags: [WW_WEIGHT:30] [PT_WEIGHT:70]",
  "color": "#2563eb"
}
```
> Grade weights default to WW=30%, PT=70%. Override by embedding `[WW_WEIGHT:n]` and `[PT_WEIGHT:n]` tags anywhere in `description`.

---

### `POST /courses/join`
Enroll a student using the course code.

| | |
|---|---|
| **Auth** | Required — `STUDENT` only |
| **Success** | `200 OK` |

**Request body:**
```json
{ "code": "AIMS-201" }
```

---

### `GET /courses/:id`
Get a single course by ID.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

### `GET /courses/:id/classwork`
Get the classwork view — quizzes, resources, and tasks grouped by topic.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "courseId": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
    "totalStudents": 2,
    "topics": [
      {
        "id": "cmnw33bmb0003bvu85y519zj5",
        "name": "Quarter 1",
        "orderIndex": 0,
        "quizzes": [
          {
            "id": "932ea499-4b99-4e7d-b59d-b583b05fa640",
            "title": "Test Quiz",
            "status": "PUBLISHED",
            "passingThreshold": 70,
            "isAIGenerated": false,
            "requiresReview": false,
            "createdAt": "2026-04-12T18:15:15.202Z",
            "questionCount": 5,
            "submittedCount": 1
          }
        ],
        "resources": [
          {
            "id": "edb4f64b-0964-4abf-88d7-72df7ea69a59",
            "title": "Lesson 1 Notes",
            "description": "Introduction to the topic",
            "fileType": "pdf",
            "fileSize": 204800,
            "youtubeUrl": null,
            "linkUrl": null,
            "uploadedAt": "2026-04-12T19:56:01.328Z"
          }
        ],
        "tasks": [
          {
            "id": "8af41140-e787-4ceb-815d-edbe219c34f1",
            "title": "Test YouTube Task",
            "taskType": "ASSIGNMENT",
            "points": 50,
            "dueDate": null,
            "status": "PUBLISHED",
            "createdAt": "2026-04-12T20:10:49.160Z"
          }
        ]
      }
    ]
  }
}
```

---

### `GET /courses/:id/students`
List all students enrolled in a course.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

### `GET /courses/:id/stream`
Get the announcement stream for a course.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

### `PUT /courses/:id`
Update course details.

| | |
|---|---|
| **Auth** | Required — `TEACHER` or `ADMIN` |
| **Success** | `200 OK` |

---

### `DELETE /courses/:id`
Delete a course and all associated content.

| | |
|---|---|
| **Auth** | Required — `TEACHER` or `ADMIN` |
| **Success** | `200 OK` |

---

### `PUT /courses/:id/archive`
Archive (or unarchive) a course.

| | |
|---|---|
| **Auth** | Required — `TEACHER` or `ADMIN` |
| **Success** | `200 OK` |

**Request body:** `{ "archived": true }`

---

## Quizzes

### `GET /quizzes/course/:courseId`
List quizzes for a course. Teachers see all statuses; students see only `PUBLISHED` quizzes.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "quizzes": [
      {
        "id": "932ea499-4b99-4e7d-b59d-b583b05fa640",
        "title": "Test Quiz from CreateQuizPage",
        "description": null,
        "courseId": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
        "teacherId": "2001afe4-3ecf-419e-9e60-a5d146ce83da",
        "status": "PUBLISHED",
        "passingScore": 70,
        "passingThreshold": 70,
        "timeLimit": null,
        "isRemedial": false,
        "topicId": null,
        "createdAt": "2026-04-12T18:15:15.202Z",
        "updatedAt": "2026-04-12T18:15:15.202Z",
        "questions": [
          {
            "id": "q-uuid",
            "text": "What is 2 + 2?",
            "choices": ["2", "3", "4", "5"],
            "orderIndex": 0
          }
        ]
      }
    ]
  }
}
```

---

### `POST /quizzes/generate`
AI-generate a quiz from an uploaded file (PDF, DOCX, TXT) or text.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Content-Type** | `multipart/form-data` |
| **Success** | `201 Created` |

**Fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `courseId` | string | Yes | Target course UUID |
| `title` | string | Yes | Quiz title |
| `questionCount` | number | No | Number of questions (default: 10) |
| `difficulty` | string | No | `easy`, `medium`, or `hard` |
| `file` | file | No | Source document (PDF/DOCX/TXT, max 10 MB) |
| `sourceText` | string | No | Paste raw text instead of uploading a file |

---

### `POST /quizzes/create`
Manually create a quiz with pre-defined questions.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `201 Created` |

**Request body:**
```json
{
  "courseId": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
  "title": "Q1 Summative",
  "description": "Optional description",
  "passingScore": 75,
  "timeLimit": 30,
  "questions": [
    {
      "text": "What is photosynthesis?",
      "choices": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Option C",
      "orderIndex": 0
    }
  ]
}
```

---

### `PATCH /quizzes/:id/publish`
Publish or unpublish a quiz.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

**Request body:** `{ "status": "PUBLISHED" }` or `{ "status": "DRAFT" }`

---

### `GET /quizzes/:id`
Get a quiz by ID including all questions.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

### `PUT /quizzes/:id`
Update quiz metadata or questions.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

---

### `DELETE /quizzes/:id`
Delete a quiz.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

---

## Submissions

### `POST /submissions/start`
Start a quiz attempt. Returns an in-progress submission record.

| | |
|---|---|
| **Auth** | Required — `STUDENT` |
| **Success** | `201 Created` |

**Request body:**
```json
{ "quizId": "932ea499-4b99-4e7d-b59d-b583b05fa640" }
```

**Response:**
```json
{
  "success": true,
  "data": {
    "submission": {
      "id": "sub-uuid",
      "quizId": "932ea499-4b99-4e7d-b59d-b583b05fa640",
      "userId": "student-uuid",
      "status": "IN_PROGRESS",
      "startedAt": "2026-04-22T10:00:00.000Z",
      "submittedAt": null,
      "score": null
    }
  }
}
```

---

### `POST /submissions/:id/submit`
Submit answers for a quiz attempt.

| | |
|---|---|
| **Auth** | Required — `STUDENT` |
| **Success** | `200 OK` |

**Request body:**
```json
{
  "answers": [
    { "questionId": "q-uuid-1", "answerText": "Option C" },
    { "questionId": "q-uuid-2", "answerText": "Option A" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "submission": {
      "id": "sub-uuid",
      "status": "GRADED",
      "score": 80,
      "submittedAt": "2026-04-22T10:15:00.000Z"
    }
  }
}
```

---

### `GET /submissions/quiz/:quizId`
Get all submissions for a quiz.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

---

### `GET /submissions/my`
Get the authenticated student's submission history.

| | |
|---|---|
| **Auth** | Required — `STUDENT` |
| **Success** | `200 OK` |

---

### `GET /submissions/:id`
Get a single submission by ID.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

## Tasks

### `POST /tasks/course/:courseId`
Create a task (written work or performance task).

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Content-Type** | `multipart/form-data` |
| **Success** | `201 Created` |

**Fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Task name |
| `instructions` | string | No | Task instructions |
| `taskType` | string | Yes | `WRITTEN_WORK` or `PERFORMANCE_TASK` |
| `points` | number | Yes | Max points (determines grade weight) |
| `dueDate` | ISO string | No | Due date/time |
| `topicId` | string | No | Assign to a topic |
| `youtubeUrl` | string | No | Reference YouTube video |
| `linkUrl` | string | No | External reference link |
| `file` | file | No | Attachment |

> `WRITTEN_WORK` maps to DepEd WW category. `PERFORMANCE_TASK` maps to PT.

---

### `GET /tasks/course/:courseId`
List all tasks for a course.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "8af41140-e787-4ceb-815d-edbe219c34f1",
        "title": "Test YouTube Task",
        "instructions": null,
        "taskType": "ASSIGNMENT",
        "points": 50,
        "dueDate": null,
        "topicId": null,
        "courseId": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
        "teacherId": "2001afe4-3ecf-419e-9e60-a5d146ce83da",
        "status": "PUBLISHED",
        "createdAt": "2026-04-12T20:10:49.160Z",
        "updatedAt": "2026-04-12T20:10:49.160Z",
        "linkUrl": "https://example.com/notes",
        "youtubeUrl": null
      }
    ]
  }
}
```

---

### `GET /tasks/:id`
Get a single task by ID.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

### `PUT /tasks/:id`
Update a task.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Content-Type** | `multipart/form-data` |
| **Success** | `200 OK` |

---

### `DELETE /tasks/:id`
Delete a task.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

---

### `POST /tasks/:id/submit`
Submit a task (student file/link submission).

| | |
|---|---|
| **Auth** | Required — `STUDENT` |
| **Content-Type** | `multipart/form-data` |
| **Success** | `201 Created` |

**Fields:** `file` (optional), `linkUrl` (optional)

---

### `GET /tasks/:id/my-submission`
Get the authenticated student's submission for a task.

| | |
|---|---|
| **Auth** | Required — `STUDENT` |
| **Success** | `200 OK` |

---

### `POST /tasks/submissions/:submissionId/grade`
Grade a student's task submission.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

**Request body:**
```json
{ "grade": 45, "feedback": "Good work, but needs more detail." }
```

---

## Resources

### `GET /resources/course/:courseId`
List all learning materials for a course.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "resources": [
      {
        "id": "edb4f64b-0964-4abf-88d7-72df7ea69a59",
        "title": "Test Posted Material",
        "description": "test desc",
        "fileName": null,
        "fileType": null,
        "fileSize": null,
        "storageBackend": "LOCAL",
        "uploadedAt": "2026-04-12T19:56:01.328Z",
        "youtubeUrl": null,
        "linkUrl": null
      }
    ]
  }
}
```

---

### `GET /resources/:id/file`
Download or stream a resource file. **No auth required** — use this URL to embed or link materials.

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` — binary file stream |

---

### `POST /resources/course/:courseId`
Upload a new learning resource.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Content-Type** | `multipart/form-data` |
| **Success** | `201 Created` |

**Fields:** `title` (string), `description` (string, optional), `youtubeUrl` (string, optional), `linkUrl` (string, optional), `file` (file, optional)

---

### `GET /resources/:id`
Get a single resource by ID.

| | |
|---|---|
| **Auth** | Required |
| **Success** | `200 OK` |

---

### `PUT /resources/:id`
Update a resource record.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

---

### `DELETE /resources/:id`
Delete a resource.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

---

## Dashboard

### `GET /dashboard/student`
Get the authenticated student's performance summary across all enrolled courses.

| | |
|---|---|
| **Auth** | Required — `STUDENT` |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "totalQuizzesTaken": 3,
    "averageScore": 82.5,
    "passRate": 66.67,
    "recentSubmissions": [
      {
        "submissionId": "sub-uuid",
        "quizId": "quiz-uuid",
        "quizTitle": "Q1 Summative",
        "courseName": "Grade 12 - Mabini",
        "score": 85,
        "passed": true,
        "isRemedial": false,
        "submittedAt": "2026-04-22T10:15:00.000Z"
      }
    ],
    "resourcesViewed": 5,
    "remedialQuizzesTaken": 0,
    "coursesCount": 3,
    "remedialPending": 1,
    "courses": [
      {
        "courseId": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
        "courseName": "Grade 12 - Mabini",
        "subject": "Animation",
        "color": "#ca8a04",
        "averageScore": 82.5,
        "completedQuizzes": 2,
        "totalPublishedQuizzes": 3,
        "passedCount": 1,
        "failedCount": 1,
        "pendingQuizzes": [
          { "id": "quiz-uuid", "title": "Q2 Quiz", "isRemedial": false }
        ],
        "depedDescriptor": "Very Satisfactory"
      }
    ]
  }
}
```

> **DepEd descriptors:** Outstanding ≥90 · Very Satisfactory ≥85 · Satisfactory ≥80 · Fairly Satisfactory ≥75 · Did Not Meet Expectations <75

---

### `GET /dashboard/teacher`
Get the teacher's school-wide overview.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "totalStudents": 7,
    "totalResources": 11,
    "totalQuizzes": 6,
    "averageClassScore": 78.4,
    "lowPerformingStudents": [
      {
        "userId": "student-uuid",
        "name": "Juan Dela Cruz",
        "averageScore": 62.5
      }
    ],
    "recentActivity": [
      {
        "id": "log-uuid",
        "userId": "student-uuid",
        "action": "SUBMITTED_QUIZ",
        "resourceId": null,
        "metadata": { "score": 20, "quizId": "quiz-uuid" },
        "createdAt": "2026-04-13T08:14:09.159Z"
      }
    ]
  }
}
```

> `action` values: `STARTED_QUIZ`, `SUBMITTED_QUIZ`, `VIEWED_RESOURCE`

---

### `GET /dashboard/course/:id`
Get a single course overview (enrollment count, quiz stats, per-quiz average).

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "course": {
      "id": "4adeb111-7c78-49dd-bae3-e6721825b4a9",
      "name": "Grade 12 - Mabini",
      "code": "AIMS-201"
    },
    "enrollmentCount": 2,
    "resourceCount": 1,
    "quizCount": 5,
    "averageScore": 78.4,
    "submissionsByQuiz": [
      {
        "quizId": "quiz-uuid",
        "quizTitle": "Q1 Summative",
        "submissionCount": 12,
        "averageScore": 81.25
      }
    ]
  }
}
```

---

### `GET /dashboard/course/:id/gradebook`
**Primary integration endpoint for Class Records.** Returns the full DepEd-format gradebook for a course — all students, all assessments (quizzes + tasks), per-category averages, and weighted quarterly grades.

| | |
|---|---|
| **Auth** | Required — `TEACHER` |
| **Success** | `200 OK` |

**Response:**
```json
{
  "success": true,
  "data": {
    "assessments": [
      {
        "id": "TASK:8af41140-e787-4ceb-815d-edbe219c34f1",
        "sourceId": "8af41140-e787-4ceb-815d-edbe219c34f1",
        "title": "Test YouTube Task",
        "type": "TASK",
        "category": "WW",
        "maxPoints": 50
      },
      {
        "id": "QUIZ:932ea499-4b99-4e7d-b59d-b583b05fa640",
        "sourceId": "932ea499-4b99-4e7d-b59d-b583b05fa640",
        "title": "Q1 Summative",
        "type": "QUIZ",
        "category": "WW",
        "maxPoints": 100
      },
      {
        "id": "TASK:582dc64e-80b6-498a-ad49-5a6f6fe9fe45",
        "sourceId": "582dc64e-80b6-498a-ad49-5a6f6fe9fe45",
        "title": "Performance Task 1",
        "type": "TASK",
        "category": "PT",
        "maxPoints": 100
      }
    ],
    "weights": {
      "ww": 30,
      "pt": 70
    },
    "rows": [
      {
        "userId": "80fddb9a-9809-47bd-9e22-bfb9e344df5d",
        "name": "Juan Dela Cruz",
        "email": "student1@school.edu",
        "googlePicture": null,
        "scores": [
          { "assessmentId": "TASK:8af41140-e787-4ceb-815d-edbe219c34f1", "score": 88 },
          { "assessmentId": "QUIZ:932ea499-4b99-4e7d-b59d-b583b05fa640", "score": 76 },
          { "assessmentId": "TASK:582dc64e-80b6-498a-ad49-5a6f6fe9fe45", "score": null }
        ],
        "categoryAverages": {
          "ww": 82,
          "pt": null
        },
        "initialGrade": 82,
        "quarterlyGrade": 82,
        "average": 82
      }
    ]
  }
}
```

> **Assessment ID format:** `"QUIZ:<uuid>"` for quiz scores (0–100), `"TASK:<uuid>"` for task scores (normalized to 0–100 percentage of max points).  
> **Weights:** Default WW=30, PT=70. Override by embedding `[WW_WEIGHT:n] [PT_WEIGHT:n]` in the course description.  
> **Quarterly grade formula:**  
> $Q = \frac{WW_{avg} \times w_{ww} + PT_{avg} \times w_{pt}}{w_{ww} + w_{pt}}$  
> Only categories with at least one graded submission are included in the weighted average.  
> **Category mapping:** Quizzes → WW. Tasks with `taskType=WRITTEN_WORK` → WW. Tasks with `taskType=PERFORMANCE_TASK` → PT.

---

## Static Files

### `GET /files/:filename`
### `GET /uploads/:filename`
Serve uploaded files (logos, resource attachments, task submissions).

| | |
|---|---|
| **Auth** | None |
| **Success** | `200 OK` — binary stream |

> Use the `logoUrl`, `filePath`, or `storageUrl` fields returned from other endpoints to construct the correct file URL.

---

## Error Responses

All errors follow the same envelope:

```json
{ "success": false, "error": "Human-readable error message" }
```

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request — missing or invalid fields |
| `401` | Unauthorized — missing or expired token |
| `403` | Forbidden — insufficient role |
| `404` | Not found |
| `409` | Conflict — e.g. email already registered |
| `500` | Internal server error |

---

## Quick Reference

| Endpoint | Auth | Role |
|---|---|---|
| `GET /health` | None | — |
| `POST /auth/login` | None | — |
| `POST /auth/register` | None | — |
| `POST /auth/refresh` | None | — |
| `GET /auth/me` | Bearer | Any |
| `GET /school` | Bearer | Any |
| `PUT /school` | Bearer | ADMIN |
| `GET /courses` | Bearer | Any |
| `POST /courses` | Bearer | TEACHER/ADMIN |
| `POST /courses/join` | Bearer | STUDENT |
| `GET /courses/:id/classwork` | Bearer | Any |
| `GET /quizzes/course/:courseId` | Bearer | Any |
| `POST /quizzes/generate` | Bearer | TEACHER |
| `POST /submissions/start` | Bearer | STUDENT |
| `POST /submissions/:id/submit` | Bearer | STUDENT |
| `GET /submissions/quiz/:quizId` | Bearer | TEACHER |
| `GET /tasks/course/:courseId` | Bearer | Any |
| `POST /tasks/course/:courseId` | Bearer | TEACHER |
| `POST /tasks/submissions/:id/grade` | Bearer | TEACHER |
| `GET /resources/:id/file` | None | — |
| `GET /dashboard/student` | Bearer | STUDENT |
| `GET /dashboard/teacher` | Bearer | TEACHER |
| `GET /dashboard/course/:id/gradebook` | Bearer | TEACHER |
