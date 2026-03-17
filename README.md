# XFlow

**AI Agent Payment Infrastructure on X Layer**

XFlow is a multi-agent system that enables AI agents to autonomously execute DeFi operations using x402 micropayments. Any agent holding USDC on any supported chain can pay and access XFlow's swap pipeline — no API keys, no subscriptions, pay only what you use.

## Architecture

```
External Agent / User
        │
        │  x402 payment (any chain: Base / Polygon / Avalanche / X Layer)
        ▼
┌─────────────────────────┐
│   Smart Payment Router  │  ← Auto-selects cheapest chain by gas cost (USD)
│   x402 Payment Adapter  │  ← Handles 402 handshake automatically
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      Orchestrator       │  ← LLM-powered intent parsing (Gemini 2.5 Flash Lite)
└────────────┬────────────┘
             │
     ┌───────┴───────┐
     ▼               ▼
┌─────────┐   ┌─────────────┐
│  Risk   │   │  DEX Agent  │  ← OKX DEX Aggregator API
│  Agent  │   │             │  ← Generates unsigned swap TX on X Layer
└────┬────┘   └──────┬──────┘
     │               │
     └───────┬───────┘
             │
             ▼ (unsigned TX returned to Agent)
             │
    Agent signs & broadcasts on X Layer
             │
             ▼ (POST /confirm with swap txHash)
     ┌───────┴───────────────┐
     ▼                       ▼
┌─────────────────┐   ┌──────────────────────┐
│ Analytics Agent │   │  ClawdMint A2A Agent  │  ← A2A + x402 auto-payment
│ (onchain record)│   │  TX explanation       │  ← Next action suggestions
└────────┬────────┘   └──────────────────────┘
         │
         ▼
┌─────────────────────────┐
│      Dashboard          │  ← Real-time visualization
│  (XFlowAnalytics.sol)   │  ← Deployed on X Layer
│  TX hash explorer links │
│  Cumulative volume      │
└─────────────────────────┘
```

## Key Features

- **Smart Payment Router** — Checks USDC balances across all supported chains, automatically selects the cheapest chain by gas cost (USD-denominated). No need to manually choose which chain to pay from.
- **x402 Payment Adapter** — Any x402-compatible agent can call XFlow regardless of which chain they hold USDC on.
- **LLM Intent Parsing** — Natural language → structured swap parameters via Gemini 2.5 Flash Lite (OpenRouter).
- **Risk Agent** — Evaluates price impact, amount size, and route quality before execution. Rejects HIGH risk swaps automatically.
- **DEX Agent** — Fetches unsigned swap TX data via OKX OnchainOS DEX Aggregator API on X Layer.
- **Analytics Agent** — Records only **successful** swaps onchain via `XFlowAnalytics.sol` deployed on X Layer.
- **ClawdMint A2A** — After each confirmed swap, XFlow autonomously calls ClawdMint via Agent-to-Agent (A2A) protocol with x402 micropayment. Returns TX explanation and next action suggestions.
- **Real-time Dashboard** — Visualizes agent activity, payment chains, DEX routes, cumulative volume, and TX hash explorer links.

## Why XFlow?

> x402 kills subscriptions. Pay only when you use it.

Traditional APIs require API keys, subscriptions, and manual billing. XFlow uses x402 — HTTP-native micropayments where AI agents pay $0.001 per call in USDC, automatically, from whichever chain is cheapest at that moment.

**For AI Agents:**
- No API keys needed
- No subscriptions
- Pay from any chain — SmartPaymentRouter handles the rest
- Full onchain audit trail of every swap
- Post-swap AI analysis via ClawdMint A2A (agent pays agent, automatically)

## Agent-to-Agent (A2A) + x402

XFlow demonstrates the full agentic payment stack: not just human→agent payments, but **agent→agent payments**.

After a successful swap, XFlow automatically:
1. Calls ClawdMint's A2A endpoint
2. Pays for the analysis using x402 (USDC micropayment, no human involved)
3. Returns TX explanation and suggested next actions to the caller

This is the core loop of the AI agent economy — agents autonomously paying other agents for services, settled onchain, with no human in the loop.

## How XFlow Compares

| | Traditional API | Bridge + DEX | XFlow |
|--|--|--|--|
| **Payment** | Credit card / subscription | Manual onchain TX | x402 micropayment ($0.001) |
| **Chain flexibility** | Single chain | Bridge required (5-30 min) | Any chain, instant |
| **Gas required** | No | Yes | No (gasless via facilitator) |
| **For AI Agents** | API keys needed | Complex multi-step | Single HTTP request |
| **Automation** | Possible | Difficult | Native |
| **Cost** | Fixed monthly | Bridge fee + gas | Pay per use |
| **Audit trail** | Centralized logs | Onchain | Onchain (X Layer) |
| **Agent→Agent** | Not supported | Not supported | Native (A2A + x402) |

### The Key Insight

> Before XFlow: To use a service on X Layer, you needed X Layer USDC + X Layer gas.
>
> With XFlow: You need USDC on **any** supported chain. XFlow's Smart Payment Router finds the cheapest chain automatically — no bridging, no gas tokens, no manual steps.

**Example:**
```
Without XFlow:
1. Check which chain the service accepts
2. Bridge USDC to that chain (wait 5-30 min, pay bridge fee)
3. Get gas token for that chain
4. Finally call the service

With XFlow:
1. Call the service → Smart Payment Router handles everything
```

This is what makes XFlow native to the agentic era — AI agents don't have time to manage bridge delays or gas tokens across 10 chains.

## Supported Payment Networks (x402)

| Chain | Network ID | USDC Address |
|-------|-----------|------|
| X Layer | `eip155:196` | `0x74b7f16337b8972027f6196a17a631ac6de26d22` |
| Base | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Polygon | `eip155:137` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Avalanche | `eip155:43114` | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |

## Onchain Contracts (X Layer)

| Contract | Address | Explorer |
|----------|---------|---------|
| XFlowAnalytics | `0xf88A47a15fAa310E11c67568ef934141880d473e` | [View](https://www.okx.com/web3/explorer/xlayer/address/0xf88A47a15fAa310E11c67568ef934141880d473e) |

## Quick Start

### 1. Run XFlow Server

```bash
git clone https://github.com/cryptohakka/xflow
cd xflow
cp .env.example .env
# Fill in PRIVATE_KEY, OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, OPENROUTER_API_KEY
docker compose up -d
```

### 2. Call XFlow as an Agent (Smart Payment Router)

```typescript
import { createSmartPaymentFetch } from './src/smartPaymentRouter.js';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Step 1: Auto-selects cheapest chain with sufficient USDC balance
const { fetchWithPayment } = await createSmartPaymentFetch(PRIVATE_KEY);

const res = await fetchWithPayment('http://localhost:3010/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'swap 1 USDC to OKB',
    userAddress: '0x...',
  }),
});

const data = await res.json();
const tx = data.result.data.result.tx;

// Step 2: Agent signs & broadcasts the unsigned TX
const walletClient = createWalletClient({ ... });
const swapHash = await walletClient.sendTransaction({
  to: tx.to, data: tx.data,
  gas: BigInt(tx.gas),
  gasPrice: BigInt(tx.gasPrice),
  chainId: 196,
});

// Step 3: Confirm successful swap (triggers Analytics + ClawdMint A2A)
const confirm = await fetch('http://localhost:3010/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    txHash: swapHash,
    fromToken: 'USDC', toToken: 'WOKB',
    fromAmount: '1.0', toAmount: '0.010417',
    paymentNetwork: 'eip155:43114',
    route: 'Uniswap V3',
    riskLevel: 'LOW',
    agentAddress: '0x...',
  }),
});

const result = await confirm.json();
// result.clawdmint.txExplanation  — AI explanation of the swap TX
// result.clawdmint.nextActions    — suggested follow-up actions
```

### 3. Manual x402 Payment (specific chain)

```typescript
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(PRIVATE_KEY);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:196', client: new ExactEvmScheme(account) }],
});

const res = await fetchWithPayment('http://localhost:3010/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'swap 0.01 USDC to OKB', userAddress: '0x...' }),
});
```

## API Reference

### `POST /swap` (x402 protected · $0.001 USDC)

Request:
```json
{
  "query": "swap 1 USDC to OKB",
  "userAddress": "0x..."
}
```

Response:
```json
{
  "success": true,
  "result": {
    "intent": { "action": "swap", "fromToken": "USDC", "toToken": "WOKB", "amount": "1" },
    "data": {
      "status": "approved",
      "risk": { "riskLevel": "LOW", "riskScore": 5, "approved": true },
      "quote": { "fromAmount": "1", "toAmount": "0.010417", "route": "Uniswap V3" },
      "result": {
        "tx": {
          "to": "0xD1b8...",
          "data": "0x...",
          "gas": "930231",
          "gasPrice": "20000001",
          "chainId": 196
        },
        "note": "Sign and send this TX to execute the swap on X Layer"
      }
    }
  }
}
```

### `POST /confirm` (free · call after successful swap)

Records the swap onchain and triggers ClawdMint A2A analysis automatically.

Request:
```json
{
  "txHash": "0x...",
  "fromToken": "USDC",
  "toToken": "WOKB",
  "fromAmount": "1.0",
  "toAmount": "0.010417",
  "paymentNetwork": "eip155:43114",
  "route": "Uniswap V3",
  "riskLevel": "LOW",
  "agentAddress": "0x..."
}
```

Response:
```json
{
  "success": true,
  "analyticsTx": "0x...",
  "clawdmint": {
    "txExplanation": "Swapped 1 USDC for 0.010417 WOKB via Uniswap V3 on X Layer...",
    "nextActions": ["Monitor WOKB price", "Consider DCA strategy"],
    "paidWithX402": true,
    "settlements": [...],
    "note": "Powered by ClawdMint via A2A + x402"
  }
}
```

### `GET /dashboard` (free)

Returns real-time analytics from `XFlowAnalytics.sol`, including cumulative volume and TX hashes.

### `GET /health` (free)

```json
{ "status": "ok", "service": "XFlow", "version": "0.1.0" }
```

## Pipeline Flow

```
1.  Agent sends natural language swap request + x402 payment ($0.001 USDC)
2.  Smart Payment Router checks USDC balances across 4 chains
3.  Cheapest chain selected by gas cost (USD-denominated)
4.  x402 payment settled by payai facilitator
5.  Orchestrator parses intent with Gemini 2.5 Flash Lite
6.  Risk Agent evaluates price impact & slippage → approves or rejects
7.  DEX Agent fetches unsigned swap TX via OKX OnchainOS DEX Aggregator on X Layer
8.  Agent receives unsigned TX → signs & broadcasts on X Layer
9.  On success: Agent calls POST /confirm
10. Analytics Agent records swap onchain (XFlowAnalytics.sol, X Layer)
11. ClawdMint A2A Agent analyzes TX via A2A + x402 (agent pays agent)
12. Dashboard reflects new swap: TX hash explorer link + cumulative volume update
```

## Environment Variables

```bash
PRIVATE_KEY=0x...
OKX_API_KEY=                # OKX Web3 Developer Portal
OKX_SECRET_KEY=
OKX_PASSPHRASE=
OPENROUTER_API_KEY=         # Gemini 2.5 Flash Lite via OpenRouter
ANALYTICS_CONTRACT=0xf88A47a15fAa310E11c67568ef934141880d473e
PAYEE_ADDRESS=0x...         # x402 payment recipient
PORT=3010
```

## Roadmap

- [ ] Additional token pairs on X Layer (ETH, BTC, USDT)
- [ ] More supported payment chains (SKALE Base, Abstract)
- [ ] Volume-based pricing (high-frequency agents get discounts)
- [ ] Multi-chain aggregated payment (split payment across chains)
- [ ] Agent SDK package (`npm install xflow-sdk`)

## Built With

- [x402 Protocol](https://x402.org) — HTTP-native micropayments
- [OKX DEX Aggregator](https://web3.okx.com) — Best swap routes on X Layer
- [OKX OnchainOS](https://web3.okx.com/onchain-os) — Onchain OS Skills
- [ClawdMint](https://clawdmint.com) — A2A agent with x402 payments
- [payai facilitator](https://facilitator.payai.network) — x402 settlement
- [X Layer](https://www.okx.com/xlayer) — EVM chain by OKX (eip155:196)
- [OpenRouter](https://openrouter.ai/) — LLM gateway (Gemini 2.5 Flash Lite)
- [viem](https://viem.sh) — EVM interactions

## License

MIT
