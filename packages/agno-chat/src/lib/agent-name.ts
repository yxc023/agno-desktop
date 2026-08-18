/**
 * Resolve a human-readable display name for an AGNO run.
 *
 * Priority chain (first non-empty wins):
 *   1. extra_data.agent_name (most specific — set by AGNO Team / WorkspaceContextProvider)
 *   2. extra_data.team_name   (team-level fallback)
 *   3. agent_name             (top-level AGNO agent name)
 *   4. team_name              (top-level AGNO team name)
 *   5. member_name            (Team mode per-member override)
 *   6. agent_id               (always present, less pretty)
 *   7. team_id                (always present on team runs, less pretty)
 *
 * Used by both the live ChatRunner (when a new sub is created) and the
 * history loaders in chat-store (runToChatMessages, buildSubFromChildRun,
 * outerAgentName derivation). Keeping one helper here ensures the same
 * precedence everywhere.
 */
export function displayNameForRun(
  run: {
    agent_name?: string;
    team_name?: string;
    member_name?: string;
    agent_id?: string | null;
    team_id?: string | null;
    extra_data?: Record<string, unknown>;
  } | null | undefined
): string | undefined {
  if (!run) return undefined;
  const extraAgent = run.extra_data?.agent_name;
  if (typeof extraAgent === "string" && extraAgent.trim()) return extraAgent;
  const extraTeam = run.extra_data?.team_name;
  if (typeof extraTeam === "string" && extraTeam.trim()) return extraTeam;
  if (typeof run.agent_name === "string" && run.agent_name.trim()) return run.agent_name;
  if (typeof run.team_name === "string" && run.team_name.trim()) return run.team_name;
  if (typeof run.member_name === "string" && run.member_name.trim())
    return run.member_name;
  if (run.agent_id) return String(run.agent_id);
  if (run.team_id) return String(run.team_id);
  return undefined;
}
