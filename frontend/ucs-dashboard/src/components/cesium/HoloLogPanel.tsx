/**
 * Holographic Log Panel
 * Bottom-left scrolling log display, max 4 visible items
 * New items push older ones up (auto-scroll)
 */
import { useEffect, useRef } from 'react';

export interface LogEntry {
  id: string | number;
  time: string;
  detail: string;
  result?: string;
  level?: 'info' | 'warn' | 'error' | 'success';
}

interface HoloLogPanelProps {
  logs: LogEntry[];
  maxVisible?: number;
}

export function HoloLogPanel({ logs, maxVisible = 4 }: HoloLogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  const visibleLogs = logs.slice(-maxVisible * 2); // Keep some buffer for smooth scroll

  const getLevelColor = (level?: string, result?: string) => {
    if (result === 'FAILURE' || result === 'FAILED' || level === 'error') return '#ef4444';
    if (result === 'SUCCESS' || level === 'success') return '#22c55e';
    if (level === 'warn') return '#f59e0b';
    return '#00e5ff';
  };

  const getLevelDot = (level?: string, result?: string) => {
    const color = getLevelColor(level, result);
    return (
      <span
        className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1"
        style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
      />
    );
  };

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto scrollbar-thin"
      style={{ maxHeight: maxVisible * 44 + 16 }}
    >
      <div className="p-2 space-y-1">
        {visibleLogs.length === 0 && (
          <div className="text-center text-slate-500 text-[10px] py-3 font-mono">
            暂无日志
          </div>
        )}
        {visibleLogs.map((log) => (
          <div
            key={log.id}
            className="flex items-start gap-2 px-2 py-1.5 rounded"
            style={{
              background: 'rgba(0, 229, 255, 0.03)',
              borderLeft: `2px solid ${getLevelColor(log.level, log.result)}30`,
            }}
          >
            {getLevelDot(log.level, log.result)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 font-mono flex-shrink-0">{log.time}</span>
                {log.result && (
                  <span
                    className="text-[8px] px-1 rounded font-mono"
                    style={{
                      color: getLevelColor(log.level, log.result),
                      background: `${getLevelColor(log.level, log.result)}15`,
                    }}
                  >
                    {log.result === 'SUCCESS' ? '成功' : log.result === 'FAILURE' || log.result === 'FAILED' ? '失败' : log.result}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-300 truncate">{log.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HoloLogPanel;
