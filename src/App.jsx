import React, { useState, useEffect } from 'react';
import InputMatrix from './components/InputMatrix';
import AgentTerminal from './components/AgentTerminal';
import OutputPanel from './components/OutputPanel';
import { DEFAULT_RFQ } from './data/defaultRfq';
import { FALLBACK_EVENTS, PLAYBACK_DELAYS_MS } from './data/fallbackPayload';
import { routeEvent } from './lib/sseParser';

export default function App() {
  // Global Clock State
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // App States
  const [rfqText, setRfqText] = useState(DEFAULT_RFQ);
  const [terminalLines, setTerminalLines] = useState([]);
  const [rateCard, setRateCard] = useState(null);
  const [emails, setEmails] = useState([]);
  const [whatsappMessages, setWhatsappMessages] = useState([]);
  const [negotiationResult, setNegotiationResult] = useState(null);
  
  // Streaming/Execution states
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState(null);
  const [isSafeMode, setIsSafeMode] = useState(false);

  // Modal State
  const [activeModal, setActiveModal] = useState(null); // 'accept' | 'escalate' | null

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Dispatchers setup for sseParser
  const dispatchers = {
    addTerminalLine: (line) => {
      setTerminalLines(prev => [...prev, line]);
    },
    setRateCard: (data) => {
      setRateCard(data);
    },
    setEmail: (event) => {
      setEmails([
        {
          id: 'email-1',
          from: event.from,
          from_name: event.from_name,
          to: event.to,
          to_name: event.to_name,
          subject: event.subject,
          timestamp: event.timestamp,
          body: event.body,
          isCounterOffer: false
        }
      ]);
    },
    setWhatsapp: (event) => {
      setWhatsappMessages([
        {
          id: 'wa-1',
          sender: event.sender,
          avatarInitials: event.avatar_initials,
          timestamp: event.timestamp,
          content: event.content,
          isOutgoing: true
        }
      ]);
    },
    setNegotiationResult: (event) => {
      setNegotiationResult(event);

      // 1. Client counter-offer email
      const clientEmail = {
        id: 'email-client-counter',
        from: 'procurement@globalconstruct.com.my',
        from_name: 'Ahmad Farouk',
        to: 'quotes@mactrans.com.my',
        to_name: 'ARIA Agent',
        subject: 'RE: RFQ #MC-2026-0441',
        timestamp: new Date().toLocaleString("en-MY", {
          timeZone: "Asia/Kuala_Lumpur",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        body: `Hi, thanks for the quote. MYR 3,880 is a bit high for us.\nCan you do MYR 3,400? That would work for our budget.`,
        isCounterOffer: true
      };

      // 2. ARIA counter email reply
      const replyEmail = {
        id: 'email-aria-reply',
        from: 'aria@mactrans.com.my',
        from_name: 'ARIA — Mactrans Logistics',
        to: 'procurement@globalconstruct.com.my',
        to_name: 'Ahmad Farouk, Global Construct Sdn Bhd',
        subject: 'RE: RFQ #MC-2026-0441 — Freight Quotation: KL to Penang Port',
        timestamp: new Date().toLocaleString("en-MY", {
          timeZone: "Asia/Kuala_Lumpur",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        body: event.counter_email_body,
        isCounterOffer: false
      };

      setEmails(prev => {
        const base = prev.filter(e => e.id === 'email-1');
        return [...base, clientEmail, replyEmail];
      });

      // 3. WhatsApp messages
      const waUpdate = {
        id: 'wa-negotiation-update',
        sender: 'ARIA Bot',
        avatarInitials: 'AB',
        timestamp: new Date().toLocaleTimeString("en-MY", {
          timeZone: "Asia/Kuala_Lumpur",
          hour: "2-digit",
          minute: "2-digit",
        }),
        content: event.whatsapp_update || `Boss, they came back at MYR 3,400 (${event.discount_pct}% off). Outside our floor. Countered at MYR ${event.counter_offer_myr || 3492} (10% max). Ball in their court. 🏓`,
        isOutgoing: true
      };

      setWhatsappMessages(prev => {
        const base = prev.filter(m => m.id === 'wa-1');
        return [...base, waUpdate];
      });
    },
    setDone: (val) => {
      setIsDone(val);
    },
    setError: (msg) => {
      setError(msg);
      setTerminalLines(prev => [...prev, { type: 'error', message: msg }]);
    }
  };

  // SSE stream client parser
  const readStream = async (response) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete trailing line

        for (const line of lines) {
          const cleaned = line.trim();
          if (cleaned.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(cleaned.substring(6));
              routeEvent(eventData, dispatchers);
            } catch (err) {
              console.error("SSE line parse error:", cleaned, err);
            }
          }
        }
      }
    } catch (err) {
      console.error("SSE stream reading failed:", err);
      dispatchers.setError("SSE stream reading failed. Fallback to Safe Mode.");
    }
  };

  // Trigger main deployment
  const handleDeploy = async () => {
    // Reset States
    setTerminalLines([]);
    setRateCard(null);
    setEmails([]);
    setWhatsappMessages([]);
    setNegotiationResult(null);
    setIsDone(false);
    setIsStreaming(true);
    setError(null);
    setEditMode(false);
    setIsSafeMode(false);

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ rfq_text: rfqText })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      await readStream(response);
    } catch (err) {
      console.error("Deploy failed:", err);
      dispatchers.addTerminalLine({
        type: 'error',
        message: `Deployment API error: ${err.message}. Initiating Safe Mode fallback...`
      });
      // Fallback automatically to Safe Mode on error so the live demo doesn't fail
      setTimeout(handleSafeMode, 1500);
    } finally {
      setIsStreaming(false);
    }
  };

  // Safe Mode Playback Simulation
  const handleSafeMode = () => {
    setTerminalLines([]);
    setRateCard(null);
    setEmails([]);
    setWhatsappMessages([]);
    setNegotiationResult(null);
    setIsDone(false);
    setIsStreaming(true);
    setError(null);
    setEditMode(false);
    setIsSafeMode(true);

    let currentIdx = 0;

    const playNext = () => {
      if (currentIdx >= FALLBACK_EVENTS.length) {
        setIsStreaming(false);
        setIsDone(true);
        return;
      }

      const event = FALLBACK_EVENTS[currentIdx];
      const delay = PLAYBACK_DELAYS_MS[currentIdx];

      routeEvent(event, dispatchers);

      currentIdx++;
      setTimeout(playNext, delay);
    };

    playNext();
  };

  // Amend Quote callback
  const handleAmendQuote = () => {
    setEditMode(prev => !prev);
  };

  // Recalculate & Regenerate from RateCard
  const handleRecalculate = async (amendedValues) => {
    setIsStreaming(true);
    setEditMode(false);
    
    // Add brief terminal logs signalling update
    dispatchers.addTerminalLine({
      type: 'separator',
      content: '🔄 RATE CARD AMENDED — REGENERATING OUTBOUND LOGISTICS COMMUNICATIONS 🔄'
    });
    dispatchers.addTerminalLine({
      type: 'thinking',
      content: 'Applying manually amended rates to quotation templates. Re-calculating markup and generating fresh drafts...'
    });

    try {
      // If we are in safe mode or API keys are missing, we mock the regeneration locally
      if (isSafeMode) {
        setTimeout(() => {
          // Calculate the custom values locally
          const updatedRateCard = {
            ...rateCard,
            ...amendedValues
          };
          setRateCard(updatedRateCard);
          
          // Generate revised email
          const updatedEmail = {
            id: 'email-1',
            from: "aria@mactrans.com.my",
            from_name: "ARIA — Mactrans Logistics",
            to: "procurement@globalconstruct.com.my",
            to_name: "Ahmad Farouk, Global Construct Sdn Bhd",
            subject: "RE: RFQ #MC-2026-0441 — Freight Quotation: KL to Penang Port",
            timestamp: new Date().toLocaleString("en-MY", {
              timeZone: "Asia/Kuala_Lumpur",
              day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
            }),
            body: `Dear Mr. Ahmad,\n\nThank you for submitting RFQ #MC-2026-0441. We are pleased to provide our updated quotation for the transport of your CNC milling machines (3 units, crated) from Cheras Industrial Zone, Kuala Lumpur to Penang Port, Butterworth.\n\n**Quotation Summary (Amended):**\n- Base Freight Rate: MYR ${amendedValues.base_rate_myr.toFixed(2)}\n- Fuel Surcharge: MYR ${amendedValues.fuel_surcharge_myr.toFixed(2)}\n- Cargo Insurance: MYR ${amendedValues.insurance_fee_myr.toFixed(2)}\n- Escort Vehicle: MYR ${amendedValues.escort_fee_myr.toFixed(2)}\n- Handling: MYR ${amendedValues.handling_fee_myr.toFixed(2)}\n- **Total: MYR ${amendedValues.total_quote_myr.toFixed(2)}**\n\n**Carrier:** Trans-Peninsular Express Sdn Bhd (Rating: 4.8/5)\n**Estimated Transit:** 4.5 hours via North-South Expressway\n**Quote Valid Until:** 6 July 2026\n\nThis quote includes full cargo insurance coverage and a dedicated escort vehicle as requested. We recommend a 05:00 departure to avoid peak congestion near the Ipoh interchange.\n\nPlease confirm your acceptance and we will proceed with booking immediately.\n\nWarm regards,\nARIA | Mactrans Logistics`
          };

          // Generate revised WhatsApp
          const updatedWhatsapp = {
            id: 'wa-1',
            sender: "ARIA Bot",
            avatarInitials: "AB",
            timestamp: new Date().toLocaleTimeString("en-MY", {
              timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit"
            }),
            content: `Boss, rate card manually adjusted. New quote: MYR ${amendedValues.total_quote_myr.toLocaleString()}. Adjusted margin. New email draft sent to Global Construct. Standing by. ✅`
          };

          setEmails([updatedEmail]);
          setWhatsappMessages([updatedWhatsapp]);
          dispatchers.addTerminalLine({ type: 'thinking', content: 'Outbound communications regenerated successfully.' });
          dispatchers.addTerminalLine({ type: 'done' });
          setIsStreaming(false);
        }, 1500);
        return;
      }

      // Real network call for regeneration
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mode: 'regenerate_email',
          amended_values: amendedValues
        })
      });

      if (!response.ok) throw new Error(`HTTP error ${response.status}`);

      await readStream(response);
    } catch (err) {
      console.error("Regenerate failed:", err);
      dispatchers.addTerminalLine({ type: 'error', message: `Failed to regenerate email: ${err.message}` });
    } finally {
      setIsStreaming(false);
    }
  };

  // Auto Negotiate callback
  const handleAutoNegotiate = async () => {
    setIsStreaming(true);

    // 1. Inject client's incoming counter-offer email to simulator thread
    const clientCounterOffer = {
      id: 'email-client-counter',
      from: 'procurement@globalconstruct.com.my',
      from_name: 'Ahmad Farouk',
      to: 'quotes@mactrans.com.my',
      to_name: 'ARIA Agent',
      subject: 'RE: RFQ #MC-2026-0441',
      timestamp: new Date().toLocaleString("en-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
      }),
      body: `Hi, thanks for the quote. MYR ${rateCard?.total_quote_myr || 3880} is a bit high for us.\nCan you do MYR 3,400? That would work for our budget.`,
      isCounterOffer: true
    };

    setEmails(prev => [...prev, clientCounterOffer]);

    // 2. Append re-engagement header to terminal
    dispatchers.addTerminalLine({
      type: 'separator',
      content: '--- COUNTER-OFFER RECEIVED — RE-ENGAGING ARIA ---'
    });

    dispatchers.addTerminalLine({
      type: 'thinking',
      content: `Ahmad Farouk has submitted a counter-proposal of MYR 3,400 against our quote of MYR ${rateCard?.total_quote_myr || 3880}.\nI will now analyze this counter-offer against our 10% maximum discount floor of MYR ${rateCard?.minimum_acceptable_myr || 3492}.`
    });

    try {
      // Support local mock negotiation if in safe mode or API keys not set
      if (isSafeMode || error) {
        setTimeout(() => {
          const mockNegEvent = {
            type: "negotiation_result",
            decision: "counter",
            reasoning: "Client's offer of MYR 3,400 represents a 12.4% discount — this exceeds our 10% maximum margin floor. I will counter at MYR 3,492 (exactly 10% below original quote) to protect minimum profitability.",
            counter_offer_myr: 3492,
            discount_pct: "12.4",
            counter_email_body: `Dear Mr. Ahmad,\n\nThank you for your response. While we appreciate your budget constraints, our quote of MYR ${rateCard?.total_quote_myr || 3880} is already highly optimized for flatbed transport with a dedicated escort vehicle and full cargo insurance.\n\nWe want to support your timeline for the July 5th vessel. The absolute best counter-offer we can support under Mactrans business rules is MYR 3,492.00 (which represents a 10% discount from our original quote).\n\nThis price still includes the flatbed, escort vehicle, and cargo insurance. Please let us know if this works so we can lock in Trans-Peninsular Express.\n\nWarm regards,\nARIA | Mactrans Logistics`,
            whatsapp_update: "Boss, they came back at MYR 3,400 (12.4% off). Outside our floor. Countered at MYR 3,492 (10% max). Ball in their court. 🏓"
          };

          // Print tool actions to terminal
          dispatchers.addTerminalLine({
            type: 'tool_call',
            name: 'evaluate_counter_offer',
            args: {
              original_quote_myr: rateCard?.total_quote_myr || 3880,
              counter_offer_myr: 3400,
              minimum_acceptable_myr: rateCard?.minimum_acceptable_myr || 3492
            }
          });

          setTimeout(() => {
            dispatchers.addTerminalLine({
              type: 'tool_response',
              name: 'evaluate_counter_offer',
              result: {
                decision: "counter",
                discount_pct: "12.4",
                counter_offer_myr: rateCard?.minimum_acceptable_myr || 3492,
                reasoning: "Counter-offer exceeds 10% discount threshold. Counter at minimum acceptable MYR 3,492."
              }
            });

            dispatchers.addTerminalLine({
              type: 'thinking',
              content: 'Drafting counter-proposal email and alert.'
            });

            dispatchers.setNegotiationResult(mockNegEvent);
            dispatchers.addTerminalLine({ type: 'done' });
            setIsStreaming(false);
          }, 800);
        }, 1200);
        return;
      }

      // Real network negotiate call
      const response = await fetch('/api/negotiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          original_quote_myr: rateCard?.total_quote_myr || 3880,
          minimum_acceptable_myr: rateCard?.minimum_acceptable_myr || 3492,
          counter_offer_myr: 3400,
          client_name: 'Ahmad Farouk',
          rfq_id: 'MC-2026-0441'
        })
      });

      if (!response.ok) throw new Error(`HTTP error ${response.status}`);

      await readStream(response);
    } catch (err) {
      console.error("Negotiate failed:", err);
      dispatchers.addTerminalLine({ type: 'error', message: `Failed to execute auto-negotiation: ${err.message}` });
    } finally {
      setIsStreaming(false);
    }
  };

  // Modals actions
  const handleAcceptFinal = () => {
    setActiveModal('accept');
  };

  const handleEscalate = () => {
    setActiveModal('escalate');
  };

  const closeModal = () => {
    setActiveModal(null);
  };

  const formatClockTime = (date) => {
    return date.toLocaleTimeString('en-MY', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  return (
    <div style={styles.appContainer}>
      {/* Header Bar */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logoBadge}>ARIA</span>
          <h1 style={styles.headerTitle}>MACTRANS ARIA — Autonomous Freight Operations Control Room</h1>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.clockIcon}>🕒</span>
          <span style={styles.clockText}>{formatClockTime(currentTime)}</span>
        </div>
      </header>

      {/* Main Workspace (3-Column Layout) */}
      <main style={styles.workspace}>
        <div style={{ ...styles.column, width: '25%' }}>
          <InputMatrix
            rfqText={rfqText}
            setRfqText={setRfqText}
            onDeploy={handleDeploy}
            isStreaming={isStreaming}
          />
        </div>
        
        <div style={{ ...styles.column, width: '45%' }}>
          <AgentTerminal
            terminalLines={terminalLines}
            isStreaming={isStreaming}
          />
        </div>
        
        <div style={{ ...styles.column, width: '30%' }}>
          <OutputPanel
            rateCard={rateCard}
            emails={emails}
            whatsappMessages={whatsappMessages}
            isDone={isDone}
            isStreaming={isStreaming}
            editMode={editMode}
            negotiationResult={negotiationResult}
            onAmendQuote={handleAmendQuote}
            onAutoNegotiate={handleAutoNegotiate}
            onRecalculate={handleRecalculate}
            onAcceptFinal={handleAcceptFinal}
            onEscalate={handleEscalate}
          />
        </div>
      </main>

      {/* Floating Low-Opacity Safe Mode trigger at bottom-left */}
      <button
        onClick={handleSafeMode}
        style={styles.safeModeBtn}
        title="Trigger Pre-recorded Demo Safe Mode"
      >
        ⚡ SAFE MODE
      </button>

      {/* Premium Modals Backdrop */}
      {activeModal && (
        <div style={styles.modalBackdrop} onClick={closeModal}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            {activeModal === 'accept' ? (
              <div style={styles.modalBody}>
                <div style={{ ...styles.modalIcon, color: 'var(--accent-green)' }}>✓</div>
                <h3 style={styles.modalTitle}>Quotation Accepted</h3>
                <p style={styles.modalText}>
                  Booking requests have been successfully dispatched to <strong>Trans-Peninsular Express Sdn Bhd</strong>.
                  <br />
                  A confirmation email has been routed to Ahmad Farouk (procurement@globalconstruct.com.my).
                </p>
              </div>
            ) : (
              <div style={styles.modalBody}>
                <div style={{ ...styles.modalIcon, color: 'var(--accent-amber)' }}>!</div>
                <h3 style={styles.modalTitle}>Case Escalated</h3>
                <p style={styles.modalText}>
                  Case #MC-2026-0441 has been escalated to the Operations Manager.
                  <br />
                  Internal dashboard ticket #TKT-2026-8910 has been opened for manual override.
                </p>
              </div>
            )}
            <button style={styles.modalCloseBtn} onClick={closeModal}>Close Panel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  appContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    position: 'relative',
    boxSizing: 'border-box',
  },
  header: {
    height: '54px',
    backgroundColor: 'rgba(5, 8, 16, 0.8)',
    borderBottom: '1px solid var(--glass-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    zIndex: 10,
    backdropFilter: 'blur(8px)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  logoBadge: {
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    color: 'var(--accent-cyan)',
    border: '1px solid rgba(0, 212, 255, 0.3)',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 'bold',
    fontFamily: 'var(--font-terminal)',
    letterSpacing: '1px',
  },
  headerTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#ffffff',
    margin: 0,
    letterSpacing: '0.5px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#a0aec0',
  },
  clockIcon: {
    fontSize: '14px',
  },
  clockText: {
    fontSize: '13px',
    fontFamily: 'var(--font-terminal)',
    color: 'var(--accent-cyan)',
    fontWeight: '500',
  },
  workspace: {
    flexGrow: 1,
    display: 'flex',
    padding: '16px',
    gap: '16px',
    height: 'calc(100vh - 54px)',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  column: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  safeModeBtn: {
    position: 'absolute',
    bottom: '12px',
    left: '12px',
    background: 'rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '4px',
    color: 'rgba(255, 255, 255, 0.3)',
    padding: '4px 8px',
    fontSize: '10px',
    fontFamily: 'var(--font-terminal)',
    cursor: 'pointer',
    zIndex: 100,
    transition: 'all 0.2s',
    outline: 'none',
    ':hover': {
      color: '#ffffff',
      borderColor: 'var(--accent-cyan)',
      background: 'rgba(0, 212, 255, 0.1)',
      opacity: 1
    }
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  modalContent: {
    backgroundColor: 'var(--glass-bg)',
    border: '1px solid var(--glass-border-hi)',
    borderRadius: '12px',
    padding: '30px',
    width: '420px',
    maxWidth: '90%',
    boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
    animation: 'fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
  },
  modalBody: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    textAlign: 'center',
  },
  modalIcon: {
    fontSize: '48px',
    lineHeight: '1',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#ffffff',
  },
  modalText: {
    fontSize: '13px',
    color: '#a0aec0',
    lineHeight: '1.6',
  },
  modalCloseBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    color: '#ffffff',
    padding: '8px 24px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    outline: 'none',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    }
  }
};
