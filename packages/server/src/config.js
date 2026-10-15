import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { expandHome, notBlank } from './util.js';
import { fileURLToPath } from 'node:url';
import { detectHost } from './gitlab.js';

/** 킷 버전 - 배포판 manifest·릴리스 노트에 남긴다 */
function kitVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version || ''; }
  catch { return ''; }
}

/**
 * 설정 파일(devloop.yml) 을 읽고 기본값·환경변수를 합친다.
 *
 * server:   port · dataDir(리포트 저장) · workDir(저장소 사본·작업) · claudeBin · pathExtra · javaHome · model · maxTurns · timeoutMinutes · runAsUser · insightsSchedule · knowledgeSchedule(HH:MM)
 *           프로젝트별: insights.schedule · knowledge.schedule · knowledge.enabled(false 면 자동 구축 안 함) · knowledge.watchMinutes(원격 base 감시 주기, 기본 10, 0=끔) · knowledge.autoUpdate(원격이 앞서면 자동 갱신, 기본 false=표시만) · knowledge.minGapMinutes(자동 갱신 최소 간격, 기본 60) · frontCheck.config(기본 {cwd}/front-check.config.mjs)
 * github:   tokenFile (또는 환경변수 DEVLOOP_GITHUB_TOKEN)
 * projects: 이름 → { apiKey, repo, githubRepo, baseBranch, autoMerge, cors, description, conventions, modules[], allowedTools[], env{} }
 *           host 는 repo 주소로 자동(github.com → github, 그 밖은 gitlab; 셀프호스팅 GitLab 은 주소 origin 이 API 주소). GitLab 토큰은 프로젝트 env GITLAB_TOKEN
 *   module: { name, match(변경 파일 경로 접두어), dir(명령 실행 위치), verify[](셸 명령), nodeModulesCache(bool), prebuild[]{ when, cwd, run } }
 *
 * 비밀값(API 키·토큰)은 파일보다 환경변수를 우선한다: DEVLOOP_GITHUB_TOKEN, DEVLOOP_KEY_<PROJECT 대문자>.
 */
export function loadConfig(file) {
  const abs = path.resolve(expandHome(file));
  const raw = YAML.parse(fs.readFileSync(abs, 'utf8')) || {};
  const baseDir = path.dirname(abs);
  const resolveDir = (p, dflt) => path.resolve(baseDir, expandHome(p || dflt));

  const server = {
    port: 8790,
    host: '0.0.0.0',
    claudeBin: 'claude',
    pathExtra: '',
    javaHome: '',
    model: '',
    maxTurns: 40,
    timeoutMinutes: 45,
    verifyTimeoutMinutes: 20,
    runAsUser: '',
    adminKey: '',
    ...(raw.server || {}),
  };
  // 운영자 대시보드 키: 환경변수 → ~/.config/devloop/default.env 의 ADMIN_KEY → yml
  server.adminKey = process.env.DEVLOOP_ADMIN_KEY || readEnvFile(expandHome('~/.config/devloop/default.env')).ADMIN_KEY || server.adminKey || '';
  server.dataDir = resolveDir(raw.server?.dataDir, './data');
  server.workDir = resolveDir(raw.server?.workDir, './work');

  const github = { tokenFile: '~/.config/devloop/github-token', ...(raw.github || {}) };

  const projects = {};
  for (const [name, p] of Object.entries(raw.projects || {})) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error(`프로젝트 이름은 영문·숫자·-_ 만: ${name}`);
    if (!notBlank(p.repo)) throw new Error(`projects.${name}: repo 는 필수`);
    const hostInfo = detectHost(p.repo, p.host);
    if (hostInfo.host === 'github' && !notBlank(p.githubRepo)) throw new Error(`projects.${name}: GitHub 저장소는 githubRepo(owner/name) 가 필수`);
    const envKey = process.env[`DEVLOOP_KEY_${name.toUpperCase().replace(/-/g, '_')}`];
    // 프로젝트 비밀값은 서버의 파일 하나(envFile, KEY=VALUE)에 - 저장소에는 안 들어가고, front-check 의 FC_USER/FC_PASS 등이 여기서 나온다
    // 운영자 비밀값: ~/.config/devloop/default.env (모든 프로젝트 공통) ← projects/<이름>.env (프로젝트별, 우선)
    const fileEnv = { ...readEnvFile(expandHome('~/.config/devloop/default.env')),
      ...readEnvFile(p.envFile ? path.resolve(baseDir, expandHome(p.envFile)) : path.join(expandHome('~/.config/devloop/projects'), `${name}.env`)) };
    projects[name] = {
      name,
      baseBranch: 'main',
      autoMerge: true,
      cors: [],
      description: '',
      conventions: '',
      modules: [],
      allowedTools: [],
      fixFrom: 'app',            // 'app' = 앱 사용자도 수정 요청 가능, 'admin' = 관리 콘솔에서만 (라이브러리·공용 코드)
      protectedPaths: [],        // AI 가 바꾸면 되돌리는 경로(접두어 또는 정확한 파일) - 예: 버그 신고 연결 파일, CI 설정
      ...p,
      ...hostInfo,                       // host: 'github'|'gitlab', gitlab 이면 gitlabUrl·gitlabProject
      githubRepo: p.githubRepo || hostInfo.gitlabProject || '',   // 표시·프롬프트용 저장소 이름
      // 수정본을 어디까지 내보내나: local(키트 저장소 안 브랜치에 보관만) · branch(원격 브랜치 푸시) · pr(푸시+PR) · merge(푸시+PR+자동 병합)
      delivery: ['local', 'branch', 'pr', 'merge'].includes(p.delivery) ? p.delivery : (p.autoMerge === false ? 'pr' : 'merge'),
      // 수정 뒤 미리보기 자동 생성 · 재현 검증(미리보기에 신고된 요청/절차를 다시 돌려 고쳐졌는지 확인, 실패하면 증거를 주고 다시 고침) · 재시도 횟수 · 앱 REST 접두 경로(요청 경로 변환용)
      // 기능·개선 작업의 사람 개입 기본값: auto(끝까지 자동) · plan(계획 승인 뒤 구현) · step(단계마다 확인)
      taskMode: ['auto', 'plan', 'step'].includes(p.taskMode) ? p.taskMode : 'plan',
      // 외부 이슈(GitHub/GitLab issues) 연동: 가져온 이슈에 진행 상황 댓글 · 병합되면 닫기
      issues: { comment: p.issues?.comment !== false, closeOnMerge: p.issues?.closeOnMerge === true },
      // 배포판(release): 빌드는 preview 레시피를 그대로 쓰고 다른 점만 적는다
      // { frontBase: '/', include: {front,back,db}, schemas: ['public'], ddlGlob: 'doc/**/ddl/*.sql', keep: 5 }
      release: typeof p.release === 'object' && p.release ? p.release : {},
      previewAuto: p.previewAuto === true,   // 기본 끔 - 미리보기는 재현·인수 검증 때와 사람이 '미리보기 띄우기' 를 누를 때만
      reproCheck: p.reproCheck !== false,
      reproRounds: Number(p.reproRounds) > 0 ? Number(p.reproRounds) : 2,
      restBase: typeof p.restBase === 'string' ? p.restBase.replace(/\/+$/, '') : '',
      env: { ...fileEnv, ...(p.env || {}) },
      apiKey: notBlank(envKey) ? envKey : (p.apiKey || fileEnv.DEVLOOP_API_KEY || ''),
      // 프로젝트별 GitHub 토큰(선택) - 없으면 서버 공용 토큰
      githubTokenFile: p.githubTokenFile || (fileEnv.GITHUB_TOKEN ? null : undefined),
      githubTokenValue: fileEnv.GITHUB_TOKEN || null,
      gitlabTokenValue: fileEnv.GITLAB_TOKEN || null,
    };
    projects[name].autoMerge = projects[name].delivery === 'merge';
    projects[name].modules = (projects[name].modules || []).map((m, i) => {
      // match '' 는 저장소 전체(앱이 곧 저장소 루트인 내장 모드)
      if (typeof m.match !== 'string') throw new Error(`projects.${name}.modules[${i}]: match 는 필수('' 면 전체)`);
      return { name: m.name || m.match.replace(/\/$/, '') || 'app', dir: m.dir || m.match.replace(/\/$/, '') || '.', verify: [], nodeModulesCache: false, prebuild: [], ...m };
    });
  }
  if (Object.keys(projects).length === 0) console.warn('[devloop] projects 가 비어 있습니다 - 콘솔(/api/ui/)의 프로젝트 탭에서 채우세요');

  const cfgObj = {
    version: kitVersion(),
    server,
    github,
    projects,
    file: abs,
    /** yml·env 를 다시 읽어 같은 객체에 반영한다 (대시보드에서 저장한 뒤). 포트 변경만 재시작 필요 */
    reload() {
      const fresh = loadConfig(abs);
      Object.assign(cfgObj.server, fresh.server);
      Object.assign(cfgObj.github, fresh.github);
      for (const k of Object.keys(cfgObj.projects)) delete cfgObj.projects[k];
      Object.assign(cfgObj.projects, fresh.projects);
      return cfgObj;
    },
    /** 토큰: (프로젝트 것) → 환경변수 → 파일(매번 읽어 재시작 없이 교체 가능). 없으면 null */
    githubToken(project) {
      // GitLab 프로젝트: 프로젝트 env 의 GITLAB_TOKEN → 공용 ~/.config/devloop/gitlab-token
      if (project?.host === 'gitlab') {
        if (project.gitlabTokenValue) return project.gitlabTokenValue;
        if (notBlank(process.env.DEVLOOP_GITLAB_TOKEN)) return process.env.DEVLOOP_GITLAB_TOKEN.trim();
        if (notBlank(process.env.GITLAB_TOKEN)) return process.env.GITLAB_TOKEN.trim();
        try { return fs.readFileSync(expandHome('~/.config/devloop/gitlab-token'), 'utf8').trim().split(/\r?\n/)[0].trim() || null; } catch { return null; }
      }
      if (project?.githubTokenValue) return project.githubTokenValue;
      if (project?.githubTokenFile) { try { return fs.readFileSync(expandHome(project.githubTokenFile), 'utf8').trim().split(/\r?\n/)[0].trim() || null; } catch { return null; } }
      if (notBlank(process.env.DEVLOOP_GITHUB_TOKEN)) return process.env.DEVLOOP_GITHUB_TOKEN.trim();
      try {
        const f = expandHome(github.tokenFile);
        const line = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/)[0].trim();
        return line || null;
      } catch {
        return null;
      }
    },
  };
  return cfgObj;
}

/** KEY=VALUE 파일(# 주석, 따옴표 허용). 없으면 {} */
export function readEnvFile(file) {
  const out = {};
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch { /* 파일 없음 */ }
  return out;
}
