/**
 * @module @commise/features-recipes/editor — the recipe editor surface and the draft helpers both apps share.
 *
 * A package-export entry (the one kind of barrel this repo keeps), registered ahead of the web/mobile UI
 * consolidation so the slice that fills it (S4 of `docs/plans/2026-10-13-007-chore-finish-pr91-plan.md`) edits
 * neither the package root index nor `package.json`.
 */
export { cookDraftsOf, editorDraftsFor } from './cookDrafts.js';
export type { CookDrafts } from './cookDrafts.js';
export { IngredientStatusPoller } from './IngredientStatusPoller.js';
export type { IngredientStatusPollerProps } from './IngredientStatusPoller.js';
export { RecipeEditorSurface } from './RecipeEditorSurface.js';
export type { PhotoUploaderTarget, RecipeEditorSurfaceProps } from './RecipeEditorSurface.js';
