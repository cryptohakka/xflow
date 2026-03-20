/**
 * XFlow Orchestrator
 * LLM-powered intent parsing + agent routing
 */
import { handleDexQuery, getSwapQuote } from './dexAgent.js';
import { resolveToken, getAvailableTokens } from './tokenResolver.js';
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
    const tokens = await getAvailableTokens();
    const tokenList = tokens.join('|');
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

Rules:
- fromToken = the token being SOLD/SENT (appears right after "swap")
- toToken = the token being BOUGHT/RECEIVED (appears after "to")
- Example: "swap 1 WETH to USDC" → fromToken=WETH, toToken=USDC

Return: {"action":"swap"|"quote"|"unknown","fromToken":"${tokenList}"|null,"toToken":"${tokenList}"|null,"amount":"number as string"|null}

Supported tokens on X Layer: ${tokenList}`,
        }],
      }),
    });
    const data = await res.json() as any;
    const text = data.choices[0].message.content.trim();
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned);
  } catch {
    // fallback to keyword matching
    const isSwap = /swap|buy|sell|trade/i.test(query);
    const amountMatch = query.match(/[\d.]+/);
    const swapMatch = query.match(/swap\s+[\d.]+\s+(\w+)\s+to\s+(\w+)/i);
    return {
      action: isSwap ? 'swap' : 'quote',
      fromToken: swapMatch?.[1]?.toUpperCase() || 'USDC',
      toToken: swapMatch?.[2]?.toUpperCase() || 'WOKB',
      amount: amountMatch?.[0] || '1.0',
    };
  }
}

export interface OrchestratorOptions {
  privateKey: `0x${string}`;
  preferredNetwork?: string;
  userAddress?: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
}

export async function orchestrate(query: string, options: OrchestratorOptions) {
  const { preferredNetwork = 'eip155:196', userAddress, fromTokenAddress, toTokenAddress } = options;

  // Step 1: LLMでintent解析
  console.log(`🧠 Orchestrator parsing intent...`);
  const intent = await parseIntent(query);
  console.log(`   Parsed:`, JSON.stringify(intent));

  if (intent.action === 'unknown') {
    return { intent, network: preferredNetwork, transaction: '', data: { status: 'unrecognized intent' } };
  }

  // Step 2: トークンアドレス解決
  // fromTokenAddress/toTokenAddressが直接指定されていればLLM解析のfromToken/toTokenを無視
  const fromResolved = await resolveToken(fromTokenAddress || intent.fromToken || 'USDC');
  const toResolved = await resolveToken(toTokenAddress || intent.toToken || 'WOKB');
  // アドレスが直接指定された場合はそのシンボルを優先
  const fromSymbol = fromTokenAddress?.length
    ? (fromResolved.symbol || 'TOKEN')
    : (intent.fromToken || 'USDC');
  const toSymbol = toTokenAddress?.length
    ? (toResolved.symbol || 'TOKEN')
    : (intent.toToken || 'WOKB');

  console.log(`🔍 Tokens: ${fromSymbol}(${fromResolved.address?.slice(0,8)}...) → ${toSymbol}(${toResolved.address?.slice(0,8)}...)`);

  if (!fromResolved.address || !toResolved.address) {
    const missing = [];
    if (!fromResolved.address) missing.push(fromSymbol);
    if (!toResolved.address) missing.push(toSymbol);
    const available = await getAvailableTokens();
    return {
      intent, network: preferredNetwork, transaction: '',
      data: {
        status: 'token_not_found',
        message: `Token(s) not found on X Layer: ${missing.join(', ')}`,
        suggestion: 'Please provide tokenContractAddress or use availableTokens',
        availableTokens: available,
      }
    };
  }

  console.log(`🔍 Resolved: ${fromSymbol}=${fromResolved.source}(${fromResolved.address?.slice(0,8)}), ${toSymbol}=${toResolved.source}(${toResolved.address?.slice(0,8)})`);

  // Step 3: quoteを取得してrisk評価
  console.log(`📊 Getting quote for risk evaluation... ${fromSymbol} → ${toSymbol}`);
  const quote = await getSwapQuote({
    fromToken: fromSymbol,
    toToken: toSymbol,
    amount: intent.amount || '1.0',
    userAddress: userAddress || '0x0000000000000000000000000000000000000001',
    fromTokenAddress: fromResolved.address || undefined,
    toTokenAddress: toResolved.address || undefined,
    fromTokenSymbol: fromResolved.symbol || fromSymbol,
  });

  // Step 4: Risk Agent
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

  // Step 5: DEX Agent
  const result = await handleDexQuery(query, userAddress, quote);

  return {
    intent,
    network: preferredNetwork,
    transaction: '',
    data: {
      status: 'approved', risk, quote, result,
      confirmEndpoint: '/confirm',
    },
  };
}
