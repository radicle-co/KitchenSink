/**
 * @module fixtures/badgeElement — an ELEMENT FACTORY: a lowercase function that returns JSX, which is a `.tsx` file and
 * not a component (`web/src/app/appDocument.tsx` is this shape). It names no component, so the per-file coverage guard
 * does not ask it for one (`exportsAComponentName`).
 */
import type { ReactElement } from 'react';

import { Badge } from './Badge.js';

/**
 * A badge's element tree.
 *
 * @param text - The badge's text.
 * @returns The element.
 */
export function badgeElement(text: string): ReactElement {
    return <Badge>{text}</Badge>;
}
