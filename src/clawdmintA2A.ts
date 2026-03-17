/**
 * ClawdMint A2A Integration
 * After XFlow executes a swap, calls ClawdMint via A2A + x402 for TX analysis.
 *
 * Protocol: JSON-RPC 2.0, method: message/send
 * Payment:  x402 USDC $0.001 on Base (auto-paid via Agent0 SDK)
 */
import { SDK } from 'agent0-sdk';

const CLAWDMINT_A2A = 'https://clawdmint-api.vercel.app/a2a';

export interface SwapContext {
  txHash: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  chainId?: number; // defaults to 196 (X Layer)
}

export interface ClawdMintAnalysis {
  txExplanation: string;
  nextActions: string;
  paidWithX402: boolean;
  settlements: string[]; // TX hashes of x402 payments on Base
}

/**
 * Extract agent reply text from message/send JSON-RPC response
 */
function extractReply(response: any): string {
  const messages: any[] = response?.result?.messages ?? [];
  const agentMsg = messages.filter((m: any) => m.role === 'agent').pop();
  return agentMsg?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
}

/**
 * Send one message to ClawdMint with automatic x402 payment
 */
async function sendMessage(
  sdk: SDK,
  label: string,
  text: string,
  contextId?: string
): Promise<{ reply: string; contextId: string; settlementTx: string | null }> {
  const params: any = {
    message: { role: 'user', parts: [{ type: 'text', text }] },
  };
  if (contextId) params.contextId = contextId;

  const body = JSON.stringify({
    jsonrpc: '2.0', id: Date.now(), method: 'message/send', params,
  });

  console.log(`\n🧠 XFlow → ClawdMint [${label}]:`);
  console.log(`   "${text.slice(0, 80)}..."`);

  let result = await (sdk as any).request({
    url: CLAWDMINT_A2A, method: 'POST', body,
    headers: { 'Content-Type': 'application/json' },
  });

  let settlementTx: string | null = null;

  if (result.x402Required) {
    console.log(`\n❌ First attempt:`);
    console.log(`   "Payment required (402) — ClawdMint requires $0.001 USDC"`);
    console.log(`\n🔁 Retrying with payment...`);
    console.log(`⚡ Paying via x402 on Base...`);
    result = await result.x402Payment.pay(0);
    settlementTx = result.x402Settlement?.transaction ?? null;
    console.log(`✅ Payment confirmed`);
    console.log(`   tx: ${settlementTx}`);
  }

  const returnedContextId = result.result?.contextId ?? contextId ?? '';
  const reply = extractReply(result);

  console.log(`\n🤖 ClawdMint → XFlow [${label}]:`);
  console.log(`   "${reply.slice(0, 120)}..."`);

  return { reply, contextId: returnedContextId, settlementTx };
}

/**
 * Main: analyze a completed swap with ClawdMint via A2A + x402
 */
export async function analyzeSwapWithClawdMint(
  swap: SwapContext
): Promise<ClawdMintAnalysis> {
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  const rpcUrl = process.env.RPC_URL ?? 'https://mainnet.base.org';

  if (!privateKey) throw new Error('PRIVATE_KEY is required');

  const sdk = new SDK({ chainId: 8453, rpcUrl, privateKey });
  const chainId = swap.chainId ?? 196;
  const settlements: string[] = [];

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🌊 XFlow A2A Session`);
  console.log(`   Swap: ${swap.fromAmount} ${swap.fromToken} → ${swap.toAmount} ${swap.toToken}`);
  console.log(`   TX:   ${swap.txHash}`);
  console.log(`${'─'.repeat(60)}`);

  const txMsg =
    `I just executed a DeFi swap via XFlow (an AI-powered DEX agent) on X Layer (chain ${chainId}). ` +
    `Transaction hash: ${swap.txHash}. ` +
    `I swapped ${swap.fromAmount} ${swap.fromToken} for ${swap.toAmount} ${swap.toToken}. ` +
    `Please analyze this transaction and explain what happened in plain English.`;

  console.log(`🧠 XFlow: "I need expert analysis on this swap to optimize future fund allocation"`);
  const step1 = await sendMessage(sdk, 'TX Analysis', txMsg);
  if (step1.settlementTx) settlements.push(step1.settlementTx);

  const nextMsg =
    `Based on this swap, what are the best next actions I should consider? ` +
    `Please check: current yield opportunities for ${swap.toToken}, ` +
    `gas prices across chains, and any relevant bridge routes from X Layer.`;

  console.log(`🧠 XFlow: "Next actions will determine where to deploy the received ${swap.toToken}"`);
  const step2 = await sendMessage(sdk, 'Next Actions', nextMsg, step1.contextId);
  if (step2.settlementTx) settlements.push(step2.settlementTx);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ A2A Session complete`);
  console.log(`💰 Total spent by XFlow: $${(settlements.length * 0.001).toFixed(3)} USDC`);
  console.log(`   - TX analysis:   $0.001 (tx: ${settlements[0]?.slice(0, 10)}...)`);
  console.log(`   - Next actions:  $0.001 (tx: ${settlements[1]?.slice(0, 10)}...)`);
  console.log(`${'─'.repeat(60)}\n`);

  return {
    txExplanation: step1.reply,
    nextActions: step2.reply,
    paidWithX402: settlements.length > 0,
    settlements,
  };
}
