/**
 * @module @commise/ui/testing/lucide-native — a Vitest plugin that stands in for `lucide-react-native`'s deep glyph
 * imports (`lucide-react-native/icons/<glyph>`) in the jsdom native suites.
 *
 * The real glyphs render through `react-native-svg`, which has no react-native-web implementation, so a native
 * component test could not mount an icon at all. Each deep import resolves instead to a stand-in that renders an empty
 * marked `View` carrying the glyph's Lucide name and the props it was drawn with (the `dataSet` marker convention the
 * other native stubs use). A suite can therefore assert WHICH glyph a control draws and in which colour, which a
 * `null` stub or one shared stand-in for every glyph could not show.
 *
 * Only the deep form is served. The package root is deliberately not: the icon Registry must never import it (Metro
 * does not tree-shake, and the root barrel ships every glyph), and a test environment that resolved it would hide an
 * import the build would ship.
 *
 * Every `vitest.native.config.ts` whose tree renders an icon adds `lucideNativeStub()` to its `plugins`.
 *
 * @pattern Virtual module — one generated module per glyph, resolved by the plugin, never written to disk
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vitest/config';

/** A deep glyph import, capturing the Lucide file name. */
const DEEP_GLYPH = /^lucide-react-native\/icons\/([a-z0-9-]+)$/;

/** The virtual-module id prefix; the `\0` keeps every other plugin from touching the id. */
const VIRTUAL_PREFIX = '\0commise-lucide-native-stub:';

/** The installed package's own glyph modules, so a stand-in is served only for a glyph the package really ships. */
const GLYPH_DIR = path.resolve(
    path.dirname(createRequire(import.meta.url).resolve('lucide-react-native')),
    '../esm/icons',
);

/** The module that builds a stand-in glyph component. */
const GLYPH_STUB = fileURLToPath(new URL('./lucideNativeGlyph.native.tsx', import.meta.url));

/**
 * The plugin. Resolves each deep glyph import to a virtual module whose default export is that glyph's stand-in.
 *
 * @returns A `pre` plugin for a Vitest config.
 */
export function lucideNativeStub(): Plugin {
    return {
        name: 'commise-lucide-native-stub',
        enforce: 'pre',
        resolveId(source) {
            const match = DEEP_GLYPH.exec(source);

            if (match === null) {
                return null;
            }

            // ⛔ A stand-in for a glyph the package does not ship would pass every test and fail the Metro build
            // (Lucide 1.x renamed `trash-2` to `trash`, and the old deep path is gone on native).
            if (!existsSync(path.join(GLYPH_DIR, `${match[1]}.mjs`))) {
                throw new Error(`lucide-react-native ships no glyph "${match[1]}" (${source}).`);
            }

            return `${VIRTUAL_PREFIX}${match[1]}`;
        },
        load(id) {
            if (!id.startsWith(VIRTUAL_PREFIX)) {
                return null;
            }

            const glyph = id.slice(VIRTUAL_PREFIX.length);

            return [
                `import { glyphStub } from ${JSON.stringify(GLYPH_STUB)};`,
                `export default glyphStub(${JSON.stringify(glyph)});`,
            ].join('\n');
        },
    };
}
