# DevLoop

> **앱에서 버그를 신고하면, AI 가 고쳐서 배포까지 해 줍니다.**

```mermaid
flowchart LR
    A["🙋 사용자<br/>앱에서 Shift+F9<br/>화면·로그 자동 첨부"] --> B["🤖 AI (Claude Code)<br/>원인 찾아 코드 수정<br/>실시간 로그"]
    B --> C["✅ 검증<br/>lint · build · compile"]
    C --> D["🖥️ 화면 확인<br/>헤드리스 브라우저로<br/>실제 화면 열어봄"]
    D --> E["🔀 PR → 병합"]
    E --> F["🚀 배포 확인"]
    F -. "질문 · 추가 수정 요청 · 추천 개선" .-> B
```

리포트 하나에 **5~10분**, 비용 **$0.5~1**. Vue·React·순수 HTML 어디에나 붙습니다.

---

## 구성

```mermaid
flowchart TB
    subgraph APP["각 앱 (프론트)"]
        C1["📦 client<br/>신고 창 · 목록 뷰어 · 수집기<br/>(두 줄로 설치)"]
    end
    subgraph SRV["개발서버 한 대"]
        S1["🖧 server<br/>리포트 저장 · 자동 수정 파이프라인"]
        S2["🎛️ 관리 콘솔 /devloop/ui/<br/>프로젝트 · 키 · 점검 · 로그"]
        S3["🔍 front-check<br/>헤드리스 화면 확인"]
    end
    subgraph GH["GitHub"]
        G1["저장소 · PR · Actions 배포"]
    end
    C1 -- 리포트 --> S1
    S1 -- 실시간 로그 --> C1
    S1 --> S3
    S1 -- PR·병합 --> G1
    G1 -- 배포 결과 --> S1
```

---

## 시작하기 — 3단계

```mermaid
flowchart LR
    S["① 서버 켜기<br/>(한 번만, 5분)"] --> K["② 콘솔에서 설정<br/>키 넣고 · 프로젝트 추가 · 점검"] --> A["③ 앱에 두 줄<br/>SDK 설치"]
```

### ⓪ 백엔드가 Node 라면 — 서버 없이 앱에 내장

```js
import { devloopKit } from 'devloop/embed';
app.use('/devloop', devloopKit());          // 신고 API · 콘솔(/devloop/ui/) · AI 수정 파이프라인 전부. 앱과 같이 뜨고 같이 갱신된다
```
package.json 한 줄 + 이 한 줄. 프로젝트 이름·저장소·브랜치·검증 명령은 package.json 과 git remote 에서 알아서 읽고, 설정은 `.devloop-data/`(gitignore) 에 둔다.
그 기계에 git·Claude Code CLI(로그인)·빌드 도구가 있으면 된다. 저장소 토큰은 `DEVLOOP_GITHUB_TOKEN` / `GITLAB_TOKEN` 환경변수. 프론트는 아래 ③ 의 플러그인 한 줄(endpoint 는 `/devloop`).
Spring 백엔드는 **스타터 한 줄**: `implementation 'com.github.hskim2515:devloop:v0.2.15'` (JitPack). 최근 로그 끝점·`/devloop/**` 프록시·보안 허용이 자동으로 붙고, 그 호스트에 Node 가 있으면 devloop 워커까지 앱과 같이 띄운다([spring-boot-starter](packages/spring-boot-starter)). Node 가 없는 컨테이너 배포는 `devloop.server` 로 ①② 의 인스턴스를 가리킨다.

### ① 서버 켜기 — **앱 하나에 인스턴스 하나**

코드는 한 번만 받고, 앱마다 인스턴스(포트·데이터·콘솔이 따로)를 띄웁니다. 같은 개발서버에 앱이 여럿이면 인스턴스를 그만큼.

```bash
git clone https://github.com/hskim2515/devloop.git ~/devloop && cd ~/devloop && npm install   # 처음 한 번
mkdir -p ~/.config/devloop && (umask 077; echo "ADMIN_KEY=$(openssl rand -hex 16)" > ~/.config/devloop/default.env)
claude login                                                   # 터미널에서 한 번
docker pull mcr.microsoft.com/playwright:v1.47.2-jammy
loginctl enable-linger $USER
packages/server/deploy/new-instance.sh myapp 8790              # 앱마다: 이름·포트 → devloop-server@myapp
```
앱 nginx: `location ^~ /devloop/ { proxy_pass http://127.0.0.1:8790/api/; client_max_body_size 60m; }` (인스턴스 포트로)
갱신: `packages/server/deploy/update.sh` 가 코드를 받고 인스턴스마다 큐가 비면 재시작합니다.

### ② 관리 콘솔 `https://앱주소/devloop/ui/`

첫 화면의 **시작 체크리스트**가 남은 일을 알려 줍니다.

| 탭 | 한 줄 요약 |
|---|---|
| 🔑 키·계정 | GitHub 토큰, 테스트 계정 넣기 |
| 📁 프로젝트 | 저장소 주소·브랜치·검증 명령 적고 저장 |
| 🩺 점검 | 버튼 눌러서 잘 붙었는지 확인 |
| 📋 리포트 | 신고 현황, 진행 중 로그, 리포트 열어 보기(수정 뒤 화면 확인 스크린샷 포함) |
| 💡 제안 | AI 가 리포트·커밋·코드·**헤드리스로 열어 본 화면**을 보고 고칠 점을 먼저 찾음. 제안만 하고 코드는 안 건드림 |
| 🧭 지식 | 프로젝트 **지식 그래프**(메뉴 → 기능 → 파일 → API → 백엔드). 연결되면 자동 구축, 병합될 때마다 갱신. 수정·질문·제안 때 AI 가 참고 |

비밀값은 서버 홈에만 저장됩니다. 저장소에는 절대 안 들어갑니다.

### ③ 앱에 붙이기 — 플러그인 한 줄

```bash
npm i -D github:hskim2515/devloop#v0.1.47
```
```js
// vite.config.js (Vite 앱: React·Vue·Svelte…)
import devloopKit from 'devloop/vite';
export default defineConfig({ plugins: [react(), devloopKit({ restBase: '/rest', server: 'http://개발서버:8791' })] });
```
```js
// vue.config.js (Vue CLI / webpack 앱)
const devloopKit = require('devloop/webpack');
module.exports = { configureWebpack: { plugins: [devloopKit({ project: 'myapp', restBase: () => process.env.VUE_APP_REST_SERVER })] } };   // 키(VUE_APP_DEVLOOP_KEY)가 없는 빌드는 자동으로 꺼짐
```
이게 전부입니다. 플러그인이 SDK 를 index.html 에 자동으로 넣고(콘솔·fetch/XHR·주소 변화·큰 캔버스 캡처), 신고 서버 주소를 정하고, `앱주소/devloop/` 로 들어오면 콘솔로 보내 줍니다. 키는 `.env` 의 `VITE_DEVLOOP_KEY`.
백엔드에는 `npx devloop-adapter spring …` 한 줄(최근 로그 + `/devloop/**` 프록시). 앱 nginx 는 안 건드립니다.

더 담고 싶은 것(앱 상태·보고자·WebGL 다시 그리기)은 코드 어디서든 `window.__devloop = { context: () => ({…}), user: () => '…', beforeCapture: () => viewer.render() }` 로.
플러그인 없이 직접 붙이려면 `createDevloop(...)`([client](packages/client)).

끝. **Shift+F9** 신고 · **Shift+F10** 목록.

### Windows 개발 환경
SDK(플러그인·신고 창·뷰어·콘솔)와 스타터의 프록시는 OS 를 가리지 않습니다. **워커**(저장소 사본·Claude 실행·검증·미리보기)만 리눅스/맥 전용이라, Windows 에서는 앱이 워커를 띄우지 않고 `/devloop` 가 503 이 됩니다(앱 자체는 정상).
Windows 개발자는 로컬 프로파일에 개발서버 워커 한 줄이면 됩니다(신고·AI 수정·미리보기 전부 개발서버에서 돕니다):
```properties
# application-local.properties (Spring)  /  Vite 는 devloopKit({ server: 'http://<개발서버>:<포트>' }) 로 같은 효과
devloop.server=http://<개발서버>:<워커 포트>
```
꼭 로컬 워커가 필요하면 WSL2 에서 앱을 실행하세요(리눅스 환경이라 그대로 돕니다).

### 버전·미리보기 (AI 수정본을 원격에 올리기 전에 직접 써 보기)
AI 가 고친 소스 상태는 원격에 올리지 않아도 키트가 **버전**(키트 저장소 태그 `devloop/v{n}`)으로 갖습니다. 프로젝트 `delivery` 로 어디까지 내보낼지 정하고(`local` 보관만 · `branch` · `pr` · `merge`),
콘솔 **버전** 탭의 레시피(`preview`: 프론트 빌드·백엔드 실행 이미지·DB 복제)를 적으면 버전마다 프론트+백엔드+DB 사본을 띄워 `앱주소/<키트 경로>/v/{project}/{n}/` 로 접속합니다(AI 초안 버튼이 저장소를 읽고 레시피를 만들어 줍니다).
프론트는 키트가 `DEVLOOP_PREVIEW_BASE` 를 주고 빌드하며 vite 플러그인은 `base`, webpack 플러그인은 `publicPath` 를 맞춥니다. Vue CLI 앱은 router 의 `BASE_URL` 때문에 `vue.config.js` 에 `publicPath: process.env.DEVLOOP_PREVIEW_BASE || '/'` 한 줄이 필요합니다.

### 배포판 (받는 쪽에 넘기는 한 덩이 — DB DDL 까지)
콘솔 **배포판** 탭에서 어느 버전이든 한 덩이로 묶습니다 — 프론트 빌드 결과 · 백엔드 실행 파일 · 릴리스 노트 · 체크섬에 **DB 스키마를 맞추는 DDL** 까지. 빌드 방법은 미리보기 레시피(`preview`)를 그대로 쓰고, 다른 점만 `release` 에 적습니다.

git 은 소스를 추적하지만 DB 스키마는 아무도 추적하지 않습니다. 그래서 받는 쪽에 테이블·열이 없어 배포 직후 깨집니다. 키트는 스키마를 추측하지 않고 **두 DB 의 스냅샷을 비교해** 받는 쪽에 없는 것만 만듭니다.

```
받는 쪽 DB ──(1) 스냅샷 SQL 받기 → psql -At -f → schema-baseline.json ──(2) 콘솔에 올리기
                                                                            ↓
보내는 쪽 DB ─────────────────────── 스냅샷 ──→ 비교 ──→ db/01-적용.sql  (만들고 더하는 것만, 재실행 안전)
                                                      └─→ db/02-확인필요.sql (지우고 좁히는 것 — 전부 주석)
```

- **기준 스냅샷**은 ① 올린 것 → ② 직전 배포판에 담긴 것 → ③ 없으면 전체 스키마 순으로 찾습니다. 운영망이 분리돼 받는 쪽 DB 에 직접 붙지 못하는 보통의 경우에 ① 을 씁니다(스냅샷 SQL 은 읽기만 합니다).
- `01-적용.sql` 은 **만들고 더하는 변경만** 담고 트랜잭션으로 감싸며 `IF NOT EXISTS`·존재 확인으로 몇 번 실행해도 결과가 같습니다. 순서도 맞춥니다 — 시퀀스 → 테이블 → PK·UNIQUE → FK, 파티션 키 유지, identity 열의 시퀀스는 중복 생성하지 않음, 확장은 트랜잭션 밖에서(OS 패키지가 없으면 경고만).
- `02-확인필요.sql` 은 DROP·타입 변경·NOT NULL 추가처럼 데이터를 잃을 수 있는 것이라 **전부 주석**입니다. 보내는 쪽에 없다는 것이 "지워야 한다" 는 뜻은 아니기 때문입니다.
- `release.ddlGlob` 을 적으면 저장소에 커밋된 DDL 파일이 받는 쪽에 실제로 들어갔는지도 이름으로 훑어 릴리스 노트에 적습니다(SQL 을 해석하지는 않습니다).
- 루프 단계 `{ type: 'release' }` 로 자동화할 수 있습니다. 보관 개수는 `release.keep`(기본 5) — 넘으면 빌드 산출물만 지우고 DDL·스냅샷은 남겨 기준점이 끊기지 않게 합니다.

**운영 프로파일로 빌드해야 합니다.** 미리보기는 개발용 프로파일로 빌드하므로(개발 API 주소·개발 DB 설정), `release.front.build`·`release.back.build` 에 운영 명령을 적어야 합니다. 안 적으면 미리보기 명령을 그대로 쓰고 콘솔과 릴리스 노트에 ⚠ 로 적습니다 — 조용히 개발 빌드를 넘기지 않습니다. `release.front.env` 를 주면 미리보기 env 를 대신하며, `{backUrl}` 같은 미리보기 자리표시자가 든 값은 배포판에 들고 가지 않습니다.

```yaml
release:
  frontBase: /                 # 배포판 프론트의 publicPath (미리보기와 달리 실제 서비스 경로)
  front: { build: 'npx vue-cli-service build --mode product' }   # 운영 프로파일
  back:  { build: './gradlew bootWar -Pprofile=product' }
  include: { front: true, back: true, db: true }
  schemas: [public]
  ddlGlob: 'doc/database/**/ddl/*.sql'
  keep: 5
```

`dir`·`dist`·`artifact` 처럼 안 적은 값은 미리보기 레시피 것을 그대로 씁니다. DB 스냅샷은 프로파일과 무관합니다 — 스키마는 설정이 아니라 DB 에 있는 것이라 개발 DB 에서 떠도 같습니다.

**킷을 거치지 않은 작업도 들어갑니다.** 킷이 만든 '버전'은 킷이 고친 커밋만 가리키지만, 배포판의 기본값은 **기준 브랜치 최신**이라 사람이 직접 푸시한 것까지 전부 담습니다. 버전을 골라 묶으면 그 뒤·옆의 작업이 빠지므로, 키트가 이것을 재서 막습니다:

| 고른 소스 | 어떻게 되나 |
| --- | --- |
| 기준 브랜치 최신(기본) | 그대로 묶습니다. 모든 작업 포함 |
| 기준 브랜치에 병합된 버전 | 묶되, 뒤에 남은 커밋 수와 작성자를 진행 로그·릴리스 노트에 적습니다 |
| 아직 병합 안 된 버전 | **거부**합니다(다른 작업이 전부 빠지므로). 정말 필요하면 `force` |

DB 쪽은 애초에 영향이 없습니다 — 스냅샷을 **살아 있는 DB** 에서 뜨므로 누가 어떻게 바꿨든(사람이 직접 적용한 DDL, 앱이 기동할 때 만든 테이블까지) 그 결과가 그대로 들어옵니다.

---

## 사용자는 이것만

```mermaid
flowchart LR
    R["Shift+F9<br/>신고"] --> L["Shift+F10<br/>목록 열기"] --> F["AI 에게 수정 요청"] --> W["로그 보며 기다리기<br/>(5~10분)"] --> M{"결과"}
    M -- "병합 완료" --> D["배포까지 자동"]
    M -- "더 고치고 싶다" --> Q["입력창에 쓰고<br/>질문 / 수정 요청"]
    M -- "AI 추천이 마음에 든다" --> S["추천 개선 [실행]"]
```

---

## 자주 묻는 것

| 질문 | 답 |
|---|---|
| 앱 nginx 를 꼭 고쳐야 하나요? | 아니요. 백엔드 어댑터의 `/devloop/**` 프록시 라우트(Spring·Express)로 앱 REST 경로 뒤에 `/devloop` 를 붙여 닿고, Vite 플러그인이 `앱주소/devloop/` 를 그리로 보내는 안내 페이지를 빌드에 넣습니다. nginx 한 줄로 `/devloop` 를 바로 넘기는 것도 됩니다 |
| 백엔드 로그도 신고에 붙나요? | 네. 앱에 최근 로그 끝점 하나만 있으면 됩니다: Spring 은 `npx devloop-adapter spring …`, Express 는 `devloop/adapters/express` ([adapters](packages/adapters)) |
| GitHub 가 아니어도 되나요? | GitLab(셀프호스팅 포함)도 됩니다. 저장소 주소만 적으면 자동 판별, 토큰은 프로젝트 env 의 `GITLAB_TOKEN` (api·write_repository) |
| 백엔드도 고치나요? | 네, 같은 저장소면 프론트·백엔드 다. 백엔드 검증은 컴파일·테스트까지 |
| 신고 창 자체가 이상하면? | 신고 창의 **버그 신고 도구 문제** 를 체크해 신고. 같은 프로젝트에 '도구' 표시로 남고 AI 수정 대상은 아님(운영자가 도구 저장소에서 처리) |
| 운영 서버에 영향은? | 없음. 개발 저장소·브랜치만 건드리고, front-check 는 운영 주소 요청을 차단 가능 |
| 개인정보는? | 신고자·문제 원문은 PR 에 안 들어감. 인증값 마스킹, AI 에겐 추린 로그만 |
| 서버를 재시작하면? | 끊긴 작업은 재시작 뒤 자동으로 다시 큐에 들어감(PR 을 올린 뒤면 그대로). 앱 서버 재배포와는 무관 |
| 앱이 여럿이면? | 앱마다 인스턴스(`new-instance.sh 이름 포트`). 콘솔·데이터·큐가 완전히 따로. 프론트/백엔드 저장소가 나뉜 한 앱은 한 인스턴스에 프로젝트 두 개로 등록해도 됨 |
| 지식 그래프는 언제 갱신되나요? | 처음 연결될 때 자동 구축, 수정이 병합될 때마다 바뀐 파일만 갱신, 그리고 `knowledge.schedule: "04:00"` 같은 예약. 콘솔 지식 탭에서 검색·수동 갱신 |
| 화면 확인 스크린샷은 어디에? | 수정 뒤 front-check 가 찍은 것은 그 리포트의 AI 자동 수정 칸에, 제안 분석 때 찍은 것은 제안 탭 위에. 서버 `{dataDir}/{project}/shots/` 에 최근 회차만 보관 |

문제가 생기면 콘솔 **점검** 탭과 **로그** 탭. 서버 갱신: `~/devloop/packages/server/deploy/update.sh` (돌던 작업이 끝나길 기다렸다가 재시작. 끊긴 작업은 재시작 뒤 자동으로 다시 큐에)

자세한 옵션: [server](packages/server) · [client](packages/client) · [front-check](packages/front-check)
