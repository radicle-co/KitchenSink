/**
 * The trust boundary for an OUTBOUND link built from recipe data — today, a recipe's `sourceUrl`. Pure.
 *
 * A recipe's source URL is UNTRUSTED input. It is written by an import pipeline (004) from data the app
 * did not author, and the wire schema does NOT protect the renderer: `sourceUrl: z.string().url()` accepts
 * `javascript:alert(1)`, `data:text/html,…` and `vbscript:…`, because every one of those is a *parseable*
 * URL. Verified against the repo's own zod (4.4.3). So "it validated on the wire" is not a reason to hand
 * a string to an `href` or to `Linking.openURL` — this module is where that decision is actually made, once,
 * for both platforms.
 *
 * Library-first: the parsing itself is the platform's WHATWG `URL`, never a hand-rolled URL regex. What is
 * added on top is a POLICY (an allowlist), which is the part no URL parser can decide for us.
 *
 * ⚠️ WHICH `URL` this gets is a property of the RUNTIME, so the guard is written not to care. React Native
 * core bundles a regex stub (`react-native/Libraries/Blob/URL.js`) whose single-argument constructor never
 * throws; Expo's winter runtime then REPLACES that global with a spec-compliant one
 * (`expo/src/winter/runtime.native.ts` installs `whatwg-url-minimum`), which does throw and parses exactly
 * as V8 does — verified directly against `whatwg-url-minimum@0.1.2` for every case in this module's tests.
 * A gate whose only teeth were "does `new URL(raw)` throw?" would therefore be load-bearing under one
 * runtime and a no-op under the other. The anchored `^https?://` test on the trimmed input is the half that
 * holds under BOTH, and it runs FIRST, so the guarantee never depends on which polyfill won.
 *
 * ⚠️ Residual risk, stated rather than papered over: every test of this module runs on V8 under Node. No
 * tier in this repo executes it on Hermes, on a device.
 *
 * ⛔ THIS MODULE IS NOT ON `@kitchensink/recipe-core`'s BARREL, AND ADDING IT THERE IS A REGRESSION.
 * It is reachable only as `@kitchensink/recipe-core/external-url` (a declared package export). Two reasons, and
 * they agree:
 *
 *  1. LAYERING. The barrel carries WIRE/DOMAIN shapes the recipe service itself composes. This is
 *     PRESENTATION policy — the service has no use for it.
 *  2. THE ENFORCED CONSEQUENCE. The recipe service's `*.schema.ts` files import that barrel, and
 *     `computeContractHash` (`@kitchensink/contract-gen`) fingerprints the raw TEXT of every transitively
 *     reachable composed source. Re-exporting this module from the barrel therefore changes the service's
 *     `CONTRACT_HASH` — forcing a contract regeneration, and client-visible contract churn, for a change no
 *     client can observe. Measured, not theorised: doing it fails `recipe-service`'s
 *     `contract/__tests__/contract.test.ts`, and so does merely adding a COMMENT to that barrel, because the
 *     fingerprint is over source text.
 */

/** The anchored shape every acceptable source URL has, checked before any parser is trusted. */
const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

/** The only two schemes a recipe source may be opened with. */
const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** A URL that has been proved safe to put in an `href` / hand to the OS. */
export interface SafeHttpUrl {
    /** The re-serialized absolute URL — what to navigate to. */
    readonly href: string;
    /** The host (with port when non-default) — what to SHOW, since a full URL is easy to disguise. */
    readonly host: string;
}

/**
 * Admit `raw` as an external http(s) link, or refuse it.
 *
 * Refused: any non-`http(s)` scheme (`javascript:`, `data:`, `vbscript:`, `file:`, `intent:`, app schemes),
 * anything that is not absolute (relative, protocol-relative, schemeless), anything unparseable, and any
 * URL carrying embedded credentials — `https://seriouseats.com@evil.example` reads as one site and resolves
 * to another, so displaying its host would actively mislead.
 *
 * Pure.
 *
 * @param raw - The untrusted URL string (e.g. `RecipeDetail.sourceUrl`).
 * @returns The safe href + display host, or `null` when the URL must not be rendered as a link at all.
 */
export function safeHttpUrl(raw: string): SafeHttpUrl | null {
    const trimmed = raw.trim();

    // FIRST, and engine-independently: an absolute http(s) URL, anchored. This is the check that does not
    // depend on which `URL` the runtime supplied — see the module header.
    if (!ABSOLUTE_HTTP_URL.test(trimmed)) {
        return null;
    }

    let parsed: URL;

    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }

    // Belt and braces on the engine that DOES parse: the protocol the parser resolved must still be one of
    // the two allowed, and there must be a real host to attribute the recipe to.
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol) || parsed.hostname === '') {
        return null;
    }

    // Credentials in the authority are a spoofing vector, never a legitimate recipe source.
    if (parsed.username !== '' || parsed.password !== '') {
        return null;
    }

    return { href: parsed.href, host: parsed.host };
}
