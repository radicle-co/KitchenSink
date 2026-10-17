/**
 * @module cards/browser/overlayKind — which column an element added to `<body>` belongs to. Pure over the element.
 */

/** Which column stage an overlay goes to, or `none` when the node is not an overlay. */
export type OverlayKind = 'web' | 'native' | 'none';

/**
 * Classifies a node added to `<body>`. A Radix layer carries `fixed inset-0` or a `radix-` id; a react-native-web
 * Modal is a bare div with no class and no id (a Radix popper wrapper is also bare, but is marked and stays put).
 *
 * @param node - The added node.
 * @returns The stage it belongs in.
 */
export function overlayKind(node: Element): OverlayKind {
    if (node.tagName !== 'DIV') {
        return 'none';
    }

    if (/fixed inset-0/u.test(node.className) || /^radix-/u.test(node.id)) {
        return 'web';
    }

    return node.className === '' && node.id === '' && !node.hasAttribute('data-radix-popper-content-wrapper')
        ? 'native'
        : 'none';
}
