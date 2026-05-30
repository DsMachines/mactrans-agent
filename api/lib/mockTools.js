// Hardcoded mock tool implementations for ARIA (used server-side in api/agent.js and api/negotiate.js)
// Using CommonJS exports as required for isolated Vercel serverless environment.

const extract_rfq_data = (args) => ({
  rfq_id: "MC-2026-0441",
  client_name: "Global Construct Sdn Bhd",
  contact_person: "Ahmad Farouk",
  contact_email: "procurement@globalconstruct.com.my",
  cargo_type: "industrial_machinery",
  cargo_description: "CNC milling machines (3 units), crated",
  weight_kg: 12000,
  dimensions_m3: 42,
  origin: "Kuala Lumpur (Cheras Industrial Zone)",
  destination: "Penang Port, Butterworth",
  required_by_date: "2026-07-05",
  special_requirements: ["flatbed_required", "escort_vehicle", "insurance_required"],
  parsed_confidence: "high"
});

const get_route = (args) => ({
  route_id: "KL-PNG-001",
  distance_km: 370,
  estimated_hours: 4.5,
  highway: "North-South Expressway (E1)",
  traffic_status: "Heavy — peak hour congestion expected near Ipoh interchange",
  toll_cost_myr: 87.40,
  recommended_departure: "05:00 local time to avoid congestion"
});

const get_market_rate = (args) => ({
  base_rate_myr: 3200,
  rate_basis: "per_trip_flatbed",
  market_low_myr: 2800,
  market_high_myr: 3600,
  fuel_surcharge_pct: 15,
  recommended_margin_pct: 22,
  data_source: "Mactrans Rate Table v2026-Q2"
});

const get_carrier_availability = (args) => ({
  available_carriers: [
    { carrier_id: "TPE-001", name: "Trans-Peninsular Express Sdn Bhd", truck_type: "flatbed_with_escort", rating: 4.8, confirmed_available: true },
    { carrier_id: "NHT-003", name: "Northern Haulage & Transport", truck_type: "flatbed_standard", rating: 4.5, confirmed_available: true }
  ],
  recommended_carrier_id: "TPE-001",
  availability_confirmed_until: "2026-06-03T23:59"
});

const calculate_quote = (args) => ({
  base_rate_myr: 3200,
  fuel_surcharge_myr: 480,
  insurance_fee_myr: 150,
  escort_fee_myr: 200,
  handling_fee_myr: 50,
  subtotal_myr: 4080,
  applied_margin_pct: 22,
  discount_applied_myr: 200,
  final_quote_myr: 3880,
  minimum_acceptable_myr: 3492,
  breakeven_myr: 3080,
  currency: "MYR",
  valid_until: "2026-06-06"
});

const evaluate_counter_offer = ({ original_quote_myr, counter_offer_myr, minimum_acceptable_myr }) => {
  const discount_pct = ((original_quote_myr - counter_offer_myr) / original_quote_myr) * 100;
  if (counter_offer_myr >= original_quote_myr) {
    return {
      decision: "accept",
      discount_pct: 0,
      reasoning: "Counter-offer meets or exceeds our quote. Accept immediately."
    };
  }
  if (counter_offer_myr >= minimum_acceptable_myr) {
    return {
      decision: "accept",
      discount_pct: parseFloat(discount_pct.toFixed(1)),
      reasoning: `Discount of ${discount_pct.toFixed(1)}% is within our 10% maximum threshold. Accept.`
    };
  }
  return {
    decision: "counter",
    discount_pct: parseFloat(discount_pct.toFixed(1)),
    counter_offer_myr: minimum_acceptable_myr,
    reasoning: `Client's offer of MYR ${counter_offer_myr} represents a ${discount_pct.toFixed(1)}% discount — exceeds our 10% floor. Counter at MYR ${minimum_acceptable_myr}.`
  };
};

module.exports = {
  extract_rfq_data,
  get_route,
  get_market_rate,
  get_carrier_availability,
  calculate_quote,
  evaluate_counter_offer
};
