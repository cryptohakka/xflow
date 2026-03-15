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

const xlayer = {
  id: 196, name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } },
};

const account = privateKeyToAccount(env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

// Step 1: XFlowにx402で支払いながらswap TX取得
console.log('1️⃣ Requesting swap TX from XFlow (x402)...');
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:196', client: new ExactEvmScheme(account) }],
});

const res = await fetchWithPayment('http://localhost:3010/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'swap 0.01 USDC to OKB',
    userAddress: account.address,
  }),
});

const pr = res.headers.get('payment-response');
if (pr) {
  const payment = JSON.parse(Buffer.from(pr, 'base64').toString());
  console.log(`   💸 x402 paid: ${payment.network} | ${payment.transaction}`);
}

const txData = await res.json();
const tx = txData.result?.data?.result?.tx;
if (!tx) {
  console.error('❌ No TX data returned');
  console.log(JSON.stringify(data, null, 2));
  process.exit(1);
}
console.log(`   ✅ TX data received`);

// Step 2: USDC approve
const USDC = '0x74b7f16337b8972027f6196a17a631ac6de26d22';
const approveAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'); // max approve
console.log('2️⃣ Approving USDC...');
const approveTx = await walletClient.writeContract({
  address: USDC,
  abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
  functionName: 'approve',
  args: [tx.to, approveAmount],
});
console.log(`   Approve TX: ${approveTx}`);
// skip waiting for approve, send swap immediately

// Step 3: swap TX送信
console.log('3️⃣ Sending swap TX...');
const swapHash = await walletClient.sendTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value || '0'),
  gas: BigInt(tx.gas),
  gasPrice: BigInt(tx.gasPrice),
  chainId: 196,
});
console.log(`   Swap TX: ${swapHash}`);
console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${swapHash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
console.log(`\n${receipt.status === 'success' ? '✅ Swap successful!' : '❌ Swap failed'}`);

// Step 4: Analytics - only record if swap succeeded
if (receipt.status === 'success') {
  console.log('4️⃣ Recording swap onchain...');
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
      agentAddress: account.address,
    }),
  });
  const confirmData = await confirmRes.json();
  if (confirmData.analyticsTx) {
    console.log('   ✅ Analytics TX:', confirmData.analyticsTx);
    console.log('   🔗 https://www.okx.com/web3/explorer/xlayer/tx/' + confirmData.analyticsTx);
  }
}

// Step 4: Analytics - record successful swap
const receipt2 = await (await import('viem')).createPublicClient({
  chain: { id: 196, name: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } } },
  transport: (await import('viem')).http('https://rpc.xlayer.tech'),
}).waitForTransactionReceipt({ hash: '0x61564f0262d982be2b8d1c84cff7f39d48ae59e65ccb7615940ea6c9e0b3aec2' });
