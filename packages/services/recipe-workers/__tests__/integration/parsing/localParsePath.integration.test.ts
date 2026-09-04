/**
 * THE CROSSING: a real SQS queue → the local consumer → the real pipeline and engines → a real PostgreSQL
 * landing. The tier the parse leg never had.
 *
 * ## ⛔ WHY `parseLeg.integration.test.ts` IS NOT THIS
 *
 * Its sibling calls `processParseLine` DIRECTLY, with an inline fake CRF, an inline fake Bedrock client and
 * an inline fake ledger. That proves the STORAGE claims it names — the cache's `ON CONFLICT`, the
 * corrections predicate, R17's zero-row discard — and it is right to exist. What it structurally cannot
 * prove is everything BETWEEN a message being enqueued and the handler being called, which is exactly where
 * the local path was broken:
 *
 *  - nothing consumed the queue at all (no `dev` script, no Dockerfile, no local Lambda);
 *  - the queue the producer sent to and the queue the sandbox created were different queues;
 *  - the LLM leg had no local substitute, so it could only have called real Bedrock;
 *  - and no test crossed those boundaries, so all three were invisible behind green suites.
 *
 * So this file drives the SHIPPED local wiring — `createLocalParseLineDeps`, `sqsParseQueuePort`,
 * `drainParseQueue`, `handleLocalParseMessage` — over a real broker and a real database, and builds no deps
 * object of its own. A hand-assembled deps here would be a second wiring, and the one under test would go
 * back to being unexercised.
 *
 * ## What each dependency being absent means
 *
 *  - **No `DATABASE_URL` / no LocalStack** — the whole file skips. CI provides both
 *    (`integration-recipe-workers`: Postgres with the recipe migrations applied, LocalStack `SERVICES:
 *    s3,sqs`), so the crossing RUNS in CI whether or not a developer has Docker.
 *  - **No `ingredient-parser-nlp` for the local interpreter** — the whole file skips, and CI asserts that
 *    this can never be the CI answer (see below).
 *
 * ## ⛔ CORRECTED 2026-09-03: an absent CRF engine is NOT survivable, and this file used to claim it was
 *
 * The header said the CRF leg "answers ABSENCE, which is ADR-0026 §3's `single-engine`, and the line still
 * lands". That is false against the shipped code, and the false claim is why the engine gate sat on ONE `it`
 * while the shared `beforeAll` needed it: `handlers/parseLine.ts` pushes everything an ENGINE throws into
 * `transientFailures` and re-throws BEFORE any landing — deliberately, because ADR-0026's 2026-08-31 update
 * puts "a CRF invocation failure" in the transient set so an outage cannot become a line's PERMANENT answer.
 * `crfInvoke.ts` says the same from the other side: "an adapter that returns absence instead of throwing is
 * reported NOWHERE, which is exactly how this shipped."
 *
 * So the engine is a PRECONDITION of this whole file, not of one assertion in it, and `canRun` now says so.
 * The consequence CI must not inherit is a vacuous skip, which `_ci.yml`'s
 * `integration-recipe-workers` closes by OBSERVING `import ingredient_parser` and failing the job if it does
 * not answer — the same pairing the `services` unit group uses for `crfEngineVersionParity.test.ts`, and the
 * one `pythonEngineTierWiring.test.ts` now asserts for every python-dependent tier.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
    CreateQueueCommand,
    GetQueueAttributesCommand,
    PurgeQueueCommand,
    SendMessageCommand,
    SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { drainParseQueue, sqsParseQueuePort } from '../../../src/local/parseQueueConsumer.js';
import { createLocalParseLineDeps, handleLocalParseMessage } from '../../../src/local/localParseLine.js';
import { ENGINE_HANDLER_DIR, pinnedCrfEngineVersion } from '../../../src/local/localCrfEngine.js';
import { disposableDatabaseUrl } from '../disposableDatabaseUrl.js';

const DATABASE_URL = disposableDatabaseUrl();
/** CI sets `AWS_ENDPOINT_URL` and `S3_ENDPOINT`; `local:up` developers set `SQS_ENDPOINT`. Any of them. */
const SQS_ENDPOINT = process.env['SQS_ENDPOINT'] ?? process.env['AWS_ENDPOINT_URL'] ?? process.env['S3_ENDPOINT'];

/** The queue this file provisions for itself, as the S3 specs provision their buckets. */
const QUEUE_NAME = 'local-parse-path-integration';
const OWNER = 'local-parse-path-owner';
const LINE = '2 cups local path flour, sifted';
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Whether the CRF engine is importable by the local interpreter.
 *
 * ⛔ A PRECONDITION of the whole file, not of one assertion — see the header. `python3 -c "import
 * ingredient_parser"` is the exact statement `handler.py` makes on line 38, so this probe and the subject
 * fail together or not at all; reading the distribution's metadata instead would answer `true` for an
 * install whose native extension does not load.
 *
 * @returns `true` when `ingredient_parser` loads. Impure.
 * @sideEffect Spawns a Python process once.
 */
function crfEngineAvailable(): boolean {
    try {
        execFileSync('python3', ['-c', 'import ingredient_parser'], { stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

/**
 * Every precondition this crossing needs, in one place.
 *
 * CI provides all three (`integration-recipe-workers`: Postgres with the recipe migrations applied,
 * LocalStack `SERVICES: s3,sqs`, and the pinned CRF engine), and it ASSERTS the engine separately so this
 * gate can never turn a broken install into a green run of nothing.
 */
const canRun = Boolean(DATABASE_URL) && Boolean(SQS_ENDPOINT) && crfEngineAvailable();

describe.skipIf(!canRun)('the LOCAL parse path, end to end (integration)', () => {
    let pool: pg.Pool;
    let client: SQSClient;
    let queueUrl: string;
    let deps: ReturnType<typeof createLocalParseLineDeps>;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        client = new SQSClient({
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            endpoint: SQS_ENDPOINT as string,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        const created = await client.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
        queueUrl = created.QueueUrl as string;

        deps = createLocalParseLineDeps(
            {
                stage: 'dev',
                databaseUrl: DATABASE_URL as string,
                queueUrl,
                sqsEndpoint: SQS_ENDPOINT as string,
                region: process.env['AWS_REGION'] ?? 'us-east-1',
                python: 'python3',
            },
            pool,
        );
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM recipe_parse_jobs WHERE owner_id = $1`, [OWNER]);
        await pool.query(`DELETE FROM ingredient_parse_cache WHERE line_digest = $1`, [lineDigest(LINE, digest)]);
        await pool.end();
        client.destroy();
    });

    /** One job with one line, ready to be driven. @returns the job id and the stored digest. */
    async function seedJob(line: string): Promise<{ jobId: string; storedDigest: string }> {
        const job = await pool.query(
            `INSERT INTO recipe_parse_jobs (owner_id, expires_at)
             VALUES ($1, now() + interval '1 day') RETURNING id`,
            [OWNER],
        );
        const jobId = (job.rows[0] as { id: string }).id;
        const storedDigest = lineDigest(line, digest);

        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest)
             VALUES ($1, 0, $2, $3)`,
            [jobId, line, storedDigest],
        );

        return { jobId, storedDigest };
    }

    /** Run the SHIPPED consumer for exactly one poll. @returns what it did. */
    async function drainOnce(): Promise<{ processed: number; failed: number }> {
        let polls = 0;

        return drainParseQueue({
            queue: sqsParseQueuePort({ client, queueUrl, waitTimeSeconds: 5 }),
            handle: (body) => handleLocalParseMessage(deps, body),
            onError: (error) => {
                throw error;
            },
            shouldContinue: () => {
                polls += 1;

                return polls <= 1;
            },
        });
    }

    /** How many messages the broker still holds. */
    async function queueDepth(): Promise<number> {
        const attributes = await client.send(
            new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['ApproximateNumberOfMessages'] }),
        );

        return Number(attributes.Attributes?.['ApproximateNumberOfMessages'] ?? '0');
    }

    /**
     * ONE crossing, asserted from several angles.
     *
     * ⚠️ Driven in a hook rather than in the first `it`, because the landing, the cache write and the CRF
     * contribution are three facts about the SAME run. Chaining them as ordered `it`s would make each one's
     * failure depend on the previous one having executed — a suite that reports three failures for one
     * cause, and that breaks the day someone runs a single test by name.
     */
    let firstRun: { jobId: string; summary: { processed: number; failed: number } };

    beforeAll(async () => {
        const { jobId, storedDigest } = await seedJob(LINE);

        await client.send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify({
                    jobId,
                    lineIndex: 0,
                    sourceLine: LINE,
                    lineDigest: storedDigest,
                    userId: OWNER,
                    requestedAt: new Date().toISOString(),
                }),
            }),
        );

        firstRun = { jobId, summary: await drainOnce() };
    });

    it('⛔ a message on the real queue lands a parsed line in the real database', async () => {
        const { jobId, summary } = firstRun;

        expect(summary).toEqual({ processed: 1, failed: 0 });

        const landed = await pool.query(
            `SELECT status, proposal FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0`,
            [jobId],
        );
        const row = landed.rows[0] as { status: string; proposal: { foods: { name: string }[] } | null };

        // ⛔ The whole point: `pending` here means the queue filled and nothing drained it — the exact state
        // every locally-pasted ingredient line was left in.
        expect(row.status, 'the line did not land — nothing consumed the queue').toBe('parsed');
        expect(row.proposal?.foods.map((food) => food.name)).toContain('local path flour');

        const job = await pool.query(`SELECT status FROM recipe_parse_jobs WHERE id = $1`, [jobId]);

        expect((job.rows[0] as { status: string }).status).toBe('complete');
    });

    it('⛔ the pipeline really wrote through to the parse CACHE — a claim only a database can settle', async () => {
        // KTD-F's amplification bound IS this table: a redelivered message re-reads it before any engine
        // call. A cache tier that silently no-op'd would leave every retry re-paying for every engine, and
        // nothing in a unit suite over an in-memory double would notice.
        const cached = await pool.query(
            `SELECT engine, engine_version FROM ingredient_parse_cache WHERE line_digest = $1 ORDER BY engine`,
            [lineDigest(LINE, digest)],
        );

        expect(cached.rows.length, 'no engine answer reached the cache').toBeGreaterThan(0);
        expect(
            (cached.rows as { engine: string }[]).map((row) => row.engine),
            'the offline LLM substitute must reach the cache like any other engine answer',
        ).toContain('llm');
    });

    it('⛔ the CRF leg answered from the DEPLOYED handler, under the pinned engine version', async () => {
        // Runs the real `packages/services/ingredient-parser/src/handler.py`. ⚠️ The per-`it`
        // `skipIf(!crfEngineAvailable())` this case carried was REMOVED rather than kept as harmless
        // belt-and-braces: it said the surrounding cases run without the engine, which is the false
        // claim the header now corrects, and it is why nobody noticed the shared `beforeAll` needed it
        // too. The precondition is the describe's.
        expect(ENGINE_HANDLER_DIR).toMatch(/ingredient-parser[/\\]src$/u);

        const cached = await pool.query(
            `SELECT engine_version FROM ingredient_parse_cache WHERE line_digest = $1 AND engine = 'crf'`,
            [lineDigest(LINE, digest)],
        );

        expect(cached.rows.length, 'the CRF engine is installed but contributed no answer').toBe(1);
        expect((cached.rows[0] as { engine_version: string }).engine_version).toBe(pinnedCrfEngineVersion());
    });

    it('⛔ a stale digest is a TERMINAL discard: nothing lands, and the message is still acknowledged', async () => {
        // R17 across the WIRE this time, not through a direct call: the consumer must delete a message whose
        // handler returned, even though that handler deliberately landed nothing. A consumer that keyed
        // acknowledgement on "something changed" would redeliver this forever.
        const other = 'a line that is not the stored one';
        const { jobId } = await seedJob(other);

        await pool.query(`UPDATE recipe_parse_job_lines SET line_digest = 'moved-on' WHERE job_id = $1`, [jobId]);
        await client.send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify({
                    jobId,
                    lineIndex: 0,
                    sourceLine: other,
                    lineDigest: lineDigest(other, digest),
                    userId: OWNER,
                    requestedAt: new Date().toISOString(),
                }),
            }),
        );

        expect(await drainOnce()).toEqual({ processed: 1, failed: 0 });

        const after = await pool.query(
            `SELECT status FROM recipe_parse_job_lines WHERE job_id = $1 AND line_index = 0`,
            [jobId],
        );

        expect((after.rows[0] as { status: string }).status).toBe('pending');
        expect(await queueDepth()).toBe(0);

        await client.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
    });
});
