# React Native (New Architecture) + Expo — code smells, anti-patterns, red flags

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID    | Smell                                                                                      | Section                                  | Detected by | Default severity | Architecture |
| ----- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------- | ---------------- | ------------ |
| RN-01 | Large or unbounded `.map()` inside `ScrollView`                                            | Lists & rendering performance            | judgement   | major            | no           |
| RN-02 | FlatList misconfiguration: inline `renderItem`, missing `keyExtractor`, heavy items, no `… | Lists & rendering performance            | judgement   | major            | no           |
| RN-03 | FlashList v2 recycling violations (per-item `key`, un-reset local state, v1 props)         | Lists & rendering performance            | tool        | major            | no           |
| RN-04 | JS-thread blocking work in press handlers / navigation transitions                         | Lists & rendering performance            | judgement   | major            | yes          |
| RN-05 | `console.log` (and loggers) shipped in production bundles                                  | Lists & rendering performance            | partial     | minor            | no           |
| RN-06 | Re-render storms from inline style objects/arrays and root-level state                     | Lists & rendering performance            | tool        | minor            | no           |
| RN-07 | Raw text outside `<Text>` (including leaked `&&` values)                                   | Lists & rendering performance            | tool        | blocker          | no           |
| RN-08 | Unsized/un-cached/oversized images; animating image width/height                           | Lists & rendering performance            | judgement   | major            | yes          |
| RN-09 | Animation driven from the JS thread (setState per frame, `Animated` without native driver) | Animations & gestures (Reanimated 4 / w… | judgement   | major            | no           |
| RN-10 | Reading/writing shared values in render; destructuring; in-place object mutation           | Animations & gestures (Reanimated 4 / w… | tool        | major            | no           |
| RN-11 | Reanimated 3 APIs / thread-hop overuse in Reanimated 4 code                                | Animations & gestures (Reanimated 4 / w… | tool        | blocker          | no           |
| RN-12 | Assuming the Legacy Architecture is still selectable (or that legacy APIs still exist)     | New Architecture, platform & upgrade pi… | judgement   | major            | yes          |
| RN-13 | Safe-area and edge-to-edge handled with hard-coded padding or deprecated `SafeAreaView`    | New Architecture, platform & upgrade pi… | judgement   | major            | yes          |
| RN-14 | Platform-file-extension misuse (`.native.tsx` / `.ios.tsx`) and `Platform.select` drift    | New Architecture, platform & upgrade pi… | tool        | major            | yes          |
| RN-15 | 1:1 web-to-mobile layout port                                                              | New Architecture, platform & upgrade pi… | judgement   | major            | yes          |
| RN-16 | Caching `Dimensions.get()` at module scope / not reacting to window changes                | New Architecture, platform & upgrade pi… | judgement   | minor            | no           |
| RN-17 | Leaked native subscriptions (AppState, Dimensions, Linking, Keyboard, NetInfo)             | New Architecture, platform & upgrade pi… | judgement   | major            | no           |
| RN-18 | Keyboard avoidance hand-rolled or single-platform                                          | New Architecture, platform & upgrade pi… | judgement   | major            | no           |
| RN-19 | Touch targets below platform minimums                                                      | Accessibility                            | judgement   | major            | yes          |
| RN-20 | Missing role/label/state on custom controls; legacy vs `aria-*` props mixed                | Accessibility                            | judgement   | major            | yes          |
| RN-21 | `useGlobalSearchParams` by default; complex objects in params; unvalidated params          | Navigation (Expo Router)                 | judgement   | minor            | no           |
| RN-22 | Client-side route guards treated as the security boundary                                  | Navigation (Expo Router)                 | judgement   | blocker          | yes          |
| RN-23 | Secrets in `EXPO_PUBLIC_*` (or any bundled constant)                                       | Configuration, storage & release         | tool        | blocker          | yes          |
| RN-24 | Env-var access shape that silently fails to inline (and a doc/lint/implementation conflic… | Configuration, storage & release         | tool        | ?                | no           |
| RN-25 | Tokens/secrets in AsyncStorage (or MMKV unencrypted); misuse of SecureStore                | Configuration, storage & release         | tool        | blocker          | yes          |
| RN-26 | Unvalidated deep links and `Linking.openURL` with untrusted input                          | Configuration, storage & release         | judgement   | blocker          | yes          |
| RN-27 | OTA update runtime-version mismanagement                                                   | Configuration, storage & release         | partial     | blocker          | yes          |

<!-- END GENERATED INDEX -->

## Scope & sources consulted

Scope: React Native 0.8x on the New Architecture (npm latest at research time `react-native@0.87.1`,
2026-09-13), Expo SDK 5x (`expo@57.0.22`), Expo Router, Reanimated 4 (`react-native-reanimated@4.6.0`),
FlashList v2 (`@shopify/flash-list@2.3.2`), `expo-image@57.0.5`. Renderer-agnostic React smells (effects, keys,
purity, compiler) are in `react.md` and apply here unchanged. All sources opened 2026-09-13.

| Source                                                                                                                                                                                | Version / date | URL                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RN docs — Performance overview                                                                                                                                                        | docs v0.87     | https://reactnative.dev/docs/performance                                                                                                                                                                                                                                                                                                                                     |
| RN docs — Optimizing FlatList configuration                                                                                                                                           | live           | https://reactnative.dev/docs/optimizing-flatlist-configuration                                                                                                                                                                                                                                                                                                               |
| RN docs — Accessibility                                                                                                                                                               | live           | https://reactnative.dev/docs/accessibility                                                                                                                                                                                                                                                                                                                                   |
| RN docs — Security                                                                                                                                                                    | live           | https://reactnative.dev/docs/security                                                                                                                                                                                                                                                                                                                                        |
| RN docs — Platform-specific code                                                                                                                                                      | live           | https://reactnative.dev/docs/platform-specific-code                                                                                                                                                                                                                                                                                                                          |
| RN docs — Pressable, Text, StyleSheet, SafeAreaView, AppState, Dimensions, Linking, KeyboardAvoidingView                                                                              | live           | https://reactnative.dev/docs/pressable · /text · /stylesheet · /safeareaview · /appstate · /dimensions · /linking · /keyboardavoidingview                                                                                                                                                                                                                                    |
| RN blog — 0.81 (Android 16, SafeAreaView deprecation, JSC removal)                                                                                                                    | 2025-08-12     | https://reactnative.dev/blog/2025/08/12/react-native-0.81                                                                                                                                                                                                                                                                                                                    |
| RN blog — 0.82 (New Architecture only, Hermes V1 experimental, unhandled rejections surface)                                                                                          | 2025-10-08     | https://reactnative.dev/blog/2025/10/08/react-native-0.82                                                                                                                                                                                                                                                                                                                    |
| `react-native@0.87.1` package source (inspected from npm tarball): `index.js` removed/deprecated shims; `@react-native/virtualized-lists@0.87.1` warnings; Fabric renderer text error | 0.87.1         | npm tarball                                                                                                                                                                                                                                                                                                                                                                  |
| Shopify FlashList — v2 migration, performance, recycling                                                                                                                              | docs 2.x       | https://shopify.github.io/flash-list/docs/v2-migration · https://shopify.github.io/flash-list/docs/fundamentals/performance · https://shopify.github.io/flash-list/docs/recycling                                                                                                                                                                                            |
| Reanimated — performance guide; 4.x migration; `useSharedValue` remarks                                                                                                               | docs 4.x       | https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/ · https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/ · https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/                                                                                                                              |
| Expo docs — Environment variables; SecureStore; Image; Minify (drop_console); EAS Update runtime versions; Expo Router URL parameters; Expo Router authentication                     | SDK latest     | https://docs.expo.dev/guides/environment-variables/ · https://docs.expo.dev/versions/latest/sdk/securestore/ · https://docs.expo.dev/versions/latest/sdk/image/ · https://docs.expo.dev/guides/minify/ · https://docs.expo.dev/eas-update/runtime-versions/ · https://docs.expo.dev/router/reference/url-parameters/ · https://docs.expo.dev/router/advanced/authentication/ |
| `eslint-plugin-expo@1.1.0` (rule source), `eslint-config-expo@57.0.2` (preset), `babel-preset-expo@57.0.11` (`plugins/inline-env-vars.js`)                                            | npm tarballs   | npm                                                                                                                                                                                                                                                                                                                                                                          |
| eslint-plugin-react-native README                                                                                                                                                     | `5.0.0`        | https://github.com/Intellicode/eslint-plugin-react-native/blob/master/README.md                                                                                                                                                                                                                                                                                              |
| Android Developers — Make apps more accessible (touch target)                                                                                                                         | live           | https://developer.android.com/guide/topics/ui/accessibility/apps                                                                                                                                                                                                                                                                                                             |
| Apple HIG — Accessibility (control size table; read from the page's JSON data)                                                                                                        | live           | https://developer.apple.com/design/human-interface-guidelines/accessibility                                                                                                                                                                                                                                                                                                  |

### Tool facts worth knowing before citing a rule

- **`eslint-plugin-react-native@5.0.0` has exactly seven rules**: `no-unused-styles`, `sort-styles`,
  `split-platform-components`, `no-inline-styles`, `no-color-literals`, `no-raw-text`,
  `no-single-element-style-arrays`. No list/perf/a11y/security rules exist in it.
- **`eslint-config-expo@57.0.2`** enables `plugin:react-hooks/recommended` plus `expo/use-dom-exports`,
  `expo/no-env-var-destructuring`, `expo/no-dynamic-env-var` (all `error`). `eslint-plugin-expo@1.1.0` also has
  `expo/prefer-box-shadow`.
- **No mainstream static tool covers RN list virtualisation, Reanimated thread misuse, touch-target size, or
  secure-storage choice.** Those entries are judgement-first; say so rather than implying lint coverage.

---

## Lists & rendering performance

### RN-01 Large or unbounded `.map()` inside `ScrollView`

- **Signal:** `<ScrollView>{items.map(...)}</ScrollView>` where `items` comes from an API/query/pagination
  (unbounded), or any static count > ~50 rows (heuristic, not a documented threshold). Also a `FlatList`/`FlashList`
  nested in a same-direction `ScrollView` → runtime warning "VirtualizedLists should never be nested inside plain
  ScrollViews with the same orientation" (`@react-native/virtualized-lists@0.87.1`, `VirtualizedList.js`).
- **Tool coverage:** none — judgement (runtime warning only for the nested case).
- **Why it hurts:** every row mounts at once → memory and JS-thread time scale with data; slow first render;
  nested lists defeat virtualisation entirely.
- **Severity:** major for server-driven lists; blocker if unbounded (user-generated feeds/search).
- **Remediation:** `FlatList` (built-in) or FlashList v2 / Legend List (named by the RN perf docs as
  alternatives); for mixed page content use a single list with `ListHeaderComponent`/`ListFooterComponent` or
  sectioned data. Trap: wrapping a list in `ScrollView` "to make the header scroll".
- **Not a finding when:** a small, fixed, local array (e.g. 5 settings rows).
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/performance · `@react-native/virtualized-lists@0.87.1`

### RN-02 FlatList misconfiguration: inline `renderItem`, missing `keyExtractor`, heavy items, no `getItemLayout`

- **Signal:** `renderItem={({item}) => <Row .../>}` inline in JSX of a component that re-renders often; no
  `keyExtractor` and items without a `key` field; item components doing data fetching/formatting per render;
  fixed-height rows without `getItemLayout`; runtime warning "VirtualizedList: You have a large list that is slow
  to update".
- **Tool coverage:** none for FlatList-specific props (`react:no-array-index-key` catches index keys in
  `keyExtractor={(_, i) => String(i)}` only when written as JSX `key`; UNVERIFIED for keyExtractor). partial:
  React Compiler auto-memoises the inline function when enabled.
- **Why it hurts:** blank areas, dropped frames on scroll; unstable keys lose row state on reorder.
- **Severity:** major on primary feeds; minor on short lists.
- **Remediation (docs):** "Avoid anonymous function on `renderItem`" (move outside JSX + `useCallback`); use
  `keyExtractor`; `memo()` list items; `getItemLayout` when all items share height; lightweight items with cached
  thumbnails; tune `initialNumToRender` (default 10), `maxToRenderPerBatch` (10), `windowSize` (21),
  `updateCellsBatchingPeriod` (50). Trap: `removeClippedSubviews` "can have bugs (missing content on iOS)";
  cranking `windowSize` trades memory for fill rate.
- **Not a finding when:** React Compiler is on and items are already memoised; list < ~20 rows.
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/optimizing-flatlist-configuration · https://reactnative.dev/docs/performance

### RN-03 FlashList v2 recycling violations (per-item `key`, un-reset local state, v1 props)

- **Signal:** `key=` on the item component or its children inside `renderItem`; `useState` in an item component
  whose value should belong to the _item_ (expanded, liked, image-loaded); `estimatedItemSize`,
  `estimatedListSize`, `estimatedFirstItemOffset`, `onBlankArea`, `disableAutoLayout` props (removed in v2);
  `MasonryFlashList` import; `useRef<FlashList<T>>`; heterogeneous rows without `getItemType`; `<Image>` in rows
  without `recyclingKey` (expo-image).
- **Tool coverage:** TypeScript catches removed props/types after upgrade. none — judgement for recycling state
  and keys.
- **Why it hurts:** "when you add a `key` prop that changes between different data items, React treats the
  component as entirely different" → recycling disabled; recycled cells show the previous item's state ("the
  component is re-rendered with a different `item` prop"); images flash the previous row's picture.
- **Severity:** major (stale state shown against a different row is a correctness bug); minor for perf-only.
- **Remediation:** remove keys (use `useMappingHelper` for inner maps); `useRecyclingState` to reset per-item
  state "without an additional render"; `getItemType` for separate recycle pools; `expo-image` `recyclingKey`;
  v2 requires the New Architecture. Trap: lifting per-row UI state to a global store keyed by id just to avoid
  recycling (fine, but then memoise selectors).
- **Not a finding when:** state is keyed off the item id and reset explicitly.
- **Architecture:** no.
- **Sources:** https://shopify.github.io/flash-list/docs/fundamentals/performance · https://shopify.github.io/flash-list/docs/recycling · https://shopify.github.io/flash-list/docs/v2-migration · https://docs.expo.dev/versions/latest/sdk/image/

### RN-04 JS-thread blocking work in press handlers / navigation transitions

- **Signal:** synchronous heavy work (large JSON parse, sorting thousands of rows, image processing, sync
  storage) in `onPress` or at screen mount; `InteractionManager.runAfterInteractions(...)` in code on RN ≥ 0.87.
- **Tool coverage:** none — judgement; `InteractionManager` in 0.87.1 throws in `__DEV__`:
  "InteractionManager has been removed from react-native core. Please refactor long tasks into smaller ones, and
  use 'requestIdleCallback' instead." (package `index.js`).
- **Why it hurts:** 16.67 ms frame budget — "Unresponsive JS thread = dropped frames"; Touchable feedback delayed
  ("Opacity/highlight effect not visible immediately if `onPress` action causes heavy re-render").
- **Severity:** major on interaction paths; blocker if `InteractionManager` is used on 0.87+ (crash in dev,
  undefined in prod).
- **Remediation:** chunk work; `requestIdleCallback`; `requestAnimationFrame` around expensive press actions;
  move pure heavy work off-thread (worklets runtime / native module); native-stack navigators (transitions on UI
  thread). Always measure in **release** builds ("JavaScript thread performance suffers greatly in dev mode").
- **Not a finding when:** work is bounded and measured < a frame.
- **Architecture:** yes if a feature requires sustained heavy compute on device — escalate (server-side or native module).
- **Sources:** https://reactnative.dev/docs/performance · `react-native@0.87.1/index.js`

### RN-05 `console.log` (and loggers) shipped in production bundles

- **Signal:** `console.log/info/debug` in app code; `redux-logger` or verbose SDK logging enabled unconditionally;
  no `drop_console` / `transform-remove-console` in the production build config.
- **Tool coverage:** ESLint core `no-console` (partial: doesn't catch third-party libraries — the RN docs say
  stripping is "Recommended even if no console calls in your code, as third-party libraries may include them").
- **Why it hurts:** "Major bottleneck in JavaScript thread when bundled"; PII/token leakage into device logs
  (CWE-532).
- **Severity:** minor (perf) → major when logging tokens/PII.
- **Remediation:** Expo Metro: `config.transformer.minifierConfig = { compress: { drop_console: ['log','info'] } }`
  (keeps warn/error); bare RN: `babel-plugin-transform-remove-console` in production env; structured logger with
  levels + redaction. Trap: dropping `console.error` also silences crash-reporter breadcrumbs.
- **Not a finding when:** dev-only code guarded by `__DEV__`.
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/performance · https://docs.expo.dev/guides/minify/

### RN-06 Re-render storms from inline style objects/arrays and root-level state

- **Signal:** `style={{ ... }}` literals and `style={[a, {margin: x}]}` inside list rows or memoised children;
  single-element arrays `style={[styles.x]}`; app-root state updated on every keystroke/scroll event.
- **Tool coverage:** `react-native:no-inline-styles` (literal values only), `react-native:no-single-element-style-arrays`,
  `react-native:no-color-literals`, `react-native:no-unused-styles`. partial: the perf consequence is judgement.
- **Why it hurts:** new object identity per render defeats `memo` children; RN docs example — "Setting state on
  complex app root causing expensive re-renders could drop 12 frames in 200ms".
- **Severity:** minor usually; major inside hot lists or scroll handlers.
- **Remediation:** `StyleSheet.create` at module scope (note: the docs now describe it as "An identity function …
  The main practical benefit … is static type checking" — do **not** justify it as a perf win);
  `StyleSheet.compose` for conditional merges ("maintaining reference equality"); design tokens; colocate state.
- **Not a finding when:** a dynamic value that must track `useWindowDimensions()` per render — the Dimensions
  docs explicitly recommend "inline styles rather than setting a value in a StyleSheet" for values that change.
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/stylesheet · https://reactnative.dev/docs/performance · https://reactnative.dev/docs/dimensions · https://github.com/Intellicode/eslint-plugin-react-native/blob/master/README.md

### RN-07 Raw text outside `<Text>` (including leaked `&&` values)

- **Signal:** string/number children directly under `<View>`/`<Pressable>`; `{count && <Badge/>}` where `count`
  can be `0`; `{title}` rendered into a `View`.
- **Tool coverage:** `react-native:no-raw-text`; `@eslint-react/no-leaked-conditional-rendering` (type-aware, not
  in recommended); `react:jsx-no-leaked-render`. Runtime (Fabric): "Text strings must be rendered within a <Text>
  component." (`ReactFabric-dev.js`, 0.87.1).
- **Why it hurts:** runtime exception → red screen / crash; appears only for the falsy-number data case → escapes
  happy-path tests.
- **Severity:** blocker when reachable by real data (`0` counts, empty strings).
- **Remediation:** `{count > 0 ? <Badge/> : null}`; wrap text in an app `Text` primitive (docs recommend custom
  text components because style inheritance "is strictly limited to text subtrees").
- **Not a finding when:** operand is a boolean.
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/text · `react-native@0.87.1` Fabric renderer

### RN-08 Unsized/un-cached/oversized images; animating image width/height

- **Signal:** `<Image source={{ uri }}/>` without width/height/aspectRatio; full-resolution originals rendered as
  thumbnails; RN core `Image` in long lists; `Animated`/Reanimated on image `width`/`height`; `useImage` from
  expo-image without `maxWidth`/`maxHeight`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** layout jumps, memory spikes/OOM on Android; "iOS re-crops and scales from original image on each
  width/height adjustment"; expo-image warns `useImage` on large images "may cause crashes due to excessive memory
  usage".
- **Severity:** major in feeds; minor for single hero images.
- **Remediation:** `expo-image` (`cachePolicy` default `'disk'`, `placeholder` BlurHash/ThumbHash, `contentFit`,
  `allowDownscaling` default `true`, `recyclingKey` in recycled lists, `Image.prefetch`); server-side thumbnails;
  animate `transform: [{ scale }]` instead of size.
- **Not a finding when:** local bundled assets with intrinsic size.
- **Architecture:** yes if the API serves only originals — image-variant pipeline is a backend contract; escalate.
- **Sources:** https://reactnative.dev/docs/performance · https://docs.expo.dev/versions/latest/sdk/image/

---

## Animations & gestures (Reanimated 4 / worklets)

### RN-09 Animation driven from the JS thread (setState per frame, `Animated` without native driver)

- **Signal:** `setInterval`/`requestAnimationFrame` loops calling `setState` to move views; `Animated.timing(...)`
  without `useNativeDriver: true`; scroll handlers that `setState` on every `onScroll`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** frame drops whenever JS is busy; jank on low-end Android.
- **Severity:** major for gesture-driven or continuous animations.
- **Remediation:** Reanimated shared values + `useAnimatedStyle`/`useAnimatedScrollHandler`; `Animated` with
  `useNativeDriver: true`; `LayoutAnimation` only for fire-and-forget ("use `Animated` if animations must be
  interruptible").
- **Not a finding when:** one-off, non-interactive transitions with no measurable jank.
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/performance · https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/

### RN-10 Reading/writing shared values in render; destructuring; in-place object mutation

- **Signal:** `sv.value` read in the component body/JSX; `const { value } = sv`; `sv.value.x = 50`; reading
  `sv.value` from JS-thread handlers in hot paths.
- **Tool coverage:** `react-hooks:refs`/`immutability` may flag `.value` reads/writes during render when the
  compiler rules are on (UNVERIFIED for shared values specifically). none otherwise.
- **Why it hurts:** "Don't read or modify the value of a shared value during a component's render"; JS-thread read
  "will get blocked until the value is fetched from the UI thread"; destructuring and in-place mutation lose
  reactivity → animation silently stops updating.
- **Severity:** major.
- **Remediation:** read inside worklets (`useAnimatedStyle`, `useDerivedValue`); reassign whole objects or
  `sv.modify()`; with React Compiler use `sv.get()`/`sv.set()`.
- **Not a finding when:** reading in an event handler that runs rarely (e.g. on submit).
- **Architecture:** no.
- **Sources:** https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/ · https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/

### RN-11 Reanimated 3 APIs / thread-hop overuse in Reanimated 4 code

- **Signal:** `runOnJS(...)` / `runOnUI(...)`, `useWorkletCallback`, `useAnimatedGestureHandler`,
  `combineTransition`, `react-native-reanimated/plugin` in babel config, `useScrollViewOffset`; per-frame
  `scheduleOnRN` calls inside `onUpdate`/frame callbacks.
- **Tool coverage:** TypeScript/runtime after upgrade for removed APIs; none for per-frame thread hops.
- **Why it hurts:** removed APIs break builds; the worklets Babel plugin path moved to
  `react-native-worklets/plugin` (old path → worklets not transformed); each JS hop per frame reintroduces JS-thread
  jank.
- **Severity:** blocker (build/runtime) for removed APIs; major for per-frame hops.
- **Remediation:** 4.x renames — `runOnJS` → `scheduleOnRN`, `runOnUI` → `scheduleOnUI`, `runOnUIRuntimeSync` →
  `runOnUISync`, `runOnRuntime` → `scheduleOnRuntime` ("arguments are no longer passed as a separate function
  invocation"); `useCallback` + `'worklet'` instead of `useWorkletCallback`; Gesture Handler 2 `Gesture` API;
  only hop to JS at gesture end. Performance: animate non-layout props (`transform`, `opacity`) over
  `top/left/width/height`; memoise gesture objects (`useMemo`) and frame callbacks (`useCallback`); keep animated
  components ≤100 (low-end Android) / ≤500 (iOS).
- **Not a finding when:** a codebase deliberately pinned to Reanimated 3 on 0.81 (last legacy-arch-capable).
- **Architecture:** no.
- **Sources:** https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/ · https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/

---

## New Architecture, platform & upgrade pitfalls

### RN-12 Assuming the Legacy Architecture is still selectable (or that legacy APIs still exist)

- **Signal:** `newArchEnabled=false` in `gradle.properties`, `RCT_NEW_ARCH_ENABLED=0` in Podfile/CI on RN ≥ 0.82;
  libraries without New Architecture support kept "because interop works"; `InteractionManager` on 0.87;
  built-in `SafeAreaView` import; `Appearance.setColorScheme(null)`; JSC-dependent code on 0.81+.
- **Tool coverage:** none static; runtime warnings/throws (SafeAreaView getter in 0.87.1 logs "SafeAreaView has
  been deprecated and will be removed in a future release.").
- **Why it hurts:** 0.82: "if you try to set `newArchEnabled=false` on Android … these will be ignored and your app
  will still run using the New Architecture" → a flag that _looks_ like a rollback lever isn't. 0.81 removed
  built-in JSC; 0.82 `Appearance.setColorScheme()` "No longer accepts null/undefined. Use 'unspecified'";
  "Uncaught promise rejections are now reported via `console.error`. Previously they were swallowed" (hidden
  bugs surface after upgrade).
- **Severity:** major (blocker if a critical native library lacks New-Arch support).
- **Remediation:** audit native deps for New-Arch support before upgrade (interop layers "remain in the codebase
  for the foreseeable future", but legacy API removal "is scheduled to start"); replace `SafeAreaView` with
  `react-native-safe-area-context`; fix previously swallowed rejections rather than muting `console.error`.
- **Not a finding when:** app pinned at RN 0.81 / Expo SDK 54 intentionally (last legacy-capable).
- **Architecture:** yes — native dependency strategy is a platform decision; escalate.
- **Sources:** https://reactnative.dev/blog/2025/10/08/react-native-0.82 · https://reactnative.dev/blog/2025/08/12/react-native-0.81 · `react-native@0.87.1/index.js`

### RN-13 Safe-area and edge-to-edge handled with hard-coded padding or deprecated `SafeAreaView`

- **Signal:** `paddingTop: 44`/`StatusBar.currentHeight` arithmetic; `Platform.OS === 'ios' ? 20 : 0`; RN core
  `SafeAreaView`; Android layouts that assume the system bars are opaque.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Android 16 (API 36) "Edge-to-edge rendering is **mandatory** with no opt-out option" (RN 0.81
  defaults to targeting it); core `SafeAreaView` "is not compatible with edge-to-edge rendering on Android" →
  content under status/gesture bars, unreachable buttons behind the nav bar.
- **Severity:** major (blocker when the primary action is obscured).
- **Remediation:** `react-native-safe-area-context` (`useSafeAreaInsets`, `SafeAreaView` from that package) at
  screen/layout level; design-system primitives own insets. Trap: applying insets at both the navigator and the
  screen (double padding).
- **Not a finding when:** the navigation library's header/tab bar already consumes the inset for that edge.
- **Architecture:** yes — should live in shared layout primitives; escalate to UX/design-system owner.
- **Sources:** https://reactnative.dev/blog/2025/08/12/react-native-0.81 · https://reactnative.dev/docs/safeareaview

### RN-14 Platform-file-extension misuse (`.native.tsx` / `.ios.tsx`) and `Platform.select` drift

- **Signal:** `Foo.native.tsx` whose exported API differs from `Foo.tsx` (props/exports mismatch); a `.native`
  file that is a copy-paste of the web layout; `Platform.OS === 'ios'` branches scattered across a component for
  large divergence; `.mobile.tsx` or other non-resolved suffixes; importing with an explicit extension
  (`./Foo.native`) which bypasses resolution; `Platform.select({ native: ... })` expecting it to match web.
- **Tool coverage:** `react-native:split-platform-components` (enforces platform filenames for iOS/Android-only
  components); TypeScript does not check that `.native.tsx` and `.tsx` share a type signature unless a shared
  interface is imported by both. partial: API parity and layout-quality parity are judgement.
- **Why it hurts:** "Import without the extension—React Native automatically selects the correct file"; mismatched
  exports compile on one platform and crash on the other; the `native` key "is matched on both Android and iOS but
  not on Web (uses `default` instead)"; web bundles grow unless the web bundler ignores `.native.js`.
- **Severity:** major for API mismatch; minor for style of branching.
- **Remediation:** one shared props type imported by both files (Adapter/Bridge pattern: shared contract, per-platform
  implementation); guard test that imports both and asserts identical export keys; use extensions for "larger,
  more complex divergence" and `Platform.select` for small differences.
- **Not a finding when:** a genuinely platform-only module behind a shared interface.
- **Architecture:** yes — cross-platform contract; escalate to architecture.
- **Sources:** https://reactnative.dev/docs/platform-specific-code · https://github.com/Intellicode/eslint-plugin-react-native/blob/master/README.md

### RN-15 1:1 web-to-mobile layout port

- **Signal:** a `.native.tsx` whose JSX tree mirrors the web component's (same row/column grid, same action
  positions, hover-only affordances like tooltips/`onMouseEnter`, right-click/drag interactions with no touch
  equivalent); multi-column layouts at phone width; primary action at top-right (desktop cursor position); fixed
  pixel widths; button labels sized for English only.
- **Tool coverage:** none — judgement (no tool compares layouts across platforms).
- **Why it hurts:** existence parity passes review while mobile usability fails: wrapped/truncated labels, primary
  action out of thumb reach, horizontal overflow, long scroll to reach the main action, affordances unreachable by
  touch.
- **Severity:** major (blocker when a flow's primary action is unreachable/obscured).
- **Remediation:** translate the _job_, not the layout: re-decide primary action placement by reach; give every
  hover/right-click/drag a touch equivalent (long-press menu, swipe action, explicit button); size to longest
  localised string; single column at narrow widths via `useWindowDimensions`. Trap: fixing per screen instead of
  in the shared primitive.
- **Not a finding when:** the design spec explicitly records the mobile disposition for each element.
- **Architecture:** yes — escalate to UX (design authority) and to the shared design-system owner.
- **Sources:** https://reactnative.dev/docs/dimensions (primary sources give the ingredients; the port anti-pattern itself is judgement)

### RN-16 Caching `Dimensions.get()` at module scope / not reacting to window changes

- **Signal:** `const { width } = Dimensions.get('window')` at module top level or in `StyleSheet.create`;
  `Dimensions.addEventListener` without `.remove()`.
- **Tool coverage:** none — judgement; `@eslint-react/web-api-no-leaked-event-listener` targets DOM
  `addEventListener`/`removeEventListener` pairs, not RN subscription `.remove()` (UNVERIFIED whether it detects
  RN `EmitterSubscription`).
- **Why it hurts:** "they may change (e.g due to device rotation, foldable devices etc)"; tablets/split-screen and
  Android 16 large-screen adaptive layouts render with stale sizes.
- **Severity:** minor–major (major on tablets/foldables targets).
- **Remediation:** `useWindowDimensions()` ("the preferred API for React components").
- **Not a finding when:** reading screen size once for analytics.
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/dimensions · https://reactnative.dev/blog/2025/08/12/react-native-0.81

### RN-17 Leaked native subscriptions (AppState, Dimensions, Linking, Keyboard, NetInfo)

- **Signal:** `AppState.addEventListener('change', h)` / `Linking.addEventListener('url', h)` /
  `Keyboard.addListener(...)` inside `useEffect` with no `return () => sub.remove()`; code calling the removed
  `removeEventListener` style APIs.
- **Tool coverage:** none reliable — judgement (see RN-16 note).
- **Why it hurts:** listeners accumulate per mount (StrictMode double-mount, navigation remounts) → duplicate
  handling (e.g. deep link processed twice, refetch storms on foreground).
- **Severity:** major when the handler performs navigation, mutations or network calls.
- **Remediation:** `const sub = AppState.addEventListener(...); return () => sub.remove();` (documented pattern);
  or wrap in `useSyncExternalStore` for read-only values.
- **Not a finding when:** module-level singleton subscription intentionally app-lifetime (document it).
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/appstate · https://reactnative.dev/docs/linking · https://reactnative.dev/docs/dimensions

### RN-18 Keyboard avoidance hand-rolled or single-platform

- **Signal:** `KeyboardAvoidingView` with `behavior` set only for iOS (`behavior={Platform.OS === 'ios' ? 'padding' : undefined}`)
  and untested Android; `keyboardVerticalOffset` magic numbers not derived from header height; forms inside
  `ScrollView` without `keyboardShouldPersistTaps`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** submit buttons hidden under the keyboard on Android (edge-to-edge changes resize behaviour);
  taps dismiss keyboard instead of pressing buttons.
- **Severity:** major on auth/checkout forms.
- **Remediation:** docs: "Setting `behavior` is recommended for both platforms"; derive offset from header height;
  consider `windowSoftInputMode` and edge-to-edge; test on both platforms.
- **Not a finding when:** navigation library/form primitive already handles insets and is tested.
- **Architecture:** no.
- **Sources:** https://reactnative.dev/docs/keyboardavoidingview

---

## Accessibility

### RN-19 Touch targets below platform minimums

- **Signal:** `Pressable`/`TouchableOpacity` with content < 44×44 pt (iOS) / 48×48 dp (Android) and no `hitSlop`;
  icon buttons styled `width: 24, height: 24`; adjacent tiny targets.
- **Tool coverage:** none — judgement (no static tool measures computed size).
- **Why it hurts:** mis-taps, inaccessible for motor impairments. Android: "at least 48dp×48dp. Larger is even
  better." Apple HIG (iOS/iPadOS): default control size **44x44 pt**, minimum **28x28 pt**.
- **Severity:** major for primary actions; minor for secondary.
- **Remediation:** enlarge the pressable area (padding) or `hitSlop`; caveat from the Pressable docs: "Touch area
  never extends past parent view bounds, and Z-index of sibling views takes precedence" → `hitSlop` silently fails
  inside tight parents; fix in the design-system `IconButton`.
- **Not a finding when:** the visual icon is small but the pressable container meets the minimum.
- **Architecture:** yes when the shared primitive is undersized — escalate to design-system/UX owner.
- **Sources:** https://developer.android.com/guide/topics/ui/accessibility/apps · https://developer.apple.com/design/human-interface-guidelines/accessibility · https://reactnative.dev/docs/pressable

### RN-20 Missing role/label/state on custom controls; legacy vs `aria-*` props mixed

- **Signal:** `Pressable` wrapping only an icon without `accessibilityLabel`/`aria-label`; custom checkbox/switch
  without `role`/`accessibilityRole` and `aria-checked`/`accessibilityState`; `accessible={false}` on
  interactive views; both `role` and `accessibilityRole` with different values; decorative images not hidden;
  live counters without `aria-live`/`accessibilityLiveRegion`; `allowFontScaling={false}` on body text.
- **Tool coverage:** none in `eslint-plugin-react-native`; jsx-a11y rules target DOM elements and don't understand
  RN components (UNVERIFIED for community `eslint-plugin-react-native-a11y` — not opened). Testing Library
  `getByRole` queries catch missing roles in component tests.
- **Why it hurts:** VoiceOver/TalkBack read "button" with no name, or nothing; state changes unannounced; text
  doesn't scale.
- **Severity:** major.
- **Remediation:** RN docs: `role` "is the newer prop and has precedence over `accessibilityRole`"; `aria-label`
  is "the newer, recommended alias" for `accessibilityLabel`; use `aria-disabled/selected/checked/busy/expanded`
  instead of the `accessibilityState` object; `aria-hidden` for decorative content; `aria-live="polite"` for
  dynamic counts; cap scaling with `maxFontSizeMultiplier` rather than disabling it. Localise labels.
- **Not a finding when:** the control is a core component whose default role is correct and text child provides
  the name.
- **Architecture:** yes if primitives lack a11y props — escalate to design-system owner.
- **Sources:** https://reactnative.dev/docs/accessibility · https://reactnative.dev/docs/text

---

## Navigation (Expo Router)

### RN-21 `useGlobalSearchParams` by default; complex objects in params; unvalidated params

- **Signal:** `useGlobalSearchParams()` in screen components that only need their own params; passing JSON-stringified
  objects/arrays through params; using params (`id`, `redirect`, `url`) directly in queries/navigation without
  parsing.
- **Tool coverage:** none — judgement (Expo typed routes give param _names_, not value validation).
- **Why it hurts:** "useGlobalSearchParams made the background screens re-render when the URL route parameters
  changed. It can cause performance issues if overused"; params are "strings or string arrays only" → fragile
  serialisation; deep links make params attacker-controlled (see RN-26).
- **Severity:** minor (perf) → major (unvalidated params used for navigation/auth decisions).
- **Remediation:** `useLocalSearchParams` by default; pass ids and fetch/derive; parse params with a schema (zod)
  at the screen boundary.
- **Not a finding when:** a global component (analytics, header) genuinely needs every URL change.
- **Architecture:** no.
- **Sources:** https://docs.expo.dev/router/reference/url-parameters/

### RN-22 Client-side route guards treated as the security boundary

- **Signal:** `Stack.Protected guard={!!session}` or redirect-in-layout as the _only_ access control for data;
  API calls that don't carry/verify auth because "the screen is protected".
- **Tool coverage:** none — judgement.
- **Why it hurts:** Expo docs scope it: "Protected routes allow you to prevent users from accessing certain routes
  using client-side navigation." A modified client or direct API call bypasses it (CWE-602 client-side
  enforcement of server-side security — mapping is judgement).
- **Severity:** blocker if the backend relies on it; otherwise not a finding.
- **Remediation:** guards for UX; authorisation enforced by the API on every request.
- **Not a finding when:** backend authorises independently (verify, don't assume).
- **Architecture:** yes — auth boundary; escalate to security/architecture.
- **Sources:** https://docs.expo.dev/router/advanced/authentication/

---

## Configuration, storage & release

### RN-23 Secrets in `EXPO_PUBLIC_*` (or any bundled constant)

- **Signal:** `EXPO_PUBLIC_*` variables whose names/values look secret (`SECRET`, `PRIVATE_KEY`, `SERVICE_ROLE`,
  `sk_live_`, `API_KEY` for server-privileged APIs); secrets in `app.json`/`app.config.*` `extra`; API keys in
  source.
- **Tool coverage:** secret scanners (gitleaks/trufflehog) on committed files only; none for values injected at EAS
  build time. partial: publishable keys (e.g. `pk_…`) are _meant_ to be public — judgement.
- **Why it hurts:** Expo: "Do not store sensitive info, such as private keys, in `EXPO_PUBLIC_` variables. These
  variables will be visible in plain-text in your compiled application." RN docs: "Never store API keys in app
  code." (CWE-798 / CWE-200.)
- **Severity:** blocker for privileged credentials.
- **Remediation:** move privileged calls behind your backend; only publishable/public identifiers in client env;
  rotate any leaked key.
- **Not a finding when:** the value is a publishable key/public URL by design.
- **Architecture:** yes — needs a backend proxy/token exchange; escalate to security.
- **Sources:** https://docs.expo.dev/guides/environment-variables/ · https://reactnative.dev/docs/security

### RN-24 Env-var access shape that silently fails to inline (and a doc/lint/implementation conflict)

- **Signal:** `const { EXPO_PUBLIC_X } = process.env`; `const env = process.env; env.EXPO_PUBLIC_X`;
  `process.env[name]` with a variable; `process.env['EXPO_PUBLIC_X']` (string-literal bracket) — the last one is
  the contested case.
- **Tool coverage:** `expo/no-env-var-destructuring`, `expo/no-dynamic-env-var` (`eslint-plugin-expo@1.1.0`, both
  `error` in `eslint-config-expo@57.0.2`). Note the rule implementation reports **any computed access in a
  `VariableDeclarator` initializer, including a string literal** — but not in other positions (e.g. JSX props,
  call arguments), so coverage is partial.
- **Why it hurts:** split by shape — (i) **variable key / aliased `process.env` / destructuring**: not inlined →
  `undefined` on device in production, app points at nothing, often masked by a `?? fallback` that "works" in
  tests. (ii) **string-literal bracket `process.env['EXPO_PUBLIC_X']`**: _does_ inline in the current
  `babel-preset-expo@57.0.11` implementation (see evidence below), so it is **not** a runtime breakage today — it
  is a lint failure (`expo/no-dynamic-env-var` errors on it in a variable initializer), a contradiction of the
  documented contract, and a version-fragility risk if the implementation is ever aligned with the docs.
- **Severity:** (i) major (blocker when it controls API base URL/auth keys); (ii) minor — report as convention /
  fragility risk, never as "this is undefined on device".
- **Remediation / evidence to weigh:** Expo docs (live) say only dot notation inlines and list
  `process.env['EXPO_PUBLIC_API_URL']` as **Invalid** "Won't inline". However `babel-preset-expo@57.0.11`
  `plugins/inline-env-vars.js` explicitly handles a `StringLiteral` property (`toMemberProperty` returns
  `property.value`) and replaces it when the key starts with `EXPO_PUBLIC_` — i.e. the current implementation
  **does** inline the literal-bracket form, while docs and lint forbid it. Recommendation: use static dot notation
  for public client vars (satisfies docs, lint, and every bundler), centralise in one typed env module (e.g. T3 Env
  `runtimeEnv` mapping each name literally), and fail the build on missing values instead of `??` fallbacks. Trap:
  a repo-wide "bracket notation only for `process.env`" convention (common with TS
  `noPropertyAccessFromIndexSignature`) collides with this — carve out public client vars explicitly.
- **Not a finding when:** server-side code (Expo Router API routes / server) reading runtime env; dot notation used.
- **Architecture:** no (yes if the convention conflict is repo-wide — escalate to whoever owns lint config).
- **Sources:** https://docs.expo.dev/guides/environment-variables/ · `eslint-plugin-expo@1.1.0/build/rules/no-dynamic-env-var.js` · `babel-preset-expo@57.0.11/build/plugins/inline-env-vars.js`

### RN-25 Tokens/secrets in AsyncStorage (or MMKV unencrypted); misuse of SecureStore

- **Signal:** `AsyncStorage.setItem('token'|'refreshToken'|'password', …)`; auth SDK token cache backed by
  AsyncStorage; large JSON blobs in `expo-secure-store`; assuming SecureStore data is wiped on iOS uninstall.
- **Tool coverage:** `codeql:js/clear-text-storage-of-sensitive-data` (CWE-312) may flag some flows (UNVERIFIED for
  AsyncStorage sinks); none otherwise.
- **Why it hurts:** RN docs: Async Storage is "unencrypted" and for "Non-sensitive data"; tokens belong in
  Keychain/Keystore. SecureStore: "Historically, some iOS releases refused values above roughly 2048 bytes";
  "iOS: Data persists across reinstallations with the same bundle ID"; Android Auto Backup must exclude it
  (`configureAndroidBackup`); biometric-protected values "become inaccessible if users modify their biometric
  settings".
- **Severity:** blocker for refresh tokens/credentials in AsyncStorage; major for SecureStore misuse (size /
  reinstall assumptions).
- **Remediation:** `expo-secure-store` / `react-native-keychain` for tokens; store small secrets only (encrypt a
  larger payload with a key held in SecureStore); on first launch after install, clear stale Keychain items if
  the app's logic requires.
- **Not a finding when:** non-sensitive caches (UI prefs, query cache without PII).
- **Architecture:** yes — session/token storage model; escalate to security.
- **Sources:** https://reactnative.dev/docs/security · https://docs.expo.dev/versions/latest/sdk/securestore/

### RN-26 Unvalidated deep links and `Linking.openURL` with untrusted input

- **Signal:** handler for `Linking.getInitialURL()`/`addEventListener('url')` or Expo Router routes that act on
  URL contents (navigate to `redirect=` param, auto-login with `token=` param, open `url=` param) without
  allow-listing; `Linking.openURL(userValue)`; sensitive data in custom-scheme links; OAuth without PKCE.
- **Tool coverage:** none — judgement (`codeql:js/client-side-unvalidated-url-redirection` is DOM-oriented;
  UNVERIFIED for RN `Linking`).
- **Why it hurts:** RN docs: "Never send sensitive information via deep links … URL schemes aren't centrally
  registered—malicious apps can hijack them"; "Never pass untrusted input directly to `openURL()`. Always validate
  URLs". (CWE-601 open redirect, CWE-939 improper authorization in handler for custom URL scheme.)
- **Severity:** blocker for auth tokens in links / auto-actions; major for open redirect.
- **Remediation:** universal links / App Links (`https`) over custom schemes; OAuth2 + PKCE; parse with `URL` and
  allow-list hosts/paths; never perform state-changing actions solely from a link without confirmation.
- **Not a finding when:** links only select a read-only screen by id and the API authorises the fetch.
- **Architecture:** yes — deep-link contract and auth flow; escalate to security.
- **Sources:** https://reactnative.dev/docs/security · https://reactnative.dev/docs/linking

### RN-27 OTA update runtime-version mismanagement

- **Signal:** `runtimeVersion` hard-coded string never bumped; `"policy": "appVersion"` with native dependency
  changes shipped without an app version bump; `expo-updates` publish in CI after adding a native module.
- **Tool coverage:** partial — the `fingerprint` policy computes native changes automatically; none if manual.
- **Why it hurts:** "if you add `expo-camera` without incrementing the runtime version, older builds will attempt
  to load the update" → crashes/rollback loops in production.
- **Severity:** blocker (fleet-wide crash risk).
- **Remediation:** `runtimeVersion: { policy: 'fingerprint' }` ("if you want to make incompatible updates extremely
  unlikely"); CI check that an update's runtime matches an existing build; staged rollouts.
- **Not a finding when:** no OTA updates are used.
- **Architecture:** yes — release/rollback strategy; escalate to release owner.
- **Sources:** https://docs.expo.dev/eas-update/runtime-versions/

---

## Security-hygiene overlap

| Concern                                                                                                 | CWE                         | Detection                                                                                                                                                                                                              | Entry                                                                                       |
| ------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Secrets bundled into the app (`EXPO_PUBLIC_*`, source constants)                                        | CWE-798, CWE-200            | secret scanners on repo; none for build-time injection                                                                                                                                                                 | RN-23                                                                                       |
| Tokens in AsyncStorage / cleartext storage                                                              | CWE-312, CWE-922            | `codeql:js/clear-text-storage-of-sensitive-data` (sink coverage for AsyncStorage UNVERIFIED); semgrep `typescript.react.security.audit.react-jwt-in-localstorage.react-jwt-in-localstorage` is web-`localStorage`-only | RN-25                                                                                       |
| Deep-link hijack / open redirect / `openURL` with untrusted input                                       | CWE-601, CWE-939            | none — judgement                                                                                                                                                                                                       | RN-26                                                                                       |
| Client-side-only authorisation (route guards)                                                           | CWE-602 (mapping judgement) | none — judgement                                                                                                                                                                                                       | RN-22                                                                                       |
| Logging tokens/PII to device logs                                                                       | CWE-532                     | ESLint `no-console` (partial)                                                                                                                                                                                          | RN-05                                                                                       |
| Cleartext HTTP                                                                                          | CWE-319                     | `semgrep:typescript.react.security.react-insecure-request.react-insecure-request` (web-oriented)                                                                                                                       | — use HTTPS; RN docs also recommend SSL pinning "mindful of certificate expiry (1-2 years)" |
| XSS in WebView (`react-native-webview` with `injectedJavaScript`/`originWhitelist={['*']}`)             | CWE-79                      | none verified                                                                                                                                                                                                          | not researched in depth — see open questions                                                |
| RSC/server functions in Expo Router server features (`babel-preset-expo` ships `server-actions-plugin`) | CWE-502 class (React2Shell) | dependency audit                                                                                                                                                                                                       | see `react.md` REACT-45 / `nextjs.md`                                                       |

---

## Open questions / unverified

- Whether `@eslint-react/web-api-no-leaked-event-listener` recognises RN `EmitterSubscription.remove()` patterns
  (RN-16/17) — not tested.
- Whether React Compiler lint (`react-hooks:refs`/`immutability`) flags Reanimated `.value` access (RN-10).
- `eslint-plugin-react-native-a11y` (community) rule list — not opened; RN a11y lint coverage therefore stated as none.
- `InteractionManager` deprecation timeline before 0.87 (which minor first warned) — only the 0.87.1 removal shim
  was verified from the package.
- Expo docs vs `babel-preset-expo@57.0.11` disagree on literal-bracket `EXPO_PUBLIC_` inlining (RN-24); behaviour
  under `inlineEnvironmentVariables: false` or in dev serializer not tested end-to-end on a device build.
- `react-native-webview` security props and Hermes-specific pitfalls (e.g. `Intl` coverage, bytecode source-map
  handling) were not researched with primary sources.
- CodeQL sink coverage for AsyncStorage and RN `Linking` not verified.
- The ">~50 rows" ScrollView heuristic (RN-01) is not from a primary source.
- **TurboModules / Fabric native-component authoring pitfalls** (Codegen specs, synchronous JSI calls blocking JS,
  legacy `NativeModules` access under bridgeless) were **not researched** — RN-12 covers only New-Architecture
  adoption/upgrade shapes. Treat this as an uncovered sub-area, not as "no smells exist".
