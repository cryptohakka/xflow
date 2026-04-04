import 'dotenv/config';
import { XFlowClient } from '@xflow/sdk';

const client = new XFlowClient({ 
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  chainId: parseInt(process.env.CHAIN_ID || '196'),
  onProgress: (msg) => console.log(msg),
});

const result = await client.swap(process.env.SWAP_QUERY || 'swap 0.01 USDC to USDT0');
console.log('✅', result.explorerUrl);
