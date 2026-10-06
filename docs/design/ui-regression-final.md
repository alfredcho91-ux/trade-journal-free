# P0–P4 final regression audit

검증일: 2026-10-06 (Asia/Seoul). 비교 기준: HEAD `b4e9b54`와 전체 working tree.
이번 단계는 최종 감사이며 새로운 UI 개선이나 P5를 시작하지 않았다.
확인된 중첩 dialog regression 1건만 수정했다. Commit/push하지 않았다.

## Final status

검증한 범위에서 미해결 UI release blocker는 없다. 실제 browser zoom 200%,
실시간 거래소/가격 데이터 및 실제 credential/persistence는 미검증이다.
따라서 모든 환경의 릴리스 수락 검증을 완료했다는 의미는 아니다.

감사 전 P0–P4는 28개 파일(제품 22, 테스트 1, 문서 5)이었다.
이번에 제품 1개와 기존 테스트 1개, 감사 문서 1개를 추가로 변경했다.
최종 HEAD 대비 **31개 파일: 제품 23, 테스트 2, 문서 6**.
Untracked 파일도 포함하며 ignored `.cache`와 build output은 제외한다.

## 전체 변경 분류 / 단계

복수 범주·단계가 적용되는 파일은 한 행에 함께 기록한다. 아래 제품 경로는 `frontend/` 기준이다.

| 파일 | 분류 | 단계 / 범위 |
|---|---|---|
| `src/index.css` | DESIGN SYSTEM / CONTROLS / ACCESSIBILITY | P0 중앙 토큰·평면 표면·focus; P2 danger/icon 버튼·native field specificity |
| `tailwind.config.js` | DESIGN SYSTEM | P0 palette/foreground·typography·radius·shadow 연결 |
| `src/App.tsx` | LAYOUT | P1 56px header·1600px shell·176px 양옆·내부 nav scroll |
| `src/components/MiniChart.tsx` | DESIGN SYSTEM | P2 SVG 색·기준선 토큰; 계산·조건 동일 |
| `src/components/StochMiniChart.tsx` | DESIGN SYSTEM | P2 SVG 선·histogram·marker 색 토큰 |
| `src/components/PositionReviewChart.tsx` | DESIGN SYSTEM | P2 canvas 표면·grid·축·font 토큰 |
| `src/features/analytics/AnalyticsFilters.tsx` | CONTROLS / ACCESSIBILITY | P2 중복 field 스타일 제거 |
| `src/features/analytics/AnalyticsResults.tsx` | SCREEN HIERARCHY / ROBUSTNESS | P3 숫자 정렬·표 글씨; P4 긴 이름/값/단위 wrapping |
| `src/features/journal/ExchangeConnectionModal.tsx` | CONTROLS / ACCESSIBILITY | P2 focus·busy guard·버튼·field·dialog 내부 scroll |
| `src/features/journal/JournalSyncPanel.tsx` | CONTROLS / ACCESSIBILITY | P2 기존 버튼·native control 재사용 |
| `src/features/journal/JournalViewTabs.tsx` | CONTROLS / ACCESSIBILITY | P2 기존 btn 스타일; 탭/dirty 처리 동일 |
| `src/features/journal/TradeReportModal.tsx` | CONTROLS / ACCESSIBILITY / SCREEN HIERARCHY / ROBUSTNESS | P2 focus·chart fallback 표면; P3 chart 가용성 배치·native details; P4 긴 symbol |
| `src/features/journal/UnsavedChangesDialog.tsx` | CONTROLS / ACCESSIBILITY | P2 중복 Escape/focus effect를 공통 hook으로 대체 |
| `src/features/journal/StrategyAssignmentEditor.tsx` | CONTROLS / ACCESSIBILITY | **이번 감사: P2 중첩 제거 확인창 등록 누락 regression 수정** |
| `src/features/onboarding/WorkspaceExperience.tsx` | SCREEN HIERARCHY | P3 sample 안내 접기; 생성/전환/라우팅 그대로 |
| `src/features/planLab/PlanTradeDetailDrawer.tsx` | CONTROLS / ACCESSIBILITY | P2 focus·aria·dialog surface |
| `src/features/playbook/PlaybookDialogs.tsx` | CONTROLS / ACCESSIBILITY / SCREEN HIERARCHY / ROBUSTNESS | P2 focus·control; P3 rule group reflow; P4 긴 버전 subtitle |
| `src/features/playbook/RuleEvaluatorEditor.tsx` | SCREEN HIERARCHY | P3 evaluator control 세로 배치; schema/authoring 동일 |
| `src/hooks/useDialogFocus.ts` | CONTROLS / ACCESSIBILITY / ROBUSTNESS | P2 stack·focus·body scroll; P4 같은 거래 visible opener fallback |
| `src/pages/HoldReentryPage.tsx` | ROBUSTNESS | P4 긴 금융 값 내부 scroll; 계산/formatter 동일 |
| `src/pages/JournalPage.tsx` | CONTROLS / ACCESSIBILITY / SCREEN HIERARCHY / ROBUSTNESS | P2 삭제 이름/버튼; P3 KPI 요약·접기·pending/error; P4 opener 식별 속성 |
| `src/pages/PlanLabPage.tsx` | CONTROLS / ACCESSIBILITY / SCREEN HIERARCHY | P2 dialog focus·field; P3 KPI·금융 숫자 정렬 |
| `src/pages/PlaybookPage.tsx` | CONTROLS / ACCESSIBILITY | P2 버튼·confirm/edit focus·세로 scroll |
| `src/hooks/useDialogFocus.test.tsx` | TEST | P2 4개 시나리오 + P4 visible opener 2개 |
| `src/features/journal/TradeReportModal.assignment.test.tsx` | TEST | 이번 감사: 실제 Report+Assignment 제거 확인창 regression 2개 추가 |

DOCUMENTATION 6개:

- `docs/design/ui-audit-p0.md`: P0 감사·전체 roadmap·토큰 기준
- `docs/design/ui-shell-p1.md`: P1
- `docs/design/ui-controls-p2.md`: P2
- `docs/design/ui-screens-p3.md`: P3
- `docs/design/ui-robustness-p4.md`: P4
- `docs/design/ui-regression-final.md`: 이번 최종 감사

어느 단계에도 속하지 않는 제품 변경은 발견하지 않았다. 최종 수정은 P2 접근성
통합의 누락 보완이며 새로운 디자인 단계가 아니다. 기존 P0–P4 문서는 수정하지 않았다.

## Functional regression audit

전체 diff와 실제 컴포넌트를 검토하고 TypeScript AST로 변경 파일의 query/mutation,
기존 event handler, state/memo/effect, 금융 표시 호출을 HEAD와 정규화 비교했다.
증거는 ignored `.cache/design-final/semantic-audit.json`이다. AST 비교는 특정 표현의
변경 탐지 보조 수단이며 실행 검증이나 완전한 의미적 동등성 증명을 대신하지 않는다.

- 제품의 **37개 `useQuery`/`useMutation` 호출과 268개 JSX event handler 표현이 동일**하다.
  Query key, enabled, retry, staleTime, mutation payload, cache 갱신 및 save/delete handler를 유지한다.
- Router/context, API/client/types/store, backend/core, package manifest/lock은 HEAD와 동일하다.
  메뉴 경로·navigate callback·선택 코인/언어 상태·권한/authority 의미를 유지한다.
- Analytics/Hold 계산, formatter 정의, 숫자·결측·부호·단위는 그대로다.
  Journal 핵심 승률은 기존 중복 요약의 2자리 표시를 남겼고 같은 server 값을 사용한다.
  기존 1자리 카드와 2자리 중복 카드 중 후자를 보존한 표시 통합이며 계산 변경이 아니다.
- Journal 기간/거래 필터와 trading-style metric 상대 순서, Analytics 정렬·표/막대 전환,
  Plan의 목록·분석 실행 의미, sample workspace 생성/전환/초기 안내는 동일하다.
- P3 native `details`의 자식은 접혀도 계속 마운트된다. 초안/query를 새로 초기화하지 않는다.
  `hasPriceChart`는 className 배치에만 사용하며 chart/query 마운트 조건과 데이터는 바꾸지 않는다.
- Canvas effect의 차이는 token 해석·표면/grid/axis/font뿐이다. 캔들/series/marker,
  가격 축·수평 zoom·drag·crosshair·ResizeObserver와 effect dependency를 유지한다.
- P2는 Escape/초기 focus/Tab을 의도적으로 추가한다. 기존 닫기·dirty·busy callback을 재사용하며,
  확인창이 부모 keyboard handler를 잘못 호출하는 아래 1건은 이번에 수정했다.

### 확인하고 수정한 regression

**Trade Report → 전략 제거 확인창의 keyboard 소유권 누락.**

제거 확인창 `RemoveAssignmentDialog`는 기존 구현 그대로 남아 있었지만 부모
Trade Report에는 P2 focus/Escape hook이 추가됐다. 실제 최종 production preview에서
제거 확인창을 열면 focus가 뒤의 '전략 제거' 버튼에 남았다. Escape를 누르면
부모가 닫혀 확인창과 리포트가 함께 사라졌다. 제거 mutation pending 중에도
부모 close callback이 호출됨을 새 통합 테스트로 확인했다.

최소 수정:

- 기존 제거 확인창에 `useDialogFocus`/ref/`tabIndex=-1`만 연결한다.
- 기존 취소 버튼을 안전한 초기 focus로 지정한다.
- pending 동안 Escape 취소를 막는다. 일반 취소·제거 버튼의 disabled와 mutation은 그대로다.
- 새 스타일, 상태, wrapper, 계산·API 처리나 persistence 변경은 없다.

추가 테스트 2개는 실제 `TradeReportModal`과 `StrategyAssignmentEditor`를 함께 렌더링한다.
수정 전 둘 다 실패했다(initial focus 불일치, pending 중 부모 close 호출).
기존 테스트를 수정/완화하지 않고, 새 테스트의 타입 오류만 바로잡았다.
기존 5초 timeout과 assertions를 유지한다.

## Complexity / design system review

수정이 필요한 별도 복잡성 문제는 발견하지 않았다.

- 공통 dialog hook은 중첩 dialog stack, body overflow restoration과 latest busy callback을
  한 곳에서 처리하므로 실제 중복/버그 위험을 줄인다. Escape ref/effect는 rerender 때
  초안 입력 focus를 초기화하지 않으면서 최신 정책을 호출하기 위해 필요하다.
- P3 `primary`/`collapsible`는 기존 helper의 작은 표시 옵션이다. 새 wrapper hierarchy가 없다.
  `hasPriceChart`, 금융 value span, 동일 trade opener key는 확인된 레이아웃/포커스 문제에 한정한다.
- 새 query, mutation, 비즈니스 상태, 불필요한 effect, viewport JS 분기, library는 없다.
  기존 lg/md/xl 구조와 native scroll/details를 사용한다. 모바일 UX가 추가되지 않았다.
- CSS/Tailwind palette는 같은 RGB channel 토큰을 사용한다. foreground와 fill 분리는
  손익/선택 텍스트 대비를 위한 P0 규칙이다. Typography/radius/shadow 역할을 유지한다.
- Gradient·blur·glow·클릭 scale을 재도입한 추가 diff는 없다. 남은 전문 chart 색이나
  기존 small text를 단순 취향 때문에 일괄 교체하지 않았다.
- Legacy `.metric-card`, `.badge`, `.tooltip` 호환 규칙과 현재 화면의 의미가 다른 전용
  control은 유지한다. 위험이 확인되지 않은 dead-style 정리/DRY 추상화는 하지 않는다.
- P1의 outer clip은 기존 shell containment를 보존한다. 내부 table/긴 값은 `overflow-auto`로
  접근 가능하며 이번 수정에서 overflow 숨김으로 문제를 가리지 않았다.
- 제거 확인창의 기존 `shadow-2xl` 클래스는 P0의 overlay shadow 토큰으로 해석된다.
  이번 감사에서 이를 다시 디자인하지 않았다.

## 최종 검증

최종 제품 수정 후 실행 결과:

| 검사 | 결과 |
|---|---|
| `npm run lint` | PASS, max warnings 0 |
| `npx tsc --noEmit` | PASS |
| `npm test -- --maxWorkers=2` | PASS: 48 files / 491 tests, 70.74s |
| backend `venv/Scripts/python.exe -X utf8 -m pytest -q` | PASS: 1070 passed / 1 skipped / 211 warnings, 136.69s |
| `npm run build` | PASS: 1637 modules, 10.56s |
| HEAD 대비 `git diff --check` | PASS |

Visual/interaction evidence는 ignored `.cache/design-final/`에 보관한다.
가상 sample 36건, KO, viewport 높이 1000px와 768/1024/1440px 기준으로 확인했다.
실제 innerWidth를 확인하고 resize 중간 frame은 다시 캡처한다. 최초 로딩 중간값과
완료된 데이터 화면을 구별하며 로딩 화면을 populated screen의 검증으로 대체하지 않는다.

- Journal 요약/거래 표, 펼친 성과/Calendar, 기록이 있는 Daily, Plan 목록/editor,
  Trade Report, Analytics 결과 표/Review, Playbook 목록/rule drawer,
  Risk unavailable/Explorer empty/Hold 기본 비교를 검증했다.
- Header 56px. Journal 실제 콘텐츠 폭은 728/792/1032px(outer main 패딩 제외).
  페이지 가로 넘침은 없고 Journal/Plan/Explorer/Risk 표는 필요한 내부 scroll을 유지한다.
- Plan 손절 초기 focus → Shift+Tab/Tab 내부 이동 → Escape → 원래 '열기' 버튼 복귀.
- Report 닫기 초기 focus, 임시 Setup 초안 → Escape → 계속 편집 초기 focus,
  양방향 Tab, Escape로 child만 닫기/초안 보존 → 다시 확인/초안 버리기 → 동일 trade opener 복귀.
- Playbook rule 추가 초안/disabled 생성, 1/2/3열 reflow와 미저장 확인을 검증하고
  초안을 버렸다. 실제 전략 생성·삭제·credential write는 실행하지 않았다.
- Native details/summary Enter와 보이는 focus outline을 확인했다.
- 수정 후 production build를 재로드했다. 제거 확인창을 768/1024/1440px에서 확인했고,
  취소 초기 focus → Shift+Tab 제거 → Tab 취소(visible outline) → Escape로 child만 닫기 →
  '전략 제거' opener → 다시 Escape로 Report 닫기 → 동일 `trade-report-36` opener 복귀를 확인했다.
  마지막에 body scroll lock도 해제됐다. 실제 제거는 실행하지 않았으며 pending guard는
  새 통합 테스트로 검증했다. `remove-confirmation-keyboard-1440.png`에 증거를 보관한다.
- 최종 build에서 Journal/Calendar/Plan/Analytics 결과 표/Risk KO·EN/Playbook도 다시 확인했다.
  다른 화면은 수정 전 동일 P0–P4 bundle에서 검증했다. 마지막 수정은 중첩 확인창의 focus 연결만이며
  production CSS는 전후 동일한 `index-Dxb7Cdkx.css`다. 로딩 중 Plan/Risk 및 resize 중간 Calendar
  캡처는 최종 캡처로 대체했다.
- 최종 build 재로드 이후 샘플 업무 흐름에서 console error/warning은 0건이었다.
  `.cache/design-final/layout-final.json`, `keyboard-final.json`, `console-final.json`에 기록했다.
  검사 후 언어는 KO로 되돌리고 임시 viewport/초안/확인창을 해제했다.
- P4의 KO/EN·긴 값·합성 chart evidence도 검토했다. 이번 수정은 해당 표시 코드와
  토큰/셸을 바꾸지 않는다. 실제 시장 chart 동작을 검증한 것으로 간주하지 않는다.

Backend의 skip은 TA-Lib 미설치에 따른 기존 optional 비교이며 warnings는 기존 의존성
deprecation이다. 테스트 삭제·약화는 없다. 감사 중 새 테스트의 `exact` 타입 옵션 오류는
정식 typecheck에서 발견해 제거했고, 검증 assertion과 기존 테스트는 유지했다.

## Release blocker / remaining debt

| 항목 | 판정 | 근거 / 처리 |
|---|---|---|
| 제거 확인창이 부모 Escape에 의해 닫힘 | RELEASE BLOCKER → FIXED | destructive 확인창의 focus/keyboard 경로 간섭. 이번 감사에서 최소 수정·회귀 테스트 추가 |
| 실제 browser zoom 200% | FOLLOW-UP / CANNOT VERIFY | 현재 IAB capability는 viewport/visibility만 제공한다. P4 확대 키도 실제 zoom 변경이 없었다. CSS zoom/축소 viewport로 대체하거나 PASS로 기록하지 않는다 |
| 같은 `?sampleTrade=1` URL에서 닫은 report 재열기 | FOLLOW-UP | HEAD의 effect/의존성과 같은 동작. 정상 거래 목록 버튼으로 재열 수 있고 핵심 작업을 막지 않는다. UI refactor 밖 기능 변경은 하지 않는다 |
| 일부 Risk 문구 KO/EN 혼용 | ACCEPTED DEBT | 기존 문구/번역 범위. 의미나 control 접근을 막지 않는다. 이번에 번역 정책을 변경하지 않는다 |

검증된 UI 범위의 **미해결 RELEASE BLOCKER는 0건**이다. 미검증 항목은 통과를 뜻하지 않는다.

### CANNOT VERIFY

- Journal/Trade Report/Plan/Analytics/Playbook의 실제 browser zoom 200%.
- 실시간 거래소·외부 가격·populated market path·open position·확정 SL 조합.
- 실제 credential 저장/삭제와 사용자 데이터 persistence. 기존 격리 테스트의 mock/temp DB 검증과 구별한다.
- 실거래 chart tooltip/zoom/marker의 모든 조합, 스크린리더 실제 음성 출력.
- TA-Lib 미설치 환경의 optional indicator 비교. 기존 deprecation warnings는 별도 의존성 debt.

## Git / recommended commit boundary

`main`, HEAD `b4e9b54`, upstream ahead/behind 0/0. 변경은 전부 working tree에만 있다.
Stage/commit/push/tag/release/publish는 실행하지 않는다.

승인 시 권장 경계는 **P0–P4 제품 변경 + 공통 focus 및 통합 회귀 테스트 + 6개 감사 문서**를
하나의 완결된 UI refactor commit으로 묶는 것이다. 전역 token/style과 소비자 변경을
임의로 일부만 staging하면 중간 상태를 만들 수 있다. 이번 확인창 수정도 같은 범위에 포함한다.
예시 메시지: `refactor(ui): apply P0–P4 design and regression fixes`.
Ignored cache/screenshots/fixture/build output은 포함하지 않고 버전/API/backend는 변경하지 않는다.
