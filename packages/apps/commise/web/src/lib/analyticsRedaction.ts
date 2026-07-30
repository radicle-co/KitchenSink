/**
 * URL redaction for Vercel Web Analytics page views (the `beforeSend` transmit seam).
 *
 * **Pattern.** A sanitizing **Interceptor** at the one point every beacon passes through, implemented as a
 * pure **projection**: `event → event'` (total, allocation-only, no I/O), so it is unit-testable in
 * isolation and cannot be reached around. `<RedactedAnalytics />` is the only mount that wires it, and
 * `beforeSend` is the only lever available — the App-Router entry point's public prop type is
 * `Omit<AnalyticsProps, 'route' | 'disableAutoTrack'>` over an `AnalyticsProps` that declares NEITHER of
 * those keys, i.e. the `Omit` is vacuous and there is no public "don't auto-track" flag to reach for.
 *
 * **Policy: default-DENY on the query string, keep the path.** The redacted URL is `origin + pathname` and
 * nothing else — every query param is dropped unconditionally, with no allowlist and (deliberately) no
 * denylist of known-bad keys.
 *
 * Why deny-all rather than a denylist: `filtersToQueryString`
 * (`@commise/features-recipes/src/filters/model.ts`) puts free-text `query`, `dietaryFlags` (vegan,
 * gluten-free, kosher… ⇒ plausibly health-condition or religious-observance data, GDPR **Art. 9**
 * special category), `tags`, `cuisine` and `ingredientName` on `/[locale]/discover`, and this app's URLs
 * also carry the credential-shaped `__clerk_handshake` / `__clerk_ticket`. A denylist would cover exactly
 * those keys — and the sixth filter param added to that serializer next month would start leaking
 * silently, with no test and no review step to catch it. Deny-all inverts that: a new param is
 * private-by-construction, and *loosening* the policy is what requires a deliberate, reviewed edit here.
 *
 * Why not an allowlist of "safe" params either: the only candidates are the bounded time buckets
 * (`maxPrepTime`/`maxCookTime`/`maxTotalTime`), no tracking requirement asks for them, and admitting them
 * would fragment one `/discover` row in the dashboard into a row per bound — strictly worse analytics for
 * a privacy cost. Adding one later is a one-line change plus its own test; building the mechanism now for
 * a need nobody has stated is the YAGNI trap.
 *
 * **What survives:** the scheme, host and **pathname** — so `/[locale]/discover`, `/[locale]/recipes/{id}`
 * and the per-stage host stay in the report (Vercel additionally aggregates on the dynamic `route`
 * template, which it computes itself from Next's params and never routes through this hook). Path segments
 * are opaque content ULIDs and a locale, carrying no visitor identifier.
 * **What is dropped:** the entire query string, the fragment (an implicit-flow `#access_token=…` never
 * appears in `search`), and any URL userinfo — plus email/bearer-shaped substrings *inside* the pathname,
 * which `sign-in/[[...sign-in]]` and `sign-up/[[...sign-up]]` make visitor-authorable at any depth.
 *
 * **Relationship to {@link scrubText} / `sentryScrubbers`.** Same posture, deliberately NOT the same
 * policy. `sentryScrubbers` is a key-**denylist** plus shape-based redaction over an arbitrary nested
 * object graph — the right shape for error payloads whose keys are open-ended, and it grows whenever a new
 * PII *key* shows up. This module is a deny-all projection of one string, and changes only if a param is
 * ever allow-listed: different knowledge, different reason to change, so merging them would be the wrong
 * abstraction (and routing the URL through `scrubEvent` would be actively worse — it would leave
 * `?query=diabetic+dinner` untouched while *looking* scrubbed). The one genuinely shared piece of
 * knowledge — "what an email/bearer-shaped substring looks like in free text" — IS reused, not restated:
 * {@link scrubText} is applied to the pathname.
 */
import { scrubText } from './sentryScrubbers';

/**
 * The transmit-seam event shape, declared structurally rather than imported from `@vercel/analytics` —
 * the same contract-by-shape `sentryScrubbers` uses for Sentry, so this module and its tests share one
 * definition and neither depends on the vendor's type. Assignable to the package's `BeforeSend`.
 */
export interface RedactableAnalyticsEvent {
    readonly type: string;
    readonly url: string;
}

/**
 * Project a page-view URL onto the only part that may leave the browser: `origin + pathname`, with
 * email/bearer-shaped substrings redacted out of the pathname. Pure.
 *
 * @param rawUrl - The absolute URL the beacon is about to report.
 * @returns The redacted absolute URL, or `null` when `rawUrl` is not a parseable absolute URL — an
 *   unrecognized shape cannot be *proven* query-free, and default-deny extends to shape, so the caller
 *   drops the event instead of shipping a string it did not understand. Parsing goes through the WHATWG
 *   {@link URL} rather than hand-rolled string surgery (CLAUDE.md library-first), which is also what makes
 *   the `#`-vs-`?` and percent-encoding cases correct for free.
 */
export const redactAnalyticsUrl = (rawUrl: string): string | null => {
    let url: URL;

    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    url.search = '';
    url.hash = '';
    url.username = '';
    url.password = '';
    url.pathname = scrubText(url.pathname);

    return url.toString();
};

/**
 * `beforeSend` hook: return the event with its URL redacted, or `null` to drop it entirely.
 *
 * `null` is reserved for "cannot establish that this event is clean" — an unparseable URL — and is
 * deliberately NOT used to suppress sensitive-looking routes. Once the query string is gone,
 * `/{locale}/sign-in` is an ordinary page: the ticket that made it sensitive is no longer on the event,
 * while sign-in is the signed-out front door (FR-045a) and therefore the single highest-value funnel step
 * in the report. Dropping it would blind that funnel and buy no privacy.
 *
 * Returns a NEW event — the beacon's own object is never mutated. Pure.
 *
 * @param event - The event the beacon is about to send.
 * @returns The event with a redacted `url`, or `null` to cancel the send.
 */
export const redactAnalyticsEvent = <T extends RedactableAnalyticsEvent>(event: T): T | null => {
    const url = redactAnalyticsUrl(event.url);

    return url === null ? null : { ...event, url };
};
