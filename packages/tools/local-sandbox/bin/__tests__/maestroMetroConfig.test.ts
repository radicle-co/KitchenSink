/**
 * What `maestroMetro.config.cjs` hides from Metro's file map for a `local:maestro` run.
 *
 * Metro watches the whole monorepo. A sibling build that deletes and recreates a service's build output (`dist-lambda`,
 * `distSeed`, `cdk.out`) or the web app's `.next` while Metro runs makes Node's `fs.watch` throw ENOENT and the Metro
 * process EXITS. The app then reads "Unable to load script" on every later flow, and each one fails at sign-in. None of
 * those trees is something the mobile bundle can import, so they are hidden; the app's own sources and the shared
 * packages' `dist` folders are not.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const requireCjs = createRequire(import.meta.url);
const config = requireCjs('../../maestroMetro.config.cjs') as { resolver: { blockList: readonly RegExp[] } };
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url)).replace(/\/$/, '');

const isHidden = (file: string): boolean => config.resolver.blockList.some((pattern) => pattern.test(file));

describe('maestroMetro.config blockList', () => {
    it.each([
        'packages/services/food-service/distSeed',
        'packages/services/food-service/distSeed/seed.js',
        'packages/services/food-service/dist-lambda/index.js',
        'packages/services/recipe-service/dist/main.js',
        'packages/services/food-service/cdk.out/manifest.json',
        'packages/apps/commise/web/.next/standalone/node_modules/svgo',
        'packages/infra/global/cdk.out/tree.json',
    ])('hides a sibling build output: %s', (relative) => {
        expect(isHidden(`${ROOT}/${relative}`)).toBe(true);
    });

    it.each([
        'packages/apps/commise/mobile/src/App.tsx',
        'packages/apps/commise/ui/src/button/Button.tsx',
        'packages/schemas/recipe/src/schemas.ts',
        'packages/clients/recipe-service-client/dist/index.js',
    ])('keeps a source the bundle can import: %s', (relative) => {
        expect(isHidden(`${ROOT}/${relative}`)).toBe(false);
    });

    it('still hides the developer-local env overrides', () => {
        expect(isHidden(`${ROOT}/packages/apps/commise/mobile/.env.local`)).toBe(true);
    });
});
