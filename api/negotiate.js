// api/negotiate.js — Counter-offer negotiation endpoint for ARIA
// Vercel Serverless Function (Node.js 20, CommonJS)
// Receives POST with counter-offer data → streams SSE events back to React frontend
//
// Two modes:
//  - default: evaluate a client counter-offer against the 10% discount floor
//  - mode: "alternate_date": client pushed for MORE discount than approved — re-run a
//    recognizable subset of the analysis (idle schedule / weather / traffic) and propose
//    a different ship date at a mechanically-lower price.

const Anthropic = require("@anthropic-ai/sdk");
const SYSTEM_PROMPT = require("./lib/systemPrompt");
const tools = require("./lib/mockTools");

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

const ALTERNATE_DATE_TOOLS = [
  ...NEGOTIATE_TOOLS,
  {
    name: "check_alternate_schedule",
    description:
      "Checks for an alternate ship date where trucks/drivers have idle capacity and traffic/weather conditions are more favorable, enabling a mechanically lower price.",
    input_schema: {
      type: "object",
      properties: {
        route_id: { type: "string" },
        current_ship_date: { type: "string" },
      },
      required: ["route_id"],
    },
  },
  {
    name: "calculate_quote",
    description:
      "Recalculates the quote for the alternate date, typically with a lower weather risk contingency given the more favorable window.",
    input_schema: {
      type: "object",
      properties: {
        base_rate_myr: { type: "number" },
        fuel_surcharge_pct: { type: "number" },
        has_insurance: { type: "boolean" },
        has_escort: { type: "boolean" },
        weather_risk_contingency_pct: { type: "number" },
        target_margin_pct: { type: "number" },
      },
      required: ["base_rate_myr", "fuel_surcharge_pct", "target_margin_pct"],
    },
  },
];

// ─── SSE helper ────────────────────────────────────────────────────────────
function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ─── Parse Claude's final text for email + WhatsApp blocks ─────────────────
// Same clean marker convention as api/agent.js (replaces the old fragile "Dear Mr./Ms." sniff).
function parseOutputBlocks(text) {
  const emailMatch = text.match(/\[EMAIL_DRAFT\]([\s\S]*?)(\[WHATSAPP_MESSAGE\]|$)/);
  const waMatch = text.match(/\[WHATSAPP_MESSAGE\]([\s\S]*?)$/);

  // Strip stray markdown Claude sometimes wraps around its own section tags
  // (e.g. "**[EMAIL_DRAFT]**" or a "---" rule right before "**[WHATSAPP_MESSAGE]**"),
  // which our marker regex captures as part of the surrounding text but doesn't consume.
  const cleanMarkdownEdges = (s) => (s || '').trim().replace(/^\*+\s*/, '').replace(/[\s\-*]+$/, '').trim();

  const emailBody = emailMatch ? cleanMarkdownEdges(emailMatch[1]) : null;
  const waBody = waMatch ? cleanMarkdownEdges(waMatch[1]) : null;

  return { emailBody, waBody };
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
    mode,
    original_quote_myr,
    minimum_acceptable_myr,
    counter_offer_myr,
    client_name,
    rfq_id,
    // Used only when mode === "alternate_date" — carried over from the rate card snapshot
    base_rate_myr,
    fuel_surcharge_pct,
    has_insurance,
    has_escort,
    target_margin_pct,
    route_id,
    current_ship_date,
  } = req.body;

  if (!original_quote_myr || !counter_offer_myr || !minimum_acceptable_myr) {
    sendEvent(res, {
      type: "error",
      message: "Missing required negotiation parameters.",
    });
    res.end();
    return;
  }

  const isAlternateDate = mode === "alternate_date";
  const anthropic = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // ── Terminal separator to signal re-engagement ─────────────────────────
  sendEvent(res, {
    type: "thinking",
    content: isAlternateDate
      ? `--- CLIENT PUSHING FOR MORE — RE-ENGAGING ARIA ---\n\n${client_name} is asking for a discount beyond what was already approved. I will check whether a different ship date opens up a genuinely cheaper window before responding.`
      : `--- COUNTER-OFFER RECEIVED — RE-ENGAGING ARIA ---\n\n${client_name} has submitted a counter-offer of MYR ${counter_offer_myr} against our original quote of MYR ${original_quote_myr}.\n\nI will now evaluate this against Mactrans business rules (maximum 10% discount floor of MYR ${minimum_acceptable_myr}).`,
  });

  try {
    const negotiatePrompt = isAlternateDate
      ? `${client_name} is pushing for a further discount beyond our approved floor of MYR ${minimum_acceptable_myr} on RFQ ${rfq_id} (current offer on the table: MYR ${counter_offer_myr}).\n\nFirst call evaluate_counter_offer again with original_quote_myr=${original_quote_myr}, counter_offer_myr=${counter_offer_myr}, minimum_acceptable_myr=${minimum_acceptable_myr} to reconfirm we cannot go lower on this date.\n\nThen call check_alternate_schedule for route_id="${route_id || 'KUA-PEN-001'}" and current_ship_date="${current_ship_date || ''}" to see if a different ship date has idle capacity and better conditions.\n\nThen call calculate_quote with base_rate_myr=${base_rate_myr || 3200}, fuel_surcharge_pct=${fuel_surcharge_pct || 15}, has_insurance=${has_insurance !== false}, has_escort=${has_escort !== false}, target_margin_pct=${target_margin_pct || 22}, and weather_risk_contingency_pct=0 (the alternate window has better weather, so no contingency needed) to produce a genuinely lower number driven by the better window, not an arbitrary discount.\n\nThen draft an email to the client proposing the alternate date and new price as "we found a more efficient window," not as a discount concession, and a WhatsApp message asking the admin to approve sending it. Never reveal breakeven or internal cost structure.`
      : `A counter-offer has arrived from ${client_name} for RFQ ${rfq_id}.\n\nOriginal quote: MYR ${original_quote_myr}\nClient counter-offer: MYR ${counter_offer_myr}\nOur minimum acceptable price (10% floor): MYR ${minimum_acceptable_myr}\n\nPlease call evaluate_counter_offer to determine the business decision, then draft the appropriate reply email and a WhatsApp message asking the admin to approve sending it.\n\nRemember: never reveal breakeven or internal cost structure. Keep the reply professional and relationship-focused. The email is a DRAFT pending admin approval — do not say it has been sent.`;

    const messages = [{ role: "user", content: negotiatePrompt }];
    let continueLoop = true;
    let negotiationResult = null;
    let alternateScheduleResult = null;
    let alternateQuoteResult = null;

    const toolSet = isAlternateDate ? ALTERNATE_DATE_TOOLS : NEGOTIATE_TOOLS;

    while (continueLoop) {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        tools: toolSet,
        messages,
      });

      const toolResults = [];

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          sendEvent(res, { type: "thinking", content: block.text.trim() });

          // On final text, parse email + WhatsApp + emit the result event
          if (response.stop_reason === "end_turn") {
            const { emailBody, waBody } = parseOutputBlocks(block.text);

            if (isAlternateDate && alternateScheduleResult) {
              sendEvent(res, {
                type: "alternate_offer",
                original_offer_myr: counter_offer_myr,
                requested_myr: counter_offer_myr,
                alternate_date: alternateScheduleResult.alternate_date,
                alternate_quote_myr: alternateQuoteResult ? alternateQuoteResult.final_quote_myr : null,
                savings_vs_original_pct: alternateScheduleResult.estimated_savings_pct,
                reasoning: alternateScheduleResult.reason,
                counter_email_body: emailBody,
                whatsapp_update: waBody,
              });

              if (emailBody) {
                sendEvent(res, {
                  type: "pending_action",
                  action_id: `act-${Date.now()}`,
                  action_type: "send_alternate_offer",
                  summary: `Send alternate-date offer to ${client_name}: ship ${alternateScheduleResult.alternate_date} at MYR ${alternateQuoteResult ? alternateQuoteResult.final_quote_myr : '(recalculated)'}?`,
                  email_ref: "email-alternate-offer",
                  whatsapp_prompt: waBody || "Boss, found a cheaper window for this client — approve to send?",
                  quote_snapshot: alternateQuoteResult,
                });
              }
            } else if (!isAlternateDate && negotiationResult) {
              sendEvent(res, {
                type: "negotiation_result",
                decision: negotiationResult.decision,
                reasoning: negotiationResult.reasoning,
                counter_offer_myr: negotiationResult.counter_offer_myr || null,
                discount_pct: negotiationResult.discount_pct,
                counter_email_body: emailBody,
                whatsapp_update: waBody,
              });

              if (emailBody) {
                sendEvent(res, {
                  type: "pending_action",
                  action_id: `act-${Date.now()}`,
                  action_type: "send_negotiation_reply",
                  summary: `Send ${negotiationResult.decision === 'accept' ? 'acceptance' : 'counter-offer'} reply to ${client_name}?`,
                  email_ref: "email-negotiation-reply",
                  whatsapp_prompt: waBody || "Boss, drafted a reply to the client's counter-offer — approve to send?",
                  quote_snapshot: {
                    decision: negotiationResult.decision,
                    original_quote_myr,
                    counter_offer_myr,
                    final_offer_myr: negotiationResult.counter_offer_myr || original_quote_myr,
                    minimum_acceptable_myr,
                  },
                });
              }
            }
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
            try {
              result = await toolFn(block.input);
            } catch (toolErr) {
              result = { error: `Tool ${block.name} failed: ${toolErr.message}` };
            }
          } else {
            result = { error: `Unknown tool: ${block.name}` };
          }

          if (block.name === "evaluate_counter_offer") {
            negotiationResult = result;
          }
          if (block.name === "check_alternate_schedule") {
            alternateScheduleResult = result;
          }
          if (block.name === "calculate_quote") {
            alternateQuoteResult = result;
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
