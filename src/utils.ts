/**
 * XFlow Shared Utilities
 */

const EXPLORER_BASES: Record<string, string> = {
  base:      'https://basescan.org/tx/',
  xlayer:    'https://www.okx.com/web3/explorer/xlayer/tx/',
  polygon:   'https://polygonscan.com/tx/',
  avalanche: 'https://snowtrace.io/tx/',
};

export function explorerLink(hash: string, chain: string): string {
  const b = EXPLORER_BASES[chain.toLowerCase()];
  return b ? `${b}${hash}` : hash;
}

export const TOKEN_DECIMALS: Record<string, number> = {
  WBTC:  8,
  BTC:   8,
  USDC:  6,
  USDT:  6,
  USDT0: 6,
  USDG:  6,
  DAI:   18,
  WETH:  18,
  ETH:   18,
  WOKB:  18,
  OKB:   18,
  UNI:   18,
  USDS:  18,
};

export function getTokenDecimals(symbol: string): number {
  return TOKEN_DECIMALS[symbol.toUpperCase()] ?? 18;
}
