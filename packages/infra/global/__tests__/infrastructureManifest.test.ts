// @vitest-environment node
/**
 * Unit tests for `scripts/infrastructureManifest.mjs` — the generator behind
 * `docs/generated/infrastructure/`.
 *
 * ## What the manifest is FOR, and the sentence it must never say
 *
 * `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 was a hand-maintained table headed "What
 * runs where, today", and it marked `verifyLine` and thirteen other handlers ✅ deployed. Measured against
 * the account: `kitchensink-recipe-workers-prod` held SIX Lambdas, last updated 2026-08-02, with the branch
 * 600+ commits ahead — neither `verifyLine` nor `parseLine` existed anywhere.
 *
 * ⛔ Generating that table from CDK would NOT have caught it. CDK describes INTENT; only the account holds
 * REALITY. So this manifest says exactly one thing — **what the CDK source at this commit DECLARES** — and
 * `deploymentDrift.mjs` is the half that compares it against what is running. The distinction is the whole
 * point, which is why {@link MANIFEST_CLAIM} is asserted verbatim below: a future edit that softens it into
 * "the deployed infrastructure" recreates the original defect in a machine-readable format.
 *
 * ## Why the source is the AST and not a synth
 *
 * A synthesized cloud assembly is the more faithful reading, and it was measured to be unusable as the
 * source of a COMMITTED artifact: every service app calls `ec2.Vpc.fromLookup` (six sites), so synth needs
 * AWS credentials and an uncached context; `RecipeWorkersStack` additionally throws unless the service has
 * been BUILT; and each entrypoint requires between one and nine environment variables. A generated file that
 * only a credentialed, fully-built CI job can reproduce cannot have a regenerate-and-diff staleness gate —
 * and a generated file with no staleness gate rots exactly like the prose table did.
 *
 * The AST reading is hermetic, needs no build, no credentials and no network, and therefore CAN be gated the
 * way `contractDriftGate.mjs` gates the wire contracts. Its limits are recorded rather than hidden: a
 * construct reached through a NON-relative import is not followed (it is counted and named), and a name
 * built from anything other than a literal or a plain reference chain renders as `{?}`.
 *
 * ## Why nothing is enumerated
 *
 * Both axes are derived. The apps come from {@link cdkApps} (content, not path convention); the stacks and
 * resources come from each file's own `new …(…)` expressions, followed across relative imports. The one
 * table that IS written down maps `aws-cdk-lib` MODULES to resource kinds — which is CDK's taxonomy, not a
 * list of this repository's resources — and a construct outside it is REPORTED as unclassified rather than
 * dropped, so the hole announces itself. Same principle as `verify-deployment.sh`'s `classify_reference`.
 *
 * ## Mutation evidence
 *
 * Deleting `handler:` from a fixture stack drops the handler and reds 'reads a Lambda's handler'. Changing
 * `new sqs.Queue` to `new sqs.CfnQueue` moves it to `unclassifiedConstructs` and reds. Removing the `if`
 * around a conditional stack reds 'records the guard a conditional stack sits behind'. Renaming
 * `stackName` reds 'reads a child stack's name template'.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { cdkApps } from './cdkApps.js';
import { repoRoot } from './serviceSources.js';
import {
    MANIFEST_CLAIM,
    MANIFEST_JSON,
    MANIFEST_MARKDOWN,
    MANIFEST_SCHEMA_VERSION,
    buildManifest,
    discoverCdkApps,
    readInfrastructureSource,
    renderManifestMarkdown,
    resolveStageNames,
} from '../../../../scripts/infrastructureManifest.mjs';

/** One scope's constructions, keyed by the class (or `<module>` for the entrypoint's top level). */
function scope(source: string, name: string) {
    const read = readInfrastructureSource(source, 'fixture.ts');
    const found = read.scopes.find((candidate: { name: string }) => candidate.name === name);

    if (found === undefined) {
        throw new Error(`fixture has no scope '${name}'; scopes: ${read.scopes.map((s: { name: string }) => s.name)}`);
    }

    return found;
}

/**
 * ⚠️ The BARREL spelling, deliberately — `import { aws_sqs as sqs } from 'aws-cdk-lib'` — because that is
 * what every stack in this repository actually writes, and the first version of this fixture used the
 * `import * as sqs from 'aws-cdk-lib/aws-sqs'` form instead. It passed, and the reader then read
 * `RecipeWorkersStack` (the stack this whole change exists for) as declaring ZERO resources. A reader that
 * silently returns an empty stack is the prose table with a JSON extension. The submodule spelling is
 * covered separately below, so both remain supported.
 */
const STACK_FIXTURE = `
import {
    CfnOutput,
    Stack,
    aws_cloudwatch as cloudwatch,
    aws_ecs as ecs,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_sqs as sqs,
    aws_ssm as ssm,
} from 'aws-cdk-lib';

export class WorkersStack extends Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const role = new iam.Role(this, 'WorkerRole', {});
        const dlq = new sqs.Queue(this, 'ArchiveDlq', { queueName: \`kitchensink-archive-dlq-\${props.stage}\` });
        const fn = new lambda.Function(this, 'ArchiveWorkerFunction', {
            handler: 'handlers/archiveWorker.handler',
            role,
        });
        new cloudwatch.Alarm(this, 'ArchiveDlqAlarm', { alarmName: \`kitchensink-archive-dlq-\${props.stage}\` });
        new ssm.StringParameter(this, 'QueueUrlParam', {
            parameterName: \`/kitchensink/\${props.stage}/recipe/archive-queue-url\`,
        });
        new ecs.FargateService(this, 'ApiService', { serviceName: \`kitchensink-api-\${props.stage}\` });
        new CfnOutput(this, 'QueueUrlOutput', { value: dlq.queueUrl });
        if (props.stage === 'prod') {
            new lambda.Function(this, 'ProdOnlyFunction', { handler: 'handlers/prodOnly.handler' });
        }
    }
}
`;

describe('readInfrastructureSource — resources', () => {
    const workers = scope(STACK_FIXTURE, 'WorkersStack');

    it('recognises the class as a Stack', () => {
        expect(workers.isStack).toBe(true);
    });

    it("reads a Lambda's logical id and handler", () => {
        expect(workers.resources).toContainEqual(
            expect.objectContaining({
                kind: 'lambdaFunction',
                logicalId: 'ArchiveWorkerFunction',
                handler: 'handlers/archiveWorker.handler',
            }),
        );
    });

    it('renders a stage-parameterised name as a template, never as one stage', () => {
        // ⛔ `{stage}`, not `prod`. The CDK is stage-parameterised on purpose; baking one stage in would
        // make the manifest a claim about a single deploy, which is the shape the prose table had.
        expect(workers.resources).toContainEqual(
            expect.objectContaining({
                kind: 'queue',
                logicalId: 'ArchiveDlq',
                nameTemplate: 'kitchensink-archive-dlq-{stage}',
            }),
        );
    });

    it('reads the last identifier of a reference chain, so `props.stage` and `stage` render alike', () => {
        const direct = scope(
            `import * as sqs from 'aws-cdk-lib/aws-sqs';\nclass S extends Stack { constructor() { new sqs.Queue(this, 'Q', { queueName: \`q-\${stage}\` }); } }`,
            'S',
        );

        expect(direct.resources[0].nameTemplate).toBe('q-{stage}');
    });

    it('renders a name it cannot attribute as `{?}` rather than guessing', () => {
        const computed = scope(
            `import * as sqs from 'aws-cdk-lib/aws-sqs';\nclass S extends Stack { constructor() { new sqs.Queue(this, 'Q', { queueName: \`q-\${a + b}\` }); } }`,
            'S',
        );

        expect(computed.resources[0].nameTemplate).toBe('q-{?}');
    });

    it.each([
        ['alarm', 'ArchiveDlqAlarm'],
        ['ssmParameter', 'QueueUrlParam'],
        ['ecsService', 'ApiService'],
    ])('classifies a %s', (kind, logicalId) => {
        expect(workers.resources).toContainEqual(expect.objectContaining({ kind, logicalId }));
    });

    it('records the guard a conditionally-created resource sits behind', () => {
        expect(workers.resources).toContainEqual(
            expect.objectContaining({ logicalId: 'ProdOnlyFunction', condition: "props.stage === 'prod'" }),
        );
    });

    it('leaves an unconditional resource with a null condition', () => {
        const archive = workers.resources.find((resource) => resource.logicalId === 'ArchiveWorkerFunction');

        expect(archive?.condition).toBeNull();
    });

    it('reports a construct it does not classify instead of dropping it', () => {
        // The honest limit, made loud — the same contract `verify-deployment.sh`'s `classify_reference`
        // holds. An IAM role is genuinely out of scope for this manifest; a resource kind that MATTERS and
        // is not yet in the table would show up here rather than vanish.
        expect(workers.unclassifiedConstructs).toContain('aws-cdk-lib/aws-iam.Role');
    });

    it('does not classify a non-Lambda `Function` from another module', () => {
        // `cloudfront.Function` is a CloudFront function, not a Lambda. Classifying by class NAME alone
        // would file EdgeStack's viewer-request verifier as a Lambda handler that no account will ever run.
        const edge = scope(
            `import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';\nclass S extends Stack { constructor() { new cloudfront.Function(this, 'Verifier', {}); } }`,
            'S',
        );

        expect(edge.resources).toEqual([]);
        expect(edge.unclassifiedConstructs).toContain('aws-cdk-lib/aws-cloudfront.Function');
    });

    it('reads the submodule import spelling too', () => {
        // Both forms are in use across the repo; supporting only one is how the barrel-spelled stacks came
        // back empty.
        const submodule = scope(
            `import * as sqs from 'aws-cdk-lib/aws-sqs';\nclass S extends Stack { constructor() { new sqs.Queue(this, 'Q', { queueName: 'q' }); } }`,
            'S',
        );

        expect(submodule.resources).toContainEqual(expect.objectContaining({ kind: 'queue', logicalId: 'Q' }));
    });

    it('files a barrel-imported CDK class as unclassified, not as an unfollowed hole', () => {
        // `new CfnOutput(...)` is a bare identifier imported from `aws-cdk-lib` — syntactically identical to
        // `new GlobalStack(...)`. Reading it as a child listed NINE phantom "unfollowed constructs" on
        // `RecipeWorkersStack` alone, which is noise that would train a reader to ignore the real signal.
        expect(workers.unclassifiedConstructs).toContain('aws-cdk-lib.CfnOutput');
        expect(workers.unfollowedConstructs).toEqual([]);
    });

    it('reports a construct from ANOTHER WORKSPACE as an unfollowed hole', () => {
        // The genuine limit: anything that construct declares is missing from the manifest, and a reader
        // must see that rather than infer an empty stack.
        const shared = scope(
            `import { SharedThing } from '@kitchensink/infra-alb';\nclass S extends Stack { constructor() { new SharedThing(this, 'T', {}); } }`,
            'S',
        );

        expect(shared.unfollowedConstructs).toEqual(['@kitchensink/infra-alb.SharedThing']);
    });

    it('records a handler that is not a literal as unresolved rather than as absent', () => {
        const constant = scope(
            `import * as lambda from 'aws-cdk-lib/aws-lambda';\nclass S extends Stack { constructor() { new lambda.Function(this, 'Parser', { handler: HANDLER }); } }`,
            'S',
        );

        expect(constant.resources[0]).toMatchObject({ handler: null, notes: ['handler is not a literal: HANDLER'] });
    });
});

const ENTRYPOINT_FIXTURE = `
import { App } from 'aws-cdk-lib';
import { GlobalStack } from '../lib/GlobalStack.js';
import { EdgeStack } from '../lib/EdgeStack.js';

const app = new App();
const stage = 'dev';

new GlobalStack(app, \`Global-\${stage}\`, { stackName: \`kitchensink-global-\${stage}\` });

if (stage === 'prod') {
    new EdgeStack(app, 'Edge', { stackName: \`kitchensink-edge-\${stage}\` });
}
`;

describe('readInfrastructureSource — composition', () => {
    const top = scope(ENTRYPOINT_FIXTURE, '<module>');

    it("reads a child stack's name template from the CALL SITE's stackName prop", () => {
        // `GlobalStack` does not name itself; every stackName in this repo is passed in by whoever builds it.
        expect(top.children).toContainEqual(
            expect.objectContaining({ className: 'GlobalStack', stackNameTemplate: 'kitchensink-global-{stage}' }),
        );
    });

    it('records the relative module a child class comes from, so the walk can follow it', () => {
        expect(top.children).toContainEqual(
            expect.objectContaining({ className: 'GlobalStack', importedFrom: '../lib/GlobalStack.js' }),
        );
    });

    it('records the guard a conditional stack sits behind', () => {
        // ADR-0008's cost guardrails and ADR-0020's edge stack are both prod-only. A manifest that listed
        // them unconditionally would report two stacks as declared for `sandbox` that the app never builds.
        expect(top.children).toContainEqual(
            expect.objectContaining({ className: 'EdgeStack', condition: "stage === 'prod'" }),
        );
    });

    it('does not treat the App itself as a child stack', () => {
        expect(top.children.map((child: { className: string }) => child.className)).not.toContain('App');
    });
});

describe('resolveStageNames', () => {
    it('substitutes the stage into every template', () => {
        expect(resolveStageNames('kitchensink-recipe-workers-{stage}', 'prod')).toBe('kitchensink-recipe-workers-prod');
    });

    it('leaves a placeholder it has no value for alone, so the caller can see it', () => {
        expect(resolveStageNames('kitchensink-{baseStage}-x', 'prod')).toBe('kitchensink-{baseStage}-x');
    });

    it('passes a template with no placeholder through unchanged', () => {
        expect(resolveStageNames('kitchensink-cost-guardrails', 'prod')).toBe('kitchensink-cost-guardrails');
    });

    it('is null-safe, because a name this reader could not read is null', () => {
        expect(resolveStageNames(null, 'prod')).toBeNull();
    });
});

describe('the manifest states what it is, and is not', () => {
    it('claims to describe what the commit DECLARES', () => {
        // ⛔ Verbatim. The whole failure this artefact exists to prevent was a document that said "what runs
        // where, today" about something it could not observe. Softening this sentence recreates it.
        expect(MANIFEST_CLAIM).toContain('DECLARES');
        expect(MANIFEST_CLAIM).toContain('does not describe what is deployed');
    });

    it('carries a schema version, so a consumer can refuse a shape it does not know', () => {
        expect(MANIFEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    });
});

const MANIFEST = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    claim: MANIFEST_CLAIM,
    generator: 'scripts/infrastructureManifest.mjs',
    apps: [
        {
            entrypoint: 'packages/services/recipe-workers/infra/bin/app.ts',
            packageName: '@kitchensink/recipe-workers',
            stacks: [
                {
                    className: 'RecipeWorkersStack',
                    source: 'packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts',
                    stackNameTemplate: 'kitchensink-recipe-workers-{stage}',
                    condition: null,
                    resources: [
                        {
                            kind: 'lambdaFunction',
                            logicalId: 'RecipeParseLineFunction',
                            handler: 'handlers/parseLine.handler',
                            nameTemplate: null,
                            condition: null,
                            notes: [],
                        },
                    ],
                    unclassifiedConstructs: ['aws-cdk-lib/aws-iam.Role'],
                    unfollowedConstructs: [],
                },
            ],
        },
    ],
};

describe('renderManifestMarkdown', () => {
    const markdown = renderManifestMarkdown(MANIFEST);

    it('leads with the claim, so a reader cannot mistake it for a deployment record', () => {
        expect(markdown).toContain(MANIFEST_CLAIM);
    });

    it('names every stack and every handler it declares', () => {
        expect(markdown).toContain('kitchensink-recipe-workers-{stage}');
        expect(markdown).toContain('RecipeParseLineFunction');
        expect(markdown).toContain('handlers/parseLine.handler');
    });

    it('surfaces the unclassified constructs rather than rendering only what it understood', () => {
        expect(markdown).toContain('aws-cdk-lib/aws-iam.Role');
    });

    it('says DO NOT EDIT, because it is generated', () => {
        expect(markdown).toContain('DO NOT EDIT');
    });
});

/**
 * ⛔ THE STALENESS GATE — the reason this artifact is allowed to be committed at all.
 *
 * A generated file that is committed has exactly one failure mode: DRIFT. The source moves and the artifact
 * does not, or somebody hand-edits it. Nothing else in the pipeline can see that — lint, typecheck and every
 * other suite pass happily against a stale JSON file, because a stale JSON file is still valid JSON. That is
 * PRECISELY how `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 came to claim two handlers
 * were live that no account contained: a hand-maintained document with no gate.
 *
 * Same shape as `contractDriftGate.mjs` gives the wire contracts — regenerate, then require no difference —
 * and the same deliberate restraint: this suite REGENERATES IN MEMORY and never writes. A test that repaired
 * the tree would report success having erased its own evidence, so a genuinely drifted checkout would come
 * out of `npm test` silently fixed. See `contractGenerationRunner.test.ts`'s header for the same ruling.
 */
describe('the committed manifest is not stale', () => {
    const generated = buildManifest();

    it('is committed at all — an untracked or ignored artifact has no gate', () => {
        // `git diff` is blind to a path git cannot see, so an ignored manifest would make every assertion
        // below pass while the artifact forked from the source forever.
        const tracked = execFileSync('git', ['ls-files', '--', MANIFEST_JSON, MANIFEST_MARKDOWN], {
            cwd: repoRoot,
            encoding: 'utf8',
        })
            .split('\n')
            .filter((file) => file !== '');

        expect(tracked.sort()).toEqual([MANIFEST_MARKDOWN, MANIFEST_JSON].sort());
    });

    it('matches what the CDK source produces today', () => {
        const committed = existsSync(path.join(repoRoot, MANIFEST_JSON))
            ? JSON.parse(readFileSync(path.join(repoRoot, MANIFEST_JSON), 'utf8'))
            : null;

        expect(
            committed,
            `${MANIFEST_JSON} is stale or missing. Run \`npm run infra:manifest\` and commit the result.`,
        ).toEqual(generated);
    });

    it('matches the rendered view too', () => {
        const committed = existsSync(path.join(repoRoot, MANIFEST_MARKDOWN))
            ? readFileSync(path.join(repoRoot, MANIFEST_MARKDOWN), 'utf8')
            : null;

        expect(committed, `${MANIFEST_MARKDOWN} is stale. Run \`npm run infra:manifest\`.`).toBe(
            renderManifestMarkdown(generated),
        );
    });
});

describe('the manifest covers every CDK app', () => {
    it('agrees with the guard layer about which apps exist', () => {
        // TWO INDEPENDENT DERIVATIONS, compared. `cdkApps()` is what `cdkAppDeployCoverage.test.ts` and
        // `deployVerificationCoverage.test.ts` already reason about; `discoverCdkApps()` is the generator's
        // own walk, deliberately not imported from there (a repo-root script may not reach into a
        // workspace's test helpers). Comparing them is what stops the copy from drifting — the exact
        // artefact ADR-0025 §3 warns about, one derivation growing a filter the other lacks.
        expect([...discoverCdkApps()].sort()).toEqual([...cdkApps()].sort());
    });

    it('carries an entry for every one of them', () => {
        const manifest = buildManifest();

        expect(manifest.apps.map((app: { entrypoint: string }) => app.entrypoint).sort()).toEqual(
            [...cdkApps()].sort(),
        );
    });

    it('declares at least one stack per app — an app that declares nothing was not read', () => {
        // Non-vacuity, per app rather than in aggregate: a reader that silently returned an empty scope for
        // ONE app would be invisible in a total, and that is exactly the bug this generator shipped with
        // (the barrel import spelling made `RecipeWorkersStack` read as empty).
        for (const app of buildManifest().apps) {
            expect(app.stacks.length, `${app.entrypoint} declares no stack`).toBeGreaterThan(0);
        }
    });

    it('reads a Lambda handler out of the stack this whole change exists for', () => {
        // The two handlers the prose table claimed were deployed. If the reader ever stops seeing them, the
        // drift check silently stops asserting them, and the failure mode returns wearing a green tick.
        const workers = buildManifest().apps.find((app) => app.packageName === '@kitchensink/recipe-workers');
        const handlers = (workers?.stacks ?? []).flatMap((stack) =>
            stack.resources
                .filter((resource) => resource.kind === 'lambdaFunction')
                .map((resource) => resource.handler),
        );

        expect(handlers).toContain('handlers/verifyLine.handler');
        expect(handlers).toContain('handlers/parseLine.handler');
    });
});
