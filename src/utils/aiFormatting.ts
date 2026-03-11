const HEADING_EMOJI_MAP: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^verdetto$/i, label: '🧭 Verdetto' },
  { pattern: /^numeri chiave$/i, label: '📊 Numeri Chiave' },
  { pattern: /^punti forti$/i, label: '✅ Punti Forti' },
  { pattern: /^punti positivi$/i, label: '✅ Punti Positivi' },
  { pattern: /^punti di forza$/i, label: '✅ Punti di Forza' },
  { pattern: /^punti chiave$/i, label: '📌 Punti Chiave' },
  { pattern: /^cosa migliorare$/i, label: '⚠️ Cosa Migliorare' },
  { pattern: /^da migliorare$/i, label: '⚠️ Da Migliorare' },
  { pattern: /^criticita$/i, label: '⚠️ Criticita' },
  { pattern: /^aree di attenzione(?:\s*\(.*\))?$/i, label: '⚠️ Aree di Attenzione' },
  { pattern: /^consiglio(?:i)? per i prossimi giorni$/i, label: '🎯 Consigli per i Prossimi Giorni' },
  { pattern: /^prossimo step$/i, label: '🎯 Prossimo Step' },
  { pattern: /^prossime azioni$/i, label: '🎯 Prossime Azioni' },
  { pattern: /^recupero$/i, label: '🛌 Recupero' },
  { pattern: /^sintesi$/i, label: '📝 Sintesi' },
];

const SECTION_EMOJIS = ['🧭', '📊', '✅', '⚠️', '🎯', '🔥', '📌', '📝', '🛌'];

function normalizeInlineSections(content: string) {
  let normalized = content;

  const sectionPattern = new RegExp(`([^\\n])\\s+(?=(?:${SECTION_EMOJIS.join('|')})\\s)`, 'g');
  normalized = normalized.replace(sectionPattern, '$1\n\n');

  normalized = normalized.replace(/([^\n])\s+(\d+\.\s+)/g, '$1\n$2');
  normalized = normalized.replace(/([^\n])\s+[-•]\s+/g, '$1\n- ');

  return normalized;
}

function normalizeHeadingLabel(line: string) {
  const trimmed = line.trim().replace(/^#{1,6}\s*/, '').replace(/\*+/g, '').trim();
  const mapped = HEADING_EMOJI_MAP.find((entry) => entry.pattern.test(trimmed));
  return mapped ? mapped.label : trimmed;
}

function isLikelyHeading(line: string) {
  const normalized = line.trim().replace(/^#{1,6}\s*/, '').replace(/\*+/g, '').trim();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith('- ') || /^\d+\./.test(normalized)) {
    return false;
  }

  return HEADING_EMOJI_MAP.some((entry) => entry.pattern.test(normalized));
}

export function formatAssistantMarkdown(content: string) {
  const lines = normalizeInlineSections(content).split('\n');
  const formattedLines: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (formattedLines[formattedLines.length - 1] !== '') {
        formattedLines.push('');
      }
      return;
    }

    if (isLikelyHeading(trimmed)) {
      if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== '') {
        formattedLines.push('');
      }
      formattedLines.push(`**${normalizeHeadingLabel(trimmed)}**`);
      formattedLines.push('');
      return;
    }

    formattedLines.push(line.replace(/^##+\s+/, '').trimEnd());
  });

  return formattedLines.join('\n');
}
