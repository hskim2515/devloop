# devloop Spring Boot 스타터

Spring 앱은 JS 를 못 돌리므로 "앱 내장" 대신, **의존성 한 줄**로 다음을 붙입니다.

- 최근 로그 링 버퍼 + `GET /debug/recent-logs` (신고에 백엔드 로그가 붙는다)
- `/devloop/**` 프록시 → devloop 인스턴스 (앱 프론트는 `<REST 경로>/devloop` 로 닿는다. nginx 불필요)
- 그 호스트에 Node 가 있으면 **devloop 워커를 앱과 같이 띄운다** (설치·설정·재시작까지 스타터가 관리). 없으면 `devloop.server` 로 외부 인스턴스를 가리킨다
- Spring Security 가 있으면 `/devloop/**` 허용

```groovy
repositories { maven { url 'https://jitpack.io' } }
dependencies { implementation 'com.github.hskim2515:devloop:v0.2.15' }
```

```properties
# 전부 선택. 배포된 자리에 git 이 없으면 저장소 주소만 적어 준다(또는 gradle-git-properties 로 git.properties 생성)
devloop.repo=https://github.com/org/app.git
devloop.base-branch=develop
# 워커 대신 외부 인스턴스를 쓸 때
# devloop.server=http://127.0.0.1:8790
```

프론트는 Vite/webpack 플러그인 한 줄(`restBase` 가 앱 REST 경로). 워커가 뜨는 호스트에는 git·Claude Code CLI 로그인·빌드 도구가 있어야 하고, 저장소 토큰은 `DEVLOOP_GITHUB_TOKEN` / `GITLAB_TOKEN` 환경변수 또는 `~/.config/devloop/`. 운영자 키는 `devloop.admin-key` / `DEVLOOP_ADMIN_KEY` / 없으면 `~/.devloop-data/<앱>/admin-key` 에 만들어 로그에 한 번 출력. 콘솔은 `<REST 경로>/devloop/ui/`.

앱을 여러 인스턴스로 띄우면 워커는 하나에서만: `devloop.worker.enabled=${DEVLOOP_WORKER:false}` 같은 식으로.


## Windows
워커는 리눅스/맥 전용입니다. Windows 에서는 스타터가 워커를 띄우지 않고 로그에 안내를 남기며 `/devloop` 는 503 입니다. 로컬 프로파일에 `devloop.server=http://<개발서버>:<워커 포트>` 를 적으면 개발서버 워커를 그대로 씁니다(또는 WSL2).
