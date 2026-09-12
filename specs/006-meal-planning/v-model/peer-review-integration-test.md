# Peer Review — integration-test

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-09 | **Re-reviewed**: 2026-08-02
**Artifact**: `integration-test.md` (18 test cases / 72 scenarios)
**Standard**: ISO 29119-4; `docs/engineering/ENGINEERING_EXCELLENCE.md` → QSE §6

## Summary

| Severity           | Count        |
| ------------------ | ------------ |
| Critical           | 0            |
| Major              | 0            |
| Minor              | 1 (resolved) |
| Observation        | 3            |
| **Total Findings** | **4**        |

**Verdict**: ✅ Pass — the single MINOR finding is resolved by enumeration.

> The May review of this artifact recorded "22 integration test cases, 0 findings" on the same day the consolidated
> review recorded **CRITICAL PRF-006-2: no integration test plan exists**. Both statements cannot be true. The
> consolidated review was right.

## Findings

### PRF-006-14 · MINOR — Scenario totals are derived, not enumerated · ✅ RESOLVED

**Disposition (2026-08-02)**: **resolved by enumeration.** The true figure is **72 ITS** (published: 63), across 18
ITP. Corrected here and in every downstream matrix.

### OBSERVATION — The real-dependency rule is applied where it changes the outcome, not uniformly for its own sake

QSE §6 requires real dependencies at this tier. The plan applies it precisely: **41 scenarios against a real Docker
PostgreSQL**, and — importantly — **17 against a real local HTTP server rather than a mocked client object**. The second
choice is the load-bearing one. Stubbing `RecipeGateway`'s client object would make ITS-015-A2 (timeout), A4 (malformed
body) and A6 (partial batch) test the stub's behaviour rather than `ky`'s and the `AbortSignal`'s. Stated here so nobody
"speeds up" the suite by mocking at the wrong seam.

### OBSERVATION — ITS-012-B4 is the scenario a mocked repository cannot express

Aborting the transaction between the entry insert and the idempotency write, then asserting **neither** row exists and a
retry genuinely creates the entry, is the only test that catches HAZ-030 — an idempotency key recorded for work that
never happened, which returns a silent success to the retry. It requires a real transaction. This single scenario is the
strongest justification for the whole real-database policy.

### OBSERVATION — Database-enforced invariants are tested by bypassing the service

ITP-009-B writes directly to the database to prove the six `CHECK` constraints exist in SQL rather than only in
TypeScript. Without this, REQ-CN-005 would be verified only at the layer that a future caller, backfill or migration can
bypass — and the pure fold downstream assumes those bounds hold.

## Verification performed

- 14/18 Phase-1 ARCH modules with a seam have integration cases; pure domain modules are correctly unit-tier only.
- Every scenario is Given/When/Then at a module boundary — no internal-logic assertions leaked down from the unit tier.
- Fault injection covers timeout, 5xx, network error, malformed body, partial batch, auth failure and empty input.
- Concurrency is covered: parallel identical idempotent writes, and a keyset page fetched across a concurrent insert.
- Consumer-driven contract cases exist for the 006 ↔ 001 seam, including ITS-015-C4 which asserts the contract breaks
  the **provider's** CI — the point of CDCT.
- Owner-scoping scenarios assert **byte-identical** bodies for absent vs. not-owned, closing the existence-oracle gap.
- Every scenario asserts state or a returned value; none asserts that a mock was called.
