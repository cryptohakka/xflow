#!/usr/bin/env node
/**
 * XFlow Server
 * x402-protected HTTP endpoint for multi-agent swap pipeline
 */
import 'dotenv/config';
import { explorerLink } from './utils.js';
import express, { Request, Response } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { paymentMiddleware, x402ResourceServer } from '@x402/express';

import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { orchestrate } from './orchestrator.js';

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Decision Latency tracker ──────────────────────────────────
const decisionLatencyMs: number[] = [];
function recordLatency(ms: number) {
  decisionLatencyMs.push(ms);
  if (decisionLatencyMs.length > 20) decisionLatencyMs.shift();
}
function avgLatencyMs(): number | null {
  if (decisionLatencyMs.length === 0) return null;
  return Math.round(decisionLatencyMs.reduce((a, b) => a + b, 0) / decisionLatencyMs.length);
}

// ── Gas Saved tracker ─────────────────────────────────────────
// 毎回「最高ガスチェーン - 実際に選んだチェーン」を積み上げ
let totalGasSavedUSD = 0;
let gasSavedTxCount  = 0;
function recordGasSaved(allBalances: any[], selectedGasCostUSD: number) {
  if (!allBalances?.length) return;
  const maxGas = Math.max(...allBalances.map((b: any) => b.gasCostUSD || 0));
  const saved  = Math.max(0, maxGas - selectedGasCostUSD);
  totalGasSavedUSD += saved;
  gasSavedTxCount++;
}

// ── x402 setup ────────────────────────────────────────────────
const PAYEE_ADDRESS = process.env.PAYEE_ADDRESS || '0x191c78ad59cc4fd59155c351c08c06c0e794b0b1';
const facilitatorClient = new HTTPFacilitatorClient({ url: "http://localhost:3011" });
const evmScheme = new ExactEvmScheme();

const x402Server = new x402ResourceServer(facilitatorClient, {
  url: `http://localhost:${process.env.PORT || 3010}/swap`
})
  .register('eip155:196', evmScheme)
  .register('eip155:8453', evmScheme)
  .register('eip155:137', evmScheme)
  .register('eip155:43114', evmScheme);

const USDC_ADDRESSES: Record<string, string> = {
  'eip155:196':   '0x74b7f16337b8972027f6196a17a631ac6de26d22',
  'eip155:8453':  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:137':   '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  'eip155:43114': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
};
const USDC_EIP712: Record<string, { name: string; version: string }> = {
  'eip155:196':   { name: 'USD Coin', version: '2' },
  'eip155:8453':  { name: 'USD Coin', version: '2' },
  'eip155:137':   { name: 'USD Coin', version: '2' },
  'eip155:43114': { name: 'USD Coin', version: '2' },
};

const NETWORKS = ['eip155:196', 'eip155:8453', 'eip155:137', 'eip155:43114'];

const paymentConfig = {
  'POST /confirm': {
    accepts: NETWORKS.map(network => ({
      scheme: 'exact',
      network,
      price: { amount: '1000', asset: USDC_ADDRESSES[network], extra: USDC_EIP712[network] },
      payTo: PAYEE_ADDRESS,
      asset: USDC_ADDRESSES[network],
      extra: USDC_EIP712[network],
    })),
    description: 'XFlow - Execution fee (successful swap only)',
    mimeType: 'application/json',
    resource: `http://localhost:${process.env.PORT || 3010}/confirm`,
  },
  'POST /swap': {
    accepts: NETWORKS.map(network => ({
      scheme: 'exact',
      network,
      price: { amount: '1000', asset: USDC_ADDRESSES[network], extra: USDC_EIP712[network] },
      payTo: PAYEE_ADDRESS,
      asset: USDC_ADDRESSES[network],
      extra: USDC_EIP712[network],
    })),
    description: 'XFlow - AI-powered DEX swap quote on X Layer',
    mimeType: 'application/json',
    resource: `http://localhost:${process.env.PORT || 3010}/swap`,
  },
};

app.use(paymentMiddleware(paymentConfig, x402Server, undefined, undefined, false));

// ── Routes ────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'XFlow', version: '0.1.0' });
});

app.post('/confirm', async (req: Request, res: Response) => {
  try {
    const {
      txHash, fromToken, toToken, fromAmount, toAmount,
      paymentNetwork, route, riskLevel, agentAddress,
      swapX402TxHash, confirmX402TxHash,
    } = req.body;

    if (!txHash) return res.status(400).json({ error: 'txHash required' });

    // Swap完了ログ
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`✅ Swap complete`);
    console.log(`   Swap: ${fromAmount} ${fromToken} → ${toAmount} ${toToken}`);
    console.log(`   TX:   ${txHash}`);
    console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${txHash}`);
    console.log(`${'─'.repeat(55)}`);

    const { recordSwapOnchain, recordA2ACallOnchain, recordX402PaymentOnchain } = await import('./analyticsAgent.js');

    const analyticsTx = await recordSwapOnchain({
      agentAddress: agentAddress || '0x0000000000000000000000000000000000000000',
      fromToken:      fromToken      || 'USDC',
      toToken:        toToken        || 'USDC',
      fromAmount:     fromAmount     || '0',
      toAmount:       toAmount       || '0',
      paymentNetwork: paymentNetwork || 'unknown',
      route:          route          || 'unknown',
      riskLevel:      riskLevel      || 'LOW',
      txHash:         txHash,
    });

    // X402支払いを記録（fire-and-forget）
    if (swapX402TxHash) {
      await recordX402PaymentOnchain({
        agentAddress: agentAddress || '0x0000000000000000000000000000000000000000',
        endpoint: '/swap',
        feePaid: '0.001',
        paymentNetwork: paymentNetwork || 'unknown',
        paymentTxHash: swapX402TxHash,
      }).catch((e: any) => console.warn('[Confirm] swap X402 record failed:', e.message));
    }
    if (confirmX402TxHash) {
      await recordX402PaymentOnchain({
        agentAddress: agentAddress || '0x0000000000000000000000000000000000000000',
        endpoint: '/confirm',
        feePaid: '0.001',
        paymentNetwork: paymentNetwork || 'unknown',
        paymentTxHash: confirmX402TxHash,
      }).catch((e: any) => console.warn('[Confirm] confirm X402 record failed:', e.message));
    }

    let clawdmint = null;
    try {
      const { analyzeSwapWithClawdMint } = await import('./clawdmintA2A.js');
      const analysis = await analyzeSwapWithClawdMint({
        txHash,
        fromToken:  fromToken  || 'USDC',
        toToken:    toToken    || 'USDC',
        fromAmount: fromAmount || '0',
        toAmount:   toAmount   || '0',
        chainId: 196,
        agentAddress: agentAddress || '0x0000000000000000000000000000000000000000',
      });
      clawdmint = {
        txExplanation: analysis.txExplanation,
        nextActions:   analysis.nextActions,
        paidWithX402:  analysis.paidWithX402,
        settlements:   analysis.settlements,
        note: 'Powered by ClawdMint via A2A + x402',
      };

    } catch (e: any) {
      console.warn('[Confirm] ClawdMint analysis failed:', e.message);
    }

    console.log(`\n🤖 XFlow → Client: Result of ClawdMint analysis`);
    res.json({ success: true, analyticsTx, clawdmint });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const { getDashboardData } = await import('./analyticsAgent.js');
    const data = await getDashboardData();
    // avgDecisionMs はセッション内メモリから取得（オンチェーン不要）
    res.json({ ...data, avgDecisionMs: avgLatencyMs(), totalGasSavedUSD, gasSavedTxCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /swap  (x402 protected) ──────────────────────────────
// Quote + risk評価のみ返す。TX dataは含まない。
// client-agentはこのレスポンスでallowance/approveを判断し、
// broadcast直前に /tx を叩いてfresh TX dataを取得する。
app.post('/swap', async (req: Request, res: Response) => {
  const { query, userAddress, fromTokenAddress, toTokenAddress, _routerMeta } = req.body;

  if (!query) return res.status(400).json({ error: 'query is required' });

  // ── Phase 1: SmartPaymentRouter ──────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('1️⃣  Smart Payment Router');
  console.log('════════════════════════════════════════════════════════════');
  if (_routerMeta?.allBalances) {
    console.log('🔍 Checking USDC balances across networks...');
    _routerMeta.allBalances.forEach((b: any) => {
      console.log(`   ${b.name}: ${b.balance} USDC ${b.sufficient ? '✅' : '❌'} · gas $${b.gasCostUSD?.toFixed(6) || 'n/a'} · ${b.finalitySeconds ?? '?'}s finality · score $${b.score?.toFixed(6) || 'n/a'}`);
    });
  }
  if (_routerMeta?.selectedNetwork) {
    console.log(`💡 Selected: ${_routerMeta.selectedNetwork} · score $${Number(_routerMeta.selectedScore).toFixed(6)}`);
  }
  console.log(`✅ XFlow got paid ($0.001 USDC)`);
  console.log('════════════════════════════════════════════════════════════\n');

  // ── Phase 2: Quote + Risk ────────────────────────────────────
  console.log('2️⃣  Quote + Risk Assessment (X Layer)');
  console.log('════════════════════════════════════════════════════════════');

  try {
    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    const t0 = performance.now();
    const result = await orchestrate(query, {
      privateKey,
      preferredNetwork: 'eip155:196',
      userAddress,
      fromTokenAddress,
      toTokenAddress,
      quoteOnly: true,
    });
    const decisionMs = Math.round(performance.now() - t0);
    recordLatency(decisionMs);
    // Gas saved: max(allBalances.gasCostUSD) - selectedGasCostUSD
    if (_routerMeta?.allBalances && _routerMeta?.selectedGasCostUSD != null) {
      recordGasSaved(_routerMeta.allBalances, _routerMeta.selectedGasCostUSD);
      console.log(`⛽ Gas saved this tx: $${(Math.max(..._routerMeta.allBalances.map((b:any)=>b.gasCostUSD||0)) - _routerMeta.selectedGasCostUSD).toFixed(6)} · total saved: $${totalGasSavedUSD.toFixed(6)}`);
    }
    console.log(`⚡ Decision latency: ${decisionMs}ms`);
    res.json({ success: true, result, intent: result.intent, decisionMs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /analysisReceived  (x402 不要) ─────────────────────────
// ClawdMint分析結果受け取り後にclient-agentが呼ぶ
// /confirmのX402 TXハッシュをここで記録する
app.post('/analysisReceived', async (req: Request, res: Response) => {
  try {
    const { agentAddress, confirmX402TxHash, paymentNetwork } = req.body;
    const { recordX402PaymentOnchain } = await import('./analyticsAgent.js');
    console.log(`✅ XFlow received payment!`);
    if (confirmX402TxHash) console.log(`   TX:${explorerLink(confirmX402TxHash, paymentNetwork || 'base')}`);
    if (confirmX402TxHash) {
      await recordX402PaymentOnchain({
        agentAddress: agentAddress || '0x0000000000000000000000000000000000000000',
        endpoint: '/confirm',
        feePaid: '0.001',
        paymentNetwork: paymentNetwork || 'unknown',
        paymentTxHash: confirmX402TxHash,
      }).catch((e: any) => console.warn('[analysisReceived] X402 record failed:', e.message));
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /tx  (x402 不要 — /swap で支払い済み) ───────────────
// broadcast直前に呼ぶ。fresh TX dataを返す。
app.post('/tx', async (req: Request, res: Response) => {
  const { query, userAddress, fromTokenAddress, toTokenAddress, parsedIntent } = req.body;

  if (!query) return res.status(400).json({ error: 'query is required' });

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🔄 Fresh TX data requested');
  console.log(`   query: "${query}"`);
  console.log('════════════════════════════════════════════════════════════');

  try {
    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    const result = await orchestrate(query, {
      privateKey,
      preferredNetwork: 'eip155:196',
      userAddress,
      fromTokenAddress,
      toTokenAddress,
      quoteOnly: false,
      parsedIntent,
    });

    const tx = result?.data?.result?.tx;
    if (!tx) {
      console.warn('[/tx] No TX data in orchestrate result');
      return res.status(500).json({ error: 'Failed to generate TX data' });
    }

    console.log(`✅ Fresh TX ready · to: ${tx.to}`);
    res.json({ success: true, result, intent: result.intent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3010;

(async () => {
  try {
    await x402Server.initialize();
    console.log('✅ x402 facilitator initialized');
  } catch (e: any) {
    console.warn('⚠️  facilitator init failed:', e.message);
  }

  app.listen(PORT, () => {
    console.log(`\n🌊 XFlow Server running on http://localhost:${PORT}`);
    console.log(`   POST /swap    — x402 protected (0.001 USDC) · quote + risk only`);
    console.log(`   POST /tx      — free · fresh TX data (call right before broadcast)`);
    console.log(`   POST /confirm — x402 protected (0.001 USDC) · swap confirmation`);
    console.log(`   GET  /health  — free\n`);
  });
})();
