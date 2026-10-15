import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firstLine, tail } from './util.js';

/**
 * Claude Code 로그인 상태 - 실행 계정의 ~/.claude/.credentials.json(또는 ~/.claude.json) 이나 환경변수(CLAUDE_CODE_OAUTH_TOKEN·ANTHROPIC_API_KEY).
 * 파일이 있는데 못 읽으면(root 로 claude 를 돌려 소유자가 바뀐 흔한 사고) 그 사유를 hint 에 담는다.
 */
export function loginState(bin = 'claude', env = process.env) {
  if (env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY) return { loggedIn: true, hint: '', via: 'env' };
  const home = os.homedir();
  const user = (() => { try { return os.userInfo().username; } catch { return env.USER || '?'; } })();
  for (const f of ['.claude/.credentials.json', '.claude.json'].map((x) => path.join(home, x))) {
    if (!fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j.claudeAiOauth || j.oauthAccount || j.primaryApiKey) return { loggedIn: true, hint: '', via: f };
    } catch (e) {
      if (e && e.code === 'EACCES') {
        let owner = '?'; try { owner = String(fs.statSync(f).uid); } catch { /* */ }
        return { loggedIn: false, via: f, hint: `자격 파일 ${f} 을 실행 계정(${user})이 읽을 수 없습니다(소유자 uid ${owner} - 보통 root 로 claude 를 실행해서 생김). 서버에서 \`sudo chown ${user}:${user} ${f}\` 한 뒤 다시 시도하거나, ${user} 계정에서 \`${bin} login\` 을 다시 하세요` };
      }
    }
  }
  return { loggedIn: false, via: null, hint: `서버 실행 계정(${user})에서 \`${bin} login\` 을 한 번 실행하세요 (터미널 필요)` };
}
/** result 이벤트가 오류였으면 그 문구, 아니면 '' */
export function errorOf(out) { const n = parseResultJson(out); return n?.is_error ? String(n.result || n.subtype || 'error') : ''; }

/**
 * Claude Code 를 `--output-format stream-json` 으로 돌리며 진행 상황(읽는 파일·고치는 파일·중간 설명)을
 * 그때그때 onProgress 로 흘린다. `--output-format json` 은 끝날 때까지 몇 분 동안 아무것도 안 보여서
 * "멈췄나" 싶게 만든다. 돌려주는 값은 마지막 result 이벤트(JSON 한 줄) - sessionIdOf/resultTextOf 로 읽는다.
 *
 * @param {{start: Function}} ex        makeExec() 결과
 * @param {string} cwd                  작업 사본
 * @param {number} timeoutMin
 * @param {string[]} args               claude 뒤에 붙일 인자(-p 프롬프트, --max-turns … --output-format 제외)
 * @param {(line: string) => void} onProgress
 */
export async function runClaudeStream(ex, cwd, timeoutMin, args, onProgress) {
  // 하위 에이전트(Task/Agent)는 금지 - 위임해 두고 "기다리는 중" 으로 턴을 끝내 버리는 일이 있다. 직접 읽고 직접 고치게
  const cmd = [...args, ...(args.includes('--disallowedTools') ? [] : ['--disallowedTools', 'Task,Agent']), '--output-format', 'stream-json', '--verbose'];
  const { child, describe } = await ex.start(cwd, cmd);
  child.stdin.end();
  let raw = '';
  let result = null;
  let last = '';
  const rl = readline.createInterface({ input: child.stdout });
  child.stderr.setEncoding('utf8');            // 청크 경계에 걸친 멀티바이트 문자가 깨지지 않게
  child.stderr.on('data', (d) => { if (raw.length < 200_000) raw += d; });
  rl.on('line', (line) => {
    if (raw.length < 200_000) raw += line + '\n';
    if (!line.startsWith('{')) return;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'result') { result = line; return; }
      if (ev.type !== 'assistant') return;
      for (const blk of ev.message?.content || []) {
        const l = progressLine(blk, cwd);
        if (!l || l === last) continue;
        last = l;
        onProgress(l);
      }
    } catch { /* JSON 이 아닌 줄 */ }
  });
  const code = await new Promise((resolve, reject) => {
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMin * 60_000);
    child.on('error', (e) => { clearTimeout(t); reject(new Error(`Claude 실행 실패: ${e.message}`)); });
    child.on('close', (c) => {
      clearTimeout(t);
      if (timedOut) return reject(new Error(`시간 초과(${timeoutMin}분): ${describe}`));
      resolve(c);
    });
  });
  if (code !== 0 && result == null) throw new Error(`명령 실패(exit ${code}): ${describe}\n${tail(raw, 2000)}`);
  return result ?? raw;
}

/** assistant 이벤트의 블록 하나 → 진행 로그 한 줄 (도구 호출은 무엇을 어디에 했는지만, 텍스트는 첫 줄만) */
export function progressLine(blk, cwd) {
  if (blk.type === 'text') {
    const t = firstLine(blk.text || '', 160);
    return t ? `💬 ${t}` : null;
  }
  if (blk.type !== 'tool_use') return null;
  const inp = blk.input || {};
  const file = rel(inp.file_path || inp.path || '', cwd);
  switch (blk.name) {
    case 'Read': return `읽기 ${file}`;
    case 'Edit': case 'MultiEdit': return `✏️ 수정 ${file}`;
    case 'Write': return `✏️ 작성 ${file}`;
    case 'Grep': return `검색 ${firstLine(inp.pattern || '', 60)}${file ? `  (${file})` : ''}`;
    case 'Glob': return `찾기 ${firstLine(inp.pattern || '', 80)}`;
    case 'Bash': return `$ ${firstLine(inp.command || '', 120)}`;
    default: return blk.name || null;
  }
}
function rel(p, cwd) {
  if (!p) return '';
  return p.startsWith(cwd) ? p.slice(cwd.length).replace(/^\//, '') : p;
}

function parseResultJson(out) {
  const s = String(out || '').trim();
  const i = s.startsWith('{') ? 0 : s.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(s.slice(i)); } catch { return null; }
}
export const sessionIdOf = (out) => parseResultJson(out)?.session_id || null;
export const resultTextOf = (out) => parseResultJson(out)?.result ?? firstLine(out, 500);

/** result 이벤트 요약 - "턴 12 · 3분 40초 · $0.75" */
export function claudeSummary(out) {
  const n = parseResultJson(out);
  if (!n) return firstLine(out, 300);
  const ms = Number(n.duration_ms || 0);
  let b = `턴 ${n.num_turns ?? 0}`;
  if (ms > 0) b += ` · ${Math.floor(ms / 60000)}분 ${Math.floor(ms / 1000) % 60}초`;
  if (n.total_cost_usd != null) b += ` · $${Number(n.total_cost_usd).toFixed(2)}`;
  if (n.subtype === 'error_max_turns') b += ' · 턴 한도에 걸려 중단';
  else if (n.is_error) b += ` · 오류: ${firstLine(String(n.result || n.subtype || ''), 200)}`;
  return b;
}
