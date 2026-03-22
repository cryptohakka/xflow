/**
 * XFlow Client Agent
 * An autonomous agent that sends swap requests to XFlow via x402
 */
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http } from 'viem';
import { createSmartPaymentFetch } from './smartPaymentRouter.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const XFLOW_URL = process.env.XFLOW_URL || 'http://localhost:3010';
const SWAP_QUERY = process.env.SWAP_QUERY || 'swap 0.01 USDC to USDT0';
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY is required');

const account = privateKeyToAccount(PRIVATE_KEY);

const xlayer = {
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } },
};

const walletClient = createWalletClient({
  account, chain: xlayer, transport: http('https://rpc.xlayer.tech'),
});
const publicClient = createPublicClient({
  chain: xlayer, transport: http('https://rpc.xlayer.tech'),
});

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║           XFlow Client Agent — Swap Request               ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log(`\n🤖 Agent:  ${account.address}`);
console.log(`📡 Target: ${XFLOW_URL}`);
console.log(`📝 Query:  "${SWAP_QUERY}"\n`);

console.log('════════════════════════════════════════════════════════════');
console.log('1️⃣  Smart Payment Router');
console.log('════════════════════════════════════════════════════════════');

const { fetchWithPayment, selectedNetwork, allBalances } = await createSmartPaymentFetch(PRIVATE_KEY);
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
    _routerMeta: {
      selectedNetwork: selectedNetwork.name,
      selectedScore: selectedNetwork.score,
      selectedGasCostUSD: selectedNetwork.gasCostUSD,
      allBalances: allBalances.map(b => ({
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
  console.log(`   TX: ${payment.transaction}`);
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

const quote = quoteData.result?.data?.quote;
const risk  = quoteData.result?.data?.risk;

if (!quote) {
  console.log('\n❌ No quote data');
  console.log(JSON.stringify(quoteData, null, 2));
  process.exit(1);
}

console.log(`\n✅ Quote: ${quote.fromAmount} ${quote.fromToken} → ${quote.toAmount} ${quote.toToken}`);
console.log(`   Risk: ${risk?.riskLevel} · Impact: ${quote.priceImpact}`);

console.log('\n════════════════════════════════════════════════════════════');
console.log('3️⃣  Checking allowance...');
console.log('════════════════════════════════════════════════════════════');

const fromTokenAddr = quote.fromTokenAddress as `0x${string}` | undefined;
const spender = (quote.spender || '0x8b773d83bc66be128c60e07e17c8901f7a64f000') as `0x${string}`;
console.log(`   Spender: ${spender}`);

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
    console.log(`   Approve TX: ${approveTx}`);
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log(`   ✅ Approved`);
  } else {
    console.log(`✅ Allowance sufficient`);
  }
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('4️⃣  Fetching fresh TX data from XFlow (/tx)...');
console.log('════════════════════════════════════════════════════════════');

const txRes = await fetch(`${XFLOW_URL}/tx`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: SWAP_QUERY,
    userAddress: account.address,
    fromTokenAddress: quote.fromTokenAddress,
    toTokenAddress: quote.toTokenAddress,
    parsedIntent: quoteData.intent,
  }),
});

const txData = await txRes.json() as any;
const freshTx = txData.result?.data?.result?.tx;

if (!freshTx) {
  console.log('\n❌ No TX data from /tx');
  console.log(JSON.stringify(txData, null, 2));
  process.exit(1);
}
console.log(`✅ Fresh TX ready`);

console.log('\n════════════════════════════════════════════════════════════');
console.log('5️⃣  Broadcasting swap TX...');
console.log('════════════════════════════════════════════════════════════');

const swapHash = await walletClient.sendTransaction({
  to: freshTx.to, data: freshTx.data,
  value: BigInt(freshTx.value || '0'),
  gas: BigInt(Math.floor(Number(freshTx.gas) * 1.5)),
  gasPrice: BigInt(freshTx.gasPrice),
  chainId: 196,
});

console.log(`\n✅ Swap TX: ${swapHash}`);
console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${swapHash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash, timeout: 60_000 })
  .catch(e => { console.log(`⚠️  Receipt timeout: ${e.message}`); return null; });

if (!receipt || receipt.status === 'reverted') {
  console.log(`\n⚠️  Swap TX reverted. Skipping confirm.`);
  await fetch(`${XFLOW_URL}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHash: swapHash, fromToken: quote.fromToken, toToken: quote.toToken, fromAmount: quote.fromAmount, paymentNetwork: swapPaymentNetwork, agentAddress: account.address }),
  }).catch(() => {});
  process.exit(1);
}
console.log('📋 Proceeding to confirm...');

console.log('\n════════════════════════════════════════════════════════════');
console.log('6️⃣  Confirming swap to XFlow (/confirm)...');
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
  console.log(`\n💸 Confirm fee paid: ${p.network} | ${p.transaction}`);
  console.log(`   DEBUG keys: ${Object.keys(p).join(', ')}`);
}

const confirmData = await confirmRes.json() as any;
if (confirmData.analyticsTx) {
  console.log(`\n✅ Analytics TX: ${confirmData.analyticsTx}`);
  console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${confirmData.analyticsTx}`);
}

// ── Step 7: /analysisReceived（confirmのX402 TX記録）────────
console.log('\n════════════════════════════════════════════════════════════');
console.log('7️⃣  Reporting analysis receipt to XFlow...');
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
console.log(`✅ Analysis receipt reported · confirmTX: ${confirmX402TxHash || 'N/A'}`);

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                  ✅ Mission Complete                       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');
