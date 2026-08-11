/**
 * The BOOT ORDER guard for drift layer 3 (`docs/CODING_STANDARDS.md` §15.2.5).
 *
 * WHY THIS EXISTS AS A TEST RATHER THAN A COMMENT. The skew assertion in `main.ts` is only meaningful if it runs
 * before anything that can fail for a different reason. ES modules evaluate every static import before a single
 * statement of `main.ts`'s body runs, and this service's config module validates `process.env` at
 * MODULE-EVALUATION time — so a static `import { AppModule } from './app.module.js'` makes a broken environment
 * throw out of the ESM loader before `bootstrap()` is even entered, and the skew check can never be first no
 * matter where it is written. The dynamic import is what makes the ordering STRUCTURAL. This test is what stops
 * someone "tidying" it back.
 *
 * It reads the source TEXT deliberately. Importing `main.ts` would execute it — booting a real Nest app, opening
 * a database pool and binding a port — and the property under test is about static-vs-dynamic module linkage,
 * which is a fact about the source rather than about runtime behaviour.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** `main.ts`'s source text. `import.meta.dirname` is `src/contract/__tests__`, so `src` is two levels up. */
const source = await readFile(join(import.meta.dirname, '../../main.ts'), 'utf8');

/**
 * `main.ts` with comments stripped, so a specifier mentioned in PROSE is not mistaken for an import.
 *
 * Stripping first is what lets the negative assertion below be permissive about SPELLING without becoming a false
 * positive on the `// ⚠️` comment that explains why the static form is forbidden.
 */
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');

describe('main.ts boot order', () => {
    // Non-vacuity: the negative assertion below is satisfied by a file that does not mention the app module at
    // all, which would be a passing test over a boot sequence that no longer exists.
    it('is not vacuous — the file really does reference the app module and the assertion', () => {
        expect(codeOnly).toContain('app.module.js');
        expect(codeOnly).toContain('assertContractHashesAgree');
    });

    // The regression this file exists to prevent.
    //
    // ⚠️ THE NEGATIVE REGEX MUST NOT BE LINE-ANCHORED. It used to be
    // `/^import .*from '\.\/app\.module\.js';$/mu`, which requires the whole static import to sit on ONE line,
    // start at column 0, use single quotes and end in a semicolon. Prettier wraps an import the moment the clause
    // grows past the print width, so the exact regression this test exists to catch —
    //
    //     import {
    //         AppModule,
    //     } from './app.module.js';
    //
    // — would not match, while all the positive assertions kept passing. `[^;]*` spans newlines and `\s*`
    // tolerates indentation, so the shape is matched rather than one formatting of it.
    it('loads AppModule with a DYNAMIC import, never a static one', () => {
        expect(codeOnly).toMatch(/await import\(['"]\.\/app\.module\.js['"]\)/u);
        expect(codeOnly).not.toMatch(/^\s*import\s[^;]*from\s+['"]\.\/app\.module\.js['"]/mu);
    });

    it('asserts contract-hash agreement BEFORE loading AppModule', () => {
        const assertion = source.indexOf('assertContractHashesAgree(CONTRACT_HASH');
        const appModule = source.indexOf("await import('./app.module.js')");

        expect(assertion).toBeGreaterThan(-1);
        expect(appModule).toBeGreaterThan(-1);
        expect(assertion).toBeLessThan(appModule);
    });

    // A TAUTOLOGY IS THE FAILURE MODE HERE, and it is not hypothetical: this mutant survived the first version
    // of this suite. `assertContractHashesAgree(CONTRACT_HASH, CONTRACT_HASH)` type-checks, boots, and passes
    // forever — a fail-closed gate that can never fail is indistinguishable from no gate, and BOTH imports still
    // being present is not evidence that both are USED. So the call site is pinned exactly.
    it("passes the schema package's published stamp as the SECOND argument, not the service's own twice", () => {
        expect(source).toContain('assertContractHashesAgree(CONTRACT_HASH, SCHEMA_PACKAGE_CONTRACT_HASH);');
        expect(source).not.toContain('assertContractHashesAgree(CONTRACT_HASH, CONTRACT_HASH)');
    });

    it('binds SCHEMA_PACKAGE_CONTRACT_HASH to the generated leaf package, not to a local constant', () => {
        expect(source).toContain(
            "import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-food';",
        );
        expect(source).toContain("from './contract/contract-hash.js'");
    });
});
