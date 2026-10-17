// @vitest-environment node
/**
 * Integration: `.github/scripts/perPrDatabaseDrop.sh` — a per-PR database drop that could not run is OWED, and the
 * debt is paid the next time the sandbox is up (ADR-0060).
 *
 * ## Why this exists
 *
 * The sandbox now starts only by hand, and a PR's teardown runs whenever the PR closes — usually while the sandbox is
 * stopped. The reaper that drops a PR's logical databases is an in-VPC Lambda against that stopped instance, and
 * nothing may start the instance for it (owner ruling 2026-10-12). Skipping the drop is right; FORGETTING it is a leak,
 * because the teardown goes on to delete the PR's stacks and nothing would ever name that PR again.
 *
 * So a skipped drop is RECORDED (`defer`), by the one script that decided to skip it, and `drain` pays every recorded
 * drop when the tier is up. ⛔ Recorded, never inferred: deriving "orphans" from what the instance holds is the
 * "orphaned-looking sweep" ADR-0005 forbids. `drain` only ever drops a PR some teardown already chose to destroy.
 *
 * Executed for real against a stubbed `aws` on `PATH` that keeps the ledger in a directory, so the record, the drop
 * and the clearing are observed as state rather than as a log of calls.
 */
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/perPrDatabaseDrop.sh');
const workspaces: string[] = [];

afterAll(() => {
    for (const dir of workspaces) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** The account the stub answers for. */
interface Account {
    /** Tokens already owed, before the run. */
    readonly owed?: readonly string[];
    /** Every CloudFormation stack that exists. */
    readonly stacks?: readonly string[];
    /** The sandbox database's status (`available` = up). */
    readonly db?: string;
    /** Reaper invokes for these tokens throw inside the function. */
    readonly failFor?: readonly string[];
    /** The SSM write fails. */
    readonly ssmFails?: boolean;
}

/**
 * Run one verb.
 *
 * @returns The exit status, both streams, the ledger afterwards, and every PR the reaper was asked to drop.
 */
function run(
    args: readonly string[],
    account: Account = {},
): {
    readonly status: number | null;
    readonly out: string;
    readonly owedAfter: readonly string[];
    readonly dropped: readonly string[];
} {
    const workspace = mkdtempSync(path.join(tmpdir(), 'per-pr-db-drop-'));
    workspaces.push(workspace);
    const ledger = path.join(workspace, 'ledger');
    mkdirSync(ledger);

    for (const token of account.owed ?? []) {
        writeFileSync(path.join(ledger, token), '2026-10-12T00:00:00Z');
    }

    const droppedLog = path.join(workspace, 'dropped');

    writeFileSync(
        path.join(workspace, 'aws'),
        `#!/usr/bin/env bash
arg_after() { local want="$1"; shift; local prev=''; for a in "$@"; do [ "$prev" = "$want" ] && { echo "$a"; return; }; prev="$a"; done; }
case "$1 $2" in
    'ssm put-parameter')
        [ -n "\${STUB_SSM_FAILS:-}" ] && exit 255
        name=$(arg_after --name "$@"); printf '%s' "$(arg_after --value "$@")" > "${ledger}/\${name##*/}" ;;
    'ssm get-parameters-by-path')
        for f in "${ledger}"/*; do [ -e "$f" ] && printf '%s\\t' "/kitchensink/sandbox/owed-per-pr-database-drops/$(basename "$f")"; done; echo ;;
    'ssm delete-parameter')
        name=$(arg_after --name "$@"); rm -f "${ledger}/\${name##*/}" ;;
    'cloudformation list-stacks') printf '%s\\n' "\${STUB_STACKS:-}" | tr ' ' '\\t' ;;
    'cloudformation describe-stacks') echo 'kitchensink-data-sandbox-reaper' ;;
    'rds describe-db-instances')
        case "$*" in
            *DBInstanceStatus*) echo "\${STUB_DB:-available}" ;;
            *) echo 'kitchensink-data-sandbox-db' ;;
        esac ;;
    'ec2 describe-instances')
        case "$*" in
            *State.Name*) echo running ;;
            *) printf 'i-0nat\\tGlobal-sandbox-NatInstance\\n' ;;
        esac ;;
    'lambda invoke')
        payload=$(arg_after --payload "$@"); out="\${@: -1}"
        pr=$(printf '%s' "$payload" | sed -nE 's/.*"pr":"(pr-[0-9]+)".*/\\1/p')
        case " \${STUB_FAIL_FOR:-} " in
            *" $pr "*) echo '{"errorMessage":"boom"}' > "$out"; echo '{"StatusCode":200,"FunctionError":"Unhandled"}' ;;
            *) printf '%s\\n' "$pr" >> "${droppedLog}"; echo '{"action":"drop"}' > "$out"; echo '{"StatusCode":200}' ;;
        esac ;;
    *) : ;;
esac
exit 0
`,
    );
    chmodSync(path.join(workspace, 'aws'), 0o755);

    const result = spawnSync('bash', [SCRIPT, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
            PATH: `${workspace}:${process.env['PATH'] ?? ''}`,
            HOME: workspace,
            STUB_STACKS: (account.stacks ?? []).join(' '),
            STUB_DB: account.db ?? 'available',
            STUB_FAIL_FOR: (account.failFor ?? []).join(' '),
            ...(account.ssmFails ? { STUB_SSM_FAILS: '1' } : {}),
            // The check's knobs, pinned so no run waits on the real clock (see `teardownPerPrDatabases`).
            SANDBOX_WAKE_TIMEOUT_SECONDS: '2',
            SANDBOX_WAKE_POLL_SECONDS: '1',
            SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS: '0',
        },
    });

    return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        owedAfter: readdirSync(ledger).sort(),
        dropped: existsSync(droppedLog) ? readFileSync(droppedLog, 'utf8').split('\n').filter(Boolean) : [],
    };
}

describe('perPrDatabaseDrop.sh', () => {
    it('defer: records the PR as owing its drop, and drops nothing', () => {
        const result = run(['defer', 'pr-7', 'us-east-1']);

        expect(result.status).toBe(0);
        expect(result.owedAfter).toEqual(['pr-7']);
        expect(result.dropped).toEqual([]);
    });

    it('⛔ defer: a record that cannot be written FAILS — an unrecorded skip is the leak', () => {
        expect(run(['defer', 'pr-7', 'us-east-1'], { ssmFails: true }).status).toBe(1);
    });

    it.each(['sandbox', 'prod', 'pr-', 'pr-7 prod', ''])(
        '⛔ defer refuses %j: only a PR token can owe a drop',
        (token) => {
            const result = run(['defer', token, 'us-east-1']);

            expect(result.status).toBe(2);
            expect(result.owedAfter).toEqual([]);
        },
    );

    it('drain: pays every owed drop through the reaper and clears each one it paid', () => {
        const result = run(['drain', 'us-east-1'], { owed: ['pr-7', 'pr-8'] });

        expect(result.status).toBe(0);
        expect(result.dropped).toEqual(['pr-7', 'pr-8']);
        expect(result.owedAfter).toEqual([]);
    });

    it('⛔ drain: keeps the debt of a PR that owns a stack again — never drops a preview that is being stood up', () => {
        const result = run(['drain', 'us-east-1'], {
            owed: ['pr-7', 'pr-8'],
            stacks: ['kitchensink-recipe-schema-pr-8', 'kitchensink-alb-sandbox'],
        });

        expect(result.dropped).toEqual(['pr-7']);
        expect(result.owedAfter).toEqual(['pr-8']);
    });

    it('⛔ drain: a drop the reaper REJECTED stays owed, and the run fails', () => {
        const result = run(['drain', 'us-east-1'], { owed: ['pr-7', 'pr-8'], failFor: ['pr-7'] });

        expect(result.status).toBe(1);
        expect(result.dropped).toEqual(['pr-8']);
        expect(result.owedAfter).toEqual(['pr-7']);
    });

    it('drain: a DOWN sandbox pays nothing and does not fail — the debt waits for the next Sandbox Up', () => {
        const result = run(['drain', 'us-east-1'], { owed: ['pr-7'], db: 'stopped' });

        expect(result.status).toBe(0);
        expect(result.dropped).toEqual([]);
        expect(result.owedAfter).toEqual(['pr-7']);
    });

    it('drop: invokes the reaper for exactly the one PR', () => {
        const result = run(['drop', 'pr-7', 'us-east-1']);

        expect(result.status).toBe(0);
        expect(result.dropped).toEqual(['pr-7']);
    });
});
