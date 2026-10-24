-- 0039 — the async parse-job resource's substrate (plan U8/U9, origin D9/R13).
--
-- Parsing is an ASYNC JOB, never a polymorphic body on recipe create (D9's ruling): the API accepts a
-- block of text, answers 202 with a job id, the worker parses line by line, and the cook reviews the
-- PROPOSALS (R19 — a parse binds nothing; the reviewed draft goes through ordinary POST /recipes, which
-- re-validates every food id through by-food admission).
--
-- ⛔ R17's stale-landing rule is STRUCTURAL here: `line_digest` is the phrase's SHA-256 as the producer
-- stored it, the landing UPDATE is guarded `WHERE line_digest = <recomputed>`, and the edit mutation
-- atomically updates the stored hash and re-enqueues — so a landing for an edited line's OLD phrase
-- matches zero rows and disappears, and the job still reaches a terminal state without waiting for TTL.
--
-- ⛔ Jobs are USER-KEYED and TTL'd: `owner_id` scopes every poll/retry (a stranger gets 404), the erasure
-- sweep deletes a cook's jobs outright (the rows carry their pasted text — user content, swept), and the
-- TTL sweep expires abandoned jobs (an abandoned job mints zero catalog entities, because proposals bind
-- nothing).

CREATE TABLE recipe_parse_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id varchar(255) NOT NULL,
    -- running → every line pending/in flight; partial → some lines failed-retryable; complete → every
    -- line terminal (parsed or unparseable); expired → the TTL sweep closed it.
    status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'partial', 'complete', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX recipe_parse_jobs_owner_idx ON recipe_parse_jobs (owner_id, created_at DESC);
CREATE INDEX recipe_parse_jobs_expiry_idx ON recipe_parse_jobs (expires_at);

CREATE TABLE recipe_parse_job_lines (
    job_id uuid NOT NULL REFERENCES recipe_parse_jobs(id) ON DELETE CASCADE,
    line_index integer NOT NULL CHECK (line_index >= 0),
    -- The cook's text, verbatim (user content — erased with the job).
    source_line text NOT NULL,
    -- R17: the phrase hash the producer stored; landings are guarded on it.
    line_digest text NOT NULL,
    -- pending → no landing yet; parsed → a proposal landed; unparseable → the validator loop exhausted
    -- (terminal, R6); failed_retryable → an engine outage, re-runnable line by line.
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'parsed', 'unparseable', 'failed_retryable')),
    -- The merged ParsedLine projection — PROPOSALS ONLY (R19): nothing here binds a food or creates one.
    proposal jsonb,
    -- U7/R8: how many LLM attempts the landing took. NULL until a landing exists.
    llm_attempts integer,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, line_index)
);

COMMENT ON TABLE recipe_parse_jobs IS
    'U8/U9: async parse jobs — user-keyed, TTL''d, erased with their owner; proposals only.';
COMMENT ON TABLE recipe_parse_job_lines IS
    'U8/U9: one row per submitted line; landings are digest-guarded (R17) and bind nothing (R19).';
