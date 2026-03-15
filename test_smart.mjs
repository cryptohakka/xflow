import { createSmartPaymentFetch } from './src/smartPaymentRouter.js';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env','utf-8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(),l.split('=').slice(1).join('=').trim()])
);

console.log('\n🌊 XFlow Smart Payment Router Demo\n');

const { fetchWithPayment, selectedNetwork, allBalances } = await createSmartPaymentFetch(env.PRIVATE_KEY);

const res = await fetchWithPayment('http://localhost:3010/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'swap 0.01 USDC to OKB', userAddress: privateKeyToAccount(env.PRIVATE_KEY).address }),
});

const pr = res.headers.get('payment-response');
if (pr) {
  const payment = JSON.parse(Buffer.from(pr, 'base64').toString());
  console.log(`\n💸 Paid on: ${payment.network}`);
  console.log(`   TX: ${payment.transaction}`);
}

const txData = await res.json();
console.log(`\n✅ Result: ${txData.result?.data?.status}`);
console.log(`   Risk: ${txData.result?.data?.risk?.riskLevel}`);
console.log(`   Quote: ${txData.result?.data?.quote?.fromAmount} USDC → ${txData.result?.data?.quote?.toAmount} WOKB`);

// Step 2: sign & broadcast swap TX
const tx = txData.result?.data?.result?.tx;
if (tx) {
  const { createWalletClient, createPublicClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { readFileSync } = await import('fs');
  const env2 = Object.fromEntries(readFileSync('/home/agent/xflow/.env','utf-8').split('\n').filter(l=>l.includes('=')).map(l=>[l.split('=')[0].trim(),l.split('=').slice(1).join('=').trim()]));
  const xlayer = { id: 196, name: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } } };
  const account2 = privateKeyToAccount(env2.PRIVATE_KEY);
  const walletClient = createWalletClient({ account: account2, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
  const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

  console.log('\n2️⃣ Broadcasting swap TX...');
  const swapHash = await walletClient.sendTransaction({
    to: tx.to, data: tx.data,
    value: BigInt(tx.value || '0'),
    gas: BigInt(tx.gas),
    gasPrice: BigInt(tx.gasPrice),
    chainId: 196,
  });
  console.log(`   TX: ${swapHash}`);
  console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${swapHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  console.log(`   ${receipt.status === 'success' ? '✅ Swap successful!' : '❌ Swap failed'}`);

  // Step 3: confirm to Analytics Agent
  if (receipt.status === 'success') {
    console.log('\n3️⃣ Recording swap onchain...');
    const confirmRes = await fetch('http://localhost:3010/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: swapHash,
        fromToken: txData.result?.data?.quote?.fromToken,
        toToken: txData.result?.data?.quote?.toToken,
        fromAmount: txData.result?.data?.quote?.fromAmount,
        toAmount: txData.result?.data?.quote?.toAmount,
        paymentNetwork: txData.result?.network,
        route: txData.result?.data?.quote?.route,
        riskLevel: txData.result?.data?.risk?.riskLevel,
        agentAddress: account2.address,
      }),
    });
    const confirmData = await confirmRes.json();
    if (confirmData.analyticsTx) {
      console.log(`   ✅ Analytics TX: ${confirmData.analyticsTx}`);
      console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${confirmData.analyticsTx}`);
    }
  }
}
