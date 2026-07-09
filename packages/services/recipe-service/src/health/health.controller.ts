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
 */
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type pg from 'pg';

import { PgPoolProvider } from '../database/database.module.js';

/** Upper bound on the readiness `SELECT 1`; a slower DB is reported not-ready rather than hanging the probe. */
export const READINESS_QUERY_TIMEOUT_MS = 2_000;

/** The health payload shape shared by both probes. */
interface HealthStatus {
    status: string;
    service: string;
}

@Controller('health')
export class HealthController {
    public constructor(@Inject(PgPoolProvider) private readonly pool: pg.Pool) {}

    /**
     * Liveness probe: the process is running. Performs no dependency checks and is one of the routes
     * left unauthenticated.
     */
    @Get()
    public getHealth(): HealthStatus {
        return { status: 'ok', service: 'recipe' };
    }

    /**
     * Readiness probe: the service can reach its database. Runs a bounded `SELECT 1`; a failure or
     * timeout surfaces as `503 Service Unavailable` so traffic is routed away until the DB recovers.
     *
     * @returns `{ status: 'ok', service: 'recipe' }` when the DB answers within the timeout.
     * @throws {ServiceUnavailableException} (→ 503) when the probe query fails or times out.
     * @sideEffect Issues a `SELECT 1` against the connection pool.
     */
    @Get('ready')
    public async getReadiness(): Promise<HealthStatus> {
        try {
            await this.probeDatabase();
        } catch {
            throw new ServiceUnavailableException({ status: 'unavailable', service: 'recipe' });
        }

        return { status: 'ok', service: 'recipe' };
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
