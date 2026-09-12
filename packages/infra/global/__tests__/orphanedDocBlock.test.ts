// @vitest-environment node
/**
 * Repo-wide guard: **a doc block that documents a function is ATTACHED to one.**
 *
 * ## The defect, which is worse than a missing docstring
 *
 * `form/model.ts` — since split into one module per concern, so this names where the gate came from
 * rather than a live path — carried two `/** … *\/` blocks back to back. The first described `toNutritionLine` —
 * fifteen lines on how a form line splits into a `LineMeasure` and a `LineCatalogNutrition`, and why a
 * missing unit degrades to `''` rather than a guess. The second described `draftQuantity`. Only the second
 * one bound: JSDoc attaches to the next DECLARATION, and the next declaration was `draftQuantity`.
 *
 * So `toNutritionLine` — exported, read by nine files — had no documentation at all, and `draftQuantity`
 * appeared to be documented TWICE, the upper block describing something it does not do. ⛔ THAT IS THE WHOLE
 * POINT: a missing docstring is a gap a reader can see, while a mis-attached one is prose that reads as
 * authoritative and describes a different function. It survives review precisely because the file looks
 * well-documented.
 *
 * The same shape was found in twelve other files, in production and in suites, including one this very
 * branch introduced (`spendArithmetic.ts`) — so it is a class, not an incident. Every one of them is a
 * docstring someone wrote, and a function that silently stopped carrying it.
 *
 * ## Why the rule is sharp enough to need no exemption register
 *
 * Back-to-back doc blocks are NOT the signal — that shape is usually fine and often correct: a module
 * docstring sits above the first declaration's docstring in dozens of files here. Matching on adjacency
 * alone reported 40+ hits, nearly all legitimate, which is how a guard earns a register of exemptions that
 * then rots.
 *
 * The signal is `@param` / `@returns`. Those tags document a CALLABLE. A module docstring does not carry
 * them, nor does a section header. So a block carrying one, whose next content is another doc block rather
 * than a declaration, documents nothing that exists — and there is no shape in which that is what the author
 * meant. ⛔ Hence NO exemption register: unlike `GOD_FILE_EXEMPTIONS` or `HOOK_EXEMPTIONS`, which rule on
 * known files, there is nothing here to rule on. A guard with nothing to exempt cannot drift.
 *
 * ⚠️ SUITES ARE IN SCOPE, unlike `databaseHandleSeam.test.ts`'s production-only rule. A cast in a test is a
 * different act from a cast in production (that guard's docstring argues why); a docstring attached to the
 * wrong function is the same act everywhere, and four of the thirteen were in test code.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repo root — this file sits at `packages/infra/global/__tests__/`. */
const REPO_ROOT = join(import.meta.dirname, '../../../..');

/**
 * Every TypeScript file the repo tracks.
 *
 * DISCOVERED from git rather than enumerated, so a package added later is in scope without an edit here —
 * the same discipline `oneHookPerFile.test.ts` and `databaseHandleSeam.test.ts` use.
 *
 * @returns Repo-relative paths.
 * @sideEffect Runs `git ls-files`.
 */
function trackedTypeScript(): readonly string[] {
    return (
        execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { cwd: REPO_ROOT, encoding: 'utf8' })
            .split('\n')
            .filter((path) => path.length > 0 && !path.includes('/dist/'))
            // ⚠️ `git ls-files` reads the INDEX, which lists a file deleted from the working tree until that
            // deletion is staged — a normal mid-refactor state. Without this the guard dies with an ENOENT
            // stack trace naming a file the author has just deleted on purpose, which reads as a broken guard
            // rather than as "nothing to check here". An absent file declares no doc block.
            .filter((path) => existsSync(join(REPO_ROOT, path)))
    );
}

/** Every JSDoc block in a file, with the offset just past its closing delimiter. Pure. */
function docBlocks(text: string): readonly { readonly block: string; readonly end: number }[] {
    return [...text.matchAll(/\/\*\*[\s\S]*?\*\//gu)].map((match) => ({
        block: match[0],
        end: (match.index ?? 0) + match[0].length,
    }));
}

/**
 * The 1-based line numbers of doc blocks in `text` that document a callable but are attached to no
 * declaration — the next thing after them is another doc block.
 *
 * @param text - The file's source.
 * @returns One line number per orphan, ascending. Pure.
 */
export function orphanedDocBlocks(text: string): readonly number[] {
    const orphans: number[] = [];

    for (const { block, end } of docBlocks(text)) {
        if (!block.includes('@param') && !block.includes('@returns')) {
            // Not a callable's documentation, so adjacency says nothing — see the module docstring.
            continue;
        }

        if (
            text
                .slice(end)
                .replace(/^[\s]*/u, '')
                .startsWith('/**')
        ) {
            orphans.push(text.slice(0, end - block.length).split('\n').length);
        }
    }

    return orphans;
}

describe('a doc block that documents a function is attached to one', () => {
    it('discovers the tree — an empty scan would pass everything below', () => {
        expect(trackedTypeScript().length).toBeGreaterThan(500);
    });

    it('finds documented callables at all, so the rule below is not passing over an empty set', () => {
        // ⛔ THE NON-VACUITY FLOOR. `orphanedDocBlocks` answering "none" everywhere — a changed comment
        // style, a broken regex — satisfies the rule perfectly while proving nothing. This repo documents
        // its functions heavily; if the population of `@param`/`@returns` blocks collapses, that is the
        // detector failing rather than the tree improving.
        const documented = trackedTypeScript().reduce(
            (count, path) =>
                count +
                docBlocks(readFileSync(join(REPO_ROOT, path), 'utf8')).filter(
                    ({ block }) => block.includes('@param') || block.includes('@returns'),
                ).length,
            0,
        );

        expect(documented).toBeGreaterThan(1000);
    });

    it('detects the shape it claims to — proven on the real defect, not just on the tree', () => {
        // The `form/model.ts` case, reduced. Without this, a regex that matches nothing would pass the rule
        // below and only the floor above would notice — and the floor counts a different population.
        const orphaned = [
            '/**',
            ' * Map a form line to a NutritionLine.',
            ' *',
            ' * @param line - The line.',
            ' * @returns The nutrition line.',
            ' */',
            '/** Something else entirely. @returns A quantity. */',
            'export const draftQuantity = (line: Line) => absent;',
        ].join('\n');

        expect(orphanedDocBlocks(orphaned)).toEqual([1]);

        // …and it does NOT fire on the legitimate shape: a module docstring above a documented function.
        const fine = [
            '/**',
            ' * @module recipes/form — the recipe draft.',
            ' */',
            '/**',
            ' * Sum the times.',
            ' *',
            ' * @param a - Prep.',
            ' * @returns The total.',
            ' */',
            'export const total = (a: number) => a;',
        ].join('\n');

        expect(orphanedDocBlocks(fine)).toEqual([]);
    });

    it('⛔ no doc block documents a function it is not attached to', () => {
        const offenders = trackedTypeScript().flatMap((path) =>
            orphanedDocBlocks(readFileSync(join(REPO_ROOT, path), 'utf8')).map((line) => `${path}:${line}`),
        );

        expect(offenders).toEqual([]);
    });
});
