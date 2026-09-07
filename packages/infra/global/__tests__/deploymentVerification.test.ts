/**
 * Repo-wide guard: the post-deploy RESOURCE verifier (`.github/scripts/verify-deployment.sh`).
 *
 * ## The failure this pins
 *
 * `cdkAppDeployCoverage.test.ts` asks whether every CDK app has a deployer. It cannot ask whether the
 * things INSIDE a deployed stack actually arrived, and that is one level above where the CRF parser
 * failed: `RecipeWorkersStack` shipped `RecipeParseLineFunction` into every stage carrying
 * `CRF_FUNCTION_NAME=kitchensink-ingredient-parser-{stage}` and an IAM grant to that ARN, while no
 * account contained the function. `crfInvoke.ts` maps a failed invoke to `unavailable` per line and the
 * pipeline reads that as `single-engine llm`, so a two-engine parse ran on one engine behind green
 * checks. Every existing signal was satisfied: the stack converged, `/health` answered 200, and the
 * smoke asserted the ECOSYSTEM one service over (recipe→food) but not this edge.
 *
 * Two more shapes are invisible to a converged stack, and both have shipped here before:
 *
 *   - a stack at rest in `UPDATE_ROLLBACK_COMPLETE` is USABLE per ADR-0010's gate — correctly, since it is
 *     intact at its previous revision — but the RESOURCE that failed to update sits at
 *     `UPDATE_ROLLBACK_COMPLETE` too, and nothing ever looked. The deploy that did not land reports green.
 *   - a Lambda whose code package is unloadable deploys fine and fails on its first cold start. ADR-0025
 *     records exactly that residual for the arm64 / CPython 3.13 wheels: "the first real proof is a deploy".
 *
 * ## Why the predicates are executed as real `bash`
 *
 * Same reason as `deployGate.test.ts` and `prScope.test.ts`: a TypeScript re-implementation would be a
 * SECOND copy of the decision, free to drift from the one CI runs. These tests shell out to the real
 * script. The two classifiers are PURE — a status in, a verdict out; a name/value in, a probe out — and
 * every AWS call lives in the `verify` / `verify-stacks` subcommands, covered by
 * `tests/deploymentVerification.integration.test.ts`.
 *
 * ## Why the harness spawns `bash -e`
 *
 * Because that is the shell CI uses. A `run:` body in GitHub Actions is executed as `/usr/bin/bash -e {0}`,
 * so errexit is ON for every invocation the deploy workflows make. This harness used to spawn a bare `bash`,
 * which made the suite a different shell from production — and under the real one the script exited at its
 * first accumulated failure, printing nothing, for every finding it exists to report. A test harness that
 * runs the subject under gentler conditions than production is not testing the subject.
 *
 * ## Why the reference classifier enumerates no services
 *
 * The subject is DISCOVERED from the deployed Lambda's own environment, and classified by the VALUE's
 * shape first: an ARN names its own service and resource type, so `arn:aws:sqs:…` is resolvable without
 * anybody registering SQS here. Only a BARE name needs the key's help, because a bare string is
 * shapeless — and that is the honest limit of this derivation, so a `kitchensink-…` value under a key
 * the classifier does not recognise is reported as UNCHECKED rather than silently passed. A hole that
 * announces itself is the difference between this and "a copy of a list cannot detect that the list is
 * incomplete" (ADR-0025 §3).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/verify-deployment.sh', import.meta.url));

/** One classifier verdict, as the script prints it. */
interface Verdict {
    readonly verdict: string;
    readonly reason: string;
    readonly status: number;
}

/**
 * Run a pure subcommand and parse its two-line verdict.
 *
 * @param args - The subcommand and its arguments.
 * @returns The parsed `verdict=` / `reason=` pair plus the exit status.
 * @sideEffect Spawns `bash`.
 */
function run(...args: readonly string[]): Verdict {
    const result = spawnSync('bash', ['-e', SCRIPT, ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const stdout = result.stdout ?? '';

    return {
        verdict: /^verdict=(.*)$/m.exec(stdout)?.[1] ?? '',
        reason: /^reason=(.*)$/m.exec(stdout)?.[1] ?? '',
        status: result.status ?? -1,
    };
}

/** One reference probe, as `classify-reference` prints it. */
interface Reference {
    readonly probe: string;
    readonly target: string;
    readonly status: number;
}

/**
 * Run the reference classifier.
 *
 * @param key - The Lambda environment variable's name.
 * @param value - Its value.
 * @returns The probe kind and the identifier to resolve.
 * @sideEffect Spawns `bash`.
 */
function classifyReference(key: string, value: string): Reference {
    const result = spawnSync('bash', ['-e', SCRIPT, 'classify-reference', key, value], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const stdout = result.stdout ?? '';

    return {
        probe: /^probe=(.*)$/m.exec(stdout)?.[1] ?? '',
        target: /^target=(.*)$/m.exec(stdout)?.[1] ?? '',
        status: result.status ?? -1,
    };
}

describe('verify-deployment.sh exists and is executable as bash', () => {
    it('is present at the path the workflows call', () => {
        expect(existsSync(SCRIPT), `${SCRIPT} is missing — both deploy workflows invoke it`).toBe(true);
    });

    it('refuses an unknown subcommand with the misuse status', () => {
        // Exit 2 rather than 1, exactly as deploy-gate.sh does: a verifier that answers "nothing wrong"
        // on malformed input is how an unverified deploy passes.
        expect(run('nonsense').status).toBe(2);
    });
});

describe('classify-resource — a converged stack is not a converged resource', () => {
    it.each(['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'IMPORT_COMPLETE'])('accepts %s', (status) => {
        expect(run('classify-resource', status).verdict).toBe('ok');
    });

    it.each(['DELETE_COMPLETE', 'DELETE_SKIPPED'])('accepts %s — the resource left the stack', (status) => {
        // Not a finding: the resource is no longer part of the stack, so there is nothing to be stale or
        // broken. `DELETE_SKIPPED` is a RETAINED resource, which is a deliberate removalPolicy, not a fault.
        expect(run('classify-resource', status).verdict).toBe('ok');
    });

    it.each(['UPDATE_ROLLBACK_COMPLETE', 'ROLLBACK_COMPLETE', 'IMPORT_ROLLBACK_COMPLETE'])(
        'reports %s as STALE, not ok',
        (status) => {
            // THE hole ADR-0010's gate leaves open by design. `UPDATE_ROLLBACK_COMPLETE` is a USABLE stack
            // status — the stack is intact at its PREVIOUS revision — so the gate skips, correctly. At the
            // RESOURCE level the same status means this deploy did not land on that resource, and nothing
            // in this repository looked at it before.
            const { verdict, reason } = run('classify-resource', status);

            expect(verdict).toBe('stale');
            expect(reason).toMatch(/previous/i);
        },
    );

    it.each([
        'CREATE_FAILED',
        'UPDATE_FAILED',
        'DELETE_FAILED',
        'IMPORT_FAILED',
        'UPDATE_ROLLBACK_FAILED',
        'ROLLBACK_FAILED',
    ])('reports %s as FAILED', (status) => {
        expect(run('classify-resource', status).verdict).toBe('failed');
    });

    it.each(['CREATE_IN_PROGRESS', 'UPDATE_IN_PROGRESS', 'UPDATE_ROLLBACK_IN_PROGRESS'])(
        'reports %s as FAILED — the deploy returned and this resource is still moving',
        (status) => {
            expect(run('classify-resource', status).verdict).toBe('failed');
        },
    );

    it('fails CLOSED on a status it does not recognise', () => {
        // A CloudFormation status added after this file was written must be LOUD, not silently accepted.
        // The permissive direction is the one that ships an unverified deploy behind a green check.
        const { verdict, reason } = run('classify-resource', 'SOME_FUTURE_STATUS');

        expect(verdict).toBe('failed');
        expect(reason).toMatch(/unrecognis|unrecogniz/i);
    });

    it('rejects an empty status as misuse rather than classifying it', () => {
        expect(run('classify-resource', '').status).toBe(2);
    });
});

describe('classify-reference — an ARN names its own service, so nothing is enumerated', () => {
    it('resolves a Lambda ARN by shape, whatever the key is called', () => {
        const reference = classifyReference(
            'SOMETHING_NOBODY_NAMED',
            'arn:aws:lambda:us-east-1:040663841500:function:kitchensink-ingredient-parser-pr-91',
        );

        expect(reference.probe).toBe('lambda');
        expect(reference.target).toBe('kitchensink-ingredient-parser-pr-91');
    });

    it('strips a Lambda ARN’s version/alias qualifier', () => {
        const reference = classifyReference(
            'FN',
            'arn:aws:lambda:us-east-1:040663841500:function:kitchensink-parse-line-prod:live',
        );

        expect(reference.target).toBe('kitchensink-parse-line-prod');
    });

    it('resolves an SQS queue URL', () => {
        const reference = classifyReference(
            'ACCOUNT_ERASURE_QUEUE_URL',
            'https://sqs.us-east-1.amazonaws.com/040663841500/kitchensink-recipe-erasure-prod',
        );

        expect(reference.probe).toBe('sqs');
        expect(reference.target).toBe(
            'https://sqs.us-east-1.amazonaws.com/040663841500/kitchensink-recipe-erasure-prod',
        );
    });

    it('resolves an SQS ARN through its queue NAME', () => {
        const reference = classifyReference('Q', 'arn:aws:sqs:us-east-1:040663841500:kitchensink-recipe-erasure-prod');

        expect(reference.probe).toBe('sqs-name');
        expect(reference.target).toBe('kitchensink-recipe-erasure-prod');
    });

    it('resolves an SNS topic ARN', () => {
        const reference = classifyReference(
            'HANDLE_SYNC_TOPIC_ARN',
            'arn:aws:sns:us-east-1:040663841500:kitchensink-handle-sync-prod',
        );

        expect(reference.probe).toBe('sns');
        expect(reference.target).toBe('arn:aws:sns:us-east-1:040663841500:kitchensink-handle-sync-prod');
    });

    it('resolves an SSM parameter ARN through its NAME', () => {
        const reference = classifyReference(
            'P',
            'arn:aws:ssm:us-east-1:040663841500:parameter/kitchensink/prod/recipe/account-erasure-queue-url',
        );

        expect(reference.probe).toBe('ssm');
        expect(reference.target).toBe('/kitchensink/prod/recipe/account-erasure-queue-url');
    });

    it('resolves a BARE function name through the key’s suffix — the CRF case', () => {
        // The defect this whole script exists for. `CRF_FUNCTION_NAME` holds a bare name, so no shape
        // rule can classify it; the key is the only signal, and the value is resolved against Lambda.
        const reference = classifyReference('CRF_FUNCTION_NAME', 'kitchensink-ingredient-parser-pr-91');

        expect(reference.probe).toBe('lambda');
        expect(reference.target).toBe('kitchensink-ingredient-parser-pr-91');
    });

    it('resolves a bare bucket name through the key’s suffix', () => {
        expect(classifyReference('RECIPE_ARCHIVE_BUCKET', 'kitchensink-archive-prod')).toMatchObject({
            probe: 's3',
            target: 'kitchensink-archive-prod',
        });
        expect(classifyReference('MEDIA_BUCKET_NAME', 'kitchensink-media-prod')).toMatchObject({ probe: 's3' });
    });

    it('reports an UNRECOGNISED kitchensink-shaped value rather than passing it silently', () => {
        // The derivation's honest limit, made loud. A bare name under a key this classifier does not
        // know is exactly the CRF defect wearing a different key, and the one thing it must never do is
        // return `none` for it.
        const reference = classifyReference('SOME_NEW_THING', 'kitchensink-something-prod');

        expect(reference.probe).toBe('unchecked');
        expect(reference.target).toBe('kitchensink-something-prod');
    });

    it('ignores values that name no AWS resource', () => {
        // Discriminating power in the other direction: a classifier that probes everything reds on
        // configuration and gets deleted. These are all real recipe/food task-definition values.
        expect(classifyReference('NODE_ENV', 'production').probe).toBe('none');
        expect(classifyReference('CRF_ENGINE_VERSION', 'ingredient-parser-nlp==2.3.0').probe).toBe('none');
        expect(classifyReference('RECIPE_DB_BASE_NAME', 'kitchensink_recipes').probe).toBe('none');
        expect(classifyReference('LOG_LEVEL', '').probe).toBe('none');
        expect(classifyReference('FOOD_SERVICE_URL', 'https://food-pr-91.commise.app').probe).toBe('none');
    });

    it('ignores a WILDCARD ARN — a grant pattern names no single resource', () => {
        expect(classifyReference('X', 'arn:aws:lambda:us-east-1:040663841500:function:kitchensink-*').probe).toBe(
            'none',
        );
    });

    it('ignores a value that still holds an unresolved template placeholder', () => {
        // A CloudFormation-substituted value that arrives literally is a synth bug, not a live resource;
        // resolving it would produce a confusing "function not found" for a name nobody meant.
        expect(classifyReference('CRF_FUNCTION_NAME', 'kitchensink-parser-${Token[TOKEN.42]}').probe).toBe('none');
    });

    it('rejects a missing value as misuse rather than answering none', () => {
        const result = spawnSync('bash', ['-e', SCRIPT, 'classify-reference', 'ONLY_A_KEY'], { encoding: 'utf8' });

        expect(result.status).toBe(2);
    });
});
