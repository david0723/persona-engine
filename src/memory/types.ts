export type MemoryKind =
  | "conversation_turn"
  | "conversation_summary"
  | "journal_entry"
  | "core_memory"
  | "relationship_note"

export interface Memory {
  id: string
  kind: MemoryKind
  content: string
  created_at: string
  session_id: string | null
  importance: number
  token_estimate: number
}
