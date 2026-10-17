/**
 * @module EditorActionBar.card — the design-system card of EditorActionBar: the resting bar, the bar with a fix
 * line, with a ready line, with its primary action disabled, and while publishing, on both platforms.
 *
 * The web bar takes `pinned` (and `placeRef`); the native bar takes neither, and sits in the thumb zone with no
 * gutter of its own, so `renderNative` states its own frame and props.
 */
import type { ReactNode } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

/** The five bars the card shows, as the props each differs by. */
const VARIANTS: readonly Record<string, unknown>[] = [
    {},
    { fixLine: 'Fix 2 things to publish' },
    { readyLine: 'Ready to publish. 3 ingredients have no match, so their nutrition is left out.' },
    { primaryLabel: 'Save changes', primaryDisabled: true },
    { busy: true, primaryLabel: 'Publishing' },
];

/** The props both bars take. */
const BASE = {
    label: 'Recipe actions',
    previewLabel: 'Preview',
    onPreview: noop,
    primaryLabel: 'Publish',
    onPrimary: noop,
    primaryDisabled: false,
    busy: false,
} as const;

/** A dashed frame that stands in for the editor's bottom edge. */
function frame(key: number, native: boolean, bar: ReactNode): ReactNode {
    return (
        <div
            key={key}
            style={{
                position: 'relative',
                border: '1px dashed var(--line)',
                borderRadius: 12,
                overflow: 'hidden',
                padding: native ? 0 : '0 16px',
                maxWidth: native ? 358 : 520,
            }}
        >
            {bar}
        </div>
    );
}

export default defineCard({
    group: 'Editor',
    height: 650,
    platforms: 'both',
    uses: ['EditorActionBar'],
    render: ({ EditorActionBar }) => (
        <div className="col" style={{ gap: 16 }}>
            {VARIANTS.map((variant, index) =>
                frame(index, false, <EditorActionBar {...BASE} pinned={false} {...variant} />),
            )}
        </div>
    ),
    renderNative: ({ EditorActionBar }) => (
        <div className="col" style={{ gap: 16 }}>
            {VARIANTS.map((variant, index) => frame(index, true, <EditorActionBar {...BASE} {...variant} />))}
        </div>
    ),
});
