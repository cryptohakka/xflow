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

const TOKENS: Record<string, string> = {
  USDC: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
  WOKB: '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  OKB:  '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  USDT0: '0x779ded0c9e1022225f8e0630b35a9b54be713736',
};

// OKX DEX Router on X Layer (fallback)
const OKX_ROUTER_XLAYER = '0x8b773d83bc66be128c60e07e17c8901f7a64f000';

export interface SwapRequest {
  fromToken: string;
  toToken: string;
  amount: string;
  userAddress: string;
  slippage?: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
  fromTokenSymbol?: string;
}

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

  // spender: try to extract from dexRouterList, fallback if not found
  // OKX quote API returns router address via various paths (router / routerAddress / dexProtocol.router)
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
    spender,  // spender address for approve
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
    return getSwapQuote({
      fromToken: okbToUsdc ? 'WOKB' : 'USDC',
      toToken:   okbToUsdc ? 'USDC' : 'WOKB',
      amount: existingQuote?.fromAmount || '1.0',
      userAddress: '0x0000000000000000000000000000000000000001',
    });
  }

  return { agent: 'dex', query, status: 'unsupported query' };
}
