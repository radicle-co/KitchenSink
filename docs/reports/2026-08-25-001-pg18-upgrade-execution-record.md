# PostgreSQL 16 → 18 upgrade — execution record

The change ticket `docs/runbooks/pg18-upgrade.md` repeatedly asks for. Both stages are now on **18.3**.
Executed **manually via the AWS CLI**, not through the CDK/merge path the runbook's Phase 4 assumes —
an owner instruction, and the more controlled option, because the merge path starts the outage unattended
from CI (`prod-deploy.yml` fires on `packages/infra/global/**` and `ApplyImmediately` defaults to true).

|                   |                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| Account / region  | the project's AWS account (`<aws-account-id>`) / `us-east-1`                                       |
| Sandbox           | `kitchensink-data-sandbox-…-p76w6xmz1xlk` — **already 18.3** on arrival, upgraded 2026-08-22T05:19 |
| Production        | `kitchensink-data-prod-…-ci1yhovuyivm` — **16.13 → 18.3**, 2026-08-25                              |
| Rollback snapshot | `kitchensink-data-prod-pre-pg18-202608250618` — `available`, **16.13**, 100 GB                     |

## The measured window

From prod's own RDS event trail — the number Phase 2 exists to produce:

```
06:33:38  pre-check started
06:33:40  pre-check finished              ← 2s, clean
06:33:42  DB instance shutdown            ┐
06:36:23  engine version upgrade started  │  ~3m 03s of database unavailability
06:36:32  DB instance restarted           │
06:36:45  engine version upgrade finished ┘
06:37:00  major version upgrade complete: 16.13.R1 → 18.3.R2
06:40:21  available
```

⚠️ The **rehearsal** (`pg18-rehearsal`, restored from prod's 2026-08-24 snapshot, same class) measured
**6m 51s** wall-clock for the same operation. Prod was FASTER. `pg_upgrade` runs in hard-link mode, so
duration tracks the number of databases and objects rather than the 100 GB — which is why the estimate was
conservative rather than wrong.

## ⛔ Two open questions in the runbook are now ANSWERED, from prod's own `pg_upgrade` log

Both were marked unverified in the runbook and are settled by evidence, not inference:

- **D3 — RDS does NOT pass `--no-statistics`.** The log shows `--statistics` six times and the flag never.
  Most statistics transferred; `pg_upgrade` still recommends an `ANALYZE`. The runbook's "run `ANALYZE`
  regardless" instruction stands, now backed by the tool's own output.
- **D5 — `datlocprovider = 'c'`** (`datcollate = 'en_US.UTF-8'`). Phase 0c makes the PG 18 FTS/`pg_trgm`
  collation-provider change conditional on this being anything OTHER than `c`. **No FTS or trigram reindex
  is required**, and the `flor` case at the 0.600 threshold is unaffected.

## What was verified

- **Phase 1 A2 (halt gate) PASSED** — 16.13 lists 18.3, 18.4 and 18.6 as valid one-hop major targets. RDS
  resolved the bare `18` prefix to **18.3** on both the clone and prod, so the prefix-resolution hazard the
  runbook warns about did not materialise.
- **Phase 2 dry run PASSED** on a clone of prod's own snapshot: 35 consistency checks `ok`, `Upgrade Complete`.
- **Object inventory IDENTICAL** — 208 relations, compared as `(relname, reloid)` SETS rather than counts,
  matching per database: `kitchensink_identity` 36, `kitchensink_recipes` 84, `kitchensink_food` 78, plus
  `postgres`/`rdsadmin`/`template1`. ⚠️ The first attempt at this comparison returned "all match" from all
  ZEROES because the parser missed the line format; the figure above is from a re-run carrying a non-vacuity
  assertion. A matching count means nothing without proof the comparison had subjects.
- **All three services green on `/health/ready`** — the probe that actually issues `SELECT 1`.
- Endpoint unchanged; `default.postgres16` → `default.postgres18` automatically; `DeletionProtection: true`
  and 7-day retention both preserved.
- Repo guards 10/10, including `engineVersionDiff` — `EXPECTED_ENGINE_VERSION` was already `'18'`, so prod
  was behind the code rather than ahead of it.

## ⛔ What was NOT verified — residual risk, stated plainly

The prod instance is **not publicly accessible**, there are **no SSM-managed hosts**, **ECS exec is disabled**
on all prod services, and the tasks authenticate with **RDS IAM tokens** rather than a password secret. So
there was no SQL path to prod at any point, and these remain open:

1. **⛔ Row counts (D2 / R53).** The structural half is proven; the row-level half is not, and the
   pre-upgrade baseline it compares against was never captured. `pg_upgrade` link mode either succeeds
   wholesale or aborts — silent partial row loss is not a documented failure mode — but _undocumented_ is
   not _verified_, and D2 exists precisely to not take that on trust. This is also the documented trigger
   for the only rollback that exists, so **the decision that fires the rollback is the one that cannot be
   made.**
2. **⛔ `ANALYZE` (D3) was not run.** Expect first-query latency until autovacuum catches up.
3. **⛔ The extension-update notice (D4) is unactioned.** `Checking for extension updates → notice` fired on
   both the clone and prod; neither log names the extension. ⚠️ Being unable to run `update_extensions.sql`
   is PROTECTIVE here: the runbook forbids updating `pg_trgm` speculatively because the ranking baselines
   were measured against 1.6, and a wholesale run would move it silently. Sandbox could not answer this
   either — its `pg_upgrade` log has already rotated out.
4. **⛔ B5, the rollback rehearsal, was NOT performed.** The snapshot is verified and B1 exercised the
   restore mechanic (a prod snapshot restored cleanly to a new instance), but **E5's open question — whether
   a restored instance keeps the original endpoint address — is still open.** It decides between a rename-
   and-restore (no template change) and a repoint (replacement-forcing, and `deletionProtection: true` makes
   the retiring instance's delete FAIL and wedge the stack). ⚠️ `FOOD_DB_ENDPOINT` and `DB_HOST` are literal
   hostnames in the task environments, so an endpoint change forces a redeploy of food and recipe as well as
   identity — the runbook's E6 lists only identity and is incomplete for today's topology.
5. **Phase 3 steps 1, 3 and 5** (Phase 1 against sandbox, Phase 5 in full on sandbox, judgement set and
   access-path guard re-run) cannot be confirmed from outside AWS. Sandbox satisfied step 2 (deployed) and
   step 4 (soak — three complete nightly stop/start cycles plus three automated backups over ~3 days, the
   step the runbook calls un-shortenable). ⚠️ If sandbox was equally unreachable for SQL then D2–D5 were
   skipped there too, meaning R54's "full suite green" demonstrated OPERATIONAL survival but not the
   data-integrity checks it was designed to demonstrate.

## ⚠️ The access gap is NETWORK, not credentials — and closing it is cheap

The master secret exists (`DatabaseCredentialsSecret74-yvA07sCZCgGc`) and the identity migration Lambda reads
it at runtime. What is missing is reachability. A one-off SSM-managed `t4g.nano` in the VPC, or temporarily
enabling `enableExecuteCommand` on one service, restores full SQL — hours of work, not days. **Doing either
BEFORE the next window is dramatically better than improvising during one**, and it would have made items
1–3 above routine rather than impossible.

## ⛔ Do NOT invoke the identity migration Lambda as a verification step

`kitchensink-identity-webh-MigrationFunction1060F2E-AA0URkR6WkJ4` bundles
`0005_identity_reset.sql`, which opens `DROP TABLE IF EXISTS users CASCADE`. The only thing preventing that
is a row in `schema_migrations`. **If `pg_upgrade` had damaged the identity database, invoking this as a
"did it survive?" check would not report the damage — it would complete it, transactionally, and return
success.** The guard is in fact intact (the log shows `public.schema_migrations` and `public.users` in both
clusters), which lowers the probability and not the blast radius.

⚠️ Food and recipe runners additionally accept `action: 'drop'`. On prod the base-name short-circuit makes it
inert, but a mistyped payload aimed at a production database during an incident is not worth a check that
returns no row counts.

## Rollback, if it is ever needed

`kitchensink-data-prod-pre-pg18-202608250618` is the sole input. It is **16.13** — verified, because a
snapshot taken after the upgrade is worthless for rollback. Every write committed since **2026-08-25T06:18:42Z**
would be lost. Follow Phase 6, and read E5 first: the variant choice is still undecided.
