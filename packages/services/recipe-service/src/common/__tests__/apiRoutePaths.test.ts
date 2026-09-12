/**
 * Route-path contract for the recipe service.
 *
 * Every versioned HTTP surface is canonically served under `/api/{version}/` (`/api/v1/recipes`), and ALSO
 * under the bare `/{version}/` path it shipped on (`/v1/recipes`) as a DEPRECATED ALIAS. This suite pins
 * BOTH halves at the cheapest tier (controller routing metadata — no HTTP, no DB), so a controller that
 * silently loses either path fails here rather than in production.
 *
 * Two reasons the alias cannot be dropped unilaterally:
 *  - Already-shipped mobile builds and cached web bundles have the bare paths compiled in
 *    (`NEXT_PUBLIC_*` endpoints are inlined at build time), so old clients keep dialing `/v1/*`.
 *  - `POST /v1/internal/account/erasure` is dialed **service to service** by the identity
 *    deletion-worker / reconciliation Lambdas (`erasureFanout.ts`), which deploy independently.
 * See `docs/architecture/decisions/0011-api-version-prefix.md`.
 *
 * `/health` is deliberately NOT under the prefix — the shared ALB target-group health check and the prod
 * smoke tests dial `/health` at the root.
 */
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import { AccountController } from '../../account/account.controller.js';
import { ServiceErasureController } from '../../account/serviceErasure.controller.js';
import { CollectionsController } from '../../collections/collections.controller.js';
import { HealthController } from '../../health/health.controller.js';
import { IngredientsController } from '../../ingredients/ingredients.controller.js';
import { PhotosController } from '../../photos/photos.controller.js';
import { RatingsController } from '../../ratings/ratings.controller.js';
import { RecipesController } from '../../recipes/recipes.controller.js';
import { SearchController } from '../../search/search.controller.js';
import { VersionsController } from '../../versions/versions.controller.js';

/** Read the route path(s) a `@Controller()` decorator registered, always as an array. */
function controllerPaths(target: NewableFunction): string[] {
    const metadata: unknown = Reflect.getMetadata(PATH_METADATA, target);

    return Array.isArray(metadata) ? (metadata as string[]) : [metadata as string];
}

/** Every versioned recipe controller, with the bare legacy prefix it originally shipped on. */
const versionedControllers: ReadonlyArray<readonly [string, NewableFunction, string]> = [
    ['RecipesController', RecipesController, 'v1/recipes'],
    ['RatingsController', RatingsController, 'v1/recipes'],
    ['VersionsController', VersionsController, 'v1/recipes/:recipeId/versions'],
    ['PhotosController', PhotosController, 'v1/recipes/:recipeId/photos'],
    ['IngredientsController', IngredientsController, 'v1/ingredients'],
    ['CollectionsController', CollectionsController, 'v1/collections'],
    ['SearchController', SearchController, 'v1/search'],
    ['AccountController', AccountController, 'v1/account'],
    ['ServiceErasureController', ServiceErasureController, 'v1/internal/account'],
];

describe('recipe service route paths', () => {
    describe.each(versionedControllers)('%s', (_name, controller, legacyPath) => {
        it(`serves the canonical api/${legacyPath}`, () => {
            expect(controllerPaths(controller)).toContain(`api/${legacyPath}`);
        });

        it(`still serves the deprecated ${legacyPath} alias`, () => {
            expect(controllerPaths(controller)).toContain(legacyPath);
        });

        it('lists the canonical path first, so generated links/logs prefer it', () => {
            expect(controllerPaths(controller)[0]).toBe(`api/${legacyPath}`);
        });
    });

    describe('HealthController', () => {
        it('stays at the unprefixed root for ALB health checks and prod smoke tests', () => {
            expect(controllerPaths(HealthController)).toEqual(['health']);
        });
    });
});
