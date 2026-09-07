/**
 * Integration suite for the post-deploy verifier's IMPURE half — `verify-deployment.sh verify-stacks` and
 * `… stacks`. `__tests__/deploymentVerification.test.ts` covers the two pure classifiers; this covers
 * everything a classifier cannot see: the CloudFormation listing and its tab-separated parse, the Lambda
 * configuration read, the environment-variable walk that resolves cross-stack references, the ECS
 * running-task check, the exit-status contract the workflow steps depend on, and the two vacuity guards.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the script, executed as `bash` in a real child process. Every classification, every loop, every
 *   `jq` filter and every exit path is the one CI runs — never a TypeScript re-implementation, for the same
 *   reason `deployGate.integration.test.ts` and `prScope.test.ts` give.
 * - **Stubbed**: the AWS CLI and `npx`, via executables placed FIRST on `PATH`. Neither CloudFormation nor a
 *   CDK synth can be stood up in a test run, and those two are exactly where this script reaches outward.
 *   The stubs are file-backed: a fixture directory decides which stacks, functions and services "exist", so
 *   each scenario states its world by writing files rather than by mocking a call.
 *
 * ## Mutation evidence — why each case can fail
 *
 * Every scenario below was watched red before the script existed, and each one dies if the corresponding
 * rule is removed:
 *
 * | scenario | the rule it kills |
 * |---|---|
 * | the CRF case | drop the environment walk → a Lambda pointed at a function nobody created passes |
 * | `UPDATE_ROLLBACK_COMPLETE` on a resource | treat it as `ok` (as the STACK-level gate correctly does) → a deploy that was rolled back passes |
 * | `State=Failed` | drop the state read → a Lambda that deployed and cannot run passes |
 * | ECS `running < desired` | drop the ECS check → a converged, non-serving service passes |
 * | absent stack | let an empty listing mean "no findings" → verifying nothing passes |
 * | empty `cdk ls` | let an empty synth mean "no stacks" → verifying nothing passes |
 *
 * ⚠️ The child is spawned SYNCHRONOUSLY here, unlike `deployGate.integration.test.ts`. That suite needs an
 * event loop because its subject makes real HTTP requests back into this process; this one talks only to
 * stub executables, so blocking is safe and keeps the fixtures readable.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/verify-deployment.sh', import.meta.url));

/**
 * A file-backed stub of the AWS CLI.
 *
 * It answers from `$AWS_STUB_DIR`, so "this function exists" is expressed by writing a file rather than by
 * teaching the stub about a scenario. A lookup with no fixture exits 254 — the status the real CLI uses for
 * a resource that does not exist, which is the case every failure scenario below turns on.
 */
const AWS_STUB = `#!/usr/bin/env bash
set -uo pipefail
service="$1"; operation="$2"; shift 2

# The value following a named flag, e.g. \`arg --function-name\` -> the function name.
arg() {
  local want="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$want" ]; then echo "$2"; return 0; fi
    shift
  done
  return 1
}

# A fixture path is the identifier with every character a filename dislikes folded to '_'.
slug() { printf '%s' "$1" | tr '/:.' '___'; }

emit() {
  if [ -f "$1" ]; then cat "$1"; return 0; fi
  echo "An error occurred (ResourceNotFoundException) calling \${operation}" >&2
  exit 254
}

case "\${service} \${operation}" in
  'cloudformation list-stack-resources') emit "\${AWS_STUB_DIR}/resources-$(slug "$(arg --stack-name "$@")").tsv" ;;
  'lambda get-function-configuration')   emit "\${AWS_STUB_DIR}/lambda-$(slug "$(arg --function-name "$@")").json" ;;
  'ecs describe-services')               emit "\${AWS_STUB_DIR}/ecs-$(slug "$(arg --services "$@")").json" ;;
  'sqs get-queue-url')                   emit "\${AWS_STUB_DIR}/sqs-$(slug "$(arg --queue-name "$@")").json" ;;
  'sqs get-queue-attributes')            emit "\${AWS_STUB_DIR}/sqs-$(slug "$(arg --queue-url "$@")").json" ;;
  'sns get-topic-attributes')            emit "\${AWS_STUB_DIR}/sns-$(slug "$(arg --topic-arn "$@")").json" ;;
  'ssm get-parameter')                   emit "\${AWS_STUB_DIR}/ssm-$(slug "$(arg --name "$@")").json" ;;
  's3api head-bucket')                   emit "\${AWS_STUB_DIR}/s3-$(slug "$(arg --bucket "$@")").json" ;;
  # ⛔ NOT \`emit\`. A prefix that matches nothing is not an ERROR to the real API — it answers an EMPTY
  # list with exit 0, and modelling it as a 254 would let \`preflight\` pass by treating a failed call the
  # same as an absent group. The deleted log group this subcommand exists for looks exactly like this.
  'logs describe-log-groups')
    fixture="\${AWS_STUB_DIR}/loggroup-$(slug "$(arg --log-group-name-prefix "$@")").txt"
    if [ -f "$fixture" ]; then cat "$fixture"; fi
    exit 0
    ;;
  *) echo "aws stub: unhandled \${service} \${operation}" >&2; exit 255 ;;
esac
`;

/**
 * A stub `npx`, so `verify-deployment.sh stacks` can be driven without a real CDK synth.
 *
 * It prints `$CDK_STUB_LISTING` verbatim and exits with `$CDK_STUB_STATUS`, which is what lets the empty-
 * listing vacuity guard be exercised for real rather than asserted about.
 */
const NPX_STUB = `#!/usr/bin/env bash
[ -n "\${CDK_STUB_STDERR:-}" ] && echo "\${CDK_STUB_STDERR}" >&2
printf '%s' "\${CDK_STUB_LISTING:-}"
exit "\${CDK_STUB_STATUS:-0}"
`;

/** One run of the script. */
interface Run {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

let workdir: string;
let fixtures: string;
let binDir: string;

beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'verify-deployment-'));
    fixtures = join(workdir, 'aws');
    // A directory holding ONLY the stubs, prepended to PATH, so a real AWS CLI (if installed) is shadowed
    // and this suite can never reach a real account.
    binDir = join(workdir, 'bin');
    mkdirSync(fixtures, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'aws'), AWS_STUB);
    chmodSync(join(binDir, 'aws'), 0o755);
    writeFileSync(join(binDir, 'npx'), NPX_STUB);
    chmodSync(join(binDir, 'npx'), 0o755);
});

afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
});

/** The fixture name the stub resolves an identifier to. Mirrors the stub's own `slug`. */
function slug(identifier: string): string {
    return identifier.replace(/[/:.]/gu, '_');
}

/** Declare a stack's resources, as `list-stack-resources --output text` returns them. */
function givenStack(
    stack: string,
    rows: readonly (readonly [logical: string, type: string, status: string, physical: string])[],
): void {
    writeFileSync(join(fixtures, `resources-${slug(stack)}.tsv`), rows.map((row) => row.join('\t')).join('\n'));
}

/**
 * Declare that a log group exists, as `describe-log-groups --log-group-name-prefix` returns it.
 *
 * Keyed by the PREFIX the caller queries, which is how the real API behaves — so a test can declare a
 * DIFFERENT group under the same prefix and prove `preflight` matches exactly rather than by prefix.
 */
function givenLogGroup(prefix: string, ...names: readonly string[]): void {
    writeFileSync(join(fixtures, `loggroup-${slug(prefix)}.txt`), names.join('\n'));
}

/** Declare that a Lambda exists, with the configuration `get-function-configuration` returns. */
function givenLambda(name: string, configuration: Readonly<Record<string, unknown>>): void {
    writeFileSync(join(fixtures, `lambda-${slug(name)}.json`), JSON.stringify(configuration));
}

/** Declare that an ECS service exists, with the shape `describe-services` returns. */
function givenEcsService(arn: string, service: Readonly<Record<string, unknown>>): void {
    writeFileSync(join(fixtures, `ecs-${slug(arn)}.json`), JSON.stringify({ services: [service] }));
}

/**
 * Run the script with the stubs on `PATH`.
 *
 * ⛔ `bash -e`, NOT a bare `bash`, and that flag is the whole reason this suite missed a verifier that was
 * INERT across every deploy pipeline. GitHub Actions runs a `run:` body under `/usr/bin/bash -e {0}`, so
 * errexit is ON for every invocation in `sandbox-deploy.yml`, `prod-deploy.yml`,
 * `sandbox-identity-deploy.yml` and `sandbox-router-deploy.yml`. This harness ran without it, which made
 * the harness a DIFFERENT shell from the one CI uses — so the script's `set -uo pipefail` combined with an
 * inherited `-e` in production and with nothing here. Measured: `bash -e … stacks "<app>"` exited 1 with
 * ZERO bytes on stdout and stderr while the same command under a bare `bash` printed its `::error::`
 * diagnostic in full.
 *
 * @sideEffect Spawns `bash`.
 */
function run(args: readonly string[], environment: Readonly<Record<string, string>> = {}): Run {
    const result = spawnSync('bash', ['-e', SCRIPT, ...args], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
            AWS_STUB_DIR: fixtures,
            ...environment,
        },
    });

    if (result.error) {
        throw result.error;
    }

    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The parse-line Lambda as `RecipeWorkersStack` really configures it (ADR-0025 / ADR-0026). */
const PARSE_LINE_ARN = 'arn:aws:ecs:us-east-1:000000000000:service/recipe/parse';

describe('verify-stacks — the resources inside a converged stack', () => {
    it('verifies a healthy stack and says what it examined', () => {
        givenStack('kitchensink-recipe-workers-pr-91', [
            ['ParseLineFunction', 'AWS::Lambda::Function', 'UPDATE_COMPLETE', 'kitchensink-parse-line-pr-91'],
            ['ParseLineRole', 'AWS::IAM::Role', 'CREATE_COMPLETE', 'kitchensink-parse-line-role'],
        ]);
        givenLambda('kitchensink-parse-line-pr-91', {
            State: 'Active',
            LastUpdateStatus: 'Successful',
            Environment: { Variables: { CRF_FUNCTION_NAME: 'kitchensink-ingredient-parser-pr-91' } },
        });
        givenLambda('kitchensink-ingredient-parser-pr-91', { State: 'Active' });

        const result = run(['verify-stacks', 'us-east-1', 'kitchensink-recipe-workers-pr-91']);

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toMatch(/2 resource\(s\) across 1 stack\(s\) verified/);
    });

    it('⛔ FAILS when a Lambda names a function that does not exist — the CRF defect', () => {
        // The whole reason this script exists. `RecipeWorkersStack` shipped `parseLine` into every stage
        // carrying `CRF_FUNCTION_NAME=kitchensink-ingredient-parser-{stage}` while no account held the
        // function; `crfInvoke.ts` mapped the failed invoke to `unavailable` and the pipeline read that as
        // `single-engine llm`. The stack converged, `/health` answered 200, and nothing was red.
        givenStack('kitchensink-recipe-workers-pr-91', [
            ['ParseLineFunction', 'AWS::Lambda::Function', 'UPDATE_COMPLETE', 'kitchensink-parse-line-pr-91'],
        ]);
        givenLambda('kitchensink-parse-line-pr-91', {
            State: 'Active',
            Environment: { Variables: { CRF_FUNCTION_NAME: 'kitchensink-ingredient-parser-pr-91' } },
        });
        // …and deliberately NO fixture for the parser: it was never deployed.

        const result = run(['verify-stacks', 'us-east-1', 'kitchensink-recipe-workers-pr-91']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/::error::/);
        expect(result.stdout).toMatch(/CRF_FUNCTION_NAME=kitchensink-ingredient-parser-pr-91/);
        expect(result.stdout).toMatch(/no such lambda resource exists/);
    });

    it('resolves a reference by ARN SHAPE, with no help from the key name', () => {
        givenStack('s', [['F', 'AWS::Lambda::Function', 'CREATE_COMPLETE', 'fn']]);
        givenLambda('fn', {
            Environment: {
                Variables: { ANYTHING_AT_ALL: 'arn:aws:sns:us-east-1:000000000000:kitchensink-handle-sync-prod' },
            },
        });

        // No fixture for the topic → the reference is unresolvable, and the ARN alone was enough to know
        // which API to ask. This is the property that makes the classifier self-extending.
        const failing = run(['verify-stacks', 'us-east-1', 's']);

        expect(failing.status).toBe(1);
        expect(failing.stdout).toMatch(/no such sns resource exists/);

        writeFileSync(
            join(fixtures, `sns-${slug('arn:aws:sns:us-east-1:000000000000:kitchensink-handle-sync-prod')}.json`),
            '{}',
        );

        expect(run(['verify-stacks', 'us-east-1', 's']).status).toBe(0);
    });

    it('⛔ FAILS a resource left at its PREVIOUS revision, which the stack-level gate calls usable', () => {
        // ADR-0010's gate treats `UPDATE_ROLLBACK_COMPLETE` as a USABLE stack — correctly: the stack is
        // intact at its previous revision, so a preview built on it works. One level down the same word
        // means "this deploy did not land here", and until now nothing in this repository looked.
        givenStack('s', [['ParseLineFunction', 'AWS::Lambda::Function', 'UPDATE_ROLLBACK_COMPLETE', 'fn']]);
        givenLambda('fn', {});

        const result = run(['verify-stacks', 'us-east-1', 's']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/PREVIOUS revision/);
    });

    it('⛔ FAILS a Lambda that deployed but cannot run', () => {
        // ADR-0025's own residual: the parser's arm64 / CPython 3.13 wheels "have never been loaded by a
        // Python 3.13 interpreter on ARM", and a bad code package is `State=Failed`, not a stack failure.
        givenStack('s', [['F', 'AWS::Lambda::Function', 'CREATE_COMPLETE', 'fn']]);
        givenLambda('fn', { State: 'Failed', StateReason: 'The function could not be created' });

        const result = run(['verify-stacks', 'us-east-1', 's']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/State=Failed/);
        expect(result.stdout).toMatch(/could not be created/);
    });

    it('⛔ FAILS a Lambda whose CODE update did not take, so it runs the previous build', () => {
        givenStack('s', [['F', 'AWS::Lambda::Function', 'UPDATE_COMPLETE', 'fn']]);
        givenLambda('fn', { State: 'Active', LastUpdateStatus: 'Failed', LastUpdateStatusReason: 'InvalidImage' });

        const result = run(['verify-stacks', 'us-east-1', 's']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/LastUpdateStatus=Failed/);
        expect(result.stdout).toMatch(/PREVIOUS build/);
    });

    it('⛔ FAILS an ECS service that converged without serving', () => {
        givenStack('s', [['Api', 'AWS::ECS::Service', 'UPDATE_COMPLETE', PARSE_LINE_ARN]]);
        givenEcsService(PARSE_LINE_ARN, { status: 'ACTIVE', runningCount: 0, desiredCount: 1 });

        const result = run(['verify-stacks', 'us-east-1', 's']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/only 0 of 1 tasks are running/);
    });

    it('accepts an ECS service deliberately scaled to zero', () => {
        // The food leg's pass 1 provisions with `FOOD_DESIRED_COUNT=0` on purpose (the per-PR database does
        // not exist yet). `running < desired` is the finding; `desired == 0` is a decision.
        givenStack('s', [['Api', 'AWS::ECS::Service', 'UPDATE_COMPLETE', PARSE_LINE_ARN]]);
        givenEcsService(PARSE_LINE_ARN, { status: 'ACTIVE', runningCount: 0, desiredCount: 0 });

        expect(run(['verify-stacks', 'us-east-1', 's']).status).toBe(0);
    });

    it('⛔ FAILS rather than passing when a stack has no readable resources', () => {
        // The vacuity guard. "Nothing came back" must never read as "nothing is wrong" — that is the same
        // silent success as a `|| true`, and it is the failure this whole file is built around.
        const result = run(['verify-stacks', 'us-east-1', 'kitchensink-ingredient-parser-pr-91']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/verified NOTHING/);
    });

    it('does not desync on a multi-line environment value', () => {
        // `CLERK_JWT_KEY` is a PEM: real, multi-line, and sitting in task definitions and Lambda
        // environments across this repo. A naive tab/newline read would consume the following variable as
        // part of it and stop checking references halfway down the list, silently.
        givenStack('s', [['F', 'AWS::Lambda::Function', 'CREATE_COMPLETE', 'fn']]);
        givenLambda('fn', {
            Environment: {
                Variables: {
                    CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nAAAA\nBBBB\n-----END PUBLIC KEY-----',
                    CRF_FUNCTION_NAME: 'kitchensink-ingredient-parser-pr-91',
                },
            },
        });

        const result = run(['verify-stacks', 'us-east-1', 's']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/CRF_FUNCTION_NAME/);
    });

    it('WARNS, rather than passing in silence, on a reference it has no resolver for', () => {
        givenStack('s', [['F', 'AWS::Lambda::Function', 'CREATE_COMPLETE', 'fn']]);
        givenLambda('fn', { Environment: { Variables: { SOME_NEW_THING: 'kitchensink-something-prod' } } });

        const result = run(['verify-stacks', 'us-east-1', 's']);

        // Not a failure — the classifier genuinely does not know what this is, and failing would make the
        // fix "delete the check". But it must be visible: this is the CRF defect under a key nobody taught
        // the classifier about.
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/::warning::/);
        expect(result.stdout).toMatch(/SOME_NEW_THING=kitchensink-something-prod/);
    });

    it('reports EVERY finding rather than stopping at the first', () => {
        // A verifier that aborts on finding one makes a broken deploy take as many runs to diagnose as it
        // has faults.
        givenStack('s', [
            ['A', 'AWS::Lambda::Function', 'UPDATE_FAILED', 'a'],
            ['B', 'AWS::Lambda::Function', 'CREATE_COMPLETE', 'b'],
        ]);
        givenLambda('b', { State: 'Failed', StateReason: 'boom' });

        const result = run(['verify-stacks', 'us-east-1', 's']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/UPDATE_FAILED/);
        expect(result.stdout).toMatch(/State=Failed/);
        expect(result.stdout).toMatch(/2 finding\(s\)/);
    });

    it('exits 2 on misuse, never 0', () => {
        expect(run(['verify-stacks']).status).toBe(2);
        expect(run(['verify-stacks', 'us-east-1']).status).toBe(2);
        expect(run(['verify', 'us-east-1']).status).toBe(2);
    });
});

describe('stacks — the checklist is DERIVED from the CDK app, and never empty', () => {
    it('reads the physical stack names out of `cdk ls --long --json`', () => {
        const result = run(['stacks', 'npx tsx infra/bin/app.ts'], {
            CDK_STUB_LISTING: JSON.stringify([
                {
                    id: 'Global-prod (kitchensink-global-prod)',
                    name: 'kitchensink-global-prod',
                    environment: { account: '1', region: 'us-east-1', name: 'aws://1/us-east-1' },
                },
                {
                    id: 'Edge (kitchensink-edge-prod)',
                    name: 'kitchensink-edge-prod',
                    environment: { account: '1', region: 'us-east-1', name: 'aws://1/us-east-1' },
                },
            ]),
        });

        expect(result.status).toBe(0);
        // ⛔ The `environment.name` values MUST NOT appear. Measured against CDK 2.x, each entry carries a
        // nested `name: aws://…`, so a line-wise `name:` parser hands `aws://1/us-east-1` to
        // `describe-stacks` as a stack. That is why this reads JSON at the top level.
        expect(result.stdout.trim().split('\n').sort()).toEqual(['kitchensink-edge-prod', 'kitchensink-global-prod']);
        expect(result.stdout).not.toMatch(/aws:\/\//);
    });

    it('⛔ FAILS when the synth produces no stacks, and shows why', () => {
        const result = run(['stacks', 'npx tsx infra/bin/app.ts'], {
            CDK_STUB_LISTING: '',
            CDK_STUB_STATUS: '1',
            CDK_STUB_STDERR: 'Error: DOMAIN_NAME env var is required',
        });

        expect(result.status).toBe(1);
        // ⚠️ REWRITTEN 2026-09-03, and the move is the fix rather than a relocation of an assertion.
        // `verify_deployment_stacks` prints stack NAMES on stdout and every diagnostic on stderr, because
        // its only production caller captures its stdout in a command substitution — see the `verify` case
        // above. Asserting the diagnostic on stdout is what let that swallow go unnoticed.
        expect(result.stderr).toMatch(/verified NOTHING/);
        // The synth's own diagnostic has to survive: without it the failure reads as "yielded no stack
        // names", which says nothing about the missing environment variable that caused it.
        expect(result.stderr).toMatch(/DOMAIN_NAME env var is required/);
    });

    it('⛔ FAILS on an output shape it does not understand, rather than sweeping nothing', () => {
        const result = run(['stacks', 'app'], { CDK_STUB_LISTING: 'Alpha\nBeta\n' });

        expect(result.status).toBe(1);
    });

    it('reads the listing even when a tool printed a banner to stdout ahead of the JSON', () => {
        // ⛔ THE DEFECT THAT MADE THIS SCRIPT INERT EVERYWHERE. `dotenv@17` prints a marketing line to
        // STDOUT on every `config()` call — even for a path that does not exist — and all seven CDK app
        // entrypoints call it, so `cdk ls --long --json` emitted:
        //
        //     ◇ injected env (0) from packages/infra/global/.env // tip: ⌘ multiple files …
        //     [ { "id": …
        //
        // `jq` cannot parse that, its error was discarded by `2>/dev/null`, `names` came back empty and the
        // whole run died one line ABOVE the `::error::` written to explain it.
        //
        // Silencing dotenv is the other half of the repair; this half is that the parse must not be
        // hostage to the next tool that decides stdout is a billboard. The names still come back.
        const result = run(['stacks', 'app'], {
            CDK_STUB_LISTING: `◇ injected env (0) from packages/infra/global/.env // tip: ⌘ multiple files
${JSON.stringify([{ id: 'Global-prod (kitchensink-global-prod)', name: 'kitchensink-global-prod', environment: {} }])}`,
        });

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout.trim().split('\n')).toEqual(['kitchensink-global-prod']);
    });

    it('⛔ recovers a banner that CONTAINS A BRACKET — the cut is line-anchored, not first-character', () => {
        // dotenv rotates its tip text, and FOUR of the eight tips observed carry a `[`:
        // `{ path: ['.env.local', '.env'] }`, `[www.dotenvx.com]`. A cut at the first `[` CHARACTER would
        // therefore have worked or failed depending on which advertisement the library chose that second —
        // an intermittent verifier, which is a worse defect than the reliably-inert one being repaired.
        const result = run(['stacks', 'app'], {
            CDK_STUB_LISTING: `◇ injected env (0) from .env // tip: ⌘ multiple files { path: ['.env.local', '.env'] }\n${JSON.stringify(
                [{ name: 'kitchensink-global-prod' }],
            )}`,
        });

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout.trim().split('\n')).toEqual(['kitchensink-global-prod']);
    });

    it('REPORTS the prefix it dropped rather than hiding that stdout was polluted', () => {
        // Recovering silently would make the next pollutant invisible, and the pollutant is the finding:
        // something in the synth chain is writing to a channel this repository parses as data.
        const result = run(['stacks', 'app'], {
            CDK_STUB_LISTING: `◇ injected env (0) from .env
${JSON.stringify([{ name: 'kitchensink-global-prod' }])}`,
        });

        expect(result.stderr).toMatch(/::warning::/);
        expect(result.stderr).toMatch(/injected env/);
    });

    it('⛔ is LOUD under `bash -e`, the shell every deploy workflow actually runs it in', () => {
        // The recurring failure this repository keeps paying for: a check whose signal reaches no one.
        // Under errexit + pipefail the empty-`names` pipeline killed the script one line before its own
        // `::error::`, so `bash -e verify-deployment.sh stacks "<app>"` exited 1 having printed NOTHING —
        // on stdout or stderr — for every deploy in `sandbox-deploy.yml`, `prod-deploy.yml`,
        // `sandbox-identity-deploy.yml` and `sandbox-router-deploy.yml`.
        const result = run(['stacks', 'app'], {
            CDK_STUB_LISTING: 'this is not JSON at all',
            CDK_STUB_STATUS: '0',
        });

        expect(result.status).toBe(1);
        expect(
            (result.stdout + result.stderr).trim(),
            'the verifier failed without saying anything — this is the inert-under-errexit defect',
        ).not.toBe('');
        // Actionable, not merely non-empty: the operator must be told WHAT was on stdout.
        expect(result.stderr).toMatch(/this is not JSON at all/);
    });

    it('⛔ surfaces the synth diagnostic through `verify`, which captures `stacks` in a substitution', () => {
        // The second silencer, independent of errexit: `verify` calls
        // `names=$(verify_deployment_stacks "$app")`, so anything that function wrote to STDOUT — its
        // `::error::` included — was captured into `names` and thrown away. Only stderr survives a command
        // substitution, which is why the discovery function's diagnostics belong there.
        const result = run(['verify', 'us-east-1', 'app'], {
            CDK_STUB_LISTING: '',
            CDK_STUB_STATUS: '1',
            CDK_STUB_STDERR: 'Error: DOMAIN_NAME env var is required',
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/verified NOTHING/);
        expect(result.stderr).toMatch(/DOMAIN_NAME env var is required/);
    });

    it('verify: discovers the app’s stacks and then verifies them', () => {
        givenStack('kitchensink-ingredient-parser-pr-91', [
            ['Parser', 'AWS::Lambda::Function', 'CREATE_COMPLETE', 'kitchensink-ingredient-parser-pr-91'],
        ]);
        givenLambda('kitchensink-ingredient-parser-pr-91', { State: 'Active' });

        const result = run(['verify', 'us-east-1', 'npx tsx packages/services/ingredient-parser/infra/bin/app.ts'], {
            CDK_STUB_LISTING: JSON.stringify([
                { id: 'IngredientParser-pr-91', name: 'kitchensink-ingredient-parser-pr-91', environment: {} },
            ]),
        });

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toMatch(/synthesises 1 stack\(s\)/);
        expect(result.stdout).toMatch(/1 resource\(s\) across 1 stack\(s\) verified/);
    });
});

describe('preflight — a resource CloudFormation manages was deleted out of band', () => {
    /**
     * ⛔ The failure this exists for, measured on 2026-09-03.
     *
     * A bulk `aws logs delete-log-group` sweep run from a workstation on 2026-08-27 removed NINE
     * CloudFormation-managed log groups across BOTH stages. CloudFormation does not notice and does not
     * re-create: its model still records the physical id, so every subsequent UPDATE calls the handler
     * against a resource that is gone, gets `NotFound`, and rolls the whole stack back.
     * `kitchensink-identity-service-sandbox` sat in `UPDATE_ROLLBACK_COMPLETE` reporting that very log
     * group as `UPDATE_COMPLETE` — the rollback restores the MODEL, not the thing.
     *
     * Nothing detects this until a deploy is already half-run, which on prod means finding out during the
     * outage rather than before it. `verify-deployment.sh verify` cannot: it runs AFTER a deploy, and a
     * deploy that rolled back never reaches it.
     */
    it('passes when every log group the stack manages still exists', () => {
        givenStack('kitchensink-identity-service-prod', [
            ['IdentityServiceLogGroup4DD93B61', 'AWS::Logs::LogGroup', 'UPDATE_COMPLETE', 'ident-prod-logs-kSpwUVcr'],
            ['IdentityTaskRole', 'AWS::IAM::Role', 'UPDATE_COMPLETE', 'ident-prod-task-role'],
        ]);
        givenLogGroup('ident-prod-logs-kSpwUVcr', 'ident-prod-logs-kSpwUVcr');

        const result = run(['preflight', 'us-east-1', 'kitchensink-identity-service-prod']);

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toMatch(/1 log group\(s\)/);
    });

    it('FAILS, naming the group and the exact command that repairs it', () => {
        givenStack('kitchensink-identity-service-prod', [
            ['IdentityServiceLogGroup4DD93B61', 'AWS::Logs::LogGroup', 'UPDATE_COMPLETE', 'ident-prod-logs-kSpwUVcr'],
        ]);
        // No `givenLogGroup` — the prefix query answers empty with exit 0, exactly as the real API does
        // for a group that was deleted.

        const result = run(['preflight', 'us-east-1', 'kitchensink-identity-service-prod']);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/::error::/);
        expect(result.stdout).toContain('ident-prod-logs-kSpwUVcr');
        // The message must carry the repair, not just the diagnosis. A deploy gate that says "something is
        // wrong" at 3am and makes the reader derive the fix is half a gate.
        //
        // ⚠️ REWRITTEN from a literal `create-log-group --log-group-name …` match. The script emits
        // `--region` between the two, which is BETTER than what this originally asserted — the printed
        // command is then copy-pasteable regardless of the operator's default region, and the 2026-08-27
        // sweep that caused all this came from a workstation whose CLI defaults nobody can assume. So the
        // assertion moved to the contract (a create-log-group command naming THIS group) rather than one
        // exact spelling of it.
        expect(result.stdout).toMatch(/aws logs create-log-group .*--log-group-name ident-prod-logs-kSpwUVcr/);
    });

    it('matches the name EXACTLY, not by prefix', () => {
        // `describe-log-groups --log-group-name-prefix X` returns everything STARTING WITH X. A different
        // group sharing the prefix would make a naive non-empty test pass while the managed one is gone —
        // and these physical ids are `<stack>-<logical><hash>-<suffix>`, so shared prefixes are the norm.
        givenStack('kitchensink-identity-service-prod', [
            ['IdentityServiceLogGroup4DD93B61', 'AWS::Logs::LogGroup', 'UPDATE_COMPLETE', 'ident-prod-logs-kSpwUVcr'],
        ]);
        givenLogGroup('ident-prod-logs-kSpwUVcr', 'ident-prod-logs-kSpwUVcr-REPLACEMENT');

        const result = run(['preflight', 'us-east-1', 'kitchensink-identity-service-prod']);

        expect(result.status, 'a different group under the same prefix is not the managed one').toBe(1);
    });

    it('refuses to report success for a stack it could not read', () => {
        // Vacuity. An unreadable stack yields no rows, and "no rows" must never be reported as "nothing
        // wrong" — that is the shape of every silent check this repo has had to repair.
        const result = run(['preflight', 'us-east-1', 'kitchensink-nonexistent-stack']);

        expect(result.status).toBe(1);
        // ⚠️ REWRITTEN to the message the script actually emits, which names the API call that came back
        // empty and says outright that nothing was checked. That is strictly more useful than the generic
        // "no resources" this first asserted, and it matches `verify_stacks`' sibling diagnostic word for
        // word — one vocabulary for one failure.
        expect(result.stdout + result.stderr).toMatch(/ListStackResources returned nothing/);
        expect(result.stdout + result.stderr).toMatch(/checked NOTHING/);
    });

    it('says so plainly when the stack manages no log groups at all', () => {
        givenStack('kitchensink-alb-sandbox', [
            ['SharedAlb', 'AWS::ElasticLoadBalancingV2::LoadBalancer', 'CREATE_COMPLETE', 'kitche-Share-lnWb'],
        ]);

        const result = run(['preflight', 'us-east-1', 'kitchensink-alb-sandbox']);

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout, 'a run that checked nothing must say it checked nothing').toMatch(/0 log group\(s\)/);
    });

    it('rejects misuse rather than passing', () => {
        expect(run(['preflight', 'us-east-1']).status).toBe(2);
        expect(run(['preflight']).status).toBe(2);
    });
});
