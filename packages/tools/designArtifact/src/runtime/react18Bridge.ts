/**
 * @module runtime/react18Bridge — the compiled React 18 bridge, as the script text the bundle prepends.
 *
 * The bridge is the typed module `installReact18Bridge.ts` (what it does and why is documented there); this file
 * only compiles its browser entry once.
 */
import { join } from 'node:path';

import { compileBrowserScript } from '../browser/compileBrowserScript.js';

/**
 * A classic script (an IIFE, no imports) that defines `window.__react` and `window.__jsx` from `window.React`.
 * It is evaluated against a fake React in `__tests__/react18Bridge.test.ts`.
 *
 * @sideEffect Computed at import: compiles the entry with esbuild.
 */
export const REACT18_BRIDGE_SOURCE: string = compileBrowserScript(join(import.meta.dirname, 'react18BridgeEntry.ts'));
