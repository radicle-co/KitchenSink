/**
 * EVERY `bedrock:InvokeModel` RESOURCE THE VERIFICATION ROLE MAY NAME (U35, ADR-0024 layer 4b).
 *
 * DESIGN PATTERN: a pure **derivation** over the model registry — the same decide/evaluate split the spend
 * ceiling uses. `BEDROCK_MODEL_REGISTRY` already decides which models may be called at all ("membership is
 * authorization", ADR-0024); this turns that one fact into the ARNs the grant must name, so the permission
 * and the caller can never disagree about which models exist. The CDK stack is left with nothing to get wrong
 * but the `formatArn` binding.
 *
 * ## ⛔ THE REGISTRY IS THE ONLY AUTHORITY — there is no `foundation-model/*` beside it any more
 *
 * The stack used to carry an in-region `foundation-model/*` wildcard for on-demand models, justified as
 * irreducible because "the model id comes from SSM and cannot be resolved at synth time". ADR-0024 §4b
 * retracted that justification the day this derivation landed: the registry IS resolvable at synth time, and
 * every runtime caller (`verifyLine`, `gatedLlm`, the band drain, the foodness pin) refuses an id outside it
 * BEFORE any call is made. So the wildcard authorized exactly the set of models the runtime could never
 * reach — a second, un-derived authority on "which models may be invoked" standing beside the registry, and a
 * standing IAM5 acceptance whose reason had already been withdrawn. It is gone: an on-demand model is granted
 * by its own ARN, from the same table that prices it, and adding a model to the roster is a registry edit plus
 * a deploy of this stack — which was already true for its PRICE.
 *
 * ## ⛔ WHY A PROFILE-ADDRESSED MODEL NEEDS MORE THAN ITS NAME
 *
 * The gate invokes Bedrock with the model's INVOCATION id, which for a profile-only model — Claude Haiku 4.5
 * reports `inferenceTypesSupported: ["INFERENCE_PROFILE"]` — is an inference-profile id, not a model id.
 * That is a different resource TYPE (`inference-profile`, and account-SCOPED where a foundation model is
 * account-less), and invoking it routes the call to foundation models in regions the caller never names: a
 * `us.` profile called from us-east-1 reaches us-east-1, us-east-2 and us-west-2. Threading the invocation id
 * WITHOUT those grants would convert a `ValidationException` that names the problem into an `AccessDenied`
 * that does not. ⛔ And a profile-addressed model gets NO bare-id grant in the deploy region outside its
 * conditioned fan-out: the registry never calls it that way, and an unconditioned deploy-region
 * `foundation-model/<id>` would authorize a direct call nothing asked for.
 *
 * ## ⚠️ TWO STATEMENTS, ONE ROLE — AWS's own least-privilege shape, and why the condition is load-bearing
 *
 * AWS documents the pair: one statement naming the profile, and a second naming the foundation models it
 * routes to, guarded by `bedrock:InferenceProfileArn`. Without that condition the second statement would also
 * authorize a DIRECT invocation of the model in us-west-2 — reach nothing in the registry asked for, and reach
 * the spend counter has no view of. The statements are per-profile for the same reason: one shared statement
 * listing every profile in its `StringLike` would let each profile borrow every other profile's regions.
 *
 * ⛔ Two statements on one role is NOT a breach of layer 4b. That gate's invariant is over GRANTEES and
 * ACTIONS, never over statement count — see `packages/infra/global/__tests__/llmSpendGuards.test.ts`, whose
 * docstring records that an earlier `grants.length === 1` assertion was three defects in one line and was
 * "what blocked adopting AWS's documented least-privilege shape for inference profiles".
 *
 * ⛔ NO WILDCARD IS EMITTED HERE, for any resource type. The registry is compile-time, so every ARN — the
 * on-demand models, the profiles, the fan-outs — is enumerable, and a `*` anywhere would discard a scope
 * reduction that costs nothing.
 *
 * ⚠️ RESIDENCY IS STILL NOT CONSULTED HERE (ADR-0024 §4b). The grant follows registry MEMBERSHIP alone; a
 * profile whose `residencyClearance` answers `unapproved` is still granted, because wiring the clearance into
 * this derivation and into `planReservation` must land as ONE change and is an owner decision.
 */
import type { ModelRegistryEntry } from '@kitchensink/recipe-core/spend/spend-arithmetic';

/**
 * The variable components of a Bedrock ARN.
 *
 * Mirrors the subset of CDK's `ArnComponents` this module needs, so the derivation stays free of CDK and can
 * be exercised without synthesizing a stack. The defaulting rules are `Stack.formatArn`'s: an absent field
 * means "the deploying stack's".
 */
export interface BedrockArnParts {
    /** The resource type. */
    readonly resource: 'inference-profile' | 'foundation-model';
    /** The resource's name — an inference-profile id, or a bare model id. */
    readonly resourceName: string;
    /** The region, or absent for the deploy region. */
    readonly region?: string;
    /** The account, or absent for the deploying account. `''` is the account-LESS form foundation models use. */
    readonly account?: string;
}

/**
 * Formats one Bedrock ARN.
 *
 * Injected rather than imported so this module needs no `Stack`: the production binding is
 * `Stack.of(this).formatArn`, which resolves the account and region to CloudFormation pseudo-parameters.
 */
export type BedrockArnFormatter = (parts: BedrockArnParts) => string;

/** One `bedrock:InvokeModel` statement the registry requires. */
export interface BedrockInvokeStatement {
    /** The ARNs the statement authorizes. Never a wildcard. */
    readonly resources: readonly string[];
    /**
     * The inference profiles this statement may be exercised THROUGH, or absent when it grants outright.
     *
     * Present on the fanned-out foundation-model statement only, where it becomes a
     * `StringLike` condition on `bedrock:InferenceProfileArn`.
     */
    readonly throughInferenceProfileArns?: readonly string[];
}

/**
 * Derive every `bedrock:InvokeModel` statement a model registry requires.
 *
 * Three shapes, in this order: ONE unconditioned statement naming every entry addressed by its own id (the
 * on-demand models, invoked in the deploy region, account-less); ONE unconditioned statement naming every
 * inference profile; and one CONDITIONED fan-out statement per profile naming the foundation model in each
 * region that profile routes to. Each shape is emitted only when the registry has an entry of that kind.
 *
 * @param registry - The model registry, keyed on bare model id.
 * @param formatArn - How to format a Bedrock ARN (`Stack.of(this).formatArn` in production).
 * @returns The statements to add, empty for an empty registry. Pure.
 */
export function bedrockInvokeStatements(
    registry: Readonly<Record<string, ModelRegistryEntry>>,
    formatArn: BedrockArnFormatter,
): readonly BedrockInvokeStatement[] {
    const onDemandArns: string[] = [];
    const profileArns: string[] = [];
    const fannedOut: BedrockInvokeStatement[] = [];

    for (const [modelId, entry] of Object.entries(registry)) {
        const { invocationId, reach } = entry.invocation;

        // ⛔ THE PREDICATE IS "ADDRESSED BY SOMETHING OTHER THAN ITSELF", not "carries a region list". The two
        // agree by an invariant `spendArithmetic.test.ts` asserts over the whole table, and this is the half
        // that decides whether a NEW resource type is needed at all.
        if (invocationId === modelId) {
            onDemandArns.push(formatArn({ account: '', resource: 'foundation-model', resourceName: modelId }));
            continue;
        }

        const profileArn = formatArn({ resource: 'inference-profile', resourceName: invocationId });

        profileArns.push(profileArn);

        if (reach.kind !== 'regions') {
            continue;
        }

        fannedOut.push({
            // The BARE model id in each reached region: the profile routes to the model, and it is the model
            // that authorization is finally evaluated against in the destination region.
            resources: reach.regions.map((region) =>
                formatArn({ region, account: '', resource: 'foundation-model', resourceName: modelId }),
            ),
            throughInferenceProfileArns: [profileArn],
        });
    }

    return [
        ...(onDemandArns.length === 0 ? [] : [{ resources: onDemandArns }]),
        ...(profileArns.length === 0 ? [] : [{ resources: profileArns }]),
        ...fannedOut,
    ];
}
