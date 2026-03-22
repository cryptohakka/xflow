/**
 * XFlow Shared Utilities
 */

const EXPLORER_BASES: Record<string, string> = {
  base:      'https://basescan.org/tx/',
  xlayer:    'https://www.oklink.com/xlayer/tx/',
  polygon:   'https://polygonscan.com/tx/',
  avalanche: 'https://snowtrace.io/tx/',
};

export function explorerLink(hash: string, chain: string): string {
  const b = EXPLORER_BASES[chain.toLowerCase()];
  return b ? `${b}${hash}` : hash;
}
