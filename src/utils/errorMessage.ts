export function getErrorMessage(
  error: unknown,
  fallback = 'Operazione non riuscita.',
) {
  if (!error) {
    return fallback;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      error_description?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };

    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message;
    }

    if (typeof candidate.error_description === 'string' && candidate.error_description.trim()) {
      return candidate.error_description;
    }

    const fragments = [
      typeof candidate.details === 'string' ? candidate.details : '',
      typeof candidate.hint === 'string' ? candidate.hint : '',
      typeof candidate.code === 'string' ? `code: ${candidate.code}` : '',
    ].filter(Boolean);

    if (fragments.length > 0) {
      return fragments.join(' | ');
    }
  }

  return fallback;
}
