/**
 * @module cards/cardPage — the full `preview.html` text of one component card.
 *
 * Every card renders the same page: the host marker line, the shared style block once, a `Web` column and a
 * `Native · iOS` column (or one column and a note saying why the other is absent), then the compiled card and the
 * run-time script. The page is a pure function of the card's metadata and its compiled script.
 *
 * @pattern Template Method — fixed skeleton here; the card supplies `render`, `afterRender` and options.
 */
import { cardMarker } from '../artifactFormat.js';
import { inlineScriptEscape } from '../bundle/inlineScriptEscape.js';
import { DesignArtifactError } from '../errors.js';

import { CARD_RUNTIME_SOURCE } from './cardRuntime.js';
import { CARD_CONFIG_ELEMENT_ID } from './cardRuntimeConfig.js';
import type { CardRuntimeConfig } from './cardRuntimeConfig.js';
import type { CardMeta, CardScope } from './cardSpec.js';
import { CARD_STYLE } from './cardStyle.js';

/** Everything of a card except its functions: what the page template reads. */
export type CardPageSpec = CardMeta & Pick<CardScope, 'platforms'> & { readonly reason?: string | undefined };

function escapeHtml(text: string): string {
    return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

/** The config as a JSON element: `<` is escaped so no text in it can end the element. */
function configElement(config: CardRuntimeConfig): string {
    const json = JSON.stringify(config).replace(/</gu, '\\u003c');

    return `<script type="application/json" id="${CARD_CONFIG_ELEMENT_ID}">${json}</script>`;
}

function paragraph(className: 'muted' | 'note', text: string | undefined): string {
    return text === undefined ? '' : `<p class="${className}">${escapeHtml(text)}</p>`;
}

function stageFor(id: 'wf' | 'nf', frameHeight: number | null): string {
    return frameHeight === null ? '' : `<div id="${id}" class="frame" style="height:${String(frameHeight)}px"></div>`;
}

function section(platform: 'web' | 'native', label: string, body: readonly string[]): string {
    return `<section class="${platform}"><h2 class="lbl">${label}</h2>${body.join('')}</section>`;
}

/**
 * Builds the page.
 *
 * @param spec - The card's metadata.
 * @param script - The card compiled by `compileCard`: defines `var __card`.
 * @returns The `preview.html` document text.
 * @throws DesignArtifactError `unsafe-header` for a marker that cannot be written, or `invalid-card` for a card on
 * one platform that does not say why the other is absent.
 */
export function cardPage(spec: CardPageSpec, script: string): string {
    const marker = cardMarker({ group: spec.group, height: spec.height });
    const missing = spec.platforms === 'both' ? undefined : spec.reason;

    if (spec.platforms !== 'both' && (missing === undefined || missing.length === 0)) {
        throw new DesignArtifactError(
            'invalid-card',
            `A ${spec.platforms}-only card must say why the other platform is absent (group "${spec.group}").`,
        );
    }

    const frameHeight = spec.staging?.portalIntoColumn?.frameHeight ?? null;
    const config: CardRuntimeConfig = {
        platforms: spec.platforms,
        phoneViewport: spec.staging?.phoneViewport === true,
        frameHeight,
    };
    const web = section('web', 'Web', [
        '<div id="w"></div>',
        stageFor('wf', frameHeight),
        paragraph('note', spec.notes?.web),
    ]);
    const native = section('native', 'Native · iOS', [
        '<div id="n"></div>',
        stageFor('nf', frameHeight),
        paragraph('note', spec.notes?.native),
    ]);
    const columns =
        spec.platforms === 'both'
            ? web + native
            : spec.platforms === 'web'
              ? web + section('native', 'Native · iOS', [paragraph('muted', `No native leaf — ${missing ?? ''}`)])
              : section('native', 'Native · iOS', [
                    '<div id="n"></div>',
                    stageFor('nf', frameHeight),
                    paragraph('muted', `Native only — ${missing ?? ''}`),
                    paragraph('note', spec.notes?.native),
                ]);

    return `${marker}
<!doctype html><html><head><meta charset="utf-8"><style>
${CARD_STYLE}
</style></head><body><div class="pair">${columns}</div>${configElement(config)}<script>
${inlineScriptEscape(`${script}\n${CARD_RUNTIME_SOURCE}`)}
</script></body></html>
`;
}
