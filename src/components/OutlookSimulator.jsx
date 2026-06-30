import React from 'react';

export default function OutlookSimulator({ emails = [] }) {
  if (!emails || emails.length === 0) {
    return (
      <div className="glass-panel placeholder-pulse" style={styles.placeholderContainer}>
        <div style={styles.placeholderText}>AWAITING EMAIL DRAFT...</div>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={styles.container}>
      {/* Outlook Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <svg style={styles.logo} viewBox="0 0 24 24" width="18" height="18">
            <path fill="#ffffff" d="M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,19H5V8H19V19M19,6H5V5H19V6Z" />
          </svg>
          <span style={styles.headerTitle}>Outlook Web — Mactrans Agent Outbox</span>
        </div>
        <div style={styles.headerRight}>
          <button style={styles.composeBtn}>[Compose ▼]</button>
        </div>
      </div>

      {/* Tabs bar */}
      <div style={styles.tabsBar}>
        <span style={styles.activeTab}>INBOX ({emails.filter(e => e.isCounterOffer).length})</span>
        <span style={styles.tab}>SENT ({emails.filter(e => !e.isCounterOffer && e.status === 'sent').length})</span>
        <span style={styles.tab}>DRAFTS ({emails.filter(e => !e.isCounterOffer && e.status === 'draft').length})</span>
      </div>

      {/* Email Thread Area */}
      <div style={styles.threadArea}>
        {emails.map((email, index) => {
          const isLast = index === emails.length - 1;
          return (
            <div
              key={email.id || index}
              className="slide-in-right"
              style={{
                ...styles.emailCard,
                ...(email.isCounterOffer ? styles.counterOfferCard : {}),
                animationDelay: `${index * 0.1}s`,
              }}
            >
              <div style={styles.emailMeta}>
                {!email.isCounterOffer && email.status === 'draft' && (
                  <span style={styles.draftBadge}>DRAFT — PENDING APPROVAL</span>
                )}
                {!email.isCounterOffer && email.status === 'sent' && (
                  <span style={styles.sentBadge}>✓ SENT</span>
                )}
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>From:</span>
                  <span style={styles.metaValue}>
                    <strong>{email.from_name || email.from}</strong> {email.from ? `<${email.from}>` : ''}
                  </span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>To:</span>
                  <span style={styles.metaValue}>
                    {email.to_name || email.to} {email.to ? `<${email.to}>` : ''}
                  </span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Date:</span>
                  <span style={styles.metaValue}>{email.timestamp || 'Just now'}</span>
                </div>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Subject:</span>
                  <span style={styles.metaValue}><strong>{email.subject}</strong></span>
                </div>
              </div>

              <div style={styles.divider}></div>

              <div style={styles.emailBody}>
                {email.body}
              </div>

              {/* Action buttons */}
              <div style={styles.emailActions}>
                <span style={styles.actionLink}>[Reply]</span>
                <span style={styles.actionLink}>[Reply All]</span>
                <span style={styles.actionLink}>[Forward]</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  placeholderContainer: {
    height: '240px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px dashed rgba(255, 255, 255, 0.1)',
  },
  placeholderText: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '1px',
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#252525',
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.05)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 16px',
    backgroundColor: '#0078d4', // Microsoft Outlook Blue
    color: '#ffffff',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  logo: {
    display: 'block',
  },
  headerTitle: {
    fontFamily: "'Segoe UI', Calibri, sans-serif",
    fontSize: '13px',
    fontWeight: '600',
  },
  headerRight: {},
  composeBtn: {
    background: 'rgba(255, 255, 255, 0.15)',
    color: '#ffffff',
    border: 'none',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: "'Segoe UI', Calibri, sans-serif",
    cursor: 'pointer',
  },
  tabsBar: {
    display: 'flex',
    padding: '0 16px',
    backgroundColor: '#1f1f1f',
    borderBottom: '1px solid #333333',
    gap: '16px',
  },
  activeTab: {
    fontFamily: "'Segoe UI', Calibri, sans-serif",
    fontSize: '11px',
    fontWeight: '600',
    color: '#0078d4',
    padding: '8px 0',
    borderBottom: '2px solid #0078d4',
    cursor: 'pointer',
  },
  tab: {
    fontFamily: "'Segoe UI', Calibri, sans-serif",
    fontSize: '11px',
    color: '#8a8a8a',
    padding: '8px 0',
    cursor: 'pointer',
  },
  threadArea: {
    flexGrow: 1,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    overflowY: 'auto',
  },
  emailCard: {
    backgroundColor: '#1f1f1f',
    border: '1px solid #333333',
    borderRadius: '6px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  counterOfferCard: {
    borderLeft: '3px solid #0078d4', // Blue border for incoming counter-offer
    backgroundColor: '#1a222f',
  },
  draftBadge: {
    alignSelf: 'flex-start',
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '0.5px',
    color: 'var(--accent-amber)',
    backgroundColor: 'rgba(255, 184, 0, 0.12)',
    border: '1px solid rgba(255, 184, 0, 0.4)',
    borderRadius: '4px',
    padding: '2px 6px',
    marginBottom: '2px',
  },
  sentBadge: {
    alignSelf: 'flex-start',
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '0.5px',
    color: 'var(--accent-green)',
    backgroundColor: 'rgba(0, 255, 157, 0.1)',
    border: '1px solid rgba(0, 255, 157, 0.35)',
    borderRadius: '4px',
    padding: '2px 6px',
    marginBottom: '2px',
  },
  emailMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '12px',
    fontFamily: "'Segoe UI', Calibri, sans-serif",
    color: '#cccccc',
  },
  metaRow: {
    display: 'flex',
  },
  metaLabel: {
    width: '60px',
    color: '#8a8a8a',
  },
  metaValue: {
    flexGrow: 1,
    wordBreak: 'break-all',
  },
  divider: {
    height: '1px',
    backgroundColor: '#333333',
    margin: '4px 0',
  },
  emailBody: {
    fontSize: '13px',
    fontFamily: "'Segoe UI', Calibri, sans-serif",
    lineHeight: '1.5',
    color: '#e8e8e8',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    padding: '6px 0',
  },
  emailActions: {
    display: 'flex',
    gap: '12px',
    fontSize: '11px',
    fontFamily: "'Segoe UI', Calibri, sans-serif",
    color: '#8a8a8a',
    marginTop: '4px',
    userSelect: 'none',
  },
  actionLink: {
    cursor: 'pointer',
    hover: {
      color: '#ffffff',
    }
  }
};
