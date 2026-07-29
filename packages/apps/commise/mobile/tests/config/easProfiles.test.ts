/**
 * Every EAS build profile must resolve the endpoints for the stage it targets — and a profile may only
 * hardcode an endpoint for a backend that is actually PERSISTENT.
 *
 * ## Why this guard exists
 *
 * `EXPO_PUBLIC_*` is inlined by Babel at BUILD time, so whatever the profile resolves to when the binary is
 * built is frozen into that binary forever. `src/config/env.ts` deliberately has no defaults, so a profile
 * that supplies nothing fails loudly — but a profile that supplies the WRONG endpoint fails silently and
 * ships. That is how the web app reached the sandbox preview with `http://localhost:3000` compiled in, and it
 * is worse on a phone: `localhost` there is the PHONE itself, so every request dies with no route to host and
 * no clue why.
 *
 * ## The topology rule this encodes (owner directive)
 *
 * Only identity and `packages/infra/global` are shared and persistent. **Every PR deploys its own recipe
 * service** (`kitchensink-recipe-service-pr-{N}` → `recipe-pr-{N}.commise.app`) — so there is no persistent
 * non-prod recipe host to hardcode, and a build profile that names one is wrong by construction.
 *
 * `preview` used to hardcode `https://recipe.sandbox.commise.app`. That host does not exist and never should,
 * yet it does not fail loudly either: the live `*.sandbox.commise.app` wildcard points at the shared ALB, so
 * it RESOLVES and answers the listener's default fixed-response 404. A preview binary built against it would
 * have failed every single request while looking perfectly configured — indistinguishable from an application
 * bug until someone thought to check DNS. So the profile now carries NO endpoint literals and declares
 * `environment: "preview"`, which makes EAS resolve them from the environment variables set for that build:
 * this PR's own recipe host plus the shared sandbox identity host.
 *
 * `production` keeps its literals because prod IS a single persistent deployment — the one case where a fixed
 * host is the correct answer. `e2e` keeps `10.0.2.2` (the Android emulator's alias for the host loopback)
 * because the Maestro suite runs against services on the CI runner; that is a loopback on purpose, and only
 * for a profile that is never distributed.
 */
import { describe, expect, it } from 'vitest';

import easConfig from '../../eas.json' with { type: 'json' };

interface BuildProfile {
    readonly env?: Readonly<Record<string, string>>;
    readonly environment?: string;
}

const profiles = easConfig.build as unknown as Readonly<Record<string, BuildProfile>>;

const ENDPOINTS = ['EXPO_PUBLIC_RECIPE_API_URL', 'EXPO_PUBLIC_IDENTITY_API_URL'] as const;

/** Profiles that hardcode their endpoints because the backend they target is a single persistent deploy. */
const LITERAL = ['production', 'e2e'] as const;

describe('eas.json build profiles', () => {
    it.each(LITERAL)('%s declares every endpoint the app reads', (name) => {
        const env = profiles[name]?.env;

        expect(env, `profile "${name}" has no env block`).toBeDefined();

        for (const key of ENDPOINTS) {
            expect(env?.[key], `${name} is missing ${key}`).toBeTruthy();
        }
    });

    it('production points at remote infrastructure, never a loopback', () => {
        const env = profiles.production?.env ?? {};

        for (const key of ENDPOINTS) {
            const value = env[key] ?? '';

            // `localhost`/`127.0.0.1` on a device is the DEVICE; `10.0.2.2` is the emulator's host alias.
            // None of the three can be reached from a real user's phone.
            expect(value, `production.${key} embeds a loopback address`).not.toMatch(
                /localhost|127\.0\.0\.1|10\.0\.2\.2/,
            );
            expect(value, `production.${key} must be an absolute https URL`).toMatch(/^https:\/\//);
        }
    });

    it('preview hardcodes NO endpoint — every PR has its own recipe service', () => {
        // The regression guard. Any literal here is a fixed host, and a fixed non-prod recipe host is either
        // another PR's deployment or the persistent instance that must not exist.
        const preview = profiles.preview;

        for (const key of ENDPOINTS) {
            expect(preview?.env?.[key], `preview must not hardcode ${key}`).toBeUndefined();
        }

        // ...and it must still SAY where they come from, or the build simply has no endpoints and fails with
        // a configuration error nobody can act on.
        expect(preview?.environment, 'preview must name the EAS environment supplying its endpoints').toBe('preview');
    });

    it('names no persistent non-prod service host in ANY profile', () => {
        // Belt-and-braces across the whole file: `recipe.sandbox` / `food.sandbox` resolve to the shared
        // ALB's default 404, so they can never be caught by "does it resolve" — only by refusing the name.
        //
        // The forbidden shape is the STAGE-QUALIFIED one: `{service}.{stage}.{apex}` — a service label
        // followed by three or more labels. Both legitimate forms are narrowly excluded by that count:
        // prod's `recipe.commise.app` has only two labels after the service, and a per-PR host uses the DASH
        // form (`recipe-pr-73.commise.app`), where `recipe` is not its own label at all.
        const stageQualifiedServiceHost = /\/\/(recipe|food)\.[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+/;
        const literals = Object.values(profiles).flatMap((profile) => Object.values(profile.env ?? {}));

        for (const value of literals) {
            expect(value, `'${value}' names a persistent non-prod service host that must not exist`).not.toMatch(
                stageQualifiedServiceHost,
            );
        }

        // Prove the matcher is not vacuous — an assertion that can never fire is not a guard.
        expect('https://recipe.sandbox.commise.app').toMatch(stageQualifiedServiceHost);
        expect('https://recipe.commise.app').not.toMatch(stageQualifiedServiceHost);
        expect('https://recipe-pr-73.commise.app').not.toMatch(stageQualifiedServiceHost);
    });

    it('keeps prod endpoints on hosts distinct from the shared sandbox identity service', () => {
        // A copy-paste that left `production` on sandbox identity would send real users' credentials to the
        // throwaway environment — silently, since it is a valid https URL that resolves.
        for (const key of ENDPOINTS) {
            expect(profiles.production?.env?.[key]).not.toMatch(/\.sandbox\./);
        }
    });

    it('targets the emulator host loopback for the e2e profile (deliberate, never distributed)', () => {
        for (const key of ENDPOINTS) {
            expect(profiles.e2e?.env?.[key]).toMatch(/^http:\/\/10\.0\.2\.2:/);
        }
    });
});
