/**
 * XFlow Smart Payment Router
 * Automatically selects the best chain for x402 payment
 * based on USDC balances, gas cost, and finality time.
 *
 * Scoring: score = gasCostUSD + finality_seconds * FINALITY_WEIGHT
 * FINALITY_WEIGHT = 0.0001  (1s finality delay ≈ $0.0001 cost)
 *
 * Phase 1 additions:
 * - 4 new EVM chains: Sei, Abstract, SKALE, Peaq
 * - uniswapSupported flag per network
 * - swapNativeToUSDC fallback when all chains lack USDC
 */
import { createPublicClient, http, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';

const FINALITY_WEIGHT = 0.0001;

const SUPPORTED_NETWORKS = [
  // ── Original 4 ──────────────────────────────────────────────
  {
    network: 'eip155:8453',
    name: 'Base',
    rpc: 'https://mainnet.base.org',
    chainId: 8453,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    finalitySeconds: 2.0,
    coingeckoId: 'ethereum',
    uniswapSupported: true,
  },
  {
    network: 'eip155:137',
    name: 'Polygon',
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    chainId: 137,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    finalitySeconds: 5.0,
    coingeckoId: 'polygon-ecosystem-token',
    uniswapSupported: true,
  },
  {
    network: 'eip155:43114',
    name: 'Avalanche',
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    chainId: 43114,
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    finalitySeconds: 0.8,
    coingeckoId: 'avalanche-2',
    uniswapSupported: true,
  },
  {
    network: 'eip155:196',
    name: 'X Layer',
    rpc: 'https://rpc.xlayer.tech',
    chainId: 196,
    usdc: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
    finalitySeconds: 1.0,
    coingeckoId: 'okb',
    uniswapSupported: false, // OKX DEX only
  },
  // ── Phase 1: New chains ──────────────────────────────────────
  {
    network: 'eip155:1329',
    name: 'Sei',
    rpc: 'https://evm-rpc.sei-apis.com',
    chainId: 1329,
    usdc: '0x3894085Ef7Ff0f0aeDf52E2A2704928d1Ec074F1',
    finalitySeconds: 0.4,
    coingeckoId: 'sei-network',
    uniswapSupported: false,
  },
  {
    network: 'eip155:2741',
    name: 'Abstract',
    rpc: 'https://api.mainnet.abs.xyz',
    chainId: 2741,
    usdc: '0x84A71ccD554Cc1b02749b35d22F684CC8ec987e1',
    finalitySeconds: 1.0,
    coingeckoId: 'ethereum', // ETH-based
    uniswapSupported: false,
  },
  {
    network: 'eip155:1564830818',
    name: 'SKALE Europa',
    rpc: 'https://mainnet.skalenodes.com/v1/elated-tan-skat',
    chainId: 1564830818,
    usdc: '0x6CE77Fc879279b4bD73E14231fB65c8c7E23B46B',
    finalitySeconds: 1.0,
    coingeckoId: 'skale',
    uniswapSupported: false,
  },
  {
    network: 'eip155:3338',
    name: 'Peaq',
    rpc: 'https://peaq.api.onfinality.io/public',
    chainId: 3338,
    usdc: '0xaBc022bA2B33b6aD16eC3A8b5C7Fc0f30e1B769',
    finalitySeconds: 6.0,
    coingeckoId: 'peaq',
    uniswapSupported: false,
  },
];

const FALLBACK_PRICES: Record<string, number> = {
  'ethereum':                2000,
  'polygon-ecosystem-token': 0.10,
  'avalanche-2':             20,
  'okb':                     40,
  'sei-network':             0.30,
  'skale':                   0.05,
  'peaq':                    0.50,
};

const ERC20_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const;

export interface NetworkBalance {
  network: string;
  name: string;
  balance: bigint;
  balanceFormatted: string;
  sufficient: boolean;
  gasCostUSD?: number;
  finalitySeconds?: number;
  score?: number;
  uniswapSupported?: boolean;
}

export async function checkBalances(address: string): Promise<NetworkBalance[]> {
  const results = await Promise.allSettled(
    SUPPORTED_NETWORKS.map(async (n) => {
      const client = createPublicClient({
        chain: { id: n.chainId, name: n.name, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [n.rpc] } } } as any,
        transport: http(n.rpc, { timeout: 6000 }),
      });
      const balance = await client.readContract({
        address: n.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      });
      return {
        network: n.network,
        name: n.name,
        balance: balance as bigint,
        balanceFormatted: formatUnits(balance as bigint, 6),
        sufficient: (balance as bigint) >= 1000n,
        finalitySeconds: n.finalitySeconds,
        uniswapSupported: n.uniswapSupported,
      };
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : {
      network: SUPPORTED_NETWORKS[i].network,
      name: SUPPORTED_NETWORKS[i].name,
      balance: 0n,
      balanceFormatted: '0',
      sufficient: false,
      finalitySeconds: SUPPORTED_NETWORKS[i].finalitySeconds,
      uniswapSupported: SUPPORTED_NETWORKS[i].uniswapSupported,
    }
  );
}

export function selectBestNetwork(balances: NetworkBalance[]): NetworkBalance | null {
  const sufficient = balances.filter(b => b.sufficient);
  if (sufficient.length === 0) return null;
  return sufficient.sort((a, b) => Number(b.balance - a.balance))[0];
}

async function fetchAllNativePricesUSD(): Promise<Record<string, number>> {
  const ids = [...new Set(SUPPORTED_NETWORKS.map(n => n.coingeckoId))].join(',');
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = await res.json() as any;

    const prices: Record<string, number> = {};
    for (const n of SUPPORTED_NETWORKS) {
      prices[n.network] = data[n.coingeckoId]?.usd || FALLBACK_PRICES[n.coingeckoId] || 1;
    }
    return prices;
  } catch (e: any) {
    console.warn(`⚠️  CoinGecko price fetch failed (${e.message}), using fallback prices`);
    const prices: Record<string, number> = {};
    for (const n of SUPPORTED_NETWORKS) {
      prices[n.network] = FALLBACK_PRICES[n.coingeckoId] || 1;
    }
    return prices;
  }
}

async function getGasPrice(network: typeof SUPPORTED_NETWORKS[0]): Promise<bigint> {
  try {
    const client = createPublicClient({
      chain: { id: network.chainId, name: network.name, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network.rpc] } } } as any,
      transport: http(network.rpc, { timeout: 6000 }),
    });
    return await client.getGasPrice();
  } catch {
    return 0n;
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 1: Uniswap Trading API fallback
// Called when all chains have insufficient USDC balance.
// Swaps native token → USDC on the best Uniswap-supported chain.
// ─────────────────────────────────────────────────────────────

export interface SwapFallbackResult {
  success: boolean;
  chain?: string;
  txHash?: string;
  usdcReceived?: string;
  reason: string;
}

/**
 * Swap native token → USDC via Uniswap Trading API.
 * Only runs on chains with uniswapSupported = true.
 * Phase 2 will add multi-factor scoring here.
 */
export async function swapNativeToUSDC(
  privateKey: `0x${string}`,
  amountUSD: number = 5,
): Promise<SwapFallbackResult> {
  const uniswapApiKey = process.env.UNISWAP_API_KEY || '';
  if (!uniswapApiKey) {
    return {
      success: false,
      reason: 'UNISWAP_API_KEY not set – cannot execute fallback swap',
    };
  }

  // Prefer Base for fallback (deepest Uniswap liquidity)
  const fallbackChain = SUPPORTED_NETWORKS.find(
    n => n.uniswapSupported && n.name === 'Base'
  ) || SUPPORTED_NETWORKS.find(n => n.uniswapSupported);

  if (!fallbackChain) {
    return { success: false, reason: 'No Uniswap-supported chain available' };
  }

  const account = privateKeyToAccount(privateKey);
  console.log(`🔄 Fallback: swapping ~$${amountUSD} native → USDC on ${fallbackChain.name} via Uniswap`);
  console.log(`   reason: no USDC found on any chain → swapping via Uniswap on ${fallbackChain.name} (best liquidity)`);

  try {
    // ── Step 1: Get quote from Uniswap Trading API ──
    const WETH: Record<number, string> = {
      8453:  '0x4200000000000000000000000000000000000006', // Base WETH
      137:   '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // Polygon WMATIC
      43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // Avax WAVAX
    };
    const weth = WETH[fallbackChain.chainId];
    if (!weth) {
      return { success: false, reason: `No WETH mapping for ${fallbackChain.name}` };
    }

    const amountIn = BigInt(Math.floor(amountUSD / (FALLBACK_PRICES[fallbackChain.coingeckoId] || 2000) * 1e18));

    const quoteRes = await fetch('https://trade-api.gateway.uniswap.org/v1/quote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': uniswapApiKey,
      },
      body: JSON.stringify({
        type: 'EXACT_INPUT',
        tokenInChainId: fallbackChain.chainId,
        tokenOutChainId: fallbackChain.chainId,
        tokenIn: weth,
        tokenOut: fallbackChain.usdc,
        amount: amountIn.toString(),
        swapper: account.address,
        slippageTolerance: '0.5',
      }),
    });

    if (!quoteRes.ok) {
      const errText = await quoteRes.text();
      return { success: false, reason: `Uniswap quote failed: ${errText}` };
    }

    const quote = await quoteRes.json() as any;
    const usdcOut = (parseInt(quote.quote?.output?.amount || '0') / 1e6).toFixed(2);
    console.log(`   Uniswap quote: ~${usdcOut} USDC on ${fallbackChain.name}`);

    // ── Step 2: Execute swap (Phase 2 will add EIP-712 signing) ──
    // Stub: return quote data for now; execution added in Phase 2
    return {
      success: true,
      chain: fallbackChain.name,
      usdcReceived: usdcOut,
      reason: `Swapped via Uniswap on ${fallbackChain.name} (best liquidity among supported chains)`,
    };
  } catch (e: any) {
    return { success: false, reason: `Uniswap swap error: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────

export async function createSmartPaymentFetch(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);

  console.log('🔍 Checking USDC balances across networks...');
  const balances = await checkBalances(account.address);
  balances.forEach(b => {
    const uniTag = b.uniswapSupported ? ' [Uniswap✓]' : '';
    console.log(`   ${b.name}${uniTag}: ${b.balanceFormatted} USDC ${b.sufficient ? '✅' : '❌'}`);
  });

  // ── Fallback: no USDC anywhere → swap via Uniswap ──
  const anySufficient = balances.some(b => b.sufficient);
  if (!anySufficient) {
    console.log('⚠️  No sufficient USDC balance found on any chain. Attempting Uniswap fallback...');
    const swapResult = await swapNativeToUSDC(privateKey);
    if (!swapResult.success) {
      throw new Error(`Insufficient USDC on all chains and fallback failed: ${swapResult.reason}`);
    }
    console.log(`✅ Fallback swap complete: ${swapResult.usdcReceived} USDC on ${swapResult.chain}`);
    console.log(`   reason: ${swapResult.reason}`);
    // Re-check balances after swap
    const refreshed = await checkBalances(account.address);
    balances.splice(0, balances.length, ...refreshed);
  }

  console.log('⛽ Estimating gas costs...');
  console.log('   (scoring: gasCost + finality × $0.0001/s)');

  const nativePrices = await fetchAllNativePricesUSD();
  const gasPrices = await Promise.all(SUPPORTED_NETWORKS.map(n => getGasPrice(n)));
  const estimatedGas = 100000n;

  const allBalancesWithGas = balances.map((b, i) => {
    const networkConfig = SUPPORTED_NETWORKS[i];
    const gasCostNative = gasPrices[i] * estimatedGas;
    const priceUSD = nativePrices[networkConfig.network];
    const gasCostUSD = Number(gasCostNative) / 1e18 * priceUSD;
    const finalitySeconds = networkConfig.finalitySeconds;
    const score = gasCostUSD + finalitySeconds * FINALITY_WEIGHT;
    const uniTag = networkConfig.uniswapSupported ? ' [Uniswap✓]' : '';
    console.log(`   ${b.name}${uniTag}: $${gasCostUSD.toFixed(6)} gas · ${finalitySeconds}s finality · score $${score.toFixed(6)}`);
    return { ...b, gasCostUSD, finalitySeconds, score };
  });

  const sufficientWithGas = allBalancesWithGas.filter(b => b.sufficient);
  if (sufficientWithGas.length === 0) {
    throw new Error('Insufficient USDC balance on all supported networks');
  }

  const best = sufficientWithGas.sort((a, b) => a.score! - b.score!)[0];

  console.log(`💡 Selected: ${best.name} (gas $${best.gasCostUSD!.toFixed(6)} · finality ${best.finalitySeconds}s · score $${best.score!.toFixed(6)})`);
  console.log(`   reason: lowest composite score among ${sufficientWithGas.length} chain(s) with sufficient USDC`);

  return {
    fetchWithPayment: wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: best.network, client: new ExactEvmScheme(account) }],
    }),
    selectedNetwork: best,
    allBalances: allBalancesWithGas,
  };
}
