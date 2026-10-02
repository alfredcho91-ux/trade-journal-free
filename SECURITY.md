# Security

## Exchange API keys

- 전용 API key를 새로 만들고 Read Only 권한만 부여합니다.
- 거래, 출금, 자산 이동 권한을 켜지 않습니다.
- 가능하면 거래소의 IP 허용 목록을 설정합니다.
- `.env`를 Git에 추가하거나 브라우저 코드에 넣지 않습니다.
- 앱의 `API 연결` 창은 읽기 조회 성공을 확인한 뒤 키를 백엔드 보호 저장소에 저장합니다. 이 검증은 키에 주문·출금 권한이 없다는 증명이 아니므로 사용자가 해당 권한을 꺼야 합니다. 연결 UI는 키를 브라우저 저장소나 bundle에 저장하지 않으며 credential 응답은 키 값을 반환하지 않습니다.
- 기본 desktop의 `auto`는 macOS Keychain/Windows Credential Manager 등 OS keyring을 사용합니다. 마스터 키가 있거나 production이면 `auto`는 AES-256-GCM 암호화 SQLite를 선택합니다. `keyring`/`encrypted_db`로 명시할 수도 있으며 `disabled`와 샘플은 credential을 사용하지 않습니다.
- 마스터 키는 URL-safe base64로 인코딩한 32 random bytes여야 하며 코드, DB, GitHub Actions 로그에 넣지 않습니다. 실제 FastAPI 프로세스의 환경 Secret으로 주입해야 합니다.
- backend는 처리 중 credential을 메모리에 보유합니다. 로깅 record factory는 등록된 민감값과 credential/Authorization 패턴을 일반 메시지, exception traceback(연쇄 예외 포함), stack text에서 마스킹합니다. 이는 알 수 없는 임의의 비밀이나 logging을 우회한 출력까지 검출한다는 보장이 아닙니다.
- 키가 노출되었다면 즉시 폐기하고 새 키를 발급합니다.

## Credential ownership and lifecycle

구현 기준은 `backend/config/settings.py`와 `backend/modules/exchanges/{credentials,legacy_env,keyring_store,encrypted_store}.py`입니다.

- `.env`에서 로딩된 값이 섞이지 않은 완전한 명시적 배포 환경 credential은 우선 사용하고 자동 저장·삭제하지 않습니다. Docker Compose의 `env_file`로 프로세스에 주입된 값도 이 경계에 속합니다. 혼합된 배포/legacy 값은 기존 보호 credential이 없을 때 자동 이전하지 않고 명시적 설정을 요구합니다.
- canonical packaged normal 프로필만 기존 vault service name을 소유합니다. 소스 checkout과 커스텀 app-data/Journal/DB 경로는 해석된 경로 기반의 별도 namespace를 사용합니다. 암호화 레코드는 선택된 DB에 저장합니다. 정상 프로필 `.env` 소유권은 로딩 전에 확인하며 redirect가 있으면 읽지 않습니다. 파일 자체가 경로를 바꾼 경우에는 그 파일에서 로딩된 credential·master key·인증 값을 제거하고 비밀이 아닌 설정은 유지합니다.
- 기본 소스 실행은 자기 checkout의 `.env`를 소유할 수 있습니다. 커스텀 데이터/DB 경로와 샘플은 정상 프로필 legacy `.env`를 읽거나 정리하지 않습니다. 커스텀 프로필도 명시적으로 주입한 배포 credential은 사용할 수 있으므로 credential 없는 테스트에는 `CREDENTIAL_STORAGE=disabled`가 필요합니다.
- 자동 resolution은 완전한 배포 환경 override 다음에 현재 모드의 보호 저장소를 확인합니다. 암호화 DB가 비어 있으면 같은 프로필의 vault를 먼저, 없으면 소유한 legacy `.env`를 복사할 수 있습니다. insert-if-absent로 기존 목적지를 덮어쓰지 않고, 복호화 재조회·구조 검증 및 직접 삽입한 경우 값의 동등성을 확인합니다. 경쟁 writer가 먼저 저장했다면 유효한 목적지가 우선합니다. 검증은 master key의 영구 보관을 입증하지 않으므로 **자동 이전은 `.env`와 vault 원본을 보존합니다**.
- keyring 모드에서는 OS vault의 atomic insert-if-absent가 없으므로 legacy `.env`를 자동으로 vault에 쓰지 않습니다. vault에 값이 없다면 소유한 legacy 값을 읽고 명시적 save를 기다립니다. 기존 보호 값을 stale `.env`로 덮어쓰지 않습니다.
- 연결 상태 GET도 resolution을 수행하여 위 암호화 DB 복사를 유발할 수 있습니다. 따라서 상태 조회는 값 비공개이지만 항상 무변경인 작업은 아닙니다. 저장소 오류는 credential 값 없는 상태 오류로 노출합니다.
- **명시적 save:** 읽기 연결 검증 → 선택한 보호 저장소 저장 → 소유한 `.env`에서 해당 거래소 키 제거 및 그 파일에서 로딩한 프로세스 값 제거. 이 save 경로에 자동 이전의 readback 검증이 있다고 가정하면 안 됩니다. legacy 정리에 실패하면 보호 저장은 유지하고 `EXCHANGE_CREDENTIAL_CLEANUP_PENDING`을 반환합니다.
- **명시적 delete:** legacy 정리가 먼저 성공해야 주 저장소를 삭제합니다. 실패하면 cleanup-pending으로 중단하여 원본이 다음 시작 때 credential을 복원하지 않도록 합니다. 주 저장소 삭제 후 다른 저장소의 레코드 삭제는 best-effort이므로 양쪽 삭제의 원자적 성공을 보장하지 않습니다. 명시적 배포 환경값은 유지되고 응답의 `environment_override`로 알립니다. 운영자가 별도로 제거해야 합니다.
- `.env` 정리는 같은 디렉터리의 임시 파일을 닫고 원자적으로 교체하며 다른 설정을 보존합니다. POSIX mode 설정은 Windows ACL을 대체하지 않습니다. 현재 프로세스의 credential lifecycle은 lock으로 직렬화되며, desktop은 프로필별 single-instance lock을 추가로 사용합니다.

## Sample workspace

샘플은 별도 프로세스·프로필·SQLite와 allowlist 환경을 사용합니다. 시작 전에 경로·ownership token·`CREDENTIAL_STORAGE=disabled`를 확인하고 정상 `.env`/credential store를 사용하지 않습니다. 실제 거래소 mutation과 sync, outgoing socket 연결은 차단됩니다. 샘플 fixture와 편집은 정상 Journal DB로 가져오지 않습니다. 샘플은 편집 가능한 연습 공간이며, 여기서 읽기 전용이라는 제품 표현은 거래소 주문·출금 실행 기능이 없다는 뜻입니다. reset/종료의 소유권은 [샘플 문서](docs/isolated-sample-onboarding.md)를 참고하세요.

## Network

Docker Compose 기본값은 `127.0.0.1:8000`으로 로컬에서만 접근됩니다. 외부 서버나 터널에 공개할 때는 `APP_ENV=production`, 강한 `DEMO_USERNAME`/`DEMO_PASSWORD`, HTTPS reverse proxy를 설정해야 합니다. credential 생성·삭제 endpoint는 production에서 HTTPS가 아니면 거부합니다. `TRUST_PROXY_HEADERS=true`는 Cloudflare처럼 직접 관리하는 proxy 뒤에서만 사용합니다.

## Windows release signing

인증서가 설정된 Windows 빌드는 `Trade Journal.exe`에 Authenticode 서명을 적용하고 timestamp 서버로 검증합니다. PFX 인증서와 비밀번호는 GitHub Actions Secret인 `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`로 주입합니다. `WINDOWS_SIGNING_REQUIRED=true`이면 인증서 누락·서명 실패·검증 실패가 배포 빌드를 중단합니다. 필수 설정과 인증서가 없으면 unsigned artifact가 가능하므로 모든 배포본이 서명되었다고 가정하면 안 됩니다.

PFX, 비밀번호, 서명 토큰을 로컬 프로젝트나 Git에 저장하지 마세요. 인증서가 노출되었거나 만료되면 즉시 폐기하고 새 인증서로 교체해야 합니다.

## Stored data

거래 기록은 선택된 프로필의 `journal/trade_journal.db`에 평문 SQLite로 저장됩니다(명시적 DB override 가능). 소스 실행은 checkout, packaged 실행은 사용자 app-data가 기본 루트입니다. 같은 DB의 credential 레코드는 encrypted_db 모드에서만 암호화 저장되고 기본 desktop credential은 OS vault에 있습니다. SQLite 연결 종료는 transaction commit/rollback 뒤 명시적으로 수행되며 데이터 암호화 기능과는 별개입니다. 컴퓨터 계정과 디스크를 보호하고, DB를 공유 저장소나 공개 백업에 올리지 마세요.

## Remaining risks

- 브라우저 입력값과 복호화된 credential은 메모리에 존재하고 환경값·클라이언트 객체·redaction registry의 수명에 따라 요청 이후에도 남을 수 있습니다. 메모리 즉시 삭제를 보장하지 않습니다.
- 현재 production 인증은 단일 Basic Auth 계정이며 credential 저장소는 데이터 프로필 단위입니다. 프로필 분리는 다중 사용자 권한 모델이 아니며 다중 사용자 서비스에는 별도 사용자 계정·행 단위 소유권·세션/CSRF 설계가 필요합니다.
- XSS나 서버 프로세스 탈취는 암호화 저장만으로 막을 수 없습니다. 의존성 업데이트, CSP, 호스트 보안과 key rotation이 필요합니다.
- 마스터 키를 잃으면 저장된 credential은 복구할 수 없습니다. 키가 노출되면 거래소 API key와 마스터 키를 모두 교체해야 합니다.

보안 문제를 공개 이슈에 API key와 함께 작성하지 마세요.
