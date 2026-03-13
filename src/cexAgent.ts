/**
 * XFlow CEX Agent
 * Uses OKX OnchainOS Skills for market data
 */

export async function handleCexQuery(query: string) {
  console.log(`📊 CEX Agent: ${query}`);
  // TODO: OKX market data API
  return { agent: 'cex', query, status: 'TODO' };
}
