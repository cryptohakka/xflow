/**
 * XFlow DEX Agent
 * Returns swap TX data for X Layer via OKX DEX Aggregator
 * Actual execution is done by the caller (agent or user)
 *
 * Phase 2 additions:
 * - Uniswap V4 pool liquidity check
 * - Multi-factor scoring: OKX vs Uniswap route selection
 * - Decision log output for dashboard
 */
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';

const CHAIN_INDEX = '196'; // X Layer

function loadEnv(): Record<string, string> {
  try {
    return readFileSync('/home/agent/xflow/.env', 'utf-8')
      .split('\n').reduce((acc, line) => {
        const [k, ...v] = line.split('=');
        if (k && v.length) acc[k.trim()] = v.join('=').trim();
        return acc;
      }, {} as Record<string, string>);
  } catch { return {}; }
}
const _env = loadEnv();

function getEnv(key: string): string {
  return process.env[key] || _env[key] || '';
}

function makeHeaders(path: string, method = 'GET', body = '') {
  const timestamp = new Date().toISOString();
  const message = timestamp + method + path + body;
  const sign = createHmac('sha256', getEnv('OKX_SECRET_KEY')).update(message).digest('base64');
  return {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': getEnv('OKX_API_KEY'),
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': getEnv('OKX_PASSPHRASE'),
  };
}

const TOKENS: Record<string, string> = {
  USDC: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
  WOKB: '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  OKB:  '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  USDT0: '0x779ded0c9e1022225f8e0630b35a9b54be713736',
};

const OKX_ROUTER_XLAYER = '0x8b773d83bc66be128c60e07e17c8901f7a64f000';

// ─────────────────────────────────────────────────────────────
// Phase 2: Uniswap config per chain
// ─────────────────────────────────────────────────────────────

// Uniswap V3 subgraph endpoints (V4 subgraph not yet widely available)
const UNISWAP_SUBGRAPHS: Record<number, string> = {
  8453:  'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base',
  137:   'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-polygon',
  43114: 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-avalanche',
};

// Uniswap Trading API chain IDs
const UNISWAP_SUPPORTED_CHAINS: Record<number, boolean> = {
  8453: true,
  137:  true,
  43114: true,
};

// ─────────────────────────────────────────────────────────────

export interface SwapRequest {
  fromToken: string;
  toToken: string;
  amount: string;
  userAddress: string;
  slippage?: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
  fromTokenSymbol?: string;
  chainId?: number; // Phase 2: which chain to route on
}

// ─────────────────────────────────────────────────────────────
// Phase 2: Route scoring types
// ─────────────────────────────────────────────────────────────

export interface RouteScore {
  route: 'OKX' | 'Uniswap';
  toAmount: number;
  priceScore: number;      // 0–1, normalized
  liquidityScore: number;  // 0–1
  gasScore: number;        // 0–1
  reliabilityScore: number;// 0–1
  totalScore: number;      // weighted composite
  reason: string;
}

export interface RouteDecision {
  selected: 'OKX' | 'Uniswap';
  okx: RouteScore | null;
  uniswap: RouteScore | null;
  reason: string;
  liquidityUSD?: number;
}

// ─────────────────────────────────────────────────────────────
// Uniswap pool liquidity check (V3 subgraph)
// ─────────────────────────────────────────────────────────────

async function getUniswapPoolLiquidity(
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
    const res = await fetch(subgraph, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as any;
    const tvl = parseFloat(data?.data?.pools?.[0]?.totalValueLockedUSD || '0');
    return tvl;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// Uniswap Trading API quote
// ─────────────────────────────────────────────────────────────

async function getUniswapQuote(
  chainId: number,
  tokenIn: string,
  tokenOut: string,
  amountIn: string, // raw units
): Promise<{ toAmount: number; gasUSD: number } | null> {
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
        tokenInChainId: chainId,
        tokenOutChainId: chainId,
        tokenIn,
        tokenOut,
        amount: amountIn,
        swapper: '0x0000000000000000000000000000000000000001',
        slippageTolerance: '0.5',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    const toAmount = parseInt(data?.quote?.output?.amount || '0') / 1e6;
    const gasUSD   = parseFloat(data?.quote?.gasFeeUSD || '0');
    return { toAmount, gasUSD };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Multi-factor route scoring
// weights: price 50% / liquidity 30% / gas 15% / reliability 5%
// ─────────────────────────────────────────────────────────────

function scoreRoutes(
  okxAmount: number,
  uniswapAmount: number | null,
  liquidityUSD: number,
  okxGasUSD: number,
  uniswapGasUSD: number,
): { okx: RouteScore; uniswap: RouteScore | null } {
  const W = { price: 0.50, liquidity: 0.30, gas: 0.15, reliability: 0.05 };

  // Liquidity score: sigmoid-like, $100k TVL = 0.5, $1M = ~0.9
  const liquidityScore = Math.min(1, liquidityUSD / 1_000_000);

  // Price scores: normalize relative to each other
  const best = Math.max(okxAmount, uniswapAmount ?? 0);
  const okxPriceScore      = best > 0 ? okxAmount / best : 0;
  const uniswapPriceScore  = uniswapAmount && best > 0 ? uniswapAmount / best : 0;

  // Gas scores: lower gas = higher score (invert, normalize to 0–1)
  const maxGas = Math.max(okxGasUSD, uniswapGasUSD, 0.001);
  const okxGasScore      = 1 - okxGasUSD / maxGas;
  const uniswapGasScore  = uniswapGasUSD ? 1 - uniswapGasUSD / maxGas : 0;

  // Reliability: OKX on X Layer proven; Uniswap gets liquidity-based score
  const okxReliability      = 0.9;
  const uniswapReliability  = liquidityUSD > 100_000 ? 0.85 : 0.5;

  const okxTotal = (
    okxPriceScore     * W.price +
    liquidityScore    * W.liquidity +  // same pool affects both
    okxGasScore       * W.gas +
    okxReliability    * W.reliability
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

// ─────────────────────────────────────────────────────────────
// OKX quote/swap (unchanged, refactored into helpers)
// ─────────────────────────────────────────────────────────────

export async function getSwapQuote(req: SwapRequest) {
  const fromAddr = req.fromTokenAddress || TOKENS[(req.fromToken||'').toUpperCase()] || req.fromToken || '';
  const toAddr   = req.toTokenAddress   || TOKENS[(req.toToken||'').toUpperCase()]   || req.toToken   || '';

  const stablecoins = ['USDC', 'USDT', 'USDT0', 'USDG', 'DAI', 'CRVUSD'];
  const fromSym = (req.fromTokenSymbol || req.fromToken || '').toUpperCase();
  const decimals = stablecoins.includes(fromSym) ? 6 : 18;
  const amountRaw = (Math.floor(parseFloat(req.amount) * 10 ** decimals) + Math.floor(Math.random() * 3)).toString();

  const query = `chainIndex=${CHAIN_INDEX}&amount=${amountRaw}&fromTokenAddress=${fromAddr}&toTokenAddress=${toAddr}`;
  const path = `/api/v6/dex/aggregator/quote?${query}`;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 8000);
  const res = await fetch(`https://www.okx.com${path}`, { headers: makeHeaders(path), signal: controller.signal });
  const json = await res.json() as any;
  if (json.code !== '0') throw new Error(`OKX quote error: ${json.msg}`);

  const q = json.data[0];
  const spender: string = OKX_ROUTER_XLAYER;

  const addrToSymbol: Record<string, string> = {
    '0x74b7f16337b8972027f6196a17a631ac6de26d22': 'USDC',
    '0xe538905cf8410324e03a5a23c1c177a474d59b2b': 'WOKB',
    '0x5a77f1443d16ee5761d310e38b62f77f726bc71c': 'WETH',
    '0x1e4a5963abfd975d8c9021ce480b42188849d41d': 'USDT',
  };
  const resolvedFromSymbol = (req.fromTokenAddress && addrToSymbol[req.fromTokenAddress.toLowerCase()]) || req.fromToken.toUpperCase();
  const resolvedToSymbol   = (req.toTokenAddress   && addrToSymbol[req.toTokenAddress.toLowerCase()])   || req.toToken.toUpperCase();

  return {
    fromToken: resolvedFromSymbol,
    toToken: resolvedToSymbol,
    fromAmount: req.amount,
    toAmount: (parseInt(q.toTokenAmount) / 10 ** parseInt(q.toToken.decimal)).toFixed(6),
    route: q.dexRouterList[0]?.dexProtocol?.dexName,
    priceImpact: q.priceImpactPercent + '%',
    estimateGasFee: q.estimateGasFee,
    isHoneyPot: q.toToken?.isHoneyPot || false,
    taxRate: q.toToken?.taxRate || '0',
    toTokenUnitPrice: q.toToken?.tokenUnitPrice || '0',
    fromTokenAddress: fromAddr,
    toTokenAddress: toAddr,
    spender,
  };
}

export async function getSwapTxData(req: SwapRequest) {
  const fromAddr = req.fromTokenAddress || TOKENS[(req.fromToken||'').toUpperCase()] || req.fromToken || '';
  const toAddr   = req.toTokenAddress   || TOKENS[(req.toToken||'').toUpperCase()]   || req.toToken   || '';

  const stablecoinsForTx = ['USDC', 'USDT', 'USDT0', 'USDG', 'DAI', 'CRVUSD'];
  const decimals = stablecoinsForTx.includes(req.fromToken.toUpperCase()) ? 6 : 18;
  const amountRaw = (Math.floor(parseFloat(req.amount) * 10 ** decimals) + Math.floor(Math.random() * 3)).toString();
  const slippage = (parseFloat(req.slippage || '1.0') + Math.random() * 0.1).toFixed(4);

  const safeFromAddr = fromAddr || undefined;
  const safeToAddr   = toAddr   || undefined;
  const params = new URLSearchParams({
    chainIndex: CHAIN_INDEX,
    amount: amountRaw,
    userWalletAddress: req.userAddress,
    slippagePercent: slippage,
  });
  if (safeFromAddr) params.set('fromTokenAddress', safeFromAddr);
  if (safeToAddr)   params.set('toTokenAddress',   safeToAddr);
  const query = params.toString();
  const path = `/api/v6/dex/aggregator/swap?${query}`;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 8000);
  const res = await fetch(`https://www.okx.com${path}`, { headers: makeHeaders(path), signal: controller.signal });
  const json = await res.json() as any;
  if (json.code !== '0') throw new Error(`OKX swap error: ${json.msg}`);

  const tx = json.data[0].tx;
  const q  = json.data[0];
  return {
    fromToken: req.fromToken.toUpperCase(),
    toToken: req.toToken.toUpperCase(),
    fromAmount: req.amount,
    toAmount: (parseInt(q.routerResult?.toTokenAmount || '0') / 10 ** parseInt(q.routerResult?.toToken?.decimal || '18')).toFixed(6),
    tx: {
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      chainId: 196,
    },
    note: 'Sign and send this TX with your wallet to execute the swap on X Layer',
  };
}

// ─────────────────────────────────────────────────────────────
// Phase 2: Smart route selection
// Checks liquidity → if sufficient, scores OKX vs Uniswap
// ─────────────────────────────────────────────────────────────

const LIQUIDITY_THRESHOLD_USD = 50_000; // below this → OKX only

export async function selectBestRoute(
  req: SwapRequest,
): Promise<{ quote: any; decision: RouteDecision }> {
  const chainId = req.chainId ?? 196; // default X Layer
  const fromAddr = req.fromTokenAddress || TOKENS[(req.fromToken||'').toUpperCase()] || '';
  const toAddr   = req.toTokenAddress   || TOKENS[(req.toToken||'').toUpperCase()]   || '';

  // Step 1: OKX quote (always available on X Layer)
  const okxQuote = await getSwapQuote(req);
  const okxAmount = parseFloat(okxQuote.toAmount);
  const okxGasUSD = parseFloat(okxQuote.estimateGasFee || '0') / 1e18 * 40; // rough OKB price

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
      decision: {
        selected: 'OKX',
        okx,
        uniswap: null,
        reason,
        liquidityUSD,
      },
    };
  }

  // Step 3: Uniswap quote
  const stablecoins = ['USDC', 'USDT', 'USDT0', 'USDG', 'DAI'];
  const fromSym = (req.fromTokenSymbol || req.fromToken || '').toUpperCase();
  const decimals = stablecoins.includes(fromSym) ? 6 : 18;
  const amountRaw = Math.floor(parseFloat(req.amount) * 10 ** decimals).toString();

  const uniResult = await getUniswapQuote(chainId, fromAddr, toAddr, amountRaw);
  const uniAmount = uniResult?.toAmount ?? null;
  const uniGasUSD = uniResult?.gasUSD ?? 0;

  // Step 4: Score both routes
  const { okx: okxScore, uniswap: uniswapScore } = scoreRoutes(
    okxAmount, uniAmount, liquidityUSD, okxGasUSD, uniGasUSD,
  );

  const selectedRoute = (uniswapScore && uniswapScore.totalScore > okxScore.totalScore)
    ? 'Uniswap' : 'OKX';

  const winnerScore  = selectedRoute === 'OKX' ? okxScore : uniswapScore!;
  const loserScore   = selectedRoute === 'OKX' ? uniswapScore! : okxScore;

  console.log(`🏆 Route selected: ${selectedRoute} (score ${winnerScore.totalScore.toFixed(3)} vs ${loserScore.totalScore.toFixed(3)})`);
  console.log(`   ${winnerScore.reason}`);

  const decision: RouteDecision = {
    selected: selectedRoute,
    okx: okxScore,
    uniswap: uniswapScore,
    reason: `${selectedRoute} wins · score ${winnerScore.totalScore.toFixed(3)} vs ${loserScore.totalScore.toFixed(3)}`,
    liquidityUSD,
  };

  return { quote: okxQuote, decision };
}

// ─────────────────────────────────────────────────────────────

export async function handleDexQuery(query: string, userAddress?: string, existingQuote?: any): Promise<any> {
  const isSwap = /swap|buy|sell|trade/i.test(query);
  const okbToUsdc = /okb.*usdc|wokb.*usdc/i.test(query);

  if (isSwap && userAddress) {
    const req: SwapRequest = {
      fromToken: existingQuote?.fromToken || 'USDC',
      toToken:   existingQuote?.toToken   || 'WOKB',
      amount:    existingQuote?.fromAmount || '1.0',
      userAddress,
      fromTokenAddress: existingQuote?.fromTokenAddress,
      toTokenAddress:   existingQuote?.toTokenAddress,
    };
    return getSwapTxData(req);
  }

  if (isSwap && existingQuote) {
    return existingQuote;
  }

  if (isSwap) {
    const req: SwapRequest = {
      fromToken: okbToUsdc ? 'WOKB' : 'USDC',
      toToken:   okbToUsdc ? 'USDC' : 'WOKB',
      amount: existingQuote?.fromAmount || '1.0',
      userAddress: '0x0000000000000000000000000000000000000001',
    };
    // Phase 2: use smart route selection
    const { quote, decision } = await selectBestRoute(req);
    return { ...quote, routeDecision: decision };
  }

  return { agent: 'dex', query, status: 'unsupported query' };
}
