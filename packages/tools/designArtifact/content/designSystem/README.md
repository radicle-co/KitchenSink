# Commise

A calm, cool kitchen interface. Mist-grey pages, storm-blue actions, clean sans headlines.

This is the design system for everything a person sees in KitchenSink. KitchenSink holds the Commise recipe and meal-planning apps on web (Next.js) and mobile (Expo). The backend services (identity, food, recipe) have no interface. The source of truth is the `@commise/ui` package. Values here were read from `src/tokens/` in PR 91.

## Content fundamentals

Write short, plain, kind sentences. Name the thing the cook is doing. Prefer "Save recipe" to "Submit". Errors say what happened and what to do next. Every string a person reads is localized, so copy lives in message keys and never in components.

## Visual foundations

- **Cool neutrals.** The page is `canvas` (mist grey). Cards are `paper`. Greys lean cool, toward the storm blue.
- **One call to action.** Each view has one filled `primary` button, in `action` (storm blue) with a white label. Steel blue is an accent, never a large fill.
- **Roles, not tones.** A screen names a role (`ink`, `action-text`, `danger-text`) and never a palette tone. A re-theme then moves one line.
- **Contrast is measured.** Dark fills take white labels. Light fills take charcoal. A tone that fails as text has a darker text sibling: `action-text`, `danger-text`, `attention`. `line-divider` is never text and never a control edge.
- **Type.** Manrope 600 for titles, Inter for everything else, JetBrains Mono for figures in code. Weight is chosen by face on native, so no `fontWeight` is set there.
- **Shape.** 4px spacing steps. Corners follow the `radius` tokens. Buttons are pills. A filter chip is shorter than a button, on `surface-muted` with no edge, so it never reads as a button.
- **Elevation.** Soft cool shadows. `glow` is the storm-blue focus halo.
- **Dark mode.** Same roles, new values, switched by the system colour scheme.
- **Layout.** Breakpoints at 600 and 840 px. Content widths: reading 640, list 768, detail 1152, page 1440. Gutters 16, 24, 32.

## Components

`components/bundle.js` holds the real components, compiled from source. It runs on React 18, which the preview frame and canvases supply.

- `window.Commise.<Name>` is the web leaf (`<Name>.tsx`), styled by `components/bundle.css`.
- `window.Commise.Native.<Name>` is the React Native leaf (`<Name>.native.tsx`), rendered in the browser through react-native-web as iOS. It follows `data-theme` for light and dark.

Each card shows both leaves side by side, so you can compare web and mobile. A card marked web only or native only says why. The set covers every `@commise/ui` component, the product components that screens are built from (recipe cards, the recipe hero, profile rows, editor parts) and the app chrome (sidebar, tab bars).

The native column is close to a device but not identical. Liquid Glass, haptics and keep-awake have no browser version, so they fall back to their solid or no-op forms.

## Fonts

The real font files ship in `fonts/`: Inter 400, 500 and 600 and Manrope 600, copied from `@expo-google-fonts`. No 700 face ships: 600 is the heaviest weight. Each file is also registered under its native face name (`Inter_400Regular`, `Manrope_600SemiBold`), because React Native names a face, not a family.

## Accessibility

WCAG 2.2 AA is the floor. Controls keep a 44 px hit area (48 dp on Android). Focus rings use `focus-ring`. A busy button stays focusable on web. Motion respects reduced-motion.
