/**
 * XFlow Risk Agent
 * Evaluates swap risk and provides actionable feedback
 */

export interface RiskInput {
  fromToken: string;
  toToken: string;
  amount: string;
  priceImpact: string;
  estimateGasFee: string;
  route: string;
  // OKX API honeypot/tax data
  isHoneyPot?: boolean;
  taxRate?: string;
  toTokenUnitPrice?: string;
}

export interface RiskResult {
  approved: boolean;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  recommendation: string;
  feedback: {
    summary: string;
    suggestions: string[];
    safeAmount?: string;
    honeypot: boolean;
    taxRate: string;
    educationNote?: string;
  };
}

const RISK_THRESHOLDS = {
  priceImpact: { low: 0.5, medium: 2.0, high: 5.0 },
  amount: { medium: 100, high: 1000 },
  taxRate: { medium: 5, high: 10 },
};

export function evaluateRisk(input: RiskInput): RiskResult {
  const reasons: string[] = [];
  const suggestions: string[] = [];
  let riskScore = 0;
  let safeAmount: string | undefined;

  // 1. Honeypot check
  const isHoneyPot = input.isHoneyPot || false;
  if (isHoneyPot) {
    riskScore += 100;
    reasons.push('⚠️ Token flagged as potential honeypot');
    suggestions.push('Do not trade this token — you may not be able to sell it');
  }

  // 2. Tax rate check
  const taxRate = parseFloat(input.taxRate || '0');
  if (taxRate >= RISK_THRESHOLDS.taxRate.high) {
    riskScore += 40;
    reasons.push(`High tax rate: ${taxRate}%`);
    suggestions.push(`This token has a ${taxRate}% tax on transactions — effective cost is much higher`);
  } else if (taxRate >= RISK_THRESHOLDS.taxRate.medium) {
    riskScore += 20;
    reasons.push(`Medium tax rate: ${taxRate}%`);
    suggestions.push(`Token has ${taxRate}% tax — factor this into your expected output`);
  }

  // 3. Price impact check
  const impact = Math.abs(parseFloat(input.priceImpact.replace('%', '')));
  if (impact >= RISK_THRESHOLDS.priceImpact.high) {
    riskScore += 60;
    reasons.push(`High price impact: ${input.priceImpact}`);
    // Calculate safe amount
    const amount = parseFloat(input.amount);
    const safeAmt = Math.floor(amount * (RISK_THRESHOLDS.priceImpact.medium / impact));
    safeAmount = safeAmt.toString();
    suggestions.push(`Reduce amount to ~$${safeAmount} to bring price impact below 2%`);
  } else if (impact >= RISK_THRESHOLDS.priceImpact.medium) {
    riskScore += 30;
    reasons.push(`Medium price impact: ${input.priceImpact}`);
    const amount = parseFloat(input.amount);
    const safeAmt = Math.floor(amount * (RISK_THRESHOLDS.priceImpact.low / impact));
    safeAmount = safeAmt.toString();
    suggestions.push(`Reduce amount to ~$${safeAmount} to bring price impact below 0.5%`);
  } else {
    riskScore += 5;
    reasons.push(`Low price impact: ${input.priceImpact}`);
  }

  // 4. Amount check
  const amount = parseFloat(input.amount);
  if (amount >= RISK_THRESHOLDS.amount.high) {
    riskScore += 30;
    reasons.push(`Large amount: $${amount}`);
    if (!safeAmount) {
      suggestions.push(`Consider splitting into smaller transactions (e.g. $${Math.floor(amount/5)} × 5)`);
    }
  } else if (amount >= RISK_THRESHOLDS.amount.medium) {
    riskScore += 15;
    reasons.push(`Medium amount: $${amount}`);
  }

  // 5. Route check
  if (!input.route || input.route === 'Unknown') {
    riskScore += 20;
    reasons.push('Unknown DEX route');
    suggestions.push('No verified DEX route found — try a different token pair');
  }

  // 6. Gas fee check
  const gasFee = parseInt(input.estimateGasFee);
  if (gasFee > 1000000) {
    riskScore += 10;
    reasons.push(`High gas estimate: ${gasFee}`);
    suggestions.push('Gas costs are high — consider waiting for lower network congestion');
  }

  // Determine risk level
  const riskLevel = riskScore >= 60 ? 'HIGH'
                  : riskScore >= 25 ? 'MEDIUM'
                  : 'LOW';

  const approved = riskLevel !== 'HIGH';

  const recommendation = approved
    ? riskLevel === 'LOW'
      ? '✅ Safe to proceed'
      : '⚠️ Proceed with caution'
    : '❌ Swap rejected due to high risk';

  // Education note
  let educationNote: string | undefined;
  if (!approved) {
    if (isHoneyPot) {
      educationNote = 'Honeypot tokens are designed to trap buyers — always verify token contracts before trading';
    } else if (impact >= RISK_THRESHOLDS.priceImpact.high) {
      educationNote = 'High price impact means low liquidity. Large orders move the price significantly against you';
    } else if (amount >= RISK_THRESHOLDS.amount.high) {
      educationNote = 'Large orders should be split into smaller chunks to minimize market impact';
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
      honeypot: isHoneyPot,
      taxRate: `${taxRate}%`,
      educationNote,
    },
  };
}

export async function handleRiskCheck(input: RiskInput): Promise<RiskResult> {
  console.log(`🛡️ Risk Agent evaluating swap: ${input.fromToken} → ${input.toToken}`);
  const result = evaluateRisk(input);
  console.log(`   Risk: ${result.riskLevel} (score: ${result.riskScore}) → ${result.approved ? 'APPROVED' : 'REJECTED'}`);
  if (result.feedback.suggestions.length > 0) {
    result.feedback.suggestions.forEach(s => console.log(`   💡 ${s}`));
  }
  return result;
}
