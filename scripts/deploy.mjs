#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env', 'utf-8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()])
);

const PRIVATE_KEY = env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY not found in .env');

const xlayer = {
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } },
};

console.log('🔨 Compiling XFlowAnalytics.sol...');

const source = readFileSync('/home/agent/xflow/contracts/XFlowAnalytics.sol', 'utf-8');

const input = JSON.stringify({
  language: 'Solidity',
  sources: { 'XFlowAnalytics.sol': { content: source } },
  settings: {
    viaIR: true,
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
  },
});

const result = spawnSync('npx', ['solc', '--standard-json'], {
  cwd: '/home/agent/xflow',
  input,
  encoding: 'utf-8',
  maxBuffer: 10 * 1024 * 1024,
});

const jsonLine = result.stdout.split("\n").find(l => l.trim().startsWith("{"));
const output = JSON.parse(result.stdout);

if (output.errors?.some(e => e.severity === 'error')) {
  console.error(output.errors.filter(e => e.severity === 'error').map(e => e.message).join('\n'));
  process.exit(1);
}

const contract = output.contracts['XFlowAnalytics.sol']['XFlowAnalytics'];
const parsedAbi = contract.abi;
const bytecode = '0x' + contract.evm.bytecode.object;
console.log('✅ Compiled successfully');

console.log('🚀 Deploying to X Layer...');

const account = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  chain: xlayer,
  transport: http('https://rpc.xlayer.tech'),
});
const publicClient = createPublicClient({
  chain: xlayer,
  transport: http('https://rpc.xlayer.tech'),
});

const hash = await walletClient.deployContract({
  abi: parsedAbi,
  bytecode,
  args: [],
});

console.log(`📡 Deploy TX: ${hash}`);
console.log('⏳ Waiting for confirmation...');

const receipt = await publicClient.waitForTransactionReceipt({ hash });
const contractAddress = receipt.contractAddress;

console.log(`\n✅ Deployed! Contract address: ${contractAddress}`);
console.log(`🔗 https://www.okx.com/web3/explorer/xlayer/address/${contractAddress}`);

const envContent = readFileSync('/home/agent/xflow/.env', 'utf-8');
const updated = envContent.includes('ANALYTICS_CONTRACT=')
  ? envContent.replace(/ANALYTICS_CONTRACT=.*/, `ANALYTICS_CONTRACT=${contractAddress}`)
  : envContent + `\nANALYTICS_CONTRACT=${contractAddress}`;

writeFileSync('/home/agent/xflow/.env', updated);
console.log(`✅ .env updated: ANALYTICS_CONTRACT=${contractAddress}`);
