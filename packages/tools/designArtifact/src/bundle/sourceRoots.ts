/**
 * @module bundle/sourceRoots — turns what esbuild actually read into the directories Tailwind must scan.
 *
 * The stylesheet's `@source` list is derived from the bundle's real inputs, not kept by hand: a hand-kept list
 * drifts the day a surface component imports from a tree nobody listed, and the symptom (a missing utility) is
 * silent.
 */
import { dirname, resolve, sep } from 'node:path';

/** Files whose text can name a utility class. */
const SCANNABLE = /\.(?:[cm]?[jt]sx?|html)$/u;

/** A key esbuild gives a virtual module or stdin: `<stdin>`, `namespace:path`. */
const VIRTUAL = /^(?:<|[a-zA-Z][\w-]*:)/u;

/**
 * @param keys - The keys of an esbuild metafile's `inputs`, relative to the build's working directory.
 * @param resolveDir - That working directory.
 * @returns Absolute paths of the product sources that went into the bundle: dependencies, virtual modules and
 *   non-text assets are left out.
 */
export function bundleInputs(keys: readonly string[], resolveDir: string): readonly string[] {
    return keys
        .filter((key) => !VIRTUAL.test(key) && !key.split(/[\\/]/u).includes('node_modules') && SCANNABLE.test(key))
        .map((key) => resolve(resolveDir, key));
}

/**
 * @param files - Absolute file paths.
 * @returns Their directories, sorted and de-duplicated, with any directory that lies under another one removed
 *   (Tailwind's `@source` on a directory is recursive).
 */
export function sourceRootsOf(files: readonly string[]): readonly string[] {
    const directories = [...new Set(files.map((file) => dirname(file)))].sort();

    return directories.filter(
        (directory) => !directories.some((other) => other !== directory && directory.startsWith(other + sep)),
    );
}
