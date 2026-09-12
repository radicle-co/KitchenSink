/**
 * @module fixtures/Orchestrator — the ORCHESTRATION half of an orchestration/render split: it owns state and
 * a ref, and hands the result to a presentational leaf. Carries three of the pattern-rule violations the
 * findings layer must report — a ref, a boolean prop that selects between two rendered subtrees, and an
 * undocumented prop.
 */
import { useRef, useState, type FC, type ReactNode } from 'react';

/** Props for {@link Orchestrator}. */
export interface OrchestratorProps {
    /** Switches the whole rendered subtree between the compact and the full presentation. */
    readonly compactMode: boolean;
    readonly title: string;
    /** Purely decorative flag that never selects a subtree. */
    readonly muted?: boolean;
}

/** Owns the open state and the focus ref; delegates the render. */
export const Orchestrator: FC<OrchestratorProps> = ({ compactMode, title, muted = false }) => {
    const anchor = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);

    return compactMode ? (
        <div ref={anchor} data-muted={muted}>
            {title}
        </div>
    ) : (
        <section ref={anchor} data-muted={muted}>
            <button onClick={() => setOpen(!open)}>{title}</button>
            {open ? ((<p>{title}</p>) as ReactNode) : null}
        </section>
    );
};
