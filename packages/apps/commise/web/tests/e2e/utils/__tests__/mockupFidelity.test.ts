/**
 * Unit tier for the PURE core of the mockup-fidelity pass (`tests/e2e/utils/mockupFidelity.ts`).
 *
 * The Playwright spec that consumes this module owns the impure half — driving a browser, screenshotting a
 * wireframe and the live route, writing files. Everything it does with the numbers afterwards is pure, and
 * that is what is tested here: which anchors are present on which side, which computed properties actually
 * differ, and whether the emitted report is byte-DETERMINISTIC (the property the two-run baseline-stability
 * proof rests on — an unstable report is worse than no report, because a reviewer cannot tell a real drift
 * from run-to-run noise).
 *
 * These are DAMP, not DRY: each case states its own observations inline so a failure reads as a fact about
 * the domain rather than a diff against a shared fixture.
 */
import { describe, expect, it } from 'vitest';

import {
    buildFidelityReport,
    compareAnchor,
    renderFidelityHtml,
    tokenRgbStrings,
    type AnchorObservation,
    type FidelityPairInput,
} from '../mockupFidelity.js';

/** A minimal, fully-populated observation; `over` names only what the case is about. */
function makeObservation(over: Partial<AnchorObservation> = {}): AnchorObservation {
    return {
        text: 'Good afternoon, Chef!',
        style: {
            fontFamily: '"Playfair Display", Georgia, serif',
            fontSize: '30px',
            fontWeight: '700',
            lineHeight: '36px',
            color: 'rgb(45, 52, 54)',
            backgroundColor: 'rgba(0, 0, 0, 0)',
            backgroundImage: 'none',
            borderRadius: '0px',
            width: 320,
            height: 36,
        },
        ...over,
    };
}

const TOKENS = {
    palette: { seafoam: '#31807A' },
    spacing: { 4: 16 },
    radius: { md: 12 },
    typography: { display: '"Playfair Display", Georgia, serif' },
} as const;

const ENVIRONMENT = {
    browser: 'chromium',
    viewport: { width: 1280, height: 800 },
    clockIso: '2026-05-31T15:30:00.000Z',
    timezone: 'UTC',
    locale: 'en-US',
} as const;

/** One complete pair input, so a case can vary a single field. */
function makePair(over: Partial<FidelityPairInput> = {}): FidelityPairInput {
    return {
        slug: 'home',
        mockupFile: 'screen-home.html',
        route: '/en',
        requirementIds: ['FR-046'],
        images: { mockup: 'home/mockup.png', implementation: 'home/implementation.png' },
        caveats: [],
        anchors: [{ anchor: 'greeting', mockup: makeObservation(), implementation: makeObservation() }],
        ...over,
    };
}

describe('tokenRgbStrings', () => {
    it('renders each 6-digit hex token as the `rgb(r, g, b)` string a browser reports', () => {
        // The comparison has to happen in the browser's own vocabulary: `getComputedStyle` never returns a hex.
        expect(tokenRgbStrings({ sand: '#FAF6F0', seafoam: '#31807A' })).toEqual(
            new Set(['rgb(250, 246, 240)', 'rgb(49, 128, 122)']),
        );
    });

    it('is case-insensitive about the hex, because a token file may write either case', () => {
        expect(tokenRgbStrings({ sand: '#faf6f0' })).toEqual(new Set(['rgb(250, 246, 240)']));
    });

    it('expands 3-digit shorthand hexes', () => {
        expect(tokenRgbStrings({ white: '#fff' })).toEqual(new Set(['rgb(255, 255, 255)']));
    });

    it('skips values that are not hex colours, rather than emitting a malformed rgb string', () => {
        // `semantic.border` ships as `rgba(178, 190, 195, 0.3)`, and gradient tokens are whole CSS functions.
        expect(tokenRgbStrings({ border: 'rgba(178, 190, 195, 0.3)', ring: '#5BA8A0' })).toEqual(
            new Set(['rgb(91, 168, 160)']),
        );
    });

    it('walks nested token groups, so a whole imported scale can be passed in one call', () => {
        expect(tokenRgbStrings({ palette: { sand: '#FAF6F0' }, semantic: { card: '#FFFFFF' } })).toEqual(
            new Set(['rgb(250, 246, 240)', 'rgb(255, 255, 255)']),
        );
    });
});

describe('compareAnchor', () => {
    it('reports presence "both" and no deltas when the two sides observe identical values', () => {
        const comparison = compareAnchor('greeting', makeObservation(), makeObservation());

        expect(comparison.presence).toBe('both');
        expect(comparison.deltas).toEqual([]);
    });

    it('names every differing property — and ONLY the differing ones', () => {
        const comparison = compareAnchor(
            'greeting',
            makeObservation({ style: { ...makeObservation().style!, fontSize: '36px' } }),
            makeObservation({ style: { ...makeObservation().style!, fontSize: '30px', fontWeight: '600' } }),
        );

        expect(comparison.deltas).toEqual([
            { property: 'fontSize', mockup: '36px', implementation: '30px' },
            { property: 'fontWeight', mockup: '700', implementation: '600' },
        ]);
    });

    it('treats the rendered TEXT as a comparable property, so a copy drift surfaces as a delta', () => {
        const comparison = compareAnchor(
            'pageHeading',
            makeObservation({ text: 'Profile & Account' }),
            makeObservation({ text: 'Profile' }),
        );

        expect(comparison.deltas).toContainEqual({
            property: 'text',
            mockup: 'Profile & Account',
            implementation: 'Profile',
        });
    });

    it('reports geometry deltas as rounded pixel strings rather than raw floats', () => {
        const comparison = compareAnchor(
            'greeting',
            makeObservation({ style: { ...makeObservation().style!, width: 320.4 } }),
            makeObservation({ style: { ...makeObservation().style!, width: 288.6 } }),
        );

        expect(comparison.deltas).toEqual([{ property: 'width', mockup: '320px', implementation: '289px' }]);
    });

    it('does NOT emit a geometry delta for a sub-pixel difference that rounds to the same px', () => {
        const comparison = compareAnchor(
            'greeting',
            makeObservation({ style: { ...makeObservation().style!, width: 320.2 } }),
            makeObservation({ style: { ...makeObservation().style!, width: 320.4 } }),
        );

        expect(comparison.deltas).toEqual([]);
    });

    it('surfaces a gradient-vs-flat page surface as a backgroundImage delta', () => {
        // The wireframes paint the page with `--gradient-beach-glow`, whose `background-color` stays
        // transparent. Comparing only `backgroundColor` would therefore report "both transparent, no drift"
        // on the single most token-relevant property of a surface.
        const comparison = compareAnchor(
            'documentSurface',
            makeObservation({
                style: {
                    ...makeObservation().style!,
                    backgroundImage: 'linear-gradient(135deg, rgb(250, 246, 240) 0%, rgb(232, 244, 248) 100%)',
                },
            }),
            makeObservation({ style: { ...makeObservation().style!, backgroundImage: 'none' } }),
        );

        expect(comparison.deltas).toEqual([
            {
                property: 'backgroundImage',
                mockup: 'linear-gradient(135deg, rgb(250, 246, 240) 0%, rgb(232, 244, 248) 100%)',
                implementation: 'none',
            },
        ]);
    });

    it('reports "mockup-only" — with no style deltas — when the implementation has no such element', () => {
        const comparison = compareAnchor('nutritionWidget', makeObservation({ text: "Today's Nutrition" }), {
            text: null,
            style: null,
        });

        expect(comparison.presence).toBe('mockup-only');
        // An absent element has no properties to differ ON; claiming 9 deltas against `null` would drown the
        // one fact that matters — the surface is missing.
        expect(comparison.deltas).toEqual([]);
    });

    it('reports "implementation-only" when the wireframe never specified the element', () => {
        const comparison = compareAnchor('versionHistoryLink', { text: null, style: null }, makeObservation());

        expect(comparison.presence).toBe('implementation-only');
        expect(comparison.deltas).toEqual([]);
    });

    it('reports "neither" when the anchor is absent on both sides', () => {
        const comparison = compareAnchor('ghost', { text: null, style: null }, { text: null, style: null });

        expect(comparison.presence).toBe('neither');
    });
});

describe('buildFidelityReport', () => {
    it('carries every pair with its FR requirement ids, images, and comparisons', () => {
        const report = buildFidelityReport({
            environment: ENVIRONMENT,
            tokens: TOKENS,
            pairs: [makePair()],
            unpaired: [],
        });

        expect(report.pairs).toHaveLength(1);
        expect(report.pairs[0]?.requirementIds).toEqual(['FR-046']);
        expect(report.pairs[0]?.images.mockup).toBe('home/mockup.png');
        expect(report.pairs[0]?.anchors[0]?.presence).toBe('both');
    });

    it('embeds the @commise/ui token scale, which is the reviewer’s frame of reference', () => {
        const report = buildFidelityReport({
            environment: ENVIRONMENT,
            tokens: TOKENS,
            pairs: [makePair()],
            unpaired: [],
        });

        expect(report.tokens).toEqual(TOKENS);
    });

    it('orders pairs by slug so two runs emit the same document regardless of capture order', () => {
        const forward = buildFidelityReport({
            environment: ENVIRONMENT,
            tokens: TOKENS,
            pairs: [makePair({ slug: 'auth' }), makePair({ slug: 'home' }), makePair({ slug: 'recipes' })],
            unpaired: [],
        });
        const reversed = buildFidelityReport({
            environment: ENVIRONMENT,
            tokens: TOKENS,
            pairs: [makePair({ slug: 'recipes' }), makePair({ slug: 'home' }), makePair({ slug: 'auth' })],
            unpaired: [],
        });

        expect(forward.pairs.map((pair) => pair.slug)).toEqual(['auth', 'home', 'recipes']);
        expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    });

    it('contains NO wall-clock timestamp — the only instant it records is the PINNED clock', () => {
        const serialized = JSON.stringify(
            buildFidelityReport({ environment: ENVIRONMENT, tokens: TOKENS, pairs: [makePair()], unpaired: [] }),
        );

        // A `generatedAt: new Date()` is the single easiest way to make a "stable" artifact differ on every
        // run, which would silently void the two-run stability proof this report is measured by.
        expect(serialized).not.toMatch(/generatedAt|capturedAt/);
        expect(serialized).toContain('2026-05-31T15:30:00.000Z');
    });

    it('summarizes how many anchors drifted, so a reviewer knows where to look first', () => {
        const drifted = makePair({
            slug: 'recipes',
            anchors: [
                { anchor: 'a', mockup: makeObservation(), implementation: makeObservation() },
                {
                    anchor: 'b',
                    mockup: makeObservation({ text: 'Recipes' }),
                    implementation: makeObservation({ text: 'My Recipes' }),
                },
                { anchor: 'c', mockup: makeObservation(), implementation: { text: null, style: null } },
            ],
        });

        const report = buildFidelityReport({
            environment: ENVIRONMENT,
            tokens: TOKENS,
            pairs: [drifted],
            unpaired: [],
        });

        expect(report.summary).toEqual({
            pairs: 1,
            unpaired: 0,
            anchorsCompared: 3,
            anchorsWithDeltas: 1,
            anchorsMissingFromImplementation: 1,
        });
    });

    it('records the wireframes that have no implementation at all, with the spec that owns them', () => {
        const report = buildFidelityReport({
            environment: ENVIRONMENT,
            tokens: TOKENS,
            pairs: [],
            unpaired: [{ mockupFile: 'screen-mealplan.html', owningSpec: '006-meal-planning' }],
        });

        expect(report.unpaired).toEqual([{ mockupFile: 'screen-mealplan.html', owningSpec: '006-meal-planning' }]);
        expect(report.summary.unpaired).toBe(1);
    });

    it('carries each pair’s caveats, so the artifact says what its own images cannot be trusted about', () => {
        const report = buildFidelityReport({
            environment: ENVIRONMENT,
            tokens: TOKENS,
            pairs: [
                makePair({
                    slug: 'profile',
                    caveats: ['the identity read is unreachable in the hermetic suite, so this is the degrade state'],
                }),
            ],
            unpaired: [],
        });

        expect(report.pairs[0]?.caveats).toEqual([
            'the identity read is unreachable in the hermetic suite, so this is the degrade state',
        ]);
    });

    it('rejects a pair that cites no FR requirement — a fidelity failure must map to a requirement', () => {
        expect(() =>
            buildFidelityReport({
                environment: ENVIRONMENT,
                tokens: TOKENS,
                pairs: [makePair({ requirementIds: [] })],
                unpaired: [],
            }),
        ).toThrow(/requirement/i);
    });

    it('rejects two pairs sharing a slug — they would overwrite each other’s images on disk', () => {
        expect(() =>
            buildFidelityReport({
                environment: ENVIRONMENT,
                tokens: TOKENS,
                pairs: [makePair({ slug: 'home' }), makePair({ slug: 'home' })],
                unpaired: [],
            }),
        ).toThrow(/home/);
    });
});

describe('renderFidelityHtml', () => {
    it('renders each pair side by side, naming the wireframe, the route and the FR ids', () => {
        const html = renderFidelityHtml(
            buildFidelityReport({ environment: ENVIRONMENT, tokens: TOKENS, pairs: [makePair()], unpaired: [] }),
        );

        expect(html).toContain('home/mockup.png');
        expect(html).toContain('home/implementation.png');
        expect(html).toContain('screen-home.html');
        expect(html).toContain('/en');
        expect(html).toContain('FR-046');
    });

    it('renders a pair’s caveats, so a reviewer cannot read the images without them', () => {
        const html = renderFidelityHtml(
            buildFidelityReport({
                environment: ENVIRONMENT,
                tokens: TOKENS,
                pairs: [makePair({ caveats: ['the identity read is unreachable, so this is the degrade state'] })],
                unpaired: [],
            }),
        );

        expect(html).toContain('the identity read is unreachable, so this is the degrade state');
    });

    it('escapes report text into the document, so a token value containing markup cannot inject it', () => {
        const html = renderFidelityHtml(
            buildFidelityReport({
                environment: ENVIRONMENT,
                tokens: TOKENS,
                pairs: [
                    makePair({
                        anchors: [
                            {
                                anchor: 'greeting',
                                mockup: makeObservation({ text: '<script>alert(1)</script>' }),
                                implementation: makeObservation({ text: 'Good afternoon, Chef!' }),
                            },
                        ],
                    }),
                ],
                unpaired: [],
            }),
        );

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('is deterministic — the same report renders the same bytes', () => {
        const report = buildFidelityReport({
            environment: ENVIRONMENT,
            tokens: TOKENS,
            pairs: [makePair()],
            unpaired: [],
        });

        expect(renderFidelityHtml(report)).toBe(renderFidelityHtml(report));
    });
});
