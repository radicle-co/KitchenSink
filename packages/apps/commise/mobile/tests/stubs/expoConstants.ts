/**
 * Vitest stand-in for `expo-constants` (plan 012). The real module reads the embedded app manifest through a native
 * module jsdom cannot load. The stub's `expoConfig.extra` starts EMPTY — every social provider off, the state of a build
 * that was given no known Clerk instance — and a suite that needs providers assigns the `extra` `app.config.ts` would
 * have written, then resets it.
 */
const Constants: { expoConfig: { extra: Record<string, unknown> | undefined } } = { expoConfig: { extra: undefined } };

export default Constants;
