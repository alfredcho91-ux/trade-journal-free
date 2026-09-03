export const strategyAssignmentQueryKeys = {
  all: ['journal-strategy-assignments'] as const,
  details: () => ['journal-strategy-assignments', 'detail'] as const,
  detail: (journalEntryId: number) => ['journal-strategy-assignments', 'detail', journalEntryId] as const,
};
