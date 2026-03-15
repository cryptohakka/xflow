# XFlow

**AI Agent Payment Infrastructure on X Layer**

XFlow is a multi-agent system that enables AI agents to autonomously execute DeFi operations using x402 micropayments. Any agent holding USDC on any supported chain can pay and access XFlow's swap pipeline — no API keys, no subscriptions.

## Architecture

```
External Agent / User
        │
        │  x402 payment (any chain: Base / Polygon / Avalanche / X Layer)
        ▼
┌─────────────────────────┐
│   Smart Payment Router   │  ← Auto-selects cheapest chain by gas cost
│   x402 Payment Adapter   │  ← Handles 402 handshake
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      Orchestrator        │  ← LLM-powered intent parsing (Claude Haiku)
└────────────┬────────────┘
             │
     ┌───────┴───────┐
     ▼               ▼
┌─────────┐   ┌─────────────┐
│  Risk   │   │  DEX Agent  │  ← OKX DEX Aggregator API
│  Agent  │   │             │  ← Generates unsigned swap TX
└────┬────┘   └──────┬──────┘
     │               │
     └───────┬───────┘
             ▼
┌─────────────────────────┐
│    Analytics Agent       │  ← Records swap onchain (X Layer)
└─────────────────────────┘
             │
             ▼
┌─────────────────────────┐
│      Dashboard           │  ← Real-time visualization
│  (XFlowAnalytics.sol)    │  ← Deployed on X Layer
└─────────────────────────┘
```

## Key Features

- **Smart Payment Router** — Checks USDC balances across all supported chains, selects the cheapest chain by gas cost (USD-denominated)
- **x402 Payment Adapter** — Any x402-compatible agent can call XFlow regardless of which chain they hold USDC on
- **LLM Intent Parsing** — Natural language → structured swap parameters via Claude Haiku
- **Risk Agent** — Evaluates price impact, amount size, and route quality before execution
- **DEX Agent** — Fetches unsigned swap TX data from OKX DEX Aggregator on X Layer
- **Analytics Agent** — Records every swap onchain via `XFlowAnalytics.sol` deployed on X Layer
- **Real-time Dashboard** — Visualizes agent activity, payment chains, and DEX routes

## Supported Payment Networks (x402)

| Chain | Network ID | USDC |
|-------|-----------|------|
| X Layer | `eip155:196` | `0x74b7...d22` |
| Base | `eip155:8453` | `0x8335...913` |
| Polygon | `eip155:137` | `0x3c49...359` |
| Avalanche | `eip155:43114` | `0xB97E...6E` |

## Onchain Contracts (X Layer)

| Contract | Address |
|----------|---------|
| XFlowAnalytics | `0xf88A47a15fAa310E11c67568ef934141880d473e` |

## Quick Start

### 1. Run XFlow Server

```bash
git clone https://github.com/cryptohakka/xflow
cd xflow
cp .env.example .env
# Fill in PRIVATE_KEY, OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, ANTHROPIC_API_KEY
docker compose up -d
```

### 2. Call XFlow as an Agent (Smart Payment Router)

```typescript
import { createSmartPaymentFetch } from './src/smartPaymentRouter.js';

// Automatically selects cheapest chain with sufficient USDC
const { fetchWithPayment, selectedNetwork } = await createSmartPaymentFetch(PRIVATE_KEY);

const res = await fetchWithPayment('http://localhost:3010/swap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'swap 1 USDC to OKB',
    userAddress: '0x...',
  }),
});

const data = await res.json();
// data.result.data.result.tx → unsigned swap TX ready to sign & send
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

## API

### `POST /swap` (x402 protected)

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
      },
      "analyticsTx": "0x..."
    }
  }
}
```

### `GET /dashboard` (free)

Returns real-time analytics data from `XFlowAnalytics.sol`.

### `GET /health` (free)

```json
{ "status": "ok", "service": "XFlow", "version": "0.1.0" }
```

## Pipeline Flow

```
1. Agent sends natural language swap request + x402 payment
2. Smart Payment Router selects cheapest chain automatically
3. Orchestrator parses intent with Claude Haiku
4. Risk Agent evaluates price impact & slippage
5. DEX Agent fetches unsigned TX from OKX DEX Aggregator (X Layer)
6. Analytics Agent records swap onchain (XFlowAnalytics.sol, X Layer)
7. Agent receives unsigned TX → signs → broadcasts on X Layer
```

## Environment Variables

```bash
PRIVATE_KEY=0x...           # Wallet private key
OKX_API_KEY=                # OKX Web3 Developer Portal
OKX_SECRET_KEY=             # OKX Web3 Developer Portal
OKX_PASSPHRASE=             # OKX Web3 Developer Portal
OPENROUTER_API_KEY=         # Gemini 2.5 flash lite for intent parsing
ANALYTICS_CONTRACT=0xf88A47a15fAa310E11c67568ef934141880d473e
PAYEE_ADDRESS=0x...         # x402 payment recipient
PORT=3010
```

## Built With

- [x402 Protocol](https://x402.org) — HTTP-native micropayments
- [OKX DEX Aggregator](https://web3.okx.com) — Best swap routes on X Layer
- [payai facilitator](https://facilitator.payai.network) — x402 settlement
- [X Layer](https://www.okx.com/xlayer) — EVM chain by OKX (eip155:196)
- [Anthropic Claude](https://anthropic.com) — LLM intent parsing
- [viem](https://viem.sh) — EVM interactions

## License

MIT
