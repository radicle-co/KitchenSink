-- Post-migration assertions for 0001_ai_initial (feature 005 — AI Integration).
--
-- Runnable as-is against the migrated kitchensink_ai database. Every check RAISES EXCEPTION on
-- failure, so a non-zero exit is the pass/fail signal — this is a gate, not a report you read.
--
-- These are written as REGRESSION GUARDS, not a restatement of forward.sql. Each one fails against
-- a specific defect that was actually present in an earlier revision of the data model, or against
-- an architectural rule that a well-meaning "fix" would violate. A check that would pass whether or
-- not the schema were correct has no business here.

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_missing TEXT;
    v_count   INT;
    v_def     TEXT;
BEGIN
    -- ── 1. All four tables exist ──────────────────────────────────────────────────────────────────
    SELECT string_agg(t, ', ') INTO v_missing
    FROM unnest(ARRAY[
        'ai_generation_records', 'user_byok_keys', 'mcp_agent_grants', 'prompt_templates'
    ]) AS t
    WHERE to_regclass('public.' || quote_ident(t)) IS NULL;

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL(1): missing table(s): %', v_missing;
    END IF;

    -- ── 2. D-005 REGRESSION GUARD — the defect this schema exists to correct ──────────────────────
    -- The composite unique (user_id, provider) MUST exist: one key per provider, up to three
    -- concurrently per user.
    SELECT count(*) INTO v_count
    FROM pg_constraint
    WHERE conrelid = 'public.user_byok_keys'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute
              WHERE attrelid = 'public.user_byok_keys'::regclass AND attname = 'user_id'),
            (SELECT attnum FROM pg_attribute
              WHERE attrelid = 'public.user_byok_keys'::regclass AND attname = 'provider')
          ]::smallint[];

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FAIL(2): user_byok_keys is missing the COMPOSITE unique (user_id, provider). D-005 '
            'approved one key per PROVIDER; without this constraint the schema cannot express it.';
    END IF;

    -- ...and a SINGLE-COLUMN unique on user_id MUST NOT exist. This is the actual defect: it silently
    -- degrades the model to one key per USER, which passes every happy-path test and breaks D-005.
    SELECT count(*) INTO v_count
    FROM pg_constraint
    WHERE conrelid = 'public.user_byok_keys'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 1
      AND conkey[1] = (SELECT attnum FROM pg_attribute
                        WHERE attrelid = 'public.user_byok_keys'::regclass AND attname = 'user_id');

    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'FAIL(2b): user_byok_keys has a COLUMN-LEVEL unique on user_id. That permits exactly one '
            'BYOK key per user and directly violates approved decision D-005.';
    END IF;

    -- ── 3. prompt_templates versioning guard ──────────────────────────────────────────────────────
    -- Composite (template_key, version) present...
    SELECT count(*) INTO v_count
    FROM pg_constraint
    WHERE conrelid = 'public.prompt_templates'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 2;

    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FAIL(3): prompt_templates is missing the composite unique (template_key, version).';
    END IF;

    -- ...and NO column-level unique on template_key, which would make versioning impossible. The
    -- previous revision declared BOTH, which is self-contradictory.
    SELECT count(*) INTO v_count
    FROM pg_constraint
    WHERE conrelid = 'public.prompt_templates'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 1
      AND conkey[1] = (SELECT attnum FROM pg_attribute
                        WHERE attrelid = 'public.prompt_templates'::regclass AND attname = 'template_key');

    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'FAIL(3b): prompt_templates has a column-level unique on template_key — versioning is '
            'impossible with it present.';
    END IF;

    -- ── 4. mcp_agent_grants uses revoked_at TIMESTAMPTZ, not is_revoked BOOLEAN ───────────────────
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE a.attrelid = 'public.mcp_agent_grants'::regclass
          AND a.attname = 'revoked_at'
          AND t.typname = 'timestamptz'
    ) THEN
        RAISE EXCEPTION 'FAIL(4): mcp_agent_grants.revoked_at is absent or not TIMESTAMPTZ.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.mcp_agent_grants'::regclass AND attname = 'is_revoked'
    ) THEN
        RAISE EXCEPTION
            'FAIL(4b): mcp_agent_grants.is_revoked exists. The boolean form loses WHEN a grant was '
            'revoked (audit requirement) and makes the partial index inexpressible.';
    END IF;

    -- ── 5. The partial index must be PARTIAL ──────────────────────────────────────────────────────
    -- A non-partial index here still answers the query, so a plain existence check would pass while
    -- silently losing the property. Assert the predicate itself.
    SELECT indexdef INTO v_def FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_mcp_grants_active';

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'FAIL(5): index idx_mcp_grants_active is missing.';
    END IF;
    IF v_def NOT ILIKE '%WHERE%revoked_at IS NULL%' THEN
        RAISE EXCEPTION
            'FAIL(5b): idx_mcp_grants_active exists but is NOT partial. Definition was: %', v_def;
    END IF;

    -- ── 6. ARCHITECTURAL GUARD — no foreign keys, at all ──────────────────────────────────────────
    -- 005 owns no users/recipes tables; user_id and output_entity_id are deliberately un-keyed TEXT
    -- (plan.md §2, matching recipe-service D2). A cross-database FK is not expressible, so ANY FK
    -- appearing on these tables means someone reintroduced local duplication of another service's
    -- data. Fail loudly rather than let the coupling ship.
    SELECT count(*) INTO v_count
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN (
          'public.ai_generation_records'::regclass, 'public.user_byok_keys'::regclass,
          'public.mcp_agent_grants'::regclass,      'public.prompt_templates'::regclass
      );

    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'FAIL(6): % foreign key(s) found. 005 must own no cross-service references — user_id is '
            'an unkeyed app ULID by design (plan.md §2).', v_count;
    END IF;

    -- ── 7. Idempotency + job identity are enforced by the DATABASE, not by application code ───────
    -- SQS is at-least-once; if these uniques are absent, a redelivery silently double-charges the
    -- user's provider account and writes a duplicate audit row.
    SELECT count(*) INTO v_count
    FROM pg_constraint
    WHERE conrelid = 'public.ai_generation_records'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 1
      AND conkey[1] IN (
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.ai_generation_records'::regclass AND attname = 'idempotency_key'),
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.ai_generation_records'::regclass AND attname = 'job_id')
      );

    IF v_count <> 2 THEN
        RAISE EXCEPTION
            'FAIL(7): ai_generation_records must carry UNIQUE on BOTH idempotency_key and job_id '
            '(found % of 2). SQS at-least-once delivery makes these the only real dedup guard.', v_count;
    END IF;

    -- ── 8. CHECK constraints on the controlled value sets ─────────────────────────────────────────
    -- TEXT + CHECK is the repo convention instead of native enums; without the CHECK the column is
    -- just free text and the "controlled" set is fiction.
    SELECT count(*) INTO v_count
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN (
          'public.ai_generation_records'::regclass, 'public.user_byok_keys'::regclass
      );

    IF v_count < 5 THEN
        RAISE EXCEPTION
            'FAIL(8): expected >= 5 CHECK constraints across ai_generation_records (generation_type, '
            'status, provider, output_entity_kind) and user_byok_keys (provider); found %.', v_count;
    END IF;

    -- ── 9. Supporting indexes present ─────────────────────────────────────────────────────────────
    SELECT string_agg(i, ', ') INTO v_missing
    FROM unnest(ARRAY[
        'idx_ai_gen_user', 'idx_ai_gen_job', 'idx_ai_gen_status', 'idx_mcp_grants_user'
    ]) AS i
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = i
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL(9): missing index(es): %', v_missing;
    END IF;

    RAISE NOTICE 'PASS: all 0001_ai_initial assertions satisfied.';
END $$;
