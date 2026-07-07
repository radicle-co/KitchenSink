import { Controller, Get } from '@nestjs/common';

/**
 * Liveness endpoint, mirroring the identity service's `/health`. Returns 200 with a static payload;
 * it performs no dependency checks and is the one route left unauthenticated.
 */
@Controller('health')
export class HealthController {
    @Get()
    public getHealth(): { status: string; service: string } {
        return { status: 'ok', service: 'recipe' };
    }
}
