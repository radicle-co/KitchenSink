/**
 * @module @commise/features-recipes/editor — whether a row editor is open, held in ONE place that both the row editor
 * and the editor's checkpoints are handed.
 *
 * A row editor's Cancel puts back what the row held when it opened, but a server write made meanwhile makes the server
 * drop that line's source and review flag, which Cancel cannot bring back. So while a row editor is open the draft's
 * idle, hide and section-change checkpoints wait (`serverWriteFor`'s `rowEditHeld`), and letting go of the hold runs the
 * one that was deferred. It is the paste hold's shape (`pasteHold.ts`) over a different fact, so it is that module's
 * cell and not a second copy of it: one writer (the open row editor), one reader (the editor, when a checkpoint runs).
 *
 * @pattern Shared state holder — one mutable cell with a single writer and a single reader
 */
import { createPasteHold, type PasteHold } from './pasteHold.js';

/** Whether a row editor is open with a restore point. */
export type RowEditHold = PasteHold;

/**
 * A row edit hold, not holding.
 *
 * @returns The hold. @sideEffect Its `set` changes what every later `get` answers, and may call a listener.
 */
export const createRowEditHold = (): RowEditHold => createPasteHold();
