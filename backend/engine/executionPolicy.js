export const DEFAULT_RULES = { text: 'Keep execution inside the assigned worktree. Preserve recoverable evidence. Human decisions must be traceable.', blockedCommands: ['git push --force', 'git reset --hard origin', 'rm -rf /', 'curl | sh', 'wget | sh'] };
export function policyViolation(command, args, policy = DEFAULT_RULES, tier = 'supervised', approved = false) {
  const text = [command || '', ...(args || [])].join(' ').replace(/\s+/g, ' ').toLowerCase();
  for (const pattern of policy.blockedCommands || []) if (text.includes(pattern.toLowerCase().replace(/\s+/g, ' ').trim())) return `Blocked by engineering rule: ${pattern}`;
  if (tier === 'strict' && !approved) return 'Strict execution requires a recorded human approval';
  if (tier === 'supervised' && /\bgit\s+(push|reset\s+--hard)\b|\brm\s+-rf\b/.test(text)) return 'Supervised execution blocks destructive or publishing commands';
  return null;
}
