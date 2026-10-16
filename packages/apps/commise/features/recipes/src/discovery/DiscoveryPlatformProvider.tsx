'use client';

/**
 * @module @commise/features-recipes/discovery/DiscoveryPlatformProvider — hands the screen's parts the host's
 * {@link DiscoveryPlatform}, so the rails, the results and the settled reads reach the boundary and the calorie lookup
 * without each passing them down four levels.
 *
 * @pattern Dependency Injection — React context carrying the platform port
 */
import { createContext, use, type FC, type ReactNode } from 'react';

import type { DiscoveryPlatform } from './discoveryScreenModel.js';

const DiscoveryPlatformContext = createContext<DiscoveryPlatform | undefined>(undefined);

/** Props for {@link DiscoveryPlatformProvider}. */
export interface DiscoveryPlatformProviderProps {
    /** The platform the parts read. */
    readonly platform: DiscoveryPlatform;
    /** The discovery screen's parts. */
    readonly children: ReactNode;
}

/**
 * Provide the platform to the discovery screen's parts.
 *
 * @param props - The platform and the subtree.
 * @returns The subtree under the platform.
 */
export const DiscoveryPlatformProvider: FC<DiscoveryPlatformProviderProps> = ({ platform, children }) => (
    <DiscoveryPlatformContext value={platform}>{children}</DiscoveryPlatformContext>
);

/**
 * The platform the nearest {@link DiscoveryPlatformProvider} supplied.
 *
 * @returns The platform.
 * @throws When read outside a provider: the parts have no sensible default boundary or calorie lookup to fall back on.
 */
export function useDiscoveryPlatform(): DiscoveryPlatform {
    const platform = use(DiscoveryPlatformContext);

    if (platform === undefined) {
        throw new Error('useDiscoveryPlatform must be used inside a DiscoveryPlatformProvider');
    }

    return platform;
}
