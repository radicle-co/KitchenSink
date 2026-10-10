/**
 * @module fixtures/NoJsxDefault — the single default export of a file with NO JSX of its own: it returns the tree an
 * element factory builds. This is a Next.js route segment's shape (`web/src/app/[locale]/layout.tsx` returns
 * `appDocument(…)`), and the framework renders it as a component. Presentational.
 */
import type { ReactElement } from 'react';

import { badgeElement } from './badgeElement.js';

export default function NoJsxDefault(): ReactElement {
    return badgeElement('done');
}
