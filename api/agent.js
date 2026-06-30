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
    name: "get_distance_real",
    description:
      "Calculates the real round-trip distance for hub → pickup → destination → hub using live routing data.",
    input_schema: {
      type: "object",
      properties: {
        hub_address: { type: "string", description: "Defaults to Mactrans HQ if omitted" },
        origin: { type: "string" },
        destination: { type: "string" },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "calculate_cost_per_km",
    description:
      "Calculates the operating cost per kilometre (fuel + maintenance) for the planned round trip.",
    input_schema: {
      type: "object",
      properties: {
        round_trip_km: { type: "number" },
        fuel_price_myr_per_liter: { type: "number" },
        truck_fuel_efficiency_km_per_liter: { type: "number" },
      },
      required: ["round_trip_km"],
    },
  },
  {
    name: "get_weather_forecast",
    description:
      "Retrieves the weather outlook for the destination region on the requested ship date, falling back to seasonal historical prediction for long-range dates.",
    input_schema: {
      type: "object",
      properties: {
        destination_region: { type: "string" },
        ship_date: { type: "string" },
      },
      required: ["destination_region", "ship_date"],
    },
  },
  {
    name: "get_route_incident_log",
    description:
      "Retrieves historical driver-logged incidents for this route (bridge clearances, potholes, narrow corners, recurring congestion, flood history).",
    input_schema: {
      type: "object",
      properties: {
        route_id: { type: "string" },
      },
      required: ["route_id"],
    },
  },
  {
    name: "get_fleet_status",
    description:
      "Checks the truck engine-management system for fleet condition (tire wear, brake inspection history) and flags any truck unsuitable for the route conditions.",
    input_schema: {
      type: "object",
      properties: {
        required_truck_type: { type: "string", enum: ["flatbed_standard", "flatbed_with_escort"] },
      },
      required: ["required_truck_type"],
    },
  },
  {
    name: "select_truck_and_driver",
    description:
      "Confirms and locks in the selected truck and driver for the trip given the route risk summary.",
    input_schema: {
      type: "object",
      properties: {
        route_risk_summary: { type: "string" },
        recommended_truck_id: { type: "string" },
      },
      required: ["recommended_truck_id"],
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
      "Calculates the final client quotation by applying real distance-driven cost, fuel surcharges, handling fees, insurance, weather contingency, and the target profit margin.",
    input_schema: {
      type: "object",
      properties: {
        base_rate_myr: { type: "number", description: "Used only if round_trip_km/cost_per_km_myr are unavailable" },
        round_trip_km: { type: "number" },
        cost_per_km_myr: { type: "number" },
        weight_kg: { type: "number" },
        fuel_surcharge_pct: { type: "number" },
        has_insurance: { type: "boolean" },
        has_escort: { type: "boolean" },
        weather_risk_contingency_pct: { type: "number" },
        target_margin_pct: { type: "number" },
      },
      required: ["fuel_surcharge_pct", "target_margin_pct"],
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

  // Strip stray markdown bolding Claude sometimes wraps around its own section tags
  // (e.g. "**[EMAIL_DRAFT]**"), which our marker regex doesn't consume.
  const stripLeadingMarkdown = (s) => (s || '').trim().replace(/^\*+\s*/, '').trim();

  const emailBody = emailMatch ? stripLeadingMarkdown(emailMatch[1]) : null;
  const waBody = waMatch ? stripLeadingMarkdown(waMatch[1]) : null;

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
      userMessage = `The quote has been manually amended by the operations team. Please regenerate ONLY the client email draft and the WhatsApp approval request using the following updated values:\n\n${JSON.stringify(amended_values, null, 2)}\n\nUse the same client and RFQ details from the previous run (Ahmad Farouk, Global Construct, RFQ #MC-2026-0441). Remember the email is still a DRAFT pending admin approval — do not say it has been sent.`;
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
                  distance_cost_myr: quoteData.distance_cost_myr,
                  weather_contingency_myr: quoteData.weather_contingency_myr,
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

            let emailRef = null;

            // Email draft event (status: draft — admin approval required before "send")
            if (emailBody) {
              emailRef = "email-1";
              sendEvent(res, {
                type: "email_draft",
                email_ref: emailRef,
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

            // WhatsApp event — this is ARIA asking the admin for approval, not a confirmation
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

            // Admin-approval gate: nothing is "sent" until the admin approves via WhatsApp chat
            if (emailBody && emailRef) {
              sendEvent(res, {
                type: "pending_action",
                action_id: `act-${Date.now()}`,
                action_type: mode === "regenerate_email" ? "send_amended_quote_email" : "send_quote_email",
                summary: quoteData
                  ? `Send quotation email to Ahmad Farouk for MYR ${quoteData.final_quote_myr}, valid until ${quoteData.valid_until}?`
                  : "Send the drafted quotation email to the client?",
                email_ref: emailRef,
                whatsapp_prompt: waBody || "Boss, quote's ready — approve to send?",
                quote_snapshot: quoteData,
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

          // Execute mock tool (some, like get_distance_real, are async — await is a no-op for sync results)
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

    // Stream done event — this means the SSE stream finished, NOT that anything was sent
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
