/**
 * Route-path contract for the food service.
 *
 * Every versioned HTTP surface is canonically served under `/api/{version}/` (`/api/v1/foods/search`), and
 * ALSO under the bare `/{version}/` path it shipped on (`/v1/foods/search`) as a DEPRECATED ALIAS. This
 * suite pins BOTH halves at the cheapest tier (controller routing metadata — no HTTP, no DB), so a
 * controller that silently loses either path fails here rather than in production.
 *
 * The alias matters for more than browsers: `POST /v1/internal/account/erasure` is dialed **service to
 * service** by the identity deletion-worker / reconciliation Lambdas (`erasureFanout.ts`), which deploy
 * independently of this service. Dropping the alias would strand in-flight erasure fan-outs from an
 * older identity-webhooks deployment. See `docs/architecture/decisions/0011-api-version-prefix.md`.
 *
 * `/health` is deliberately NOT under the prefix — the shared ALB target-group health check and the prod
 * smoke tests dial `/health` at the root.
 */
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import { FoodsAdminController } from '../src/foods/admin/foodsAdmin.controller.js';
import { FoodsController } from '../src/foods/foods.controller.js';
import { ServiceErasureController } from '../src/foods/serviceErasure.controller.js';
import { HealthController } from '../src/health/health.controller.js';

/** Read the route path(s) a `@Controller()` decorator registered, always as an array. */
function controllerPaths(target: NewableFunction): string[] {
    const metadata: unknown = Reflect.getMetadata(PATH_METADATA, target);

    return Array.isArray(metadata) ? (metadata as string[]) : [metadata as string];
}

/** Every versioned food controller, with the bare legacy prefix it originally shipped on. */
const versionedControllers: ReadonlyArray<readonly [string, NewableFunction, string]> = [
    ['FoodsController', FoodsController, 'v1/foods'],
    ['FoodsAdminController', FoodsAdminController, 'v1/foods/admin'],
    ['ServiceErasureController', ServiceErasureController, 'v1/internal/account'],
];

describe('food service route paths', () => {
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
