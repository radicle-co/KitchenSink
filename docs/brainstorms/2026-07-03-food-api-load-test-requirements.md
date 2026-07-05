# Food API load test — requirements

- **Date:** 2026-07-03
- **Status:** Requirements (ready for `/ce-plan`)
- **Scope:** Standard
- **Target:** the live per-PR sandbox food API (`food-pr-59.commise.app`)

## Problem / goal

The food service has never been exercised under concurrent load. Now that a working
sandbox deploy exists, we want one end-to-end run that answers two questions:

1. **Does it hold?** At the realistic supported request rate, does the service stay healthy
   (acceptable latency, no unexpected errors, no task restarts) across the full user journey?
2. **Where's the ceiling?** As load ramps past that rate, what sustained throughput does the
   deployed configuration actually support, and does it degrade gracefully when the throttle saturates?

The output is a **k6 harness** plus a documented **supported-throughput number and degradation
characterization** for the food ingestion path as currently deployed.

## Context

The food API (NestJS on ECS/Fargate, fronted by the shared sandbox ALB) has two surfaces with very
different load behavior:

- **Read path** — `GET /v1/foods/search`, `GET /v1/foods/:id`, `GET /v1/foods/:id/status`. Served by
  the API tasks (`FOOD_DESIRED_COUNT=2`) over Postgres. Where real concurrency lives.
- **Write / ingestion path** — `POST /v1/foods` (add-by-name) enqueues into a Postgres `fetch_queue`
  drained by a **single worker** (`FOOD_WORKER_DESIRED_COUNT=1`, FR-022), throttled by a USDA
  rolling-window limiter (`FOOD_SOURCE_RATE_LIMIT_PER_HOUR`) and a queue depth cap
  (`FOOD_MAX_QUEUE_DEPTH=25`). It calls **real, paid, quota-limited USDA FDC** downstream.

Because the ingestion path is deliberately throttled and upstream-bound, its "max load" is set by the
USDA rate limit (≈500 foods/hr through a signed key) long before any infrastructure limit — so this
test **measures the throttle-bound supported rate**; it does not attempt to break hardware.

Auth is a Clerk **session token** (Bearer), verified networkless against the sandbox Clerk instance
(`CLERK_JWT_KEY`), with `azp` enforced (`CLERK_AUTHORIZED_PARTIES`). On first request the service
read-through-creates the user (Clerk `sub` → app ULID). There is deliberately no header auth bypass.

## Approach

A **k6** script drives the **realistic user journey** — `search → add-by-name → poll status` — against
the live sandbox, as a pool of **distinct Clerk test users** (VU _i_ → token _i_), over a staged profile:

1. **Baseline** — light traffic to establish healthy latency/error reference.
2. **Hold at target** — sustain the throttle-bound supported rate for a fixed duration; assert health.
3. **Over-ramp** — increase arrival rate past target until the USDA limiter / queue-25 saturate; record
   the sustained supported throughput and how the system sheds load.

USDA stays **real** throughout — the throttle saturating **is** the ceiling we document. No throttle,
worker, or config changes; no attempt to reach a hardware breakpoint (see Rejected alternatives).

## Requirements

### Functional

- **FR-1 — Journey script.** Each VU iteration performs a realistic `search → add-by-name → poll
status until terminal (RESOLVED/UNRESOLVED/NOT_FOUND)` flow with human-like think-time between steps.
- **FR-2 — Varied corpus.** VUs draw from a corpus of many real food queries (not one repeated key), so
  the run exercises breadth rather than cache/dedup on a single item.
- **FR-3 — Distinct-user auth.** A setup step provisions **N Clerk test users** in the sandbox instance
  and obtains a session token per user (correct `azp`); VU _i_ sends token _i_. Handle token lifetime.
- **FR-4 — Staged profile.** Baseline → hold-at-target → over-ramp, with configurable stage durations
  and arrival rates.
- **FR-5 — Server-side observation.** Correlate k6 client metrics (latency, error mix, throughput) with:
  CloudWatch (ECS CPU/mem, RDS CPU/connections, ALB 5xx) and the food admin endpoints
  (`GET /v1/foods/admin/queue`, `GET /v1/foods/admin/metrics`) plus status-outcome distribution.
- **FR-6 — Teardown.** Remove the test users' added foods and the provisioned Clerk test users after
  the run (the per-PR DB is isolated, but the Clerk users live on the shared sandbox instance).

### Success criteria

- **Hold phase (pass/fail):** read p95 latency under target; add-by-name returns `PENDING` promptly;
  unexpected 5xx rate under ~1%; `fetch_queue` never exceeds its cap with corruption; no ECS task
  restarts; system returns to baseline latency within minutes after load drops. Exact thresholds set at
  plan time.
- **Ramp phase (deliverable):** a documented **sustained supported throughput** (adds/hr and read req/s)
  at saturation, plus the degradation signature — how excess adds are shed (clear rejections /
  `UNRESOLVED`, not 5xx storms), queue behavior at the cap, and recovery time.

## Scope boundaries

**In scope:** the k6 harness, the distinct-user auth provisioning, the food-query corpus, the
observation/correlation plan, and the written capacity + degradation findings.

**Rejected alternatives (considered, deliberately not doing):**

- **Stubbed-USDA infra-breakpoint test** — would find the hardware ceiling of the ingestion machine, but
  requires intercepting USDA and raising throttles; throttle-bound reality is the point of this run.
- **Raising throttles / scaling the worker** — diverges from the as-deployed config we want to validate.
- **Read-path-only breakpoint** — a valid separate test (seed catalog, no USDA, break the serving tier),
  but not what "simulate users requesting food items" is asking for here.

**Deferred:** prod load testing; wiring this into CI as a recurring gate.

## Assumptions

- "Max load we support" is the throttle-bound rate this test **measures**, not a pre-existing SLA number.
- Peak concurrency / pool size is **dozens, not thousands** — real USDA (≈500 foods/hr) cannot absorb more.
- The run happens **outside** the nightly sandbox shutdown window (i.e. 09:00–24:00 ET).
- Test-user tokens can be minted with an `azp` the sandbox `CLERK_AUTHORIZED_PARTIES` accepts.

## Risks / dependencies

- **Shared-sandbox blast radius.** The ramp loads the shared sandbox RDS (`db.t4g.micro`, co-tenant with
  other PR previews' logical DBs) and burns the **shared** sandbox USDA key's hourly quota — it can
  briefly degrade other previews or exhaust the key. Bounded (no hardware-break attempt) but real.
- **Representativeness.** Numbers reflect `db.t4g.micro` + Fargate Spot, **not** prod (`db.t4g.small`,
  on-demand) — treat the ceiling as a lower-bound smoke signal, not prod capacity.
- **Dependency — token provisioning.** Needs a way to create Clerk test users + session tokens in the
  sandbox instance (Clerk backend API), with correct `azp`. Feasibility of this gates FR-3.

## Outstanding questions (for planning)

- Exact hold-phase thresholds (read p95, add-accept latency, 5xx budget, recovery window).
- Concrete `N` (user pool / peak VUs) and the stage durations/arrival rates for the k6 profile.
- Source of the food-query corpus (curated list vs sampled from a known-good set).
- The precise token-provisioning mechanism and lifetime handling (FR-3 dependency).
