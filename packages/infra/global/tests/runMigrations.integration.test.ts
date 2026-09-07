/**
 * Integration suite for the migration safety net's IMPURE half — `run-migrations.sh run`.
 * `__tests__/runMigrations.test.ts` covers the pure classification; this covers everything it cannot see:
 * resolving the runner from the stack's own `CfnOutput`, the invoke, the payload file the CLI writes, and
 * the exit-status contract the workflow steps depend on.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the script, executed as `bash` in a real child process; a real payload file on disk; real
 *   `jq`; the real exit paths.
 * - **Stubbed**: the AWS CLI, via an executable placed FIRST on `PATH`. That seam is exactly where this
 *   script reaches outward, and a file-backed stub lets each scenario state its world by writing files.
 *
 * ## Mutation evidence
 *
 * | scenario | the rule it kills |
 * |---|---|
 * | the runner threw | drop either half of `classify`'s two-sided read → `aws lambda invoke`'s exit 0 passes a failed migration |
 * | the stack exists but publishes no output | treat a missing output like a missing stack → an unreachable runner reads as "nothing to do" |
 * | the stack is absent | fail on it → every prod deploy reds until every feature service has shipped once |
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readMigrationManifest } from '@kitchensink/db-schema-guard';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/run-migrations.sh', import.meta.url));

/**
 * A file-backed stub of the AWS CLI.
 *
 * `describe-stacks` answers from `outputs-<stack>.json` and exits 254 (the real CLI's status for a stack
 * that does not exist) when there is no fixture. `lambda invoke` writes `invoke-payload` to the output file
 * the CLI was given and prints `$STUB_FUNCTION_ERROR` — which is what `--query FunctionError --output text`
 * yields.
 */
const AWS_STUB = `#!/usr/bin/env bash
set -uo pipefail
service="$1"; operation="$2"; shift 2

arg() {
  local want="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$want" ]; then echo "$2"; return 0; fi
    shift
  done
  return 1
}

# The output FILE is \`aws lambda invoke\`'s one positional argument: the last token that is not a flag and
# is not a flag's value.
outfile() {
  local previous='' token=''
  for token in "$@"; do
    case "$token" in
      --*) previous="$token"; continue ;;
    esac
    case "$previous" in
      --*) previous=''; continue ;;
    esac
    echo "$token"
  done
}

case "\${service} \${operation}" in
  'cloudformation describe-stacks')
    file="\${AWS_STUB_DIR}/outputs-$(arg --stack-name "$@").json"
    if [ ! -f "$file" ]; then
      echo "An error occurred (ValidationError): Stack with id X does not exist" >&2
      exit 254
    fi
    cat "$file"
    ;;
  'lambda invoke')
    printf '%s' "$(arg --payload "$@")" > "\${AWS_STUB_DIR}/sent-payload"
    printf '%s' "\${STUB_INVOKE_PAYLOAD-}" > "$(outfile "$@" | tail -1)"
    echo "\${STUB_FUNCTION_ERROR:-None}"
    ;;
  *) echo "aws stub: unhandled \${service} \${operation}" >&2; exit 255 ;;
esac
`;

interface Run {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

let workdir: string;
let fixtures: string;
let binDir: string;

beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'run-migrations-'));
    fixtures = join(workdir, 'aws');
    binDir = join(workdir, 'bin');
    mkdirSync(fixtures, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'aws'), AWS_STUB);
    chmodSync(join(binDir, 'aws'), 0o755);
});

afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
});

/** Declare that a stack exists, with the outputs `describe-stacks` returns for it. */
function givenStack(stack: string, outputs: readonly { OutputKey: string; OutputValue: string }[]): void {
    writeFileSync(join(fixtures, `outputs-${stack}.json`), JSON.stringify(outputs));
}

/**
 * Run the script with the stub on `PATH`.
 *
 * @sideEffect Spawns `bash`.
 */
function run(args: readonly string[], environment: Readonly<Record<string, string>> = {}): Run {
    const result = spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${binDir}:${process.env['PATH'] ?? ''}`, AWS_STUB_DIR: fixtures, ...environment },
    });

    if (result.error) {
        throw result.error;
    }

    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const STACK = 'kitchensink-food-service-prod';
const OUTPUT = 'FoodMigrationFunctionName';

/**
 * The real food migrations directory — the fifth argument `run` now requires, and the source of the
 * manifest digest it sends with the invoke.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../services/food-service/src/db/migrations', import.meta.url));

describe('run — the safety net resolves, invokes, and reads the answer', () => {
    it('invokes the runner named by the stack’s own output and passes on a clean run', () => {
        givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'kitchensink-food-migrate-prod' }]);

        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', MIGRATIONS_DIR], {
            STUB_INVOKE_PAYLOAD: '{"applied":[],"pending":[]}',
        });

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout).toMatch(/invoking migration runner kitchensink-food-migrate-prod/);
    });

    it('⛔ FAILS when the runner threw, which the CLI reports with exit status 0', () => {
        // The defect the food leg carried: `aws lambda invoke` succeeds, the FUNCTION did not, and nothing
        // looked. The deploy then continued onto a schema that had not moved.
        givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', MIGRATIONS_DIR], {
            STUB_FUNCTION_ERROR: 'Unhandled',
            STUB_INVOKE_PAYLOAD: '{"errorType":"Error","errorMessage":"connect ETIMEDOUT"}',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/::error::/);
        expect(result.stdout).toMatch(/ETIMEDOUT/);
    });

    it('⛔ FAILS when the runner reports the fault in its PAYLOAD with FunctionError unset', () => {
        givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', MIGRATIONS_DIR], {
            STUB_INVOKE_PAYLOAD: '{"errorType":"MigrationError","errorMessage":"relation does not exist"}',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/errorType/);
    });

    it('⛔ FAILS when the stack exists but publishes no such output', () => {
        // `RecipeSchemaMigrationRunner` in `RecipeWorkersStack` has no `CfnOutput` at all today, so its only
        // path is the in-stack Trigger. A runner the safety net cannot reach must be LOUD, not mistaken for
        // "there is nothing here to migrate".
        givenStack(STACK, [{ OutputKey: 'SomethingElse', OutputValue: 'x' }]);

        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', MIGRATIONS_DIR]);

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/publishes no 'FoodMigrationFunctionName' output/);
        expect(result.stdout).toMatch(/CfnOutput/);
    });

    it('SKIPS, with a stated reason, when the stack does not exist at all', () => {
        // Prod's recipe stack has never been deployed. Failing here would red every prod deploy until every
        // feature service has shipped once — and a service's absence is the deploy gate's concern, not this
        // script's. The skip is announced so it can never read as a successful migration.
        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', MIGRATIONS_DIR]);

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/::notice::/);
        expect(result.stdout).toMatch(/does not exist, so there is no schema of ours to migrate/);
    });

    it('⛔ FAILS when the invoke itself could not be made', () => {
        givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'fn' }]);

        // An empty payload with no FunctionError is "the CLI wrote nothing" — a transport failure dressed as
        // a success, which must not read as a clean migration.
        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', MIGRATIONS_DIR], { STUB_INVOKE_PAYLOAD: '' });

        expect(result.status).toBe(1);
        expect(result.stdout).toMatch(/no payload/i);
    });
});

describe('run — the migration manifest travels with the invoke', () => {
    it('sends the digest of the working tree, so a runner holding a different set can refuse', () => {
        // ⛔ This is the whole fix for ADR-0022's silent no-op. Without an expectation in the payload, a
        // PREVIOUS release's runner answers `applied: []` — "I have never heard of these migrations" —
        // which is byte-identical to "everything was already applied", and the deploy goes green onto an
        // unmigrated schema.
        givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'kitchensink-food-migrate-prod' }]);

        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', MIGRATIONS_DIR], {
            STUB_INVOKE_PAYLOAD: '{"applied":[]}',
        });

        expect(result.status, result.stdout + result.stderr).toBe(0);

        const sent = JSON.parse(readFileSync(join(fixtures, 'sent-payload'), 'utf8')) as {
            action: string;
            expectManifestSha: string;
        };

        expect(sent.action).toBe('migrate');
        expect(sent.expectManifestSha).toBe(readMigrationManifest(MIGRATIONS_DIR).sha);
    });

    it('reports the expectation in the log, so the deploy record names the set it required', () => {
        givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'kitchensink-food-migrate-prod' }]);

        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', MIGRATIONS_DIR], {
            STUB_INVOKE_PAYLOAD: '{"applied":[]}',
        });

        expect(result.stdout).toContain(readMigrationManifest(MIGRATIONS_DIR).sha);
    });

    it('is MISUSE, never a skip, to omit the migrations directory', () => {
        // ⛔ An optional expectation is one a caller forgets, and a forgotten one behaves exactly like the
        // bug it replaces. Omitting it has to be louder than getting it wrong, not quieter.
        givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'kitchensink-food-migrate-prod' }]);

        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food']);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('<migrationsDir>');
    });

    it('FAILS — never invokes — when the migrations directory does not exist', () => {
        // Computed before the stack is looked up, so a bad path fails on every run rather than only on the
        // stages that happen to have a stack.
        givenStack(STACK, [{ OutputKey: OUTPUT, OutputValue: 'kitchensink-food-migrate-prod' }]);

        const result = run(['run', 'us-east-1', STACK, OUTPUT, 'food', join(workdir, 'nope')]);

        expect(result.status).toBe(1);
        expect(existsSync(join(fixtures, 'sent-payload'))).toBe(false);
    });
});
