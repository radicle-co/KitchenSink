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
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type pg from 'pg';

import { CONTRACT_HASH } from '../contract/contract-hash.js';
import type { HealthStatus, HealthUnavailable } from './health.schema.js';
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
     * timeout surfaces as `503 Service Unavailable` so traffic is routed away until the DB recovers.
     *
     * @returns The `ok` payload (with `contractHash`) when the DB answers within the timeout.
     * @throws {ServiceUnavailableException} (→ 503) when the probe query fails or times out.
     * @sideEffect Issues a `SELECT 1` against the connection pool.
     */
    @Get('ready')
    public async getReadiness(): Promise<HealthStatus> {
        try {
            await this.probeDatabase();
        } catch {
            throw new ServiceUnavailableException({
                status: 'unavailable',
                service: 'recipe',
            } satisfies HealthUnavailable);
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
