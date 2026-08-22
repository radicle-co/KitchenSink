# Specification Quality Checklist: ReciMe Parity

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-22
**Feature**: [spec.md](../spec.md)
**Iteration**: 3 (post-clarification, post-016-reconciliation)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — _one deliberate exception, see Notes_
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] **No [NEEDS CLARIFICATION] markers remain** — all 3 resolved by owner ruling 2026-08-22
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification — _see Notes_

## Cross-cutting governance

- [x] **GR-003** (FR namespace): every cross-feature citation qualified as `{feature}-FR-{NNN}`; 017's own
      FRs number locally from FR-001, matching the 003/011/012/013/014 precedent
- [x] **GR-003 AC-003-b**: `cross-feature-FR-index.md` updated 2026-08-22 with **27 rows** covering 017's
      citations to 001/004/005/006/007/008/010/013/016. Note recorded there that features **015 and 016 are
      still unregistered** — not added on their owners' behalf, per Review Rule 3 and GR-003's own precedent.
- [ ] **GR-005** (offline): FR-025 declares the _requirement_ for offline cook, but the four mandated answers
      (scope, persistence layer, sync strategy, conflict handling) are **not yet stated**, and
      `docs/offline-strategy.md` does not exist. FR-033's shared check-off makes this materially harder than
      when GR-005 was written for a single user. Blocks implementation, not this spec.
- [x] **NFR-005 / `001-FR-044a`**: web+mobile parity asserted, with the browser-extension exemption stated
      explicitly rather than left implicit

## Owner rulings applied (2026-08-22)

| Question               | Ruling                                     | Effect                                           |
| ---------------------- | ------------------------------------------ | ------------------------------------------------ |
| Scope breadth          | **Every parity delta**                     | 17 deltas, 7 owner specs                         |
| Import waterfall depth | **All five tiers**                         | Pulls D7 in as a hard prerequisite (FR-037)      |
| FR-024 voice           | **Promote what 008 already analysed**      | Commands + spoken output; satisfies `013-FR-020` |
| FR-030 sharing         | **Pull D18 in**                            | Household becomes first-class across 006/007/010 |
| FR-036 lifetime tier   | **Dropped — "subscriptions only for now"** | D23 deferred to `010` pending a cost model       |

## Verification performed

Claims in this spec were checked against the repository rather than inherited from the gap analysis:

| Claim                               | Method                                             | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video import absent from every spec | `grep -rniE 'tiktok\|reel'` over all `spec.md`     | **0 hits** — confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Share sheet absent                  | same                                               | **0 hits** — confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Browser extension absent            | same                                               | **0 hits** — confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Unit conversion absent              | `grep` for `metric\|imperial`                      | **0 hits** — confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Dark mode absent                    | `grep` for `dark mode`                             | **0 hits** — confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Migration importers absent          | `grep` for `Paprika\|AnyList`                      | **0 hits** — confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Voice/hands-free absent             | `grep` for `voice\|hands-free`, **`spec.md` only** | ⚠️ **TOO NARROW — corrected.** 0 hits in any `spec.md`, but 008's `research/ux-patterns.md` §5 defines a Voice Command Entry Pattern ("not an explicit FR; keep as Should Have until promoted"), its `v-model/traceability-matrix.md` carries **HAZ-005** and **HAZ-021** for voice, 008's charter reads "hands-free cooking interface", and **`013-FR-020` delegates hands-free cook-along to 008**. Voice is 008's territory, unpromoted — not absent. This changed FR-024 from "new capability" to `→ 008 PROMOTED`. |
| Aisle grouping not an FR            | read `007/spec.md:141,201`                         | **prose only** — confirmed, D9 real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Recipe export not an FR             | read `001/spec.md` export hits                     | **all TypeScript `export`** — confirmed, D14 real                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 006 has no sharing model            | read `006/spec.md:375`                             | _"there is no sharing model in this feature"_ — confirmed; `006-FR-029` scopes to a single owner                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Owner FR ranges                     | enumerated `**FR-NNN**` per spec                   | 004 runs to **FR-052**, not FR-028 as GR-003's stale note says                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Open items carried forward

1. ✅ **The `016` conflict was overstated — corrected 2026-08-22, no longer a blocker.** Reading the actual
   text: `016-FR-027` prohibits **persisting** a copy to operator storage, and `016-FR-027c` prohibits
   **derived renditions of a referenced photograph** for display. Tiers 3–4 do neither. Three outcomes:
   **(a)** FR-011 now states that no sampled frame or derived rendition is persisted, satisfying `016-FR-027`;
   **(b)** FR-025 now carves out referenced photographs offline, matching `016-FR-027e`, which `016` had
   already named as a known cook-mode interaction; **(c)** FR-015 records the channel classification, and it
   is accepted that video import is permanently `operator-performed retrieval` under `016-FR-028`/`FR-029`,
   since no user-supplied-bytes alternative can exist for a hosted video — which does weaken the §512(c)
   posture for that channel specifically.
   1a. ⚠️ **What genuinely remains, and it is narrow.** Is transient decode-for-extraction a reproduction at all?
   It is closer to text-and-data-mining than to serving a thumbnail. Session `911043cd` raised **DSM Art. 4**
   and the machine-readable reservation against `004-FR-023`'s wildcard-`Disallow` carve-out; this is the same
   question applied to video. **Does not block planning. Must be answered before tiers 3–4 ship.**
2. **ADR-0024's ceiling was sized for the LLM verification gate**, not a vision waterfall. §8 open decision 4
   requires a cost model before committing to tiers 3–4.
3. **`006-FR-032`'s idempotency key** was written for a single owner and does not cover two household members
   editing one plan entry concurrently.

## Notes

- **Deliberate implementation-detail exception.** FR-035 and FR-036 cite `ServingScaleControl`,
  `servingScale.ts`, `cookingProgress.ts`, and `useCookingProgress.ts` by name. These requirements exist
  _because_ the behaviour is already shipped with no requirement anywhere; removing the file references would
  make the claim unverifiable. They are evidence, not design.
- **Feature number collision.** This feature was created as `016-recime-parity` and renumbered to `017` after
  a concurrent session was found to have created `016-legal-compliance-framework` thirteen minutes earlier.
  `.specify/feature.json` is a shared singleton with no isolation — it now points at `017`, so the other
  session must re-point it before running `/speckit-plan`.
- **Stale governance record found.** GR-003's "Current State (2026-08-02)" states 004 owns `FR-008…028`.
  004 actually defines through `FR-052`. GR-003 should be corrected; not blocking, and not corrected here
  since this spec does not own that file.
