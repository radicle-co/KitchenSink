/**
 * @module tests/e2e/utils/mockupFidelity — the PURE core of the U10a mockup-fidelity pass.
 *
 * ## What this pass is, and what it deliberately is NOT
 *
 * `docs/mockups/screens/screen-*.html` are feature 001's visual CONTRACT — the archived Figma-Make
 * wireframes a designer or an agent opens to answer "what should this look like?". This module backs a
 * Playwright pass ({@link file://./../mockupFidelity.spec.ts}) that renders a wireframe and the live route it
 * specifies **in the same browser at the same viewport under the same pinned clock**, so the two PNGs are
 * directly comparable, and emits a structured record of what the two documents actually computed.
 *
 * It is **not** a pixel-diff threshold engine, on purpose. A pixel-diff answers "how many pixels moved",
 * which is the question nobody asks: a 3% diff can be a font-fallback shrug or a palette regression, and no
 * threshold can tell them apart. What a reviewer — human or LLM — needs is the image PAIR plus the numbers
 * behind it: this heading is 30px in the implementation and 36px in the wireframe, and `@commise/ui`'s scale
 * says `display.md` is 28px, so neither side is on the ramp. That is a token conversation, and it is the one
 * this report is shaped to have. Token/contrast PARITY at the value level is already policed by
 * `tests/mockupContrast.test.ts`; this module never re-asserts it (one authoritative representation).
 *
 * ## Patterns
 *
 * **Value object + pure builder.** Every export here is a pure function over plain data: the spec owns all
 * I/O (browser, screenshots, filesystem) and hands the numbers over. That split is what makes the interesting
 * half unit-testable without a browser, and it is why the determinism property below is assertable at all.
 *
 * **Deterministic by construction.** The report carries NO wall-clock instant, and pairs/anchors/deltas are
 * emitted in a fixed order. Two unchanged runs must produce byte-identical `report.json` and `index.html` —
 * an artifact that differs every run cannot distinguish a real drift from noise, which makes it worse than no
 * artifact. `__tests__/mockupFidelity.test.ts` holds that line.
 */

/** The computed properties compared on both sides of a pair. Order here IS the delta order in the report. */
const STYLE_PROPERTIES = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'color',
    'backgroundColor',
    // The wireframes paint the page surface with `--gradient-beach-glow`, which leaves `background-color`
    // transparent — so comparing colour alone would report "no drift" on the most token-relevant property a
    // surface has. Both are compared.
    'backgroundImage',
    'borderRadius',
] as const;

/** Geometry compared as ROUNDED pixels — sub-pixel layout noise is not a fidelity finding. */
const GEOMETRY_PROPERTIES = ['width', 'height'] as const;

/** One element's resolved presentation, as `getComputedStyle` + `getBoundingClientRect` report it. */
export interface AnchorStyle {
    readonly fontFamily: string;
    readonly fontSize: string;
    readonly fontWeight: string;
    readonly lineHeight: string;
    readonly color: string;
    readonly backgroundColor: string;
    /** `none`, or the resolved gradient/image — a flat token where a gradient was specified is real drift. */
    readonly backgroundImage: string;
    readonly borderRadius: string;
    /** CSS px, unrounded — {@link compareAnchor} rounds before comparing. */
    readonly width: number;
    /** CSS px, unrounded — {@link compareAnchor} rounds before comparing. */
    readonly height: number;
}

/**
 * What one side of a pair observed for one anchor.
 *
 * `style: null` means the element is ABSENT on that side — the single most useful thing this pass can say
 * about a surface, so it is modelled explicitly rather than as an empty style.
 */
export interface AnchorObservation {
    readonly text: string | null;
    readonly style: AnchorStyle | null;
}

/** An anchor as observed on both sides, before comparison. */
export interface AnchorInput {
    readonly anchor: string;
    readonly mockup: AnchorObservation;
    readonly implementation: AnchorObservation;
}

/** Which sides rendered the anchor at all. */
export type AnchorPresence = 'both' | 'mockup-only' | 'implementation-only' | 'neither';

/** One property the two sides disagree on, quoted as both sides report it. */
export interface AnchorDelta {
    readonly property: string;
    readonly mockup: string;
    readonly implementation: string;
}

/** The compared anchor: where it exists, what each side observed, and every property that differs. */
export interface AnchorComparison {
    readonly anchor: string;
    readonly presence: AnchorPresence;
    readonly mockup: AnchorObservation;
    readonly implementation: AnchorObservation;
    readonly deltas: readonly AnchorDelta[];
}

/**
 * The capture conditions both sides shared. Recorded because a pair is only comparable if they DID share
 * them — a reviewer reading a 6px heading delta needs to know it was not simply a different viewport.
 */
export interface FidelityEnvironment {
    readonly browser: string;
    readonly viewport: { readonly width: number; readonly height: number };
    /** The instant the browser clock was pinned to — the only instant in the whole report. */
    readonly clockIso: string;
    readonly timezone: string;
    readonly locale: string;
}

/** The `@commise/ui` scale, passed through verbatim as the reviewer's frame of reference. */
export type FidelityTokens = Readonly<Record<string, unknown>>;

/** A wireframe paired with the live route that implements it. */
export interface FidelityPairInput {
    /** Stable kebab id; also the on-disk directory holding the pair's two PNGs. */
    readonly slug: string;
    readonly mockupFile: string;
    readonly route: string;
    /**
     * The `FR-*` ids this surface implements. Non-empty by contract: a fidelity failure that cites no
     * requirement is a matter of taste, and tastes do not belong in a build artifact.
     */
    readonly requirementIds: readonly string[];
    readonly images: { readonly mockup: string; readonly implementation: string };
    /**
     * What a reviewer must know before trusting this pair's images — e.g. "the implementation is showing its
     * degrade state because the identity read is unreachable in the hermetic suite". Required (pass `[]` when
     * there are none) so a caveat cannot be forgotten: an image pair read without its caveats produces
     * confident, wrong conclusions, which is worse than no artifact.
     */
    readonly caveats: readonly string[];
    readonly anchors: readonly AnchorInput[];
}

/** A wireframe with no live counterpart — a scope fact, not a fidelity defect. */
export interface UnpairedScreen {
    readonly mockupFile: string;
    /** The spec that owns the unbuilt surface, so the gap is traceable rather than mysterious. */
    readonly owningSpec: string;
}

/** A compared pair. */
export interface FidelityPair {
    readonly slug: string;
    readonly mockupFile: string;
    readonly route: string;
    readonly requirementIds: readonly string[];
    readonly images: { readonly mockup: string; readonly implementation: string };
    readonly caveats: readonly string[];
    readonly anchors: readonly AnchorComparison[];
}

/** Counts that tell a reviewer where to look first. */
export interface FidelitySummary {
    readonly pairs: number;
    readonly unpaired: number;
    readonly anchorsCompared: number;
    readonly anchorsWithDeltas: number;
    readonly anchorsMissingFromImplementation: number;
}

/** The emitted artifact. */
export interface FidelityReport {
    readonly environment: FidelityEnvironment;
    readonly summary: FidelitySummary;
    readonly tokens: FidelityTokens;
    readonly pairs: readonly FidelityPair[];
    readonly unpaired: readonly UnpairedScreen[];
}

/** Everything {@link buildFidelityReport} needs. */
export interface FidelityReportInput {
    readonly environment: FidelityEnvironment;
    readonly tokens: FidelityTokens;
    readonly pairs: readonly FidelityPairInput[];
    readonly unpaired: readonly UnpairedScreen[];
}

/** A 3- or 6-digit hex colour, as the token files write them. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Every hex colour in a token tree, rendered as the `rgb(r, g, b)` string a browser reports.
 *
 * This exists because the comparison can only happen in the ENGINE's vocabulary: `getComputedStyle` never
 * returns `#FAF6F0`, it returns `rgb(250, 246, 240)`. Converting the tokens (rather than parsing the browser's
 * output) keeps the direction of trust right — the token file is the source, the rendered value is the claim
 * being checked.
 *
 * Non-hex values are skipped rather than mangled: `semantic.border` ships as `rgba(178, 190, 195, 0.3)` and the
 * gradient tokens are whole CSS functions, none of which have a single rgb triple.
 *
 * @param tokens - A token record, possibly nested (a whole imported scale is fine).
 * @returns The set of on-token `rgb()` strings. Pure.
 */
export function tokenRgbStrings(tokens: Readonly<Record<string, unknown>>): Set<string> {
    const rendered = new Set<string>();

    for (const value of Object.values(tokens)) {
        if (typeof value === 'string') {
            if (HEX_COLOR.test(value)) {
                rendered.add(hexToRgbString(value));
            }

            continue;
        }

        if (typeof value === 'object' && value !== null) {
            for (const nested of tokenRgbStrings(value as Readonly<Record<string, unknown>>)) {
                rendered.add(nested);
            }
        }
    }

    return rendered;
}

/**
 * Render one hex colour as a browser-style `rgb()` string.
 *
 * @param hex - A 3- or 6-digit hex colour, with the leading `#`.
 * @returns `rgb(r, g, b)`. Pure.
 */
function hexToRgbString(hex: string): string {
    const digits = hex.slice(1);
    const full = digits.length === 3 ? [...digits].map((digit) => `${digit}${digit}`).join('') : digits;
    const channels = [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));

    return `rgb(${channels.join(', ')})`;
}

/**
 * Compare one anchor across the two documents.
 *
 * An anchor missing on either side yields NO style deltas: nine "differs from null" rows would bury the one
 * fact that matters, which is that the surface is not there.
 *
 * @param anchor - The anchor's stable name.
 * @param mockup - What the wireframe rendered.
 * @param implementation - What the live route rendered.
 * @returns The comparison, with deltas in {@link STYLE_PROPERTIES} order. Pure.
 */
export function compareAnchor(
    anchor: string,
    mockup: AnchorObservation,
    implementation: AnchorObservation,
): AnchorComparison {
    const presence = presenceOf(mockup, implementation);

    if (presence !== 'both') {
        return { anchor, presence, mockup, implementation, deltas: [] };
    }

    return { anchor, presence, mockup, implementation, deltas: deltasBetween(mockup, implementation) };
}

/**
 * Build the report from the two sides' observations.
 *
 * @param input - Capture conditions, the token scale, the pairs and the unpaired wireframes.
 * @returns The deterministic report: pairs sorted by slug, no wall-clock instant. Pure.
 * @throws When a pair cites no `FR-*` requirement, or two pairs share a slug (they would overwrite each
 *   other's PNGs on disk, and the report would silently describe only one of them).
 */
export function buildFidelityReport(input: FidelityReportInput): FidelityReport {
    const seen = new Set<string>();

    for (const pair of input.pairs) {
        if (pair.requirementIds.length === 0) {
            throw new Error(
                `mockup-fidelity pair "${pair.slug}" cites no FR requirement id. Every compared surface must ` +
                    'name the requirement(s) it implements, so a fidelity failure maps to a requirement.',
            );
        }

        if (seen.has(pair.slug)) {
            throw new Error(`mockup-fidelity pair slug "${pair.slug}" is used twice; slugs must be unique.`);
        }

        seen.add(pair.slug);
    }

    const pairs = [...input.pairs]
        .sort((left, right) => left.slug.localeCompare(right.slug))
        .map(
            (pair): FidelityPair => ({
                slug: pair.slug,
                mockupFile: pair.mockupFile,
                route: pair.route,
                requirementIds: [...pair.requirementIds],
                images: { mockup: pair.images.mockup, implementation: pair.images.implementation },
                caveats: [...pair.caveats],
                anchors: pair.anchors.map((anchor) =>
                    compareAnchor(anchor.anchor, anchor.mockup, anchor.implementation),
                ),
            }),
        );

    const unpaired = [...input.unpaired].sort((left, right) => left.mockupFile.localeCompare(right.mockupFile));
    const anchors = pairs.flatMap((pair) => pair.anchors);

    return {
        environment: input.environment,
        summary: {
            pairs: pairs.length,
            unpaired: unpaired.length,
            anchorsCompared: anchors.length,
            anchorsWithDeltas: anchors.filter((anchor) => anchor.deltas.length > 0).length,
            anchorsMissingFromImplementation: anchors.filter((anchor) => anchor.presence === 'mockup-only').length,
        },
        tokens: input.tokens,
        pairs,
        unpaired,
    };
}

/**
 * Render the report as a self-contained side-by-side review page.
 *
 * The PNGs are referenced relatively (never inlined) so the page stays small enough to open, and every piece
 * of report text is escaped: the report quotes rendered page content, which can contain markup.
 *
 * @param report - The built report.
 * @returns A complete HTML document. Pure and deterministic for a given report.
 */
export function renderFidelityHtml(report: FidelityReport): string {
    const { environment: env } = report;

    return [
        '<!doctype html>',
        '<html lang="en"><head><meta charset="utf-8">',
        '<title>Commise — mockup fidelity</title>',
        `<style>${STYLE_SHEET}</style>`,
        '</head><body>',
        '<h1>Mockup fidelity — wireframe vs implementation</h1>',
        `<p class="env">${escapeHtml(
            `${env.browser} · ${env.viewport.width}×${env.viewport.height} · clock pinned ${env.clockIso} · ` +
                `${env.timezone} · ${env.locale}`,
        )}</p>`,
        `<p class="env">${escapeHtml(
            `${report.summary.pairs} pairs · ${report.summary.anchorsCompared} anchors · ` +
                `${report.summary.anchorsWithDeltas} with deltas · ` +
                `${report.summary.anchorsMissingFromImplementation} missing from the implementation · ` +
                `${report.summary.unpaired} wireframes not implemented`,
        )}</p>`,
        ...report.pairs.map(renderPair),
        renderUnpaired(report.unpaired),
        '<h2>@commise/ui token scale</h2>',
        `<pre>${escapeHtml(JSON.stringify(report.tokens, null, 2))}</pre>`,
        '</body></html>',
    ].join('\n');
}

/** Minimal review-page styling — no external stylesheet, so the artifact opens straight from disk. */
const STYLE_SHEET =
    'body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#2d3436}' +
    'h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:2.5rem}' +
    '.env{color:#636e72}' +
    '.pair{display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:start}' +
    '.pair figure{margin:0}.pair img{width:100%;border:1px solid #b2bec3}' +
    'figcaption{font-weight:600;margin-bottom:.25rem}' +
    'table{border-collapse:collapse;width:100%;margin-top:1rem}' +
    'th,td{border:1px solid #b2bec3;padding:.25rem .5rem;text-align:left;vertical-align:top}' +
    'pre{background:#f5f5f5;padding:1rem;overflow:auto}' +
    'code{background:#f5f5f5;padding:0 .25rem}' +
    '.caveats{background:#fdf6e8;border-left:4px solid #f5b041;margin:.5rem 0;padding:.5rem 1rem .5rem 2rem}';

/**
 * Render one pair: the image pair, its requirement ids, and its anchor table.
 *
 * @param pair - The compared pair.
 * @returns An HTML fragment. Pure.
 */
function renderPair(pair: FidelityPair): string {
    return [
        `<h2>${escapeHtml(pair.slug)}</h2>`,
        `<p class="env">${escapeHtml(pair.mockupFile)} → <code>${escapeHtml(pair.route)}</code> · ${escapeHtml(
            pair.requirementIds.join(', '),
        )}</p>`,
        renderCaveats(pair.caveats),
        '<div class="pair">',
        `<figure><figcaption>Wireframe</figcaption><img alt="${escapeHtml(
            `${pair.slug} wireframe`,
        )}" src="${escapeHtml(pair.images.mockup)}"></figure>`,
        `<figure><figcaption>Implementation</figcaption><img alt="${escapeHtml(
            `${pair.slug} implementation`,
        )}" src="${escapeHtml(pair.images.implementation)}"></figure>`,
        '</div>',
        renderAnchorTable(pair.anchors),
    ].join('\n');
}

/**
 * Render a pair's caveats as a warning list, or nothing when it has none.
 *
 * @param caveats - The pair's caveats.
 * @returns An HTML fragment. Pure.
 */
function renderCaveats(caveats: readonly string[]): string {
    if (caveats.length === 0) {
        return '';
    }

    return ['<ul class="caveats">', ...caveats.map((caveat) => `<li>${escapeHtml(caveat)}</li>`), '</ul>'].join('\n');
}

/**
 * Render a pair's anchors as a table of presence + deltas.
 *
 * @param anchors - The pair's compared anchors.
 * @returns An HTML fragment. Pure.
 */
function renderAnchorTable(anchors: readonly AnchorComparison[]): string {
    const rows = anchors.map((anchor) => {
        const deltas =
            anchor.deltas.length === 0
                ? '—'
                : anchor.deltas
                      .map(
                          (delta) =>
                              `<code>${escapeHtml(delta.property)}</code>: ${escapeHtml(delta.mockup)} → ` +
                              escapeHtml(delta.implementation),
                      )
                      .join('<br>');

        return (
            `<tr><td>${escapeHtml(anchor.anchor)}</td><td>${escapeHtml(anchor.presence)}</td>` +
            `<td>${escapeHtml(anchor.mockup.text ?? '—')}</td>` +
            `<td>${escapeHtml(anchor.implementation.text ?? '—')}</td><td>${deltas}</td></tr>`
        );
    });

    return [
        '<table><thead><tr><th>anchor</th><th>presence</th><th>wireframe text</th>',
        '<th>implementation text</th><th>deltas</th></tr></thead><tbody>',
        ...rows,
        '</tbody></table>',
    ].join('\n');
}

/**
 * Render the wireframes that have no implementation.
 *
 * @param unpaired - The unpaired wireframes.
 * @returns An HTML fragment. Pure.
 */
function renderUnpaired(unpaired: readonly UnpairedScreen[]): string {
    if (unpaired.length === 0) {
        return '';
    }

    const rows = unpaired.map(
        (screen) => `<tr><td>${escapeHtml(screen.mockupFile)}</td><td>${escapeHtml(screen.owningSpec)}</td></tr>`,
    );

    return [
        '<h2>Wireframes with no implementation</h2>',
        '<table><thead><tr><th>wireframe</th><th>owning spec</th></tr></thead><tbody>',
        ...rows,
        '</tbody></table>',
    ].join('\n');
}

/**
 * Which sides rendered the anchor.
 *
 * @param mockup - The wireframe's observation.
 * @param implementation - The live route's observation.
 * @returns The presence classification. Pure.
 */
function presenceOf(mockup: AnchorObservation, implementation: AnchorObservation): AnchorPresence {
    if (mockup.style !== null && implementation.style !== null) {
        return 'both';
    }

    if (mockup.style !== null) {
        return 'mockup-only';
    }

    if (implementation.style !== null) {
        return 'implementation-only';
    }

    return 'neither';
}

/**
 * Every property the two sides disagree on, in a fixed order: text, then presentation, then geometry.
 *
 * @param mockup - The wireframe's observation (style present).
 * @param implementation - The live route's observation (style present).
 * @returns The deltas. Pure.
 */
function deltasBetween(mockup: AnchorObservation, implementation: AnchorObservation): readonly AnchorDelta[] {
    const deltas: AnchorDelta[] = [];
    const mockupText = mockup.text ?? '';
    const implementationText = implementation.text ?? '';

    if (mockupText !== implementationText) {
        deltas.push({ property: 'text', mockup: mockupText, implementation: implementationText });
    }

    // Non-null by the caller's contract (`presence === 'both'`); read into locals so the property walks below
    // don't each need to re-narrow.
    const mockupStyle = mockup.style;
    const implementationStyle = implementation.style;

    if (mockupStyle === null || implementationStyle === null) {
        return deltas;
    }

    for (const property of STYLE_PROPERTIES) {
        if (mockupStyle[property] !== implementationStyle[property]) {
            deltas.push({
                property,
                mockup: mockupStyle[property],
                implementation: implementationStyle[property],
            });
        }
    }

    for (const property of GEOMETRY_PROPERTIES) {
        const left = `${Math.round(mockupStyle[property])}px`;
        const right = `${Math.round(implementationStyle[property])}px`;

        if (left !== right) {
            deltas.push({ property, mockup: left, implementation: right });
        }
    }

    return deltas;
}

/**
 * Escape text for HTML text/attribute context.
 *
 * @param value - Untrusted text (rendered page content, token values).
 * @returns The escaped string. Pure.
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
