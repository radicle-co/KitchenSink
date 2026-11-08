/**
 * The mobile screens the navigator and the auth gate register, as the selector derives them.
 *
 * For guards that must name the same set (the screen recorder's guard asserts each calls `useScreenTrace`): they ask here
 * instead of scanning the source for import paths, so the guard and the selector cannot disagree.
 */
import { buildImportGraph } from './dependencyGraph.js';
import { MOBILE_PROFILE, mobileRegistryOf } from './repoModels.js';

/**
 * Derives the registered screens of the mobile app.
 *
 * @sideEffect Reads the repository and runs dependency-cruiser over the mobile app.
 * @param repo - The repository root.
 * @returns Screen names such as `HomeScreen`, sorted.
 */
export async function registeredMobileScreens(repo: string): Promise<readonly string[]> {
    return mobileRegistryOf(await buildImportGraph(repo, MOBILE_PROFILE)).screens;
}
