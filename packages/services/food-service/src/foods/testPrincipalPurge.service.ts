/**
 * `TestPrincipalPurgeService` — the injectable seam between `FoodsController`'s authored-food test purge and the
 * raw-SQL {@link purgeTestPrincipalFoods} (ADR-0040, food half).
 *
 * @pattern Command — executes the purge for an ALREADY-AUTHORIZED caller. Authorization is not here: it is the
 *   pure `domain/testPurgePolicy.ts`, evaluated by the controller before this is reached, because the refusal must
 *   be rendered as the request's own unrouted `404`, which only the HTTP layer can name.
 *
 * Shaped like `UserErasureService`: it holds the database handle so the controller never does.
 */
import { Inject, Injectable } from '@nestjs/common';

import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';
import type { AuthoredFoodTestPurgeResponse } from './foods.schema.js';
import { purgeTestPrincipalFoods } from './purgeTestPrincipalFoods.js';

@Injectable()
export class TestPrincipalPurgeService {
    public constructor(@Inject(DrizzleProvider) private readonly db: FoodDrizzle) {}

    /**
     * Purge one test principal's private authored foods.
     *
     * @param userId - The authorized test principal's app-user ULID.
     * @returns The published response body.
     * @sideEffect Deletes the caller's private authored foods.
     */
    public async purge(userId: string): Promise<AuthoredFoodTestPurgeResponse> {
        return purgeTestPrincipalFoods(this.db, userId);
    }
}
