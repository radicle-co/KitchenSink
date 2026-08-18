// @vitest-environment node
/**
 * ⛔ THE ACCEPTANCE CRITERION for the sharded unit tier: every package that HAS tests actually RUNS them.
 *
 * `ci / Test` used to be one `turbo run test` over the whole workspace, which cannot miss a package. It is
 * now three matrix legs, each a `--filter` expression — and that introduces a failure mode the single job
 * could not have: a package added to NO group stops being tested, CI stays green, and nothing says so. A
 * silent loss of coverage is worse than the 399s it was split to save.
 *
 * So the groups are asserted COMPLETE and DISJOINT here, by resolving the real filters against the real
 * workspace with turbo itself — not by reading the YAML and trusting that a glob means what it looks like.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const WORKFLOW = path.join(repoRoot, '.github/workflows/_ci.yml');

/** The `--filter` expressions the matrix declares, one per group. */
function groupFilters(): { readonly group: string; readonly filter: string }[] {
    const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as {
        jobs: { test: { strategy: { matrix: { include: { group: string; filter: string }[] } } } };
    };

    return workflow.jobs.test.strategy.matrix.include;
}

/** Packages turbo resolves for a filter expression, restricted to those that actually define `test`. */
function packagesFor(filter: string): readonly string[] {
    const args = ['turbo', 'run', 'test', '--dry=json', ...filter.split(/\s+/).filter(Boolean)];
    const out = execFileSync('npx', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const plan = JSON.parse(out) as { tasks: { package: string; command: string; task: string }[] };

    // ⛔ `task === 'test'` matters. A `--dry=json` plan also carries the `build` tasks turbo schedules for
    // the filtered package's DEPENDENCIES, so counting every task's package reports a package as "covered"
    // when all that happens on that runner is its dist being built. That mistake made this file's first
    // draft claim the `infra` group ran ten packages; it runs one.
    return [
        ...new Set(plan.tasks.filter((t) => t.task === 'test' && t.command !== '<NONEXISTENT>').map((t) => t.package)),
    ];
}

describe('the sharded unit tier covers every package with tests', () => {
    it('⛔ leaves NO package with a `test` script unrun', () => {
        const everything = new Set(packagesFor(''));
        const covered = new Set(groupFilters().flatMap((g) => packagesFor(g.filter)));
        const missed = [...everything].filter((pkg) => !covered.has(pkg)).sort();

        expect(
            missed,
            'these packages define a `test` script but no matrix group selects them, so their tests stopped ' +
                'running while CI stayed green. Add them to a group in `_ci.yml`.',
        ).toStrictEqual([]);
    });

    it('runs no package TWICE, which would pay for it on two runners', () => {
        const seen = new Map<string, string[]>();

        for (const { group, filter } of groupFilters()) {
            for (const pkg of packagesFor(filter)) {
                seen.set(pkg, [...(seen.get(pkg) ?? []), group]);
            }
        }

        const duplicated = [...seen.entries()].filter(([, groups]) => groups.length > 1);

        expect(duplicated, 'a package selected by two groups is tested twice, on two runners').toStrictEqual([]);
    });

    it('keeps infra-global alone, because it is the longest pole AND the one task that never caches', () => {
        // `@kitchensink/infra-global#test` is `cache: false` (see turbo.json): its gates read other
        // packages' sources, which turbo cannot hash into its inputs. It therefore runs in full on every
        // CI run, and pairing it with anything else just makes that leg the critical path again.
        const infra = groupFilters().find((g) => g.group === 'infra');

        expect(infra).toBeDefined();
        expect(packagesFor(infra!.filter)).toStrictEqual(['@kitchensink/infra-global']);
    });
});
