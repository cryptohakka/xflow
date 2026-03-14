import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env','utf-8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(),l.split('=').slice(1).join('=').trim()])
);

const account = privateKeyToAccount(env.PRIVATE_KEY);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:196', client: new ExactEvmScheme(account) }],
});

const res = await fetchWithPayment('http://localhost:3010/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'swap 0.01 USDC to OKB', userAddress: account.address }),
});

const data = await res.json();
const tx = data.result?.data?.result?.tx;
console.log('tx.gas:', tx?.gas);
console.log('tx.to:', tx?.to);
console.log('tx.value:', tx?.value);
