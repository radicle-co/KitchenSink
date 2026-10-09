'use client';

/**
 * @module @commise/ui/create-fab — the web face of a floating create control: the glyph and the label. In the icon form
 * the label stays in the accessible name, visually hidden. A hidden twin of the label, out of flow, measures its natural
 * width for the "fits in half the window" rule; it is observed, so a late web font or a zoom re-measures it.
 *
 * The twin is held by a callback ref in state — the shape the app shell's tab bar uses — read in an effect, never in
 * render.
 *
 * Presentational: props → JSX, plus the one measurement its rule needs.
 *
 * @pattern Observer — a `ResizeObserver` over the label's twin
 */
import { useEffect, useState, type FC } from 'react';

import { Icon } from '../icon/Icon.js';
import type { FabFaceProps } from './props.js';

/** The web face of a floating create control. */
export const FabFace: FC<FabFaceProps> = ({ label, icon, presentation, onLabelWidth }) => {
    const [twin, setTwin] = useState<HTMLSpanElement | null>(null);

    // @sideEffect Measures the label's twin, and again whenever its box changes.
    useEffect(() => {
        if (twin === null) {
            return undefined;
        }

        const measure = (): void => onLabelWidth(twin.getBoundingClientRect().width);
        measure();

        if (typeof ResizeObserver !== 'function') {
            return undefined;
        }

        const observer = new ResizeObserver(measure);
        observer.observe(twin);

        return () => observer.disconnect();
    }, [onLabelWidth, twin]);

    return (
        <>
            <Icon name={icon} size={24} />
            <span className={presentation === 'icon' ? 'sr-only' : undefined}>{label}</span>
            <span
                ref={setTwin}
                aria-hidden="true"
                className="pointer-events-none invisible absolute whitespace-nowrap text-label"
            >
                {label}
            </span>
        </>
    );
};
