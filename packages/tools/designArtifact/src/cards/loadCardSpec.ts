/**
 * @module cards/loadCardSpec — reads a card's metadata (group, height, platforms, staging, notes) in Node.
 *
 * The card's functions are never called here; only the data the page template needs is taken from the module. The
 * card is loaded by `import()` from the same toolchain that runs the build (tsx, vitest), so its JSX and types compile
 * exactly as they do when `compileCard` bundles it for the browser.
 */
import { pathToFileURL } from 'node:url';

import { DesignArtifactError } from '../errors.js';

import type { CardPageSpec } from './cardPage.js';

const PLATFORMS = ['both', 'web', 'native'] as const;

/** A card's page metadata plus the components it mounts, which the surface checks compare with the bundle. */
export type LoadedCardSpec = CardPageSpec & { readonly uses: readonly string[] };

function invalid(file: string, why: string): DesignArtifactError {
    return new DesignArtifactError('invalid-card', `${file}: ${why}`);
}

/**
 * Validates a loaded card module and extracts its page metadata.
 *
 * @param module - The module namespace of a `*.card.tsx`.
 * @param file - Its path, for the error message.
 * @returns The data `cardPage` reads, and `uses` for the surface checks.
 * @throws DesignArtifactError `invalid-card` when the default export is not a card.
 */
export function toCardPageSpec(module: unknown, file: string): LoadedCardSpec {
    const card = typeof module === 'object' && module !== null && 'default' in module ? module.default : undefined;

    if (typeof card !== 'object' || card === null) {
        throw invalid(file, 'the default export is not a card (use defineCard).');
    }

    const { group, height, platforms, reason, staging, notes, uses } = card as Record<string, unknown>;

    if (typeof group !== 'string' || group.length === 0) {
        throw invalid(file, 'the card has no group.');
    }

    if (typeof height !== 'number') {
        throw invalid(file, 'the card has no numeric height.');
    }

    if (!PLATFORMS.some((value) => value === platforms)) {
        throw invalid(file, `platforms must be one of ${PLATFORMS.join(', ')}.`);
    }

    if (!Array.isArray(uses) || !uses.every((used): used is string => typeof used === 'string')) {
        throw invalid(file, 'uses must be a list of component names.');
    }

    return {
        group,
        height,
        platforms: platforms as CardPageSpec['platforms'],
        uses,
        ...(typeof reason === 'string' ? { reason } : {}),
        ...(typeof staging === 'object' && staging !== null ? { staging: staging as CardPageSpec['staging'] } : {}),
        ...(typeof notes === 'object' && notes !== null ? { notes: notes as CardPageSpec['notes'] } : {}),
    };
}

/**
 * Loads a card file and reads its metadata.
 *
 * @param file - Absolute path of the `*.card.tsx`.
 * @returns The page metadata.
 * @throws DesignArtifactError `invalid-card`.
 * @sideEffect Imports (executes) the card module.
 */
export async function loadCardSpec(file: string): Promise<LoadedCardSpec> {
    return toCardPageSpec(await import(pathToFileURL(file).href), file);
}
