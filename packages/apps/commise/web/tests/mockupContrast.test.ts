/**
 * Repo-wide guard: `docs/mockups/` — the archived Figma-Make wireframes that ARE feature 001's visual
 * contract — must declare the SHIPPED design tokens, and must pair every accent FILL with a label that
 * clears the WCAG 2.1 AA floor.
 *
 * ## Why a docs directory gets a test
 *
 * #113 moved two palette tiers in OKLCH and gave the pastel tiers dark labels, because a white label on a
 * filled accent was measuring as low as 1.88:1. The mockups were left behind: they still declared the
 * PRE-#113 hexes and still paired `text-white` with every fill (35 white labels against 4 charcoal), so all
 * six pastel/mid tiers failed AA on the page a designer or an agent opens to answer "what should this look
 * like?". A stale visual contract is not a cosmetic problem — it is a REGRESSION GENERATOR: every future
 * "match the mockups" pass faithfully re-introduces the defect the product just fixed, and does so with the
 * design docs as justification.
 *
 * So the mockups are treated as what they are — a second REPRESENTATION of the palette — and held to the
 * same measured floor as the product:
 *
 *  1. **token parity.** Every `--color-*` a screen declares, plus `--destructive` and the `--chart-*` series,
 *     must equal the value `@commise/ui` ships. This is the assertion that fails when someone re-themes a
 *     token and forgets the wireframes (or vice versa).
 *  2. **rendered label contrast.** Every label and every `currentColor` icon whose background chain bottoms
 *     out on an accent FILL must clear 4.5:1 (SC 1.4.3) or 3:1 (SC 1.4.11) against the colour a reader
 *     actually sees — translucent glass panes and `/NN` tints composited, not measured against the raw token.
 *
 * The pairing walk deliberately reads only the RESTING state: a `hover:`/`focus:`-prefixed utility names a
 * state this file cannot know the entry condition for, and the resting pair is the one every reader gets.
 * Variant states are covered where they belong — on the components, by `utilityContrast(className, {
 * variant })` from `@commise/test-utils`.
 *
 * ## Why it lives in the WEB app
 *
 * The guard needs four things at once: Node's filesystem, a DOM parser, `@commise/ui`'s palette, and the
 * alpha-compositing contrast helpers. `@commise/web` is the only workspace with all four, and it already hosts
 * the repo's other design-artifact guards (`tests/nextConfig.test.ts`,
 * `tests/__integration__/tailwindTheme.integration.test.ts`, which compiles the generated `theme.css` and
 * asserts what a utility resolves to). The subject matter fits too: the archive is Tailwind utility classes in
 * HTML, which is the web platform's idiom.
 *
 * The two nearer-looking homes are both closed. `@commise/test-utils` — where `contrast.ts` lives — sets
 * `"types": []` so its browser-facing helpers cannot reach for a Node API; importing `node:fs` there fails
 * typecheck by design. `@commise/ui`, which owns the palette, cannot import the contrast helpers at all
 * (`@commise/test-utils` depends on it, so consuming it would close a workspace cycle — the same reason
 * `ui/src/tokens/__tests__/colors.test.ts` re-derives its own compositing).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { compositeOver, contrastRatio } from '@commise/test-utils';
import type { ContrastUse } from '@commise/test-utils';
import { chart, palette, semantic } from '@commise/ui/colors';
import { describe, expect, it } from 'vitest';

/**
 * The archive's location, resolved from this file rather than the working directory (the suite must give the
 * same answer under `npm test`, a Turbo task and an editor run alike).
 *
 * `fileURLToPath(new URL(…, import.meta.url))` — the idiom `infra/global`'s repo-wide guards use — cannot be
 * used here: this suite runs under jsdom, whose global `URL` is not Node's, so `fileURLToPath` rejects the
 * instance with "The URL must be of scheme file".
 */
const MOCKUP_DIR = resolve(import.meta.dirname, '../../../../../docs/mockups');

/** The archived screens, in a stable order so a failure names the same case run to run. */
const SCREENS: readonly string[] = readdirSync(`${MOCKUP_DIR}/screens`)
    .filter((name) => name.endsWith('.html'))
    .sort();

/** The WCAG 2.1 AA minimum for each use, mirroring `AA_FLOOR` in `@commise/test-utils`' `contrast.ts`. */
const AA_FLOOR: Record<ContrastUse, number> = { 'normal-text': 4.5, 'large-text': 3, 'ui-component': 3 };

/**
 * The tiers the product paints as an accent FILL beneath a label — the same set
 * `@commise/ui/src/tokens/__tests__/colors.test.ts` polices at the token. A pair is only asserted when the
 * background chain bottoms out on one of these: `white`/`sand`/`pearl` are SURFACES, and the contrast of body
 * copy on a surface is the components' own contract, not the wireframes'.
 */
const ACCENT_FILLS: readonly string[] = [
    'seafoam',
    'seafoam-light',
    'ocean-dark',
    'coral',
    'sky',
    'success',
    'warning',
    'error',
    'error-dark',
    'premium',
    'charcoal',
];

/**
 * The colour the mockups' own base layer gives text that declares none: their `@layer base` rule is
 * `body { color: var(--color-charcoal) }`. Modelling it explicitly is what keeps an unlabelled span on a
 * filled accent from being silently skipped — inheriting charcoal onto `bg-seafoam` is a real 2.72:1.
 */
const INHERITED_LABEL = 'charcoal';

/** One `--color-{tier}: {hex}` declaration inside a mockup's `:root` token block. */
const COLOR_TOKEN = /--color-([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g;

/**
 * A RESTING-state Tailwind colour utility: the role, the tier it names, and an optional `/NN` opacity —
 * `bg-coral`, `text-white`, `from-white/12`, `to-seafoam/8`.
 *
 * Variant-prefixed utilities (`hover:bg-coral`) do NOT match, on purpose: this file measures the resting
 * pair. Non-colour utilities that share a prefix (`text-sm`, `bg-gradient-to-br`, `to-transparent`) match the
 * shape but name no palette tier, and are dropped by the `tier in palette` filter.
 */
const COLOR_UTILITY = /^(bg|text|from|via|to)-([a-z-]+?)(?:\/(\d{1,3}))?$/;

/** A background or foreground colour an element declares: a palette tier at an alpha. */
interface Layer {
    readonly tier: string;
    readonly alpha: number;
}

/** A label/graphic pair that failed its floor, described well enough to fix without re-deriving it. */
interface Violation {
    readonly screen: string;
    readonly use: ContrastUse;
    readonly fill: string;
    readonly label: string;
    readonly ratio: string;
    readonly floor: number;
    readonly sample: string;
    /** The offending element's own class list, so a failure names the markup to edit. */
    readonly element: string;
}

describe('docs/mockups — design-token parity with @commise/ui', () => {
    it('archives at least one screen (a silent empty glob would pass every assertion below)', () => {
        expect(SCREENS.length).toBeGreaterThan(0);
    });

    it.each(SCREENS)('%s declares the shipped palette, tier for tier', (screen) => {
        expect(declaredColorTokens(read(`screens/${screen}`))).toEqual(normalized(palette));
    });

    it.each(SCREENS)('%s points --destructive at the shipped destructive tier', (screen) => {
        expect(declaredToken(read(`screens/${screen}`), 'destructive')).toBe(expandHex(semantic.destructive));
    });

    it.each(SCREENS)('%s declares the shipped chart series (the B25a collision stays fixed)', (screen) => {
        const html = read(`screens/${screen}`);

        expect(
            Object.fromEntries(Object.keys(chart).map((series) => [series, declaredToken(html, `chart-${series}`)])),
        ).toEqual(normalized(chart));
    });

    it("README's extracted-token table quotes the shipped values", () => {
        expect(readmeColorTable()).toEqual(normalized(palette));
    });
});

describe('docs/mockups — filled-accent label contrast (WCAG 2.1 AA)', () => {
    it.each(SCREENS)('%s gives every label on a filled accent a legible colour', (screen) => {
        expect(violationsIn(screen)).toEqual([]);
    });
});

/** Read one file out of the mockup archive. */
function read(relative: string): string {
    return readFileSync(`${MOCKUP_DIR}/${relative}`, 'utf8');
}

/** A palette map with every value lowercased and expanded to `#rrggbb`, for comparison with CSS text. Pure. */
function normalized(tokens: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, expandHex(value)]));
}

/** `#FFF` / `#FfFfFf` → `#ffffff`. Longer forms (8-digit) are lowercased only. Pure. */
function expandHex(hex: string): string {
    const body = hex.slice(1).toLowerCase();

    return body.length === 3 ? `#${[...body].map((channel) => `${channel}${channel}`).join('')}` : `#${body}`;
}

/**
 * The screen's DESIGN-token `:root` block — the one declaring `--color-seafoam`.
 *
 * Scoping matters twice over. A Figma-Make screen also carries Tailwind's own preflight `@layer theme` block,
 * whose `--color-black: #000` would read as a brand tier the palette is missing — and that same block
 * RE-DECLARES `--color-seafoam: var(--color-seafoam)`, so the anchor has to require a literal hex value or it
 * lands on the indirection instead of the definition.
 *
 * @throws Error when the screen declares no brand palette at all, which is a broken archive rather than a
 *   drifted one and must not read as an empty-vs-empty pass.
 */
function designTokenBlock(html: string): string {
    const anchor = /--color-seafoam:\s*#/.exec(html)?.index;

    if (anchor === undefined) {
        throw new Error('docs/mockups screen declares no --color-seafoam hex; the design-token block is missing.');
    }

    return html.slice(html.lastIndexOf(':root', anchor), html.indexOf('}', anchor));
}

/** Every `--color-*` a screen declares in its design-token block, keyed by tier. Pure. */
function declaredColorTokens(html: string): Record<string, string> {
    return Object.fromEntries(
        [...designTokenBlock(html).matchAll(COLOR_TOKEN)].map(([, tier, hex]) => [
            tier as string,
            expandHex(hex as string),
        ]),
    );
}

/**
 * One named custom property's declared value, read from the design-token block.
 *
 * @throws Error when the property is absent — a missing declaration must fail loudly rather than compare
 *   `undefined` against a token and read as a value mismatch.
 */
function declaredToken(html: string, property: string): string {
    const match = new RegExp(`--${property}:\\s*(#[0-9a-fA-F]{3,8})`).exec(designTokenBlock(html));

    if (match === null) {
        throw new Error(`docs/mockups declares no --${property}.`);
    }

    return expandHex(match[1] as string);
}

/**
 * The `| \`--color-x\` | \`#hex\` |` rows of the README's "Color Palette" table.
 *
 * The section is sliced out rather than the whole file scanned: the README ALSO carries an
 * original-vs-corrected changelog table whose first hex column quotes the pre-fix values on purpose, and a
 * whole-file scan reads those as the current ones.
 *
 * @throws Error when the section is missing, so a renamed heading fails loudly instead of comparing `{}`.
 */
function readmeColorTable(): Record<string, string> {
    const readme = read('README.md');
    const start = readme.indexOf('### Color Palette');

    if (start === -1) {
        throw new Error('docs/mockups/README.md has no "### Color Palette" section to compare.');
    }

    const section = readme.slice(start, readme.indexOf('###', start + '### Color Palette'.length));

    return Object.fromEntries(
        [...section.matchAll(/\|\s*`--color-([a-z-]+)`\s*\|\s*`(#[0-9A-Fa-f]{3,8})`\s*\|/g)].map(([, tier, hex]) => [
            tier as string,
            expandHex(hex as string),
        ]),
    );
}

/** Every failing label/graphic pair on one screen, deduplicated by what a fix would have to change. */
function violationsIn(screen: string): readonly Violation[] {
    const html = read(`screens/${screen}`);
    const tokens = declaredColorTokens(html);
    const document = new DOMParser().parseFromString(html.slice(html.indexOf('<body')), 'text/html');
    const found = new Map<string, Violation>();

    for (const element of document.querySelectorAll('*')) {
        const use = useOf(element);

        if (use === undefined) {
            continue;
        }

        const { fill, backdrops } = backgroundOf(element, tokens);

        if (fill === undefined || !ACCENT_FILLS.includes(fill)) {
            continue;
        }

        const label = labelOf(element);
        const floor = AA_FLOOR[use];
        const ratio = Math.min(
            ...backdrops.map((backdrop) => contrastRatio(flatten(label, backdrop, tokens), backdrop)),
        );

        if (ratio >= floor) {
            continue;
        }

        const violation: Violation = {
            screen,
            use,
            fill: `bg-${fill}`,
            label: `text-${label.tier}${label.alpha === 1 ? '' : `/${Math.round(label.alpha * 100)}`}`,
            ratio: ratio.toFixed(2),
            floor,
            sample: ownText(element).slice(0, 48),
            element: element.getAttribute('class') ?? '',
        };

        found.set(`${violation.fill} ${violation.label} ${violation.use}`, violation);
    }

    return [...found.values()];
}

/**
 * What the element is, for floor selection — or `undefined` when it carries nothing a reader must perceive.
 *
 * A `currentColor` SVG is included because it is coloured by the very `text-*` utility this walk resolves:
 * the mockups' circular quick-action buttons are icon-ONLY, so skipping them would have missed
 * `text-white` on `bg-sky` (1.79:1) and on `bg-warning` (1.88:1) — under even the 3:1 graphic floor.
 */
function useOf(element: Element): ContrastUse | undefined {
    if (ownText(element) !== '') {
        return 'normal-text';
    }

    const paintsIcon = [...element.children].some(
        (child) => child.tagName.toLowerCase() === 'svg' && child.outerHTML.includes('currentColor'),
    );

    return paintsIcon ? 'ui-component' : undefined;
}

/** The element's OWN text (descendants excluded — they resolve their own pair). Pure. */
function ownText(element: Element): string {
    return [...element.childNodes]
        .filter((node) => node.nodeType === node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
}

/**
 * The opaque colour(s) a reader sees behind the element's text, and the accent FILL the chain bottoms out on.
 *
 * The walk climbs self → ancestors, collecting each level's background layers, and stops at the first OPAQUE
 * one. Translucent layers above it are then composited back down, so a `text-charcoal` label on a
 * `from-white/12` glass pane over `bg-charcoal` is measured against the ~#464c4e a reader actually sees
 * rather than against charcoal. A gradient contributes ALL its stops as alternative backdrops, and the caller
 * scores the worst of them — a label that is legible at one end of a gradient and not the other is illegible.
 *
 * @returns `fill: undefined` when no opaque background is reached, which means the element sits on the page's
 *   own near-white gradient — a surface, not an accent, and therefore not this file's contract.
 */
function backgroundOf(
    element: Element,
    tokens: Readonly<Record<string, string>>,
): { readonly fill: string | undefined; readonly backdrops: readonly string[] } {
    const translucent: (readonly Layer[])[] = [];

    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const layers = paintedLayers(node);
        const opaque = layers.filter((layer) => layer.alpha === 1);

        if (opaque.length > 0) {
            const fill = (opaque[0] as Layer).tier;
            const backdrops = translucent.reduceRight<readonly string[]>(
                (below, level) => below.flatMap((backdrop) => level.map((layer) => flatten(layer, backdrop, tokens))),
                [tokens[fill] as string],
            );

            return { fill, backdrops: [...new Set(backdrops)] };
        }

        if (layers.length > 0) {
            translucent.push(layers);
        }
    }

    return { fill: undefined, backdrops: [] };
}

/** The background layers an element paints on itself: its own `bg-*` fill and/or its gradient stops. Pure. */
function paintedLayers(element: Element): readonly Layer[] {
    return utilities(element).filter((layer) => layer.role !== 'text');
}

/** The colour the element's text takes: its own `text-*`, else the nearest ancestor's, else the base rule. */
function labelOf(element: Element): Layer {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const declared = utilities(node).filter((layer) => layer.role === 'text');

        if (declared.length > 0) {
            return declared[declared.length - 1] as Layer;
        }
    }

    return { tier: INHERITED_LABEL, alpha: 1 };
}

/** Every palette-coloured resting utility on one element, tagged with its role. Pure. */
function utilities(element: Element): readonly (Layer & { readonly role: string })[] {
    return (element.getAttribute('class') ?? '')
        .split(/\s+/)
        .map((token) => COLOR_UTILITY.exec(token))
        .filter((match): match is RegExpExecArray => match !== null && (match[2] as string) in palette)
        .map((match) => ({
            role: match[1] as string,
            tier: match[2] as string,
            alpha: match[3] === undefined ? 1 : Number.parseInt(match[3], 10) / 100,
        }));
}

/** A layer flattened onto the opaque colour beneath it, as `#rrggbb`. Pure. */
function flatten(layer: Layer, backdrop: string, tokens: Readonly<Record<string, string>>): string {
    const color = tokens[layer.tier] as string;

    return layer.alpha === 1 ? color : compositeOver(withAlpha(color, layer.alpha), backdrop);
}

/** An opaque `#rrggbb` at an alpha, in the `rgba()` notation `compositeOver` parses. Pure. */
function withAlpha(color: string, alpha: number): string {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));

    return `rgba(${channels.join(', ')}, ${alpha})`;
}
