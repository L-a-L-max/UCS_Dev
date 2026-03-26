/**
 * Holographic Member Panel
 * Right side - shows member online status
 * Priority: leaders first, online first, offline last
 */

interface TeamMember {
  userId: string;
  username: string;
  realName?: string;
  role: string;
  online?: boolean;
}

interface HoloMemberPanelProps {
  members: TeamMember[];
}

const ROLE_PRIORITY: Record<string, number> = {
  COMMANDER: 0,
  LEADER: 1,
  PILOT: 2,
  OPERATOR: 2,
  OBSERVER: 3,
};

const ROLE_LABELS: Record<string, string> = {
  COMMANDER: '指挥员',
  LEADER: '队长',
  PILOT: '飞手',
  OPERATOR: '操作员',
  OBSERVER: '观察员',
};

const ROLE_COLORS: Record<string, string> = {
  COMMANDER: '#f59e0b',
  LEADER: '#00e5ff',
  PILOT: '#22c55e',
  OPERATOR: '#22c55e',
  OBSERVER: '#64748b',
};

export function HoloMemberPanel({ members }: HoloMemberPanelProps) {
  // Sort: leaders first, online first, offline last
  const sorted = [...members].sort((a, b) => {
    const roleA = ROLE_PRIORITY[a.role.toUpperCase()] ?? 99;
    const roleB = ROLE_PRIORITY[b.role.toUpperCase()] ?? 99;
    if (roleA !== roleB) return roleA - roleB;
    // Online first
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.username.localeCompare(b.username);
  });

  const onlineCount = members.filter(m => m.online).length;

  return (
    <div className="p-2">
      {/* Summary */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[10px] text-slate-400">
          在线 <span className="text-cyan-400 font-bold">{onlineCount}</span> / {members.length}
        </span>
      </div>

      {/* Member list */}
      <div className="space-y-1 max-h-[300px] overflow-y-auto scrollbar-thin">
        {sorted.length === 0 && (
          <div className="text-center text-slate-500 text-[10px] py-3 font-mono">
            暂无成员数据
          </div>
        )}
        {sorted.map((member) => {
          const roleUpper = member.role.toUpperCase();
          const roleColor = ROLE_COLORS[roleUpper] || '#64748b';
          const roleLabel = ROLE_LABELS[roleUpper] || member.role;

          return (
            <div
              key={member.userId}
              className="flex items-center gap-2 px-2 py-1.5 rounded transition-colors"
              style={{
                background: member.online ? 'rgba(0, 229, 255, 0.04)' : 'rgba(30, 41, 59, 0.3)',
              }}
            >
              {/* Online indicator */}
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: member.online ? '#22c55e' : '#475569',
                  boxShadow: member.online ? '0 0 6px rgba(34, 197, 94, 0.5)' : 'none',
                }}
              />

              {/* Name */}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-slate-200 truncate">
                  {member.realName || member.username}
                </div>
              </div>

              {/* Role badge */}
              <span
                className="text-[8px] px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                style={{
                  color: roleColor,
                  background: `${roleColor}15`,
                  border: `1px solid ${roleColor}30`,
                }}
              >
                {roleLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HoloMemberPanel;
