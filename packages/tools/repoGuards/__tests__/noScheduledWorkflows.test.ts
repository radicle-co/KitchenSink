// @vitest-environment node
/**
 * Repo-wide guard: NO workflow has a `schedule:` trigger, except the two the owner kept.
 *
 * ## The ruling (owner, 2026-10-12)
 *
 * "no automatic or scheduled tasks or jobs except for the single one to check if the sandbox is running at
 * midnight and bringing every single sandbox down." That one is the AWS-side nightly stop in
 * `SandboxSchedulerStack`, not a workflow. And, for the two crons that stay: "Keep the `cachePrune.yml` and
 * `codeql.yml` crons. Remove every other sandbox or test cron."
 * (docs/plans/2026-10-12-001-fix-sandbox-manual-start-plan.md, D7.)
 *
 * A cron that fires the sandbox's reap, reconcile, router drift-heal or deploy sweep from the default branch is
 * how the tier got started and re-started with nobody pressing a button. Those workflows keep `workflow_dispatch`
 * and are run by hand.
 *
 * ## What the guard reads
 *
 * The parsed `on:` of every workflow file in the tree, in all three YAML spellings (a map, a list, a bare string),
 * never a text search: a commented-out `schedule:` must not trip it and a `schedule` reached through an unusual
 * spelling must not slip past it. The allowlist is checked from the other side too — an entry that no longer
 * schedules anything is stale, so the exemption cannot outlive the cron it excused.
 *
 * ## Mutation evidence
 *
 *   1. A `schedule:` restored to `sandboxReap.yml` (or any other file) → `no workflow outside the allowlist
 *      has a schedule` fails and names the file.
 *   2. The allowlist widened to a third file → `the allowlist is exactly the two crons the owner kept` fails.
 *   3. `on:` written as `[schedule]` or `schedule` → the fixture table fails, not just the live tree.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));

/** The only workflows allowed a `schedule:`, each with the owner's reason. */
const SCHEDULED_BY_RULING: ReadonlyMap<string, string> = new Map([
    ['cachePrune.yml', 'owner ruling 2026-10-12: keep the cache-prune cron'],
    ['codeql.yml', 'owner ruling 2026-10-12: keep the weekly CodeQL cron'],
]);

/**
 * Whether a parsed workflow's `on:` includes a `schedule` trigger. Pure.
 *
 * @param doc - A parsed workflow document.
 * @returns `true` when `schedule` is one of its triggers, in any of the three `on:` spellings.
 */
function hasSchedule(doc: unknown): boolean {
    const on = (doc as { readonly on?: unknown } | null | undefined)?.on;

    if (typeof on === 'string') {
        return on === 'schedule';
    }

    if (Array.isArray(on)) {
        return on.includes('schedule');
    }

    if (typeof on === 'object' && on !== null) {
        return 'schedule' in on;
    }

    return false;
}

/** Every workflow file in the tree with its parsed document. */
const workflows = (): readonly { readonly file: string; readonly doc: unknown }[] =>
    readdirSync(WORKFLOW_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort()
        .map((file) => ({ file, doc: parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as unknown }));

describe('hasSchedule — the detector itself', () => {
    it.each([
        ['a map with a schedule', { on: { push: null, schedule: [{ cron: '0 0 * * *' }] } }, true],
        ['a map with an EMPTY schedule', { on: { schedule: null } }, true],
        ['a list containing schedule', { on: ['push', 'schedule'] }, true],
        ['a bare string schedule', { on: 'schedule' }, true],
        ['a map without one', { on: { push: null, workflow_dispatch: null } }, false],
        ['a list without one', { on: ['push', 'workflow_dispatch'] }, false],
        ['a bare string for another trigger', { on: 'workflow_dispatch' }, false],
        ['a document with no `on`', {}, false],
        ['an empty document', null, false],
    ] as const)('%s', (_label, doc, expected) => {
        expect(hasSchedule(doc)).toBe(expected);
    });
});

describe('no workflow is scheduled, except the two the owner kept (2026-10-12)', () => {
    it('no workflow outside the allowlist has a schedule', () => {
        const offenders = workflows()
            .filter(({ file, doc }) => hasSchedule(doc) && !SCHEDULED_BY_RULING.has(file))
            .map(({ file }) => file);

        expect(
            offenders,
            'a `schedule:` fires from the default branch with nobody pressing a button. Owner ruling 2026-10-12: ' +
                '"no automatic or scheduled tasks or jobs except for the single one to check if the sandbox is ' +
                'running at midnight and bringing every single sandbox down." Delete the `schedule:` and keep ' +
                '`workflow_dispatch`; do not add the file to the allowlist.',
        ).toEqual([]);
    });

    it('the allowlist is exactly the two crons the owner kept', () => {
        expect([...SCHEDULED_BY_RULING.keys()].sort()).toEqual(['cachePrune.yml', 'codeql.yml']);
    });

    // Non-vacuity from the other side: an exemption for a cron that no longer exists is fiction.
    it.each([...SCHEDULED_BY_RULING.keys()])('%s still has the schedule its exemption excuses', (file) => {
        const found = workflows().find((workflow) => workflow.file === file);

        expect(found, `${file} is gone from the tree — drop its allowlist entry`).toBeDefined();
        expect(hasSchedule(found?.doc), `${file} no longer schedules anything — drop its allowlist entry`).toBe(true);
    });

    it('the guard sees a real workflow tree, not an empty directory', () => {
        expect(workflows().length).toBeGreaterThan(10);
    });
});
