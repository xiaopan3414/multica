import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const vcsKeys = {
  all: (wsId: string) => ["vcs", wsId] as const,
  connections: (wsId: string) => [...vcsKeys.all(wsId), "connections"] as const,
  deliveries: (wsId: string, connectionId: string) =>
    [...vcsKeys.all(wsId), "connections", connectionId, "deliveries"] as const,
};

export const vcsConnectionsOptions = (wsId: string) =>
  queryOptions({
    queryKey: vcsKeys.connections(wsId),
    queryFn: () => api.listVCSConnections(wsId),
    enabled: !!wsId,
  });

export const vcsWebhookDeliveriesOptions = (wsId: string, connectionId: string) =>
  queryOptions({
    queryKey: vcsKeys.deliveries(wsId, connectionId),
    queryFn: () => api.listVCSWebhookDeliveries(wsId, connectionId),
    enabled: !!wsId && !!connectionId,
    refetchInterval: 5_000,
  });
