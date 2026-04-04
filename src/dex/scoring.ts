/**
 * XFlow DEX - Route scoring
 * weights: price 50% / liquidity 30% / gas 15% / reliability 5%
 */
import { RouteScore } from './types';

export function scoreRoutes(
  okxAmount: number,
  uniswapAmount: number | null,
  liquidityUSD: number,
  okxGasUSD: number,
  uniswapGasUSD: number,
): { okx: RouteScore; uniswap: RouteScore | null } {
  const W = { price: 0.50, liquidity: 0.30, gas: 0.15, reliability: 0.05 };

  const liquidityScore = Math.min(1, liquidityUSD / 1_000_000);

  const best = Math.max(okxAmount, uniswapAmount ?? 0);
  const okxPriceScore     = best > 0 ? okxAmount / best : 0;
  const uniswapPriceScore = uniswapAmount && best > 0 ? uniswapAmount / best : 0;

  const maxGas = Math.max(okxGasUSD, uniswapGasUSD, 0.001);
  const okxGasScore     = 1 - okxGasUSD / maxGas;
  const uniswapGasScore = uniswapGasUSD ? 1 - uniswapGasUSD / maxGas : 0;

  const okxReliability     = 0.9;
  const uniswapReliability = liquidityUSD > 100_000 ? 0.85 : 0.5;

  const okxTotal = (
    okxPriceScore  * W.price +
    liquidityScore * W.liquidity +
    okxGasScore    * W.gas +
    okxReliability * W.reliability
  );

  const okxScore: RouteScore = {
    route: 'OKX',
    toAmount: okxAmount,
    priceScore: okxPriceScore,
    liquidityScore,
    gasScore: okxGasScore,
    reliabilityScore: okxReliability,
    totalScore: okxTotal,
    reason: `OKX DEX Aggregator on X Layer · price ${(okxPriceScore * 100).toFixed(1)}% · liq $${liquidityUSD.toFixed(0)} · gas $${okxGasUSD.toFixed(4)}`,
  };

  if (uniswapAmount === null) {
    return { okx: okxScore, uniswap: null };
  }

  const uniswapTotal = (
    uniswapPriceScore   * W.price +
    liquidityScore      * W.liquidity +
    uniswapGasScore     * W.gas +
    uniswapReliability  * W.reliability
  );

  const uniswapScore: RouteScore = {
    route: 'Uniswap',
    toAmount: uniswapAmount,
    priceScore: uniswapPriceScore,
    liquidityScore,
    gasScore: uniswapGasScore,
    reliabilityScore: uniswapReliability,
    totalScore: uniswapTotal,
    reason: `Uniswap V3 · price ${(uniswapPriceScore * 100).toFixed(1)}% · liq $${liquidityUSD.toFixed(0)} · gas $${uniswapGasUSD.toFixed(4)}`,
  };

  return { okx: okxScore, uniswap: uniswapScore };
}
