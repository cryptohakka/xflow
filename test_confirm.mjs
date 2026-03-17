import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env', 'utf-8')
    .split('\n').filter(l => l.includes('='))
    .map(l => [l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()])
);

const account = privateKeyToAccount(env.PRIVATE_KEY);

// test_smart.mjsと同じ初期化パターン
const confirmFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }],
});

console.log('\n🌊 XFlow /confirm × ClawdMint A2A Test\n');
console.log(`Wallet: ${account.address}`);

console.log('\n📤 POST /confirm...');
const res = await confirmFetch('http://localhost:3010/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    txHash: '0x5502b0240171a5161fd36fff58499b83a78059c0bf3845e18aa2691e2d89cc3e',
    fromToken: 'USDC',
    toToken: 'WOKB',
    fromAmount: '0.01',
    toAmount: '0.001234',
    chainId: 196,
    agentAddress: account.address,
    paymentNetwork: 'eip155:8453',
    route: 'OKX DEX',
    riskLevel: 'LOW',
  }),
});

const pr = res.headers.get('payment-response');
if (pr) {
  const payment = JSON.parse(Buffer.from(pr, 'base64').toString());
  console.log(`💸 x402 paid on: ${payment.network}`);
  console.log(`   TX: ${payment.transaction}`);
}

const data = await res.json();

if (data.clawdmint) {
  console.log(`\n🤖 ClawdMint Analysis:`);
  console.log(`   paidWithX402: ${data.clawdmint.paidWithX402}`);
  console.log(`   settlements: ${data.clawdmint.settlements?.join(', ')}`);
  console.log(`\n📝 TX Explanation:\n${data.clawdmint.txExplanation}`);
  console.log(`\n💡 Next Actions:\n${data.clawdmint.nextActions}`);
} else {
  console.log('\n⚠️  ClawdMint analysis not returned');
  console.log(JSON.stringify(data, null, 2));
}
