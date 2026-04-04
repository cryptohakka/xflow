/**
 * XFlow Orchestrator
 * LLM-powered intent parsing + agent routing
 */
import { handleDexQuery, getSwapQuote, selectBestRoute } from './dexAgent.js';
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

async function parseIntent(query: string, chainId: number): Promise<ParsedIntent> {
  try {
    const tokens = await getAvailableTokens(chainId);
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

Supported tokens on chain ${chainId}: ${tokenList}`,
        }],
      }),
    });
    const data = await res.json() as any;
    const text = data.choices[0].message.content.trim();
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const isSwap = /swap|buy|sell|trade/i.test(query);
    const amountMatch = query.match(/[\d.]+/);
    const swapMatch = query.match(/swap\s+[\d.]+\s+(\w+)\s+to\s+(\w+)/i);
    return {
      action: isSwap ? 'swap' : 'quote',
      fromToken: swapMatch?.[1]?.toUpperCase() || 'USDC',
      toToken: swapMatch?.[2]?.toUpperCase() || 'WETH',
      amount: amountMatch?.[0] || '1.0',
    };
  }
}

export interface OrchestratorOptions {
  parsedIntent?: ParsedIntent;
  privateKey: `0x${string}`;
  preferredNetwork?: string;
  userAddress?: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
  quoteOnly?: boolean;
  chainId?: number;
  permit2Signature?: string;
  uniswapRawQuote?: any; // pass from /swap to skip re-fetching
}

export async function orchestrate(query: string, options: OrchestratorOptions) {
  const {
    preferredNetwork = 'eip155:196',
    userAddress,
    fromTokenAddress,
    toTokenAddress,
    quoteOnly = false,
    chainId = 196,
    permit2Signature,
    uniswapRawQuote: passedRawQuote,
  } = options;

  // Step 1: Parse intent
  console.log(`🧠 Orchestrator parsing intent... (chain ${chainId})`);
  const intent = options.parsedIntent || await parseIntent(query, chainId);
  console.log(`   Parsed:`, JSON.stringify(intent));

  if (intent.action === 'unknown') {
    return { intent, network: preferredNetwork, transaction: '', data: { status: 'unrecognized intent' } };
  }

  // Step 2: Resolve token addresses (chain-aware)
  const fromResolved = await resolveToken(fromTokenAddress || intent.fromToken || 'USDC', chainId);
  const toResolved   = await resolveToken(toTokenAddress   || intent.toToken   || 'WETH', chainId);
  const fromSymbol = fromTokenAddress?.length ? (fromResolved.symbol || 'TOKEN') : (intent.fromToken || 'USDC');
  const toSymbol   = toTokenAddress?.length   ? (toResolved.symbol   || 'TOKEN') : (intent.toToken   || 'WETH');

  console.log(`🔍 Tokens: ${fromSymbol}(${fromResolved.address?.slice(0,8)}...) → ${toSymbol}(${toResolved.address?.slice(0,8)}...)`);

  if (!fromResolved.address || !toResolved.address) {
    const missing = [];
    if (!fromResolved.address) missing.push(fromSymbol);
    if (!toResolved.address)   missing.push(toSymbol);
    const available = await getAvailableTokens(chainId);
    return {
      intent, network: preferredNetwork, transaction: '',
      data: {
        status: 'token_not_found',
        message: `Token(s) not found on chain ${chainId}: ${missing.join(', ')}`,
        suggestion: 'Please provide tokenContractAddress or use availableTokens',
        availableTokens: available,
      },
    };
  }

  console.log(`🔍 Resolved: ${fromSymbol}=${fromResolved.source}(${fromResolved.address?.slice(0,8)}), ${toSymbol}=${toResolved.source}(${toResolved.address?.slice(0,8)})`);

  // Step 3: Quote + route decision
  let quote: any;
  let routeDecision: any = null;
  let uniswapRawQuote: any = passedRawQuote ?? null;

  if (passedRawQuote) {
    // rawQuote passed from /swap — skip re-fetching, reconstruct quote/decision
    console.log(`♻️  Reusing rawQuote from /swap (chain ${chainId})`);
    const toAmount = parseInt(passedRawQuote?.quote?.output?.amount || '0') / 1e6;
    const rawImpact = parseFloat(passedRawQuote?.quote?.priceImpact || '0');
    quote = {
      fromToken:        fromSymbol,
      toToken:          toSymbol,
      fromAmount:       intent.amount || '1.0',
      toAmount:         toAmount.toFixed(6),
      route:            'Uniswap V3',
      priceImpact:      `${(rawImpact * 100).toFixed(4)}%`,
      estimateGasFee:   '0',
      isHoneyPot:       false,
      taxRate:          '0',
      toTokenUnitPrice: '0',
      fromTokenAddress: fromResolved.address,
      toTokenAddress:   toResolved.address,
      chainId,
    };
    routeDecision = {
      selected: 'Uniswap',
      okx: null,
      uniswap: { route: 'Uniswap', toAmount, totalScore: 1, reason: 'rawQuote reused' },
      reason: 'rawQuote reused from /swap',
    };
  } else {
    console.log(`📊 Getting quote + route decision... ${fromSymbol} → ${toSymbol} (chain ${chainId})`);
    try {
      const { quote: bestQuote, decision, uniswapRawQuote: rawQ } = await selectBestRoute({
        fromToken: fromSymbol,
        toToken:   toSymbol,
        amount:    intent.amount || '1.0',
        userAddress: userAddress || '0x0000000000000000000000000000000000000001',
        fromTokenAddress: fromResolved.address || undefined,
        toTokenAddress:   toResolved.address   || undefined,
        fromTokenSymbol:  fromResolved.symbol  || fromSymbol,
        chainId,
      });
      quote           = bestQuote;
      routeDecision   = decision;
      uniswapRawQuote = rawQ ?? null;
      console.log(`🏆 Route: ${decision.selected} · liq $${(decision.liquidityUSD || 0).toFixed(0)} · ${decision.reason}`);
    } catch (e: any) {
      console.warn(`⚠️  selectBestRoute failed (${e.message}), falling back to OKX quote`);
      quote = await getSwapQuote({
        fromToken: fromSymbol,
        toToken:   toSymbol,
        amount:    intent.amount || '1.0',
        userAddress: userAddress || '0x0000000000000000000000000000000000000001',
        fromTokenAddress: fromResolved.address || undefined,
        toTokenAddress:   toResolved.address   || undefined,
        fromTokenSymbol:  fromResolved.symbol  || fromSymbol,
        chainId,
      });
    }
  }

  // Step 4: Risk Agent
  const risk = await handleRiskCheck({
    fromToken:        quote.fromToken,
    toToken:          quote.toToken,
    amount:           quote.fromAmount,
    priceImpact:      quote.priceImpact,
    estimateGasFee:   quote.estimateGasFee,
    route:            quote.route,
    isHoneyPot:       (quote as any).isHoneyPot,
    taxRate:          (quote as any).taxRate,
    toTokenUnitPrice: (quote as any).toTokenUnitPrice,
  });

  if (!risk.approved) {
    try {
      await recordFailedSwapOnchain({
        agentAddress: userAddress || '0x0000000000000000000000000000000000000000',
        fromToken:    quote.fromToken,
        toToken:      quote.toToken,
        fromAmount:   quote.fromAmount,
        reason:       'risk_rejected',
        paymentNetwork: preferredNetwork,
      });
    } catch (e: any) {
      console.warn('Failed to record rejection:', e.message);
    }
    return {
      intent,
      network: preferredNetwork,
      transaction: '',
      data: { status: 'rejected', risk, quote, routeDecision },
    };
  }

  if (quoteOnly) {
    console.log(`✅ Quote+Risk approved · skipping TX generation (quoteOnly mode)`);
    return {
      intent,
      network: preferredNetwork,
      transaction: '',
      data: {
        status: 'approved',
        risk,
        quote,
        routeDecision,
        permitData:      uniswapRawQuote?.permitData ?? null,
        uniswapRawQuote: uniswapRawQuote ?? null,
        result: null,
        confirmEndpoint: '/confirm',
        txEndpoint: '/tx',
      },
    };
  }

  await new Promise(r => setTimeout(r, 1100));

  // Step 5: DEX Agent (generate TX data)
  let result: any;

  if (routeDecision?.selected === 'Uniswap' && uniswapRawQuote && userAddress) {
    console.log(`🦄 Generating Uniswap TX... (signature: ${permit2Signature ? 'provided' : 'none'})`);
    try {
      const { getUniswapSwapTx } = await import('./dex/integrations/uniswap.js');
      const uniTx = await getUniswapSwapTx(chainId, uniswapRawQuote, userAddress, permit2Signature);
      if (uniTx) {
        result = {
          fromToken:  quote.fromToken,
          toToken:    quote.toToken,
          fromAmount: quote.fromAmount,
          toAmount:   quote.toAmount,
          tx: uniTx,
          note: 'Sign and send this TX with your wallet to execute the swap via Uniswap',
        };
      } else {
        console.warn('⚠️  Uniswap TX generation failed, falling back to OKX TX');
        result = await handleDexQuery(query, userAddress, quote);
      }
    } catch (e: any) {
      console.warn(`⚠️  Uniswap TX error (${e.message}), falling back to OKX TX`);
      result = await handleDexQuery(query, userAddress, quote);
    }
  } else {
    result = await handleDexQuery(query, userAddress, quote);
  }

  return {
    intent,
    network: preferredNetwork,
    transaction: '',
    data: {
      status: 'approved',
      risk,
      quote,
      routeDecision,
      result,
      confirmEndpoint: '/confirm',
    },
  };
}
