/**
 * @module PushedPageFrame.card — the design-system card of the PushedPageFrame: the frame every pushed page mounts, with
 * Back pinned in the bar over the page's one scroller (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md`). On native the
 * phone is scrolled down, so the bar shows its surface over the page; the web page sits at its top, where the bar draws
 * Back alone below 840 and the large title's eyebrow carries Back from 840.
 */
import { useCallback } from 'react';
import type { CSSProperties } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';
import { nextFrame, waitFor } from '../../../../src/cards/waitFor.js';

const noop = (): void => undefined;
const back = { label: 'Back to Collections', parent: 'Collections', onPress: noop };
const recipes = [
    'Weeknight pasta',
    'Lemon ricotta pancakes',
    'Sunday roast chicken',
    'Miso salmon',
    'Black bean chili',
];
const title: CSSProperties = { margin: 0, font: '600 28px Inter, system-ui' };
const text: CSSProperties = { margin: 0, font: '15px Inter, system-ui', color: 'var(--ink-muted)' };
const row: CSSProperties = {
    background: 'var(--paper)',
    border: '1px solid var(--line-divider)',
    borderRadius: 12,
    padding: '12px 16px',
    font: '15px Inter, system-ui',
    color: 'var(--ink)',
};
/** The phone's height; the scroller takes it too, because the frame does not stretch to its parent. */
const PHONE_HEIGHT = 320;
const phone: CSSProperties = {
    position: 'relative',
    transform: 'translateZ(0)',
    height: PHONE_HEIGHT,
    width: 358,
    border: '1px solid var(--line-divider)',
    borderRadius: 24,
    overflow: 'hidden',
    background: 'var(--canvas)',
};

interface ScrollBind {
    readonly ref: (handle: ScrollHandle) => void;
    readonly onScroll: (event: {
        nativeEvent: {
            contentOffset: { y: number };
            layoutMeasurement: { height: number };
            contentSize: { height: number };
        };
    }) => void;
}

interface ScrollHandle {
    readonly scrollTo: (options: { y: number }) => void;
}

/**
 * One handle per scroller node. The frame stores the handle in state, so a new object on every call would re-render the
 * frame, which hands the scroller a new `bind`, which calls the ref again: a render loop.
 */
const handles = new WeakMap<HTMLElement, ScrollHandle>();

function handleFor(node: HTMLElement): ScrollHandle {
    const known = handles.get(node);

    if (known !== undefined) {
        return known;
    }

    const handle: ScrollHandle = { scrollTo: (options) => node.scrollTo({ top: options.y }) };

    handles.set(node, handle);

    return handle;
}

interface PushedPageInset {
    readonly paddingTop: number;
}

function Page() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h1 id="collection" style={title}>
                Weeknight dinners
            </h1>
            <p style={text}>Fast, forgiving meals for school nights.</p>
            {recipes.map((recipe) => (
                <div key={recipe} style={row}>
                    {recipe}
                </div>
            ))}
            <div style={{ height: 80 }} />
        </div>
    );
}

function Scroller({ bind, inset }: { readonly bind: ScrollBind; readonly inset: PushedPageInset }) {
    // A callback ref hands the node over when it mounts, with no effect and no ref object.
    const handOver = useCallback(
        (node: HTMLDivElement | null) => {
            if (node !== null) {
                bind.ref(handleFor(node));
            }
        },
        [bind],
    );

    return (
        <div
            ref={handOver}
            data-scroller=""
            style={{
                height: PHONE_HEIGHT,
                overflowY: 'auto',
                padding: 16,
                paddingTop: 16 + inset.paddingTop,
                boxSizing: 'border-box',
            }}
            onScroll={(event) => {
                const node = event.currentTarget;

                bind.onScroll({
                    nativeEvent: {
                        contentOffset: { y: node.scrollTop },
                        layoutMeasurement: { height: node.clientHeight },
                        contentSize: { height: node.scrollHeight },
                    },
                });
            }}
        >
            <Page />
        </div>
    );
}

export default defineCard({
    group: 'Layout',
    height: 560,
    platforms: 'both',
    uses: ['PushedPageFrame'],
    staging: { phoneViewport: true },
    afterRender: async ({ native }) => {
        // Scroll the phone's page down 90 px and wait until the frame has been told.
        const scroller = await waitFor(() => native?.querySelector<HTMLElement>('[data-scroller]'), {
            description: 'the native scroller',
        });
        const scrolled = new Promise<void>((resolve) => {
            scroller.addEventListener('scroll', () => resolve(), { once: true });
        });

        scroller.scrollTop = 90;
        await scrolled;
        await nextFrame();
    },
    notes: {
        native: 'Scrolled down 90 px: the bar shows its surface over the page, and Back stays pinned.',
        web: 'At the top of the page: below 840 the bar draws Back alone; from 840 the eyebrow above the title is Back.',
    },
    render: ({ PushedPageFrame }, { platform }) =>
        platform === 'web' ? (
            <PushedPageFrame back={back} headingId="collection" title="Weeknight dinners">
                {() => <Page />}
            </PushedPageFrame>
        ) : (
            <div style={phone}>
                <PushedPageFrame back={back} headingId="collection" title="Weeknight dinners">
                    {(bind: ScrollBind, inset: PushedPageInset) => <Scroller bind={bind} inset={inset} />}
                </PushedPageFrame>
            </div>
        ),
});
