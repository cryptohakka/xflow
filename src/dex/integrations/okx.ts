/**
 * XFlow DEX - OKX DEX Aggregator integration
 */
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { SwapRequest, TOKENS, OKX_ROUTER_XLAYER, STABLECOINS } from '../types';
import { CHAIN_INDEX } from '../../tokenResolver';

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

export function getEnv(key: string): string {
  return process.env[key] || _env[key] || '';
}

export function makeHeaders(path: string, method = 'GET', body = '') {
  const timestamp = new Date().toISOString();
  const message   = timestamp + method + path + body;
  const sign      = createHmac('sha256', getEnv('OKX_SECRET_KEY')).update(message).digest('base64');
  return {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY':        getEnv('OKX_API_KEY'),
    'OK-ACCESS-SIGN':       sign,
    'OK-ACCESS-TIMESTAMP':  timestamp,
    'OK-ACCESS-PASSPHRASE': getEnv('OKX_PASSPHRASE'),
  };
}

const ADDR_TO_SYMBOL: Record<string, string> = {
  '0x74b7f16337b8972027f6196a17a631ac6de26d22': 'USDC',
  '0xe538905cf8410324e03a5a23c1c177a474d59b2b': 'WOKB',
  '0x5a77f1443d16ee5761d310e38b62f77f726bc71c': 'WETH',
  '0x1e4a5963abfd975d8c9021ce480b42188849d41d': 'USDT',
  '0x078d782b760474a361dda0af3839290b0ef57ad6': 'USDC',
  '0x4200000000000000000000000000000000000006': 'WETH',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC',
  '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 'USDC',
};

export async function getSwapQuote(req: SwapRequest) {
  const chainId  = req.chainId ?? 196;
  const chainIdx = CHAIN_INDEX[chainId] || '196';
  const fromAddr = req.fromTokenAddress || TOKENS[(req.fromToken || '').toUpperCase()] || req.fromToken || '';
  const toAddr   = req.toTokenAddress   || TOKENS[(req.toToken   || '').toUpperCase()] || req.toToken   || '';

  const fromSym  = (req.fromTokenSymbol || req.fromToken || '').toUpperCase();
  const decimals = STABLECOINS.includes(fromSym) ? 6 : 18;
  const amountRaw = (Math.floor(parseFloat(req.amount) * 10 ** decimals) + Math.floor(Math.random() * 3)).toString();

  const query = `chainIndex=${chainIdx}&amount=${amountRaw}&fromTokenAddress=${fromAddr}&toTokenAddress=${toAddr}`;
  const path  = `/api/v6/dex/aggregator/quote?${query}`;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 8000);

  const res  = await fetch(`https://www.okx.com${path}`, { headers: makeHeaders(path), signal: controller.signal });
  const json = await res.json() as any;
  if (json.code !== '0') throw new Error(`OKX quote error: ${json.msg}`);

  const q = json.data[0];
  const resolvedFromSymbol = (req.fromTokenAddress && ADDR_TO_SYMBOL[req.fromTokenAddress.toLowerCase()]) || req.fromToken.toUpperCase();
  const resolvedToSymbol   = (req.toTokenAddress   && ADDR_TO_SYMBOL[req.toTokenAddress.toLowerCase()])   || req.toToken.toUpperCase();

  return {
    fromToken: resolvedFromSymbol,
    toToken:   resolvedToSymbol,
    fromAmount: req.amount,
    toAmount: (parseInt(q.toTokenAmount) / 10 ** parseInt(q.toToken.decimal)).toFixed(6),
    route: q.dexRouterList[0]?.dexProtocol?.dexName,
    priceImpact: q.priceImpactPercent + '%',
    estimateGasFee: q.estimateGasFee,
    isHoneyPot: q.toToken?.isHoneyPot || false,
    taxRate: q.toToken?.taxRate || '0',
    toTokenUnitPrice: q.toToken?.tokenUnitPrice || '0',
    fromTokenAddress: fromAddr,
    toTokenAddress:   toAddr,
    spender: OKX_ROUTER_XLAYER,
    chainId,
  };
}

export async function getSwapTxData(req: SwapRequest) {
  const chainId  = req.chainId ?? 196;
  const chainIdx = CHAIN_INDEX[chainId] || '196';
  const fromAddr = req.fromTokenAddress || TOKENS[(req.fromToken || '').toUpperCase()] || req.fromToken || '';
  const toAddr   = req.toTokenAddress   || TOKENS[(req.toToken   || '').toUpperCase()] || req.toToken   || '';

  const decimals  = STABLECOINS.includes(req.fromToken.toUpperCase()) ? 6 : 18;
  const amountRaw = (Math.floor(parseFloat(req.amount) * 10 ** decimals) + Math.floor(Math.random() * 3)).toString();
  const slippage  = (parseFloat(req.slippage || '1.0') + Math.random() * 0.1).toFixed(4);

  const params = new URLSearchParams({
    chainIndex:        chainIdx,
    amount:            amountRaw,
    userWalletAddress: req.userAddress,
    slippagePercent:   slippage,
  });
  if (fromAddr) params.set('fromTokenAddress', fromAddr);
  if (toAddr)   params.set('toTokenAddress',   toAddr);

  const path = `/api/v6/dex/aggregator/swap?${params.toString()}`;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 8000);

  const res  = await fetch(`https://www.okx.com${path}`, { headers: makeHeaders(path), signal: controller.signal });
  const json = await res.json() as any;
  if (json.code !== '0') throw new Error(`OKX swap error: ${json.msg}`);

  const tx = json.data[0].tx;
  const q  = json.data[0];
  return {
    fromToken:  req.fromToken.toUpperCase(),
    toToken:    req.toToken.toUpperCase(),
    fromAmount: req.amount,
    toAmount: (parseInt(q.routerResult?.toTokenAmount || '0') / 10 ** parseInt(q.routerResult?.toToken?.decimal || '18')).toFixed(6),
    tx: {
      to:       tx.to,
      data:     tx.data,
      value:    tx.value,
      gas:      tx.gas,
      gasPrice: tx.gasPrice,
      chainId,
    },
    note: 'Sign and send this TX with your wallet to execute the swap',
  };
}
