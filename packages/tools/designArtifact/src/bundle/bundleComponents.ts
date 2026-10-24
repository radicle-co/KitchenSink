/**
 * @module bundle/bundleComponents — assembles the one classic script the artifact ships.
 *
 * Order matters: the header comment first (the host reads it), then the React 18 bridge (defines `window.__react`
 * and `window.__jsx`), then the web and native bundles, then the single global the previews use.
 *
 * @pattern Pipes and Filters — surface in, bundles out through the {@link Bundler} port, one escaped script out.
 */
import { join } from 'node:path';

import { bundleHeader } from '../artifactFormat.js';
import { COMMISE_ROOT } from '../config.js';
import { REACT18_BRIDGE_SOURCE } from '../runtime/react18Bridge.js';
import type { Surface } from '../surface/discoverSurface.js';
import { entryModule } from '../surface/entryModule.js';

import type { Bundler } from './bundler.js';
import { inlineScriptEscape } from './inlineScriptEscape.js';
import { sourceRootsOf } from './sourceRoots.js';

const WEB_GLOBAL = '__CommiseWeb';
const NATIVE_GLOBAL = '__CommiseNative';

/** The component script and the directories its sources live in. */
export interface ComponentBundle {
    /** The classic script text, safe to inline in an HTML `<script>`. */
    readonly script: string;
    /** Directories of every product source the bundles read: the stylesheet's `@source` roots. */
    readonly sourceRoots: readonly string[];
}

/**
 * Builds the component bundle: `window.Commise` (web) and `window.Commise.Native`.
 *
 * The platforms build one after the other, web first, so a failure names the first broken platform and two
 * esbuild processes never compete for the same disk cache.
 *
 * @param surface - What each platform exports.
 * @param bundler - Builds an entry module into an IIFE.
 * @returns The final script and the source directories it was built from.
 * @throws DesignArtifactError `bundle-failed` or `unsafe-header`.
 * @sideEffect Whatever the bundler does (the esbuild adapter reads the source tree).
 */
export async function bundleComponents(surface: Surface, bundler: Bundler): Promise<ComponentBundle> {
    const web = await bundler.bundle({
        entrySource: entryModule(surface.web),
        globalName: WEB_GLOBAL,
        platform: 'web',
        resolveDir: join(COMMISE_ROOT, 'web'),
    });
    const native = await bundler.bundle({
        entrySource: entryModule(surface.native),
        globalName: NATIVE_GLOBAL,
        platform: 'native',
        resolveDir: join(COMMISE_ROOT, 'mobile'),
    });
    const components = surface.web.filter(({ kind }) => kind === 'component').map(({ name }) => name);

    const script = inlineScriptEscape(
        [
            bundleHeader(components),
            REACT18_BRIDGE_SOURCE,
            web.script,
            native.script,
            `window.Commise = Object.assign({}, ${WEB_GLOBAL}, { Native: ${NATIVE_GLOBAL} });\n`,
        ].join('\n'),
    );

    return { script, sourceRoots: sourceRootsOf([...web.inputs, ...native.inputs]) };
}
