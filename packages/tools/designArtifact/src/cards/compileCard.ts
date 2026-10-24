/**
 * @module cards/compileCard — bundles one card `.tsx` into a classic script that the preview page runs.
 *
 * The card's `react` imports resolve to the artifact runtime globals (`runtimeGlobalsPlugin`), so it shares the
 * page's React. Its imports of `@commise/*` must be `import type`: those are erased by the TypeScript transform,
 * and any that survives (a value import) is refused here, so the card can never carry a second copy of the
 * component code: it renders whatever `window.Commise` holds, which is the real bundle.
 *
 * A file that loads from inside the product tree (`packages/apps/commise`), by whatever route (a relative or absolute
 * path, or a `paths` alias), is refused just as a package import is: it would bundle a second copy of the component
 * code into the card, one that is not the copy in `window.Commise`.
 *
 * @pattern Adapter — esbuild behind a one-function interface; the plugin is a guard (fail closed).
 */
import { build } from 'esbuild';
import type { Plugin } from 'esbuild';

import { describeFailure } from '../bundle/describeFailure.js';
import { runtimeGlobalsPlugin } from '../bundle/runtimeGlobalsPlugin.js';
import { COMMISE_ROOT, PACKAGE_ROOT } from '../config.js';
import { DesignArtifactError } from '../errors.js';

/** The global the card module is assigned to; `cardRuntime` reads `__card.default`. */
export const CARD_GLOBAL = '__card';

/**
 * A package of ours a card may name only as a type. Packages outside the product tree (`@kitchensink/*`) are refused
 * here by name; everything INSIDE the tree is refused by where it lives ({@link typeOnlyProductImports}).
 */
const PRODUCT_SPECIFIER = /^@(?:commise|kitchensink)\//; // Go regular expression: esbuild rejects the JS `u` flag.

const SECOND_COPY =
    'A card renders window.Commise and may import product code only with "import type"; a value import would bundle a second copy of product code.';

/** Whether `file` is inside the product tree. */
function insideProductTree(file: string): boolean {
    return file === COMMISE_ROOT || file.startsWith(`${COMMISE_ROOT}/`);
}

/**
 * Refuses a surviving (value) import of product code.
 *
 * Two rules, and no list of specifiers: a package of ours by name, and ANY file that loads from inside the product
 * tree, whatever route reached it (a package, a relative or absolute path, or a `paths` alias such as `#commise/*`,
 * which this package's tsconfig defines for types only). Refusing by where the file lives is one rule for every way in.
 */
function typeOnlyProductImports(): Plugin {
    return {
        name: 'typeOnlyProductImports',
        setup(build) {
            build.onResolve({ filter: PRODUCT_SPECIFIER }, (args) => ({
                errors: [{ text: `"${args.path}" is imported as a value. ${SECOND_COPY}` }],
            }));
            build.onLoad({ filter: /.*/ }, (args) =>
                insideProductTree(args.path)
                    ? { errors: [{ text: `"${args.path}" is product code, reached as a value. ${SECOND_COPY}` }] }
                    : undefined,
            );
        },
    };
}

/**
 * Compiles a card module.
 *
 * @param file - Absolute path of the `*.card.tsx`; its default export is the card.
 * @returns `var __card = (() => { … })();` with the card at `__card.default`.
 * @throws DesignArtifactError `bundle-failed` when the card does not compile or imports product code as a value.
 * @sideEffect Reads the card and what it imports from disk.
 */
export async function compileCard(file: string): Promise<string> {
    try {
        const result = await build({
            entryPoints: [file],
            bundle: true,
            format: 'iife',
            globalName: CARD_GLOBAL,
            platform: 'browser',
            target: 'es2020',
            write: false,
            jsx: 'automatic',
            logLevel: 'silent',
            absWorkingDir: PACKAGE_ROOT,
            plugins: [typeOnlyProductImports(), runtimeGlobalsPlugin()],
        });
        const output = result.outputFiles[0];

        if (output === undefined) {
            throw new Error('esbuild produced no output file.');
        }

        return output.text;
    } catch (error) {
        throw new DesignArtifactError('bundle-failed', `Card ${file} failed to compile:\n${describeFailure(error)}`);
    }
}
