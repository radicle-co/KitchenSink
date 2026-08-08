/**
 * The repository's ONE Lambda runtime pin — `NODE_LAMBDA_RUNTIME` (issue #143, `AwsSolutions-L1`).
 *
 * | Invariant                                                                     | Test                                                        |
 * | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
 * | The pin is an explicit literal, never derived at synth time                    | 'pins an explicit runtime rather than a moving alias'        |
 * | It matches the newest Node runtime the installed CDK knows about               | 'equals the newest nodejs runtime aws-cdk-lib knows about'   |
 * | …computed exactly the way cdk-nag L1 computes it, so the two cannot disagree   | 'agrees with the rule cdk-nag L1 actually applies'           |
 * | A function built on it reports NO L1 finding                                   | 'a function on this runtime reports no AwsSolutions-L1'      |
 * | …and the proof is not vacuous — an older runtime does report one               | 'an older runtime still reports AwsSolutions-L1'             |
 * | It is a Node runtime, matching the repo-wide `engines.node` major              | 'targets the Node major the repository pins in engines.node' |
 *
 * ## Why an explicit literal that a test keeps current, rather than `Runtime.NODEJS_LATEST`
 *
 * `Runtime.NODEJS_LATEST` and `determineLatestNodeRuntime()` are MOVING aliases: bumping `aws-cdk-lib` would
 * silently change the runtime of every deployed Lambda as a side effect of a dependency update. Runtime
 * majors are not a no-op — they are where native-module and API-removal breakage lives — so that decision
 * must be taken deliberately, not inherited.
 *
 * An explicit pin alone, though, is what produced the state this fixes: 19 `AwsSolutions-L1` findings, and a
 * repo whose `engines.node` is `24.x` (so every test, lint and local run happens on Node 24) shipping its
 * Lambdas on `nodejs22.x`. The code was verified on one Node major and executed on another.
 *
 * So: pin the value explicitly, and assert here that it has not fallen behind — the same shape ADR-0002 uses
 * for the prod VPC CIDR (an explicit value, with a guard that it has not drifted). The consequence is
 * deliberate: the next `aws-cdk-lib` bump that adds a newer Node runtime FAILS THIS TEST. That converts what
 * ADR-0013 called "a recurring, low-value 19-finding block of noise" into one actionable test failure at the
 * moment of the bump, in the PR that caused it.
 */
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AdvisoryAwsSolutionsChecks } from '../advisory-aws-solutions-checks.js';
import { NODE_LAMBDA_RUNTIME, latestNodeRuntimeKnownToCdk } from '../lambda-runtime.js';
import { collectNagAnnotations, ruleIdsIn } from './__fixtures__/nag-annotations.js';

const env = { account: '123456789012', region: 'us-east-1' };

/** Synthesizes one inline Lambda on `runtime` under the advisory pack and returns the rule ids it reported. */
const ruleIdsForRuntime = (runtime: Runtime): string[] => {
    const app = new App();

    Aspects.of(app).add(new AdvisoryAwsSolutionsChecks());

    const stack = new Stack(app, 'Probe', { env });

    new LambdaFunction(stack, 'Fn', {
        runtime,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({});'),
    });
    app.synth();

    return ruleIdsIn(collectNagAnnotations(app).warnings);
};

describe('NODE_LAMBDA_RUNTIME', () => {
    it('pins an explicit runtime rather than a moving alias', () => {
        // Identity against the alias object would mean a CDK bump silently re-targets every Lambda.
        expect(NODE_LAMBDA_RUNTIME).not.toBe(Runtime.NODEJS_LATEST);
        expect(NODE_LAMBDA_RUNTIME.name).toMatch(/^nodejs\d+\.x$/u);
    });

    it('equals the newest nodejs runtime aws-cdk-lib knows about', () => {
        // ⚠️ If this fails after bumping aws-cdk-lib, that is the guard working: a newer Node runtime became
        // available. Decide whether to move (bump NODE_LAMBDA_RUNTIME, verify the bundles) and record it.
        expect(NODE_LAMBDA_RUNTIME.name).toBe(latestNodeRuntimeKnownToCdk());
    });

    it('agrees with the rule cdk-nag L1 actually applies', () => {
        // `latestNodeRuntimeKnownToCdk` reimplements cdk-nag's LambdaLatestVersion selection (filter
        // Runtime.ALL to the family, sort by version with numeric collation, take the last). Asserting
        // through the REAL pack, not our copy of its logic, is what stops the two drifting apart.
        const computed = Runtime.ALL.find((runtime) => runtime.name === latestNodeRuntimeKnownToCdk());

        expect(computed, 'latestNodeRuntimeKnownToCdk returned a name aws-cdk-lib does not expose').toBeDefined();
        expect(ruleIdsForRuntime(computed as Runtime)).not.toContain('AwsSolutions-L1');
    });

    it('a function on this runtime reports no AwsSolutions-L1', () => {
        expect(ruleIdsForRuntime(NODE_LAMBDA_RUNTIME)).not.toContain('AwsSolutions-L1');
    });

    it('an older runtime still reports AwsSolutions-L1', () => {
        // Negative control: without this, the assertion above could pass because L1 stopped firing at all.
        expect(ruleIdsForRuntime(Runtime.NODEJS_18_X)).toContain('AwsSolutions-L1');
    });

    it('targets the Node major the repository pins in engines.node', () => {
        // THE defect this constant exists to close: the repo runs every test, lint and local command on the
        // engines.node major, so shipping Lambdas on a different one means code is verified on one runtime
        // and executed on another. Read from the root package.json so the two cannot drift.
        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
        const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
            engines?: { node?: string };
        };
        const enginesNode = rootManifest.engines?.node;

        expect(enginesNode, 'root package.json has no engines.node to compare against').toMatch(/^\d+\.x$/u);
        expect(NODE_LAMBDA_RUNTIME.name).toBe(`nodejs${enginesNode}`);
    });
});
