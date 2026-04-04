/**
 * XFlow Risk Agent
 * Evaluates swap risk and provides actionable feedback
 */

export interface RiskInput {
  fromToken: string;
  toToken: string;
  amount: string;
  priceImpact?: string;
  estimateGasFee: string;
  route: string;
  isHoneyPot?: boolean;
  taxRate?: string;
  toTokenUnitPrice?: string;
}

export interface RiskResult {
  approved: boolean;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  reasons: string[];
  recommendation: string;
  feedback: {
    summary: string;
    suggestions: string[];
    safeAmount?: string;
    honeypot: boolean;
    taxRate: string;
    educationNote?: string;
    driver?: string;
    scores: { impact: number; route: number };
  };
}

function scorePriceImpact(impact: number): number {
  if (impact <= 0)   return 0;
  if (impact < 0.1)  return 0;
  if (impact < 0.5)  return 1;
  if (impact < 1.0)  return 2;
  if (impact <= 2.0) return 3;
  return 4;
}

// Route quality: binary scoring (0 or 2)
// Uniswap Trading API and OKX aggregator routes are both verified
function scoreRoute(route: string): number {
  if (!route || route === 'Unknown') return 2;
  if (/uniswap/i.test(route)) return 0;  // Uniswap Trading API = verified
  return 0; // OKX aggregator = verified
}

function riskLevelFromScore(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 4) return 'HIGH';
  if (score >= 2) return 'MEDIUM';
  return 'LOW';
}

export function evaluateRisk(input: RiskInput): RiskResult {
  const reasons: string[] = [];
  const suggestions: string[] = [];
  let safeAmount: string | undefined;

  // 1. Honeypot check
  const isHoneyPot = input.isHoneyPot || false;
  if (isHoneyPot) {
    reasons.push('⚠️ Token flagged as potential honeypot');
    suggestions.push('Do not trade this token — you may not be able to sell it');
    return {
      approved: false,
      riskScore: 100,
      riskLevel: 'HIGH',
      reasons,
      recommendation: '❌ Swap rejected: honeypot detected',
      feedback: {
        summary: 'Swap rejected: honeypot token detected',
        suggestions,
        honeypot: true,
        taxRate: `${parseFloat(input.taxRate || '0')}%`,
        educationNote: 'Honeypot tokens are designed to trap buyers — always verify token contracts before trading',
        scores: { impact: 0, route: 0 },
      },
    };
  }

  // 2. Tax rate check
  const taxRate = parseFloat(input.taxRate || '0');
  if (taxRate >= 10) {
    reasons.push(`High tax rate: ${taxRate}%`);
    suggestions.push(`This token has a ${taxRate}% tax on transactions — effective cost is much higher`);
  } else if (taxRate >= 5) {
    reasons.push(`Medium tax rate: ${taxRate}%`);
    suggestions.push(`Token has ${taxRate}% tax — factor this into your expected output`);
  }

  // 3. Price impact guard
  if (!input.priceImpact) {
    return {
      approved: false,
      riskScore: -1,
      riskLevel: 'UNKNOWN',
      reasons: ['Price impact data unavailable'],
      recommendation: '❌ Swap rejected: cannot assess execution risk',
      feedback: {
        summary: 'Risk assessment failed: price impact unavailable from API',
        suggestions: ['Try again or use a different token pair'],
        honeypot: false,
        taxRate: `${taxRate}%`,
        scores: { impact: 0, route: 0 },
      },
    };
  }

  const rawImpact = parseFloat(input.priceImpact.replace('%', ''));
  const impact = rawImpact < 0 ? 0 : rawImpact; // negative = favorable slippage → no risk
  const impactScore = scorePriceImpact(impact);
  const routeScore  = scoreRoute(input.route);

  const riskScore = Math.max(impactScore, routeScore);
  const driver    = impactScore >= routeScore ? 'price impact' : 'route quality';
  const riskLevel = riskLevelFromScore(riskScore);

  reasons.push(`Price impact: ${input.priceImpact} → score ${impactScore}`);
  reasons.push(`Route quality: ${input.route} → score ${routeScore}`);

  if (impact > 2.0) {
    const amount = parseFloat(input.amount);
    const safeAmt = Math.floor(amount * (2.0 / impact));
    safeAmount = safeAmt.toString();
    suggestions.push(`Reduce amount to ~$${safeAmount} to bring price impact below 2%`);
  } else if (impact >= 1.0) {
    suggestions.push('Price impact is elevated — consider reducing swap size');
  }

  if (routeScore === 2) {
    suggestions.push('No verified route found — try a different token pair');
  }

  const gasFee = parseInt(input.estimateGasFee);
  if (gasFee > 1_000_000) {
    suggestions.push('Gas costs are high — consider waiting for lower network congestion');
  }

  const approved = riskLevel !== 'HIGH';

  const recommendation = approved
    ? riskLevel === 'LOW'
      ? '✅ Safe to proceed'
      : '⚠️ Proceed with caution'
    : '❌ Swap rejected due to high risk';

  let educationNote: string | undefined;
  if (!approved) {
    if (impact > 2.0) {
      educationNote = 'High price impact means low liquidity. Large orders move the price significantly against you';
    } else if (routeScore === 2) {
      educationNote = 'Routing through low-TVL pools increases the risk of slippage and price manipulation';
    }
  }

  return {
    approved,
    riskScore,
    riskLevel,
    reasons,
    recommendation,
    feedback: {
      summary: approved
        ? `Swap looks ${riskLevel === 'LOW' ? 'safe' : 'acceptable with caution'}`
        : `Swap rejected: ${reasons[0]}`,
      suggestions,
      safeAmount,
      honeypot: false,
      taxRate: `${taxRate}%`,
      educationNote,
      driver,
      scores: { impact: impactScore, route: routeScore },
    },
  };
}

export async function handleRiskCheck(input: RiskInput): Promise<RiskResult> {
  console.log(`🛡️  Risk Agent evaluating swap: ${input.fromToken} → ${input.toToken}`);
  const result = evaluateRisk(input);

  if (result.riskLevel === 'UNKNOWN') {
    console.log(`   Risk: UNKNOWN → REJECTED (price impact unavailable)`);
    return result;
  }

  console.log(`\n🔍 Risk Assessment:`);
  console.log(`   Price Impact: ${input.priceImpact ?? 'N/A'} (score: ${result.feedback.scores.impact})`);
  console.log(`   Route:        ${input.route} (score: ${result.feedback.scores.route})`);
  console.log(`   ─────────────────────────────`);
  console.log(`   Final:        ${result.riskLevel} (score: ${result.riskScore}, driver: ${result.feedback.driver})`);
  console.log(`   Decision:     ${result.approved ? 'APPROVED' : 'REJECTED'}`);

  if (result.feedback.suggestions.length > 0) {
    result.feedback.suggestions.forEach(s => console.log(`   💡 ${s}`));
  }

  return result;
}
