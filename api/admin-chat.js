// api/admin-chat.js — Interprets the sales admin's freeform WhatsApp reply
// Vercel Serverless Function (Node.js 20, CommonJS)
//
// Plain JSON, not SSE: this is a single bounded Q&A (one Claude call, no tools, no
// multi-step loop), so the SSE plumbing used by agent.js/negotiate.js isn't earned here.

const Anthropic = require("@anthropic-ai/sdk");

const ADMIN_CHAT_PROMPT = `You are ARIA, an autonomous freight-broker agent at Mactrans Logistics Sdn Bhd, messaging your sales admin (your boss) on WhatsApp about a pending action that needs their sign-off before you act on it.

Read the admin's message carefully and reply the way a sharp, slightly informal colleague would — warm but efficient. Then decide what to do next:
- "approve" — the admin has clearly said to go ahead (e.g. "ok send it", "go ahead", "approved", "yes do it")
- "reject" — the admin has clearly said not to proceed, or to cancel
- "clarify" — the admin asked a question, pushed back, asked for a change you can't directly apply (e.g. "can you knock off another 100"), or their intent isn't clear yet. In this case, your reply_text should answer their question or ask what they'd like instead (e.g. suggest using the Amend Quote panel for number changes), and the conversation should continue.

Use the pending action context and any prior chat history given to you. Keep your reply under 4 lines, casual WhatsApp tone, can use emojis sparingly.

End your response with EXACTLY one line in this format, with no other text after it:
[DECISION: approve|reject|clarify]`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { pending_action, admin_message, chat_history } = req.body;

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

    const contextPrompt = `PENDING ACTION AWAITING APPROVAL:\nType: ${pending_action.action_type}\nSummary: ${pending_action.summary}\nQuote details: ${JSON.stringify(pending_action.quote_snapshot || {}, null, 2)}\n\n${historyText ? `PRIOR CONVERSATION THIS SESSION:\n${historyText}\n\n` : ""}ADMIN JUST SAID:\n"${admin_message}"\n\nReply as ARIA and end with the [DECISION: ...] marker.`;

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
    const decision = decisionMatch ? decisionMatch[1].toLowerCase() : "clarify";
    const reply_text = text.replace(/\[DECISION:[^\]]*\]/i, "").trim() || "Got it, boss.";

    res.status(200).json({ decision, reply_text });
  } catch (err) {
    console.error("ARIA admin-chat error:", err);
    res.status(200).json({
      decision: "clarify",
      reply_text: "Sorry boss, having a connection hiccup on my end — can you say that again?",
    });
  }
};
