// Minimal markdown-to-HTML renderer for ARIA-drafted email bodies.
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
