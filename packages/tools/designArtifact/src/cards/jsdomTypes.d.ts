/**
 * The slice of jsdom the card tests use. `@types/jsdom` is not installed in this workspace; this declares only the
 * constructor, the `beforeParse` hook and `window`, so a test that reaches for more fails to compile.
 */
declare module 'jsdom' {
    export type JsdomWindow = Window & typeof globalThis;

    export interface JSDOMOptions {
        readonly url?: string;
        readonly runScripts?: 'dangerously' | 'outside-only';
        readonly beforeParse?: (window: JsdomWindow) => void;
    }

    export class JSDOM {
        constructor(html?: string, options?: JSDOMOptions);
        readonly window: JsdomWindow;
    }
}
