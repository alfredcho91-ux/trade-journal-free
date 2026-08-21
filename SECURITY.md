# Security

## Deepcoin key

- 전용 API key를 새로 만들고 Read Only 권한만 부여합니다.
- 거래, 출금, 자산 이동 권한을 켜지 않습니다.
- 가능하면 Deepcoin의 IP 허용 목록을 설정합니다.
- `.env`를 Git에 추가하거나 브라우저 코드에 넣지 않습니다.
- 키가 노출되었다면 즉시 폐기하고 새 키를 발급합니다.

## Network

Docker Compose 기본값은 `127.0.0.1:8000`으로 로컬에서만 접근됩니다. 외부 서버나 터널에 공개할 때는 `APP_ENV=production`, 강한 `DEMO_USERNAME`/`DEMO_PASSWORD`, HTTPS reverse proxy를 설정해야 합니다.

## Stored data

거래 기록은 기본적으로 `journal/trade_journal.db`에 평문 SQLite로 저장됩니다. 컴퓨터 계정과 디스크를 보호하고, DB를 공유 저장소나 공개 백업에 올리지 마세요.

보안 문제를 공개 이슈에 API key와 함께 작성하지 마세요.
