/**
 * `FoodsModule` (T-010) — wires the `/v1/foods/*` read API: {@link FoodsController},
 * {@link FoodsService}, {@link FoodsRepository}, and {@link FetchQueueService} (the in-process
 * Postgres-as-queue enqueue). Depends on the global {@link DatabaseModule} for the Drizzle client
 * and the raw `pg` pool.
 *
 * Phase-7 seams left here: the `FoodAuthGuard` middleware (T-033) and `admitEnqueue`
 * backpressure/demotion (T-052) are not wired in this module yet.
 *
 * @implements FR-001
 */
import { Module } from '@nestjs/common';

import { FetchQueueService } from './fetch-queue.service.js';
import { FoodsController } from './foods.controller.js';
import { FoodsRepository } from './foods.repository.js';
import { FoodsService } from './foods.service.js';

@Module({
    controllers: [FoodsController],
    providers: [FoodsService, FoodsRepository, FetchQueueService],
    exports: [FoodsService, FetchQueueService],
})
export class FoodsModule {}
