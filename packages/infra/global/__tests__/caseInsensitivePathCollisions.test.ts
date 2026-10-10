/**
 * Repo-wide guard: **no two tracked files may name the same module on a case-insensitive filesystem.**
 *
 * macOS (APFS, the default) and Windows fold case. There, an import of `./Panel.js` written for `Panel.tsx` is
 * matched by `panel.ts` first, because TypeScript tries `.ts` before `.tsx` and Metro tries it before `.native.tsx`.
 * The import binds the wrong module, and `tsc` reports TS1149 on that disk only. The iOS Maestro job builds on macOS,
 * so it is the one CI job that sees it.
 *
 * ## Why this is a guard and not a tool setting
 *
 * The collision is a relation between two FILES, and the standard tools check one file or one import at a time.
 * `forceConsistentCasingInFileNames` (on by default) and `import-x/no-unresolved`'s `caseSensitive` both compare an
 * import against the disk, so they fire only on a case-insensitive disk — never on the Linux runners every other
 * job uses. `ls-lint` and `eslint-plugin-check-file` judge each name alone.
 *
 * ## The rule
 *
 * Two files collide when they share a directory and a RESOLUTION STEM ignoring case, but not the stem itself. The
 * resolution stem is the name a relative import resolves through: the script extension, a `.d` and a platform
 * suffix (`.native`, `.ios`, `.android`, `.web`) come off. So `Foo.tsx` + `Foo.native.tsx` is one module (same
 * stem), while `Foo.tsx` + `foo.ts` is a collision. A non-script file keeps its whole name, so two paths that
 * differ only in case, which a case-folding checkout cannot even hold, are caught by the same rule.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The extensions a relative import resolves through, plus the optional `.d` of a declaration file. */
const SCRIPT_EXTENSION = /(?:\.d)?\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/u;

/** The platform suffixes TypeScript's `moduleSuffixes` and Metro add before the extension. */
const PLATFORM_SUFFIX = /\.(?:native|ios|android|web)$/u;

/** A file's directory plus the stem a relative import resolves it through, in its own case. Pure. */
export function resolutionStem(file: string): string {
    const directory = path.posix.dirname(file);
    const name = path.posix.basename(file);
    const stem = SCRIPT_EXTENSION.test(name) ? name.replace(SCRIPT_EXTENSION, '').replace(PLATFORM_SUFFIX, '') : name;

    return path.posix.join(directory, stem);
}

/** Every group of files that folds to one module but is spelled more than one way, sorted. Pure. */
export function findCaseCollisions(files: readonly string[]): readonly (readonly string[])[] {
    const byFolded = new Map<string, Set<string>>();

    for (const file of files) {
        const folded = resolutionStem(file).toLowerCase();
        const group = byFolded.get(folded) ?? new Set<string>();

        group.add(file);
        byFolded.set(folded, group);
    }

    return [...byFolded.values()]
        .filter((group) => new Set([...group].map(resolutionStem)).size > 1)
        .map((group) => [...group].sort())
        .sort((left, right) => (left[0] ?? '').localeCompare(right[0] ?? ''));
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

describe('case-insensitive collisions — the rule', () => {
    it.each([
        {
            shape: 'a component beside a pure module of the same name in another case',
            files: ['form/AuthoredFoodSheet.tsx', 'form/authoredFoodSheet.ts'],
            collides: true,
        },
        {
            shape: 'a native leaf beside a lower-cased module',
            files: ['form/ShortlistPanel.native.tsx', 'form/shortlistPanel.ts'],
            collides: true,
        },
        {
            shape: 'two tests whose stems differ only in case, whatever the extension',
            files: ['form/__tests__/ShortlistPanel.test.tsx', 'form/__tests__/shortlistPanel.test.ts'],
            collides: true,
        },
        {
            shape: 'a declaration file against a module',
            files: ['src/Env.d.ts', 'src/env.ts'],
            collides: true,
        },
        {
            shape: 'two non-script paths that differ only in case',
            files: ['docs/Readme.txt', 'docs/README.txt'],
            collides: true,
        },
        {
            shape: 'a web and a native leaf of one module',
            files: ['form/ShortlistPanel.tsx', 'form/ShortlistPanel.native.tsx'],
            collides: false,
        },
        {
            shape: 'a component beside its role-suffixed pure model',
            files: ['form/ShortlistPanel.tsx', 'form/shortlistPanel.model.ts'],
            collides: false,
        },
        {
            shape: 'the same stem in two different directories',
            files: ['a/Foo.tsx', 'b/foo.ts'],
            collides: false,
        },
        {
            shape: 'a non-script file whose name only shares a script stem',
            files: ['form/AuthoredFoodSheet.tsx', 'form/authoredFoodSheet.json'],
            collides: false,
        },
    ])('$shape → collides: $collides', ({ files, collides }) => {
        expect(findCaseCollisions(files).length > 0).toBe(collides);
    });

    it('reports every member of a colliding group, and nothing outside it', () => {
        expect(findCaseCollisions(['f/Panel.tsx', 'f/Panel.native.tsx', 'f/panel.ts', 'f/other.ts'])).toStrictEqual([
            ['f/Panel.native.tsx', 'f/Panel.tsx', 'f/panel.ts'],
        ]);
    });
});

describe('case-insensitive collisions — the real tree', () => {
    const files = trackedFiles();

    it('is not vacuous: the subject set is the whole tree', () => {
        expect(files.length).toBeGreaterThan(5000);
    });

    it('holds: no two tracked files resolve to one module on a case-folding filesystem', () => {
        expect(
            findCaseCollisions(files),
            'On macOS and Windows these name ONE module, so an import binds whichever the resolver tries first. ' +
                'Rename one side so the stems differ by more than case (a pure module beside a component takes a ' +
                'role suffix, e.g. `shortlistPanel.model.ts`).',
        ).toStrictEqual([]);
    });
});
