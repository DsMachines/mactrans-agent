import React, { useState, useEffect } from 'react';

export default function RateCard({ data, editMode, onRecalculate }) {
  const [values, setValues] = useState({
    base_rate_myr: 0,
    fuel_surcharge_myr: 0,
    insurance_fee_myr: 0,
    escort_fee_myr: 0,
    handling_fee_myr: 0,
    weather_contingency_myr: 0,
    discount_applied_myr: 0,
  });

  // Sync editable values whenever new data arrives from Claude
  useEffect(() => {
    if (data) {
      setValues({
        base_rate_myr: Number(data.base_rate_myr || 0),
        fuel_surcharge_myr: Number(data.fuel_surcharge_myr || 0),
        insurance_fee_myr: Number(data.insurance_fee_myr || 150),
        escort_fee_myr: Number(data.escort_fee_myr || 200),
        handling_fee_myr: Number(data.handling_fee_myr || 50),
        weather_contingency_myr: Number(data.weather_contingency_myr || 0),
        discount_applied_myr: Number(data.discount_applied_myr || 0),
      });
    }
  }, [data]);

  // ── Awaiting state ──────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="glass-panel placeholder-pulse" style={styles.placeholderContainer}>
        <div style={styles.placeholderText}>AWAITING RATE CARD DATA...</div>
      </div>
    );
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleChange = (field, val) => {
    setValues(prev => ({ ...prev, [field]: Number(val) || 0 }));
  };

  const handleRecalculateClick = () => {
    if (onRecalculate) {
      // Pass all current line-item values (including discount/contingency) plus the
      // newly computed total, so nothing the admin sees here is hidden from downstream
      // calculations or the regenerated email.
      onRecalculate({
        ...values,
        total_quote_myr: editTotal,
        carrier: data.carrier,
        valid_until: data.valid_until,
      });
    }
  };

  // ── Total calculation ───────────────────────────────────────────────────
  // Both modes now sum every line item that actually feeds the total — including
  // weather contingency — and subtract the discount explicitly, so the displayed
  // total always reconciles with the visible rows (this used to silently diverge
  // whenever weather_contingency_myr was non-zero, since it fed calculate_quote's
  // subtotal/discount/total math but was never rendered as its own row).
  const grossLineItemSum =
    values.base_rate_myr +
    values.fuel_surcharge_myr +
    values.insurance_fee_myr +
    values.escort_fee_myr +
    values.handling_fee_myr +
    values.weather_contingency_myr;

  const editTotal = grossLineItemSum - values.discount_applied_myr;
  const readOnlyTotal = data.total_quote_myr ?? editTotal;
  const displayTotal = editMode ? editTotal : readOnlyTotal;

  const discountAmount = data.discount_applied_myr || 0;
  const weatherAmount = data.weather_contingency_myr || 0;

  // ── Formatting ──────────────────────────────────────────────────────────
  const fmt = (amount) =>
    new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: 'MYR',
      minimumFractionDigits: 2,
    }).format(amount);

  // ── Row renderer ────────────────────────────────────────────────────────
  const renderRow = (label, field, val) => (
    <tr key={field} style={styles.row}>
      <td style={styles.labelCell}>{label}</td>
      <td style={styles.valueCell}>
        {editMode ? (
          <div style={styles.inputContainer}>
            <span style={styles.inputPrefix}>MYR</span>
            <input
              type="number"
              value={val}
              onChange={e => handleChange(field, e.target.value)}
              style={styles.numberInput}
            />
          </div>
        ) : (
          <span style={styles.valueText}>{fmt(val)}</span>
        )}
      </td>
    </tr>
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="glass-panel" style={styles.container}>

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>⚡ MACTRANS LIVE RATE CARD</span>
        <span style={styles.rfqTag}>#{data.client_rfq_id || 'MC-2026-0441'}</span>
      </div>

      <div style={styles.body}>

        {/* Route & carrier info */}
        <div style={styles.infoStrip}>
          <div style={styles.infoCol}>
            <span style={styles.infoLabel}>Route:</span>
            <span style={styles.infoValue}>{data.route_label ? `${data.route_label}${data.route_distance_km ? ` (${data.route_distance_km} km)` : ''}` : 'Kuala Lumpur → Penang Port (370 km)'}</span>
          </div>
          <div style={styles.infoCol}>
            <span style={styles.infoLabel}>Carrier:</span>
            <span style={styles.infoValue}>{data.carrier || 'Trans-Peninsular Express Sdn Bhd'}</span>
          </div>
        </div>

        {/* Line items */}
        <table style={styles.table}>
          <tbody>
            {renderRow('Base Freight Rate', 'base_rate_myr', values.base_rate_myr)}
            {renderRow('Fuel Surcharge (15%)', 'fuel_surcharge_myr', values.fuel_surcharge_myr)}
            {renderRow('Cargo Insurance', 'insurance_fee_myr', values.insurance_fee_myr)}
            {renderRow('Escort Vehicle', 'escort_fee_myr', values.escort_fee_myr)}
            {renderRow('Handling Fee', 'handling_fee_myr', values.handling_fee_myr)}

            {/* Weather contingency — only shown when non-zero in read-only mode, but always
                editable in edit mode so the admin can add/remove/adjust it directly */}
            {(editMode || weatherAmount > 0) && renderRow('Weather Contingency', 'weather_contingency_myr', values.weather_contingency_myr)}

            {/* Discount row — read-only display when present; always editable (incl. to 0
                to remove it entirely) in edit mode, since this is an automatic goodwill
                discount baked into every quote, not something the admin chose */}
            {!editMode && discountAmount > 0 && (
              <tr style={styles.row}>
                <td style={{ ...styles.labelCell, color: 'var(--accent-green)', fontStyle: 'italic' }}>
                  Volume Discount Applied
                </td>
                <td style={styles.valueCell}>
                  <span style={{ ...styles.valueText, color: 'var(--accent-green)' }}>
                    − {fmt(discountAmount)}
                  </span>
                </td>
              </tr>
            )}
            {editMode && (
              <tr style={styles.row}>
                <td style={{ ...styles.labelCell, color: 'var(--accent-green)', fontStyle: 'italic' }}>
                  Discount (0 to remove)
                </td>
                <td style={styles.valueCell}>
                  <div style={styles.inputContainer}>
                    <span style={styles.inputPrefix}>− MYR</span>
                    <input
                      type="number"
                      value={values.discount_applied_myr}
                      onChange={e => handleChange('discount_applied_myr', e.target.value)}
                      style={styles.numberInput}
                    />
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={styles.divider} />

        {/* Total */}
        <div style={styles.totalRow}>
          <span style={styles.totalLabel}>▶ TOTAL QUOTED</span>
          <span style={styles.totalValue}>{fmt(displayTotal)}</span>
        </div>

        {/* Footer meta */}
        <div style={styles.footerStrip}>
          <span>Valid Until: {data.valid_until || '7 days from quote'}</span>
          <span>Margin: {data.applied_margin_pct || data.margin_pct || 22}%</span>
        </div>

        {/* Recalculate button — only visible in edit mode */}
        {editMode && (
          <button
            onClick={handleRecalculateClick}
            style={styles.recalcButton}
          >
            🔄 Recalculate &amp; Regenerate Email
          </button>
        )}

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles = {
  placeholderContainer: {
    height: '180px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px dashed rgba(255, 255, 255, 0.1)',
  },
  placeholderText: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '1px',
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: '1px solid rgba(0, 212, 255, 0.1)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: 'linear-gradient(90deg, rgba(0, 212, 255, 0.1) 0%, transparent 100%)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  headerTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--accent-cyan)',
    letterSpacing: '0.5px',
  },
  rfqTag: {
    fontSize: '11px',
    fontFamily: 'var(--font-terminal)',
    color: '#a0aec0',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  body: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  infoStrip: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: '6px',
    fontSize: '11px',
    border: '1px solid rgba(255, 255, 255, 0.03)',
  },
  infoCol: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  infoLabel: {
    color: '#718096',
  },
  infoValue: {
    color: '#e8e8e8',
    fontWeight: '500',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  row: {
    borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
  },
  labelCell: {
    padding: '8px 0',
    fontSize: '12px',
    color: '#a0aec0',
  },
  valueCell: {
    padding: '8px 0',
    textAlign: 'right',
  },
  valueText: {
    fontFamily: 'var(--font-terminal)',
    fontSize: '13px',
    color: '#ffffff',
  },
  inputContainer: {
    display: 'inline-flex',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid var(--accent-cyan)',
    borderRadius: '4px',
    overflow: 'hidden',
    padding: '2px 6px',
  },
  inputPrefix: {
    fontSize: '10px',
    fontFamily: 'var(--font-terminal)',
    color: 'var(--accent-cyan)',
    marginRight: '4px',
    userSelect: 'none',
  },
  numberInput: {
    width: '80px',
    background: 'transparent',
    border: 'none',
    color: '#ffffff',
    textAlign: 'right',
    fontFamily: 'var(--font-terminal)',
    fontSize: '13px',
    outline: 'none',
  },
  divider: {
    height: '1px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    margin: '4px 0',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
  },
  totalLabel: {
    fontSize: '13px',
    fontWeight: '700',
    color: 'var(--accent-cyan)',
  },
  totalValue: {
    fontSize: '16px',
    fontWeight: '700',
    fontFamily: 'var(--font-terminal)',
    color: 'var(--accent-green)',
  },
  footerStrip: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#718096',
    padding: '4px 0',
  },
  recalcButton: {
    marginTop: '8px',
    width: '100%',
    padding: '10px',
    background: 'linear-gradient(135deg, var(--accent-amber) 0%, #d48800 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 10px rgba(255, 184, 0, 0.2)',
    transition: 'all 0.2s',
  },
};
