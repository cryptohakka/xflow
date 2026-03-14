/**
 * XFlow DEX Agent
 * Returns swap TX data for X Layer via OKX DEX Aggregator
 * Actual execution is done by the caller (agent or user)
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

// X Layer token addresses
const TOKENS: Record<string, string> = {
  USDC: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
  WOKB: '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  OKB:  '0xe538905cf8410324e03a5a23c1c177a474d59b2b', // WOKB = OKB on X Layer
};

export interface SwapRequest {
  fromToken: string;  // e.g. "USDC"
  toToken: string;    // e.g. "OKB"
  amount: string;     // human readable e.g. "1.0"
  userAddress: string;
  slippage?: string;  // default "0.01" = 1%
}

/**
 * Get swap quote (no execution)
 */
export async function getSwapQuote(req: SwapRequest) {
  const fromAddr = TOKENS[req.fromToken.toUpperCase()] || req.fromToken;
  const toAddr   = TOKENS[req.toToken.toUpperCase()]   || req.toToken;
  
  // USDC decimals = 6, others = 18
  const decimals = req.fromToken.toUpperCase() === 'USDC' ? 6 : 18;
  const amountRaw = Math.floor(parseFloat(req.amount) * 10 ** decimals).toString();

  const query = `chainIndex=${CHAIN_INDEX}&amount=${amountRaw}&fromTokenAddress=${fromAddr}&toTokenAddress=${toAddr}`;
  const path = `/api/v6/dex/aggregator/quote?${query}`;
  const res = await fetch(`https://www.okx.com${path}`, { headers: makeHeaders(path) });
  const json = await res.json() as any;
  if (json.code !== '0') throw new Error(`OKX quote error: ${json.msg}`);
  
  const q = json.data[0];
  return {
    fromToken: req.fromToken.toUpperCase(),
    toToken: req.toToken.toUpperCase(),
    fromAmount: req.amount,
    toAmount: (parseInt(q.toTokenAmount) / 10 ** parseInt(q.toToken.decimal)).toFixed(6),
    route: q.dexRouterList[0]?.dexProtocol?.dexName,
    priceImpact: q.priceImpactPercent + '%',
    estimateGasFee: q.estimateGasFee,
  };
}

/**
 * Get swap TX data (unsigned) — agent calls this, user signs & executes
 */
export async function getSwapTxData(req: SwapRequest) {
  const fromAddr = TOKENS[req.fromToken.toUpperCase()] || req.fromToken;
  const toAddr   = TOKENS[req.toToken.toUpperCase()]   || req.toToken;
  
  const decimals = req.fromToken.toUpperCase() === 'USDC' ? 6 : 18;
  const amountRaw = Math.floor(parseFloat(req.amount) * 10 ** decimals).toString();
  const slippage = req.slippage || '0.01';

  const query = `chainIndex=${CHAIN_INDEX}&amount=${amountRaw}&fromTokenAddress=${fromAddr}&toTokenAddress=${toAddr}&userWalletAddress=${req.userAddress}&slippage=${slippage}`;
  const path = `/api/v6/dex/aggregator/swap?${query}`;
  const res = await fetch(`https://www.okx.com${path}`, { headers: makeHeaders(path) });
  const json = await res.json() as any;
  if (json.code !== '0') throw new Error(`OKX swap error: ${json.msg}`);

  const tx = json.data[0].tx;
  const q  = json.data[0];
  return {
    // quote info
    fromToken: req.fromToken.toUpperCase(),
    toToken: req.toToken.toUpperCase(),
    fromAmount: req.amount,
    toAmount: (parseInt(q.routerResult?.toTokenAmount || '0') / 10 ** parseInt(q.routerResult?.toToken?.decimal || '18')).toFixed(6),
    // unsigned TX data — caller signs and sends
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

/**
 * DEX Agent handler — called by Orchestrator
 */
export async function handleDexQuery(query: string, userAddress?: string): Promise<any> {
  console.log(`🔄 DEX Agent: ${query}`);

  const isSwap = /swap|buy|sell|trade/i.test(query);

  // queryからトークンペアを抽出（簡易）
  const usdcToOkb = /usdc.*okb|usdc.*wokb/i.test(query);
  const okbToUsdc = /okb.*usdc|wokb.*usdc/i.test(query);

  if (isSwap && userAddress) {
    const req: SwapRequest = {
      fromToken: okbToUsdc ? 'WOKB' : 'USDC',
      toToken:   okbToUsdc ? 'USDC' : 'WOKB',
      amount: '1.0',
      userAddress,
    };
    return getSwapTxData(req);
  }

  if (isSwap) {
    // userAddressなしはquoteのみ
    return getSwapQuote({
      fromToken: okbToUsdc ? 'WOKB' : 'USDC',
      toToken:   okbToUsdc ? 'USDC' : 'WOKB',
      amount: '1.0',
      userAddress: '0x0000000000000000000000000000000000000001',
    });
  }

  return { agent: 'dex', query, status: 'unsupported query' };
}
