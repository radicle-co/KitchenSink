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

import { actionProblems, catalogueServicesOf } from '../src/iamCatalogue.js';
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

    it('renders the twenty documents of the policy stack', () => {
        expect(policies).toHaveLength(20);
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
