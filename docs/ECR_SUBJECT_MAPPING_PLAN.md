# ECR Subject Mapping & Implementation Plan

## Overview
This document outlines the strategy for mapping subjects from **EnrollPro/Atlas** to the available **Electronic Class Record (ECR)** templates in `server/uploads/ecr-templates/`. Since some subjects are specialized (STE, Sports, Arts), they must be routed to the most relevant standard DepEd template.

## 1. Available ECR Templates
Location: `server/uploads/ecr-templates/`

*   `GRADE 7-10_ARALING PANLIPUNAN.xlsx`
*   `GRADE 7-10_EDUKASYON SA PAGPAPAKATAO.xlsx`
*   `GRADE 7-10_ENGLISH.xlsx`
*   `GRADE 7-10_FILIPINO.xlsx`
*   `GRADE 7-10_MATHEMATICS.xlsx`
*   `GRADE 7-10_SCIENCE.xlsx`
*   `GRADE 7-10_MAPEH [QUARTER].xlsx`
*   `GRADE 7-10_TLE.xlsx` / `GRADE 7-10_HOME ECONOMICS.xlsx`

## 2. Subject Mapping Strategy

### Core Subjects (Direct Mapping)
| EnrollPro Subject | Atlas Code | Target ECR Template |
| :--- | :--- | :--- |
| Araling Panlipunan | `AP` | `ARALING PANLIPUNAN.xlsx` |
| English | `ENG` | `ENGLISH.xlsx` |
| ESP/GMRC | `ESP` | `EDUKASYON SA PAGPAPAKATAO.xlsx` |
| Filipino | `FIL` | `FILIPINO.xlsx` |
| Mathematics | `MATH` | `MATHEMATICS.xlsx` |
| Science | `SCI_*` | `SCIENCE.xlsx` |
| MAPEH | `MAPEH` | `MAPEH [QUARTER].xlsx` |
| TLE Exploratory | `TLE_*` | `TLE.xlsx` |

### Specialized Subjects (Fell-back Mapping)
| Specialization | Subjects | Target ECR Template | Rationale |
| :--- | :--- | :--- | :--- |
| **STE (Science)** | `STE_RESEARCH`, `STE_ENV_SCI`, `STE_BIOTECH`, `STE_ROBOTICS`, etc. | `SCIENCE.xlsx` | High alignment with Science grading components. |
| **SPS (Sports)** | `SPS_SPEC` | `MAPEH [QUARTER].xlsx` | Physical Education focus. |
| **SPA (Arts)** | `SPA_SPEC` | `MAPEH [QUARTER].xlsx` | Arts/Music focus within MAPEH components. |
| **Reading** | `DEVL_READING` | `ENGLISH.xlsx` | Literacy and Language arts focus. |
| **Guidance** | `HG` (Homeroom) | `EDUKASYON SA PAGPAPAKATAO.xlsx` | Values/Character focus. |

## 3. Implementation Logic (Draft)

To handle this in the backend, we can use a lookup table or a normalization function in the `ecrService` or similar.

```typescript
function getTemplateForSubject(subjectCode: string): string {
  // 1. Check for STE prefix
  if (subjectCode.startsWith('STE_')) return 'GRADE 7-10_SCIENCE.xlsx';
  
  // 2. Check for SPA/SPS (Sports/Arts)
  if (subjectCode.startsWith('SPA_') || subjectCode.startsWith('SPS_')) {
    return 'GRADE 7-10_MAPEH 1ST QUARTER.xlsx'; // Or dynamic by quarter
  }

  // 3. Mapping Table
  const mapping: Record<string, string> = {
    'AP': 'GRADE 7-10_ARALING PANLIPUNAN.xlsx',
    'ENG': 'GRADE 7-10_ENGLISH.xlsx',
    'DEVL_READING': 'GRADE 7-10_ENGLISH.xlsx',
    'ESP': 'GRADE 7-10_EDUKASYON SA PAGPAPAKATAO.xlsx',
    'HG': 'GRADE 7-10_EDUKASYON SA PAGPAPAKATAO.xlsx',
    'FIL': 'GRADE 7-10_FILIPINO.xlsx',
    'MATH': 'GRADE 7-10_MATHEMATICS.xlsx',
    'MAPEH': 'GRADE 7-10_MAPEH 1ST QUARTER.xlsx',
  };

  if (subjectCode.startsWith('SCI_')) return 'GRADE 7-10_SCIENCE.xlsx';
  if (subjectCode.startsWith('TLE_')) return 'GRADE 7-10_TLE.xlsx';

  return mapping[subjectCode] || 'GRADE 7-10_SUMMARY FINAL GRADES.xlsx';
}
```

## 4. Next Steps
1. [ ] Create a `ECR_MAPPING.md` or similar for permanent reference. (Current step)
2. [ ] Identify if "Home Economics" template should be used vs general "TLE" for specific codes.
3. [ ] Verify if MAPEH needs to switch templates automatically based on the current quarter.
4. [ ] Implement the template selection logic in the ECR import/generation script.
