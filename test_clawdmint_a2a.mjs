/**
 * test_clawdmint_a2a.mjs
 * ClawdMint A2A連携の動作確認テスト
 * Usage: node test_clawdmint_a2a.mjs
 */
import { SDK } from './node_modules/agent0-sdk/dist/index.js';
import { readFileSync } from 'fs';

// .envを読む
const env = readFileSync('/home/agent/xflow/.env', 'utf-8')
  .split('\n').reduce((acc, line) => {
    const [k, ...v] = line.split('=');
    if (k && v.length) acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});

const CLAWDMINT_A2A = 'https://clawdmint-api.vercel.app/a2a';

function extractReply(response) {
  const messages = response?.result?.messages ?? [];
  const agentMsg = messages.filter(m => m.role === 'agent').pop();
  return agentMsg?.parts?.map(p => p.text ?? '').join('') ?? '';
}

async function sendMessage(sdk, text, contextId) {
  const params = {
    message: { role: 'user', parts: [{ type: 'text', text }] },
  };
  if (contextId) params.contextId = contextId;

  const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'message/send', params });

  let result = await sdk.request({
    url: CLAWDMINT_A2A, method: 'POST', body,
    headers: { 'Content-Type': 'application/json' },
  });

  let settlementTx = null;
  if (result.x402Required) {
    console.log(`💳 Paying $0.001 USDC on Base...`);
    result = await result.x402Payment.pay(0);
    settlementTx = result.x402Settlement?.transaction ?? null;
    console.log(`✅ Settlement TX: ${settlementTx}`);
  }

  return {
    reply: extractReply(result),
    contextId: result.result?.contextId ?? contextId ?? '',
    settlementTx,
  };
}

// --- テスト実行 ---
const sdk = new SDK({
  chainId: 8453,
  rpcUrl: env.RPC_URL || 'https://mainnet.base.org',
  privateKey: env.PRIVATE_KEY,
});

// ダミーswapデータ（実際のTX hashに変えてテスト可能）
const swap = {
  txHash: '0x5502b0240171a5161fd36fff58499b83a78059c0bf3845e18aa2691e2d89cc3e',
  fromToken: 'USDC',
  toToken: 'WOKB',
  fromAmount: '0.01',      // 1.0 → 0.01
  toAmount: '0.001234',    // 0.123456 → 0.001234
  chainId: 196,
};

console.log('\n=== XFlow × ClawdMint A2A Integration Test ===\n');
console.log(`Swap: ${swap.fromAmount} ${swap.fromToken} → ${swap.toAmount} ${swap.toToken}`);
console.log(`TX:   ${swap.txHash}\n`);

// Step 1: TX解説
console.log('--- Step 1: TX Analysis ---');
const step1 = await sendMessage(sdk,
  `I just executed a DeFi swap via XFlow (an AI-powered DEX agent) on X Layer (chain ${swap.chainId}). ` +
  `Transaction hash: ${swap.txHash}. ` +
  `I swapped ${swap.fromAmount} ${swap.fromToken} for ${swap.toAmount} ${swap.toToken}. ` +
  `Please analyze this transaction and explain what happened in plain English.`
);
console.log(`Reply: ${step1.reply}\n`);

// Step 2: 次のアクション（会話継続）
console.log('--- Step 2: Next Actions ---');
const step2 = await sendMessage(sdk,
  `Based on this swap, what are the best next actions I should consider? ` +
  `Please check: current yield opportunities for ${swap.toToken}, ` +
  `gas prices across chains, and any relevant bridge routes from X Layer.`,
  step1.contextId
);
console.log(`Reply: ${step2.reply}\n`);

console.log('=== Result ===');
console.log({
  txExplanation: step1.reply.slice(0, 100) + '...',
  nextActions: step2.reply.slice(0, 100) + '...',
  paidWithX402: !!(step1.settlementTx || step2.settlementTx),
  settlements: [step1.settlementTx, step2.settlementTx].filter(Boolean),
});
