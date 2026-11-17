/**
 * @module @commise/features-recipes/session — the recipe and food service clients bound to the signed-in cook,
 * with the one policy for a missing session token.
 *
 * A package-export entry (the one kind of barrel this repo keeps).
 */
export { RecipeAuthNotReadyError, isRecipeAuthNotReadyError } from './recipeAuthNotReady.js';
export { useRecipeServiceClients } from './useRecipeServiceClients.js';
export type { RecipeServiceClients, UseRecipeServiceClientsOptions } from './useRecipeServiceClients.js';
export { RecipeServicesTree } from './RecipeServicesTree.js';
export type { RecipeServicesTreeProps } from './RecipeServicesTree.js';
export { createKeptSessionStore } from './kept/keptSessionStore.js';
export type { KeptSessionStore, KeptSessionStoreDeps, KeptSnapshot } from './kept/keptSessionStore.js';
export { KEPT_KEY_PREFIX } from './kept/keptRecord.js';
export type { ExclusiveRunner, KeptPort, WriteOutcome } from './kept/keptPort.js';
