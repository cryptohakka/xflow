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

console.log('\n🌊 XFlow Smart Payment Router Demo\n');

const { fetchWithPayment, selectedNetwork, allBalances } = await createSmartPaymentFetch(env.PRIVATE_KEY);

const SWAP_QUERY = 'swap 0.01 USDC to USDG';

// Step 1: quoteを取得（fromTokenAddress/spenderを動的に取得）
async function fetchQuote(fetchFn, userAddress) {
  const res = await fetchFn('http://localhost:3010/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SWAP_QUERY, userAddress }),
  });
  const pr = res.headers.get('payment-response');
  if (pr) {
    const payment = JSON.parse(Buffer.from(pr, 'base64').toString());
    console.log(`\n💸 Paid on: ${payment.network}`);
    console.log(`   TX: ${payment.transaction}`);
  }
  return res.json();
}

const { createWalletClient, createPublicClient, http } = await import('viem');
const { privateKeyToAccount: pta } = await import('viem/accounts');
const xlayer = { id: 196, name: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } } };
const account = pta(env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

// 1回目のquote（allowanceチェック用）
const txData = await fetchQuote(fetchWithPayment, account.address);
console.log('RAW txData:', JSON.stringify(txData).slice(0, 200));
console.log(`\n✅ Result: ${txData.result?.data?.status}`);
console.log(`   Risk: ${txData.result?.data?.risk?.riskLevel}`);
console.log(`   Quote: ${txData.result?.data?.quote?.fromAmount} ${txData.result?.intent?.fromToken} → ${txData.result?.data?.quote?.toAmount} ${txData.result?.intent?.toToken}`);

const tx0 = txData.result?.data?.result?.tx;
if (!tx0) { console.log('❌ No TX data'); process.exit(1); }

// allowanceチェック → 不足ならapprove+wait → 再quote
const fromTokenAddr = txData.result?.data?.quote?.fromTokenAddress;
const spender = tx0.to;
const allowanceAbi = [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }];
const approveAbi   = [{ name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }];

let finalTx = tx0;
let finalTxData = txData;

if (fromTokenAddr && spender) {
  const allowance = await publicClient.readContract({ address: fromTokenAddr, abi: allowanceAbi, functionName: 'allowance', args: [account.address, spender] });
  const fromAmountRaw = BigInt(txData.result?.data?.quote?.fromTokenRawAmount || '0');
  if (allowance < fromAmountRaw) {
    console.log(`\n🔐 Allowance insufficient, approving ${txData.result?.intent?.fromToken}...`);
    const approveTx = await walletClient.writeContract({ address: fromTokenAddr, abi: approveAbi, functionName: 'approve', args: [spender, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')] });
    console.log(`   Approve TX: ${approveTx}`);
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log(`   ✅ Approved — fetching fresh quote...`);
    // approve完了後に新鮮なquoteを取得
    finalTxData = await fetchQuote(fetchWithPayment, account.address);
    finalTx = finalTxData.result?.data?.result?.tx;
    if (!finalTx) { console.log('❌ Re-quote failed'); process.exit(1); }
  } else {
    console.log(`\n✅ Allowance sufficient, skipping approve`);
  }
}

// Step 2: swap TX即時送信
console.log('\n2️⃣ Broadcasting swap TX...');
const swapHash = await walletClient.sendTransaction({
  to: finalTx.to, data: finalTx.data,
  value: BigInt(finalTx.value || '0'),
  gas: BigInt(finalTx.gas),
  gasPrice: BigInt(finalTx.gasPrice),
  chainId: 196,
});
console.log(`   TX: ${swapHash}`);
console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${swapHash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
console.log(`   ${receipt.status === 'success' ? '✅ Swap successful!' : '❌ Swap failed'}`);

// Step 3: Analytics Agent (x402 execution fee)
const confirmFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: selectedNetwork?.network || 'eip155:196', client: new ExactEvmScheme(account) }],
});
if (receipt.status === 'success') {
  console.log('\n3️⃣ Recording swap onchain...');
  const confirmRes = await confirmFetch('http://localhost:3010/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      txHash: swapHash,
      fromToken: finalTxData.result?.data?.quote?.fromToken,
      toToken: finalTxData.result?.data?.quote?.toToken,
      fromAmount: finalTxData.result?.data?.quote?.fromAmount,
      toAmount: finalTxData.result?.data?.quote?.toAmount,
      paymentNetwork: finalTxData.result?.network,
      route: finalTxData.result?.data?.quote?.route,
      riskLevel: finalTxData.result?.data?.risk?.riskLevel,
      agentAddress: account.address,
    }),
  });
  const confirmPr = confirmRes.headers.get('payment-response');
  if (confirmPr) {
    const confirmPayment = JSON.parse(Buffer.from(confirmPr, 'base64').toString());
    console.log(`   💸 Execution fee paid on: ${confirmPayment.network} | ${confirmPayment.transaction}`);
  }
  const confirmData = await confirmRes.json();
  if (confirmData.analyticsTx) {
    console.log(`   ✅ Analytics TX: ${confirmData.analyticsTx}`);
    console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${confirmData.analyticsTx}`);
  }

  if (confirmData.clawdmint) {
    console.log(`\n🤖 ClawdMint Analysis (paid $${confirmData.clawdmint.paidWithX402 ? '0.002' : '0'} USDC):`);
    console.log(`\n📝 TX Explanation:\n${confirmData.clawdmint.txExplanation}`);
    console.log(`\n💡 Next Actions:\n${confirmData.clawdmint.nextActions}`);
  }
}
