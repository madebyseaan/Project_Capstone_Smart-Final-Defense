# ROLLOVER_READINESS_PLAN.md

**Last Updated:** 2026-08-26
**Status:** ✅ ALL DONE

---

## What This Document Covers

1. **EOSY Grade Finalization** — ✅ DONE
2. **School Year Rollover** — In progress

---

## How SMART and EnrollPro Work Together

- **EnrollPro** is the boss — it decides the school year, students, teachers, sections
- **SMART** listens — it syncs every 5 minutes and copies what EnrollPro says
- **SMART gives back** — grades and SF forms (report cards, permanent records)
- **When EnrollPro rolls over** — SMART automatically picks up the new year on next sync

---

## Part A: EOSY Grade Finalization ✅ DONE

Registrar can now:
- Finalize grades (locks them from teacher edits)
- See the adviser for each section
- View each student's grades in a popup

---

## Part B: School Year Rollover

### The Problem
SMART had its own "Rollover" button that was accidentally clicked. It archived all old data and created a new school year locally. But EnrollPro is supposed to do that, not SMART.

### The Fix

**Cluster 1:** Remove SMART's rollover button
- SMART shouldn't create school years — EnrollPro does that
- Remove the button and endpoint

**Cluster 2:** Fix report cards for old years
- After archiving, report cards (SF9, SF5, SF6) stopped working for past years
- Fix the queries so they still work with archived data

**Cluster 3:** Add "Sync for New SY" button
- After EnrollPro rolls over, admin clicks this button
- SMART syncs and picks up the new year data

---

## What Data Stays After Archiving

Everything stays. Nothing is deleted.

| What | Stays? |
|---|---|
| Grades | ✅ Yes |
| Students | ✅ Yes |
| Sections | ✅ Yes |
| Teachers | ✅ Yes |
| Attendance | ✅ Yes |
| Adviser info | ✅ Yes |
| Subjects | ✅ Yes |

The "archived" flag just prevents editing. The data is still there for generating report cards and permanent records.

---

## Execution Plan

### Cluster 1: Remove SMART's Rollover Button
- ✅ Removed POST /admin/rollover endpoint
- ✅ Removed GET /admin/rollover-readiness endpoint
- ✅ Removed rolloverSchema from schemas
- **Time:** ~15 minutes

### Cluster 2: Fix Report Cards for Old Years
- ✅ Fixed SF9 (Report Card) — removed isActive filter
- ✅ Fixed SF5 (Promotion Report) — removed isActive filter
- ✅ Fixed SF6 (Summary Report) — removed isActive filter
- SF10 (Permanent Record) — already works, no fix needed
- **Time:** ~20 minutes

### Cluster 3: Add "Sync for New SY" Button
- ✅ "Sync from EnrollPro" button already exists in System Settings
- ✅ "Run Sync Now" button already exists in System Health
- Admin clicks either button after EnrollPro rolls over
- **Time:** ~15 minutes

---

## Total Time: ~50 minutes

| Cluster | Time | Status |
|---|---|---|
| Part A: EOSY | 2 hours | ✅ Done |
| Cluster 1: Remove rollover | 15 min | ✅ Done |
| Cluster 2: Fix report cards | 20 min | ✅ Done |
| Cluster 3: Sync button | 15 min | ✅ Done (already exists) |

## Cleanup Done

- ✅ Removed `POST /admin/rollover` endpoint
- ✅ Removed `GET /admin/rollover-readiness` endpoint
- ✅ Removed `rolloverSchema` from admin schemas
- ✅ Fixed SF9/SF5/SF6 queries to work with archived data
- ✅ Verified "Sync from EnrollPro" button exists
