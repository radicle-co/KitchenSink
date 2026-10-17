/**
 * @module surface/discoverSurface — decides which names the artifact exports, per platform.
 *
 * Two sources compose, so there is one list and no second copy to drift:
 *   - DISCOVERED: every PascalCase component export of the `@commise/ui` leaves (web `.tsx`, native `.native.tsx`),
 *     found with the same file discovery and "is this file a component" test the docs generator uses.
 *   - REGISTERED: the product components, app chrome, hooks and values in `productSurface`.
 *
 * @pattern Union of sources — discovery and the registry both yield {@link SurfaceEntry}; the surface is their union,
 * with a name collision treated as an error rather than resolved by order.
 */
import { componentExportsOf, discoverComponentFiles, exportsAComponentName } from '@kitchensink/docgen-components';

import { UI_SRC } from '../config.js';
import { DesignArtifactError } from '../errors.js';

import { CHROME_SURFACE, PRODUCT_SURFACE, SHIM_SURFACE, SURFACE_VALUES, SURFACE_HOOKS } from './productSurface.js';
import type { PlatformFiles, RegisteredFile } from './productSurface.js';
import type { SurfaceEntry } from './surfaceEntry.js';

/** The two surfaces of the artifact: `window.Commise` and `window.Commise.Native`. */
export interface Surface {
    readonly web: readonly SurfaceEntry[];
    readonly native: readonly SurfaceEntry[];
}

/**
 * `@commise/ui` directories that hold components-shaped files which are NOT part of the design system:
 *   - `testing`: stubs and spies for the test runners (`hardwareBack`, `safeAreaContext`, …); they exist to be
 *     swapped in under vitest and would shadow the real shims here.
 *   - `tokens`: the colour and scale tables; data, not components, and `buildTokens` publishes them.
 *   - `theme`: the theme provider and the generated `theme.css` plumbing; the artifact ships `theme.css` itself
 *     and previews are themed by the `data-theme` attribute, so the provider would fight it.
 *   - `backIntercept`: the Android hardware-back registry; it needs a navigator and has no visual output.
 */
const EXCLUDED_UI_DIRECTORIES = ['testing', 'tokens', 'theme', 'backIntercept'] as const;

const NATIVE_LEAF = /\.native\.tsx$/u;

/**
 * The names a file publishes on the surface: its component-named exports, under the name a consumer imports.
 * docgen owns the definition of a component name, so this and the file selection in {@link uiLeaves} cannot disagree.
 *
 * @param file - Absolute path to a source file.
 * @returns Exported component names, in source order.
 * @sideEffect Reads the file.
 */
export function componentNamesOf(file: string): readonly string[] {
    return componentExportsOf(file).map(({ exported }) => exported);
}

/**
 * Turns an ordered file list into surface entries.
 *
 * @param files - Absolute source paths, in the order names should appear.
 * @param namesOf - The names a file exports.
 * @param platform - Used in the error message only.
 * @returns One entry per exported name.
 * @throws DesignArtifactError `duplicate-name` when two exports (in one file or two) share a name. Silently keeping
 * one would publish a component that is not the one the screen asked for.
 */
export function toSurfaceEntries(
    files: readonly string[],
    namesOf: (file: string) => readonly string[],
    platform: 'web' | 'native',
): readonly SurfaceEntry[] {
    const owners = new Map<string, string>();
    const entries: SurfaceEntry[] = [];

    for (const file of files) {
        for (const name of namesOf(file)) {
            const previous = owners.get(name);

            if (previous !== undefined) {
                throw new DesignArtifactError(
                    'duplicate-name',
                    `${name} is exported twice on the ${platform} surface: ${previous} and ${file}.`,
                );
            }

            owners.set(name, file);
            entries.push({ name, file, kind: 'component' });
        }
    }

    return entries;
}

/** The `@commise/ui` component files, split by platform. @sideEffect Reads the directory tree. */
function uiLeaves(): { readonly web: readonly string[]; readonly native: readonly string[] } {
    const excluded = EXCLUDED_UI_DIRECTORIES.map((directory) => `${UI_SRC}/${directory}/`);
    const files = discoverComponentFiles(UI_SRC).filter(
        (file) => !excluded.some((prefix) => file.startsWith(prefix)) && exportsAComponentName(file),
    );

    return {
        web: files.filter((file) => !NATIVE_LEAF.test(file)),
        native: files.filter((file) => NATIVE_LEAF.test(file)),
    };
}

/** Confirms each registered file still exports the component it is registered under. */
function assertRegistered(registered: readonly RegisteredFile[]): readonly string[] {
    for (const { name, file } of registered) {
        if (!componentNamesOf(file).includes(name)) {
            throw new DesignArtifactError(
                'unknown-component',
                `${file} is registered as ${name} but does not export it.`,
            );
        }
    }

    return registered.map(({ file }) => file);
}

/**
 * Appends entries that name exactly what they export (a hook, an artifact-only component) to a platform's surface.
 *
 * @param entries - The surface so far.
 * @param direct - Entries to add after it.
 * @param platform - Used in the error message only.
 * @returns The surface with `direct` appended, order kept.
 * @throws DesignArtifactError `duplicate-name` when a name is already taken: appending would publish one of two
 * components under a name, whichever happened to come second.
 */
export function appendDirectEntries(
    entries: readonly SurfaceEntry[],
    direct: readonly SurfaceEntry[],
    platform: 'web' | 'native',
): readonly SurfaceEntry[] {
    const owners = new Map(entries.map(({ name, file }) => [name, file]));

    for (const { name, file } of direct) {
        const previous = owners.get(name);

        if (previous !== undefined) {
            throw new DesignArtifactError(
                'duplicate-name',
                `${name} is exported twice on the ${platform} surface: ${previous} and ${file}.`,
            );
        }

        owners.set(name, file);
    }

    return [...entries, ...direct];
}

function platformSurface(
    platform: 'web' | 'native',
    discovered: readonly string[],
    registered: PlatformFiles,
): readonly SurfaceEntry[] {
    const registeredFiles = assertRegistered([...registered[platform]]);
    const shimmed = SHIM_SURFACE[platform];

    assertRegistered([...shimmed]);

    return appendDirectEntries(
        toSurfaceEntries([...discovered, ...registeredFiles], componentNamesOf, platform),
        [
            ...shimmed.map((entry): SurfaceEntry => ({ ...entry, kind: 'component' })),
            ...SURFACE_HOOKS.map((entry): SurfaceEntry => ({ ...entry, kind: 'hook' })),
            ...SURFACE_VALUES.map((entry): SurfaceEntry => ({ ...entry, kind: 'value' })),
        ],
        platform,
    );
}

/**
 * Everything the artifact exports, for both platforms.
 *
 * @returns The web surface (`window.Commise`) and the native surface (`window.Commise.Native`).
 * @throws DesignArtifactError `duplicate-name` or `unknown-component`.
 * @sideEffect Reads the source tree.
 */
export function discoverSurface(): Surface {
    const leaves = uiLeaves();
    const registered: PlatformFiles = {
        web: [...PRODUCT_SURFACE.web, ...CHROME_SURFACE.web],
        native: [...PRODUCT_SURFACE.native, ...CHROME_SURFACE.native],
    };

    return {
        web: platformSurface('web', leaves.web, registered),
        native: platformSurface('native', leaves.native, registered),
    };
}
