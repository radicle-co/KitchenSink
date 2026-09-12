/**
 * THE PRECONDITION BEHIND THE CORS POLICY: this service authenticates from `Authorization: Bearer` ONLY, and
 * reads no ambient credential anywhere.
 *
 * `src/config/cors.ts` admits a whole family of origins on non-prod (the anchored `CLERK_AZP_PATTERN`) and every
 * loopback origin in local development. That is only survivable because a page at a matching origin has NOTHING
 * to ride: there is no cookie, no `__session`, no session store, so a cross-origin request carries no credential
 * unless its author already holds a bearer token — in which case CORS was never the control. The moment one
 * route reads a cookie, the same policy becomes a real CSRF/credential-theft surface.
 *
 * A precondition that lives only in a comment is a precondition nobody will re-check. This file re-checks it on
 * every run, over the whole of `src/`.
 *
 * ⚠️ IT PARSES, IT DOES NOT GREP — and that is not fastidiousness, it is a bug already made twice in this
 * repository: a gate defeated by the PROSE explaining it, because the docstring contains the very words the
 * check searches for. `config/cors.ts` says `req.cookies` in its own docstring, this file says it several times,
 * and a substring scan would flag both. So the scan runs over the TypeScript AST: comments and string literals
 * are not nodes it looks at, and only a real property access or a real import can trip it. The pure detector is
 * exercised against synthetic sources below, INCLUDING the case where the forbidden text appears only in a
 * comment — so the parse-not-grep property is itself tested rather than asserted.
 *
 * @module
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

/** `src/`, absolute. `import.meta.dirname` is the package's `tests/` directory. */
const SRC_ROOT = join(import.meta.dirname, '../src');

/**
 * Property names that name an ambient (browser-supplied, non-bearer) credential. A read of any of these off any
 * expression means something other than the `Authorization` header is being trusted.
 */
const AMBIENT_CREDENTIAL_PROPERTIES = new Set(['cookie', 'cookies', 'signedCookies', 'session']);

/** Packages whose presence means cookie parsing has been introduced. */
const COOKIE_PACKAGES = new Set(['cookie', 'cookie-parser', 'express-session', 'cookie-session']);

/** One place a source file touches an ambient credential. */
interface AmbientCredentialUse {
    /** What was found, e.g. `req.cookies` or `import 'cookie-parser'`. */
    readonly what: string;
    /** 1-based line number. */
    readonly line: number;
}

/**
 * Find every ambient-credential access in one TypeScript source, by walking its AST. Pure.
 *
 * Detects `x.cookies` / `x['cookies']` (any receiver, at any depth) and an import of a cookie/session package.
 * Comments and string literals are never inspected, so prose about cookies — including this file's own — cannot
 * produce a finding.
 *
 * @param fileName - Used only for the parser's diagnostics.
 * @param source - The file's text.
 * @returns Every use found, in source order.
 */
export function findAmbientCredentialUses(fileName: string, source: string): AmbientCredentialUse[] {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const found: AmbientCredentialUse[] = [];

    const lineOf = (node: ts.Node): number =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && AMBIENT_CREDENTIAL_PROPERTIES.has(node.name.text)) {
            found.push({ what: `${node.expression.getText(sourceFile)}.${node.name.text}`, line: lineOf(node) });
        }

        if (
            ts.isElementAccessExpression(node) &&
            ts.isStringLiteralLike(node.argumentExpression) &&
            AMBIENT_CREDENTIAL_PROPERTIES.has(node.argumentExpression.text)
        ) {
            found.push({
                what: `${node.expression.getText(sourceFile)}['${node.argumentExpression.text}']`,
                line: lineOf(node),
            });
        }

        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteralLike(node.moduleSpecifier) &&
            COOKIE_PACKAGES.has(node.moduleSpecifier.text)
        ) {
            found.push({ what: `import '${node.moduleSpecifier.text}'`, line: lineOf(node) });
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return found;
}

/** Every non-test `.ts` file under `src/`, as `{ path, source }`. */
async function readSourceFiles(directory: string): Promise<Array<{ path: string; source: string }>> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: Array<{ path: string; source: string }> = [];

    for (const entry of entries) {
        const full = join(directory, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === '__tests__') {
                continue;
            }

            files.push(...(await readSourceFiles(full)));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            files.push({ path: full, source: await readFile(full, 'utf8') });
        }
    }

    return files;
}

const sourceFiles = await readSourceFiles(SRC_ROOT);

describe('the detector parses rather than greps', () => {
    it('finds a real cookie read', () => {
        expect(findAmbientCredentialUses('x.ts', 'const t = req.cookies["__session"];')).toContainEqual({
            what: 'req.cookies',
            line: 1,
        });
    });

    it('finds a bracketed cookie read', () => {
        expect(findAmbientCredentialUses('x.ts', "const t = request['cookies'];")).toContainEqual({
            what: "request['cookies']",
            line: 1,
        });
    });

    it('finds a cookie-parser import', () => {
        expect(findAmbientCredentialUses('x.ts', "import cookieParser from 'cookie-parser';")).toContainEqual({
            what: "import 'cookie-parser'",
            line: 1,
        });
    });

    // ⛔ THE PROPERTY THAT MAKES THIS GATE TRUSTWORTHY. A substring scan reports all four of these.
    it.each([
        ['a block comment', '/** Reads req.cookies — do not. */\nexport const a = 1;'],
        ['a line comment', '// never read req.cookies here\nexport const a = 1;'],
        ['a string literal', "export const message = 'req.cookies is forbidden';"],
        ['a template literal', 'export const message = `cookies: ${1}`;'],
    ])('reports nothing when the text appears only in %s', (_label, source) => {
        expect(findAmbientCredentialUses('x.ts', source)).toEqual([]);
    });

    it('is not fooled by an unrelated property that merely contains the word', () => {
        expect(findAmbientCredentialUses('x.ts', 'const a = policy.cookiePolicyName;')).toEqual([]);
    });
});

describe('identity service — bearer-only precondition', () => {
    it('scanned a non-trivial number of source files (non-vacuity)', () => {
        expect(sourceFiles.length).toBeGreaterThan(20);
    });

    it('reads no ambient credential anywhere in src/', () => {
        const findings = sourceFiles.flatMap(({ path, source }) =>
            findAmbientCredentialUses(path, source).map(
                (use) => `${relative(SRC_ROOT, path).split(sep).join('/')}:${use.line} — ${use.what}`,
            ),
        );

        // If this fails, DO NOT delete the assertion. Read `src/config/cors.ts`'s precondition note first: a
        // route that reads an ambient credential makes the non-prod origin policy exploitable, and the policy
        // must be tightened in the same change that introduces the read.
        expect(findings).toEqual([]);
    });

    it('declares no cookie or session package as a dependency', async () => {
        const manifest = JSON.parse(await readFile(join(import.meta.dirname, '../package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

        expect(declared.filter((name) => COOKIE_PACKAGES.has(name))).toEqual([]);
    });
});
