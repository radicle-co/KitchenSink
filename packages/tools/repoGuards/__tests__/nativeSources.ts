/**
 * NATIVE-SOURCE DISCOVERY: every app module that renders on a phone. Written once, here, because a guard that silently
 * stops reading a file passes vacuously forever (`appSources.ts`), and the native guards had each grown their own glob.
 *
 * A module is native when it is a `.native.ts(x)` leaf anywhere in the apps, when it belongs to the mobile app (its
 * `src/` and its root `App.tsx`), or when it imports a value from `react-native` (a shared module with no web sibling).
 * Exclusions are `appSourceModules`' own: tests, fixtures and build output.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { appSourceModules, parseModule } from './appSources.js';
import { repoRoot } from './serviceSources.js';

const MOBILE_APP = /^packages\/apps\/commise\/mobile\/(?:src\/|App\.tsx$)/u;

function importsReactNativeValue(file: ts.SourceFile): boolean {
    return file.statements.some(
        (statement) =>
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            statement.moduleSpecifier.text === 'react-native' &&
            statement.importClause !== undefined &&
            !statement.importClause.isTypeOnly,
    );
}

/**
 * The native app modules.
 *
 * @returns Repo-relative paths, sorted.
 * @sideEffect Shells out to git and reads the working tree.
 */
export function nativeSources(): readonly string[] {
    return appSourceModules().filter(
        (file) =>
            /\.native\.tsx?$/u.test(file) ||
            MOBILE_APP.test(file) ||
            importsReactNativeValue(parseModule(file, readFileSync(path.join(repoRoot, file), 'utf8'))),
    );
}
