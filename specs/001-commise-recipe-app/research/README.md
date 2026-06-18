# Research: Commise Recipe Management Core

**Branch**: `001-commise-recipe-app` | **Date**: 2026-05-09
**Status**: Complete | **Input**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md)

---

This directory contains the Product Forge Phase 1 research artifacts for feature 001. Each file synthesizes existing SpecKit/V-Model output into a focused domain document.

## File Index

### [competitors.md](./competitors.md)

Competitive landscape for recipe management apps covering Paprika, Whisk, Mealime, Yummly, Cookpad, and Notion-recipe-templates. Includes a feature parity matrix, current pricing (2026), market gap analysis, and Commise differentiation thesis. Key finding: no consumer recipe app offers version history with 3-way merge + async SQS archival + pg_trgm/tsvector search — the primary differentiation opportunity.

### [ux-patterns.md](./ux-patterns.md)

UX pattern reference for recipe CRUD, search, versioning, sharing, and collections. Covers: master-detail list, optimistic save with ETag/If-Match, HTTP 409 conflict resolution modal, photo upload progress (presigned S3 + Lambda Sharp + CloudFront), faceted full-text search, soft-delete with 8-second undo, and collection management. Each pattern cites the relevant spec/plan section. Intended as a design and implementation reference.

### [codebase-analysis.md](./codebase-analysis.md)

Monorepo structure analysis grounded in root `package.json` and `turbo.json`. Covers: existing workspaces (`packages/tools/*`, `packages/apps/commise/web`, `packages/apps/commise/mobile`, `packages/ui`), new workspaces required (`api` for NestJS, `lambda-photos` for Sharp), TypeScript conventions, auth architecture (Clerk web + mobile), data model summary, and workspace dependency graph. Gaps flagged: no test framework declared in root, E2E approach TBD, CDK stack structure TBD.

### [tech-stack.md](./tech-stack.md)

Full technology stack rationale extracted from [research.md](../research.md) RQ-1 through RQ-9 and [plan.md](../plan.md). Sections for: NestJS on Fargate, RDS PostgreSQL 16 (tsvector GIN + pg_trgm), S3 + CloudFront + Lambda Sharp photo pipeline, SQS version-archive queue + DLQ, Clerk, Next.js 15, Expo 53, Drizzle ORM, CDK v2. Each choice includes documented trade-offs from the source artifacts. RQ-to-technology mapping table included.

### [metrics-roi.md](./metrics-roi.md)

Success metrics and ROI hypothesis. Covers: operational SLOs from NFR-008..011 (CI completeness, configurable API URLs, E2E seed data, test isolation), performance SLOs from SC-009 and plan (p95 API <= 500ms, search < 2s wall-clock, recipe save <= 500ms independent of S3 archive), cost ceiling (~$25/mo RDS launch, ~$50–80/mo at 1k MAU), and growth metrics (TBD pending product input for north-star MAU, activation, W4 retention, premium conversion rate). ROI hypothesis: 8x ROI at 5,000 MAU.

## Relationship to Other Artifacts

```
spec.md (source of truth for FR/NFR)
    ├── research.md (Phase 0 research answers RQ-1..RQ-9)
    │   └── [research/] (Product Forge Phase 1 synthesis)
    │       ├── competitors.md
    │       ├── ux-patterns.md
    │       ├── codebase-analysis.md
    │       ├── tech-stack.md
    │       └── metrics-roi.md
    ├── plan.md (implementation plan, tech decisions)
    ├── data-model.md (schema, indexes, versioning)
    ├── findings.md (additional findings, if present)
    └── v-model/
        ├── requirements.md (REQ-xxx, REQ-NF-xxx)
        ├── system-design.md
        ├── acceptance-plan.md
        └── ... other V-Model artifacts
```

## What Is Grounded vs. TBD

| Artifact                              | Status                    | Notes                                              |
| ------------------------------------- | ------------------------- | -------------------------------------------------- |
| Competitor pricing and feature parity | Grounded                  | App store data + MyMealTicket blog (2026-04-14)    |
| Market gaps                           | Grounded                  | Consistent across all six competitors              |
| Differentiation thesis                | Grounded                  | Version history + conflict UI + SQS archival       |
| UX patterns                           | Grounded                  | From spec.md, plan.md, research.md                 |
| Codebase analysis                     | Grounded                  | Verified against root `package.json`, `turbo.json` |
| Tech stack rationale                  | Grounded                  | RQ-1..RQ-9 fully answered in research.md           |
| Latency SLOs                          | Grounded                  | SC-009, plan performance goals                     |
| Cost ceiling                          | Grounded                  | ~$25/mo RDS from data-model.md                     |
| Growth metrics (MAU, activation, W4)  | TBD pending product input | Not defined in existing artifacts                  |
| Premium conversion rate               | TBD pending product input | Industry estimate only                             |
| Test framework (unit/integration)     | TBD                       | Plan references Vitest but no root config          |
