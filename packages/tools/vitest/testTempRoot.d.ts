/** Vitest `globalSetup`: confines test-created temp directories to one removable, gitignored root. */
export default function setup(): () => void;
/** Where this run's temp directories live. */
export declare const testTempRoot: () => string;
