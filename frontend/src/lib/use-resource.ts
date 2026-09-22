"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface CrudApi<TRead, TWrite> {
  list: (params?: Record<string, unknown>) => Promise<TRead[]>;
  create: (payload: TWrite) => Promise<TRead>;
  update: (id: string | number, payload: TWrite) => Promise<TRead>;
  remove: (id: string | number) => Promise<void>;
}

/** Wraps a resource<T> api object with react-query list/create/update/delete hooks sharing one cache key. */
export function useCrudResource<TRead, TWrite = Partial<TRead>>(
  queryKey: string,
  api: CrudApi<TRead, TWrite>,
  listParams?: Record<string, unknown>
) {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: [queryKey, listParams],
    queryFn: () => api.list(listParams),
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: [queryKey] });
  }

  const createMutation = useMutation({
    mutationFn: (payload: TWrite) => api.create(payload),
    onSuccess: () => invalidate(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string | number; payload: TWrite }) => api.update(id, payload),
    onSuccess: () => invalidate(),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string | number) => api.remove(id),
    onSuccess: () => invalidate(),
  });

  return { listQuery, createMutation, updateMutation, removeMutation };
}
