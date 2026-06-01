// api/agent.js — Primary SSE streaming endpoint for ARIA
// Vercel Serverless Function (Node.js 20, CommonJS)
// Receives POST {rfq_text} → streams SSE events back to React frontend

const Anthropic = require("@anthropic-ai/sdk");
const SYSTEM_PROMPT = require("./lib/systemPrompt");
const tools = require("./lib/mockTools");

// ─── Tool schemas for Claude ───────────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    name: "extract_rfq_data",
    description:
      "Extracts structured cargo data from a raw, unformatted RFQ or logistics manifest text.",
    input_schema: {
      type: "object",
      properties: {
        raw_text: {
          type: "string",
          description: "The unformatted RFQ text to parse",
        },
      },
      required: ["raw_text"],
    },
  },
  {
    name: "get_route",
    description:
      "Returns routing data including distance, estimated transit time, and current traffic conditions between two Malaysian cities.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        destination: { type: "string" },
        cargo_type: { type: "string" },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "get_market_rate",
    description:
      "Queries the internal rate database to return market benchmark pricing for a given cargo type and route.",
    input_schema: {
      type: "object",
      properties: {
        route_id: { type: "string" },
        cargo_type: { type: "string" },
        weight_kg: { type: "number" },
      },
      required: ["route_id", "cargo_type", "weight_kg"],
    },
  },
  {
    name: "get_carrier_availability",
    description:
      "Checks the internal carrier fleet database for available trucks matching the cargo requirements on the requested date.",
    input_schema: {
      type: "object",
      properties: {
        route_id: { type: "string" },
        required_by_date: { type: "string" },
        special_requirements: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["route_id", "required_by_date"],
    },
  },
  {
    name: "calculate_quote",
    description:
      "Calculates the final client quotation by applying fuel surcharges, handling fees, insurance, and the target profit margin to the base market rate.",
    input_schema: {
      type: "object",
      properties: {
        base_rate_myr: { type: "number" },
        fuel_surcharge_pct: { type: "number" },
        has_insurance: { type: "boolean" },
        has_escort: { type: "boolean" },
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
function parseOutputBlocks(text) {
  const emailMatch = text.match(/\[EMAIL_DRAFT\]([\s\S]*?)(\[WHATSAPP_MESSAGE\]|$)/);
  const waMatch = text.match(/\[WHATSAPP_MESSAGE\]([\s\S]*?)$/);

  const emailBody = emailMatch ? emailMatch[1].trim() : null;
  const waBody = waMatch ? waMatch[1].trim() : null;

  return { emailBody, waBody };
}

// ─── Main handler ──────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Only accept POST
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

  const { rfq_text, mode, amended_values } = req.body;

  if (!rfq_text && mode !== "regenerate_email") {
    sendEvent(res, { type: "error", message: "No RFQ text provided." });
    res.end();
    return;
  }

  const anthropic = new Anthropic.default({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    // ── Build initial message ──────────────────────────────────────────────
    let userMessage;
    if (mode === "regenerate_email" && amended_values) {
      userMessage = `The quote has been manually amended by the operations team. Please regenerate ONLY the client email and internal WhatsApp message using the following updated values:\n\n${JSON.stringify(amended_values, null, 2)}\n\nUse the same client and RFQ details from the previous run (Ahmad Farouk, Global Construct, RFQ #MC-2026-0441).`;
    } else {
      userMessage = `Please process this incoming RFQ:\n\n${rfq_text}`;
    }

    const messages = [{ role: "user", content: userMessage }];

    // ── Agentic loop ───────────────────────────────────────────────────────
    let continueLoop = true;
    let quoteData = null; // Captured from calculate_quote tool result

    while (continueLoop) {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS,
        messages,
      });

      // ── Process each content block ───────────────────────────────────────
      const toolResults = [];

      for (const block of response.content) {
        if (block.type === "text") {
          // Stream thinking text to terminal
          if (block.text.trim()) {
            sendEvent(res, { type: "thinking", content: block.text.trim() });
          }

          // On final stop_reason=end_turn, parse output blocks
          if (response.stop_reason === "end_turn") {
            const { emailBody, waBody } = parseOutputBlocks(block.text);

            // Build rate card event from captured quote data
            if (quoteData) {
              sendEvent(res, {
                type: "rate_card",
                data: {
                  base_rate_myr: quoteData.base_rate_myr,
                  fuel_surcharge_myr: quoteData.fuel_surcharge_myr,
                  insurance_fee_myr: quoteData.insurance_fee_myr,
                  escort_fee_myr: quoteData.escort_fee_myr,
                  handling_fee_myr: quoteData.handling_fee_myr,
                  subtotal_myr: quoteData.subtotal_myr,
                  applied_margin_pct: quoteData.applied_margin_pct,
                  discount_applied_myr: quoteData.discount_applied_myr,
                  total_quote_myr: quoteData.final_quote_myr,
                  minimum_acceptable_myr: quoteData.minimum_acceptable_myr,
                  currency: "MYR",
                  valid_until: quoteData.valid_until,
                  carrier: "Trans-Peninsular Express Sdn Bhd",
                },
              });
            }

            // Email draft event
            if (emailBody) {
              sendEvent(res, {
                type: "email_draft",
                from: "aria@mactrans.com.my",
                from_name: "ARIA — Mactrans Logistics",
                to: "procurement@globalconstruct.com.my",
                to_name: "Ahmad Farouk, Global Construct Sdn Bhd",
                subject:
                  "RE: RFQ #MC-2026-0441 — Freight Quotation: KL to Penang Port",
                timestamp: new Date().toLocaleString("en-MY", {
                  timeZone: "Asia/Kuala_Lumpur",
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                body: emailBody,
              });
            }

            // WhatsApp event
            if (waBody) {
              sendEvent(res, {
                type: "whatsapp_msg",
                sender: "ARIA Bot",
                avatar_initials: "AB",
                timestamp: new Date().toLocaleTimeString("en-MY", {
                  timeZone: "Asia/Kuala_Lumpur",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                content: waBody,
              });
            }
          }
        }

        if (block.type === "tool_use") {
          // Stream tool_call event to terminal
          sendEvent(res, {
            type: "tool_call",
            name: block.name,
            args: block.input,
          });

          // Execute mock tool
          const toolFn = tools[block.name];
          let result;
          if (toolFn) {
            result = toolFn(block.input);
          } else {
            result = { error: `Unknown tool: ${block.name}` };
          }

          // Capture quote data for rate_card event
          if (block.name === "calculate_quote") {
            quoteData = result;
          }

          // Stream tool_response event to terminal
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

      // ── Decide whether to continue the loop ──────────────────────────────
      if (response.stop_reason === "tool_use") {
        // Claude wants to call more tools — append assistant + tool_results and loop
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });
      } else {
        // stop_reason === "end_turn" — Claude is done
        continueLoop = false;
      }
    }

    // Stream done event
    sendEvent(res, { type: "done" });
  } catch (err) {
    console.error("ARIA agent error:", err);
    sendEvent(res, {
      type: "error",
      message: err.message || "Unexpected error in ARIA agent.",
    });
  }

  res.end();
};
