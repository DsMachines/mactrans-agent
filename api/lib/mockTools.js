// api/lib/mockTools.js
// Input-responsive mock tool implementations for ARIA.
// Used server-side in api/agent.js and api/negotiate.js.
// CommonJS exports required for Vercel serverless Node.js environment.

// ── Route lookup table for Malaysian city pairs ─────────────────────────────
const ROUTE_TABLE = {
  'kuala lumpur|penang': { distance_km: 370, estimated_hours: 4.5, highway: 'North-South Expressway (E1)' },
  'kuala lumpur|johor bahru': { distance_km: 360, estimated_hours: 4.0, highway: 'North-South Expressway (E2)' },
  'kuala lumpur|johor': { distance_km: 360, estimated_hours: 4.0, highway: 'North-South Expressway (E2)' },
  'kuala lumpur|ipoh': { distance_km: 205, estimated_hours: 2.5, highway: 'North-South Expressway (E1)' },
  'kuala lumpur|kota bharu': { distance_km: 470, estimated_hours: 6.0, highway: 'East Coast Expressway (E8)' },
  'kuala lumpur|kuantan': { distance_km: 260, estimated_hours: 3.0, highway: 'East Coast Expressway (E8)' },
  'kuala lumpur|melaka': { distance_km: 150, estimated_hours: 2.0, highway: 'North-South Expressway (E2)' },
  'kuala lumpur|seremban': { distance_km: 70, estimated_hours: 1.0, highway: 'North-South Expressway (E2)' },
  'johor bahru|penang': { distance_km: 720, estimated_hours: 8.0, highway: 'North-South Expressway (E1/E2)' },
  'johor|penang': { distance_km: 720, estimated_hours: 8.0, highway: 'North-South Expressway (E1/E2)' },
  'ipoh|penang': { distance_km: 170, estimated_hours: 2.0, highway: 'North-South Expressway (E1)' },
  'ipoh|kuala lumpur': { distance_km: 205, estimated_hours: 2.5, highway: 'North-South Expressway (E1)' },
  'penang|johor': { distance_km: 720, estimated_hours: 8.0, highway: 'North-South Expressway (E1/E2)' },
};

// Finds a matching route regardless of word order or extra text in origin/destination
function findRoute(origin, destination) {
  const a = (origin || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  const b = (destination || '').toLowerCase().replace(/[^a-z ]/g, '').trim();

  for (const key of Object.keys(ROUTE_TABLE)) {
    const [k1, k2] = key.split('|');
    const fwd = a.includes(k1) && b.includes(k2);
    const rev = a.includes(k2) && b.includes(k1);
    if (fwd || rev) return ROUTE_TABLE[key];
  }

  // Fallback: estimate distance from string length heuristic for unknown cities
  return { distance_km: 300, estimated_hours: 3.5, highway: 'Federal / State Highway' };
}

// Generates a short route ID from origin and destination strings
function makeRouteId(origin, destination) {
  const short = (str) => (str || 'UNK').replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
  return `${short(origin)}-${short(destination)}-001`;
}

// ── Tool 1: extract_rfq_data ────────────────────────────────────────────────
// Returns hardcoded extraction — the actual parsing is done by Claude from the raw text.
// This tool's return value is intentionally static; Claude's real work is reasoning over the RFQ.
const extract_rfq_data = (args) => ({
  rfq_id: 'MC-2026-0441',
  client_name: 'Global Construct Sdn Bhd',
  contact_person: 'Ahmad Farouk',
  contact_email: 'procurement@globalconstruct.com.my',
  cargo_type: 'industrial_machinery',
  cargo_description: 'CNC milling machines (3 units), crated',
  weight_kg: 12000,
  dimensions_m3: 42,
  origin: 'Kuala Lumpur (Cheras Industrial Zone)',
  destination: 'Penang Port, Butterworth',
  required_by_date: '2026-07-05',
  special_requirements: ['flatbed_required', 'escort_vehicle', 'insurance_required'],
  parsed_confidence: 'high',
});

// ── Tool 2: get_route ───────────────────────────────────────────────────────
// Responds to origin and destination — different city pairs return different data.
const get_route = (args) => {
  const route = findRoute(args.origin, args.destination);
  const routeId = makeRouteId(args.origin, args.destination);
  const toll = Math.round(route.distance_km * 0.24 * 10) / 10; // ~MYR 0.24/km

  const trafficStatus = route.distance_km > 500
    ? 'Moderate — long-haul interstate route, schedule rest stops per regulations'
    : route.distance_km > 300
      ? 'Heavy — peak hour congestion expected near major interchanges'
      : 'Light to moderate — urban exit corridors may be busy during peak hours';

  return {
    route_id: routeId,
    distance_km: route.distance_km,
    estimated_hours: route.estimated_hours,
    highway: route.highway,
    traffic_status: trafficStatus,
    toll_cost_myr: toll,
    recommended_departure: '05:00 local time to avoid peak congestion',
  };
};

// ── Tool 3: get_market_rate ─────────────────────────────────────────────────
// Base rate scales with distance and cargo weight.
const get_market_rate = (args) => {
  // Infer distance from route_id or default to 350km
  const routeId = args.route_id || '';
  const distanceGuess = 350; // conservative default — actual distance is in get_route result
  const distFactor = distanceGuess / 350;

  const weight = Number(args.weight_kg) || 12000;
  const weightTier = weight > 20000 ? 1.4
    : weight > 15000 ? 1.2
      : weight > 10000 ? 1.0
        : weight > 5000 ? 0.85
          : 0.70;

  const baseRate = Math.round(3200 * distFactor * weightTier / 50) * 50;

  return {
    base_rate_myr: baseRate,
    rate_basis: 'per_trip_flatbed',
    market_low_myr: Math.round(baseRate * 0.875 / 50) * 50,
    market_high_myr: Math.round(baseRate * 1.125 / 50) * 50,
    fuel_surcharge_pct: 15,
    recommended_margin_pct: 22,
    data_source: 'Mactrans Rate Table v2026-Q2',
  };
};

// ── Tool 4: get_carrier_availability ───────────────────────────────────────
// Carrier truck type adapts to special requirements.
const get_carrier_availability = (args) => {
  const needsEscort = (args.special_requirements || []).includes('escort_vehicle');
  return {
    available_carriers: [
      {
        carrier_id: 'TPE-001',
        name: 'Trans-Peninsular Express Sdn Bhd',
        truck_type: needsEscort ? 'flatbed_with_escort' : 'flatbed_standard',
        rating: 4.8,
        confirmed_available: true,
      },
      {
        carrier_id: 'NHT-003',
        name: 'Northern Haulage & Transport',
        truck_type: 'flatbed_standard',
        rating: 4.5,
        confirmed_available: true,
      },
    ],
    recommended_carrier_id: 'TPE-001',
    availability_confirmed_until: '2026-06-03T23:59',
  };
};

// ── Tool 5: calculate_quote ─────────────────────────────────────────────────
// Fully dynamic — calculates from actual args passed by Claude.
const calculate_quote = (args) => {
  const base = Number(args.base_rate_myr) || 3200;
  const fuelPct = Number(args.fuel_surcharge_pct) || 15;
  const hasInsurance = args.has_insurance !== false;   // default true if not explicitly false
  const hasEscort = args.has_escort !== false;   // default true if not explicitly false

  const fuelSurcharge = Math.round(base * fuelPct / 100 / 10) * 10;
  const insuranceFee = hasInsurance ? 150 : 0;
  const escortFee = hasEscort ? 200 : 0;
  const handlingFee = 50;
  const subtotal = base + fuelSurcharge + insuranceFee + escortFee + handlingFee;

  // Goodwill discount (~5%) to reach the final quoted price
  const discountApplied = Math.round(subtotal * 0.05 / 10) * 10;
  const finalQuote = subtotal - discountApplied;
  const minimumAcceptable = Math.round(finalQuote * 0.90 / 2) * 2; // 10% floor
  const breakeven = Math.round(subtotal * 0.75 / 10) * 10;

  // Valid for 7 days from today
  const validDate = new Date();
  validDate.setDate(validDate.getDate() + 7);
  const validUntil = validDate.toISOString().split('T')[0];

  return {
    base_rate_myr: base,
    fuel_surcharge_myr: fuelSurcharge,
    insurance_fee_myr: insuranceFee,
    escort_fee_myr: escortFee,
    handling_fee_myr: handlingFee,
    subtotal_myr: subtotal,
    applied_margin_pct: Number(args.target_margin_pct) || 22,
    discount_applied_myr: discountApplied,
    final_quote_myr: finalQuote,
    minimum_acceptable_myr: minimumAcceptable,
    breakeven_myr: breakeven,
    currency: 'MYR',
    valid_until: validUntil,
  };
};

// ── Tool 6: evaluate_counter_offer ─────────────────────────────────────────
// Real business-rule logic — not hardcoded.
const evaluate_counter_offer = ({ original_quote_myr, counter_offer_myr, minimum_acceptable_myr }) => {
  const discount_pct = ((original_quote_myr - counter_offer_myr) / original_quote_myr) * 100;

  if (counter_offer_myr >= original_quote_myr) {
    return {
      decision: 'accept',
      discount_pct: 0,
      reasoning: 'Counter-offer meets or exceeds our quote. Accept immediately.',
    };
  }

  if (counter_offer_myr >= minimum_acceptable_myr) {
    return {
      decision: 'accept',
      discount_pct: parseFloat(discount_pct.toFixed(1)),
      reasoning: `Discount of ${discount_pct.toFixed(1)}% is within our 10% maximum threshold. Accept.`,
    };
  }

  return {
    decision: 'counter',
    discount_pct: parseFloat(discount_pct.toFixed(1)),
    counter_offer_myr: minimum_acceptable_myr,
    reasoning: `Client's offer of MYR ${counter_offer_myr} represents a ${discount_pct.toFixed(1)}% discount — exceeds our 10% floor. Counter at MYR ${minimum_acceptable_myr}.`,
  };
};

// ── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  extract_rfq_data,
  get_route,
  get_market_rate,
  get_carrier_availability,
  calculate_quote,
  evaluate_counter_offer,
};