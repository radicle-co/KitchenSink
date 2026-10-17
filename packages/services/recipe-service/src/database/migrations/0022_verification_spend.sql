-- 0022_verification_spend.sql (plan U11 / R23, ADR-0024) — the LLM verification gate's spend ceiling.
--
-- ⛔ THIS TABLE IS THE CEILING. Not a report of it, not a metric about it — the thing that actually stops the
-- call. ADR-0024 §1 enumerates every AWS mechanism and none of them gates Bedrock inference at a dollar
-- threshold in near-real-time: quotas are denominated in tokens and are increase-only, application inference
-- profiles are attribution, Budgets (and Budget ACTIONS, which fire off the same evaluation) carry an 8–12h
-- detection lag, and Cost Anomaly Detection is alert-only at up to 24h. So the gate is our code, which is also
-- AWS's own published position.
--
-- ⛔ IT LIVES IN THE RECIPE SERVICE'S MIGRATIONS, NOT recipe-workers'. `recipe-workers` ships no migration SQL
-- and no runner: `RecipeWorkersStack`'s in-deploy barrier deploys RECIPE-SERVICE's runner via
-- `migrationBundlePath` (ADR-0022). SQL filed anywhere else is never applied, and the gate then fails closed
-- on every call — a silent, total outage of verification that looks like a healthy deploy.
--
-- ⛔ POSTGRES, NOT DYNAMODB. An earlier draft specified DynamoDB on a claim that `RecipeWorkersStack` already
-- owned a table. It owns none, and carries no DynamoDB client. Removing the false premise left the choice
-- unargued, and the honest answer is the database the worker is already bound to: recipe-workers ships
-- `drizzle-orm`, `pg` and `@aws-sdk/rds-signer`, and every one of its Lambdas is VPC-attached for the sole
-- purpose of reaching this RDS. No dependency, no IAM surface, no CDK construct — and decisively, no new
-- failure domain. A separate store's outage would close the gate while everything else is healthy; Postgres
-- going down stops the worker regardless.
--
-- ⛔ ONE CEILING, MONTHLY, AND ONE ROW PER PERIOD. An earlier draft added a ~$5 daily sub-ceiling. It was
-- removed by owner ruling (2026-08-21): a monthly ceiling is a HARD CAP, not a slow detector — a runaway that
-- completes inside a day still stops at $100 — while a daily cap denies legitimate bulk work and never
-- enforced the monthly figure it sat under (31 x $5 = $155 > $100). It would also turn the single-row
-- invariant below into two, and two invariants means the reserve pair has to become one transaction so a
-- denial on the second cannot leave the first charged. Do not reintroduce one without re-deriving that.
--
-- ⛔ THE SHAPE IS RESERVE-THEN-SETTLE, and the obvious alternative is broken in a way that hides. "Read the
-- counter, call Bedrock, increment from the response's `usage`" has a DURABILITY defect that
-- `reservedConcurrency = 1` does not fix: reserved concurrency removes the read-modify-write RACE and does
-- nothing about a Lambda that dies between a successful response and the increment. The money is spent and
-- the counter never learns — and those crashes are CORRELATED with the runaway the ceiling exists to stop, so
-- the counter under-reports precisely when it matters. A counter that reports green during a runaway is worse
-- than no counter. So we charge worst case BEFORE the call and refund after, mirroring Bedrock's own quota
-- burndown, which deducts `input + max_tokens` at request start and replenishes the unused remainder.
--
--   RESERVE (one statement, no prior read):
--     INSERT INTO verification_spend (period, reserved_micros)
--     VALUES ($period, $worst)
--     ON CONFLICT (period) DO UPDATE
--        SET reserved_micros = verification_spend.reserved_micros + $worst,
--            updated_at      = now()
--      WHERE verification_spend.reserved_micros <= $headroom
--     RETURNING reserved_micros;
--   ZERO ROWS RETURNED IS THE BUDGET DENIAL — the row exists and the WHERE failed.
--
--   SETTLE (never retried; see the CHECK below):
--     UPDATE verification_spend
--        SET reserved_micros = reserved_micros + $delta,   -- $delta = $actual - $worst, normally negative
--            settled_micros  = settled_micros  + $actual,
--            calls           = calls + 1,
--            updated_at      = now()
--      WHERE period = $period;                             -- the period captured at RESERVE, never recomputed
--
-- `$headroom` is `CEILING - $worst`, so the worst case is subtracted BEFORE the comparison. That is what
-- bounds reserved spend AT the ceiling rather than at `ceiling + one call`, and it holds under ARBITRARY
-- concurrency because `INSERT … ON CONFLICT DO UPDATE` takes a row lock and concurrent callers serialize on
-- the one row, each seeing the latest value. The bound therefore does NOT depend on `reservedConcurrency = 1`,
-- which is free to change later for throughput.
--
-- EXPAND-ONLY (ADR-0022). One new table; nothing existing is altered, dropped or rewritten, so it is safe to
-- apply BEFORE the code that reads it — the order the in-stack migration Trigger enforces. There is no
-- down-migration in any runner here; recovery is `DROP TABLE`, and the data is a monthly spend estimate that
-- rebuilds itself at the next period boundary.
--
-- NO PERSONAL DATA. One row per calendar month holding four integers. Nothing here is linkable to a person,
-- so it is correctly outside the right-to-erasure sweep.

CREATE TABLE "verification_spend" (
    -- `YYYY-MM`, UTC — computed by `periodKey()` in `@kitchensink/recipe-core/spend/spend-arithmetic`.
    -- ⛔ UTC because that is what AWS bills on, so this counter and layer 5's audit budget agree on where the
    -- month boundary is. The key is captured at RESERVE and carried into SETTLE; recomputing it at settle
    -- time is a real bug — a call spanning midnight on the 1st would reserve against month M and settle
    -- against M+1, leaving M permanently over-reserved and M+1 permanently over-charged.
    "period" text PRIMARY KEY,

    -- Micro-dollars (1,000,000 = $1) currently CHARGED against the ceiling: the sum of every worst-case
    -- reservation taken this period, less every refund settled. `bigint` rather than `integer` because the
    -- ceiling is configurable and int4 tops out at ~$2,147 — a limit nobody would think to look for. The live
    -- $100 ceiling is 100,000,000, six orders of magnitude below `Number.MAX_SAFE_INTEGER`, so the driver's
    -- string-valued int8 parses to a safe JS number.
    "reserved_micros" bigint NOT NULL DEFAULT 0,

    -- Micro-dollars ACTUALLY spent, accumulated from each response's reported `usage`. This is the number
    -- layer 5's $20 Bedrock-filtered budget disagrees with when our rate table has gone stale; the ceiling
    -- itself is enforced against `reserved_micros`, never this.
    "settled_micros" bigint NOT NULL DEFAULT 0,

    -- Settled calls this period. With `settled_micros` it gives a cost-per-call an operator can sanity-check
    -- against the rate table without reading a log.
    "calls" bigint NOT NULL DEFAULT 0,

    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),

    -- The period key is a derived, machine-written value, so a malformed one means a code defect rather than
    -- bad input — and a malformed key silently creates a SECOND row for the same month, which would hand the
    -- ceiling twice the budget. Refusing it here makes that defect loud.
    CONSTRAINT "verification_spend_period_format" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

    -- ⛔ THIS CHECK IS THE ANTI-DOUBLE-REFUND GUARD, and it is the reason a settle is NEVER retried.
    -- `reserved_micros + $delta` is not idempotent with a negative delta: a settle that is auto-retried
    -- refunds most of the reservation twice, reintroducing exactly the silent under-count reserve-then-settle
    -- exists to prevent. In any correct sequence this column cannot go negative — every settle subtracts at
    -- most what its own reserve added — so a violation IS a duplicate settle, and the constraint converts the
    -- one forbidden operation from a silent under-count into a loud error the worker meters.
    CONSTRAINT "verification_spend_reserved_nonnegative" CHECK ("reserved_micros" >= 0),

    CONSTRAINT "verification_spend_settled_nonnegative" CHECK ("settled_micros" >= 0),
    CONSTRAINT "verification_spend_calls_nonnegative" CHECK ("calls" >= 0)
);

-- ⛔ NO INDEX BEYOND THE PRIMARY KEY, DELIBERATELY. Every access is a point lookup on `period`, which the PK
-- already serves, and the table holds one row per calendar month — twelve rows a year. An index here would be
-- write amplification on the hottest single row in the system in exchange for nothing.
--
-- ⚠️ Scale is a non-issue and was checked rather than assumed: ~8,000 writes a month against one row is about
-- 0.003 writes/second. Single-row contention is worth revisiting above ~1,000 writes/second; we are five
-- orders of magnitude away, and `reservedConcurrency = 1` currently serializes the writer anyway.
