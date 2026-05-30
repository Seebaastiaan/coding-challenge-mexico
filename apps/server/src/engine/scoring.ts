export function scoreOpportunity(input: {
  netProfit: number;
  grossProfit: number;
  slippage: number;
  latencyMs: number;
  volume: number;
  minAvailableVolume: number;
}) {
  const profitScore = Math.min(Math.max(input.netProfit / 25, 0), 1) * 42;
  const spreadScore = Math.min(Math.max(input.grossProfit / 40, 0), 1) * 18;
  const liquidityRatio = input.minAvailableVolume / Math.max(input.volume, 0.00000001);
  const liquidityScore = Math.min(liquidityRatio / 12, 1) * 18;
  const latencyScore = Math.max(0, 1 - input.latencyMs / 1_500) * 12;
  const slippagePenalty = Math.min(Math.max(input.slippage / Math.max(input.netProfit, 1), 0), 1) * 16;
  const riskPenalty = input.netProfit < 0 ? 25 : 0;

  return Math.round(Math.max(0, Math.min(100, profitScore + spreadScore + liquidityScore + latencyScore - slippagePenalty - riskPenalty)));
}
