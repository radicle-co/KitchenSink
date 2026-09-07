# Peer Review — integration-test.md

> **Scope warning.** The review below was performed on **2026-05-10 against 248 test cases** covering
> ARCH-001…ARCH-062, and reported zero findings. `integration-test.md` now covers ARCH-001…ARCH-082.
> ITP-063…ITP-082 were **not examined** by that review. See the dated supplement at the end of this file.

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-10
**Artifact**: integration-test.md (248 test cases)
**Standard**: ISO 29119-4 Integration Techniques

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

**Scope of this supplement**: ITP-063…ITP-082 and ITS-063…ITS-082, covering ARCH-063…ARCH-082.
**Review status**: **NOT peer-reviewed.** The 2026-05-10 ISO 29119-4 pass predates this material.

### What the amendment means for this artifact

The adapter-to-core boundary is the integration boundary FR-024 is about, so this layer is where "both
adapters call the same core" is actually verified — one contract test per rule, run twice, once per adapter.
Eighty test cases were added across the twenty new architecture modules.

### Findings observed during propagation

| ID              | Severity    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-INTTEST-001 | Major       | **ITP-001…ITP-062's scenarios are unfalsifiable.** All 248 read "Given upstream and downstream module boundaries are available with deterministic fixtures … When a contract-valid and contract-invalid interaction is exercised … Then the handshake, error propagation, and telemetry behavior match architecture definitions". No boundary, input or expected value is named. 248 rows, zero verification.                                                                                         |
| PRF-INTTEST-002 | Major       | **The ID allocation in `traceability-matrix.md` Matrix C does not match this document** for ARCH-001…ARCH-062: the matrix staggers each row's first case onto the previous ARCH, so `ITP-001-D` appears under ARCH-002. Each such id exists here, but under a different module than the matrix row claims, so the two documents disagree about which module a case verifies. The new rows follow this document. Renumbering the old ones is regeneration work; recorded in `review.md` → Outstanding. |
| PRF-INTTEST-003 | Minor       | **The Concurrency & Race technique finally has real targets.** ITP-073/074-D (cross-path ordering under simultaneous arrival) and ITP-063/064-D (two adapters entering the same core concurrently) are the first cases in this document where the technique is exercising a genuine race rather than filling a required slot.                                                                                                                                                                         |
| PRF-INTTEST-004 | Observation | **ITP-069/070 cannot be fully exercised in-process.** The bus resource policy is enforced by the AWS API, not by this codebase, so half of REQ-035 is verified by an infrastructure assertion (synthesized policy plus a denied `PutEvents`) rather than by a module-boundary test. Recorded so the gap is not mistaken for coverage.                                                                                                                                                                 |

### Supplement summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 2     |
| Minor              | 1     |
| Observation        | 1     |
| **Total Findings** | **4** |
