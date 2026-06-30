import React, { useState } from 'react';
import { renderChatHtml } from '../lib/markdownToHtml';

export default function WhatsAppSimulator({ messages = [], canReply = false, isLoading = false, onSendMessage }) {
  const [draft, setDraft] = useState('');

  if (!messages || messages.length === 0) {
    return (
      <div className="glass-panel placeholder-pulse" style={styles.placeholderContainer}>
        <div style={styles.placeholderText}>AWAITING OPERATIONAL CHAT...</div>
      </div>
    );
  }

  const submitDraft = () => {
    if (!draft.trim() || !canReply || isLoading) return;
    onSendMessage?.(draft);
    setDraft('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitDraft();
    }
  };

  return (
    <div className="glass-panel" style={styles.container}>
      {/* WhatsApp Header */}
      <div style={styles.header}>
        <div style={styles.headerInfo}>
          <div style={styles.avatar}>AB</div>
          <div>
            <div style={styles.name}>Mactrans Operations Chat</div>
            <div style={styles.status}>ARIA Agent • Online</div>
          </div>
        </div>
        <div style={styles.headerActions}>
          <span style={styles.actionIcon}>📞</span>
          <span style={styles.actionIcon}>🎥</span>
          <span style={styles.actionIcon}>⋮</span>
        </div>
      </div>

      {/* Chat Area */}
      <div style={styles.chatArea}>
        {messages.map((msg, index) => {
          const isOutgoing = msg.sender === 'ARIA Bot' || msg.isOutgoing;
          return (
            <div
              key={msg.id || index}
              style={{
                ...styles.messageRow,
                justifyContent: isOutgoing ? 'flex-end' : 'flex-start',
              }}
            >
              {!isOutgoing && <div style={styles.smallAvatar}>{msg.avatarInitials || 'M'}</div>}
              <div
                style={{
                  ...styles.bubble,
                  ...(isOutgoing ? styles.outgoingBubble : styles.incomingBubble),
                }}
              >
                {!isOutgoing && <div style={styles.senderName}>{msg.sender}</div>}
                <div style={styles.messageContent} dangerouslySetInnerHTML={{ __html: renderChatHtml(msg.content) }} />
                <div style={styles.timestampRow}>
                  <span style={styles.timestamp}>{msg.timestamp || '2:32 PM'}</span>
                  {isOutgoing && <span style={styles.ticks}>✓✓</span>}
                </div>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div style={{ ...styles.messageRow, justifyContent: 'flex-start' }}>
            <div style={{ ...styles.bubble, ...styles.incomingBubble }}>
              <div style={styles.messageContent}>ARIA is typing…</div>
            </div>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div style={styles.inputBar}>
        <span style={styles.inputIcon}>😊</span>
        <span style={styles.inputIcon}>📎</span>
        <input
          type="text"
          placeholder="Message ARIA..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!canReply || isLoading}
          style={{ ...styles.textInput, opacity: canReply ? 1 : 0.5 }}
        />
        <span
          style={{ ...styles.inputIcon, cursor: canReply ? 'pointer' : 'default', opacity: canReply && draft.trim() ? 1 : 0.4 }}
          onClick={submitDraft}
          title="Send"
        >
          ➤
        </span>
      </div>
    </div>
  );
}

const styles = {
  placeholderContainer: {
    height: '200px',
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
    backgroundColor: '#0b141a', // WhatsApp Dark Background
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.05)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    backgroundColor: '#202c33', // Header Background
    color: '#e9edef',
  },
  headerInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  avatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#00a884', // Green Avatar Background
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '14px',
    fontFamily: 'var(--font-ui)',
  },
  smallAvatar: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: '#6b6375',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '10px',
    fontFamily: 'var(--font-ui)',
    marginRight: '6px',
    alignSelf: 'flex-end',
  },
  name: {
    fontSize: '14px',
    fontWeight: '600',
    fontFamily: 'var(--font-ui)',
  },
  status: {
    fontSize: '11px',
    color: '#8696a0',
    fontFamily: 'var(--font-ui)',
  },
  headerActions: {
    display: 'flex',
    gap: '16px',
    color: '#aebac1',
    cursor: 'pointer',
  },
  actionIcon: {
    fontSize: '16px',
  },
  chatArea: {
    flexGrow: 1,
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundImage: 'radial-gradient(rgba(0, 0, 0, 0.15) 20%, transparent 20%)',
    backgroundSize: '16px 16px',
  },
  messageRow: {
    display: 'flex',
    width: '100%',
    alignItems: 'flex-end',
  },
  bubble: {
    padding: '8px 12px 6px 12px',
    maxWidth: '85%',
    fontSize: '13px',
    fontFamily: 'var(--font-ui)',
    lineHeight: '1.45',
    position: 'relative',
    boxShadow: '0 1px 0.5px rgba(0,0,0,0.15)',
  },
  outgoingBubble: {
    backgroundColor: '#005c4b', // WhatsApp Dark Green Bubble
    color: '#e9edef',
    borderRadius: '8px 0px 8px 8px',
  },
  incomingBubble: {
    backgroundColor: '#202c33', // WhatsApp Dark Gray Bubble
    color: '#e9edef',
    borderRadius: '0px 8px 8px 8px',
  },
  senderName: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: 'var(--accent-cyan)',
    marginBottom: '2px',
  },
  messageContent: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  timestampRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '4px',
    marginTop: '4px',
  },
  timestamp: {
    fontSize: '9px',
    color: '#8696a0',
  },
  ticks: {
    fontSize: '10px',
    color: '#53bdeb', // WhatsApp Blue Checkmark
    fontWeight: 'bold',
  },
  inputBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px',
    backgroundColor: '#202c33',
    gap: '10px',
  },
  inputIcon: {
    fontSize: '18px',
    color: '#8696a0',
    cursor: 'pointer',
  },
  textInput: {
    flexGrow: 1,
    border: 'none',
    backgroundColor: '#2a3942',
    color: '#e9edef',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: 'var(--font-ui)',
    outline: 'none',
  }
};
