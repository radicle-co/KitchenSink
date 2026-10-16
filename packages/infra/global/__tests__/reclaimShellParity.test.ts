// @vitest-environment node
/**
 * The reclaim's TypeScript matchers are held equal to the shell they mirror (ADR-0061).
 *
 * ## Why this test exists
 *
 * ADR-0005 says there is no second matcher: the per-PR scope lives once, in `prScope.sh`, and the shared tier's
 * allowlist once, in `sandboxSharedTier.sh`. The reclaim runs inside a Lambda, which cannot source a shell file, so it
 * carries TypeScript copies (`reclaim.ts`). That is the recorded exception, and this test is what makes it safe: it
 * RUNS the real shell functions over the same hostile table and requires the TypeScript answers equal.
 *
 * It is not a re-implementation. Each shell answer comes from `bash` executing the committed script, so a loosened
 * shell glob, a changed allowlist order, or a TypeScript regex that is edited alone all fail here.
 *
 * ⚠️ A table can only prove equality over what it holds. The shapes are the ones the matchers were written against:
 * `pr-1` and `pr-15`, a leading zero, a name that contains a token, a tag that is a prefix of another, the
 * persistent tier, production and another application.
 *
 * @pattern Mirrored Authority — a TypeScript selection held to its shell source by an executed parity test
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SHARED_TIER_DELETE_ORDER, environmentTagBelongs, liveTokens } from '../lib/sandbox-scheduler/reclaim.js';
import { repoRoot } from './serviceSources.js';

const PR_SCOPE = path.join(repoRoot, '.github/scripts/prScope.sh');
const SHARED_TIER = path.join(repoRoot, '.github/scripts/sandboxSharedTier.sh');
const SANDBOX_REAP = path.join(repoRoot, '.github/scripts/sandboxReap.sh');

/** Run bash with a byte-order locale, so `sort -u` agrees with JavaScript's default sort. */
function bash(args: readonly string[], input = ''): { readonly status: number | null; readonly stdout: string } {
    const result = spawnSync('bash', args, {
        encoding: 'utf8',
        input,
        env: { PATH: process.env['PATH'] ?? '', LC_ALL: 'C' },
    });

    return { status: result.status, stdout: result.stdout };
}

const TOKENS = [
    'pr-1',
    'pr-15',
    'pr-091',
    'pr-91',
    'pr-',
    'pr-1x',
    'sandbox',
    'production',
    'prod',
    '',
    'pr-1-sandbox',
    'PR-1',
];
const TAGS = [
    'pr-1',
    'pr-1-sandbox',
    'pr-15',
    'pr-15-sandbox',
    'pr-091',
    'pr-091-sandbox',
    'pr-91',
    'pr-91-sandbox',
    'pr-9-sandbox',
    'pr-91-sandboxx',
    'pr-91-anything',
    'sandbox',
    'production',
    'prod',
    '',
    'pr-1-sandbox-sandbox',
];
const NAMES = [
    'kitchensink-food-service-pr-1',
    'kitchensink-food-service-pr-15',
    'kitchensink-recipe-workers-pr-091',
    'kitchensink-ingredient-parser-pr-91',
    'kitchensink-food-service-pr-91-old',
    'kitchensink-food-pr-1-pr-2',
    'kitchensink-pr-91',
    'kitchensink-food-service-prod',
    'kitchensink-food-service-PR-91',
    'kitchensink-Food-service-pr-91',
    'kitchensink-food_service-pr-91',
    'kitchensink-data-sandbox',
    'kitchensink-network-sandbox',
    'kitchensink-identity-webhooks-sandbox',
    'kitchensink-alb-prod',
    'armoury-api-pr-91',
    'xkitchensink-food-service-pr-91',
    'pr-91',
    '',
    ...SHARED_TIER_DELETE_ORDER,
];

describe('the reclaim mirrors the shell it restates (ADR-0061)', () => {
    it('the tag rule equals pr_scope_environment_tag_belongs over every token x tag', () => {
        let checked = 0;

        for (const token of TOKENS) {
            for (const tag of TAGS) {
                const shell = bash([PR_SCOPE, 'env-tag-belongs', token, tag]).status === 0;

                expect(
                    environmentTagBelongs(token, tag),
                    `token ${JSON.stringify(token)} tag ${JSON.stringify(tag)}`,
                ).toBe(shell);
                checked += 1;
            }
        }

        expect(checked).toBe(TOKENS.length * TAGS.length);
    });

    it('is not vacuous: the shell accepts some pair and refuses some pair', () => {
        expect(bash([PR_SCOPE, 'env-tag-belongs', 'pr-91', 'pr-91-sandbox']).status).toBe(0);
        expect(bash([PR_SCOPE, 'env-tag-belongs', 'pr-91', 'pr-9-sandbox']).status).toBe(1);
    });

    it('liveTokens equals sandboxSharedTier.sh live-tokens, for the whole table and for every name alone', () => {
        const expectFor = (names: readonly string[]): void => {
            const shell = bash([SHARED_TIER, 'live-tokens'], `${names.join('\n')}\n`)
                .stdout.split('\n')
                .filter((line) => line.length > 0);

            expect(liveTokens(names), JSON.stringify(names)).toEqual(shell);
        };

        expectFor(NAMES);

        for (const name of NAMES) {
            expectFor([name]);
        }
    });

    /**
     * The daily reaper discovers candidate previews by the same stack-name rule, so it is held to the same answer: a
     * reaper that disagreed with the reclaim on which stacks belong to a preview would act on a different set, on a
     * path that deletes stacks.
     */
    it('sandboxReap.sh tokens equals liveTokens, for the whole table and for every name alone', () => {
        const expectFor = (names: readonly string[]): void => {
            const shell = bash([SANDBOX_REAP, 'tokens'], `${names.join('\t')}\n`)
                .stdout.split('\n')
                .filter((line) => line.length > 0);

            expect(liveTokens(names), JSON.stringify(names)).toEqual(shell);
        };

        expectFor(NAMES);

        for (const name of NAMES) {
            expectFor([name]);
        }
    });

    it('the shared tier delete order equals sandboxSharedTier.sh order, as a sequence', () => {
        const shell = bash([SHARED_TIER, 'order'])
            .stdout.split('\n')
            .filter((line) => line.length > 0);

        expect([...SHARED_TIER_DELETE_ORDER]).toEqual(shell);
    });

    it('is not vacuous: live-tokens finds tokens in the table', () => {
        expect(liveTokens(NAMES).length).toBeGreaterThanOrEqual(3);
    });
});
