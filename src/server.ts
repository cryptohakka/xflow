#!/usr/bin/env node
/**
 * XFlow Server
 * x402-protected HTTP endpoint for multi-agent swap pipeline
 */
import 'dotenv/config';
import express, { Request, Response } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { orchestrate } from './orchestrator.js';

const app = express();
app.use(express.json());

// ── x402 setup ────────────────────────────────────────────────
const PAYEE_ADDRESS = process.env.PAYEE_ADDRESS || '0x191c78ad59cc4fd59155c351c08c06c0e794b0b1';

const facilitator = new HTTPFacilitatorClient({ url: 'https://facilitator.payai.network' });
const evmScheme = new ExactEvmScheme();

const x402Server = new x402ResourceServer(facilitator, {
  url: `http://localhost:${process.env.PORT || 3010}/swap`
})
  .register('eip155:196', evmScheme)
  .register('eip155:8453', evmScheme)
  .register('eip155:137', evmScheme)
  .register('eip155:43114', evmScheme);

const USDC_ADDRESSES: Record<string, string> = {
  'eip155:196':  '0x74b7f16337b8972027f6196a17a631ac6de26d22', // X Layer
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
  'eip155:137':  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Polygon
  'eip155:43114': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche
};
const USDC_EIP712: Record<string, { name: string; version: string }> = {
  'eip155:196':  { name: 'USD Coin', version: '2' },
  'eip155:8453': { name: 'USD Coin', version: '2' },
  'eip155:137':  { name: 'USD Coin', version: '2' },
  'eip155:43114': { name: 'USD Coin', version: '2' },
};

const NETWORKS = ['eip155:196', 'eip155:8453', 'eip155:137', 'eip155:43114'];

const paymentConfig = {
  'POST /swap': {
    accepts: NETWORKS.map(network => ({
      scheme: 'exact',
      network,
      price: { amount: '1000', asset: USDC_ADDRESSES[network], extra: USDC_EIP712[network] },
      payTo: PAYEE_ADDRESS,
      asset: USDC_ADDRESSES[network],
      extra: USDC_EIP712[network],
    })),
    description: 'XFlow - AI-powered DEX swap on X Layer',
    mimeType: 'application/json',
    resource: `http://localhost:${process.env.PORT || 3010}/swap`,
  },
};

app.use(paymentMiddleware(paymentConfig, x402Server, undefined, undefined, false));

// ── Routes ────────────────────────────────────────────────────

// Health check (free)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'XFlow', version: '0.1.0' });
});

// Main swap endpoint (x402 protected)
app.post('/swap', async (req: Request, res: Response) => {
  const { query, userAddress } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    const result = await orchestrate(query, {
      privateKey,
      preferredNetwork: 'eip155:196',
      userAddress,
    });
    res.json({ success: true, result });
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
    console.log(`   POST /swap  — x402 protected (0.001 USDC · X Layer/Base/Polygon)`);
    console.log(`   GET  /health — free\n`);
  });
})();
