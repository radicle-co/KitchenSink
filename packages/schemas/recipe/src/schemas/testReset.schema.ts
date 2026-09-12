/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/account/testReset.schema.ts

/**
 * AUTHORED WIRE CONTRACT for the test-principal self-purge (ADR-0040): `POST /api/v1/account/test-reset` and
 * `GET /api/v1/account/test-reset/{jobId}`.
 *
 * SOURCE OF TRUTH; copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY `zod`,
 * `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules (allowlist in `contract/config.ts`).
 *
 * @pattern Command — the request records a durable job and hands the purge to the account-erasure worker; the GET
 *   is the command's status query, which CI polls.
 *
 * ⛔ THIS IS A FIXTURE DOOR, NOT A PRODUCT SURFACE, and three decisions follow from that:
 *
 *  1. **Only a test principal can see it exists.** A caller that is not a signed test principal the service's
 *     registry also knows answers `404 NOT_FOUND` — the same code as a path this service does not route — so the
 *     door is indistinguishable from absent to every real user.
 *  2. **There is NO request body.** The principal is the verified token; there is no `ownerId` to smuggle and no
 *     target to name. A principal can purge only itself.
 *  3. **It is REPEATABLE.** Unlike erasure's one-shot `410 ALREADY_ERASED`, a completed reset does not block the
 *     next — a pool slot is reset before and after every run, forever.
 *
 * `lastError` is deliberately not published: it carries worker-internal SQL text, and the status is what a poller
 * needs to decide whether to proceed.
 */
import { z } from 'zod';

/**
 * Every lifecycle status of a test-reset job.
 *
 * ⚠️ The same four values as `erasureJobStatusSchema`, and DECLARED SEPARATELY on purpose: the two jobs change for
 * different reasons (erasure's `completed` is terminal and legally meaningful; a reset's is one run's checkpoint),
 * and sharing the enum would couple a legal contract to a fixture's. The drizzle column's array `satisfies` this.
 */
export const testResetJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);

/** A lifecycle status of a test-reset job. */
export type TestResetJobStatus = z.infer<typeof testResetJobStatusSchema>;

/** The in-flight subset a `202` can report: a fresh job is `queued`, a job already running is returned as-is. */
export const activeTestResetJobStatusSchema = z.enum(['queued', 'running']);

/** An in-flight status of a test-reset job. */
export type ActiveTestResetJobStatus = z.infer<typeof activeTestResetJobStatusSchema>;

/** The `202` body of `POST /api/v1/account/test-reset`: the job now purging the caller. `{ jobId, status }` only. */
export const testResetAcceptedResponseSchema = z
    .object({
        /** The reset job's id (`test_reset_jobs.id`, a UUID) — the path parameter of the status query. */
        jobId: z.string().min(1),
        /** `queued` for a newly enqueued job; `running` when an in-progress job is returned idempotently. */
        status: activeTestResetJobStatusSchema,
    })
    .readonly();

/** The `202` acceptance body for a test reset. */
export type TestResetAcceptedResponse = z.infer<typeof testResetAcceptedResponseSchema>;

/** The `200` body of `GET /api/v1/account/test-reset/{jobId}`: where one of the caller's own reset jobs stands. */
export const testResetJobResponseSchema = z
    .object({
        jobId: z.string().min(1),
        status: testResetJobStatusSchema,
        /** ISO 8601 — when the reset was requested. */
        createdAt: z.string(),
        /** ISO 8601 — the job's last state change. */
        updatedAt: z.string(),
    })
    .readonly();

/** The status body of one test-reset job. */
export type TestResetJobResponse = z.infer<typeof testResetJobResponseSchema>;
