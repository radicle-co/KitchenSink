/**
 * @module cards/browser/cardRuntimeEntry — the browser entry of a card page: apply the staging, then mount the
 * card. Compiled to a classic script by `cardRuntime.ts`, inlined after the compiled card (which defines `__card`).
 */
import { mountCard } from './mountCard.js';
import { portalOverlays } from './portalOverlays.js';
import { installPhoneViewport } from './phoneViewport.js';
import { readCardConfig } from './readCardConfig.js';

const config = readCardConfig(document);

if (config.phoneViewport) {
    installPhoneViewport(window);
}

if (config.frameHeight !== null) {
    portalOverlays(document);
}

mountCard(config, window);
