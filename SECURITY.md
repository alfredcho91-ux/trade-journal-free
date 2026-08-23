# Security

## Exchange API keys

- 전용 API key를 새로 만들고 Read Only 권한만 부여합니다.
- 거래, 출금, 자산 이동 권한을 켜지 않습니다.
- 가능하면 거래소의 IP 허용 목록을 설정합니다.
- `.env`를 Git에 추가하거나 브라우저 코드에 넣지 않습니다.
- 앱의 `API 연결` 창은 읽기 권한을 확인한 뒤 성공한 키만 백엔드 보호 저장소에 저장합니다. 브라우저 저장소, 프론트엔드 bundle, API 응답에는 키를 보관하지 않습니다.
- desktop은 macOS Keychain/Windows Credential Manager를 사용합니다. production 서버는 `CREDENTIAL_MASTER_KEY`로 AES-256-GCM 암호화한 값만 SQLite에 저장합니다.
- 마스터 키는 URL-safe base64로 인코딩한 32 random bytes여야 하며 코드, DB, GitHub Actions 로그에 넣지 않습니다. Cloudflare에서는 Workers Secret으로 설정합니다.
- 기존 로컬 `.env`의 거래소 키는 보호 저장소 사용이 가능할 때 자동 이전 후 제거됩니다. 연결 삭제는 저장 레코드를 제거하지만 배포 환경변수는 운영 환경에서 직접 삭제해야 합니다.
- backend는 거래소 Secret을 서명 시점에만 메모리에서 사용하고 credential endpoint의 로그 값과 인증 header를 마스킹합니다.
- 키가 노출되었다면 즉시 폐기하고 새 키를 발급합니다.

## Network

Docker Compose 기본값은 `127.0.0.1:8000`으로 로컬에서만 접근됩니다. 외부 서버나 터널에 공개할 때는 `APP_ENV=production`, 강한 `DEMO_USERNAME`/`DEMO_PASSWORD`, HTTPS reverse proxy를 설정해야 합니다. credential 생성·삭제 endpoint는 production에서 HTTPS가 아니면 거부합니다. `TRUST_PROXY_HEADERS=true`는 Cloudflare처럼 직접 관리하는 proxy 뒤에서만 사용합니다.

## Windows release signing

공개 Windows 배포본은 `Trade Journal.exe`에 Authenticode 서명을 적용하고 timestamp 서버로 검증합니다. PFX 인증서와 비밀번호는 GitHub Actions Secret인 `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`로만 주입합니다. `WINDOWS_SIGNING_REQUIRED=true`이면 인증서 누락·서명 실패·검증 실패가 배포 빌드를 중단합니다.

PFX, 비밀번호, 서명 토큰을 로컬 프로젝트나 Git에 저장하지 마세요. 인증서가 노출되었거나 만료되면 즉시 폐기하고 새 인증서로 교체해야 합니다.

## Stored data

거래 기록은 기본적으로 `journal/trade_journal.db`에 평문 SQLite로 저장됩니다. 같은 DB의 거래소 credential 레코드만 암호화됩니다. 컴퓨터 계정과 디스크를 보호하고, DB를 공유 저장소나 공개 백업에 올리지 마세요.

## Remaining risks

- 브라우저 입력값과 복호화된 credential은 요청 처리 중 프로세스 메모리에 잠시 존재합니다.
- 현재 앱 인증은 단일 Basic Auth 계정이며 credential도 설치 단위입니다. 다중 사용자 서비스에는 사용자 계정, 행 단위 소유권, 세션/CSRF 방어가 추가로 필요합니다.
- XSS나 서버 프로세스 탈취는 암호화 저장만으로 막을 수 없습니다. 의존성 업데이트, CSP, 호스트 보안과 key rotation이 필요합니다.
- 마스터 키를 잃으면 저장된 credential은 복구할 수 없습니다. 키가 노출되면 거래소 API key와 마스터 키를 모두 교체해야 합니다.

보안 문제를 공개 이슈에 API key와 함께 작성하지 마세요.
