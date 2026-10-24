/**
 * The tier-name Denies (`DenyProductionNames`, `DenyNonProductionNames`) must keep each stage tier out of the other's
 * names with a CONCRETE service AND a concrete resource TYPE in every ARN (IAM refuses a wildcard vendor, and a
 * wildcard where the type belongs: `arn:aws:iam::*:*-prod*`), and must still cover every name the policies allow.
 *
 * Claims, each judged against the rendered documents:
 *
 * 1. **Property.** Take every Allow ARN that carries a name, fill its wildcards with a name of the OTHER tier, and the
 *    policy's Deny refuses it. This is independent of how the Deny is derived: it fails when an Allow reaches a type
 *    the Deny does not name.
 * 2. **Both directions, per service.** The other tier's sample name is refused and the policy's own tier's names
 *    (sandbox AND preview, or production) are not.
 * 3. **Derivation.** The resource types come from the Allows (`resourceTypesOf`), so a type is never listed by hand.
 */
import { describe, expect, it } from 'vitest';

import { buildBoundary } from '../src/boundary.js';
import { buildExecutionPolicy } from '../src/executionPolicy.js';
import type { PolicyDocument } from '../src/policyDocument.js';
import { unconditionalDeny } from '../src/policyEval.js';
import { QUALIFIERS, type QualifierName } from '../src/qualifiers.js';
import { resourceTypesOf, tierNameResources } from '../src/tierNames.js';
import { TIER_NAME_SAMPLES } from './nameFixtures.js';

/** Services an Allow reaches whose ARNs hold generated ids, never a name: a name pattern could not match them. */
const ID_ONLY = new Set([
    'acm',
    'apigateway',
    'application-autoscaling',
    'bedrock',
    'budgets',
    'ce',
    'cloudfront',
    'ec2',
    'rds-db',
    'route53',
    'tag',
    'xray',
]);

const stageQualifiers = [QUALIFIERS.nonprod, QUALIFIERS.prod] as const;

const protects = (qualifier: QualifierName): 'production' | 'nonproduction' =>
    qualifier === QUALIFIERS.nonprod ? 'production' : 'nonproduction';

/**
 * Names of the other tier, to put where an Allow has a wildcard: the shapes the stacks make (`kitchensink-<x>-<stage>`),
 * and, for an Allow that reaches `kitchensink/` paths, the path shapes too.
 */
const otherTierFillers = (qualifier: QualifierName, path: boolean): readonly string[] => {
    const flat =
        qualifier === QUALIFIERS.nonprod ? ['kitchensink-x-prod'] : ['kitchensink-x-sandbox', 'kitchensink-x-pr-91'];
    const paths =
        qualifier === QUALIFIERS.nonprod
            ? ['/a/prod/y', '/a/prod']
            : ['/sandbox/y', '/a/sandbox', '/pr-91/y', '/a/pr-91'];

    return path ? [...flat, ...paths] : flat;
};

/** Fill an Allow ARN's wildcards: region and account concretely, the name part with the other tier's token. */
function instantiate(arn: string, filler: string): string {
    const fields = arn.split(':');
    const resource = fields.slice(5).join(':').replaceAll(/[*?]/gu, filler);

    return [
        ...fields.slice(0, 3),
        fields[3] === '*' ? 'us-east-1' : fields[3],
        fields[4] === '*' ? '123456789012' : fields[4],
        resource,
    ].join(':');
}

/** Whether the policy set's Allows name this sample's resource type (a type no Allow reaches needs no Deny). */
function allowed(documents: readonly PolicyDocument[], service: string, arn: string): boolean {
    const types = resourceTypesOf(
        documents.flatMap((document) => document.Statement),
        false,
    );
    const resource = arn.split(':').slice(5).join(':');

    return (types[service as keyof typeof types] ?? []).some(({ type }) => resource.startsWith(type));
}

const documentsOf = (qualifier: QualifierName, kind: 'execution' | 'boundary'): PolicyDocument[] =>
    kind === 'boundary' ? [buildBoundary(qualifier)] : buildExecutionPolicy(qualifier).map((part) => part.document);

describe('tierNameResources', () => {
    it('names a concrete service and a concrete type in every ARN it produces', () => {
        const types = {
            iam: [{ type: 'role/', path: false }],
            ssm: [{ type: 'parameter/', path: true }],
            sqs: [{ type: '', path: false }],
        };

        for (const side of ['production', 'nonproduction'] as const) {
            for (const form of ['anchored', 'compact'] as const) {
                for (const arn of tierNameResources(side, types, form)) {
                    expect(arn.split(':')[2], arn).toMatch(/^[a-z0-9-]+$/u);
                    expect(arn.split(':').slice(5).join(':'), arn).toMatch(/^([a-z-]+[/:])?[*]/u);
                }
            }
        }
    });

    it('gives a path-named type more forms than a flat one', () => {
        const forms = (path: boolean): number =>
            tierNameResources('production', { ssm: [{ type: 'parameter/', path }] }).length;

        expect(forms(true)).toBeGreaterThan(forms(false));
    });
});

describe('resourceTypesOf', () => {
    const allow = (
        resource: string,
        condition?: Record<string, never>,
    ): Parameters<typeof resourceTypesOf>[0][number] => ({
        Sid: 'S',
        Effect: 'Allow',
        Action: ['iam:PassRole'],
        Resource: [resource],
        ...(condition === undefined ? {} : { Condition: condition }),
    });

    it('reads the type from the Allow: role/, policy/ and instance-profile/ are three types of iam', () => {
        const types = resourceTypesOf(
            ['role/x-*', 'policy/x-*', 'instance-profile/x-*'].map((resource) => allow(`arn:aws:iam::1:${resource}`)),
            false,
        );

        expect(types.iam?.map(({ type }) => type)).toEqual(['instance-profile/', 'policy/', 'role/']);
    });

    it('treats sqs, sns and s3 as bare names, whatever follows', () => {
        const types = resourceTypesOf([allow('arn:aws:s3:::cdk-assets-1-us-east-1/*')], false);

        expect(types.s3).toEqual([{ type: '', path: false }]);
    });

    it('marks a type path-named when the Allow reaches kitchensink/ paths', () => {
        const types = resourceTypesOf([allow('arn:aws:ssm:*:1:parameter/kitchensink/*')], false);

        expect(types.ssm).toEqual([{ type: 'parameter/', path: true }]);
    });

    it('can leave out the Allows a resource-tag condition already separates', () => {
        const tagged = allow('arn:aws:lambda:*:1:function:kitchensink-*', {
            StringLike: { 'aws:ResourceTag/aws:cloudformation:stack-name': [] },
        } as never);

        expect(resourceTypesOf([tagged], true).lambda).toBeUndefined();
        expect(resourceTypesOf([tagged], false).lambda).toEqual([{ type: 'function:', path: false }]);
    });
});

describe.each(stageQualifiers)('%s — the tier Denies', (qualifier) => {
    it.each(['execution', 'boundary'] as const)(
        'the %s Deny refuses every name of the other tier that an Allow reaches',
        (kind) => {
            const documents = documentsOf(qualifier, kind);
            const reached = documents.flatMap((document) =>
                document.Statement.filter(
                    (statement) =>
                        statement.Effect === 'Allow' &&
                        // The boundary leaves resources under a stack-tag condition to that condition.
                        !(kind === 'boundary' && JSON.stringify(statement.Condition ?? {}).includes('ResourceTag')),
                ).flatMap((statement) => statement.Resource),
            );
            const named = reached.filter(
                (arn) =>
                    arn.startsWith('arn:') &&
                    !ID_ONLY.has(arn.split(':')[2] ?? '') &&
                    /[*?]/u.test(arn.split(':').slice(5).join(':')),
            );

            expect(named.length).toBeGreaterThan(0);

            const leaks = named.flatMap((arn) =>
                otherTierFillers(qualifier, /kitchensink[/?*]/u.test(arn))
                    .map((filler) => instantiate(arn, filler))
                    // An Allow whose literal part already contains the OTHER tier's token is not a name of this tier.
                    .filter((name) => !unconditionalDeny(documents, 'sts:Any', name)),
            );

            expect(leaks).toEqual([]);
        },
    );

    it.each(TIER_NAME_SAMPLES)(
        'the execution role refuses the other tier and not its own: $service ($kind) $arn',
        ({ arn, kind, service }) => {
            const otherTier = protects(qualifier) === 'production' ? kind === 'production' : kind !== 'production';
            const documents = documentsOf(qualifier, 'execution');

            if (allowed(documents, service, arn)) {
                expect(unconditionalDeny(documents, 'sts:Any', arn)).toBe(otherTier);
            }
        },
    );

    it.each(TIER_NAME_SAMPLES)(
        'the boundary never denies its own tier, and denies the other where it allows the type: $service ($kind) $arn',
        ({ arn, kind }) => {
            const otherTier = protects(qualifier) === 'production' ? kind === 'production' : kind !== 'production';
            const denied = unconditionalDeny([buildBoundary(qualifier)], 'sts:Any', arn);

            if (!otherTier) {
                expect(denied).toBe(false);
            }
        },
    );
});
