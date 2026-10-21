/**
 * `stackCurrency.sh evaluate` with stubbed `cdk` and `aws` on PATH (ADR-0067): the I/O half of the per-stack gate.
 *
 * What it must do, each asserted from the stubs' own call logs:
 *  - synthesize the app ONCE, and judge every stack against that one assembly;
 *  - select stacks for `cdk deploy --exclusively` by their construct path, mapped from the CloudFormation name;
 *  - read each deployed template with the CALLER's credentials (`get-template`), never through `cdk diff`, which
 *    assumes the bootstrap lookup role, and that role may not read stacks (run 39661720474: every stack read changed);
 *  - leave a stack alone only when it is usable, its template equals the synthesized one apart from CDK's own
 *    `CDKMetadata` resource, and its resolved SSM values still hold;
 *  - never compare the bootstrap version parameter;
 *  - read any answer it cannot get (a stack it cannot describe, a template or a parameter it cannot read) as STALE;
 *  - deploy everything, comparing nothing, on a forced run;
 *  - fail loudly, not "skip", when the app does not synthesize or a named stack is not in it.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github', 'scripts', 'stackCurrency.sh');
const scratch: string[] = [];

afterAll(() => {
    for (const dir of scratch) {
        rmSync(dir, { recursive: true, force: true });
    }
});

const TEMPLATE = '{"Resources":{"Queue":{"Type":"AWS::SQS::Queue","Properties":{"DelaySeconds":1}}}}';

/** The `cdk` stub. `synth` writes a real cloud assembly manifest and one template per stack; `diff` must never run. */
const FAKE_CDK = `#!/usr/bin/env bash
echo "cdk $*" >> "$FAKE_LOG"
case "$1" in
    synth)
        out=''; while [ $# -gt 0 ]; do [ "$1" = --output ] && out="$2"; shift; done
        [ "\${FAKE_SYNTH_EXIT:-0}" = 0 ] || exit "$FAKE_SYNTH_EXIT"
        mkdir -p "$out"
        echo '{"artifacts":{"AppA":{"type":"aws:cloudformation:stack","displayName":"App/A","properties":{"stackName":"stack-a","templateFile":"AppA.template.json"}},"stack-b":{"type":"aws:cloudformation:stack","displayName":"App/B","properties":{"templateFile":"stack-b.template.json"}}}}' > "$out/manifest.json"
        echo "\${FAKE_LOCAL_A:-$TEMPLATE}" > "$out/AppA.template.json"
        echo "\${FAKE_LOCAL_B:-$TEMPLATE}" > "$out/stack-b.template.json"
        ;;
    ls)
        echo '[{"id":"App/A (stack-a)","name":"stack-a"},{"id":"App/B (stack-b)","name":"stack-b"}]'
        ;;
    diff)
        exit 99
        ;;
esac
exit 0
`;

/** The `aws` stub, routed on what is asked: the status query, the parameters query, or an SSM read. */
const AWS_ROUTER = `#!/usr/bin/env bash
echo "aws $*" >> "$FAKE_LOG"
args="$*"
stack=''; name=''
set -- "$@"
while [ $# -gt 0 ]; do
    case "$1" in --stack-name) stack="$2" ;; --name) name="$2" ;; esac
    shift
done
case "$stack" in stack-a) key=A ;; stack-b) key=B ;; *) key='' ;; esac
status_var="FAKE_STATUS_$key"; params_var="FAKE_PARAMS_$key"
status="\${!status_var:-UPDATE_COMPLETE}"
case "$args" in
    *"describe-stacks"*StackStatus*)
        case "$status" in ABSENT) echo 'Stack does not exist' >&2; exit 254 ;; UNREADABLE) echo 'AccessDenied' >&2; exit 254 ;; esac
        echo "$status"
        ;;
    *"describe-stacks"*Parameters*)
        case "$status" in ABSENT|UNREADABLE) exit 254 ;; esac
        params_fail_var="FAKE_PARAMS_FAIL_$key"
        [ -z "\${!params_fail_var:-}" ] || { echo 'Rate exceeded' >&2; exit 254; }
        echo "\${!params_var:-[]}"
        ;;
    *"get-template"*)
        tpl_var="FAKE_DEPLOYED_$key"; unreadable_var="FAKE_TEMPLATE_UNREADABLE_$key"
        [ -z "\${!unreadable_var:-}" ] || { echo 'AccessDenied' >&2; exit 254; }
        echo "\${!tpl_var:-$TEMPLATE}"
        ;;
    *"ssm get-parameter"*)
        case "$name" in
            /p/changed) echo new ;;
            /p/unreadable) echo 'AccessDenied' >&2; exit 254 ;;
            /cdk-bootstrap/*) echo 99 ;;
            *) echo same ;;
        esac
        ;;
esac
exit 0
`;

interface Run {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly calls: readonly string[];
    readonly githubOutput: string;
}

function evaluate(env: Readonly<Record<string, string>>, args: readonly string[] = ['false']): Run {
    const dir = mkdtempSync(path.join(tmpdir(), 'stackCurrency-'));
    const bin = path.join(dir, 'bin');
    const log = path.join(dir, 'calls.log');
    const output = path.join(dir, 'github_output');

    scratch.push(dir);
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'cdk'), FAKE_CDK);
    writeFileSync(path.join(bin, 'aws'), AWS_ROUTER);
    chmodSync(path.join(bin, 'cdk'), 0o755);
    chmodSync(path.join(bin, 'aws'), 0o755);
    writeFileSync(log, '');
    writeFileSync(output, '');

    const [forced = 'false', ...stacks] = args;
    const result = spawnSync(
        'bash',
        [
            SCRIPT,
            'evaluate',
            'us-east-1',
            forced,
            'cdk',
            'tsx bin/app.ts',
            ...(stacks.length > 0 ? stacks : ['stack-a', 'stack-b']),
        ],
        {
            encoding: 'utf8',
            env: {
                PATH: `${bin}:${process.env['PATH'] ?? ''}`,
                FAKE_LOG: log,
                TEMPLATE,
                GITHUB_OUTPUT: output,
                RUNNER_TEMP: dir,
                ...env,
            },
        },
    );

    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
        githubOutput: readFileSync(output, 'utf8'),
    };
}

const staleOf = (run: Run): string => /^stale=(.*)$/mu.exec(run.stdout)?.[1] ?? '<none>';
const synths = (run: Run): number => run.calls.filter((call) => call.startsWith('cdk synth')).length;
const diffs = (run: Run): readonly string[] => run.calls.filter((call) => call.startsWith('cdk diff'));
const templateReads = (run: Run): readonly string[] => run.calls.filter((call) => call.includes('get-template'));
const CHANGED = TEMPLATE.replace('"DelaySeconds":1', '"DelaySeconds":2');

describe('stackCurrency.sh evaluate', () => {
    it('leaves every unchanged stack alone, from ONE synth', () => {
        const run = evaluate({});

        expect(run.status, run.stderr).toBe(0);
        expect(staleOf(run)).toBe('');
        expect(run.githubOutput).toContain('stale_json=[]\n');
        expect(synths(run)).toBe(1);
        expect(templateReads(run)).toHaveLength(2);
        expect(existsSync(/^assembly=(.*)$/mu.exec(run.stdout)?.[1] ?? '')).toBe(true);
    });

    // ⛔ `cdk diff` reads the deployed template through the bootstrap LOOKUP role, which may not call DescribeStacks
    // here, and it then exits 1 exactly as for a real change. So it is never called: the template is read with the
    // caller's own credentials, the role every other read in the gate uses.
    it('reads each deployed template with the caller credentials, original stage, and never runs cdk diff', () => {
        const run = evaluate({});

        expect(diffs(run)).toEqual([]);
        expect(templateReads(run)).toEqual([
            'aws cloudformation get-template --region us-east-1 --stack-name stack-a --template-stage Original --query TemplateBody --output json',
            'aws cloudformation get-template --region us-east-1 --stack-name stack-b --template-stage Original --query TemplateBody --output json',
        ]);
    });

    it('marks the stack whose template differs, by its construct path', () => {
        const run = evaluate({ FAKE_DEPLOYED_B: CHANGED });

        expect(staleOf(run)).toBe('App/B');
        expect(run.stderr).toContain('stack-b: STALE (the template differs from the deployed one)');
    });

    it('compares templates as JSON, so key order and whitespace do not count', () => {
        const reordered =
            '{ "Resources": { "Queue": { "Properties": { "DelaySeconds": 1 }, "Type": "AWS::SQS::Queue" } } }';

        expect(staleOf(evaluate({ FAKE_DEPLOYED_A: reordered }))).toBe('');
    });

    it('accepts a deployed template that CloudFormation returns as a JSON string', () => {
        expect(staleOf(evaluate({ FAKE_DEPLOYED_A: JSON.stringify(TEMPLATE) }))).toBe('');
    });

    // CDK's own analytics resource changes with the CDK version, and `cdk diff` ignores it for the same reason.
    it('ignores only the CDKMetadata resource', () => {
        const withMetadata = (analytics: string): string =>
            JSON.stringify({
                Resources: {
                    ...(JSON.parse(TEMPLATE) as { Resources: object }).Resources,
                    CDKMetadata: { Type: 'AWS::CDK::Metadata', Properties: { Analytics: analytics } },
                },
            });

        expect(staleOf(evaluate({ FAKE_DEPLOYED_A: withMetadata('v2:a'), FAKE_LOCAL_A: withMetadata('v2:b') }))).toBe(
            '',
        );
    });

    it('marks a stack whose deployed template cannot be read, and says why', () => {
        const run = evaluate({ FAKE_TEMPLATE_UNREADABLE_A: '1' });

        expect(staleOf(run)).toBe('App/A');
        expect(run.stderr).toContain('stack-a: STALE (the deployed template could not be read)');
    });

    it('marks an absent stack without diffing it', () => {
        const run = evaluate({ FAKE_STATUS_A: 'ABSENT' });

        expect(staleOf(run)).toBe('App/A');
        expect(templateReads(run).some((call) => call.includes(' stack-a '))).toBe(false);
    });

    it('marks a stack it cannot describe as stale, never as current', () => {
        expect(staleOf(evaluate({ FAKE_STATUS_B: 'UNREADABLE' }))).toBe('App/B');
    });

    it('marks a stack in an unusable state', () => {
        expect(staleOf(evaluate({ FAKE_STATUS_A: 'UPDATE_ROLLBACK_FAILED' }))).toBe('App/A');
    });

    it('marks a stack whose resolved SSM value changed, and names the parameter', () => {
        const run = evaluate({
            FAKE_PARAMS_A: JSON.stringify([
                { ParameterKey: 'Vpc', ParameterValue: '/p/changed', ResolvedValue: 'old' },
            ]),
        });

        expect(staleOf(run)).toBe('App/A');
        expect(run.stderr).toContain('/p/changed');
    });

    // ⛔ The status read and the parameters read are two calls. When only the second fails (a throttle), there are no
    // parameters to compare, and that must never read as "none changed".
    it('marks a stack whose parameters cannot be read after its status was, and says why', () => {
        const run = evaluate({ FAKE_PARAMS_FAIL_A: '1' });

        expect(run.status, run.stderr).toBe(0);
        expect(staleOf(run)).toBe('App/A');
        expect(run.stderr).toContain('stack-a: STALE (its resolved parameters could not be read)');
    });

    it('marks a stack whose SSM parameter cannot be read', () => {
        expect(
            staleOf(
                evaluate({
                    FAKE_PARAMS_B: JSON.stringify([
                        { ParameterKey: 'Vpc', ParameterValue: '/p/unreadable', ResolvedValue: 'x' },
                    ]),
                }),
            ),
        ).toBe('App/B');
    });

    it('does not compare the bootstrap version parameter, and keeps an unchanged one current', () => {
        const run = evaluate({
            FAKE_PARAMS_A: JSON.stringify([
                {
                    ParameterKey: 'BootstrapVersion',
                    ParameterValue: '/cdk-bootstrap/hnb659fds/version',
                    ResolvedValue: '21',
                },
                { ParameterKey: 'Vpc', ParameterValue: '/p/same', ResolvedValue: 'same' },
            ]),
        });

        expect(staleOf(run)).toBe('');
        expect(run.calls.some((call) => call.includes('/cdk-bootstrap/'))).toBe(false);
    });

    it('deploys every stack on a forced run, comparing nothing', () => {
        const run = evaluate({}, ['true']);

        expect(staleOf(run)).toBe('App/A App/B');
        expect(run.stdout).toContain('stale_json=["stack-a","stack-b"]\n');
        expect(templateReads(run)).toEqual([]);
        expect(synths(run)).toBe(1);
    });

    // A stack's construct path is not always its name (`IdentityService-sandbox` deploys
    // `kitchensink-identity-service-sandbox`), and `cdk deploy` selects by path, so a step deploying one stack reads it.
    it('writes every judged stack path, keyed by CloudFormation name', () => {
        const run = evaluate({});

        expect(run.githubOutput).toContain('paths_json={"stack-a":"App/A","stack-b":"App/B"}\n');
    });

    it('writes the verdict to $GITHUB_OUTPUT, with the stale stacks by path and by CloudFormation name', () => {
        const run = evaluate({ FAKE_DEPLOYED_A: CHANGED });

        expect(run.githubOutput).toContain('stale=App/A\n');
        // A JSON array, so a step can ask `contains(fromJSON(…), '<name>')`, which matches whole names only.
        expect(run.githubOutput).toContain('stale_json=["stack-a"]\n');
        expect(run.githubOutput).not.toContain('stale_names');
        expect(run.githubOutput).toMatch(/^assembly=.+$/mu);
    });

    it('fails, answering nothing, when the app does not synthesize', () => {
        const run = evaluate({ FAKE_SYNTH_EXIT: '1' });

        expect(run.status).toBe(1);
        expect(run.stdout).toBe('');
        expect(run.githubOutput).toBe('');
    });

    it('fails, answering nothing, when a named stack is not in the app', () => {
        const run = evaluate({}, ['false', 'stack-a', 'stack-zzz']);

        expect(run.status).toBe(1);
        expect(run.stdout).toBe('');
        expect(run.stderr).toContain('stack-zzz');
    });

    it('refuses missing arguments with the usage status', () => {
        expect(spawnSync('bash', [SCRIPT, 'evaluate', 'us-east-1'], { encoding: 'utf8' }).status).toBe(2);
    });
});
