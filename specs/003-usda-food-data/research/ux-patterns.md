# UX Patterns: USDA Food Data Integration

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Status**: Complete | **Source**: [spec.md](../spec.md), [research.md](../research.md), [plan.md](../plan.md)

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._
_Updated 2026-06-28: reconciled to the source-agnostic stabilization baseline (golden-record `id`; `PENDING/UNRESOLVED/RESOLVED/NOT_FOUND/FAILED` lifecycle; `food_candidates` candidate-pick flow; add-by-name-miss framing)._

---

## 1. Food Search and Selection

### 1.1 Search-as-You-Type Pattern

Food lookup starts with local-store query (never USDA request-path call), with incremental results as users type.

- Debounce input 150–250ms.
- Minimum query length: 2 characters.
- Empty-state guidance: “No local match yet; save ingredient to trigger background fetch.”
- Typo tolerance via `pg_trgm` (e.g., “avacado” → “avocado”).

**FR references**: FR-008, FR-009, FR-010.

---

### 1.2 Food Disambiguation / Candidate Resolution (Brand vs Generic)

When an add-by-name request resolves to **more than one** surviving candidate, the food is set to `UNRESOLVED` and the surviving set is persisted to `food_candidates` for a human pick (US-2a). The candidate-resolution screen surfaces, for each candidate row:

- Data type badge: Foundation / SR Legacy / Branded.
- Brand owner/name (when present).
- Per-100g calories and key macros.

Primary interaction:

1. User types ingredient name.
2. System auto-resolves: exactly **1** normalized-name match → `RESOLVED`; **>1** → `UNRESOLVED` (surface candidate set via `GET /candidates`); **0** → `NOT_FOUND`.
3. For `UNRESOLVED`, the user picks the most appropriate candidate (single-select, with a "none match" escape).
4. The pick (`PATCH`-resolve, candidate-in-set validated and idempotent) persists the resolved food `id` link on the ingredient and clears the candidate set.

**FR references**: FR-002, FR-008, FR-028, FR-MRG-5 (auto-resolve boundary), FR-RES-1 (`GET /candidates`), FR-RES-2 (`PATCH`-resolve), FR-RES-3.

---

## 2. Async Fetch Lifecycle UX

### 2.1 Pending-State Contract (202 Accepted)

On an add-by-name miss (no `RESOLVED` local record yet):

- Immediate response with `status: PENDING` + `estimatedWaitSeconds`.
- UI renders pending chip (not color-only).
- User can continue recipe authoring without blocking.

**FR references**: FR-003, FR-004, FR-011, FR-013, FR-033.

---

### 2.2 Polling-First Completion Pattern

Polling endpoint drives status transitions:

- `PENDING` → spinner + ETA
- `RESOLVED` → auto-refresh nutrition panel
- `UNRESOLVED` → open the candidate-resolution flow (§1.2) for a human pick
- `NOT_FOUND` → inline guidance for manual/fallback ingredient handling
- `FAILED` → retry affordance + non-blocking warning

**FR references**: FR-007, FR-033, FR-RES-1.

---

### 2.3 Optional Push Enhancement

WebSocket push is a UX enhancement layer over polling, not launch dependency.

**FR references**: FR-034, A-007.

---

## 3. Ingredient Matcher and Nutrition Panel

### 3.1 Ingredient Picker Pattern

Recipe ingredient rows expose match status:

- Matched: shows selected food description and data type.
- Pending: shows wait state and last poll timestamp.
- Unmatched: allows freeform ingredient entry (no forced hard block).

**FR references**: FR-002, FR-003, FR-033, A-008.

---

### 3.2 Nutrition Panel Pattern

Panel shows per-selected-food nutrient breakdown and aggregate contribution hints. Unit toggle controls are presented as UX aids.

**FR references**: FR-002, FR-028, SC-008.
**Warning linkage**: explicit conversion semantics are not a dedicated FR (tracked in verify warning).

---

## 4. Error and Recovery Patterns

### 4.1 Tombstone / Not Found Pattern

If USDA returns 404:

- Status shown as “Not found in USDA dataset”.
- No retry loop.
- User can keep freeform ingredient (downstream recipe UX decides nutrition treatment).

**FR references**: FR-005, FR-025.

---

### 4.2 Rate-Limit Backpressure Pattern

When the rolling-window limiter is at capacity:

- User-facing reads remain functional from local store.
- Pending requests continue queued with realistic ETA.
- System avoids false promise of immediate fetch.

**FR references**: FR-019, FR-020, FR-021, FR-022, SC-002.

---

### 4.3 Tombstone Visibility Pattern

Operational, not end-user UI: terminal failures recorded as tombstone rows (no DLQ) are surfaced in monitoring dashboards and alerts.

**FR references**: FR-016, FR-018, SC-006.

---

## 5. Accessibility and Clarity Constraints

- `PENDING`/`UNRESOLVED`/`RESOLVED`/`NOT_FOUND`/`FAILED` must be conveyed via text/icon + color (NFR-005).
- Interactive picker/search/status controls need accessible names (NFR-004).
- Any food-state badges must remain keyboard/screen-reader discoverable.
