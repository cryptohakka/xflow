import { explorerLink } from './utils.js';
/**
 * XFlow Analytics Agent v3
 * Records swap activity + A2A calls + X402 payments onchain on X Layer
 */
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

const xlayer = {
  id: 196, name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } },
} as const;

const ANALYTICS_ABI = parseAbi([
  'function recordSwap(address agent, string fromToken, string toToken, uint256 fromAmount, uint256 toAmount, string paymentNetwork, string route, uint8 riskLevel, string txHash) external',
  'function recordA2ACall(address callerAgent, string externalAgent, string purpose, uint256 feePaid, string paymentNetwork) external',
  'function recordX402Payment(address agent, string endpoint, uint256 feePaid, string paymentNetwork, string paymentTxHash) external',
  'function totalSwaps() view returns (uint256)',
  'function totalVolume() view returns (uint256)',
  'function totalA2ACalls() view returns (uint256)',
  'function totalX402Payments() view returns (uint256)',
  'function totalX402Fees() view returns (uint256)',
  'function getRecentSwaps(uint256 count) view returns ((address agent, string fromToken, string toToken, uint256 fromAmount, uint256 toAmount, string paymentNetwork, string route, uint8 riskLevel, uint256 timestamp, string txHash)[])',
  'function getRecentA2ACalls(uint256 count) view returns ((address callerAgent, string externalAgent, string purpose, uint256 feePaid, string paymentNetwork, uint256 timestamp)[])',
  'function getRecentX402Payments(uint256 count) view returns ((address agent, string endpoint, uint256 feePaid, string paymentNetwork, string paymentTxHash, uint256 timestamp)[])',
  'function externalAgentCallCount(string) view returns (uint256)',
]);

function loadEnv(): Record<string, string> {
  if (process.env.PRIVATE_KEY) return process.env as Record<string, string>;
  try {
    const envPath = '/home/agent/xflow/.env';
    return readFileSync(envPath, 'utf-8')
      .split('\n').reduce((acc, line) => {
        const [k, ...v] = line.split('=');
        if (k && v.length) acc[k.trim()] = v.join('=').trim();
        return acc;
      }, {} as Record<string, string>);
  } catch { return {}; }
}

function getContractAddress(env: Record<string, string>): `0x${string}` {
  return (env.ANALYTICS_CONTRACT || '0xfb7f08ea7e59974a8b3a80898462dd7826e4b93b') as `0x${string}`;
}

// ── SwapAnalyticsInput ─────────────────────────────────────────

export interface SwapAnalyticsInput {
  agentAddress: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  paymentNetwork: string;
  route: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  txHash: string;
}

export async function recordSwapOnchain(input: SwapAnalyticsInput): Promise<string> {
  const env = loadEnv();
  const account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
  const riskLevelMap = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const fromAmountRaw = BigInt(Math.floor(parseFloat(input.fromAmount) * 1e6));
  const toAmountRaw   = BigInt(Math.floor(parseFloat(input.toAmount)   * 1e18));

  console.log(`📊 Analytics Agent: recording swap onchain...`);
  const hash = await walletClient.writeContract({
    address: getContractAddress(env),
    abi: ANALYTICS_ABI,
    functionName: 'recordSwap',
    args: [input.agentAddress as `0x${string}`, input.fromToken, input.toToken, fromAmountRaw, toAmountRaw, input.paymentNetwork, input.route, riskLevelMap[input.riskLevel], input.txHash],
  });
  console.log(`   ✅ Recorded! Analytics TX: ${explorerLink(hash, 'xlayer')}`);
  return hash;
}

// ── A2ACallInput ───────────────────────────────────────────────

export interface A2ACallInput {
  callerAgent: string;
  externalAgent: string;
  purpose: string;
  feePaid: string;
  paymentNetwork: string;
}

export async function recordA2ACallOnchain(input: A2ACallInput): Promise<string> {
  const env = loadEnv();
  const account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
  const feePaidRaw = BigInt(Math.floor(parseFloat(input.feePaid) * 1e6));

  console.log(`🤝 Analytics Agent: recording A2A call (${input.externalAgent})...`);
  const hash = await walletClient.writeContract({
    address: getContractAddress(env),
    abi: ANALYTICS_ABI,
    functionName: 'recordA2ACall',
    args: [input.callerAgent as `0x${string}`, input.externalAgent, input.purpose, feePaidRaw, input.paymentNetwork],
  });
  console.log(`✅ A2A call recorded!
   TX: ${explorerLink(hash, 'xlayer')}`);
  return hash;
}

// ── X402PaymentInput ───────────────────────────────────────────

export interface X402PaymentInput {
  agentAddress: string;
  endpoint: string;       // '/swap' or '/confirm'
  feePaid: string;        // e.g. '0.001'
  paymentNetwork: string; // e.g. 'avalanche'
  paymentTxHash: string;  // x402 settlement TX hash
}

export async function recordX402PaymentOnchain(input: X402PaymentInput): Promise<string> {
  const env = loadEnv();
  const account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
  const feePaidRaw = BigInt(Math.floor(parseFloat(input.feePaid) * 1e6));

  console.log(`💸 Analytics Agent: recording X402 payment (${input.endpoint})...`);
  const hash = await walletClient.writeContract({
    address: getContractAddress(env),
    abi: ANALYTICS_ABI,
    functionName: 'recordX402Payment',
    args: [input.agentAddress as `0x${string}`, input.endpoint, feePaidRaw, input.paymentNetwork, input.paymentTxHash],
  });
  console.log(`✅ X402 payment recorded!
   TX: ${explorerLink(hash, 'xlayer')}`);
  return hash;
}

// ── getDashboardData ───────────────────────────────────────────

export async function getDashboardData() {
  const env = loadEnv();
  const contractAddress = getContractAddress(env);
  const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

  const FAILED_ABI = parseAbi([
    'function totalFailed() view returns (uint256)',
    'function getRecentFailedSwaps(uint256 count) view returns ((address agent, string fromToken, string toToken, uint256 fromAmount, string reason, string paymentNetwork, uint256 timestamp)[])',
    'function getSuccessRate() view returns (uint256 numerator, uint256 denominator)',
  ]);

  const [totalSwaps, totalFailed, totalVolume, totalA2ACalls, totalX402Payments, totalX402Fees, recentSwaps, recentFailed, recentA2ACalls, recentX402Payments, successRate] = await Promise.all([
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'totalSwaps' }),
    publicClient.readContract({ address: contractAddress, abi: FAILED_ABI,    functionName: 'totalFailed' }),
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'totalVolume' }),
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'totalA2ACalls' }),
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'totalX402Payments' }),
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'totalX402Fees' }),
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'getRecentSwaps',       args: [10n] }),
    publicClient.readContract({ address: contractAddress, abi: FAILED_ABI,    functionName: 'getRecentFailedSwaps', args: [5n] }),
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'getRecentA2ACalls',    args: [5n] }),
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'getRecentX402Payments', args: [20n] }),
    publicClient.readContract({ address: contractAddress, abi: FAILED_ABI,    functionName: 'getSuccessRate' }),
  ]);

  const networkCount: Record<string, number> = {};
  const routeCount:   Record<string, number> = {};
  const reasonCount:  Record<string, number> = {};
  const a2aAgentCount: Record<string, number> = {};

  for (const swap of recentSwaps as any[]) {
    routeCount[swap.route] = (routeCount[swap.route] || 0) + 1;
  }
  for (const p of recentX402Payments as any[]) {
    networkCount[p.paymentNetwork] = (networkCount[p.paymentNetwork] || 0) + 1;
  }
  for (const f of recentFailed as any[]) {
    reasonCount[f.reason] = (reasonCount[f.reason] || 0) + 1;
  }
  for (const c of recentA2ACalls as any[]) {
    a2aAgentCount[c.externalAgent] = (a2aAgentCount[c.externalAgent] || 0) + 1;
  }

  const [numerator, denominator] = successRate as [bigint, bigint];
  const successRatePct = denominator > 0n
    ? (Number(numerator) / Number(denominator) * 100).toFixed(1)
    : '100.0';

  return {
    totalSwaps:         (totalSwaps as bigint).toString(),
    totalFailed:        (totalFailed as bigint).toString(),
    totalVolume:        (Number(totalVolume as bigint) / 1e6).toFixed(6),
    totalA2ACalls:      (totalA2ACalls as bigint).toString(),
    totalX402Payments:  (totalX402Payments as bigint).toString(),
    totalX402Fees:      (Number(totalX402Fees as bigint) / 1e6).toFixed(4),
    successRate:        successRatePct + '%',

    recentSwaps: (recentSwaps as any[]).map(s => ({
      agent:          s.agent,
      fromToken:      s.fromToken,
      toToken:        s.toToken,
      fromAmount:     (Number(s.fromAmount) / 1e6).toFixed(6),
      toAmount:       (Number(s.toAmount)   / 1e18).toFixed(6),
      network:        'xlayer',
      paymentNetwork: s.paymentNetwork,
      route:          s.route,
      riskLevel:      ['LOW', 'MEDIUM', 'HIGH'][s.riskLevel],
      timestamp:      new Date(Number(s.timestamp) * 1000).toISOString(),
      txHash:         s.txHash || undefined,
    })),

    recentFailed: (recentFailed as any[]).map(f => ({
      agent:          f.agent,
      fromToken:      f.fromToken,
      toToken:        f.toToken,
      fromAmount:     (Number(f.fromAmount) / 1e6).toFixed(6),
      reason:         f.reason,
      paymentNetwork: f.paymentNetwork,
      timestamp:      new Date(Number(f.timestamp) * 1000).toISOString(),
    })),

    recentA2ACalls: (recentA2ACalls as any[]).map(c => ({
      callerAgent:    c.callerAgent,
      externalAgent:  c.externalAgent,
      purpose:        c.purpose,
      feePaid:        (Number(c.feePaid) / 1e6).toFixed(4),
      paymentNetwork: c.paymentNetwork,
      timestamp:      new Date(Number(c.timestamp) * 1000).toISOString(),
    })),

    recentX402Payments: (recentX402Payments as any[]).map(p => ({
      agent:          p.agent,
      endpoint:       p.endpoint,
      feePaid:        (Number(p.feePaid) / 1e6).toFixed(4),
      paymentNetwork: p.paymentNetwork,
      paymentTxHash:  p.paymentTxHash || undefined,
      timestamp:      new Date(Number(p.timestamp) * 1000).toISOString(),
    })),

    networkBreakdown:  networkCount,
    routeBreakdown:    routeCount,
    reasonBreakdown:   reasonCount,
    a2aAgentBreakdown: a2aAgentCount,
  };
}

// ── recordFailedSwapOnchain ────────────────────────────────────

export interface FailedSwapInput {
  agentAddress: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  reason: 'risk_rejected' | 'broadcast_failed';
  paymentNetwork: string;
}

export async function recordFailedSwapOnchain(input: FailedSwapInput): Promise<string> {
  const env = loadEnv();
  const account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });
  const fromAmountRaw = BigInt(Math.floor(parseFloat(input.fromAmount) * 1e6));

  console.log(`📊 Analytics Agent: recording failed swap (${input.reason})...`);
  const hash = await walletClient.writeContract({
    address: getContractAddress(env),
    abi: parseAbi([
      'function recordFailedSwap(address agent, string fromToken, string toToken, uint256 fromAmount, string reason, string paymentNetwork) external',
    ]),
    functionName: 'recordFailedSwap',
    args: [input.agentAddress as `0x${string}`, input.fromToken, input.toToken, fromAmountRaw, input.reason, input.paymentNetwork],
  });
  console.log(`   ✅ Recorded! TX: ${explorerLink(hash, 'xlayer')}`);
  return hash;
}
