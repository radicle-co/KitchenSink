# Peer Review — requirements.md

> **Scope warning.** The review below was performed on **2026-05-10 against 31 requirements** and reported
> zero findings. `requirements.md` now carries **41**. REQ-032…REQ-041 were **not examined** by that review.
> See the dated supplement at the end of this file.

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-10
**Artifact**: requirements.md (31 requirements)
**Standard**: INCOSE Guide for Writing Requirements

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

**Scope of this supplement**: `spec.md` FR-024…FR-033 and SC-008…SC-011, converted into REQ-032…REQ-041.
**Review status**: **NOT peer-reviewed.** The 2026-05-10 review predates this material by three months and
did not see it. The findings below were observed while propagating the amendment, not produced by an
independent INCOSE pass over the new requirements. A re-run of the peer-review lint over REQ-001…REQ-041 is
owed and is recorded in `review.md` → Outstanding.

### What the amendment means for this artifact

Ten functional requirements were added, taking the total from 31 to 41. Nine are P1. The verification method
is Test for all ten. Structurally the amendment does not change how this document works — it changes what a
downstream reader must satisfy, most consequentially REQ-035, whose two controls are the only trust boundary
on a credential-less ingress.

### Findings observed during propagation

| ID          | Severity    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-REQ-001 | Major       | **REQ-002 and REQ-040 both state the producer-authentication requirement, at different strengths.** REQ-002 says "the shared service-to-service mechanism aligned with feature 002" — an unresolved reference INCOSE would reject as not verifiable. REQ-040 names Ed25519, networkless. Both now exist, so an implementer can satisfy the weaker one. The fix is upstream: `spec.md` FR-002 should be rewritten to point at FR-032 rather than left as a vaguer parallel. Not done here, because it amends an owner-authored requirement.                                                                                                                        |
| PRF-REQ-002 | Minor       | **REQ-032…REQ-041 sit numerically after REQ-024…REQ-031 but appear before them in the document**, because ids are never renumbered and the non-functional block already held 024–031. Correct under the ID rule, and a reader hazard. Stated inline in the table's preamble rather than resolved.                                                                                                                                                                                                                                                                                                                                                                 |
| PRF-REQ-003 | Minor       | **REQ-004's description was corrupted by an unescaped pipe** in `user \| group \| global`, which split it across three table cells and truncated it from the rendered requirement text. Repaired in this pass; the same corruption existed in `system-design.md` SYS-004 and `traceability-matrix.md` Matrix A and is repaired there too.                                                                                                                                                                                                                                                                                                                         |
| PRF-REQ-004 | Observation | **REQ-039 is a prohibition on this system plus an obligation on external publishers.** INCOSE prefers one actor per requirement. It is kept as one because splitting it would let the prohibition stand without the obligation that makes it workable, which is precisely how a fan-out storm reaches a user. Recorded so a later reviewer does not "fix" it by splitting.                                                                                                                                                                                                                                                                                        |
| PRF-REQ-005 | Observation | **REQ-037 contains a conditional escape** — REQ-008 may be narrowed if cross-path FIFO proves unachievable. That is deliberate and is tracked as a conditional entry in `hazard-analysis.md` → Frozen-Pending-Resolution, not as a waiver.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| PRF-REQ-006 | Major       | **REQ-034 and REQ-035 both name the producer on the event path, and neither says which wins.** REQ-034 requires a `producer` field "because that path has no bearer token"; REQ-035 makes the validated `source` the trust boundary. `system-design.md` resolves it — the registry `producer` mapped from the allowlisted `source` is the identity, the envelope field is record-only — because trusting the field lets an allowlisted principal attribute a publish to another producer and inherit its quota. **An owner ruling on `spec.md` FR-026 is owed**; a design-layer resolution of an ambiguity in a security requirement is not where it should live. |
| PRF-REQ-007 | Minor       | **SC-011 promises more than the transport provides.** "Delivered exactly once" is not available over an at-least-once transport, which `plan.md` states and US-010 relies on. REQ-034 and REQ-038 are verifiable as the publish-side collapse — one replayed event, one notification, one delivery attempt per client — and that is how the acceptance tests read them. The SC wording should be narrowed to match.                                                                                                                                                                                                                                               |

### Supplement summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 2     |
| Minor              | 3     |
| Observation        | 2     |
| **Total Findings** | **7** |
