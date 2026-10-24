# Peer Review — architecture-design.md

> **Scope warning.** The review below was performed on **2026-05-10 against 62 architecture modules** and
> reported zero findings. `architecture-design.md` now carries **82**. ARCH-063…ARCH-082 — the dual-ingress
> modules — were **not examined** by that review. See the dated supplement at the end of this file.

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-10
**Artifact**: architecture-design.md (62 architecture modules)
**Standard**: IEEE 42010 / Kruchten 4+1

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

**Scope of this supplement**: ARCH-063…ARCH-082, the added Process View path for the event ingress, and the
effect of the amendment on the existing views.
**Review status**: **NOT peer-reviewed.** The 2026-05-10 Kruchten 4+1 pass predates this material.

### What the amendment means for this artifact

FR-024 is an architectural requirement, not a feature: it fixes a **shape** — two adapters, one core — and
declares any deviation a defect. This document is therefore where an implementer will look, and where the
shape must be visible rather than described. Twenty modules were added (two per SYS-032…SYS-041), a third
Process View sequence was added for the event ingress, and Data Flow rows were added for the event ingress,
the event-path rejection flow, and cross-path ordering.

### Findings observed during propagation

| ID           | Severity    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-ARCH-001 | Major       | **The original Producer Publish Path sequence diagram shows the single-door flow**: ARCH-001 calls auth, validation, durable commit and routing directly, with no core interposed. It is the picture FR-024 forbids. The event-ingress diagram added alongside it makes the intended shape visible, but the two diagrams now disagree about where the rules live, and the HTTP one is the misleading half. Rewriting it means re-deriving the original participant set, which is regeneration work. |
| PRF-ARCH-002 | Minor       | **ARCH-001…ARCH-062's descriptions are content-free** — every row reads "Interface boundary and policy contract for SYS-0NN." or "Runtime processing path and state transitions for SYS-0NN.". The name is restated and nothing is said. ARCH-063…ARCH-082 carry real descriptions instead of matching that pattern.                                                                                                                                                                                |
| PRF-ARCH-003 | Minor       | **The Contract/Policy + Runtime/Execution split is mechanical, not analytic.** Every SYS is decomposed into exactly the same two modules regardless of whether that division means anything for it — SYS-039 (the absence of an aggregation stage) has a "Runtime/Execution Module" describing runtime behaviour that by definition does not exist. The split is preserved for traceability, not because it is the right decomposition.                                                             |
| PRF-ARCH-004 | Observation | **The Failure Contract bullet is asymmetric across the new modules on purpose.** Event-side modules dead-letter with a reason code because there is no caller to receive a structured error; HTTP-side modules return one. That asymmetry is the only permitted difference between the two adapters, and stating it here is what stops it being read as a rule difference.                                                                                                                          |
| PRF-ARCH-005 | Minor       | **The original Producer Publish Path diagram names ARCH-031 as its "route and sequence" participant, but ARCH-031 is SYS-016 — the `messageType` registry.** Routing and sequencing is SYS-008 → ARCH-015/ARCH-016. The new event-ingress diagram names ARCH-016 and carries an inline note, so the discrepancy is visible rather than duplicated into a second diagram.                                                                                                                            |
| PRF-ARCH-006 | Minor       | **Three pre-existing Data Flow rows cite the wrong modules.** ARCH-033 and ARCH-035 (registry enforcement, idempotency) are listed as sources of the _routing_ flow, and ARCH-039 and ARCH-041 (unauthenticated-access rejector, cross-user subscription guard) as sources of the _registry and observability_ flow. Left as found; they predate the amendment and correcting them is regeneration work.                                                                                            |

### Supplement summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 1     |
| Minor              | 4     |
| Observation        | 1     |
| **Total Findings** | **6** |
