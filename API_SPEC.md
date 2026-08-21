# API

| Method | Endpoint | 설명 |
| --- | --- | --- |
| GET | `/api/health` | 서비스 상태 |
| GET | `/api/journal` | 저장된 종료 거래와 내부 체결 조회 |
| DELETE | `/api/journal/{entry_id}` | 저널 기록 삭제 |
| GET | `/api/journal/excursions` | 거래별 15분봉 MFE/MAE |
| GET | `/api/journal/current-market` | 현재 시장 스냅샷과 유사 거래 비교 입력 |
| GET | `/api/journal/quality-analysis` | MTF Regime과 진입·청산 품질 |
| GET | `/api/journal/stop-loss-analysis` | 실제 손절 이후 4H 사후 분석 |
| GET | `/api/journal/stop-optimization` | 고정%·ATR Stop 후보 비교 |
| GET | `/api/journal/sl-tp-analysis` | 5분봉 SL/TP 조합 시뮬레이션 |
| GET | `/api/deepcoin/status` | 자격 증명 설정 여부만 반환 |
| POST | `/api/deepcoin/sync` | 읽기 전용 체결·종료 포지션 동기화 |
| GET | `/api/deepcoin/trade-markers` | 실제 발동 TP 마커 조회 |
| GET | `/api/exchanges` | 지원 거래소와 읽기 전용 연결 상태 |
| POST | `/api/exchanges/{exchange_id}/credentials` | 연결 확인 후 로컬 읽기 전용 자격 증명 저장 |
| POST | `/api/exchanges/{exchange_id}/sync` | 선택 거래소 체결·종료 포지션 동기화 |
| GET | `/api/indicators/trade-report/{coin}/{interval}` | 거래 복기 캔들과 지표 |
| GET | `/api/indicators/projection` | RSI 가격대와 VWAP |
| GET | `/api/indicators/vpvr/{coin}/{interval}` | Binance kline 기반 VPVR |
| GET | `/api/indicators/vpvr-source/{coin}/{interval}` | VPVR 입력 데이터 검증 |

실행 중 상세 요청/응답 계약은 `http://localhost:8000/docs`에서 확인합니다.
