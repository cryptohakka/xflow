/**
 * XFlow DEX - Shared types and constants
 */

export const CHAIN_INDEX = '196'; // X Layer

export const TOKENS: Record<string, string> = {
  USDC:  '0x74b7f16337b8972027f6196a17a631ac6de26d22',
  WOKB:  '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  OKB:   '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  USDT0: '0x779ded0c9e1022225f8e0630b35a9b54be713736',
};

export const OKX_ROUTER_XLAYER = '0x8b773d83bc66be128c60e07e17c8901f7a64f000';

export const STABLECOINS = ['USDC', 'USDT', 'USDT0', 'USDG', 'DAI', 'CRVUSD'];

export const LIQUIDITY_THRESHOLD_USD = 50_000;

export interface SwapRequest {
  fromToken: string;
  toToken: string;
  amount: string;
  userAddress: string;
  slippage?: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
  fromTokenSymbol?: string;
  chainId?: number;
}

export interface RouteScore {
  route: 'OKX' | 'Uniswap';
  toAmount: number;
  priceScore: number;
  liquidityScore: number;
  gasScore: number;
  reliabilityScore: number;
  totalScore: number;
  reason: string;
}

export interface RouteDecision {
  selected: 'OKX' | 'Uniswap';
  okx: RouteScore | null;
  uniswap: RouteScore | null;
  reason: string;
  liquidityUSD?: number;
}
