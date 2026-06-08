---
name: Generated hook query options
description: How to pass enabled/staleTime to orval-generated useXxx query hooks without TS errors
---

When calling orval-generated hooks like `useGetEquipoHistory`, passing `{ query: { enabled, staleTime } }` fails TypeScript because the inner `UseQueryOptions` type requires `queryKey`.

**Rule:** Instead of passing a `query` sub-object, rely on the built-in guard:
- The generated `getGetEquipoHistoryQueryOptions` already sets `enabled: !!(equipoId)`
- Pass `equipoId = 0` when you don't want fetching — the hook won't fire for 0

```tsx
// ✅ correct
const { data = [] } = useGetEquipoHistory(item?.id ?? 0);
const results = item ? data : [];

// ❌ TS error: queryKey missing in type
const { data = [] } = useGetEquipoHistory(id, { query: { enabled: !!item } });
```

**Why:** `UseQueryOptions<T>` in React Query v5 has `queryKey` as a required field. Orval does not Omit/Partial it in the options type even though getXxxQueryOptions internally provides a default queryKey.
