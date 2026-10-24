// @vitest-environment node
/**
 * Integration: the two gates `sandbox-identity-deploy.yml` runs before it deploys the shared tier (ADR-0060).
 *
 * 1. **An absent shared tier on a `pull_request` deploys NOTHING** (`sandboxSharedTier.sh standing`, read by the
 *    "Is the sandbox up?" step). Only Sandbox Up starts the tier; before this, the next push to any identity-touching PR
 *    saw `kitchensink-alb-sandbox` missing, called that "a stack the environment must self-heal", and rebuilt the ALB
 *    Sandbox Down had just deleted. A dispatch or a Sandbox Up call (`workflow_call`) is a request for the tier, so
 *    they keep the rebuild.
 * 2. **A called run waits for an in-progress PR run** (`waitForPrIdentityDeploy.sh`) instead of sharing the PR
 *    concurrency group, where a PR push replaced Sandbox Up's pending identity run (GitHub keeps ONE pending run per
 *    group). Unknown is not idle: a `gh` that fails stops the wait with an error.
 *
 * The scripts are executed as real `bash` against stubbed `aws` and `gh` on `PATH`; the workflow step's own `run:` body
 * is extracted from the parsed YAML, so the wiring and the behaviour are the shipped text and not a copy of it.
 */
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const workspaces: string[] = [];

afterAll(() => {
    for (const dir of workspaces) {
        rmSync(dir, { recursive: true, force: true });
    }
});

const ANCHOR = 'kitchensink-alb-sandbox';

interface Step {
    readonly name?: string;
    readonly run?: string;
}

const workflow = parse(readFileSync(path.join(repoRoot, '.github/workflows/sandbox-identity-deploy.yml'), 'utf8')) as {
    readonly jobs: { readonly deploy: { readonly steps: readonly Step[] } };
};

const stepBody = (name: string): string => {
    const step = workflow.jobs.deploy.steps.find((candidate) => candidate.name === name);

    if (step?.run === undefined) {
        throw new Error(`no step named "${name}" in sandbox-identity-deploy.yml`);
    }

    return step.run;
};

/** A throwaway working copy holding the REAL scripts and a stub `sandboxWake.sh`, plus stub CLIs first on PATH. */
function makeWorkspace(stubs: Readonly<Record<string, string>>): {
    readonly dir: string;
    readonly env: NodeJS.ProcessEnv;
} {
    const dir = mkdtempSync(path.join(tmpdir(), 'identity-gates-'));
    workspaces.push(dir);
    const bin = path.join(dir, 'bin');
    const scripts = path.join(dir, '.github', 'scripts');
    mkdirSync(bin);
    mkdirSync(scripts, { recursive: true });

    for (const real of ['sandboxSharedTier.sh', 'waitForPrIdentityDeploy.sh']) {
        const source = path.join(repoRoot, '.github/scripts', real);

        if (existsSync(source)) {
            symlinkSync(source, path.join(scripts, real));
        }
    }

    // The wake check is its own suite's subject; here the database and NAT are simply up.
    writeFileSync(path.join(scripts, 'sandboxWake.sh'), '#!/usr/bin/env bash\nexit "${STUB_WAKE_RC:-0}"\n');

    for (const [name, body] of Object.entries(stubs)) {
        writeFileSync(path.join(bin, name), body);
        chmodSync(path.join(bin, name), 0o755);
    }

    return { dir, env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: dir } };
}

const AWS_STUB = `#!/usr/bin/env bash
# cloudformation describe-stacks --stack-name X: answered from STUB_ALB ('absent' | 'broken' | a status).
case "$STUB_ALB" in
    absent) echo "An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id ${ANCHOR} does not exist" >&2; exit 254 ;;
    broken) echo "An error occurred (Throttling) when calling the DescribeStacks operation: Rate exceeded" >&2; exit 254 ;;
    *) echo "$STUB_ALB" ;;
esac
`;

function runTierStep(event: string, alb: string): { status: number | null; up: string | undefined; out: string } {
    const { dir, env } = makeWorkspace({ aws: AWS_STUB });
    const outputFile = path.join(dir, 'github_output');
    writeFileSync(outputFile, '');
    writeFileSync(path.join(dir, 'step.sh'), stepBody('Is the sandbox up?'));
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'step.sh'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...env, EVENT_NAME: event, DEFAULT_AWS_REGION: 'us-east-1', GITHUB_OUTPUT: outputFile, STUB_ALB: alb },
    });
    const up = /^up=(.*)$/mu.exec(readFileSync(outputFile, 'utf8'))?.[1];

    return { status: result.status, up, out: `${result.stdout}${result.stderr}` };
}

describe('"Is the sandbox up?" — an absent shared tier on a pull_request deploys nothing (triage [8])', () => {
    it('⛔ pull_request + ALB absent: up=false, a notice naming Sandbox Up, and NO failure', () => {
        const result = runTierStep('pull_request', 'absent');

        expect(result.up).toBe('false');
        expect(result.status).toBe(0);
        expect(result.out).toContain('::notice::');
        expect(result.out).toContain('Sandbox Up');
    });

    it('⛔ pull_request + ALB being DELETED: not standing either', () => {
        expect(runTierStep('pull_request', 'DELETE_IN_PROGRESS').up).toBe('false');
    });

    it('pull_request + ALB standing: deploys as before', () => {
        expect(runTierStep('pull_request', 'UPDATE_COMPLETE').up).toBe('true');
    });

    it.each(['workflow_dispatch'])('⛔ %s + ALB absent: KEEPS the rebuild — the caller asked for the tier', (event) => {
        const result = runTierStep(event, 'absent');

        expect(result.up).toBe('true');
        expect(result.status).toBe(0);
    });

    it('⛔ pull_request + a lookup that FAILS: an error, never "absent" and never "standing"', () => {
        const result = runTierStep('pull_request', 'broken');

        expect(result.status).not.toBe(0);
        expect(result.up).toBeUndefined();
    });
});

describe('sandboxSharedTier.sh anchor — the stack whose absence means the tier is released', () => {
    const run = (...args: string[]): { status: number | null; stdout: string } => {
        const result = spawnSync('bash', [path.join(repoRoot, '.github/scripts/sandboxSharedTier.sh'), ...args], {
            encoding: 'utf8',
        });

        return { status: result.status, stdout: result.stdout.trim() };
    };

    it('is the ALB, and is on the delete allowlist as its LAST entry', () => {
        const anchor = run('anchor').stdout;

        expect(anchor).toBe(ANCHOR);
        expect(run('may-delete', anchor).status).toBe(0);
        expect(run('order').stdout.split('\n').at(-1)).toBe(anchor);
    });
});

describe('waitForPrIdentityDeploy.sh — a called run waits for an in-progress PR run (triage [11])', () => {
    // `gh run list` answers the COUNT of in-progress PR runs, from a script of answers, one per call.
    const GH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_LOG"
[ -n "\${STUB_GH_FAILS:-}" ] && exit 1
n=$(cat "$STUB_COUNTER" 2>/dev/null || echo 0)
echo $((n + 1)) >"$STUB_COUNTER"
answers=($STUB_ANSWERS)
echo "\${answers[$n]:-\${answers[-1]}}"
`;

    function wait(
        answers: string,
        extra: Readonly<Record<string, string>> = {},
    ): {
        readonly status: number | null;
        readonly out: string;
        readonly calls: readonly string[];
    } {
        const { dir, env } = makeWorkspace({ gh: GH_STUB });
        const log = path.join(dir, 'calls');
        const result = spawnSync('bash', [path.join(dir, '.github/scripts/waitForPrIdentityDeploy.sh')], {
            cwd: dir,
            encoding: 'utf8',
            env: {
                ...env,
                STUB_ANSWERS: answers,
                STUB_LOG: log,
                STUB_COUNTER: path.join(dir, 'counter'),
                WAIT_POLL_SECONDS: '1',
                WAIT_TIMEOUT_SECONDS: '3',
                ...extra,
            },
        });

        return {
            status: result.status,
            out: `${result.stdout}${result.stderr}`,
            calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
        };
    }

    it('returns at once when no PR run is in progress', () => {
        const result = wait('0');

        expect(result.status).toBe(0);
        expect(result.calls).toHaveLength(1);
    });

    it('⛔ waits while a PR run is in progress, and goes on when it ends', () => {
        // Two 1-second polls must fit inside the deadline, and bash's whole-second SECONDS can tick early, so the
        // default 3-second bound raced them; only the never-ends case below needs a tight bound.
        const result = wait('1 1 0', { WAIT_TIMEOUT_SECONDS: '30' });

        expect(result.status).toBe(0);
        expect(result.calls).toHaveLength(3);
    });

    it("asks only about this workflow's PR-triggered, in-progress runs", () => {
        const [call] = wait('0').calls;

        expect(call).toContain('--workflow sandbox-identity-deploy.yml');
        expect(call).toContain('--event pull_request');
        expect(call).toContain('--status in_progress');
    });

    it('⛔ fails, rather than deploys, when a PR run NEVER ends within the bound', () => {
        const result = wait('1');

        expect(result.status).not.toBe(0);
        expect(result.out).toContain('::error::');
    });

    it('⛔ unknown is not idle: a gh that fails is an error', () => {
        const result = wait('0', { STUB_GH_FAILS: '1' });

        expect(result.status).not.toBe(0);
        expect(result.out).toContain('::error::');
    });
});

describe('sandbox-identity-deploy.yml wiring for the called path (triage [11])', () => {
    const raw = readFileSync(path.join(repoRoot, '.github/workflows/sandbox-identity-deploy.yml'), 'utf8');
    const parsed = parse(raw) as {
        readonly concurrency: { readonly group: string; readonly 'cancel-in-progress': boolean };
        readonly jobs: {
            readonly deploy: {
                readonly permissions: Readonly<Record<string, string>>;
                readonly steps: readonly Step[];
            };
        };
    };

    it('⛔ the PR path keeps the shared group; every other event gets its OWN per-run group', () => {
        const { group } = parsed.concurrency;

        expect(group).toContain("github.event_name == 'pull_request'");
        expect(group).toContain("'sandbox-identity-deploy'");
        expect(group).toContain('github.run_id');
        expect(parsed.concurrency['cancel-in-progress']).toBe(false);
    });

    it('⛔ waits for the PR run BEFORE it signs in or deploys anything — on non-PR events only', () => {
        const { steps } = parsed.jobs.deploy;
        const wait = steps.findIndex((step) => (step.run ?? '').includes('waitForPrIdentityDeploy.sh'));
        const signIn = steps.findIndex((step) => step.name === 'Sign in to AWS');

        expect(wait).toBeGreaterThanOrEqual(0);
        expect(wait).toBeLessThan(signIn);
        expect((steps[wait] as { readonly if?: string }).if).toContain("github.event_name != 'pull_request'");
    });

    it('can list workflow runs (`actions: read`)', () => {
        expect(parsed.jobs.deploy.permissions['actions']).toBe('read');
    });

    it('Sandbox Up grants that to the identity job that calls this workflow (a callee can only downgrade)', () => {
        const up = parse(readFileSync(path.join(repoRoot, '.github/workflows/sandboxUp.yml'), 'utf8')) as {
            readonly jobs: { readonly identity: { readonly permissions: Readonly<Record<string, string>> } };
        };

        expect(up.jobs.identity.permissions['actions']).toBe('read');
    });
});
