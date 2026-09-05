/**
 * `IngredientParserStack` — the repository's first non-Node deployable (U17, KTD-16, ADR-0025).
 *
 * | Invariant                                                                | Test                                                        |
 * | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
 * | The function runs the ONE pinned Python runtime, never a literal          | 'runs the pinned Python runtime'                            |
 * | `NLTK_DATA` names the corpus the build stages, so nothing downloads      | 'points NLTK at the corpus the build stages, not at $HOME'  |
 * | It is NOT VPC-attached, so it is not an ADR-0004 NAT consumer             | 'attaches no VPC, so it never reaches the NAT instance'     |
 * | It introduces no VPC interface endpoint                                   | 'introduces no interface VPC endpoint'                      |
 * | The `handler:` string resolves to a Python module that exists             | 'deploys a handler that resolves to a real module'          |
 * | It owns NO database, per ADR-0019's exception template                    | 'owns no database, table or queue'                          |
 * | Its role grants two log actions and nothing else                         | 'gives its function a role that can do nothing but write…'  |
 * | …asserted through the real cdk-nag pack, with L1 as the live control      | 'reports no AwsSolutions-IAM4 under the advisory pack'      |
 * | An unbuilt or empty asset FAILS THE SYNTH rather than shipping empty      | 'refuses to synthesize against an unstaged asset'           |
 * | …and the proof is not vacuous — a staged asset synthesizes                | 'runs the pinned Python runtime' (uses a staged fixture)    |
 *
 * ## Why the asset path is a PROP rather than a path inside the stack
 *
 * So the failure above is testable. `Code.fromAsset` throws on a missing directory but is perfectly happy
 * to zip an EMPTY one — which is the `handle-sync-worker` failure exactly: a deployed function whose asset
 * carries nothing it needs, green all the way to the first cold start. Taking the staging directory as a
 * prop lets this suite hand the stack a real one, an empty one and a missing one, and assert that two of
 * the three are refused at synth.
 */
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AdvisoryAwsSolutionsChecks, PYTHON_LAMBDA_RUNTIME } from '@kitchensink/infra-security';

import { IngredientParserStack } from '../lib/IngredientParserStack.js';
import { handlerModuleOf } from '../lib/assetContents.js';
import { readHandlerImports } from '../lib/assetInspection.js';
import { LAMBDA_TASK_ROOT, NLTK_DATA_DIRECTORY } from '../lib/packaging.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = { account: '123456789012', region: 'us-east-1' };

/** A staging directory that looks like a built asset: a handler module and something to import. */
function stagedAsset(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'ingredient-parser-asset-'));

    writeFileSync(path.join(directory, 'handler.py'), 'def handle(event, context):\n    return {}\n');
    mkdirSync(path.join(directory, 'ingredient_parser'), { recursive: true });
    writeFileSync(path.join(directory, 'ingredient_parser', '__init__.py'), '');

    return directory;
}

/** Synthesize the stack against a staging directory. */
function templateFor(assetDirectory: string): Template {
    const app = new App();
    const stack = new IngredientParserStack(app, 'IngredientParser-test', {
        env,
        stage: 'pr-1',
        assetDirectory,
    });

    return Template.fromStack(stack);
}

describe('IngredientParserStack', () => {
    it('runs the pinned Python runtime', () => {
        // ⛔ The pin, not a literal. A literal here is how nineteen Lambdas ended up on nodejs22.x while the
        // repo ran every test on Node 24 — see `lambdaRuntime.ts`. `pythonLambdaRuntime.test.ts` is what
        // keeps the pin itself current against cdk-nag's family-generic L1 rule.
        templateFor(stagedAsset()).hasResourceProperties('AWS::Lambda::Function', {
            Runtime: PYTHON_LAMBDA_RUNTIME.name,
        });
    });

    it('points NLTK at the corpus the build stages, not at $HOME', () => {
        // ⚠️ THIS ASSERTION ALONE PROVES LITTLE, and it is here for the one thing it does prove: that the
        // two ends of the same constant are wired together. The engine's `_utils.py` runs
        // `download_nltk_resources()` at IMPORT; unset, `nltk.data.find` misses every default search path
        // (none of which exist on Lambda), `nltk.download()` writes to `$HOME`, and the function dies with
        // `OSError: [Errno 30] Read-only file system` — which is how the first real deploy of this stack
        // failed, with a green build and a green synth. That the corpus is actually THERE is asserted by
        // the packaging guard; that the engine actually READS it from there is asserted by invoking the
        // handler under this exact variable in `tests/handler.integration.test.ts`.
        templateFor(stagedAsset()).hasResourceProperties('AWS::Lambda::Function', {
            Environment: { Variables: { NLTK_DATA: `${LAMBDA_TASK_ROOT}/${NLTK_DATA_DIRECTORY}` } },
        });
    });

    it('attaches no VPC, so it never reaches the NAT instance', () => {
        // ⛔ ADR-0004. This function holds no state and reaches no database, so it has no reason to be in the
        // VPC — and a VPC-attached Lambda egresses through the single t4g.nano NAT instance and must be
        // added to the ADR's published consumer list, which `natEgressConsumers.test.ts` asserts in BOTH
        // directions. Staying out of the VPC is the cheap answer and the honest one.
        const functions = templateFor(stagedAsset()).findResources('AWS::Lambda::Function');

        expect(Object.keys(functions).length).toBeGreaterThan(0);
        expect(
            Object.values(functions).filter((resource) => resource['Properties']?.['VpcConfig'] !== undefined),
        ).toEqual([]);
    });

    it('introduces no interface VPC endpoint', () => {
        // Interface endpoints bill $0.01 per endpoint-hour PER AZ — $14.60/month/stage at maxAzs 2, several
        // times the whole NAT instance, and once per open PR when declared in a per-service stack.
        const endpoints = templateFor(stagedAsset()).findResources('AWS::EC2::VPCEndpoint');

        expect(Object.keys(endpoints)).toEqual([]);
    });

    it('deploys a handler that resolves to a real module, whose imports are the ones packaged', () => {
        // The W2 property, restated for a service W2 skips: the deployed `handler:` string must name a module
        // that exists. Derived from the template, never from a name written here.
        const functions = templateFor(stagedAsset()).findResources('AWS::Lambda::Function');
        const handlers = Object.values(functions).map((resource) => String(resource['Properties']?.['Handler']));

        expect(handlers.length).toBeGreaterThan(0);

        for (const handler of handlers) {
            const module = handlerModuleOf(handler);
            const source = path.join(packageRoot, 'src', `${module}.py`);

            // Throws if the file is absent, which is the assertion.
            expect(readHandlerImports(source).length).toBeGreaterThan(0);
        }
    });

    it('owns no database, table or queue', () => {
        // ADR-0019 §3 fixes the consequence of the "new deployable" exception: the new deployable owns NO
        // database. The parse cache lives in the recipe database (KTD-16), not beside the engine.
        const template = templateFor(stagedAsset());

        expect(Object.keys(template.findResources('AWS::RDS::DBInstance'))).toEqual([]);
        expect(Object.keys(template.findResources('AWS::DynamoDB::Table'))).toEqual([]);
        expect(Object.keys(template.findResources('AWS::SQS::Queue'))).toEqual([]);
    });

    it('gives its function a role that can do nothing but write its own logs', () => {
        // ARCH-IT-7, and the shape both existing Lambda stacks use: one least-privilege role per function.
        // CDK's DEFAULT role attaches the AWS-managed `AWSLambdaBasicExecutionRole`, which grants
        // `logs:CreateLogGroup` across the account — and reports `AwsSolutions-IAM4`, a finding no other
        // Lambda in this repository produces.
        const template = templateFor(stagedAsset());
        const roles = template.findResources('AWS::IAM::Role');

        expect(Object.keys(roles)).toHaveLength(1);
        expect(Object.values(roles)[0]?.['Properties']?.['ManagedPolicyArns']).toBeUndefined();

        const policies = Object.values(template.findResources('AWS::IAM::Policy'));
        const actions = policies.flatMap((policy) =>
            (
                (policy['Properties']?.['PolicyDocument'] as { Statement?: { Action?: unknown }[] })?.Statement ?? []
            ).flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action])),
        );

        expect([...new Set(actions)].sort()).toEqual(['logs:CreateLogStream', 'logs:PutLogEvents']);
    });

    it('reports no AwsSolutions-IAM4 under the advisory pack', () => {
        // Asserted through the REAL cdk-nag pack rather than our reading of the template, because the rule
        // is the authority on what counts as a managed policy.
        const app = new App();

        Aspects.of(app).add(new AdvisoryAwsSolutionsChecks());

        const stack = new IngredientParserStack(app, 'IngredientParser-test', {
            env,
            stage: 'pr-1',
            assetDirectory: stagedAsset(),
        });

        app.synth();

        const findings = stack.node
            .findAll()
            .flatMap((node) => node.node.metadata.map((entry) => String(entry.data)))
            .join(' ');

        expect(findings).not.toContain('AwsSolutions-IAM4');
        // ⛔ Negative control. The pack must actually be running, or the assertion above is about nothing —
        // and this function is EXPECTED to report L1 while the engine's Requires-Python holds it on 3.13.
        expect(findings).toContain('AwsSolutions-L1');
    });

    it('refuses to synthesize against an unstaged asset', () => {
        // ⛔ THE handle-sync-worker GUARD, at synth. `Code.fromAsset` zips an empty directory without
        // complaint, so "the build was never run" would otherwise deploy a function with no code and fail on
        // the first cold start, behind a green deploy.
        expect(() => templateFor(path.join(packageRoot, 'build', 'does-not-exist'))).toThrow(/bundle:lambda/u);
    });

    it('refuses to synthesize against an empty staging directory', () => {
        const empty = mkdtempSync(path.join(tmpdir(), 'ingredient-parser-empty-'));

        expect(() => templateFor(empty)).toThrow(/empty/u);
    });

    it('tags nothing per-PR at the stack level, leaving the Environment tag to the app', () => {
        // ADR-0005: the Environment tag is applied ONCE, at App level in bin/app.ts, so a per-PR deploy is
        // caught by the teardown script's tag match. A second, stack-level tag is how the two drift.
        const stack = Stack.of(
            new IngredientParserStack(new App(), 'IngredientParser-test', {
                env,
                stage: 'pr-1',
                assetDirectory: stagedAsset(),
            }),
        );

        expect(stack.tags.tagValues()['Environment']).toBeUndefined();
    });

    it('names the function for its stage, so two stages never collide', () => {
        templateFor(stagedAsset()).hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'kitchensink-ingredient-parser-pr-1',
        });
    });
});
