import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env','utf-8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(),l.split('=').slice(1).join('=').trim()])
);

const xlayer = {
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } },
};

const account = privateKeyToAccount(env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

// まずapproveが必要
const USDC = '0x74b7f16337b8972027f6196a17a631ac6de26d22';
const ROUTER = '0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954';
const approveAbi = [{name:'approve',type:'function',stateMutability:'nonpayable',inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}],outputs:[{type:'bool'}]}];

console.log('1️⃣ Approving USDC...');
const approveTx = await walletClient.writeContract({
  address: USDC,
  abi: approveAbi,
  functionName: 'approve',
  args: [ROUTER, 100n], // 0.0001 USDC (6 decimals)
});
console.log('   Approve TX:', approveTx);
await publicClient.waitForTransactionReceipt({ hash: approveTx });

// swap TX送信
const tx = {
  to: '0xD1b8997AaC08c619d40Be2e4284c9C72cAB33954',
  data: '0xf2c42696000000000000000000000000000000000000000000000000000000000003663800000000000000000000000074b7f16337b8972027f6196a17a631ac6de26d22000000000000000000000000e538905cf8410324e03a5a23c1c177a474d59b2b0000000000000000000000000000000000000000000000000000000000002710',
  value: 0n,
  gas: 300000n,
  chainId: 196,
};

console.log('2️⃣ Sending swap TX...');
const hash = await walletClient.sendTransaction(tx);
console.log('   Swap TX:', hash);
console.log('   Explorer: https://www.okx.com/web3/explorer/xlayer/tx/' + hash);
