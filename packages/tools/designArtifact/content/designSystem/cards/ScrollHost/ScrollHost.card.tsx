/**
 * @module ScrollHost.card — the design-system card of the ScrollHost. ScrollHost draws nothing: on the web the
 * SectionSwitch reads and moves the page through it; on native the screen's scroller takes `bind` and a CreateFab
 * beside it reads the host and shrinks to its disc once scrolled down.
 */
import { useCallback } from 'react';
import type { CSSProperties } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';
import { nextFrame, waitFor } from '../../../../src/cards/waitFor.js';

const steps = [
    'Whisk the ricotta, eggs and lemon zest.',
    'Fold in the flour and rest the batter 10 minutes.',
    'Cook on a medium pan until the edges set.',
    'Flip once and finish for one more minute.',
    'Serve warm with lemon curd.',
];
const title: CSSProperties = { margin: 0, font: '700 28px Georgia, serif' };
const heading: CSSProperties = { margin: 0, font: '600 18px Inter, system-ui' };
const text: CSSProperties = { margin: 0, font: '14px Inter, system-ui', color: 'var(--ink-muted)' };
const section: CSSProperties = {
    background: 'var(--paper)',
    border: '1px solid var(--line-divider)',
    borderRadius: 12,
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
};
const phone: CSSProperties = {
    position: 'relative',
    transform: 'translateZ(0)',
    height: 320,
    width: 358,
    border: '1px solid var(--line-divider)',
    borderRadius: 24,
    overflow: 'hidden',
    background: 'var(--canvas)',
};

interface ScrollBind {
    readonly ref: (handle: { scrollTo: (options: { y: number }) => void }) => void;
    readonly onScroll: (event: {
        nativeEvent: {
            contentOffset: { y: number };
            layoutMeasurement: { height: number };
            contentSize: { height: number };
        };
    }) => void;
}

function Scroller({ bind }: { readonly bind: ScrollBind }) {
    // A callback ref hands the node over when it mounts, with no effect and no ref object.
    const handOver = useCallback(
        (node: HTMLDivElement | null) => {
            if (node !== null) {
                bind.ref({ scrollTo: (options) => node.scrollTo({ top: options.y }) });
            }
        },
        [bind],
    );

    return (
        <div
            ref={handOver}
            data-scroller=""
            style={{ height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box' }}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h1 style={title}>Lemon ricotta pancakes</h1>
                <div style={section}>
                    <h2 style={heading}>Ingredients</h2>
                    <p style={text}>1 cup ricotta, 2 eggs, 1 lemon (zest and juice)</p>
                </div>
                <div style={section}>
                    <h2 style={heading}>Method</h2>
                    {steps.map((step, index) => (
                        <p key={step} style={text}>
                            {String(index + 1)}. {step}
                        </p>
                    ))}
                </div>
                <div style={{ height: 80 }} />
            </div>
        </div>
    );
}

export default defineCard({
    group: 'Layout',
    height: 440,
    platforms: 'both',
    uses: ['ScrollHost', 'SectionSwitch', 'CreateFab'],
    staging: { phoneViewport: true },
    afterRender: async ({ native }) => {
        // Scroll the phone's list down 90 px, the way a thumb would, and wait until the host has been told.
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
    notes: { native: 'Scrolled down 90 px: the host reports scrollingDown, so the CreateFab shrinks to its disc.' },
    render: ({ ScrollHost, SectionSwitch, CreateFab }, { platform }) =>
        platform === 'web' ? (
            <ScrollHost headingId="title" sections={['ingredients', 'method']}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <h1 id="title" style={title}>
                        Lemon ricotta pancakes
                    </h1>
                    <SectionSwitch
                        label="Recipe sections"
                        sections={[
                            { id: 'ingredients', label: 'Ingredients' },
                            { id: 'method', label: 'Method' },
                        ]}
                        currentId="ingredients"
                    />
                    <div style={section}>
                        <h2 id="ingredients" tabIndex={-1} style={heading}>
                            Ingredients
                        </h2>
                        <p style={text}>1 cup ricotta, 2 eggs, 1 lemon (zest and juice)</p>
                    </div>
                    <div style={section}>
                        <h2 id="method" tabIndex={-1} style={heading}>
                            Method
                        </h2>
                        <p style={text}>Whisk, rest 10 minutes, cook on a medium pan.</p>
                    </div>
                    <p style={text}>
                        ScrollHost draws nothing itself; the switch above reads and moves the page through it.
                    </p>
                </div>
            </ScrollHost>
        ) : (
            <div style={phone}>
                <ScrollHost headingId="title" sections={[]}>
                    {(bind: ScrollBind) => (
                        <>
                            <Scroller bind={bind} />
                            <CreateFab label="New recipe" icon="plus" onPress={() => undefined} />
                        </>
                    )}
                </ScrollHost>
            </div>
        ),
});
