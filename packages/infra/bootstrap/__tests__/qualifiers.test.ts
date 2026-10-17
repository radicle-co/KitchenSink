/**
 * The qualifier module is the ONE authority for the three bootstrap qualifiers (ADR-0065). Renaming a qualifier
 * means re-bootstrapping every stage, so what is pinned here is the one-way-door surface: the names, the charset
 * rule CloudFormation enforces on them, and the role ARNs every other module derives from them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    ASSUMABLE_ROLE_KINDS,
    BOOTSTRAP_ROLE_KINDS,
    BOOTSTRAP_TRUST,
    CI_TIERS,
    DEFAULT_QUALIFIER,
    QUALIFIERS,
    bootstrapRoleArn,
    ciRoleArn,
    isValidQualifier,
    qualifierForStage,
    toolkitStackName,
} from '../src/qualifiers.js';

const ACCOUNT = '123456789012';
const REGION = 'us-east-1';

describe('QUALIFIERS', () => {
    it('pins the three names, because a rename re-bootstraps every stage', () => {
        expect(QUALIFIERS).toEqual({ nonprod: 'ksnonprod', prod: 'ksprod', account: 'ksaccount' });
    });

    it('never reuses the default qualifier that another application in the account bootstrapped', () => {
        expect(DEFAULT_QUALIFIER).toBe('hnb659fds');
        expect(Object.values(QUALIFIERS)).not.toContain(DEFAULT_QUALIFIER);
    });

    it.each(Object.values(QUALIFIERS))('%s satisfies the rule the bootstrap template enforces', (qualifier) => {
        expect(isValidQualifier(qualifier)).toBe(true);
    });
});

describe('isValidQualifier — the template parameter is [A-Za-z0-9_-]{1,10}', () => {
    it.each([
        ['a', true],
        ['abcdefghij', true],
        ['ks_prod-1', true],
        ['', false],
        ['abcdefghijk', false],
        ['ks prod', false],
        ['ks.prod', false],
        ['ksprod\n', false],
        ['ks/prod', false],
    ])('%j -> %s', (candidate, expected) => {
        expect(isValidQualifier(candidate)).toBe(expected);
    });
});

describe('qualifierForStage', () => {
    it.each([
        ['prod', 'ksprod'],
        ['sandbox', 'ksnonprod'],
        ['pr-91', 'ksnonprod'],
        ['dev', 'ksnonprod'],
        ['local', 'ksnonprod'],
    ])('stage %s deploys through %s', (stage, expected) => {
        expect(qualifierForStage(stage)).toBe(expected);
    });

    it('refuses an empty stage rather than defaulting a deploy into a tier', () => {
        expect(() => qualifierForStage('')).toThrow(/stage/u);
    });

    it('routes only the exact token "prod" to the production qualifier, so a near miss fails closed', () => {
        expect(qualifierForStage('Prod')).toBe('ksnonprod');
        expect(qualifierForStage('production')).toBe('ksnonprod');
        expect(qualifierForStage('prod-1')).toBe('ksnonprod');
    });
});

describe('toolkitStackName', () => {
    it('is kitchensink-bootstrap-<qualifier>, never the shared CDKToolkit', () => {
        expect(toolkitStackName('ksnonprod')).toBe('kitchensink-bootstrap-ksnonprod');
        expect(toolkitStackName('ksprod')).toBe('kitchensink-bootstrap-ksprod');
        expect(toolkitStackName('ksaccount')).toBe('kitchensink-bootstrap-ksaccount');
    });
});

describe('bootstrapRoleArn', () => {
    it('builds the name the bootstrap template gives each role', () => {
        expect(bootstrapRoleArn({ account: ACCOUNT, region: REGION, qualifier: 'ksprod', kind: 'deploy' })).toBe(
            `arn:aws:iam::${ACCOUNT}:role/cdk-ksprod-deploy-role-${ACCOUNT}-${REGION}`,
        );
        expect(bootstrapRoleArn({ account: ACCOUNT, region: REGION, qualifier: 'ksnonprod', kind: 'lookup' })).toBe(
            `arn:aws:iam::${ACCOUNT}:role/cdk-ksnonprod-lookup-role-${ACCOUNT}-${REGION}`,
        );
    });

    it('cdk-exec uses the "cfn-exec" spelling, which is not the kind name', () => {
        expect(bootstrapRoleArn({ account: ACCOUNT, region: REGION, qualifier: 'ksprod', kind: 'cfn-exec' })).toBe(
            `arn:aws:iam::${ACCOUNT}:role/cdk-ksprod-cfn-exec-role-${ACCOUNT}-${REGION}`,
        );
    });

    it('matches the role-name expressions in the vendored stock template for every kind', () => {
        const stock = readFileSync(
            path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/stockTemplate.yaml'),
            'utf8',
        );

        for (const kind of BOOTSTRAP_ROLE_KINDS) {
            expect(stock).toContain(`cdk-\${Qualifier}-${kind}-role-\${AWS::AccountId}-\${AWS::Region}`);
        }
    });
});

describe('ciRoleArn — the roles the bootstrap roles trust', () => {
    it.each(CI_TIERS)('tier %s has a kitchensink-gha role', (tier) => {
        const name = tier === 'nonprod' ? 'kitchensink-gha-nonprod' : `kitchensink-gha-${tier}`;
        expect(ciRoleArn(ACCOUNT, tier)).toBe(`arn:aws:iam::${ACCOUNT}:role/${name}`);
    });

    it('stays equal to the role names GithubActionsAccessStack gives the roles', () => {
        const stack = readFileSync(
            path.join(
                path.dirname(fileURLToPath(import.meta.url)),
                '../../global/lib/platform/GithubActionsAccessStack.ts',
            ),
            'utf8',
        );

        for (const tier of CI_TIERS) {
            expect(stack).toContain(`'kitchensink-gha-${tier}'`);
        }
    });
});

describe('BOOTSTRAP_TRUST', () => {
    it('lets only the prod CI role reach the account qualifier, on every kind', () => {
        for (const kind of ASSUMABLE_ROLE_KINDS) {
            expect(BOOTSTRAP_TRUST[QUALIFIERS.account][kind]).toEqual(['prod']);
        }
    });

    it('never lets a branch or nonprod role reach a prod or account qualifier', () => {
        for (const qualifier of [QUALIFIERS.prod, QUALIFIERS.account]) {
            for (const tiers of Object.values(BOOTSTRAP_TRUST[qualifier])) {
                expect(tiers).not.toContain('nonprod');
            }
        }
    });

    it('never lets a prod role reach the nonprod qualifier', () => {
        for (const tiers of Object.values(BOOTSTRAP_TRUST[QUALIFIERS.nonprod])) {
            expect(tiers).toEqual(['nonprod']);
        }
    });

    it('lets the read-only prod role reach only the prod LOOKUP role', () => {
        for (const qualifier of Object.values(QUALIFIERS)) {
            for (const kind of ASSUMABLE_ROLE_KINDS) {
                const trusted = BOOTSTRAP_TRUST[qualifier][kind].includes('prod-read');
                expect(trusted).toBe(qualifier === QUALIFIERS.prod && kind === 'lookup');
            }
        }
    });
});
