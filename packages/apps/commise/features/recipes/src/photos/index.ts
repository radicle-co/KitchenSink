/**
 * @module @commise/features-recipes/photos — platform-neutral barrel for the recipe photo manager building
 * block (T067, wireframe step 4). The component specifier resolves to its web (`*.tsx`) or native
 * (`*.native.tsx`) leaf at bundle time; the model + message layers are platform-agnostic. The apps compose
 * this into their recipe-edit surface, supplying the platform image-acquisition control + upload wiring.
 */
export { RecipePhotoManager } from './RecipePhotoManager.js';

export { isAtPhotoCap, visibleQueueItems, MAX_RECIPE_PHOTOS } from './model.js';
export type { RecipePhotoManagerProps } from './model.js';

export { photoMessages } from './messages.js';
export type { PhotoMessages } from './messages.js';
