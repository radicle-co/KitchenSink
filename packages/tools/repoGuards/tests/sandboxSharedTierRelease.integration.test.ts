// @vitest-environment node
/**
 * Integration: `sandboxSharedTier.sh release-if-idle` — Sandbox Down's last step for the LAST preview (ADR-0060 D9),
 * and the manual reconciler's.
 *
 * It deletes the shared identity service and ALB, so the two questions it asks before deleting are the whole of its
 * safety, and both are about state no static reader sees:
 *
 * 1. Is any preview LEFT? Every `kitchensink-<app>-pr-<N>` stack imports the ALB's listener. A wrong "none" takes
 *    sign-in from a preview that is still up and wedges the ALB on an export in use.
 * 2. Is anything STANDING ONE UP right now? A Sandbox Up for another PR builds the shared tier before its own stacks
 *    exist, so "no preview stack" is also what the world looks like half-way through a start.
 *
 * An unanswerable question is answered "keep": a lookup that fails must never read as "nothing is there".
 *
 * Executed for real against stubbed `aws` and `gh` on `PATH`; the stubs are the boundary.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from '../__tests__/serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/sandboxSharedTier.sh');
const workspaces: string[] = [];

afterAll(() => {
    for (const dir of workspaces) {
        rmSync(dir, { recursive: true, force: true });
    }
});

interface World {
    /** Every stack `list-stacks` reports. */
    readonly stacks: readonly string[];
    /** Workflows with a queued or running run. */
    readonly running?: readonly string[];
    /** `list-stacks` fails. */
    readonly listFails?: boolean;
    /** `gh run list` fails. */
    readonly ghFails?: boolean;
    /** Stacks CloudFormation reports as DELETE_IN_PROGRESS. */
    readonly deleting?: readonly string[];
    /** `describe-stacks` fails with something that is not "does not exist" (throttling, expired credentials). */
    readonly describeFails?: boolean;
    /** When set, `gh run list` reports a run only for this `--status`; unset, for every status. */
    readonly runningState?: string;
    /** A Sandbox Up appears (queued) once this many stacks have been deleted. */
    readonly upAppearsAfterDeletes?: number;
}

type Verb = 'release-if-idle' | 'release-in-progress';

function release(
    world: World,
    verb: Verb = 'release-if-idle',
): {
    readonly status: number | null;
    readonly deleted: readonly string[];
    readonly out: string;
} {
    const workspace = mkdtempSync(path.join(tmpdir(), 'shared-tier-'));
    workspaces.push(workspace);
    const deletedLog = path.join(workspace, 'deleted');

    writeFileSync(
        path.join(workspace, 'aws'),
        `#!/usr/bin/env bash
case "$1 $2" in
    'cloudformation list-stacks')
        [ -n "\${STUB_LIST_FAILS:-}" ] && exit 255
        printf '%s\\n' "\${STUB_STACKS:-}" | tr ' ' '\\t'
        ;;
    'cloudformation describe-stacks')
        shift 2
        while [ "$#" -gt 0 ]; do [ "$1" = --stack-name ] && name="$2"; shift; done
        [ -n "\${STUB_DESCRIBE_FAILS:-}" ] && { echo 'An error occurred (Throttling) when calling the DescribeStacks operation: Rate exceeded' >&2; exit 254; }
        case " \${STUB_DELETING:-} " in *" $name "*) echo DELETE_IN_PROGRESS; exit 0 ;; esac
        case " \${STUB_STACKS:-} " in *" $name "*) echo UPDATE_COMPLETE ;; *) echo "An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id $name does not exist" >&2; exit 254 ;; esac
        ;;
    'cloudformation delete-stack')
        shift 2
        while [ "$#" -gt 0 ]; do [ "$1" = --stack-name ] && printf '%s\\n' "$2" >>"${deletedLog}"; shift; done
        ;;
    'cloudformation wait') exit 0 ;;
    *) echo "unexpected aws $*" >&2; exit 99 ;;
esac
`,
    );
    writeFileSync(
        path.join(workspace, 'gh'),
        `#!/usr/bin/env bash
[ -n "\${STUB_GH_FAILS:-}" ] && exit 1
while [ "$#" -gt 0 ]; do [ "$1" = --workflow ] && wf="$2"; [ "$1" = --status ] && st="$2"; shift; done
if [ -n "\${STUB_RUNNING_STATE:-}" ] && [ "$st" != "$STUB_RUNNING_STATE" ]; then echo 0; exit 0; fi
if [ -n "\${STUB_UP_AFTER_DELETES:-}" ] && [ "$wf" = sandboxUp.yml ] && [ -f "${deletedLog}" ] &&
    [ "$(wc -l <"${deletedLog}")" -ge "$STUB_UP_AFTER_DELETES" ]; then echo 1; exit 0; fi
case " \${STUB_RUNNING:-} " in *" $wf "*) echo 1 ;; *) echo 0 ;; esac
`,
    );
    chmodSync(path.join(workspace, 'aws'), 0o755);
    chmodSync(path.join(workspace, 'gh'), 0o755);

    const result = spawnSync('bash', [SCRIPT, verb, 'us-east-1'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
            PATH: `${workspace}:${process.env['PATH'] ?? ''}`,
            HOME: workspace,
            STUB_STACKS: world.stacks.join(' '),
            STUB_RUNNING: (world.running ?? []).join(' '),
            ...(world.listFails ? { STUB_LIST_FAILS: '1' } : {}),
            ...(world.ghFails ? { STUB_GH_FAILS: '1' } : {}),
            ...(world.describeFails ? { STUB_DESCRIBE_FAILS: '1' } : {}),
            ...(world.runningState === undefined ? {} : { STUB_RUNNING_STATE: world.runningState }),
            STUB_DELETING: (world.deleting ?? []).join(' '),
            ...(world.upAppearsAfterDeletes === undefined
                ? {}
                : { STUB_UP_AFTER_DELETES: String(world.upAppearsAfterDeletes) }),
        },
    });

    return {
        status: result.status,
        deleted: existsSync(deletedLog) ? readFileSync(deletedLog, 'utf8').split('\n').filter(Boolean) : [],
        out: `${result.stdout}${result.stderr}`,
    };
}

const SHARED = [
    'kitchensink-network-sandbox',
    'kitchensink-data-sandbox',
    'kitchensink-alb-sandbox',
    'kitchensink-identity-schema-sandbox',
    'kitchensink-identity-service-sandbox',
    'kitchensink-identity-webhooks-sandbox',
];

describe('sandboxSharedTier.sh release-if-idle', () => {
    it('releases the shared tier, importer first, when no preview is left and nothing is starting one', () => {
        const result = release({ stacks: SHARED });

        expect(result.status).toBe(0);
        expect(result.deleted).toEqual([
            'kitchensink-identity-service-sandbox',
            'kitchensink-identity-schema-sandbox',
            'kitchensink-alb-sandbox',
        ]);
    });

    it('⛔ keeps it while ANOTHER preview still owns a stack', () => {
        const result = release({ stacks: [...SHARED, 'kitchensink-recipe-workers-pr-8'] });

        expect(result.status).toBe(0);
        expect(result.deleted).toEqual([]);
        expect(result.out).toContain('pr-8');
    });

    it('⛔ keeps it while a Sandbox Up is queued or running — it builds the tier before its own stacks exist', () => {
        const result = release({ stacks: SHARED, running: ['sandboxUp.yml'] });

        expect(result.status).toBe(0);
        expect(result.deleted).toEqual([]);
    });

    it.each(['ci-pr.yml', 'ci-main.yml', 'sandbox-identity-deploy.yml'])(
        '⛔ keeps it while %s runs — it reaches a preview deploy through reusable workflows it CALLS',
        (workflow) => {
            // A called workflow's runs belong to its caller, so asking GitHub about `sandboxPreview.yml` finds nothing
            // while a push's `ci-pr.yml` → `_ci.yml` → `sandboxPreview.yml` is creating a preview. The busy set must
            // walk from every workflow that can deploy a preview up through its callers, transitively.
            expect(release({ stacks: SHARED, running: [workflow] }).deleted).toEqual([]);
        },
    );

    it.each(['pending', 'waiting', 'requested'])(
        '⛔ keeps it while a Sandbox Up is %s: a run held behind a concurrency group is about to build on the tier',
        (state) => {
            expect(release({ stacks: SHARED, running: ['sandboxUp.yml'], runningState: state }).deleted).toEqual([]);
        },
    );

    it('⛔ keeps it when GitHub cannot say whether anything is running — unknown is BUSY', () => {
        expect(release({ stacks: SHARED, ghFails: true }).deleted).toEqual([]);
    });

    it('⛔ fails, deleting nothing, when the stacks cannot be listed — a failed lookup is not "none left"', () => {
        const result = release({ stacks: SHARED, listFails: true });

        expect(result.status).toBe(1);
        expect(result.deleted).toEqual([]);
    });

    it('never deletes the database, the network or the webhooks — only the allowlist', () => {
        const { deleted } = release({ stacks: SHARED });

        for (const kept of [
            'kitchensink-data-sandbox',
            'kitchensink-network-sandbox',
            'kitchensink-identity-webhooks-sandbox',
        ]) {
            expect(deleted).not.toContain(kept);
        }
    });
});

describe('sandboxSharedTier.sh release-if-idle — re-checks before EACH delete (triage [7])', () => {
    it('⛔ stops, with the ALB kept, when a Sandbox Up appears after the first delete', () => {
        // The idle check ran once and the deletes then took minutes. A press landing in that window found the ALB
        // still there, built on it, and had it deleted underneath. Busy is asked again before EVERY delete-stack.
        const result = release({ stacks: SHARED, upAppearsAfterDeletes: 1 });

        expect(result.deleted).toEqual(['kitchensink-identity-service-sandbox']);
        expect(result.status).toBe(0);
        expect(result.out).toContain('kept');
    });

    it('deletes all three when nothing appears between the deletes', () => {
        expect(release({ stacks: SHARED }).deleted).toHaveLength(3);
    });
});

describe('sandboxSharedTier.sh release-in-progress — what Sandbox Up asks before it starts (triage [7])', () => {
    it('answers 0 (clear) when nothing is being released', () => {
        expect(release({ stacks: SHARED }, 'release-in-progress').status).toBe(0);
    });

    it.each(['kitchensink-identity-service-sandbox', 'kitchensink-identity-schema-sandbox', 'kitchensink-alb-sandbox'])(
        '⛔ answers 3 while %s is DELETE_IN_PROGRESS',
        (stack) => {
            const result = release({ stacks: SHARED, deleting: [stack] }, 'release-in-progress');

            expect(result.status).toBe(3);
            expect(result.out).toContain(stack);
        },
    );

    it.each(['sandboxDown.yml', 'sandboxReconcile.yml'])('⛔ answers 3 while %s is queued or running', (workflow) => {
        expect(release({ stacks: SHARED, running: [workflow] }, 'release-in-progress').status).toBe(3);
    });

    it('⛔ answers 1 (cannot tell), never 0, when GitHub cannot be asked', () => {
        expect(release({ stacks: SHARED, ghFails: true }, 'release-in-progress').status).toBe(1);
    });

    // A lookup that fails says nothing about the stack: it may be the very one mid-delete under a Sandbox Down that was
    // cancelled after `delete-stack`, so no run is listed. Only "does not exist" is an answer (an absent stack is fine).
    it('⛔ answers 1 (cannot tell), never 0, when a stack lookup fails for any reason but "does not exist"', () => {
        expect(release({ stacks: SHARED, describeFails: true }, 'release-in-progress').status).toBe(1);
    });

    it('answers 0 when the stacks are simply absent (nothing to release)', () => {
        expect(release({ stacks: [] }, 'release-in-progress').status).toBe(0);
    });

    it.each(['pending', 'waiting', 'requested'])(
        '⛔ answers 3 for a Sandbox Down that is %s, not yet running',
        (state) => {
            expect(
                release({ stacks: SHARED, running: ['sandboxDown.yml'], runningState: state }, 'release-in-progress')
                    .status,
            ).toBe(3);
        },
    );

    it('deletes nothing, whatever it answers', () => {
        expect(
            release({ stacks: SHARED, deleting: ['kitchensink-alb-sandbox'] }, 'release-in-progress').deleted,
        ).toEqual([]);
    });
});
