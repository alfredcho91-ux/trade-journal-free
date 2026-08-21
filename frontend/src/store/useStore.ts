import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_MARKET_COIN, isMarketCoin } from '../constants/market';
import type { Coin, Language } from '../types';

interface AppState {
  language: Language;
  selectedCoin: Coin;
  setLanguage: (language: Language) => void;
  setSelectedCoin: (coin: Coin) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      language: 'ko',
      selectedCoin: DEFAULT_MARKET_COIN,
      setLanguage: (language) => set({ language }),
      setSelectedCoin: (selectedCoin) => set({ selectedCoin }),
    }),
    {
      name: 'trade-journal-free-settings',
      partialize: ({ language, selectedCoin }) => ({ language, selectedCoin }),
      merge: (persisted, current) => {
        const incoming = (persisted as Partial<AppState>) ?? {};
        return {
          ...current,
          language: incoming.language === 'en' ? 'en' : 'ko',
          selectedCoin: isMarketCoin(incoming.selectedCoin)
            ? incoming.selectedCoin
            : current.selectedCoin,
        };
      },
    },
  ),
);

export const useLanguage = () => useStore((state) => state.language);
export const useSelectedCoin = () => useStore((state) => state.selectedCoin);
export const useSetLanguage = () => useStore((state) => state.setLanguage);
export const useSetSelectedCoin = () => useStore((state) => state.setSelectedCoin);
