// @vitest-environment node
/**
 * Which runs have a DEPLOYED target, for a spec that reads a deployed service and may not run against anything else.
 *
 * ## Why this is a decision
 *
 * `paidFeatureRoles.spec.ts` reads what the deployed identity answers on `GET /api/v1/users/me`. A local run has no
 * deployed identity: the browser serves at a free port, and the local stack admits (by `azp` and CORS) only the origin
 * `@kitchensink/local-sandbox` names. So every local run waited 60 s per test for a `200` that could not come. The owner's
 * rulings (2026-09-05, 2026-10-03) settle what that spec does instead: a DEPLOYED-target spec SKIPS when its target is
 * absent, and is never re-pointed at localhost.
 *
 * `PLAYWRIGHT_BASE_URL` being set is not enough. `recipeLive.spec.ts` tells a developer to point it at a local dev
 * server, and that is localhost by another name. So the target counts only when it is an http(s) origin whose host is
 * not loopback.
 *
 * Every case fails if the rule is broken in an obvious way: a bare presence check, a loopback check that knows only the
 * word `localhost`, a blank value read as a target, or a malformed value skipped in silence (a skip claims nothing, so
 * a misconfigured target must not look like an absent one).
 */
import { describe, expect, it } from 'vitest';

import { deployedTargetOrigin, isInvalidDeployedTargetError } from '../deployedTarget';

const withBase = (value: string | undefined): Readonly<Record<string, string | undefined>> => ({
    PLAYWRIGHT_BASE_URL: value,
});

describe('deployedTargetOrigin', () => {
    it('is the origin when PLAYWRIGHT_BASE_URL names a deployed host', () => {
        expect(deployedTargetOrigin(withBase('https://pr-91.sandbox.commise.app'))).toBe(
            'https://pr-91.sandbox.commise.app',
        );
    });

    it('drops a path or trailing slash: the target is an ORIGIN', () => {
        expect(deployedTargetOrigin(withBase('https://commise.app/en/'))).toBe('https://commise.app');
    });

    it.each([undefined, '', '   '])('is absent when PLAYWRIGHT_BASE_URL is %j', (value) => {
        expect(deployedTargetOrigin(withBase(value))).toBeUndefined();
    });

    it.each([
        'http://localhost:3010',
        'http://LOCALHOST:3010',
        'http://web.localhost:3010',
        'http://127.0.0.1:3010',
        'http://127.8.9.10',
        'http://[::1]:3010',
        'http://0.0.0.0:3010',
    ])('is absent for a loopback address, %s: a local server is not a deployed target', (value) => {
        expect(deployedTargetOrigin(withBase(value))).toBeUndefined();
    });

    it.each(['not a url', 'ftp://commise.app', '/en/sign-in'])(
        'throws for %j rather than skipping as if nothing were deployed',
        (value) => {
            let thrown: unknown;

            try {
                deployedTargetOrigin(withBase(value));
            } catch (error) {
                thrown = error;
            }

            expect(isInvalidDeployedTargetError(thrown)).toBe(true);
            expect(String(thrown)).toContain('PLAYWRIGHT_BASE_URL');
        },
    );
});
