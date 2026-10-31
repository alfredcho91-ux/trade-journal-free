export const discoveryQueryKeys = {
  metadata: ['strategy-discovery', 'metadata'] as const,
  runs: ['strategy-discovery', 'runs'] as const,
  list: (offset: number) => ['strategy-discovery', 'runs', 'list', offset] as const,
  run: (id: number | null) => ['strategy-discovery', 'runs', 'detail', id] as const,
  candidate: (id: number | null) => ['strategy-discovery', 'candidate', id] as const,
  evidence: (id: number, offset: number) => ['strategy-discovery', 'candidate', id, 'evidence', offset] as const,
};
