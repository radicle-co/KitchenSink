/**
 * @module bundle/nativeFirstPlugin — makes the native build resolve like Metro: an import inside the Commise tree
 * of `Chip` loads `Chip.native.tsx` when it exists. The decision is `chooseNativeVariant`; this is the esbuild
 * wiring around it.
 *
 * @pattern Adapter — esbuild's resolver on one side, the pure variant policy on the other.
 */
import { existsSync } from 'node:fs';

import type { Plugin } from 'esbuild';

import { COMMISE_ROOT } from '../config.js';

import { chooseNativeVariant } from './chooseNativeVariant.js';

/** Marks the plugin's own inner `resolve` call so it does not recurse into itself. */
const INNER_RESOLVE = 'nativeFirst:inner';

/** Where the plugin looks, overridable so tests can use a temporary tree. */
export interface NativeFirstOptions {
    readonly root?: string;
    readonly exists?: (path: string) => boolean;
}

/**
 * The native-first resolution plugin.
 *
 * @param options - Tree root and file-existence check; default to the real Commise tree and the filesystem.
 * @returns An esbuild plugin.
 * @sideEffect Checks the filesystem for sibling files during a build.
 */
export function nativeFirstPlugin({ root = COMMISE_ROOT, exists = existsSync }: NativeFirstOptions = {}): Plugin {
    return {
        name: 'nativeFirst',
        setup(build) {
            // Go regular expressions: esbuild rejects the JS `u` flag.
            build.onResolve({ filter: /.*/ }, async (args) => {
                if (args.pluginData === INNER_RESOLVE || args.importer === '') {
                    return undefined;
                }

                const resolution = await build.resolve(args.path, {
                    importer: args.importer,
                    namespace: args.namespace,
                    resolveDir: args.resolveDir,
                    kind: args.kind,
                    pluginData: INNER_RESOLVE,
                });

                if (resolution.errors.length > 0) {
                    return undefined;
                }

                const chosen = chooseNativeVariant(args.importer, resolution.path, exists, root);

                return chosen === resolution.path ? undefined : { path: chosen };
            });
        },
    };
}
