/**
 * The IAM wildcard semantics every policy-boundary guard in this package evaluates with.
 *
 * A guard that asks "does this grant reach that resource?" is only as right as its matcher, so the matcher has
 * its own table: `*` is any run (including `/` and `:`), `?` is exactly one character, resource names are
 * case-sensitive, and every other character is literal — a regex metacharacter in an ARN must not become syntax.
 */
import { describe, expect, it } from 'vitest';

import { iamActionMatches, iamResourceMatches, policyAdmits, type PolicyStatementJson } from './iamGlob.js';

describe('iamResourceMatches', () => {
    it.each([
        ['an exact name', 'stack/kitchensink-alb-sandbox/*', 'stack/kitchensink-alb-sandbox/abc', true],
        ['* across a slash', 'log-group:*kitchensink-*-pr-*', 'log-group:/aws/lambda/kitchensink-x-pr-9', true],
        ['* across a colon', 'log-group:kitchensink-*', 'log-group:kitchensink-a:*', true],
        ['* matches the empty run', 'repository/kitchensink-*', 'repository/kitchensink-', true],
        ['? is exactly one character', 'pr-?', 'pr-7', true],
        ['? is not zero characters', 'pr-?', 'pr-', false],
        ['? is not two characters', 'pr-?', 'pr-77', false],
        ['case is significant', 'stack/kitchensink-*', 'stack/KitchenSink-alb', false],
        ['anchored at the start', 'kitchensink-*', 'xkitchensink-alb', false],
        ['anchored at the end', 'kitchensink-alb-sandbox', 'kitchensink-alb-sandbox-old', false],
        ['a dot is literal', 'pr-*.sandbox.commise.app', 'pr-1xsandboxxcommisexapp', false],
        ['a plus is literal', 'a+b', 'aab', false],
    ])('%s: %s vs %s -> %s', (_label, pattern, value, expected) => {
        expect(iamResourceMatches(pattern, value)).toBe(expected);
    });
});

describe('iamActionMatches', () => {
    it.each([
        ['an exact action', 'logs:DeleteLogGroup', 'logs:DeleteLogGroup', true],
        ['action names ignore case', 'logs:deleteloggroup', 'logs:DeleteLogGroup', true],
        ['a verb wildcard', 'logs:Delete*', 'logs:DeleteLogGroup', true],
        ['a service wildcard does not cross services', 'logs:*', 'ecr:DeleteRepository', false],
        ['a bare star is everything', '*', 'ecr:DeleteRepository', true],
    ])('%s: %s vs %s -> %s', (_label, pattern, action, expected) => {
        expect(iamActionMatches(pattern, action)).toBe(expected);
    });
});

describe('policyAdmits', () => {
    const statements: readonly PolicyStatementJson[] = [
        { Effect: 'Allow', Action: ['logs:DeleteLogGroup'], Resource: 'log-group:*-pr-*' },
        {
            Effect: 'Allow',
            Action: 'ecs:DeleteService',
            Resource: ['service/a-pr-*/*'],
            Condition: { StringLike: { 'aws:ResourceTag/Environment': 'pr-*' } },
        },
        { Effect: 'Deny', Action: 'logs:DeleteLogGroup', Resource: 'log-group:x-pr-1' },
        {
            Effect: 'Deny',
            Action: 'ecs:DeleteService',
            Resource: '*',
            Condition: { StringEquals: { 'aws:ResourceTag/Environment': 'production' } },
        },
    ];

    it.each([
        ['an Allow whose action and resource match', 'logs:DeleteLogGroup', 'log-group:y-pr-2', true],
        ['an action no Allow names', 'logs:PutRetentionPolicy', 'log-group:y-pr-2', false],
        ['a resource no Allow names', 'logs:DeleteLogGroup', 'log-group:y-prod', false],
        ['an unconditioned Deny wins', 'logs:DeleteLogGroup', 'log-group:x-pr-1', false],
        // A conditioned Allow still ADMITS: a refusal must come from the resource pattern, never from a tag that
        // a resource may or may not carry. A conditioned Deny is likewise not counted on to refuse.
        ['a tag-conditioned Allow counts as admitting', 'ecs:DeleteService', 'service/a-pr-1/api', true],
    ])('%s: %s on %s -> %s', (_label, action, resource, expected) => {
        expect(policyAdmits(statements, action, resource)).toBe(expected);
    });

    it('refuses to judge an Allow it cannot evaluate (NotAction / NotResource)', () => {
        expect(() =>
            policyAdmits([{ Effect: 'Allow', NotAction: 'iam:*', Resource: '*' }], 'logs:DeleteLogGroup', 'x'),
        ).toThrow(/cannot evaluate/u);
        expect(() =>
            policyAdmits([{ Effect: 'Allow', Action: '*', NotResource: 'x' }], 'logs:DeleteLogGroup', 'y'),
        ).toThrow(/cannot evaluate/u);
    });

    it('treats a NotAction Deny as denying every action it does not list', () => {
        const denyAllButReads: readonly PolicyStatementJson[] = [
            { Effect: 'Allow', Action: ['ssm:GetParameter', 'ssm:PutParameter'], Resource: '*' },
            { Effect: 'Deny', NotAction: ['ssm:GetParameter'], Resource: '*' },
        ];

        expect(policyAdmits(denyAllButReads, 'ssm:GetParameter', 'p')).toBe(true);
        expect(policyAdmits(denyAllButReads, 'ssm:PutParameter', 'p')).toBe(false);
    });
});
