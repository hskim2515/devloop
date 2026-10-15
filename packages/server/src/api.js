import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FileStore } from './store.js';
import { Shots } from './shots.js';
import { HttpError, notBlank } from './util.js';
import { adminRouter } from './admin.js';

const STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
const REPORT_FIELDS = ['severity', 'problem', 'reproSteps', 'expectedResult', 'screenshot', 'contextJson', 'frontendLogs', 'backendLogs', 'networkLogs', 'mutationLog'];

/**
 * HTTP API. 응답은 `{ content }` 하나로 감싼다(프론트 SDK 와 lhdt 뷰어가 res.data.content 로 읽는다).
 *
 *   POST   /api/p/:project/reports              리포트 저장 → { bugReportId }
 *   GET    /api/p/:project/reports              목록(가벼운 필드)
 *   GET    /api/p/:project/reports/:id          상세
 *   GET    /api/p/:project/reports/:id/fix      진행 상태만(스크린샷·로그 제외) - 진행 중 3초 폴링용
 *   PATCH  /api/p/:project/reports/:id/status   { status }
 *   DELETE /api/p/:project/reports/:id
 *   POST   /api/p/:project/reports/:id/request-fix
 *   POST   /api/p/:project/reports/:id/fix-chat { message, mode: 'ask'|'change' }
 *   POST   /api/p/:project/reports/:id/fix-sync
 *
 * 인증: 프로젝트에 apiKey 가 있으면 `X-Devloop-Key` 헤더가 같아야 한다. 보고자는 `X-Devloop-User` 헤더(앱이 로그인 사용자를 넣는다) 또는 body.reporter.
 */
/**
 * 라우터를 돌려준다(경로는 마운트 지점 기준). 독립 서버는 `app.use('/api', router)`, 앱 내장(devloop/embed)은 `app.use('/devloop', router)`.
 * 콘솔(/ui/)은 자기 주소의 한 단계 위를 API 기준으로 쓰므로 어디에 마운트해도 맞는다.
 */
export function createApi(cfg, store, runner, log = console, insights = null, knowledge = null, versions = null, loops = null, notifier = null, features = null, releases = null) {
  const app = express.Router();
  // 버전 미리보기({마운트}/v/:project/:n/…)는 본문을 그대로 넘겨야 하므로 JSON 파서보다 앞에
  if (versions) app.use(versions.router());
  app.use(express.json({ limit: '60mb' }));

  // CORS - 프로젝트 cors 목록(없으면 전부 허용). 프리플라이트는 프로젝트를 모르므로 요청 origin 을 그대로 돌려준다
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Devloop-Key, X-Devloop-User, X-Devloop-Admin, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((v) => { if (v !== undefined) res.json({ content: v }); }).catch(next);

  app.get('/health', (req, res) => res.json({ ok: true, projects: Object.keys(cfg.projects), queue: runner.pending, busy: !!runner.busy, lanes: runner.laneState() }));

  // ── 운영자 대시보드: <마운트>/ui/ (독립 서버 /api/ui/, 내장 /devloop/ui/) ──
  const here = path.dirname(fileURLToPath(import.meta.url));
  const uiDir = path.join(here, '..', 'ui');
  const clientDist = path.join(here, '..', '..', 'client', 'dist');
  app.use('/ui/client', express.static(clientDist, { maxAge: '1h' }));
  // 콘솔 HTML: 클라이언트 번들 주소에 킷 버전을 붙인다 - Cloudflare 같은 CDN 이 .js 를 몇 시간 캐시해 새 배포 뒤에도 옛 번들을 주는 것을 막는다
  let uiHtml = null;
  app.get(['/ui', '/ui/'], (req, res) => {
    if (!uiHtml) {
      let ver = '';
      try { ver = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version || ''; } catch { /* */ }
      uiHtml = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8').replace('client/devloop-client.iife.js"', `client/devloop-client.iife.js?v=${encodeURIComponent(ver || Date.now())}"`);
    }
    res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(uiHtml);
  });

  const admin = (req, res, next) => {
    if (!notBlank(cfg.server.adminKey)) return next(new HttpError(503, '운영자 키가 설정되지 않았습니다 (DEVLOOP_ADMIN_KEY 또는 ~/.config/devloop/default.env 의 ADMIN_KEY)'));
    if (req.get('X-Devloop-Admin') !== cfg.server.adminKey) return next(new HttpError(401, '운영자 키가 맞지 않습니다'));
    next();
  };
  /** 전 프로젝트 요약: 리포트 목록(가벼운 필드 + 수정 상태) · 진행 중 작업의 로그 꼬리 · 큐 길이 · 프로젝트 API 키(뷰어가 쓰게) */
  app.get('/admin/overview', admin, wrap(async () => {
    const projects = [];
    let running = null;
    for (const p of Object.values(cfg.projects)) {
      const list = await store.list(p.name);
      const counts = {};
      for (const r of list) counts[r.fixStatus || 'NONE'] = (counts[r.fixStatus || 'NONE'] || 0) + 1;
      for (const r of list) {
        if (['QUEUED', 'RUNNING'].includes(r.fixStatus)) {
          const full = await store.get(p.name, r.bugReportId);
          const tail = (full?.fixLog || '').split('\n').filter(Boolean).slice(-12).join('\n');
          if (!running || r.fixStatus === 'RUNNING') running = { project: p.name, bugReportId: r.bugReportId, fixStatus: r.fixStatus, problem: r.problem, logTail: tail, fixRequestedAt: full?.fixRequestedAt };
        }
      }
      projects.push({ name: p.name, apiKey: p.apiKey || '', githubRepo: p.githubRepo, baseBranch: p.baseBranch, autoMerge: p.autoMerge, delivery: p.delivery, cors: p.cors || [], host: p.host, counts, reports: list.map((r) => ({ ...r, fixPrNumber: undefined })) });
    }
    return { projects, running, queue: runner.pending, now: new Date().toISOString() };
  }));
  app.use('/admin', admin, adminRouter(cfg, store, runner, log));

  // ── 제안(Insights): AI 가 먼저 고칠 점을 찾는다 ──
  const proj = (req) => { const p = cfg.projects[req.params.project]; if (!p) throw new HttpError(404, `모르는 프로젝트: ${req.params.project}`); return p; };
  app.get('/admin/insights/:project', admin, wrap(async (req) => insights ? insights.state(proj(req).name) : { status: 'NONE', items: [] }));
  app.post('/admin/insights/:project', admin, wrap(async (req) => { if (!insights) throw new HttpError(503, '분석 기능이 꺼져 있습니다'); await insights.enqueue(proj(req), { focus: String(req.body?.focus || '').slice(0, 500) }); return insights.state(proj(req).name); }));
  // ── 지식 그래프(Knowledge): 메뉴·기능 → 파일·API 온톨로지 ──
  app.get('/admin/knowledge/:project', admin, wrap(async (req) => knowledge ? knowledge.summary(proj(req).name) : { status: 'NONE' }));
  app.get('/admin/knowledge/:project/graph', admin, wrap(async (req) => { const s = knowledge ? await knowledge.state(proj(req).name) : {}; return { nodes: s.nodes || [], edges: s.edges || [], head: s.head || null }; }));
  app.post('/admin/notify/:project/test', admin, wrap(async (req) => notifier.test(proj(req), { webhook: String(req.body?.webhook || '').trim(), mention: req.body?.mention })));
  app.get('/admin/notify/events', admin, wrap(async () => (await import('./notifier.js')).EVENTS));
  // ── 루프(되풀이 자동화) ──
  app.get('/admin/loops/:project', admin, wrap(async (req) => (loops ? loops.list(proj(req)) : { loops: [], runs: [] })));
  app.post('/admin/loops/:project/:name/run', admin, wrap(async (req) => loops.runNow(proj(req), req.params.name)));
  app.post('/admin/loops/:project/stop', admin, wrap(async (req) => loops.stop(proj(req))));
  // ── 버전(AI 수정본) · 미리보기 ──
  // ── 기능(feature) ──
  app.get('/admin/features/:project', admin, wrap(async (req) => ({ features: features ? await features.list(proj(req).name) : [], statuses: (await import('./features.js')).FEATURE_STATUS })));
  app.post('/admin/features/:project', admin, wrap(async (req) => features.create(proj(req).name, req.body || {})));
  app.put('/admin/features/:project/:id', admin, wrap(async (req) => { const f = await features.update(proj(req).name, req.params.id, req.body || {}); if (!f) throw new HttpError(404, '없는 기능'); return f; }));
  app.delete('/admin/features/:project/:id', admin, wrap(async (req) => features.remove(proj(req).name, req.params.id)));
  app.get('/admin/features/:project/:id/tasks', admin, wrap(async (req) => ({ tasks: (await features.tasksOf(proj(req).name, req.params.id)).map((r) => FileStore.light(r)) })));
  app.post('/admin/features/:project/:id/regress', admin, wrap(async (req) => { const p = proj(req); let n = Number(req.body?.n); if (!n) { const vs = versions ? await versions.list(p.name) : []; n = (vs.find((v) => v.preview?.status === 'UP') || vs[0])?.n; } if (!n) throw new HttpError(409, '돌릴 버전이 없습니다'); return features.regress(p, req.params.id, n, runner); }));
  app.post('/admin/features/:project/:id/acceptance/from-task', admin, wrap(async (req) => features.acceptanceFromTask(proj(req).name, req.params.id, Number(req.body?.taskId))));
  app.post('/admin/features/:project/:id/remote/ack', admin, wrap(async (req) => features.ackRemote(proj(req).name, req.params.id)));
  app.get('/admin/roadmap/:project', admin, wrap(async (req) => (features ? features.roadmap(proj(req).name) : { milestones: [], unassigned: [], summary: {} })));
  app.get('/admin/milestones/:project', admin, wrap(async (req) => ({ milestones: features ? await features.milestones(proj(req).name) : [] })));
  app.post('/admin/milestones/:project', admin, wrap(async (req) => features.saveMilestone(proj(req).name, req.body || {})));
  app.put('/admin/milestones/:project/:id', admin, wrap(async (req) => features.saveMilestone(proj(req).name, req.body || {}, req.params.id)));
  app.delete('/admin/milestones/:project/:id', admin, wrap(async (req) => features.removeMilestone(proj(req).name, req.params.id)));
  // ── 외부 이슈(GitHub/GitLab) ──
  app.get('/admin/issues/:project', admin, wrap(async (req) => {
    const p = proj(req); const gh = runner.gh(p);
    if (!gh.isConfigured()) throw new HttpError(409, '저장소 토큰이 없습니다');
    const issues = await gh.listIssues(req.query.state === 'closed' ? 'closed' : 'open', 60);
    const reports = await store.list(p.name);
    const linked = new Map(); for (const r of reports) { try { const x = r.externalIssue ? JSON.parse(r.externalIssue) : null; if (x?.number) linked.set(Number(x.number), r.bugReportId); } catch { /* */ } }
    return { provider: p.host || 'github', issues: issues.map((i) => ({ ...i, body: (i.body || '').slice(0, 400), taskId: linked.get(Number(i.number)) || null })) };
  }));
  app.post('/admin/issues/:project/import', admin, wrap(async (req) => {
    const p = proj(req); const gh = runner.gh(p); const b = req.body || {};
    const number = Number(b.number); if (!number) throw new HttpError(400, '이슈 번호가 필요합니다');
    const reports = await store.list(p.name);
    for (const r of reports) { try { const x = r.externalIssue ? JSON.parse(r.externalIssue) : null; if (x && Number(x.number) === number) throw new HttpError(409, `이미 작업 #${r.bugReportId} 로 가져왔습니다`); } catch (e) { if (e instanceof HttpError) throw e; } }
    const iss = await gh.getIssue(number);
    const labels = (iss.labels || []).map((l) => String(l).toLowerCase());
    const kind = ['bug', 'feature', 'improve'].includes(b.kind) ? b.kind : (labels.some((l) => /bug|버그|defect|fix/.test(l)) ? 'bug' : labels.some((l) => /refactor|improve|개선|enhancement/.test(l)) ? 'improve' : 'feature');
    const mode = ['auto', 'plan', 'step'].includes(b.mode) ? b.mode : (p.taskMode || 'plan');
    const featureId = b.featureId != null && b.featureId !== '' ? Number(b.featureId) : null;
    const report = { severity: labels.some((l) => /critical|urgent|high|긴급/.test(l)) ? 'HIGH' : 'MEDIUM', problem: `${iss.body || iss.title}\n\n(원본 이슈: ${iss.url})`, kind, mode, title: iss.title.slice(0, 200), featureId, externalIssue: JSON.stringify({ provider: p.host || 'github', number: iss.number, url: iss.url, title: iss.title }) };
    report.reporter = iss.author ? `issue:${iss.author}` : 'issue';
    const saved = await store.save(p.name, report);
    await store.update(p.name, saved.bugReportId, (c) => ({ ...c, fixStatus: 'QUEUED', fixRequestedAt: new Date().toISOString(), fixUpdatedAt: new Date().toISOString(), status: 'IN_PROGRESS' }));
    if (kind === 'bug') await runner.enqueue(p, saved.bugReportId); else await runner.enqueuePlan(p, saved.bugReportId);
    if (p.issues?.comment !== false) gh.commentIssue(number, `🤖 DevLoop 가 이 이슈를 ${({ bug: '버그 수정', feature: '기능 구현', improve: '개선' })[kind]} 작업 #${saved.bugReportId} 로 가져왔습니다 (개입 방식: ${mode}). 진행 상황은 여기에 댓글로 남깁니다.`).catch((e) => log.warn(`[devloop ${p.name}] 이슈 댓글 실패: ${e.message}`));
    log.info(`[devloop ${p.name}] 이슈 #${number} → 작업 #${saved.bugReportId} (${kind}/${mode})`);
    return FileStore.fixState(await store.get(p.name, saved.bugReportId));
  }));
  // ── 대시보드: 이 워커의 프로젝트 요약(콘솔이 여러 워커를 한 화면에 모은다) ──
  app.get('/admin/dashboard', admin, wrap(async () => {
    const { loginState } = await import('./claude.js');
    const login = loginState(cfg.server.claudeBin || 'claude');
    const projects = [];
    for (const p of Object.values(cfg.projects)) {
      const list = await store.list(p.name);
      const counts = {}; for (const r of list) counts[r.fixStatus || 'NONE'] = (counts[r.fixStatus || 'NONE'] || 0) + 1;
      const recent = list.slice().sort((a, b) => new Date(b.fixUpdatedAt || b.insertDate) - new Date(a.fixUpdatedAt || a.insertDate)).slice(0, 8).map((r) => ({ id: r.bugReportId, kind: r.kind || 'bug', title: r.title || String(r.problem || '').split('\n')[0].slice(0, 80), fixStatus: r.fixStatus || 'NONE', at: r.fixUpdatedAt || r.insertDate, featureId: r.featureId || null }));
      const rm = features ? await features.roadmap(p.name).catch(() => null) : null;
      const vs = versions ? await versions.list(p.name).catch(() => []) : [];
      const kn = knowledge ? await knowledge.summary(p.name).catch(() => null) : null;
      projects.push({ name: p.name, repo: p.githubRepo || p.repo, baseBranch: p.baseBranch, delivery: p.delivery, counts, total: list.length, waiting: (counts.PLANNED || 0) + (counts.STEP_WAIT || 0), active: (counts.QUEUED || 0) + (counts.RUNNING || 0) + (counts.PLANNING || 0), recent,
        roadmap: rm ? { ...rm.summary, milestones: rm.milestones.map((m) => ({ name: m.name, due: m.due, progress: m.progress, done: m.done, total: m.total })) } : null,
        previewsUp: vs.filter((v) => v.preview?.status === 'UP').length, versions: vs.length,
        loops: (p.loops || []).filter((l) => l.enabled !== false).length,
        knowledge: kn ? { status: kn.status, head: (kn.head || '').slice(0, 7), behind: !!kn.remotePending, updatedAt: kn.updatedAt || kn.builtAt || null } : null });
    }
    return { at: new Date().toISOString(), version: (() => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'package.json'), 'utf8')).version; } catch { return ''; } })(), claude: { loggedIn: login.loggedIn, hint: login.hint }, queue: runner.pending, lanes: runner.laneState(), projects };
  }));
  app.post('/admin/features/:project/suggest', admin, wrap(async (req) => features.suggest(proj(req).name, String(req.body?.text || ''))));
  app.post('/admin/features/:project/impact', admin, wrap(async (req) => ({ features: await features.impact(proj(req).name, Array.isArray(req.body?.files) ? req.body.files : []) })));
  app.get('/admin/versions/:project', admin, wrap(async (req) => ({ versions: versions ? await versions.list(proj(req).name) : [], recipe: versions ? versions.recipe(proj(req)) : null, dbTemplate: versions ? (await versions.state(proj(req).name)).dbTemplate || null : null, sandbox: versions ? await versions.sandboxInfo(proj(req)) : {}, lane: runner.laneState().preview || null })));
  app.post('/admin/versions/:project/sandbox/reset', admin, wrap(async (req) => versions.resetSandbox(proj(req))));
  app.get('/admin/versions/:project/:n/diff', admin, wrap(async (req) => { const d = versions ? await versions.diff(proj(req), req.params.n) : null; if (!d) throw new HttpError(404, '없는 버전'); return d; }));
  app.post('/admin/versions/:project/:n/preview', admin, wrap(async (req) => versions.start(proj(req), req.params.n)));
  app.delete('/admin/versions/:project/:n/preview', admin, wrap(async (req) => versions.stop(proj(req), req.params.n)));
  app.delete('/admin/versions/:project/:n', admin, wrap(async (req) => { await versions.remove(proj(req), req.params.n); return { ok: true }; }));
  app.post('/admin/versions/:project/recipe/draft', admin, wrap(async (req) => ({ recipe: await versions.draftRecipe(proj(req), { note: String(req.body?.note || '').slice(0, 1000) }) })));

  // ── 배포판 ────────────────────────────────────────────────────────────────
  // 소스 빌드 산출물 + 받는 쪽 DB 를 맞추는 DDL 을 한 덩이로 묶는다. 기준 스냅샷은 사람이 올리거나 직전 배포판 것을 쓴다.
  const rel = () => { if (!releases) throw new HttpError(503, '배포판 기능을 쓸 수 없습니다'); return releases; };
  app.get('/admin/releases/:project', admin, wrap(async (req) => {
    const p = proj(req);
    const st = await rel().state(p.name);
    return {
      releases: await rel().list(p.name),
      baseline: st.baseline || null,
      recipe: rel().recipe(p),
      lane: runner.laneState().release || null,
      versions: versions ? (await versions.list(p.name)).map((v) => ({ n: v.n, sha: v.sha, summary: v.summary, reportId: v.reportId, createdAt: v.createdAt })) : [],
    };
  }));
  // 받는 쪽 DB 에서 돌릴 스냅샷 SQL - 결과를 baseline 으로 올리면 DDL 이 그 DB 기준으로 좁혀진다
  app.get('/admin/releases/:project/snapshot-sql', admin, wrap(async (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="devloop-schema-snapshot.sql"');
    res.type('text/plain; charset=utf-8').send(rel().snapshotSqlFor(proj(req)));
  }));
  app.put('/admin/releases/:project/baseline', admin, wrap(async (req) => rel().saveBaseline(proj(req), req.body?.snapshot ?? req.body, req.body?.source || 'upload')));
  app.delete('/admin/releases/:project/baseline', admin, wrap(async (req) => {
    const p = proj(req);
    await fs.promises.rm(rel().baselineFile(p.name), { force: true });
    await rel().save(p.name, { baseline: null });
    return { ok: true };
  }));
  app.post('/admin/releases/:project', admin, wrap(async (req) => rel().start(proj(req), { n: req.body?.n, label: req.body?.label, note: req.body?.note })));
  app.delete('/admin/releases/:project/:id', admin, wrap(async (req) => { await rel().remove(proj(req), req.params.id); return { ok: true }; }));
  app.get('/admin/releases/:project/:id/download', admin, wrap(async (req, res) => {
    const p = await rel().fileOf(proj(req), req.params.id, null);
    res.download(p, `${proj(req).name}-${req.params.id}.tar.gz`);
  }));
  // 묶음 안의 파일 하나 보기 (콘솔에서 DDL 을 바로 읽게)
  app.get('/admin/releases/:project/:id/file', admin, wrap(async (req, res) => {
    const p = await rel().fileOf(proj(req), req.params.id, String(req.query.path || ''));
    res.type('text/plain; charset=utf-8').send(await fs.promises.readFile(p, 'utf8'));
  }));
  app.post('/admin/knowledge/:project', admin, wrap(async (req) => { if (!knowledge) throw new HttpError(503, '지식 그래프 기능이 꺼져 있습니다'); await knowledge.enqueue(proj(req), { mode: req.body?.mode === 'full' ? 'full' : 'update', reason: '콘솔' }); return knowledge.summary(proj(req).name); }));

  // 제안 삭제 - 목록에서 빼고 제목을 '무시' 목록에 남겨 다음 분석에서 같은 것을 다시 내지 않게
  app.delete('/admin/insights/:project/items/:id', admin, wrap(async (req) => {
    if (!insights) throw new HttpError(503, '분석 기능이 꺼져 있습니다');
    const p = proj(req);
    const id = Number(req.params.id);
    let removed = null;
    await insights.save(p.name, (cur) => {
      removed = (cur.items || []).find((x) => x.id === id) || null;
      const dismissed = [...(cur.dismissed || []), ...(removed ? [removed.title] : [])].slice(-60);
      return { items: (cur.items || []).filter((x) => x.id !== id), dismissed };
    });
    if (!removed) throw new HttpError(404, '없는 제안');
    return { ok: true };
  }));

  app.post('/admin/insights/:project/report', admin, wrap(async (req) => {
    if (!insights) throw new HttpError(503, '분석 기능이 꺼져 있습니다');
    const p = proj(req);
    const fix = !!req.body?.fix;
    if (fix && !notBlank(cfg.githubToken(p))) throw new HttpError(409, 'GitHub 토큰이 없습니다(DEVLOOP_GITHUB_TOKEN 또는 github.tokenFile)');
    // 읽기~reportId 저장을 잠금 안에서 - 중복 클릭·동시 요청이 리포트를 두 번 만들지 않게
    // save() 가 p.name 키로 따로 잠그므로(재진입 불가) 여기서는 다른 키로 잠근다
    return insights.withLock(`report:${p.name}`, async () => {
      const st = await insights.state(p.name);
      const item = st.items?.find((x) => x.id === Number(req.body?.id));
      if (!item) throw new HttpError(404, '없는 제안');
      if (item.reportId) throw new HttpError(409, `이미 리포트 #${item.reportId} 로 만들었습니다`);
      const id = await insights.toReport(p, item, { fix, reporter: req.body?.reporter || 'insights' });
      // 만든 제안은 목록에서 '리포트 #n' 으로 표시되게
      await insights.save(p.name, (cur) => ({ items: (cur.items || []).map((x) => (x.id === item.id ? { ...x, reportId: id } : x)) }));
      return { bugReportId: id };
    });
  }));

  const pr = express.Router({ mergeParams: true });
  app.use('/p/:project', (req, res, next) => {
    const project = cfg.projects[req.params.project];
    if (!project) return next(new HttpError(404, `모르는 프로젝트: ${req.params.project}`));
    const origin = req.headers.origin;
    if (origin && project.cors?.length && !project.cors.includes(origin)) return next(new HttpError(403, `허용되지 않은 origin: ${origin}`));
    req.isAdmin = notBlank(cfg.server.adminKey) && req.get('X-Devloop-Admin') === cfg.server.adminKey;
    if (!req.isAdmin && notBlank(project.apiKey) && req.get('X-Devloop-Key') !== project.apiKey) return next(new HttpError(401, 'API 키가 맞지 않습니다(X-Devloop-Key)'));
    req.project = project;
    next();
  }, pr);
  // 수정 요청·후속 요청은 프로젝트 설정(fixFrom)에 따라 관리 콘솔에서만 허용할 수 있다
  const fixGuard = (req, res, next) => (req.project.fixFrom === 'admin' && !req.isAdmin ? next(new HttpError(403, '이 프로젝트의 수정 요청은 관리 콘솔에서만 할 수 있습니다. 신고는 접수됐습니다.')) : next());

  /** 앱 SDK 가 화면을 맞추는 데 필요한 공개 정보 */
  pr.get('/info', wrap((req) => ({ name: req.project.name, fixFrom: req.project.fixFrom, canFix: req.project.fixFrom !== 'admin' || !!req.isAdmin, autoMerge: !!req.project.autoMerge, delivery: req.project.delivery })));

  pr.post('/reports', wrap(async (req) => {
    const b = req.body || {};
    if (!notBlank(b.problem) && !notBlank(b.reproSteps)) throw new HttpError(400, '문제 또는 재현 절차를 적어 주세요');
    const report = {};
    for (const k of REPORT_FIELDS) report[k] = b[k] == null ? null : (typeof b[k] === 'string' ? b[k] : JSON.stringify(b[k]));
    report.reporter = req.get('X-Devloop-User') || b.reporter || 'anonymous';
    // 버그 신고 도구 자체의 문제 - 같은 프로젝트에 '도구' 표시로 저장되고 AI 수정 대상이 아니다(운영자가 도구 저장소에서 처리)
    report.tool = b.tool === true || b.tool === 'true';
    const saved = await store.save(req.project.name, report);
    log.info(`[devloop ${req.project.name}] 리포트 #${saved.bugReportId} (${report.reporter})`);
    notifier?.send(req.project, 'report.new', { title: `새 리포트 #${saved.bugReportId} [${report.severity || '-'}]`, lines: [notBlank(report.problem) ? report.problem.split('\n')[0].slice(0, 160) : '(내용 없음)', `보고자 ${report.reporter || '-'}${report.tool ? ' · 신고 도구 문제' : ''}`], level: 'info', data: { reportId: saved.bugReportId, severity: report.severity } }).catch(() => {});
    return { bugReportId: saved.bugReportId };
  }));

  pr.get('/reports', wrap((req) => store.list(req.project.name)));

  /** 작업 만들기(버그 아닌 기능·개선 요청도) - 버그는 바로 수정 흐름, 기능·개선은 계획부터 */
  pr.post('/tasks', fixGuard, wrap(async (req) => {
    const p = req.project; const b = req.body || {};
    const kind = ['bug', 'feature', 'improve'].includes(b.kind) ? b.kind : 'feature';
    const title = String(b.title || '').trim().slice(0, 200);
    const description = String(b.description || b.problem || '').trim();
    if (!title && !description) throw new HttpError(400, '제목이나 설명을 적어 주세요');
    if (!notBlank(cfg.githubToken(p))) throw new HttpError(409, '저장소 토큰이 없습니다(키·계정 탭)');
    const mode = ['auto', 'plan', 'step'].includes(b.mode) ? b.mode : (p.taskMode || 'plan');
    const featureId = b.featureId != null && b.featureId !== '' ? Number(b.featureId) : null;
    if (featureId != null && features && !await features.get(p.name, featureId)) throw new HttpError(400, '없는 기능입니다');
    const report = { severity: ['HIGH', 'MEDIUM', 'LOW'].includes(b.severity) ? b.severity : 'MEDIUM', problem: description || title, reproSteps: b.notes || null, expectedResult: b.expected || null, kind, mode, title: title || null, scope: b.scope ? String(b.scope).slice(0, 200) : null, featureId };
    report.reporter = req.get('X-Devloop-User') || b.reporter || (req.isAdmin ? 'admin' : 'anonymous');
    const saved = await store.save(p.name, report);
    log.info(`[devloop ${p.name}] 작업 #${saved.bugReportId} (${kind}/${mode}) ${title}`);
    await store.update(p.name, saved.bugReportId, (c) => ({ ...c, fixStatus: 'QUEUED', fixRequestedAt: new Date().toISOString(), fixUpdatedAt: new Date().toISOString(), status: 'IN_PROGRESS' }));
    if (kind === 'bug') await runner.enqueue(p, saved.bugReportId); else await runner.enqueuePlan(p, saved.bugReportId);
    return FileStore.fixState(await store.get(p.name, saved.bugReportId));
  }));
  /** 리포트를 기능에 묶기/풀기 */
  pr.put('/reports/:id/feature', wrap(async (req) => {
    const p = req.project; const r = await load(req);
    const featureId = req.body?.featureId != null && req.body.featureId !== '' ? Number(req.body.featureId) : null;
    if (featureId != null && features && !await features.get(p.name, featureId)) throw new HttpError(400, '없는 기능입니다');
    await store.update(p.name, r.bugReportId, (c) => ({ ...c, featureId }));
    return { ok: true, featureId };
  }));
  /** 이 리포트의 변경이 영향 주는 기능 */
  pr.get('/reports/:id/impact', wrap(async (req) => {
    const r = await load(req); let files = []; try { files = JSON.parse(r.fixFiles || '[]'); } catch { /* */ }
    return { features: features ? await features.impact(req.project.name, files) : [] };
  }));
  /** 계획 승인(수정된 계획을 같이 보낼 수 있음) → 구현 시작 */
  pr.post('/reports/:id/plan/approve', fixGuard, wrap(async (req) => {
    const p = req.project; const r = await loadFixable(req);
    if (r.fixStatus !== 'PLANNED') throw new HttpError(409, '승인 대기 중인 계획이 없습니다');
    const patch = {};
    if (req.body?.plan) { const { normalizePlan } = await import('./plan.js'); const np = normalizePlan(typeof req.body.plan === 'string' ? JSON.parse(req.body.plan) : req.body.plan); if (!np) throw new HttpError(400, '계획 형식이 맞지 않습니다(steps 필요)'); patch.plan = JSON.stringify(np); }
    if (['auto', 'plan', 'step'].includes(req.body?.mode)) patch.mode = req.body.mode;
    await store.update(p.name, r.bugReportId, (c) => ({ ...c, ...patch, planStep: 0, planApprovedAt: new Date().toISOString(), planApprovedBy: req.get('X-Devloop-User') || (req.isAdmin ? 'admin' : 'user'), fixStatus: 'QUEUED', fixUpdatedAt: new Date().toISOString() }));
    await runner.logLine(p, r.bugReportId, `✓ 계획 승인 (${patch.plan ? '수정된 계획' : '그대로'}${patch.mode ? ` · 개입 ${patch.mode}` : ''})`);
    await runner.enqueueImplement(p, r.bugReportId);
    return FileStore.fixState(await store.get(p.name, r.bugReportId));
  }));
  /** 단계 모드: 다음 단계 진행 */
  pr.post('/reports/:id/plan/next', fixGuard, wrap(async (req) => {
    const p = req.project; const r = await loadFixable(req);
    if (r.fixStatus !== 'STEP_WAIT') throw new HttpError(409, '다음 단계 대기 상태가 아닙니다');
    await store.update(p.name, r.bugReportId, (c) => ({ ...c, fixStatus: 'QUEUED', fixUpdatedAt: new Date().toISOString() }));
    await runner.logLine(p, r.bugReportId, '▶ 다음 단계 진행 요청');
    await runner.enqueueImplement(p, r.bugReportId);
    return FileStore.fixState(await store.get(p.name, r.bugReportId));
  }));
  /** 다시 계획(메모를 주면 반영) */
  pr.post('/reports/:id/plan/replan', fixGuard, wrap(async (req) => {
    const p = req.project; const r = await loadFixable(req);
    if (['QUEUED', 'RUNNING', 'PLANNING'].includes(r.fixStatus)) throw new HttpError(409, '작업이 진행 중입니다');
    await runner.enqueuePlan(p, r.bugReportId, { note: String(req.body?.note || '').slice(0, 2000) });
    return FileStore.fixState(await store.get(p.name, r.bugReportId));
  }));

  // front-check 스크린샷 (fixShots / 제안 분석의 shots 에 적힌 file). 보관 디렉터리 밖은 404
  const shots = new Shots(cfg.server.dataDir);
  pr.get('/shots/*', (req, res, next) => {
    const abs = shots.resolve(req.project.name, req.params[0]);
    if (!abs) return next(new HttpError(404, '없는 스크린샷'));
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(abs, (e) => { if (e) next(new HttpError(404, '없는 스크린샷')); });
  });

  const load = async (req) => {
    const id = Number(req.params.id);
    const r = Number.isInteger(id) ? await store.get(req.project.name, id) : null;
    if (!r) throw new HttpError(404, `리포트가 없습니다: ${req.params.id}`);
    return r;
  };

  // 도구 문제 리포트는 이 프로젝트의 코드와 무관하므로 수정 파이프라인에 넣지 않는다
  const loadFixable = async (req) => {
    const r = await load(req);
    if (r.tool) throw new HttpError(409, '버그 신고 도구 문제로 접수된 리포트는 AI 수정 대상이 아닙니다(도구 저장소에서 처리)');
    return r;
  };

  // 이 리포트의 수정본 버전 미리보기 상태(뷰어 표시용)
  const withPreview = async (req, r) => {
    if (!versions || !r || r.fixVersion == null) return r;
    const v = await versions.get(req.project.name, r.fixVersion);
    return { ...r, preview: v ? { status: v.preview?.status || 'NONE', url: v.preview?.url || null, error: v.preview?.error || null, canPreview: !!versions.recipe(req.project) } : null };
  };
  pr.get('/reports/:id', wrap(async (req) => withPreview(req, await load(req))));
  pr.post('/reports/:id/preview', fixGuard, wrap(async (req) => { const r = await loadFixable(req); if (r.fixVersion == null) throw new HttpError(409, '아직 수정본 버전이 없습니다'); await versions.start(req.project, r.fixVersion); return withPreview(req, FileStore.fixState(await store.get(req.project.name, r.bugReportId))); }));
  pr.delete('/reports/:id/preview', fixGuard, wrap(async (req) => { const r = await loadFixable(req); if (r.fixVersion == null) throw new HttpError(409, '수정본 버전이 없습니다'); await versions.stop(req.project, r.fixVersion); return withPreview(req, FileStore.fixState(await store.get(req.project.name, r.bugReportId))); }));
  // 이 신고와 관련된 지식 그래프 부분 - AI 가 프롬프트로 받는 것과 같은 선택. 그래프가 없으면 빈 목록
  pr.get('/reports/:id/knowledge', wrap(async (req) => {
    const r = await load(req);
    const g = knowledge ? await knowledge.graph(req.project.name) : null;
    if (!g) return { nodes: [], edges: [], available: false };
    const { relevantGraph, hintsFromReport } = await import('./knowledge.js');
    return { ...relevantGraph(g, hintsFromReport(r)), available: true };
  }));
  pr.get('/reports/:id/fix', wrap(async (req) => withPreview(req, FileStore.fixState(await load(req)))));

  pr.patch('/reports/:id/status', wrap(async (req, res) => {
    const st = req.body?.status;
    if (!STATUSES.has(st)) throw new HttpError(400, `유효하지 않은 상태값: ${st}`);
    const r = await load(req);
    await store.update(req.project.name, r.bugReportId, { status: st });
    res.status(204).end();
  }));

  pr.delete('/reports/:id', wrap(async (req, res) => {
    const r = await load(req);
    await store.delete(req.project.name, r.bugReportId);
    res.status(204).end();
  }));

  pr.post('/reports/:id/request-fix', fixGuard, wrap(async (req) => {
    const p = req.project;
    if (!notBlank(cfg.githubToken(p))) throw new HttpError(409, 'GitHub 토큰이 없습니다(DEVLOOP_GITHUB_TOKEN 또는 github.tokenFile)');
    const r = await loadFixable(req);
    if (['QUEUED', 'RUNNING', 'PLANNING'].includes(r.fixStatus)) throw new HttpError(409, '이미 수정이 진행 중입니다.');
    await store.update(p.name, r.bugReportId, (c) => ({
      ...c,
      fixStatus: 'QUEUED', fixBranch: null, fixPrUrl: null, fixPrNumber: null, fixSummary: null, fixLog: '', fixSessionId: null, fixChat: null, fixSuggestions: null,
      fixRequestedAt: new Date().toISOString(), fixUpdatedAt: new Date().toISOString(),
      status: c.status === 'OPEN' ? 'IN_PROGRESS' : c.status,
    }));
    await runner.enqueue(p, r.bugReportId);
    return FileStore.fixState(await store.get(p.name, r.bugReportId));
  }));

  pr.post('/reports/:id/fix-chat', fixGuard, wrap(async (req) => {
    const p = req.project;
    const { message, mode } = req.body || {};
    if (!notBlank(message)) throw new HttpError(400, '메시지가 비어 있습니다.');
    const r = await loadFixable(req);
    if (!r.fixStatus) throw new HttpError(409, "먼저 '수정 요청' 을 실행한 뒤에 이어서 대화할 수 있습니다.");
    if (['QUEUED', 'RUNNING', 'PLANNING'].includes(r.fixStatus)) throw new HttpError(409, '작업이 진행 중입니다. 끝난 뒤에 보내세요.');
    await runner.appendChat(p, r.bugReportId, 'user', message.trim());
    await runner.enqueueFollowUp(p, r.bugReportId, message.trim(), mode === 'change' ? 'change' : 'ask');
    return FileStore.fixState(await store.get(p.name, r.bugReportId));
  }));

  /** 열린 PR 을 정식 경로로 병합 (관리 콘솔·자동 병합 프로젝트용) */
  // 되돌리기: 병합된 수정을 revert 브랜치 + PR 로 (자동 병합 프로젝트면 병합까지)
  pr.post('/reports/:id/revert', fixGuard, wrap(async (req) => {
    const r = await loadFixable(req);
    await runner.enqueueRevert(req.project, r.bugReportId, String(req.body?.reason || '').slice(0, 300));
    return FileStore.fixState(await store.get(req.project.name, r.bugReportId));
  }));
  // 내보내기·병합: body.mode = branch|pr|merge (기본 merge). 보관만 한 수정본(READY)도 여기서 푸시·PR·병합
  pr.post('/reports/:id/merge', fixGuard, wrap(async (req) => {
    const r = await loadFixable(req);
    const mode = ['branch', 'pr', 'merge'].includes(req.body?.mode) ? req.body.mode : 'merge';
    await runner.enqueueMerge(req.project, r.bugReportId, mode);
    return FileStore.fixState(await store.get(req.project.name, r.bugReportId));
  }));

  pr.post('/reports/:id/fix-sync', wrap(async (req) => {
    const r = await load(req);
    return FileStore.fixState(await runner.syncWithGitHub(req.project, r.bugReportId));
  }));

  app.use((req, res) => res.status(404).json({ message: `없는 경로: ${req.method} ${req.path}` }));
  void fs;
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) log.error('[devloop] API 오류', err);
    res.status(status).json({ message: err.message || '오류' });
  });
  return app;
}
