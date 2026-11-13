/**
 * @module shimAliases — the esbuild alias map: which module specifier each build replaces with which shim file.
 *
 * @pattern Registry of module specifier to Adapter
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const SHIMS_DIR = import.meta.dirname;

/**
 * The stand-in for Tamagui's device animation driver, which cannot run in this build: its browser entry only throws,
 * and its native entry is built for Tamagui's native core while this build loads the web core. The native test lanes
 * run the same web core and use this CSS stand-in for the same reason. It is resolved through `@commise/ui`'s own
 * export, so a move of the file inside that package cannot leave this path behind.
 */
const ANIMATION_DRIVER_STAND_IN = createRequire(import.meta.url).resolve('@commise/ui/testing/animations-shim');

const WEB: Readonly<Record<string, string>> = {
    'next/link': join(SHIMS_DIR, 'nextLink.tsx'),
    'next/navigation': join(SHIMS_DIR, 'nextNavigation.ts'),
};

const NATIVE: Readonly<Record<string, string>> = {
    'react-native': join(SHIMS_DIR, 'reactNative.ts'),
    'react-native-safe-area-context': join(SHIMS_DIR, 'safeAreaContext.tsx'),
    'expo-linear-gradient': join(SHIMS_DIR, 'linearGradient.tsx'),
    '@tamagui/animations-react-native': ANIMATION_DRIVER_STAND_IN,
};

/**
 * The specifier to file map for a build.
 *
 * @param platform - Which build.
 * @returns Module specifier to the absolute path of its shim.
 */
export function shimAliases(platform: 'web' | 'native'): Readonly<Record<string, string>> {
    return platform === 'web' ? WEB : NATIVE;
}
