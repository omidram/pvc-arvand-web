"use client";

import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "@/lib/endpoints";

/** Cell-health score stays hidden until Settings turns it on. */
export function useShowCellHealth() {
  const query = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get, staleTime: 15_000 });
  return query.data?.show_cell_health === true;
}
