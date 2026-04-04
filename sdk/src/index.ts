// xflow/sdk/src/index.ts

import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http } from 'viem';

// ── Types ──────────────────────────────────────────────────────

export interface XFlowConfig {
  privateKey: `0x${string}`;
  xflowUrl?: string;       // default: https://xflow.a2aflow.space
  chainId?: number;        // default: auto (best-network選択)
  onProgress?: (msg: string) => void;
}

export interface SwapResult {
  success: boolean;
  swapTxHash: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  route: string;
  paymentTxHash?: string;
  explorerUrl: string;
}

// ── Internal constants ─────────────────────────────────────────

const DEFAULT_URL = 'https://xflow.a2aflow.space';
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
const STABLECOINS = ['USDC', 'USDT', 'USDT0', 'USDG', 'DAI'];

const EXPLORER_BASES: Record<string, string> = {
  xlayer:    'https://www.oklink.com/xlayer/tx/',
  unichain:  'https://uniscan.xyz/tx/',
  base:      'https://basescan.org/tx/',
  polygon:   'https://polygonscan.com/tx/',
  avalanche: 'https://snowtrace.io/tx/',
};

// chains.jsonをバンドル（SDKに内包）
const CHAINS: Record<string, {
  name: string; rpc: string; explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}> = {
  "196":  { name: "X Layer", rpc: "https://rpc.xlayer.tech", explorer: "xlayer",
             nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 } },
  "130":  { name: "Unichain", rpc: "https://mainnet.unichain.org", explorer: "unichain",
             nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  "8453": { name: "Base", rpc: "https://mainnet.base.org", explorer: "base",
             nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  "137":  { name: "Polygon", rpc: "https://polygon-rpc.com", explorer: "polygon",
             nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 } },
  "43114":{ name: "Avalanche", rpc: "https://api.avax.network/ext/bc/C/rpc", explorer: "avalanche",
             nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 } },
};

function explorerLink(hash: string, key: string): string {
  const base = EXPLORER_BASES[key?.toLowerCase()];
  return base ? `${base}${hash}` : hash;
}

const allowanceAbi = [{
  name: 'allowance', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const;

const approveAbi = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ type: 'bool' }],
}] as const;

// ── XFlowClient ────────────────────────────────────────────────

export class XFlowClient {
  private account;
  private xflowUrl: string;
  private chainId?: number;
  private log: (msg: string) => void;

  constructor(config: XFlowConfig) {
    this.account  = privateKeyToAccount(config.privateKey);
    this.xflowUrl = config.xflowUrl ?? DEFAULT_URL;
    this.chainId  = config.chainId;
    this.log      = config.onProgress ?? (() => {});
  }

  async swap(query: string): Promise<SwapResult> {
    const { xflowUrl, account, log } = this;

    // 1. Best network selection
    log('🔍 Selecting best network...');
    const bestRes = await fetch(`${xflowUrl}/best-network?address=${account.address}`);
    if (!bestRes.ok) throw new Error(`/best-network failed: ${(await bestRes.json() as any).error}`);
    const { selectedNetwork, allBalances } = await bestRes.json() as any;

    // chainId: explicit override or auto-selected
    const chainId = this.chainId ?? parseInt(selectedNetwork.network.split(':')[1]);
    const chainConfig = CHAINS[String(chainId)];
    if (!chainConfig) throw new Error(`Unsupported chainId: ${chainId}`);

    log(`💡 Network: ${selectedNetwork.name} (${selectedNetwork.balanceFormatted} USDC)`);

    const chain = {
      id: chainId,
      name: chainConfig.name,
      nativeCurrency: chainConfig.nativeCurrency,
      rpcUrls: { default: { http: [chainConfig.rpc] } },
    };
    const walletClient = createWalletClient({ account, chain, transport: http(chainConfig.rpc) });
    const publicClient = createPublicClient({ chain, transport: http(chainConfig.rpc) });

    // x402 payment-wrapped fetch
    const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: selectedNetwork.network, client: new ExactEvmScheme(account) }],
    });

    // 2. /swap → quote
    log('📋 Fetching quote...');
    const swapRes = await fetchWithPayment(`${xflowUrl}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        userAddress: account.address,
        chainId,
        _routerMeta: {
          selectedNetwork: selectedNetwork.name,
          selectedScore: selectedNetwork.score,
          selectedGasCostUSD: selectedNetwork.gasCostUSD,
          allBalances: allBalances.map((b: any) => ({
            name: b.name, balance: b.balanceFormatted, sufficient: b.sufficient,
            gasCostUSD: b.gasCostUSD, finalitySeconds: b.finalitySeconds, score: b.score,
          })),
        },
      }),
    });

    // x402 payment receipt
    let swapPaymentNetwork: string | undefined;
    let swapX402TxHash: string | undefined;
    const pr = swapRes.headers.get('payment-response');
    if (pr) {
      const payment = JSON.parse(Buffer.from(pr, 'base64').toString());
      swapPaymentNetwork = payment.network;
      swapX402TxHash = payment.transaction;
      log(`💸 x402 paid: ${explorerLink(payment.transaction, payment.network)}`);
    }

    const quoteData = await swapRes.json() as any;
    if (!quoteData.success) throw new Error(`Quote failed: ${JSON.stringify(quoteData)}`);
    if (quoteData.result?.data?.status === 'rejected')
      throw new Error(`Swap rejected by Risk Agent: ${JSON.stringify(quoteData.result.data.risk)}`);

    const quote          = quoteData.result?.data?.quote;
    const risk           = quoteData.result?.data?.risk;
    const permitData     = quoteData.result?.data?.permitData ?? null;
    const uniswapRawQuote = quoteData.result?.data?.uniswapRawQuote ?? null;

    if (!quote) throw new Error(`No quote data: ${JSON.stringify(quoteData)}`);
    log(`✅ Quote: ${quote.fromAmount} ${quote.fromToken} → ${quote.toAmount} ${quote.toToken}`);

    // 3. Permit2 signing (Uniswap only)
    let permit2Signature: string | undefined;
    if (permitData) {
      log('✍️  Signing Permit2...');
      try {
        permit2Signature = await walletClient.signTypedData({
          domain:      permitData.domain,
          types:       permitData.types,
          primaryType: 'PermitSingle',
          message:     permitData.values,
        });
        log('✅ Permit2 signed');
      } catch (e: any) {
        log(`⚠️  Permit2 signing failed: ${e.message}`);
      }
    }

    // 4. /tx → fresh calldata
    log('⚙️  Building transaction...');
    const txRes = await fetch(`${xflowUrl}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        userAddress: account.address,
        chainId,
        fromTokenAddress: quote.fromTokenAddress,
        toTokenAddress:   quote.toTokenAddress,
        parsedIntent:     quoteData.intent,
        permit2Signature,
        uniswapRawQuote,
      }),
    });
    const txData = await txRes.json() as any;
    const freshTx = txData.result?.data?.result?.tx;
    if (!freshTx) throw new Error(`No TX data: ${JSON.stringify(txData)}`);

    // 5. Allowance check & approve
    const fromTokenAddr = quote.fromTokenAddress as `0x${string}` | undefined;
    if (fromTokenAddr) {
      const spender = (permitData ? PERMIT2_ADDRESS : freshTx.to) as `0x${string}`;
      const allowance = await publicClient.readContract({
        address: fromTokenAddr, abi: allowanceAbi,
        functionName: 'allowance', args: [account.address, spender],
      });
      const decimals = STABLECOINS.includes(quote.fromToken) ? 6 : 18;
      const needed = BigInt(Math.floor(parseFloat(quote.fromAmount) * 10 ** decimals));

      if (allowance < needed) {
        log(`🔐 Approving ${quote.fromToken}...`);
        const approveTx = await walletClient.writeContract({
          address: fromTokenAddr, abi: approveAbi, functionName: 'approve',
          args: [spender, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        log('✅ Approved');
      }
    }

    // 6. Broadcast swap
    log('🚀 Broadcasting swap...');
    const swapHash = await walletClient.sendTransaction({
      to:       freshTx.to,
      data:     freshTx.data,
      value:    BigInt(freshTx.value || '0'),
      gas:      BigInt(Math.floor(Number(freshTx.gas) * 1.5)),
      gasPrice: freshTx.gasPrice ? BigInt(freshTx.gasPrice) : undefined,
      chainId,
    });
    log(`✅ Swap TX: ${explorerLink(swapHash, chainConfig.explorer)}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash, timeout: 60_000 })
      .catch(e => { log(`⚠️  Receipt timeout: ${e.message}`); return null; });

    if (!receipt || receipt.status === 'reverted') {
      await fetch(`${xflowUrl}/fail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: swapHash, fromToken: quote.fromToken, toToken: quote.toToken,
          fromAmount: quote.fromAmount, paymentNetwork: swapPaymentNetwork,
          agentAddress: account.address,
        }),
      }).catch(() => {});
      throw new Error(`Swap TX reverted: ${explorerLink(swapHash, chainConfig.explorer)}`);
    }

    // 7. /confirm
    log('📡 Confirming...');
    const confirmFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: selectedNetwork.network, client: new ExactEvmScheme(account) }],
    });
    const confirmRes = await confirmFetch(`${xflowUrl}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: swapHash,
        fromToken: quote.fromToken, toToken: quote.toToken,
        fromAmount: quote.fromAmount, toAmount: quote.toAmount,
        paymentNetwork: swapPaymentNetwork || quoteData.result?.network,
        route: quote.route, riskLevel: risk?.riskLevel,
        agentAddress: account.address, swapX402TxHash,
      }),
    });

    let confirmX402TxHash: string | undefined;
    const confirmPr = confirmRes.headers.get('payment-response');
    if (confirmPr) {
      const p = JSON.parse(Buffer.from(confirmPr, 'base64').toString());
      confirmX402TxHash = p.transaction;
    }
    await confirmRes.json();

    // 8. /analysisReceived
    await fetch(`${xflowUrl}/analysisReceived`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentAddress: account.address,
        confirmX402TxHash: confirmX402TxHash ?? '',
        paymentNetwork: swapPaymentNetwork,
      }),
    }).catch(() => {});

    log('🎉 Done!');

    return {
      success: true,
      swapTxHash: swapHash,
      fromToken: quote.fromToken,
      toToken: quote.toToken,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      route: quote.route ?? 'unknown',
      paymentTxHash: swapX402TxHash,
      explorerUrl: explorerLink(swapHash, chainConfig.explorer),
    };
  }
}
