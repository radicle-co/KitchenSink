/** The one function of `shell-quote` this package uses; the package ships no types. */
declare module 'shell-quote' {
    export function quote(args: readonly string[]): string;
}
