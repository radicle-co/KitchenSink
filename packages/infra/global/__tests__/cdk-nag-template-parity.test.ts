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
 * | No suppression is in force — a suppression IS a template change                 | 'no prod template carries cdk_nag suppression metadata'        |
 *
 * WHY this is the highest-value test in the change. ADR-0002 keeps prod on `10.0.0.0/16` precisely so the
 * explicit value produces NO diff, because replacing the prod VPC replaces the prod RDS — `removalPolicy:
 * DESTROY`, `deletionProtection: false`, no safety snapshot. ADR-0008 makes the same no-prod-diff promise
 * for the gp3/Spot/budget levers. An Aspect runs over every construct in the tree, so an output-mutating
 * one would breach that line everywhere at once and be invisible in review. This suite makes that
 * impossible to land silently: it compares the FULL template JSON, per stack, and the negative control
 * proves the comparison would fail if output moved.
 *
 * WHY suppression metadata is asserted absent: `NagSuppressions` writes
 * `Metadata.cdk_nag.rules_to_suppress` into the CloudFormation resource — verified by synthesizing with
 * and without one. A suppression is therefore a real template diff, which is why advisory mode ships with
 * ZERO of them; each future suppression must be landed as its own reviewed, justified template change.
 */
import { App, Aspects, CfnResource, type IAspect } from 'aws-cdk-lib';
import { ArtifactMetadataEntryType } from 'aws-cdk-lib/cloud-assembly-schema';
import { attachSecurityChecks } from '@kitchensink/infra-security';
import { describe, it, expect } from 'vitest';
import type { IConstruct } from 'constructs';

import { CostGuardrailsStack } from '../lib/platform/cost-guardrails-stack.js';
import { GlobalStack } from '../lib/platform/global-stack.js';

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

    it('covers the stacks it claims to (prod: five platform stacks plus cost guardrails)', () => {
        expect(Object.keys(prodPlain).sort()).toEqual([
            'kitchensink-alb-prod',
            'kitchensink-cost-guardrails',
            'kitchensink-data-prod',
            'kitchensink-domain-prod',
            'kitchensink-global-prod',
            'kitchensink-network-prod',
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

describe('no cdk-nag suppression is in force', () => {
    it.each(Object.entries(prodNagged))('no cdk_nag suppression metadata in %s', (_stackName, template) => {
        // A suppression writes Metadata.cdk_nag.rules_to_suppress into the resource — i.e. it IS a
        // template diff. Advisory mode carries none; adding one must be a deliberate, reviewed change.
        expect(template).not.toContain('cdk_nag');
        expect(template).not.toContain('rules_to_suppress');
    });
});
