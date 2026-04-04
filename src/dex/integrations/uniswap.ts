/**
 * XFlow DEX - Uniswap integration (V3 subgraph + Trading API)
 */
import { getEnv } from './okx';

export const UNISWAP_SUBGRAPHS: Record<number, string> = {
  8453:  'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base',
  137:   'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-polygon',
  43114: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-avalanche',
  130:   'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-unichain',
};

export const UNISWAP_SUPPORTED_CHAINS: Record<number, boolean> = {
  8453:  true,
  137:   true,
  43114: true,
  130:   true,
};

export async function getUniswapPoolLiquidity(
  chainId: number,
  token0: string,
  token1: string,
): Promise<number> {
  const subgraph = UNISWAP_SUBGRAPHS[chainId];
  if (!subgraph) return 0;

  const query = `{
    pools(
      where: {
        token0_in: ["${token0.toLowerCase()}", "${token1.toLowerCase()}"],
        token1_in: ["${token0.toLowerCase()}", "${token1.toLowerCase()}"]
      }
      orderBy: totalValueLockedUSD
      orderDirection: desc
      first: 1
    ) {
      totalValueLockedUSD
      feeTier
    }
  }`;

  try {
    const res  = await fetch(subgraph, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as any;
    return parseFloat(data?.data?.pools?.[0]?.totalValueLockedUSD || '0');
  } catch {
    return 0;
  }
}

export interface UniswapQuoteResult {
  toAmount: number;
  gasUSD: number;
  rawQuote: any; // full API response, needed for /v1/swap
}

export async function getUniswapQuote(
  chainId: number,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  swapper?: string,
): Promise<UniswapQuoteResult | null> {
  const apiKey = getEnv('UNISWAP_API_KEY');
  if (!apiKey || !UNISWAP_SUPPORTED_CHAINS[chainId]) return null;

  try {
    const res = await fetch('https://trade-api.gateway.uniswap.org/v1/quote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        type: 'EXACT_INPUT',
        tokenInChainId:  chainId,
        tokenOutChainId: chainId,
        tokenIn,
        tokenOut,
        amount: amountIn,
        swapper: swapper || '0x0000000000000000000000000000000000000001',
        slippageTolerance: '0.5',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data     = await res.json() as any;
    const toAmount = parseInt(data?.quote?.output?.amount || '0') / 1e6;
    const gasUSD   = parseFloat(data?.quote?.gasFeeUSD || '0');
    return { toAmount, gasUSD, rawQuote: data };
  } catch {
    return null;
  }
}

export interface UniswapSwapTxResult {
  to: string;
  data: string;
  value: string;
  gas: string;
  gasPrice?: string;
  chainId: number;
}

/**
 * Get executable TX from Uniswap Trading API /v1/swap.
 * Pass rawQuote from getUniswapQuote.
 * If permitData is present in rawQuote, sign it first and pass the signature.
 */
export async function getUniswapSwapTx(
  chainId: number,
  rawQuote: any,
  swapper: string,
  signature?: string,
): Promise<UniswapSwapTxResult | null> {
  const apiKey = getEnv('UNISWAP_API_KEY');
  if (!apiKey) return null;

  const classicQuote = rawQuote?.quote;
  if (!classicQuote) return null;

  const body: Record<string, any> = { classicQuote };

  const permitData = rawQuote?.permitData;
  if (permitData && signature) {
    body.signature  = signature;
    body.permitData = permitData;
  }

  try {
    const res = await fetch('https://trade-api.gateway.uniswap.org/v1/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[Uniswap /v1/swap] ${res.status}: ${err}`);
      return null;
    }

    const data = await res.json() as any;
    const tx   = data?.swap;
    if (!tx?.to || !tx?.data) {
      console.warn('[Uniswap /v1/swap] invalid TX:', JSON.stringify(data));
      return null;
    }

    return {
      to:       tx.to,
      data:     tx.data,
      value:    tx.value   || '0x0',
      gas:      tx.gas     || tx.gasLimit || '300000',
      gasPrice: tx.gasPrice,
      chainId,
    };
  } catch (e: any) {
    console.warn('[Uniswap /v1/swap] error:', e.message);
    return null;
  }
}
