/**
 * Integration suite for section 0b of `.github/scripts/teardown-sandbox-pr.sh` — reclaiming the per-PR
 * GitHub **Environment**.
 *
 * ## The leak it exists for
 *
 * `sandbox-web-preview.yml` creates a GitHub Environment named `sandbox-preview/pr-{N}` for every PR, via the
 * Deployments API, so the PR gets a "View deployment" button aimed at the working preview URL. Nothing had
 * ever deleted one. Measured against the live repo on 2026-08-11: **51** `sandbox-preview/pr-{N}` environments
 * against **8** open PRs — 43 orphans. `transient_environment: true` does not make GitHub reclaim them, and
 * because no `Environment` tag or cost signal is attached, the leak produced no symptom at all. Same class as
 * the `DELETE_FAILED` stacks and the dangling preview CNAMEs, found the same way: by counting.
 *
 * ## Why this tier, and not only the predicate unit test
 *
 * `prScope.test.ts` proves `pr_scope_environment_belongs` answers correctly. It cannot prove the teardown
 * ASKS it. The failure that would actually delete `Production` is not a wrong predicate — it is a delete site
 * that constructs the name itself, or filters with a shell glob, and never calls the predicate at all. So the
 * assertion surface here is the CALL LOG: which environments the script really issued a `DELETE` for.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the teardown script, executed as `bash` in a child process, sourcing the real `pr-scope.sh`.
 * - **Stubbed**: `gh` and `aws`, as executables placed first on `PATH`. `gh` logs every invocation (plus the
 *   `GH_TOKEN` it was handed) and answers the environment list from a fixture; `aws` answers nothing, which
 *   is the same shape as an empty AWS account, so sections 1–4 are no-ops.
 *
 * ## Mutation evidence (each applied to the script, and the named test watched to fail)
 *
 *   1. `pr_scope_environment_belongs` replaced by a `case "$gh_env" in sandbox-preview/$PR*)` glob →
 *      `never claims another PR's environment` fails (`pr-1` deletes `sandbox-preview/pr-15`).
 *   2. The predicate call dropped entirely (delete every listed environment) → `never deletes a persistent
 *      environment` fails, and it fails on `Production` — the mutation whose real-world cost is the prod
 *      approval gate silently disappearing.
 *   3. `${gh_env//\//%2F}` replaced by `$gh_env` → `URL-encodes the `/` in the environment name` fails. This
 *      one is invisible in production: an unencoded path answers `404` exactly like an absent environment
 *      (measured against the live API), so the run stays green while deleting nothing.
 *   4. `--paginate` dropped from the list call → `enumerates every page of environments` fails. Also
 *      invisible in production: the default page size is 30 and there were 55 environments, so the orphans
 *      past the first page would never be reached.
 *   5. Section 0b moved below the stack-delete loop → `runs even when the preview-domain step failed` still
 *      passes, but the ordering rationale is documented in the script; the guard that matters operationally
 *      is that it does not sit behind a `wait stack-delete-complete` that can burn an hour.
 *   6. The unset-token branch changed from a warning to `teardown_failed=1` → `does not fail the teardown
 *      merely because the admin token is unset` fails. That branch is a deliberate severity call: the token
 *      cannot be `github.token` (which structurally cannot delete an environment), and reddening every PR
 *      close over leaked metadata would train people to ignore the job that reclaims billable compute.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/teardown-sandbox-pr.sh', import.meta.url));

const ADMIN_TOKEN = 'ghp_stub_admin_token';
const REPOSITORY = 'radicle-co/KitchenSink';

/**
 * A stub `gh` that logs every call plus the token it was handed, and answers the environment list from a
 * fixture. It distinguishes the LIST from the DELETE by the presence of the literal `DELETE` argument, so it
 * cannot accidentally treat a mis-built delete path as a list.
 */
const GH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_CALL_LOG"
printf 'token=%s\\n' "\${GH_TOKEN:-<none>}" >> "$GH_CALL_LOG"
for arg in "$@"; do
    if [ "$arg" = 'DELETE' ]; then
        if [ -f "$GH_STUB_DIR/delete-fails" ]; then
            echo 'gh: HTTP 403 (Resource not accessible by integration)' >&2
            exit 1
        fi
        exit 0
    fi
done
if [ -f "$GH_STUB_DIR/list-fails" ]; then
    echo 'gh: HTTP 403 (Resource not accessible by integration)' >&2
    exit 1
fi
cat "$GH_STUB_DIR/environments" 2>/dev/null || true
exit 0
`;

/** A stub `aws` that answers nothing, so every AWS-driven section of the teardown is an empty no-op. */
const AWS_STUB = `#!/usr/bin/env bash
exit 0
`;

interface RunResult {
    readonly status: number;
    /**
     * stdout and stderr combined. The script writes its workflow annotations to stdout but its hard
     * `pr-{N}` refusal to stderr, and a test that read only one of the two would miss whichever it chose.
     */
    readonly output: string;
    /** Every `gh` invocation, in order, as one argv string per line, each followed by a `token=` line. */
    readonly calls: readonly string[];
}

interface RunOptions {
    /** The environment names the stub `gh` reports, one per line. */
    readonly environments?: readonly string[];
    /** Omit the admin token, i.e. the state of the repo until the owner provisions the secret. */
    readonly withoutToken?: boolean;
    /** Omit `GITHUB_REPOSITORY`, i.e. running outside Actions. */
    readonly withoutRepository?: boolean;
    /** Make the stub `gh` fail the list call. */
    readonly listFails?: boolean;
    /** Make the stub `gh` fail the delete call. */
    readonly deleteFails?: boolean;
}

let workdir: string;
let binDir: string;
let logFile: string;

/** The full inventory the live repo showed, reduced to the shapes that matter: the target, its neighbours, and every persistent environment. */
const LIVE_SHAPED_INVENTORY = [
    'Preview',
    'Production',
    'Sandbox',
    'copilot',
    'sandbox-preview/pr-1',
    'sandbox-preview/pr-15',
    'sandbox-preview/pr-100',
    'sandbox-preview/pr-73',
];

/**
 * Run the real teardown script with stub `gh`/`aws` first on PATH.
 *
 * @param token - The `pr-{N}` token to tear down.
 * @param options - Fixture and environment overrides.
 * @returns The exit status, stdout, and the ordered `gh` call log.
 * @sideEffect Spawns `bash` and writes fixtures into a temp dir.
 */
function run(token: string, options: RunOptions = {}): RunResult {
    writeFileSync(join(workdir, 'environments'), `${(options.environments ?? []).join('\n')}\n`);

    if (options.listFails === true) {
        writeFileSync(join(workdir, 'list-fails'), '');
    }

    if (options.deleteFails === true) {
        writeFileSync(join(workdir, 'delete-fails'), '');
    }

    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            env[key] = value;
        }
    }

    env['PATH'] = `${binDir}:${process.env['PATH'] ?? ''}`;
    env['GH_CALL_LOG'] = logFile;
    env['GH_STUB_DIR'] = workdir;
    env['GITHUB_REPOSITORY'] = REPOSITORY;
    env['GH_ENVIRONMENT_ADMIN_TOKEN'] = ADMIN_TOKEN;

    // The preview-domain step (section 0) is left UNCONFIGURED on purpose: it then reports its own error
    // without shelling out to `npx tsx`, which keeps this suite hermetic — and proves section 0b is not
    // skipped by a predecessor's failure.
    for (const key of ['PREVIEW_ZONE', 'PREVIEW_HOSTED_ZONE_ID', 'VERCEL_TOKEN', 'VERCEL_PROJECT_ID']) {
        delete env[key];
    }

    if (options.withoutToken === true) {
        delete env['GH_ENVIRONMENT_ADMIN_TOKEN'];
    }

    if (options.withoutRepository === true) {
        delete env['GITHUB_REPOSITORY'];
    }

    const result = spawnSync('bash', [SCRIPT, token, 'us-east-1'], { encoding: 'utf8', env });

    const calls = existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
              .split('\n')
              .filter((line) => line.length > 0)
        : [];

    return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}`, calls };
}

/** The environment names the script actually issued a DELETE for, decoded back from the API path. */
const deletedEnvironments = (calls: readonly string[]): readonly string[] =>
    calls
        .filter((call) => call.includes('DELETE'))
        .map((call) => call.split(' ').find((part) => part.includes('/environments/')) ?? '')
        .map((path) => decodeURIComponent(path.replace(/^.*\/environments\//u, '')));

beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'teardown-gh-env-'));
    binDir = join(workdir, 'bin');
    mkdirSync(binDir);
    logFile = join(workdir, 'gh-calls.log');

    for (const [name, body] of [
        ['gh', GH_STUB],
        ['aws', AWS_STUB],
    ] as const) {
        const stub = join(binDir, name);
        writeFileSync(stub, body);
        chmodSync(stub, 0o755);
    }
});

describe('teardown-sandbox-pr.sh §0b — reclaiming the per-PR GitHub Environment', () => {
    it("deletes exactly the PR's own sandbox-preview environment", () => {
        const { calls, output } = run('pr-73', { environments: LIVE_SHAPED_INVENTORY });

        expect(deletedEnvironments(calls)).toEqual(['sandbox-preview/pr-73']);
        expect(output).toContain('[gh-env] deleted sandbox-preview/pr-73');
    });

    // ⛔ The delimiter case, at the delete site rather than in the predicate. A prefix/glob match here is the
    // mutation that makes closing PR #1 reclaim #15's and #100's previews.
    it("never claims another PR's environment (pr-1 is not pr-15 or pr-100)", () => {
        const { calls } = run('pr-1', { environments: LIVE_SHAPED_INVENTORY });

        expect(deletedEnvironments(calls)).toEqual(['sandbox-preview/pr-1']);
    });

    // ⛔ THE regression that matters. These four sit in the same list as the per-PR ones, and deleting
    // `Production` would remove the required-reviewer rule and the main-only branch policy that gate prod —
    // failing OPEN, not closed. Asserted for a token whose own environment is absent from the list too, so a
    // "delete everything listed" mutation has nothing legitimate to hide behind.
    it.each(['pr-1', 'pr-73', 'pr-9999'])('never deletes a persistent environment, tearing down %s', (token) => {
        const { calls } = run(token, { environments: ['Production', 'Sandbox', 'Preview', 'copilot'] });

        expect(deletedEnvironments(calls)).toEqual([]);
        expect(calls.some((call) => call.includes('DELETE'))).toBe(false);
    });

    // Invisible-in-production mutation #3: an unencoded `/` yields a 404 that is indistinguishable from an
    // absent environment, so the run stays green having deleted nothing.
    it('URL-encodes the `/` in the environment name as %2F', () => {
        const { calls } = run('pr-73', { environments: ['sandbox-preview/pr-73'] });

        const deleteCall = calls.find((call) => call.includes('DELETE')) ?? '';
        expect(deleteCall).toContain(`repos/${REPOSITORY}/environments/sandbox-preview%2Fpr-73`);
        expect(deleteCall).not.toContain('environments/sandbox-preview/pr-73');
    });

    // Invisible-in-production mutation #4: 55 environments existed against a default page size of 30.
    it('enumerates every page of environments', () => {
        const { calls } = run('pr-73', { environments: ['sandbox-preview/pr-73'] });

        const listCall = calls.find((call) => call.includes('/environments') && !call.includes('DELETE')) ?? '';
        expect(listCall).toContain('--paginate');
        expect(listCall).toContain(`repos/${REPOSITORY}/environments`);
    });

    it('authenticates with the admin token, never with the workflow token', () => {
        const { calls } = run('pr-73', { environments: ['sandbox-preview/pr-73'] });

        const tokens = calls.filter((call) => call.startsWith('token='));
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens.every((line) => line === `token=${ADMIN_TOKEN}`)).toBe(true);
    });

    it('reports a clean no-op when the environment is already reclaimed (idempotent)', () => {
        const { calls, output } = run('pr-73', { environments: ['Production', 'sandbox-preview/pr-15'] });

        expect(deletedEnvironments(calls)).toEqual([]);
        expect(output).toContain("[gh-env] no 'sandbox-preview/pr-73' environment to delete");
    });

    // Section 0 is deliberately left unconfigured by the harness, so it reports an error before this runs.
    // Section 0b must still execute: GitHub skips no steps here (it is one script), but a future refactor
    // that put an early `exit` in section 0 would silently disable reclamation — the exact defect that once
    // leaked nine merged PRs' worth of Fargate tasks.
    it('runs even when the preview-domain step (section 0) failed', () => {
        const { calls, output } = run('pr-73', { environments: ['sandbox-preview/pr-73'] });

        expect(output).toContain('preview-domain teardown is unconfigured');
        expect(deletedEnvironments(calls)).toEqual(['sandbox-preview/pr-73']);
    });
});

describe('teardown-sandbox-pr.sh §0b — failure and unconfigured states', () => {
    it('does not fail the teardown merely because the admin token is unset', () => {
        const { calls, output } = run('pr-73', {
            environments: ['sandbox-preview/pr-73'],
            withoutToken: true,
        });

        // No `gh` call at all: without an admin token the DELETE cannot succeed, so listing is pointless.
        expect(calls).toEqual([]);
        expect(output).toContain('::warning::GH_ENVIRONMENT_ADMIN_TOKEN is unset');
        // It must say what to do about it, not merely that it happened.
        expect(output).toContain('Administration: write');
    });

    it('errors, rather than silently skipping, when the environment list cannot be read', () => {
        const { calls, output } = run('pr-73', { environments: ['sandbox-preview/pr-73'], listFails: true });

        expect(deletedEnvironments(calls)).toEqual([]);
        expect(output).toContain('::error::could not list GitHub Environments');
    });

    it('errors when a listed environment fails to delete, and names it', () => {
        const { output, status } = run('pr-73', {
            environments: ['sandbox-preview/pr-73'],
            deleteFails: true,
        });

        expect(output).toContain("::error::failed to delete the GitHub Environment 'sandbox-preview/pr-73'");
        // A configured mechanism that failed must make the run non-zero — unlike the unset-token case above.
        expect(status).not.toBe(0);
    });

    it('errors when the repository cannot be resolved', () => {
        const { calls, output } = run('pr-73', {
            environments: ['sandbox-preview/pr-73'],
            withoutRepository: true,
        });

        expect(calls).toEqual([]);
        expect(output).toContain('::error::GITHUB_REPOSITORY is unset');
    });

    // The script-wide guard, re-asserted because section 0b is now the FIRST thing that could touch a
    // non-AWS, non-recoverable resource: a malformed token must stop the run before any deletion at all.
    it('refuses a token that is not pr-{N} before issuing any call', () => {
        const { calls, status, output } = run('sandbox', { environments: LIVE_SHAPED_INVENTORY });

        expect(status).toBe(2);
        expect(calls).toEqual([]);
        expect(output).toContain('refusing to tear down a non pr-{N} token');
    });
});
