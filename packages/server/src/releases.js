import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { snapshotSql, parseSnapshot, diffSchema, toDdl, ddlFileCheck, changeLabel } from './schema.js';
import { firstLine, hhmmss, nowIso } from './util.js';

/**
 * 배포판 = 어느 버전의 소스를 받는 쪽에 그대로 넘길 수 있게 묶은 한 덩이.
 * 빌드 산출물(프론트 dist · 백엔드 실행 파일) + **DB 스키마를 맞추는 DDL** + 릴리스 노트.
 *
 * <p>왜 DDL 이 들어가야 하나 - git 은 소스를 추적하지만 DB 스키마는 아무도 추적하지 않는다.
 * 그래서 받는 쪽에 테이블·열이 없어 배포 직후 깨진다(lhdt 실측: 운영에만 있던
 * user_group.teneleven_id 때문에 개발서버 기능 4곳이 죽었고, district_request 는
 * DDL 파일은 커밋됐는데 DB 에 안 들어가 500 이었다). 스키마를 추측하지 않고
 * **두 DB 의 스냅샷을 비교해** 받는 쪽에 없는 것만 만들어 준다.
 *
 * <p>기준 스냅샷(baseline, 받는 쪽)을 구하는 세 길 - 순서대로 찾는다:
 *   ① 사람이 올린 스냅샷: 콘솔에서 `db/스냅샷-SQL.sql` 을 받아 운영 DB 에 한 번 돌리고 결과를 올린다.
 *      받는 쪽 DB 에 직접 붙지 못하는 보통의 경우(운영망 분리)에 쓰는 정식 경로다.
 *   ② 직전 배포판의 스냅샷: 같은 받는 쪽에 연달아 낼 때. 배포판마다 스냅샷을 함께 담아 두므로 이어진다.
 *   ③ 둘 다 없으면 기준 없음 → 전체 스키마를 만드는 DDL(새로 세우는 경우)
 *
 * <p>설정은 미리보기 레시피(preview)를 그대로 쓴다 - 같은 빌드 명령·같은 DB 를 보기 때문에
 * 두 벌로 적지 않는다. 프로젝트 `release` 는 다른 점만 적는다:
 *   release: { frontBase: '/', include: {front,back,db}, schemas: ['public'], ddlGlob: 'doc/**\/ddl/*.sql', keep: 5 }
 *
 *   data/{project}/releases.json          { seq, releases: [...] }
 *   data/{project}/releases/{id}/         묶는 중인 디렉터리
 *   data/{project}/releases/{id}.tar.gz   내려받는 파일
 *   data/{project}/schema-baseline.json   사람이 올린 받는 쪽 기준 스냅샷
 */
export class Releases {
  constructor(cfg, store, runner, versions, log = console) {
    this.cfg = cfg;
    this.store = store;
    this.runner = runner;
    this.versions = versions;
    this.log = log;
    this.locks = new Map();
  }

  file(project) { return path.join(this.cfg.server.dataDir, project, 'releases.json'); }
  dir(project, id) { return path.join(this.cfg.server.dataDir, project, 'releases', String(id)); }
  tarPath(project, id) { return path.join(this.cfg.server.dataDir, project, 'releases', `${id}.tar.gz`); }
  baselineFile(project) { return path.join(this.cfg.server.dataDir, project, 'schema-baseline.json'); }

  /**
   * 배포판 설정 - 미리보기 레시피(preview)를 받아쓰고 `release` 에 적은 것으로 덮는다.
   *
   * <p>⚠️ 빌드 명령을 반드시 다시 볼 것. 미리보기는 **개발용 프로파일**로 빌드한다(lhdt 실측:
   * 프론트 `--mode development` 는 lhdt.gaia3d.dev 를, 백엔드 `-Pprofile=develop` 은 개발 DB·개발
   * 설정을 본다). 운영에 넘기는 배포판은 운영 프로파일로 빌드해야 하므로 `release.front.build`·
   * `release.back.build` 를 적어야 한다. 안 적으면 미리보기 명령을 그대로 쓰고, 그 사실을
   * 릴리스 노트와 콘솔에 적어 둔다(조용히 개발 빌드를 넘기지 않게).
   *
   * <p>`env` 는 합치지 않고 **갈아치운다** - 미리보기 env 는 {backUrl} 처럼 미리보기에서만 뜻이 있다.
   */
  recipe(project) {
    const pv = this.versions?.recipe(project) || null;
    const r = project.release || {};
    const step = (base, over) => {
      if (!base && !over) return null;
      const m = { ...(base || {}), ...(over || {}) };
      m.env = over?.env ? { ...over.env } : { ...(base?.env || {}) };
      // 미리보기 자리표시자가 든 값은 배포판에서 뜻이 없다 - 들고 가지 않는다
      for (const [k, v] of Object.entries(m.env)) if (/\{(backUrl|previewUrl|port|db|n)\}/.test(String(v))) delete m.env[k];
      return m;
    };
    const front = step(pv?.front, r.front);
    const back = step(pv?.back, r.back);
    return {
      frontBase: typeof r.frontBase === 'string' ? r.frontBase : '/',
      include: { front: !!front, back: !!back, db: !!pv?.db, ...(r.include || {}) },
      schemas: Array.isArray(r.schemas) && r.schemas.length ? r.schemas : ['public'],
      ddlGlob: typeof r.ddlGlob === 'string' ? r.ddlGlob : '',
      keep: Number(r.keep) > 0 ? Number(r.keep) : 5,
      front, back, preview: pv,
      // 운영 프로파일로 빌드하도록 따로 적었는가 - 안 적었으면 경고로 보여 준다
      buildOverridden: { front: !!r.front?.build, back: !!r.back?.build },
    };
  }

  // ── 상태 ────────────────────────────────────────────────────────────────
  async withLock(project, fn) {
    const prev = this.locks.get(project) || Promise.resolve();
    let release;
    const cur = new Promise((r) => { release = r; });
    const chain = prev.then(() => cur);
    this.locks.set(project, chain);
    await prev;
    try { return await fn(); }
    finally { release(); if (this.locks.get(project) === chain) this.locks.delete(project); }
  }
  async state(project) {
    try { return JSON.parse(await fs.readFile(this.file(project), 'utf8')); }
    catch { return { seq: 0, releases: [] }; }
  }
  async save(project, patch) {
    return this.withLock(project, async () => {
      const cur = await this.state(project);
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      await fs.mkdir(path.dirname(this.file(project)), { recursive: true });
      const tmp = `${this.file(project)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await fs.rename(tmp, this.file(project));
      return next;
    });
  }
  async list(project) { return (await this.state(project)).releases.slice().reverse(); }
  async get(project, id) { return (await this.state(project)).releases.find((x) => String(x.id) === String(id)) || null; }
  async update(project, id, patch) {
    return this.save(project, (c) => ({ ...c, releases: c.releases.map((x) => (String(x.id) === String(id) ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)) }));
  }
  async plog(project, id, line) {
    const stamped = `${hhmmss()}  ${line}`;
    this.log.info(`[release ${project}/${id}] ${line}`);
    await this.update(project, id, (x) => ({ log: ((x.log || '') + stamped + '\n').slice(-40_000) }));
  }

  // ── 기준 스냅샷 ─────────────────────────────────────────────────────────
  /** 받는 쪽 DB 에서 돌릴 SQL - 콘솔에서 내려받아 운영 DB 에 한 번 돌리면 된다 */
  snapshotSqlFor(project) {
    const r = this.recipe(project);
    return [
      '-- 받는 쪽 DB 의 스키마 스냅샷을 뜬다. 읽기만 한다 - 아무것도 바꾸지 않는다.',
      '--',
      '--   psql -h <호스트> -U <계정> -d <DB> -At -f 이파일 > schema-baseline.json',
      '--',
      '-- 나온 파일을 DevLoop 콘솔 배포판 탭의 "기준 스냅샷 올리기" 에 넣으면,',
      '-- 다음 배포판의 DDL 이 이 DB 에 없는 것만 담는다.',
      `-- 대상 스키마: ${r.schemas.join(', ')}`,
      '',
      snapshotSql(r.schemas) + ';',
      '',
    ].join('\n');
  }

  /** 사람이 올린 기준 스냅샷을 저장 */
  async saveBaseline(project, text, source = 'upload') {
    const snap = parseSnapshot(text);                 // 형식이 아니면 여기서 예외
    const meta = { source, database: snap.database || null, server: snap.server || null, takenAt: snap.takenAt || null, savedAt: nowIso(), tables: snap.tables.length, columns: snap.columns.length };
    await fs.mkdir(path.dirname(this.baselineFile(project.name)), { recursive: true });
    await fs.writeFile(this.baselineFile(project.name), JSON.stringify(snap), 'utf8');
    await this.save(project.name, { baseline: meta });
    this.log.info(`[release ${project.name}] 기준 스냅샷 저장: ${meta.database} 테이블 ${meta.tables}개 (${source})`);
    return meta;
  }

  /** 기준 스냅샷 - 올린 것 → 직전 배포판 → 없음 */
  async baseline(project) {
    try {
      const snap = parseSnapshot(await fs.readFile(this.baselineFile(project.name), 'utf8'));
      const meta = (await this.state(project.name)).baseline || {};
      return { snap, from: `올린 스냅샷 (${meta.database || '?'}${meta.takenAt ? `, ${meta.takenAt}` : ''})`, kind: 'upload' };
    } catch { /* 없으면 다음 */ }
    for (const rel of await this.list(project.name)) {
      if (rel.status !== 'DONE' || !rel.db?.snapshotFile) continue;
      try {
        const snap = parseSnapshot(await fs.readFile(path.join(this.dir(project.name, rel.id), rel.db.snapshotFile), 'utf8'));
        return { snap, from: `직전 배포판 ${rel.id} 의 스냅샷 (${rel.createdAt})`, kind: 'previous' };
      } catch { /* 지워졌으면 다음 */ }
    }
    return { snap: null, from: '기준 없음 - 전체 스키마를 만드는 DDL 을 낸다', kind: 'none' };
  }

  // ── 만들기 ──────────────────────────────────────────────────────────────
  /**
   * 큐에 넣는다. n 을 비우면 가장 최근 버전, 버전이 없으면 base 브랜치의 최신 커밋을 쓴다.
   */
  async start(project, { n = null, label = '', note = '' } = {}) {
    const r = this.recipe(project);
    const nothing = !(r.include.front && r.front) && !(r.include.back && r.back) && !(r.include.db && r.preview?.db);
    if (nothing) throw Object.assign(new Error('묶을 것이 없습니다 - 미리보기 레시피(preview)를 만들거나 프로젝트 설정 release 에 front·back·db 를 적으세요'), { status: 409 });
    let sha = null, base = project.baseBranch, version = null;
    if (n != null && n !== '') {
      const v = await this.versions.get(project.name, n);
      if (!v) throw Object.assign(new Error(`없는 버전 v${n}`), { status: 404 });
      sha = v.sha; base = v.base || base; version = v.n;
    }
    const st = await this.save(project.name, (c) => {
      const seq = (c.seq || 0) + 1;
      const id = `r${String(seq).padStart(3, '0')}`;
      return { ...c, seq, releases: [...c.releases, { id, seq, version, sha, base, label: String(label || '').slice(0, 80), note: String(note || '').slice(0, 2000), status: 'QUEUED', createdAt: nowIso(), log: '' }] };
    });
    const rel = st.releases[st.releases.length - 1];
    const ahead = this.runner.submit(project, `release-${rel.id}`, () => this.run(project, rel.id), async (e) => {
      await this.plog(project.name, rel.id, `✗ 실패: ${firstLine(e.message, 300)}`);
      await this.update(project.name, rel.id, { status: 'FAILED', error: firstLine(e.message, 300) });
      this.notifier?.send(project, 'release.failed', { title: `배포판 실패 - ${rel.id}`, lines: [firstLine(e.message, 200)], level: 'bad' }).catch(() => {});
    }, 'release');
    await this.plog(project.name, rel.id, `▶ 배포판 대기열 등록${ahead > 0 ? ` (앞에 ${ahead}건)` : ''}`);
    return rel;
  }

  async run(project, id) {
    const name = project.name;
    const rel = await this.get(name, id);
    const r = this.recipe(project);
    const L = (s) => this.plog(name, id, s);
    const ex = this.runner.ex(project);
    const gh = this.runner.gh(project);
    const { repo, jobs } = this.runner.paths(project, 0);
    const wt = path.join(jobs, `release-${id}`);
    const out = this.dir(name, id);
    const t0 = Date.now();

    await this.update(name, id, { status: 'BUILDING', error: null });
    await fs.rm(out, { recursive: true, force: true });
    await fs.mkdir(out, { recursive: true });
    await this.runner.prepareRepo(project, ex, gh.gitAuthHeader(), L);

    // 버전을 안 줬으면 base 브랜치 최신으로
    let sha = rel.sha;
    if (!sha) {
      await this.runner.mutex(this.runner.repoKey(project), () => ex.exec(repo, 10, ['git', '-c', `http.extraheader=${gh.gitAuthHeader()}`, 'fetch', 'origin', rel.base]));
      sha = (await ex.exec(repo, 1, ['git', 'rev-parse', `origin/${rel.base}`])).trim();
      await this.update(name, id, { sha });
      await L(`버전을 주지 않아 ${rel.base} 최신 커밋을 씁니다: ${sha.slice(0, 8)}`);
    }
    await this.runner.freshWorktree(ex, repo, jobs, wt, sha);

    const artifacts = [];
    try {
      // ── 프론트 ──
      if (r.include.front && r.front) {
        const fe = path.join(wt, r.front.dir || '.');
        await this.runner.prepareNodeModules(project, ex, wt, L, true);
        const env = { DEVLOOP_PREVIEW_BASE: r.frontBase, ...r.front.env };   // 플러그인이 이 변수로 base·publicPath 를 맞춘다
        await L(`프론트 빌드: ${r.front.build}  (publicPath ${r.frontBase})${r.buildOverridden.front ? '' : '  ⚠ 미리보기와 같은 명령 - 운영 프로파일인지 확인할 것'}`);
        const exportEnv = Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(v)};`).join(' ');
        await ex.sh(fe, this.cfg.server.verifyTimeoutMinutes || 20, `${exportEnv} ${r.front.build}`);
        const dist = path.join(fe, r.front.dist || 'dist');
        if (!fss.existsSync(path.join(dist, 'index.html'))) throw new Error(`프론트 빌드 결과에 index.html 이 없습니다: ${dist}`);
        await fs.cp(dist, path.join(out, 'front'), { recursive: true, dereference: true });
        artifacts.push({ kind: 'front', path: 'front/', note: `정적 파일 (publicPath ${r.frontBase}) — 빌드: ${r.front.build}` });
        await L('✓ 프론트');
      }
      // ── 백엔드 ──
      if (r.include.back && r.back) {
        const be = path.join(wt, r.back.dir || '.');
        await L(`백엔드 빌드: ${r.back.build}${r.buildOverridden.back ? '' : '  ⚠ 미리보기와 같은 명령 - 운영 프로파일인지 확인할 것'}`);
        const envArgs = Object.entries(r.back.env || {}).map(([k, v]) => `export ${k}=${JSON.stringify(v)};`).join(' ');
        await ex.sh(be, this.cfg.server.verifyTimeoutMinutes || 20, `${envArgs} ${r.back.build}`);
        const art = await this.versions.findArtifact(ex, be, r.back.artifact || 'build/libs/*.jar');
        if (!art) throw new Error(`실행 파일을 찾지 못했습니다: ${r.back.artifact}`);
        await fs.mkdir(path.join(out, 'back'), { recursive: true });
        await fs.copyFile(art, path.join(out, 'back', path.basename(art)));
        artifacts.push({ kind: 'back', path: `back/${path.basename(art)}`, note: `실행 파일 — 빌드: ${r.back.build}` });
        await L(`✓ 백엔드: ${path.basename(art)}`);
      }
      // ── DB ──
      let db = null;
      if (r.include.db && r.preview.db) db = await this.buildDb(project, id, ex, wt, out, r, L);

      // ── 노트·명세 ──
      const notes = await this.notes(project, id, { sha, base: rel.base, db, artifacts, r, ex, repo });
      await fs.writeFile(path.join(out, 'RELEASE.md'), notes, 'utf8');
      const manifest = {
        project: name, release: id, version: rel.version ?? null, sha, baseBranch: rel.base,
        label: rel.label || null, builtAt: nowIso(), kit: this.cfg.version || null,
        artifacts, db: db ? { ...db, baselineSnapshot: undefined } : null,
      };
      await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      const sums = await this.checksums(out);
      await fs.writeFile(path.join(out, 'CHECKSUMS.txt'), sums.text, 'utf8');

      // ── 묶기 ──
      const tar = this.tarPath(name, id);
      await fs.rm(tar, { force: true });
      await ex.exec(path.dirname(out), 10, ['tar', '-czf', tar, '-C', path.dirname(out), id]);
      const size = (await fs.stat(tar)).size;
      await L(`✓ 묶음: ${id}.tar.gz (${(size / 1048576).toFixed(1)} MB, 파일 ${sums.count}개)`);

      await this.update(name, id, { status: 'DONE', doneAt: nowIso(), seconds: Math.round((Date.now() - t0) / 1000), artifacts, db, sizeBytes: size, fileCount: sums.count });
      this.notifier?.send(project, 'release.done', {
        title: `배포판 ${id} 준비 완료${rel.version != null ? ` (v${rel.version})` : ''}`,
        lines: [db ? `DDL 적용 ${db.safeCount}건 · 확인 필요 ${db.reviewCount}건` : 'DB 변경 없음', `${(size / 1048576).toFixed(1)} MB`], level: 'ok',
      }).catch(() => {});
      await this.prune(project);
      return this.get(name, id);
    } finally {
      await this.runner.removeWorktree(ex, repo, wt);
    }
  }

  /**
   * 현재(보내는 쪽) DB 스키마를 뜬다 - 읽기만 한다.
   * 미리보기 레시피의 DB 컨테이너에서 psql 로 돌리고, container 가 비어 있고 host 가 있으면 직접 붙는다
   * (미리보기는 DB 사본을 떠야 해서 컨테이너가 필요하지만, 배포판은 스키마만 읽으면 되므로 관리형 DB 도 된다).
   */
  async snapshotLive(project, ex, cwd, r) {
    const d = r.preview.db;
    const sql = snapshotSql(r.schemas) + ';';
    const cmd = d.container
      ? ['docker', 'exec', '-i', d.container, 'psql', '-U', d.user, '-d', d.name, '-At', '-f', '-']
      : ['psql', '-h', d.host, '-p', String(d.port || 5432), '-U', d.user, '-d', d.name, '-At', '-f', '-'];
    if (!d.container && !d.host) throw new Error('DB 레시피에 container 도 host 도 없습니다');
    const out = await ex.exec(cwd, 3, cmd, { stdin: sql });
    const text = out.slice(out.indexOf('{'));          // psql 알림(NOTICE)이 앞에 붙는 경우
    return parseSnapshot(text);
  }

  /**
   * DB 부분: 스냅샷 → 비교 → DDL 두 파일 + 저장소 DDL 파일 교차 확인 + 다음 기준이 될 스냅샷.
   */
  async buildDb(project, id, ex, wt, out, r, L) {
    const dbDir = path.join(out, 'db');
    await fs.mkdir(dbDir, { recursive: true });
    await L(`DB 스키마 스냅샷: ${r.preview.db.name} (${r.preview.db.container})`);
    const next = await this.snapshotLive(project, ex, wt, r);
    const { snap: base, from, kind } = await this.baseline(project);
    await L(`기준(받는 쪽): ${from}`);

    const changes = diffSchema(base || { tables: [] }, next);
    const ddl = toDdl(changes, {
      title: `${project.name} 배포판 ${id}`,
      base: base || { database: '(기준 없음)', takenAt: null },
      next, kit: this.cfg.version || '', reviewFile: '02-확인필요.sql',
    });
    await fs.writeFile(path.join(dbDir, '01-적용.sql'), ddl.apply, 'utf8');
    await fs.writeFile(path.join(dbDir, '02-확인필요.sql'), ddl.review, 'utf8');
    await fs.writeFile(path.join(dbDir, '스키마-스냅샷.json'), JSON.stringify(next), 'utf8');
    await fs.writeFile(path.join(dbDir, '스냅샷-SQL.sql'), this.snapshotSqlFor(project), 'utf8');

    // 저장소에 커밋된 DDL 파일이 받는 쪽에 실제로 들어갔는지 - 사람이 깜빡한 것을 잡는다
    let unapplied = [];
    if (r.ddlGlob && base) {
      const files = (await ex.execOut(wt, 1, ['sh', '-c', `ls -1 ${r.ddlGlob} 2>/dev/null | head -200`])).trim().split('\n').filter(Boolean);
      const loaded = [];
      for (const f of files) {
        try { loaded.push({ path: f, content: await fs.readFile(path.join(wt, f), 'utf8') }); } catch { /* 건너뜀 */ }
      }
      unapplied = ddlFileCheck(loaded, base);
      await L(`저장소 DDL 파일 ${loaded.length}개 확인 - 받는 쪽에 안 들어간 것 ${unapplied.length}개`);
    }

    const warnings = changes.filter((c) => c.safe && c.warn).map((c) => `${changeLabel(c.kind)} ${c.key}: ${c.note}`);
    await L(`✓ DDL: 적용 ${ddl.safeCount}건 · 확인 필요 ${ddl.reviewCount}건`);
    return {
      baselineKind: kind, baselineFrom: from,
      database: next.database, server: next.server, takenAt: next.takenAt,
      snapshotFile: 'db/스키마-스냅샷.json',        // dir(project,id) 기준 상대 경로 - baseline() 이 이걸로 다시 읽는다
      counts: ddl.counts, safeCount: ddl.safeCount, reviewCount: ddl.reviewCount,
      warnings, unapplied,
      review: changes.filter((c) => !c.safe).map((c) => ({ kind: c.kind, key: c.key, note: c.note || null })),
    };
  }

  /** 릴리스 노트 - 무엇이 들어 있고, 받는 쪽에서 무엇을 해야 하는가 */
  async notes(project, id, { sha, base, db, artifacts, r, ex, repo }) {
    const rel = await this.get(project.name, id);
    const prev = (await this.list(project.name)).find((x) => x.status === 'DONE' && x.sha && x.sha !== sha);
    const lines = [];
    lines.push(`# ${project.name} 배포판 ${id}${rel.label ? ` — ${rel.label}` : ''}`, '');
    lines.push(`- 소스: \`${sha.slice(0, 12)}\` (${base}${rel.version != null ? `, 버전 v${rel.version}` : ''})`);
    lines.push(`- 만든 시각: ${nowIso()}`);
    if (prev) lines.push(`- 직전 배포판: ${prev.id} (\`${String(prev.sha).slice(0, 12)}\`)`);
    if (rel.note) lines.push('', rel.note);
    lines.push('', '## 들어 있는 것', '');
    for (const a of artifacts) lines.push(`- \`${a.path}\` — ${a.note}`);
    const notOverridden = [r.include.front && r.front && !r.buildOverridden.front ? '프론트' : null, r.include.back && r.back && !r.buildOverridden.back ? '백엔드' : null].filter(Boolean);
    if (notOverridden.length) lines.push('', `> ⚠ ${notOverridden.join('·')} 빌드 명령이 **미리보기와 같습니다**. 미리보기는 개발용 프로파일로 빌드합니다 —`,
      '> 운영에 넘길 것이면 프로젝트 설정 `release.front.build`·`release.back.build` 에 운영 프로파일 명령을 적고 다시 만드세요.');
    if (db) lines.push('- `db/01-적용.sql` — DB 스키마 적용 DDL', '- `db/02-확인필요.sql` — 사람이 보고 결정할 변경 (전부 주석)', '- `db/스키마-스냅샷.json` — 이 배포판 기준 스키마 (다음 배포판의 기준점)', '- `db/스냅샷-SQL.sql` — 받는 쪽 DB 스키마를 뜨는 SQL');

    if (db) {
      lines.push('', '## DB 스키마', '', `기준(받는 쪽): ${db.baselineFrom}`, `대상(보내는 쪽): ${db.database} @ ${String(db.server || '').split(' ')[0]}`, '');
      if (db.baselineKind === 'none') lines.push('> ⚠ 받는 쪽 기준 스냅샷이 없어 **전체 스키마**를 만드는 DDL 이다. 이미 쓰고 있는 DB 에 올린다면', '> `db/스냅샷-SQL.sql` 을 그 DB 에 돌려 결과를 콘솔에 올린 뒤 배포판을 다시 만들 것.', '');
      const rows = Object.entries(db.counts).sort((a, b) => b[1] - a[1]);
      if (rows.length) { lines.push('| 변경 | 건수 |', '| --- | --- |'); for (const [k, v] of rows) lines.push(`| ${changeLabel(k)} | ${v} |`); lines.push(''); }
      lines.push(`적용 ${db.safeCount}건 / 확인 필요 ${db.reviewCount}건`, '');
      lines.push('적용 방법 — 되돌릴 수 있게 트랜잭션으로 감싸 두었다. 여러 번 실행해도 결과는 같다:', '', '```sh', 'psql -h <호스트> -U <계정> -d <DB> -v ON_ERROR_STOP=1 -f db/01-적용.sql', '```', '');
      if (db.warnings.length) { lines.push('### 적용 전에 볼 것', ''); for (const w of db.warnings) lines.push(`- ${w}`); lines.push(''); }
      if (db.reviewCount) {
        lines.push('### 확인 필요 (적용되지 않음)', '', '받는 쪽에서 지워지거나 좁혀지는 변경이다. 보내는 쪽에 없다는 것이 "지워야 한다" 는 뜻은 아니다 —', '받는 쪽의 운영 데이터일 수 있으니 하나씩 보고 필요한 것만 `db/02-확인필요.sql` 에서 주석을 풀 것.', '');
        for (const c of db.review.slice(0, 40)) lines.push(`- ${changeLabel(c.kind)} \`${c.key}\`${c.note ? ` — ${c.note}` : ''}`);
        if (db.review.length > 40) lines.push(`- … 그 외 ${db.review.length - 40}건 (\`db/02-확인필요.sql\` 참고)`);
        lines.push('');
      }
      if (db.unapplied.length) {
        lines.push('### 저장소 DDL 파일인데 받는 쪽에 안 들어간 것', '', '저장소에 커밋된 DDL 파일을 이름으로 훑어 본 결과다(SQL 을 해석하지는 않는다).', '`01-적용.sql` 이 같은 것을 담고 있으면 그것으로 해결된다.', '');
        for (const u of db.unapplied) lines.push(`- \`${u.file}\`: ${u.missing.map((m) => `${m.what === 'table' ? '테이블' : '열'} ${m.name}`).join(', ')}`);
        lines.push('');
      }
    }

    // 직전 배포판 이후의 소스 변경
    if (prev?.sha) {
      const stat = await ex.execOut(repo, 2, ['git', 'diff', '--stat=100', `${prev.sha}..${sha}`]);
      const log = await ex.execOut(repo, 2, ['git', 'log', '--no-merges', '--pretty=- %s', `${prev.sha}..${sha}`]);
      if (log.trim()) lines.push('## 직전 배포판 이후 변경', '', log.trim().split('\n').slice(0, 80).join('\n'), '');
      if (stat.trim()) lines.push('<details><summary>파일 변경</summary>', '', '```', stat.trim().split('\n').slice(-60).join('\n'), '```', '', '</details>', '');
    }
    lines.push('---', '', `DevLoop ${this.cfg.version || ''} 가 만들었다.`, '');
    return lines.join('\n');
  }

  /** 파일별 sha256 - 받는 쪽이 전송 사고를 확인할 수 있게 */
  async checksums(root) {
    const rows = [];
    const walk = async (dir) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && e.name !== 'CHECKSUMS.txt') {
          const h = crypto.createHash('sha256');
          h.update(await fs.readFile(p));
          rows.push(`${h.digest('hex')}  ${path.relative(root, p)}`);
        }
      }
    };
    await walk(root);
    rows.sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
    return { text: rows.join('\n') + '\n', count: rows.length };
  }

  /** 오래된 배포판 정리 - 빌드 산출물이 크니 keep 개만 둔다(기록은 남긴다) */
  async prune(project) {
    const r = this.recipe(project);
    const done = (await this.list(project.name)).filter((x) => x.status === 'DONE');
    for (const x of done.slice(r.keep)) {
      if (x.pruned) continue;
      // 큰 것만 지운다 - db/(스냅샷·DDL)와 노트는 남긴다. 스냅샷을 지우면 다음 배포판의 기준점이 끊긴다.
      for (const sub of ['front', 'back']) await fs.rm(path.join(this.dir(project.name, x.id), sub), { recursive: true, force: true }).catch(() => {});
      await fs.rm(this.tarPath(project.name, x.id), { force: true }).catch(() => {});
      await this.update(project.name, x.id, { pruned: true, prunedAt: nowIso() });
      this.log.info(`[release ${project.name}] 오래된 배포판의 빌드 산출물 정리: ${x.id} (최근 ${r.keep}개만 둔다 · DDL·스냅샷은 남김)`);
    }
  }

  async remove(project, id) {
    await fs.rm(this.dir(project.name, id), { recursive: true, force: true }).catch(() => {});
    await fs.rm(this.tarPath(project.name, id), { force: true }).catch(() => {});
    await this.save(project.name, (c) => ({ ...c, releases: c.releases.filter((x) => String(x.id) !== String(id)) }));
  }

  /** 묶음 파일 하나를 읽을 수 있는 스트림으로 */
  async fileOf(project, id, rel) {
    const r = await this.get(project.name, id);
    if (!r) throw Object.assign(new Error('없는 배포판'), { status: 404 });
    const p = rel ? path.join(this.dir(project.name, id), rel) : this.tarPath(project.name, id);
    const root = rel ? this.dir(project.name, id) : path.dirname(this.tarPath(project.name, id));
    if (!path.resolve(p).startsWith(path.resolve(root))) throw Object.assign(new Error('잘못된 경로'), { status: 400 });
    if (!fss.existsSync(p)) throw Object.assign(new Error(r.pruned ? '오래돼 정리된 배포판입니다 - 다시 만드세요' : '파일이 없습니다'), { status: 404 });
    return p;
  }

  /** 재시작으로 끊긴 것은 실패로 - 빌드는 이어갈 수 없다(산출물이 반쯤 남아 있다) */
  async resetInterrupted() {
    for (const name of Object.keys(this.cfg.projects)) {
      const st = await this.state(name);
      for (const x of st.releases) {
        if (['QUEUED', 'BUILDING'].includes(x.status)) await this.update(name, x.id, { status: 'FAILED', error: '서버 재시작으로 끊김 - 다시 만드세요' });
      }
    }
  }

  router() {
    const r = express.Router();
    return r;
  }
}
