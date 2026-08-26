import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_MARKET_COIN, isMarketCoin } from '../constants/market';
import { isTradingStyle, type TradingStyle } from '../features/preferences/tradingStyle';
import type { Coin, Language } from '../types';

interface AppState {
  language: Language;
  selectedCoin: Coin;
  tradingStyle: TradingStyle;
  setLanguage: (language: Language) => void;
  setSelectedCoin: (coin: Coin) => void;
  setTradingStyle: (style: TradingStyle) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      language: 'ko',
      selectedCoin: DEFAULT_MARKET_COIN,
      tradingStyle: 'auto',
      setLanguage: (language) => set({ language }),
      setSelectedCoin: (selectedCoin) => set({ selectedCoin }),
      setTradingStyle: (tradingStyle) => set({ tradingStyle }),
    }),
    {
      name: 'trade-journal-free-settings',
      partialize: ({ language, selectedCoin, tradingStyle }) => ({ language, selectedCoin, tradingStyle }),
      merge: (persisted, current) => {
        const incoming = (persisted as Partial<AppState>) ?? {};
        return {
          ...current,
          language: incoming.language === 'en' ? 'en' : 'ko',
          selectedCoin: isMarketCoin(incoming.selectedCoin)
            ? incoming.selectedCoin
            : current.selectedCoin,
          tradingStyle: isTradingStyle(incoming.tradingStyle)
            ? incoming.tradingStyle
            : current.tradingStyle,
        };
      },
    },
  ),
);

export const useLanguage = () => useStore((state) => state.language);
export const useSelectedCoin = () => useStore((state) => state.selectedCoin);
export const useTradingStyle = () => useStore((state) => state.tradingStyle);
export const useSetLanguage = () => useStore((state) => state.setLanguage);
export const useSetSelectedCoin = () => useStore((state) => state.setSelectedCoin);
export const useSetTradingStyle = () => useStore((state) => state.setTradingStyle);
