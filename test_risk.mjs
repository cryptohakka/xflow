import { orchestrate } from './src/orchestrator.js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env','utf-8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(),l.split('=').slice(1).join('=').trim()])
);

console.log('🧪 Testing Risk Rejection...\n');
const result = await orchestrate('swap 99999 USDC to OKB', {
  privateKey: env.PRIVATE_KEY,
  preferredNetwork: 'eip155:196',
  userAddress: '0x191c78ad59cc4fd59155c351c08c06c0e794b0b1',
});

console.log('Status:', result.data.status);
console.log('Risk:', JSON.stringify(result.data.risk, null, 2));
