# Trade Journal Free Core File Map

이 문서는 거래 데이터, 분석, 계획, 화면을 수정할 때 영향 범위를 먼저 확인하기 위한 위험도 지도다.
코드 구조를 바꾸거나 계산식을 재정의하는 문서가 아니며, 현재 구현을 기준으로 작성한다.

## 1. 전체 흐름

```text
거래소 API
  -> exchanges/ccxt_adapter.py 또는 deepcoin/service.py
  -> exchanges/execution_repository.py (원시 체결 원장)
  -> exchanges/reconstruction.py (포지션 lifecycle 재구성)
  -> journal/repository.py (종료 거래 저장)
  -> journal 분석 서비스 / plan_lab 분석
  -> FastAPI router
  -> frontend API client / page / chart
```

매매 분석용 시장 데이터는 `journal/market_data.py`에서 Binance USDT-M Futures OHLCV로 통일한다.

## 2. CRITICAL 파일

| Path | Risk | 책임 / 입출력 | 주요 소비자 | 보호해야 할 불변조건 |
| --- | --- | --- | --- | --- |
| `backend/modules/exchanges/reconstruction.py` | 5 | 정규화된 fill을 LONG/SHORT 포지션 lifecycle, 추가 진입, 부분 청산, 전량 청산, reversal로 재구성 | `sync_service.py`, `exchanges/service.py` | 같은 포지션의 추가 진입·부분 청산은 같은 lifecycle, flat 후 재진입은 새 lifecycle, 불확실한 최초 lifecycle은 제외 |
| `backend/modules/exchanges/execution_repository.py` | 5 | 원시 체결 원장의 SQLite 저장·중복 제거·복원 | `sync_service.py`, `reconstruction.py` | external ID/account scope 중복 방지, 원시 fill과 종료 journal 분리 |
| `backend/modules/journal/repository.py` | 5 | 종료 거래, 사용자 기록, 거래 ID, import row의 영속화와 조회 | 모든 journal 분석, Plan Lab | 종료 거래만 공식 분석에 포함, 사용자 annotation이 동기화로 덮어써지지 않음 |
| `backend/modules/plan_lab/repository.py` | 5 | Plan, immutable Revision, 거래 Link 저장과 상태 전이 | `plan_lab/analysis.py`, `PlanLabPage.tsx` | Actual Entry와 Planned Entry 분리, Revision 불변, stable link, atomic save, IN_TRADE 검증 |
| `backend/modules/plan_lab/analysis.py` | 5 | 계획 SL/TP 경로, Plan R, Actual/Plan Delta, Attribution, Optimizer 계산 | `plan_lab/router.py`, Plan Lab UI | `NOT_EVALUABLE`과 0 구분, 실제 entry만 execution-only에 사용, 미래 데이터로 계획 의미 오염 금지 |
| `backend/modules/deepcoin/snapshot.py` | 5 | 이벤트 시점의 완료봉 기반 RSI/MACD/Stoch/VWAP/VPVR/RVOL20 snapshot 생성 | 동기화, 거래 리포트, 분석 | 이벤트 이전 완료봉만 사용, 진입 봉 최종 거래량 사용 금지, missing과 0 구분 |

### CRITICAL 수정 후 필수 테스트

- `backend/tests/test_binance_position_lifecycle.py`
- `backend/tests/test_open_trades_focused_qa.py`
- `backend/tests/test_plan_lab_repository.py`
- `backend/tests/test_plan_lab_analysis.py`
- `backend/tests/test_volume_readiness.py`
- `backend/tests/test_journal_quality_analysis.py`

## 3. CORE 파일

| Path | Risk | 책임 |
| --- | --- | --- |
| `backend/modules/exchanges/sync_service.py` | 4 | CCXT 거래·funding 수집, 원장 저장, lifecycle 재구성, snapshot 생성, journal upsert |
| `backend/modules/exchanges/ccxt_adapter.py` | 4 | Binance 거래 조회, pagination/window, fee 정규화, Binance funding 조회 |
| `backend/modules/exchanges/service.py` | 4 | credential 기반 거래소 client, 현재 open position 조회, sync orchestration |
| `backend/modules/deepcoin/service.py` | 4 | Deepcoin fill/position API, Deepcoin journal 저장과 snapshot 연결 |
| `backend/modules/journal/market_data.py` | 4 | 모든 journal 분석의 Binance USDT-M Futures OHLCV source와 volume metadata |
| `backend/modules/journal/trade_selection.py` | 4 | 종료 거래, 시간 범위, 방향, 순수익률 scope의 공통 선택 |
| `backend/modules/journal/performance.py` | 4 | 기간 수익률·순손익·승률·PF·방향/종목 집계 |
| `backend/modules/journal/analysis.py` | 4 | 진입 후 최대 유리/불리 움직임과 trade path |
| `backend/modules/journal/quality_analysis.py` | 4 | 진입 시점 Regime, 지표, 진입/청산 품질 집계 |
| `backend/modules/journal/behavior_analysis.py` | 4 | Setup/Mistake, Biggest Leak, rule compliance, 공식 quality 재사용 |
| `backend/modules/journal/market_context.py` | 4 | Weekly/Daily/4H 등 완료봉 시장상황 frame 준비 |
| `backend/modules/journal/quality_market.py` | 4 | 시장상황·추세·추가보유·품질 계산 primitive |
| `backend/modules/journal/exit_hold_analysis.py` | 4 | 종료 이후 선택 봉 수 추가보유 결과 |
| `backend/modules/journal/stop_loss_analysis.py` | 4 | 손절 후 4H 사후 분류 |
| `backend/modules/journal/stop_optimization.py` | 4 | 과거 거래 기반 stop 후보 비교 |
| `backend/modules/journal/sl_tp_analysis.py` | 4 | OHLCV 경로 기반 SL/TP 조합 재생 |
| `backend/modules/journal/current_market.py` | 3 | 현재 완료봉 snapshot과 과거 유사 거래 기준 |
| `backend/modules/journal/router.py` | 3 | journal 분석 API의 타입 검증·서비스 연결 |

이 영역은 FE에서 다시 계산하지 않고 공식 service 결과를 확장·표시한다.
분석 서비스는 공통 `trade_selection.py`, `market_data.py`, snapshot 결과를 재사용해야 한다.

## 4. UI 파일

| Path | Risk | 책임 / 주의점 |
| --- | --- | --- |
| `frontend/src/pages/JournalPage.tsx` | 3 | 매매일지 기간 필터, KPI, 캘린더, 거래 목록, 거래 리포트 연결 |
| `frontend/src/pages/TradeAnalysisPage.tsx` | 3 | 한눈에 보기·상세 분석 orchestration, 전역 filter, query 상태 |
| `frontend/src/pages/TradeExplorerPage.tsx` | 3 | evidence 거래 목록, 필터 결과, 거래별 복기 진입 |
| `frontend/src/pages/PlanLabPage.tsx` | 3 | 진행중/종료 계획 입력, Plan 상태, 저장 race/error UX |
| `frontend/src/features/journal/TradeReportModal.tsx` | 2 | 개별 거래 가격·지표·진입/청산 리포트 |
| `frontend/src/features/journal/DailyPnlCalendar.tsx` | 2 | 월간 손익 캘린더 표시 |
| `frontend/src/features/tradeAnalysis/TradeQualityAnalysis.tsx` | 3 | 공식 quality 결과 표시와 근거 거래 drill-down |
| `frontend/src/features/tradeAnalysis/TradeBehaviorAnalysis.tsx` | 3 | 공식 behavior 결과, Setup/Mistake/규칙 표시 |
| `frontend/src/features/tradeAnalysis/TradeExitReviewPanel.tsx` | 2 | 실제 청산과 추가보유 결과 시각화 |
| `frontend/src/features/tradeAnalysis/AnalysisVisualizations.tsx` | 2 | MFE/MAE·청산 관련 그래프 표시 |
| `frontend/src/features/planLab/PlanTradeDetailDrawer.tsx` | 2 | Plan 입력 전 hindsight 정보 차단과 거래 상세 |

UI 파일에서 공식 통계를 재산출하거나 실제 snapshot을 임의 보정하면 CORE/CRITICAL 위험으로 승격한다.

## 5. SUPPORT 파일

| Path | Risk | 책임 |
| --- | --- | --- |
| `frontend/src/api/journal.ts` | 3 | journal/analysis API client와 응답 타입 연결 |
| `frontend/src/api/client.ts` | 3 | 공통 HTTP client와 오류 처리 |
| `frontend/src/types/journal.ts` | 3 | backend 응답 TypeScript contract |
| `frontend/src/types/planLab.ts` | 3 | Plan/Revision/Link contract |
| `backend/modules/journal/schemas.py` | 3 | API response/query Pydantic schema |
| `backend/modules/plan_lab/schemas.py` | 3 | Plan API schema와 source/status contract |
| `backend/modules/exchanges/credentials.py` | 4 | Keychain/encrypted DB credential resolution과 삭제 |
| `backend/modules/exchanges/keyring_store.py` | 4 | OS credential store |
| `backend/modules/exchanges/encrypted_store.py` | 4 | AES-GCM encrypted credential DB |
| `backend/config/settings.py` | 4 | DB/cache/app data 경로와 환경 설정 |
| `backend/desktop.py` | 3 | local server lifecycle, port, browser launch |
| `packaging/build_windows_app.ps1` | 3 | Windows x64 PyInstaller 배포 ZIP 생성 |
| `packaging/build-msix.ps1` | 3 | Windows ZIP을 MSIX staging으로 변환 |
| `packaging/sign_windows_artifact.ps1` | 4 | 선택적 Windows code signing 정책 |
| `.github/workflows/windows-package.yml` | 3 | Windows build artifact/release workflow |
| `scripts/check_release_versions.py` | 2 | 앱·문서·release version guard |
| `README.md`, `ARCHITECTURE.md`, `SECURITY.md` | 2 | 실제 구현·운영·보안 정책 문서 |

현재 저장소에는 `migrations/` 디렉터리가 없다. SQLite schema 보정은 각 repository의 `_ensure_schema` 경로에 있다.

## 6. TEST 파일

핵심 lifecycle과 계획 의미:

- `backend/tests/test_binance_position_lifecycle.py`
- `backend/tests/test_open_trades_focused_qa.py`
- `backend/tests/test_plan_lab_repository.py`
- `backend/tests/test_plan_lab_analysis.py`
- `backend/tests/test_journal_service.py`

시장 데이터·지표:

- `backend/tests/test_journal_market_data.py`
- `backend/tests/test_volume_readiness.py`
- `backend/tests/test_vpvr_source.py`
- `backend/tests/test_journal_quality_market.py`

분석 회귀:

- `backend/tests/test_journal_performance.py`
- `backend/tests/test_journal_analysis.py`
- `backend/tests/test_journal_quality_analysis.py`
- `backend/tests/test_journal_behavior_analysis.py`
- `backend/tests/test_journal_stop_loss_analysis.py`
- `backend/tests/test_journal_stop_optimization.py`
- `backend/tests/test_journal_sl_tp_analysis.py`

프론트 회귀:

- `frontend/src/pages/PlanLabPage.test.tsx`
- `frontend/src/features/journal/DailyPnlCalendar.test.ts`
- `frontend/src/features/journal/journalPeriod.test.ts`
- `frontend/src/features/journal/tradeReportSnapshot.test.ts`
- `frontend/src/features/tradeAnalysis/*.test.ts`

## 7. 핵심 불변조건 연결

| 불변조건 | 보호 파일 |
| --- | --- |
| Actual Entry != Planned Entry | `plan_lab/repository.py`, `plan_lab/analysis.py`, `PlanLabPage.tsx` |
| VERIFIED_PRETRADE는 서버 수신 시각이 최초 실제 Entry보다 빠를 때만 | `plan_lab/repository.py`, `plan_lab/router.py`, `test_plan_lab_repository.py` |
| Revision은 immutable, link는 stable/idempotent | `plan_lab/repository.py`, `test_plan_lab_repository.py` |
| Plan 저장 실패 시 orphan Plan/Revision/Link 없음 | `plan_lab/repository.py` transaction 경로, repository tests |
| OPEN은 종료 Quant에서 제외 | `trade_selection.py`, 각 journal analysis service |
| Target R:R != Official Plan R | `plan_lab/analysis.py`, `scripts/check_plan_lab_target_rr_isolation.py` |
| TP2 있으면 50/50, TP2 없으면 legacy TP1 100% | `plan_lab/analysis.py`, `test_plan_lab_analysis.py` |
| NOT_EVALUABLE != 0, missing != 0 | `plan_lab/analysis.py`, `deepcoin/snapshot.py`, market data tests |
| 진입 분석에 look-ahead 없음 | `deepcoin/snapshot.py`, `quality_market.py`, `market_context.py` |
| MFE/MAE·추가보유·손절 사후 데이터는 진입 feature와 분리 | `analysis.py`, `exit_hold_analysis.py`, `stop_loss_analysis.py` |
| 원시 fill 종료값만으로 OPEN을 판정하지 않음 | `exchanges/service.py`, `reconstruction.py`, lifecycle tests |
| Binance lifecycle deterministic, Deepcoin position identity stable | `reconstruction.py`, `deepcoin/service.py`, sync tests |
| Binance USDT-M Futures OHLCV 단일 source | `journal/market_data.py`, `test_journal_market_data.py` |
| RVOL20은 직전 완료봉 / 그 이전 20개 완료봉 평균 | `deepcoin/snapshot.py`, `test_volume_readiness.py` |
| API credential은 frontend/localStorage/log에 노출하지 않음 | `credentials.py`, `keyring_store.py`, `encrypted_store.py`, redaction tests |

## 8. 변경 권장 순서

1. CRITICAL 파일과 관련 테스트를 먼저 읽고 fixture를 추가한다.
2. CORE 서비스의 공식 집계와 API contract를 확인한다.
3. UI에서는 기존 API 값을 표시하고, 필터·상태·드릴다운만 연결한다.
4. `backend/venv/bin/python -m pytest -q backend/tests`, `npm test`, `npm run lint`, `npm run build`를 실행한다.
5. `git diff --check`와 secret/package 검사를 완료한 뒤에만 commit/release를 검토한다.

## 9. 조사 결과

- 첨부된 분류 기준은 현재 repository 구조와 일치한다.
- 문서와 실제 코드의 차이: Setup은 stable ID가 아니라 Revision별 문자열 snapshot이다.
- `migrations/` 디렉터리는 없으며 repository의 schema ensure/migration 경로가 대신한다.
- 현재 작업에서는 신규 기능, 리팩터링, rename, 계산식 변경을 수행하지 않았다.
