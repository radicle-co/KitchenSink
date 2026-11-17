/**
 * Narrow a queried node to an `HTMLElement` for a test, failing loudly when the query found nothing or an element of
 * another kind. A cast would hide that failure and let the next line throw a less helpful error.
 *
 * @param node - What a DOM query returned.
 * @returns The node as an `HTMLElement`. Pure.
 */
export function htmlElementOf(node: Element | null): HTMLElement {
    if (!(node instanceof HTMLElement)) {
        throw new Error(
            node === null ? 'expected an HTMLElement, found nothing' : `expected an HTMLElement, got a ${node.tagName}`,
        );
    }

    return node;
}
