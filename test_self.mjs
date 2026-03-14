import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

const env = readFileSync('/home/agent/xflow/.env', 'utf-8')
  .split('\n').reduce((acc, line) => {
    const [k, ...v] = line.split('=');
    if (k && v.length) acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});

const account = privateKeyToAccount(env.PRIVATE_KEY);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:196', client: new ExactEvmScheme(account) }],
});

console.log('\n🌊 XFlow Agent-to-Agent Demo');
console.log('📤 Sending swap request with x402 payment...\n');

const res = await fetchWithPayment('http://localhost:3010/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'swap 0.01 USDC to OKB',
    userAddress: env.PAYEE_ADDRESS || account.address,
  }),
});

const pr = res.headers.get('payment-response');
if (pr) {
  const payment = JSON.parse(Buffer.from(pr, 'base64').toString());
  console.log('💸 Payment:', payment.network, '|', payment.transaction);
}

const data = await res.json();
console.log('\n✅ Result:');
console.log(JSON.stringify(data, null, 2));
