# Peer Review — acceptance-plan.md

> **Scope warning.** The review below was performed on **2026-05-10 against 62 test cases** covering
> REQ-001…REQ-031, and reported zero findings. `acceptance-plan.md` now carries **82** test cases and 84
> scenarios. ATP-032…ATP-041 — which is where SC-008…SC-011 are validated — were **not examined** by that
> review. See the dated supplement at the end of this file.

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-10
**Artifact**: acceptance-plan.md (62 test cases)
**Standard**: Acceptance Criteria Traceability

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 0     |
| Observation        | 0     |
| **Total Findings** | **0** |

## Findings

No findings.

---

## Supplement — 2026-08-10 (dual-ingress amendment)

**Scope of this supplement**: ATP-032…ATP-041, SCN-032…SCN-041, and the SC-001…SC-011 coverage table.
**Review status**: **NOT peer-reviewed.** The 2026-05-10 traceability pass predates this material.

### What the amendment means for this artifact

Four success criteria were added and one was rewritten. SC-008 (ingress equivalence), SC-009 (spoofing
rejected), SC-010 (no aggregation) and SC-011 (exactly-once on replay) now have named acceptance coverage,
and SC-001 was amended to require **both** paths against a synthetic reference producer owned by this
feature, which removes its dependency on a consumer's schedule. A `Success Criteria Coverage` table was added
so each SC resolves to specific ATP ids rather than being implied.

### Findings observed during propagation

| ID          | Severity    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-ACC-001 | Major       | **ATP-001…ATP-031 are unfalsifiable.** Every one of the 62 original scenarios reads "Given prerequisite identities/configuration are set … When the relevant publish/subscribe/operation behavior is executed … Then observed outputs satisfy the requirement acceptance condition". No input, no threshold, no assertion. They would pass against any implementation, including a broken one — which makes the 100% coverage figure a count of rows, not of verification. The 2026-05-10 review of this artifact reported zero findings, which is itself the finding. |
| PRF-ACC-002 | Minor       | **ATP-032…ATP-041 deliberately break template symmetry** by carrying concrete inputs and falsifiable outcomes, rather than matching the boilerplate above them. Symmetry with unfalsifiable text is not worth having. A regeneration will overwrite them with boilerplate unless the generator is fixed first.                                                                                                                                                                                                                                                         |
| PRF-ACC-003 | Minor       | **Two test cases carry a second scenario** (SCN-035-B2, SCN-037-B2), so scenarios exceed test cases for the first time. Both exist because one assertion cannot express the requirement: REQ-035 needs its two controls proven independently, or either alone passing would let the other be dropped; REQ-037 needs the explicit-narrowing outcome stated as a scenario so it cannot be reached by waiver.                                                                                                                                                             |
| PRF-ACC-004 | Minor       | **Section headings truncate the requirement mid-word** (`REQ-002 (The publish API SHALL authenticate producer calls using the shared service-to-service mech)`) — a generator artefact at a fixed character count. Harmless to traceability, corrosive to review, since a reviewer cannot see what is being tested without opening `requirements.md`.                                                                                                                                                                                                                  |
| PRF-ACC-005 | Observation | **ATP-038-B asserts a negative outcome on purpose**: a key derived from a transport id or a clock must be shown _not_ to deduplicate. Without it, ATP-038-A can pass while producers derive keys the wrong way, which is the mistake REQ-038 exists to prevent.                                                                                                                                                                                                                                                                                                        |

### Supplement summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 1     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **5** |
