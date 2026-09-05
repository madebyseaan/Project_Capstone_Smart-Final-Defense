---
description: Generate planning prompt for GPT-5.6 Sol
---

Read AGENTS.md for project context and file map. Then ask: "What feature do you want to plan?"

After user answers:

1. Use glob/grep to find relevant files for this feature
2. Read the relevant files (3-5 files max)
3. Check if docs/ directory exists for similar past plans
4. Generate this prompt for the user to copy-paste into GPT-5.6 Sol:

```markdown
# Planning Prompt for GPT-5.6 Sol

## Feature
$ARGUMENTS

## Tech Stack
- Frontend: React 19, Vite, React Router, React Query, Tailwind CSS, shadcn/ui
- Backend: Node.js, Express 5, Prisma (PostgreSQL), ts-node-dev
- Three roles: TEACHER, ADMIN, REGISTRAR

## Relevant Files

[Include the files you read, with path and contents]

## Past Plans (if any)
[Include links to similar past plans in docs/ directory]

## Constraints
- Do not modify .env files
- Do not write to external systems (EnrollPro/ATLAS)
- Max 1000 lines per file
- Use existing React Query patterns
- Use zod for validation

## Output Format
1. FILES: (file path — what to create/modify)
2. FLOW: (data flow diagram)
3. EDGES: (edge cases)
4. ORDER: (implementation steps)
```

Tell user: "Copy the above prompt and paste it into GPT-5.6 Sol. Then paste the plan it returns back to me."

After user pastes plan back:

5. Save the plan to docs/[feature-name].md with timestamp
6. Tell user: "Plan saved to docs/[feature-name].md"
