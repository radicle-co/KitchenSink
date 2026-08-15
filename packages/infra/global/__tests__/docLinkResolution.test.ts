/**
 * Guard: every TSDoc link in this repository resolves to a declaration.
 *
 * ## The defect this exists to prevent
 *
 * A link whose target does not resolve is dead text. No editor navigates it, no doc tool renders it, and
 * nothing tells the author — so it rots exactly like a stale ADR path, silently, and a symbol deleted in one
 * package leaves confident-looking references to it everywhere else. Measured at `abfc5549`, before the sweep
 * that landed with this guard: **360 dead references in 244 of 808 link-bearing files**, in five classes.
 *
 *   1. `import('./x.js').Y` (145) — the repo's own idiom for naming a symbol without importing it, and it has
 *      never resolved: the JSDoc parser stops the entity name at the `(`.
 *   2. A bare name that is not in scope (172) — a sibling interface member, a barrel's own re-export (an
 *      `export … from` creates no local binding), a CDK construct ID, a SQL constraint name.
 *   3. A target pushed onto the next comment line (14) — the parser reads the leading `*` as the target.
 *   4. TSDoc's `./module.js!member` declaration reference or a bare path (12) — TypeScript implements neither.
 *   5. An opener in a `//` comment, or after `@returns` where JSDoc reads the braces as a TYPE (17).
 *
 * ⚠️ The remedy for class 2 is BACKTICKS, not an import. An import that exists only for a docstring passes
 * `tsc` (JSDoc counts as a use for `noUnusedLocals`) and then FAILS lint — `@typescript-eslint/no-unused-vars`
 * has no JSDoc awareness. Measured against this repo's config, so nobody re-litigates it.
 *
 * ## Why the fixture cannot defeat the guard
 *
 * A gate whose own explanation trips it gets deleted rather than fixed, and this branch has had seven. The
 * fixture below is a string literal holding a deliberately dead link, and the verdict comes from the PARSER —
 * a string literal is not a comment, so the fixture is invisible to the check it proves. That is asserted, not
 * assumed: `the fixture cannot be reported` pins it, and non-vacuity is asserted BEFORE the invariant.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    analyzeRepoDocLinks,
    collectDocLinks,
    discoverDocLinkUnits,
    repoRoot,
    unresolvedDocLinks,
} from './docLinks.js';
import type { DocLink } from './docLinks.js';

/** This guard's own repo-relative path — the subject of the self-match assertions. */
const SELF = path
    .relative(repoRoot, fileURLToPath(import.meta.url))
    .split(path.sep)
    .join('/');

/**
 * A synthetic module exercising every form the guard classifies, so the DECISION is proven without the working
 * tree — the mutation lens: one dead entity link, one dead import-type link, one link on the wrong line, one
 * URL, and resolvable links that must stay green.
 */
const FIXTURE = `
import type { Recipe } from './other.js';

/**
 * Resolvable: {@link Recipe} and {@link localValue} and {@link Recipe.title}.
 * Dead: {@link NoSuchSymbol}.
 * Dead import form: {@link import('./other.js').Recipe}.
 * Exempt: {@link https://example.com | the spec}.
 * Wrapped, so the target lands on the next line: {@link
 * localValue}.
 */
export const localValue = 1;
`;

/** The imported module the fixture resolves against. */
const FIXTURE_IMPORT = `export interface Recipe { title: string }\n`;

/**
 * Compile the fixture in memory and read its links.
 *
 * In memory rather than as a committed file on purpose: a fixture ON DISK would be discovered by the guard
 * itself and would have to be exempted, and an exemption is the seam through which a real violation later
 * hides.
 *
 * @returns Every link the mechanism finds in the fixture.
 * @sideEffect Reads TypeScript's bundled lib files through the compiler host.
 */
function analyzeFixture(): readonly DocLink[] {
    // Virtual names in the REAL repo root: module resolution walks the directory for a `package.json`, so a
    // fabricated directory leaves `./other.js` unresolvable and every imported target would read as dangling —
    // the exact false positive this fixture exists to rule out.
    const files = new Map([
        [path.join(repoRoot, 'docLinkFixture.ts'), FIXTURE],
        [path.join(repoRoot, 'other.ts'), FIXTURE_IMPORT],
    ]);
    const options: ts.CompilerOptions = {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
    };
    const host = ts.createCompilerHost(options, true);
    const readReal = host.readFile.bind(host);
    const existsReal = host.fileExists.bind(host);

    host.readFile = (fileName) => files.get(fileName) ?? readReal(fileName);
    host.fileExists = (fileName) => files.has(fileName) || existsReal(fileName);

    host.getSourceFile = (fileName, languageVersion) => {
        const overlay = files.get(fileName);

        return overlay === undefined
            ? ts.createSourceFile(fileName, readReal(fileName) ?? '', languageVersion, true)
            : ts.createSourceFile(fileName, overlay, languageVersion, true);
    };

    return collectDocLinks(ts.createProgram([...files.keys()], options, host), [
        path.join(repoRoot, 'docLinkFixture.ts'),
    ]);
}

describe('doc-link resolution mechanism', () => {
    const fixtureLinks = analyzeFixture();

    it('is not vacuous: the fixture yields one link per form', () => {
        expect(fixtureLinks.map((link) => link.form).sort()).toEqual([
            'entity',
            'entity',
            'entity',
            'entity',
            'importType',
            'unparsed',
            'url',
        ]);
    });

    it('reports the dead entity link, the dead import form, and the wrapped target', () => {
        expect(unresolvedDocLinks(fixtureLinks).map((link) => `${link.form}:${link.target}`)).toEqual([
            'entity:NoSuchSymbol',
            "importType:import('./other.js').Recipe",
            'unparsed:* localValue',
        ]);
    });

    it('leaves an imported, a local, a qualified and a URL target green', () => {
        const green = fixtureLinks.filter((link) => link.resolved).map((link) => link.target);

        expect(green).toEqual(['Recipe', 'localValue', 'Recipe.title', 'https://example.com | the spec']);
    });
});

describe('doc links across the repository', () => {
    const units = discoverDocLinkUnits();
    const discovered = units.flatMap((unit) => unit.files);

    /** One repo-wide analysis shared by both assertions below — 33 programs, ~20s, not worth building twice. */
    let analyzed: readonly DocLink[] | undefined;
    const repoLinks = (): readonly DocLink[] => (analyzed ??= analyzeRepoDocLinks());

    it('is not vacuous: it discovers the whole tree, including this guard', () => {
        expect(units.length).toBeGreaterThan(20);
        expect(discovered.length).toBeGreaterThan(600);
        expect(discovered).toContain(SELF);
        expect(discovered).toContain('packages/infra/global/__tests__/docLinks.ts');
    });

    /**
     * JavaScript is in scope, and this pins it. The gate shipped `.ts`/`.tsx` only, which left six links in five
     * files outside it — measured, then closed by `allowJs` rather than by writing the exemption down, because a
     * dead link in a `.mjs` build script rots exactly like one in a `.ts` module. One file per owning-tsconfig
     * shape is asserted: a package-owned `.js`, and a repo-root `.mjs` that falls through to the root config.
     */
    it('covers JavaScript too, under both the package and the root tsconfig', () => {
        expect(discovered).toContain('packages/services/identity/tests/load/lib/common.js');
        expect(discovered).toContain('packages/tools/eslint/__tests__/nativeA11y.test.js');
        expect(discovered).toContain('scripts/contractOwners.mjs');
    });

    it('the fixture cannot be reported: this file holds a dead link in a string, and is clean', () => {
        const mechanism = 'packages/infra/global/__tests__/docLinks.ts';

        // Positive control: the mechanism's own docstrings carry real links, so "no findings" cannot mean
        // "these two files were never parsed".
        expect(repoLinks().filter((link) => link.file === mechanism).length).toBeGreaterThan(0);
        expect(readFileSync(path.join(repoRoot, SELF), 'utf8')).toContain('NoSuchSymbol');
        expect(unresolvedDocLinks(repoLinks()).filter((link) => link.file === SELF)).toEqual([]);
    }, 600_000);

    it('has no link a reader cannot follow', () => {
        expect(
            unresolvedDocLinks(repoLinks()).map((link) => `${link.file}:${link.line} [${link.form}] ${link.target}`),
            'A TSDoc link must resolve to a declaration. Use backticks (never an import added for the docstring — ' +
                'it fails lint) or fix the target.',
        ).toEqual([]);
    }, 600_000);
});
