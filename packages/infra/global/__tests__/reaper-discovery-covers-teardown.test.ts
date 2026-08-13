// @vitest-environment node
/**
 * Repo-wide guard: the daily reaper must be able to SEE every resource class the teardown can DELETE.
 *
 * ## The invariant, and why it is not obvious
 *
 * `sandbox-deploy.yml`'s `reap-abandoned` job is a two-stage machine. Stage one DISCOVERS candidate `pr-{N}`
 * tokens by enumerating live resources; stage two hands each token to `teardown-sandbox-pr.sh`, which
 * re-applies the anchored `pr-{N}` match and deletes what belongs to it. Those two stages have no shared
 * definition of "the things a preview owns" — the teardown knows five resource classes, the discovery step
 * happens to enumerate some subset of them — so they can drift silently, and the drift is invisible in the
 * only direction that matters:
 *
 *   A class the teardown deletes but discovery cannot see is UNRECLAIMABLE as soon as the other classes are
 *   gone. There is no token left to rediscover the PR by, the sweep reports "nothing to do", and the resource
 *   survives forever behind a green check.
 *
 * That is not hypothetical, it is the defect this file was written for. Teardown §0b deletes the legacy
 * `sandbox-preview/pr-{N}` GitHub Environment, and discovery enumerated stacks, ECR repos, log groups and
 * Route 53 records — never environments. So a PR close whose §0b failed (expired token, a 403) stranded that
 * name permanently: by the next daily sweep its stacks, repos and CNAME had all been reclaimed, leaving the
 * reaper with no token to act on. It is the same defect SHAPE as `pr_scope_path_belongs` failing to match a
 * mid-segment token, where a documented, implemented, apparently-working log-group sweep matched nothing on
 * every run and accumulated 22 orphans; and the same shape as ADR-0010's ensure-exists gate, where a skipped
 * dependency silently removed a whole service. In all three the code reads correctly and does nothing.
 *
 * Route 53 is the precedent that proves the rule was already understood one class at a time: it is in the
 * source list precisely because a web-only PR owns no stack, repo or log group. This test generalizes that
 * one-off reasoning into an invariant over the whole set, so the NEXT resource class the teardown learns to
 * delete cannot be added without a way to find it.
 *
 * ## How it is asserted, and why not by parsing the teardown script
 *
 * The class list below is a declared TABLE, not something inferred from the script. Inferring it would mean
 * pattern-matching `aws … delete-*` calls out of shell, which is exactly the kind of clever-but-fragile
 * analyzer that passes vacuously the day someone reformats a line — and a vacuous pass here restores the
 * silent failure this guard exists to remove. A table is honest: it forces the human adding class six to
 * write down how the reaper will find it, which IS the thinking the guard is trying to enforce. `whyDiscovery`
 * records, per class, the state in which that source is the ONLY signal left, so the entry cannot be deleted
 * as redundant without arguing with the reason.
 *
 * `missingDiscoverySources` is a pure function over the step body, and it is tested against MUTATED bodies as
 * well as the real one — an analyzer that cannot demonstrate its own failure mode is not evidence.
 *
 * ## Second concern in this file: the admin-token wiring
 *
 * The environment source is inseparable from `GH_ENVIRONMENT_ADMIN_TOKEN`, so its wiring is pinned here too.
 * `github.token` CANNOT delete an environment at any permission level (`administration` is not a grantable
 * `permissions:` key), which is why a distinct secret exists — and why passing the wrong one, or forgetting
 * to pass it to one of the two reclamation jobs, is a live failure mode rather than a theoretical one. In the
 * reaper it fails SILENTLY: the discovery call ends in `2>/dev/null` to match its sibling sources, so a 403
 * from a missing or rotated token yields an empty list and a clean-looking sweep. Pagination is load-bearing
 * for the same reason — the default page size is 30, and 51 environments once existed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

const readRepoFile = (...segments: readonly string[]): string => readFileSync(join(repoRoot, ...segments), 'utf8');

/** The literal expression that must reach BOTH reclamation jobs for environment reclamation to work. */
const ADMIN_TOKEN_EXPRESSION = '${{ secrets.GH_ENVIRONMENT_ADMIN_TOKEN }}';

/**
 * A resource class `teardown-sandbox-pr.sh` deletes, paired with the discovery signal the reaper needs to
 * find a PR that owns one.
 *
 * `probe` is deliberately the API call, not a keyword: "environments" appears in prose comments all over the
 * step, and matching prose would let a deleted API call pass. Each pattern is the narrowest fragment that
 * cannot be satisfied by a comment.
 */
interface ReclaimedClass {
    /** Human name, used verbatim in failure messages. */
    readonly name: string;
    /** The teardown section that deletes it — so a failure points at the code, not just the concept. */
    readonly deletedBy: string;
    /** The API call that must appear in the reaper's discovery block. */
    readonly probe: RegExp;
    /** The state in which this source is the ONLY remaining signal. Keeps the entry from being "simplified". */
    readonly whyDiscovery: string;
}

const RECLAIMED_CLASSES: readonly ReclaimedClass[] = [
    {
        name: 'CloudFormation stacks',
        deletedBy: '§2 (name match or Environment=pr-{N} tag)',
        probe: /aws cloudformation list-stacks/,
        whyDiscovery:
            'a stack stuck in DELETE_FAILED is the most expensive orphan (it keeps ECS/RDS alive) and the ' +
            'reaper is the only retry it ever gets',
    },
    {
        name: 'ECR repositories',
        deletedBy: '§3/§4 (tag sweep and name sweep)',
        probe: /aws ecr describe-repositories/,
        whyDiscovery: 'a build that pushed an image but never deployed leaves a repo and nothing else',
    },
    {
        name: 'CloudWatch log groups',
        deletedBy: '§3/§4 (tag sweep and path-anchored name sweep)',
        probe: /aws logs describe-log-groups/,
        whyDiscovery:
            'ECS auto-creates Container Insights groups the stack does not own, so they outlive a ' +
            'successful stack delete',
    },
    {
        name: 'Route 53 preview records',
        deletedBy: '§0 (teardownPreviewDomain.ts, exact first-label match)',
        probe: /aws route53 list-resource-record-sets/,
        whyDiscovery:
            'a WEB-only PR owns no stack, repo or log group, so its dangling CNAME — a subdomain-takeover ' +
            'vector — is invisible without this source',
    },
    {
        name: 'legacy GitHub Environments',
        deletedBy: '§0b (sandbox-preview/pr-{N}, exact equality)',
        // `[\s\\]+` because the call is wrapped over a shell line continuation — a plain `\s+` matches the
        // newline and the indentation but not the trailing backslash, and would report the source missing.
        probe: /gh api --paginate[\s\\]+"repos\/\$\{REPOSITORY\}\/environments"/,
        whyDiscovery:
            'once a close-time §0b failure is followed by a successful sweep of the AWS classes, the ' +
            'environment NAME is the only trace of the PR that remains',
    },
];

/** Parses a workflow under `.github/workflows/`. */
const readWorkflow = (name: string): Record<string, unknown> =>
    parse(readRepoFile('.github', 'workflows', name)) as Record<string, unknown>;

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly env?: Record<string, string>;
}

const stepsOf = (workflow: string, job: string): readonly Step[] => {
    const jobs = readWorkflow(workflow)['jobs'] as Record<string, { steps?: readonly Step[] }>;

    // Guards the guard: a renamed job must fail loudly rather than pass vacuously over an empty step list.
    expect(jobs, `job '${job}' no longer exists in ${workflow} — update this test`).toHaveProperty(job);

    return jobs[job]?.steps ?? [];
};

/**
 * The `run:` body of the step whose name starts with `prefix`, within `job`.
 *
 * Matched on a name PREFIX rather than an index so that inserting a step ahead of it does not silently shift
 * the assertion onto the wrong body.
 */
const stepBody = (workflow: string, job: string, prefix: string): string => {
    const step = stepsOf(workflow, job).find((candidate) => candidate.name?.startsWith(prefix));

    expect(step, `no step named '${prefix}…' in ${workflow} → ${job} — update this test`).toBeDefined();
    expect(step?.run, `step '${prefix}…' has no run: body`).toBeTypeOf('string');

    return step?.run ?? '';
};

/**
 * Names the reclaimed classes whose discovery signal is ABSENT from `discoveryBody`.
 *
 * Pure. Empty result = every class the teardown deletes is findable.
 */
const missingDiscoverySources = (discoveryBody: string): readonly string[] =>
    RECLAIMED_CLASSES.filter(({ probe }) => !probe.test(discoveryBody)).map(({ name }) => name);

const REAPER_STEP = 'Reap pr-{N} resources';
const CLEANUP_STEP = 'Tear down';

describe('the reaper can discover every class the teardown deletes', () => {
    it('enumerates a signal for all five reclaimed resource classes', () => {
        const missing = missingDiscoverySources(stepBody('sandbox-deploy.yml', 'reap-abandoned', REAPER_STEP));

        expect(
            missing,
            `the reaper cannot DISCOVER: ${missing.join(', ')}. Each of these is deleted by the teardown, so ` +
                `a PR that owns only this class — or whose other resources were already swept — can never be ` +
                `reclaimed: the sweep finds no token, reports "nothing to do", and the resource survives ` +
                `behind a green check. Add an enumeration for it to the discovery block, or delete the ` +
                `teardown code that claims to reclaim it.`,
        ).toEqual([]);
    });

    it('derives tokens through the ONE `pr-[0-9]+` extraction, not a per-source matcher', () => {
        const body = stepBody('sandbox-deploy.yml', 'reap-abandoned', REAPER_STEP);

        // Every source feeds one brace group piped into a single extraction. A second, source-specific
        // matcher is what CLAUDE.md forbids and what would let one source's scope drift from the rest.
        expect([...body.matchAll(/grep -oE 'pr-\[0-9\]\+'/g)].length).toBeGreaterThanOrEqual(1);
        expect(body).toContain("| grep -oE 'pr-[0-9]+' | sort -u");
    });

    it('reads the environment list with the ADMIN token, never the workflow token', () => {
        const body = stepBody('sandbox-deploy.yml', 'reap-abandoned', REAPER_STEP);

        // `github.token` cannot even be granted `administration`, and the call ends in `2>/dev/null`, so the
        // wrong token here produces an empty list and a green sweep rather than an error anybody sees.
        expect(body).toMatch(/GH_TOKEN="\$GH_ENVIRONMENT_ADMIN_TOKEN" gh api --paginate/);
    });

    it('paginates the environment list, because the default page size is 30', () => {
        const body = stepBody('sandbox-deploy.yml', 'reap-abandoned', REAPER_STEP);
        const call = body.split('\n').find((line) => line.includes('/environments"'));

        // 51 environments existed on 2026-08-11. An unpaginated list stops at 30 and everything past it is
        // undiscoverable — silently, since the response is a valid page.
        expect(body).toMatch(/gh api --paginate/);
        expect(call ?? '', 'the environment list call must be on a --paginate invocation').toBeTruthy();
    });
});

describe('missingDiscoverySources (the analyzer itself)', () => {
    const realBody = stepBody('sandbox-deploy.yml', 'reap-abandoned', REAPER_STEP);

    it('reports the environment source when its API call is removed', () => {
        // The exact regression that motivated this file: the class is still deleted by §0b, still discussed
        // in comments, and no longer findable. Stripping only the `gh api` line leaves every comment intact,
        // which is what proves the probe matches the CALL and not the prose around it.
        const withoutEnvironments = realBody
            .split('\n')
            .filter((line) => !line.includes('gh api --paginate'))
            .join('\n');

        expect(missingDiscoverySources(withoutEnvironments)).toEqual(['legacy GitHub Environments']);
    });

    it('reports the Route 53 source when its API call is removed', () => {
        const withoutDns = realBody.replace('aws route53 list-resource-record-sets', 'aws route53 list-hosted-zones');

        expect(missingDiscoverySources(withoutDns)).toEqual(['Route 53 preview records']);
    });

    it('reports every class for an empty body, so a lookup failure cannot pass vacuously', () => {
        expect(missingDiscoverySources('')).toHaveLength(RECLAIMED_CLASSES.length);
    });

    it('is not satisfied by a comment that merely mentions the resource', () => {
        const prosaicOnly = RECLAIMED_CLASSES.map(({ name, whyDiscovery }) => `# ${name}: ${whyDiscovery}`).join('\n');

        expect(missingDiscoverySources(prosaicOnly)).toHaveLength(RECLAIMED_CLASSES.length);
    });
});

describe('GH_ENVIRONMENT_ADMIN_TOKEN reaches both reclamation jobs', () => {
    // Two call sites, two failure modes. Missing on `cleanup` ⇒ every PR close leaks its environment behind a
    // warning. Missing on `reap-abandoned` ⇒ the backstop cannot reclaim what a failed close left, AND the
    // discovery source above goes dark, since it is gated on this variable being set.
    const sites: readonly { readonly job: string; readonly step: string }[] = [
        { job: 'cleanup', step: CLEANUP_STEP },
        { job: 'reap-abandoned', step: REAPER_STEP },
    ];

    for (const { job, step } of sites) {
        it(`${job} passes the secret into its teardown step`, () => {
            const found = stepsOf('sandbox-deploy.yml', job).find((candidate) => candidate.name?.startsWith(step));

            expect(
                found?.env?.['GH_ENVIRONMENT_ADMIN_TOKEN'],
                `${job} does not pass GH_ENVIRONMENT_ADMIN_TOKEN. github.token cannot delete an environment ` +
                    `at any permission level, so without this secret the step can only warn and skip.`,
            ).toBe(ADMIN_TOKEN_EXPRESSION);
        });
    }

    it('spells the variable exactly as the teardown script reads it', () => {
        // A rename on either side leaves both files syntactically valid: the workflow exports a name nobody
        // reads, the script sees an unset variable, and §0b warn-skips forever on a run that looks healthy.
        expect(readRepoFile('.github', 'scripts', 'teardown-sandbox-pr.sh')).toContain(
            '${GH_ENVIRONMENT_ADMIN_TOKEN:-}',
        );
    });

    it('does not smuggle the token through a job- or workflow-level env, where every step would see it', () => {
        const workflow = readWorkflow('sandbox-deploy.yml');
        const jobs = workflow['jobs'] as Record<string, { env?: Record<string, string> }>;

        // An admin-scoped credential belongs to the one step that needs it. Hoisting it to the job (let alone
        // the workflow) puts `Administration: write` in scope for `npm ci` and every action on the runner.
        expect(Object.values(workflow['env'] ?? {})).not.toContain(ADMIN_TOKEN_EXPRESSION);

        for (const [name, job] of Object.entries(jobs)) {
            expect(Object.values(job.env ?? {}), `${name} hoists the admin token to job scope`).not.toContain(
                ADMIN_TOKEN_EXPRESSION,
            );
        }
    });
});
