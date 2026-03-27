/**
 * Holographic Member Panel - Phase 4
 * Right side: member online status list
 * Priority: captain (gold dot), online (green), offline (red)
 * Matches HTML prototype member-item style
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

export function HoloMemberPanel({ members }: HoloMemberPanelProps) {
  // Sort: leaders/captains first, online first, offline last
  const sorted = [...members].sort((a, b) => {
    const roleA = ROLE_PRIORITY[a.role.toUpperCase()] ?? 99;
    const roleB = ROLE_PRIORITY[b.role.toUpperCase()] ?? 99;
    if (roleA !== roleB) return roleA - roleB;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.username.localeCompare(b.username);
  });

  return (
    <div style={{ overflowY: 'auto', maxHeight: '100%' }}>
      {sorted.length === 0 && (
        <div style={{ textAlign: 'center', color: '#a0cfff', fontSize: '12px', padding: '12px 0' }}>
          暂无成员数据
        </div>
      )}
      {sorted.map((member) => {
        const roleUpper = member.role.toUpperCase();
        const isCaptain = roleUpper === 'COMMANDER' || roleUpper === 'LEADER';
        const roleLabel = ROLE_LABELS[roleUpper] || member.role;

        // Dot color: captain=gold, online=green, offline=red
        const dotClass = isCaptain && member.online ? 'captain' : member.online ? 'online' : 'offline';
        const dotColor = dotClass === 'captain' ? '#ffd700' : dotClass === 'online' ? '#00ff7f' : '#ff4d4f';

        // Status text
        const statusText = member.online
          ? isCaptain ? '在线 · 指挥中' : '在线 · 作业中'
          : '离线';
        const statusColor = member.online ? '#00ff7f' : '#ff4d4f';

        return (
          <div
            key={member.userId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0',
              borderBottom: '1px solid rgba(82, 168, 255, 0.1)',
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: dotColor,
                  boxShadow: `0 0 6px ${dotColor}`,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: '#c0d8ff' }}>
                {member.realName || member.username}
                {isCaptain && <span style={{ color: '#a0cfff', fontSize: '10px', marginLeft: '4px' }}>({roleLabel})</span>}
              </span>
            </div>
            <div style={{ color: statusColor, fontSize: '12px' }}>{statusText}</div>
          </div>
        );
      })}
    </div>
  );
}

export default HoloMemberPanel;
