/**
 * Every action a rendered policy document names must exist.
 *
 * `cloudfront:CreateDistributionWithTags` and `logs:AllowVendedLogDeliveryForResource` were written from memory, read
 * as plausible, passed every guard that compared the table with itself, and were rejected by IAM at the end of the
 * first real deploy. The catalogue is a committed snapshot of AWS's Service Authorization Reference
 * (`scripts/refreshIamCatalogue.ts`), so an invented action fails here, offline.
 *
 * A wildcard action (`logs:*Delivery*`) must match at least one real action, or it grants nothing and is a typo.
 */
import { describe, expect, it } from 'vitest';

import { actionProblems, catalogueServicesOf, tagKeySupport } from '../src/iamCatalogue.js';
import { renderedPolicies } from '../src/policySet.js';
import { iamCatalogue, TEST_CONTEXT } from './iamCatalogueFixture.js';

const FIXTURES: ReadonlyArray<readonly [string, boolean]> = [
    ['logs:CreateDelivery', true],
    ['logs:PutDeliverySource', true],
    ['cloudfront:AllowVendedLogDeliveryForResource', true],
    ['cloudfront:CreateDistribution', true],
    ['cloudfront:TagResource', true],
    ['LAMBDA:invokefunction', true],
    ['logs:*Delivery*', true],
    ['lambda:Get*', true],
    ['iam:*', true],
    ['*', true],
    // The two actions the first real deploy was rejected for.
    ['cloudfront:CreateDistributionWithTags', false],
    ['logs:AllowVendedLogDeliveryForResource', false],
    // Shapes of invention a reviewer's eye passes over.
    ['lambda:CreateFunctions', false],
    ['s3:GetObjects', false],
    ['logs:*Deliveryz*', false],
    ['notaservice:DoThing', false],
    ['lambda', false],
    ['lambda:', false],
    ['*:Get*', false],
];

describe('actionProblems — fixture table', () => {
    it.each(FIXTURES)('%s -> exists: %s', (action, exists) => {
        expect(actionProblems(iamCatalogue, action) === undefined).toBe(exists);
    });
});

describe('every rendered policy document', () => {
    const policies = renderedPolicies(TEST_CONTEXT);

    it('renders the twenty-two documents of the policy stack (3 boundaries + 8 + 8 + 3 execution parts)', () => {
        expect(policies).toHaveLength(22);
    });

    it('is covered by the committed catalogue: every service the tables mention is in the snapshot', () => {
        const services = catalogueServicesOf(policies.map((policy) => policy.document));

        expect(services.filter((service) => iamCatalogue.services[service] === undefined)).toEqual([]);
    });

    it.each(policies.map((policy) => [policy.name, policy] as const))('%s names only real actions', (_name, policy) => {
        const problems = policy.document.Statement.flatMap((statement) =>
            statement.Action.flatMap((action) => {
                const problem = actionProblems(iamCatalogue, action);

                return problem === undefined ? [] : [`${statement.Sid}: ${problem}`];
            }),
        );

        expect(problems).toEqual([]);
    });
});

/**
 * The snapshot also carries which actions honour the tag condition keys ADR-0065 authorizes by: `aws:RequestTag` (the
 * tags on the request) and `aws:ResourceTag` (the tags on the resource acted on). A key an action does not honour is
 * ABSENT from the request context, so a `StringEquals` on it never matches: on a create it denies the create, and on a
 * modify it denies the modify. Whether an action honours a key is therefore decidable offline, from the reference.
 */
describe('tagKeySupport — which actions honour the tier tag keys', () => {
    const FIXTURES: ReadonlyArray<readonly [string, 'requestTag' | 'resourceTag', boolean]> = [
        ['lambda:CreateFunction', 'requestTag', true],
        ['acm:RequestCertificate', 'requestTag', true],
        ['acm:AddTagsToCertificate', 'requestTag', true],
        ['acm:DeleteCertificate', 'requestTag', false],
        ['acm:DeleteCertificate', 'resourceTag', true],
        ['lambda:DeleteFunction', 'resourceTag', true],
        ['lambda:DeleteFunction', 'requestTag', false],
        ['route53:ChangeResourceRecordSets', 'requestTag', false],
        ['route53:ChangeResourceRecordSets', 'resourceTag', false],
    ];

    it.each(FIXTURES)('%s honours %s: %s', (action, key, expected) => {
        const { supported } = tagKeySupport(iamCatalogue, action, key);

        expect(supported.length > 0).toBe(expected);
    });

    it('reports the unsupported members of a wildcard, so a guard can refuse a partly supported pattern', () => {
        const { supported, unsupported } = tagKeySupport(iamCatalogue, 'lambda:Get*', 'resourceTag');

        expect(supported).toContain('lambda:GetFunction');
        expect(unsupported).toContain('lambda:GetAccountSettings');
    });

    it('answers nothing for a pattern that matches no real action', () => {
        expect(tagKeySupport(iamCatalogue, 'lambda:Nonexistent*', 'requestTag')).toEqual({
            supported: [],
            unsupported: [],
        });
    });
});
