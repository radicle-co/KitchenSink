// @vitest-environment node
/**
 * Repo-wide guard: a workflow step that runs a CDK entrypoint under `tsx` must be preceded by a build of
 * that entrypoint's DEPENDENCY CLOSURE — and the closure must be asked of turbo, never hand-listed.
 *
 * ## The failure this pins, twice
 *
 * `@kitchensink/infra-security` and `@kitchensink/infra-alb` export `./dist`, not `./src`, because the
 * COMPILED CDK apps run under plain `node`, whose type-stripping resolves a `.js` specifier inside a `.ts`
 * file literally rather than through `extensionAlias` (ADR-0013). Exporting `dist` means it must be BUILT
 * before anything imports it, and the service build that would produce it comes later in the job and is
 * gated on the deploy decision.
 *
 * `sandbox-deploy.yml` therefore carries a build step before each resolver. It originally named
 * `infra-security` alone — and its own comment described itself as "the step that was missed". Then
 * `infra-alb` landed for the listener-priority allocator, the hand-written filter did not grow with it, and
 * every sandbox food deploy died on:
 *
 *     ERR_MODULE_NOT_FOUND
 *     url: .../node_modules/@kitchensink/infra-alb/dist/index.js
 *
 * A named filter is a SECOND REPRESENTATION of the dependency graph, kept in step by memory. `^...` asks
 * turbo for the real one, so the next dist-exporting package needs no edit here — which is the property
 * this guard exists to hold, not merely the two package names that happen to be involved today.
 *
 * ## Why it asserts the FORM and not the package list
 *
 * Asserting "the filter mentions infra-alb" would re-encode the same list this defect came from, in a third
 * place. The invariant is that the filter resolves the closure, so that is what is checked: a
 * `--filter=<pkg>^...` covering the entrypoint's own package. A guard that enumerates dependencies would go
 * stale on the same schedule as the thing it guards.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// ⚠️ `_sandbox-preview.yml`, not `sandbox-deploy.yml`: the deploy jobs moved to `_sandbox-preview.yml`, a REUSABLE workflow, because GitHub Actions has no cross-workflow `needs` — `_ci.yml` has to be able to run them as one branch of its own graph.
const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_sandbox-preview.yml', import.meta.url));

interface Step {
    readonly name?: string;
    readonly run?: string;
}

interface Job {
    readonly steps?: readonly Step[];
}

/** One `tsx`-run CDK entrypoint, with the steps that precede it in its own job. */
interface Entrypoint {
    /** `<job>/<step name>`, for a failure message that names the place to fix. */
    readonly where: string;
    /** The workspace package owning the entrypoint script, e.g. `@kitchensink/food-service`. */
    readonly owningPackage: string;
    readonly precedingRuns: readonly string[];
}

/** Map a repo-relative `packages/<group>/<name>/…` path to the manifest name that owns it. */
function packageNameFor(scriptPath: string): string | undefined {
    const match = /^(packages\/[^/]+\/[^/]+)\//u.exec(scriptPath);

    if (match === null) {
        return undefined;
    }

    const manifest = fileURLToPath(new URL(`../../../../${match[1]}/package.json`, import.meta.url));

    try {
        return (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name;
    } catch {
        return undefined;
    }
}

/**
 * Every step that executes a CDK entrypoint through `tsx`, paired with what ran before it.
 *
 * Parsed from YAML rather than grepped: a `run:` block is multi-line and a grep cannot tell which job or
 * which position a match belongs to, which is exactly what this invariant is about.
 *
 * @sideEffect Reads the workflow and the owning packages' manifests.
 */
function tsxEntrypoints(): readonly Entrypoint[] {
    const doc = parse(readFileSync(WORKFLOW, 'utf8')) as { jobs?: Record<string, Job> };
    const found: Entrypoint[] = [];

    for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
        const steps = job.steps ?? [];

        steps.forEach((step, index) => {
            const run = step.run ?? '';
            const script = /npx tsx\s+(\S*infra\/bin\/\S+\.ts)/u.exec(run);

            if (script === null) {
                return;
            }

            const owningPackage = packageNameFor(script[1]);

            if (owningPackage === undefined) {
                return;
            }

            found.push({
                where: `${jobId}/${step.name ?? `step[${index}]`}`,
                owningPackage,
                precedingRuns: steps.slice(0, index).map((earlier) => earlier.run ?? ''),
            });
        });
    }

    return found;
}

const entrypoints = tsxEntrypoints();

describe('sandbox-deploy.yml — a tsx CDK entrypoint is preceded by a closure build', () => {
    // Non-vacuity first: a renamed script path or a restructured job would otherwise leave every
    // assertion below iterating an empty list and passing.
    it('discovers the tsx CDK entrypoints it is meant to constrain', () => {
        expect(entrypoints.length).toBeGreaterThanOrEqual(2);
        expect(entrypoints.map((entry) => entry.owningPackage)).toContain('@kitchensink/food-service');
    });

    it('builds the closure of each entrypoint’s own package before running it', () => {
        const unguarded = entrypoints.filter((entry) => {
            const closure = new RegExp(
                String.raw`turbo run build[^\n]*--filter=['"]?${entry.owningPackage}\^\.\.\.`,
                'u',
            );

            return !entry.precedingRuns.some((run) => closure.test(run));
        });

        expect(unguarded.map((entry) => `${entry.where} (needs ${entry.owningPackage}^...)`)).toEqual([]);
    });

    /**
     * The regression that actually happened: a filter naming individual packages. It looks correct, passes
     * review, and silently stops covering the graph the moment a dependency is added.
     */
    it('never names an infra package individually in a build filter', () => {
        const named = readFileSync(WORKFLOW, 'utf8')
            .split('\n')
            .map((line, index) => ({ line, number: index + 1 }))
            .filter(({ line }) =>
                /turbo run build[^\n]*--filter=['"]?@kitchensink\/infra-[^^'"\s]*['"]?\s*$/u.test(line),
            )
            .map(({ line, number }) => `${number}: ${line.trim()}`);

        expect(named).toEqual([]);
    });
});
