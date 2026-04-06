/**
 * ClawdMint A2A Integration
 * After XFlow executes a swap, calls ClawdMint via A2A + x402 for TX analysis.
 *
 * Protocol: JSON-RPC 2.0, method: message/send
 * Payment:  x402 USDC $0.001 on Base (auto-paid via Agent0 SDK)
 */
import { SDK } from 'agent0-sdk';
import { recordX402PaymentOnchain, recordA2ACallOnchain } from './analyticsAgent.js';
import { explorerLink } from './utils.js';

const CLAWDMINT_A2A = 'https://clawdmint-api.vercel.app/a2a';

const POOL_XLAYER = { name: 'USDT0/WOKB', url: 'https://app.uniswap.org/explore/pools/xlayer/0x63d62734847E55A266FCa4219A9aD0a02D5F6e02' };
const POOL_UNICHAIN = { name: 'USDC/USD₮0', url: 'https://app.uniswap.org/explore/pools/unichain/0x77ea9d2be50eb3e82b62db928a1bcc573064dd2a14f5026847e755518c8659c9' };

export interface SwapContext {
  txHash: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  chainId?: number;
  agentAddress?: string;
}

export interface ClawdMintAnalysis {
  txExplanation: string;
  nextActions: string;
  paidWithX402: boolean;
  settlements: string[];
}

function extractReply(response: any): string {
  const messages: any[] = response?.result?.messages ?? [];
  const agentMsg = messages.filter((m: any) => m.role === 'agent').pop();
  return agentMsg?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
}

async function sendMessage(
  sdk: SDK,
  text: string,
  agentAddress: string,
): Promise<{ reply: string; settlementTx: string | null }> {
  const params: any = {
    message: { role: 'user', parts: [{ type: 'text', text }] },
  };

  const body = JSON.stringify({
    jsonrpc: '2.0', id: Date.now(), method: 'message/send', params,
  });

  let result = await (sdk as any).request({
    url: CLAWDMINT_A2A, method: 'POST', body,
    headers: { 'Content-Type': 'application/json' },
  });

  let settlementTx: string | null = null;

  if (result.x402Required) {
    console.log(`⚡ Paying via x402 on Base...`);
    result = await result.x402Payment.pay(0);
    settlementTx = result.x402Settlement?.transaction ?? null;
    console.log(`✅ Payment confirmed · tx: ${explorerLink(settlementTx, 'base')}`);
    await recordX402PaymentOnchain({
      agentAddress,
      endpoint: '/clawdmint-a2a',
      feePaid: '0.001',
      paymentNetwork: 'base',
      paymentTxHash: settlementTx || '',
    }).catch((e: any) => console.warn('[ClawdMint] X402 record failed:', e.message));
  }

  return { reply: extractReply(result), settlementTx };
}

export async function analyzeSwapWithClawdMint(
  swap: SwapContext
): Promise<ClawdMintAnalysis> {
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  const rpcUrl = process.env.RPC_URL ?? 'https://mainnet.base.org';

  if (!privateKey) throw new Error('PRIVATE_KEY is required');

  const sdk = new SDK({ chainId: 8453, rpcUrl, privateKey });
  const chainId = swap.chainId ?? 196;
  const agentAddress = process.env.PAYEE_ADDRESS || swap.agentAddress || '0x0000000000000000000000000000000000000000';
  const pool = chainId === 130 ? POOL_UNICHAIN : POOL_XLAYER;

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`3️⃣  A2A Session (ClawdMint)`);
  console.log(`════════════════════════════════════════════════════════════`);

  const prompt =
    `I just executed a DeFi swap via XFlow (an AI-powered DEX agent) on ${chainId === 130 ? 'Unichain' : 'X Layer'} (chain ${chainId}). ` +
    `Transaction hash: ${swap.txHash}. ` +
    `I swapped ${swap.fromAmount} ${swap.fromToken} for ${swap.toAmount} ${swap.toToken}. ` +
    `\n\nPlease provide:` +
    `\n1. Brief TX analysis (1-2 sentences in plain English)` +
    `\n2. Next action recommendation: the received ${swap.toToken} can be deployed to the ${pool.name} liquidity pool on Uniswap (${pool.url}). Is this a good move?`;

  console.log(`\n🧠 XFlow → ClawdMint:`);
  console.log(`   "${prompt.slice(0, 100)}..."`);

  const { reply, settlementTx } = await sendMessage(sdk, prompt, agentAddress);
  const settlements = settlementTx ? [settlementTx] : [];

  const lines = reply.split('\n').filter(l => l.trim());
  const txExplanation = lines.slice(0, 2).join(' ').trim() || reply.slice(0, 200);
  const nextActions = lines.slice(2).join(' ').trim() || reply.slice(200);

  console.log(`\n🤖 ClawdMint → XFlow:`);
  console.log(`   TX Analysis:  ${txExplanation.slice(0, 120)}...`);
  console.log(`   Next Actions: Consider the ${pool.name} pool on ${chainId === 130 ? 'Unichain' : 'X Layer'} as a yield opportunity`);
  console.log(`   Pool: ${pool.url}`);
  await recordA2ACallOnchain({
    callerAgent:    agentAddress,
    externalAgent:  'ClawdMint',
    purpose:        'swap_confirmation',
    feePaid:        '0.001',
    paymentNetwork: 'base',
  }).catch((e: any) => console.warn('[ClawdMint] A2A record failed:', e.message));

  return {
    txExplanation,
    nextActions: `Deploy ${swap.toToken} to ${pool.name} pool on ${chainId === 130 ? 'Unichain' : 'X Layer'} · ${pool.url}`,
    paidWithX402: settlements.length > 0,
    settlements,
  };
}
