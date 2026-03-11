const HEADING_PATTERNS = [
  /^verdetto$/i,
  /^punti di forza$/i,
  /^punti chiave$/i,
  /^cosa migliorare$/i,
  /^aree di attenzione(?:\s*\(.*\))?$/i,
  /^consiglio(?:i)? per i prossimi giorni$/i,
  /^prossimo step$/i,
  /^recupero$/i,
  /^sintesi$/i,
];

function isLikelyHeading(line: string) {
  if (line.startsWith('#') || line.startsWith('- ') || /^\d+\./.test(line)) {
    return false;
  }

  return HEADING_PATTERNS.some((pattern) => pattern.test(line.trim()));
}

export function formatAssistantMarkdown(content: string) {
  const lines = content.split('\n');

  const formattedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return '';
    }

    if (isLikelyHeading(trimmed)) {
      return `### ${trimmed}`;
    }

    return line;
  });

  return formattedLines.join('\n');
}
