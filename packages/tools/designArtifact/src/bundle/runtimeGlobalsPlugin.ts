/**
 * @module bundle/runtimeGlobalsPlugin — keeps React out of the bundle. The artifact page loads React 18 itself, so
 * every `react` import resolves to a global instead of a second copy (two Reacts would split hook state).
 *
 * `window.__react` and `window.__jsx` are defined by `runtime/react18Bridge`, `window.ReactDOM` by the host page.
 *
 * @pattern Adapter — redirects module specifiers onto the host's runtime objects.
 */
import type { Plugin } from 'esbuild';

/** Module specifier to the expression that evaluates to its module at run time. */
export const RUNTIME_GLOBALS: Readonly<Record<string, string>> = {
    react: 'window.__react',
    'react-dom': 'window.ReactDOM',
    'react-dom/client': 'window.ReactDOM',
    'react/jsx-runtime': 'window.__jsx',
    'react/jsx-dev-runtime': 'window.__jsx',
};

const NAMESPACE = 'runtimeGlobal';

/**
 * The esbuild plugin that serves {@link RUNTIME_GLOBALS}.
 *
 * Only the exact specifiers in the table are claimed; any other `react…` import (for example `react-dom/server`)
 * resolves normally, and fails loudly if it cannot.
 *
 * @returns An esbuild plugin.
 */
export function runtimeGlobalsPlugin(): Plugin {
    return {
        name: 'runtimeGlobals',
        setup(build) {
            // Go regular expressions: esbuild rejects the JS `u` flag.
            build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) =>
                args.path in RUNTIME_GLOBALS ? { path: args.path, namespace: NAMESPACE } : undefined,
            );
            build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
                contents: `module.exports = ${RUNTIME_GLOBALS[args.path] ?? 'undefined'};`,
                loader: 'js',
            }));
        },
    };
}
