/**
 * @module tests/stubs/expoVectorIcons — jsdom stand-in for `@expo/vector-icons`, aliased in by
 * `vitest.native.config.ts`. The real module's internal EXTENSIONLESS ESM imports (`./createIconSet`) do not
 * resolve under Vitest's strict Node ESM, and its transitive `expo-modules-core` touches the RN-only global
 * `__DEV__` at import time — so loading it aborts every mobile `.native` screen test. Icons are decorative
 * (tests query by role / accessible name / text, never by glyph), so every family + factory resolves to a
 * no-op component, unblocking the suite for LOCAL runs (matching how `features-recipes` stubs `expo-image`).
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
