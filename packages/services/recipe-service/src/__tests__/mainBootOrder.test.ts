/**
 * Boot ORDER for `src/main.ts` — specifically, that the drift-layer-3 skew assertion really is the first thing
 * the process does.
 *
 * WHY THIS IS A SOURCE-TEXT TEST AND NOT A BEHAVIOURAL ONE. The guarantee is a property of the ES MODULE GRAPH,
 * not of a function: every static import is evaluated before a single statement of `main.ts`'s body, and
 * `config/config.module.ts` calls `ConfigModule.forRoot({ validate })` inside its `@Module` decorator argument,
 * so importing `app.module.js` statically validates the environment during loading. Measured — with the static
 * form and a broken environment, `ConfigValidationError` is thrown out of the ESM loader and
 * `assertContractHashesAgree` never runs at all, wherever it sits in the body. Executing `main.ts` in a test to
 * observe that would mean booting a real Nest app with a real pool, which is both slow and the wrong tier.
 *
 * So the invariant is checked where it lives: `main.ts` must NOT statically import `./app.module.js`. This is
 * the exact hazard a well-meaning cleanup or an import-sorting rule introduces silently, which is why it is
 * pinned rather than left to the comment above the import.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../main.ts'), 'utf8');

/** `main.ts` with comments stripped, so a specifier mentioned in prose is not mistaken for an import. */
const codeOnly = mainSource.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');

describe('src/main.ts boot order', () => {
    it('is not vacuous — the file really does reference the app module and the assertion', () => {
        expect(codeOnly).toContain('app.module.js');
        expect(codeOnly).toContain('assertContractHashesAgree');
    });

    it('does NOT statically import ./app.module.js, which would validate config before the skew check', () => {
        expect(codeOnly).not.toMatch(/^\s*import\s[^;]*from\s+['"]\.\/app\.module\.js['"]/mu);
    });

    it('loads the app module through a dynamic import instead', () => {
        expect(codeOnly).toMatch(/await import\(['"]\.\/app\.module\.js['"]\)/u);
    });

    it('asserts the contract hashes BEFORE it loads the app module', () => {
        const assertionAt = codeOnly.indexOf('assertContractHashesAgree(CONTRACT_HASH');
        const importAt = codeOnly.indexOf("await import('./app.module.js')");

        expect(assertionAt).toBeGreaterThan(-1);
        expect(importAt).toBeGreaterThan(-1);
        expect(assertionAt).toBeLessThan(importAt);
    });
});
