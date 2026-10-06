# Trade Journal UI audit and Anti-AI Design System

감사: 2026-10-05, 최종 검증: 2026-10-06 (Asia/Seoul). 기준: v1.0.27 / `b4e9b54`.

## 범위와 근거

이번 작업은 감사 → 디자인 시스템 → 중앙 구현 지점 → **P0 구현**까지다.
P1 셸 변경은 사용자 승인 이후이며, 개별 페이지 재배치는 포함하지 않는다.
제품을 생성한 방식은 외관만으로 판정할 수 없다. 아래의 “템플릿 인상”은
시각적 반복과 작업 우선순위의 문제를 가리키며, 코드 작성자를 추정하지 않는다.

- React 18, Tailwind 3, 단일 `src/index.css`. 별도 shadcn 또는 공용 Button/Table/Dialog 컴포넌트는 없다.
- `App.tsx`, 전체 페이지의 렌더 구조, Journal/Daily Journal/거래 상세/거래소 연결,
  Analytics/Review, Playbook, Plan Lab, Risk Lab, Trade Explorer, Hold/Re-entry의
  컨트롤·표·상태 처리·차트 소스를 확인했다.
- 실행 화면은 기존 RC의 격리된 **가상 샘플 데이터**로 확인했다.
  Journal, 안내형 분석, 거래 상세, Plan Lab, Playbook을 확인하고
  1440px 데스크톱과 390px 모바일 구조를 비교했다.
- 샘플에서는 실시간 거래 차트를 제공하지 않는다. 캔들 차트·시장 데이터 관련 평가는
  코드에 근거하며, 실제 거래소 데이터의 시각 검증을 완료했다는 뜻은 아니다.
- 감사 시작 시 작업 트리는 깨끗했다. `rg`/소스 조사상 9–11px 명시 글씨가 41개 파일,
  373개 줄에 있고, 표가 13개 파일에 있다. 정확한 렌더 개수와는 다르다.
- `.card`의 실제 사용은 주로 Journal과 ErrorNotice다. `.metric-card` 등 일부 레거시
  CSS 클래스는 현재 TSX 소비자가 없다. 이 클래스를 바꿔 모든 KPI가 개선된다고 주장하지 않는다.

## 1. 감사: 유지할 구조와 주요 문제

| 분류 | 위치 / 관찰 | 제품에 미치는 영향 | 대체 원칙 / 수정 수준 |
|---|---|---|---|
| KEEP | Journal의 데스크톱 거래 표, 코인별 손익 표 | 거래 비교에 적합하다. 모바일에는 별도 목록이 이미 있다 | 표를 일급 작업 영역으로 유지. 모바일 목록을 무조건 표로 바꾸지 않는다. 페이지 |
| KEEP | 손익의 부호·단위·색상, 미기록/판정 불가 구분 | 색상 이외의 의미와 데이터 한계를 제공한다 | 표기·계산·결측 의미 유지. 전역/공유 |
| KEEP | Playbook의 목록→버전→규칙 구조, TradeReport의 차트+상세 구조 | 업무에 필요한 문맥을 보존한다 | 구조를 활용하고 중첩 테두리와 보조 정보만 줄인다. 페이지 |
| KEEP | AnalysisGroup 범위 표시·근거 이동·접기, Analytics의 표/차트 전환 | 분석 범위와 근거를 추적할 수 있다 | 설명을 없애지 않고 단계적으로 노출한다. 공유 |
| REPLACE | `index.css`와 `tailwind.config.js`에 색상 중복 정의 | CSS와 유틸리티를 각각 수정해야 하며 화면 간 색이 어긋난다 | CSS 토큰을 단일 값 공급원으로 사용. 전역 P0 |
| SIMPLIFY | `.card`: 반투명 배경, blur, 12px 모서리, 큰 그림자 | Journal의 평면 표·패널과 다른 떠 있는 표면을 만든다 | 불투명 표면, 1px 테두리, 8px 모서리. 전역 P0 |
| REMOVE | `.btn-primary` 그라데이션과 클릭 scale | 일반 작업 버튼에 장식과 움직임이 붙는다 | 단색·색상 피드백, 위치 유지. 전역 P0 |
| REPLACE | `input[type=text/number]`와 `select`만 전역 규칙 적용 | type 생략, password, date, textarea는 다른 패딩·포커스를 가진다. 속성 선택자가 유틸리티보다 강하다 | 모든 텍스트형 컨트롤의 낮은 specificity 기본값. 전역 P0 |
| REPLACE | 여러 폼의 `outline-none`, 불균일한 focus border | 키보드 사용자가 현재 편집 위치를 놓칠 수 있다 | 밝은 2px focus-visible 외곽선. 전역 P0 |
| SIMPLIFY | 강한 청색 배경과 어두운 `primary-400` 글씨, `dark-600` 보조 글씨 | 선택/보조 정보가 손익·핵심 값과 경쟁하거나 읽기 어렵다 | 채움색과 글자색 역할 분리. 전역 P0 |
| SIMPLIFY | 산발적인 글씨 크기·weight, 9–11px 설명문 | 밀도는 높지만 읽기 부담이 크다. 단순히 더 줄이면 악화된다 | 14/13/12px 본문·컨트롤·레이블, 11px 메타만 허용. 토큰 P0, 기존 작은 글씨 전환 P2/P3 |
| REPLACE | `App.tsx`: 모바일 7등분 내비게이션 | 390px에서 메뉴명이 잘려 목적지를 알아보기 어렵다 | 1차 메뉴의 가독성을 보장하는 overflow/menu 방식. 셸 P1 |
| SIMPLIFY | 데스크톱 192px 좌측 메뉴 + 240px 우측 피드백 영역 | 1440px에서 작업 영역을 줄이며 9개 KPI를 좁게 만든다 | 피드백을 보조 액션으로 이동하고 작업 폭 확보. 셸 P1 |
| SIMPLIFY | 셸의 69px sticky offset·고정 높이와 wrapping header | 작은 화면/확대 시 헤더 높이와 맞지 않을 가능성 | 실제 헤더 크기에 맞는 레이아웃 기준. 셸 P1; 위험은 소스에서 확인 |
| SIMPLIFY | Journal 상단 9개 동등 KPI, 아래 요약 4개, 반복 통계 | 모든 수치가 같은 중요도로 보이며 거래 목록까지 이동이 길다 | 핵심 손익·기대값·표본을 작은 요약 행으로, 보조 통계는 접기. 페이지 P3 |
| SIMPLIFY | 페이지별 날짜/방향/스타일/전략 필터와 적용 버튼 | 적용 범위와 즉시/명시적 적용 동작을 다시 배워야 한다 | 공통 툴바의 슬롯·정렬 규칙. 각 기능의 적용 의미는 유지. 공유 P2 |
| REPLACE | Plan Lab/Analytics의 일부 금융 숫자 왼쪽 정렬 | 소수점·수량 비교가 느리다 | 값과 헤더 오른쪽 정렬, 단위와 정밀도 보존. 표 공유 규칙 P2, 페이지 전환 P3 |
| SIMPLIFY | Plan Lab/AnalysisGroup 내부의 패널→KPI→badge 중첩 | 테두리와 경고색이 반복되어 결론보다 패널 구조가 강조된다 | 섹션, 구분선, 한 단계의 그룹 표면. 공유 P2/페이지 P3 |
| REMOVE | Journal 제목의 이모지, 일부 아이콘 배경, 장식적 번호 | 목적과 관계없는 시각적 강조가 다른 페이지 제목과 충돌한다 | 제품 내 탐색/상태에 필요한 아이콘만 유지. 페이지 P3 |
| SIMPLIFY | 첫 실행의 30px 문구와 긴 여백, 모든 샘플 화면의 큰 안내 패널 | 반복 업무에서 안내가 작업 영역을 차지한다 | 첫 실행 안내는 유지하되 재방문 안내는 축약/접기. P1/P3 |
| REPLACE | MiniChart/StochMiniChart/PositionReviewChart/PlanLabCharts의 개별 색·grid | SVG/캔들/분석 차트가 서로 다른 시각 규칙을 가진다 | 공통 chart theme와 의미별 series. 공유 P2; 현재 계산은 유지 |
| SIMPLIFY | TradeReport의 큰 모달, 긴 우측 상세와 여러 empty panel | 샘플에서 차트 자리가 비고 보조 정보는 긴 세로 스크롤이 된다 | 차트 가용성에 맞는 영역과 접을 수 있는 상세. 페이지 P3 |
| REPLACE | 모달별 역할·포커스 관리 구현 차이 | 일관된 Escape/초기 포커스/복귀 동작을 보장하기 어렵다 | 공용 dialog/drawer 기반. P2; CSS만으로 해결했다고 주장하지 않는다 |
| SIMPLIFY | 상태 문구, spinner, 큰 중앙 empty 영역, ErrorNotice 카드 혼재 | 데이터 없음/조건 미실행/오류가 다른 크기와 강도로 나타난다 | 작업 영역을 유지하는 작은 상태 행과 명확한 다음 행동. 공유 P2 |
| REPLACE | Journal 최초 응답 전 KPI 기본값 0 표시 | 로딩 중을 실제 0건/0손익으로 오인할 수 있다 | 기존 계산을 유지하고 로딩 중에는 skeleton/미확정 표시. 공유 P2/페이지 P3 |
| SIMPLIFY | Playbook RuleEditor의 고정 3열, 여러 min-width 표 | 좁은 화면의 폼과 테이블을 별도로 점검해야 한다 | 폼은 1→2→3열, 표만 내부 가로 스크롤. P2/P3; 전체 페이지를 숨겨 해결하지 않는다 |

## 2. Trade Journal Anti-AI Design System

장식보다 구분, 새로움보다 예측 가능성, 작은 글씨보다 효율적인 정보 배치를 우선한다.
다음 규칙은 목표 설계이며 P0에 실제 적용한 부분과 후속 전환 부분은 구별한다.

### 글꼴과 숫자

| 역할 | 크기 / 행간 | 굵기 / 용도 |
|---|---|---|
| 본문 | 14 / 20–21px | 400, 설명·기록 |
| 입력·툴바·표 값 | 13 / 20px | 400–500 |
| 레이블·표 머리 | 12 / 16px | 500, 무조건 대문자 변환 금지 |
| 메타데이터 | 11 / 16px | 400, 시간·부가 단위에만 사용 |
| 섹션 제목 | 16 / 24px | 600 |
| 페이지 제목 | 20 / 28px | 600 |
| 핵심 KPI | 20 / 28px | 600, 최대 24px 예외. 다른 수치는 13–16px |

Pretendard → Inter → Segoe UI → system-ui. 기존 웹폰트 로딩은 유지하고
로컬 fallback을 명시한다. 숫자는 lining/tabular 숫자를 기본으로 사용한다.
가격·식별자·시각 등 고정 폭이 도움이 되는 곳에만 mono를 사용한다.
기존 arbitrary 9–11px 클래스와 24–30px 제목은 일괄 강제 덮어쓰지 않고 P2/P3에서 전환한다.

### 간격·표면

- 기본 단위 4px. 컨트롤 내부는 수직 5px / 수평 10px, 높이 기본 32px, 필요 시 36px.
- 페이지 패딩 목표 16px 모바일 / 24px 데스크톱. 섹션 간격 20px, 패널 내부 16px,
  밀집 툴바 gap 4–8px, 같은 필드 그룹 8–12px. 기존 셸 간격은 P1에서 조정한다.
- 작은 레이블/칩 4px, 컨트롤 6px, 표면·dialog 8px. 원형 status dot은 예외.
- 배경 `#151a22`, 작업 표면 `#1d242e`, 내부 그룹 `#0e1218`, hover는 중립색,
  selected는 얕은 청색. 새 섹션마다 카드·배경·테두리를 중첩하지 않는다.
- 기본 표면은 그림자 없음. 메뉴·tooltip·dialog에만 `0 4px 16px / 24%` 그림자.
- 테두리는 1px. 컨트롤 경계는 패널 경계보다 명확하게. 선택·포커스는 별도 색과 외곽선.
- 반투명 glass, 장식 그라데이션, glow, 클릭 확대/축소 금지.

### 의미 색상

- 수익/손실의 기존 `bull`/`bear` 의미와 채움색은 유지한다. 손실 글자색은
  `#f87171`로 분리해 작업 표면 대비를 확보한다. 부호·단위·상태 문구를 함께 제공한다.
- amber는 주의, red는 오류/손실, blue는 선택/행동/정보. 장식용 rainbow 금지.
- 글자색은 채움색과 분리한다. 기존 `text-primary-400/500`은 밝은 foreground,
  `bg-primary-400/500`은 흰 글씨를 위한 더 어두운 채움으로 연결한다.
- `text-dark-600`은 읽을 수 있는 muted 색으로 매핑하고, `border-dark-600`은 경계로 유지한다.
- 새 시리즈를 늘릴 때 색만 추가하지 말고 라벨·선 형태로도 구분한다.

### 탐색·툴바·KPI

- 좌측 메뉴 목표 너비 176–192px, 한 행 36–40px. 활성 항목은 한 가지 선/배경과 텍스트로 표시.
- 상위 업무와 상세 화면의 계층이 있을 때만 breadcrumb를 도입한다. 현재 라우팅을 바꾸지 않는다.
- 공통 툴바 순서는 기간/계정 등 범위 → 검색·필터 → 보기/정렬 → 보조 액션.
  줄바꿈은 그룹 단위로 하고 검색·버튼의 높이를 맞춘다.
- 필터 적용 범위, 현재 적용값, 재실행 필요 여부를 가까이 표시한다.
- 핵심 KPI 3–5개를 하나의 요약 행에 배치한다. 비교 수치는 더 작은 보조 행.
  동등한 큰 KPI 카드 8–12개를 늘리지 않는다. 이 재배치는 P3다.

### 표

- 기본 header 32px, 단일 행 36px, 두 줄 정보 행 44–48px. 줄바꿈이 필요하면 높이는 유연하게.
- 셀 수평 패딩 12px. 텍스트는 왼쪽, 금융 숫자와 같은 열의 헤더는 오른쪽.
- 손익은 부호와 단위를 유지하고 tabular 숫자 사용. 결측은 0으로 보이게 하지 않는다.
- 중립 hover, 옅은 selected 배경과 명시적 체크/상태를 함께 제공한다.
- 정렬 버튼은 방향 아이콘과 `aria-sort`, 필터는 표 위 툴바, 건수와 페이지 이동은 아래 한 줄.
- sticky header는 내부 스크롤 영역과 불투명 배경을 함께 정의한다.
- 행 액션은 열 끝의 작은 버튼. 주 작업은 드릴다운, 파괴적 액션은 보조 위치.
- P0에서는 숫자 형태·색 토큰만 적용한다. 정렬·선택·페이지 이동 기능을 새로 추가하지 않는다.

### 차트

- 배경은 해당 작업 표면, grid는 얇은 중립 1px, 기본적으로 수평 grid 우선.
- 축 11px, tooltip 12px·4px radius·1px border, 이름/단위/정확한 값을 표시한다.
- 범례는 차트 상단 한 줄. 실제값과 비교값은 실선/점선 및 레이블로 구분한다.
- hover crosshair와 선택점은 얇고 명확하게. gradient area/glow 금지.
- 확대·드릴다운·시점별 데이터 연결은 유지한다. 공통 JS chart theme의 도입은 P2다.

### 입력·버튼·dialog

- text/number/password/search/date/datetime/select/textarea는 같은 경계·radius·포커스 기반.
  다중 select는 행 수를 유지한다. checkbox/radio/range를 텍스트 필드처럼 확대하지 않는다.
- combobox는 동일한 입력 외형+목록, 필터 chip은 4px radius+명확한 해제 버튼,
  segmented control은 하나의 그룹 안에서 selected 상태 표시. toggle은 색과 위치를 함께 사용.
- primary는 작업 그룹당 대표 행동 1개, secondary는 중립 표면+경계,
  ghost는 보조 탐색, destructive는 텍스트/경고 경계. icon-only에는 이름과 충분한 hit area.
- P0는 기존 `.btn*`와 native 필드 기본값을 통일한다. 새 React primitive 묶음을 만들지 않는다.
- 문맥 있는 상세는 drawer 또는 기존 split workspace를 우선한다. 모달은 확인과 집중 편집에 사용.
- dialog는 초기 포커스, focus trap, Escape, 닫은 후 포커스 복귀를 보장해야 한다.
  이는 후속 공유 컴포넌트 작업이며 이번 CSS 변경의 완료 항목이 아니다.

### 상태

- hover: 중립 표면/글자 변화. active: 작은 채움 변화. selected: 배경+문구/아이콘.
- focus: 2px 밝은 외곽선, 2px offset. 키보드 사용자가 항상 현재 위치를 알 수 있어야 한다.
- disabled: native disabled 유지, 낮은 opacity와 금지 cursor. hover를 적용하지 않는다.
- loading: 작업 영역을 유지하는 상태 문구/작은 spinner. reduced-motion에서 반복 애니메이션 제거.
- error: 인접한 오류 메시지와 재시도. empty: 데이터 없음/필터 결과 없음/아직 미실행을 구분.
- success: 저장 상태를 인접한 작은 문구로 표시. 큰 축하 패널을 추가하지 않는다.

## 3. 중앙 구현 지점

| 파일 | 목적 / 제안 | 위험 | 영향 화면 / 단계 |
|---|---|---|---|
| `frontend/src/index.css` | palette+semantic 토큰, 폰트·필드·focus·기존 card/button 기준 | cascade, native date/select, outline-none 우선순위 | 전체, P0 구현 |
| `frontend/tailwind.config.js` | CSS 토큰 참조, text와 fill 역할 분리, typography/radius/shadow | opacity modifier, 기존 유틸리티의 크기·색 변화 | 전체, P0 구현 |
| `frontend/index.html` | 폰트 로딩/fallback 검토 | 오프라인 폰트·라이선스·자산 배포 | 전체, 이번 유지 |
| `frontend/src/App.tsx` | sidebar/모바일 탐색/피드백 위치/폭과 sticky offset | navigation, scroll, localization | 전체, P1 승인 후 |
| `frontend/src/features/journal/JournalViewTabs.tsx` + `JournalSyncPanel.tsx` | 공통 탭·범위 툴바 기준 채택 | 적용 범위·동기화 의미 | Journal, P2 |
| `frontend/src/features/analytics/AnalyticsFilters.tsx` | 공유 inputClass와 필터 레이아웃 | multiple select·불가능한 필터 설명 | Analytics/Review/Experiments, P2 |
| `frontend/src/components/ErrorNotice.tsx` + `AppErrorBoundary.tsx` | compact 상태 규칙 채택 | 오류 안내·재시도 손실 금지 | 여러 페이지, P2 |
| `frontend/src/features/tradeAnalysis/AnalysisGroup.tsx` | 반복 패널·결론·scope/chip의 계층 단순화 | 근거/필터 범위 표시 손실 금지 | 분석·Risk/Explorer, P2 |
| `frontend/src/components/PositionReviewChart.tsx`, `MiniChart.tsx`, `StochMiniChart.tsx` | 공통 chart theme의 주요 소비자 | canvas 색상·재생성·hover·series 의미 | 거래 상세/분석, P2 |
| `frontend/src/features/planLab/PlanLabCharts.tsx` + `features/tradeAnalysis/AnalysisVisualizations.tsx` | SVG chart 규칙 합류 | 축·범례·선택 표현 | Plan/Analysis, P2 |
| `frontend/src/features/playbook/PlaybookDialogs.tsx` + `features/journal/UnsavedChangesDialog.tsx` | 공용 모달·버튼·폼 기준 | 키보드 포커스·저장 권한·미저장 경고 | Playbook/Journal, P2 |
| `frontend/src/pages/JournalPage.tsx` | KPI 요약·목록 우선순위 | 기간/성과 의미·페이지 상태 | Journal, P3 |
| `frontend/src/features/journal/TradeReportModal.tsx` | 상세 업무 계층·빈 차트 영역 | chart·편집 authority·미저장 처리 | 거래 상세, P3 |
| `frontend/src/pages/PlanLabPage.tsx` + `features/analytics/AnalyticsResults.tsx` | 금융 숫자 정렬과 표 밀도 | 정밀도·결측·근거 해석 | Plan/Analytics, P3 |

## 4. 우선순위와 중단 지점

1. **P0 전역 시스템**: 단일 토큰, 색 역할, native 필드 cascade, focus-visible,
   평면 card/단색 button, 제한된 radius/shadow, 숫자/폰트 기본값, reduced motion.
2. **P1 셸**: 모바일 탐색 가독성, 피드백 영역 축소, 콘텐츠 폭, 헤더·sticky 높이,
   공통 제목/컨텍스트/전역 액션. 사용자 승인 후 별도 구현하고 중단.
3. **P2 공유 컴포넌트**: toolbar/filter/segmented/button, 표의 정렬·밀도 규칙,
   chart theme, dialog focus, error/empty/loading. 실제 반복 소비자가 있는 것만 추출.
4. **P3 화면**: Journal 거래 목록과 요약 → Trade Detail → 성과 Overview → Analytics/Review
   → Calendar/Daily Journal → Playbook/Plan Lab → Risk/Explorer/Hold-Reentry.
   한 번에 하나의 업무 흐름을 검증한다.
5. **P4 시각 마무리**: KO/EN 줄바꿈, 아이콘 baseline, 200% 확대, 긴 값·0·결측·음수,
   차트 대비·키보드 이동·좁은 화면 스크롤. 근거 없는 장식을 추가하지 않는다.

## 5. 이번 P0 구현

- 제품 코드는 CSS와 Tailwind 설정 두 파일만 수정했다. React 구조·라우팅·API·도메인 계산은 유지한다.
- 기존 클래스 이름과 opacity modifier를 유지해 소비 화면에서 같은 토큰을 사용하게 했다.
- 입력 기본값을 base layer의 `:where()`로 옮겨 명시적 padding/size 유틸리티가 이기도록 했다.
- 명시되지 않은 텍스트·비밀번호·날짜·메모 필드에 기본 외형을 제공하고 native date UI를 dark로 맞췄다.
- focus-visible은 기존 outline-none 폼에서도 보이도록 utilities layer에 둔다.
- 기존 card와 button의 장식만 줄였다. KPI 배치, 셸 blur, page-level border 중첩,
  큰 onboarding, 임의 크기 글씨, canvas 색상은 아직 남는다.
- blur 제거 후에는 `.card`에 `position: relative`를 명시해 absolute 자식의 위치 기준을 유지한다.
  이 기준이 없으면 태블릿 거래 표의 `sr-only` 레이블이 페이지 너비를 늘리는 회귀가 발생했다.
- 기존 `.metric-card`, `.tooltip`, `.badge` 등의 호환 규칙도 정리했지만 현재 화면의
  모든 통계/tooltip/badge를 이 클래스에 이관한 것은 아니다.

## 6. 검증 결과 (2026-10-06)

| 검사 | 결과 |
|---|---|
| `npm run lint` | 통과, 경고 허용 0 |
| `npx tsc --noEmit` | 통과 |
| `npm test` | 47개 파일 / 483개 테스트 통과 |
| `npm run build` | 통과, TypeScript + Vite, 1,636 modules |
| `git diff --check` | 통과 |
| production build, 가상 샘플 36건 | Journal·복기 결과 정상 표시 |
| 390px / 768px / 1440px Journal | 문서 너비 382 / 760 / 1432px. 페이지 가로 넘침 없음 |
| 기본 스타일 | card 8px radius, blur·shadow 없음. primary 단색, 컨트롤 6px radius |
| 키보드 / 검색 | Playbook 검색 필터 작동, Tab/Shift+Tab focus-visible 확인, 검색 아이콘의 36px 왼쪽 여백 유지 |
| 폼 / 상세 | 새 전략의 text/textarea·disabled 상태, Daily Journal date/number/textarea, 샘플 거래 상세 표시 확인 |
| 브라우저 로그 | 최종 Journal/복기 검증 중 error/warn 기록 없음 |

검사 중 발견하고 해결한 사항:

1. **대비 회귀**: 작업 표면을 바꾼 뒤 기존 손실 글씨 `#ef4444`의 대비는 약 4.15:1이었다.
   텍스트 전용 `#f87171`로 분리해 약 5.65:1로 보정했다. 같은 표면의 muted 글씨는
   약 5.82:1, accent 글씨는 약 7.25:1이다. 이는 해당 색 조합의 계산값이며 전체 UI 인증이 아니다.
2. **768px 가로 넘침**: blur가 만들던 위치 기준이 사라져 absolute `sr-only` 레이블이
   문서 너비를 1006px로 늘렸다. 공통 `.card`의 `position: relative`로 원인을 수정하고
   같은 768px 창에서 문서 너비 760px, 데이터 로딩 완료를 재확인했다. 페이지별 숨김 CSS는 추가하지 않았다.
3. **검증 환경**: Vite 프록시(5190)에서 다른 포트의 패키지 백엔드에 복기를 요청하면
   `Untrusted local Origin`으로 거부됐다. 보안 정책을 변경하지 않고 production build를
   같은 출처에서 제공하는 별도 테스트 프로필로 검증해 복기 요약의 정상 응답을 확인했다.
4. 중단 후 이전 검사 세션이 사라져 최종 코드로 lint/typecheck/test/build를 다시 실행했다.

증거 이미지는 로컬 `.cache/design-p0/`에 있다:
`journal-before.jpg`, `journal-after.jpg`, `journal-mobile-after.jpg`,
`journal-tablet-after.jpg`, `form-focus-after.jpg`, `daily-mobile-after.jpg`,
`review-production-after.jpg`. 캐시 파일은 제품 소스에 포함하지 않는다.

### 남은 작업과 승인 범위

**P0 완료. 다음 변경은 P1 승인 후 진행한다.**
P1의 우선 작업은 390px 메뉴 잘림, 우측 피드백 영역이 차지하는 폭,
header/sticky 크기 기준, 공통 제목·문맥·전역 액션 정리다.
KPI 재배치·필터 통합·차트 theme·작은 글씨 전환·dialog focus 관리 등 P2/P3는 그대로 남는다.

가상 샘플은 시장 가격 차트를 제공하지 않으므로 실시간 캔들·시장 데이터의 시각 검증은 제외했다.
현재 패키지의 Windows/거래소 수락 검증을 완료한 것으로 해석하면 안 된다.
새 의존성, 백엔드 변경, API 변경, 라우트 변경, 사용자 데이터 편집은 없다.
커밋·푸시·릴리스는 수행하지 않았으며 기존 RC ZIP도 변경하지 않았다.
