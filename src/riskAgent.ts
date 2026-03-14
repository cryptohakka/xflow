/**
 * XFlow Risk Agent
 * Evaluates swap risk before execution
 */

export interface RiskInput {
  fromToken: string;
  toToken: string;
  amount: string;
  priceImpact: string;  // e.g. "-0.08%"
  estimateGasFee: string;
  route: string;
}

export interface RiskResult {
  approved: boolean;
  riskScore: number;    // 0-100 (低いほど安全)
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  recommendation: string;
}

const RISK_THRESHOLDS = {
  priceImpact: {
    low:    0.5,   // < 0.5% → LOW
    medium: 2.0,   // < 2.0% → MEDIUM
    high:   5.0,   // >= 5.0% → HIGH (reject)
  },
  amount: {
    medium: 100,   // > $100 → MEDIUM
    high:   1000,  // > $1000 → HIGH
  },
};

export function evaluateRisk(input: RiskInput): RiskResult {
  const reasons: string[] = [];
  let riskScore = 0;

  // 1. Price impact check
  const impact = Math.abs(parseFloat(input.priceImpact.replace('%', '')));
  if (impact >= RISK_THRESHOLDS.priceImpact.high) {
    riskScore += 60;
    reasons.push(`High price impact: ${input.priceImpact}`);
  } else if (impact >= RISK_THRESHOLDS.priceImpact.medium) {
    riskScore += 30;
    reasons.push(`Medium price impact: ${input.priceImpact}`);
  } else {
    riskScore += 5;
    reasons.push(`Low price impact: ${input.priceImpact}`);
  }

  // 2. Amount check
  const amount = parseFloat(input.amount);
  if (amount >= RISK_THRESHOLDS.amount.high) {
    riskScore += 30;
    reasons.push(`Large amount: $${amount}`);
  } else if (amount >= RISK_THRESHOLDS.amount.medium) {
    riskScore += 15;
    reasons.push(`Medium amount: $${amount}`);
  }

  // 3. Route check
  if (!input.route || input.route === 'Unknown') {
    riskScore += 20;
    reasons.push('Unknown route');
  }

  // 4. Gas fee check
  const gasFee = parseInt(input.estimateGasFee);
  if (gasFee > 1000000) {
    riskScore += 10;
    reasons.push(`High gas estimate: ${gasFee}`);
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

  return { approved, riskScore, riskLevel, reasons, recommendation };
}

export async function handleRiskCheck(input: RiskInput): Promise<RiskResult> {
  console.log(`🛡️ Risk Agent evaluating swap: ${input.fromToken} → ${input.toToken}`);
  const result = evaluateRisk(input);
  console.log(`   Risk: ${result.riskLevel} (score: ${result.riskScore}) → ${result.approved ? 'APPROVED' : 'REJECTED'}`);
  return result;
}
