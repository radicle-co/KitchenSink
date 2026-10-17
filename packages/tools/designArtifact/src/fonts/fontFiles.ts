/**
 * @module fonts/fontFiles — resolves the font files the product registers to real files on disk.
 *
 * @pattern Adapter over Node's module resolution — the resolver is a parameter so a test can make a font go missing.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DesignArtifactError } from '../errors.js';

import type { FontFile, FontLicence } from './fontFile.js';
import { fontFaces, fontLicenceSources } from './fontFaces.js';

/** Resolves a module specifier to a `file:` URL, as `import.meta.resolve` does. */
export type SpecifierResolver = (specifier: string) => string;

const requireFromHere = createRequire(import.meta.url);

/**
 * The real resolver: Node's own resolution from this package. `createRequire` and not `import.meta.resolve`, which
 * vitest's module runner does not implement, so the same code runs under tsx and under the e2e tier.
 */
const nodeResolver: SpecifierResolver = (specifier) => pathToFileURL(requireFromHere.resolve(specifier)).href;

/**
 * Resolve a specifier to an existing file.
 *
 * @throws DesignArtifactError `missing-font` when it does not resolve or the file is not on disk.
 */
function resolveExisting(specifier: string, resolve: SpecifierResolver): string {
    let path: string;

    try {
        path = fileURLToPath(resolve(specifier));
    } catch (cause) {
        throw new DesignArtifactError('missing-font', `Cannot resolve ${specifier}: ${String(cause)}`);
    }

    if (!existsSync(path)) {
        throw new DesignArtifactError('missing-font', `${specifier} resolved to ${path}, which does not exist.`);
    }

    return path;
}

/**
 * The font files of every face the product registers.
 *
 * @param resolve - How a specifier becomes a `file:` URL. Defaults to Node's resolution.
 * @returns One entry per registration, with the absolute path of its `.ttf`.
 * @throws DesignArtifactError `missing-font` when a font file cannot be found.
 * @sideEffect Reads the file system to confirm each file exists.
 */
export function fontFiles(resolve: SpecifierResolver = nodeResolver): readonly FontFile[] {
    return fontFaces().map(({ family, weight, fileName, specifier }) => ({
        family,
        weight,
        file: fileName,
        source: resolveExisting(specifier, resolve),
    }));
}

/**
 * The SIL Open Font Licence text of each font package, which the licence requires to travel with the fonts.
 *
 * @param resolve - How a specifier becomes a `file:` URL. Defaults to Node's resolution.
 * @returns One entry per font package.
 * @throws DesignArtifactError `missing-font` when a licence file cannot be found.
 * @sideEffect Reads the file system to confirm each file exists.
 */
export function fontLicences(resolve: SpecifierResolver = nodeResolver): readonly FontLicence[] {
    return fontLicenceSources().map(({ file, specifier }) => ({ file, source: resolveExisting(specifier, resolve) }));
}
