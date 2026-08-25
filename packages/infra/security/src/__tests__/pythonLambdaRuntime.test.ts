/**
 * The repository's ONE Python Lambda runtime pin — `PYTHON_LAMBDA_RUNTIME` (`AwsSolutions-L1`).
 *
 * | Invariant                                                                       | Test                                                          |
 * | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
 * | The pin is an explicit literal, never derived at synth time                     | 'pins an explicit runtime rather than a moving alias'          |
 * | It is the newest Python runtime CDK knows that the engine's own ceiling admits  | 'is the newest python runtime below the engine ceiling'        |
 * | …selected exactly the way cdk-nag L1 selects a family, so the two cannot disagree | 'agrees with the family selection cdk-nag L1 actually applies' |
 * | The ceiling is stated as an exclusive upper bound, in `major.minor` form         | 'states the engine ceiling as an exclusive major.minor bound'  |
 * | L1 fires on the pin EXACTLY WHEN the ceiling holds it below CDK's newest         | 'reports L1 exactly when the engine ceiling holds it back'     |
 * | …and the proof is not vacuous — a much older runtime always reports one          | 'an older runtime still reports AwsSolutions-L1'               |
 *
 * ## Why a SECOND runtime pin exists at all, and why it is not `NODE_LAMBDA_RUNTIME`'s shape copied
 *
 * `NODE_LAMBDA_RUNTIME` can be pinned to the newest runtime `aws-cdk-lib` knows, because the repository
 * chooses its own Node major. This pin cannot: the function it exists for runs `ingredient-parser-nlp`,
 * whose distribution metadata declares `Requires-Python: <3.14,>=3.10`. So there are two facts here, not
 * one — "the newest Python runtime that exists" and "the newest Python runtime the engine will run on" —
 * and the pin is the SECOND. Collapsing them into `latestPythonRuntimeKnownToCdk()` would ship a Lambda
 * the engine refuses to install on.
 *
 * ## Why the L1 finding is left REPORTING rather than suppressed
 *
 * Exactly the precedent `lambdaRuntime.ts` already records for the `framework-onEvent` functions: the
 * finding is ACCURATE (the runtime really is not the newest), it is not ours to fix (the ceiling is the
 * engine's), it clears itself the moment the engine supports the newer Python, and suppressing it would
 * write template metadata in exchange for hiding a genuinely stale runtime later. So instead of a
 * suppression this suite asserts the finding's presence is EXPLAINED — L1 fires if and only if the ceiling
 * is what holds the pin below CDK's newest. The assertion flips on its own when the ceiling is raised.
 */
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';

import { AdvisoryAwsSolutionsChecks } from '../AdvisoryAwsSolutionsChecks.js';
import {
    ENGINE_PYTHON_CEILING,
    PYTHON_LAMBDA_RUNTIME,
    latestPythonRuntimeBelow,
    latestPythonRuntimeKnownToCdk,
} from '../pythonLambdaRuntime.js';
import { collectNagAnnotations, ruleIdsIn } from './__fixtures__/nagAnnotations.js';

const env = { account: '123456789012', region: 'us-east-1' };

/** Synthesizes one Lambda on `runtime` under the advisory pack and returns the rule ids it reported. */
const ruleIdsForRuntime = (runtime: Runtime): string[] => {
    const app = new App();

    Aspects.of(app).add(new AdvisoryAwsSolutionsChecks());

    const stack = new Stack(app, 'Probe', { env });

    new LambdaFunction(stack, 'Fn', {
        runtime,
        handler: 'index.handler',
        code: Code.fromInline('def handler(event, context):\n    return {}\n'),
    });
    app.synth();

    return ruleIdsIn(collectNagAnnotations(app).warnings);
};

describe('PYTHON_LAMBDA_RUNTIME', () => {
    it('pins an explicit runtime rather than a moving alias', () => {
        expect(PYTHON_LAMBDA_RUNTIME.name).toMatch(/^python\d+\.\d+$/u);
    });

    it('states the engine ceiling as an exclusive major.minor bound', () => {
        expect(ENGINE_PYTHON_CEILING).toMatch(/^\d+\.\d+$/u);
    });

    it('is the newest python runtime below the engine ceiling', () => {
        // ⚠️ If this fails after bumping the engine or aws-cdk-lib, that is the guard working. Raise
        // ENGINE_PYTHON_CEILING only to what the engine's own Requires-Python admits, then move the pin.
        expect(PYTHON_LAMBDA_RUNTIME.name).toBe(latestPythonRuntimeBelow(ENGINE_PYTHON_CEILING));
    });

    it('agrees with the family selection cdk-nag L1 actually applies', () => {
        // `latestPythonRuntimeKnownToCdk` reimplements cdk-nag's LambdaLatestVersion selection for the
        // python family. Asserting through the REAL pack, not our copy of its logic, is what stops the two
        // drifting apart: the runtime it names must be the one L1 is satisfied by.
        const newest = Runtime.ALL.find((runtime) => runtime.name === latestPythonRuntimeKnownToCdk());

        expect(newest, 'latestPythonRuntimeKnownToCdk returned a name aws-cdk-lib does not expose').toBeDefined();
        expect(ruleIdsForRuntime(newest as Runtime)).not.toContain('AwsSolutions-L1');
    });

    it('reports L1 exactly when the engine ceiling holds it back', () => {
        // Total in both directions: while the ceiling holds the pin below CDK's newest the finding is
        // expected and accepted; the day the ceiling is raised to CDK's newest, L1 must stop firing. Neither
        // branch can pass vacuously, and nobody has to remember to revisit this.
        const heldBack = PYTHON_LAMBDA_RUNTIME.name !== latestPythonRuntimeKnownToCdk();

        expect(ruleIdsForRuntime(PYTHON_LAMBDA_RUNTIME).includes('AwsSolutions-L1')).toBe(heldBack);
    });

    it('an older runtime still reports AwsSolutions-L1', () => {
        // Negative control: without this, the assertion above could pass because L1 stopped firing at all.
        expect(ruleIdsForRuntime(Runtime.PYTHON_3_9)).toContain('AwsSolutions-L1');
    });

    it('rejects a ceiling no runtime satisfies rather than returning a wrong answer', () => {
        expect(() => latestPythonRuntimeBelow('0.1')).toThrow(/python/u);
    });
});
