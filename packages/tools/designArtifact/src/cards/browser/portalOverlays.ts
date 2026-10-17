/**
 * @module cards/browser/portalOverlays — keeps a component's overlay inside its own column. Runs on the card page.
 */
import { overlayKind } from './overlayKind.js';

/**
 * Watches `<body>` and moves each overlay a component portals there into the framed stage of its own column.
 *
 * @sideEffect Starts a MutationObserver on `doc.body` and moves nodes between parents.
 * @param doc - The card page's document.
 */
export function portalOverlays(doc: Document): void {
    new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!(node instanceof Element)) {
                    continue;
                }

                const kind = overlayKind(node);
                const stage =
                    kind === 'web' ? doc.getElementById('wf') : kind === 'native' ? doc.getElementById('nf') : null;

                stage?.appendChild(node);
            }
        }
    }).observe(doc.body, { childList: true });
}
