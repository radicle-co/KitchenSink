/**
 * @module @commise/ui/scroll-host — the `@commise/ui/scroll-host` package export: the design-system `ScrollHost`,
 * resolved to its web or native leaf at bundle time, the hook its screen's chrome reads it with, and the one
 * section algorithm.
 */
export { ScrollHost } from './ScrollHost.js';
export { useScrollHost } from './scrollHostContext.js';
export { currentSectionOf } from './currentSection.js';
export type { SectionTop } from './currentSection.js';
export type { LayoutReport, ScrollBind, ScrollHostApi, ScrollHostProps, ScrollReport, ScrollTarget } from './props.js';
