/**
 * Every Resource ARN of every rendered policy document must obey IAM's ARN grammar for ITS service.
 *
 * IAM rejected the cross-tier Denies at CreatePolicy ("Resource vendor must be fully qualified and cannot contain
 * regexes": `arn:aws:*:*:*:...`) and Access Analyzer rejected a CloudWatch dashboard ARN that carried a region. Neither
 * is visible to a guard that matches names. This is an offline grammar check over the rendered documents:
 *
 * - the partition is `aws` and the service is a concrete name (no wildcard);
 * - the region and account fields follow the SERVICE'S OWN resource type, taken from the Service Authorization
 *   Reference snapshot: a global resource (an IAM role, a CloudFront distribution, a CloudWatch dashboard) takes no
 *   region, an S3 bucket takes neither, a regional one takes a region (`*` allowed);
 * - an ALLOW names this account (or none, where the type has none); only a DENY may say `*` for the account.
 */
import { describe, expect, it } from 'vitest';

import { arnProblems } from '../src/iamCatalogue.js';
import { renderedPolicies } from '../src/policySet.js';
import { iamCatalogue, TEST_CONTEXT } from './iamCatalogueFixture.js';

const A = TEST_CONTEXT.account;
const R = TEST_CONTEXT.region;

/** [arn, effect, valid] */
const FIXTURES: ReadonlyArray<readonly [string, 'Allow' | 'Deny', boolean]> = [
    ['*', 'Allow', true],
    [`arn:aws:sqs:${R}:${A}:kitchensink-queue`, 'Allow', true],
    [`arn:aws:sqs:*:${A}:kitchensink-*`, 'Allow', true],
    ['arn:aws:sqs:*:*:*kitchensink-*-prod*', 'Deny', true],
    ['arn:aws:s3:::kitchensink-*', 'Allow', true],
    ['arn:aws:s3:::*kitchensink-*-prod*', 'Deny', true],
    [`arn:aws:iam::${A}:role/kitchensink-*`, 'Allow', true],
    ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole', 'Allow', true],
    ['arn:aws:iam::*:role/kitchensink-*-prod*', 'Deny', true],
    [`arn:aws:cloudfront::${A}:distribution/*`, 'Allow', true],
    ['arn:aws:cloudfront::*:function/*prod*', 'Deny', true],
    [`arn:aws:cloudwatch:${R}:${A}:alarm:kitchensink-*`, 'Allow', true],
    [`arn:aws:cloudwatch::${A}:dashboard/food-data`, 'Allow', true],
    ['arn:aws:cloudwatch::*:dashboard/food-data', 'Deny', true],
    ['arn:aws:bedrock:*::foundation-model/amazon.nova-*', 'Allow', true],
    [`arn:aws:logs:${R}:${A}:log-group:/aws/lambda/kitchensink-*:*`, 'Allow', true],
    ['arn:aws:route53:::hostedzone/*', 'Allow', true],
    [`arn:aws:apigateway:${R}::/restapis/*`, 'Allow', true],

    // The defect IAM refused: a wildcard vendor.
    ['arn:aws:*:*:*:*kitchensink-*-prod*', 'Deny', false],
    ['arn:aws:s*:*:*:kitchensink-*', 'Deny', false],
    ['arn:aws:?qs:*:*:kitchensink-*', 'Deny', false],
    // The defect Access Analyzer refused: a region on a global resource.
    [`arn:aws:cloudwatch:${R}:${A}:dashboard/food-data`, 'Allow', false],
    ['arn:aws:cloudwatch:*:*:dashboard/food-data', 'Deny', false],
    [`arn:aws:cloudfront:${R}:${A}:distribution/*`, 'Allow', false],
    [`arn:aws:iam:${R}:${A}:role/kitchensink-*`, 'Allow', false],
    [`arn:aws:s3::${A}:kitchensink-*`, 'Allow', false],
    [`arn:aws:s3:${R}::kitchensink-*`, 'Allow', false],
    // A regional resource with no region.
    [`arn:aws:sqs::${A}:kitchensink-queue`, 'Allow', false],
    [`arn:aws:cloudwatch::${A}:alarm:kitchensink-*`, 'Allow', false],
    // An account that is not ours, or a wildcard account on an Allow.
    [`arn:aws:sqs:${R}:999999999999:kitchensink-queue`, 'Allow', false],
    [`arn:aws:sqs:${R}:*:kitchensink-queue`, 'Allow', false],
    // Structure.
    ['arn:aws:sqs:us-east-1', 'Allow', false],
    ['arn:aws-cn:sqs:us-east-1:123456789012:x', 'Allow', false],
    ['arn:*:sqs:us-east-1:123456789012:x', 'Allow', false],
    ['sqs:us-east-1:123456789012:x', 'Allow', false],
    // A resource type the service does not have, and a service that does not exist.
    [`arn:aws:lambda:${R}:${A}:nosuchtype:x`, 'Allow', false],
    ['arn:aws:notaservice:us-east-1:123456789012:x', 'Allow', false],
];

describe('arnProblems — fixture table', () => {
    it.each(FIXTURES)('%s (%s) -> valid: %s', (arn, effect, valid) => {
        expect(arnProblems(iamCatalogue, arn, { effect, account: A }).length === 0).toBe(valid);
    });
});

describe('every rendered policy document', () => {
    const policies = renderedPolicies(TEST_CONTEXT);

    it.each(policies.map((policy) => [policy.name, policy] as const))('%s has well-formed ARNs', (_name, policy) => {
        const problems = policy.document.Statement.flatMap((statement) =>
            statement.Resource.flatMap((arn) =>
                arnProblems(iamCatalogue, arn, { effect: statement.Effect, account: A }).map(
                    (problem) => `${statement.Sid}: ${problem}`,
                ),
            ),
        );

        expect(problems).toEqual([]);
    });
});
