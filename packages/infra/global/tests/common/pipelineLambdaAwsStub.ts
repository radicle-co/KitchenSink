/**
 * A file-backed stub of the AWS CLI for the pipeline Lambda scripts, `runMigrations.sh` and `runSeed.sh`, which reach
 * outward only through `cloudformation describe-stacks` and `lambda invoke`. An executable placed FIRST on `PATH`
 * is exactly that seam, and each scenario states its world by writing files.
 *
 * Shared because both scripts resolve and invoke through the same two helpers in `runMigrations.sh`; the other
 * script suites stub different operations and keep their own.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The stub itself.
 *
 * `describe-stacks` answers from `outputs-<stack>.json` and exits 254 (the real CLI's status for a stack
 * that does not exist) when there is no fixture. `lambda invoke` writes `invoke-payload` to the output file
 * the CLI was given and prints `$STUB_FUNCTION_ERROR` — which is what `--query FunctionError --output text`
 * yields.
 *
 * Every call appends `<service> <operation>` to `calls`, and an invoke records its argv in `sent-args` and the
 * `AWS_MAX_ATTEMPTS` it saw in `sent-max-attempts`.
 */
const AWS_STUB = `#!/usr/bin/env bash
set -uo pipefail
service="$1"; operation="$2"; shift 2
echo "\${service} \${operation}" >> "\${AWS_STUB_DIR}/calls"

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
      --no-cli-pager) continue ;;
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
    # A failure that is NOT "no such stack": the caller states the message and status the real CLI would
    # give for a denial, a throttle, or a bad region.
    if [ -n "\${STUB_DESCRIBE_ERROR-}" ]; then
      echo "\${STUB_DESCRIBE_ERROR}" >&2
      exit "\${STUB_DESCRIBE_STATUS:-255}"
    fi
    file="\${AWS_STUB_DIR}/outputs-$(arg --stack-name "$@").json"
    if [ ! -f "$file" ]; then
      echo "An error occurred (ValidationError): Stack with id X does not exist" >&2
      exit 254
    fi
    cat "$file"
    ;;
  'lambda invoke')
    # The CLI itself failing (a dropped connection, a throttle): a message on stderr and a non-zero status.
    if [ -n "\${STUB_INVOKE_FAIL-}" ]; then
      echo "\${STUB_INVOKE_FAIL}" >&2
      exit 255
    fi
    printf '%s' "$(arg --payload "$@")" > "\${AWS_STUB_DIR}/sent-payload"
    printf '%s\n' "$@" > "\${AWS_STUB_DIR}/sent-args"
    printf '%s' "\${AWS_MAX_ATTEMPTS-unset}" > "\${AWS_STUB_DIR}/sent-max-attempts"
    printf '%s' "\${STUB_INVOKE_PAYLOAD-}" > "$(outfile "$@" | tail -1)"
    echo "\${STUB_FUNCTION_ERROR:-None}"
    ;;
  *) echo "aws stub: unhandled \${service} \${operation}" >&2; exit 255 ;;
esac
`;

/** One script run. */
export interface ScriptRun {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

/** A stubbed AWS CLI in a scratch directory, and what each scenario reads back from it. */
export interface PipelineLambdaAwsStub {
    /** Declare that a stack exists, with the outputs `describe-stacks` returns for it. */
    givenStack(stack: string, outputs: readonly { OutputKey: string; OutputValue: string }[]): void;
    /** Run `script` with the stub first on `PATH`. */
    run(script: string, args: readonly string[], environment?: Readonly<Record<string, string>>): ScriptRun;
    /** Every `<service> <operation>` the scripts called, in order. */
    calls(): readonly string[];
    /** The invoke's `--payload`, or `undefined` when nothing was invoked. */
    sentPayload(): string | undefined;
    /** The invoke's argv. */
    sentArgs(): readonly string[];
    /** The `AWS_MAX_ATTEMPTS` the invoke ran under, or `unset`. */
    sentMaxAttempts(): string;
    /** Remove the scratch directory. */
    cleanup(): void;
}

/**
 * Create a stubbed AWS CLI in a fresh scratch directory.
 *
 * @returns The stub.
 * @sideEffect Creates a directory and an executable file.
 */
export function pipelineLambdaAwsStub(): PipelineLambdaAwsStub {
    const workdir = mkdtempSync(join(tmpdir(), 'pipeline-lambda-'));
    const fixtures = join(workdir, 'aws');
    const binDir = join(workdir, 'bin');

    mkdirSync(fixtures, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'aws'), AWS_STUB);
    chmodSync(join(binDir, 'aws'), 0o755);

    const read = (name: string): string | undefined =>
        existsSync(join(fixtures, name)) ? readFileSync(join(fixtures, name), 'utf8') : undefined;

    return {
        givenStack: (stack, outputs) => {
            writeFileSync(join(fixtures, `outputs-${stack}.json`), JSON.stringify(outputs));
        },
        run: (script, args, environment = {}) => {
            const result = spawnSync('bash', [script, ...args], {
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
        },
        calls: () => (read('calls') ?? '').split('\n').filter((line) => line !== ''),
        sentPayload: () => read('sent-payload'),
        sentArgs: () => (read('sent-args') ?? '').split('\n'),
        sentMaxAttempts: () => read('sent-max-attempts') ?? 'unset',
        cleanup: () => {
            rmSync(workdir, { recursive: true, force: true });
        },
    };
}
