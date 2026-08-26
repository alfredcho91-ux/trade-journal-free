import { TRADING_STYLE_OPTIONS, type TradingStyle } from './tradingStyle';
import { useSetTradingStyle, useTradingStyle } from '../../store/useStore';

export default function TradingStyleSelect({ isKo, onStyleChange }: { isKo: boolean; onStyleChange?: (style: TradingStyle) => void }) {
  const tradingStyle = useTradingStyle();
  const setTradingStyle = useSetTradingStyle();

  return (
    <label className="flex min-h-9 items-center gap-2 border border-dark-700 bg-dark-900/45 px-2.5 text-xs text-dark-400">
      <span className="whitespace-nowrap">{isKo ? '트레이딩 스타일' : 'Trading style'}</span>
      <select
        value={tradingStyle}
        onChange={(event) => {
          const nextStyle = event.target.value as TradingStyle;
          setTradingStyle(nextStyle);
          onStyleChange?.(nextStyle);
        }}
        className="min-w-0 bg-transparent font-medium text-dark-100 outline-none"
        aria-label={isKo ? '트레이딩 스타일 선택' : 'Select trading style'}
      >
        {TRADING_STYLE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id} className="bg-dark-900 text-dark-100">
            {isKo ? option.labelKo : option.labelEn}
          </option>
        ))}
      </select>
    </label>
  );
}
