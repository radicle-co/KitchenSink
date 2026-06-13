// `.sql` files are imported as raw text via esbuild's `text` loader (see esbuild.mjs) so migration
// SQL ships inlined in the self-contained Lambda bundle. This ambient declaration lets tsc type the
// imports as strings.
declare module '*.sql' {
    const content: string;
    export default content;
}
