# Traceability — SUPERSEDED (historical pointer, not a live artifact)

**This file holds no traceability data and is not maintained by any tool.** The authoritative matrix is
[`traceability-matrix.md`](./traceability-matrix.md). Nothing in this file should be read as a statement
about the current design, and no traceability data should ever be hand-written back into it.

## Status

**KEEP-AS-STUB.** Delete-or-rebuild was reviewed on 2026-08-05 and resolved in favour of keeping the
pointer. Deletion is not blocked by any script — it is blocked by inbound citations from a **frozen**
artifact and by the phase manifest (below). Rebuilding is wrong on principle: hand-authoring this file is
what produced the defects recorded here in the first place. If the traceability data is ever wanted at
this path again, the only correct source is `build-matrix.sh`, which does not write here.

## Inbound references — why the path must stay resolvable

`peer-review.md` is designated a **historical record that is deliberately not rewritten**
(`.forge-status.yml:72`, and `:161` — "the path must stay resolvable"). It cites this path in five findings
plus its artifact list, so deleting the file would leave dangling citations inside a frozen audit
document:

| Reference                                  | Where                                            |
| ------------------------------------------ | ------------------------------------------------ |
| Artifact list                              | `peer-review.md:11`                              |
| `PRF-005-A2` (integration plan absent)     | `peer-review.md:60`, summary row `:341`          |
| `PRF-005-A3` (REQ-CN-001 unverified)       | `peer-review.md:78`, summary row `:342`          |
| `PRF-005-B3` (REQ-012 agent-path coverage) | `peer-review.md:150`, summary row `:346`         |
| `PRF-005-P4` (Matrix H "thorough")         | `peer-review.md:257`                             |
| `PRF-005-P5` (no orphan artifacts)         | `peer-review.md:266`                             |
| v-model phase artifact manifest            | `specs/005-ai-integration/.forge-status.yml:317` |

The manifest entry matters independently: deleting the file without also editing `.forge-status.yml`
would make the v-model phase report a missing artifact. Deletion is therefore a **two-file, coordinated**
change, not a `git rm`.

No script or gate requires this file. `build-matrix.sh`, `build-audit-report.sh`, `setup-v-model.sh`,
`ingest-test-results.sh`, every `validate-*.sh`, `check-prerequisites.sh`, `common.sh`, and the
`speckit.v-model.trace` skill all reference `traceability-matrix.md` **only** — verified 2026-08-05.
Absence would break no automation.

## What was removed, and why

This file was a hand-authored duplicate of the tool-maintained matrix. Nothing regenerated it, so it
drifted until it was actively wrong in two ways:

1. **It asserted the rejected BYOK design.** It described "AES-256-GCM encryption with unique IV per
   write", a `ProviderConfigRepository`, and `src/ai/provider-config/*`. The approved design writes the
   key to AWS Secrets Manager and keeps **only the ARN** in Postgres — see `plan.md` §2.2
   (`user_byok_keys`, `secret_arn`, "The raw key is never in Postgres") and spec `FR-015`. _(A previous
   revision of this banner also cited ADR-0012 here. That citation was wrong: ADR-0012 is the MCP agent
   credential bridge and says nothing about BYOK key storage. Corrected 2026-08-05.)_
2. **Its hazard block collided with the authoritative register.** Its Matrix H defined seven hazards,
   `HAZ-001`..`HAZ-007` — the set `peer-review.md:260` (`PRF-005-P4`) praises as "thorough". The
   authoritative register in `hazard-analysis.md` now defines **34** hazards, `HAZ-001`..`HAZ-034`, keyed
   to `SYS-001`..`SYS-008`, with entirely different meanings at the same IDs:

    | ID        | This file said                                      | `hazard-analysis.md` says                                                            |
    | --------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
    | `HAZ-001` | "BYOK API key stored in plaintext"                  | "Raw API key written to the application database instead of Secrets Manager" (`:74`) |
    | `HAZ-002` | "GCM auth tag mismatch exposes tampered credential" | "Wrong provider key bound to user profile during update race" (`:75`)                |

    Under a scheme whose own rule is "Never renumbered" (`hazard-analysis.md:17`), same-ID/different-hazard
    is the worst kind of drift: a citation resolves, but to the wrong thing.

    **This is an ID collision, not a coverage gap.** "GCM auth tag mismatch" is absent from the register
    because the cryptography that could produce it was designed out, not because a real hazard went
    unregistered. The genuinely surviving concerns from the old seven are carried forward — e.g. old
    `HAZ-007` ("revoked agent retains access via previously issued token") is now
    `hazard-analysis.md:106` `HAZ-018`, and the OAuth replay surface is now `:104` `HAZ-016`.

## The history recorded here is not unique — this is a pointer, not the archive

Both defects above are preserved independently, in more detail, and this stub is a convenience summary
rather than the record of last resort:

- `peer-review.md:260` (`PRF-005-P4`) enumerates the full original seven-hazard Matrix H.
- `peer-review.md:278` (`PRF-005-P6`) and `:168` (`PRF-005-B4`) record the rejected AES-256-GCM design.
- `unit-test.md:45`, `system-test.md:77`, `integration-test.md:41` each carry a "Revised 2026-08-02"
  note explaining what the crypto assertions used to claim and why they were wrong.
- `.forge-status.yml` → `completed_2026_08_02` lists the correction made to every affected artifact.

**The pre-truncation file is recoverable** — verified, not assumed. Commit `cea6f91c`
("docs(005): rewrite plan/tasks and reconcile the V-Model to the codebase", 2026-08-02) truncated it from
300 lines to this stub, and `cea6f91c` is an ancestor of `main`:

```bash
git show cea6f91c^:specs/005-ai-integration/v-model/trace.md
```

The old Matrix H is at lines 181–187 of that revision.

## Where the data lives now

| Matrix | Scope                                   | In `traceability-matrix.md` |
| ------ | --------------------------------------- | --------------------------- |
| A      | Validation — REQ → ATP → SCN            | `:6`                        |
| B      | Verification — REQ → SYS → STP → STS    | `:90`                       |
| C      | Integration — SYS → ARCH → ITP → ITS    | `:404`                      |
| D      | Implementation — ARCH → MOD → UTP → UTS | `:501`                      |
| H      | Hazards — HAZ → mitigation → test       | `:602`                      |

All five are generated deterministically by `build-matrix.sh` from the V-Model artifacts.
