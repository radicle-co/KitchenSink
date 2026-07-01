# Wireframes: Source-Agnostic Food Data Integration

**Branch**: `003-usda-food-data`
**Date**: 2026-05-09
**Updated**: 2026-06-22 — re-baselined to the **source-agnostic food data model**: users add foods **by name**; foods are golden records keyed by an internal `id` and merged across multiple sources with **per-field source provenance**; the `PENDING → (UNRESOLVED) → RESOLVED / NOT_FOUND / FAILED` lifecycle replaces the old `fetch_status`; `fdcId` and cache-hit/miss framing are removed; USDA is **one source among many**.
**Status**: Draft
**Source**: [product-spec.md](../product-spec.md), [spec.md](../../spec.md)

---

## Index

| File                                                 | Description                                                                                                 | Key FRs / Stories                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [food-search.md](./food-search.md)                   | Search-by-name over the local store; add-by-name on a miss with the PENDING state and NOT_FOUND copy        | FR-008, FR-009, FR-010, US-2                            |
| [candidate-resolution.md](./candidate-resolution.md) | **NEW** — the UNRESOLVED state: pick from candidate matches across sources, then resolve to a golden record | US-2a, FR-RES-1, FR-RES-2, FR-RES-3, FR-MRG-2, FR-MRG-3 |
| [food-detail.md](./food-detail.md)                   | Golden-record detail view with **per-field source provenance** and branded/generic badge                    | FR-002, FR-007, FR-028, US-2a                           |
| [ingredient-picker.md](./ingredient-picker.md)       | Recipe ingredient rows with matched / pending / needs-review / not-found / failed state handling            | FR-003, FR-004, FR-011, FR-013, FR-033                  |
| [nutrition-panel.md](./nutrition-panel.md)           | Nutritional breakdown from golden records (per-field provenance), totals over resolved ingredients only     | FR-002, FR-028, SC-008                                  |
| [food-substitution.md](./food-substitution.md)       | Side-by-side substitute chooser comparing golden records (source-agnostic)                                  | FR-008, FR-010, FR-033 (warning-tracked)                |

---

## Lifecycle Key (source-agnostic model)

A food added by name moves through this lifecycle; the wireframes surface each state:

- **PENDING** — added by name (`POST /v1/foods` → `202` + internal `id`); assembling across sources.
- **UNRESOLVED** — multiple candidates need the user to pick (Candidate Resolution screen).
- **RESOLVED** — a golden record is assembled; the food is selectable.
- **NOT_FOUND** — no source has this food (terminal tombstone with TTL); usable only as freeform text.
- **FAILED** — a source fetch errored after bounded retries; re-fetchable later.

## FR Reference Key

- **FR-002**: `200` with the complete golden-record food data when RESOLVED
- **FR-003**: `202` PENDING response on a miss (add-by-name)
- **FR-004 / FR-013**: add-by-name deduplication (normalized-name key collapses concurrent adds)
- **FR-007**: lifecycle `status` semantics (status always retrievable for a held `id`)
- **FR-008**: local search-by-name endpoint
- **FR-009**: no external source call on search
- **FR-010**: search relevance + performance (typo-tolerant via `pg_trgm`)
- **FR-011**: enqueue background sync on a miss
- **FR-RES-1**: list the candidate set (`GET /v1/foods/{id}/candidates`)
- **FR-RES-2**: resolve from a validated candidate pick (`PATCH /v1/foods/{id}`, candidate-in-set)
- **FR-RES-3**: persist the surviving candidate set when a food lands `UNRESOLVED`
- **FR-MRG-2 / FR-MRG-3**: merge the chosen candidate into the golden record with per-field provenance
- **FR-028**: golden record + **per-field source provenance** (`food_nutrients.source_id`, `food_field_provenance`)
- **FR-033**: polling as the primary notification mechanism
- **SC-008**: nutrient fidelity against source values
- **US-2 / US-2a**: add food by name / disambiguate candidates and resolve
