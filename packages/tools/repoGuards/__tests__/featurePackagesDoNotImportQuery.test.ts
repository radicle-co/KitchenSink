/**
 * No `@commise/features-*` package imports `@commise/query` — asserted by DISCOVERY, never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. The two packages are declared independent of each other (`features/recipes/src/refresh/model.ts`,
 * `query/src/useRefreshNotice.ts`): a feature states the shape of a read boundary, a refresh notice or a recovery signal
 * STRUCTURALLY and the app hands in the real one through a port. A feature that imports the query package instead couples
 * the two for good, and nothing but a reviewer noticed it happen: the discovery screen did exactly that while three
 * sibling files documented the rule.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidates come from the FILESYSTEM (every source file under a feature's `src`, test files
 * included — a test that builds its boundary from `@commise/query` still ties the package to it). A string literal is
 * checked rather than an import declaration, so `vi.mock('@commise/query/boundary')` and `import('@commise/query')` are
 * caught as well, and a comment that merely NAMES the package is not.
 *
 * ✅ THE FIX FOR A FAILURE: declare the shape the feature needs structurally, add the hook or component to the feature's
 * platform port, and let the app supply it (see `DiscoveryPlatform.useRefreshNotice`).
 *
 * ⛔ NOR DOES ITS PRODUCTION SOURCE READ CONNECTIVITY. `@commise/query`'s `useIsOffline` is the one reader of TanStack's
 * `onlineManager`, and a feature that subscribes to the singleton itself is a second reader that can drift from it (the
 * food page once carried a copy). A feature takes connectivity from its host, or derives it from a read or write TanStack
 * paused. The check is on the IDENTIFIER, so a comment that names `onlineManager` (as `signOutAndVerify.ts`'s does,
 * describing what the app passes in) is not a reference, and test files, which drive connectivity, are out of scope.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isTestFile, parse, repoRoot, stringLiterals, visit } from './serviceSources.js';

const QUERY_PACKAGE = /^@commise\/query(\/|$)/u;

/** Whether a source file names `@commise/query` (or a sub-path of it) in a string literal. */
const reachesQueryPackage = (source: string): boolean =>
    stringLiterals({ file: 'fixture.ts', contents: source }).some((literal) => QUERY_PACKAGE.test(literal));

/** Whether a source file references TanStack's `onlineManager` in code (an import, a call or a property access). */
const readsConnectivity = (source: string): boolean => {
    let found = false;

    visit(parse({ file: 'fixture.ts', contents: source }), (node) => {
        found ||= ts.isIdentifier(node) && node.text === 'onlineManager';
    });

    return found;
};

const featureSourceFiles = (): readonly string[] =>
    globSync('packages/apps/commise/features/*/src/**/*.{ts,tsx}', {
        cwd: repoRoot,
        ignore: ['**/node_modules/**', '**/dist/**'],
    }).sort();

describe('the detector', () => {
    const cases: readonly (readonly [string, string, boolean])[] = [
        ['a named import', "import { useRefreshNotice } from '@commise/query/refresh-notice';", true],
        ['a type-only import', "import type { QueryBoundaryProps } from '@commise/query/boundary';", true],
        ['the bare package', "import { x } from '@commise/query';", true],
        ['a re-export', "export { y } from '@commise/query/recovery-signal';", true],
        ['a test mock', "vi.mock('@commise/query/boundary', () => ({}));", true],
        ['a dynamic import', "const m = await import('@commise/query/sync');", true],
        ['a comment that names it', "// @commise/query is not imported here\nimport { a } from './a.js';", false],
        ['a doc block that names it', "/** `@commise/query`'s hook */\nexport const a = 1;", false],
        ['a sibling package with the prefix', "import { z } from '@commise/query-extras';", false],
        ['an unrelated package', "import { z } from '@commise/ui/modal';", false],
    ];

    it.each(cases)('%s', (_name, source, expected) => {
        expect(reachesQueryPackage(source)).toBe(expected);
    });
});

describe('the feature packages', () => {
    it('discovers the feature sources (a vacuous pass would hide the rule below)', () => {
        expect(featureSourceFiles().length).toBeGreaterThan(100);
    });

    it('import @commise/query nowhere', () => {
        const offenders = featureSourceFiles().filter((file) =>
            reachesQueryPackage(readFileSync(path.join(repoRoot, file), 'utf8')),
        );

        expect(offenders).toEqual([]);
    });
});

describe('the connectivity detector', () => {
    const cases: readonly (readonly [string, string, boolean])[] = [
        ['a named import', "import { onlineManager } from '@tanstack/react-query';", true],
        ['a namespace access', "import * as rq from '@tanstack/react-query';\nrq.onlineManager.isOnline();", true],
        ['a call on the singleton', 'const online = onlineManager.isOnline();', true],
        ['a comment that names it', '// the app passes `onlineManager.isOnline`\nexport const a = 1;', false],
        ['a doc block that names it', '/** reads `onlineManager` */\nexport const a = 1;', false],
        ['a string that names it', "const label = 'onlineManager';", false],
        ['the focus singleton', "import { focusManager } from '@tanstack/react-query';", false],
    ];

    it.each(cases)('%s', (_name, source, expected) => {
        expect(readsConnectivity(source)).toBe(expected);
    });
});

describe('the feature packages’ production source', () => {
    it('reads connectivity nowhere: the host hands it in', () => {
        const offenders = featureSourceFiles()
            .filter((file) => !isTestFile(file))
            .filter((file) => readsConnectivity(readFileSync(path.join(repoRoot, file), 'utf8')));

        expect(offenders).toEqual([]);
    });
});
