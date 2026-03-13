/**
 * XFlow DEX Agent
 * Uses OKX OnchainOS Skills for DEX operations
 */

const OKX_API_KEY = process.env.OKX_API_KEY || '';
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY || '';
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE || '';

export interface SwapParams {
  fromToken: string;
  toToken: string;
  amount: string;
  chainId?: string; // default: X Layer (196)
  userAddress: string;
}

export interface TokenParams {
  tokenAddress: string;
  chainId?: string;
}

/**
 * Get DEX quote via OnchainOS
 */
export async function getDexQuote(params: SwapParams) {
  const chainId = params.chainId || '196'; // X Layer
  const res = await fetch('https://www.okx.com/api/v5/dex/aggregator/quote', {
    headers: {
      'OK-ACCESS-KEY': OKX_API_KEY,
      'OK-ACCESS-SIGN': await sign('GET', '/api/v5/dex/aggregator/quote', OKX_SECRET_KEY, OKX_PASSPHRASE),
      'OK-ACCESS-TIMESTAMP': new Date().toISOString(),
      'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE,
    },
  });
  return res.json();
}

/**
 * Get token info via OnchainOS
 */
export async function getTokenInfo(params: TokenParams) {
  const chainId = params.chainId || '196';
  const url = `https://www.okx.com/api/v5/dex/aggregator/token-info?chainId=${chainId}&tokenContractAddress=${params.tokenAddress}`;
  const timestamp = new Date().toISOString();
  const sign = await hmacSign('GET', '/api/v5/dex/aggregator/token-info', '', timestamp, OKX_SECRET_KEY, OKX_PASSPHRASE);
  const res = await fetch(url, {
    headers: {
      'OK-ACCESS-KEY': OKX_API_KEY,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE,
    },
  });
  return res.json();
}

/**
 * HMAC-SHA256 signing for OKX API
 */
async function hmacSign(
  method: string,
  path: string,
  body: string,
  timestamp: string,
  secretKey: string,
  passphrase: string
): Promise<string> {
  const message = timestamp + method + path + body;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function sign(method: string, path: string, secretKey: string, passphrase: string): Promise<string> {
  const timestamp = new Date().toISOString();
  return hmacSign(method, path, '', timestamp, secretKey, passphrase);
}

/**
 * DEX Agent handler — called by Orchestrator
 */
export async function handleDexQuery(query: string) {
  console.log(`🔄 DEX Agent: ${query}`);
  // TODO: LLMでqueryをparseしてgetDexQuote/getTokenInfoを呼ぶ
  return { agent: 'dex', query, status: 'TODO' };
}
