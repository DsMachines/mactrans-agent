import React, { useState, useEffect } from 'react';
import InputMatrix from './components/InputMatrix';
import AgentTerminal from './components/AgentTerminal';
import OutputPanel from './components/OutputPanel';
import { DEFAULT_RFQ, DEFAULT_CLIENT_INFO } from './data/defaultRfq';
import {
  FALLBACK_EVENTS, PLAYBACK_DELAYS_MS,
  FALLBACK_NEGOTIATION_EVENTS, NEGOTIATION_PLAYBACK_DELAYS_MS,
  FALLBACK_ALTERNATE_EVENTS, ALTERNATE_PLAYBACK_DELAYS_MS,
} from './data/fallbackPayload';
import { routeEvent } from './lib/sseParser';

const nowMY = (opts) => new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", ...opts });
const timeMY = () => new Date().toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });

export default function App() {
  // Global Clock State
  const [currentTime, setCurrentTime] = useState(new Date());

  // App States
  const [rfqText, setRfqText] = useState(DEFAULT_RFQ);
  const [terminalLines, setTerminalLines] = useState([]);
  const [rateCard, setRateCard] = useState(null);
  const [clientInfo, setClientInfoState] = useState(null); // real extracted identity for this run; null = use DEFAULT_CLIENT_INFO
  const [emails, setEmails] = useState([]);
  const [whatsappMessages, setWhatsappMessages] = useState([]);
  const [negotiationResult, setNegotiationResultState] = useState(null);
  const [alternateOffer, setAlternateOfferState] = useState(null);

  // Admin-approval gate state
  const [pendingApproval, setPendingApprovalState] = useState(null);
  const [adminChatHistory, setAdminChatHistory] = useState([]);
  const [isAdminChatLoading, setIsAdminChatLoading] = useState(false);

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

  // Derived email-status flags driving the presenter-button state machine
  const email1 = emails.find(e => e.id === 'email-1');
  const quoteSent = email1?.status === 'sent';
  const negReplyEmail = emails.find(e => e.id === 'email-negotiation-reply');
  const negotiationReplySent = negReplyEmail?.status === 'sent';
  const altOfferEmail = emails.find(e => e.id === 'email-alternate-offer');
  const alternateOfferSent = altOfferEmail?.status === 'sent';

  const pushWhatsapp = (msg) => {
    setWhatsappMessages(prev => [...prev, { id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...msg }]);
  };

  // Real extracted identity for this run, falling back to the canned demo identity
  // whenever nothing's been deployed yet (Safe Mode, or a simulator button clicked early).
  const effectiveClient = clientInfo || DEFAULT_CLIENT_INFO;

  // Dispatchers setup for sseParser
  const dispatchers = {
    addTerminalLine: (line) => {
      setTerminalLines(prev => [...prev, line]);
    },
    setRateCard: (data) => {
      setRateCard(data);
    },
    setClientInfo: (event) => {
      setClientInfoState({
        rfq_id: event.rfq_id,
        client_name: event.client_name,
        contact_person: event.contact_person,
        contact_email: event.contact_email,
        origin: event.origin,
        destination: event.destination,
        required_by_date: event.required_by_date,
      });
    },
    setEmail: (event) => {
      const id = event.email_ref || 'email-1';
      const newEmail = {
        id,
        from: event.from,
        from_name: event.from_name,
        to: event.to,
        to_name: event.to_name,
        subject: event.subject,
        timestamp: event.timestamp,
        body: event.body,
        isCounterOffer: false,
        status: 'draft',
      };
      setEmails(prev => (prev.some(e => e.id === id) ? prev.map(e => (e.id === id ? newEmail : e)) : [...prev, newEmail]));
    },
    setWhatsapp: (event) => {
      pushWhatsapp({
        sender: event.sender,
        avatarInitials: event.avatar_initials,
        timestamp: event.timestamp,
        content: event.content,
        isOutgoing: true,
      });
    },
    setNegotiationResult: (event) => {
      setNegotiationResultState(event);

      const clientEmail = {
        id: 'email-client-counter',
        from: effectiveClient.contact_email,
        from_name: effectiveClient.contact_person,
        to: 'quotes@mactrans.com.my',
        to_name: 'ARIA Agent',
        subject: `RE: RFQ #${effectiveClient.rfq_id}`,
        timestamp: nowMY({ day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        body: `Hi, thanks for the quote. MYR 3,880 is a bit high for us.\nCan you do MYR 3,400? That would work for our budget.`,
        isCounterOffer: true,
        status: 'received',
      };

      const replyEmail = {
        id: 'email-negotiation-reply',
        from: 'aria@mactrans.com.my',
        from_name: 'ARIA — Mactrans Logistics',
        to: effectiveClient.contact_email,
        to_name: `${effectiveClient.contact_person}, ${effectiveClient.client_name}`,
        subject: `RE: RFQ #${effectiveClient.rfq_id} — Freight Quotation: ${effectiveClient.origin} to ${effectiveClient.destination}`,
        timestamp: nowMY({ day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        body: event.counter_email_body,
        isCounterOffer: false,
        status: 'draft',
      };

      setEmails(prev => {
        const base = prev.filter(e => e.id === 'email-1');
        return [...base, clientEmail, replyEmail];
      });

      if (event.whatsapp_update) {
        pushWhatsapp({ sender: 'ARIA Bot', avatarInitials: 'AB', timestamp: timeMY(), content: event.whatsapp_update, isOutgoing: true });
      }
    },
    setAlternateOffer: (event) => {
      setAlternateOfferState(event);

      const altEmail = {
        id: 'email-alternate-offer',
        from: 'aria@mactrans.com.my',
        from_name: 'ARIA — Mactrans Logistics',
        to: effectiveClient.contact_email,
        to_name: `${effectiveClient.contact_person}, ${effectiveClient.client_name}`,
        subject: `RE: RFQ #${effectiveClient.rfq_id} — Alternate Ship Date Offer`,
        timestamp: nowMY({ day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        body: event.counter_email_body,
        isCounterOffer: false,
        status: 'draft',
      };
      setEmails(prev => [...prev.filter(e => e.id !== 'email-alternate-offer'), altEmail]);

      if (event.whatsapp_update) {
        pushWhatsapp({ sender: 'ARIA Bot', avatarInitials: 'AB', timestamp: timeMY(), content: event.whatsapp_update, isOutgoing: true });
      }
    },
    setPendingApproval: (event) => {
      setPendingApprovalState({
        action_id: event.action_id,
        action_type: event.action_type,
        summary: event.summary,
        email_ref: event.email_ref,
        whatsapp_prompt: event.whatsapp_prompt,
        quote_snapshot: event.quote_snapshot,
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

  // Generic scripted-playback helper used by Safe Mode for every phase (initial quote,
  // negotiation reply, alternate-date offer). Each scripted array ends right after its own
  // pending_action + done events, so there's nothing further to auto-advance into — the next
  // phase only starts when the presenter clicks the next button or the real admin-chat
  // round-trip resolves the current pendingApproval.
  const playEventSequence = (events, delays) => {
    let idx = 0;
    const playNext = () => {
      if (idx >= events.length) {
        setIsStreaming(false);
        setIsDone(true);
        return;
      }
      const event = events[idx];
      const delay = delays[idx];
      routeEvent(event, dispatchers);
      idx++;
      setTimeout(playNext, delay);
    };
    playNext();
  };

  // Trigger main deployment
  const handleDeploy = async () => {
    // Reset States
    setTerminalLines([]);
    setRateCard(null);
    setEmails([]);
    setWhatsappMessages([]);
    setNegotiationResultState(null);
    setAlternateOfferState(null);
    setPendingApprovalState(null);
    setAdminChatHistory([]);
    setClientInfoState(null);
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

  // Safe Mode Playback Simulation (initial quote phase)
  const handleSafeMode = () => {
    setTerminalLines([]);
    setRateCard(null);
    setEmails([]);
    setWhatsappMessages([]);
    setNegotiationResultState(null);
    setAlternateOfferState(null);
    setPendingApprovalState(null);
    setAdminChatHistory([]);
    setClientInfoState(null);
    setIsDone(false);
    setIsStreaming(true);
    setError(null);
    setEditMode(false);
    setIsSafeMode(true);

    playEventSequence(FALLBACK_EVENTS, PLAYBACK_DELAYS_MS);
  };

  // Amend Quote callback
  const handleAmendQuote = () => {
    setEditMode(prev => !prev);
  };

  // Recalculate & Regenerate from RateCard — produces a fresh pending_action, same as the
  // primary flow, so the amended quote still requires admin approval before it's "sent."
  const handleRecalculate = async (amendedValues) => {
    setIsStreaming(true);
    setEditMode(false);

    // Update the displayed Rate Card immediately and deterministically, client-side —
    // this must NOT depend on whether the backend's regenerate_email call happens to call
    // calculate_quote again, since it may just redraft text from the values we already sent it.
    const updatedRateCard = { ...rateCard, ...amendedValues };
    dispatchers.setRateCard(updatedRateCard);

    dispatchers.addTerminalLine({
      type: 'separator',
      content: '🔄 RATE CARD AMENDED — REGENERATING OUTBOUND LOGISTICS COMMUNICATIONS 🔄'
    });
    dispatchers.addTerminalLine({
      type: 'thinking',
      content: 'Applying manually amended rates to quotation templates. Re-calculating markup and generating fresh drafts...'
    });

    try {
      if (isSafeMode) {
        setTimeout(() => {
          const lineItems = [
            `- Base Freight Rate: MYR ${amendedValues.base_rate_myr.toFixed(2)}`,
            `- Fuel Surcharge: MYR ${amendedValues.fuel_surcharge_myr.toFixed(2)}`,
            `- Cargo Insurance: MYR ${amendedValues.insurance_fee_myr.toFixed(2)}`,
            `- Escort Vehicle: MYR ${amendedValues.escort_fee_myr.toFixed(2)}`,
            `- Handling: MYR ${amendedValues.handling_fee_myr.toFixed(2)}`,
            amendedValues.weather_contingency_myr ? `- Weather Contingency: MYR ${Number(amendedValues.weather_contingency_myr).toFixed(2)}` : null,
            amendedValues.discount_applied_myr ? `- Discount: − MYR ${Number(amendedValues.discount_applied_myr).toFixed(2)}` : null,
          ].filter(Boolean).join('\n');

          dispatchers.setEmail({
            email_ref: 'email-1',
            from: "aria@mactrans.com.my",
            from_name: "ARIA — Mactrans Logistics",
            to: "procurement@globalconstruct.com.my",
            to_name: "Ahmad Farouk, Global Construct Sdn Bhd",
            subject: "RE: RFQ #MC-2026-0441 — Freight Quotation: KL to Penang Port",
            timestamp: nowMY({ day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
            body: `Dear Mr. Ahmad,\n\nThank you for submitting RFQ #MC-2026-0441. We are pleased to provide our updated quotation for the transport of your CNC milling machines (3 units, crated) from Cheras Industrial Zone, Kuala Lumpur to Penang Port, Butterworth.\n\n**Quotation Summary (Amended):**\n${lineItems}\n- **Total: MYR ${amendedValues.total_quote_myr.toFixed(2)}**\n\n**Carrier:** Trans-Peninsular Express Sdn Bhd (Rating: 4.8/5)\n**Estimated Transit:** 4.5 hours via North-South Expressway\n**Quote Valid Until:** 6 July 2026\n\nThis quote includes full cargo insurance coverage and a dedicated escort vehicle as requested. We recommend a 05:00 departure to avoid peak congestion near the Ipoh interchange.\n\nPlease confirm your acceptance and we will proceed with booking immediately.\n\nWarm regards,\nARIA | Mactrans Logistics`
          });

          const waPrompt = `Boss, rate card manually adjusted — new quote MYR ${amendedValues.total_quote_myr.toLocaleString()}. Drafted the updated email, approve to send? 👍`;
          dispatchers.setWhatsapp({ sender: "ARIA Bot", avatar_initials: "AB", timestamp: timeMY(), content: waPrompt });

          dispatchers.setPendingApproval({
            action_id: `act-${Date.now()}`,
            action_type: 'send_amended_quote_email',
            summary: `Send amended quote to client for MYR ${amendedValues.total_quote_myr}?`,
            email_ref: 'email-1',
            whatsapp_prompt: waPrompt,
            quote_snapshot: updatedRateCard,
          });

          dispatchers.addTerminalLine({ type: 'thinking', content: 'Outbound communications regenerated successfully — awaiting admin approval.' });
          dispatchers.addTerminalLine({ type: 'done' });
          setIsStreaming(false);
          setIsDone(true);
        }, 1500);
        return;
      }

      // Carry the real identity/route through so the regenerated email/rate_card stay
      // consistent with whatever was actually extracted in the original Deploy run.
      const enrichedValues = {
        ...amendedValues,
        contact_person: effectiveClient.contact_person,
        contact_email: effectiveClient.contact_email,
        client_name: effectiveClient.client_name,
        client_rfq_id: rateCard?.client_rfq_id || effectiveClient.rfq_id,
        route_label: rateCard?.route_label || `${effectiveClient.origin} to ${effectiveClient.destination}`,
        route_distance_km: rateCard?.route_distance_km,
      };

      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mode: 'regenerate_email',
          amended_values: enrichedValues
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

  // Presenter simulates the client side: injects an incoming counter-offer and re-engages ARIA
  const handleSimulateClientCounter = async () => {
    setIsStreaming(true);

    const clientCounterOffer = {
      id: 'email-client-counter',
      from: effectiveClient.contact_email,
      from_name: effectiveClient.contact_person,
      to: 'quotes@mactrans.com.my',
      to_name: 'ARIA Agent',
      subject: `RE: RFQ #${effectiveClient.rfq_id}`,
      timestamp: nowMY({ day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      body: `Hi, thanks for the quote. MYR ${rateCard?.total_quote_myr || 3880} is a bit high for us.\nCan you do MYR 3,400? That would work for our budget.`,
      isCounterOffer: true,
      status: 'received',
    };

    setEmails(prev => [...prev, clientCounterOffer]);

    dispatchers.addTerminalLine({
      type: 'separator',
      content: '--- COUNTER-OFFER RECEIVED — RE-ENGAGING ARIA ---'
    });

    dispatchers.addTerminalLine({
      type: 'thinking',
      content: `${effectiveClient.contact_person} has submitted a counter-proposal of MYR 3,400 against our quote of MYR ${rateCard?.total_quote_myr || 3880}.\nI will now analyze this counter-offer against our 10% maximum discount floor of MYR ${rateCard?.minimum_acceptable_myr || 3492}.`
    });

    try {
      if (isSafeMode || error) {
        playEventSequence(FALLBACK_NEGOTIATION_EVENTS, NEGOTIATION_PLAYBACK_DELAYS_MS);
        return;
      }

      const response = await fetch('/api/negotiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          original_quote_myr: rateCard?.total_quote_myr || 3880,
          minimum_acceptable_myr: rateCard?.minimum_acceptable_myr || 3492,
          counter_offer_myr: 3400,
          client_name: effectiveClient.contact_person,
          rfq_id: effectiveClient.rfq_id
        })
      });

      if (!response.ok) throw new Error(`HTTP error ${response.status}`);

      await readStream(response);
    } catch (err) {
      console.error("Negotiate failed:", err);
      dispatchers.addTerminalLine({ type: 'error', message: `Failed to execute negotiation: ${err.message}` });
    } finally {
      setIsStreaming(false);
    }
  };

  // Presenter simulates the client pushing for more than the approved counter — ARIA re-runs
  // a subset of the analysis and proposes an alternate ship date at a mechanically lower price
  const handleClientPushesForMore = async () => {
    setIsStreaming(true);

    dispatchers.addTerminalLine({
      type: 'separator',
      content: '--- CLIENT PUSHING FOR MORE — RE-ENGAGING ARIA ---'
    });
    dispatchers.addTerminalLine({
      type: 'thinking',
      content: `${effectiveClient.contact_person} is asking for an even better price than our approved counter of MYR ${rateCard?.minimum_acceptable_myr || 3492}. Let me check if a different ship date opens up a genuinely cheaper window.`
    });

    try {
      if (isSafeMode || error) {
        playEventSequence(FALLBACK_ALTERNATE_EVENTS, ALTERNATE_PLAYBACK_DELAYS_MS);
        return;
      }

      const response = await fetch('/api/negotiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mode: 'alternate_date',
          original_quote_myr: rateCard?.total_quote_myr || 3880,
          minimum_acceptable_myr: rateCard?.minimum_acceptable_myr || 3492,
          counter_offer_myr: 3300,
          client_name: effectiveClient.contact_person,
          rfq_id: effectiveClient.rfq_id,
          base_rate_myr: rateCard?.base_rate_myr,
          fuel_surcharge_pct: 15,
          has_insurance: true,
          has_escort: true,
          target_margin_pct: rateCard?.applied_margin_pct || 22,
          route_id: 'KUA-PEN-001',
          current_ship_date: effectiveClient.required_by_date,
          deadline_date: effectiveClient.required_by_date,
        })
      });

      if (!response.ok) throw new Error(`HTTP error ${response.status}`);

      await readStream(response);
    } catch (err) {
      console.error("Alternate-date negotiation failed:", err);
      dispatchers.addTerminalLine({ type: 'error', message: `Failed to execute alternate-date analysis: ${err.message}` });
    } finally {
      setIsStreaming(false);
    }
  };

  // Admin types a freeform WhatsApp reply — real Claude call, regardless of Safe Mode,
  // since this is the one capability that must stay genuinely interactive at all times.
  const handleAdminChatSend = async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || isAdminChatLoading) return;

    pushWhatsapp({ sender: 'Sales Admin', avatarInitials: 'SA', timestamp: timeMY(), content: trimmed, isOutgoing: false });

    const historyForRequest = adminChatHistory;
    setAdminChatHistory(prev => [...prev, { role: 'admin', content: trimmed }]);
    setIsAdminChatLoading(true);

    // Fall back to the most recent email for context when chatting with nothing pending —
    // the chat stays available at all times, not just during an active approval gate.
    const refEmail = emails.find(e => e.id === pendingApproval?.email_ref) || emails[emails.length - 1];

    try {
      const response = await fetch('/api/admin-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pending_action: pendingApproval,
          admin_message: trimmed,
          chat_history: historyForRequest,
          client_name: refEmail?.to_name || 'the client',
          original_email_body: refEmail?.body || null,
        }),
      });

      const data = await response.json();

      pushWhatsapp({ sender: 'ARIA Bot', avatarInitials: 'AB', timestamp: timeMY(), content: data.reply_text, isOutgoing: true });
      setAdminChatHistory(prev => [...prev, { role: 'aria', content: data.reply_text }]);

      if (data.decision === 'approve' && pendingApproval?.email_ref) {
        const ref = pendingApproval.email_ref;

        // Admin described a change via chat (e.g. "strip the discount" or "adjust to rm3500")
        // — the backend already validated it, recalculated the total, and redrafted the email;
        // apply that here before marking sent so nothing displayed is stale. This is one
        // generic merge regardless of which action_type/quote shape this is — admin-chat
        // already normalized whatever fields actually changed.
        if (data.revised) {
          const rs = data.revised.quote_snapshot || {};
          const revisedTotal = rs.total_quote_myr ?? rs.final_quote_myr ?? rs.final_offer_myr ?? null;

          setEmails(prev => prev.map(e => (e.id === ref ? { ...e, body: data.revised.email_body || e.body, status: 'sent' } : e)));
          dispatchers.setRateCard(prev => prev ? {
            ...prev,
            ...rs,
            ...(revisedTotal != null ? { total_quote_myr: revisedTotal } : {}),
          } : prev);
        } else {
          setEmails(prev => prev.map(e => (e.id === ref ? { ...e, status: 'sent' } : e)));
        }

        setPendingApprovalState(null);
      }
      // reject/clarify: keep pendingApproval as-is, conversation continues
    } catch (err) {
      console.error("Admin chat failed:", err);
      pushWhatsapp({ sender: 'ARIA Bot', avatarInitials: 'AB', timestamp: timeMY(), content: 'Sorry boss, connection hiccup on my end — mind repeating that?', isOutgoing: true });
    } finally {
      setIsAdminChatLoading(false);
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
            alternateOffer={alternateOffer}
            pendingApproval={pendingApproval}
            quoteSent={quoteSent}
            negotiationReplySent={negotiationReplySent}
            alternateOfferSent={alternateOfferSent}
            isAdminChatLoading={isAdminChatLoading}
            onAmendQuote={handleAmendQuote}
            onRecalculate={handleRecalculate}
            onSimulateClientCounter={handleSimulateClientCounter}
            onClientPushesForMore={handleClientPushesForMore}
            onSendAdminMessage={handleAdminChatSend}
            onAcceptFinal={handleAcceptFinal}
            onEscalate={handleEscalate}
          />
        </div>
      </main>

      {/* Floating Low-Opacity Safe Mode trigger at bottom-left */}
      <button
        onClick={handleSafeMode}
        className="safe-mode-btn"
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
                  A confirmation email has been routed to {effectiveClient.contact_person} ({effectiveClient.contact_email}).
                </p>
              </div>
            ) : (
              <div style={styles.modalBody}>
                <div style={{ ...styles.modalIcon, color: 'var(--accent-amber)' }}>!</div>
                <h3 style={styles.modalTitle}>Case Escalated</h3>
                <p style={styles.modalText}>
                  Case #{effectiveClient.rfq_id} has been escalated to the Operations Manager.
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
