/**
 * Route-path contract for the identity service.
 *
 * Every versioned HTTP surface is canonically served under `/api/{version}/` (`/api/v1/users/me`), and
 * ALSO under the bare `/{version}/` path it shipped on (`/v1/users/me`) as a DEPRECATED ALIAS. This suite
 * pins BOTH halves of that contract at the cheapest tier (controller routing metadata — no HTTP, no DB),
 * so a controller that silently loses either path fails here rather than in production.
 *
 * Why the alias must not be dropped: `/v1/*` is live in production and at least one consumer is configured
 * OUTSIDE this repository (the Clerk dashboard webhook URL), plus already-shipped mobile builds and cached
 * web bundles have the old paths compiled in. See `docs/architecture/decisions/0011-api-version-prefix.md`.
 *
 * `/health` is deliberately NOT under the prefix — the shared ALB target-group health check and the prod
 * smoke tests dial `/health` at the root. That exclusion is pinned here too, so "tidying" health under
 * `/api` cannot pass review silently.
 */
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import { AdminController } from '../src/admin/admin.controller.js';
import { HealthController } from '../src/health/health.controller.js';
import { AvatarUploadController } from '../src/users/avatar-upload.controller.js';
import { UsersController } from '../src/users/users.controller.js';

/** Read the route path(s) a `@Controller()` decorator registered, always as an array. */
function controllerPaths(target: NewableFunction): string[] {
    const metadata: unknown = Reflect.getMetadata(PATH_METADATA, target);

    return Array.isArray(metadata) ? (metadata as string[]) : [metadata as string];
}

/** Every versioned identity controller, with the bare legacy prefix it originally shipped on. */
const versionedControllers: ReadonlyArray<readonly [string, NewableFunction, string]> = [
    ['UsersController', UsersController, 'v1/users'],
    ['AvatarUploadController', AvatarUploadController, 'v1/users/me/avatar'],
    ['AdminController', AdminController, 'v1/admin/users'],
];

describe('identity service route paths', () => {
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
