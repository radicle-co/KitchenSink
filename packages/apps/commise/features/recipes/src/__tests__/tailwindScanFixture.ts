/**
 * A class spelled only here, in a test tree. `web/tests/__integration__/tailwindTheme.integration.test.ts` finds it by
 * scanning and asserts the web build emits no rule for it, which holds only while `globals.css` keeps its
 * `@source not` line for `__tests__`. It is read by that scan, never imported.
 */
export const TEST_ONLY_CLASS = 'w-[7.3125rem]';
