// @vitest-environment node
/**
 * Repo-wide guard: the check that notices a pull request nobody ever deployed.
 *
 * ## What it protects, and what it deliberately does not
 *
 * ADR-0032 records the owner's ruling that a deployed tier SKIPS when the PR's sandbox is not running, and
 * that a PR which ran no e2e tests is GREEN. That is not touched here and must not be: this suite would be
 * the wrong place to quietly re-litigate it.
 *
 * What it closes is the gap the same ADR names and leaves open — "a PR merged without ever raising a
 * sandbox has had no end-to-end test of any kind — the mitigation is `sandbox-up` plus the manual job, and
 * neither is enforced by a check". A label a human must remember is a single point of failure whose failure
 * mode is SILENCE: every tier skips, every check is green, and the skip is indistinguishable from a pass.
 *
 * So the rule is not "deployed tests must run". It is "a pull request may not run NONE of them by accident".
 *
 * ⛔ The predicate is executed as real `bash`, never re-implemented here — same reason as `deployGate.test.ts`
 * and `prScope.test.ts`: a TypeScript copy is a second decision free to drift from the one CI runs.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/deployed-tier-evidence.sh', import.meta.url));

/** One verdict, as the script prints it. */
interface Verdict {
    readonly verdict: string;
    readonly reason: string;
    readonly status: number;
}

/**
 * Run the pure `verdict` subcommand.
 *
 * @param event - The GitHub event name.
 * @param optOut - Whether the opt-out label is present.
 * @param results - Each deployed tier's job result.
 * @returns The parsed verdict plus the exit status.
 * @sideEffect Spawns `bash`.
 */
function verdict(event: string, optOut: string, ...results: readonly string[]): Verdict {
    const run = spawnSync('bash', [SCRIPT, 'verdict', event, optOut, ...results], { encoding: 'utf8' });
    const read = (key: string): string =>
        (run.stdout ?? '')
            .split('\n')
            .find((line) => line.startsWith(`${key}=`))
            ?.slice(key.length + 1) ?? '';

    return { verdict: read('verdict'), reason: read('reason'), status: run.status ?? -1 };
}

describe('deployed-tier evidence', () => {
    it('⛔ refuses a pull request where every deployed tier skipped', () => {
        // THE CASE THIS EXISTS FOR. Today it is green and says nothing.
        const result = verdict('pull_request', 'false', 'skipped', 'skipped', 'skipped');

        expect(result.verdict).toBe('missing');
        expect(result.reason).toContain('never been exercised against a deployed environment');
    });

    it('accepts a pull request where any tier RAN', () => {
        expect(verdict('pull_request', 'false', 'skipped', 'success', 'skipped').verdict).toBe('ok');
    });

    it('accepts a FAILED tier as evidence — it ran and said something', () => {
        // ⛔ Not a second red for one defect. The tier that failed reports its own failure, in its own job,
        // where the log is. Reporting it again here would aim the operator at the wrong step.
        const result = verdict('pull_request', 'false', 'failure', 'skipped');

        expect(result.verdict).toBe('ok');
        expect(result.reason).toContain('1 failed');
    });

    it('accepts a deliberate opt-out, and says that is what happened', () => {
        const result = verdict('pull_request', 'true', 'skipped', 'skipped');

        expect(result.verdict).toBe('ok');
        expect(result.reason).toContain('deliberate choice');
    });

    it('⛔ gates only a PULL REQUEST — a push, a schedule or a dispatch has no merge decision to protect', () => {
        for (const event of ['push', 'schedule', 'workflow_dispatch']) {
            const result = verdict(event, 'false', 'skipped', 'skipped');

            expect(result.verdict, `${event} must not be gated`).toBe('ok');
            expect(result.reason).toContain('nothing to gate');
        }
    });

    it('counts the tiers it was given, so the reason names a real number', () => {
        expect(verdict('pull_request', 'false', 'skipped', 'skipped', 'skipped', 'skipped').reason).toContain('all 4');
    });

    it('is MISUSE — never a verdict — to call it with no results', () => {
        // ⛔ A check invoked with nothing to judge must not answer "ok". That is the vacuous pass this
        // repository treats as worse than a missing gate: it would report evidence for a PR that has none.
        const run = spawnSync('bash', [SCRIPT, 'verdict', 'pull_request'], { encoding: 'utf8' });

        expect(run.status).toBe(2);
    });

    it('is MISUSE to invoke the script with no subcommand', () => {
        expect(spawnSync('bash', [SCRIPT], { encoding: 'utf8' }).status).toBe(2);
    });
});

describe('the workflow wires the check to every deployed tier it claims to cover', () => {
    it('⛔ depends on every tier gated on the sandbox being live', () => {
        // The subject set is DERIVED: any job in `_ci.yml` conditioned on `resolve-sandbox`'s `live` output
        // IS a deployed tier, and this check must observe it. A seventh tier added tomorrow and left out of
        // `needs` would make the verdict silently narrower than it reads.
        const workflow = fileURLToPath(new URL('../../../../.github/workflows/_ci.yml', import.meta.url));
        const parsed = spawnSync(
            'python3',
            [
                '-c',
                [
                    'import yaml,sys,json',
                    'wf=yaml.safe_load(open(sys.argv[1]))',
                    'jobs=wf["jobs"]',
                    'tiers=[k for k,v in jobs.items() if "resolve-sandbox.outputs.live" in str(v.get("if",""))]',
                    'print(json.dumps({"tiers":sorted(tiers),"needs":sorted(jobs["deployed-tier-evidence"]["needs"])}))',
                ].join('\n'),
                workflow,
            ],
            { encoding: 'utf8' },
        );

        expect(parsed.status, parsed.stderr).toBe(0);

        const { tiers, needs } = JSON.parse(parsed.stdout) as { tiers: string[]; needs: string[] };

        expect(tiers.length, 'no live-gated tiers found — the discovery stopped matching').toBeGreaterThan(3);
        expect(tiers.filter((tier) => !needs.includes(tier))).toStrictEqual([]);
    });
});
