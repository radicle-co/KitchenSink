# Traceability — SUPERSEDED

**This file no longer holds traceability data.** Use
[`traceability-matrix.md`](./traceability-matrix.md).

## Why this file still exists

It is cited by `peer-review.md` (findings PRF-005-A2, PRF-005-A3, PRF-005-B3 and the artifact list).
`peer-review.md` is a historical record and is not rewritten, so deleting this path would break those
citations. The file is kept as a pointer and its stale content removed.

## What was removed, and why

`trace.md` was a hand-authored duplicate of the tool-maintained matrix. `build-matrix.sh` writes only
`traceability-matrix.md`, so nothing regenerated this file and it drifted until it was actively wrong:

1. It asserted the **rejected** BYOK design — "AES-256-GCM encryption with unique IV per write",
   `ProviderConfigRepository`, `src/ai/provider-config/*`. The approved design writes the key to AWS
   Secrets Manager and keeps only the ARN in Postgres (`plan.md` §2.2, FR-015, ADR-0011).
2. Its hazard rows did not match the authoritative register. It listed `HAZ-001 "BYOK API key stored in
plaintext"` and `HAZ-002 "GCM auth tag mismatch exposes tampered credential"`; `hazard-analysis.md`
   defines `HAZ-001` as "Raw API key written to the application database instead of Secrets Manager" and
   `HAZ-002` as "Wrong provider key bound to user profile during update race" — different hazards under
   the same IDs, in a scheme whose own rule is "Never renumbered".

Content removed 2026-08-02. Recoverable from git history if the original wording is ever needed for an
audit trail.

## Where the data lives now

| Matrix | Scope                                   |
| ------ | --------------------------------------- |
| A      | Validation — REQ → ATP → SCN            |
| B      | Verification — REQ → SYS → STP → STS    |
| C      | Integration — SYS → ARCH → ITP → ITS    |
| D      | Implementation — ARCH → MOD → UTP → UTS |
| H      | Hazards — HAZ → mitigation → test       |

All five are generated deterministically by `build-matrix.sh` from the V-Model artifacts.
