/**
 * Holographic Member Panel - Phase 5
 * Real member data with team filtering, WebSocket online status
 * Priority: captain (gold), online (green), offline (red)
 */
import { useState } from 'react';

export interface HoloTeamMember {
  userId: string;
  username: string;
  realName?: string;
  role: string;
  online?: boolean;
  teamId?: string;
  teamName?: string;
}

interface HoloTeam {
  teamId: string;
  teamName: string;
  leader: string;
  memberCount: number;
}

interface HoloMemberPanelProps {
  members: HoloTeamMember[];
  teams?: HoloTeam[];
}

const ROLE_PRIORITY: Record<string, number> = {
  COMMANDER: 0, LEADER: 1, PILOT: 2, OPERATOR: 2, OBSERVER: 3,
};
const ROLE_LABELS: Record<string, string> = {
  COMMANDER: '指挥员', LEADER: '队长', PILOT: '飞手', OPERATOR: '操作员', OBSERVER: '观察员',
};

export function HoloMemberPanel({ members, teams = [] }: HoloMemberPanelProps) {
  const [filterTeam, setFilterTeam] = useState<string>('all');

  const filtered = filterTeam === 'all'
    ? members
    : members.filter(m => m.teamId === filterTeam);

  const sorted = [...filtered].sort((a, b) => {
    const roleA = ROLE_PRIORITY[a.role.toUpperCase()] ?? 99;
    const roleB = ROLE_PRIORITY[b.role.toUpperCase()] ?? 99;
    if (roleA !== roleB) return roleA - roleB;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.username.localeCompare(b.username);
  });

  const onlineCount = members.filter(m => m.online === true).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '11px', color: '#a0cfff' }}>
        <span>在线 <b style={{ color: '#00ff7f' }}>{onlineCount}</b> / {members.length}</span>
        {teams.length > 0 && (
          <select
            value={filterTeam}
            onChange={e => setFilterTeam(e.target.value)}
            style={{
              padding: '1px 4px', background: 'rgba(20, 40, 80, 0.8)',
              border: '1px solid rgba(60, 120, 220, 0.4)', borderRadius: '3px',
              color: '#c0d8ff', fontSize: '10px',
            }}
          >
            <option value="all">全部团队</option>
            {teams.map(t => <option key={t.teamId} value={t.teamId}>{t.teamName}</option>)}
          </select>
        )}
      </div>

      {/* Member list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', color: '#a0cfff', fontSize: '12px', padding: '12px 0' }}>暂无成员数据</div>
        )}
        {sorted.map(member => {
          const roleUpper = member.role.toUpperCase();
          const isCaptain = roleUpper === 'COMMANDER' || roleUpper === 'LEADER';
          const roleLabel = ROLE_LABELS[roleUpper] || member.role;
          const dotColor = isCaptain && member.online ? '#ffd700' : member.online ? '#00ff7f' : member.online === false ? '#ff4d4f' : '#64748b';
          const statusText = member.online === true
            ? (isCaptain ? '在线 · 指挥中' : '在线 · 作业中')
            : member.online === false ? '离线' : '未知';
          const statusColor = member.online === true ? '#00ff7f' : member.online === false ? '#ff4d4f' : '#64748b';

          return (
            <div key={member.userId} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', borderBottom: '1px solid rgba(82, 168, 255, 0.1)', fontSize: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '6px', height: '6px', borderRadius: '50%', background: dotColor,
                  boxShadow: `0 0 6px ${dotColor}`, flexShrink: 0,
                }} />
                <span style={{ color: '#c0d8ff' }}>
                  {member.realName || member.username}
                  {isCaptain && <span style={{ color: '#ffd700', fontSize: '10px', marginLeft: '4px' }}>({roleLabel})</span>}
                  {!isCaptain && <span style={{ color: '#a0cfff', fontSize: '10px', marginLeft: '4px' }}>({roleLabel})</span>}
                </span>
              </div>
              <div style={{ color: statusColor, fontSize: '11px', flexShrink: 0 }}>{statusText}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HoloMemberPanel;
