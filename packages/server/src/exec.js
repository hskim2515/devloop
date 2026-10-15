import { spawn } from 'node:child_process';
import path from 'node:path';
import { notBlank, tail } from './util.js';

/**
 * 프로세스 실행 도우미. 서버 설정 + 프로젝트 설정으로 실행 환경(PATH·JAVA_HOME·추가 env·sudo 래핑)을 만든다.
 * 작업 사본(jobs/{id}) 안에서 돌 때는 nodeModulesCache 모듈의 node_modules/.bin 을 PATH 앞에 둔다 -
 * Claude 와 검증 명령이 sass·vue-cli-service 같은 것을 그냥 이름으로 부를 수 있게.
 */
export function makeExec(server, project, log = console) {
  let loginPath = null;

  async function loginShellPath() {
    if (loginPath != null) return loginPath;
    try {
      const c = [];
      if (notBlank(server.runAsUser)) c.push('sudo', '-n', '-H', '-u', server.runAsUser);
      c.push('bash', '-lc', 'echo "$PATH"');
      const out = await rawRun(c, { cwd: '/', timeoutMs: 30_000 });
      const lines = out.out.trim().split(/\r?\n/);
      loginPath = out.code === 0 ? lines[lines.length - 1].trim() : '';
    } catch (e) {
      log.warn('[devloop] 로그인 셸 PATH 조회 실패:', e.message);
      loginPath = '';
    }
    return loginPath;
  }

  function jobRoot(cwd) {
    const m = String(cwd).match(/^(.*\/jobs\/[^/]+)/);
    return m ? m[1] : null;
  }

  async function buildEnv(cwd) {
    const root = jobRoot(cwd);
    const bins = root
      ? project.modules.filter((m) => m.nodeModulesCache).map((m) => path.join(root, m.dir, 'node_modules', '.bin'))
      : [];
    const parts = [...bins];
    if (notBlank(server.pathExtra)) parts.push(server.pathExtra);
    const lp = await loginShellPath();
    if (notBlank(lp)) parts.push(lp);
    parts.push(process.env.PATH || '/usr/local/bin:/usr/bin:/bin');
    const vars = { PATH: parts.join(':'), CI: 'true', LANG: process.env.LANG || 'C.UTF-8' };
    if (notBlank(server.javaHome)) vars.JAVA_HOME = server.javaHome;
    for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'HOME']) if (notBlank(process.env[k])) vars[k] = process.env[k];
    Object.assign(vars, project.env || {});
    return vars;
  }

  /** 명령을 띄운다(stdout+stderr 합침). sudo 로 다른 계정이면 env 로 변수를 다시 넘긴다 */
  async function start(cwd, cmd) {
    const vars = await buildEnv(cwd);
    let c = [...cmd];
    if (notBlank(server.runAsUser)) {
      c = ['sudo', '-n', '-H', '-u', server.runAsUser, 'env', ...Object.entries(vars).map(([k, v]) => `${k}=${v}`), ...c];
    }
    const child = spawn(c[0], c.slice(1), { cwd, env: { ...process.env, ...vars }, stdio: ['pipe', 'pipe', 'pipe'] });
    trackChild(child);
    return { child, describe: describe(c) };
  }

  function rawRun(c, { cwd, timeoutMs, stdin }) {
    return new Promise((resolve, reject) => {
      const child = spawn(c[0], c.slice(1), { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      trackChild(child);
      let out = '';
      // setEncoding 없이 Buffer 를 그냥 더하면 청크 경계에 걸친 멀티바이트 문자가 깨진다(한글·일본어 출력에서 발생)
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', (e) => { clearTimeout(t); reject(e); });
      child.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
      if (stdin != null) child.stdin.end(stdin); else child.stdin.end();
    });
  }

  /**
   * 실행하고 출력(stdout+stderr)을 돌려준다. exit≠0 이면 "명령 실패(exit N): …" 오류.
   * @param {string} cwd
   * @param {number} timeoutMin
   * @param {string[]} cmd
   * @param {{stdin?: string}} [opt]
   */
  async function exec(cwd, timeoutMin, cmd, opt = {}) {
    const { child, describe: desc } = await start(cwd, cmd);
    return new Promise((resolve, reject) => {
      let out = '';
      let timedOut = false;
      // ⚠️ setEncoding 은 빼면 안 된다 - Buffer 를 문자열에 더하면 청크 경계에 걸친 멀티바이트 문자가 깨진다.
      // (실측: DB 열 설명의 한글이 '분���' 처럼 깨져, 같은 DB 를 두 번 떠도 다르게 보였다)
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (d) => { if (out.length < 4_000_000) out += d; });
      child.stderr.on('data', (d) => { if (out.length < 4_000_000) out += d; });
      const t = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMin * 60_000);
      child.on('error', (e) => { clearTimeout(t); reject(new Error(`실행 실패: ${desc}: ${e.message}`)); });
      child.on('close', (code) => {
        clearTimeout(t);
        if (timedOut) return reject(new Error(`시간 초과(${timeoutMin}분): ${desc}`));
        if (code !== 0) return reject(new Error(`명령 실패(exit ${code}): ${desc}\n${tail(out, 2000)}`));
        resolve(out);
      });
      if (opt.stdin != null) child.stdin.end(opt.stdin); else child.stdin.end();
    });
  }

  /** 종료 코드만 (0 이 아니어도 예외 없음). 시간 초과·실행 불가는 -1 */
  async function execRc(cwd, timeoutMin, cmd) {
    try { await exec(cwd, timeoutMin, cmd); return 0; }
    catch (e) { return /^명령 실패/.test(e.message) ? 1 : -1; }
  }
  /** 출력만 ('없음' 이 exit 1 인 git grep 류) */
  async function execOut(cwd, timeoutMin, cmd) {
    try { return await exec(cwd, timeoutMin, cmd); }
    catch { return ''; }
  }
  /** `sh -c` 로 셸 문자열 실행 (설정 파일의 verify 명령용) */
  const sh = (cwd, timeoutMin, script) => exec(cwd, timeoutMin, ['sh', '-c', script]);

  return { exec, execRc, execOut, sh, start };
}

/** 로그용 명령 요약 - sudo/env 래핑과 토큰 헤더는 빼고 앞부분만 */
export function describe(c) {
  let i = 0;
  if (c[i] === 'sudo') {
    i++;
    while (i < c.length && c[i].startsWith('-')) i += c[i] === '-u' ? 2 : 1;
  }
  if (c[i] === 'env') {
    i++;
    while (i < c.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(c[i])) i++;
  }
  return c.slice(i, i + 4).join(' ').replace(/Authorization: Basic \S+/g, 'Authorization: ***');
}

/**
 * 워커가 띄운 자식 프로세스(claude·빌드 명령) 추적 - 워커가 SIGTERM 으로 내려갈 때(앱 재배포) 같이 끝내서
 * 고아 claude 프로세스가 옛 작업 사본에서 계속 돌며 비용을 쓰고 이어가기 작업과 충돌하는 일을 막는다.
 */
const CHILDREN = new Set();
export function trackChild(child) { CHILDREN.add(child); child.once('close', () => CHILDREN.delete(child)); }
export function killChildren(signal = 'SIGTERM') {
  let n = 0;
  for (const c of CHILDREN) { try { c.kill(signal); n++; } catch { /* 이미 끝남 */ } }
  return n;
}
export function childCount() { return CHILDREN.size; }
