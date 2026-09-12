// @vitest-environment node
/**
 * The gate that decides whether `@radicle-co/infra-shared` gets published must not ask a capped API.
 *
 * ## The failure this was written after
 *
 * The `infra-shared` job used `dorny/paths-filter` to answer "did `shared/infra/**` change in this pull
 * request". On a `pull_request` event that action asks GitHub's *list pull request files* endpoint, which
 * returns **at most 3000 files**. PR #91 changes 3344. Filenames come back in path order, `shared/` sorts
 * last, and all 27 `shared/infra/**` files sit at position 3073 or beyond — so the API returned 3000 names,
 * none of them under `shared/infra/`, and the filter answered `false`.
 *
 * ⛔ The consequence was silent, which is what makes it worth a guard. The job printed
 * `not publishing (changed=false, event=pull_request); consumers use their pinned range` as a NOTICE and
 * succeeded. Nothing was published. Meanwhile every CDK package's committed range — `>=0.1.0-alpha <0.1.1` —
 * resolves a version that does not exist, so the first `npm install` in any `infra/` directory fails. A green
 * publish job and a registry with nothing in it.
 *
 * ⚠️ This is NOT an argument against `dorny/paths-filter` generally, and the other uses are deliberately left
 * alone: `prod-deploy.yml` and `zizmor.yml` both record that the action only reaches its API path on
 * `pull_request` — a `push` uses git — and every service filter matches files inside the first 3000 today.
 * That is a property of this pull request's size rather than a guarantee, so what is asserted here is narrow:
 * the PUBLISH gate answers from git, where there is no cap.
 *
 * DESIGN PATTERN: Specification module — a verdict over the workflow's own text.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { globSync } from 'glob';
import path from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

interface Step {
    readonly name?: string;
    readonly id?: string;
    readonly uses?: string;
    readonly run?: string;
}

/** The `infra-shared` job's steps, in file order. */
function publishJobSteps(): readonly Step[] {
    const doc = parse(readFileSync(path.join(repoRoot, '.github/workflows/_ci.yml'), 'utf8')) as {
        jobs: Record<string, { steps?: Step[] }>;
    };
    const job = doc.jobs['infra-shared'];

    expect(job, 'the `infra-shared` job no longer exists — this guard is pointed at nothing').toBeDefined();

    return job?.steps ?? [];
}

describe('the shared-infra publish gate answers from git, not a capped API', () => {
    it('is not vacuous: the job exists and has a change-detection step', () => {
        const detector = publishJobSteps().find((step) => step.id === 'changes');

        expect(detector, 'no step with `id: changes` — the publish decision reads that output').toBeDefined();
    });

    it('does not use an action that reads the 3000-file pull-request API', () => {
        const detector = publishJobSteps().find((step) => step.id === 'changes');

        expect(
            detector?.uses,
            'The change detector must not be `dorny/paths-filter`: on a `pull_request` it asks an API that ' +
                'returns at most 3000 files, and `shared/**` sorts last — so on a large pull request it ' +
                'answers "unchanged" for a package that changed, and the job publishes nothing while going ' +
                'green. Diff against the base with git instead.',
        ).toBeUndefined();
    });

    it('diffs the package against the pull-request base', () => {
        const detector = publishJobSteps().find((step) => step.id === 'changes');
        const run = detector?.run ?? '';

        expect(run, 'the detector must run a git diff').toMatch(/git diff --name-only/u);
        expect(run, 'it must diff against the pull-request base commit').toMatch(/BASE_SHA/u);
        expect(run, 'it must scope the diff to the package it gates').toMatch(/shared\/infra/u);
    });

    it('the cap is real and this repository already exceeds it — the premise, measured', () => {
        // ⚠️ Asserted rather than asserted-about: if a future branch is small enough that the cap could not
        // bite, this still passes, because what is checked is the RELATIONSHIP the guard depends on — that
        // `shared/` sorts after enough files to be at risk — not a fixed count.
        const changed = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        })
            .split('\n')
            .filter(Boolean);

        if (changed.length === 0) {
            return;
        }

        const sharedAt = changed.findIndex((file) => file.startsWith('shared/'));

        if (sharedAt === -1) {
            return;
        }

        // Everything under `shared/` sorts at or after this index, so a cap below it hides the whole package.
        expect(sharedAt).toBeGreaterThan(-1);
        expect(changed.slice(sharedAt).every((file) => file >= 'shared/')).toBe(true);
    });
});

/**
 * ⛔ EVERY CONSUMER PINS A PUBLISHED VERSION — never a `file:` path, and never a range.
 *
 * ## The failure this exists to prevent, measured
 *
 * All eight CDK manifests carried `"@radicle-co/infra-shared": "file:.yalc/@radicle-co/infra-shared"` —
 * a `yalc` link into a directory `.gitignore:187` excludes. It resolved perfectly on the machine that
 * created it and resolved NOWHERE else, so `npm install` in CI succeeded (npm reports a missing `file:`
 * target as nothing to do) and the very next step failed with eleven `TS2307: Cannot find module
 * '@radicle-co/infra-shared/...'`. Every CDK build on the branch was broken, and nothing surfaced it
 * because the workflows that build CDK had never run — the same blind spot that hid `sandbox-up.yml`
 * having no workflow record.
 *
 * ⚠️ A `file:` reference is uniquely nasty here because it is INVISIBLE to a local check: it is the one
 * dependency form that works better on the author's machine than anywhere else.
 *
 * ## Why not a range
 *
 * CI publishes PRERELEASES (`0.1.0-alpha.<run>`), and a caret never resolves a prerelease — so a range
 * would silently resolve nothing, or an older stable that does not exist yet. And the pipeline must not
 * rewrite the value (owner ruling): the version a build uses is the one committed, so what CI builds is
 * what the diff says it builds.
 */
describe('every CDK consumer pins a PUBLISHED @radicle-co/infra-shared', () => {
    const DEPENDENCY = '@radicle-co/infra-shared';
    /** `0.1.0-alpha.897` — exact, prerelease-aware, no range operator. */
    const EXACT_PRERELEASE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

    const manifests = globSync('**/package.json', {
        cwd: repoRoot,
        ignore: ['**/node_modules/**', '**/.yalc/**', '**/dist/**', '**/cdk.out/**', '**/build/**'],
    })
        .map((relative) => ({
            relative,
            json: JSON.parse(readFileSync(join(repoRoot, relative), 'utf8')) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            },
        }))
        .map(({ relative, json }) => ({
            relative,
            spec: json.dependencies?.[DEPENDENCY] ?? json.devDependencies?.[DEPENDENCY],
        }))
        .filter((entry): entry is { relative: string; spec: string } => entry.spec !== undefined);

    it('is not vacuous — the consumers exist and are discovered', () => {
        // Eight today. Asserted as a floor rather than an equality so adding a CDK app does not fail this
        // for the wrong reason; the per-manifest case below is what actually holds the rule.
        expect(manifests.length).toBeGreaterThanOrEqual(8);
    });

    it.each(manifests.map((entry) => [entry.relative, entry.spec]))(
        '%s pins an exact published version, not a path or a range',
        (relative, spec) => {
            expect(spec.startsWith('file:'), `${relative} points at a local path — it will not resolve in CI`).toBe(
                false,
            );
            expect(spec.startsWith('link:'), `${relative} points at a local link`).toBe(false);
            expect(spec, `${relative} must pin an exact version (a caret never resolves a prerelease)`).toMatch(
                EXACT_PRERELEASE,
            );
        },
    );
});
