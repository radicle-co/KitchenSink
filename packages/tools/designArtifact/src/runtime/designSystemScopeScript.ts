/**
 * @module runtime/designSystemScopeScript — the compiled design-system scope, as the script text the bundle
 * includes after the native bundle. What the scope does is documented in `designSystemScope.ts`.
 */
import { join } from 'node:path';

import { compileBrowserScript } from '../browser/compileBrowserScript.js';

/**
 * A classic script (an IIFE, no imports) that defines `window.__scopeDesignSystem`.
 *
 * @sideEffect Computed at import: compiles the entry with esbuild.
 */
export const DESIGN_SYSTEM_SCOPE_SOURCE: string = compileBrowserScript(
    join(import.meta.dirname, 'designSystemScopeEntry.ts'),
);
