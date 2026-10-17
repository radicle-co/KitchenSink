# Peer Review — architecture-design

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-09 | **Re-reviewed**: 2026-08-02
**Artifact**: `architecture-design.md` (25 architecture modules)
**Standard**: IEEE 42010 / Kruchten 4+1; `CLAUDE.md` design-pattern-first

## Summary

| Severity           | Count        |
| ------------------ | ------------ |
| Critical           | 0            |
| Major              | 0            |
| Minor              | 1 (resolved) |
| Observation        | 3            |
| **Total Findings** | **4**        |

**Verdict**: ✅ Pass — the single MINOR finding is resolved.

## Findings

### PRF-006-16 · MINOR — The batch endpoint path diverges from platform convention · ✅ RESOLVED

The Interface View originally specified `POST /api/v1/recipes/nutrition:batch`. No shipped route in this platform uses a colon action
suffix (`/api/v1/recipes/{id}/clone`, `/api/v1/foods/search`, `/api/v1/recipes/{id}/visibility` are all plain segments). IEEE 42010
§5.4 treats interface consistency as an architectural property, and a URL is an expensive-to-reverse wire contract.
**Disposition (2026-08-02)**: **resolved** by the recipe service's owner — settled on `POST /api/v1/recipes/nutrition-batch` and applied across all ten references. The endpoint had no clients yet, so this was the cheapest possible moment to align it.

### OBSERVATION — Every module names its pattern, and three name a pattern as _already satisfied_

`CLAUDE.md` item 1 permits "pattern intent already satisfied by a language/library feature" as using the pattern. The
document does this in three places — discriminated union + exhaustive switch **is** Visitor; TanStack mutations **are**
Command; `.native.tsx` resolution **is** Strategy selection — and explicitly declines to add registries or strategy
machinery for them. That is the intended reading of the rule, and recording it prevents a later reviewer "adding the
missing pattern".

### OBSERVATION — The deleted-module table is the most useful part of the document

Nine modules are listed with the reason each was deleted. This matters more than usual here because several were
plausible: a nutrition cache and a USDA adapter are exactly what an engineer would reach for without knowing that
`recipe-core` already computes per-serving nutrition. Without the table, someone re-adds `ARCH-017` in six months.

### OBSERVATION — ARCH-015's properties are justified individually

Each of the Gateway's six disciplines carries the specific failure it prevents (`Promise.race` leaking sockets, a
boolean flattening `degraded`, unthrottled logging burying the incident signal). Kruchten's Process View asks for
concurrency and synchronization to be stated; stating _why_ each is chosen is what makes the module reviewable rather
than merely described.

## Verification performed

- All 9 Phase-1 SYS components have ≥ 1 ARCH module (100% forward coverage).
- No ARCH module lacks a SYS parent — 0 derived modules.
- Every module's target package matches the `CODING_STANDARDS §5.1` platform/product split.
- The Development View's naming regimes match `§1a`/`§1b` for each package.
- The Physical View's listener priority (400) and bands (50000/60000) are disjoint from food and recipe — cross-checked
  against `RecipeServiceStack.ts`.
