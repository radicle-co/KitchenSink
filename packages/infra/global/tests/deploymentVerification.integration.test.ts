/**
 * Integration suite for the post-deploy verifier's IMPURE half — `verifyDeployment.sh verify-stacks` and
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

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/verifyDeployment.sh', import.meta.url));

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
  # ⛔ NOT \`emit\`, for the same reason as \`describe-log-groups\` below: a group with NO subscription
  # filter is not an API error, it is an empty list at exit 0 — and that is the single most important state
  # this subcommand has to tell apart from a failed call.
  'logs describe-subscription-filters')
    fixture="\${AWS_STUB_DIR}/filters-$(slug "$(arg --log-group-name "$@")").txt"
    # ⛔ A \`.fail\` marker models the call that could not be MADE — a missing IAM grant, a throttle. It is a
    # third state, distinct from both "no filter" and "a filter", and folding it into the first is what made
    # the first version of \`drains\` pass green having asked nothing.
    if [ -f "\${fixture%.txt}.fail" ]; then
      echo "An error occurred (AccessDeniedException) calling DescribeSubscriptionFilters" >&2
      exit 254
    fi
    if [ -f "\${fixture%.txt}.noisy" ]; then
      echo "urllib3 NotOpenSSLWarning: urllib3 v2 only supports OpenSSL 1.1.1+" >&2
    fi
    if [ -f "$fixture" ]; then cat "$fixture"; else echo None; fi
    exit 0
    ;;
  'logs describe-log-groups')
    fixture="\${AWS_STUB_DIR}/loggroup-$(slug "$(arg --log-group-name-prefix "$@")").txt"
    if [ -f "$fixture" ]; then cat "$fixture"; fi
    exit 0
    ;;
  *) echo "aws stub: unhandled \${service} \${operation}" >&2; exit 255 ;;
esac
`;

/**
 * A stub `npx`, so `verifyDeployment.sh stacks` can be driven without a real CDK synth.
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
        // `::error::`, so `bash -e verifyDeployment.sh stacks "<app>"` exited 1 having printed NOTHING —
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
     * outage rather than before it. `verifyDeployment.sh verify` cannot: it runs AFTER a deploy, and a
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

/**
 * ⛔ The RDS resolver's three outcomes, executed against a stubbed `aws`.
 *
 * The classifier half of this feature has unit tests; the RESOLVER had none, and it is the half that
 * decides whether a deploy is reported as verified. An errored AWS call is a hard failure (owner ruling
 * 2026-09-10), never a 0 — a PASS — because that would collapse "could not check" into "checked and fine",
 * in the one script whose job is telling those apart.
 *
 * ⚠️ `aws` is stubbed on `PATH` rather than mocked in TypeScript: the subject is a bash function, and a
 * re-implementation of it here would be a second copy free to drift from the one CI runs.
 */
describe('verify_deployment_resolve_rds — found · absent · could not ask', () => {
    const withStubbedAws = (script: string, target = 'db.abc.us-east-1.rds.amazonaws.com'): number => {
        // The file's own convention: one temp dir per test, removed by the existing `afterEach`. Here the
        // dir is the stub's home and goes on PATH, so `aws` inside the bash function resolves to it.
        const stub = join(workdir, 'stub');

        mkdirSync(stub, { recursive: true });
        writeFileSync(join(stub, 'aws'), `#!/usr/bin/env bash\n${script}\n`);
        chmodSync(join(stub, 'aws'), 0o755);

        const result = spawnSync(
            'bash',
            ['-c', `source ${JSON.stringify(SCRIPT)}; verify_deployment_resolve_rds us-east-1 ${target}`],
            { encoding: 'utf8', env: { ...process.env, PATH: `${stub}:${process.env['PATH'] ?? ''}` } },
        );

        return result.status ?? -1;
    };

    it('passes when the endpoint names a live instance', () => {
        expect(withStubbedAws('echo kitchensink-data-sandbox')).toBe(0);
    });

    it('fails when the call SUCCEEDS and matches nothing — the resource is genuinely absent', () => {
        expect(withStubbedAws('echo ""')).toBe(1);
    });

    it('⛔ fails when the call ERRORS — an unaskable question is not a pass', () => {
        // The owner ruling. A verifier that cannot ask has verified nothing, and 0 means VERIFIED.
        expect(withStubbedAws('exit 255')).toBe(1);
    });

    it('checks CLUSTERS as well as instances, so a cluster endpoint is not a false finding', () => {
        // `describe-db-instances` never matches a `cluster-` address; the second call is not a retry. The
        // stub answers empty for the first call and a name for the second, which is the real shape.
        expect(
            withStubbedAws(
                'if [ "$2" = describe-db-instances ]; then echo ""; else echo kitchensink-cluster; fi',
                'db.cluster-abc.us-east-1.rds.amazonaws.com',
            ),
        ).toBe(0);
    });
});

/**
 * ⛔ `drains` — the deployed-state check ADR-0042 records as owed, and the reason it is owed is that every
 * other signal for a broken drain is an ABSENCE OF LOGS, which is what a healthy quiet system also looks
 * like. `logDrainRegister.test.ts` proves the code cannot attach a filter without an ARN or drop one with
 * it; nothing there can prove a RUNNING stage has them.
 *
 * ⚠️ The two states it must not conflate are the whole point, so both are asserted here: a filter pointing
 * at a destination that no longer exists is a DEFECT and fails, while a group with no filter at all is a
 * SUPPORTED state (a fresh account has no forwarder) and is reported without failing.
 */
describe('drains', () => {
    const RESOURCES = [
        'WebhooksLogGroupA05F4FC6\tAWS::Logs::LogGroup\tCREATE_COMPLETE\tkitchensink-identity-webhooks-sandbox-WebhooksLogGroup-abc',
        'LogForwarderLogGroupB1\tAWS::Logs::LogGroup\tCREATE_COMPLETE\tkitchensink-identity-webhooks-sandbox-LogForwarderLogGroup-def',
    ].join('\n');

    const FORWARDER = 'arn:aws:lambda:us-east-1:123456789012:function:kitchensink-log-forwarder-sandbox';

    beforeEach(() => {
        writeFileSync(join(fixtures, 'resources-kitchensink-identity-webhooks-sandbox.tsv'), `${RESOURCES}\n`);
    });

    it('⛔ FAILS when a filter points at a function that does not exist — delivery fails silently', () => {
        writeFileSync(
            join(fixtures, 'filters-kitchensink-identity-webhooks-sandbox-WebhooksLogGroup-abc.txt'),
            `${FORWARDER}\n`,
        );

        // No `lambda-*.json` fixture for the forwarder: the stub answers 254, i.e. the function is gone.
        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox']);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('::error::');
        expect(result.stdout).toContain('could not be confirmed');
    });

    it('passes when every filter points at a function that exists', () => {
        writeFileSync(
            join(fixtures, 'filters-kitchensink-identity-webhooks-sandbox-WebhooksLogGroup-abc.txt'),
            `${FORWARDER}\n`,
        );
        writeFileSync(
            join(fixtures, 'lambda-kitchensink-log-forwarder-sandbox.json'),
            JSON.stringify({ FunctionName: 'kitchensink-log-forwarder-sandbox' }),
        );

        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('2 log group(s): 1 with a filter, 1 with none, 0 unconfirmed destination(s)');
    });

    /**
     * ⛔ ABSENCE IS REPORTED, NEVER FAILED. A fresh account has no forwarder to point at, so failing here
     * would make a first deploy impossible — which is the deadlock this whole change removed. It is also
     * the state of the forwarder's OWN group, permanently and correctly (a filter on it would feed the
     * Lambda its own output), and nothing in a resource listing can tell that group from an undrained one.
     */
    it('⛔ REPORTS a group with no filter and does not fail — absence is a supported state', () => {
        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('::warning::');
        expect(result.stdout).toContain('has NO subscription filter');
        expect(result.stdout).toContain('2 log group(s): 0 with a filter, 2 with none');
    });

    /**
     * ⛔ An unreadable stack verified NOTHING, and must never be a pass. A sweep that matches nothing
     * reports success, which is the silent direction — the same rule `preflight` above already holds.
     */
    it('⛔ fails when the stack cannot be read, rather than passing on an empty listing', () => {
        const result = run(['drains', 'us-east-1', 'kitchensink-absent-stack']);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('verified NOTHING');
    });

    it('--warn-only downgrades a missing destination without hiding it', () => {
        writeFileSync(
            join(fixtures, 'filters-kitchensink-identity-webhooks-sandbox-WebhooksLogGroup-abc.txt'),
            `${FORWARDER}\n`,
        );

        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox', '--warn-only']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('reported, not enforced');
    });

    it('refuses a call with no stack name rather than checking nothing', () => {
        const result = run(['drains', 'us-east-1']);

        expect(result.status).toBe(2);
    });
});

/**
 * ⛔ THE THREE WAYS `drains` CAN LIE, each measured by the GATE on the round that introduced it and each
 * pinned here. They are not variations on one bug: they are three different wrong answers, and two of them
 * are wrong in the direction that FAILS A DEPLOY on a claim the check cannot support.
 */
describe('drains — the destination probe and the failed call', () => {
    const GROUP = 'kitchensink-identity-webhooks-sandbox-WebhooksLogGroup-abc';

    beforeEach(() => {
        writeFileSync(
            join(fixtures, 'resources-kitchensink-identity-webhooks-sandbox.tsv'),
            `WebhooksLogGroupA05F4FC6\tAWS::Logs::LogGroup\tCREATE_COMPLETE\t${GROUP}\n`,
        );
    });

    /**
     * ⛔ A NON-LAMBDA DESTINATION IS LEGAL. Kinesis, Firehose and a cross-account `logs:destination` are all
     * valid subscription targets. The first version stripped `*:function:` unconditionally — which returns
     * the string UNCHANGED on a non-match — so it probed a Lambda literally named `arn` and then failed the
     * deploy claiming that function was missing. A verifier that fails on a false claim is worse than one
     * that misses, because it teaches its reader to ignore it.
     */
    it('⛔ REPORTS a Kinesis destination as unresolved rather than failing on a false claim', () => {
        writeFileSync(
            join(fixtures, `filters-${GROUP.replace(/[/:.]/gu, '_')}.txt`),
            'arn:aws:kinesis:us-east-1:123456789012:stream/audit\n',
        );

        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('this check does not resolve');
        expect(result.stdout).not.toContain('::error::');
        expect(result.stdout).toContain('1 of a type this check does not resolve');
    });

    /**
     * ⛔ CLOUDWATCH PERMITS TWO FILTERS PER GROUP, and reading `subscriptionFilters[0]` lets a healthy first
     * one mask a broken second — the group reports drained while half its delivery is dead.
     */
    it('⛔ examines EVERY filter, so a healthy one cannot mask a broken sibling', () => {
        writeFileSync(
            join(fixtures, `filters-${GROUP.replace(/[/:.]/gu, '_')}.txt`),
            'arn:aws:lambda:us-east-1:123456789012:function:present\tarn:aws:lambda:us-east-1:123456789012:function:deleted\n',
        );
        writeFileSync(join(fixtures, 'lambda-present.json'), JSON.stringify({ FunctionName: 'present' }));

        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox']);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('function:deleted');
        expect(result.stdout).not.toContain('function:present, and that function');
    });

    /**
     * ⛔ THE INERT-VERIFIER CASE, and the one this check is most likely to arrive in:
     * `logs:DescribeSubscriptionFilters` is a NEW action for this pipeline, and the deploy principal's
     * policy is console-managed rather than declared in this repository. Folding a failed call into "no
     * filter" — which is only a warning — would have every group reported undrained, the step exit 0, and
     * the whole check pass GREEN having asked nothing. An unanswerable question is a finding.
     */
    it('⛔ FAILS when the API call itself fails, rather than reading it as "no filter"', () => {
        writeFileSync(join(fixtures, `filters-${GROUP.replace(/[/:.]/gu, '_')}.fail`), '');

        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox']);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('logs:DescribeSubscriptionFilters failed');
        expect(result.stdout).toContain('AccessDenied');
        // ⛔ And it must NOT be reported as the supported absent state, which is the whole conflation.
        expect(result.stdout).not.toContain('has NO subscription filter');
    });

    /**
     * ⚠️ The Lambda probe keeps stderr so an AccessDenied is not reported as "the function does not exist" —
     * a second false claim, in the same failing direction.
     */
    it('names what AWS actually said when a destination cannot be confirmed', () => {
        writeFileSync(
            join(fixtures, `filters-${GROUP.replace(/[/:.]/gu, '_')}.txt`),
            'arn:aws:lambda:us-east-1:123456789012:function:gone\n',
        );

        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox']);

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('AWS said:');
    });
});

/**
 * ⛔ TWO WAYS THE SWEEP CAN REPORT SUCCESS HAVING CHECKED NOTHING, both introduced by a repair for an
 * earlier finding and both in the hiding direction. They are pinned because neither is visible from the
 * function's own behaviour: one lives in how its CALLER reads the stack list, the other in a stray byte on
 * a stream nobody was watching.
 */
describe('drains-app and the streams it reads', () => {
    const GROUP = 'kitchensink-identity-webhooks-sandbox-WebhooksLogGroup-abc';
    const slug = (name: string): string => name.replace(/[/:.]/gu, '_');

    /**
     * ⛔ A SUCCESSFUL CALL THAT WRITES TO STDERR MUST NOT LOOK LIKE A FILTER. Reading the value with `2>&1`
     * captures the error text on the failing path and CONTAMINATES it on the succeeding one: one CLI
     * warning made an undrained group report as drained, and suppressed the `has NO subscription filter`
     * warning that is the entire signal for a deploy which resolved an empty `LOG_FORWARDER_ARN`.
     */
    it('⛔ still reports "no filter" when a SUCCESSFUL call writes a warning to stderr', () => {
        writeFileSync(
            join(fixtures, 'resources-kitchensink-identity-webhooks-sandbox.tsv'),
            `WebhooksLogGroupA05F4FC6\tAWS::Logs::LogGroup\tCREATE_COMPLETE\t${GROUP}\n`,
        );
        writeFileSync(join(fixtures, `filters-${slug(GROUP)}.noisy`), '');

        const result = run(['drains', 'us-east-1', 'kitchensink-identity-webhooks-sandbox']);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('has NO subscription filter');
        expect(result.stdout).toContain('0 with a filter, 1 with none');
    });

    /**
     * ⛔ A FAILED STACK LISTING MUST FAIL THE SWEEP. `verify_deployment_stacks` calls its own empty-output
     * guard "the load-bearing half of this function", and reading the list through process substitution
     * threw that verdict away — `pipefail` does not reach it — so a failed `cdk ls` produced zero
     * iterations and a GREEN result. The `stacks` subcommand's own vacuity tests could not see this: they
     * drive the function, not the caller that consumes it.
     */
    it('⛔ FAILS when the app cannot be listed, rather than sweeping nothing and passing', () => {
        const result = run(['drains-app', 'us-east-1', 'npx tsx bin/app.ts'], {
            CDK_STUB_LISTING: '',
            CDK_STUB_STATUS: '1',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('checked NOTHING');
    });

    /**
     * ⛔ THE ACCUMULATOR IS THE THIRD THING THAT DISTINGUISHES THE IMPLEMENTATIONS, and it went unpinned
     * because the other two cases were written from the DEFECTS — a contaminated stream and a dropped
     * producer status — rather than from the contract. `|| failed=1` instead of `|| return 1` is the whole
     * reason the previous round's blocker was fixed with a here-string rather than a pipe: a per-stack
     * finding must not abort a sweep whose every round-trip costs a full deploy, or an operator fixes one
     * broken drain and meets the next one release later.
     *
     * ⚠️ Mutating `|| failed=1` to `|| return 1` passes all three of the sibling cases: the positive one
     * has no finding to stop at, and the failed-listing one fires at the guard ABOVE the accumulator. Only
     * this shape — a finding on the FIRST of two stacks — can see it.
     */
    it('⛔ visits EVERY stack even when one has a finding, and then fails', () => {
        writeFileSync(
            join(fixtures, 'resources-one.tsv'),
            'G\tAWS::Logs::LogGroup\tCREATE_COMPLETE\t/aws/lambda/one\n',
        );
        writeFileSync(
            join(fixtures, 'resources-two.tsv'),
            'G\tAWS::Logs::LogGroup\tCREATE_COMPLETE\t/aws/lambda/two\n',
        );
        writeFileSync(join(fixtures, `filters-${slug('/aws/lambda/one')}.fail`), '');

        const result = run(['drains-app', 'us-east-1', 'npx tsx bin/app.ts'], {
            CDK_STUB_LISTING: JSON.stringify([
                { id: 'A (one)', name: 'one', environment: { account: '1', region: 'us-east-1' } },
                { id: 'B (two)', name: 'two', environment: { account: '1', region: 'us-east-1' } },
            ]),
            CDK_STUB_STATUS: '0',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('drains: one');
        // ⛔ The assertion the mutant loses: `return 1` never reaches the second stack.
        expect(result.stdout).toContain('drains: two');
    });

    it('sweeps every stack the app lists', () => {
        writeFileSync(
            join(fixtures, 'resources-one.tsv'),
            'G\tAWS::Logs::LogGroup\tCREATE_COMPLETE\t/aws/lambda/one\n',
        );
        writeFileSync(
            join(fixtures, 'resources-two.tsv'),
            'G\tAWS::Logs::LogGroup\tCREATE_COMPLETE\t/aws/lambda/two\n',
        );

        const result = run(['drains-app', 'us-east-1', 'npx tsx bin/app.ts'], {
            CDK_STUB_LISTING: JSON.stringify([
                { id: 'A (one)', name: 'one', environment: { account: '1', region: 'us-east-1' } },
                { id: 'B (two)', name: 'two', environment: { account: '1', region: 'us-east-1' } },
            ]),
            CDK_STUB_STATUS: '0',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('drains: one');
        expect(result.stdout).toContain('drains: two');
    });
});
