/**
 * XFlow Orchestrator
 * LLM-powered intent parsing + agent routing
 */
import { handleDexQuery, getSwapQuote } from './dexAgent.js';
import { recordSwapOnchain } from './analyticsAgent.js';
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
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
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
    const text = data.content[0].text.trim();
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
  });

  if (!risk.approved) {
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

  // Step 5: Analytics Agent - record onchain
  let analyticsTx = '';
  try {
    analyticsTx = await recordSwapOnchain({
      agentAddress: userAddress || options.privateKey,
      fromToken: quote.fromToken,
      toToken: quote.toToken,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      paymentNetwork: preferredNetwork,
      route: quote.route,
      riskLevel: risk.riskLevel,
    });
  } catch (e: any) {
    console.warn('Analytics recording failed:', e.message);
  }

  return {
    intent,
    network: preferredNetwork,
    transaction: '',
    data: { status: 'approved', risk, quote, result, analyticsTx },
  };
}
