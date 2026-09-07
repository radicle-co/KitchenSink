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

import {
    BEDROCK_MODEL_REGISTRY,
    DEFAULT_MONTHLY_CEILING_MICROS,
    planReservation,
    residencyClearance,
    type ModelRegistryEntry,
    type ResidencyApproval,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';

import { bedrockInvokeStatements, type BedrockArnParts } from '../lib/bedrockInvokePolicy.js';

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
 * The warrant every fixture below uses where residency has been decided.
 *
 * ⛔ A FIXTURE ONLY. `spendArithmetic.test.ts` asserts that NO SHIPPED entry carries one — approving a real
 * model is 016's decision and must show up as its own diff, not as a test constant leaking into the table.
 */
const APPROVAL: ResidencyApproval = { approvedOn: '2026-09-04', reference: 'ADR-0024 §9 (fixture)' };

/**
 * A registry entry addressed through a cross-region inference profile.
 *
 * ⚠️ `residencyApproval` is a REQUIRED parameter, not an optional one. Every ARN-shape test below wants an
 * APPROVED profile (its subject is the ARN, not the warrant) while the residency tests want an unapproved
 * one, and a default would have silently given the shape tests whichever arm the default happened to pick —
 * which is how they would go on passing over a profile the derivation had stopped emitting at all.
 *
 * @param modelId - The model id, i.e. the registry key.
 * @param invocationId - The inference-profile id `Converse` is called with.
 * @param regions - Every region the profile routes to.
 * @param residencyApproval - The residency warrant, or `undefined` for an entry 016 has not cleared.
 * @returns A one-entry registry. Pure.
 */
const throughProfile = (
    modelId: string,
    invocationId: string,
    regions: readonly string[],
    residencyApproval: ResidencyApproval | undefined,
): Readonly<Record<string, ModelRegistryEntry>> => ({
    [modelId]: {
        rate: RATE,
        invocation: {
            invocationId,
            reach: {
                kind: 'regions',
                regions,
                readOn: '2026-08-23',
                ...(residencyApproval === undefined ? {} : { residencyApproval }),
            },
        },
    },
});

describe('bedrockInvokeStatements', () => {
    it('grants each self-addressed model BY NAME in the deploy region — account-less, unconditioned, no wildcard', () => {
        // ⛔ THE STATEMENT THAT REPLACED `foundation-model/*`. An on-demand model is invoked by its own id in
        // the deploy region, so its grant is exactly that ARN. The registry is the compile-time authority for
        // which ids exist ("membership is authorization", ADR-0024), and every runtime caller already refuses
        // an id outside it before any call — so a wildcard bought nothing and re-opened the reach the counter
        // has no view of. This test used to assert `[]` here, on the claim that the wildcard "already covers"
        // an on-demand model; that claim is what ADR-0024 §4b retracted.
        expect(bedrockInvokeStatements(onDemand('amazon.nova-micro-v1:0'), formatArn, DEPLOY_REGION)).toEqual([
            { resources: ['arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0'] },
        ]);
    });

    it('grants NOTHING for an empty registry — no model, no permission', () => {
        expect(bedrockInvokeStatements({}, formatArn, DEPLOY_REGION)).toEqual([]);
    });

    /**
     * ⛔ AN UNRESOLVED REGION MUST FAIL THE SYNTH, not quietly narrow the policy.
     *
     * The residency comparison is `regions.every(r => r === deployRegion)`. Hand it a CloudFormation token —
     * which is what `Stack.region` becomes for an env-agnostic stack — and it matches nothing: every profile
     * loses its grant, the deploy SUCCEEDS, and the first call meets `AccessDenied` for a model the registry
     * and the runtime both consider fine. That is a failure with no symptom until traffic arrives, so it is
     * refused at the only moment it is cheap to refuse.
     *
     * ⚠️ It also catches the duller inputs — `''`, `'undefined'`, a typo — for the same reason: they are all
     * values the comparison silently reads as "matches nothing".
     */
    it.each([['${Token[AWS.Region.4]}'], [''], ['undefined'], ['us-east']])(
        'refuses an unresolved deploy region (%s) rather than silently granting nothing',
        (region) => {
            expect(() => bedrockInvokeStatements(onDemand('amazon.nova-micro-v1:0'), formatArn, region)).toThrow(
                /resolved deploy region/u,
            );
        },
    );

    it('accepts every region SHAPE, holding no opinion about which regions exist', () => {
        // Not a list of AWS regions: this module has no business going stale the day one is added.
        for (const region of ['us-east-1', 'ap-southeast-2', 'eu-central-1', 'us-gov-west-1']) {
            expect(() => bedrockInvokeStatements({}, formatArn, region), region).not.toThrow();
        }
    });

    it('names every self-addressed model in ONE unconditioned statement, in registry order', () => {
        const statements = bedrockInvokeStatements(
            { ...onDemand('amazon.nova-micro-v1:0'), ...onDemand('amazon.nova-lite-v1:0') },
            formatArn,
            DEPLOY_REGION,
        );

        expect(statements).toEqual([
            {
                resources: [
                    'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0',
                    'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0',
                ],
            },
        ]);
    });

    it('gives a profile-addressed model NO unconditioned bare-id grant in the deploy region', () => {
        // The registry never calls it by its bare id, so a deploy-region `foundation-model/<id>` outside the
        // conditioned fan-out would authorize a direct call nothing asked for — the reach the condition exists
        // to deny, handed back through the front door.
        const statements = bedrockInvokeStatements(
            throughProfile('anthropic.model-v1:0', 'us.anthropic.model-v1:0', ['us-east-1', 'us-west-2'], APPROVAL),
            formatArn,
            DEPLOY_REGION,
        );
        const unconditioned = statements.filter((statement) => statement.throughInferenceProfileArns === undefined);

        expect(unconditioned.flatMap((statement) => statement.resources)).toEqual([
            `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.model-v1:0`,
        ]);
    });

    it('grants the PROFILE arn with the account populated', () => {
        const [profileStatement] = bedrockInvokeStatements(
            throughProfile('anthropic.model-v1:0', 'us.anthropic.model-v1:0', ['us-east-1', 'us-west-2'], APPROVAL),
            formatArn,
            DEPLOY_REGION,
        );

        // ⛔ Account-SCOPED and in the deploy region: an inference profile is a resource in the caller's own
        // account, unlike the foundation models it routes to.
        expect(profileStatement?.resources).toEqual([
            `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.model-v1:0`,
        ]);
        expect(profileStatement?.throughInferenceProfileArns).toBeUndefined();
    });

    it('grants the fanned-out FOUNDATION MODEL in every region the profile spans, account-LESS', () => {
        const [, fanOut] = bedrockInvokeStatements(
            throughProfile(
                'anthropic.model-v1:0',
                'us.anthropic.model-v1:0',
                ['us-east-1', 'us-east-2', 'us-west-2'],
                APPROVAL,
            ),
            formatArn,
            DEPLOY_REGION,
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
        const [, fanOut] = bedrockInvokeStatements(
            throughProfile('anthropic.model-v1:0', 'us.anthropic.model-v1:0', ['us-east-1', 'us-west-2'], APPROVAL),
            formatArn,
            DEPLOY_REGION,
        );

        // Without this condition the statement would also authorize a DIRECT us-west-2 invocation of the
        // model — a reach nothing in the registry asked for, and one the gate could not account for.
        expect(fanOut?.throughInferenceProfileArns).toEqual([
            `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.model-v1:0`,
        ]);
    });

    it('keeps every profile’s fan-out in its own statement, so one profile cannot borrow another’s regions', () => {
        const statements = bedrockInvokeStatements(
            {
                ...throughProfile('anthropic.a-v1:0', 'us.anthropic.a-v1:0', ['us-east-1', 'us-west-2'], APPROVAL),
                ...throughProfile('anthropic.b-v1:0', 'eu.anthropic.b-v1:0', ['eu-west-1', 'eu-central-1'], APPROVAL),
            },
            formatArn,
            DEPLOY_REGION,
        );

        // One shared statement listing both profiles in a StringLike would let A reach eu-west-1.
        expect(statements).toHaveLength(3);
        expect(statements[1]?.throughInferenceProfileArns).toHaveLength(1);
        expect(statements[2]?.throughInferenceProfileArns).toHaveLength(1);
        expect(statements[1]?.throughInferenceProfileArns).not.toEqual(statements[2]?.throughInferenceProfileArns);
    });

    it('never emits a wildcard resource', () => {
        const statements = bedrockInvokeStatements(BEDROCK_MODEL_REGISTRY, formatArn, DEPLOY_REGION);

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
     *
     * ⚠️ NARROWED by the residency wiring (ADR-0024 §4b). It used to cover EVERY profile-addressed entry, on
     * the rule that the grant follows registry MEMBERSHIP. It now covers every profile residency CLEARS, and
     * the shipped table clears none — so the loop's subject is the entries that remain, and the two shipped
     * profiles are asserted ABSENT by the test below instead.
     */
    it('covers every residency-CLEARED profile the SHIPPED registry carries', () => {
        const profileAddressed = Object.entries(BEDROCK_MODEL_REGISTRY).filter(
            ([modelId, entry]) =>
                entry.invocation.invocationId !== modelId && residencyClearance(entry, DEPLOY_REGION) !== 'unapproved',
        );
        const granted = new Set(
            bedrockInvokeStatements(BEDROCK_MODEL_REGISTRY, formatArn, DEPLOY_REGION).flatMap(
                ({ resources }) => resources,
            ),
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

    /**
     * ⛔ THE HALF THAT CLOSES ADR-0024 §4b's OPEN GAP, asserted on the LITERAL ids rather than derived.
     *
     * Every other assertion here derives its expectation from the registry through `residencyClearance`, which
     * is the same predicate the implementation calls — so a mutation that turned the filter off in BOTH would
     * be invisible. These two strings are the shipped table's two unapproved profiles, written out, and this
     * test says the deployed role may not name them anywhere. It is also the concrete claim the ADR made and
     * could not keep: "the only things standing between recipe text and us-east-2/us-west-2 are the SSM model
     * parameter and this entry's presence in the table."
     */
    it('grants NOTHING for a profile 016 has not cleared — no profile arn, no fan-out, no destination region', () => {
        const granted = bedrockInvokeStatements(BEDROCK_MODEL_REGISTRY, formatArn, DEPLOY_REGION).flatMap(
            ({ resources, throughInferenceProfileArns }) => [...resources, ...(throughInferenceProfileArns ?? [])],
        );

        for (const invocationId of ['us.amazon.nova-2-lite-v1:0', 'us.anthropic.claude-haiku-4-5-20251001-v1:0']) {
            expect(
                granted.filter((arn) => arn.includes(invocationId)),
                invocationId,
            ).toEqual([]);
        }

        // ⛔ AND NOT ONE ARN OUTSIDE THE DEPLOY REGION. The fan-out statements were the only thing that ever
        // named another region, so their removal is observable as an absence of the region itself.
        for (const arn of granted) {
            expect(arn, arn).not.toContain(':us-east-2:');
            expect(arn, arn).not.toContain(':us-west-2:');
        }
    });

    /**
     * ⛔ THE PARITY GUARD — the whole reason ADR-0024 §4b insisted both halves land as ONE change: "or IAM will
     * grant what the runtime refuses (or the reverse)". A model the runtime cannot reserve for must not be
     * granted, and a model it CAN reserve for must be, or the deploy hands the gate an `AccessDenied` in place
     * of a call it planned and priced.
     *
     * ⚠️ Both directions, over the shipped table, with non-vacuity on each arm.
     */
    it('agrees with planReservation about every model — no ARN the runtime refuses, none it needs missing', () => {
        const granted = new Set(
            bedrockInvokeStatements(BEDROCK_MODEL_REGISTRY, formatArn, DEPLOY_REGION).flatMap(
                ({ resources }) => resources,
            ),
        );
        let reservable = 0;
        let refused = 0;

        for (const [modelId, entry] of Object.entries(BEDROCK_MODEL_REGISTRY)) {
            const plan = planReservation({
                modelId,
                ceilingMicros: DEFAULT_MONTHLY_CEILING_MICROS,
                maxInputTokens: 1_000,
                maxOutputTokens: 200,
                nowUtc: new Date('2026-09-04T00:00:00.000Z'),
                deployRegion: DEPLOY_REGION,
            });
            const { invocationId } = entry.invocation;
            const address =
                invocationId === modelId
                    ? `arn:aws:bedrock:${DEPLOY_REGION}::foundation-model/${modelId}`
                    : `arn:aws:bedrock:${DEPLOY_REGION}:${ACCOUNT}:inference-profile/${invocationId}`;

            if (plan.kind === 'priced') {
                expect(granted, `${modelId}: the runtime plans a call IAM would deny`).toContain(address);
                reservable += 1;
                continue;
            }

            expect(granted, `${modelId}: IAM grants a model the runtime refuses`).not.toContain(address);
            refused += 1;
        }

        expect(reservable, 'nothing is reservable — the parity holds over nothing').toBeGreaterThan(0);
        expect(refused, 'nothing is refused — the residency branch is unexercised').toBeGreaterThan(0);
    });

    /**
     * ⛔ THE MUTATION TEST THE OWNER ASKED FOR: flipping ONE fixture entry's warrant must move BOTH halves.
     *
     * The registry cannot be injected into `planReservation`, so the runtime half is represented by the shared
     * predicate the reservation composes — which is the point of `residencyClearance` being "the only
     * interpreter of the marker". What this proves is that the IAM derivation moves in LOCKSTEP with that
     * interpreter, in both directions, on the same entry: warranted → granted, warrant removed → nothing.
     */
    it('moves the grant with the warrant — one fixture entry, both answers, in lockstep', () => {
        const regions = ['us-east-1', 'us-west-2'];
        const approved = throughProfile('vendor.model-v1:0', 'us.vendor.model-v1:0', regions, APPROVAL);
        const unapproved = throughProfile('vendor.model-v1:0', 'us.vendor.model-v1:0', regions, undefined);

        expect(residencyClearance(approved['vendor.model-v1:0']!, DEPLOY_REGION)).toBe('approved');
        expect(residencyClearance(unapproved['vendor.model-v1:0']!, DEPLOY_REGION)).toBe('unapproved');

        expect(bedrockInvokeStatements(approved, formatArn, DEPLOY_REGION)).not.toEqual([]);
        expect(bedrockInvokeStatements(unapproved, formatArn, DEPLOY_REGION)).toEqual([]);
    });

    it('grants EXACTLY the shipped registry — set equality in both directions, so nothing rides along', () => {
        // ⛔ Bidirectional. `toContain` per entry proves the grant is not too NARROW; only equality proves it
        // is not too WIDE — the property the wildcard's removal is for.
        const expected = new Set(
            Object.entries(BEDROCK_MODEL_REGISTRY).flatMap(([modelId, entry]) => {
                const { invocation } = entry;

                if (residencyClearance(entry, DEPLOY_REGION) === 'unapproved') {
                    return [];
                }

                if (invocation.invocationId === modelId) {
                    return [`arn:aws:bedrock:${DEPLOY_REGION}::foundation-model/${modelId}`];
                }

                const profile = `arn:aws:bedrock:${DEPLOY_REGION}:${ACCOUNT}:inference-profile/${invocation.invocationId}`;
                const fanOut =
                    invocation.reach.kind === 'regions'
                        ? invocation.reach.regions.map(
                              (region) => `arn:aws:bedrock:${region}::foundation-model/${modelId}`,
                          )
                        : [];

                return [profile, ...fanOut];
            }),
        );
        const granted = new Set(
            bedrockInvokeStatements(BEDROCK_MODEL_REGISTRY, formatArn, DEPLOY_REGION).flatMap(
                ({ resources }) => resources,
            ),
        );

        // Non-vacuity on the on-demand side: the gate's shipped default is addressed by its own id.
        expect(expected.has(`arn:aws:bedrock:${DEPLOY_REGION}::foundation-model/amazon.nova-micro-v1:0`)).toBe(true);
        expect(granted).toEqual(expected);
    });
});
