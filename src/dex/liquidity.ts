/**
 * XFlow DEX - Route selection (core orchestration)
 */
import { SwapRequest, RouteDecision, LIQUIDITY_THRESHOLD_USD, STABLECOINS, TOKENS } from './types';
import { getSwapQuote } from './integrations/okx';
import { getUniswapPoolLiquidity, getUniswapQuote, UNISWAP_SUPPORTED_CHAINS } from './integrations/uniswap';
import { scoreRoutes } from './scoring';

export interface BestRouteResult {
  quote: any;
  decision: RouteDecision;
  uniswapRawQuote?: any; // preserved for TX generation step
}

export async function selectBestRoute(
  req: SwapRequest,
): Promise<BestRouteResult> {
  const chainId  = req.chainId ?? 196;
  const fromAddr = req.fromTokenAddress || TOKENS[(req.fromToken || '').toUpperCase()] || '';
  const toAddr   = req.toTokenAddress   || TOKENS[(req.toToken   || '').toUpperCase()] || '';

  // Step 1: OKX quote (always available on X Layer)
  const okxQuote  = await getSwapQuote(req);
  const okxAmount = parseFloat(okxQuote.toAmount);
  const okxGasUSD = parseFloat(okxQuote.estimateGasFee || '0') / 1e18 * 40;

  // Step 2: Liquidity check
  const liquidityUSD = await getUniswapPoolLiquidity(chainId, fromAddr, toAddr);
  console.log(`📊 Uniswap pool liquidity: $${liquidityUSD.toLocaleString()}`);

  if (liquidityUSD < LIQUIDITY_THRESHOLD_USD || !UNISWAP_SUPPORTED_CHAINS[chainId]) {
    const reason = liquidityUSD < LIQUIDITY_THRESHOLD_USD
      ? `Uniswap liquidity $${liquidityUSD.toFixed(0)} below threshold $${LIQUIDITY_THRESHOLD_USD} → OKX fixed`
      : `Chain ${chainId} not supported by Uniswap → OKX fixed`;
    console.log(`   ${reason}`);

    const { okx } = scoreRoutes(okxAmount, null, liquidityUSD, okxGasUSD, 0);
    return {
      quote: okxQuote,
      decision: { selected: 'OKX', okx, uniswap: null, reason, liquidityUSD },
    };
  }

  // Step 3: Uniswap quote (pass real swapper for TX-ready rawQuote)
  const fromSym   = (req.fromTokenSymbol || req.fromToken || '').toUpperCase();
  const decimals  = STABLECOINS.includes(fromSym) ? 6 : 18;
  const amountRaw = Math.floor(parseFloat(req.amount) * 10 ** decimals).toString();

  const uniResult = await getUniswapQuote(
    chainId, fromAddr, toAddr, amountRaw,
    req.userAddress !== '0x0000000000000000000000000000000000000001' ? req.userAddress : undefined,
  );
  const uniAmount = uniResult?.toAmount ?? null;
  const uniGasUSD = uniResult?.gasUSD   ?? 0;

  // Step 4: Score both routes
  const { okx: okxScore, uniswap: uniswapScore } = scoreRoutes(
    okxAmount, uniAmount, liquidityUSD, okxGasUSD, uniGasUSD,
  );

  const selectedRoute = (uniswapScore && uniswapScore.totalScore > okxScore.totalScore)
    ? 'Uniswap' : 'OKX';

  const winnerScore = selectedRoute === 'OKX' ? okxScore : uniswapScore!;
  const loserScore  = selectedRoute === 'OKX' ? uniswapScore! : okxScore;

  console.log(`🏆 Route selected: ${selectedRoute} (score ${winnerScore.totalScore.toFixed(3)} vs ${loserScore.totalScore.toFixed(3)})`);
  console.log(`   ${winnerScore.reason}`);

  const decision: RouteDecision = {
    selected: selectedRoute,
    okx: okxScore,
    uniswap: uniswapScore,
    reason: `${selectedRoute} wins · score ${winnerScore.totalScore.toFixed(3)} vs ${loserScore.totalScore.toFixed(3)}`,
    liquidityUSD,
  };

  return {
    quote: okxQuote,
    decision,
    uniswapRawQuote: uniResult?.rawQuote,
  };
}
