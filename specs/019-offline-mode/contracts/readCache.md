# Contract: The read-cache storage adapter

Owner: `@commise/query`, a new module beside `queryClient.ts`. Pattern: Adapter, with zod at the boundary.

## Interface

```ts
interface ReadCacheStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    /** Every key under a prefix, for the per-cook wipe. */
    keys(prefix: string): Promise<readonly string[]>;
}
```

- Mobile implements it over AsyncStorage (`getAllKeys` for `keys`).
- Web implements it over IndexedDB with `idb-keyval` (`keys` lists the store's keys and filters by prefix).

## Persister settings

- `prefix`: `query.v1.{subject}.`
- `buster`: `READ_CACHE_VERSION`
- `maxAge`: the offline admission limit (research R6)
- `filters`: the allowlist in data-model.md
- `deserialize`: parse with the schema package's zod, and drop the entry on failure

## Guarantees

- A wipe removes every key under the cook's prefix and nothing else.
- A failed read or parse never throws into a query. It reads as a cache miss.
- No entry for one cook is readable under another cook's prefix.
