/**
 * 화면 글자 번역(한국어 → 영어). 원본 UI 는 한국어로 쓰고, 영어는 DOM 을 훑어 정확히 일치하는 구절만 바꾼다.
 * 데이터(리포트 본문·로그·지식 그래프·AI 답변)는 건드리지 않는다: .bf-md .bf-log .bf-diff pre code .prob .ktree .brv-text 등은 제외.
 *   lang: localStorage['devloop-lang'] → navigator.language(ko 면 ko, 아니면 en)
 *   translateTree(root, lang): root 아래를 번역하고 MutationObserver 로 새로 생기는 글자도 계속 번역
 */
export const KO_EN = {
  // 배포판
  '어느 소스로 묶나': 'Which source to package', '병합 안 된 소스도 허용': 'Allow unmerged source',
  '기준 브랜치 최신 (권장 - 모든 작업 포함)': 'Latest on base branch (recommended - includes all work)',
  '최신과 같음': 'same as latest', '에 병합되지 않은 소스': 'source not merged into',
  '기준 스냅샷 (받는 쪽 DB)': 'Baseline snapshot (target DB)', '스냅샷 SQL 받기': 'Download snapshot SQL', '기준 스냅샷 올리기': 'Upload baseline snapshot',
  '배포판 만들기': 'Build release', '기준 브랜치 최신': 'Latest on base branch', '내려받기': 'Download', '적용 DDL': 'Apply DDL', '확인 필요': 'Needs review', '노트': 'Notes',
  '아직 배포판이 없습니다': 'No releases yet', '지우기': 'Clear', '묶는 중': 'packaging', '준비됨': 'ready', '대기': 'queued', '실패': 'failed',
  '이름 (선택: 2026-10 1차 납품)': 'Name (optional)', '릴리스 노트에 넣을 메모 (선택)': 'Note for the release notes (optional)',
  '어느 버전으로 묶을까요': 'Which version to package', '올린 스냅샷': 'uploaded snapshot', '직전 배포판': 'previous release', '없음(전체)': 'none (full schema)',
  '적용': 'apply', '확인': 'review', '기준:': 'baseline:',
  // ── 콘솔 공통 ──
  '리포트': 'Reports', '제안': 'Insights', '버전': 'Versions', '배포판': 'Release', '루프': 'Loops', '지식': 'Knowledge', '프로젝트': 'Project', '키·계정': 'Keys', '서버': 'Server', '점검': 'Checks', '로그': 'Logs',
  '관리': 'Console', 'devloop 관리': 'devloop console', '키 지우기': 'Clear key', '저장된 운영자 키 지우기': 'Forget the saved admin key', '운영자 키': 'Admin key', '들어가기': 'Enter',
  '⏳ 잠시만요': '⏳ One moment', '입력한 키는 그대로 둡니다. 계속 이 화면이면 앱 로그의 [devloop] 줄이나 콘솔 \'점검\' 탭을 보세요.': 'Your key is kept. If this stays, check the app log lines tagged [devloop] or the Checks tab.',
  '워커가 시작 중입니다 (앱 재배포 직후 10초~1분)': 'The worker is starting (10 s to 1 min after a redeploy)', '앱이 재시작 중입니다': 'The app is restarting', '운영자 키가 맞지 않습니다': 'Wrong admin key',
  '전체': 'All', '진행 중': 'In progress', '실패': 'Failed', '수정본 준비': 'Fix ready', 'PR 열림': 'PR open', '병합됨': 'Merged', '되돌림': 'Reverted', '요청 전': 'Not requested', '문제·보고자 검색': 'Search problem · reporter',
  '#': '#', '심각도': 'Severity', '문제': 'Problem', '수정': 'Fix', '보고자': 'Reporter', '갱신': 'Update', '리포트가 없습니다': 'No reports', '대기': 'Queued', '수정 중': 'Fixing', '병합': 'Merged', '도구': 'tool',
  'PR 만들기': 'Open PR', '병합까지': 'Merge', '되돌리기': 'Revert', '되돌리기 PR': 'Revert PR', '병합된 수정을 revert 하는 브랜치·PR 을 만듭니다(자동 병합 프로젝트면 병합까지)': 'Creates a revert branch and PR (and merges it if the project auto-merges)',
  '· 원격에 푸시됨(PR 없음)': '· pushed to remote (no PR)', '· 키트 저장소 안(원격에 없음)': '· only on this server (not on remote)',
  'AI 수정본이 담긴 작업 브랜치. \'푸시됨\' 이면 원격 저장소에 같은 이름으로 있고, \'키트 안\' 이면 아직 이 서버에만 있습니다': 'Work branch holding the AI fix. "pushed" means it exists on the remote with this name; otherwise it is only on this server',
  // 제안
  '특히 볼 것 (선택)': 'Focus on (optional)', '분석 실행': 'Run analysis', '진행 로그': 'Progress log', '확신': 'Confidence', '파일': 'Files', '리포트로': 'To report', '바로 수정': 'Fix now', '삭제': 'Delete',
  '이 제안을 지웁니다. 다음 분석에서 같은 내용은 다시 나오지 않습니다': 'Removes this insight; the next analysis will not raise it again',
  '분석 실행을 누르면 AI 가 최근 리포트·커밋·코드를 읽고 고칠 점을 찾습니다 (5분 안팎, Claude 비용 발생)': 'Run analysis: the AI reads recent reports, commits and code to find things to fix (about 5 min, Claude cost)',
  '마지막 분석': 'last analysis', '분석 전': 'not analysed yet', '대기 중…': 'queued…', '분석 중…': 'analysing…',
  // 버전
  'AI 가 고친 소스 상태는 원격에 올리지 않아도 키트가': 'Every AI fix is kept by the kit as a', '으로 갖고 있습니다(키트 저장소 태그 devloop/v{n}). 버전마다 프론트+백엔드+DB 사본을 띄워': 'even before it goes to the remote (kit repo tag devloop/v{n}). Each version can be spun up as front+backend+DB copy and', '해 보고, 마음에 들면': ', and when it looks right you', '원격으로 보냅니다': 'send it to the remote', '(브랜치만 / PR·MR / 자동 병합).': '(branch only / PR·MR / auto-merge).', '접속': 'opened',
  '미리보기 레시피': 'Preview recipe', '· 있음': '· set', '· 없음 (초안을 만들거나 적어 주세요)': '· none (draft one or write it)',
  '프론트 빌드·백엔드 실행·DB 복제 방법. 자리표시자 {base} {project} {n} {db} {port} {host} {previewUrl} {backUrl}. db.mode: template(기본, 템플릿 DB 에서 초 단위 복제) · clone(매번 라이브에서, 느림) · shared(사본 없이 개발 DB 공유). maxUp(동시 개수, 기본 2) · ttlHours(미사용 자동 중지, 기본 12)': 'How to build the front, run the backend and copy the DB. Placeholders {base} {project} {n} {db} {port} {host} {previewUrl} {backUrl}. db.mode: template (default, seconds from a template DB) · clone (from live each time, slow) · shared (use the dev DB, no copy). maxUp (concurrent previews, default 2) · ttlHours (auto-stop when idle, default 12)',
  'AI 초안 만들기': 'Draft with AI', 'AI 에게 줄 메모 (선택: 배포 서버 IP, DB 컨테이너 이름 …)': 'Notes for the AI (optional: deploy host IP, DB container name …)', '레시피 저장': 'Save recipe',
  'Claude 가 저장소(컴포즈·Dockerfile·env·properties)를 읽고 초안을 만듭니다 (1~3분)': 'Claude reads the repo (compose, Dockerfile, env, properties) and drafts a recipe (1–3 min)',
  '내용': 'Contents', '미리보기': 'Preview', '아직 버전이 없습니다 - AI 수정이 끝나면 여기에 쌓입니다': 'No versions yet - they appear here when an AI fix finishes',
  '미리보기 띄우기': 'Start preview', '다시 띄우기': 'Restart preview', '중지': 'Stop', '원격으로 보내기': 'Send to remote', '열기 ↗': 'Open ↗', '떠 있음': 'up', '중지됨': 'stopped', '빌드 중': 'building', '시작 중': 'starting', '없음': 'none',
  '레시피가 먼저 필요합니다': 'A recipe is needed first', '닫기': 'Close',
  // 루프
  '정해 둔 순서를 되풀이 돕니다:': 'Runs a fixed sequence repeatedly:', '지식 갱신 → 제안 분석 → 심각도 이상 자동 수정 → 미리보기 → 내보내기': 'knowledge update → insights → auto-fix above a severity → preview → send to remote',
  '중 원하는 단계만. 시점은 수동 · 원격에 새 커밋이 보일 때 · N시간마다 · 매일 HH:MM.': '- pick the steps you want. Triggers: manual · new commit on the remote · every N hours · daily at HH:MM.',
  '을 정하면(지식 그래프의 화면·메뉴·기능) 그 기능에 이어진 파일들로 분석·수정을 한정합니다. 수정은 프로젝트의 내보내기 설정(보관만/브랜치/PR/병합)을 따르고, 한 번에 최대 건수를 둡니다(Claude 비용).': '(a screen/menu/feature from the knowledge graph) limits analysis and fixes to the files connected to it. Fixes follow the project delivery setting (keep / branch / PR / merge) with a per-run cap (Claude cost).',
  '대상 기능': 'Target feature', '단계': 'Steps', '시점': 'Trigger', '마지막 · 다음': 'Last · next', '루프가 없습니다 - 아래에서 만드세요': 'No loops - create one below', '새 루프': 'New loop', '이름': 'Name',
  '비우면 전체': 'empty = whole project', '화면·메뉴·기능 이름 (지식 그래프)': 'Screen / menu / feature name (knowledge graph)', '수동(지금 실행만)': 'Manual (run now only)', '원격에 새 커밋이 보이면': 'When a new commit appears on the remote', 'N시간마다': 'Every N hours', '매일 정해진 시각': 'Daily at a time', '6 (시간) / 03:00': '6 (hours) / 03:00',
  '순서대로 · 켠 것만': 'in order · enabled only', '1. 지식 그래프 갱신': '1. Update knowledge graph', '바뀐 코드를 읽어 화면·기능·파일 관계를 최신으로 맞춥니다. 뒤 단계의 AI 가 이 그래프를 참고합니다.': 'Reads changed code to refresh screen/feature/file relations. Later steps consult this graph.',
  '2. 제안 분석': '2. Insights', '코드·최근 리포트·헤드리스 화면 확인을 바탕으로 고칠 점(버그·위험·정리)을 찾아 "제안" 탭에 쌓습니다.': 'Finds things to fix (bugs, risks, cleanup) from code, recent reports and a headless screen check, and lists them in the Insights tab.',
  '3. 자동 수정': '3. Auto-fix', '2 에서 찾은 제안 중 심각도': 'From step 2, take insights of severity', '이상을 심각한 순으로 최대': 'or higher, most severe first, up to', '건, AI 가 고쳐 검증한 뒤 작업 브랜치(': 'items; the AI fixes, verifies and commits to the work branch (', ')에 커밋합니다. 종류 제한:': '). Restrict kinds:', 'bug,risk (비우면 전부)': 'bug,risk (empty = all)',
  '고친 결과가 원격 저장소로 어디까지 가는지는 5 단계 또는(5 를 끄면) 프로젝트 설정': 'How far the result goes to the remote is step 5 or, if 5 is off, the project setting', '을 따릅니다.': '.',
  '4. 미리보기': '4. Preview', '3 에서 만든 수정본마다 프론트+백엔드+DB 사본을 띄워 접속 주소를 만듭니다(버전 탭·뷰어에서 열기). 레시피가 없으면 건너뜁니다.': 'Spins up front+backend+DB copy for each fix from step 3 and gives a URL (open from Versions tab or viewer). Skipped without a recipe.',
  '5. 원격 저장소로 보내기': '5. Send to remote', '3 의 수정본 브랜치를': 'Send the fix branch from step 3:', '원격에 브랜치만 올리기 (PR 없음)': 'push the branch only (no PR)', 'PR/MR 까지 만들기 (병합은 사람이)': 'open a PR/MR (a person merges)', '재검증 뒤 자동 병합·배포까지': 're-verify, auto-merge and track deploy',
  '끄면 3 단계가 프로젝트 설정대로 처리합니다(보관만이면 이 서버에만 남고, 버전 탭에서 나중에 보낼 수 있음).': 'If off, step 3 follows the project setting (with "keep" it stays on this server; send it later from the Versions tab).',
  '제한 시간': 'Time limit', '분': 'min', '켜기': 'Enabled', '저장': 'Save', '실행 기록': 'Run history', '지금 실행': 'Run now', '편집': 'Edit', '꺼짐': 'off', '단계 없음': 'no steps', '실행 전': 'never run', '아직 실행한 적 없음': 'No runs yet', '수동': 'Manual', '원격 새 커밋': 'Remote commit',
  '지식 갱신': 'Knowledge update', '제안 분석': 'Insights', '미리보기 띄우기 ': 'Preview', '자동 수정': 'Auto-fix', '야간 점검': 'Nightly check', '이름을 적어 주세요': 'Enter a name', '단계를 하나 이상 고르세요': 'Pick at least one step', '저장됨': 'Saved',
  // 지식
  '3D': '3D', '트리': 'Tree', '전체 구축': 'Full rebuild', '마지막 구축 이후 바뀐 파일만 반영': 'Only files changed since the last build', '처음부터 다시 만든다 (5~15분, Claude 비용 발생)': 'Rebuild from scratch (5–15 min, Claude cost)', '메뉴·기능·파일 검색': 'Search menu · feature · file', '모두 펼치기': 'Expand all', '모든 노드 펼치기': 'Expand every node', '접기': 'Collapse', '화면·메뉴만': 'Screens and menus only',
  '프로젝트가 연결되면 자동으로 구축됩니다. 병합될 때마다, 그리고 예약 시각(knowledge.schedule)에 갱신됩니다.': 'Built automatically when a project connects; refreshed after each merge and at the scheduled time (knowledge.schedule).',
  '원격과 같음 · ': 'in sync with remote · ', '왼→오: 모듈 · 화면 · 메뉴 · 기능 · 파일 · API · 백엔드 · 테이블': 'left→right: module · screen · menu · feature · file · API · backend · table', '처음엔 화면·메뉴만 · ▸ 표시 노드를 누르면 아래가 펼쳐짐 · 빈 곳 클릭 = 선택 해제': 'Starts with screens and menus · click a ▸ node to expand · click empty space to deselect',
  '모듈': 'module', '화면': 'screen', '메뉴': 'menu', '기능': 'feature', '컴포넌트': 'component', '스토어': 'store', '유틸': 'util', '서비스': 'service', '테이블': 'table', '선:': 'edges:', '포함': 'contains', '호출': 'calls', '읽기/쓰기': 'reads/writes', '이동': 'navigates',
  '3D 불가': '3D unavailable', '트리로 보여줍니다': 'showing the tree', 'WebGL 없음': 'no WebGL',
  // 프로젝트
  '새 프로젝트': 'New project', 'SDK 의 project 값': 'the SDK project value', '저장소 URL': 'Repository URL', 'GitHub owner/repo': 'GitHub owner/repo', '기준 브랜치': 'Base branch',
  '수정본을 원격에': 'Deliver fixes to remote', 'AI 가 고친 뒤 어디까지 보낼지': 'how far an AI fix goes', '푸시 + PR + 자동 병합 (검증 통과 시)': 'push + PR + auto-merge (when verified)', '푸시 + PR 만 (병합은 사람이)': 'push + PR only (a person merges)', '원격 브랜치 푸시만 (PR 없음)': 'push the branch only (no PR)', '보관만 - 키트 저장소 안 브랜치 (원격에 안 올림)': 'keep only - branch inside the kit repo (nothing on remote)',
  'AI 가 고친 코드는 항상': 'AI fixes are always committed to a', '작업 브랜치': 'work branch', '이름의': 'named', '에 커밋됩니다(기준 브랜치는 건드리지 않음). 어디까지 내보낼지:': '(the base branch is never touched). How far to send it:',
  '보관만': 'Keep only', '- 키트 저장소 안에만 둡니다. 원격(GitHub/GitLab)엔 아무것도 안 생깁니다. 콘솔 버전 탭에서 미리보기로 확인한 뒤 내보내기.': '- stays inside the kit repo; nothing appears on GitHub/GitLab. Check it with a preview in the Versions tab, then send.',
  '브랜치 푸시만': 'Branch only', '- 그 작업 브랜치를 원격에 올립니다. PR/MR 은 안 만듭니다. 팀원이 브랜치를 받아 직접 검토·병합할 때.': '- pushes the work branch to the remote without a PR/MR, for teammates to review and merge themselves.',
  'PR 까지': 'Up to PR', '- 브랜치를 올리고 기준 브랜치로 향하는 PR/MR 을 만듭니다. 병합은 사람이.': '- pushes the branch and opens a PR/MR against the base branch. A person merges.',
  '자동 병합': 'Auto-merge', '- PR 을 만든 뒤 기준 브랜치와 합쳐 재검증하고 통과하면 병합, 배포까지 추적합니다.': '- opens the PR, merges the base branch in, re-verifies, merges when green and tracks the deploy.',
  '수정 요청': 'Fix requests', '누가 할 수 있나': 'who may request', '앱 사용자 + 관리 콘솔': 'app users + console', '관리 콘솔에서만 (앱은 신고만)': 'console only (app users report only)',
  '앱 주소': 'App URLs', '쉼표 구분 · 첫 주소가 알림 링크 기준': 'comma separated · the first is used for notification links', '알림 웹훅': 'Notification webhook', 'Slack incoming webhook 또는 JSON 을 받을 URL': 'Slack incoming webhook or any URL that accepts JSON', 'https://hooks.slack.com/services/… (비우면 알림 없음)': 'https://hooks.slack.com/services/… (empty = no notifications)', '테스트 보내기': 'Send test', '알림 이벤트': 'Notification events', '받을 것만': 'only the ones you want', '알림 멘션': 'Mention', 'Slack, 선택': 'Slack, optional', '<@U0123ABC> 또는 <!channel>': '<@U0123ABC> or <!channel>',
  '새 리포트': 'New report', '수정본 준비(보관·브랜치)': 'Fix ready (kept / branch)', 'PR/MR 생성': 'PR/MR opened', '병합 완료': 'Merged', '수정 실패': 'Fix failed', '미리보기 준비됨': 'Preview up', '미리보기 실패': 'Preview failed', '배포 완료': 'Deploy done', '배포 실패': 'Deploy failed', '루프 끝': 'Loop finished', '루프 실패': 'Loop failed', '제안 분석 끝': 'Insights done', '원격이 앞섬(지식 그래프)': 'Remote ahead (knowledge graph)',
  '프로젝트를 먼저 저장하세요': 'Save the project first', '보내는 중…': 'sending…', '✓ 보냈습니다 - 채널을 확인하세요. 계속 받으려면 저장을 누르세요': '✓ Sent - check the channel. Press Save to keep receiving',
  'API 키': 'API key', '프론트에 넣는 공개 키': 'public key used by the front end', '(선택)': '(optional)', '설명': 'Description', '스택·구조 한 줄': 'one line on stack and layout', '규약': 'Conventions', '경로별 검증 명령': 'verify commands per path', '+ 모듈': '+ module', '화면 확인': 'Screen check', '보호 경로': 'Protected paths', 'AI 가 바꾸면 되돌림. 줄마다 하나': 'reverted if the AI touches them, one per line', '허용 도구': 'Allowed tools', '줄마다 하나': 'one per line', '환경변수': 'Environment', 'cwd (예: web)': 'cwd (e.g. web)',
  '공통': 'Shared', '프로젝트별': 'Per project', '공통보다 우선': 'overrides shared', '서버 설정': 'Server settings', '포트': 'Port', 'Claude 실행 파일': 'Claude binary', 'PATH 추가': 'Extra PATH', '\':\' 구분': 'colon separated', 'Claude 모델': 'Claude model', '최대 턴': 'Max turns', 'Claude 시간 제한(분)': 'Claude time limit (min)', '검증 명령 시간 제한(분)': 'Verify time limit (min)', '작업 디렉터리': 'Work directory', '데이터 디렉터리': 'Data directory', '환경': 'Environment',
  '저장소 토큰 · 권한 (GitHub/GitLab)': 'Repository token · permissions (GitHub/GitLab)', 'Claude Code · git · Node (워커 실행 환경)': 'Claude Code · git · Node (worker environment)', 'Docker · 브라우저 이미지': 'Docker · browser image', '저장소 접근': 'Repository access', '앱 화면 열기': 'Open the app screen', '1~2분': '1–2 min', '검사': 'Check', '검사 중…': 'checking…',
  '서버 로그': 'Server log', '다시 읽기': 'Reload', '5초마다': 'every 5 s', '(다시 읽기를 누르세요)': '(press Reload)',
  // 체크리스트
  '설정': 'Setup', ' - 필수는 끝, 선택 항목 남음': ' - required done, optional left', '프로젝트 등록': 'Project registered', 'Claude Code CLI 설치': 'Claude Code CLI installed', 'Claude 로그인': 'Claude logged in', 'git 설치': 'git installed', '헤드리스 브라우저 (docker 이미지)': 'Headless browser (docker image)', '테스트 계정 (로그인이 있는 앱만)': 'Test account (apps with login)', '앱 SDK 연결 (첫 신고)': 'App SDK connected (first report)', '(선택)': '(optional)', '→ 키·계정 탭': '→ Keys tab', '→ 점검 탭': '→ Checks tab', '→ 프로젝트 탭': '→ Project tab',
  // 뷰어
  '저장된 버그 리포트': 'Saved bug reports', '← 목록': '← List', '기본 정보': 'Basics', '상태': 'Status', '일시': 'Time', 'AI 자동 수정': 'AI auto-fix', '새로고침': 'Refresh', '처음부터 다시': 'Start over', '상태·로그 다시 읽기 (PR 이 열려 있으면 GitHub 와 맞춤)': 'Reload status and log (syncs with GitHub when a PR is open)', '앞선 대화·수정을 잇지 않고 원인 조사부터 새로 고칩니다': 'Fix again from scratch, ignoring the earlier conversation',
  '병합된 이 수정을 되돌리는 브랜치·PR 을 만듭니다 (자동 병합 프로젝트면 병합까지)': 'Creates a branch and PR reverting this merged fix (merged too on auto-merge projects)',
  'AI 에게 수정 요청': 'Ask the AI to fix', '서버의 AI 가 원인을 찾아 고치고 검증 → PR → 병합 → 배포까지 자동으로 진행합니다. 진행 상황은 여기에 실시간으로 표시됩니다.': 'The server AI finds the cause, fixes, verifies, opens a PR, merges and tracks the deploy. Progress shows here live.',
  '버그 신고 도구 자체의 문제로 접수됐습니다. 앱 코드 수정 대상이 아니라 운영자가 도구 저장소에서 처리합니다.': 'Filed as an issue of the reporting tool itself; handled by the operator in the tool repo, not the app code.', '이 프로젝트의 수정은 운영자가 관리 콘솔에서 진행합니다. 신고는 접수됐습니다.': 'Fixes for this project are started by the operator from the console. Your report is filed.',
  '미리보기 열기 ↗': 'Open preview ↗', '미리보기 준비 중': 'preview starting', '이 수정본으로 프론트·백엔드·DB 사본을 띄워 직접 써 봅니다 (몇 분)': 'Spin up front, backend and a DB copy with this fix and try it (a few minutes)', '이 수정본으로 띄운 앱(프론트+백엔드+DB 사본)': 'The app running this fix (front+backend+DB copy)',
  '원격에 브랜치만 있음 · PR 없음': 'branch on remote · no PR', '키트 서버 안에만 있음 · 원격에 없음': 'only on the kit server · not on remote',
  '관련 기능·파일': 'Related features · files', '지식 그래프에서 이 신고와 이어진 부분 · 노란 테두리 = 신고 내용과 직접 맞는 것': 'Part of the knowledge graph linked to this report · yellow border = direct match', '화면·메뉴': 'Screens · menus', '구현 파일': 'Implementation files',
  '추천 개선': 'Suggested follow-ups', '실행을 누르면 그 내용으로 이어서 고칩니다': 'Run continues the fix with that suggestion', '실행': 'Run', '나': 'me', 'AI': 'AI', '생각 중…': 'thinking…',
  '질문: 왜 이렇게 고쳤어?   수정 요청: 라이트 테마에서도 맞게 고쳐줘': 'Ask: why this way?   Change: make it work in the light theme too', '질문': 'Ask', '코드는 바꾸지 않고 답만 합니다 (Ctrl+Enter)': 'Answers without changing code (Ctrl+Enter)', '앞서 고친 내용에 이어서 고치고 검증 → PR → 병합까지': 'Continues the fix, then verify → PR → merge', '질문은 코드를 바꾸지 않고 답만, 수정 요청은 이어서 고쳐 검증·PR·병합까지 진행합니다.': 'Ask only answers; Change continues the fix through verify, PR and merge.',
  '문제 상황': 'Problem', '재현 단계': 'Steps to reproduce', '기대 결과': 'Expected result', '컨텍스트': 'Context', '프론트': 'Front', '백엔드': 'Backend', '네트워크': 'Network', '표시할 로그 없음': 'No logs', '표시할 로그가 없습니다': 'No logs to show', '표시할 요청 없음': 'No requests', '기록된 요청이 없습니다': 'No requests recorded', '기록된 mutation 없음': 'No mutations', '기록된 mutation이 없습니다': 'No mutations recorded', '기록된 라우터 이력이 없습니다': 'No router history', '기록된 이벤트 없음': 'No events',
  '오류': 'errors', '경고': 'warnings', '백엔드 서버 로그': 'Backend server log', '백엔드 로그 가져오는 중...': 'Loading backend log...', '백엔드 로그 조회 실패 (인증 확인)': 'Could not load backend log (check auth)', '프론트엔드 콘솔 로그': 'Front-end console log', '최근 API 요청 (최대 50건, 최신순)': 'Recent API requests (up to 50, newest first)', 'Vuex Mutation 이력 (최신순, 최대 100건)': 'Vuex mutation history (newest first, up to 100)', '라우터 이력': 'Router history', '최근 이벤트 (최신순)': 'Recent events (newest first)',
  '🌐 환경 정보': '🌐 Environment', '📍 카메라 위치': '📍 Camera', '📸 스크린샷': '📸 Screenshot', '🗂 앱 상태': '🗂 App state', '브라우저 / 화면': 'Browser / screen', '해상도': 'Resolution', '언어': 'Language', 'Cesium 성능 지표': 'Cesium performance', 'JS 힙 메모리': 'JS heap', '경도': 'Longitude', '위도': 'Latitude', '높이 (m)': 'Height (m)', '지도 타입': 'Map type', '지형': 'Terrain', '카메라': 'Camera', '메뉴 상태': 'Menu state', '상단 탭': 'Top tab', '좌측 메뉴': 'Left menu', '하위 메뉴': 'Sub menu', '열린 패널': 'Open panels', '활성 도구': 'Active tool', '표시 중인 데이터': 'Data shown', '데이터셋': 'Datasets', '사용자': 'User', '아이디': 'ID', '권한': 'Role', 'localStorage (민감 키 제외)': 'localStorage (sensitive keys excluded)', '토큰 만료': 'Token expiry',
  '접수': 'Open', '진행중': 'In progress', '해결': 'Resolved', '보류': 'On hold', '치명적': 'Critical', '높음': 'High', '보통': 'Medium', '낮음': 'Low', '수정중': 'fixing', '준비': 'ready', 'PR': 'PR',
  '병합 완료 ': 'merged', '실패 · 진행 로그 확인': 'failed · see the progress log', 'PR 올라옴 · 병합 안 됨(로그 확인)': 'PR open · not merged (see log)', '수정본 준비 · 작업 브랜치에 커밋됨, 아직 PR·병합 전(콘솔 버전 탭에서 내보내기)': 'fix ready · committed to the work branch, not yet PR/merged (send from the console Versions tab)', '되돌림 - 수정이 취소됨(되돌리기 PR 참고)': 'reverted - the fix was cancelled (see the revert PR)', 'AI 가 고치는 중': 'the AI is fixing',
  '배포 중': 'deploying', '리포트를 삭제하시겠습니까?': 'Delete this report?', '저장된 리포트가 없습니다.': 'No saved reports.', '불러오는 중...': 'Loading...', '요청에 실패했습니다.': 'The request failed.', '실패했습니다.': 'Failed.', '수정 요청 실패': 'Fix request failed', '전송 실패': 'Send failed', '되돌리기 실패': 'Revert failed', '미리보기 실패 ': 'Preview failed', '복사': 'Copy', '복사됨': 'Copied', '다운로드': 'Download', '다운로드에 포함되는 정보': 'Included in the download', '도구 문제': 'tool issue', '버그 신고 도구 자체의 문제': 'issue of the reporting tool itself',
  // ── 추가(키·계정·서버·뷰어 조각) ──
  '큐': 'queue', '기본': 'default', '설정됨': 'set', '플랫폼': 'Platform', '데이터': 'Data', '설정 파일': 'Config file', '서버 가동': 'Uptime', '다시 찍기': 'Retake', '새 키 추가': 'Add key', '지우기': 'Clear', '호스트 · 계정': 'Host · user',
  '테스트 계정 아이디': 'Test account ID', '테스트 계정 비밀번호': 'Test account password', 'GitHub 토큰 (공용)': 'GitHub token (shared)', 'GitHub 토큰 (전용 - 비우면 공용 토큰)': 'GitHub token (project - empty = shared)', 'GitLab 토큰': 'GitLab token', 'classic PAT (repo)': 'classic PAT (repo)',
  'classic PAT, repo 스코프': 'classic PAT, repo scope', '(선택) claude-sonnet-4-5': '(optional) claude-sonnet-4-5', 'claude 또는 /home/user/.local/bin/claude': 'claude or /home/user/.local/bin/claude', 'MyApp (Vue 3 프론트 web/, Spring Boot 백엔드 api/)': 'MyApp (Vue 3 front in web/, Spring Boot backend in api/)',
  '보는 프로젝트 - 한 서버에 여러 앱이 등록될 수 있다': 'Project shown - one server can host several apps', '원격 저장소가 앞서 있습니다 - 바뀐 파일만 다시 읽어 그래프를 맞춥니다 (Claude 비용 발생)': 'The remote is ahead - re-reads only changed files to update the graph (Claude cost)',
  'AI 수정본이 담긴 작업 브랜치 (기준 브랜치는 건드리지 않음)': 'Work branch holding the AI fix (the base branch is never touched)', 'AI 수정본이 담긴 작업 브랜치 - 원격 저장소에 같은 이름으로 올라가 있습니다 (PR 은 아직 없음)': 'Work branch holding the AI fix - pushed to the remote under this name (no PR yet)', 'AI 수정본이 담긴 작업 브랜치 - 아직 키트 서버 안에만 있고 원격에는 없습니다 (콘솔에서 내보내기)': 'Work branch holding the AI fix - only on the kit server so far (send it from the console)',
  '🖥 백엔드 로그 (프론트 에러로 판단, 미수집)': '🖥 Backend log (judged a front-end error, not collected)', '언어 / Language': 'Language',
  '키·계정 탭의 GitHub 토큰(classic PAT, repo 스코프). 프로젝트 전용이면 demo 의 GITHUB_TOKEN': 'GitHub token in the Keys tab (classic PAT, repo scope), or GITHUB_TOKEN for the project',
  '키·계정 탭의 FC_USER/FC_PASS - 화면 확인이 로그인 뒤 화면을 보게': 'FC_USER / FC_PASS in the Keys tab so the screen check can log in',
  'docker 와 `docker pull mcr.microsoft.com/playwright:v1.47.2-jammy` - 없으면 화면 확인만 건너뜀': 'docker plus `docker pull mcr.microsoft.com/playwright:v1.47.2-jammy` - without it only the screen check is skipped',
  '워커가 도는 곳에 git (저장소 받기·브랜치 푸시)': 'git where the worker runs (clone, push)', '워커가 도는 곳에 `npm i -g @anthropic-ai/claude-code`': '`npm i -g @anthropic-ai/claude-code` where the worker runs',
  '수정 결과': 'Fix result', '원인 · 고친 내용 · 검증 · 확인이 필요한 점': 'cause · changes · verification · things to check', '원인': 'Cause', '고친 내용': 'Changes', '검증': 'Verification', '확인이 필요한 점': 'Things to check', '추천 개선 ': 'Suggested follow-ups',
  '대시보드': 'Dashboard', '+ 다른 서버': '+ Another server', '콘솔 주소': 'Console URL', '관리 키': 'Admin key', '이 서버': 'This server', '연결 실패': 'unreachable', '저장소 이슈': 'Repository issues', '불러오기': 'Load', '열림': 'Open', '닫힘': 'Closed', '작업으로': 'Make task', '이슈 연동': 'Issue integration', '사람 대기': 'waiting for you', '라벨': 'Labels', '작성': 'Author', '종류 자동': 'auto kind', '기능 없음': 'no feature',
  '로드맵': 'Roadmap', '+ 마일스톤': '+ Milestone', '목표일': 'Due', '미배정': 'Unassigned', '기능 없음': 'no features', '원격 변경': 'remote change', '전체 진행률': 'overall progress', '상태 바꾸기': 'change status', '원격 변경이 기능 범위에 닿음': 'Remote change touches a feature',
  '회귀 검증': 'Regression check', '기능 회귀 검증': 'Feature regression', '작업의 절차 가져오기': 'Import a task\'s procedure', '쌓인 인수 조건': 'Accumulated acceptance', '기능 회귀 실패': 'Feature regression failed',
  '기능': 'Features', '+ 새 기능': '+ New feature', '새 기능': 'New feature', '이름': 'Name', '마일스톤 (선택, 예: 10월 배포)': 'Milestone (optional)', '코드 범위': 'Code scope', '지식 그래프': 'knowledge graph', '범위 추천': 'Suggest scope', '파일 직접 지정': 'Extra files', '범위': 'Scope', '작업': 'Tasks', '작업 보기': 'Tasks', '수정': 'Edit', '삭제': 'Delete', '범위 없음': 'no scope', '기능이 없습니다 - 위에서 만드세요': 'No features yet - create one above', '계획': 'Planned', '진행': 'Active', '검토': 'Review', '완료': 'Done', '보류': 'On hold', '(기능에 묶지 않음)': '(not linked to a feature)',
  '+ 새 작업': '+ New task', '새 작업': 'New task', '계획 대기': 'Plan pending', '단계 대기': 'Step pending', '계획 중': 'Planning', '계획 승인 대기': 'Awaiting plan approval', '다음 단계 대기': 'Awaiting next step', '기능': 'Feature', '개선': 'Improve', '버그': 'Bug', '종류': 'Kind', '기능 요청': 'Feature request', '개선·리팩터링': 'Improvement / refactor', '계획 승인 뒤 끝까지 자동': 'Approve plan, then fully automatic', '단계마다 확인(미리보기 보고 다음 단계)': 'Confirm each step (preview, then next)', '단계마다 확인': 'Confirm each step', '끝까지 자동': 'Fully automatic', '제목': 'Title', '설명': 'Description', '무엇을, 왜, 어디에': 'what, why, where', '관련 범위': 'Scope', '작업 만들기': 'Create task', '작업 개입 방식': 'Task intervention', '기능·개선 요청 기본값': 'default for feature/improve requests', '작업을 만들 때 바꿀 수 있습니다': 'can be changed per task', '계획': 'Plan', '계획 승인 → 구현 시작': 'Approve plan → start', '다시 계획': 'Re-plan', '다음 단계': 'Next step', '접근 · 파일 · 위험': 'Approach · files · risks', '확인 질문': 'Questions', '위험': 'Risks', '파일': 'Files', '사람이 확인할 것': 'Manual checks', '개입': 'Intervention', '자동': 'Auto', '계획 승인': 'Plan approval',
  '샌드박스 사본': 'Sandbox copy', '샌드박스 초기화': 'Reset sandbox', '아직 없음 - 처음 미리보기를 띄울 때 만듭니다': 'none yet - created on the first preview', '미리보기는 원본 파일 저장소 대신 이 사본을 씁니다(레시피 volumes 중 :ro·:shared 표시가 없는 것). 미리보기에서 만든 파일은 여기 쌓이고, 원본에 새로 올라온 자료는 초기화해야 들어옵니다.': 'Previews mount this copy instead of the original file storage (recipe volumes without :ro/:shared). Files made in previews accumulate here; new files in the original appear only after a reset.',
  '수정 뒤 검증': 'After a fix', '미리보기·재현': 'preview · reproduce', '재현 검증': 'Reproduction check', '- 고친 수정본을 미리보기로 띄워 신고된 요청·화면 절차를 다시 돌려 고쳐졌는지 확인. 실패하면 응답·서버 로그를 증거로 AI 가 다시 고침(최대': '- spins up the fix as a preview and replays the reported requests / screen steps to confirm it is fixed. On failure the AI fixes again with the response and server log as evidence (up to', '회). 레시피가 있어야 함': 'rounds). Needs a preview recipe', '미리보기 자동 생성': 'Auto preview', '- 재현 검증을 끈 경우에도 수정이 끝나면 미리보기를 띄움': '- start a preview after each fix even when the reproduction check is off', 'REST 접두 경로': 'REST base path', '/rest 또는 /lhdt-rest (요청 경로 변환용)': '/rest or /lhdt-rest (for rewriting request paths)', '✓ 통과': '✓ passed', '✗ 실패': '✗ failed',
  // 신고 창
  '버그 신고': 'Report a bug', '어디에 대한 신고인지': 'What this report is about', '버그 신고 도구 문제': 'Reporting-tool issue', '신고 창·목록 등 이 도구 자체의 문제일 때 (앱 코드 수정 대상이 아니고 운영자가 처리)': 'When the problem is this tool itself (report dialog, list) - handled by the operator, not app code', '어떤 문제가 발생했나요?': 'What went wrong?', '어떻게 동작해야 하나요?': 'What should happen instead?', '화면 캡처': 'Screen capture', '화면 캡처 중...': 'Capturing...', '캡처 중...': 'Capturing...', '이미지 불러오기': 'Load image', '이미지를 붙여넣기(Ctrl+V)해도 캡처 대신 쓸 수 있습니다.': 'You can also paste an image (Ctrl+V) instead of capturing.', '화면 캡처를 못 했습니다 - 스크린샷 없이 저장하거나, 이미지를 붙여넣기(Ctrl+V)·불러오기로 넣을 수 있습니다': 'Screen capture failed - save without a screenshot, or paste (Ctrl+V) / load an image', '그래도 가져오기': 'Import anyway', '컨텍스트 수집에 실패했습니다 (콘솔 확인)': 'Context collection failed (see console)', '서버 저장': 'Save to server', '저장 중...': 'Saving...', '저장 실패': 'Save failed', '저장 목록': 'Saved list', '취소': 'Cancel', '적용': 'Apply', '모두 지우기': 'Clear all', '그리기·표시': 'Draw · mark', '클릭해서 그리기·표시': 'Click to draw or mark', '사각형': 'Rectangle', '화살표': 'Arrow', '글자': 'Text', '표시할 글자를 입력하세요': 'Enter the text to show', '(눌러서 닫기)': '(click to close)', 'kit 없음': 'no kit', '발생 시각': 'Occurred at', '프론트엔드': 'Front end', '네트워크 오류 없음 — 프론트엔드 에러로 판단하여 미수집': 'No network errors — judged a front-end error, not collected', '시작': 'Start',
};

/** 값이 섞인 문구: 정규식 → 치환 (앞뒤 공백 제외한 전체 문자열에 적용) */
export const RX = [
  [/^프로젝트 (\d+) · 리포트 (\d+) · 큐 (\d+)$/, 'projects $1 · reports $2 · queue $3'],
  [/^갱신 (.+)$/, 'updated $1'], [/^연결 실패: (.+)$/, 'connection failed: $1'],
  [/^(\d+)초 전$/, '$1 s ago'], [/^(\d+)분 전$/, '$1 min ago'], [/^(\d+)시간 전$/, '$1 h ago'], [/^(\d+)일 전$/, '$1 d ago'],
  [/^설정 (\d+)\/(\d+)(.*)$/, 'Setup $1/$2$3'], [/^리포트 (\S+) (.+)$/, 'Reports $1 $2'], [/^마지막 분석 (.+)$/, 'last analysis $1'], [/^마지막 (.+)$/, 'last $1'], [/^다음 (.+)$/, 'next $1'],
  [/^노드 (\d+) · 관계 (\d+) · 구축 (.+?) · 갱신 (.+)$/, 'nodes $1 · edges $2 · built $3 · updated $4'], [/^노드 (\d+) · 관계 (\d+)(.*)$/, 'nodes $1 · edges $2$3'],
  [/^⚠ 원격 (\S+) 이 앞섬 → 갱신을 누르세요 · (.*)$/, '⚠ remote $1 is ahead → press Update · $2'], [/^구축 실패 - 로그 확인$/, 'build failed - see log'],
  [/^v(\d+) 미리보기 로그 \((.+)\)$/, 'v$1 preview log ($2)'], [/^v(\d+) 변경$/, 'v$1 changes'], [/^v(\d+) 을 지울까요\? (.*)$/, 'Delete v$1? $2'],
  [/^루프 편집: (.+)$/, 'Edit loop: $1'], [/^범위: (.+)$/, 'scope: $1'], [/^자동 수정 (\S+) 이상 최대 (\d+)건(.*)$/, 'auto-fix $1+ up to $2$3'], [/^제안 분석\((.+)\)$/, 'insights ($1)'], [/^원격으로: (.+)$/, 'to remote: $1'], [/^(\d+)시간마다$/, 'every $1 h'], [/^(\d+)분마다$/, 'every $1 min'], [/^매일 (\S+)$/, 'daily $1'],
  [/^(\d+)초째 기다리는 중 · 5초마다 다시 시도$/, 'waiting $1 s · retrying every 5 s'], [/^(\d+)줄$/, '$1 lines'], [/^리포트 (\d+)건은 여기서 빠집니다: (.*)$/, '$1 items already turned into reports: $2'], [/^리포트로 넘긴 제안 (\d+)건은 여기서 빠집니다: (.*)$/, '$1 insights already turned into reports: $2'],
  [/^버전 (\d+)$/, 'version $1'], [/^리포트 #(\d+)(.*)$/, 'report #$1$2'], [/^(\d+)개$/, '$1'], [/^파일 (\d+)개$/, '$1 files'],
  [/^오류 \((\d+)\)$/, 'errors ($1)'], [/^경고 \((\d+)\)$/, 'warnings ($1)'], [/^로그 \((\d+)\)$/, 'logs ($1)'], [/^전체 \((\d+)\)$/, 'All ($1)'],
  [/^템플릿 DB (\S+) (.+) 갱신\((\d+)초\)$/, 'template DB $1 refreshed $2 ($3 s)'], [/^ · 템플릿 DB (\S+) (.+) 갱신\((\d+)초\)$/, ' · template DB $1 refreshed $2 ($3 s)'],
  // ── 조각(문장 일부에 값이 섞인 것) - 아래 규칙은 문자열 안 어디서든 바꾼다 ──
  [/리포트로 넘긴 제안 (\d+)건은 여기서 빠집니다:/g, '$1 insights already turned into reports:'], [/· 리포트 (\d+)$/, '· $1 reports'],
  [/^(대기|수정 중|수정본 준비|PR 열림|병합|실패|되돌림|요청 전) (\d+)$/, (m, a, n) => `${({ '대기': 'queued', '수정 중': 'fixing', '수정본 준비': 'fix ready', 'PR 열림': 'PR open', '병합': 'merged', '실패': 'failed', '되돌림': 'reverted', '요청 전': 'not requested' })[a]} ${n}`],
  [/^(수동|예약|원격 [^·]+) · (.+?) · (\d+)분$/, (m, a, b, c) => `${a === '수동' ? 'manual' : a === '예약' ? 'scheduled' : a.replace('원격', 'remote')} · ${b} · ${c} min`],
  [/^(\d+)시간 (\d+)분$/, '$1 h $2 min'], [/^GitHub 토큰 \((.+)\)$/, 'GitHub token ($1)'], [/^API 키 (.+) · GitHub (공용|전용) · 계정 (.+)$/, (m, a, b, c) => `API key ${a} · GitHub ${b === '공용' ? 'shared' : 'own'} · account ${c}`],
  [/📋 프론트 로그 \((\d+)건\)/, '📋 Front-end log ($1)'], [/📡 네트워크 요청 \((\d+)건\)/, '📡 Network requests ($1)'],
  [/· 없음 \(초안을 만들거나 적어 주세요\)/, '· none (draft one or write it)'], [/· 템플릿 DB (\S+) (.+?) 갱신\((\d+)초\)/, '· template DB $1 refreshed $2 ($3 s)'],
  [/화면 확인 ([✓✗])/, 'Screen check $1'], [/콘솔 오류 (\d+)/, 'console errors $1'], [/페이지 예외 (\d+)/, 'page exceptions $1'], [/실패 요청 (\d+)/, 'failed requests $1'], [/절차 실패 (\d+)/, 'step failures $1'],
  [/노드 (\d+) · 관계 (\d+)/, 'nodes $1 · edges $2'], [/구축 (\S+ 전|.+?) · 갱신 /, 'built $1 · updated '], [/파일 (\d+)개/, '$1 files'],
];
RX.push([/\((중지됨|떠 있음|빌드 중|시작 중|대기|실패|없음)\)/, (m, a) => `(${({ '중지됨': 'stopped', '떠 있음': 'up', '빌드 중': 'building', '시작 중': 'starting', '대기': 'queued', '실패': 'failed', '없음': 'none' })[a]})`],
  [/"(자동 병합까지|PR\/MR 까지|원격 브랜치만|보관만\(이 서버\)|자동 병합)"/, (m, a) => `"${({ '자동 병합까지': 'auto-merge', 'PR/MR 까지': 'up to PR/MR', '원격 브랜치만': 'branch only', '보관만(이 서버)': 'keep only (this server)', '자동 병합': 'auto-merge' })[a]}"`]);
RX.push([/· 키트 저장소 안\(원격에 없음\)/, '· only on this server (not on remote)'], [/· 원격에 푸시됨\(PR 없음\)/, '· pushed to remote (no PR)'], [/^scope: /, 'scope: ']);
RX.push([/^바뀐 파일 \((\d+)\)$/, 'Changed files ($1)']);
RX.push([/^재현 검증 (.*)$/, 'Reproduction check $1'], [/(\d+)회/g, '$1 rounds']);
const AGO = [[/(\d+)초 전/g, '$1 s ago'], [/(\d+)분 전/g, '$1 min ago'], [/(\d+)시간 전/g, '$1 h ago'], [/(\d+)일 전/g, '$1 d ago']];

const SKIP = '.bf-md,.bf-log,.bf-diff,pre,code,textarea,.prob,.ktree,.kg-info,.kg-tip,.brv-text,.brv-chat__text,.brv-logbox,.brv-ai__summary,.brv-suggest__text,.brv-problem,.brv-log-msg,.brv-log-payload,.brv-shots__bigcap,[data-i18n-skip],#kLegend,.shots figcaption,.log';

export function detectLang() {
  try { const s = localStorage.getItem('devloop-lang'); if (s === 'ko' || s === 'en') return s; } catch { /* */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')) || 'ko';
  return nav.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
export function setLang(lang) { try { localStorage.setItem('devloop-lang', lang); } catch { /* */ } }

export function tr(text) {
  const raw = String(text ?? '');
  const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
  let core = m[2];
  if (!core || !/[가-힣]/.test(core)) return raw;
  if (Object.prototype.hasOwnProperty.call(KO_EN, core)) return m[1] + KO_EN[core] + m[3];
  if (/^\[.+\] /.test(core)) return raw;   // [태그] 로 시작하는 데이터 문장(제안 제목 등)은 그대로
  for (const [re, rep] of RX) { re.lastIndex = 0; if (re.test(core)) { re.lastIndex = 0; core = core.replace(re, rep); } }
  for (const [re, rep] of AGO) core = core.replace(re, rep);
  return m[1] + core + m[3];
}

const ATTRS = ['placeholder', 'title', 'aria-label'];
function translateNode(n) {
  if (n.nodeType === 3) {
    const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE'].includes(p.tagName) || p.closest(SKIP)) return;
    const t = tr(n.nodeValue); if (t !== n.nodeValue) { n.__ko = n.__ko ?? n.nodeValue; n.nodeValue = t; }
  } else if (n.nodeType === 1) {
    if (n.closest && n.closest(SKIP)) return;
    for (const a of ATTRS) { const v = n.getAttribute && n.getAttribute(a); if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } }
    if (n.tagName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && n.value) { const t = tr(n.value); if (t !== n.value) n.value = t; }
  }
}
function walk(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = root.nodeType === 1 ? (translateNode(root), it.nextNode()) : it.nextNode();
  while (n) { translateNode(n); n = it.nextNode(); }
}
/** root(document.body 또는 shadowRoot) 아래를 영어로 바꾸고, 이후 바뀌는 글자도 계속 바꾼다. lang 이 ko 면 아무것도 안 한다 */
export function translateTree(root, lang = detectLang()) {
  if (!root || lang !== 'en') return () => {};
  walk(root);
  const mo = new MutationObserver((muts) => {
    for (const mu of muts) {
      if (mu.type === 'characterData') translateNode(mu.target);
      else if (mu.type === 'attributes') translateNode(mu.target);
      else for (const a of mu.addedNodes) { if (a.nodeType === 3) translateNode(a); else if (a.nodeType === 1) walk(a); }
    }
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return () => mo.disconnect();
}
