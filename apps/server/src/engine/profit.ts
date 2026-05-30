import { EXCHANGE_FEES } from "../config.js";
import type { ExchangeName } from "../types.js";

export function estimateSlippage(price: number, volume: number, availableVolume: number) {
  const pressure = availableVolume <= 0 ? 1 : Math.min(volume / availableVolume, 1);
  return price * volume * pressure * 0.00035;
}

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
  const buyFee = buyCost * EXCHANGE_FEES[input.buyExchange];
  const sellFee = sellIncome * EXCHANGE_FEES[input.sellExchange];
  const slippage =
    estimateSlippage(input.buyPrice, input.volume, input.availableAskVolume) +
    estimateSlippage(input.sellPrice, input.volume, input.availableBidVolume);
  const grossProfit = sellIncome - buyCost;
  const fees = buyFee + sellFee;
  const netProfit = grossProfit - fees - slippage;

  return {
    grossProfit,
    netProfit,
    fees,
    slippage
  };
}
