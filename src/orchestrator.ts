import { payAndCall } from './x402PaymentAdapter.js';

export type AgentType = 'dex' | 'cex' | 'unknown';

const DEX_KEYWORDS = ['swap', 'trade', 'buy', 'sell', 'bridge', 'liquidity', 'pool'];
const CEX_KEYWORDS = ['price', 'market', 'chart', 'volume', 'orderbook', 'ticker'];

/**
 * Intent classifier — DEX or CEX?
 */
export function classifyIntent(query: string): AgentType {
  const q = query.toLowerCase();
  if (DEX_KEYWORDS.some(k => q.includes(k))) return 'dex';
  if (CEX_KEYWORDS.some(k => q.includes(k))) return 'cex';
  return 'unknown';
}

export interface OrchestratorOptions {
  privateKey: `0x${string}`;
  preferredNetwork?: string;
  dexAgentUrl?: string;
  cexAgentUrl?: string;
  clawdmintUrl?: string;
}

/**
 * XFlow Orchestrator
 * Routes user intent to the appropriate agent
 */
export async function orchestrate(query: string, options: OrchestratorOptions) {
  const {
    privateKey,
    preferredNetwork = 'eip155:196',
    dexAgentUrl = 'http://localhost:3003',
    cexAgentUrl = 'http://localhost:3004',
    clawdmintUrl = 'http://localhost:3000/a2a',
  } = options;

  const intent = classifyIntent(query);
  console.log(`🧭 Intent: ${intent} | Query: ${query}`);

  const paymentOptions = { privateKey, preferredNetwork };

  // DEX / CEX agentが未実装の場合はClawdMintにfallback
  const url = intent === 'dex' ? dexAgentUrl
            : intent === 'cex' ? cexAgentUrl
            : clawdmintUrl;

  const result = await payAndCall(url, {
    jsonrpc: '2.0',
    id: '1',
    method: 'message/send',
    params: {
      message: { role: 'user', parts: [{ type: 'text', text: query }] },
    },
  }, paymentOptions);

  return {
    intent,
    ...result,
  };
}
