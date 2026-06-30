// api/admin-chat.js — Interprets the sales admin's freeform WhatsApp reply
// Vercel Serverless Function (Node.js 20, CommonJS)
//
// Plain JSON, not SSE: this is a single bounded Q&A (one Claude call, no tools, no
// multi-step loop), so the SSE plumbing used by agent.js/negotiate.js isn't earned here.

const Anthropic = require("@anthropic-ai/sdk");
const SYSTEM_PROMPT = require("./lib/systemPrompt");

const ADMIN_CHAT_PROMPT = `You are ARIA, an autonomous freight-broker agent at Mactrans Logistics Sdn Bhd, messaging your sales admin (your boss) on WhatsApp about a pending action that needs their sign-off before you act on it.

Read the admin's message carefully and reply the way a sharp, slightly informal colleague would — warm but efficient. Then decide what to do next:
- "approve" — the admin has clearly said to go ahead (e.g. "ok send it", "go ahead", "approved", "yes do it"), OR has given you a specific new price/amount and clearly instructed you to use it and proceed
- "reject" — the admin has clearly said not to proceed, or to cancel
- "clarify" — the admin asked a question, pushed back, mentioned a number without yet confirming you should act on it, or their intent isn't clear yet. In this case, your reply_text should answer their question or ask them to confirm before you act, and the conversation should continue.

Separately, scan ONLY the admin's own typed words (prior "Admin:" lines + this message) — NEVER the "Quote details" JSON block, that's background context the admin did not type — for any explicit price/amount the admin has stated should override the currently quoted figure (e.g. "rm3500", "RM 3,500", "make it 3500", "set it to 3,500"). If the admin has clearly confirmed/instructed you to use a figure THEY THEMSELVES TYPED, extract it as a plain number with no currency symbol or commas. If the admin never typed a number (e.g. they just said "send", "strip the discount", "approved", or edited something outside the chat), output "none" — do not invent a number from the quote context just because one is present there.

Use the pending action context and any prior chat history given to you. Keep your reply under 4 lines, casual WhatsApp tone, can use emojis sparingly.

End your response with EXACTLY these two lines in this format, with no other text after them:
[DECISION: approve|reject|clarify]
[REVISED_AMOUNT: <number>|none]`;

// Same clean marker convention used by api/agent.js and api/negotiate.js.
function parseOutputBlocks(text) {
  const emailMatch = text.match(/\[EMAIL_DRAFT\]([\s\S]*?)(\[WHATSAPP_MESSAGE\]|$)/);
  const waMatch = text.match(/\[WHATSAPP_MESSAGE\]([\s\S]*?)$/);
  const cleanMarkdownEdges = (s) => (s || '').trim().replace(/^\*+\s*/, '').replace(/[\s\-*]+$/, '').trim();
  return {
    emailBody: emailMatch ? cleanMarkdownEdges(emailMatch[1]) : null,
    waBody: waMatch ? cleanMarkdownEdges(waMatch[1]) : null,
  };
}

// Action types whose client-facing figure is a single negotiated price, safe to override
// directly from a confirmed chat instruction. The initial structured quote (send_quote_email /
// send_amended_quote_email) has multiple interdependent line items — those must go through the
// Amend Quote panel so the math stays consistent, not a single number typed into chat.
const CHAT_REVISABLE_ACTION_TYPES = ["send_negotiation_reply", "send_alternate_offer"];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { pending_action, admin_message, chat_history, client_name, original_email_body } = req.body;

  if (!admin_message || !pending_action) {
    res.status(400).json({ error: "Missing pending_action or admin_message." });
    return;
  }

  try {
    const anthropic = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const historyText = (chat_history || [])
      .map((turn) => `${turn.role === "admin" ? "Admin" : "ARIA"}: ${turn.content}`)
      .join("\n");

    const contextPrompt = `PENDING ACTION AWAITING APPROVAL:\nType: ${pending_action.action_type}\nSummary: ${pending_action.summary}\nQuote details: ${JSON.stringify(pending_action.quote_snapshot || {}, null, 2)}\n\n${historyText ? `PRIOR CONVERSATION THIS SESSION:\n${historyText}\n\n` : ""}ADMIN JUST SAID:\n"${admin_message}"\n\nReply as ARIA and end with the [DECISION: ...] and [REVISED_AMOUNT: ...] markers.`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: ADMIN_CHAT_PROMPT,
      messages: [{ role: "user", content: contextPrompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const decisionMatch = text.match(/\[DECISION:\s*(approve|reject|clarify)\s*\]/i);
    let decision = decisionMatch ? decisionMatch[1].toLowerCase() : "clarify";

    const amountMatch = text.match(/\[REVISED_AMOUNT:\s*([0-9.]+|none)\s*\]/i);
    let revisedAmount = amountMatch && amountMatch[1].toLowerCase() !== "none" ? Number(amountMatch[1]) : null;

    // Guard against the model pulling a number out of the "Quote details" JSON context (which
    // always contains a price) instead of something the admin actually typed — e.g. a plain
    // "send" was getting misread as a revision because the pending quote_snapshot had a total.
    // Only trust a revised amount if a real number appears somewhere in the admin's own words.
    if (revisedAmount != null) {
      const adminOwnText = [admin_message, ...(chat_history || []).filter((t) => t.role === "admin").map((t) => t.content)].join(" ");
      const adminTypedANumber = /\d{3,}/.test(adminOwnText.replace(/,/g, ""));
      if (!adminTypedANumber) revisedAmount = null;
    }

    let reply_text = text
      .replace(/\[DECISION:[^\]]*\]/i, "")
      .replace(/\[REVISED_AMOUNT:[^\]]*\]/i, "")
      .trim() || "Got it, boss.";

    let revised = null;

    if (decision === "approve" && revisedAmount != null) {
      const isRevisable = CHAT_REVISABLE_ACTION_TYPES.includes(pending_action.action_type);

      if (!isRevisable) {
        // Don't let a raw chat number silently override a structured multi-line-item quote —
        // redirect to the Amend Quote panel, where the line-item math stays consistent.
        decision = "clarify";
        reply_text = "For number changes on the full quote, best to use the Amend Quote panel so the line items stay accurate — want me to flag it for you instead, boss?";
      } else {
        const snapshot = pending_action.quote_snapshot || {};
        const currentAmount = snapshot.final_offer_myr ?? snapshot.final_quote_myr ?? null;

        if (currentAmount == null || Math.abs(revisedAmount - currentAmount) > 0.5) {
          const regenPrompt = `The sales admin has just instructed you, via WhatsApp chat, to change the price on this pending action to MYR ${revisedAmount} (overriding the previously drafted figure${currentAmount != null ? ` of MYR ${currentAmount}` : ""}). This new figure is final — do not recalculate it, do not call any tools, just use it exactly.\n\nContext: ${pending_action.summary}\nClient: ${client_name || "the client"}\n\nPreviously drafted email (for tone/structure reference only — replace the price with the new figure, keep the rest consistent):\n"""\n${original_email_body || "(no prior draft available)"}\n"""\n\nDraft a fresh client email using EXACTLY MYR ${revisedAmount} as the offered/final price.\n\nIMPORTANT — for the WhatsApp message only, override the system prompt's usual "draft pending approval" framing: the admin has ALREADY approved this in chat, so you are confirming a completed action, not requesting sign-off. Write a brief WhatsApp CONFIRMATION (e.g. "Done boss — sent ${client_name || "the client"} the revised offer at MYR ${revisedAmount} ✅"), never asking for further approval.\n\nUse the standard [EMAIL_DRAFT] and [WHATSAPP_MESSAGE] markers.`;

          const regenResponse = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1200,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: regenPrompt }],
          });

          const regenText = regenResponse.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n");

          const { emailBody, waBody } = parseOutputBlocks(regenText);

          revised = {
            amount_myr: revisedAmount,
            email_body: emailBody,
            quote_snapshot: {
              ...snapshot,
              final_offer_myr: revisedAmount,
              final_quote_myr: revisedAmount,
              minimum_acceptable_myr: Math.max(snapshot.minimum_acceptable_myr || 0, revisedAmount),
            },
          };

          if (waBody) reply_text = waBody;
        }
      }
    }

    res.status(200).json({ decision, reply_text, revised });
  } catch (err) {
    console.error("ARIA admin-chat error:", err);
    res.status(200).json({
      decision: "clarify",
      reply_text: "Sorry boss, having a connection hiccup on my end — can you say that again?",
      revised: null,
    });
  }
};
