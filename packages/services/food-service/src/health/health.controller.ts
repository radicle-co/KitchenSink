import { Controller, Get } from '@nestjs/common';

/** Liveness/readiness probe consumed by the ALB target group and ECS container health check. */
@Controller('health')
export class HealthController {
    /**
     * @returns A static `ok` payload identifying the service.
     */
    @Get()
    public getHealth(): { status: string; service: string } {
        return { status: 'ok', service: 'food' };
    }
}
