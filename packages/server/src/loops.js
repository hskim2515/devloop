import fs from 'node:fs/promises';
import path from 'node:path';
import { firstLine, hhmmss, nowIso, sleep } from './util.js';

/**
 * 루프 = 사람이 정한 순서로 되풀이 도는 자동화. 프로젝트 설정 `loops[]` 에 저장(콘솔 '루프' 탭에서 편집).
 *   { name, enabled, every, steps[], maxMinutes }
 *   every:  "manual" | "push"(원격 base 브랜치에 새 커밋이 보이면) | "6h" | "30m" | "daily 03:00"
 *   scope:  { id, label }  (선택) 지식 그래프의 화면·메뉴·기능 노드 - 그 노드와 이어진 파일들로 제안 분석을 한정하고, 자동 수정도 그 범위의 제안만 고른다
 *   steps:  { type: 'knowledge' }                              지식 그래프 갱신(없으면 전체 구축)
 *           { type: 'insights', focus }                         제안 분석
 *           { type: 'fix', severity: 'HIGH', max: 2, kinds }    제안 중 심각도 이상을 리포트로 만들어 AI 수정(프로젝트 delivery 대로)
 *           { type: 'preview' }                                 이번 실행에서 만든 수정본 버전을 미리보기로
 *           { type: 'export', mode: 'pr'|'merge'|'branch' }     이번 실행의 수정본을 내보내기
 *           { type: 'release', label, note }                     배포판 묶기(프론트·백엔드 빌드 + 받는 쪽 DB 를 맞추는 DDL)
 * 실행 기록: {dataDir}/{project}/loops.json = { runs: [{ id, loop, trigger, startedAt, endedAt, status, log, made: [reportId…] }], last: { [loop]: { at, sha } } }
 * 한 프로젝트에 루프는 한 번에 하나만 돈다(단계들이 큐를 쓰므로 겹치면 서로 기다리기만 한다).
 */
const SEV = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export class Loops {
  constructor(cfg, store, runner, insights, knowledge, versions, log = console) {
    Object.assign(this, { cfg, store, runner, insights, knowledge, versions, log });
    this.active = new Map();     // project → { runId, stop }
    this.locks = new Map();
    this.timer = null;
  }
  file(p) { return path.join(this.cfg.server.dataDir, p, 'loops.json'); }
  async state(p) { try { return JSON.parse(await fs.readFile(this.file(p), 'utf8')); } catch { return { runs: [], last: {} }; } }
  async save(p, patch) {
    const prev = this.locks.get(p) || Promise.resolve();
    let release; const cur = new Promise((r) => { release = r; }); const chain = prev.then(() => cur); this.locks.set(p, chain);
    await prev;
    try {
      const st = await this.state(p);
      const next = typeof patch === 'function' ? patch(st) : { ...st, ...patch };
      next.runs = (next.runs || []).slice(-40);
      await fs.mkdir(path.dirname(this.file(p)), { recursive: true });
      const tmp = `${this.file(p)}.tmp`; await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8'); await fs.rename(tmp, this.file(p));
      return next;
    } finally { release(); if (this.locks.get(p) === chain) this.locks.delete(p); }
  }
  async updateRun(p, id, patch) { return this.save(p, (st) => ({ ...st, runs: st.runs.map((r) => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)) })); }
  async rlog(p, id, line) { await this.updateRun(p, id, (r) => ({ log: ((r.log || '') + `${hhmmss()}  ${line}\n`).slice(-60_000) })); }

  loopsOf(project) { return Array.isArray(project.loops) ? project.loops.filter((l) => l && l.name) : []; }

  /** every 문자열 → 다음 실행 시각(ms) 또는 null(수동·푸시) */
  nextAt(loop, last) {
    const e = String(loop.every || 'manual').trim().toLowerCase();
    if (e === 'manual' || e === 'push') return null;
    const lastAt = last?.at ? Date.parse(last.at) : 0;
    // 켜자마자 돌지 않는다: 간격형은 (마지막 실행 또는 지금) + 간격, 매일형은 오늘 시각이 지났으면 내일
    let m = e.match(/^(\d+)\s*([mh])$/);
    if (m) { const ms = Number(m[1]) * (m[2] === 'h' ? 3600_000 : 60_000); return (lastAt || (last?.armedAt ? Date.parse(last.armedAt) : 0) || Date.now()) + ms; }
    m = e.match(/^daily\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      const d = new Date(); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      if (d.getTime() <= Date.now() || (lastAt && d.getTime() <= lastAt)) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    return null;
  }

  async list(project) {
    const st = await this.state(project.name);
    const loops = this.loopsOf(project).map((l) => ({ ...l, last: st.last?.[l.name] || null, nextAt: this.nextAt(l, st.last?.[l.name]) ? new Date(this.nextAt(l, st.last?.[l.name])).toISOString() : null }));
    const act = this.active.get(project.name);
    return { loops, runs: st.runs.slice().reverse().slice(0, 20), running: act ? act.runId : null };
  }

  // ── 예약 ────────────────────────────────────────────────────────────────
  startSchedules() { if (this.timer) return; this.timer = setInterval(() => this.tick().catch((e) => this.log.warn('[loops] 예약 확인 실패:', e.message)), 60_000); }
  stopSchedules() { clearInterval(this.timer); this.timer = null; }
  async resetInterrupted() {
    for (const p of Object.values(this.cfg.projects)) {
      const st = await this.state(p.name);
      if (st.runs.some((r) => r.status === 'RUNNING')) await this.save(p.name, (s) => ({ ...s, runs: s.runs.map((r) => (r.status === 'RUNNING' ? { ...r, status: 'FAILED', endedAt: nowIso(), log: (r.log || '') + `${hhmmss()}  ✗ 워커 재시작으로 끊김\n` } : r)) }));
    }
  }
  async tick() {
    for (const p of Object.values(this.cfg.projects)) {
      if (this.active.has(p.name)) continue;
      const st = await this.state(p.name);
      for (const loop of this.loopsOf(p)) {
        if (loop.enabled === false) continue;
        let last = st.last?.[loop.name];
        if (!last?.at && !last?.armedAt && /^\d+\s*[mh]$/.test(String(loop.every || '').trim().toLowerCase())) { last = { ...(last || {}), armedAt: nowIso() }; await this.save(p.name, (s) => ({ ...s, last: { ...(s.last || {}), [loop.name]: last } })); }
        const e = String(loop.every || 'manual').trim().toLowerCase();
        if (e === 'push') {
          // 원격 감시(knowledge.watchRemote)가 본 head 가 지난 실행 때와 다르면
          const ks = await this.knowledge.state(p.name);
          const sha = ks.remoteHead;
          if (sha && sha !== last?.sha && (!last?.at || Date.now() - Date.parse(last.at) > 10 * 60_000)) { await this.run(p, loop, `원격 ${p.baseBranch} ${sha.slice(0, 7)}`, sha); break; }
          continue;
        }
        const at = this.nextAt(loop, last);
        if (at != null && at <= Date.now()) { await this.run(p, loop, '예약'); break; }
      }
    }
  }

  // ── 실행 ────────────────────────────────────────────────────────────────
  async runNow(project, name) {
    const loop = this.loopsOf(project).find((l) => l.name === name);
    if (!loop) throw Object.assign(new Error('없는 루프'), { status: 404 });
    if (this.active.has(project.name)) throw Object.assign(new Error('이 프로젝트에 이미 도는 루프가 있습니다'), { status: 409 });
    this.run(project, loop, '수동').catch((e) => this.log.warn(`[loops ${project.name}] ${name} 실패: ${e.message}`));
    await sleep(50);
    return this.list(project);
  }
  async stop(project) {
    const a = this.active.get(project.name);
    if (!a) throw Object.assign(new Error('도는 루프가 없습니다'), { status: 409 });
    a.stop = true;
    return this.list(project);
  }

  /** 루프 범위(지식 그래프 노드) → 이어진 노드·파일. 노드가 없으면 라벨 검색으로 찾는다 */
  async resolveScope(project, scope) {
    if (!scope || (!scope.id && !scope.label)) return null;
    const g = await this.knowledge.graph(project.name).catch(() => null);
    if (!g?.nodes?.length) return { label: scope.label || scope.id, files: [], nodes: [], missing: true };
    let root = scope.id ? g.nodes.find((n) => n.id === scope.id) : null;
    if (!root && scope.label) { const q = String(scope.label).toLowerCase(); root = g.nodes.find((n) => String(n.label).toLowerCase() === q) || g.nodes.find((n) => String(n.label).toLowerCase().includes(q)); }
    if (!root) return { label: scope.label || scope.id, files: [], nodes: [], missing: true };
    // 2단계까지 이어진 노드(포함·호출·읽기/쓰기·이동 모두)
    const adj = new Map();
    for (const e of g.edges || []) { const a = e.source ?? e.from, b = e.target ?? e.to; if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set()); adj.get(a).add(b); adj.get(b).add(a); }
    const seen = new Set([root.id]); let frontier = [root.id];
    for (let d = 0; d < 2; d++) { const next = []; for (const id of frontier) for (const nb of adj.get(id) || []) if (!seen.has(nb)) { seen.add(nb); next.push(nb); } frontier = next; }
    const nodes = g.nodes.filter((n) => seen.has(n.id));
    const files = [...new Set(nodes.map((n) => n.path).filter(Boolean))].slice(0, 60);
    return { id: root.id, label: root.label, type: root.type, files, nodes: nodes.map((n) => n.label).slice(0, 40), missing: false };
  }

  async run(project, loop, trigger, sha = null) {
    const p = project.name;
    const id = `${Date.now().toString(36)}`;
    const ctl = { runId: id, stop: false };
    this.active.set(p, ctl);
    await this.save(p, (st) => ({ ...st, runs: [...st.runs, { id, loop: loop.name, trigger, startedAt: nowIso(), status: 'RUNNING', log: '', made: [] }], last: { ...(st.last || {}), [loop.name]: { at: nowIso(), sha: sha || st.last?.[loop.name]?.sha || null } } }));
    const L = (s) => this.rlog(p, id, s);
    const deadline = Date.now() + (Number(loop.maxMinutes) > 0 ? Number(loop.maxMinutes) : 180) * 60_000;
    const check = () => { if (ctl.stop) throw new Error('중지 요청'); if (Date.now() > deadline) throw new Error(`제한 시간(${Math.round((deadline - Date.now()) / 60000 + (loop.maxMinutes || 180))}분) 초과`); };
    const waitUntil = async (fn, every = 5000) => { for (;;) { check(); const v = await fn(); if (v) return v; await sleep(every); } };
    const made = [];
    try {
      await L(`▶ 루프 '${loop.name}' 시작 (${trigger}) - 단계 ${(loop.steps || []).map((s) => s.type).join(' → ') || '없음'}`);
      let scope = null;
      if (loop.scope) {
        scope = await this.resolveScope(project, loop.scope);
        if (scope?.missing) await L(`⚠ 범위 '${scope.label}' 를 지식 그래프에서 찾지 못했습니다 - 이름으로만 거릅니다`);
        else if (scope) await L(`범위: ${scope.type ? `[${scope.type}] ` : ''}${scope.label} - 이어진 노드 ${scope.nodes.length}개 · 파일 ${scope.files.length}개`);
      }
      const inScope = (files = [], text = '') => {
        if (!scope) return true;
        const t = String(text).toLowerCase();
        if (scope.label && t.includes(String(scope.label).toLowerCase())) return true;
        return (files || []).some((f) => scope.files.some((sf) => String(f).includes(sf) || sf.includes(String(f).split(':')[0])));
      };
      for (const step of loop.steps || []) {
        check();
        if (step.type === 'knowledge') {
          await L('지식 그래프 갱신…');
          try { await this.knowledge.enqueue(project, { mode: 'update', reason: `루프 ${loop.name}`, low: true }); } catch (e) { if (e.status !== 409) throw e; }
          const st = await waitUntil(async () => { const s = await this.knowledge.state(p); return ['QUEUED', 'RUNNING'].includes(s.status) ? null : s; });
          await L(`${st.status === 'DONE' ? '✓' : '✗'} 지식 그래프 ${st.status} (노드 ${(st.nodes || []).length})`);
        } else if (step.type === 'insights') {
          const focus = [scope ? `범위를 '${scope.label}' ${scope.type ? `(${scope.type})` : ''} 에 한정하세요. 이 범위의 파일: ${scope.files.slice(0, 30).join(', ') || '(그래프에 파일 없음 - 이름으로 찾으세요)'}. 이 범위 밖의 문제는 적지 마세요.` : '', step.focus || ''].filter(Boolean).join(' ');
          await L(`제안 분석…${scope ? ` (범위: ${scope.label})` : ''}${step.focus ? ` (${step.focus})` : ''}`);
          try { await this.insights.enqueue(project, { focus, low: true }); } catch (e) { if (e.status !== 409) throw e; }
          const st = await waitUntil(async () => { const s = await this.insights.state(p); return ['QUEUED', 'RUNNING'].includes(s.status) ? null : s; });
          await L(`${st.status === 'DONE' ? '✓' : '✗'} 제안 분석 ${st.status} - 항목 ${(st.items || []).filter((i) => !i.reportId).length}건`);
          if (st.status !== 'DONE') throw new Error('제안 분석 실패');
        } else if (step.type === 'fix') {
          const st = await this.insights.state(p);
          const thr = SEV[String(step.severity || 'HIGH').toUpperCase()] ?? 1;
          const kinds = Array.isArray(step.kinds) && step.kinds.length ? new Set(step.kinds) : null;
          const cands = (st.items || []).filter((i) => !i.reportId && (SEV[i.severity] ?? 9) <= thr && (!kinds || kinds.has(i.kind)) && inScope(i.files, `${i.title} ${i.evidence || ''}`))
            .sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9) || (b.confidence || 0) - (a.confidence || 0)).slice(0, Number(step.max) > 0 ? Number(step.max) : 1);
          if (!cands.length) { await L(`수정 대상 없음 (${step.severity || 'HIGH'} 이상${scope ? ` · 범위 '${scope.label}' 안` : ''} 제안 없음)`); continue; }
          for (const item of cands) {
            check();
            if (this.runner.userPending('fix') || this.runner.lane('fix').busy) { await L('사람이 요청한 수정이 먼저 - 끝나길 기다립니다'); await waitUntil(async () => !this.runner.userPending('fix') && !this.runner.lane('fix').busy, 10_000); }
            const rid = await this.insights.withLock(`report:${p}`, async () => {
              const cur = await this.insights.state(p);
              const it = (cur.items || []).find((x) => x.id === item.id);
              if (!it || it.reportId) return null;
              const rid2 = await this.insights.toReport(project, it, { fix: true, reporter: `loop:${loop.name}` });
              await this.insights.save(p, (c) => ({ items: (c.items || []).map((x) => (x.id === it.id ? { ...x, reportId: rid2 } : x)) }));
              return rid2;
            });
            if (rid == null) continue;
            made.push(rid);
            await this.updateRun(p, id, { made: [...made] });
            await L(`리포트 #${rid} 로 만들어 AI 수정 시작: [${item.severity}] ${firstLine(item.title, 70)}`);
            const r = await waitUntil(async () => { const x = await this.store.get(p, rid); return ['QUEUED', 'RUNNING'].includes(x?.fixStatus) ? null : x; });
            await L(`${['READY', 'PR_OPENED', 'MERGED'].includes(r.fixStatus) ? '✓' : '✗'} #${rid} ${r.fixStatus}${r.fixVersion ? ` · 버전 v${r.fixVersion}` : ''}${r.fixPrUrl ? ` · ${r.fixPrUrl}` : ''} - ${firstLine(r.fixSummary || '', 80)}`);
          }
        } else if (step.type === 'preview') {
          if (!this.versions?.recipe(project)) { await L('미리보기 레시피가 없어 건너뜀'); continue; }
          for (const rid of made) {
            check();
            const r = await this.store.get(p, rid);
            if (r?.fixVersion == null) continue;
            await L(`v${r.fixVersion} 미리보기 띄우는 중…`);
            try { await this.versions.start(project, r.fixVersion, { low: true }); } catch (e) { if (e.status !== 409) { await L(`✗ 미리보기 실패: ${firstLine(e.message, 120)}`); continue; } }
            const v = await waitUntil(async () => { const x = await this.versions.get(p, r.fixVersion); return ['QUEUED', 'BUILDING', 'STARTING'].includes(x?.preview?.status) ? null : x; });
            await L(`${v.preview?.status === 'UP' ? '✓' : '✗'} v${r.fixVersion} 미리보기 ${v.preview?.status}${v.preview?.url ? ` ${v.preview.url}` : ''}`);
          }
        } else if (step.type === 'export') {
          const mode = ['branch', 'pr', 'merge'].includes(step.mode) ? step.mode : 'pr';
          for (const rid of made) {
            check();
            const r = await this.store.get(p, rid);
            if (!r || !['READY', 'PR_OPENED'].includes(r.fixStatus)) continue;
            if (r.fixStatus === 'PR_OPENED' && mode !== 'merge') continue;
            await L(`#${rid} 내보내기(${mode})…`);
            try { await this.runner.enqueueMerge(project, rid, mode, { low: true }); } catch (e) { await L(`✗ #${rid} 내보내기 실패: ${firstLine(e.message, 120)}`); continue; }
            const x = await waitUntil(async () => { const y = await this.store.get(p, rid); return ['QUEUED', 'RUNNING'].includes(y?.fixStatus) ? null : y; });
            await L(`${['MERGED', 'PR_OPENED', 'READY'].includes(x.fixStatus) ? '✓' : '✗'} #${rid} ${x.fixStatus}${x.fixPrUrl ? ` ${x.fixPrUrl}` : ''}`);
          }
        } else if (step.type === 'release') {
          // 루프 끝에 배포판 한 덩이 - 묶음 안에 DB DDL 까지 들어간다
          if (!this.releases) { await L('배포판 기능이 없어 건너뜀'); continue; }
          try {
            const r0 = await this.releases.start(project, { label: step.label || `루프 ${loop.name}`, note: step.note || '' });
            await L(`배포판 ${r0.id} 만드는 중…`);
            const x = await waitUntil(async () => { const y = await this.releases.get(p, r0.id); return ['QUEUED', 'BUILDING'].includes(y?.status) ? null : y; });
            await L(`${x.status === 'DONE' ? '✓' : '✗'} 배포판 ${r0.id} ${x.status}${x.db ? ` · DDL 적용 ${x.db.safeCount}건·확인 ${x.db.reviewCount}건` : ''}${x.error ? ` - ${firstLine(x.error, 120)}` : ''}`);
          } catch (e) { await L(`✗ 배포판 실패: ${firstLine(e.message, 150)}`); }
        } else await L(`모르는 단계 '${step.type}' 건너뜀`);
      }
      await L(`✓ 루프 끝 - 만든 리포트 ${made.length}건`);
      await this.updateRun(p, id, { status: 'DONE', endedAt: nowIso(), made });
      this.notifier?.send(project, 'loop.done', { title: `루프 '${loop.name}' 끝 (${trigger})`, lines: [`만든 리포트 ${made.length}건${made.length ? `: ${made.map((m) => '#' + m).join(' ')}` : ''}`, `단계: ${(loop.steps || []).map((s) => s.type).join(' → ')}`], level: 'ok' }).catch(() => {});
    } catch (e) {
      await L(`✗ ${firstLine(e.message, 200)}`);
      await this.updateRun(p, id, { status: ctl.stop ? 'STOPPED' : 'FAILED', endedAt: nowIso(), made });
      if (!ctl.stop) this.notifier?.send(project, 'loop.failed', { title: `루프 '${loop.name}' 실패`, lines: [firstLine(e.message, 200)], level: 'bad' }).catch(() => {});
    } finally {
      this.active.delete(p);
    }
  }
}
