-- 0036 — the band-authority substrate (plan U3, KTD-B): earned autonomy's three tables, plus the band
-- key's third axis on the provenance events.
--
-- A BAND is a confidence shape — (rung, margin_band, query_shape, ranker_version) — and authority is the
-- earned right for lexical resolutions in that shape to skip the verification gate. The POLICY lives in
-- `@kitchensink/recipe-core` `resolution/bandPolicy.ts` (pure, truth-table tested); these tables are its memory.
--
-- ⛔ `ranker_version` is part of EVERY key (R15): a ladder or prior change re-earns authority from
-- scratch — the old version's rows stay as history, the new version starts at `observing` with nothing.
--
-- ⛔ `resolution_band_skips` stores the READY verification message, built by the PRODUCER at skip time —
-- the one moment all message machinery is in hand. Revocation then flips state and the scheduled drain
-- sends stored messages under spend headroom (R14), with no message-rebuilding outside the producer (the
-- DRY line this table exists to hold). Content-keyed verdicts make a stale stored message safe: it can
-- only re-verify what it described.

CREATE TABLE resolution_band_authority (
    rung text NOT NULL,
    margin_band text NOT NULL,
    query_shape text NOT NULL,
    ranker_version text NOT NULL,
    -- The KTD-B state machine. CHECKed: a typo'd state must not silently read as "not authorized".
    state text NOT NULL DEFAULT 'observing' CHECK (state IN ('observing', 'authorized', 'revoked')),
    -- Increments on each grant; skips record the epoch they happened under (R14).
    epoch integer NOT NULL DEFAULT 0,
    granted_at timestamptz,
    revoked_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (rung, margin_band, query_shape, ranker_version)
);

CREATE TABLE resolution_band_observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rung text NOT NULL,
    margin_band text NOT NULL,
    query_shape text NOT NULL,
    ranker_version text NOT NULL,
    -- ⛔ agree/disagree ONLY: a could-not-judge is ABSENCE, never an observation (ADR-0026 §3's rule one
    -- layer up), and R16's human corrections land as 'disagree'.
    verdict text NOT NULL CHECK (verdict IN ('agree', 'disagree')),
    -- Where the verdict came from: the gate's answer, a shadow sample, or a human correction (R16).
    source text NOT NULL DEFAULT 'gate' CHECK (source IN ('gate', 'shadow', 'correction')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resolution_band_observations_band_idx
    ON resolution_band_observations (rung, margin_band, query_shape, ranker_version);

CREATE TABLE resolution_band_skips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rung text NOT NULL,
    margin_band text NOT NULL,
    query_shape text NOT NULL,
    ranker_version text NOT NULL,
    epoch integer NOT NULL,
    -- The ready `VerifyIngredientLineMessage`, verbatim.
    message jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Set when the revocation drain sent this message. Never deleted: the row is the audit of what
    -- skipped under which epoch.
    drained_at timestamptz
);

-- The drain reads "undrained skips of a revoked epoch, oldest first".
CREATE INDEX resolution_band_skips_drain_idx
    ON resolution_band_skips (ranker_version, rung, margin_band, query_shape, epoch)
    WHERE drained_at IS NULL;

-- The band key's third axis, recorded at resolve time (single-token vs multi-word — the two retrieval
-- strategies rank differently, so their confidence shapes are different bands).
ALTER TABLE ingredient_resolutions ADD COLUMN query_shape text;

-- And the fourth: the ranker version the resolution was made UNDER. The worker's band feedback keys its
-- observation on the version that produced the shortlist, not on whatever version is deployed when the
-- verdict lands — a deploy between resolve and verdict must not pollute the new version's fresh record.
ALTER TABLE ingredient_resolutions ADD COLUMN ranker_version text;

COMMENT ON TABLE resolution_band_authority IS
    'U3: per-band earned-autonomy state. The policy is bandPolicy.ts; this is its memory.';
COMMENT ON TABLE resolution_band_observations IS
    'U3: the measured record — gate verdicts, shadow samples, and human corrections (R16) per band.';
COMMENT ON TABLE resolution_band_skips IS
    'U3: band-authorized skips with their ready verification message, for revocation''s drain (R14).';
