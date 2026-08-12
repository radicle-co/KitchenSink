/**
 * ARCH-PS-3 — the recipe service's health surface, split into liveness and readiness.
 *
 *   - `GET /health`       — **liveness**: a static `ok` (the process is up). No dependency checks, so a
 *     transient DB blip never restarts a healthy container. Mirrors the identity/food `/health`.
 *   - `GET /health/ready` — **readiness**: a cheap `SELECT 1` against the Drizzle pool (bounded by a
 *     short timeout). `200` when the DB answers, `503` when it does not — so a load balancer / ECS can
 *     drain a task that has lost its database without killing it.
 *
 * Both routes are unauthenticated (see `AuthMiddleware.PUBLIC_PATHS`).
 *
 * Both `200` payloads also carry `contractHash` — the wire-contract fingerprint this binary was built
 * against, and the SKEW SIGNAL for drift layer 3 (CODING_STANDARDS §15.2.5). See `health.schema.ts` for why it
 * is published unauthenticated and why it leaks nothing.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type pg from 'pg';

import { CONTRACT_HASH } from '../contract/contract-hash.js';
import { apiError } from '../common/api-error.js';
import type { HealthStatus } from './health.schema.js';
import { PgPoolProvider } from '../database/database.module.js';

/** Upper bound on the readiness `SELECT 1`; a slower DB is reported not-ready rather than hanging the probe. */
export const READINESS_QUERY_TIMEOUT_MS = 2_000;

/** The `200` payload both probes return. Built once so the two routes cannot answer differently. */
const OK: HealthStatus = { status: 'ok', service: 'recipe', contractHash: CONTRACT_HASH };

@Controller('health')
@SkipThrottle()
export class HealthController {
    public constructor(@Inject(PgPoolProvider) private readonly pool: pg.Pool) {}

    /**
     * Liveness probe: the process is running. Performs no dependency checks and is one of the routes
     * left unauthenticated.
     */
    @Get()
    public getHealth(): HealthStatus {
        return OK;
    }

    /**
     * Readiness probe: the service can reach its database. Runs a bounded `SELECT 1`; a failure or
     * timeout surfaces as a `503` carrying the `NOT_READY` envelope, so traffic is routed away until the DB
     * recovers.
     *
     * @returns The `ok` payload (with `contractHash`) when the DB answers within the timeout.
     * @throws {HttpException} The `NOT_READY` envelope (→ 503) when the probe query fails or times out.
     * @sideEffect Issues a `SELECT 1` against the connection pool.
     */
    @Get('ready')
    public async getReadiness(): Promise<HealthStatus> {
        try {
            await this.probeDatabase();
        } catch {
            // ⚠️ THE ENVELOPE, NOT THE OLD `{ status: 'unavailable', service: 'recipe' }` BODY.
            //
            // Since `ApiExceptionFilter` became the SOLE AUTHOR of every error body, a passthrough shape would
            // have been normalized into `{ code: 'SERVICE_UNAVAILABLE', message, details: { status, service } }`
            // — the same information under a status-derived code that tells a consumer nothing the `503` did
            // not. Raising `NOT_READY` through `apiError` names the failure with a code a consumer can branch
            // on and keeps this route inside the one-shape contract.
            //
            // ⚠️ This CHANGES a published body (`HealthUnavailable` is retired). Verified safe rather than
            // assumed: nothing reads it. The only producer was this line, the only other references were the
            // schema and the document, and every probe that consumes this route — the ALB target group, ECS,
            // and the sandbox deploy smoke — reads the STATUS. Searched across `packages/` and `.github/`.
            //
            // The message is deliberately generic: readiness is UNAUTHENTICATED, so it must not report which
            // dependency failed. The diagnosable detail is in the log line the filter writes.
            throw apiError('NOT_READY', 'Database not reachable');
        }

        return OK;
    }

    /**
     * Run the readiness `SELECT 1`, rejecting if it does not resolve within
     * {@link READINESS_QUERY_TIMEOUT_MS}. The timer is always cleared so a fast query leaves nothing
     * pending on the event loop.
     *
     * @sideEffect Issues a `SELECT 1` against the connection pool.
     */
    private async probeDatabase(): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('readiness probe timed out')), READINESS_QUERY_TIMEOUT_MS);
        });

        try {
            await Promise.race([this.pool.query('SELECT 1'), timeout]);
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }
}
