import React from 'react';
import RateCard from './RateCard';
import OutlookSimulator from './OutlookSimulator';
import WhatsAppSimulator from './WhatsAppSimulator';

export default function OutputPanel({
  rateCard,
  emails = [],
  whatsappMessages = [],
  isDone,
  isStreaming,
  editMode,
  negotiationResult,
  onAmendQuote,
  onAutoNegotiate,
  onRecalculate,
  onAcceptFinal,
  onEscalate
}) {
  return (
    <div style={styles.container}>
      {/* Scrollable stack of simulator screens */}
      <div style={styles.scrollArea}>
        <div style={styles.stack}>
          <div className={!rateCard ? 'placeholder-pulse' : 'fade-in-up'}>
            <RateCard
              data={rateCard}
              editMode={editMode}
              onRecalculate={onRecalculate}
            />
          </div>

          <div className={emails.length === 0 ? 'placeholder-pulse' : 'fade-in-up'}>
            <OutlookSimulator emails={emails} />
          </div>

          <div className={whatsappMessages.length === 0 ? 'placeholder-pulse' : 'fade-in-up'}>
            <WhatsAppSimulator messages={whatsappMessages} />
          </div>
        </div>
      </div>

      {/* Persistent action panel at bottom */}
      <div style={styles.actionPanel}>
        {!negotiationResult ? (
          <div style={styles.buttonRow}>
            <button
              onClick={onAmendQuote}
              disabled={!isDone || isStreaming}
              style={{
                ...styles.button,
                ...styles.amendBtn,
                ...((!isDone || isStreaming) ? styles.disabledBtn : {}),
                ...(editMode ? styles.amendBtnActive : {})
              }}
            >
              {editMode ? '❌ Cancel Amendment' : '✏️ Amend Quote'}
            </button>

            <button
              onClick={onAutoNegotiate}
              disabled={!isDone || isStreaming || editMode}
              style={{
                ...styles.button,
                ...styles.negotiateBtn,
                ...((!isDone || isStreaming || editMode) ? styles.disabledBtn : {})
              }}
            >
              ✅ Approve &amp; Auto-Negotiate
            </button>
          </div>
        ) : (
          <div style={styles.buttonRow}>
            <button
              onClick={onAcceptFinal}
              style={{
                ...styles.button,
                ...styles.acceptFinalBtn,
              }}
            >
              🤝 Accept Final Offer
            </button>

            <button
              onClick={onEscalate}
              style={{
                ...styles.button,
                ...styles.escalateBtn,
              }}
            >
              ⚠️ Escalate to Manager
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    gap: '12px',
  },
  scrollArea: {
    flexGrow: 1,
    overflowY: 'auto',
    paddingRight: '4px',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    paddingBottom: '16px',
  },
  actionPanel: {
    padding: '12px 0 0 0',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
  },
  buttonRow: {
    display: 'flex',
    gap: '10px',
  },
  button: {
    flex: 1,
    padding: '12px 8px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out',
    border: 'none',
    textAlign: 'center',
  },
  amendBtn: {
    background: 'transparent',
    color: 'var(--accent-amber)',
    border: '1.5px solid var(--accent-amber)',
    boxShadow: '0 2px 8px rgba(255, 184, 0, 0.05)',
  },
  amendBtnActive: {
    background: 'rgba(255, 184, 0, 0.1)',
    color: '#ffffff',
    borderColor: '#ffffff',
  },
  negotiateBtn: {
    background: 'linear-gradient(135deg, #00d4ff 0%, var(--accent-green) 100%)',
    color: '#050810',
    boxShadow: '0 4px 12px rgba(0, 255, 157, 0.2)',
  },
  acceptFinalBtn: {
    background: 'transparent',
    color: 'var(--accent-green)',
    border: '1.5px solid var(--accent-green)',
    boxShadow: '0 4px 12px rgba(0, 255, 157, 0.1)',
  },
  escalateBtn: {
    background: 'transparent',
    color: 'var(--accent-amber)',
    border: '1.5px solid var(--accent-amber)',
    boxShadow: '0 4px 12px rgba(255, 184, 0, 0.1)',
  },
  disabledBtn: {
    background: 'rgba(255, 255, 255, 0.03)',
    color: 'rgba(255, 255, 255, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    cursor: 'not-allowed',
    boxShadow: 'none',
  }
};
