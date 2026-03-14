/**
 * XFlow DEX Agent
 * OKX DEX Aggregator API for X Layer
 */
import { createHmac } from 'crypto';

const CHAIN_INDEX = '196'; // X Layer

function getEnv(key: string): string {
  return process.env[key] || '';
}

function sign(timestamp: string, method: string, path: string, body = ''): string {
  const message = timestamp + method + path + body;
  return createHmac('sha256', getEnv('OKX_SECRET_KEY'))
    .update(message)
    .digest('base64');
}

function headers(path: string, method = 'GET', body = '') {
  const timestamp = new Date().toISOString();
  return {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': getEnv('OKX_API_KEY'),
    'OK-ACCESS-SIGN': sign(timestamp, method, path, body),
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': getEnv('OKX_PASSPHRASE'),
  };
}

export interface QuoteParams {
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  chainIndex?: string;
}

/**
 * Get DEX quote on X Layer
 */
export async function getDexQuote(params: QuoteParams) {
  const chainIndex = params.chainIndex || CHAIN_INDEX;
  const query = `chainIndex=${chainIndex}&amount=${params.amount}&fromTokenAddress=${params.fromTokenAddress}&toTokenAddress=${params.toTokenAddress}`;
  const path = `/api/v6/dex/aggregator/quote?${query}`;
  const res = await fetch(`https://www.okx.com${path}`, { headers: headers(path) });
  const json = await res.json() as any;
  if (json.code !== '0') throw new Error(`OKX API error: ${json.msg}`);
  return json.data[0];
}

/**
 * Get swap transaction data
 */
export async function getSwapTx(params: QuoteParams & { userWalletAddress: string; slippage?: string }) {
  const chainIndex = params.chainIndex || CHAIN_INDEX;
  const query = `chainIndex=${chainIndex}&amount=${params.amount}&fromTokenAddress=${params.fromTokenAddress}&toTokenAddress=${params.toTokenAddress}&userWalletAddress=${params.userWalletAddress}&slippage=${params.slippage || '0.01'}`;
  const path = `/api/v6/dex/aggregator/swap?${query}`;
  const res = await fetch(`https://www.okx.com${path}`, { headers: headers(path) });
  const json = await res.json() as any;
  if (json.code !== '0') throw new Error(`OKX API error: ${json.msg}`);
  return json.data[0];
}

/**
 * DEX Agent handler — called by Orchestrator
 */
export async function handleDexQuery(query: string): Promise<any> {
  console.log(`🔄 DEX Agent: ${query}`);

  // USDCアドレス(X Layer) と WOKBアドレス
  const USDC  = '0x74b7f16337b8972027f6196a17a631ac6de26d22';
  const WOKB  = '0xe538905cf8410324e03a5a23c1c177a474d59b2b';

  // queryからswap意図を検出
  const isSwap = /swap|buy|sell|trade/i.test(query);

  if (isSwap) {
    const quote = await getDexQuote({
      fromTokenAddress: USDC,
      toTokenAddress: WOKB,
      amount: '1000000', // 1 USDC
    });
    return {
      agent: 'dex',
      action: 'quote',
      from: `${quote.fromToken.tokenSymbol}`,
      to: `${quote.toToken.tokenSymbol}`,
      fromAmount: quote.fromTokenAmount,
      toAmount: quote.toTokenAmount,
      route: quote.dexRouterList[0]?.dexProtocol?.dexName,
      priceImpact: quote.priceImpactPercent,
      estimateGasFee: quote.estimateGasFee,
    };
  }

  return { agent: 'dex', query, status: 'unsupported' };
}
