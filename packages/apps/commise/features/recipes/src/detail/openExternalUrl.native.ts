/**
 * @module @commise/features-recipes — the NATIVE "open an external URL" adapter.
 *
 * Pattern: **Adapter**. It translates an already-verified href into the one platform call that can leave the
 * app, and adds no behaviour of its own. It exists as its own module so the impurity is NAMED and isolated
 * at a boundary a test double can cross, leaving `RecipeSourceLine.native.tsx` a pure `props → JSX` render
 * whose `onPress` merely delegates — the same shape as the detail view's other callbacks.
 *
 * There is deliberately NO web twin: `<a href>` already is the browser's link adapter.
 *
 * ⚠️ The href handed here MUST have come from `safeHttpUrl`. `Linking.openURL` will dispatch whatever scheme
 * it is given — `tel:`, `sms:`, an app deep link, an Android `intent:` — so the protocol allowlist, not this
 * module, is the trust boundary.
 */
import { Linking } from 'react-native';

/**
 * Open a verified http(s) URL in the platform's browser.
 *
 * @sideEffect Hands the URL to the operating system.
 * @param href - An href already admitted by `safeHttpUrl`.
 */
export function openExternalUrl(href: string): void {
    // `openURL` REJECTS when the OS has no handler (or the user dismisses the chooser). Left unhandled that
    // is a redbox in development and a floating rejection in production; the honest outcome of a failed open
    // is that the cook simply stays on the recipe, so the rejection is absorbed here rather than escaping
    // into a render tree that has no surface for it.
    void Linking.openURL(href).catch(() => undefined);
}
