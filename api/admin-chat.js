// api/admin-chat.js — Interprets the sales admin's freeform WhatsApp reply
// Vercel Serverless Function (Node.js 20, CommonJS)
//
// Plain JSON, not SSE: this is a single bounded Q&A (one Claude call, no tools, no
// multi-step loop), so the SSE plumbing used by agent.js/negotiate.js isn't earned here.
//
// Generic quote-patch design: rather than hardcoding which action_type/field combination
// is editable from chat, this reads whatever numeric fields actually exist in the CURRENT
// pending_action.quote_snapshot, lets the admin's instruction patch any subset of them, and
// recomputes the total in code (never trusting the model's own arithmetic or a number that
// merely appears in the JSON context rather than something the admin actually typed).

const Anthropic = require("@anthropic-ai/sdk");
const SYSTEM_PROMPT = require("./lib/systemPrompt");

const ADMIN_CHAT_PROMPT = `You are ARIA, an autonomous freight-broker agent at Mactrans Logistics Sdn Bhd, messaging your sales admin (your boss) on WhatsApp about a pending action that needs their sign-off before you act on it.

Read the admin's message carefully and reply the way a sharp, slightly informal colleague would — warm but efficient. Then decide what to do next:
- "approve" — the admin has clearly told you to proceed (e.g. "ok send it", "go ahead", "edit the quote and send", "send it now"), whether or not they also described a change to make first
- "reject" — the admin has clearly said not to proceed, or to cancel
- "clarify" — the admin asked a question, described a possible change without yet confirming you should act on it, or their intent isn't clear. Ask a short confirming question and wait.

Separately, check whether the admin's own words (this message + prior "Admin:" lines) describe a change to one or more of the quote's numeric fields (e.g. "strip the discount", "remove the escort fee", "set the handling fee to 80", "knock off the volume discount", "rm3500", "make it 3500"). The "Quote details" JSON below shows the CURRENT fields and values — use it ONLY to learn the existing field names so you can reference them correctly; never treat a number that merely appears there as something the admin said.

If the admin described a confirmed change, output the NEW value for ONLY the fields that should change, as compact JSON using the EXACT field names from "Quote details" (e.g. {"discount_applied_myr": 0} or {"final_offer_myr": 3500}). Do not include fields that aren't changing. Do not compute or include any total/sum field yourself — the system recalculates that from the parts. If no quote change is implied, output "none".

IMPORTANT: if you set decision to "approve" specifically because the admin asked for a quote change, you MUST also provide the matching patch in the same response — never approve a change without capturing it as a patch, and never invent a patch the admin didn't actually ask for.

Use the pending action context and any prior chat history given to you. Keep your reply under 4 lines, casual WhatsApp tone, can use emojis sparingly.

End your response with EXACTLY these two lines in this format, with no other text after them:
[DECISION: approve|reject|clarify]
[QUOTE_PATCH: <compact JSON object>|none]`;

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

// The fixed set of numeric fields that ever legitimately appear across any quote_snapshot
// shape in this app (initial quote, amended quote, negotiation reply, alternate-date offer).
// A patch may only touch keys that are BOTH in this list AND already present as a number in
// the current snapshot — this is what stops the model from inventing or corrupting a field.
const LINE_ITEM_KEYS = ["base_rate_myr", "fuel_surcharge_myr", "insurance_fee_myr", "escort_fee_myr", "handling_fee_myr", "weather_contingency_myr"];
const EDITABLE_KEYS = new Set([...LINE_ITEM_KEYS, "discount_applied_myr", "final_offer_myr", "final_quote_myr", "total_quote_myr"]);
const TOTAL_FIELD_CANDIDATES = ["total_quote_myr", "final_quote_myr", "final_offer_myr"];

const LINE_ITEM_LABELS = {
  base_rate_myr: "Base Freight Rate",
  fuel_surcharge_myr: "Fuel Surcharge",
  insurance_fee_myr: "Cargo Insurance",
  escort_fee_myr: "Escort Vehicle",
  handling_fee_myr: "Handling",
  weather_contingency_myr: "Weather Contingency",
};

// Edits described in words alone (no number) still need to be caught, so "strip the
// discount" doesn't silently get approved-unchanged if the model fails to emit a patch.
const EDIT_INTENT_RE = /\b(discount|remove|strip|reduce|increase|lower|raise|change|adjust|edit|knock off|cut|fee|surcharge|rate|price|margin|amend)\b/i;

function validatePatch(parsed, snapshot) {
  if (!parsed || typeof parsed !== "object") return null;
  const patch = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (EDITABLE_KEYS.has(k) && typeof snapshot[k] === "number" && typeof v === "number" && Number.isFinite(v) && v >= 0) {
      patch[k] = v;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

// Applies a validated patch and recalculates the total deterministically — never trusting
// the model's own arithmetic, regardless of which quote shape this is.
function applyPatch(snapshot, patch) {
  const merged = { ...snapshot, ...patch };
  const hasLineItems = LINE_ITEM_KEYS.some((k) => snapshot[k] != null);
  let total;

  if (hasLineItems) {
    const sum = LINE_ITEM_KEYS.reduce((acc, k) => acc + (Number(merged[k]) || 0), 0);
    const discount = Number(merged.discount_applied_myr) || 0;
    total = Math.round((sum - discount) * 100) / 100;
    for (const k of TOTAL_FIELD_CANDIDATES) if (merged[k] != null) merged[k] = total;
  } else {
    const presentTotalKey = TOTAL_FIELD_CANDIDATES.find((k) => merged[k] != null);
    total = presentTotalKey ? Number(merged[presentTotalKey]) : 0;
    for (const k of TOTAL_FIELD_CANDIDATES) if (merged[k] != null) merged[k] = total;
    // A single-figure quote (negotiation/alternate-offer) — the new figure the admin gave
    // becomes the new floor going forward, not just a one-off display number.
    if (merged.minimum_acceptable_myr != null) merged.minimum_acceptable_myr = total;
  }

  return { snapshot: merged, total, hasLineItems };
}

function formatLineItems(snapshot) {
  const lines = Object.entries(LINE_ITEM_LABELS)
    .filter(([key]) => snapshot[key] != null)
    .map(([key, label]) => `- ${label}: MYR ${Number(snapshot[key]).toFixed(2)}`);
  if (snapshot.discount_applied_myr) lines.push(`- Discount: − MYR ${Number(snapshot.discount_applied_myr).toFixed(2)}`);
  return lines.join("\n");
}

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

    const contextPrompt = `PENDING ACTION AWAITING APPROVAL:\nType: ${pending_action.action_type}\nSummary: ${pending_action.summary}\nQuote details: ${JSON.stringify(pending_action.quote_snapshot || {}, null, 2)}\n\n${historyText ? `PRIOR CONVERSATION THIS SESSION:\n${historyText}\n\n` : ""}ADMIN JUST SAID:\n"${admin_message}"\n\nReply as ARIA and end with the [DECISION: ...] and [QUOTE_PATCH: ...] markers.`;

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

    const patchMatch = text.match(/\[QUOTE_PATCH:\s*(\{[\s\S]*?\}|none)\s*\]/i);
    const snapshot = pending_action.quote_snapshot || {};
    let quotePatch = null;
    if (patchMatch && patchMatch[1].toLowerCase() !== "none") {
      try {
        quotePatch = validatePatch(JSON.parse(patchMatch[1]), snapshot);
      } catch {
        quotePatch = null; // malformed JSON from the model — treat as no patch, not a crash
      }
    }

    let reply_text = text
      .replace(/\[DECISION:[^\]]*\]/i, "")
      .replace(/\[QUOTE_PATCH:[\s\S]*?\]/i, "")
      .trim() || "Got it, boss.";

    // Safety net: never let an edit request get silently approved unchanged because the model
    // failed to capture it as a patch — that's the exact failure mode this design replaces.
    // Deliberately scoped to ONLY this message, not the full chat history: an edit keyword
    // from an earlier, already-resolved exchange (chat history persists across actions) would
    // otherwise re-trigger this on completely unrelated later turns, recreating the same kind
    // of stuck-loop bug this is meant to prevent.
    const adminDescribedAnEdit = EDIT_INTENT_RE.test(admin_message) || /\d{3,}/.test(admin_message.replace(/,/g, ""));
    if (decision === "approve" && !quotePatch && adminDescribedAnEdit) {
      decision = "clarify";
      reply_text = "Just want to get the numbers exactly right — can you confirm precisely what should change (e.g. \"set discount to 0\" or \"escort fee to 150\")?";
    }

    let revised = null;

    if (decision === "approve" && quotePatch) {
      const { snapshot: newSnapshot, total, hasLineItems } = applyPatch(snapshot, quotePatch);

      const regenPrompt = hasLineItems
        ? `The sales admin has just instructed you, via WhatsApp chat, to amend this quote. Use EXACTLY these figures — do not recalculate, do not call any tools, do not change any number:\n${formatLineItems(newSnapshot)}\n- TOTAL: MYR ${total.toFixed(2)}\n${newSnapshot.valid_until ? `- Valid Until: ${newSnapshot.valid_until}\n` : ""}\nContext: ${pending_action.summary}\nClient: ${client_name || "the client"}\n\nPreviously drafted email (for tone/structure reference only — replace the figures with the ones above):\n"""\n${original_email_body || "(no prior draft available)"}\n"""\n\nDraft a fresh client email using these exact figures, formatted as a simple dash-bulleted list (not a markdown table).\n\nIMPORTANT — for the WhatsApp message only, override the system prompt's usual "draft pending approval" framing: the admin has ALREADY approved this in chat, so you are confirming a completed action, not requesting sign-off. Write a brief WhatsApp CONFIRMATION, never asking for further approval.\n\nUse the standard [EMAIL_DRAFT] and [WHATSAPP_MESSAGE] markers.`
        : `The sales admin has just instructed you, via WhatsApp chat, to change the price on this pending action to MYR ${total}. This new figure is final — do not recalculate it, do not call any tools, just use it exactly.\n\nContext: ${pending_action.summary}\nClient: ${client_name || "the client"}\n\nPreviously drafted email (for tone/structure reference only — replace the price with the new figure, keep the rest consistent):\n"""\n${original_email_body || "(no prior draft available)"}\n"""\n\nDraft a fresh client email using EXACTLY MYR ${total} as the offered/final price.\n\nIMPORTANT — for the WhatsApp message only, override the system prompt's usual "draft pending approval" framing: the admin has ALREADY approved this in chat, so you are confirming a completed action, not requesting sign-off. Write a brief WhatsApp CONFIRMATION (e.g. "Done boss — sent ${client_name || "the client"} the revised offer at MYR ${total} ✅"), never asking for further approval.\n\nUse the standard [EMAIL_DRAFT] and [WHATSAPP_MESSAGE] markers.`;

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
        amount_myr: total,
        email_body: emailBody,
        quote_snapshot: newSnapshot,
      };

      if (waBody) reply_text = waBody;
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
