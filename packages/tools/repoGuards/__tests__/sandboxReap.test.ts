// @vitest-environment node
/**
 * Repo-wide guard: the scheduled reaper's discovery and decision (`.github/scripts/sandboxReap.sh`).
 *
 * ## The invariant this protects
 *
 * `sandboxReap.yml` presses `Sandbox Down` for every preview that has outlived its day. It decides WHO from
 * two systems that already hold the facts — a `kitchensink-*-pr-{N}` stack EXISTING in CloudFormation, that
 * stack's `LastUpdatedTime`, and whether GitHub says the pull request is still open — and nothing else. Three
 * questions are answered in this file, each by a pure function executed as real `bash`:
 *
 *   1. **Which previews exist?** Only a `pr-{N}` token parsed out of a `kitchensink-<service>-pr-{N}` stack
 *      name is a candidate. A tier stack — `kitchensink-data-prod`, `kitchensink-identity-service-sandbox` —
 *      must never become one, because the button this reaper presses DELETES.
 *   2. **When was it last deployed?** The most recent instant across ALL of a preview's stacks. Taking the
 *      oldest would reap a preview deployed an hour ago because its schema stack is days old.
 *   3. **Reap or keep?** A CLOSED or MERGED pull request is reaped regardless of the clock; an open one — or
 *      one GitHub could not describe — is reaped only once its deadline has passed.
 *
 * Plus the look-ahead: a sweep claims what falls due within the next 75 minutes, so the 23:17 ET sweep lands
 * while the shared RDS is still up rather than 17 minutes into the nightly shutdown.
 *
 * ## Why the predicates are executed as real `bash`
 *
 * Same reason as `prScope.test.ts` and `deployGate.test.ts`: a TypeScript re-implementation would be a second
 * copy of the decision that could drift from the one the workflow runs. The impure evaluation — AWS, `gh`,
 * the dispatch, the tallies — is covered with stubbed commands by `tests/sandboxReap.integration.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/sandboxReap.sh');
const LIFETIME = path.join(repoRoot, '.github/scripts/sandboxLifetime.sh');

interface Run {
    readonly out: string;
    readonly err: string;
    readonly status: number;
}

/**
 * Run one subcommand of the real script.
 *
 * @param args - Subcommand and its arguments.
 * @param input - Text fed on stdin, for the filter subcommands.
 * @returns stdout, stderr and the exit status.
 * @sideEffect Spawns `bash`.
 */
const run = (args: readonly string[], input = ''): Run => {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', input });

    if (result.error) {
        throw result.error;
    }

    return { out: result.stdout ?? '', err: result.stderr ?? '', status: result.status ?? -1 };
};

/** The non-empty lines of a command's stdout. */
const lines = (out: string): readonly string[] => out.split('\n').filter((line) => line !== '');

/** Seconds since the epoch for a UTC instant, so expectations never reuse the script's own maths. */
const utc = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** One reap-or-keep verdict, as the script prints it. */
interface Verdict {
    readonly action: string;
    readonly reason: string;
    readonly status: number;
}

const decide = (...args: readonly string[]): Verdict => {
    const { out, status } = run(['decide', ...args]);

    return {
        action: /^action=(.*)$/mu.exec(out)?.[1] ?? '',
        reason: /^reason=(.*)$/mu.exec(out)?.[1] ?? '',
        status,
    };
};

/** Every persistent stack a sweep sees and must never turn into a candidate. */
const TIER_STACKS = [
    'kitchensink-identity-service-sandbox',
    'kitchensink-identity-service-prod',
    'kitchensink-identity-webhooks-sandbox',
    'kitchensink-identity-webhooks-prod',
    'kitchensink-data-sandbox',
    'kitchensink-data-prod',
    'kitchensink-network-sandbox',
    'kitchensink-network-prod',
    'kitchensink-alb-sandbox',
    'kitchensink-alb-prod',
    'kitchensink-domain-sandbox',
    'kitchensink-global-sandbox',
    'kitchensink-service-logs-prod',
    'kitchensink-cost-guardrails',
];

describe('sandboxReap.sh — the file exists where the workflow invokes it from', () => {
    it('is present at .github/scripts/sandboxReap.sh', () => {
        expect(existsSync(SCRIPT), `expected the reaper at ${SCRIPT}`).toBe(true);
    });

    it('can be SOURCED for its functions without running a sweep', () => {
        // The CLI dispatch must only fire when executed. A script that ran its evaluation on `source` would
        // call AWS from any test or caller that only wanted a predicate — and would print more than the verdict.
        const result = spawnSync('bash', ['-c', `source "${SCRIPT}" && sandbox_reap_decide CLOSED false`], {
            encoding: 'utf8',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('action=reap\nreason=closed\n');
    });

    it('never runs the teardown itself — it presses the button', () => {
        // `sandboxReclamationReachability.test.ts` pins the jobs that may invoke the teardown by reading workflow
        // YAML, so a teardown call added to this script would be outside its reach. The reaper's only route to a
        // deletion is dispatching `Sandbox Down` with digits.
        expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/teardownSandboxPr\.sh/u);
    });

    it('refuses an unknown subcommand rather than guessing', () => {
        expect(run(['reap-everything']).status).toBe(2);
    });
});

describe('sandbox_reap_tokens — only a pr-{N} preview is ever a candidate', () => {
    it('extracts the token from a per-PR stack name', () => {
        const { out, status } = run(['tokens'], 'kitchensink-recipe-service-pr-91\n');

        expect(status).toBe(0);
        expect(lines(out)).toEqual(['pr-91']);
    });

    it('reads the tab-separated, multi-page shape `list-stacks --output text` prints', () => {
        const input =
            'kitchensink-recipe-service-pr-91\tkitchensink-food-service-pr-91\tkitchensink-recipe-schema-pr-91\n' +
            'kitchensink-food-service-pr-7\tkitchensink-ingredient-parser-pr-91\n';

        expect(lines(run(['tokens'], input).out)).toEqual(['pr-7', 'pr-91']);
    });

    it('counts a preview ONCE however many stacks it owns', () => {
        const input = ['recipe-service', 'recipe-workers', 'food-service', 'recipe-schema', 'food-schema']
            .map((service) => `kitchensink-${service}-pr-12`)
            .join('\t');

        expect(lines(run(['tokens'], input).out)).toEqual(['pr-12']);
    });

    it('keeps pr-1 and pr-15 distinct', () => {
        expect(lines(run(['tokens'], 'kitchensink-food-service-pr-1\tkitchensink-food-service-pr-15').out)).toEqual([
            'pr-1',
            'pr-15',
        ]);
    });

    it.each(TIER_STACKS)('never turns the tier stack %s into a candidate', (stack) => {
        const { out, status } = run(['tokens'], `${stack}\tkitchensink-recipe-service-pr-3\n`);

        expect(status).toBe(0);
        expect(lines(out)).toEqual(['pr-3']);
    });

    it.each([
        ['a name whose token is not the final segment', 'kitchensink-food-service-pr-91-old'],
        ['a name with no service segment', 'kitchensink-pr-91'],
        ['another application in the same account', 'armoury-api-pr-91'],
        ['an upper-case token', 'kitchensink-food-service-PR-91'],
        ['a token with no digits', 'kitchensink-food-service-pr-'],
        ['a prefix match inside a longer name', 'x-kitchensink-food-service-pr-91'],
    ])('ignores %s (%s)', (_label, stack) => {
        const { out, status } = run(['tokens'], `${stack}\n`);

        expect(status).toBe(0);
        expect(lines(out)).toEqual([]);
    });

    it('answers nothing, successfully, when no stacks exist', () => {
        const { out, status } = run(['tokens'], '');

        expect(status).toBe(0);
        expect(out).toBe('');
    });
});

describe('sandbox_reap_latest_deploy — the most recent deploy across a preview’s stacks', () => {
    it('takes the newest instant, not the oldest', () => {
        // The schema stack is days older than the service: a preview deployed an hour ago is still live.
        const input =
            '2026-09-10T08:00:00.000000+00:00\t2026-09-01T08:00:00.000000+00:00\n' +
            '2026-09-12T21:30:00.000000+00:00\t2026-09-01T09:00:00.000000+00:00\n';
        const { out, status } = run(['latest-deploy'], input);

        expect(status).toBe(0);
        expect(lines(out)).toEqual(['2026-09-12T21:30:00.000000+00:00']);
    });

    it('falls back to CreationTime for a stack that was never updated', () => {
        // CloudFormation reports `LastUpdatedTime` as `None` until a stack's first update.
        const { out, status } = run(['latest-deploy'], 'None\t2026-09-11T10:00:00.000000+00:00\n');

        expect(status).toBe(0);
        expect(lines(out)).toEqual(['2026-09-11T10:00:00.000000+00:00']);
    });

    it('prefers a creation time that is newer than another stack’s update', () => {
        const input =
            '2026-09-05T10:00:00.000000+00:00\t2026-09-01T10:00:00.000000+00:00\nNone\t2026-09-09T10:00:00Z\n';

        expect(lines(run(['latest-deploy'], input).out)).toEqual(['2026-09-09T10:00:00Z']);
    });

    it('FAILS rather than answering when every instant is None', () => {
        // An answer of "" here would be a deploy time of nothing, and the evaluation must skip the preview
        // rather than guess at a deadline for it.
        const { out, status } = run(['latest-deploy'], 'None\tNone\n');

        expect(status).not.toBe(0);
        expect(out).toBe('');
    });

    it('FAILS on empty input, which is what a describe that matched no stack prints', () => {
        expect(run(['latest-deploy'], '').status).not.toBe(0);
    });
});

describe('sandbox_reap_decide — reap or keep', () => {
    it.each(['CLOSED', 'MERGED'])('reaps a %s pull request even when its deadline is far away', (state) => {
        // Its on-close cleanup either already ran or failed, and this is the retry.
        expect(decide(state, 'false')).toEqual({ action: 'reap', reason: 'closed', status: 0 });
    });

    it.each(['CLOSED', 'MERGED'])('names the closure, not the clock, for a %s PR that is also expired', (state) => {
        expect(decide(state, 'true')).toEqual({ action: 'reap', reason: 'closed', status: 0 });
    });

    it('reaps an OPEN pull request whose deadline has come', () => {
        expect(decide('OPEN', 'true')).toEqual({ action: 'reap', reason: 'expired', status: 0 });
    });

    it('keeps an OPEN pull request whose deadline has not come', () => {
        expect(decide('OPEN', 'false')).toEqual({ action: 'keep', reason: 'live', status: 0 });
    });

    it('does NOT treat a PR GitHub could not describe as closed', () => {
        // `UNKNOWN` is what the evaluation substitutes when `gh pr view` fails. A rate-limited `gh` must not
        // be what reaps a preview somebody is working in.
        expect(decide('UNKNOWN', 'false')).toEqual({ action: 'keep', reason: 'live', status: 0 });
        expect(decide('UNKNOWN', 'true')).toEqual({ action: 'reap', reason: 'expired', status: 0 });
    });

    it('matches GitHub’s state enum exactly, so a near-miss is not a closure', () => {
        expect(decide('closed', 'false')).toEqual({ action: 'keep', reason: 'live', status: 0 });
        expect(decide('', 'false')).toEqual({ action: 'keep', reason: 'live', status: 0 });
    });

    it.each([['yes'], [''], ['TRUE']])('refuses an expiry verdict of %j without printing one', (expired) => {
        const { action, status } = decide('OPEN', expired);

        expect(status).toBe(2);
        expect(action).toBe('');
    });

    it('refuses a call that is missing its expiry verdict', () => {
        const { action, status } = decide('CLOSED');

        expect(status).toBe(2);
        expect(action).toBe('');
    });
});

describe('sandbox_reap_due_by — the look-ahead', () => {
    const dueBy = (now: string): Run => run(['due-by', now]);

    it('looks 75 minutes ahead of now', () => {
        const { out, status } = dueBy('1000000');

        expect(status).toBe(0);
        expect(lines(out)).toEqual([String(1_000_000 + 75 * 60)]);
    });

    it.each([[''], ['soon'], ['-5'], ['12.5']])('refuses a now of %j', (now) => {
        const { out, status } = dueBy(now);

        expect(status).toBe(2);
        expect(out).toBe('');
    });

    /**
     * Whether a preview deployed at <deployedIso> is due at a sweep running at <sweepIso>, composed from the
     * real clock (`sandboxLifetime.sh`) and the real look-ahead — the exact chain the evaluation runs.
     */
    const dueAtSweep = (deployedIso: string, sweepIso: string): boolean => {
        const lifetime = (...args: readonly string[]): string =>
            spawnSync('bash', [LIFETIME, ...args], { encoding: 'utf8' }).stdout ?? '';
        const deadline = /^expiresAt=(\d+)$/mu.exec(lifetime('expires-at', String(utc(deployedIso))))?.[1] ?? '';
        const due = lines(dueBy(String(utc(sweepIso))).out)[0] ?? '';

        return /^expired=true$/mu.test(lifetime('is-expired', deadline, due));
    };

    it('claims a preview due at midnight ET from the 23:17 ET sweep, while the shared tier is still up', () => {
        // Deployed 12 Sep 10:00 EDT; deadline 13 Sep 00:00 EDT = 04:00Z. 23:17 EDT is 03:17Z.
        expect(dueAtSweep('2026-09-12T14:00:00Z', '2026-09-13T03:17:00Z')).toBe(true);
    });

    it('does not claim it an hour earlier, from the 22:17 ET sweep', () => {
        expect(dueAtSweep('2026-09-12T14:00:00Z', '2026-09-13T02:17:00Z')).toBe(false);
    });
});

describe('sandboxReap.yml runs this script, in one step', () => {
    interface Step {
        readonly name?: string;
        readonly run?: string;
    }

    const steps = (): readonly Step[] => {
        const doc = parse(readFileSync(path.join(repoRoot, '.github/workflows/sandboxReap.yml'), 'utf8')) as {
            jobs?: Record<string, { steps?: readonly Step[] }>;
        };

        return doc.jobs?.['reap']?.steps ?? [];
    };

    it('evaluates the sweep through the script, handing it this run’s own ref', () => {
        // The ref is what `gh workflow run` dispatches `Sandbox Down` on; without it the dispatch targets the
        // default branch, where a branch-only workflow does not exist.
        const invoking = steps().filter((step) => (step.run ?? '').includes('sandboxReap.sh'));

        expect(invoking).toHaveLength(1);
        expect(invoking[0]?.run ?? '').toMatch(/bash \.github\/scripts\/sandboxReap\.sh evaluate "\$GITHUB_REF_NAME"/u);
    });

    it('keeps discovery, decision and dispatch out of the workflow text', () => {
        // One implementation of the sweep. A second copy left inline would be the drift this extraction ends.
        const inline = steps()
            .map((step) => step.run ?? '')
            .join('\n');

        expect(inline).not.toMatch(/list-stacks|describe-stacks|gh pr view|gh workflow run/u);
    });
});
