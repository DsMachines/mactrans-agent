import React, { useEffect, useRef, useState } from 'react';
import { getToolMeta } from '../data/toolMeta';
import { renderNarrationHtml } from '../lib/markdownToHtml';

// Walks raw terminalLines and merges an adjacent tool_call + matching tool_response
// (same name, immediately following — true for every real event source: api/agent.js
// and api/negotiate.js always emit tool_call then execute then tool_response inline
// before any other tool call can start, and fallbackPayload.js mirrors that ordering)
// into one renderable tool_step. A trailing unmatched tool_call (response hasn't
// streamed in yet) becomes a pending step with a spinner.
function groupTerminalLines(lines) {
  const grouped = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'tool_call') {
      const next = lines[i + 1];
      if (next && next.type === 'tool_response' && next.name === line.name) {
        grouped.push({ type: 'tool_step', name: line.name, args: line.args, result: next.result, pending: false, key: i });
        i += 2;
        continue;
      }
      grouped.push({ type: 'tool_step', name: line.name, args: line.args, result: null, pending: true, key: i });
      i += 1;
      continue;
    }
    if (line.type === 'tool_response') {
      // Orphaned response — shouldn't normally happen, but render standalone rather than drop it.
      grouped.push({ type: 'tool_step', name: line.name, args: null, result: line.result, pending: false, key: i });
      i += 1;
      continue;
    }
    grouped.push({ ...line, key: i });
    i += 1;
  }
  return grouped;
}

function TimelineRow({ icon, accent, children }) {
  return (
    <div style={styles.stepRow}>
      <div style={{ ...styles.iconBubble, ...(accent ? styles.iconBubbleAccent[accent] : {}) }}>{icon}</div>
      <div style={styles.rowBody}>{children}</div>
    </div>
  );
}

function ToolStepCard({ step, stepNumber }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getToolMeta(step.name);
  const inText = step.args ? meta.summarizeIn(step.args) : null;
  const outText = !step.pending && step.result ? meta.summarizeOut(step.result) : null;
  const hasRaw = !step.pending && (step.args || step.result);

  return (
    <TimelineRow icon={step.pending ? '⏳' : meta.icon} accent={meta.isDecision ? 'decision' : step.pending ? 'pending' : null}>
      <div style={{ ...styles.card, ...(meta.isDecision ? styles.cardDecision : {}) }}>
        <div style={styles.cardHeader}>
          <span style={styles.cardLabel}>{meta.label}</span>
          {meta.isDecision && <span style={styles.decisionBadge}>DECISION</span>}
          <span style={styles.stepNumber}>STEP {stepNumber}</span>
        </div>
        {inText && (
          <div style={styles.detailLine}>
            <span style={styles.detailTag}>IN</span>
            <span style={styles.detailText}>{inText}</span>
          </div>
        )}
        {step.pending ? (
          <div style={styles.detailLine}>
            <span style={styles.detailTag}>OUT</span>
            <span style={{ ...styles.detailText, opacity: 0.55 }}>Waiting on result...</span>
          </div>
        ) : (
          outText && (
            <div style={styles.detailLine}>
              <span style={styles.detailTag}>OUT</span>
              <span style={styles.detailText}>{outText}</span>
            </div>
          )
        )}
        {hasRaw && (
          <>
            <button type="button" style={styles.rawToggle} onClick={() => setExpanded((v) => !v)}>
              {expanded ? '▾ hide raw JSON' : '▸ view raw JSON'}
            </button>
            {expanded && <pre style={styles.rawJson}>{JSON.stringify({ args: step.args, result: step.result }, null, 2)}</pre>}
          </>
        )}
      </div>
    </TimelineRow>
  );
}

function ThinkingRow({ content }) {
  return (
    <TimelineRow icon="🧠">
      <div style={styles.thinkingText} dangerouslySetInnerHTML={{ __html: renderNarrationHtml(content) }} />
    </TimelineRow>
  );
}

function MilestoneRow({ icon, accent, title, detail }) {
  return (
    <TimelineRow icon={icon} accent={accent}>
      <div style={{ ...styles.card, ...(accent ? styles.cardDecision : {}) }}>
        <div style={styles.milestoneTitle}>{title}</div>
        {detail && <div style={styles.milestoneDetail}>{detail}</div>}
      </div>
    </TimelineRow>
  );
}

function renderGroupedLine(line, stepNumberRef) {
  switch (line.type) {
    case 'separator':
      return (
        <div key={line.key} style={styles.separator}>
          {line.content}
        </div>
      );
    case 'thinking':
      return <ThinkingRow key={line.key} content={line.content} />;
    case 'tool_step': {
      stepNumberRef.count += 1;
      return <ToolStepCard key={line.key} step={line} stepNumber={stepNumberRef.count} />;
    }
    case 'email_draft':
      return (
        <MilestoneRow
          key={line.key}
          icon="📧"
          title="Email drafted"
          detail={`Subject: ${line.subject || ''}\nSent to: ${line.to_name || line.to || ''}`}
        />
      );
    case 'whatsapp_msg':
      return <MilestoneRow key={line.key} icon="💬" title="WhatsApp approval request drafted" detail={line.content} />;
    case 'negotiation_result':
      return (
        <MilestoneRow
          key={line.key}
          icon="⚖️"
          accent="decision"
          title={`Negotiation decision: ${(line.decision || '').toUpperCase()}`}
          detail={line.reasoning}
        />
      );
    case 'done':
      return <MilestoneRow key={line.key} icon="✅" accent="success" title="Mission complete" detail="ARIA operations finished executing successfully." />;
    case 'error':
      return <MilestoneRow key={line.key} icon="🚨" accent="error" title="Error" detail={line.message || 'An unexpected error occurred.'} />;
    default:
      return null;
  }
}

export default function AgentTerminal({ terminalLines = [], isStreaming }) {
  const terminalEndRef = useRef(null);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLines, isStreaming]);

  const grouped = groupTerminalLines(terminalLines);
  const stepNumberRef = { count: 0 };

  return (
    <div className="glass-panel" style={styles.container}>
      <div style={styles.header}>
        <div style={styles.dots}>
          <span style={{ ...styles.dot, backgroundColor: '#ff5f57' }}></span>
          <span style={{ ...styles.dot, backgroundColor: '#febc2e' }}></span>
          <span style={{ ...styles.dot, backgroundColor: '#28c840' }}></span>
        </div>
        <div style={styles.headerTitle}>ARIA COGNITIVE ENGINE — LIVE</div>
        <div style={styles.placeholderDot}></div>
      </div>

      <div style={styles.body}>
        {grouped.length === 0 ? (
          <div style={styles.welcomeText}>
            System idle. Click &quot;DEPLOY AGENTIC BROKER&quot; to initiate cognitive reasoning loop...
          </div>
        ) : (
          <div style={styles.timeline}>
            <div style={styles.timelineRail}></div>
            {grouped.map((line) => renderGroupedLine(line, stepNumberRef))}
          </div>
        )}

        {isStreaming && (
          <div style={styles.activeLine}>
            <span className="cursor-blinking"></span>
          </div>
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: 'var(--terminal-bg)',
    border: '1px solid rgba(0, 212, 255, 0.15)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  dots: {
    display: 'flex',
    gap: '6px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  headerTitle: {
    fontSize: '11px',
    fontFamily: 'var(--font-terminal)',
    color: '#718096',
    letterSpacing: '1px',
    textTransform: 'uppercase',
  },
  placeholderDot: {
    width: '38px',
  },
  body: {
    flexGrow: 1,
    padding: '16px',
    fontFamily: 'var(--font-terminal)',
    fontSize: '12px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  welcomeText: {
    color: 'rgba(200, 240, 255, 0.3)',
    fontStyle: 'italic',
    padding: '20px 0',
    textAlign: 'center',
  },

  // Timeline scaffold
  timeline: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  timelineRail: {
    position: 'absolute',
    left: '17px',
    top: '18px',
    bottom: '18px',
    width: '2px',
    background: 'linear-gradient(180deg, rgba(0, 212, 255, 0.35), rgba(0, 212, 255, 0.08))',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
  },
  iconBubble: {
    flexShrink: 0,
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '15px',
    backgroundColor: 'var(--terminal-bg)',
    border: '1px solid rgba(0, 212, 255, 0.25)',
    boxShadow: '0 0 0 4px var(--terminal-bg)',
  },
  iconBubbleAccent: {
    decision: { border: '1px solid var(--accent-amber)', boxShadow: '0 0 0 4px var(--terminal-bg), 0 0 10px rgba(255, 184, 0, 0.35)' },
    pending: { border: '1px solid var(--accent-cyan)' },
    success: { border: '1px solid var(--accent-green)', boxShadow: '0 0 0 4px var(--terminal-bg), 0 0 10px rgba(0, 255, 157, 0.35)' },
    error: { border: '1px solid #ff5f57', boxShadow: '0 0 0 4px var(--terminal-bg), 0 0 10px rgba(255, 95, 87, 0.35)' },
  },
  rowBody: {
    flexGrow: 1,
    minWidth: 0,
    paddingTop: '4px',
  },

  // Tool step / milestone card
  card: {
    backgroundColor: 'var(--panel-surface)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '8px',
    padding: '10px 12px',
  },
  cardDecision: {
    backgroundColor: 'rgba(255, 184, 0, 0.06)',
    border: '1px solid rgba(255, 184, 0, 0.3)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  cardLabel: {
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
    fontWeight: '600',
    color: '#e8f4ff',
  },
  decisionBadge: {
    fontSize: '9px',
    fontWeight: '700',
    letterSpacing: '0.5px',
    color: 'var(--accent-amber)',
    border: '1px solid rgba(255, 184, 0, 0.4)',
    borderRadius: '4px',
    padding: '1px 5px',
  },
  stepNumber: {
    marginLeft: 'auto',
    fontSize: '9px',
    color: '#5a6b80',
    letterSpacing: '0.5px',
  },
  detailLine: {
    display: 'flex',
    gap: '8px',
    lineHeight: '1.5',
    marginTop: '2px',
  },
  detailTag: {
    flexShrink: 0,
    width: '28px',
    fontSize: '10px',
    fontWeight: '700',
    color: '#5a6b80',
    userSelect: 'none',
  },
  detailText: {
    color: 'var(--terminal-text)',
    opacity: 0.9,
    wordBreak: 'break-word',
  },
  rawToggle: {
    marginTop: '8px',
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: 'var(--font-terminal)',
    fontSize: '10px',
    color: 'var(--accent-cyan)',
    opacity: 0.7,
    cursor: 'pointer',
  },
  rawJson: {
    marginTop: '6px',
    padding: '8px',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '6px',
    fontSize: '10.5px',
    lineHeight: '1.5',
    color: 'var(--terminal-resp)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '260px',
    overflowY: 'auto',
  },

  // Thinking narration
  thinkingText: {
    fontFamily: 'var(--font-ui)',
    fontSize: '12.5px',
    lineHeight: '1.6',
    color: 'var(--terminal-think)',
    fontStyle: 'italic',
    paddingTop: '2px',
  },

  // Milestone text
  milestoneTitle: {
    fontFamily: 'var(--font-ui)',
    fontSize: '12.5px',
    fontWeight: '700',
    color: '#e8f4ff',
  },
  milestoneDetail: {
    marginTop: '4px',
    fontSize: '11.5px',
    color: 'var(--terminal-text)',
    opacity: 0.85,
    whiteSpace: 'pre-wrap',
    lineHeight: '1.5',
  },

  separator: {
    margin: '4px 0',
    color: 'var(--accent-cyan)',
    textAlign: 'center',
    fontFamily: 'var(--font-terminal)',
    fontSize: '11px',
    fontWeight: 'bold',
    letterSpacing: '1.5px',
    borderTop: '1px dashed rgba(0, 212, 255, 0.2)',
    borderBottom: '1px dashed rgba(0, 212, 255, 0.2)',
    padding: '6px 0',
  },
  activeLine: {
    paddingLeft: '4px',
  },
};
