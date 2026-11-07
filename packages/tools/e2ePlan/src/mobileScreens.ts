/**
 * The screens of the mobile app: the modules in the screens folder that a registrar (the navigator, the auth gate)
 * imports. Anything else in that folder, or outside it, is a plain module whose change reaches a screen through the
 * import graph, or reaches a registrar and with it the whole app.
 */
import type { Terminals } from './reachability.js';

export interface MobileRegistry {
    /** Screen names, such as `HomeScreen`. */
    readonly screens: readonly string[];
    readonly terminals: Pick<Terminals, 'screenEntries' | 'roots'>;
}

export interface MobileRegistryInput {
    /** The repo-relative screens folder. */
    readonly screensDir: string;
    /** Repo-relative path prefixes of the files that register screens. A prefix ending in `/` is a folder. */
    readonly registrars: readonly string[];
    /** Repo-relative files that are part of every screen on their own (the app entry, the app config). */
    readonly roots: readonly string[];
    /** Every repo-relative file of the app. */
    readonly files: readonly string[];
    readonly importersOf: (file: string) => readonly string[];
}

const isUnder = (file: string, prefix: string): boolean =>
    prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix;

/** `Detail.native.tsx` and `Detail.tsx` are the same screen. */
const screenName = (file: string): string => (file.split('/').pop() ?? file).replace(/(\.native)?\.[^.]+$/u, '');

/**
 * Derives the mobile screens.
 *
 * @param input - The screens folder, who registers screens, and what imports what.
 * @returns The screens, and the entries and roots a backwards walk ends at.
 */
export function mobileRegistry(input: MobileRegistryInput): MobileRegistry {
    const registrars = input.files.filter((file) => input.registrars.some((prefix) => isUnder(file, prefix)));
    const inScreens = input.files.filter((file) => file.startsWith(`${input.screensDir}/`));
    const registered = new Set(
        inScreens
            .filter((file) => input.importersOf(file).some((importer) => registrars.includes(importer)))
            .map(screenName),
    );
    const screenEntries = new Map(
        inScreens.filter((file) => registered.has(screenName(file))).map((file) => [file, [screenName(file)]] as const),
    );

    return {
        screens: [...registered].sort(),
        terminals: { screenEntries, roots: new Set([...input.roots, ...registrars]) },
    };
}
