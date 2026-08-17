/** True when text contains Arabic-script characters (Urdu labels). */
export function containsUrduScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

export function urduLabelClassName(text: string, base = ''): string {
  const urdu = containsUrduScript(text) ? 'field-label-urdu' : '';
  return [base, urdu].filter(Boolean).join(' ');
}
