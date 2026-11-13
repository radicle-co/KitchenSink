/**
 * @module runtime/designSystemScopeEntry — the browser entry of the design-system scope: defines
 * `window.__scopeDesignSystem`, which the bundle's last line calls on the native exports. Compiled to a classic
 * script by `designSystemScopeScript.ts`; never imported by Node code.
 */
import { scopeDesignSystem } from './designSystemScope.js';

window.__scopeDesignSystem = (native, components) => {
    const react = window.__react;
    const runtime = window.__jsx;

    if (react === undefined || runtime === undefined) {
        throw new Error('The React 18 bridge must load before the native components are scoped.');
    }

    return scopeDesignSystem(native, components, react, runtime);
};
