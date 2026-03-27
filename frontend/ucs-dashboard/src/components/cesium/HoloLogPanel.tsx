/**
 * Holographic Log Panel - Phase 4
 * Bottom-left scrolling log with auto-scroll animation matching prototype
 * CSS animation scrollLog for continuous upward scroll
 */
import { useEffect, useRef } from 'react';

export interface LogEntry {
  id: string | number;
  time: string;
  message?: string;
  detail?: string;
  result?: string;
  level?: 'info' | 'warn' | 'error' | 'success';
  operatorName?: string;
  operationType?: string;
}

interface HoloLogPanelProps {
  logs: LogEntry[];
  maxVisible?: number;
}

export function HoloLogPanel({ logs, maxVisible = 4 }: HoloLogPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll animation: move first item up, then move it to end
  useEffect(() => {
    const el = listRef.current;
    if (!el || logs.length <= maxVisible) return;

    const interval = setInterval(() => {
      el.style.transition = 'transform 0.5s ease';
      el.style.transform = 'translateY(-30px)';
      setTimeout(() => {
        el.style.transition = 'none';
        el.style.transform = 'translateY(0)';
        // Move first child to end (DOM rotation)
        const first = el.firstElementChild;
        if (first) {
          const clone = first.cloneNode(true);
          el.appendChild(clone);
          first.remove();
        }
      }, 500);
    }, 3500);

    return () => clearInterval(interval);
  }, [logs.length, maxVisible]);

  const displayLogs = logs.length > 0 ? logs : [
    { id: 'placeholder-1', time: '--:--:--', detail: '暂无日志', level: 'info' as const },
  ];

  return (
    <div style={{ overflow: 'hidden', maxHeight: maxVisible * 30 + 8 }}>
      <div ref={listRef}>
        {displayLogs.map((log) => (
          <div
            key={log.id}
            style={{
              fontSize: '12px',
              padding: '6px 0',
              borderBottom: '1px solid rgba(82, 168, 255, 0.1)',
              color: '#c0d8ff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#52a8ff', flexShrink: 0 }}>{log.time}</span>
              {log.operatorName && <span style={{ color: '#ffd700', fontSize: '10px', flexShrink: 0 }}>[{log.operatorName}]</span>}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.detail || log.message}</span>
              {log.result && (
                <span style={{
                  flexShrink: 0, padding: '0 3px', borderRadius: '2px', fontSize: '9px',
                  background: log.result === 'SUCCESS' ? 'rgba(0,255,127,0.15)' : 'rgba(255,77,79,0.15)',
                  color: log.result === 'SUCCESS' ? '#00ff7f' : log.result === 'FAILURE' || log.result === 'FAILED' ? '#ff4d4f' : '#a0cfff',
                }}>
                  {log.result === 'SUCCESS' ? '成功' : log.result === 'FAILURE' || log.result === 'FAILED' ? '失败' : log.result}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HoloLogPanel;
