/**
 * @module @commise/features-recipes/form — how long the cook pauses in typing before a field's polite region speaks.
 *
 * One number for every editor field that reads back what the cook typed (build spec §7.5.3): the ingredient entry's
 * live reading and the Cuisine field's count (`docs/design/uiOverhaul/cuisineField.md` §3.3). Its own module so a field
 * that needs the pause does not import another field's hook to reach it.
 */

/** How long the cook pauses before the live reading is said: never per keystroke (build spec §7.5.3). */
export const LIVE_READING_PAUSE_MS = 500;
