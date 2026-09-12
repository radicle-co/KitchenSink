/**
 * Repo-wide guard: **no hyphens or underscores in a file name** (`docs/CODING_STANDARDS.md` §1).
 *
 * §1 is already enforced by `eslint-plugin-check-file`, and that enforcement has two holes this closes:
 *
 *   - **It only sees what ESLint lints** — `*.{ts,tsx,js,jsx}` under `packages/`. A shell script, a workflow, a
 *     Maestro flow, a JSON baseline or a text prompt is never checked, which is how PR 91 added 44 hyphenated
 *     scripts, workflows and flows with a green lint.
 *   - **`ignoreMiddleExtensions` skips every segment but the first**, so `recipes.dal.soft-delete.test.ts`
 *     passes: `.dal.soft-delete.test` is read as an extension.
 *
 * So the subject here is EVERY tracked file, and EVERY dot-separated segment of its name.
 *
 * ## Library-first: what was checked (measured 2026-09-13)
 *
 * **`@ls-lint/ls-lint`** 2.3.1 is the dedicated tool, and it does read every file type. Run against a scratch
 * tree with `.*: camelcase`, it failed `bad-name.sh` and `record-baselines.yaml` — and PASSED
 * `recipes.dal.soft-delete.test.ts` and `erasure.service.service-path.test.ts`, because it too treats everything
 * after the first dot as the extension. It would close the first hole and leave the second, and its `ignore`
 * list carries no reason and never notices an entry that no longer applies.
 *
 * ## The two registries, and why they are different things
 *
 *   - {@link EXEMPT_BY_OWNER_RULING} — POLICY: kinds of file the owner has exempted outright. Owner ruling
 *     2026-09-13: GitHub workflow files and markdown files are exempt. Each entry cites its dated ruling. It is
 *     deliberately NOT checked for liveness: a ruling does not lapse because no file happens to need it today.
 *   - {@link MANDATED} — FACT: names a tool resolves BY FILENAME, so renaming breaks it. Each carries the tool
 *     and the evidence (its source or docs). A mandate that excuses no violating file the owner ruling does not
 *     already excuse fails, so a mandate can neither outlive its files nor hide behind the ruling.
 *
 * There is no debt list. The 106 pre-existing violations it once recorded were renamed, deleted as stray tool
 * output, or re-classified under one of the two registries above on 2026-09-13.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** A family of file names the owner has exempted from §1, with the ruling that exempts it. */
interface OwnerExemption {
    readonly pattern: RegExp;
    readonly ruling: string;
}

const WORKFLOWS_AND_MARKDOWN_RULING =
    'owner ruling 2026-09-13: GitHub workflow files and markdown files are exempt from the file-name rule';

export const EXEMPT_BY_OWNER_RULING: readonly OwnerExemption[] = [
    // GitHub runs a workflow only from a file DIRECTLY in `.github/workflows/`, so a nested file is not one.
    { pattern: /^\.github\/workflows\/[^/]+\.ya?ml$/u, ruling: WORKFLOWS_AND_MARKDOWN_RULING },
    { pattern: /\.md$/u, ruling: WORKFLOWS_AND_MARKDOWN_RULING },
];

/** A family of file names a tool resolves by name, with the tool that requires it. */
interface Mandate {
    readonly pattern: RegExp;
    readonly mandatedBy: string;
}

export const MANDATED: readonly Mandate[] = [
    {
        pattern: /^\.specify\//u,
        mandatedBy:
            'Spec Kit — `specify extension add` installs this tree verbatim and its scripts resolve each other by ' +
            'path (e.g. `extensions/product-forge/scripts/gate-risk.js` does `require("./lib-yaml")`); it is vendored',
    },
    {
        pattern: /^v-model-config\.yml$/u,
        mandatedBy:
            'the Spec Kit v-model extension — `.specify/extensions/v-model/commands/system-design.md`: "Load ' +
            '`v-model-config.yml` (if it exists at the repository root)"',
    },
    {
        pattern: /^specs\/[^/]+\/(\.forge-status\.yml|sync-report\.json)$/u,
        mandatedBy:
            'the Spec Kit product-forge extension — `scripts/lib-paths.js` finds a feature by ' +
            '`statSync(path.join(dir, ".forge-status.yml"))`, and `commands/sync-verify.md` writes ' +
            '`{FEATURE_DIR}/sync-report.json`',
    },
    { pattern: /(^|\/)package-lock\.json$/u, mandatedBy: 'npm — the lockfile name is fixed' },
    {
        pattern:
            /^\.husky\/(pre-commit|pre-merge-commit|prepare-commit-msg|commit-msg|post-commit|applypatch-msg|pre-applypatch|post-applypatch|pre-rebase|post-rewrite|post-checkout|post-merge|pre-push|pre-auto-gc)$/u,
        mandatedBy:
            'husky 9 — its `_/h` shim runs `.husky/$(basename "$0")`, where `$0` is the git hook git invoked, so ' +
            'the file must carry the git hook name',
    },
    {
        pattern: /(^|\/)nest-cli\.json$/u,
        mandatedBy:
            "the Nest CLI 11 — `lib/configuration/nest-configuration.loader.js` discovers only `readAnyOf(['nest-cli.json', " +
            "'.nest-cli.json'])`; both spellings are hyphenated",
    },
    {
        pattern: /\/(database|db)\/migrations\/\d{4}_[a-z0-9_]+\.sql$/u,
        mandatedBy:
            "`@kitchensink/db-schema-guard`'s `applyMigrations` keys every deployed database's `schema_migrations` " +
            'ledger by FILENAME with no checksum, so a renamed migration is re-applied against every live database',
    },
    {
        pattern: /(^|\/)(next-env\.d\.ts|not-found\.tsx|global-error\.tsx|instrumentation-client\.ts)$/u,
        mandatedBy: 'Next.js — App Router special files resolved by name, and the `next-env.d.ts` it generates',
    },
];

/** Whether any dot-separated segment of the file's name carries a hyphen or an underscore. Pure. */
export function violatesConvention(file: string): boolean {
    return path.posix
        .basename(file)
        .split('.')
        .some((segment) => /[-_]/u.test(segment));
}

/** Whether the owner has exempted this file's name by ruling. Pure. */
export function isOwnerExempt(file: string): boolean {
    return EXEMPT_BY_OWNER_RULING.some((exemption) => exemption.pattern.test(file));
}

/** Whether a tool resolves this file by its name. Pure. */
export function isMandated(file: string): boolean {
    return MANDATED.some((mandate) => mandate.pattern.test(file));
}

/** The files that break §1 and are neither owner-exempt nor mandated. Pure. */
export function findViolations(files: readonly string[]): readonly string[] {
    return files.filter((file) => violatesConvention(file) && !isOwnerExempt(file) && !isMandated(file));
}

/**
 * Every tracked file, repo-relative.
 *
 * @sideEffect Shells out to `git ls-files`.
 */
function trackedFiles(): readonly string[] {
    return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 })
        .split('\n')
        .filter((file) => file.length > 0);
}

describe('file names — the rule', () => {
    it('fails a hyphen or an underscore in ANY segment, not just the first', () => {
        expect(violatesConvention('.github/scripts/sandbox-wake.sh')).toBe(true);
        expect(violatesConvention('src/recipes.dal.soft-delete.test.ts')).toBe(true);
        expect(violatesConvention('docs/CODING_STANDARDS.md')).toBe(true);
    });

    it('passes camelCase, PascalCase, role suffixes and dotfiles', () => {
        expect(violatesConvention('.github/scripts/sandboxWake.sh')).toBe(false);
        expect(violatesConvention('src/RecipeCard.native.test.tsx')).toBe(false);
        expect(violatesConvention('.gitignore')).toBe(false);
    });

    it('does not judge a DIRECTORY name, only the file', () => {
        expect(violatesConvention('specs/017-recime-parity/plan.md')).toBe(false);
    });

    it('excuses a mandated name, and not a hyphenated neighbour of it', () => {
        expect(findViolations(['package-lock.json', 'a/package-lock.json.bak', 'a/new-name.sh'])).toStrictEqual([
            'a/package-lock.json.bak',
            'a/new-name.sh',
        ]);
    });

    it('excuses, by owner ruling, a markdown file anywhere and a workflow directly under .github/workflows', () => {
        expect(
            findViolations([
                'docs/some-note.md',
                'packages/x/README-old.md',
                '.github/workflows/new-flow.yml',
                '.github/workflows/new-flow.yaml',
                '.github/scripts/new-script.sh',
                '.github/workflows/nested/not-a-workflow.yml',
                'docs/some-note.mdx',
                'docs/some-note.md.bak',
            ]),
        ).toStrictEqual([
            '.github/scripts/new-script.sh',
            '.github/workflows/nested/not-a-workflow.yml',
            'docs/some-note.mdx',
            'docs/some-note.md.bak',
        ]);
    });

    it('names the dated owner ruling each exemption rests on', () => {
        expect(EXEMPT_BY_OWNER_RULING.length).toBeGreaterThan(0);

        for (const exemption of EXEMPT_BY_OWNER_RULING) {
            expect(exemption.ruling).toMatch(/^owner ruling \d{4}-\d{2}-\d{2}: /u);
        }
    });
});

describe('file names — the real tree', () => {
    const files = trackedFiles();

    it('is not vacuous: the subject set is the whole tree', () => {
        expect(files.length).toBeGreaterThan(5000);
    });

    it('holds: no tracked file name carries a hyphen or an underscore', () => {
        expect(
            findViolations(files),
            'CODING_STANDARDS §1: camelCase, or PascalCase for a class or component. If a tool genuinely resolves ' +
                'the name, add it to MANDATED with the tool that requires it and the evidence.',
        ).toStrictEqual([]);
    });

    it('every mandate still excuses at least one violating file the owner ruling does not already excuse', () => {
        const dead = MANDATED.filter((mandate) =>
            files.every((file) => !violatesConvention(file) || isOwnerExempt(file) || !mandate.pattern.test(file)),
        );

        expect(dead.map((mandate) => mandate.mandatedBy)).toStrictEqual([]);
    });
});
