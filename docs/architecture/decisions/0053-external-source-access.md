# 0053 — Every external food source is called within its own declared limit, through one transport

- **Status:** Proposed
- **Date:** 2026-10-01
- **Owner ruling (2026-09-30):** "hit those sources that expose APIs along with USDA when doing food search and food
  sync; make sure we respect rate limiting (handled the same way we handle USDA but each API needs its own declaration
  of the limit so that the search and food sync don't query the endpoints if they are at their limit and/or pause
  import until reset)."
- **Amends:** `specs/003-usda-food-data/spec.md` FR-019, FR-026, A-004 and FR-MRG-2.
- **Relates to:** [ADR-0052](0052-food-data-sources.md), the source register this record calls.
- **Plan:** `docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md` (R56 to R60, KTD-25, KTD-26, U26 to
  U29)

## Context

Today only USDA is called. `RollingWindowLimiter` counts USDA's calls in `source_call_log`, and eight call sites charge
it by hand. Three of them never record a 429: PATCH resolve, change-refresh and the worker's refresh. One environment
variable sets every source's cap, and one sets every source's window.

The owner now asks search and sync to call every source that has an API, each within its own limit. A review of each
API's terms on 2026-10-01 (plan U26) found that only USDA can search by name. Matvaretabellen publishes its whole table
as five static files. Livsmedelsdatabasen can list and fetch by id, and its download terms wait for an owner ruling.

## Decision

1. **Each source declares its limit.** The register (ADR-0052) gives each API source a `RateLimitDeclaration`: the
   number of requests, the window, what the limit counts (an API key or a client address), whether the publisher states
   it (with its URL) or we set it (with a reason), and how long a breach blocks. USDA counts per hour and Matvaretabellen
   per day.
2. **Admission stops at 90% of the declared limit, for every caller.** The owner's 2026-09-15 ruling for USDA ("Up to
   900") now applies to every source. The top tenth of a window is headroom, never spent, because spending to a
   publisher's limit is how a 429 is earned.
3. **One transport admits every request.** A `RateLimitedTransport` Decorator over each source's `fetch` charges the
   shared window before each upstream request. `RollingWindowLimiter` keeps owning the count and the ceiling, and the
   transport only enforces them. The eight hand charges go.
4. **A full window is busy, never a timeout.** The transport throws a typed `SourceBusyError`. The USDA client rethrows
   it unchanged, and the adapter maps it to a busy outcome, never to a `SourceApiError` status code, because the worker
   classifies status codes. So live search reports the source as busy (or skipped, when a block refused it), the
   worker defers the whole row without counting an attempt, change-refresh stops its scan, and PATCH resolve waits
   once when the refusal clears within 2 s and otherwise answers 503. When our own admission or block ledger fails,
   the transport throws `SourceAccountingError` instead: live search reports the source unavailable, and the other
   callers treat it as busy.
5. **One block is shared by every task.** A 429, a 502, 503 or 504, or a low publisher count writes
   `source_backoff(source, blocked_until)` (migration 0019), read under the limiter's advisory lock. Admission waits at
   most 2 s for that lock and then answers `contended`, never a timeout; every instant it returns comes from the
   database clock. The API, the worker, change-refresh
   and the mirror sync all read it. Each source declares how long each kind of block lasts:

    | Signal                                     | Block lasts                                               |
    | ------------------------------------------ | --------------------------------------------------------- |
    | 429                                        | Until `Retry-After`, else `breachBlockSeconds`            |
    | Publisher's remaining count is 0           | `breachBlockSeconds`                                      |
    | Publisher's remaining count is 10% or less | `probeSeconds` (USDA: 300)                                |
    | 502, 503 or 504                            | Until `Retry-After`, else `outageBlockSeconds` (USDA: 60) |

    An outage is not a breach, so it never blocks for a breach's hour. The 10% rule applies the 90% ceiling of point 2
    to the publisher's own count, because that count also sees the key's other users.

6. **An override may only lower a limit.** `FOOD_SOURCE_LIMIT_OVERRIDES`, a JSON object keyed by register id, replaces
   the two source-agnostic variables (CDK context `foodSourceLimitOverrides`; the retired context keys fail synth). It
   exists for load tests, and an override that could admit more calls than the declared limit in one of the
   publisher's windows is refused at startup.
7. **A list-only API is searched through a mirror.** `source_mirror_item` caches each item of a list-only source, keyed
   by `(source, external_key)`. A `MirrorSync` Fargate task keeps it current in sandbox and prod only, within the source's
   limit. A preview fills its mirror from the committed snapshot at deploy and calls no publisher. The mirror is a cache,
   never catalog, and the seed never reads it.
8. **Search ranks every USDA dataset above every mirror source.** Add-by-name asks every source in parallel and takes
   candidates from the highest-ranked source that answered. A skipped source that ranks above that one defers the whole
   row, so a busy USDA never lets a lower source decide a food.
9. **A live food comes from one source.** It takes every field and every value from one source's candidate. The
   cross-source field merge FR-MRG-2 described is withdrawn.

### Amendments to 003

| Item     | Amended to                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| FR-019   | A rolling window per source, from the register, with admission stopping at 90% of each declared limit.        |
| FR-026   | A 429, a 5xx outage or a low publisher count blocks the source for every task, for the time point 5 declares. |
| A-004    | A second live source is in scope through a mirror. USDA stays the only source searched remotely.              |
| FR-MRG-2 | A live food is one source's candidate. No food merges fields from two sources.                                |

### Rejected alternatives

- **A limiter per process.** Two tasks would each spend the whole window, and only the publisher would see the total.
- **Retrying a 429 at once.** It spends the window that the block exists to protect.
- **Crawling a list-only API from every preview.** Open pull requests would multiply the load on a publisher.

## Consequences

**Positive**

- No caller can call a source at its limit, and one task's 429 stops every task.
- PATCH resolve, change-refresh and the worker's refresh stop on a 429.

**Negative, accepted**

- USDA's limit counts per key across every api.data.gov request made with that key. Sandbox and every preview share one
  key while each counts its own calls, so together they can exceed it. The owner deferred that fix (2026-09-30).
  `X-RateLimit-Remaining` is the only count that sees the key's other users.
- A mirror is stale between syncs, and a source's daily limit bounds how fresh it can be.

**Guards**

- A guard that every source client is built through the transport: `new UsdaApiClient(` appears only in
  `sourceRegistry.ts`, and no file under `src/sources` calls a bare `fetch(`.
- A guard that the transport's block reasons equal `source_backoff`'s `CHECK`.
- LOCAL e2e cases: two tasks admitting at once never exceed the ceiling, and a block written by one task stops the other.
