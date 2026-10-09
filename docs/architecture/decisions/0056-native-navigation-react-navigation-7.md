# 0056 — Native navigation is React Navigation 7, one native stack per tab, under our own tab bar

- **Status**: Accepted
- **Date**: 2026-10-08
- **Drivers**: The owner's navigation rulings for the UI overhaul (`docs/design/uiOverhaul/ownerDecisions.md`).
  The tabs are Home, Recipes and Discover. Profile opens from the avatar. The iPad keeps the bottom tab bar (D6). The
  app keeps its own tab bar, with real glass behind it on iOS 26, until native system tabs are stable (D14). The build
  spec adds four needs (`docs/design/uiOverhaul/buildSpec.md` §3.1, §3.5, §3.7):
    - history in each tab.
    - push and pop with the iOS edge swipe.
    - pop to the root on a second tap of the active tab.
    - Profile pushed onto the current tab.
- **Decides**: blueprint A6 (`docs/architecture/uiOverhaulBlueprint.md`), with the back-handler order corrected.
- **Supersedes**: the "B13" note in `packages/apps/commise/mobile/src/screens/AppRoot.tsx`. That note kept the app on
  a `useState` destination switch.

## Context

The mobile app had no navigation library. `AppRoot` switched among four destinations with `useState`.
`RecipesScreen` kept its own stack of thirteen surfaces in a second `useState`.

The B13 note gave the reason. It said that with three flat destinations and no history needs, a `useState` switch was
the simplest correct design. It also named a navigation library as "a legitimate future need".

That premise no longer holds. The overhaul needs these things:

- history in each tab, and a stack per tab that survives a tab switch.
- the iOS interactive edge swipe on a pushed screen.
- pop to the root on a second tap, and a scroll to the top at the root.
- Profile pushed onto the current tab.

Those are history needs.

## Decision

1. **Use React Navigation 7.** The packages are `@react-navigation/native`, `@react-navigation/native-stack` and
   `@react-navigation/bottom-tabs`, with `react-native-screens` (`~4.26`, installed with `npx expo install`). The code
   is in `packages/apps/commise/mobile/src/navigation/`.
2. **The root native stack holds `Tabs` and the focused tasks.** The tasks are the interim create and edit wizard, the
   paste flow, and the collection form and picker. Slices 5, 7 and 8 replace them. A task sits above the tabs, so the
   tab bar hides by construction.
    - Tasks use `presentation: 'card'` with the edge swipe on.
    - The interim wizard is the exception. Only its own back control and Android Back guard its unsaved changes. So
      its swipe stays off until the slice 7 editor, which saves all the time.
3. **Each tab is a native stack.** Each one registers its root and the same pushed screens: recipe detail, versions,
   collection detail, Profile, and the account hub until slice 9. So the three stacks share one param list
   (`routes.ts`). That list replaces both `useState` unions.
4. **The app keeps its own tab bar.** `tabBar` renders `AppTabBar`. It is an Adapter from `BottomTabBarProps` to the
   presentational `HomeTabBar`.
    - It emits `tabPress` with `canPreventDefault`, and it moves to the tab unless a listener prevents it. The library's
      default bar does the same.
    - The library's own listeners then give the second tap its meaning. A stack pops to its root. A tab root scrolls
      to the top through `useScrollToTop` over the screen's `ScrollHost` handle. Nothing here re-implements either.
    - `backBehavior="initialRoute"` sends Android Back from Recipes or Discover to Home.
5. **Our back provider sits OUTSIDE the container.** React Native calls `hardwareBackPress` listeners in reverse
   order: the last one registered answers first. React runs the effects of a child before those of its parent.
    - Inside `NavigationContainer`, a `BackInterceptProvider` subscribes first and answers last. Then the container
      pops the screen under an open sheet before the sheet sees the press.
    - Outside, it subscribes last and answers first. A sheet or a guarded editor gets the first refusal. A press that
      nothing claims is declined (`onUnhandled` returns `false`), so React Navigation's handler takes it.
    - The blueprint drew this the other way round. The subscription order decides it.
6. **Each routed screen has its own crash boundary** (`ScreenBoundary`, through each navigator's `screenLayout`). The
   tab bar survives a screen that throws. "Back to Home" resets the app through the container's handle
   (`createNavigationContainerRef`). It is not offered on Home itself.
7. **Scenes are transparent.** The navigation theme's `background`, the stacks' `contentStyle` and the tabs'
   `sceneStyle` are all transparent, so the root canvas wash shows through (issue #145). The other theme colours come
   from the colour roles, so both themes follow the system (D15, D17).

## Alternatives considered

- **A hand-made stack with an iOS swipe.** It needs `react-native-gesture-handler` and Reanimated, two more native
  modules. It also re-builds the interruptible pop of `UINavigationController`. We use the library instead.
- **React Navigation 8.** It is still alpha (`next` was `8.0.0-alpha.50` on the date of this record). Its bottom tabs
  default to native system tabs. Those replace our bar, against D14.
- **Expo Router.** It restructures the entry point and `AuthGate` around files. It gives nothing that React Navigation
  does not, and it is built on React Navigation.
- **Native system tabs now** (`createNativeBottomTabNavigator`). It is marked unstable, and D14 defers it.

## Consequences

- `react-native-screens` is a native module, so the dev client is rebuilt (`LOCAL_MAESTRO_BUILD_APK=1`). A store build
  carries it. `expo-glass-effect` came with it, for the iOS 26 glass behind the bar and in the floating button.
- Each routed screen is now a route component. The screens keep their callback props. Route adapters in `stacks.tsx`
  and `tasks.tsx` translate params and navigator intents, so no screen knows it is routed.
- The rules of the old `RecipesScreen` stack moved with it:
    - the review REPLACES a spent paste.
    - a new recipe opens on the Recipes tab with the list under it.
    - a delete returns to the root of the tab.
- Under Vitest, React Navigation renders its web build through react-native-web. Four test changes support this:
    - the native config inlines `@react-navigation/*` and `react-native-screens`.
    - the shared safe-area stub exports `SafeAreaInsetsContext` and `initialWindowMetrics`.
    - the setup supplies a `ResizeObserver` that does nothing.
    - `tests/navigation/RootNavigator.native.test.tsx` pins that a sheet answers before our provider declines.
- React Navigation's own `hardwareBackPress` subscription exists only on a device, so jsdom cannot see the order
  between it and our provider. A device proves that order. On it, `recipes/systemBackGuard.yaml` shows the wizard's
  discard guard answering Android Back before the stack pops, and `shell/tabBar.yaml` shows Back from the Recipes
  root going Home.
- React Navigation CALLS `screenLayout` as a function inside its own render. So a hook in a layout function becomes a
  hook of the navigator, and the hook order breaks as screens push. Each `screenLayout` therefore renders a component.
  jsdom did not show this. A device did, as a React warning over the tab bar.
- The iOS edge swipe and the status-bar tap cannot run on the owner's Linux machine. They stay unverified until an iOS
  run (blueprint Q4).
- A reversal is a code change, but it touches the spine of the app: every screen became a route component.
