-- 0049 — a per-digest lease, so two concurrent workers do not both parse a line nobody has answered yet.
--
-- ⛔ WHY THIS EXISTS AND WHY IT DID NOT BEFORE. Dedup has three layers: copy-forward refuses to queue a
-- line this owner has already answered, `ingredient_parse_cache` answers a line ANYONE has already
-- answered, and the pipeline collapses a line repeated inside one paste. All three need an answer to
-- already exist. The one case none of them covers is two submissions of a NEVER-ANSWERED digest in flight
-- together: both read the cache, both miss, both call the engines.
--
-- ⚠️ In every non-prod stage that window is shut by the deployment rather than by this table —
-- `consumerConcurrency.ts` gives the parse consumer `reservedConcurrentExecutions: 1` and
-- `RecipeWorkersStack.ts` sets its event source to `batchSize: 1`, so messages are handled one at a time
-- and the second finds the cache warm. Prod is configured at 5. This table is what makes the guarantee a
-- property of the SYSTEM instead of a property of one number in an infra file, which is the kind of
-- dependency that gets tuned by somebody who does not know it is load-bearing.
--
-- ⛔ A LEASE, NOT A LOCK. Nothing here may be held across the engine call: an advisory lock would hold a
-- pooled connection for the seconds a parse takes, and a row with no expiry would let a worker that died
-- mid-parse block its digest forever. Those crashes correlate with exactly the conditions this exists to
-- contain, so the expiry is the mechanism, not a nicety. `claimLine` in recipe-workers'
-- `src/handlers/parseLine.ts` already applies this idiom to a job LINE — its re-claim predicate is
-- `last_received_at < now() - make_interval(secs => $4)`. This applies the same shape to a DIGEST.
CREATE TABLE IF NOT EXISTS ingredient_parse_leases (
    line_digest text PRIMARY KEY,
    leased_until timestamptz NOT NULL
);

COMMENT ON TABLE ingredient_parse_leases IS
    'One row per in-flight parse. A row means some worker is asking the engines about that line right '
    'now. Rows are transient: the holder deletes its own on the way out, and a holder that dies leaves '
    'one that expires. Never read for an answer — the answer lives in ingredient_parse_cache.';

COMMENT ON COLUMN ingredient_parse_leases.line_digest IS
    'The LINE, not the cache key. ingredient_parse_cache is keyed per (line_digest, engine, '
    'engine_version) because it stores one answer per engine, but the worker asks BOTH engines in one '
    'pipeline call and that call is what is being serialised — so the unit of work, and therefore of the '
    'lease, is the line. Keying it per engine would need two leases for one indivisible call.';

COMMENT ON COLUMN ingredient_parse_leases.leased_until IS
    'When this lease stops being honoured. A row past it is indistinguishable from no row, so a dead '
    'holder costs at most one duplicate parse rather than a permanently stuck digest.';

-- ⛔ NO SECONDARY INDEX. Both statements this table has — the conditional upsert and the fenced delete —
-- address it by PRIMARY KEY, so an index on `leased_until` would serve zero reads while adding write
-- amplification to a table that takes two writes per parse. The index a reader reaches for is one over
-- `leased_until`, for "the reaper's range over what has expired" — but there is no reaper, and building an
-- index for a component that does not exist is the speculative capability YAGNI names. If orphan rows are
-- ever judged to need sweeping, that is a decision with a real sweeper behind it — and it can bring its
-- own index.
--
-- ⚠️ Orphans are bounded without one: a row is deleted by its holder, and a row a dead holder left is
-- taken over by the next acquirer of the same line. Only a digest never parsed again keeps a row, at two
-- small columns each.
