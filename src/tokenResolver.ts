/**
 * XFlow Token Resolver
 * Resolves token symbols to contract addresses on X Layer
 */
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';

const CHAIN_INDEX = '196';

// ハードコードの主要トークン（常に利用可能）
const KNOWN_TOKENS: Record<string, string> = {
  'USDC':   '0x74b7f16337b8972027f6196a17a631ac6de26d22',
  'WOKB':   '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  'OKB':    '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  'WETH':   '0x5a77f1443d16ee5761d310e38b62f77f726bc71c',
  'USDT':   '0x1e4a5963abfd975d8c9021ce480b42188849d41d',
  'ETH':    '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  'WBTC':   '0x2A6b0a87f41a765A4f0d2CC3Ed0dd4fe8FF2De18',
  'DAI':    '0xc5015b9d9161dca7e18e32f6f25c4ad850731fd4',
  'USDG':   '0x4ae46a509f6b1d9056937ba4500cb143933d2dc8',
  'CRVUSD': '0xda8f4eb4503acf5dec5420523637bb5b33a846f6',
};

// アドレス→シンボルの逆引きマップ
const ADDRESS_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(KNOWN_TOKENS).map(([sym, addr]) => [addr.toLowerCase(), sym])
);

// APIキャッシュ（バックグラウンドで更新）
let apiCache: Record<string, string> = {};
let cacheLoaded = false;

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

// バックグラウンドでAPIからトークンリストを取得
async function refreshTokenCache() {
  try {
    const env = loadEnv();
    const ts = new Date().toISOString();
    const path = `/api/v6/dex/aggregator/all-tokens?chainIndex=${CHAIN_INDEX}`;
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
      apiCache = cache;
      cacheLoaded = true;
      console.log(`[TokenResolver] Cached ${Object.keys(cache).length} tokens from OKX API`);
    }
  } catch (e: any) {
    console.warn('[TokenResolver] API fetch failed (using known tokens only):', e.message);
    cacheLoaded = true; // エラーでも続行
  }
}

// 起動時にバックグラウンドでキャッシュ更新
refreshTokenCache();

/**
 * Resolve token symbol to contract address
 * Synchronous-first: uses KNOWN_TOKENS immediately, API cache when available
 */
export async function resolveToken(symbolOrAddress: string): Promise<{
  address: string | null;
  source: 'address' | 'known' | 'api' | 'not_found';
  symbol?: string;
}> {
  // アドレス直接指定
  if (symbolOrAddress.startsWith('0x') && symbolOrAddress.length === 42) {
    const symbol = ADDRESS_TO_SYMBOL[symbolOrAddress.toLowerCase()] || 
                   Object.entries(apiCache).find(([,v]) => v.toLowerCase() === symbolOrAddress.toLowerCase())?.[0];
    return { address: symbolOrAddress, source: 'address', symbol };
  }

  const upper = symbolOrAddress.toUpperCase();

  // KNOWN_TOKENSから即座に返す
  if (KNOWN_TOKENS[upper]) {
    return { address: KNOWN_TOKENS[upper], source: 'known', symbol: upper };
  }

  // APIキャッシュが読み込まれていれば使う
  if (cacheLoaded && apiCache[upper]) {
    return { address: apiCache[upper], source: 'api', symbol: upper };
  }

  // キャッシュ未ロードでも待たずにnot_foundを返す
  // （KNOWN_TOKENSにない場合はアドレス直接指定を要求）
  return { address: null, source: 'not_found' };
}

export async function getAvailableTokens(): Promise<string[]> {
  const all = new Set([
    ...Object.keys(KNOWN_TOKENS),
    ...Object.keys(apiCache),
  ]);
  return Array.from(all).sort();
}
