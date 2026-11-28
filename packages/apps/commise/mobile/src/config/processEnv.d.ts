/**
 * The `EXPO_PUBLIC_*` variables `env.ts` reads, typed by name. `expo-modules-core` declares `NodeJS.ProcessEnv` with
 * `[key: string]: any`, so an undeclared name reads as `any` and slips past the type checker. A named optional property
 * wins over that index signature: each one reads as `string | undefined`, which is what a build inlines or leaves out.
 */
declare namespace NodeJS {
    interface ProcessEnv {
        EXPO_PUBLIC_RECIPE_API_URL?: string;
        EXPO_PUBLIC_IDENTITY_API_URL?: string;
        EXPO_PUBLIC_FOOD_API_URL?: string;
        EXPO_PUBLIC_SUPPORT_URL?: string;
        EXPO_PUBLIC_IDP_PUBLISHABLE_KEY?: string;
    }
}
