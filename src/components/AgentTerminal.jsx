import React, { useEffect, useRef } from 'react';

export default function AgentTerminal({ terminalLines = [], isStreaming }) {
  const terminalEndRef = useRef(null);

  // Auto-scroll logic
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLines, isStreaming]);

  const renderLine = (line, idx) => {
    if (line.type === 'separator') {
      return (
        <div key={idx} style={styles.separator}>
          {line.content}
        </div>
      );
    }

    let prefix = '';
    let textColor = 'var(--terminal-text)';
    let content = '';
    let isBold = false;

    switch (line.type) {
      case 'thinking':
        prefix = '[THINKING] ';
        textColor = 'var(--terminal-think)';
        content = line.content;
        break;
      case 'tool_call':
        prefix = `[CALLING TOOL: ${line.name}] `;
        textColor = 'var(--accent-cyan)';
        content = JSON.stringify(line.args || {}, null, 2);
        break;
      case 'tool_response':
        prefix = `[TOOL RESPONSE: ${line.name}] `;
        textColor = 'var(--terminal-resp)';
        content = JSON.stringify(line.result || {}, null, 2);
        break;
      case 'email_draft':
        prefix = '[EMAIL DRAFTED ✓] ';
        textColor = 'var(--accent-green)';
        isBold = true;
        content = `Subject: ${line.subject || ''}\nSent to: ${line.to_name || line.to || ''}`;
        break;
      case 'whatsapp_msg':
        prefix = '[WHATSAPP ALERT DRAFTED ✓] ';
        textColor = 'var(--accent-green)';
        content = line.content;
        break;
      case 'negotiation_result':
        prefix = `[NEGOTIATION DECISION: ${line.decision?.toUpperCase()}] `;
        textColor = line.decision === 'accept' ? 'var(--accent-green)' : 'var(--accent-amber)';
        isBold = true;
        content = line.reasoning || '';
        break;
      case 'done':
        prefix = '[MISSION COMPLETE ✓] ';
        textColor = 'var(--accent-green)';
        isBold = true;
        content = 'ARIA operations finished executing successfully.';
        break;
      case 'error':
        prefix = '[ERROR 🚨] ';
        textColor = '#ff5f57';
        isBold = true;
        content = line.message || 'An unexpected error occurred.';
        break;
      default:
        content = typeof line === 'string' ? line : JSON.stringify(line);
    }

    return (
      <div key={idx} style={{ ...styles.line, color: textColor, fontWeight: isBold ? 'bold' : 'normal' }}>
        <span style={styles.prefix}>{prefix}</span>
        <span style={styles.content}>{content}</span>
      </div>
    );
  };

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
        {terminalLines.length === 0 ? (
          <div style={styles.welcomeText}>
            System idle. Click &quot;DEPLOY AGENTIC BROKER&quot; to initiate cognitive reasoning loop...
          </div>
        ) : (
          terminalLines.map((line, idx) => renderLine(line, idx))
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
    width: '38px', // Visual balance for dots on left
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
  line: {
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  prefix: {
    userSelect: 'none',
  },
  content: {
    opacity: 0.95,
  },
  separator: {
    margin: '16px 0',
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
  }
};
