/**
 * XFlow Token Resolver
 * Resolves token symbols to contract addresses, per chain
 */
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';

// ── OKX chainIndex mapping ────────────────────────────────────
export const CHAIN_INDEX: Record<number, string> = {
  196:   '196',
  8453:  '8453',
  137:   '137',
  43114: '43114',
  130:   '130',
};

// ── Known tokens per chainId ──────────────────────────────────
const KNOWN_TOKENS: Record<number, Record<string, string>> = {
  196: {
    'USDC':   '0x74b7f16337b8972027f6196a17a631ac6de26d22',
    'WOKB':   '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
    'OKB':    '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
    'WETH':   '0x5a77f1443d16ee5761d310e38b62f77f726bc71c',
    'USDT':   '0x1e4a5963abfd975d8c9021ce480b42188849d41d',
    'ETH':    '0x0000000000000000000000000000000000000000',
    'WBTC':   '0x2A6b0a87f41a765A4f0d2CC3Ed0dd4fe8FF2De18',
    'DAI':    '0xc5015b9d9161dca7e18e32f6f25c4ad850731fd4',
    'USDG':   '0x4ae46a509f6b1d9056937ba4500cb143933d2dc8',
    'CRVUSD': '0xda8f4eb4503acf5dec5420523637bb5b33a846f6',
    'USDT0':  '0x779ded0c9e1022225f8e0630b35a9b54be713736',
  },
  130: {
    'USDC':   '0x078d782b760474a361dda0af3839290b0ef57ad6',
    'USDT0':  '0x9151434b16b9763660705744891fa906f660ecc5',
    'WETH':   '0x4200000000000000000000000000000000000006',
    'ETH':    '0x0000000000000000000000000000000000000000',
    'UNI':    '0x8f187aa05619a017077f5308904739877ce9ea21',
    'USDS':   '0x7e10036acc4b56d4dfca3b77810356ce52313f9c',
    'WBTC':   '0x0555e30da8f98308edb960aa94c0db47230d2b9c',
  },
  8453: {
    'USDC':   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'WETH':   '0x4200000000000000000000000000000000000006',
    'ETH':    '0x0000000000000000000000000000000000000000',
    'DAI':    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
    'USDT':   '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  },
  137: {
    'USDC':   '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    'WETH':   '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    'ETH':    '0x0000000000000000000000000000000000000000',
    'USDT':   '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    'DAI':    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  },
  43114: {
    'USDC':   '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    'WETH':   '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
    'ETH':    '0x0000000000000000000000000000000000000000',
    'USDT':   '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    'DAI':    '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70',
  },
};

// Reverse map per chain: address → symbol
const ADDRESS_TO_SYMBOL: Record<number, Record<string, string>> = {};
for (const [chainId, tokens] of Object.entries(KNOWN_TOKENS)) {
  ADDRESS_TO_SYMBOL[Number(chainId)] = Object.fromEntries(
    Object.entries(tokens).map(([sym, addr]) => [addr.toLowerCase(), sym])
  );
}

// OKX API cache per chain
const apiCache: Record<number, Record<string, string>> = {};
const cacheLoaded: Record<number, boolean> = {};

function loadEnv(): Record<string, string> {
  if (process.env.OKX_API_KEY) return process.env as Record<string, string>;
  try {
    return readFileSync('/home/agent/xflow/.env', 'utf-8')
      .split('\n').reduce((acc, line) => {
        const [k, ...v] = line.split('=');
        if (k && v.length) acc[k.trim()] = v.join('=').trim();
        return acc;
      }, {} as Record<string, string>);
  } catch { return {}; }
}

async function refreshTokenCache(chainId: number) {
  const idx = CHAIN_INDEX[chainId];
  if (!idx) { cacheLoaded[chainId] = true; return; }

  // Unichain: OKX APIに対応していないのでスキップ
  if (chainId === 130) { cacheLoaded[chainId] = true; return; }

  try {
    const env = loadEnv();
    const ts = new Date().toISOString();
    const path = `/api/v6/dex/aggregator/all-tokens?chainIndex=${idx}`;
    const sign = createHmac('sha256', env.OKX_SECRET_KEY || '')
      .update(ts + 'GET' + path).digest('base64');
    const res = await fetch(`https://www.okx.com${path}`, {
      headers: {
        'OK-ACCESS-KEY': env.OKX_API_KEY || '',
        'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': env.OKX_PASSPHRASE || '',
      },
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json() as any;
    if (json.code === '0' && json.data?.length > 0) {
      const cache: Record<string, string> = {};
      for (const token of json.data) {
        cache[token.tokenSymbol.toUpperCase()] = token.tokenContractAddress;
      }
      apiCache[chainId] = cache;
      console.log(`[TokenResolver] Cached ${Object.keys(cache).length} tokens from OKX API (chain ${chainId})`);
    }
  } catch (e: any) {
    console.warn(`[TokenResolver] API fetch failed for chain ${chainId}:`, e.message);
  } finally {
    cacheLoaded[chainId] = true;
  }
}

// Refresh default chain (196) on startup
refreshTokenCache(196);

export async function resolveToken(symbolOrAddress: string, chainId = 196): Promise<{
  address: string | null;
  source: 'address' | 'known' | 'api' | 'not_found';
  symbol?: string;
}> {
  // Ensure cache is loaded for this chain
  if (!cacheLoaded[chainId]) {
    await refreshTokenCache(chainId);
  }

  // Direct address input
  if (symbolOrAddress.startsWith('0x') && symbolOrAddress.length === 42) {
    const symbol = ADDRESS_TO_SYMBOL[chainId]?.[symbolOrAddress.toLowerCase()] ||
                   Object.entries(apiCache[chainId] || {}).find(([, v]) => v.toLowerCase() === symbolOrAddress.toLowerCase())?.[0];
    return { address: symbolOrAddress, source: 'address', symbol };
  }

  const upper = symbolOrAddress.toUpperCase();

  if (KNOWN_TOKENS[chainId]?.[upper]) {
    return { address: KNOWN_TOKENS[chainId][upper], source: 'known', symbol: upper };
  }

  if (apiCache[chainId]?.[upper]) {
    return { address: apiCache[chainId][upper], source: 'api', symbol: upper };
  }

  return { address: null, source: 'not_found' };
}

export async function getAvailableTokens(chainId = 196): Promise<string[]> {
  if (!cacheLoaded[chainId]) await refreshTokenCache(chainId);
  const all = new Set([
    ...Object.keys(KNOWN_TOKENS[chainId] || {}),
    ...Object.keys(apiCache[chainId] || {}),
  ]);
  return Array.from(all).sort();
}
