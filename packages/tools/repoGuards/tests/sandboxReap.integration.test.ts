// @vitest-environment node
/**
 * Integration: `sandboxReap.sh evaluate` — the hourly sweep, end to end, against stubbed AWS and GitHub.
 *
 * ## What this proves that the unit spec cannot
 *
 * `__tests__/sandboxReap.test.ts` proves each decision in isolation. This file proves the evaluation WIRES
 * them: that it discovers from `list-stacks` with the full resting-state list, feeds each preview's newest
 * deploy through `sandboxLifetime.sh` at the look-ahead instant rather than at now, asks `gh` about the pull
 * request, dispatches `Sandbox Down` with DIGITS and this run's ref, and — the property the whole loop is shaped
 * around — keeps every per-preview failure per-preview, so one PR's bad luck never stops the others being
 * reaped while still turning the run red.
 *
 * ## How it runs without touching anything real
 *
 * The REAL script runs in place, with its real siblings (`prScope.sh`, `cfnRestingStates.sh`,
 * `sandboxLifetime.sh`). `aws`, `gh` and `date +%s` are replaced on `PATH` by stubs that answer from files in
 * a temporary directory and log every invocation; every other `date` call is passed through to the real one,
 * so the timezone arithmetic under test is the real arithmetic. No credential is present and no stub can
 * reach a network.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/sandboxReap.sh');

let scratch = '';

afterEach(() => {
    if (scratch !== '') {
        rmSync(scratch, { recursive: true, force: true });
        scratch = '';
    }
});

/** The world one sweep observes. */
interface World {
    /** What `list-stacks` prints; `undefined` makes the call fail. */
    readonly stacks?: string;
    /** Per token, the `LastUpdatedTime<TAB>CreationTime` rows `describe-stacks` prints; `null` makes it fail. */
    readonly times?: Readonly<Record<string, string | null>>;
    /** Per PR number, the state `gh pr view` prints; a number absent here makes the call fail. */
    readonly states?: Readonly<Record<string, string>>;
    /** PR numbers whose dispatch `gh workflow run` refuses. */
    readonly refuseDispatch?: readonly string[];
    /** The sweep's `date +%s`, as a UTC ISO instant. */
    readonly now: string;
    /** The ref handed to `evaluate`; omitted entirely when `null`. */
    readonly ref?: string | null;
}

interface Sweep {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    /** Every `aws` invocation, one argument string per call. */
    readonly aws: readonly string[];
    /** Every `gh` invocation, one argument string per call. */
    readonly gh: readonly string[];
    /** The `gh workflow run` invocations only. */
    readonly dispatches: readonly string[];
}

const readLog = (file: string): readonly string[] =>
    existsSync(file)
        ? readFileSync(file, 'utf8')
              .split('\n')
              .filter((line) => line !== '')
        : [];

/**
 * Run one sweep against a stubbed world.
 *
 * @param world - The answers the stubs give.
 * @returns What the sweep printed, how it exited, and every external call it made.
 * @sideEffect Creates a temporary directory and runs bash in it.
 */
function sweep(world: World): Sweep {
    scratch = mkdtempSync(path.join(tmpdir(), 'sandbox-reap-'));
    const bin = path.join(scratch, 'bin');
    const stub = path.join(scratch, 'world');

    mkdirSync(bin, { recursive: true });
    mkdirSync(stub, { recursive: true });

    if (world.stacks !== undefined) {
        writeFileSync(path.join(stub, 'stacks'), world.stacks);
    }

    for (const [token, rows] of Object.entries(world.times ?? {})) {
        writeFileSync(path.join(stub, rows === null ? `fail-times-${token}` : `times-${token}`), rows ?? '');
    }

    for (const [number, state] of Object.entries(world.states ?? {})) {
        writeFileSync(path.join(stub, `state-${number}`), `${state}\n`);
    }

    for (const number of world.refuseDispatch ?? []) {
        writeFileSync(path.join(stub, `refuse-dispatch-${number}`), '');
    }

    const realDate = (spawnSync('bash', ['-c', 'command -v date'], { encoding: 'utf8' }).stdout ?? '').trim();

    const stubs: Record<string, string> = {
        aws: `printf '%s\\n' "$*" >> "$REAP_WORLD/aws.log"
case "$1 $2" in
    'cloudformation list-stacks')
        [ -e "$REAP_WORLD/stacks" ] || { echo 'An error occurred (Throttling)' >&2; exit 255; }
        cat "$REAP_WORLD/stacks"
        ;;
    'cloudformation describe-stacks')
        query=''
        while [ $# -gt 0 ]; do
            if [ "$1" = '--query' ]; then query="$2"; fi
            shift
        done
        token=$(printf '%s' "$query" | grep -oE 'pr-[0-9]+' | head -1)
        [ -e "$REAP_WORLD/fail-times-$token" ] && { echo 'An error occurred (Throttling)' >&2; exit 255; }
        cat "$REAP_WORLD/times-$token" 2>/dev/null
        ;;
    *) echo "unexpected aws call: $*" >&2; exit 99 ;;
esac
exit 0`,
        gh: `printf '%s\\n' "$*" >> "$REAP_WORLD/gh.log"
case "$1 $2" in
    'pr view')
        [ -e "$REAP_WORLD/state-$3" ] || { echo 'HTTP 403: API rate limit exceeded' >&2; exit 1; }
        cat "$REAP_WORLD/state-$3"
        ;;
    'workflow run')
        number=''
        for argument in "$@"; do
            case "$argument" in pr=*) number="\${argument#pr=}" ;; esac
        done
        [ -e "$REAP_WORLD/refuse-dispatch-$number" ] && { echo 'HTTP 422' >&2; exit 1; }
        ;;
    *) echo "unexpected gh call: $*" >&2; exit 99 ;;
esac
exit 0`,
        // Only the sweep's own clock is pinned; every other `date` is the real one.
        date: `if [ "$#" -eq 1 ] && [ "$1" = '+%s' ]; then echo "$REAP_NOW"; exit 0; fi
exec ${JSON.stringify(realDate)} "$@"`,
    };

    for (const [name, body] of Object.entries(stubs)) {
        writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
        chmodSync(path.join(bin, name), 0o755);
    }

    const ref = world.ref === undefined ? 'chore/code-quality-enforcement-phase-1-2' : world.ref;
    const result = spawnSync('bash', [SCRIPT, 'evaluate', ...(ref === null ? [] : [ref])], {
        cwd: scratch,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
            ...process.env,
            PATH: `${bin}:${process.env['PATH'] ?? ''}`,
            REAP_WORLD: stub,
            REAP_NOW: String(Math.floor(Date.parse(world.now) / 1000)),
            AWS_ACCESS_KEY_ID: '',
            AWS_SECRET_ACCESS_KEY: '',
            AWS_PROFILE: '',
            GH_TOKEN: '',
        },
    });

    const gh = readLog(path.join(stub, 'gh.log'));

    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        aws: readLog(path.join(stub, 'aws.log')),
        gh,
        dispatches: gh.filter((call) => call.startsWith('workflow run')),
    };
}

/** 2026-09-12 14:00 EDT. Anything deployed that day is due at 2026-09-13T04:00Z. */
const NOW = '2026-09-12T18:00:00Z';

/** Deployed earlier TODAY: live until tonight's midnight, and not within the look-ahead. */
const FRESH = '2026-09-12T13:00:00.000000+00:00';

/** Deployed three days ago: its midnight has passed. */
const STALE = '2026-09-09T13:00:00.000000+00:00';

/** The dispatch the sweep issues for PR <n> on the default test ref. */
const dispatchOf = (number: string): string =>
    `workflow run sandboxDown.yml --ref chore/code-quality-enforcement-phase-1-2 -f pr=${number}`;

describe('sandboxReap.sh evaluate — discovery', () => {
    it('asks list-stacks for EVERY resting state, including the FAILED ones a reaper exists to retry', () => {
        const states = (
            spawnSync(
                'bash',
                [
                    '-c',
                    `source "${path.join(repoRoot, '.github/scripts/cfnRestingStates.sh')}"; printf '%s\\n' "\${CFN_RESTING_STATES[@]}"`,
                ],
                { encoding: 'utf8' },
            ).stdout ?? ''
        )
            .split('\n')
            .filter((line) => line !== '');

        const { aws } = sweep({ stacks: '', now: NOW });
        const listing = aws.find((call) => call.startsWith('cloudformation list-stacks')) ?? '';

        expect(states.length).toBeGreaterThan(5);
        expect(states).toContain('UPDATE_ROLLBACK_FAILED');
        expect(listing).toContain(`--stack-status-filter ${states.join(' ')}`);
    });

    it('FAILS the run, having dispatched nothing, when the stacks cannot be listed', () => {
        const run = sweep({ now: NOW });

        expect(run.status).toBe(1);
        expect(run.stderr).toContain('::error::could not list stacks');
        expect(run.gh).toEqual([]);
    });

    it('succeeds having done nothing when no preview exists — tier stacks are not previews', () => {
        const run = sweep({
            stacks: 'kitchensink-data-prod\tkitchensink-identity-service-sandbox\tkitchensink-alb-sandbox\n',
            now: NOW,
        });

        expect(run.status).toBe(0);
        expect(run.stdout).toContain('no per-PR previews exist — nothing to reap.');
        expect(run.aws.filter((call) => call.startsWith('cloudformation describe-stacks'))).toEqual([]);
        expect(run.gh).toEqual([]);
    });

    it('never asks about, or dispatches for, anything but a pr-{N} preview', () => {
        const run = sweep({
            stacks:
                'kitchensink-data-prod\tkitchensink-recipe-service-pr-91\tkitchensink-identity-service-prod\n' +
                'kitchensink-network-sandbox\tkitchensink-food-service-pr-91\n',
            times: { 'pr-91': `${STALE}\t${STALE}\n` },
            states: { '91': 'OPEN' },
            now: NOW,
        });

        const described = run.aws.filter((call) => call.startsWith('cloudformation describe-stacks'));

        expect(described).toHaveLength(1);
        expect(described[0]).toContain('`-pr-91`');
        expect(run.dispatches).toEqual([dispatchOf('91')]);
        expect(run.status).toBe(0);
    });
});

describe('sandboxReap.sh evaluate — the decision, per preview', () => {
    it('reaps a closed PR, reaps an expired open one, keeps a live open one, and reports all three', () => {
        const run = sweep({
            stacks: 'kitchensink-recipe-service-pr-10\tkitchensink-recipe-service-pr-20\tkitchensink-recipe-service-pr-30\n',
            times: {
                'pr-10': `${FRESH}\t${FRESH}\n`,
                'pr-20': `${STALE}\t${STALE}\n`,
                'pr-30': `${FRESH}\t${FRESH}\n`,
            },
            states: { '10': 'MERGED', '20': 'OPEN', '30': 'OPEN' },
            now: NOW,
        });

        expect(run.status).toBe(0);
        expect(run.dispatches).toEqual([dispatchOf('10'), dispatchOf('20')]);
        expect(run.stdout).toContain('pr-10: PR #10 is MERGED — reaping');
        expect(run.stdout).toContain(
            'pr-20: last deployed 2026-09-09T13:00:00.000000+00:00, due at 2026-09-10T04:00:00Z — reaping',
        );
        expect(run.stdout).toContain(
            'pr-30: last deployed 2026-09-12T13:00:00.000000+00:00, live until 2026-09-13T04:00:00Z',
        );
        expect(run.stdout).toContain('dispatched 2 teardown(s), kept 1');
    });

    it('dates a preview by its NEWEST stack, so an old schema stack cannot condemn a fresh deploy', () => {
        const run = sweep({
            stacks: 'kitchensink-recipe-schema-pr-5\tkitchensink-recipe-service-pr-5\n',
            times: { 'pr-5': `${STALE}\t${STALE}\nNone\t${FRESH}\n` },
            states: { '5': 'OPEN' },
            now: NOW,
        });

        expect(run.dispatches).toEqual([]);
        expect(run.stdout).toContain('kept 1');
    });

    it('does not reap a live preview just because GitHub could not describe its PR', () => {
        const run = sweep({
            stacks: 'kitchensink-food-service-pr-44\tkitchensink-food-service-pr-45\n',
            times: { 'pr-44': `${FRESH}\t${FRESH}\n`, 'pr-45': `${STALE}\t${STALE}\n` },
            now: NOW,
        });

        // pr-44 is live and its PR unknown: kept. pr-45 is past its deadline: reaped on the clock alone.
        expect(run.dispatches).toEqual([dispatchOf('45')]);
        expect(run.status).toBe(0);
    });

    it('claims tonight’s previews from the 23:17 ET sweep — the look-ahead, not now, is what is compared', () => {
        const at = (now: string): Sweep =>
            sweep({
                stacks: 'kitchensink-recipe-service-pr-8\n',
                times: { 'pr-8': `${FRESH}\t${FRESH}\n` },
                states: { '8': 'OPEN' },
                now,
            });

        // Due 2026-09-13T04:00Z. 23:17 EDT (03:17Z) + 75 min is past it; 22:17 EDT (02:17Z) + 75 min is not.
        expect(at('2026-09-13T03:17:00Z').dispatches).toEqual([dispatchOf('8')]);
        expect(at('2026-09-13T02:17:00Z').dispatches).toEqual([]);
    });
});

describe('sandboxReap.sh evaluate — one preview’s failure stays that preview’s', () => {
    it('skips a preview whose stacks cannot be read, reaps the rest, and fails the run', () => {
        const run = sweep({
            stacks: 'kitchensink-recipe-service-pr-1\tkitchensink-recipe-service-pr-2\n',
            times: { 'pr-1': null, 'pr-2': `${STALE}\t${STALE}\n` },
            states: { '1': 'CLOSED', '2': 'OPEN' },
            now: NOW,
        });

        expect(run.stdout).toContain('::warning::pr-1: could not read its stacks');
        expect(run.dispatches).toEqual([dispatchOf('2')]);
        expect(run.status).toBe(1);
    });

    it('skips a preview whose every deploy time is None rather than guessing a deadline', () => {
        const run = sweep({
            stacks: 'kitchensink-recipe-service-pr-3\tkitchensink-recipe-service-pr-4\n',
            times: { 'pr-3': 'None\tNone\n', 'pr-4': `${STALE}\t${STALE}\n` },
            states: { '3': 'CLOSED', '4': 'OPEN' },
            now: NOW,
        });

        expect(run.stdout).toContain('::warning::pr-3:');
        expect(run.dispatches).toEqual([dispatchOf('4')]);
        expect(run.status).toBe(1);
    });

    it('skips a preview whose deploy time will not parse', () => {
        const run = sweep({
            stacks: 'kitchensink-recipe-service-pr-6\n',
            times: { 'pr-6': 'yesterday-ish\tNone\n' },
            states: { '6': 'CLOSED' },
            now: NOW,
        });

        expect(run.stdout).toContain("::warning::pr-6: unparseable deploy time 'yesterday-ish' — skipping");
        expect(run.dispatches).toEqual([]);
        expect(run.status).toBe(1);
    });

    it('reports a refused dispatch as still live, carries on, and fails the run', () => {
        const run = sweep({
            stacks: 'kitchensink-recipe-service-pr-11\tkitchensink-recipe-service-pr-12\n',
            times: { 'pr-11': `${STALE}\t${STALE}\n`, 'pr-12': `${STALE}\t${STALE}\n` },
            states: { '11': 'OPEN', '12': 'OPEN' },
            refuseDispatch: ['11'],
            now: NOW,
        });

        expect(run.stderr).toContain('::error::could not dispatch Sandbox Down for #11 — pr-11 is still live');
        expect(run.dispatches).toEqual([dispatchOf('11'), dispatchOf('12')]);
        expect(run.stdout).toContain('dispatched 1 teardown(s), kept 0');
        expect(run.status).toBe(1);
    });
});

describe('sandboxReap.sh evaluate — misuse', () => {
    it.each([[null], ['']])('refuses a ref of %j before calling anything', (ref) => {
        // Without a ref `gh workflow run` targets the default branch, where a branch-only `Sandbox Down` does
        // not exist — so a sweep with no ref could find every expired preview and reclaim none of them.
        const run = sweep({ stacks: 'kitchensink-recipe-service-pr-1\n', now: NOW, ref });

        expect(run.status).toBe(2);
        expect(run.aws).toEqual([]);
        expect(run.gh).toEqual([]);
    });
});
