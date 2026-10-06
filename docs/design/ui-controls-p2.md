# P2 컨트롤·대화상자·차트 UI 정리

검증일: 2026-10-06. **P2 완료, P3 미착수.** Commit/push하지 않았다.

## 감사와 범위

P0/P1 감사 문서, 현재 Git diff, CSS/Tailwind 토큰, 페이지와 feature 컴포넌트,
기존 custom dialog와 lightweight-charts/SVG 구현을 먼저 확인했다.
작업 시작 시점의 SHA-256으로 `App.tsx`, `tailwind.config.js`, P0/P1 문서가
그대로임을 확인했다. Git diff에 보이는 이 파일들의 변경은 기존 P0/P1 작업이다.
P0 팔레트·크기·타이포·focus·shadow 토큰 값과 P1 셸 폭/배치도 유지했다.

실제 문제와 수정:

- Playbook과 API 연결의 같은 역할 버튼/필드가 별도 padding, 글씨 크기,
  border, radius와 hover 스타일을 갖고 있었다. 기존 `.btn-primary`,
  `.btn-secondary`, native field 스타일을 재사용하고 중복 utility를 제거했다.
- 파괴적 작업과 작은 아이콘 버튼에는 재사용할 스타일이 없었다.
  `.btn-danger`와 `.btn-icon` 두 CSS 스타일만 추가했다. 기존 크기·radius·색상
  토큰을 사용하며 icon button은 32×32px, 닫기 아이콘은 16px다.
  Journal 삭제 버튼의 접근 가능한 이름도 보완했다. 삭제 처리 자체는 그대로다.
- P0 native field selector의 specificity가 Tailwind Preflight보다 낮아,
  중복 utility를 제거하면 label의 12px 글씨를 상속했다. selector 우선순위만
  조정해 P0의 13px, padding 5px/10px, 최소 높이 32px를 적용했다.
  명시적인 개별 utility는 계속 우선한다. 체크박스/toggle은 기존 표현과
  P0 전역 focus-visible을 유지하며 별도 component로 교체하지 않았다.
- 여러 custom dialog에 Tab containment, 일관된 초기 focus와 focus 복귀가
  없었다. 작은 `useDialogFocus` hook을 기존 dialog에 연결했다. 최상위 dialog만
  Escape/Tab을 처리하고 숨김·disabled 컨트롤을 제외한다. 중첩 창과 scroll lock을
  관리하며 기존 닫기/dirty/busy 정책을 호출한다. 새로운 wrapper나 라이브러리는 없다.
- 입력 창은 첫 입력, 확인 창은 취소/계속 편집, 읽기 창은 닫기에 초기 focus를 둔다.
  aria name/role과 닫기 label을 보완했다. 리포트의 미저장 확인 창이 열린 동안은
  뒤의 리포트를 접근성 트리에서 숨긴다. 기존 테스트는 수정하지 않았다.
- 기존 큰 그림자와 Plan drawer의 blur를 제거하고 P0 overlay shadow/border/radius를
  재사용했다. Edit Strategy에 필요한 세로 스크롤만 추가했다. 기존 dialog 폭,
  내부 grid, backdrop 클릭 처리와 P1 layout은 유지했다.
- 가격 canvas의 배경/grid/axis border와 축 글씨를 P0 토큰에 연결했다.
  SVG RSI/Stoch의 공통 정보·경고·상승·하락·기준선 색도 기존 토큰을 사용한다.
  차트 로딩/오류/빈 화면의 다른 배경색을 같은 표면으로 맞췄다.

수정하지 않은 영역: API·backend·데이터 모델·저장·거래소 동기화·차트 계산·
marker/zoom/tooltip 로직, 의미가 다른 전문 차트 이벤트 색상, 정상적인 전용 컨트롤,
브라우저 native confirm. 모바일 UX와 P3 작업도 추가하지 않았다.

## P2 파일 목록

제품 코드 16개, 새 행동 테스트 1개, 이 문서 1개다.

- `frontend/src/index.css`
- `frontend/src/hooks/useDialogFocus.ts`
- `frontend/src/hooks/useDialogFocus.test.tsx`
- `frontend/src/features/analytics/AnalyticsFilters.tsx`
- `frontend/src/features/journal/ExchangeConnectionModal.tsx`
- `frontend/src/features/journal/JournalSyncPanel.tsx`
- `frontend/src/features/journal/JournalViewTabs.tsx`
- `frontend/src/features/journal/TradeReportModal.tsx`
- `frontend/src/features/journal/UnsavedChangesDialog.tsx`
- `frontend/src/features/playbook/PlaybookDialogs.tsx`
- `frontend/src/features/planLab/PlanTradeDetailDrawer.tsx`
- `frontend/src/pages/JournalPage.tsx`
- `frontend/src/pages/PlaybookPage.tsx`
- `frontend/src/pages/PlanLabPage.tsx`
- `frontend/src/components/PositionReviewChart.tsx`
- `frontend/src/components/MiniChart.tsx`
- `frontend/src/components/StochMiniChart.tsx`
- `docs/design/ui-controls-p2.md`

## 검증

- Frontend `npm run lint`: 통과.
- Frontend `npx tsc --noEmit`: 통과.
- Frontend `npm test`: 48개 파일, 487개 테스트 통과.
  새 테스트 4개는 양방향 Tab, 초기 focus, 배경 focus 차단, Escape와 focus 복귀,
  중첩 확인/초안 유지/전체 닫기, 연결 창 busy guard와 최신 콜백을 검증한다.
  기존 리포트/Playbook/Plan 테스트도 그대로 통과했다.
- Frontend `npm run build`: 통과, production bundle 생성.
- Backend 전체 `venv/Scripts/python.exe -m pytest -q`: 1070개 통과,
  TA-Lib 미설치로 비교 테스트 1개 skip, 기존 의존성 deprecation 경고 211개.
  기존 테스트의 임시 데이터/credential 격리를 사용했다. backend 코드는 변경하지 않았다.
- 기존 CI의 core/route import, Plan Lab Target R:R isolation, release version guard:
  모두 통과. Windows 출력 인코딩 문제는 코드 수정 없이 Python `-X utf8`로 해결했다.
- Git `diff --check`: 통과.

실제 production preview의 가상 샘플 36건, viewport 높이 1000px 기준으로
Journal, 새 전략, 거래 리포트, Plan 입력 창을 세 폭에서 확인했다.

| 검증 폭 | Journal 문서 폭 | 헤더 높이 | Journal 콘텐츠 폭 | 새 전략 drawer 폭 |
|---|---:|---:|---:|---:|
| 768px | 760px | 56px | 728px | 약 584px |
| 1024px | 1016px | 56px | 792px | 약 778px |
| 1440px | 1432px | 56px | 1032px | 880px |

Journal 문서 폭의 8px 차이는 scrollbar다. P1 실측과 동일하다.
모달을 열면 body scroll이 잠기고 문서 폭은 각 viewport와 동일하다.
필드는 13px이며 가로 넘침이 없다. 중립 버튼과 focus ring을 직접 확인했다.

실제 키보드 확인:

- 새 전략 이름 초기 focus → Shift+Tab으로 닫기 → Shift+Tab으로 취소 →
  Tab으로 닫기 순환. disabled 생성 버튼은 건너뛴다.
- Escape로 깨끗한 창 닫기와 열기 버튼 focus 복귀.
- 저장하지 않은 임시 전략 이름 입력 → Escape로 미저장 확인 → 계속 편집 초기 focus →
  Escape로 확인 창만 닫기 → 초안 유지 → 임시 초안 버리기 → 여는 버튼 focus 복귀.
- 거래 리포트 닫기 초기 focus, Escape 닫기와 예시 열기 버튼 focus 복귀.
- Plan 입력 손절가 초기 focus, Shift+Tab이 dialog 내부로 이동,
  Escape로 변경 없는 창 닫기와 거래의 열기 버튼 focus 복귀.
- 위 샘플 제품 화면에서 수집된 console error/warn 없음.

샘플은 가격 캔들을 제공하지 않아 별도 로컬 fixture에 합성 OHLCV/지표를 넣고
**실제 변경한 차트 컴포넌트와 production CSS**를 렌더링했다. 세 폭에서
canvas 배경/axis/grid 및 SVG 색을 확인했으며 console error/warn은 없었다.
fixture는 `.cache/design-p2`의 Git ignored 파일이며 제품 기능이나 의존성이 아니다.
확인 후 fixture 서버를 종료하고 제품 미리보기는 유지했다.

스크린샷과 실측 JSON은 `.cache/design-p2`에 보관했다:
`journal-*`, `new-strategy-*`, `trade-report-*`, `plan-editor-*`,
`chart-fixture-*`, `nested-unsaved.jpg`, `shell-layout.json`, `dialog-layout.json`.
브라우저 viewport override는 검증 후 해제했다.

## 한계와 다음 단계

실시간 거래소·실제 credential 저장/삭제·실거래 데이터에서의 tooltip/zoom/marker,
스크린리더 실제 음성 출력은 검증하지 않았다. 차트 fixture 검증은 시각 통합에 한정한다.
TA-Lib 설치가 필요한 별도 CI 회귀 비교는 이 환경에서 수행되지 않았다.
데이터가 필요한 공식 계획 분석의 모든 modal 조합을 브라우저에서 열지는 못했으며,
기존 전체 테스트와 새 중첩 focus 테스트를 함께 사용했다.
기존 native confirm은 제품 정책/동작을 바꾸지 않도록 유지했다.

P3는 시작하지 않았다. 추가 작업은 별도 범위 확인 후 진행한다.
Git은 `main`, HEAD `b4e9b54`, upstream 앞/뒤 0/0이며,
P0/P1 변경을 포함한 현재 작업 트리를 commit/push하지 않았다.
