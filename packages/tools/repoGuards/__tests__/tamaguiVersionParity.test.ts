/**
 * The Tamagui packages the guards read agree with the one the app runs (ADR-0080). The guards take their facts from
 * Tamagui itself: the shorthand table from `@tamagui/web`, the modifier aliases and state names from
 * `@tamagui/style-grammar`. If the installed `tamagui` moves and those two do not (a hoisting accident, a lockfile
 * edit, a caret range that resolves differently in two packages), the guards would read a table the app does not run.
 * Each version is the one RESOLVED from the package that imports it, never a string written here.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** The resolved `version` of a package, as `fromDir` sees it. */
function resolvedVersion(fromDir: string, name: string): string {
    const require = createRequire(path.join(repoRoot, fromDir, 'package.json'));
    const manifest = path.join(path.dirname(require.resolve(`${name}/package.json`)), 'package.json');
    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { readonly version?: unknown };

    if (typeof version !== 'string') {
        throw new Error(`${name} resolved from ${fromDir} has no version`);
    }

    return version;
}

describe('Tamagui version parity', () => {
    it('resolves tamagui for the app, and @tamagui/web and @tamagui/style-grammar for the guards, to ONE version', () => {
        const app = resolvedVersion('packages/apps/commise/ui', 'tamagui');
        const web = resolvedVersion('packages/tools/repoGuards', '@tamagui/web');
        const grammar = resolvedVersion('packages/tools/repoGuards', '@tamagui/style-grammar');

        expect({ web, grammar }).toEqual({ web: app, grammar: app });
    });
});
