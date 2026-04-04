/**
 * XFlow DEX Agent - Entry point
 * Delegates to dex/* modules; maintains backward-compatible exports
 */
import { SwapRequest, RouteDecision } from './dex/types';
import { getSwapQuote, getSwapTxData } from './dex/integrations/okx';
import { selectBestRoute } from './dex/liquidity';

export type { SwapRequest, RouteDecision };
export { getSwapQuote, getSwapTxData, selectBestRoute };

export async function handleDexQuery(query: string, userAddress?: string, existingQuote?: any): Promise<any> {
  const isSwap    = /swap|buy|sell|trade/i.test(query);
  const okbToUsdc = /okb.*usdc|wokb.*usdc/i.test(query);

  if (isSwap && userAddress) {
    const req: SwapRequest = {
      fromToken:        existingQuote?.fromToken    || 'USDC',
      toToken:          existingQuote?.toToken      || 'WOKB',
      amount:           existingQuote?.fromAmount   || '1.0',
      userAddress,
      fromTokenAddress: existingQuote?.fromTokenAddress,
      toTokenAddress:   existingQuote?.toTokenAddress,
    };
    return getSwapTxData(req);
  }

  if (isSwap && existingQuote) return existingQuote;

  if (isSwap) {
    const req: SwapRequest = {
      fromToken:   okbToUsdc ? 'WOKB' : 'USDC',
      toToken:     okbToUsdc ? 'USDC' : 'WOKB',
      amount:      existingQuote?.fromAmount || '1.0',
      userAddress: '0x0000000000000000000000000000000000000001',
    };
    const { quote, decision } = await selectBestRoute(req);
    return { ...quote, routeDecision: decision };
  }

  return { agent: 'dex', query, status: 'unsupported query' };
}
