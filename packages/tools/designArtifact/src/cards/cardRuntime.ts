/**
 * @module cards/cardRuntime — the script a card page runs in the browser after the compiled card: apply the
 * staging, mount one React root per shown column with that column's namespace, then hand the columns to
 * `afterRender` and wait for the promise it may return, then flag `<html data-card-ready="true">` so a browser test
 * waits on the page rather than a timer. A rejected `afterRender` sets `data-card-error` instead and logs the error.
 *
 * It is real, type-checked browser code in `cards/browser/`, compiled once to a classic script; the page's config
 * reaches it as a JSON element, so nothing a card author wrote is spliced into script source.
 * `__tests__/cardPage.test.ts` executes the compiled script in jsdom.
 */
import { join } from 'node:path';

import { compileBrowserScript } from '../browser/compileBrowserScript.js';

/**
 * Classic-script source that expects `var __card` (the compiled card module) to be defined above it and the
 * config element (`CARD_CONFIG_ELEMENT_ID`) to be in the document.
 *
 * @sideEffect Computed at import: compiles the entry with esbuild.
 */
export const CARD_RUNTIME_SOURCE: string = compileBrowserScript(
    join(import.meta.dirname, 'browser', 'cardRuntimeEntry.ts'),
);
