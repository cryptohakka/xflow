import { handleDexQuery } from './dexAgent.js';
import { handleCexQuery } from './cexAgent.js';

export type AgentType = 'dex' | 'cex' | 'unknown';

const DEX_KEYWORDS = ['swap', 'trade', 'buy', 'sell', 'bridge', 'liquidity', 'pool'];
const CEX_KEYWORDS = ['price', 'market', 'chart', 'volume', 'orderbook', 'ticker'];

export function classifyIntent(query: string): AgentType {
  const q = query.toLowerCase();
  if (DEX_KEYWORDS.some(k => q.includes(k))) return 'dex';
  if (CEX_KEYWORDS.some(k => q.includes(k))) return 'cex';
  return 'unknown';
}

export interface OrchestratorOptions {
  privateKey: `0x${string}`;
  preferredNetwork?: string;
}

export async function orchestrate(query: string, options: OrchestratorOptions) {
  const { preferredNetwork = 'eip155:196' } = options;
  const intent = classifyIntent(query);
  console.log(`🧭 Intent: ${intent} | Query: ${query}`);

  let result: any;
  if (intent === 'dex') {
    result = await handleDexQuery(query);
  } else if (intent === 'cex') {
    result = await handleCexQuery(query);
  } else {
    result = { agent: 'unknown', query, status: 'unrecognized intent' };
  }

  return { intent, network: preferredNetwork, transaction: '', data: result };
}
