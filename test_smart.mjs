import { createSmartPaymentFetch } from './src/smartPaymentRouter.ts';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env','utf-8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(),l.split('=').slice(1).join('=').trim()])
);

const { fetchWithPayment, selectedNetwork, allBalances } = await createSmartPaymentFetch(env.PRIVATE_KEY);

const SWAP_QUERY = 'swap 0.01 USDC to USDT0';

const { createWalletClient, createPublicClient, http } = await import('viem');
const { privateKeyToAccount: pta } = await import('viem/accounts');
const xlayer = { id: 196, name: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } } };
const account = pta(env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

// ── Step 1: /swap（x402支払い + quote+risk取得）────────────────
console.log('\n════════════════════════════════════════════════════════════');
console.log('1️⃣  Requesting quote from XFlow (/swap)...');
console.log('════════════════════════════════════════════════════════════');

const swapRes = await fetchWithPayment('http://localhost:3010/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: SWAP_QUERY,
    userAddress: account.address,
    _routerMeta: {
      selectedNetwork: selectedNetwork?.name,
      selectedGasCostUSD: selectedNetwork?.gasCostUSD,
      allBalances: allBalances.map(b => ({
        name: b.name,
        balance: b.balanceFormatted,
        sufficient: b.sufficient,
        gasCostUSD: b.gasCostUSD,
      })),
    },
  }),
});

const pr = swapRes.headers.get('payment-response');
if (pr) {
  const payment = JSON.parse(Buffer.from(pr, 'base64').toString());
  console.log(`\n💸 Paid on: ${payment.network}`);
  console.log(`   TX: ${payment.transaction}`);
}

const quoteData = await swapRes.json();

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

// ── Step 2: allowanceチェック → approve ──────────────────────
console.log('\n════════════════════════════════════════════════════════════');
console.log('2️⃣  Checking allowance...');
console.log('════════════════════════════════════════════════════════════');

const fromTokenAddr = quote.fromTokenAddress;
const spender = quote.spender || '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';

const allowanceAbi = [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }];
const approveAbi   = [{ name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }];

if (fromTokenAddr && spender) {
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
      address: fromTokenAddr, abi: approveAbi,
      functionName: 'approve',
      args: [spender, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
    });
    console.log(`   Approve TX: ${approveTx}`);
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log(`   ✅ Approved`);
  } else {
    console.log(`✅ Allowance sufficient`);
  }
}

// ── Step 3: /tx（x402不要 — approve完了直後にfresh TX取得）──
console.log('\n════════════════════════════════════════════════════════════');
console.log('3️⃣  Fetching fresh TX data (/tx)...');
console.log('════════════════════════════════════════════════════════════');

const txRes = await fetch('http://localhost:3010/tx', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: SWAP_QUERY,
    userAddress: account.address,
    fromTokenAddress: quote.fromTokenAddress,
    toTokenAddress: quote.toTokenAddress,
  }),
});

const txData = await txRes.json();
const freshTx = txData.result?.data?.result?.tx;

if (!freshTx) {
  console.log('\n❌ No TX data from /tx');
  console.log(JSON.stringify(txData, null, 2));
  process.exit(1);
}

console.log(`✅ Fresh TX ready · to: ${freshTx.to}`);

// ── Step 4: Broadcast swap TX ────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
console.log('4️⃣  Broadcasting swap TX...');
console.log('════════════════════════════════════════════════════════════');

const swapHash = await walletClient.sendTransaction({
  to: freshTx.to,
  data: freshTx.data,
  value: BigInt(freshTx.value || '0'),
  gas: BigInt(Math.floor(Number(freshTx.gas) * 1.5)),
  gasPrice: BigInt(freshTx.gasPrice),
  chainId: 196,
});

console.log(`\n✅ Swap TX: ${swapHash}`);
console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${swapHash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });

// ── Step 5: /confirm（成功時のみ）────────────────────────────
if (receipt.status !== 'success') {
  console.log(`\n⚠️  Swap TX reverted. Skipping confirm.`);
  process.exit(1);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('5️⃣  Confirming swap (/confirm)...');
console.log('════════════════════════════════════════════════════════════');

const confirmFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: selectedNetwork?.network || 'eip155:8453', client: new ExactEvmScheme(account) }],
});

const confirmRes = await confirmFetch('http://localhost:3010/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    txHash: swapHash,
    fromToken: quote.fromToken,
    toToken: quote.toToken,
    fromAmount: quote.fromAmount,
    toAmount: quote.toAmount,
    paymentNetwork: quoteData.result?.network,
    route: quote.route,
    riskLevel: risk?.riskLevel,
    agentAddress: account.address,
  }),
});

const confirmPr = confirmRes.headers.get('payment-response');
if (confirmPr) {
  const p = JSON.parse(Buffer.from(confirmPr, 'base64').toString());
  console.log(`\n💸 Execution fee paid: ${p.network} | ${p.transaction}`);
}

const confirmData = await confirmRes.json();
if (confirmData.analyticsTx) {
  console.log(`\n✅ Analytics TX: ${confirmData.analyticsTx}`);
  console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${confirmData.analyticsTx}`);
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                  ✅ Mission Complete                       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');
