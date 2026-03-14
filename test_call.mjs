import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { createHmac } from 'crypto';

const env = Object.fromEntries(
  readFileSync('/home/agent/xflow/.env','utf-8')
    .split('\n').filter(l=>l.includes('='))
    .map(l=>[l.split('=')[0].trim(),l.split('=').slice(1).join('=').trim()])
);

const xlayer = { id: 196, name: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.xlayer.tech'] } } };
const account = privateKeyToAccount(env.PRIVATE_KEY);
const publicClient = createPublicClient({ chain: xlayer, transport: http('https://rpc.xlayer.tech') });

// OKX APIから直接TX取得
const ts = new Date().toISOString();
const path = '/api/v6/dex/aggregator/swap?chainIndex=196&amount=10000&fromTokenAddress=0x74b7f16337b8972027f6196a17a631ac6de26d22&toTokenAddress=0xe538905cf8410324e03a5a23c1c177a474d59b2b&userWalletAddress=0x191c78ad59cc4fd59155c351c08c06c0e794b0b1&slippagePercent=0.5';
const sign = createHmac('sha256', env.OKX_SECRET_KEY).update(ts+'GET'+path).digest('base64');
const res = await fetch('https://www.okx.com'+path, {
  headers: { 'OK-ACCESS-KEY': env.OKX_API_KEY, 'OK-ACCESS-SIGN': sign, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': env.OKX_PASSPHRASE }
});
const json = await res.json();
const tx = json.data?.[0]?.tx;

// eth_callでrevert理由を取得
try {
  await publicClient.call({
    account: account.address,
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value || '0'),
    gas: BigInt(tx.gas),
  });
  console.log('call succeeded');
} catch(e) {
  console.log('revert reason:', e.message.slice(0, 300));
}
