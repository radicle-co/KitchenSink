/**
 * @module tamagui/tamaguiTokens — the design scale as Tamagui tokens. Pure, and free of any Tamagui import, so it is
 * tested in Node; `tamaguiConfig.native.ts` hands it to `createTokens`.
 *
 * There is deliberately no `color` group. A colour on native is a theme role (`$paper`, `$ink`), which follows the
 * system scheme; a palette swatch as a token would be a second colour vocabulary that ignores dark mode. With the
 * config's strict `allowedStyleValues`, a colour that is not a theme key does not compile.
 *
 * The zero radius step is `0`, not `none`: Tamagui reserves CSS-wide keywords as token names.
 *
 * The stacking group holds only `0`. Native code uses two other values today, and the slice that ports each one names
 * its step on the design scale; a number invented here would carry no meaning.
 *
 * @pattern Adapter — the `scale.ts` registry projected into Tamagui's token shape
 */
import { radius, spacing } from '../tokens/scale.js';

export const tamaguiTokens = {
    space: { ...spacing },
    size: { ...spacing },
    radius: { 0: 0, ...radius },
    zIndex: { 0: 0 },
} as const;
