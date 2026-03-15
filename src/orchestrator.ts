/**
 * XFlow Orchestrator
 * LLM-powered intent parsing + agent routing
 */
import { handleDexQuery, getSwapQuote } from './dexAgent.js';
import { recordFailedSwapOnchain } from './analyticsAgent.js';
import { handleRiskCheck } from './riskAgent.js';

export type AgentType = 'dex' | 'unknown';

export interface ParsedIntent {
  action: 'swap' | 'quote' | 'unknown';
  fromToken?: string;
  toToken?: string;
  amount?: string;
  userAddress?: string;
}

/**
 * LLMでクエリを構造化
 */
async function parseIntent(query: string): Promise<ParsedIntent> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY || ''}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Parse this DeFi swap request and return JSON only, no explanation:
"${query}"

Return: {"action":"swap"|"quote"|"unknown","fromToken":"USDC"|"WOKB"|"OKB"|null,"toToken":"USDC"|"WOKB"|"OKB"|null,"amount":"number as string"|null}

Supported tokens on X Layer: USDC, WOKB, OKB (WOKB=OKB)`
        }],
      }),
    });
    const data = await res.json() as any;
    const text = data.choices[0].message.content.trim();
    return JSON.parse(text);
  } catch {
    // fallback to keyword matching
    const isSwap = /swap|buy|sell|trade/i.test(query);
    const okbToUsdc = /okb.*usdc|wokb.*usdc/i.test(query);
    const amountMatch = query.match(/[\d.]+/);
    return {
      action: isSwap ? 'swap' : 'quote',
      fromToken: okbToUsdc ? 'WOKB' : 'USDC',
      toToken: okbToUsdc ? 'USDC' : 'WOKB',
      amount: amountMatch?.[0] || '1.0',
    };
  }
}

export interface OrchestratorOptions {
  privateKey: `0x${string}`;
  preferredNetwork?: string;
  userAddress?: string;
}

export async function orchestrate(query: string, options: OrchestratorOptions) {
  const { preferredNetwork = 'eip155:196', userAddress } = options;

  // Step 1: LLMでintent解析
  console.log(`🧠 Orchestrator parsing intent...`);
  const intent = await parseIntent(query);
  console.log(`   Parsed:`, JSON.stringify(intent));

  if (intent.action === 'unknown') {
    return { intent, network: preferredNetwork, transaction: '', data: { status: 'unrecognized intent' } };
  }

  // Step 2: まずquoteを取得してrisk評価
  console.log(`📊 Getting quote for risk evaluation...`);
  const quote = await getSwapQuote({
    fromToken: intent.fromToken || 'USDC',
    toToken: intent.toToken || 'WOKB',
    amount: intent.amount || '1.0',
    userAddress: userAddress || '0x0000000000000000000000000000000000000001',
  });

  // Step 3: Risk Agent
  const risk = await handleRiskCheck({
    fromToken: quote.fromToken,
    toToken: quote.toToken,
    amount: quote.fromAmount,
    priceImpact: quote.priceImpact,
    estimateGasFee: quote.estimateGasFee,
    route: quote.route,
    isHoneyPot: (quote as any).isHoneyPot,
    taxRate: (quote as any).taxRate,
    toTokenUnitPrice: (quote as any).toTokenUnitPrice,
  });

  if (!risk.approved) {
    // Record rejected swap onchain
    try {
      await recordFailedSwapOnchain({
        agentAddress: userAddress || '0x0000000000000000000000000000000000000000',
        fromToken: quote.fromToken,
        toToken: quote.toToken,
        fromAmount: quote.fromAmount,
        reason: 'risk_rejected',
        paymentNetwork: preferredNetwork,
      });
    } catch (e: any) {
      console.warn('Failed to record rejection:', e.message);
    }
    return {
      intent,
      network: preferredNetwork,
      transaction: '',
      data: { status: 'rejected', risk, quote },
    };
  }

  // Rate limit: 1 req/sec
  await new Promise(r => setTimeout(r, 1100));

  // Step 4: DEX Agent
  const result = await handleDexQuery(query, userAddress, quote);

  return {
    intent,
    network: preferredNetwork,
    transaction: '',
    data: {
      status: 'approved', risk, quote, result,
      // Call POST /confirm with swap txHash after successful broadcast
      confirmEndpoint: '/confirm',
    },
  };
}
