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
import type { ParseJobMutation, ParseJobRecord, ParseJobsDalPort, ReenqueueableLine } from '../parseJobs.service.js';

export class ParseJobsDal implements ParseJobsDalPort {
    public constructor(
        private readonly db: RecipeDrizzle,
        /** For the shared `$1`-parameterized aggregate — the same driver form the worker uses. */
        private readonly pool: pg.Pool,
    ) {}

    /** @inheritdoc */
    public async createJob(
        ownerId: string,
        lines: readonly { readonly sourceLine: string; readonly lineDigest: string }[],
        expiresAt: Date,
    ): Promise<ParseJobRecord> {
        return this.db.transaction(async (tx) => {
            const [job] = await tx.insert(recipeParseJobs).values({ ownerId, expiresAt }).returning();

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
                    })),
                )
                .returning();

            return {
                id: job.id,
                status: 'running' as const,
                createdAt: job.createdAt,
                expiresAt: job.expiresAt,
                lines: inserted
                    .sort((a, b) => a.lineIndex - b.lineIndex)
                    .map((line) => ({
                        lineIndex: line.lineIndex,
                        sourceLine: line.sourceLine,
                        lineDigest: line.lineDigest,
                        status: 'pending' as const,
                        proposal: null,
                        llmAttempts: null,
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

            const reset = await tx
                .update(recipeParseJobLines)
                .set({ status: 'pending', updatedAt: sql`now()` })
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
            const [line] = await tx
                .update(recipeParseJobLines)
                .set({
                    sourceLine,
                    lineDigest: digest,
                    status: 'pending',
                    proposal: null,
                    llmAttempts: null,
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
