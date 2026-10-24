/**
 * @module EditorStateFrame — the editor's loading and error states, in the editor's gutter.
 *
 * A focused task's `<main>` carries no gutter (the editor frame runs edge to edge and owns its own, F15), so a state
 * drawn before the frame exists would sit against the window's edge. This gives those states the frame's gutter.
 *
 * Presentational: `children → JSX`.
 */
import { EDITOR_GUTTER } from '@commise/features-recipes';
import type { FC, ReactNode } from 'react';

/** Props for {@link EditorStateFrame}. */
export interface EditorStateFrameProps {
    /** The state to draw: a loading line or a load error. */
    readonly children: ReactNode;
}

/** The editor's page gutter around a state drawn before the editor itself. */
export const EditorStateFrame: FC<EditorStateFrameProps> = ({ children }) => (
    <div className={EDITOR_GUTTER}>{children}</div>
);
