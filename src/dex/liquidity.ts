/**
 * XFlow DEX - Route selection (core orchestration)
 */
import { SwapRequest, RouteDecision, LIQUIDITY_THRESHOLD_USD, STABLECOINS, TOKENS } from './types';
import { getSwapQuote } from './integrations/okx';
import { getUniswapPoolLiquidity, getUniswapQuote, getUniswapSwapTx, UNISWAP_SUPPORTED_CHAINS } from './integrations/uniswap';
import { scoreRoutes } from './scoring';

// Chains where OKX DEX Aggregator is available
const OKX_SUPPORTED_CHAINS = new Set([196, 8453, 137, 43114]);

export interface BestRouteResult {
  quote: any;
  decision: RouteDecision;
  uniswapRawQuote?: any;
}

export async function selectBestRoute(
  req: SwapRequest,
): Promise<BestRouteResult> {
  const chainId  = req.chainId ?? 196;
  const fromAddr = req.fromTokenAddress || TOKENS[(req.fromToken || '').toUpperCase()] || '';
  const toAddr   = req.toTokenAddress   || TOKENS[(req.toToken   || '').toUpperCase()] || '';

  const fromSym   = (req.fromTokenSymbol || req.fromToken || '').toUpperCase();
  const decimals  = STABLECOINS.includes(fromSym) ? 6 : 18;
  const amountRaw = Math.floor(parseFloat(req.amount) * 10 ** decimals).toString();

  // ── OKX非対応チェーン: Uniswap直接 ───────────────────────────
  if (!OKX_SUPPORTED_CHAINS.has(chainId)) {
    console.log(`⛓️  Chain ${chainId} not supported by OKX → Uniswap direct`);

    if (!UNISWAP_SUPPORTED_CHAINS[chainId]) {
      throw new Error(`Chain ${chainId} is not supported by OKX or Uniswap`);
    }

    const uniResult = await getUniswapQuote(
      chainId, fromAddr, toAddr, amountRaw,
      req.userAddress !== '0x0000000000000000000000000000000000000001' ? req.userAddress : undefined,
    );

    if (!uniResult) {
      throw new Error(`Uniswap quote failed for chain ${chainId}`);
    }

    const toAmount = uniResult.toAmount;
    const liquidityUSD = await getUniswapPoolLiquidity(chainId, fromAddr, toAddr);

    const quote = {
      fromToken:        req.fromToken.toUpperCase(),
      toToken:          req.toToken.toUpperCase(),
      fromAmount:       req.amount,
      toAmount:         toAmount.toFixed(6),
      route:            'Uniswap V3',
      priceImpact:      uniResult.priceImpact,
      estimateGasFee:   String(Math.round(uniResult.gasUSD * 1e18 / 2000)),
      isHoneyPot:       false,
      taxRate:          '0',
      toTokenUnitPrice: '0',
      fromTokenAddress: fromAddr,
      toTokenAddress:   toAddr,
      spender:          '',  // set from freshTx.to
      chainId,
    };

    const decision: RouteDecision = {
      selected: 'Uniswap',
      okx: null,
      uniswap: {
        route: 'Uniswap',
        toAmount,
        priceScore:      1,
        liquidityScore:  Math.min(1, liquidityUSD / 1_000_000),
        gasScore:        1,
        reliabilityScore: 0.85,
        totalScore:      1,
        reason: `Uniswap direct · chain ${chainId} · liq $${liquidityUSD.toFixed(0)} · impact ${uniResult.priceImpact}`,
      },
      reason: `Uniswap direct (OKX not available on chain ${chainId})`,
      liquidityUSD,
    };

    console.log(`🦄 Uniswap direct: ${req.fromToken} → ${req.toToken} · impact ${uniResult.priceImpact}`);

    return { quote, decision, uniswapRawQuote: uniResult.rawQuote };
  }

  // ── OKX対応チェーン: 従来のscoring ───────────────────────────

  // Step 1: OKX quote
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

  // Step 3: Uniswap quote
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

  // Uniswap選択時はpriceImpactをUniswap APIから上書き
  let finalQuote = okxQuote;
  if (selectedRoute === 'Uniswap' && uniResult) {
    finalQuote = {
      ...okxQuote,
      toAmount:    uniResult.toAmount.toFixed(6),
      priceImpact: uniResult.priceImpact,
      route:       'Uniswap V3',
    };
  }

  const decision: RouteDecision = {
    selected: selectedRoute,
    okx: okxScore,
    uniswap: uniswapScore,
    reason: `${selectedRoute} wins · score ${winnerScore.totalScore.toFixed(3)} vs ${loserScore.totalScore.toFixed(3)}`,
    liquidityUSD,
  };

  return {
    quote: finalQuote,
    decision,
    uniswapRawQuote: uniResult?.rawQuote,
  };
}
