# P4 시각 마무리와 robustness 검증

검증일: 2026-10-06 (Asia/Seoul). P4의 확인된 문제만 수정했다.
**실제 browser zoom 200%는 검증 미완료다.** 좁은 viewport를 zoom 결과로 주장하지 않는다.
P4 이후 작업, commit/push는 진행하지 않았다.

## 범위와 감사 기준

P0/P1/P2/P3 문서, 기존 Git diff와 frontend 구조를 확인했다. 기존 감사의 P4는
KO/EN 줄바꿈, icon baseline, 200% 확대, 긴 값/0/결측/음수, 차트 대비,
keyboard 이동과 좁은 영역 scroll이다. 새 디자인·번역·계산 정책 전환은 포함하지 않는다.
작업 시작 시 frontend 소스와 설정, 디자인 문서 195개를
`.cache/design-p4/baseline`에 복사하고 SHA-256을 기록했다.

구현 전 분류와 후속 검증에서 확인한 문제:

| 판정 | 후보 / 실제 근거 | 조치 또는 유지 이유 |
|---|---|---|
| FIX | Analytics 막대의 긴 무공백 이름이 막대와 값 열을 침범 | 이름에 줄바꿈, 막대 열 최소 폭 0, 값 열 자연 폭 |
| FIX | Analytics의 긴 이름이 첫 열을 과도하게 늘리고 큰 값의 단위가 줄바꿈 | 이름 열에 기존 `max-w-xs`와 anywhere wrapping, 숫자·단위만 한 줄 유지. 기존 내부 scroll 유지 |
| FIX | Trade Report 긴 symbol이 header/닫기 버튼을 화면 밖으로 밀어냄. 768px dialog scrollWidth 2185px | 제목의 flex 최소 폭과 줄바꿈만 보완. symbol 전체 표시 |
| FIX | Playbook 새 버전의 긴 전략 이름이 header를 넓힘. 768px drawer scrollWidth 1530px | 기존 header에 min-width 0, 설명 줄바꿈, 닫기 버튼 shrink 방지 |
| FIX | 큰 Hold currency가 1024px의 두 결과 열과 패널 밖으로 겹침 | 값 행의 필요한 wrap, 값 자체의 내부 가로 scroll. KPI 값도 각각 내부 scroll |
| FIX | 리포트를 연 뒤 768px 경계를 넘으면 숨겨진 opener에 focus 복귀 실패 | 같은 거래의 현재 보이는 opener로만 복귀. 기존 focus hook의 return 부분만 보완 |
| KEEP | 기본 샘플의 KO/EN 버튼·탭·헤더·폼 | 정상 wrap과 control 폭을 유지. 문구를 변경하지 않음 |
| KEEP | header/menu/toolbars/dialog 아이콘 | 검증한 버튼에서 중심 오차 0px, 기존 역할별 14/16px 유지. icon system 재작성 없음 |
| KEEP | 0, null, optional undefined, unavailable 표시와 기존 금융 formatter | 실제 0과 결측 구분, 부호/단위/정밀도 보존. Analytics 계약은 undefined를 허용하지 않아 잘못된 응답을 새 정책으로 처리하지 않음 |
| KEEP | 차트의 P2 axis/grid/surface, 상승·하락·K/D/histogram·marker·crosshair | 실제 컴포넌트의 합성 OHLCV/지표에서 표시 확인. 새 palette 없음 |
| KEEP | native field의 긴 입력값과 Calendar compact cell의 기존 truncate/title | 입력은 cursor/selection으로 읽을 수 있고 calendar는 기존 전체 값/title을 유지. 새 tooltip/편집 UX 없음 |
| CANNOT VERIFY | 실제 browser zoom 200% | 현재 browser API는 viewport만 제공. 확대 키 이후 DPR≈1, visualViewport.scale=1, innerWidth=1440 그대로여서 실제 zoom 검증으로 계산하지 않음 |
| CANNOT VERIFY | 실시간 candle/외부 가격 경로/오픈 포지션/확정 SL, credential 저장·삭제 | 제품 sample은 실시간 데이터를 제공하지 않음. fixture 결과를 실제 거래소 검증으로 주장하지 않음 |

후속 Hold/focus 문제는 재현 후에만 범위에 추가했다. 데이터 처리나 새로운 정보 계층은 추가하지 않았다.

## 변경 파일

제품 코드 6개, 기존 테스트에 새 시나리오 2개, 이 보고서 1개다.

- `frontend/src/features/analytics/AnalyticsResults.tsx`
- `frontend/src/features/journal/TradeReportModal.tsx`
- `frontend/src/features/playbook/PlaybookDialogs.tsx`
- `frontend/src/pages/HoldReentryPage.tsx`
- `frontend/src/pages/JournalPage.tsx`: 기존 report 버튼에 거래별 focus 식별 속성만 추가
- `frontend/src/hooks/useDialogFocus.ts`: 숨겨진 opener와 같은 식별자의 보이는 버튼으로 focus 복귀
- `frontend/src/hooks/useDialogFocus.test.tsx`: viewport 변경 후 Escape 및 중첩 discard 회귀 테스트 추가
- `docs/design/ui-robustness-p4.md`

기존 표시 클래스와 금융 값 범위의 span 한 개를 사용했다. 새 component, wrapper component,
라이브러리, CSS 토큰, chart theme, responsive breakpoint는 추가하지 않았다.
focus 식별 속성은 기록 ID가 있을 때만 부여하며 서로 다른 거래로 복귀하지 않는다.
fallback도 기존 visible/enabled/inert 제외 규칙과 최상위 dialog 조건을 그대로 사용한다.

## 시각·interaction 검증

Production preview의 가상 샘플 36건으로 Journal, Trade Report, Plan/Plan editor,
Analytics/Review, Calendar/Daily, Playbook/전략 editor, Risk/Explorer/Hold를
KO/EN 각각 768/1024/1440px에서 확인했다. Risk/Explorer는 기본 범위의 empty/
unavailable 화면이며 가격 데이터가 채워진 상태는 미검증이다.
일부 Risk label의 기존 한·영 혼용은 번역 재작성 범위가 아니므로 유지했다.

기본 문서 폭은 viewport와 같거나 세로 scrollbar 때문에 8px 작다.
P1 header 56px를 유지한다. 정상 버튼/필드/heading에는 내용 넘침이 없었다.
긴 native input의 내부 scroll은 정상 편집 동작이며 페이지 overflow로 분류하지 않는다.
viewport 설정 뒤 실제 innerWidth가 일치하는 경우만 검증 근거에 포함했다.

추가로 720/512/384px와 일부 500px 높이에서 읽기·입력·dialog·scroll을 확인했다.
이는 **좁은 유효 공간 보조 검사이며 browser zoom 200% 대체 검증이 아니다.**
기존 lg 아래 가로 navigation만 사용하며 모바일 UX를 추가하지 않았다.

격리된 `.cache/design-p4/fixture`는 실제 AnalyticsResults, TradeReportModal,
NewVersionDrawer와 세 차트 컴포넌트를 import하고 production CSS를 사용한다.
무공백 영어 이름 약 220자, 긴 한국어 이름, 28자리 양·음수 금액,
긴 소수, 0/null, optional field 미제공, 합성 OHLCV·RSI·K/D·양음 histogram을 넣었다.
fixture는 백엔드나 실제 데이터 저장에 연결되지 않는다.

- 긴 Report/버전 header의 가로 넘침이 사라지고 32px 닫기 버튼이 viewport 안에 남는다.
- Analytics 숫자/단위는 한 줄, 부호와 기존 두 자리 반올림은 그대로다.
  이름은 전체 표시하고 표 안의 필요 scroll을 유지한다. 정상 표본 정렬/막대 전환도 확인했다.
- Hold 큰 값은 각 행/셀에서 scroll하며 패널/옆 열을 침범하지 않는다.
  1024px에서 금융 값의 첫 부호가 scroll 시작점에 남고, Tab → ArrowRight로
  scrollLeft 0 → 40px 이동을 확인했다. 기본값과 0 입력의 기존 validation도 확인하고 초기화했다.
- 384×500px NewVersion에서 Shift+Tab으로 닫기 및 취소에 접근했다.
  취소 버튼 bottom=480px, drawer scrollTop≈262px로 viewport 내 접근을 확인했다.
- 384×500px Report에서 저장 버튼 bottom≈497px 접근, 양방향 Tab containment,
  미저장 확인의 안전한 초기 focus, Escape로 확인만 닫기와 임시 Setup 초안 유지,
  임시 초안 버리기를 확인했다. 실제 저장/삭제/거래/전략 생성은 실행하지 않았다.
- 최종 production bundle에서 1440px의 거래 36 리포트를 연 뒤 384px로 변경하고
  Escape로 닫아 같은 `trade-report-36`의 보이는 버튼으로 복귀했다. 384px에서 다시 열고
  임시 초안 입력 → 1024px 변경 → 미저장 확인/버리기도 같은 거래의 desktop 버튼으로 복귀했다.
- 차트의 axis/grid, bull/bear candle, entry/exit label, OHLC legend와 crosshair를 확인했다.
  실거래 tooltip/가격 경로의 모든 조합이나 완전한 chart keyboard 조작을 검증했다고 주장하지 않는다.
- 최종 제품/fixture tab의 console error/warn을 확인했다. build 중 기존 asset URL을
  가진 탭의 lazy import 오류는 reload 후 재검증하고 실패한 중간 관찰을 증거에서 제외했다.

스크린샷, layout/fixture JSON과 P4 전용 diff는 ignored `.cache/design-p4`에 보관한다.
검증 후 임시 초안/입력값을 버리거나 초기화하고 viewport override를 해제했다.
가상 fixture 서버와 P4 임시 탭은 종료하고 최종 제품 Journal 탭을 유지했다.

## 전체 검증과 self review

- 최종 `npm run lint` 통과(경고 허용 0), `npx tsc --noEmit` 통과.
- 최종 `npm test -- --maxWorkers=2`: 48개 파일 / 489개 테스트 통과, 63.14초.
  기존 487개 테스트에 focus 복귀 회귀 시나리오 2개를 추가했다.
  기존 timeout/assertion은 유지하고 실행 worker 수만 제한했다.
- 최종 `npm run build`: TypeScript + Vite 통과, 1637 modules, Vite 11.71초.
- backend `venv/Scripts/python.exe -X utf8 -m pytest -q`:
  1070 passed / 1 skipped / 211 기존 deprecation warnings, 113.43초.
  TA-Lib 미설치 비교 테스트 skip. 기존 임시 DB/credential 격리를 사용했다.
- `git diff --check` 통과. Windows LF/CRLF 안내만 있으며 whitespace error 없음.

P4 전용 diff를 P3 baseline과 비교했다. 195개 기존 파일 중 제품 6개와 테스트 1개만 바뀌었고
188개는 byte-for-byte 동일하다. 기존 CSS/Tailwind 토큰, App shell, P0–P3 문서,
차트 컴포넌트, query/mutation, API/모델, 거래/분석 계산과 formatter를 유지했다.
새 hard-coded 색/radius/shadow/typography나 overflow-hidden 회피는 없다.
표의 max-w-xs는 기존 Tailwind 레이아웃 scale, 막대의 100px 최소 폭은 기존 값이다.
기존 테스트/timeout/assertion을 완화하거나 삭제하지 않았다.
접근성 변경은 같은 기록의 visible opener를 선택하는 focus 복귀 보완으로 한정했다.

## 한계 / remaining UI debt / Git

- 실제 browser zoom 200%는 주요 흐름 모두 별도 검증이 필요하다. viewport 축소만으로 통과 처리하지 않는다.
- 실시간 거래소/가격 경로가 채워진 Risk/Explorer/Plan/Report, 실제 credential/persistence,
  실거래 tooltip/market edge case, 스크린리더 음성 출력은 미검증이다.
- 기존 P3 보고서의 같은 `?sampleTrade=1` 안내 링크 재열기 문제와 일부 Risk의 한·영 혼용은 유지했다.
  기능/번역 정책 변경은 이번 P4에서 시작하지 않았다.
- Calendar의 compact truncate/title, 기존 차트 keyboard 전용 기능 여부는 후속 별도 접근성 감사 대상이다.
- TA-Lib 의존 CI 비교는 이 환경에서 실행되지 않았다.

`main`, HEAD `b4e9b54`, upstream ahead/behind 0/0.
P0–P3 변경을 보존했고 현재 P4도 작업 트리에만 있다. 사용자 승인 전 commit/push하지 않는다.
**P4 이후 리팩토링이나 기능 개선을 시작하지 않았다.**
