/**
 * @module @commise/features-recipes/editor — the ONE switch for the held public save's ways out (heldPublicSave KTD-4).
 *
 * ⛔ OFF until the owner turns it on (heldPublicSave U7 lists the conditions): while it is off, every client surface
 * behaves as main. It is read in the editor's orchestration layer where the branch is, never in a pure policy. There is
 * no env var, remote config or user-reachable switch, and turning it on is one change to this value with a qse
 * TEST-CHANGE on its pin test. Annotated `boolean` so both branches stay typed and no linter calls one dead.
 *
 * @pattern Feature Toggle — one release toggle read in one module
 */

export const HELD_SAVE_WAYS_OUT_ON: boolean = false;
