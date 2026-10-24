/**
 * @module EditorHeader.card — the design-system card of the editor's header: a saved status, a saving status and
 * no status, the first two with the overflow menu, on both platforms.
 *
 * The leaves' props differ only by the web header's optional `placeRef` (the handle the page's popups read its edge by),
 * which this card never passes, so both columns state the same props. Each column still has its own render, because the
 * native one is checked against the native leaf: a prop the native header drops would fail there and not in the web one.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const MENU = {
    triggerLabel: 'More editor actions',
    closeLabel: 'Close',
    discardLabel: 'Discard draft',
    onDiscard: noop,
};

const headerProps = {
    closeLabel: 'Close editor',
    onClose: noop,
};

export default defineCard({
    group: 'Editor',
    height: 260,
    platforms: 'both',
    uses: ['EditorHeader'],
    render: ({ EditorHeader }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <EditorHeader title="New recipe" status="Saved just now" menu={MENU} {...headerProps} />
            <EditorHeader title="Edit recipe" status="Saving…" menu={MENU} {...headerProps} />
            <EditorHeader title="New recipe" status={undefined} {...headerProps} />
        </div>
    ),
    renderNative: ({ EditorHeader }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <EditorHeader title="New recipe" status="Saved just now" menu={MENU} {...headerProps} />
            <EditorHeader title="Edit recipe" status="Saving…" menu={MENU} {...headerProps} />
            <EditorHeader title="New recipe" status={undefined} {...headerProps} />
        </div>
    ),
});
