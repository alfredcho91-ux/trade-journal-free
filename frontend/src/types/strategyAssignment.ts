export interface JournalStrategyAssignment {
  journal_entry_id: number;
  strategy_version_id: number;
  strategy_id: number;
  strategy_name: string;
  strategy_archived_at: string | null;
  version_sequence: number;
  version_label: string;
  version_description: string | null;
  version_is_active: boolean;
  version_retired_at: string | null;
  assigned_at: string;
  updated_at: string;
}
