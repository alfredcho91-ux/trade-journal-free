export const strategyQueryKeys = {
  all: ['strategies'] as const,
  lists: () => ['strategies', 'list'] as const,
  list: (includeArchived: boolean) => ['strategies', 'list', { includeArchived }] as const,
  details: () => ['strategies', 'detail'] as const,
  detail: (strategyId: number) => ['strategies', 'detail', strategyId] as const,
  versions: (strategyId: number) => ['strategies', 'detail', strategyId, 'versions'] as const,
  version: (strategyId: number, versionId: number) => ['strategies', 'detail', strategyId, 'versions', versionId] as const,
};
