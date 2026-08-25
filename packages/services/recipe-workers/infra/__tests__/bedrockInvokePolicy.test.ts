/**
 * The `bedrock:InvokeModel` resources the MODEL REGISTRY requires beyond the in-region foundation-model
 * wildcard (U35, ADR-0024 layer 4b).
 *
 * ⛔ WHY A PURE HELPER RATHER THAN ONLY A SYNTH ASSERTION. `BEDROCK_MODEL_REGISTRY` is a frozen module
 * constant with no injection seam, so the questions worth asking — "what happens when a profile spans four
 * regions", "what happens when the registry has no profile at all" — are unaskable through the stack without
 * mocking a module and dynamically importing CDK. A function that takes the registry as a parameter can be
 * asked all of them; the synth suite then pins that the STACK really calls it with the shipped table.
 *
 * ⚠️ The shape is AWS's own least-privilege example for cross-region inference, and it is TWO statements on
 * one role rather than one: the profile is an account-scoped `inference-profile` resource, while the models it
 * fans out to are account-LESS `foundation-model` resources in regions the caller never names. The second
 * statement carries a `bedrock:InferenceProfileArn` condition so the cross-region reach is usable ONLY through
 * the profile that justified it — without it, granting us-west-2 for a profile would also grant every direct
 * us-west-2 call on that model.
 */
import { describe, expect, it } from 'vitest';

import { BEDROCK_MODEL_REGISTRY, type ModelRegistryEntry } from '@kitchensink/recipe-core/spend/spend-arithmetic';

import { inferenceProfileStatements, type BedrockArnParts } from '../lib/bedrockInvokePolicy.js';

/** The account the fake formatter stands in for — the deploying account. */
const ACCOUNT = '123456789012';

/** The region the fake formatter deploys from. */
const DEPLOY_REGION = 'us-east-1';

/**
 * An ARN formatter with the same defaulting rules `Stack.formatArn` applies: an absent region or account
 * means the deploying stack's, and an EMPTY account is the account-less form AWS publishes foundation models
 * under.
 *
 * @param parts - The ARN's variable components.
 * @returns The formatted ARN. Pure.
 */
const formatArn = (parts: BedrockArnParts): string =>
    `arn:aws:bedrock:${parts.region ?? DEPLOY_REGION}:${parts.account ?? ACCOUNT}:${parts.resource}/${parts.resourceName}`;

/** The rate half of a fixture entry — irrelevant to addressing, so identical everywhere below. */
const RATE = {
    inputMicrosPerMillionTokens: 1,
    outputMicrosPerMillionTokens: 1,
    cacheReadMicrosPerMillionTokens: 1,
    cacheWriteMicrosPerMillionTokens: 1,
    effectiveDate: '2026-08-20',
    priceVerified: true,
} as const;

/**
 * A registry entry addressed by its own id — an on-demand model.
 *
 * @param modelId - The model id, which is also its address.
 * @returns A one-entry registry. Pure.
 */
const onDemand = (modelId: string): Readonly<Record<string, ModelRegistryEntry>> => ({
    [modelId]: { rate: RATE, invocation: { invocationId: modelId, reach: { kind: 'deploy-region' } } },
});

/**
 * A registry entry addressed through a cross-region inference profile.
 *
 * @param modelId - The model id, i.e. the registry key.
 * @param invocationId - The inference-profile id `Converse` is called with.
 * @param regions - Every region the profile routes to.
 * @returns A one-entry registry. Pure.
 */
const throughProfile = (
    modelId: string,
    invocationId: string,
    regions: readonly string[],
): Readonly<Record<string, ModelRegistryEntry>> => ({
    [modelId]: { rate: RATE, invocation: { invocationId, reach: { kind: 'regions', regions, readOn: '2026-08-23' } } },
});

describe('inferenceProfileStatements', () => {
    it('adds NOTHING for a registry of on-demand models — the in-region wildcard already covers them', () => {
        // The regression assertion for Nova Micro, which is what the gate actually ships pointed at: a model
        // addressed by its own id needs no new resource, and emitting one would widen the policy for nothing.
        expect(inferenceProfileStatements(onDemand('amazon.nova-micro-v1:0'), formatArn)).toEqual([]);
    });

    it('grants the PROFILE arn with the account populated', () => {
        const [profileStatement] = inferenceProfileStatements(
            throughProfile('anthropic.model-v1:0', 'us.anthropic.model-v1:0', ['us-east-1', 'us-west-2']),
            formatArn,
        );

        // ⛔ Account-SCOPED and in the deploy region: an inference profile is a resource in the caller's own
        // account, unlike the foundation models it routes to.
        expect(profileStatement?.resources).toEqual([
            `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.model-v1:0`,
        ]);
        expect(profileStatement?.throughInferenceProfileArns).toBeUndefined();
    });

    it('grants the fanned-out FOUNDATION MODEL in every region the profile spans, account-LESS', () => {
        const [, fanOut] = inferenceProfileStatements(
            throughProfile('anthropic.model-v1:0', 'us.anthropic.model-v1:0', ['us-east-1', 'us-east-2', 'us-west-2']),
            formatArn,
        );

        // ⚠️ THE BARE MODEL ID, not the profile id — the profile routes to the model, and it is the model the
        // authorization is finally evaluated against in the destination region.
        expect(fanOut?.resources).toEqual([
            'arn:aws:bedrock:us-east-1::foundation-model/anthropic.model-v1:0',
            'arn:aws:bedrock:us-east-2::foundation-model/anthropic.model-v1:0',
            'arn:aws:bedrock:us-west-2::foundation-model/anthropic.model-v1:0',
        ]);
    });

    it('makes that cross-region reach usable ONLY through the profile that justified it', () => {
        const [, fanOut] = inferenceProfileStatements(
            throughProfile('anthropic.model-v1:0', 'us.anthropic.model-v1:0', ['us-east-1', 'us-west-2']),
            formatArn,
        );

        // Without this condition the statement would also authorize a DIRECT us-west-2 invocation of the
        // model — a reach nothing in the registry asked for, and one the gate could not account for.
        expect(fanOut?.throughInferenceProfileArns).toEqual([
            `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.model-v1:0`,
        ]);
    });

    it('keeps every profile’s fan-out in its own statement, so one profile cannot borrow another’s regions', () => {
        const statements = inferenceProfileStatements(
            {
                ...throughProfile('anthropic.a-v1:0', 'us.anthropic.a-v1:0', ['us-east-1', 'us-west-2']),
                ...throughProfile('anthropic.b-v1:0', 'eu.anthropic.b-v1:0', ['eu-west-1', 'eu-central-1']),
            },
            formatArn,
        );

        // One shared statement listing both profiles in a StringLike would let A reach eu-west-1.
        expect(statements).toHaveLength(3);
        expect(statements[1]?.throughInferenceProfileArns).toHaveLength(1);
        expect(statements[2]?.throughInferenceProfileArns).toHaveLength(1);
        expect(statements[1]?.throughInferenceProfileArns).not.toEqual(statements[2]?.throughInferenceProfileArns);
    });

    it('never emits a wildcard resource', () => {
        const statements = inferenceProfileStatements(BEDROCK_MODEL_REGISTRY, formatArn);

        for (const { resources } of statements) {
            for (const resource of resources) {
                expect(resource, 'an inference-profile grant is enumerable and must not be widened').not.toContain('*');
            }
        }
    });

    /**
     * ⛔ THE NON-VACUITY FLOOR. Every assertion above runs against a fixture; this one runs against the table
     * the stack actually deploys, and DERIVES what it expects from that table rather than restating it. If the
     * registry ever loses its profile-addressed entry, this fails rather than passing over nothing — which is
     * the failure mode a fixture-only suite cannot see.
     */
    it('covers every profile-addressed entry the SHIPPED registry carries', () => {
        const profileAddressed = Object.entries(BEDROCK_MODEL_REGISTRY).filter(
            ([modelId, entry]) => entry.invocation.invocationId !== modelId,
        );

        expect(profileAddressed.length, 'the registry no longer carries a profile-addressed model').toBeGreaterThan(0);

        const granted = new Set(
            inferenceProfileStatements(BEDROCK_MODEL_REGISTRY, formatArn).flatMap(({ resources }) => resources),
        );

        for (const [modelId, entry] of profileAddressed) {
            expect(granted, modelId).toContain(
                `arn:aws:bedrock:${DEPLOY_REGION}:${ACCOUNT}:inference-profile/${entry.invocation.invocationId}`,
            );

            const { reach } = entry.invocation;

            if (reach.kind !== 'regions') {
                continue;
            }

            for (const region of reach.regions) {
                expect(granted, `${modelId} in ${region}`).toContain(
                    `arn:aws:bedrock:${region}::foundation-model/${modelId}`,
                );
            }
        }
    });
});
