# Phase 0 — Research: 015 Publishing Rewards

**Created**: 2026-08-22 · **Plan**: [`plan.md`](./plan.md)

## Status: no unresolved NEEDS CLARIFICATION

`spec.md` carries **zero** `[NEEDS CLARIFICATION]` markers. Every open question was closed by owner decision
across five clarification rounds (`C-015-001` … `C-015-025`). This document therefore records **where the
research already lives** and what remains genuinely unknown, rather than restating settled decisions.

## Research already performed

| Question                                                 | Where it was answered                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which reward mechanics produce **durable** contribution? | [`research/reward-psychology.md`](./research/reward-psychology.md) §1 — symbolic, human-sourced recognition (barnstars: ~60% higher productivity persisting at three months)            |
| Which mechanics are counter-indicated here?              | §2 — streaks (frequency mismatch + loss framing), global leaderboards (demotivate the ~99% who do not create), volume-threshold badges (steer at volume), peer-voted scores (collusion) |
| How should the schedule be shaped?                       | §3 — front-loaded, mildly diminishing, terminating at the ceiling                                                                                                                       |
| What reaches premium users?                              | §5 — recognition, early access, contributor input; discovery placement and anything monetary rejected                                                                                   |
| What is the legal exposure of a reward programme?        | §6 — _Grokster_ inducement, §512(c)(1)(B); DSA Art. 25 applies, EU AI Act Art. 5 does **not** (it is scoped to AI systems)                                                              |
| Is the migration safe on the target engine?              | [`migrations/migration-plan.md`](./migrations/migration-plan.md) §2.5 — executed against PG 16 and PG 18.6                                                                              |

## Decisions taken during planning

### D1 — Ratchet enforcement: trigger, not CHECK

- **Decision**: `FR-007i` monotonicity is enforced by a `BEFORE UPDATE` trigger.
- **Rationale**: the originally-planned `CHECK (tier >= highest_tier_reached)` was **tested against a live
  database and defeated** — lowering both columns in one statement satisfies it. A row-level CHECK sees only
  the candidate row; "never decreases" compares OLD to NEW.
- **Alternatives**: CHECK constraint (rejected — demonstrably non-functional); application-level guard
  (rejected — `FR-007i` governs the whole feature and discipline is not enforcement).

### D2 — Slot balance derived, not stored

- **Decision**: balance is `SUM(amount) WHERE kind='slot' AND reversed_at IS NULL`, with a materialization
  for the hot path and the ledger as source of truth.
- **Rationale**: a stored counter can drift; a derived sum cannot. Makes `FR-007b` permanence structural.
- **Alternatives**: mutable counter column (rejected — drift silently grants or denies privacy).

### D3 — Obligation separated from grant

- **Decision**: publication and the grant _obligation_ commit together; the grant is a later conditional write.
- **Rationale**: reconciles `FR-010a` (atomic decision) with `FR-010b` (publication never blocked), which pull
  in opposite directions. See [`plan.md`](./plan.md) §6a.
- **Alternatives**: grant inside the publication transaction (rejected — contradicts `FR-007c`, `FR-010`,
  `FR-011`, all of which state publication succeeds even when no grant is made); fire-and-forget grant
  (rejected — `FR-005` makes a lost grant permanent).

### D4 — Near-duplicate is deterministic

- **Decision**: normalized-title equality OR identical resolved-ingredient set.
- **Rationale**: a false positive **denies a legitimate grant** — the coercive direction this feature exists
  to remove — and a similarity score cannot be explained to the user in terms they can act on.
- **Alternatives**: fuzzy similarity threshold (rejected, above); no check at all (rejected — drops a control
  the spec added for a stated edge case).

## Genuinely open — carried, not resolved

| #   | Unknown                                                    | Why it is not resolved here                                                            |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| U1  | Latency budget for `GET /rewards/me`                       | Needs a measurement against real corpus size; no target can be set honestly in advance |
| U2  | Observability signals (metrics, alerts) for grant issuance | Operational design, belongs with the monitoring phase                                  |
| U3  | Data volume / scale assumptions                            | No production baseline for publication rate exists yet                                 |
| U4  | Attestation wording                                        | Legally load-bearing text owned by **016**, not by this feature                        |
| U5  | Appeal-path mechanism (`FR-019`)                           | Consumes 016's takedown process, which does not exist yet                              |

**None of U1–U5 blocks task decomposition**; each is an input to implementation or to 016.
