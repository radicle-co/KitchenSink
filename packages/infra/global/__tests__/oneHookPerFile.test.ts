// @vitest-environment node
/**
 * Repo-wide guard: **one React hook per file.**
 *
 * ## Why this is separate from `oneFileOneThing.test.ts`
 *
 * That guard implements the same principle — CODING_STANDARDS §1, a file does ONE thing — but its subject is
 * exported **classes** and **components**, counted per file. A hook is a plain function, so it is invisible to
 * it, and the gap was not theoretical: `packages/clients/recipe-service/src/hooks.ts` reached **1,222 lines
 * and 49 hooks** while passing that guard, because it contained `classes: 0, components: 0`.
 *
 * ⛔ THE LESSON IS ABOUT THE SHAPE OF THE MISS, not the file. A rule enforced for two kinds of export, on a
 * principle stated for all of them, reads as fully enforced — the census says zero violations and the census
 * is telling the truth about the question it asked. Fixing the one file by hand and leaving the rule alone
 * would have been fixing an instance and leaving its class open, which is the criticism this work levelled at
 * the codebase before it noticed it was doing the same thing.
 *
 * ## What counts as a hook
 *
 * React's own naming convention makes this precise rather than a judgement call: an exported function whose
 * name begins `use` followed by an upper-case letter. So the threshold is not arbitrary — it is the same
 * `>= 2` rule the sibling guard applies to classes, over a kind that is syntactically identifiable.
 *
 * ⚠️ A RE-EXPORT BARREL IS NOT A VIOLATION, and that distinction is the whole reason the cure works: after a
 * split, `hooks.ts` still names all 49 on the published `./hooks` subpath, because it must — consumers import
 * from `@kitchensink/recipe-service-client/hooks` and a package export is a contract. A barrel DECLARES no
 * hook; it forwards. `export … from` is therefore not counted, and only a local declaration is.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repo root — this file sits at `packages/infra/global/__tests__/`. */
const REPO_ROOT = join(import.meta.dirname, '../../../..');

/**
 * Every tracked front-end source file — the only places a hook can live.
 *
 * DISCOVERED from git, so a package added later is in scope without an edit here.
 *
 * @returns Repo-relative paths.
 * @sideEffect Runs `git ls-files`.
 */
function frontEndSources(): readonly string[] {
    return execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(
            (path) =>
                path.length > 0 &&
                !path.includes('/dist/') &&
                !path.includes('/.claude/') &&
                !path.includes('/__tests__/') &&
                !path.includes('/__testing__/') &&
                !path.includes('/__fixtures__/') &&
                !path.includes('/tests/') &&
                !/\.(?:test|spec)\.tsx?$/u.test(path),
        );
}

/**
 * Every hook a file DECLARES locally — `export … from` re-exports excluded.
 *
 * @param text - The file's source.
 * @returns The hook names, in source order. Pure.
 */
function declaredHooks(text: string): readonly string[] {
    const withoutComments = text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

    return [...withoutComments.matchAll(/^export (?:async )?(?:function|const) (use[A-Z][A-Za-z0-9_]*)/gmu)].map(
        (match) => match[1] as string,
    );
}

/** One file allowed to declare more than one hook, with the ruling that allows it. */
interface HookExemption {
    /** Repo-relative path. */
    readonly file: string;
    /** EXACT number of hooks it declares — so an exempted file that grows a further hook still fails. */
    readonly hooks: number;
    /** Why splitting would make it worse. Substantive, or `validateExemptions` rejects it. */
    readonly why: string;
}

/**
 * The register.
 *
 * ⛔ EVERY ENTRY PINS AN EXACT COUNT, so an exemption is a ruling about a known file rather than a permanent
 * licence: adding a third hook to a file exempted at two fails this guard and needs its own argument. Same
 * discipline as `oneFileOneThing.test.ts`'s `GOD_FILE_EXEMPTIONS`.
 *
 * ⚠️ There is exactly one legitimate reason to sit here, and it is not "this file is fine": it is that the
 * hooks share module-PRIVATE state, so splitting them would force that state to be exported — trading a
 * one-file-two-hooks violation for a wider public surface, which is a worse outcome by the rule's own logic.
 */
const HOOK_EXEMPTIONS: readonly HookExemption[] = [
    {
        file: 'packages/apps/commise/i18n/src/react.tsx',
        hooks: 2,
        why:
            'useLocale reads the module-private LocaleContext and useMessages resolves against it; splitting ' +
            'them would have to export that context, widening the public surface to satisfy a file-count rule. ' +
            'The same reasoning keeps recipe-service-client’s provider, its props type and its context reader ' +
            'together in one file.',
    },
];

/**
 * Reasons that are missing, too short to be a ruling, or attached to no file.
 *
 * @param exemptions - The register.
 * @returns One message per problem; empty when every entry rules on something. Pure.
 */
export function validateExemptions(exemptions: readonly HookExemption[]): readonly string[] {
    const problems: string[] = [];

    for (const exemption of exemptions) {
        if (exemption.why.trim().split(/\s+/u).length < 12) {
            problems.push(`${exemption.file} — \`why\` is missing or too short to be a ruling`);
        }

        if (exemption.hooks < 2) {
            problems.push(`${exemption.file} — exempted at ${exemption.hooks} hooks, which breaks no rule`);
        }
    }

    return problems;
}

describe('one hook per file', () => {
    it('discovers the tree — an empty scan would pass everything below', () => {
        const files = frontEndSources();

        expect(files.length).toBeGreaterThan(500);
    });

    it('finds the hooks at all, so the rule below is not passing over an empty set', () => {
        // ⛔ THE NON-VACUITY FLOOR. `declaredHooks` returning nothing everywhere — a broken regex, a changed
        // export style — satisfies the rule perfectly while proving nothing. This repo has many hooks; if the
        // count collapses, that is the detector failing, not the tree improving.
        const total = frontEndSources().reduce(
            (count, path) => count + declaredHooks(readFileSync(join(REPO_ROOT, path), 'utf8')).length,
            0,
        );

        expect(total).toBeGreaterThan(40);
    });

    it('every exemption is a ruling — a reason, substantive, about a file that breaks the rule', () => {
        expect(validateExemptions(HOOK_EXEMPTIONS)).toEqual([]);
    });

    it('⛔ no file DECLARES more than one hook, after exemptions', () => {
        const ruled = new Map(HOOK_EXEMPTIONS.map((exemption) => [exemption.file, exemption.hooks]));

        const offenders = frontEndSources()
            .map((path) => [path, declaredHooks(readFileSync(join(REPO_ROOT, path), 'utf8'))] as const)
            .filter(([path, hooks]) => hooks.length > 1 && ruled.get(path) !== hooks.length)
            .map(([path, hooks]) =>
                ruled.has(path)
                    ? `${path} — GREW to ${hooks.length} hooks past its exemption at ${ruled.get(path) ?? 0}`
                    : `${path} — declares ${hooks.length} hooks [${hooks.join(', ')}]`,
            );

        expect(offenders).toEqual([]);
    });

    it('names only files that exist, so a rename cannot silently drop an exemption', () => {
        for (const { file } of HOOK_EXEMPTIONS) {
            expect(() => readFileSync(join(REPO_ROOT, file), 'utf8'), file).not.toThrow();
        }
    });
});
