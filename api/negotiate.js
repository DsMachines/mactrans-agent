// api/negotiate.js — Counter-offer negotiation endpoint for ARIA
// Vercel Serverless Function (Node.js 20, CommonJS)
// Receives POST with counter-offer data → streams SSE events back to React frontend

const Anthropic = require("@anthropic-ai/sdk");
const SYSTEM_PROMPT = require("./lib/systemPrompt");
const tools = require("./lib/mockTools");

// ─── Tool schema for evaluate_counter_offer only ───────────────────────────
const NEGOTIATE_TOOLS = [
  {
    name: "evaluate_counter_offer",
    description:
      "Evaluates a client counter-offer against Mactrans business rules. The maximum allowable discount from the original quote is exactly 10%. Returns a structured decision with reasoning.",
    input_schema: {
      type: "object",
      properties: {
        original_quote_myr: { type: "number" },
        counter_offer_myr: { type: "number" },
        minimum_acceptable_myr: { type: "number" },
      },
      required: [
        "original_quote_myr",
        "counter_offer_myr",
        "minimum_acceptable_myr",
      ],
    },
  },
];

// ─── SSE helper ────────────────────────────────────────────────────────────
function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ─── Main handler ──────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const {
    original_quote_myr,
    minimum_acceptable_myr,
    counter_offer_myr,
    client_name,
    rfq_id,
  } = req.body;

  if (!original_quote_myr || !counter_offer_myr || !minimum_acceptable_myr) {
    sendEvent(res, {
      type: "error",
      message: "Missing required negotiation parameters.",
    });
    res.end();
    return;
  }

  const anthropic = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // ── Terminal separator to signal re-engagement ─────────────────────────
  sendEvent(res, {
    type: "thinking",
    content: `--- COUNTER-OFFER RECEIVED — RE-ENGAGING ARIA ---\n\n${client_name} has submitted a counter-offer of MYR ${counter_offer_myr} against our original quote of MYR ${original_quote_myr}.\n\nI will now evaluate this against Mactrans business rules (maximum 10% discount floor of MYR ${minimum_acceptable_myr}).`,
  });

  try {
    const negotiatePrompt = `A counter-offer has arrived from ${client_name} for RFQ ${rfq_id}.\n\nOriginal quote: MYR ${original_quote_myr}\nClient counter-offer: MYR ${counter_offer_myr}\nOur minimum acceptable price (10% floor): MYR ${minimum_acceptable_myr}\n\nPlease call evaluate_counter_offer to determine the business decision, then draft the appropriate reply email and a WhatsApp update for the operations manager.\n\nRemember: never reveal breakeven or internal cost structure. Keep the reply professional and relationship-focused.`;

    const messages = [{ role: "user", content: negotiatePrompt }];
    let continueLoop = true;
    let negotiationResult = null;

    while (continueLoop) {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        tools: NEGOTIATE_TOOLS,
        messages,
      });

      const toolResults = [];

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          sendEvent(res, { type: "thinking", content: block.text.trim() });

          // On final text, parse email + WhatsApp + emit negotiation_result
          if (response.stop_reason === "end_turn" && negotiationResult) {
            // Extract email body (everything after a common header pattern)
            const emailMatch = block.text.match(
              /(?:\[EMAIL_DRAFT\]|Dear\s+(?:Mr\.|Ms\.|))([\s\S]+?)(?:\[WHATSAPP_MESSAGE\]|$)/
            );
            const waMatch = block.text.match(
              /\[WHATSAPP_MESSAGE\]([\s\S]+?)$/
            );

            const emailBody = emailMatch
              ? ("Dear " + emailMatch[1]).trim()
              : block.text.trim();
            const waBody = waMatch ? waMatch[1].trim() : null;

            sendEvent(res, {
              type: "negotiation_result",
              decision: negotiationResult.decision,
              reasoning: negotiationResult.reasoning,
              counter_offer_myr: negotiationResult.counter_offer_myr || null,
              discount_pct: negotiationResult.discount_pct,
              counter_email_body: emailBody,
              whatsapp_update: waBody,
            });
          }
        }

        if (block.type === "tool_use") {
          sendEvent(res, {
            type: "tool_call",
            name: block.name,
            args: block.input,
          });

          const toolFn = tools[block.name];
          let result;
          if (toolFn) {
            result = toolFn(block.input);
          } else {
            result = { error: `Unknown tool: ${block.name}` };
          }

          // Capture the negotiation decision
          if (block.name === "evaluate_counter_offer") {
            negotiationResult = result;
          }

          sendEvent(res, {
            type: "tool_response",
            name: block.name,
            result,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });
      } else {
        continueLoop = false;
      }
    }

    sendEvent(res, { type: "done" });
  } catch (err) {
    console.error("ARIA negotiate error:", err);
    sendEvent(res, {
      type: "error",
      message: err.message || "Unexpected error in negotiate endpoint.",
    });
  }

  res.end();
};
