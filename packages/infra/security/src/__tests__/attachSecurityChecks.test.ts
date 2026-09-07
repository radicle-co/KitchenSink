/**
 * `attachSecurityChecks` — the single wiring point every CDK app entrypoint calls (U9).
 *
 * | Invariant                                                                | Test                                                       |
 * | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
 * | Exactly one advisory AwsSolutions Aspect is attached, at the app root     | 'attaches exactly one AdvisoryAwsSolutionsChecks Aspect'   |
 * | Attaching it changes NO synthesized template                              | 'leaves every synthesized template byte-identical'         |
 * | …and that parity is not vacuous — the Aspect really ran                   | 'still reports findings while leaving templates untouched' |
 * | …and the comparison can actually detect a mutating Aspect                 | 'detects an Aspect that DOES mutate the template'          |
 * | Findings do not fail synthesis                                            | 'synthesizes successfully despite open findings'           |
 *
 * The byte-identical invariant is the load-bearing one. ADR-0002 and ADR-0008 both stake prod safety on
 * "the prod template does not change" — a changed prod VPC/RDS is a data-loss event with no snapshot — so
 * an output-mutating Aspect must be impossible to add here unnoticed. Two things make that concrete:
 * comparing the FULL template JSON (not a resource count), and the negative control below, which proves
 * the comparison fails when an Aspect does mutate output.
 *
 * NOTE: a cdk-nag SUPPRESSION does mutate the template — it writes `Metadata.cdk_nag.rules_to_suppress`
 * into the CloudFormation resource (verified). Advisory mode therefore ships with ZERO suppressions; each
 * future one is a deliberate, reviewable template change.
 */
import { App, Aspects, CfnResource, type IAspect } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import type { IConstruct } from 'constructs';

import { AdvisoryAwsSolutionsChecks } from '../AdvisoryAwsSolutionsChecks.js';
import { attachSecurityChecks } from '../attachSecurityChecks.js';
import { collectNagAnnotations } from './__fixtures__/nagAnnotations.js';
import { makeNonCompliantStack } from './__fixtures__/nonCompliantStack.js';

const env = { account: '123456789012', region: 'us-east-1' };

/** Synthesizes the fixture app, optionally under an extra Aspect, and returns its templates + findings. */
const synthesize = (extraAspect?: IAspect) => {
    const app = new App();

    if (extraAspect) {
        Aspects.of(app).add(extraAspect);
    }

    makeNonCompliantStack(app, 'NonCompliant', { env });

    const assembly = app.synth();
    const templates = Object.fromEntries(assembly.stacks.map((stack) => [stack.stackName, stack.template]));

    return { templates: JSON.stringify(templates, null, 2), annotations: collectNagAnnotations(app) };
};

/** Synthesizes the fixture app with the real wiring — `attachSecurityChecks(app)` — applied. */
const synthesizeAttached = () => {
    const app = new App();

    attachSecurityChecks(app);
    makeNonCompliantStack(app, 'NonCompliant', { env });

    const assembly = app.synth();
    const templates = Object.fromEntries(assembly.stacks.map((stack) => [stack.stackName, stack.template]));

    return { templates: JSON.stringify(templates, null, 2), annotations: collectNagAnnotations(app) };
};

describe('attachSecurityChecks', () => {
    it('attaches exactly one AdvisoryAwsSolutionsChecks Aspect', () => {
        const app = new App();

        attachSecurityChecks(app);

        expect(Aspects.of(app).all).toHaveLength(1);
        expect(Aspects.of(app).all[0]).toBeInstanceOf(AdvisoryAwsSolutionsChecks);
    });

    it('leaves every synthesized template byte-identical', () => {
        expect(synthesizeAttached().templates).toBe(synthesize().templates);
    });

    it('still reports findings while leaving templates untouched', () => {
        // Guards the test above from passing because the Aspect never ran.
        const { annotations } = synthesizeAttached();

        expect(annotations.warnings.filter((message) => message.startsWith('AwsSolutions-')).length).toBeGreaterThan(0);
        expect(annotations.errors).toEqual([]);
    });

    it('detects an Aspect that DOES mutate the template', () => {
        // Negative control for the byte-identical assertion: if the comparison could not see a template
        // change, 'leaves every synthesized template byte-identical' would be worthless.
        const mutating: IAspect = {
            visit(node: IConstruct): void {
                if (node instanceof CfnResource) {
                    node.addMetadata('mutated', 'yes');
                }
            },
        };

        expect(synthesize(mutating).templates).not.toBe(synthesize().templates);
    });

    it('synthesizes successfully despite open findings', () => {
        expect(() => synthesizeAttached()).not.toThrow();
    });
});
