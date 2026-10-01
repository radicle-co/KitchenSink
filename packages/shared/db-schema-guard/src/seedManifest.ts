/**
 * The seed manifest's path contract (curated catalog plan U2, KTD-4).
 *
 * The seed digest names a whole bundle tree, computed twice: by `readSeedManifest` (`seedManifestFile.ts`) in the
 * seed function and by `runSeed.sh manifest` in the pipeline. The two agree only if they list and order every path
 * identically. Within this contract they must: every segment is plain ASCII from `[A-Za-z0-9._-]`, so a JavaScript
 * string comparison orders paths exactly as `LC_ALL=C sort` does, and `sha256sum` never escapes a name. A path
 * outside it is refused by both halves, never digested two ways.
 *
 * @pattern Functional core — the pure rule both manifest readers apply
 */

/** One path segment: plain ASCII from a set whose byte order is its sort order, and never `.` or `..`. */
const SEGMENT = /^[A-Za-z0-9._-]+$/u;

/**
 * Whether a bundle-relative path is inside the seed manifest's contract.
 *
 * @param path - A POSIX path relative to the bundle root, with no leading `./`.
 * @returns `true` when every segment is safe to digest the same way in TypeScript and in shell. Pure.
 */
export function isSeedManifestPath(path: string): boolean {
    return path.split('/').every((segment) => SEGMENT.test(segment) && segment !== '.' && segment !== '..');
}
