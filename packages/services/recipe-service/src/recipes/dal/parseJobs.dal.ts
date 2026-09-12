/**
 * `ParseJobsDal` (plan U9, origin D9/R13) — the SQL truth behind `ParseJobsService`'s
 * {@link ParseJobsDalPort}.
 *
 * DESIGN PATTERN: Repository over the shared Drizzle client, the `RecipesDal` shape. Three rules of this
 * table live in the WHERE clauses rather than in service code, `resolutionMappings.dal.ts`'s discipline
 * ("the WHERE clauses ARE the authorization — zero rows returned IS the denial"):
 *
 *  1. **Owner scoping**: every read and mutation carries `owner_id = :caller`. A stranger's poll and a
 *     missing job are ONE answer (`undefined` / `missing`) so the API cannot confirm a foreign job exists.
 *  2. **Expiry is derived, not polled**: mutations refuse when `status = 'expired'` OR `expires_at` has
 *     passed — the 15-minute sweep (recipe-workers `bandDrain`) only makes the stored status catch up, so
 *     a retry cannot sneak into the sweep's lag window.
 *  3. **R17's edit half is ONE UPDATE**: `source_line`, `line_digest`, `status = 'pending'` and the
 *     cleared landing move together, so there is no instant where a landing for the old phrase could
 *     match the new digest (the worker guards on the STORED digest).
 *
 * ⚠️ The job-status aggregate is `PARSE_JOB_AGGREGATE_SQL` from `@kitchensink/recipe-core` — the ONE
 * representation both writers (this DAL and the worker's landing path) apply; see its docstring. It is a
 * `$1`-parameterized pg text, so it runs on the injected `pg.Pool` exactly as the worker runs it — never
 * through `sql.raw` (banned by lint for good reason). That places it OUTSIDE the mark's own statement; the
 * window is benign and self-healing (a stale `running` job with retryable lines still retries, and the
 * next landing recomputes the aggregate), which is also precisely the worker's own crash posture.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type pg from 'pg';
import { PARSE_JOB_AGGREGATE_SQL } from '@kitchensink/recipe-core/parsing/parse-job-aggregate';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipeParseJobLines, recipeParseJobs } from '../../database/schema/parseJobs.js';
import { COPYABLE_LINE_STATUSES, type CopyForwardCandidate } from '../domain/copyForwardPolicy.js';
import type {
    NewParseJobLine,
    ParseJobMutation,
    ParseJobRecord,
    ParseJobsDalPort,
    ReenqueueableLine,
} from '../parseJobs.service.js';

/**
 * The copyable statuses as a SQL literal list, DERIVED from the policy's own constant.
 *
 * ⛔ Not restated. "Which landed statuses carry an answer" is one rule with one authority
 * ({@link COPYABLE_LINE_STATUSES}), and it is load-bearing in a way that fails silently: `failed_retryable`
 * must stay OUT — it means "we kept trying and could not get to it", which is absence rather than a reading,
 * and copying it would turn a transient outage into a permanent fact about an ingredient. A second copy of
 * the list in SQL could admit it with nothing to notice, because the policy would then simply never see a
 * row it would have refused.
 *
 * Safe to interpolate: the values are a frozen `as const` tuple of identifiers this module owns, never
 * input. Everything caller-supplied in this statement stays a bound parameter.
 */
const COPYABLE_STATUS_LIST = COPYABLE_LINE_STATUSES.map((status) => `'${status}'`).join(', ');

/**
 * Every previously landed answer this caller could copy — NEWEST PER DIGEST, and no more.
 *
 * ⛔ `DISTINCT ON` is not a tidiness choice, and it is not merely a bound either. A digest this owner has
 * submitted hundreds of times ("1 tsp salt") would otherwise return hundreds of `proposal` jsonb blobs on
 * every create; the index makes the lookup cheap but does not bound the row count. So the statement bounds
 * the fetch — AND, because it bounds it to ONE row per digest, this `ORDER BY … DESC` is also the only
 * thing that decides WHICH answer is copied.
 *
 * ⛔ THIS STATEMENT IS THE ORDERING AUTHORITY. `copyForwardPolicy.ts` has a newest-wins loop, but with one
 * row per digest reaching it that loop maximises over a singleton and CANNOT re-check this. Flip the `DESC`
 * to `ASC` and the oldest answer is served with every unit test still green. What protects it is an
 * integration case — "copies the most recently landed answer when a digest has several" in
 * `__tests__/integration/parseJobs/parseJobCopyForward.integration.test.ts`, which builds two eligible
 * candidates and is verified to fail when this clause is reversed. Do not weaken it on the belief that the
 * policy re-asserts it; an earlier version of this comment said exactly that and was wrong.
 *
 * ⚠️ The policy DOES independently re-assert the other two gates, and they are the ones it can: the status
 * set (`carriesAnAnswer`) and the recency window — the window is not redundant because the two checks read
 * DIFFERENT CLOCKS, this statement against the database's `now()` and the policy against an injected one.
 *
 * ⛔ `l.copied_at IS NULL` is the ANTI-LAUNDERING predicate (migration 0048): a copied row's `updated_at` is
 * its INSERT time, so letting a copy be a copy source would present an ever-refreshing landing time and
 * defeat both the recency window and the corrections watermark.
 *
 * ⛔ The job's STATUS is deliberately NOT filtered. An `expired` job's lines are a valid source — expiry
 * ends the cook's review session, not the parse's validity — and excluding them would shrink the pool from
 * the purge horizon (~8 days) to the 24-hour TTL and make copy-forward nearly useless. The real bound is
 * `expireParseJobs`' DELETE seven days past expiry, which cascades to these rows.
 *
 * ⛔ `j.owner_id = $1` IS THE AUTHORIZATION, in the WHERE clause — `resolutionMappings.dal.ts`' discipline.
 * Zero rows is the denial, and a stranger's identical line is simply not a candidate.
 */
const COPY_FORWARD_CANDIDATES_SQL = `SELECT DISTINCT ON (l.line_digest)
        l.line_digest, l.status, l.proposal, l.llm_attempts, l.updated_at AS landed_at
   FROM recipe_parse_job_lines l
   JOIN recipe_parse_jobs j ON j.id = l.job_id
  WHERE j.owner_id = $1
    AND l.line_digest = ANY($2::text[])
    AND l.status IN (${COPYABLE_STATUS_LIST})
    AND l.proposal IS NOT NULL
    AND l.copied_at IS NULL
    AND l.updated_at >= now() - make_interval(hours => $3)
  ORDER BY l.line_digest, l.updated_at DESC`;

/**
 * The newest moment anything in this caller's VISIBLE correction set changed.
 *
 * ⛔ THE DISCHARGE OF THE CORRECTIONS ORDERING RULE. `parsePipeline.ts` owns "a human correction outranks a
 * cached parse"; copy-forward is a tier ABOVE corrections, in this deployable, which cannot consult that
 * tier. Without this, a cook corrects a parse, re-pastes, and silently gets the pre-correction answer back.
 *
 * ⛔ It asks only whether the set MOVED — never which correction wins. `parsePorts.ts` warns by name that
 * two readers with different precedence let a correction bind on one path and not the other, so this
 * deliberately does NOT re-derive `findInForce`'s ordering.
 *
 * ⛔ `superseded_at` is inside the `GREATEST` because a retraction is a bare UPDATE with no accompanying
 * insert — `max(created_at)` alone would miss a correction being withdrawn.
 *
 * ⚠️ Scope mirrors `findInForce`'s visibility (`global` OR the caller's own), which is why the watermark is
 * per-caller rather than install-wide.
 */
const CORRECTIONS_WATERMARK_SQL = `SELECT max(GREATEST(created_at, COALESCE(superseded_at, created_at))) AS changed_at
   FROM ingredient_parse_corrections
  WHERE scope = 'global' OR ($1::text IS NOT NULL AND user_id = $1)`;

export class ParseJobsDal implements ParseJobsDalPort {
    public constructor(
        private readonly db: RecipeDrizzle,
        /** For the shared `$1`-parameterized aggregate — the same driver form the worker uses. */
        private readonly pool: pg.Pool,
    ) {}

    /** @inheritdoc */
    public async findCopyForwardCandidates(
        ownerId: string,
        digests: readonly string[],
        maxAgeHours: number,
    ): Promise<readonly CopyForwardCandidate[]> {
        // ⚠️ An empty batch never reaches the database, and a zero window never asks: `maxAgeHours = 0` is
        // the kill switch, and a query that cannot match is a query not worth issuing.
        if (digests.length === 0 || maxAgeHours <= 0) {
            return [];
        }

        const result = await this.pool.query(COPY_FORWARD_CANDIDATES_SQL, [ownerId, [...digests], maxAgeHours]);

        return (
            result.rows as {
                line_digest: string;
                status: string;
                proposal: unknown;
                llm_attempts: number | null;
                landed_at: Date;
            }[]
        ).map((row) => ({
            lineDigest: row.line_digest,
            status: this.lineStatusOf(row.status),
            proposal: row.proposal,
            llmAttempts: row.llm_attempts,
            landedAt: row.landed_at,
        }));
    }

    /** @inheritdoc */
    public async correctionsChangedAt(ownerId: string): Promise<Date | null> {
        const result = await this.pool.query(CORRECTIONS_WATERMARK_SQL, [ownerId]);

        return (result.rows[0] as { changed_at: Date | null } | undefined)?.changed_at ?? null;
    }

    /** @inheritdoc */
    public async createJob(
        ownerId: string,
        lines: readonly NewParseJobLine[],
        expiresAt: Date,
    ): Promise<ParseJobRecord> {
        // ⛔ THE JOB'S STATUS IS DERIVED IN THIS TRANSACTION, not recomputed after it — and that is the whole
        // remedy for copy-forward's hang. A copied line NEVER lands, so the worker never runs
        // `PARSE_JOB_AGGREGATE_SQL` for it; an all-copied job left `running` would sit with zero pending
        // lines until the TTL swept it, invisible to `POST :id/retry` (which re-drives only
        // `failed_retryable`). A post-commit aggregate call would fix the symptom and open a durability gap
        // that does not exist today: in the all-copies case NOTHING else will ever call the aggregate, so a
        // crash between commit and that query strands the job with no self-heal.
        //
        // ⚠️ `running` for a mixed job is exactly what the aggregate's first arm would have kept anyway, and
        // the worker's landings drive it from there — so the two representations agree by construction. An
        // integration assertion pins that running the aggregate afterwards is a no-op.
        const pending = lines.filter((line) => line.decision.kind === 'enqueue').length;
        const status = pending > 0 ? ('running' as const) : ('complete' as const);

        return this.db.transaction(async (tx) => {
            const [job] = await tx.insert(recipeParseJobs).values({ ownerId, expiresAt, status }).returning();

            if (job === undefined) {
                throw new Error('parse job insert returned no row');
            }

            const inserted = await tx
                .insert(recipeParseJobLines)
                .values(
                    lines.map((line, index) => ({
                        jobId: job.id,
                        lineIndex: index,
                        sourceLine: line.sourceLine,
                        lineDigest: line.lineDigest,
                        status: line.decision.kind === 'copy' ? line.decision.status : ('pending' as const),
                        proposal: line.decision.kind === 'copy' ? line.decision.proposal : null,
                        llmAttempts: line.decision.kind === 'copy' ? line.decision.llmAttempts : null,
                        // ⛔ Stamped ONLY on a copy — it is the predicate that stops this row becoming a
                        // copy source in its turn (migration 0048).
                        copiedAt: line.decision.kind === 'copy' ? new Date() : null,
                    })),
                )
                .returning();

            return {
                id: job.id,
                status,
                createdAt: job.createdAt,
                expiresAt: job.expiresAt,
                lines: inserted
                    .sort((a, b) => a.lineIndex - b.lineIndex)
                    .map((line) => ({
                        lineIndex: line.lineIndex,
                        sourceLine: line.sourceLine,
                        lineDigest: line.lineDigest,
                        status: this.lineStatusOf(line.status),
                        proposal: line.proposal ?? null,
                        llmAttempts: line.llmAttempts,
                    })),
            };
        });
    }

    /** @inheritdoc */
    public async getJob(ownerId: string, jobId: string): Promise<ParseJobRecord | undefined> {
        const [job] = await this.db
            .select()
            .from(recipeParseJobs)
            .where(and(eq(recipeParseJobs.id, jobId), eq(recipeParseJobs.ownerId, ownerId)));

        if (job === undefined) {
            return undefined;
        }

        const lines = await this.db
            .select()
            .from(recipeParseJobLines)
            .where(eq(recipeParseJobLines.jobId, jobId))
            .orderBy(asc(recipeParseJobLines.lineIndex));

        return {
            id: job.id,
            status: this.statusOf(job.status),
            createdAt: job.createdAt,
            expiresAt: job.expiresAt,
            lines: lines.map((line) => ({
                lineIndex: line.lineIndex,
                sourceLine: line.sourceLine,
                lineDigest: line.lineDigest,
                status: this.lineStatusOf(line.status),
                proposal: line.proposal ?? null,
                llmAttempts: line.llmAttempts,
            })),
        };
    }

    /** @inheritdoc */
    public async markLinesFailedRetryable(jobId: string, lineIndexes: readonly number[]): Promise<void> {
        if (lineIndexes.length === 0) {
            return;
        }

        // ⚠️ Only from `pending`: a landing that raced in between the enqueue failure and this mark is
        // BETTER information than the failure — a parsed line must not be regressed to retryable.
        await this.db
            .update(recipeParseJobLines)
            .set({ status: 'failed_retryable', updatedAt: sql`now()` })
            .where(
                and(
                    eq(recipeParseJobLines.jobId, jobId),
                    inArray(recipeParseJobLines.lineIndex, [...lineIndexes]),
                    eq(recipeParseJobLines.status, 'pending'),
                ),
            );
        await this.pool.query(PARSE_JOB_AGGREGATE_SQL, [jobId]);
    }

    /** @inheritdoc */
    public async resetForRetry(
        ownerId: string,
        jobId: string,
    ): Promise<ParseJobMutation<{ readonly lines: readonly ReenqueueableLine[] }>> {
        return this.db.transaction(async (tx) => {
            const gate = await this.gateMutation(tx, ownerId, jobId);

            if (gate !== 'ok') {
                return { kind: gate };
            }

            // ⛔ The CLAIM COUNTERS reset with the status (U6), or the retry is a button that does nothing.
            // A line made `failed_retryable` because it exhausted its delivery allowance re-enters the queue
            // with `attempts` already at the allowance, so the very first delivery of the retry would claim,
            // see itself over budget and mark it retryable again — a loop the cook can press forever. The
            // lease clears for the same reason: a retry enqueued within the lease window would be refused as
            // a duplicate of the delivery that failed, and `failure_code` is the previous answer, which must
            // not outlive the attempt it described.
            const reset = await tx
                .update(recipeParseJobLines)
                .set({
                    status: 'pending',
                    attempts: 0,
                    lastReceivedAt: null,
                    failureCode: null,
                    updatedAt: sql`now()`,
                })
                .where(and(eq(recipeParseJobLines.jobId, jobId), eq(recipeParseJobLines.status, 'failed_retryable')))
                .returning({
                    lineIndex: recipeParseJobLines.lineIndex,
                    sourceLine: recipeParseJobLines.sourceLine,
                    lineDigest: recipeParseJobLines.lineDigest,
                });

            if (reset.length > 0) {
                // Explicitly `running`, NOT the aggregate: its first arm KEEPS the current status while
                // lines are pending, which would leave a `partial` job `partial` — see the shared SQL's docs.
                await tx
                    .update(recipeParseJobs)
                    .set({ status: 'running', updatedAt: sql`now()` })
                    .where(eq(recipeParseJobs.id, jobId));
            }

            return { kind: 'ok', lines: reset.sort((a, b) => a.lineIndex - b.lineIndex) };
        });
    }

    /** @inheritdoc */
    public async editLine(
        ownerId: string,
        jobId: string,
        lineIndex: number,
        sourceLine: string,
        digest: string,
    ): Promise<ParseJobMutation<{ readonly line: ReenqueueableLine }>> {
        return this.db.transaction(async (tx) => {
            const gate = await this.gateMutation(tx, ownerId, jobId);

            if (gate !== 'ok') {
                return { kind: gate };
            }

            // R17: text, digest, status and the cleared landing move in ONE statement.
            //
            // ⛔ The CLAIM COUNTERS clear with them (U6). The stale digest already stops the OLD message
            // landing, but the NEW one would claim against `attempts` inherited from a phrase it has
            // nothing to do with — so a line edited after exhausting its allowance would be refused on its
            // first delivery, which is the cook fixing the very thing we asked them to fix and being
            // ignored for it. `failure_code` goes for the same reason: it described the old phrase.
            //
            // ⛔ AND `copied_at` GOES WITH THEM, on that same rule. An edit rewrites `line_digest`, so the
            // row is now ABOUT a different phrase and cannot still be a copy of the old one. Leaving it set
            // costs three things, none of which raises: migration 0048's `COMMENT ON COLUMN` ("NULL means
            // the worker landed it") becomes false for every copied → edited → landed row; the copy-forward
            // hit rate, whose only observable measure is this column, over-counts permanently; and — the one
            // a cook feels — `COPY_FORWARD_CANDIDATES_SQL` filters on `l.copied_at IS NULL`, so a genuinely
            // worker-landed answer would be excluded from the candidate pool FOREVER. That is worst on the
            // line most likely to be pasted again, because the cook has just fixed it.
            const [line] = await tx
                .update(recipeParseJobLines)
                .set({
                    sourceLine,
                    lineDigest: digest,
                    status: 'pending',
                    proposal: null,
                    llmAttempts: null,
                    attempts: 0,
                    lastReceivedAt: null,
                    failureCode: null,
                    copiedAt: null,
                    updatedAt: sql`now()`,
                })
                .where(and(eq(recipeParseJobLines.jobId, jobId), eq(recipeParseJobLines.lineIndex, lineIndex)))
                .returning({
                    lineIndex: recipeParseJobLines.lineIndex,
                    sourceLine: recipeParseJobLines.sourceLine,
                    lineDigest: recipeParseJobLines.lineDigest,
                });

            if (line === undefined) {
                return { kind: 'missing' };
            }

            await tx
                .update(recipeParseJobs)
                .set({ status: 'running', updatedAt: sql`now()` })
                .where(eq(recipeParseJobs.id, jobId));

            return { kind: 'ok', line };
        });
    }

    /**
     * Rule 1 + rule 2 of the module docstring, for mutations: `missing` for stranger/absent, `expired`
     * when the TTL has passed — whether or not the sweep already flipped the stored status.
     *
     * @sideEffect Reads (and row-locks) the job inside the caller's transaction.
     */
    private async gateMutation(
        tx: Parameters<Parameters<RecipeDrizzle['transaction']>[0]>[0],
        ownerId: string,
        jobId: string,
    ): Promise<'ok' | 'missing' | 'expired'> {
        const [job] = await tx
            .select({ status: recipeParseJobs.status, expiresAt: recipeParseJobs.expiresAt })
            .from(recipeParseJobs)
            .where(and(eq(recipeParseJobs.id, jobId), eq(recipeParseJobs.ownerId, ownerId)))
            .for('update');

        if (job === undefined) {
            return 'missing';
        }

        if (job.status === 'expired' || job.expiresAt.getTime() <= Date.now()) {
            return 'expired';
        }

        return 'ok';
    }

    /** Narrow a stored job status. A value outside the CHECK'd set is a defect worth throwing on. Pure. */
    private statusOf(status: string): ParseJobRecord['status'] {
        if (status === 'running' || status === 'partial' || status === 'complete' || status === 'expired') {
            return status;
        }

        throw new Error(`unknown parse job status '${status}'`);
    }

    /** Narrow a stored line status. Pure. */
    private lineStatusOf(status: string): ParseJobRecord['lines'][number]['status'] {
        if (status === 'pending' || status === 'parsed' || status === 'unparseable' || status === 'failed_retryable') {
            return status;
        }

        throw new Error(`unknown parse job line status '${status}'`);
    }
}
