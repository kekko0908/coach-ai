function hexToUuid(hex: string) {
  const normalized = hex.padEnd(32, '0').slice(0, 32);
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join('-');
}

function hashStringToHex(value: string) {
  let hashA = 0x811c9dc5;
  let hashB = 0x01000193;
  let hashC = 0x9e3779b1;
  let hashD = 0x85ebca77;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x27d4eb2d);
    hashC = Math.imul(hashC ^ code, 0x165667b1);
    hashD = Math.imul(hashD ^ code, 0x85ebca6b);
  }

  return [hashA, hashB, hashC, hashD]
    .map((valuePart) => (valuePart >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export function createAppUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return hexToUuid(hashStringToHex(`${Date.now()}-${Math.random()}`));
}

export function createDeterministicUuid(seed: string) {
  return hexToUuid(hashStringToHex(seed));
}
