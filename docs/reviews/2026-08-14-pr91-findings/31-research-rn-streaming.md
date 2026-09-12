# Research: Can React Native / Expo consume a streaming HTTP response body? (Aug 2026)

**Research value: high** — Directly applicable prior art exists (`expo/fetch`), with named failure modes, a vendor-neutral confirming source (Vercel AI SDK's own Expo integration), and multiple independent postmortems on the alternative.

## 1. RN's built-in `fetch` (XHR polyfill) — still does not give a real streaming `response.body`

Confirmed still true as of RN 0.86 / Hermes in 2026. `facebook/react-native#27741` ("fetch implementation does not support streams from the spec") remains **open** (filed Jan 2020, no resolution found in current comments). Independent 2026 source (getwireai.com, May 2026, "The Hermes ReadableStream Problem"): _"Hermes does not implement `ReadableStream` on `fetch`... every cloud LLM SDK that calls `response.body.getReader()` dies silently"_ — manifesting as a `TypeError`, an infinite hang, or a silent no-op depending on RN version. RN's fetch is layered on XMLHttpRequest, and XHR only fires incremental `onprogress` data when `responseType` is `'text'`, which caps incremental delivery to text-only transfers.

One conflicting claim (also getwireai.com, a different post): _"React Native 0.74 shipped with better `ReadableStream` support in the Hermes engine"_ and that it's usable "without a native module." Read this narrowly — it appears to describe a **partial JS-level polyfill** whose own author admits _"`ReadableStream` behavior can be inconsistent across Hermes versions"_ and that `EventSource` is still absent natively. This is not the same claim as "bare fetch streams reliably" — treat the 0.74 claim as unconfirmed/partial, not a green light. The New Architecture (Fabric/TurboModules/JSI, bridgeless-by-default since ~RN 0.82) changes the JS↔native transport but was **not** found in any source to touch fetch/XHR body streaming specifically — no evidence New Architecture fixes this.

## 2. `expo/fetch` — the real answer, and it is production-viable on SDK 57

Confirmed via Expo's own docs (`docs.expo.dev/versions/latest/sdk/expo/`): `expo/fetch` is a WinterCG-compliant fetch built on native HTTP stacks (not the XHR polyfill), supports Android/iOS/tvOS/Web/Expo Go, and its documented pattern is exactly incremental reading:

```ts
const reader = resp.body.getReader();
while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
}
```

It was introduced in **SDK 52** (per Expo maintainer Kudo, `expo/expo` discussion #21710, Oct 24 2024 — _"the upcoming Expo SDK 52 will have an `expo/fetch` to support streaming"_) and is present in SDK 57. On Android/iOS it becomes the **global** `fetch` automatically unless `EXPO_PUBLIC_USE_RN_FETCH=1` is set to keep RN's native fetch.

**Strongest confirming signal**: Vercel's own AI SDK ships an official Expo integration (`ai-sdk.dev/v4/docs/getting-started/expo`) whose setup instructions say verbatim _"you use the `expo/fetch` function instead of the native fetch to enable streaming of chat responses,"_ requires SDK 52+, and needs two additional polyfills (`@ungap/structured-clone`, `@stardazed/streams-text-encoding`) for `structuredClone`/`TextEncoderStream`/`TextDecoderStream`, which are still missing in Hermes even with `expo/fetch`. This is a real vendor treating `expo/fetch` as the supported streaming path, not a community workaround.

**Known limitations / bugs (not production-flawless):**

- `expo/expo#37310` (SDK 53): streaming "batches the chunks to the last one instead of streaming one by one" on Android and iOS in some cases (worked in SDK 52, regressed in 53) — closed as stale/outdated but no confirmed root-cause fix visible; treat SDK-to-SDK regressions as a live risk, not a solved problem.
- `expo/expo#32953` (SDK 52): error consuming a streamed JSON response in some configurations.
- `expo/expo#47762` (SDK 57): intermittent large-response parsing failures on Android via RTK Query's `fetchBaseQuery` — a different symptom but signals the streaming/response-handling path is still not bulletproof on SDK 57 specifically.
- Earlier community reports (2024, discussion #21710) noted Android-specific first-chunk delay/buffering, and an iOS regression that was fixed within a patch release (52.0.7).

Net: `expo/fetch` is the correct, Expo-native, vendor-blessed mechanism for streaming — but it has a nonzero, recurring history of platform-specific regressions across SDK versions, and needs manual verification against SDK 57 + your exact chunk-boundary (NDJSON) shape before shipping.

## 3. Alternatives

- **`react-native-fetch-api`** — unmaintained (last npm publish ~5 years ago per Snyk/npm; no recent PR/issue activity). Do not adopt for new work.
- **`react-native-sse`** (binaryminds) — EventSource implementation over XHR (`onprogress` + cursor parsing). Last npm publish ~2 years ago (v1.2.1) — low but not abandoned; TypeScript support; documented limitation: does not detect/re-establish a connection lost while the app was backgrounded/asleep.
- **`react-native-nitro-sse`** — a newer (2026-era) Nitro Modules–based native SSE implementation, found via search but not deeply verified; represents the "native module" alternative path (New-Architecture-native, not JS-polyfill), worth a spike if SSE semantics (not raw NDJSON-over-fetch) fit the design.
- **XHR + manual SSE/NDJSON parsing via `onprogress`** — the fallback of last resort when neither `expo/fetch` nor a maintained SSE lib fits: track a read cursor, parse only the new tail, buffer partial messages across progress events. This is what getwireai.com's "production fix" and the Expo community workaround (pre-SDK-52) both converge on independently — real prior art, not a one-off hack. Reported perf on iPhone 13 (vendor blog, unverified independently): 25–40 tokens/sec, 60fps UI, <30% JS-thread CPU for LLM token streaming.
- **WebSocket** — lower latency overhead (~30–60ms vs ~80–120ms for SSE-over-fetch per one vendor benchmark, not independently verified) but adds a stateful bidirectional channel your NestJS backend doesn't otherwise need; usually only wins for voice/bidirectional use cases, not a one-shot recipe+nutrition payload.

## 4. SSE on React Native

Not natively supported (no native `EventSource`, confirmed by two independent sources). `react-native-sse` (XHR-based) is the closest thing to a standard library but is low-activity. Given your payload is NDJSON-shaped structured data (recipe then nutrition), not a token stream, plain incremental NDJSON parsing over `expo/fetch`'s reader is a better structural fit than adopting SSE framing solely to get a library.

## 5. Real-world reports

Every real-world writeup found (getwireai.com x2, the Expo `#21710` discussion, the Vercel AI SDK Expo guide) is about **LLM token streaming into RN**, not structured secondary-payload streaming — but the underlying mechanics are identical (incremental read of a chunked HTTP body). Convergent finding across all of them: **bare RN fetch does not work for this**; teams either (a) adopt `expo/fetch` on Expo, or (b) hand-roll XHR+`onprogress` parsing on bare RN / when `expo/fetch` regresses. Nobody in the researched sources reported clean, unqualified success with only stock RN `fetch` in 2026.

## 6. Recommendation

Given the constraint (one NestJS endpoint, two very different client fetch stacks — Next.js 15 App Router with real streaming Suspense on web vs. Expo 57 on mobile):

- **If mobile is Expo-managed (it is — Expo 57 confirmed in this repo's stack): use `expo/fetch` with the reader-loop pattern**, matching Vercel AI SDK's own supported approach. This is the least-fragile path that still delivers true "recipe first, nutrition follows" behavior on both platforms from one endpoint. Budget verification time against the SDK 57–specific regressions above (`#37310`, `#47762`) with your actual chunk boundaries before trusting it in production — do not assume "it streamed once in a manual test" is sufficient given the SDK-to-SDK regression history.
- **"Don't stream to mobile; issue two requests" wins when**: the nutrition fetch is fast/cheap enough that a second immediate request costs little, when the team wants zero exposure to `expo/fetch`'s regression history, or when `EXPO_PUBLIC_USE_RN_FETCH=1` / a bare (non-Expo-managed) RN target is ever needed — in which case there is no reliable streaming fetch at all and two-request is close to the only sane option (short of hand-rolled XHR+NDJSON parsing, which is real but adds meaningful bespoke-code surface for a non-LLM, structured-payload use case). Given this repo's mobile app is Expo-managed and the backend is already yours to shape, two-requests (GET recipe, then GET/POST nutrition once fetched) is the pragmatic fallback if `expo/fetch`'s SDK 57 regressions prove real in your own spike — it trades the "arrives progressively" UX nicety for zero streaming-infrastructure risk, and is trivial to implement identically on web and mobile (web can still get the Suspense-streamed version separately, since the two platforms don't have to share one wire mechanism, only one logical contract).

## What I could not verify

- Whether the SDK 53 chunk-batching bug (`expo/expo#37310`) is actually fixed by SDK 57 — the issue was closed as stale/outdated, not confirmed-fixed by a maintainer.
- The wireai.com performance numbers (25–40 tok/s, latency-overhead table) are single-vendor, blog-only claims, not independently reproduced.
- Whether `react-native-nitro-sse` is production-ready — found only via search, not fetched/read in depth.
- Exact behavior difference between iOS and Android for `expo/fetch` on SDK 57 specifically (older reports describe Android-specific delay/buffering on earlier SDKs; unclear if still true).

## Sources

- [Expo `expo/fetch` API docs](https://docs.expo.dev/versions/latest/sdk/expo/) — official streaming API surface, platform support, `EXPO_PUBLIC_USE_RN_FETCH` flag.
- [Vercel AI SDK — Getting Started: Expo](https://ai-sdk.dev/v4/docs/getting-started/expo) — vendor-confirmed production use of `expo/fetch` for streaming, required polyfills.
- [expo/expo discussion #21710 — "fetch stream"](https://github.com/expo/expo/discussions/21710) — origin story of `expo/fetch`, SDK 52 introduction, platform caveats.
- [expo/expo issue #37310 — SDK 53 streaming batches chunks](https://github.com/expo/expo/issues/37310) — regression report, closed stale.
- [expo/expo issue #32953 — SDK 52 streamed JSON consumption error](https://github.com/expo/expo/issues/32953).
- [expo/expo issue #47762 — SDK 57 Android large-response parsing failure](https://github.com/expo/expo/issues/47762).
- [facebook/react-native issue #27741 — fetch doesn't support streams](https://github.com/facebook/react-native/issues/27741) — open since 2020, confirms core RN gap.
- [getwireai.com — "The Hermes ReadableStream Problem"](https://getwireai.com/blog/hermes-readablestream-llm-streaming-react-native-fix) (May 2026) — vendor blog, XHR+SSE production fix, perf numbers (unverified independently).
- [getwireai.com — "How to Stream LLM Responses in React Native"](https://getwireai.com/blog/react-native-llm-streaming) — vendor blog, SSE/WebSocket/polling comparison table, RN 0.74 partial-ReadableStream claim.
- [react-native-sse (binaryminds)](https://github.com/binaryminds/react-native-sse) / [npm](https://www.npmjs.com/package/react-native-sse) — XHR-based EventSource, last published ~2 years ago.
- [react-native-fetch-api npm / Snyk](https://snyk.io/advisor/npm-package/react-native-fetch-api) — unmaintained, last publish ~5 years ago.
- [react-native-nitro-sse](https://github.com/IAmTester35/react-native-nitro-sse) — Nitro Modules native SSE, not independently verified.
