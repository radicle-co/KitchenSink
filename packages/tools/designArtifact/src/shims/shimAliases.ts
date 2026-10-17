/**
 * @module shimAliases — the esbuild alias map: which module specifier each build replaces with which shim file.
 *
 * @pattern Registry of module specifier to Adapter
 */
import { join } from 'node:path';

const SHIMS_DIR = import.meta.dirname;

const WEB: Readonly<Record<string, string>> = {
    'next/link': join(SHIMS_DIR, 'nextLink.tsx'),
    'next/navigation': join(SHIMS_DIR, 'nextNavigation.ts'),
};

const NATIVE: Readonly<Record<string, string>> = {
    'react-native': join(SHIMS_DIR, 'reactNative.ts'),
    'react-native-safe-area-context': join(SHIMS_DIR, 'safeAreaContext.tsx'),
    'expo-linear-gradient': join(SHIMS_DIR, 'linearGradient.tsx'),
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
