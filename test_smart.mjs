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

const data = await res.json();
console.log(`\n✅ Result: ${data.result?.data?.status}`);
console.log(`   Risk: ${data.result?.data?.risk?.riskLevel}`);
console.log(`   Quote: ${data.result?.data?.quote?.fromAmount} USDC → ${data.result?.data?.quote?.toAmount} WOKB`);
