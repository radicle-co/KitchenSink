/**
 * `TestPrincipalPurgeService` — the injectable seam between `FoodsController`'s test purge and the two functions it
 * runs: {@link purgeTestPrincipalFoods} (the caller's authored foods) and {@link purgeTestPickedRoots} (the catalog
 * roots the caller's remote picks created) (ADR-0040, food half).
 *
 * @pattern Command — executes the purge for an ALREADY-AUTHORIZED caller. Authorization is not here: it is the pure
 *   `domain/testPurgePolicy.ts`, evaluated by the controller before this is reached, because the refusal must
 *   be rendered as the request's own unrouted `404`, which only the HTTP layer can name.
 *
 * Shaped like `UserErasureService`: it holds the database handle so the controller never does.
 */
import { Inject, Injectable } from '@nestjs/common';

import { DrizzleProvider, type FoodDrizzle } from '../database/database.module.js';
import { TestPickedRootDao } from './dao/testPickedRoot.dao.js';
import type { AuthoredFoodTestPurgeResponse } from './foods.schema.js';
import { purgeTestPickedRoots } from './purgeTestPickedRoots.js';
import { purgeTestPrincipalFoods } from './purgeTestPrincipalFoods.js';

@Injectable()
export class TestPrincipalPurgeService {
    public constructor(@Inject(DrizzleProvider) private readonly db: FoodDrizzle) {}

    /**
     * Purge one test principal's private authored foods and the catalog roots its own picks created.
     *
     * @param userId - The authorized test principal's app-user ULID.
     * @returns The published response body.
     * @sideEffect Deletes the caller's private authored foods and picked roots.
     */
    public async purge(userId: string): Promise<AuthoredFoodTestPurgeResponse> {
        const deletedPickedRoots = await this.db.transaction((tx) =>
            purgeTestPickedRoots(new TestPickedRootDao(tx), userId),
        );
        const authored = await purgeTestPrincipalFoods(this.db, userId);

        return { ...authored, deletedPickedRoots };
    }
}
