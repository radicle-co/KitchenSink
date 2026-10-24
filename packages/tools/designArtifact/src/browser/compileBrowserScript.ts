/**
 * @module browser/compileBrowserScript — turns a TypeScript module that runs on the host page into the classic
 * script text the artifact inlines.
 *
 * Browser code is written as real, type-checked modules (DOM lib) instead of JavaScript inside a template string,
 * so `tsc`, ESLint and CodeQL see it and its pure parts can be imported by a test. This is the one place that
 * compiles it, with the same esbuild path `cards/compileCard` uses.
 *
 * @pattern Adapter — esbuild behind a one-function interface.
 */
import { buildSync } from 'esbuild';

import { describeFailure } from '../bundle/describeFailure.js';
import { PACKAGE_ROOT } from '../config.js';
import { DesignArtifactError } from '../errors.js';

/**
 * Compiles a browser entry module and everything it imports to one IIFE.
 *
 * It is synchronous because the callers hold the result as a module constant (the entry never changes while the
 * process runs) and the work is a few milliseconds of esbuild over a handful of small files.
 *
 * @param entry - Absolute path of the `.ts` entry. It must not import product code or `react`.
 * @returns `(() => { … })();`, a classic script with nothing left to resolve.
 * @throws DesignArtifactError `bundle-failed` when the entry or an import does not compile or does not exist.
 * @sideEffect Reads the entry and its imports from disk.
 */
export function compileBrowserScript(entry: string): string {
    try {
        const result = buildSync({
            entryPoints: [entry],
            bundle: true,
            format: 'iife',
            platform: 'browser',
            target: 'es2020',
            write: false,
            logLevel: 'silent',
            absWorkingDir: PACKAGE_ROOT,
        });
        const output = result.outputFiles[0];

        if (output === undefined) {
            throw new Error('esbuild produced no output file.');
        }

        return output.text;
    } catch (error) {
        throw new DesignArtifactError(
            'bundle-failed',
            `Browser script ${entry} failed to compile:\n${describeFailure(error)}`,
        );
    }
}
