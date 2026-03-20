/**
 * XFlow Smart Payment Router
 * Automatically selects the best chain for x402 payment
 * based on USDC balances across supported networks
 */
import { createPublicClient, http, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';

const SUPPORTED_NETWORKS = [
  {
    network: 'eip155:8453',
    name: 'Base',
    rpc: 'https://mainnet.base.org',
    chainId: 8453,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  {
    network: 'eip155:137',
    name: 'Polygon',
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    chainId: 137,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
  {
    network: 'eip155:43114',
    name: 'Avalanche',
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    chainId: 43114,
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  },
  {
    network: 'eip155:196',
    name: 'X Layer',
    rpc: 'https://rpc.xlayer.tech',
    chainId: 196,
    usdc: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
  },
];

const ERC20_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const;

export interface NetworkBalance {
  network: string;
  name: string;
  balance: bigint;
  balanceFormatted: string;
  sufficient: boolean;
  gasCostUSD?: number;
}

export async function checkBalances(address: string): Promise<NetworkBalance[]> {
  const results = await Promise.allSettled(
    SUPPORTED_NETWORKS.map(async (n) => {
      const client = createPublicClient({
        chain: { id: n.chainId, name: n.name, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [n.rpc] } } } as any,
        transport: http(n.rpc),
      });
      const balance = await client.readContract({
        address: n.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      });
      return {
        network: n.network,
        name: n.name,
        balance: balance as bigint,
        balanceFormatted: formatUnits(balance as bigint, 6),
        sufficient: (balance as bigint) >= 1000n,
      };
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : {
      network: SUPPORTED_NETWORKS[i].network,
      name: SUPPORTED_NETWORKS[i].name,
      balance: 0n,
      balanceFormatted: '0',
      sufficient: false,
    }
  );
}

export function selectBestNetwork(balances: NetworkBalance[]): NetworkBalance | null {
  const sufficient = balances.filter(b => b.sufficient);
  if (sufficient.length === 0) return null;
  return sufficient.sort((a, b) => Number(b.balance - a.balance))[0];
}

async function getGasCostUSD(network: typeof SUPPORTED_NETWORKS[0]): Promise<number> {
  try {
    const client = createPublicClient({
      chain: { id: network.chainId, name: network.name, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [network.rpc] } } } as any,
      transport: http(network.rpc),
    });
    const gasPrice = await client.getGasPrice();
    const estimatedGas = 100000n;
    const gasCostNative = gasPrice * estimatedGas;

    const nativeTokenIds: Record<string, string> = {
      'eip155:8453':  'ethereum',
      'eip155:137':   'polygon-ecosystem-token',
      'eip155:43114': 'avalanche-2',
      'eip155:196':   'okb',
    };
    const tokenId = nativeTokenIds[network.network];
    const priceRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`,
      { headers: { 'Accept': 'application/json' } }
    );
    const priceData = await priceRes.json() as any;
    const priceUSD = priceData[tokenId]?.usd || 0;

    return Number(gasCostNative) / 1e18 * (priceUSD || 100);
  } catch {
    return 999;
  }
}

/**
 * 全チェーンのガスコストを取得してbestを選ぶ
 */
export async function selectBestNetworkByGas(
  balances: NetworkBalance[]
): Promise<(NetworkBalance & { gasCostUSD: number }) | null> {
  const sufficient = balances.filter(b => b.sufficient);
  if (sufficient.length === 0) return null;

  console.log('⛽ Estimating gas costs...');
  const withGas = await Promise.all(
    sufficient.map(async (b) => {
      const networkConfig = SUPPORTED_NETWORKS.find(n => n.network === b.network)!;
      const gasCostUSD = await getGasCostUSD(networkConfig);
      console.log(`   ${b.name}: $${gasCostUSD.toFixed(6)} gas`);
      return { ...b, gasCostUSD };
    })
  );

  return withGas.sort((a, b) => a.gasCostUSD - b.gasCostUSD)[0];
}

export async function createSmartPaymentFetch(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);

  console.log('🔍 Checking USDC balances across networks...');
  const balances = await checkBalances(account.address);
  balances.forEach(b => {
    console.log(`   ${b.name}: ${b.balanceFormatted} USDC ${b.sufficient ? '✅' : '❌'}`);
  });

  // 全チェーンのガスコストを並列取得
  console.log('⛽ Estimating gas costs...');
  const allBalancesWithGas = await Promise.all(
    balances.map(async (b) => {
      const networkConfig = SUPPORTED_NETWORKS.find(n => n.network === b.network)!;
      const gasCostUSD = await getGasCostUSD(networkConfig);
      console.log(`   ${b.name}: $${gasCostUSD.toFixed(6)} gas`);
      return { ...b, gasCostUSD };
    })
  );

  // sufficientなチェーンの中でガス最安を選ぶ
  const sufficientWithGas = allBalancesWithGas.filter(b => b.sufficient);
  if (sufficientWithGas.length === 0) {
    throw new Error('Insufficient USDC balance on all supported networks');
  }
  const best = sufficientWithGas.sort((a, b) => a.gasCostUSD - b.gasCostUSD)[0];

  console.log(`💡 Selected: ${best.name} (${best.balanceFormatted} USDC · gas $${best.gasCostUSD.toFixed(6)})`);

  return {
    fetchWithPayment: wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: best.network, client: new ExactEvmScheme(account) }],
    }),
    selectedNetwork: best,
    allBalances: allBalancesWithGas,
  };
}
