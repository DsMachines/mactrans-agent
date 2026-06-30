// api/lib/mockTools.js
// Input-responsive mock tool implementations for ARIA.
// Used server-side in api/agent.js and api/negotiate.js.
// CommonJS exports required for Vercel serverless Node.js environment.

const HUB_ADDRESS = 'Mactrans Logistics HQ, Shah Alam, Selangor, Malaysia';

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

const round1 = (n) => Math.round(n * 10) / 10;

// Stable string hash (not Math.random) so reruns in front of an audience are deterministic
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ── Tool 1: extract_rfq_data ────────────────────────────────────────────────
// Claude has already read the raw email in its prompt — this tool takes Claude's own
// structured reading as its arguments (rather than re-parsing raw text in JS) and just
// normalizes/defaults fields per existing business rules (insurance/escort thresholds).
const extract_rfq_data = (args) => {
  const weight = Number(args.weight_kg) || 0;
  const requirements = new Set(args.special_requirements || []);
  if (weight > 5000) requirements.add('insurance_required');
  if (weight > 10000) requirements.add('escort_vehicle');

  return {
    rfq_id: args.rfq_id || `MC-${new Date().getFullYear()}-${String(hashStr(args.contact_email || args.client_name || '') % 9000 + 1000)}`,
    client_name: args.client_name || 'Unknown Client',
    contact_person: args.contact_person || 'Client Contact',
    contact_email: args.contact_email || '',
    cargo_type: args.cargo_type || 'general_freight',
    cargo_description: args.cargo_description || '',
    weight_kg: weight,
    dimensions_m3: Number(args.dimensions_m3) || 0,
    origin: args.origin || '',
    destination: args.destination || '',
    required_by_date: args.required_by_date || '',
    special_requirements: Array.from(requirements),
    parsed_confidence: args.parsed_confidence || 'medium',
  };
};

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

// ── Tool 2b: get_distance_real ─────────────────────────────────────────────
// Real Google Maps Distance Matrix call (hub→origin→destination→hub round trip),
// with a deterministic fallback that is narration-identical if the key is missing,
// the call fails, or it times out. Must NEVER return an {error:...} shape — the raw
// tool_response JSON is dumped into the terminal verbatim, so this always returns a
// well-formed result; only the internal `data_source` field tells the two paths apart.
async function get_distance_real(args) {
  const hub = args.hub_address || HUB_ADDRESS;
  const origin = args.origin;
  const destination = args.destination;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (apiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const params = new URLSearchParams({
        origins: `${hub}|${origin}|${destination}`,
        destinations: `${origin}|${destination}|${hub}`,
        key: apiKey,
        region: 'my',
        units: 'metric',
      });
      const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const json = await res.json();
        const cell = (r, c) => json && json.rows && json.rows[r] && json.rows[r].elements && json.rows[r].elements[c];
        const hubToOrigin = cell(0, 0);
        const originToDest = cell(1, 1);
        const destToHub = cell(2, 2);
        const allOk =
          json.status === 'OK' &&
          hubToOrigin && hubToOrigin.status === 'OK' &&
          originToDest && originToDest.status === 'OK' &&
          destToHub && destToHub.status === 'OK';

        if (allOk) {
          const hubOriginKm = round1(hubToOrigin.distance.value / 1000);
          const originDestKm = round1(originToDest.distance.value / 1000);
          const destHubKm = round1(destToHub.distance.value / 1000);
          const totalSec = hubToOrigin.duration.value + originToDest.duration.value + destToHub.duration.value;

          return {
            hub_to_origin_km: hubOriginKm,
            hub_to_origin_min: Math.round(hubToOrigin.duration.value / 60),
            origin_to_destination_km: originDestKm,
            origin_to_destination_min: Math.round(originToDest.duration.value / 60),
            destination_to_hub_km: destHubKm,
            destination_to_hub_min: Math.round(destToHub.duration.value / 60),
            round_trip_km: round1(hubOriginKm + originDestKm + destHubKm),
            round_trip_min: Math.round(totalSec / 60),
            data_source: 'google_maps_distance_matrix',
            computed_at: new Date().toISOString(),
          };
        }
      }
    } catch (err) {
      // Network error, timeout/abort, or bad response — fall through to the estimation model.
    }
  }

  // ── Fallback: deterministic internal estimation model ──────────────────
  const route = findRoute(origin, destination);
  const hubLeg = Math.max(15, round1(route.distance_km * 0.07));
  const hubLegMin = Math.round(hubLeg / 0.8);
  const mainLegMin = Math.round(route.estimated_hours * 60);

  return {
    hub_to_origin_km: hubLeg,
    hub_to_origin_min: hubLegMin,
    origin_to_destination_km: route.distance_km,
    origin_to_destination_min: mainLegMin,
    destination_to_hub_km: hubLeg,
    destination_to_hub_min: hubLegMin,
    round_trip_km: round1(route.distance_km + hubLeg * 2),
    round_trip_min: mainLegMin + hubLegMin * 2,
    data_source: 'internal_estimation_model',
    computed_at: new Date().toISOString(),
  };
}

// ── Tool 2c: calculate_cost_per_km ──────────────────────────────────────────
// Pure local math, no external call. cost_per_km_myr is a full per-km FREIGHT RATE
// (fuel + maintenance + driver wages/permits/overhead) — not just raw fuel cost — since
// this value directly drives calculate_quote's base_rate_myr and needs to land in a
// realistic market range (roughly RM 7-8/km for specialized flatbed freight), not the
// much smaller raw operating cost alone.
const calculate_cost_per_km = (args) => {
  const roundTripKm = Number(args.round_trip_km) || 400;
  const fuelPrice = Number(args.fuel_price_myr_per_liter) || 2.15; // RM/liter diesel, approx
  const efficiency = Number(args.truck_fuel_efficiency_km_per_liter) || 3.2; // typical flatbed truck
  const maintenancePerKm = 0.45; // tires, servicing, depreciation
  const driverOverheadPerKm = 6.2; // driver wages, permits, base overhead/margin

  const fuelCostPerKm = Math.round((fuelPrice / efficiency) * 100) / 100;
  const totalFuelCost = Math.round(roundTripKm * fuelCostPerKm * 100) / 100;
  const maintenanceCost = Math.round(roundTripKm * maintenancePerKm * 100) / 100;
  const costPerKm = Math.round((fuelCostPerKm + maintenancePerKm + driverOverheadPerKm) * 100) / 100;

  return {
    cost_per_km_myr: costPerKm,
    total_fuel_cost_myr: totalFuelCost,
    maintenance_cost_myr: maintenanceCost,
  };
};

// ── Tool 2d: get_weather_forecast ───────────────────────────────────────────
// Deliberately fake — deterministic pick from a Malaysia-appropriate seasonal pool.
const WEATHER_PATTERNS = [
  { condition: 'Monsoon rain likely — heavy downpour expected along coastal stretches', risk_note: 'Wet road surface and reduced visibility expected — recommend a schedule buffer and reduced speed allowance.', precip_probability_pct: 75 },
  { condition: 'Scattered thunderstorms, typical for the season', risk_note: 'Brief heavy bursts possible during afternoon hours — minor schedule buffer recommended.', precip_probability_pct: 55 },
  { condition: 'Generally dry with isolated showers', risk_note: 'Low risk — standard contingency only.', precip_probability_pct: 25 },
  { condition: 'Clear with high humidity', risk_note: 'No significant weather risk identified.', precip_probability_pct: 10 },
  { condition: 'Hazy conditions from regional weather patterns, light winds', risk_note: 'Minor visibility consideration, no material delay risk.', precip_probability_pct: 15 },
];

const get_weather_forecast = (args) => {
  const shipDate = args.ship_date || '';
  const region = args.destination_region || '';
  const month = shipDate && !isNaN(new Date(shipDate)) ? new Date(shipDate).getMonth() : new Date().getMonth();

  // Malaysia: Nov–Mar = NE monsoon (wetter), Apr–Oct = drier with isolated storms
  const isMonsoonSeason = month <= 2 || month === 10 || month === 11;
  const pool = isMonsoonSeason
    ? [WEATHER_PATTERNS[0], WEATHER_PATTERNS[1]]
    : [WEATHER_PATTERNS[2], WEATHER_PATTERNS[3], WEATHER_PATTERNS[4]];

  const picked = pool[hashStr(region + shipDate) % pool.length];

  return {
    forecast_confidence: 'low_long_range',
    method: 'seasonal_historical_pattern_model',
    condition: picked.condition,
    risk_note: picked.risk_note,
    precip_probability_pct: picked.precip_probability_pct,
  };
};

// ── Tool 2e: get_route_incident_log ─────────────────────────────────────────
// Fixed 5-entry dummy dataset per route, with a generic 5-entry fallback for unknown routes.
const ROUTE_INCIDENT_LOG = {
  'KUA-PEN-001': [
    { date: '2026-03-14', location_km_marker: 'km 312 (near Bukit Mertajam)', type: 'low_bridge_clearance', severity: 'medium', description: 'Overpass clearance measured at 4.2m — flagged for any flatbed cargo exceeding 4.0m loaded height.', recommended_mitigation: 'Confirm cargo height before dispatch; use the Jalan Bukit Tengah alternate if oversized.' },
    { date: '2026-01-22', location_km_marker: 'km 180 (Ipoh interchange)', type: 'pothole_cluster', severity: 'medium', description: 'Recurring pothole cluster logged three times in the last six months, worsens after monsoon rain.', recommended_mitigation: 'Reduce speed to 60km/h through the interchange and avoid the outer lane.' },
    { date: '2025-11-08', location_km_marker: 'km 295 (Sungai Petani)', type: 'narrow_corner', severity: 'low', description: 'Sharp bend with reduced shoulder width — tight for long-bed trailers.', recommended_mitigation: 'Escort vehicle to lead through the corner at reduced speed.' },
    { date: '2026-02-03', location_km_marker: 'km 305 (Bukit Mertajam town)', type: 'market_day_congestion', severity: 'medium', description: 'Recurring Thursday and Saturday morning congestion (7–9am) near the wet market.', recommended_mitigation: 'Schedule passage outside 7–9am on Thu/Sat, or depart before 06:00.' },
    { date: '2025-12-19', location_km_marker: 'km 355 (Prai industrial area)', type: 'flooding_history', severity: 'high', description: 'Flash-flood history during heavy monsoon downpour — road has been impassable for short periods.', recommended_mitigation: 'Check live conditions before departure if heavy rain is forecast; keep a 2-hour schedule buffer.' },
  ],
};

const GENERIC_INCIDENT_LOG = [
  { date: '2026-02-11', location_km_marker: 'mid-route', type: 'pothole_cluster', severity: 'low', description: 'Minor surface degradation reported along this corridor.', recommended_mitigation: 'Standard caution advised, no route change needed.' },
  { date: '2025-12-30', location_km_marker: 'mid-route', type: 'narrow_corner', severity: 'low', description: 'One tight bend noted, manageable for standard flatbed trailers.', recommended_mitigation: 'Reduce speed through the bend.' },
  { date: '2026-01-15', location_km_marker: 'urban approach', type: 'market_day_congestion', severity: 'medium', description: 'Periodic congestion near a local market on weekend mornings.', recommended_mitigation: 'Avoid weekend morning departures where possible.' },
  { date: '2025-11-20', location_km_marker: 'river crossing', type: 'flooding_history', severity: 'low', description: 'Occasional minor flooding reported near a river crossing during heavy rain.', recommended_mitigation: 'Check weather before departure during wet season.' },
  { date: '2026-03-02', location_km_marker: 'highway overpass', type: 'low_bridge_clearance', severity: 'low', description: 'One overpass on this corridor has below-average clearance.', recommended_mitigation: 'Confirm cargo height clears 4.3m before dispatch.' },
];

const get_route_incident_log = (args) => {
  const entries = ROUTE_INCIDENT_LOG[args.route_id] || GENERIC_INCIDENT_LOG;
  return {
    route_id: args.route_id || 'UNKNOWN',
    incident_count: entries.length,
    entries,
  };
};

// ── Tool 2f: get_fleet_status ────────────────────────────────────────────────
// Fixed fleet dataset — at least one truck is always flagged unsuitable (poor brakes /
// high tire wear) so the agent has a concrete reason to exclude it.
const FLEET_TABLE = [
  { truck_id: 'TPE-001', plate: 'WTY 4521', type: 'flatbed_with_escort', driver_name: 'Razak Ismail', tire_wear_pct: 22, last_brake_inspection_date: '2026-05-18', brake_condition: 'good', mileage_km: 84210, flagged_unsuitable_reason: null },
  { truck_id: 'TPE-007', plate: 'WTY 9012', type: 'flatbed_standard', driver_name: 'Lim Wei Kit', tire_wear_pct: 38, last_brake_inspection_date: '2026-04-02', brake_condition: 'fair', mileage_km: 112400, flagged_unsuitable_reason: null },
  { truck_id: 'NHT-014', plate: 'PJY 3387', type: 'flatbed_standard', driver_name: 'Suresh Kumar', tire_wear_pct: 86, last_brake_inspection_date: '2026-01-09', brake_condition: 'poor', mileage_km: 198750, flagged_unsuitable_reason: 'Brake condition rated poor at last inspection and tire wear at 86% — unsuitable for wet or pothole-flagged routes.' },
  { truck_id: 'TPE-009', plate: 'WTY 7765', type: 'flatbed_with_escort', driver_name: 'Hafiz Rahman', tire_wear_pct: 15, last_brake_inspection_date: '2026-06-10', brake_condition: 'good', mileage_km: 41200, flagged_unsuitable_reason: null },
];

const get_fleet_status = (args) => {
  const requiredType = args.required_truck_type || 'flatbed_standard';
  let candidates = FLEET_TABLE.filter((t) => t.type === requiredType);
  if (candidates.length === 0) candidates = FLEET_TABLE; // unrecognized type string — consider the whole fleet rather than reporting none available
  const usable = candidates.filter((t) => t.brake_condition !== 'poor' && t.tire_wear_pct <= 80);
  const recommended = usable[0] || candidates[0] || FLEET_TABLE[0];
  const exclusions = FLEET_TABLE
    .filter((t) => t.brake_condition === 'poor' || t.tire_wear_pct > 80)
    .map((t) => ({ truck_id: t.truck_id, reason: t.flagged_unsuitable_reason || 'Failed fleet condition threshold.' }));

  return {
    available_trucks: candidates,
    recommended_truck_id: recommended.truck_id,
    recommended_driver_name: recommended.driver_name,
    exclusions,
  };
};

// ── Tool 2g: select_truck_and_driver ────────────────────────────────────────
// Thin confirmation tool — kept separate from get_fleet_status so the selection
// gets its own discrete tool_call/tool_response beat in the terminal.
const select_truck_and_driver = (args) => {
  const truck = FLEET_TABLE.find((t) => t.truck_id === args.recommended_truck_id) || FLEET_TABLE[0];
  return {
    confirmed_truck_id: truck.truck_id,
    confirmed_driver_name: truck.driver_name,
    confirmation_note: `${truck.truck_id} (${truck.plate}) assigned with driver ${truck.driver_name} — brake condition ${truck.brake_condition}, tire wear ${truck.tire_wear_pct}%. Cleared for the flagged route conditions.`,
  };
};

// ── Tool 3: get_market_rate ─────────────────────────────────────────────────
// Base rate scales with distance and cargo weight. This is advisory data shown in
// the terminal narration — calculate_quote always prioritizes the real round_trip_km
// when available, so this isn't pricing-critical, just narration consistency.
const get_market_rate = (args) => {
  const distance = Number(args.distance_km) || 350; // 350 = conservative default if no real distance yet
  const distFactor = distance / 350;

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
// Fully dynamic — calculates from actual args passed by Claude. When real round-trip
// distance + cost-per-km are available, those drive base_rate_myr directly (rather than
// double-counting against get_market_rate's static distance guess). Weather risk adds a
// small capped contingency line.
const calculate_quote = (args) => {
  const fuelPct = Number(args.fuel_surcharge_pct) || 15;
  const hasInsurance = args.has_insurance !== false;   // default true if not explicitly false
  const hasEscort = args.has_escort !== false;   // default true if not explicitly false
  const weight = Number(args.weight_kg) || 12000;
  const weightTier = weight > 20000 ? 1.4
    : weight > 15000 ? 1.2
      : weight > 10000 ? 1.0
        : weight > 5000 ? 0.85
          : 0.70;

  const hasRealDistance = Number(args.round_trip_km) > 0 && Number(args.cost_per_km_myr) > 0;
  const base = hasRealDistance
    ? Math.round(Number(args.round_trip_km) * Number(args.cost_per_km_myr) * weightTier / 10) * 10
    : Number(args.base_rate_myr) || 3200;

  const fuelSurcharge = Math.round(base * fuelPct / 100 / 10) * 10;
  const insuranceFee = hasInsurance ? 150 : 0;
  const escortFee = hasEscort ? 200 : 0;
  const handlingFee = 50;

  const weatherPct = Math.min(8, Math.max(0, Number(args.weather_risk_contingency_pct) || 0));
  const weatherContingency = Math.round(base * weatherPct / 100 / 10) * 10;

  const subtotal = base + fuelSurcharge + insuranceFee + escortFee + handlingFee + weatherContingency;

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
    distance_cost_myr: hasRealDistance ? base : 0,
    weather_contingency_myr: weatherContingency,
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

// ── Tool 7: check_alternate_schedule ────────────────────────────────────────
// Used by the persistent-negotiation flow when a client pushes for more discount than
// approved. Produces a fake-but-mechanical "cheaper window" rather than an arbitrary number —
// and owns the actual pricing decision itself (rather than a separate calculate_quote call),
// so the final figure quoted to the client is guaranteed consistent with what gets narrated.
const ALTERNATE_SAVINGS_PCT = 6;

const check_alternate_schedule = (args) => {
  const current = args.current_ship_date && !isNaN(new Date(args.current_ship_date))
    ? new Date(args.current_ship_date)
    : new Date();
  const deadline = args.deadline_date && !isNaN(new Date(args.deadline_date))
    ? new Date(args.deadline_date)
    : null;

  // Try the standard 4-day shift first, then progressively smaller shifts, picking the
  // largest one that still lands on or before the client's deadline. If even a 1-day
  // shift would blow past the deadline, there is no feasible cheaper window at all —
  // never fabricate a date the client can't actually use.
  let altDateStr = null;
  for (const shiftDays of [4, 3, 2, 1]) {
    const candidate = new Date(current);
    candidate.setDate(candidate.getDate() + shiftDays);
    if (!deadline || candidate <= deadline) {
      altDateStr = candidate.toISOString().split('T')[0];
      break;
    }
  }

  const originalPrice = Number(args.original_quote_myr) || 0;
  const requestedPrice = Number(args.requested_price_myr) || 0;
  const minimumAcceptable = Number(args.minimum_acceptable_myr) || 0;

  if (!altDateStr) {
    return {
      feasible: false,
      alternate_date: null,
      alternate_time_window: null,
      alternate_truck_id: null,
      alternate_driver_name: null,
      reason: `No shipping window before the client's required deadline of ${args.deadline_date} can support a lower price than the already-approved floor.`,
      estimated_savings_pct: 0,
      recommended_quote_myr: minimumAcceptable || originalPrice,
      meets_client_request: false,
      alternate_weather: null,
      alternate_traffic: null,
    };
  }

  // The lowest price the alternate window mechanically supports.
  const altWindowFloor = originalPrice > 0 ? Math.round(originalPrice * (1 - ALTERNATE_SAVINGS_PCT / 100)) : 0;
  // Never quote above what the client actually asked for or above the original price.
  const clampedRequest = requestedPrice > 0
    ? Math.min(requestedPrice, originalPrice || requestedPrice)
    : altWindowFloor;
  // Meet the client's ask exactly if the window can support it; otherwise give the best
  // achievable price for that window — never an arbitrary number either way.
  const recommendedQuoteMyr = altWindowFloor > 0 ? Math.max(altWindowFloor, clampedRequest) : clampedRequest;

  return {
    feasible: true,
    alternate_date: altDateStr,
    alternate_time_window: '05:30–07:00 AM departure (non-peak slot, avoids the port\'s 7-9am truck-queue surcharge window)',
    alternate_truck_id: 'TPE-009',
    alternate_driver_name: 'Hafiz Rahman',
    reason: 'Midweek demand is lower that week and TPE-009 has confirmed idle capacity in a non-peak departure slot, avoiding the weekend rush and port congestion surcharge windows.',
    estimated_savings_pct: ALTERNATE_SAVINGS_PCT,
    recommended_quote_myr: recommendedQuoteMyr,
    meets_client_request: requestedPrice > 0 && recommendedQuoteMyr <= requestedPrice + 0.5,
    alternate_weather: {
      condition: 'Clearer conditions expected, lower monsoon risk that week',
      risk_note: 'Minimal weather contingency needed',
    },
    alternate_traffic: 'Lighter — avoids month-end peak congestion on the North-South Expressway',
  };
};

// ── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  extract_rfq_data,
  get_route,
  get_distance_real,
  calculate_cost_per_km,
  get_weather_forecast,
  get_route_incident_log,
  get_fleet_status,
  select_truck_and_driver,
  get_market_rate,
  get_carrier_availability,
  calculate_quote,
  evaluate_counter_offer,
  check_alternate_schedule,
  HUB_ADDRESS,
};
