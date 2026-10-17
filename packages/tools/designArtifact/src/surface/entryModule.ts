/**
 * @module surface/entryModule — the generated entry source for one platform's bundle: a `export { … } from …`
 * line per file.
 */
import type { SurfaceEntry } from './surfaceEntry.js';

const SOURCE_SUFFIX = /\.tsx?$/u;

/**
 * The entry module that re-exports a platform's surface.
 *
 * Paths end in `.js` because that is how this repository imports its own sources; esbuild resolves `.js` to the
 * `.ts` / `.tsx` file beside it. Names sharing a file collapse into one statement, files in first-seen order.
 *
 * @param entries - The platform's surface.
 * @returns TypeScript source, empty for no entries.
 * @throws Error when a file is not a `.ts` / `.tsx` source.
 */
export function entryModule(entries: readonly SurfaceEntry[]): string {
    const namesByFile = new Map<string, string[]>();

    for (const { name, file } of entries) {
        if (!SOURCE_SUFFIX.test(file)) {
            throw new Error(`Surface entry ${name} points at ${file}, which is not a .ts or .tsx source.`);
        }

        const names = namesByFile.get(file) ?? [];

        names.push(name);
        namesByFile.set(file, names);
    }

    return [...namesByFile]
        .map(
            ([file, names]) =>
                `export { ${names.join(', ')} } from ${JSON.stringify(file.replace(SOURCE_SUFFIX, '.js'))};\n`,
        )
        .join('');
}
