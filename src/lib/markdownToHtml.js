// Minimal markdown-to-HTML renderer for ARIA-drafted email bodies and agent narration.
// Claude drafts emails using **bold** and "- " bullet lines; Outlook should render
// those properly instead of showing literal asterisks/dashes as plain text.

const escapeHtml = (str) =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inlineFormat = (line) =>
  escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

export function renderEmailBodyHtml(text) {
  if (!text) return '';

  const blocks = text.trim().split(/\n\s*\n/);

  return blocks
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const isList = lines.length > 0 && lines.every((l) => /^[-•]\s+/.test(l));

      if (isList) {
        const items = lines
          .map((l) => `<li>${inlineFormat(l.replace(/^[-•]\s+/, ''))}</li>`)
          .join('');
        return `<ul style="margin:4px 0 12px 18px;padding:0;">${items}</ul>`;
      }

      return `<p style="margin:0 0 12px 0;">${lines.map(inlineFormat).join('<br/>')}</p>`;
    })
    .join('');
}

// Renders ARIA's spoken narration ("thinking") text for the Agent Terminal. Unlike
// email bodies, narration sometimes (a) folds in **Step N: ...** markers when the
// model batches several reasoning beats into one turn, and (b) occasionally tacks the
// entire final [EMAIL_DRAFT]/[WHATSAPP_MESSAGE] output onto the same text block even
// though that content already has its own dedicated panels — both are handled here so
// the terminal only ever shows the reasoning, not a second copy of the output.
export function renderNarrationHtml(text) {
  if (!text) return '';

  const cutIdx = text.indexOf('[EMAIL_DRAFT]');
  let body = cutIdx === -1 ? text : text.slice(0, cutIdx);
  const truncated = cutIdx !== -1;

  // Drop any dangling decorative lines left right before the cut point — blank lines,
  // headers, "---" separators, or an orphaned "**"/"*" from a marker like
  // "**[EMAIL_DRAFT]**" that the cut above sliced through mid-marker. Loops because
  // several of these can stack up in a row (e.g. a "## FINAL OUTPUTS" header followed
  // by a blank line followed by the orphaned "**").
  const isJunkLine = (l) => {
    const t = l.trim();
    return t === '' || /^#{1,6}/.test(t) || /^-{3,}$/.test(t) || /^\*{1,3}$/.test(t);
  };
  const lines = body.split('\n');
  while (lines.length && isJunkLine(lines[lines.length - 1])) {
    lines.pop();
  }
  body = lines.join('\n').trim();

  if (truncated) {
    body += (body ? '\n\n' : '') + 'Drafting the quotation email and WhatsApp approval request now.';
  }

  const stepRe = /\*\*(Step \d+[:.][^*]*)\*\*/g;
  const markers = [...body.matchAll(stepRe)];

  if (markers.length >= 2) {
    const preamble = body.slice(0, markers[0].index).trim();
    const items = markers
      .map((m, i) => {
        const start = m.index + m[0].length;
        const end = i + 1 < markers.length ? markers[i + 1].index : body.length;
        const label = m[1].trim();
        const rest = body.slice(start, end).trim();
        return `<li><strong>${escapeHtml(label)}</strong>${rest ? ' ' + inlineFormat(rest) : ''}</li>`;
      })
      .join('');
    const preambleHtml = preamble ? `<p style="margin:0 0 8px 0;">${inlineFormat(preamble)}</p>` : '';
    return `${preambleHtml}<ul style="margin:0;padding:0 0 0 18px;">${items}</ul>`;
  }

  return body
    .split(/\n\s*\n/)
    .map((block) => inlineFormat(block.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')))
    .filter(Boolean)
    .join('<br/><br/>');
}
