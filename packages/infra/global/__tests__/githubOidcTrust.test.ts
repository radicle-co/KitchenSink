/**
 * The trust policy of the three GitHub Actions roles (ADR-0063), judged as a pure function.
 *
 * Every refusal below is a trust document that WOULD let a workflow outside this repository, or a prod role
 * a job that is not on `main` under the `Production` environment, assume the role. The table is the proof
 * that the module refuses them: a builder that was loosened (a wildcard sub, a dropped repository id) must
 * fail a row, not just fail to produce the happy shape.
 */
import { describe, expect, it } from 'vitest';

import {
    GITHUB_OIDC_AUDIENCE,
    GITHUB_OIDC_ISSUER,
    GITHUB_OIDC_TIERS,
    GITHUB_REPOSITORY_ID,
    GITHUB_REPOSITORY_OWNER_ID,
    assertSafeTrust,
    githubTrustConditions,
    type TrustConditions,
} from '../lib/platform/githubOidcTrust.js';

const K = (claim: string): string => `${GITHUB_OIDC_ISSUER}:${claim}`;

const CLASSIC = 'repo:radicle-co/KitchenSink';
const NEW_FORM = `repo:radicle-co@${GITHUB_REPOSITORY_OWNER_ID}/KitchenSink@${GITHUB_REPOSITORY_ID}`;

/** A prod trust that is correct, from which each refusal row removes or damages ONE thing. */
const goodProd = (): TrustConditions => ({
    StringEquals: {
        [K('aud')]: GITHUB_OIDC_AUDIENCE,
        [K('repository_id')]: GITHUB_REPOSITORY_ID,
        [K('repository_owner_id')]: GITHUB_REPOSITORY_OWNER_ID,
        [K('environment')]: 'Production',
        [K('ref')]: 'refs/heads/main',
        [K('sub')]: [`${CLASSIC}:environment:Production`, `${NEW_FORM}:environment:Production`],
    },
});

const without = (conditions: TrustConditions, key: string): TrustConditions => {
    const { [key]: _removed, ...rest } = conditions.StringEquals ?? {};

    return { ...conditions, StringEquals: rest };
};

const withEquals = (conditions: TrustConditions, key: string, value: string | readonly string[]): TrustConditions => ({
    ...conditions,
    StringEquals: { ...conditions.StringEquals, [key]: value },
});

describe('githubTrustConditions: what each tier is built to', () => {
    it('names exactly the three tiers', () => {
        expect([...GITHUB_OIDC_TIERS].sort()).toEqual(['nonprod', 'prod', 'prod-read']);
    });

    it.each(GITHUB_OIDC_TIERS)('%s: pins audience, repository id and owner id with exact equality', (tier) => {
        const equals = githubTrustConditions(tier).StringEquals ?? {};

        expect(equals[K('aud')]).toBe('sts.amazonaws.com');
        expect(equals[K('repository_id')]).toBe('1203438406');
        expect(equals[K('repository_owner_id')]).toBe('69129769');
    });

    it('nonprod: any ref or environment of THIS repository, in both subject forms', () => {
        const conditions = githubTrustConditions('nonprod');

        expect(conditions.StringLike?.[K('sub')]).toEqual([`${CLASSIC}:*`, `${NEW_FORM}:*`]);
        expect(conditions.StringEquals?.[K('sub')]).toBeUndefined();
        expect(conditions.StringEquals?.[K('ref')]).toBeUndefined();
    });

    it('prod-read: main only, no environment, exact subject in both forms', () => {
        const conditions = githubTrustConditions('prod-read');

        expect(conditions.StringLike).toBeUndefined();
        expect(conditions.StringEquals?.[K('sub')]).toEqual([
            `${CLASSIC}:ref:refs/heads/main`,
            `${NEW_FORM}:ref:refs/heads/main`,
        ]);
        expect(conditions.StringEquals?.[K('ref')]).toBe('refs/heads/main');
        expect(conditions.StringEquals?.[K('environment')]).toBeUndefined();
    });

    it('prod: Production environment on main, exact subject in both forms, nothing wildcarded', () => {
        const conditions = githubTrustConditions('prod');

        expect(conditions.StringLike).toBeUndefined();
        expect(conditions.StringEquals?.[K('sub')]).toEqual([
            `${CLASSIC}:environment:Production`,
            `${NEW_FORM}:environment:Production`,
        ]);
        expect(conditions.StringEquals?.[K('environment')]).toBe('Production');
        expect(conditions.StringEquals?.[K('ref')]).toBe('refs/heads/main');
    });

    it.each(GITHUB_OIDC_TIERS)('%s: the trust it builds passes its own gate', (tier) => {
        expect(() => assertSafeTrust(tier, githubTrustConditions(tier))).not.toThrow();
    });
});

describe('assertSafeTrust: trust documents that must be REFUSED', () => {
    const refused: readonly (readonly [string, 'nonprod' | 'prod' | 'prod-read', () => TrustConditions])[] = [
        ['no sub at all', 'prod', () => without(goodProd(), K('sub'))],
        [
            'a bare repo:* sub (StringLike)',
            'nonprod',
            () => ({ StringEquals: goodProd().StringEquals, StringLike: { [K('sub')]: 'repo:*' } }),
        ],
        [
            'an owner-wide sub (repo:radicle-co/*)',
            'nonprod',
            () => ({ StringEquals: goodProd().StringEquals, StringLike: { [K('sub')]: ['repo:radicle-co/*'] } }),
        ],
        [
            'a sub of just *',
            'nonprod',
            () => ({ StringEquals: goodProd().StringEquals, StringLike: { [K('sub')]: '*' } }),
        ],
        [
            'one good sub form and one wildcard owner',
            'nonprod',
            () => ({
                StringEquals: goodProd().StringEquals,
                StringLike: { [K('sub')]: [`${CLASSIC}:*`, 'repo:*/KitchenSink:*'] },
            }),
        ],
        [
            'another repository under the same owner',
            'nonprod',
            () => ({ StringEquals: goodProd().StringEquals, StringLike: { [K('sub')]: 'repo:radicle-co/Other:*' } }),
        ],
        [
            'a prefix lookalike (KitchenSink-fork)',
            'nonprod',
            () => ({
                StringEquals: goodProd().StringEquals,
                StringLike: { [K('sub')]: 'repo:radicle-co/KitchenSink-fork:*' },
            }),
        ],
        ['no repository_id', 'prod', () => without(goodProd(), K('repository_id'))],
        ['a different repository_id', 'prod', () => withEquals(goodProd(), K('repository_id'), '1')],
        ['no repository_owner_id', 'prod', () => without(goodProd(), K('repository_owner_id'))],
        ['no aud', 'prod', () => without(goodProd(), K('aud'))],
        ['a wrong aud', 'prod', () => withEquals(goodProd(), K('aud'), 'sts.example.com')],
        ['prod without ref', 'prod', () => without(goodProd(), K('ref'))],
        ['prod on a branch other than main', 'prod', () => withEquals(goodProd(), K('ref'), 'refs/heads/feature')],
        ['prod without environment', 'prod', () => without(goodProd(), K('environment'))],
        ['prod bound to the Sandbox environment', 'prod', () => withEquals(goodProd(), K('environment'), 'Sandbox')],
        [
            'prod with a wildcarded sub',
            'prod',
            () => ({
                StringEquals: without(goodProd(), K('sub')).StringEquals,
                StringLike: { [K('sub')]: `${CLASSIC}:*` },
            }),
        ],
        [
            'prod whose sub is not the Production environment',
            'prod',
            () => withEquals(goodProd(), K('sub'), `${CLASSIC}:ref:refs/heads/main`),
        ],
        ['prod-read without ref', 'prod-read', () => without(githubTrustConditions('prod-read'), K('ref'))],
        [
            'prod-read whose ref is not main',
            'prod-read',
            () => withEquals(githubTrustConditions('prod-read'), K('ref'), 'refs/pull/1/merge'),
        ],
        [
            'prod-read with a wildcarded sub',
            'prod-read',
            () => ({
                StringEquals: without(githubTrustConditions('prod-read'), K('sub')).StringEquals,
                StringLike: { [K('sub')]: `${CLASSIC}:*` },
            }),
        ],
        [
            'prod-read that admits any environment',
            'prod-read',
            () => withEquals(githubTrustConditions('prod-read'), K('environment'), 'Production'),
        ],
        [
            'an empty sub list',
            'nonprod',
            () => ({ StringEquals: without(goodProd(), K('sub')).StringEquals, StringLike: { [K('sub')]: [] } }),
        ],
    ];

    it.each(refused)('%s', (_label, tier, build) => {
        expect(() => assertSafeTrust(tier, build())).toThrow();
    });

    it('would not have caught the refusals above if the happy trust were also refused (control)', () => {
        expect(() => assertSafeTrust('prod', goodProd())).not.toThrow();
    });
});
