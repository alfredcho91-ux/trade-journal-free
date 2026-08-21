# Architecture

Trade Journal Free는 저널과 거래 분석에 필요한 경로만 남긴 React/FastAPI 애플리케이션입니다.

```text
Browser
  -> React: /journal, /trade-analysis
  -> /api
FastAPI
  -> journal: 저장·MFE/MAE·품질·손절·SL/TP 분석
  -> exchanges: 공통 거래소 목록·읽기 전용 동기화
     -> deepcoin: native 종료 포지션·TP 마커
     -> ccxt: Binance·Bybit·OKX 체결 및 포지션 재구성
  -> indicators: Binance 거래 복기 차트·VPVR·VWAP
  -> core: RSI·MACD·Stochastic·ADX·VPVR 계산
  -> journal/trade_journal.db
```

## 프런트엔드

- `frontend/src/App.tsx`: 두 화면, 코인 선택, 언어 전환만 제공
- `frontend/src/pages/JournalPage.tsx`: 거래소 선택·동기화와 종료 거래 목록
- `frontend/src/pages/TradeAnalysisPage.tsx`: 승패·품질·손절·SL/TP 분석
- `frontend/src/features/journal/`: 기간·수익률·리포트 조립
- `frontend/src/features/tradeAnalysis/`: 브라우저 집계와 분석 UI
- `frontend/src/components/PositionReviewChart.tsx`: Lightweight Charts 가격 차트

## 백엔드

- `backend/modules/exchanges/`: 거래소 레지스트리, 공통 API 계약, CCXT 동기화
- `backend/modules/deepcoin/`: Deepcoin 고유 서명 API와 TP/SL 주문 상세
- `backend/modules/journal/`: SQLite 저장소와 분석 서비스
- `backend/modules/indicators/`: 거래 리포트와 시장 지표
- `backend/utils/data_service.py`: Binance Spot OHLCV 조회와 캐시
- `core/indicator_pipelines.py`: 공용 지표 계산
- `core/vpvr.py`: kline 기반 Volume Profile

`backend/main.py`는 저널, 거래소, Deepcoin 고유 기능, 지표 라우터만 등록합니다. AI, 백테스트, 스캐너, 전략 분석 라우터는 무료판에 포함하지 않습니다.

## 보안 경계

- 모든 거래소 자격 증명은 서버의 환경 변수로만 읽습니다.
- API 응답은 키·secret·passphrase를 반환하지 않습니다.
- 거래소 동기화는 체결·포지션·주문 이력의 읽기 전용 endpoint만 사용합니다.
- production은 HTTP Basic Auth 설정 없이는 시작하지 않습니다.
- Docker 기본 포트는 localhost에만 바인딩합니다.

## 분석 시점

진입 feature는 진입 전에 완료된 candle만 사용합니다. 거래 종료 이후 데이터는 MFE/MAE, 추가 홀딩, 가상 청산, 손절 사후 분석에만 사용해 look-ahead bias가 진입 분석에 섞이지 않도록 분리합니다.
