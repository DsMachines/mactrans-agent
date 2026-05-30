import React from 'react';

export default function InputMatrix({ rfqText, setRfqText, onDeploy, isStreaming }) {
  return (
    <div className="glass-panel" style={styles.container}>
      <h2 style={styles.title}>📋 INCOMING RFQ — REQUEST FOR QUOTE</h2>
      
      <div style={styles.metadataStrip}>
        <span style={styles.metaItem}><strong>RFQ:</strong> #MC-2026-0441</span>
        <span style={styles.metaDivider}>|</span>
        <span style={styles.metaItem}><strong>Status:</strong> AWAITING PROCESSING</span>
        <span style={styles.metaDivider}>|</span>
        <span style={styles.metaItem}><strong>Class:</strong> HEAVY FREIGHT</span>
      </div>

      <div style={styles.textareaContainer}>
        <textarea
          value={rfqText}
          onChange={(e) => setRfqText(e.target.value)}
          disabled={isStreaming}
          style={styles.textarea}
          placeholder="Paste raw RFQ email text here..."
        />
      </div>

      <button
        onClick={onDeploy}
        disabled={isStreaming}
        style={{
          ...styles.deployButton,
          ...(isStreaming ? styles.deployButtonDisabled : {})
        }}
        className={isStreaming ? 'pulse-animation' : ''}
      >
        {isStreaming ? (
          <span style={styles.btnContent}>
            <span style={styles.spinner}></span>
            ARIA IS PROCESSING...
          </span>
        ) : (
          '🚀 DEPLOY AGENTIC BROKER'
        )}
      </button>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: '20px',
    gap: '12px',
    overflow: 'hidden',
  },
  title: {
    fontSize: '14px',
    fontWeight: '700',
    letterSpacing: '1px',
    color: 'var(--accent-cyan)',
    fontFamily: 'var(--font-ui)',
    margin: 0,
    textTransform: 'uppercase',
  },
  metadataStrip: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: 'var(--panel-surface)',
    borderRadius: '6px',
    fontSize: '11px',
    fontFamily: 'var(--font-terminal)',
    color: '#a0aec0',
    border: '1px solid rgba(255, 255, 255, 0.03)',
  },
  metaItem: {
    whiteSpace: 'nowrap',
  },
  metaDivider: {
    color: 'rgba(255, 255, 255, 0.1)',
  },
  textareaContainer: {
    flexGrow: 1,
    position: 'relative',
    minHeight: '200px',
  },
  textarea: {
    width: '100%',
    height: '100%',
    backgroundColor: 'var(--terminal-bg)',
    color: 'var(--terminal-text)',
    fontFamily: 'var(--font-terminal)',
    fontSize: '13px',
    lineHeight: '1.5',
    padding: '16px',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    resize: 'none',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  deployButton: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #00d4ff 0%, #0078d4 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontFamily: 'var(--font-ui)',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    boxShadow: '0 4px 15px rgba(0, 212, 255, 0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  deployButtonDisabled: {
    background: 'linear-gradient(135deg, #2b3a4a 0%, #1f2a36 100%)',
    color: '#718096',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  btnContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  spinner: {
    width: '16px',
    height: '16px',
    border: '2px solid rgba(255, 255, 255, 0.2)',
    borderTop: '2px solid #ffffff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 1s linear infinite',
  }
};

// Add CSS spin dynamic animation
if (typeof document !== 'undefined') {
  const styleTag = document.createElement('style');
  styleTag.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleTag);
}
