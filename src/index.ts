#!/usr/bin/env node
/**
 * XFlow - Multi-agent AI system with x402 payment routing on X Layer
 */
import { orchestrate } from './orchestrator.js';
import { readFileSync } from 'fs';

// .envロード
const env = readFileSync('/home/agent/xflow/.env', 'utf-8')
  .split('\n').reduce((acc: Record<string, string>, line) => {
    const [k, ...v] = line.split('=');
    if (k && v.length) acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});

const privateKey = (env.PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}`;
if (!privateKey) {
  console.error('❌ PRIVATE_KEY is required');
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const query = rawArgs.filter(a => !a.startsWith('--')).join(' ');
const userAddress = rawArgs.find(a => a.startsWith('--address='))?.split('=')[1];
if (!query) {
  console.log('Usage: node src/index.ts "<query>"');
  console.log('Examples:');
  console.log('  node src/index.ts "swap 10 USDC to OKB on X Layer"');
  console.log('  node src/index.ts "price of OKB"');
  process.exit(0);
}

console.log(`\n🌊 XFlow`);
console.log(`📝 Query: ${query}\n`);

const result = await orchestrate(query, {
  privateKey,
  preferredNetwork: 'eip155:196',
  userAddress,
});

console.log(`\n✅ Done`);
console.log(`   Intent:  ${result.intent}`);
console.log(`   Network: ${result.network}`);
console.log(`   TX:      ${result.transaction}`);
console.log(`   Result:  ${JSON.stringify(result.data, null, 2)}`);
