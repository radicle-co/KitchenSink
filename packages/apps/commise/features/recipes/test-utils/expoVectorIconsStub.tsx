/**
 * @module test-utils/expoVectorIconsStub — a jsdom stand-in for `@expo/vector-icons`, aliased in by
 * `vitest.native.config.ts` (mirrors `@commise/mobile`'s `tests/stubs/expoVectorIcons.tsx`, the same fix
 * applied at the app layer). The real module's internal EXTENSIONLESS ESM imports (e.g. `./createIconSet`,
 * required from `AntDesign.js`) do not reliably resolve under Vitest's Node-ESM dependency scan — a fresh
 * cold optimize of this package's OWN native suite (rather than one already warmed by another package's
 * test run) reproduces `Cannot find module '.../createIconSet' imported from '.../AntDesign.js'` even for a
 * bare `import { Feather } from '@expo/vector-icons'`. Icons are decorative in these tests (queried by role /
 * accessible name / text, never by glyph), so every family + factory resolves to a no-op component —
 * unblocking the native suite locally, matching how this package already stubs `expo-image`.
 */
import type { FC } from 'react';

/** A no-op icon: renders nothing, accepts any props (name/size/color/style). */
const IconStub: FC<Record<string, unknown>> = () => null;

/** Icon-set factories return the same no-op component. */
const createIconSetStub = (): FC<Record<string, unknown>> => IconStub;

export const AntDesign = IconStub;
export const Entypo = IconStub;
export const EvilIcons = IconStub;
export const Feather = IconStub;
export const Fontisto = IconStub;
export const FontAwesome = IconStub;
export const FontAwesome5 = IconStub;
export const FontAwesome6 = IconStub;
export const Foundation = IconStub;
export const Ionicons = IconStub;
export const MaterialCommunityIcons = IconStub;
export const MaterialIcons = IconStub;
export const Octicons = IconStub;
export const SimpleLineIcons = IconStub;
export const Zocial = IconStub;
export const createIconSet = createIconSetStub;
export const createMultiStyleIconSet = createIconSetStub;
export const createIconSetFromFontello = createIconSetStub;
export const createIconSetFromIcoMoon = createIconSetStub;

export default { AntDesign, Ionicons, MaterialIcons, Feather, MaterialCommunityIcons };
