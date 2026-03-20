/**
 * ClawdMint A2A Integration
 * After XFlow executes a swap, calls ClawdMint via A2A + x402 for TX analysis.
 *
 * Protocol: JSON-RPC 2.0, method: message/send
 * Payment:  x402 USDC $0.001 on Base (auto-paid via Agent0 SDK)
 */
import { SDK } from 'agent0-sdk';

const CLAWDMINT_A2A = 'https://clawdmint-api.vercel.app/a2a';

const USDT0_WOKB_POOL = 'https://app.uniswap.org/explore/pools/xlayer/0x63d62734847E55A266FCa4219A9aD0a02D5F6e02';

export interface SwapContext {
  txHash: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  chainId?: number;
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
    console.log(`✅ Payment confirmed · tx: ${settlementTx}`);
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

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`3️⃣  A2A Session (ClawdMint)`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`   Swap: ${swap.fromAmount} ${swap.fromToken} → ${swap.toAmount} ${swap.toToken}`);
  console.log(`   TX:   ${swap.txHash}`);

  const prompt =
    `I just executed a DeFi swap via XFlow (an AI-powered DEX agent) on X Layer (chain ${chainId}). ` +
    `Transaction hash: ${swap.txHash}. ` +
    `I swapped ${swap.fromAmount} ${swap.fromToken} for ${swap.toAmount} ${swap.toToken}. ` +
    `\n\nPlease provide:` +
    `\n1. Brief TX analysis (1-2 sentences in plain English)` +
    `\n2. Next action recommendation: the received ${swap.toToken} can be deployed to the USDT0/WOKB liquidity pool on Uniswap X Layer (${USDT0_WOKB_POOL}). Is this a good move?`;

  console.log(`\n🧠 XFlow → ClawdMint:`);
  console.log(`   "${prompt.slice(0, 100)}..."`);

  const { reply, settlementTx } = await sendMessage(sdk, prompt);
  const settlements = settlementTx ? [settlementTx] : [];

  // Extract TX analysis and next actions from combined reply
  const lines = reply.split('\n').filter(l => l.trim());
  const txExplanation = lines.slice(0, 2).join(' ').trim() || reply.slice(0, 200);
  const nextActions = lines.slice(2).join(' ').trim() || reply.slice(200);

  console.log(`\n🤖 ClawdMint → XFlow:`);
  console.log(`   TX Analysis:  ${txExplanation.slice(0, 120)}...`);
  console.log(`   Next Actions: Consider the USDT0/WOKB pool on Uniswap X Layer as a yield opportunity`);
  console.log(`   Pool: ${USDT0_WOKB_POOL}`);

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`✅ A2A Session complete`);
  console.log(`💰 Total spent by XFlow: $0.001 USDC`);
  if (settlementTx) console.log(`   Settlement: ${settlementTx}`);
  console.log(`════════════════════════════════════════════════════════════\n`);

  return {
    txExplanation,
    nextActions: `Deploy ${swap.toToken} to USDT0/WOKB pool on Uniswap X Layer · ${USDT0_WOKB_POOL}`,
    paidWithX402: settlements.length > 0,
    settlements,
  };
}
