/**
 * The tier-name Denies (`DenyProductionNames`, `DenyNonProductionNames`) must keep each stage tier out of the other's
 * names with CONCRETE services in every ARN (IAM refuses a wildcard vendor), and must still cover every service the
 * policies allow.
 *
 * Three claims, each judged against the rendered documents:
 *
 * 1. **Coverage.** Every service a policy set allows is either named by its tier Deny or listed below as one whose
 *    ARNs carry no name, with the reason. A new service added to an Allow therefore fails here, not in production.
 * 2. **Both directions, per service.** For every covered service the other tier's sample name is refused and the
 *    policy's own tier's names (sandbox AND preview, or production) are not.
 * 3. **The vendors are concrete** (also held for every document by `arnGrammar.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { BOUNDARY_TIER_SERVICES, buildBoundary } from '../src/boundary.js';
import { buildExecutionPolicy } from '../src/executionPolicy.js';
import { unconditionalDeny } from '../src/policyEval.js';
import { QUALIFIERS, type QualifierName } from '../src/qualifiers.js';
import { TIER_SERVICES, tierNameResources, type TierService } from '../src/tierNames.js';
import type { PolicyDocument } from '../src/policyDocument.js';
import { TIER_NAME_SAMPLES } from './nameFixtures.js';

/** Services an Allow reaches whose ARNs hold generated ids, never a name: a name pattern could not match them. */
const ID_ONLY: Readonly<Record<string, string>> = {
    acm: 'certificate ARNs end in a generated UUID',
    apigateway: 'REST API, stage and domain ARNs are generated ids',
    'application-autoscaling': 'scalable targets are addressed by generated ids',
    bedrock: 'model and inference-profile ids carry no stage',
    budgets: 'account-level singletons, named only by the account app',
    ce: 'account-level singletons, named only by the account app',
    ec2: 'ARNs are resource ids (i-, vpc-, sg-, subnet-)',
    'rds-db': 'a login ARN is an opaque db-XXXX id plus a role name that carries no stage (ADR-0039)',
    route53: 'hosted zones are addressed by generated ids',
    tag: 'account-wide read, no resource',
    xray: 'account-wide telemetry, no resource',
};

/** Services the BOUNDARY leaves without a name Deny, with the reason (a tag condition, or ids only). */
const BOUNDARY_EXEMPT: Readonly<Record<string, string>> = {
    lambda: 'TaggedCompute allows it only on resources tagged with a stack of the tier',
    states: 'TaggedCompute allows it only on resources tagged with a stack of the tier',
    cloudfront: 'the boundary reaches distributions only, which are addressed by generated ids',
};

const stageQualifiers = [QUALIFIERS.nonprod, QUALIFIERS.prod] as const;

const sideOf = (qualifier: QualifierName): 'production' | 'nonproduction' =>
    qualifier === QUALIFIERS.nonprod ? 'production' : 'nonproduction';

/** The services an Allow reaches: the service of each concrete resource ARN, and the action's own service for `*`. */
const servicesAllowed = (documents: readonly PolicyDocument[]): string[] => [
    ...new Set(
        documents.flatMap((document) =>
            document.Statement.filter((statement) => statement.Effect === 'Allow').flatMap((statement) =>
                statement.Resource.flatMap((resource) =>
                    resource === '*'
                        ? statement.Action.flatMap((action) => (action === '*' ? [] : [action.split(':')[0] ?? '']))
                        : [resource.split(':')[2] ?? ''],
                ),
            ),
        ),
    ),
];

const executionDocuments = (qualifier: QualifierName): PolicyDocument[] =>
    buildExecutionPolicy(qualifier).map((part) => part.document);

describe('tierNameResources', () => {
    it('names a concrete service in every ARN it produces', () => {
        for (const side of ['production', 'nonproduction'] as const) {
            for (const form of ['anchored', 'compact'] as const) {
                for (const arn of tierNameResources(side, TIER_SERVICES, form)) {
                    expect(arn.split(':')[2], arn).toMatch(/^[a-z0-9-]+$/u);
                    expect(arn.startsWith('arn:aws:'), arn).toBe(true);
                }
            }
        }
    });

    it('gives the path-named services (ssm, secretsmanager, logs) more forms than the flat ones', () => {
        const forms = (service: TierService): number => tierNameResources('production', [service]).length;

        expect(forms('ssm')).toBeGreaterThan(forms('sqs'));
        expect(forms('secretsmanager')).toBeGreaterThan(forms('sqs'));
        expect(forms('logs')).toBeGreaterThan(forms('sqs'));
    });
});

describe.each(stageQualifiers)('%s — coverage of the tier Deny', (qualifier) => {
    const side = sideOf(qualifier);

    it('the execution role covers every service it allows that has names in its ARNs', () => {
        const uncovered = servicesAllowed(executionDocuments(qualifier)).filter(
            (service) => !(TIER_SERVICES as readonly string[]).includes(service) && ID_ONLY[service] === undefined,
        );

        expect(uncovered).toEqual([]);
    });

    it('the boundary covers every service it allows that has names in its ARNs', () => {
        const uncovered = servicesAllowed([buildBoundary(qualifier)]).filter(
            (service) =>
                !(BOUNDARY_TIER_SERVICES[qualifier] as readonly string[]).includes(service) &&
                ID_ONLY[service] === undefined &&
                BOUNDARY_EXEMPT[service] === undefined,
        );

        expect(uncovered).toEqual([]);
    });

    it('lists no service as id-only or tag-conditioned that a Deny covers anyway (a stale reason hides the next gap)', () => {
        const stale = Object.keys({ ...ID_ONLY, ...BOUNDARY_EXEMPT }).filter((service) =>
            (BOUNDARY_TIER_SERVICES[qualifier] as readonly string[]).includes(service),
        );

        expect(stale).toEqual([]);
    });

    it('the boundary names only services the boundary allows (a Deny line nothing allows is dead size)', () => {
        const allowed = new Set(servicesAllowed([buildBoundary(qualifier)]));

        expect(BOUNDARY_TIER_SERVICES[qualifier].filter((service) => !allowed.has(service))).toEqual([]);
    });

    it.each(
        TIER_NAME_SAMPLES.filter((sample) =>
            (BOUNDARY_TIER_SERVICES[qualifier] as readonly string[]).includes(sample.service),
        ),
    )('the boundary refuses the other tier: $service ($kind) $arn', ({ arn, kind }) => {
        const otherTier = side === 'production' ? kind === 'production' : kind !== 'production';

        expect(unconditionalDeny([buildBoundary(qualifier)], 'sts:Any', arn)).toBe(otherTier);
    });

    it.each(TIER_NAME_SAMPLES)(
        'the execution role does not refuse its own tier: $service ($kind) $arn',
        ({ arn, kind }) => {
            const otherTier = side === 'production' ? kind === 'production' : kind !== 'production';

            expect(unconditionalDeny(executionDocuments(qualifier), 'sts:Any', arn)).toBe(otherTier);
        },
    );
});
