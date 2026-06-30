// src/data/toolMeta.js
// Per-tool presentation metadata for AgentTerminal.jsx — turns raw tool args/results
// into a short human-readable IN/OUT line instead of a JSON dump. Pure presentation,
// no business logic; defensive against missing fields since not every tool_call/
// tool_response pair (e.g. Safe Mode's scripted payloads) populates every field.

const titleCase = (name) =>
  (name || 'tool').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Fallback for any tool not explicitly curated below — lists the first few top-level
// keys so nothing ever renders blank or throws.
const genericSummary = (obj) => {
  if (!obj || typeof obj !== 'object') return '';
  return Object.keys(obj)
    .slice(0, 3)
    .map((k) => `${k}: ${typeof obj[k] === 'object' ? '…' : obj[k]}`)
    .join(' · ');
};

const TOOL_META = {
  extract_rfq_data: {
    icon: '📋',
    label: 'Extracting RFQ Data',
    summarizeIn: (args) =>
      args?.client_name ? `Structuring extracted data for ${args.client_name}` : 'Reading the raw RFQ email text...',
    summarizeOut: (r) =>
      r ? `${r.client_name || 'Unknown client'} · ${r.weight_kg ?? '?'}kg · ${r.origin || '?'} → ${r.destination || '?'}` : '',
  },
  get_route: {
    icon: '🗺️',
    label: 'Routing Intelligence',
    summarizeIn: (args) => `Checking route ${args?.origin || '?'} → ${args?.destination || '?'}`,
    summarizeOut: (r) =>
      r ? `${r.distance_km}km via ${r.highway} · ~${r.estimated_hours}h · toll MYR ${r.toll_cost_myr}` : '',
  },
  get_distance_real: {
    icon: '📡',
    label: 'Real Round-Trip Distance',
    summarizeIn: (args) => `Calculating hub → ${args?.origin || '?'} → ${args?.destination || '?'} → hub`,
    summarizeOut: (r) =>
      r ? `${r.round_trip_km}km round-trip · ~${Math.round(((r.round_trip_min || 0) / 60) * 10) / 10}h` : '',
  },
  calculate_cost_per_km: {
    icon: '💰',
    label: 'Cost Per Kilometre',
    summarizeIn: (args) => `Computing operating cost for ${args?.round_trip_km ?? '?'}km round trip`,
    summarizeOut: (r) =>
      r ? `MYR ${r.cost_per_km_myr}/km · fuel MYR ${r.total_fuel_cost_myr} · maintenance MYR ${r.maintenance_cost_myr}` : '',
  },
  get_weather_forecast: {
    icon: '⛅',
    label: 'Weather Outlook',
    summarizeIn: (args) => `Checking forecast for ${args?.destination_region || '?'} on ${args?.ship_date || '?'}`,
    summarizeOut: (r) => (r ? `${r.condition} · ${r.precip_probability_pct}% rain risk` : ''),
  },
  get_route_incident_log: {
    icon: '⚠️',
    label: 'Route Incident History',
    summarizeIn: (args) => `Pulling incident history for route ${args?.route_id || '?'}`,
    summarizeOut: (r) => {
      if (!r) return '';
      const entries = r.entries || [];
      const high = entries.filter((e) => e.severity === 'high').length;
      return `${r.incident_count ?? entries.length} incidents on record${high ? ` · ${high} high severity` : ''}`;
    },
  },
  get_fleet_status: {
    icon: '🚚',
    label: 'Fleet Readiness Check',
    summarizeIn: (args) => `Checking fleet for ${args?.required_truck_type || 'required truck type'}`,
    summarizeOut: (r) =>
      r ? `Recommended ${r.recommended_truck_id} (${r.recommended_driver_name})${r.exclusions?.length ? ` · ${r.exclusions.length} excluded` : ''}` : '',
  },
  select_truck_and_driver: {
    icon: '✅',
    label: 'Truck & Driver Locked',
    summarizeIn: (args) => `Confirming ${args?.recommended_truck_id || 'recommended truck'}`,
    summarizeOut: (r) => (r ? `${r.confirmed_truck_id} confirmed with ${r.confirmed_driver_name}` : ''),
  },
  get_market_rate: {
    icon: '📊',
    label: 'Market Rate Benchmark',
    summarizeIn: (args) => `Benchmarking ${args?.cargo_type || 'cargo'}, ${args?.weight_kg ?? '?'}kg`,
    summarizeOut: (r) => (r ? `MYR ${r.base_rate_myr} benchmark (range ${r.market_low_myr}–${r.market_high_myr})` : ''),
  },
  get_carrier_availability: {
    icon: '🏢',
    label: 'Carrier Availability',
    summarizeIn: (args) => `Checking carriers available by ${args?.required_by_date || '?'}`,
    summarizeOut: (r) =>
      r ? `Recommended ${r.recommended_carrier_id} · ${r.available_carriers?.length ?? 0} carrier(s) available` : '',
  },
  calculate_quote: {
    icon: '🧮',
    label: 'Final Quote Calculation',
    isDecision: true,
    summarizeIn: (args) => `Calculating quote · ${args?.target_margin_pct ?? '?'}% margin target`,
    summarizeOut: (r) =>
      r ? `MYR ${r.final_quote_myr} total · floor MYR ${r.minimum_acceptable_myr} · valid until ${r.valid_until}` : '',
  },
  evaluate_counter_offer: {
    icon: '⚖️',
    label: 'Counter-Offer Evaluation',
    isDecision: true,
    summarizeIn: (args) => `MYR ${args?.counter_offer_myr ?? '?'} offer vs MYR ${args?.original_quote_myr ?? '?'} quote`,
    summarizeOut: (r) =>
      r ? `${(r.decision || '').toUpperCase()} · ${r.discount_pct}% discount${r.counter_offer_myr ? ` · counter at MYR ${r.counter_offer_myr}` : ''}` : '',
  },
  check_alternate_schedule: {
    icon: '📅',
    label: 'Alternate Schedule Check',
    isDecision: true,
    summarizeIn: (args) => `Checking alternate ship windows for route ${args?.route_id || '?'}`,
    summarizeOut: (r) =>
      r
        ? `${r.alternate_date || '?'}${r.recommended_quote_myr ? ` · MYR ${r.recommended_quote_myr}` : ''}${r.estimated_savings_pct ? ` (${r.estimated_savings_pct}% savings)` : ''}`
        : '',
  },
};

export function getToolMeta(name) {
  return (
    TOOL_META[name] || {
      icon: '🔧',
      label: titleCase(name),
      summarizeIn: (args) => genericSummary(args),
      summarizeOut: (r) => genericSummary(r),
    }
  );
}
