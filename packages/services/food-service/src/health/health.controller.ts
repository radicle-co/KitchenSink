import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';

import { PgPoolProvider } from '../database/database.module.js';
import { probeDatabase } from './readiness.js';
// AUTHORED wire contract, published via `@kitchensink/schema-food` (CODING_STANDARDS §15.2). The probe payload
// is part of the contract: its `service` discriminator is what lets a deploy smoke tell this service's answer
// from the shared ALB's default 404 (ADR-0003/ADR-0010).
import type { HealthStatus } from './health.schema.js';

/**
 * Health probes for the food service. Liveness (`GET /health`) is static — it answers "is the process
 * up?" and must NOT depend on the DB, or a transient RDS blip would make ECS kill an otherwise-healthy
 * container. Readiness (`GET /health/ready`) answers "can this instance serve traffic?" by probing the
 * DB pool, so the ALB can drain a node whose database is unreachable (ARCH-PS-3). Both routes are
 * unauthenticated: the `FoodAuthGuard` is mounted only on `/api/v1/foods/*`.
 */
@Controller('health')
export class HealthController {
    public constructor(@Inject(PgPoolProvider) private readonly pool: Pool) {}

    /** Liveness — a static `ok` payload. Consumed by the ECS container health check. */
    @Get()
    public getHealth(): HealthStatus {
        return { status: 'ok', service: 'food' };
    }

    /**
     * Readiness — `200` when a `SELECT 1` against the pool succeeds within the probe budget, `503`
     * (via {@link ServiceUnavailableException}, shaped by the global filter) when it fails or times out.
     */
    @Get('ready')
    public async getReadiness(): Promise<HealthStatus> {
        try {
            await probeDatabase(this.pool);
        } catch {
            // Deliberately swallow the cause: it may embed connection strings / host detail. The DB
            // failure is already observable via pool metrics; the client only needs the 503 signal.
            throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Database not reachable' });
        }

        return { status: 'ok', service: 'food' };
    }
}
