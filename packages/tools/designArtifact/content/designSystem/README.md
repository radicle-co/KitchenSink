# Commise

A warm, calm kitchen interface. Sand pages, teal actions, serif headlines.

This is the design system for everything a person sees in KitchenSink. KitchenSink holds the Commise recipe and meal-planning apps on web (Next.js) and mobile (Expo). The backend services (identity, food, recipe) have no interface. The source of truth is the `@commise/ui` package. Values here were read from `src/tokens/` in PR 91.

## Content fundamentals

Write short, plain, kind sentences. Name the thing the cook is doing. Prefer "Save recipe" to "Submit". Errors say what happened and what to do next. Every string a person reads is localized, so copy lives in message keys and never in components.

## Visual foundations

- **Warm neutrals.** The page is `canvas` (sand). Cards are `paper`. Greys lean warm, never blue.
- **One call to action.** Each view has one filled `primary` button, in `action` (seafoam) with a white label.
- **Roles, not tones.** A screen names a role (`ink`, `action-text`, `danger-text`) and never a palette tone. A re-theme then moves one line.
- **Contrast is measured.** Dark fills take white labels. Light fills take charcoal. A tone that fails as text has a darker text sibling: `action-text`, `danger-text`, `attention`. `line-divider` is never text and never a control edge.
- **Type.** Playfair Display for titles, Inter for everything else, JetBrains Mono for figures in code. Weight is chosen by face on native, so no `fontWeight` is set there.
- **Shape.** 4px spacing steps. Radii 6, 12, 20, 28. Only pressable controls are pills.
- **Elevation.** Soft warm shadows. `glow` is the seafoam halo for the FAB.
- **Dark mode.** Same roles, new values, switched by the system colour scheme.
- **Layout.** Breakpoints at 600 and 840 px. Content widths: reading 640, list 768, detail 1152, page 1440. Gutters 16, 24, 32.

## Components

`components/bundle.js` holds the real components, compiled from source. It runs on React 18, which the preview frame and canvases supply.

- `window.Commise.<Name>` is the web leaf (`<Name>.tsx`), styled by `components/bundle.css`.
- `window.Commise.Native.<Name>` is the React Native leaf (`<Name>.native.tsx`), rendered in the browser through react-native-web as iOS. It follows `data-theme` for light and dark.

Each card shows both leaves side by side, so you can compare web and mobile. A card marked web only or native only says why. The set covers every `@commise/ui` component, the product components that screens are built from (recipe cards, the recipe hero, profile rows, editor parts) and the app chrome (sidebar, tab bars).

The native column is close to a device but not identical. Liquid Glass, haptics and keep-awake have no browser version, so they fall back to their solid or no-op forms.

## Fonts

The real font files ship in `fonts/`: Inter 400 to 700 and Playfair Display 600 and 700, copied from `@expo-google-fonts`. Each file is also registered under its native face name (`Inter_400Regular`, `PlayfairDisplay_700Bold`), because React Native names a face, not a family.

## Accessibility

WCAG 2.2 AA is the floor. Controls keep a 44 px hit area (48 dp on Android). Focus rings use `focus-ring`. A busy button stays focusable on web. Motion respects reduced-motion.
