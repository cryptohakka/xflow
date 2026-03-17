/**
 * XFlow Analytics Agent
 * Records swap activity onchain on X Layer
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
  'function recordSwap(address agent, string fromToken, string toToken, uint256 fromAmount, uint256 toAmount, string paymentNetwork, string route, uint8 riskLevel) external',
  'function totalSwaps() view returns (uint256)',
  'function getRecentSwaps(uint256 count) view returns ((address agent, string fromToken, string toToken, uint256 fromAmount, uint256 toAmount, string paymentNetwork, string route, uint8 riskLevel, uint256 timestamp)[])',
  'event SwapExecuted(address indexed agent, string fromToken, string toToken, uint256 fromAmount, uint256 toAmount, string paymentNetwork, string route, uint8 riskLevel, uint256 timestamp)',
]);

function loadEnv(): Record<string, string> {
  // process.envを優先（Docker環境）
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

export interface SwapAnalyticsInput {
  agentAddress: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;   // human readable e.g. "0.01"
  toAmount: string;
  paymentNetwork: string; // e.g. "eip155:43114"
  route: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * Record swap onchain
 */
export async function recordSwapOnchain(input: SwapAnalyticsInput): Promise<string> {
  const env = loadEnv();
  const privateKey = env.PRIVATE_KEY as `0x${string}`;
  const contractAddress = (env.ANALYTICS_CONTRACT || '0xf88A47a15fAa310E11c67568ef934141880d473e') as `0x${string}`;

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });

  const riskLevelMap = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const fromAmountRaw = BigInt(Math.floor(parseFloat(input.fromAmount) * 1e6)); // USDC 6 decimals
  const toAmountRaw = BigInt(Math.floor(parseFloat(input.toAmount) * 1e18));   // WOKB 18 decimals

  console.log(`📊 Analytics Agent: recording swap onchain...`);

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: ANALYTICS_ABI,
    functionName: 'recordSwap',
    args: [
      input.agentAddress as `0x${string}`,
      input.fromToken,
      input.toToken,
      fromAmountRaw,
      toAmountRaw,
      input.paymentNetwork,
      input.route,
      riskLevelMap[input.riskLevel],
    ],
  });

  console.log(`   ✅ Recorded! TX: ${hash}`);
  console.log(`   🔗 https://www.okx.com/web3/explorer/xlayer/tx/${hash}`);
  return hash;
}

/**
 * Get dashboard data
 */
export async function getDashboardData() {
  const env = loadEnv();
  const contractAddress = (env.ANALYTICS_CONTRACT || '0xf88A47a15fAa310E11c67568ef934141880d473e') as `0x${string}`;

  const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

  const FAILED_ABI = parseAbi([
    'function totalFailed() view returns (uint256)',
    'function getRecentFailedSwaps(uint256 count) view returns ((address agent, string fromToken, string toToken, uint256 fromAmount, string reason, string paymentNetwork, uint256 timestamp)[])',
    'function getSuccessRate() view returns (uint256 numerator, uint256 denominator)',
  ]);

  const [totalSwaps, totalFailed, recentSwaps, recentFailed, successRate] = await Promise.all([
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'totalSwaps' }),
    publicClient.readContract({ address: contractAddress, abi: FAILED_ABI, functionName: 'totalFailed' }),
    publicClient.readContract({ address: contractAddress, abi: ANALYTICS_ABI, functionName: 'getRecentSwaps', args: [10n] }),
    publicClient.readContract({ address: contractAddress, abi: FAILED_ABI, functionName: 'getRecentFailedSwaps', args: [5n] }),
    publicClient.readContract({ address: contractAddress, abi: FAILED_ABI, functionName: 'getSuccessRate' }),
  ]);

  // ── totalVolume: コントラクトに関数があれば使う、なければ recentSwaps の合計で代用 ──
  let totalVolume: string;
  try {
    const vol = await publicClient.readContract({
      address: contractAddress,
      abi: parseAbi(['function totalVolume() view returns (uint256)']),
      functionName: 'totalVolume',
    }) as bigint;
    totalVolume = (Number(vol) / 1e6).toFixed(6);
  } catch {
    totalVolume = (recentSwaps as any[])
      .reduce((sum, s) => sum + Number(s.fromAmount) / 1e6, 0)
      .toFixed(6);
  }

  const networkCount: Record<string, number> = {};
  const routeCount: Record<string, number> = {};
  const reasonCount: Record<string, number> = {};

  for (const swap of recentSwaps as any[]) {
    networkCount[swap.paymentNetwork] = (networkCount[swap.paymentNetwork] || 0) + 1;
    routeCount[swap.route] = (routeCount[swap.route] || 0) + 1;
  }
  for (const f of recentFailed as any[]) {
    reasonCount[f.reason] = (reasonCount[f.reason] || 0) + 1;
  }

  const [numerator, denominator] = successRate as [bigint, bigint];
  const successRatePct = denominator > 0n
    ? (Number(numerator) / Number(denominator) * 100).toFixed(1)
    : '100.0';

  return {
    totalSwaps: totalSwaps.toString(),
    totalFailed: totalFailed.toString(),
    totalVolume,
    successRate: successRatePct + '%',
    recentSwaps: (recentSwaps as any[]).map(s => ({
      agent: s.agent,
      fromToken: s.fromToken,
      toToken: s.toToken,
      fromAmount: (Number(s.fromAmount) / 1e6).toFixed(6),
      toAmount: (Number(s.toAmount) / 1e18).toFixed(6),
      paymentNetwork: s.paymentNetwork,
      route: s.route,
      riskLevel: ['LOW', 'MEDIUM', 'HIGH'][s.riskLevel],
      timestamp: new Date(Number(s.timestamp) * 1000).toISOString(),
      txHash: s.txHash || undefined,
    })),
    recentFailed: (recentFailed as any[]).map(f => ({
      agent: f.agent,
      fromToken: f.fromToken,
      toToken: f.toToken,
      fromAmount: (Number(f.fromAmount) / 1e6).toFixed(6),
      reason: f.reason,
      paymentNetwork: f.paymentNetwork,
      timestamp: new Date(Number(f.timestamp) * 1000).toISOString(),
      txHash: f.txHash || undefined,
    })),
    networkBreakdown: networkCount,
    routeBreakdown: routeCount,
    reasonBreakdown: reasonCount,
  };
}

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
  const privateKey = env.PRIVATE_KEY as `0x${string}`;
  const contractAddress = (env.ANALYTICS_CONTRACT || '0xc5808b9D5b5403802d8276A52bbf53e32C53e998') as `0x${string}`;

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain: xlayer, transport: http('https://rpc.xlayer.tech') });

  const fromAmountRaw = BigInt(Math.floor(parseFloat(input.fromAmount) * 1e6));

  console.log(`📊 Analytics Agent: recording failed swap (${input.reason})...`);

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: parseAbi([
      'function recordFailedSwap(address agent, string fromToken, string toToken, uint256 fromAmount, string reason, string paymentNetwork) external',
    ]),
    functionName: 'recordFailedSwap',
    args: [
      input.agentAddress as `0x${string}`,
      input.fromToken,
      input.toToken,
      fromAmountRaw,
      input.reason,
      input.paymentNetwork,
    ],
  });

  console.log(`   ✅ Recorded! TX: ${hash}`);
  return hash;
}
