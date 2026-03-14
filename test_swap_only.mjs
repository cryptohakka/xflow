import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http } from 'viem';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env','utf-8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(),l.split('=').slice(1).join('=').trim()])
);

const xlayer = { id: 196, name: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } } };
const account = privateKeyToAccount(env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

// Step 1: TX取得
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

// Step 2: 即座にswap送信（approveスキップ）
console.log('Sending swap TX...');
const hash = await walletClient.sendTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value || '0'),
  gas: BigInt(tx.gas),
  gasPrice: BigInt(tx.gasPrice),
  chainId: 196,
});
console.log('TX:', hash);
console.log('🔗 https://www.okx.com/web3/explorer/xlayer/tx/' + hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(receipt.status === 'success' ? '✅ Success!' : '❌ Failed');
