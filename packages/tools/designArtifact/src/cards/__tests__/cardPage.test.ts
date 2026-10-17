import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { cardMarker } from '../../artifactFormat.js';
import { DesignArtifactError } from '../../errors.js';
import { cardPage } from '../cardPage.js';
import type { CardPageSpec } from '../cardPage.js';

/** A stand-in for the compiled card: `render` records what the page handed it. */
const FAKE_SCRIPT = `var __card = { default: {
    render: function (ui, ctx) { return { ui: ui, ctx: ctx }; },
    afterRender: function (columns) { window.__columns = columns; }
} };`;

const BOTH: CardPageSpec = { group: 'Actions', height: 330, platforms: 'both' };

interface Rendered {
    readonly root: string;
    readonly node: { ui: unknown; ctx: { platform: string; stack: string } };
}

/** Runs the page in jsdom with a fake React DOM and the two namespaces the host would provide. */
function run(html: string): { dom: JSDOM; rendered: Rendered[] } {
    const rendered: Rendered[] = [];
    const web = { name: 'web' };
    const native = { name: 'native' };
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        beforeParse(window) {
            const w = window as unknown as Record<string, unknown>;

            w['Commise'] = Object.assign({}, web, { Native: native });
            w['ReactDOM'] = {
                flushSync: (work: () => void) => work(),
                createRoot: (el: Element) => ({
                    render: (node: Rendered['node']) => rendered.push({ root: el.id, node }),
                }),
            };
        },
    });

    return { dom, rendered };
}

describe('cardPage markup', () => {
    it('opens with the host marker, built by artifactFormat', () => {
        const html = cardPage(BOTH, FAKE_SCRIPT);

        expect(html.startsWith(`${cardMarker({ group: 'Actions', height: 330 })}\n<!doctype html>`)).toBe(true);
    });

    it('carries the shared style block exactly once', () => {
        expect(cardPage(BOTH, FAKE_SCRIPT).match(/<style>/gu)).toHaveLength(1);
    });

    it('lays out a Web and a Native · iOS column for a card on both platforms', () => {
        const { dom } = run(cardPage(BOTH, FAKE_SCRIPT));
        const labels = [...dom.window.document.querySelectorAll('section > h2.lbl')].map((h) => h.textContent);

        expect(labels).toEqual(['Web', 'Native · iOS']);
        expect(dom.window.document.querySelector('section.web #w')).not.toBeNull();
        expect(dom.window.document.querySelector('section.native #n')).not.toBeNull();
    });

    it('explains a missing native leaf and mounts only the web root', () => {
        const spec: CardPageSpec = {
            group: 'Overlays',
            height: 160,
            platforms: 'web',
            reason: 'a tooltip needs hover.',
        };
        const { dom, rendered } = run(cardPage(spec, FAKE_SCRIPT));
        const note = dom.window.document.querySelector('section.native .muted');

        expect(note?.textContent).toBe('No native leaf — a tooltip needs hover.');
        expect(dom.window.document.querySelector('#n')).toBeNull();
        expect(rendered.map((r) => r.root)).toEqual(['w']);
    });

    it('explains a missing web leaf and mounts only the native root', () => {
        const spec: CardPageSpec = { group: 'Overlays', height: 560, platforms: 'native', reason: 'Radix owns web.' };
        const { dom, rendered } = run(cardPage(spec, FAKE_SCRIPT));

        expect(dom.window.document.querySelector('section.native .muted')?.textContent).toBe(
            'Native only — Radix owns web.',
        );
        expect(dom.window.document.querySelector('section.web')).toBeNull();
        expect(rendered.map((r) => r.root)).toEqual(['n']);
    });

    it('escapes the reason and the column notes as text', () => {
        const spec: CardPageSpec = {
            group: 'G',
            height: 100,
            platforms: 'web',
            reason: '<img src=x onerror=alert(1)>',
            notes: { web: '</p><b>x</b>' },
        };
        const { dom } = run(cardPage(spec, FAKE_SCRIPT));

        expect(dom.window.document.querySelector('img')).toBeNull();
        expect(dom.window.document.querySelector('b')).toBeNull();
        expect(dom.window.document.querySelector('section.native .muted')?.textContent).toContain('<img');
    });

    it('puts a column note under its column', () => {
        const spec: CardPageSpec = { ...BOTH, notes: { native: 'Scrolled down 90 px.' } };
        const { dom } = run(cardPage(spec, FAKE_SCRIPT));

        expect(dom.window.document.querySelector('section.native p.note')?.textContent).toBe('Scrolled down 90 px.');
        expect(dom.window.document.querySelector('section.web p.note')).toBeNull();
    });

    it('refuses a single-platform card with no reason', () => {
        expect(() => cardPage({ group: 'G', height: 10, platforms: 'web' }, FAKE_SCRIPT)).toThrow(
            expect.objectContaining({ name: 'DesignArtifactError', code: 'invalid-card' }),
        );
        expect(() => cardPage({ group: 'G', height: 10, platforms: 'native', reason: '' }, FAKE_SCRIPT)).toThrow(
            DesignArtifactError,
        );
    });

    it('is safe to inline: a script that mentions a closing tag cannot end the element', () => {
        const hostile = `${FAKE_SCRIPT}\nvar s = '</script><!--';`;
        const { dom } = run(cardPage(BOTH, hostile));

        expect(dom.window.document.querySelectorAll('script:not([type])')).toHaveLength(1);
    });
});

describe('cardPage config', () => {
    it('carries the runtime config as a JSON element, not as script source', () => {
        const spec: CardPageSpec = {
            ...BOTH,
            staging: { phoneViewport: true, portalIntoColumn: { frameHeight: 400 } },
        };
        const { dom } = run(cardPage(spec, FAKE_SCRIPT));
        const element = dom.window.document.getElementById('card-config');

        expect(element?.getAttribute('type')).toBe('application/json');
        expect(JSON.parse(element?.textContent ?? '')).toEqual({
            platforms: 'both',
            phoneViewport: true,
            frameHeight: 400,
        });
    });
});

describe('cardPage run time', () => {
    it('renders the web namespace into #w and Commise.Native into #n, each with its layout context', () => {
        const { rendered } = run(cardPage(BOTH, FAKE_SCRIPT));

        expect(rendered).toEqual([
            {
                root: 'w',
                node: { ui: { name: 'web', Native: { name: 'native' } }, ctx: { platform: 'web', stack: 'row' } },
            },
            { root: 'n', node: { ui: { name: 'native' }, ctx: { platform: 'native', stack: 'col' } } },
        ]);
    });

    it('draws the native column with renderNative when the card has one, and the web column with render', () => {
        const script = `var __card = { default: {
            render: function () { return { drawnBy: 'render' }; },
            renderNative: function (ui, ctx) { return { drawnBy: 'renderNative', stack: ctx.stack, ui: ui }; }
        } };`;
        const { rendered } = run(cardPage(BOTH, script));

        expect(rendered.map((r) => [r.root, (r.node as unknown as { drawnBy: string }).drawnBy])).toEqual([
            ['w', 'render'],
            ['n', 'renderNative'],
        ]);
        expect(rendered[1]?.node).toMatchObject({ stack: 'col', ui: { name: 'native' } });
    });

    it('flags the page ready only after every shown column rendered and afterRender ran', () => {
        const order: string[] = [];
        const dom = new JSDOM(
            cardPage(
                BOTH,
                FAKE_SCRIPT.replace(
                    'window.__columns = columns;',
                    'window.__ready = document.documentElement.dataset.cardReady; window.__columns = columns;',
                ),
            ),
            {
                runScripts: 'dangerously',
                beforeParse(window) {
                    const w = window as unknown as Record<string, unknown>;

                    w['Commise'] = { Native: {} };
                    w['ReactDOM'] = {
                        flushSync: (work: () => void) => work(),
                        createRoot: (el: Element) => ({
                            render: () =>
                                order.push(`${el.id}:${String(el.ownerDocument.documentElement.dataset['cardReady'])}`),
                        }),
                    };
                },
            },
        );
        const w = dom.window as unknown as { __ready?: string };

        expect(order).toEqual(['w:undefined', 'n:undefined']);
        expect(w.__ready).toBeUndefined();
        expect(dom.window.document.documentElement.dataset['cardReady']).toBe('true');
    });

    describe('an afterRender that returns a promise', () => {
        /** A card whose afterRender settles when the test says so (`window.__settle`) or rejects. */
        const pending = (body: string): string => `var __card = { default: {
            render: function () { return null; },
            afterRender: function () { return new Promise(function (resolve, reject) { window.__settle = ${body}; }); }
        } };`;
        const flag = (dom: JSDOM): string | undefined => dom.window.document.documentElement.dataset['cardReady'];
        const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

        it('flags ready only once the promise has settled', async () => {
            const { dom } = run(cardPage(BOTH, pending('resolve')));

            await tick();
            expect(flag(dom)).toBeUndefined();

            (dom.window as unknown as { __settle: () => void }).__settle();
            await tick();

            expect(flag(dom)).toBe('true');
        });

        it('never flags ready when the promise rejects, and records the failure on the page', async () => {
            const { dom } = run(cardPage(BOTH, pending('reject')));

            (dom.window as unknown as { __settle: (reason: string) => void }).__settle('boom');
            await tick();

            expect(flag(dom)).toBeUndefined();
            expect(dom.window.document.documentElement.dataset['cardError']).toContain('boom');
        });
    });

    it('hands afterRender the mounted column elements', () => {
        const { dom } = run(cardPage(BOTH, FAKE_SCRIPT));
        const columns = (dom.window as unknown as { __columns: { web?: Element; native?: Element } }).__columns;

        expect(columns.web?.id).toBe('w');
        expect(columns.native?.id).toBe('n');
    });

    it.each<[string, CardPageSpec, { webStage?: string; nativeStage?: string }]>([
        ['no stages without portalIntoColumn', BOTH, {}],
        [
            'both stages with portalIntoColumn',
            { ...BOTH, staging: { portalIntoColumn: { frameHeight: 400 } } },
            { webStage: 'wf', nativeStage: 'nf' },
        ],
        [
            "only the shown column's stage on a native-only card",
            { ...BOTH, platforms: 'native', reason: 'r', staging: { portalIntoColumn: { frameHeight: 400 } } },
            { nativeStage: 'nf' },
        ],
    ])('hands afterRender the overlay stages: %s', (_case, spec, expected) => {
        const { dom } = run(cardPage(spec, FAKE_SCRIPT));
        const columns = (dom.window as unknown as { __columns: { webStage?: Element; nativeStage?: Element } })
            .__columns;

        expect({ webStage: columns.webStage?.id, nativeStage: columns.nativeStage?.id }).toEqual({
            webStage: expected.webStage,
            nativeStage: expected.nativeStage,
        });
    });

    it('leaves the window alone unless phoneViewport is asked for', () => {
        const { dom } = run(cardPage(BOTH, FAKE_SCRIPT));

        expect(dom.window.innerWidth).not.toBe(390);
    });

    it('phoneViewport makes the window 390 x 844 and announces the resize', () => {
        const { dom } = run(
            cardPage(
                { ...BOTH, staging: { phoneViewport: true } },
                `window.__resized = 0;\nwindow.addEventListener('resize', function () { window.__resized += 1; });\n${FAKE_SCRIPT}`,
            ),
        );
        const w = dom.window as unknown as { innerWidth: number; innerHeight: number; __resized: number };

        expect([w.innerWidth, w.innerHeight]).toEqual([390, 844]);
        expect(w.__resized).toBeGreaterThan(0);
    });

    it('phoneViewport also resizes visualViewport when the browser has one', () => {
        const { dom } = run(
            cardPage(
                { ...BOTH, staging: { phoneViewport: true } },
                `window.visualViewport = Object.assign(new EventTarget(), { width: 1000, height: 1000 });\n${FAKE_SCRIPT}`,
            ),
        );
        const vv = (dom.window as unknown as { visualViewport: { width: number; height: number } }).visualViewport;

        expect([vv.width, vv.height]).toEqual([390, 844]);
    });

    describe('phoneViewport and matchMedia', () => {
        /** Runs the page with a browser-like `matchMedia` that says "no" to everything it is asked. */
        function phoneMatches(query: string): { phone: boolean; plain: boolean } {
            const answer = (spec: CardPageSpec): boolean => {
                const dom = new JSDOM(cardPage(spec, FAKE_SCRIPT), {
                    runScripts: 'dangerously',
                    beforeParse(window) {
                        const w = window as unknown as Record<string, unknown>;

                        w['Commise'] = { Native: {} };
                        w['ReactDOM'] = {
                            flushSync: (work: () => void) => work(),
                            createRoot: () => ({ render: () => undefined }),
                        };
                        w['matchMedia'] = (q: string) => ({ media: q, matches: q.includes('prefers-reduced-motion') });
                    },
                });

                return (dom.window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia(query)
                    .matches;
            };

            return {
                phone: answer({ ...BOTH, staging: { phoneViewport: true } }),
                plain: answer(BOTH),
            };
        }

        it.each<[string, boolean]>([
            ['(max-width: 767px)', true],
            ['(max-width: 390px)', true],
            ['(max-width: 389px)', false],
            ['(min-width: 768px)', false],
            ['(min-width: 390px)', true],
            ['(min-height: 800px)', true],
            ['(min-height: 845px)', false],
            ['(min-width: 640px) and (max-width: 900px)', false],
            ['(max-width: 100px), (min-width: 300px)', true],
            ['(orientation: portrait)', true],
            ['(orientation: landscape)', false],
            ['(max-width: 40em)', true],
        ])('answers %s with the 390 x 844 phone: %s', (query, expected) => {
            expect(phoneMatches(query).phone).toBe(expected);
        });

        it('passes a query that is not about the viewport to the browser', () => {
            expect(phoneMatches('(prefers-reduced-motion: reduce)').phone).toBe(true);
        });

        it('leaves matchMedia alone without phoneViewport', () => {
            expect(phoneMatches('(max-width: 767px)').plain).toBe(false);
        });

        it('returns a list that can be subscribed to', () => {
            const { dom } = run(cardPage({ ...BOTH, staging: { phoneViewport: true } }, FAKE_SCRIPT));
            const list = (
                dom.window as unknown as {
                    matchMedia: (q: string) => { addEventListener: () => void; removeEventListener: () => void };
                }
            ).matchMedia('(max-width: 500px)');

            expect(() => {
                list.addEventListener();
                list.removeEventListener();
            }).not.toThrow();
        });
    });

    describe('portalIntoColumn', () => {
        const staged = cardPage({ ...BOTH, staging: { portalIntoColumn: { frameHeight: 400 } } }, FAKE_SCRIPT);

        it('adds a framed stage under each column, of the asked height', () => {
            const { dom } = run(staged);
            const frames = [...dom.window.document.querySelectorAll<HTMLElement>('.frame')];

            expect(frames.map((f) => [f.id, f.style.height])).toEqual([
                ['wf', '400px'],
                ['nf', '400px'],
            ]);
        });

        it('has no frames when it is not asked for', () => {
            expect(run(cardPage(BOTH, FAKE_SCRIPT)).dom.window.document.querySelector('.frame')).toBeNull();
        });

        async function appended(make: (document: Document) => HTMLElement): Promise<HTMLElement | null> {
            const { dom } = run(staged);
            const node = make(dom.window.document);

            dom.window.document.body.appendChild(node);
            await new Promise((resolve) => setTimeout(resolve, 0));

            return node.parentElement;
        }

        it('moves a react-native-web modal (a bare div on body) into the native frame', async () => {
            const parent = await appended((d) => d.createElement('div'));

            expect(parent?.id).toBe('nf');
        });

        it('moves a Radix overlay (fixed inset-0, or a radix- id) into the web frame', async () => {
            const byClass = await appended((d) =>
                Object.assign(d.createElement('div'), { className: 'fixed inset-0 z-50' }),
            );
            const byId = await appended((d) => Object.assign(d.createElement('div'), { id: 'radix-:r1:' }));

            expect([byClass?.id, byId?.id]).toEqual(['wf', 'wf']);
        });

        it('leaves a popper wrapper and any other node on the body', async () => {
            const popper = await appended((d) => {
                const el = d.createElement('div');

                el.setAttribute('data-radix-popper-content-wrapper', '');

                return el;
            });
            const other = await appended((d) => Object.assign(d.createElement('span'), { className: 'x' }));

            expect([popper?.tagName, other?.tagName]).toEqual(['BODY', 'BODY']);
        });
    });
});
