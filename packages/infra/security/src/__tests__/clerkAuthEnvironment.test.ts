/**
 * The Clerk auth env rule, asserted ONCE (2026-09-02).
 *
 * ⛔ WHY THIS EXISTS AT ALL. Identity, food and recipe each wrote this same rule by hand: the same four
 * SSM parameter paths, the same prod-vs-non-prod mode split, the same native-admission gate. That is one
 * piece of KNOWLEDGE in three places, and this repo has already paid for the shape once — the ALB
 * listener priorities were three per-service copies of two band constants until they drifted (recipe's
 * docstring described food's bands and collided a live priority), which is why
 * `packages/infra/alb/listenerPriority.ts` is now the single allocator. The drift had started here too:
 * identity resolved its key path with `stage === 'prod' ? 'prod' : 'sandbox'` while the other two used
 * `baseStage` — equivalent today, two expressions of one rule tomorrow — and when the native gate had to
 * reach prod it was three hand edits, in three files, with a prod assertion in only one of the three
 * test suites.
 *
 * ## The rule, which is the subject of every case below
 *
 * 1. `CLERK_JWT_KEY` always, from the stage's own parameter tree.
 * 2. EXACTLY ONE azp mode (`hasExactlyOneAzpMode`'s invariant, at the env layer): prod gets the
 *    exact-match list; non-prod gets the anchored preview pattern PLUS its preview mode.
 * 3. `CLERK_ADMIT_NATIVE_CLIENT` on EVERY stage — native (@clerk/expo) tokens carry no `azp` at all, and
 *    since `@clerk/backend` 3.x both modes reject an azp-less token without this positive gate.
 */
import { App, Stack } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';

import { clerkAuthEnvironment, clerkAuthParameterPrefix } from '../clerkAuthEnvironment.js';

/** Resolve the helper against a real (throwaway) stack — the SSM lookups need a construct scope. */
function envFor(baseStage: string): Record<string, string> {
    const stack = new Stack(new App(), `TestStack-${baseStage}`, {
        env: { account: '111111111111', region: 'us-east-1' },
    });

    return clerkAuthEnvironment(stack, baseStage);
}

describe('clerkAuthEnvironment — the azp mode is stage-gated', () => {
    it('prod gets the exact-match list and NEITHER pattern key', () => {
        const env = envFor('prod');

        expect(Object.keys(env)).toContain('CLERK_AUTHORIZED_PARTIES');
        expect(Object.keys(env)).not.toContain('CLERK_AZP_PATTERN');
        expect(Object.keys(env)).not.toContain('CLERK_AZP_PREVIEW_MODE');
    });

    it('non-prod gets the pattern PAIR and NOT the list', () => {
        const env = envFor('sandbox');

        expect(Object.keys(env)).toContain('CLERK_AZP_PATTERN');
        expect(Object.keys(env)).toContain('CLERK_AZP_PREVIEW_MODE');
        expect(Object.keys(env)).not.toContain('CLERK_AUTHORIZED_PARTIES');
    });

    it('⛔ EXACTLY ONE mode per stage — never both, never neither (the fail-open shape)', () => {
        // `hasExactlyOneAzpMode` states this for the RUNTIME config; this is the same invariant one layer
        // up, at the env that feeds it. Neither mode set would make `verifyToken` skip azp entirely.
        for (const baseStage of ['prod', 'sandbox']) {
            const keys = Object.keys(envFor(baseStage));
            const hasList = keys.includes('CLERK_AUTHORIZED_PARTIES');
            const hasPattern = keys.includes('CLERK_AZP_PATTERN');

            expect(hasList !== hasPattern, `${baseStage} must select exactly one azp mode`).toBe(true);
        }
    });
});

describe('clerkAuthEnvironment — what every stage carries', () => {
    it('⛔ the native gate is on EVERY stage, prod included', () => {
        // The bug this helper was extracted after: the gate lived inside the non-prod branch in all three
        // stacks, on the premise that prod's list mode "skips the azp check on absent azp" — true of
        // @clerk/backend 1.34, false since 3.16, which throws instead. Prod would have 401'd every
        // mobile token.
        expect(envFor('prod')['CLERK_ADMIT_NATIVE_CLIENT']).toBe('true');
        expect(envFor('sandbox')['CLERK_ADMIT_NATIVE_CLIENT']).toBe('true');
    });

    it('always carries the JWT public key', () => {
        expect(Object.keys(envFor('prod'))).toContain('CLERK_JWT_KEY');
        expect(Object.keys(envFor('sandbox'))).toContain('CLERK_JWT_KEY');
    });
});

describe('clerkAuthEnvironment — the parameter tree', () => {
    it('prod reads the prod tree; every other stage reads the shared sandbox tree', () => {
        // The identity stack expressed this as `stage === 'prod' ? 'prod' : 'sandbox'` and the other two
        // as `baseStage` — equivalent, differently written. Stated once here, keyed on baseStage.
        const stack = new Stack(new App(), 'ParamTreeStack', { env: { account: '111111111111', region: 'us-east-1' } });

        expect(clerkAuthParameterPrefix('prod')).toBe('/kitchensink/prod/clerk');
        expect(clerkAuthParameterPrefix('sandbox')).toBe('/kitchensink/sandbox/clerk');
        // A per-PR stage is NOT its own tree — it shares the sandbox instance's parameters.
        expect(clerkAuthParameterPrefix('pr-73')).toBe('/kitchensink/sandbox/clerk');
        expect(Object.keys(clerkAuthEnvironment(stack, 'pr-73'))).toContain('CLERK_AZP_PATTERN');
    });
});
