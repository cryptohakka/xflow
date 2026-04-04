/**
 * XFlow Client Agent
 * An autonomous agent that sends swap requests to XFlow via x402
 */
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http } from 'viem';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

const XFLOW_URL   = process.env.XFLOW_URL   || 'http://localhost:3010';
const SWAP_QUERY  = process.env.SWAP_QUERY  || 'swap 0.01 USDC to USDT0';
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const CHAIN_ID    = parseInt(process.env.CHAIN_ID || '196');

if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY is required');

interface ChainConfig {
  name: string;
  rpc: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  explorer: string;
}

const chainsPath = path.join(__dirname, 'chains.json');
const CHAINS: Record<string, ChainConfig> = JSON.parse(readFileSync(chainsPath, 'utf-8'));

const chainConfig = CHAINS[String(CHAIN_ID)];
if (!chainConfig) throw new Error(`Unsupported CHAIN_ID: ${CHAIN_ID}. Add it to chains.json`);

const chain = {
  id: CHAIN_ID,
  name: chainConfig.name,
  nativeCurrency: chainConfig.nativeCurrency,
  rpcUrls: { default: { http: [chainConfig.rpc] } },
};

const EXPLORER_BASES: Record<string, string> = {
  xlayer:    'https://www.oklink.com/xlayer/tx/',
  unichain:  'https://uniscan.xyz/tx/',
  base:      'https://basescan.org/tx/',
  polygon:   'https://polygonscan.com/tx/',
  avalanche: 'https://snowtrace.io/tx/',
};

function explorerLink(hash: string, explorerKey: string): string {
  const base = EXPLORER_BASES[explorerKey.toLowerCase()];
  return base ? `${base}${hash}` : hash;
}

const account = privateKeyToAccount(PRIVATE_KEY);

const walletClient = createWalletClient({
  account, chain, transport: http(chainConfig.rpc),
});
const publicClient = createPublicClient({
  chain, transport: http(chainConfig.rpc),
});

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║           XFlow Client Agent — Swap Request               ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log(`\n🤖 Agent:  ${account.address}`);
console.log(`📡 Target: ${XFLOW_URL}`);
console.log(`⛓️  Chain:  ${chainConfig.name} (${CHAIN_ID})`);
console.log(`📝 Query:  "${SWAP_QUERY}"\n`);

console.log('════════════════════════════════════════════════════════════');
console.log('1️⃣  Smart Payment Router');
console.log('════════════════════════════════════════════════════════════');

const bestNetworkRes = await fetch(`${XFLOW_URL}/best-network?address=${account.address}`);
if (!bestNetworkRes.ok) {
  const err = await bestNetworkRes.json() as any;
  throw new Error(`/best-network failed: ${err.error}`);
}
const { selectedNetwork, allBalances } = await bestNetworkRes.json() as any;

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: selectedNetwork.network, client: new ExactEvmScheme(account) }],
});

console.log(`💡 Selected: ${selectedNetwork.name} (${selectedNetwork.balanceFormatted} USDC · gas $${selectedNetwork.gasCostUSD.toFixed(6)})`);

console.log('\n════════════════════════════════════════════════════════════');
console.log('2️⃣  Requesting quote from XFlow (/swap)...');
console.log('════════════════════════════════════════════════════════════');

const swapRes = await fetchWithPayment(`${XFLOW_URL}/swap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: SWAP_QUERY,
    userAddress: account.address,
    chainId: CHAIN_ID,
    _routerMeta: {
      selectedNetwork: selectedNetwork.name,
      selectedScore: selectedNetwork.score,
      selectedGasCostUSD: selectedNetwork.gasCostUSD,
      allBalances: allBalances.map((b: any) => ({
        name: b.name,
        balance: b.balanceFormatted,
        sufficient: b.sufficient,
        gasCostUSD: b.gasCostUSD,
        finalitySeconds: b.finalitySeconds,
        score: b.score,
      })),
    },
  }),
});

const pr = swapRes.headers.get('payment-response');
let swapPaymentNetwork: string | undefined;
let swapX402TxHash: string | undefined;
if (pr) {
  const payment = JSON.parse(Buffer.from(pr, 'base64').toString());
  swapPaymentNetwork = payment.network;
  swapX402TxHash = payment.transaction;
  console.log(`\n💸 Paid on: ${payment.network}`);
  console.log(`   TX: ${explorerLink(payment.transaction, payment.network)}`);
}

const quoteData = await swapRes.json() as any;

if (!quoteData.success) {
  console.log('\n❌ Quote failed');
  console.log(JSON.stringify(quoteData, null, 2));
  process.exit(1);
}

if (quoteData.result?.data?.status === 'rejected') {
  console.log(`\n🚫 Swap rejected by Risk Agent`);
  console.log(JSON.stringify(quoteData.result.data.risk, null, 2));
  process.exit(1);
}

const quote          = quoteData.result?.data?.quote;
const risk           = quoteData.result?.data?.risk;
const permitData     = quoteData.result?.data?.permitData ?? null;
const uniswapRawQuote = quoteData.result?.data?.uniswapRawQuote ?? null;
console.log("uniswapRawQuote received:", !!uniswapRawQuote);

if (!quote) {
  console.log('\n❌ No quote data');
  console.log(JSON.stringify(quoteData, null, 2));
  process.exit(1);
}

console.log(`\n✅ Quote: ${quote.fromAmount} ${quote.fromToken} → ${quote.toAmount} ${quote.toToken}`);
console.log(`   Risk: ${risk?.riskLevel} · Impact: ${quote.priceImpact}`);
if (quoteData.result?.data?.routeDecision) {
  const rd = quoteData.result.data.routeDecision;
  console.log(`   Route: ${rd.selected} · ${rd.reason}`);
}

// ── Permit2 signing (Uniswap only) ────────────────────────────
let permit2Signature: string | undefined;
if (permitData) {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('3️⃣  Signing Permit2...');
  console.log('════════════════════════════════════════════════════════════');
  try {
    permit2Signature = await walletClient.signTypedData({
      domain:      permitData.domain,
      types:       permitData.types,
      primaryType: 'PermitSingle',
      message:     permitData.values,
    });
    console.log(`✅ Permit2 signed`);
  } catch (e: any) {
    console.warn(`⚠️  Permit2 signing failed: ${e.message}`);
  }
}

const step = (n: number) => ['', '1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'][permitData ? n : n - 1] || `${n}.`;

console.log('\n════════════════════════════════════════════════════════════');
console.log(`${step(4)}  Fetching fresh TX data from XFlow (/tx)...`);
console.log('════════════════════════════════════════════════════════════');

const txRes = await fetch(`${XFLOW_URL}/tx`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: SWAP_QUERY,
    userAddress: account.address,
    chainId: CHAIN_ID,
    fromTokenAddress: quote.fromTokenAddress,
    toTokenAddress: quote.toTokenAddress,
    parsedIntent: quoteData.intent,
    permit2Signature,
    uniswapRawQuote,  // pass rawQuote to avoid re-fetching
  }),
});

const txData = await txRes.json() as any;
const freshTx = txData.result?.data?.result?.tx;

if (!freshTx) {
  console.log('\n❌ No TX data from /tx');
  console.log(JSON.stringify(txData, null, 2));
  process.exit(1);
}
console.log(`✅ Fresh TX ready · router: ${freshTx.to}`);

console.log('\n════════════════════════════════════════════════════════════');
console.log(`${step(5)}  Checking allowance...`);
console.log('════════════════════════════════════════════════════════════');

const fromTokenAddr = quote.fromTokenAddress as `0x${string}` | undefined;
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const spender = permitData ? PERMIT2_ADDRESS as `0x${string}` : freshTx.to as `0x${string}`;

const allowanceAbi = [{
  name: 'allowance', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const;
const approveAbi = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ type: 'bool' }],
}] as const;

if (fromTokenAddr) {
  console.log(`   Spender: ${spender}`);
  const allowance = await publicClient.readContract({
    address: fromTokenAddr, abi: allowanceAbi,
    functionName: 'allowance', args: [account.address, spender],
  });
  const stablecoins = ['USDC', 'USDT', 'USDT0', 'USDG', 'DAI'];
  const decimals = stablecoins.includes(quote.fromToken) ? 6 : 18;
  const fromAmountRaw = BigInt(Math.floor(parseFloat(quote.fromAmount) * 10 ** decimals));

  if (allowance < fromAmountRaw) {
    console.log(`\n🔐 Approving ${quote.fromToken}...`);
    const approveTx = await walletClient.writeContract({
      address: fromTokenAddr, abi: approveAbi, functionName: 'approve',
      args: [spender, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
    });
    console.log(`   Approve TX: ${explorerLink(approveTx, chainConfig.explorer)}`);
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log(`   ✅ Approved`);
  } else {
    console.log(`✅ Allowance sufficient`);
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`${step(6)}  Broadcasting swap TX...`);
console.log('════════════════════════════════════════════════════════════');

const swapHash = await walletClient.sendTransaction({
  to: freshTx.to, data: freshTx.data,
  value: BigInt(freshTx.value || '0'),
  gas: BigInt(Math.floor(Number(freshTx.gas) * 1.5)),
  gasPrice: freshTx.gasPrice ? BigInt(freshTx.gasPrice) : undefined,
  chainId: CHAIN_ID,
});

console.log(`\n✅ Swap TX: ${explorerLink(swapHash, chainConfig.explorer)}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash, timeout: 60_000 })
  .catch(e => { console.log(`⚠️  Receipt timeout: ${e.message}`); return null; });

if (!receipt || receipt.status === 'reverted') {
  console.log(`\n⚠️  Swap TX reverted. Skipping confirm.`);
  await fetch(`${XFLOW_URL}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      txHash: swapHash, fromToken: quote.fromToken, toToken: quote.toToken,
      fromAmount: quote.fromAmount, paymentNetwork: swapPaymentNetwork,
      agentAddress: account.address,
    }),
  }).catch(() => {});
  process.exit(1);
}
console.log('📋 Proceeding to confirm...');

console.log('\n════════════════════════════════════════════════════════════');
console.log(`${step(7)}  Confirming swap to XFlow (/confirm)...`);
console.log('════════════════════════════════════════════════════════════');

const confirmFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: selectedNetwork.network, client: new ExactEvmScheme(account) }],
});

const confirmRes = await confirmFetch(`${XFLOW_URL}/confirm`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    txHash: swapHash,
    fromToken: quote.fromToken, toToken: quote.toToken,
    fromAmount: quote.fromAmount, toAmount: quote.toAmount,
    paymentNetwork: swapPaymentNetwork || quoteData.result?.network,
    route: quote.route, riskLevel: risk?.riskLevel,
    agentAddress: account.address,
    swapX402TxHash,
  }),
});

const confirmPr = confirmRes.headers.get('payment-response');
let confirmX402TxHash: string | undefined;
if (confirmPr) {
  const p = JSON.parse(Buffer.from(confirmPr, 'base64').toString());
  confirmX402TxHash = p.transaction;
}

const confirmData = await confirmRes.json() as any;
if (confirmData.analyticsTx) {
  console.log(`\n✅ Analytics TX: ${explorerLink(confirmData.analyticsTx, 'xlayer')}`);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`${step(8)}  Reporting analysis receipt to XFlow...`);
console.log('════════════════════════════════════════════════════════════');

await fetch(`${XFLOW_URL}/analysisReceived`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentAddress: account.address,
    confirmX402TxHash: confirmX402TxHash || '',
    paymentNetwork: swapPaymentNetwork,
  }),
}).catch(e => console.warn('analysisReceived failed:', e.message));

console.log(`\n💸 Client: received analysis and sending X402 payment to XFlow (/confirm)...`);
if (confirmX402TxHash) {
  console.log(`✅ XFlow received payment!\n   TX:${explorerLink(confirmX402TxHash, swapPaymentNetwork || 'base')}`);
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                  ✅ Mission Complete                       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');
