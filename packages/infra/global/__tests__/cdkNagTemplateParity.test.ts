/**
 * ⛔ THE ACCEPTANCE CRITERION for U9: attaching cdk-nag must leave the PROD template BYTE-IDENTICAL.
 *
 * | Invariant                                                                     | Test                                                          |
 * | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
 * | Every prod GlobalStack template is byte-identical with the Aspect attached      | 'leaves every prod platform template byte-identical'           |
 * | …per stack, so a diff names the stack that moved                                | 'leaves kitchensink-{network,data,domain,alb,global}-prod …'   |
 * | The account-scoped cost-guardrails template is untouched too (ADR-0008)         | 'leaves the cost-guardrails template byte-identical'           |
 * | A non-prod stage is likewise untouched                                          | 'leaves every sandbox platform template byte-identical'        |
 * | The comparison is not vacuous — the Aspect really ran on these stacks           | 'reports findings against the prod platform stacks'            |
 * | The comparison can detect a mutating Aspect                                     | 'detects an Aspect that DOES mutate a prod template'           |
 * | ONLY the reviewed suppressions are in force, per resource, per rule             | 'carries the expected suppressions and no others'              |
 * | …and they come from the STACK, not the Aspect                                   | 'records the same set with the Aspect detached'                |
 * | …each with a readable (non-base64) justification                                | 'states a readable justification for every one of them'        |
 * | …and prod and sandbox do not diverge on a security decision                     | 'keeps sandbox in step with prod'                              |
 *
 * WHY this is the highest-value test in the change. ADR-0002 keeps prod on `10.0.0.0/16` precisely so the
 * explicit value produces NO diff, because replacing the prod VPC replaces the prod RDS — `removalPolicy:
 * DESTROY`, no safety snapshot. (`deletionProtection` was `false` when this was written; it is now `true`
 * for every stage per the owner ruling of 2026-08-08, which turns that particular accident from silent data
 * loss into a loud CloudFormation failure. The no-diff discipline still matters: protection blocks a DELETE,
 * it does not make an unintended REPLACE safe to attempt.) ADR-0008 makes the same no-prod-diff promise
 * for the gp3/Spot/budget levers. An Aspect runs over every construct in the tree, so an output-mutating
 * one would breach that line everywhere at once and be invisible in review. This suite makes that
 * impossible to land silently: it compares the FULL template JSON, per stack, and the negative control
 * proves the comparison would fail if output moved.
 *
 * WHY suppressions are ALLOWLISTED rather than forbidden (changed by issue #143). `NagSuppressions` writes
 * `Metadata.cdk_nag.rules_to_suppress` into the CloudFormation resource — verified by synthesizing with and
 * without one — so a suppression IS a real template diff. Advisory mode shipped with zero of them and this
 * suite asserted that no prod template contained `cdk_nag` at all. The burn-down needed suppressions, and a
 * blanket prohibition can only be satisfied by DELETING the assertion, which would drop the control at the
 * exact moment it starts mattering. So the prohibition became an exact, closed inventory
 * (`EXPECTED_PLATFORM_SUPPRESSIONS`): same guarantee — no unreviewed suppression reaches a prod template —
 * but it fails loudly and names the resource instead of quietly permitting everything.
 *
 * Note the two properties are INDEPENDENT and both still hold: cdk-nag itself changes no output (a
 * suppression is written by the stack constructor, not by the Aspect — 'records the same set with the Aspect
 * detached' proves it), and the set of suppressions is fixed.
 */
import { App, Aspects, CfnResource, type IAspect } from 'aws-cdk-lib';
import { ArtifactMetadataEntryType } from 'aws-cdk-lib/cloud-assembly-schema';
import { attachSecurityChecks } from '@kitchensink/infra-security';
import { describe, it, expect } from 'vitest';
import type { IConstruct } from 'constructs';

import { CostGuardrailsStack } from '../lib/platform/CostGuardrailsStack.js';
import { EdgeStack } from '../lib/platform/EdgeStack.js';
import { GlobalStack } from '../lib/platform/GlobalStack.js';
import { TEST_EDGE_JWT_KEY, stubEdgeBundleDir } from './edgeBundleFixture.js';

const env = { account: '123456789012', region: 'us-east-1' };
const domainName = 'commise.app';

type Templates = Record<string, string>;

/** Synthesizes the whole platform app for a stage and returns each stack's template as canonical JSON. */
function synthesizePlatform(stage: string, options: { readonly aspect?: IAspect | 'security' } = {}): Templates {
    const app = new App();

    if (options.aspect === 'security') {
        attachSecurityChecks(app);
    } else if (options.aspect) {
        Aspects.of(app).add(options.aspect);
    }

    new GlobalStack(app, `Global-${stage}`, {
        env,
        stackName: `kitchensink-global-${stage}`,
        stage,
        domainName,
    });

    // ADR-0008: created ONCE, prod-guarded in bin/app.ts. Included here so the account-scoped stack is
    // covered by the same parity proof as the per-stage ones.
    if (stage === 'prod') {
        new CostGuardrailsStack(app, 'CostGuardrails', {
            env,
            stackName: 'kitchensink-cost-guardrails',
            alertEmail: 'alerts@example.com',
        });

        // ADR-0020 / plan U16: likewise prod-guarded in bin/app.ts. It is the newest place an Aspect could
        // mutate a prod template, and it carries the only Lambda whose ASSET HASH is part of the template —
        // so it is exactly the stack a parity proof must cover rather than skip because it is awkward to
        // construct. The bundle fixture is memoized per key, so both synths stage identical asset content.
        new EdgeStack(app, 'Edge', {
            env,
            stackName: 'kitchensink-edge-prod',
            stage,
            domainName,
            verifierBundleDir: stubEdgeBundleDir(),
        });
    }

    return Object.fromEntries(
        app.synth().stacks.map((stack) => [stack.stackName, JSON.stringify(stack.template, null, 2)]),
    );
}

/** Every annotation message recorded anywhere under `root`, grouped by CDK annotation level. */
function annotationsUnder(root: IConstruct): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const node of root.node.findAll()) {
        for (const entry of node.node.metadata) {
            if (entry.type === ArtifactMetadataEntryType.ERROR) {
                errors.push(String(entry.data));
            } else if (entry.type === ArtifactMetadataEntryType.WARN) {
                warnings.push(String(entry.data));
            }
        }
    }

    return { errors, warnings };
}

// ADR-0020 trap 6: `EdgeStack` reads the build-time verification key from the environment and fails loudly
// without it, exactly as a prod synth does. Set before the module-level synths below.
process.env['CLERK_JWT_KEY'] = TEST_EDGE_JWT_KEY;

const prodPlain = synthesizePlatform('prod');
const prodNagged = synthesizePlatform('prod', { aspect: 'security' });
const sandboxPlain = synthesizePlatform('sandbox');
const sandboxNagged = synthesizePlatform('sandbox', { aspect: 'security' });

describe('cdk-nag leaves synthesized templates byte-identical (ADR-0002 / ADR-0008 no-prod-diff)', () => {
    it('leaves every prod platform template byte-identical', () => {
        expect(prodNagged).toEqual(prodPlain);
    });

    it.each([
        'kitchensink-global-prod',
        'kitchensink-network-prod',
        'kitchensink-data-prod',
        'kitchensink-domain-prod',
        'kitchensink-alb-prod',
        'kitchensink-edge-prod',
    ])('leaves %s byte-identical', (stackName) => {
        // Per-stack so a failure names the stack that moved instead of dumping the whole app.
        expect(prodPlain[stackName]).toBeDefined();
        expect(prodNagged[stackName]).toBe(prodPlain[stackName]);
    });

    it('leaves the account-scoped cost-guardrails template byte-identical', () => {
        expect(prodNagged['kitchensink-cost-guardrails']).toBe(prodPlain['kitchensink-cost-guardrails']);
    });

    it('leaves every sandbox platform template byte-identical', () => {
        // Non-prod is not exempt: sandbox carries the ADR-0007 scheduler and the ADR-0008 gp3/Spot levers.
        expect(sandboxNagged).toEqual(sandboxPlain);
    });

    it('covers the stacks it claims to (prod: eight platform stacks plus cost guardrails)', () => {
        // `kitchensink-messaging-prod` joined the platform with plan U5 (the message substrate),
        // `kitchensink-edge-prod` with U16 (the CloudFront edge), and `kitchensink-service-logs-prod` with
        // ADR-0028's 2026-08-30 amendment — it owns the log groups that must outlive the reclaimable
        // identity service stack. The list is exhaustive on purpose: a new platform stack that skipped the
        // parity proof would be the one place cdk-nag could silently change a prod template.
        expect(Object.keys(prodPlain).sort()).toEqual([
            'kitchensink-alb-prod',
            'kitchensink-cost-guardrails',
            'kitchensink-data-prod',
            'kitchensink-domain-prod',
            'kitchensink-edge-prod',
            'kitchensink-global-prod',
            'kitchensink-messaging-prod',
            'kitchensink-network-prod',
            'kitchensink-service-logs-prod',
        ]);
    });
});

describe('the parity proof is not vacuous', () => {
    it('reports findings against the prod platform stacks, at warning level only', () => {
        const app = new App();

        attachSecurityChecks(app);
        new GlobalStack(app, 'Global-prod', {
            env,
            stackName: 'kitchensink-global-prod',
            stage: 'prod',
            domainName,
        });
        app.synth();

        const { errors, warnings } = annotationsUnder(app);

        expect(warnings.filter((message) => message.startsWith('AwsSolutions-')).length).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });

    it('detects an Aspect that DOES mutate a prod template', () => {
        const mutating: IAspect = {
            visit(node: IConstruct): void {
                if (node instanceof CfnResource) {
                    node.addMetadata('mutated', 'yes');
                }
            },
        };

        expect(synthesizePlatform('prod', { aspect: mutating })).not.toEqual(prodPlain);
    });
});

/**
 * Every cdk-nag suppression written into a synthesized template, as `stackName/logicalId → ruleId`, sorted.
 *
 * A suppression lands in `Resources.<logicalId>.Metadata.cdk_nag.rules_to_suppress`.
 */
function suppressionsIn(templates: Templates): string[] {
    const found: string[] = [];

    for (const [stackName, json] of Object.entries(templates)) {
        const template = JSON.parse(json) as {
            Resources?: Record<string, { Metadata?: { cdk_nag?: { rules_to_suppress?: Array<{ id: string }> } } }>;
        };

        for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
            for (const rule of resource.Metadata?.cdk_nag?.rules_to_suppress ?? []) {
                found.push(`${stackName}/${logicalId} ${rule.id}`);
            }
        }
    }

    return found.sort();
}

/** Every suppression entry written into a synthesized template, with its full recorded shape. */
function suppressionEntriesIn(
    templates: Templates,
): Array<{ where: string; id: string; reason: string; encoded: boolean }> {
    const found: Array<{ where: string; id: string; reason: string; encoded: boolean }> = [];

    for (const [stackName, json] of Object.entries(templates)) {
        const template = JSON.parse(json) as {
            Resources?: Record<
                string,
                {
                    Metadata?: {
                        cdk_nag?: {
                            rules_to_suppress?: Array<{ id: string; reason: string; is_reason_encoded?: boolean }>;
                        };
                    };
                }
            >;
        };

        for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
            for (const rule of resource.Metadata?.cdk_nag?.rules_to_suppress ?? []) {
                found.push({
                    where: `${stackName}/${logicalId}`,
                    id: rule.id,
                    reason: rule.reason,
                    encoded: rule.is_reason_encoded === true,
                });
            }
        }
    }

    return found;
}

/**
 * ⛔ THE SUPPRESSION ALLOWLIST for the platform app (issue #143).
 *
 * This block REPLACED an assertion that no prod template contained `cdk_nag` at all. That was the right
 * contract while the burn-down carried zero suppressions (ADR-0013), and it is the wrong one now: a blanket
 * prohibition can only be satisfied by deleting it, which would have removed the control precisely when
 * suppressions started existing. So the prohibition became an ALLOWLIST — the same guarantee (no
 * unreviewed suppression reaches a prod template) expressed as an exact, closed inventory.
 *
 * Two independent properties are asserted, and it matters that they are separate:
 *
 * 1. **Attaching cdk-nag still changes nothing.** The suite above still proves prod templates are
 *    byte-identical with and without the Aspect. That property SURVIVED the burn-down because a suppression
 *    is written by the STACK (`acceptNagFindings(...)` in the constructor), not by the Aspect — so the
 *    ADR-0002/ADR-0008 no-prod-diff guarantee for the *Aspect* is intact and still guarded.
 * 2. **The suppressions themselves are a reviewed, fixed set.** Which resource, which rule, nothing else.
 *
 * Anything added, removed or moved fails here and names the resource, so a new suppression cannot ride along
 * in an unrelated change.
 */
const EXPECTED_PLATFORM_SUPPRESSIONS = [
    // The internet-facing shared ALB's ingress boundary doing its job (ADR-0003).
    'kitchensink-network-prod/AlbSecurityGroup86A59E99 AwsSolutions-EC23',
    // Not a credential: a static SQL bootstrap string + an owner label, so rotation is meaningless.
    // NOTE what is deliberately ABSENT: `DatabaseCredentialsSecret`. Its SMG4 finding is a REAL gap and is
    // escalated in ADR-0013, not suppressed — single-user rotation would take the identity service down,
    // because ECS injects the password at task start and the pool re-dials with the stale value.
    'kitchensink-data-prod/MigrationPlanSecretA0DF90AF AwsSolutions-SMG4',
    // ⚠️ The FIRST suppressions on a resource that fronts PRODUCTION. `SandboxRouterStack` carries the
    // sibling decision (`CLOUDFRONT_EDGE_CONTROLS_NOT_PROPORTIONATE`) whose own words are "REVISIT if the
    // router ever fronts production" — so this is a SEPARATE key, argued here, and never that one widened.
    // Owner triage 2026-09-03: geo restriction is the wrong control for a consumer recipe app; a WAFv2 web
    // ACL is deferred while the product is pre-launch. See ADR-0013's triage update.
    // The CloudFront access-log bucket, whose own S1 has nowhere to log TO that would not fire S1 in turn.
    // ⚠️ Narrow to a bucket of logs — `DataStack`'s media/archive buckets keep their open S1 findings.
    'kitchensink-edge-prod/EdgeAccessLogs01ACC060 AwsSolutions-S1',
    'kitchensink-edge-prod/FoodDistribution0FAC182B AwsSolutions-CFR1',
    'kitchensink-edge-prod/FoodDistribution0FAC182B AwsSolutions-CFR2',
    'kitchensink-edge-prod/IdentityDistributionA374AA37 AwsSolutions-CFR1',
    'kitchensink-edge-prod/IdentityDistributionA374AA37 AwsSolutions-CFR2',
    'kitchensink-edge-prod/RecipeDistributionCBA9CD03 AwsSolutions-CFR1',
    'kitchensink-edge-prod/RecipeDistributionCBA9CD03 AwsSolutions-CFR2',
    // Owner triage 2026-09-03. PITR on a table whose rows are DERIVED doorbells, expire in three days, and
    // could only be restored under a different name than every producer addresses. ⚠️ NOT accepted as a
    // "dedup table" — it is not one; see the register entry.
    'kitchensink-messaging-prod/MessageTable477906EA AwsSolutions-DDB3',
];

describe('exactly the reviewed cdk-nag suppressions are in force', () => {
    it('carries the expected suppressions and no others', () => {
        expect(suppressionsIn(prodNagged)).toEqual([...EXPECTED_PLATFORM_SUPPRESSIONS].sort());
    });

    it('records the same set with the Aspect detached', () => {
        // Proves the suppressions come from the STACK, not from cdk-nag — which is why the byte-identical
        // suite above still passes. If a suppression ever appeared only under the Aspect, that would mean
        // the Aspect had started mutating output, i.e. the ADR-0002 line breached.
        expect(suppressionsIn(prodPlain)).toEqual(suppressionsIn(prodNagged));
    });

    it('states a readable justification for every one of them', () => {
        // cdk-nag base64-encodes a reason containing any codepoint above 255 (`is_reason_encoded`), which
        // would leave the template — and the prod `cdk diff` a human approves — carrying an opaque blob
        // instead of the argument. See @kitchensink/infra-security's own suite for the mechanism.
        for (const entry of suppressionEntriesIn(prodNagged)) {
            expect(entry.encoded, `${entry.where} ${entry.id}: reason is base64-encoded, not readable`).toBe(false);
            expect(
                entry.reason.length,
                `${entry.where} ${entry.id}: reason is too short to be a reason`,
            ).toBeGreaterThan(80);
        }
    });

    it('keeps sandbox in step with prod, on every stack BOTH stages build', () => {
        // A suppression applied only to one stage would mean the two stages diverge on a security decision,
        // and that is still what this asserts.
        //
        // ⚠️ REWRITTEN (2026-09-03), not weakened, and the distinction matters. The original compared the
        // two stages' whole suppression sets, which silently assumed both stages build the SAME stacks. They
        // do not: `kitchensink-edge-prod` is prod-ONLY (`bin/app.ts` gates it on `stage === 'prod'`), so the
        // moment `EdgeStack` accepted its first finding the comparison started failing on a stack sandbox
        // cannot have — a structural fact, not a divergent decision. Comparing everything would leave only
        // two ways out, both bad: delete the assertion, or suppress on sandbox too (which is impossible
        // here, and would be a fiction if it were not).
        //
        // So the subject set becomes the stacks both stages build, and the stacks EXCLUDED are pinned — a
        // future prod-only stack cannot quietly escape the comparison by being new.
        const stageless = (entry: string): string => entry.replace('-sandbox/', '-prod/');
        const stackOf = (entry: string): string => entry.split('/')[0] ?? '';
        const sandboxStacks = new Set(Object.keys(sandboxNagged).map((name) => name.replace('-sandbox', '-prod')));
        const shared = (entries: readonly string[]): readonly string[] =>
            entries.map(stageless).filter((entry) => sandboxStacks.has(stackOf(entry)));

        // Non-vacuity: the shared set is what the assertion is actually about, so an empty one would make it
        // pass by comparing nothing.
        expect(shared(suppressionsIn(prodNagged)).length).toBeGreaterThan(0);
        expect(shared(suppressionsIn(sandboxNagged))).toEqual(shared(suppressionsIn(prodNagged)));

        // The excluded stacks, named. `kitchensink-cost-guardrails` is account-scoped and created once
        // (ADR-0008); `kitchensink-edge-prod` is the production CloudFront edge (ADR-0020). Neither has a
        // sandbox counterpart, so neither can be held to a cross-stage comparison — but a THIRD one
        // appearing must be a decision, which is why this is asserted rather than filtered silently.
        expect(
            Object.keys(prodNagged)
                .filter((name) => !sandboxStacks.has(name))
                .sort(),
        ).toEqual(['kitchensink-cost-guardrails', 'kitchensink-edge-prod']);
    });
});
