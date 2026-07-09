import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth as useIdpAuth } from '@clerk/expo';
import type { UserProfile, UserUpdateInput } from '@kitchensink/identity-service';
import { deleteUserMe, getUserMe, patchUserMe } from '../services/api';

const PROFILE_KEY = ['user', 'me'] as const;

export function useUserProfile() {
    const { getToken, isSignedIn } = useIdpAuth();

    // Force a fresh session token for the profile fetch. Clerk session tokens live ~60s; a query
    // that refetches when the app returns from the background can otherwise send an expired cached
    // token and 401. skipCache mints a current one. (The web server component gets a fresh token
    // per request via auth().getToken(), so this guard is mobile-specific.)
    return useQuery({
        queryKey: PROFILE_KEY,
        queryFn: () => getUserMe(() => getToken({ skipCache: true })) as Promise<UserProfile>,
        enabled: Boolean(isSignedIn),
        staleTime: 2 * 60 * 1000,
    });
}

export function useUpdateProfile() {
    const { getToken } = useIdpAuth();
    const qc = useQueryClient();

    return useMutation({
        mutationFn: (body: UserUpdateInput) => patchUserMe(getToken, body),
        onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
    });
}

export function useDeleteAccount() {
    const { getToken, signOut } = useIdpAuth();

    return useMutation({
        mutationFn: async () => {
            await deleteUserMe(getToken);
            await signOut();
        },
    });
}
