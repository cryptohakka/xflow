import { resolveToken, getAvailableTokens } from './src/tokenResolver.js';

console.log('Testing USDC...');
const usdc = await resolveToken('USDC');
console.log('USDC:', usdc);

console.log('Testing WOKB...');
const wokb = await resolveToken('WOKB');
console.log('WOKB:', wokb);

console.log('Testing unknown token...');
const unknown = await resolveToken('DOGE');
console.log('DOGE:', unknown);

console.log('Available tokens:', (await getAvailableTokens()).slice(0,10));
