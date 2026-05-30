import type { ExchangeName } from "../types.js";

export function calculateProfit(input: {
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  buyPrice: number;
  sellPrice: number;
  volume: number;
  availableAskVolume: number;
  availableBidVolume: number;
}) {
  const buyCost = input.buyPrice * input.volume;
  const sellIncome = input.sellPrice * input.volume;
  const grossProfit = sellIncome - buyCost;

  return {
    grossProfit,
    netProfit: grossProfit,
    fees: 0,
    slippage: 0
  };
}
