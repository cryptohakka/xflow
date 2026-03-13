import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

export interface PaymentOptions {
  privateKey: `0x${string}`;
  preferredNetwork?: string;
}

/**
 * x402 Payment Adapter
 * Adapts to any network the server accepts, prioritizing preferredNetwork
 */
export async function createPaymentFetch(options: PaymentOptions) {
  const { privateKey, preferredNetwork = 'eip155:196' } = options;
  const account = privateKeyToAccount(privateKey);

  const patchedFetch = async (input: any, init?: any) => {
    const response = await fetch(input, init);
    if (response.status === 402) {
      const headerVal = response.headers.get('payment-required') 
                     || response.headers.get('PAYMENT-REQUIRED');
      if (headerVal) {
        const decoded = JSON.parse(Buffer.from(headerVal, 'base64').toString());
        // preferredNetworkが含まれていればそれだけに絞る
        const filtered = decoded.accepts.filter((a: any) => a.network === preferredNetwork);
        if (filtered.length > 0) decoded.accepts = filtered;
        const newHeaders = new Headers(response.headers);
        newHeaders.set('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(decoded)).toString('base64'));
        return new Response(await response.text(), {
          status: 402,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }
    }
    return response;
  };

  return wrapFetchWithPaymentFromConfig(patchedFetch, {
    schemes: [{ network: preferredNetwork, client: new ExactEvmScheme(account) }],
  });
}

/**
 * Pay and call an x402 endpoint
 */
export async function payAndCall(
  url: string,
  body: any,
  options: PaymentOptions
): Promise<{ data: any; network: string; transaction: string }> {
  const fetchWithPayment = await createPaymentFetch(options);

  const res = await fetchWithPayment(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const pr = res.headers.get('payment-response');
  const payment = pr ? JSON.parse(Buffer.from(pr, 'base64').toString()) : {};
  const data = await res.json();

  return {
    data,
    network: payment.network || options.preferredNetwork || 'unknown',
    transaction: payment.transaction || '',
  };
}
