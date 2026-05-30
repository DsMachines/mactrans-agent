// src/data/fallbackPayload.js
// Safe Mode: pre-recorded perfect run sequence for reliable presentation fallback.
// This contains every single event, fully populated, with no placeholders.

export const FALLBACK_EVENTS = [
  { type: "thinking", content: "Received RFQ from Ahmad Farouk at Global Construct Sdn Bhd. Initiating extraction of cargo parameters from this unformatted email..." },
  { type: "tool_call", name: "extract_rfq_data", args: { raw_text: "(full RFQ text)" } },
  { type: "tool_response", name: "extract_rfq_data", result: { rfq_id: "MC-2026-0441", client_name: "Global Construct Sdn Bhd", contact_person: "Ahmad Farouk", contact_email: "procurement@globalconstruct.com.my", cargo_type: "industrial_machinery", cargo_description: "CNC milling machines (3 units), crated", weight_kg: 12000, dimensions_m3: 42, origin: "Kuala Lumpur (Cheras Industrial Zone)", destination: "Penang Port, Butterworth", required_by_date: "2026-07-05", special_requirements: ["flatbed_required", "escort_vehicle", "insurance_required"], parsed_confidence: "high" } },
  { type: "thinking", content: "Cargo extracted: 12,000kg CNC machinery, KL to Penang Port. Need flatbed, escort, and insurance. Let me check the route conditions..." },
  { type: "tool_call", name: "get_route", args: { origin: "Kuala Lumpur", destination: "Penang Port", cargo_type: "industrial_machinery" } },
  { type: "tool_response", name: "get_route", result: { route_id: "KL-PNG-001", distance_km: 370, estimated_hours: 4.5, highway: "North-South Expressway (E1)", traffic_status: "Heavy — peak hour congestion expected near Ipoh interchange", toll_cost_myr: 87.40, recommended_departure: "05:00 local time" } },
  { type: "thinking", content: "Route confirmed: 370km via E1, ~4.5 hours. Heavy traffic near Ipoh. Now checking market rates for this cargo class..." },
  { type: "tool_call", name: "get_market_rate", args: { route_id: "KL-PNG-001", cargo_type: "industrial_machinery", weight_kg: 12000 } },
  { type: "tool_response", name: "get_market_rate", result: { base_rate_myr: 3200, rate_basis: "per_trip_flatbed", market_low_myr: 2800, market_high_myr: 3600, fuel_surcharge_pct: 15, recommended_margin_pct: 22, data_source: "Mactrans Rate Table v2026-Q2" } },
  { type: "thinking", content: "Base rate MYR 3,200 with 22% margin recommended. Checking carrier availability for a flatbed with escort..." },
  { type: "tool_call", name: "get_carrier_availability", args: { route_id: "KL-PNG-001", required_by_date: "2026-07-05", special_requirements: ["flatbed_required", "escort_vehicle"] } },
  { type: "tool_response", name: "get_carrier_availability", result: { available_carriers: [{ carrier_id: "TPE-001", name: "Trans-Peninsular Express Sdn Bhd", truck_type: "flatbed_with_escort", rating: 4.8, confirmed_available: true }], recommended_carrier_id: "TPE-001" } },
  { type: "thinking", content: "Trans-Peninsular Express confirmed available, rated 4.8. Now calculating the final quote with all surcharges..." },
  { type: "tool_call", name: "calculate_quote", args: { base_rate_myr: 3200, fuel_surcharge_pct: 15, has_insurance: true, has_escort: true, target_margin_pct: 22 } },
  { type: "tool_response", name: "calculate_quote", result: { base_rate_myr: 3200, fuel_surcharge_myr: 480, insurance_fee_myr: 150, escort_fee_myr: 200, handling_fee_myr: 50, subtotal_myr: 4080, applied_margin_pct: 22, discount_applied_myr: 200, final_quote_myr: 3880, minimum_acceptable_myr: 3492, breakeven_myr: 3080, currency: "MYR", valid_until: "2026-06-06" } },
  { type: "rate_card", data: { base_rate_myr: 3200, fuel_surcharge_myr: 480, insurance_fee_myr: 150, escort_fee_myr: 200, handling_fee_myr: 50, total_quote_myr: 3880, currency: "MYR", valid_until: "2026-06-06", carrier: "Trans-Peninsular Express Sdn Bhd" } },
  { type: "thinking", content: "Quote calculated: MYR 3,880 total. Margin is 22%. Now composing the professional quotation email and internal WhatsApp alert..." },
  { type: "email_draft", from: "aria@mactrans.com.my", from_name: "ARIA — Mactrans Logistics", to: "procurement@globalconstruct.com.my", to_name: "Ahmad Farouk, Global Construct Sdn Bhd", subject: "RE: RFQ #MC-2026-0441 — Freight Quotation: KL to Penang Port", timestamp: "30 Jun 2026, 14:32", body: "Dear Mr. Ahmad,\n\nThank you for submitting RFQ #MC-2026-0441. We are pleased to provide our quotation for the transport of your CNC milling machines (3 units, crated) from Cheras Industrial Zone, Kuala Lumpur to Penang Port, Butterworth.\n\n**Quotation Summary:**\n- Base Freight Rate: MYR 3,200.00\n- Fuel Surcharge (15%): MYR 480.00\n- Cargo Insurance: MYR 150.00\n- Escort Vehicle: MYR 200.00\n- Handling: MYR 50.00\n- **Total: MYR 3,880.00**\n\n**Carrier:** Trans-Peninsular Express Sdn Bhd (Rating: 4.8/5)\n**Estimated Transit:** 4.5 hours via North-South Expressway\n**Quote Valid Until:** 6 July 2026\n\nThis quote includes full cargo insurance coverage and a dedicated escort vehicle as requested. We recommend a 05:00 departure to avoid peak congestion near the Ipoh interchange.\n\nPlease confirm your acceptance and we will proceed with booking immediately.\n\nWarm regards,\nARIA | Mactrans Logistics Sdn Bhd | aria@mactrans.com.my" },
  { type: "whatsapp_msg", sender: "ARIA Bot", avatar_initials: "AB", timestamp: "2:32 PM", content: "Boss, new job locked in 🚛 Global Construct, KL → Penang Port, 12T machinery. Quoted MYR 3,880. Margin is 22%. Email sent. Standing by, boss. ✅" },
  { type: "done" }
];

export const PLAYBACK_DELAYS_MS = [
  800, 400, 600, 1200, 400, 600, 1000, 400, 600, 1200, 400, 600, 1000, 400, 600, 400, 1400, 2200, 600, 0
];
