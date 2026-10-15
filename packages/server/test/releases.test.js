import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Releases } from '../src/releases.js';

const quiet = { info() {}, warn() {}, error() {} };

async function fixture({ release = {}, preview = { db: { container: 'c', name: 'n', user: 'u' } } } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devloop-rel-'));
  const project = { name: 'demo', baseBranch: 'main', modules: [], env: {}, release };
  const cfg = { version: 'v0.0.0', server: { dataDir, workDir: path.join(dataDir, 'work') }, projects: { demo: project } };
  const rel = new Releases(cfg, null, {}, { recipe: () => preview }, quiet);
  return { rel, project, dataDir };
}

const SNAP = (over = {}) => ({ version: 1, takenAt: '2026-10-15T00:00:00Z', database: 'db', server: '13.3', tables: [{ schema: 'public', name: 't' }], columns: [], constraints: [], indexes: [], views: [], functions: [], triggers: [], sequences: [], enums: [], extensions: [], ...over });

test('배포판 설정은 미리보기 레시피를 받아쓰고 다른 점만 덮는다', async () => {
  const { rel, project } = await fixture({ release: { frontBase: '/app/', keep: 2, include: { db: false } }, preview: { front: { dir: 'fe' }, back: { dir: 'be' }, db: { container: 'c' } } });
  const r = rel.recipe(project);
  assert.equal(r.frontBase, '/app/');
  assert.equal(r.keep, 2);
  assert.deepEqual(r.include, { front: true, back: true, db: false });   // db 만 끔
  assert.deepEqual(r.schemas, ['public']);
  assert.equal(r.preview.front.dir, 'fe');
});

test('미리보기 레시피가 없으면 배포판을 시작할 수 없다', async () => {
  const { rel, project } = await fixture({ preview: null });
  await assert.rejects(() => rel.start(project, {}), (e) => e.status === 409 && /레시피/.test(e.message));
});

test('기준 스냅샷: 올린 것 → 직전 배포판 → 없음 순으로 찾는다', async () => {
  const { rel, project, dataDir } = await fixture();
  assert.equal((await rel.baseline(project)).kind, 'none');

  // 직전 배포판이 담은 스냅샷
  await rel.save('demo', (c) => ({ ...c, seq: 1, releases: [{ id: 'r001', status: 'DONE', createdAt: '2026-10-01', db: { snapshotFile: 'db/스키마-스냅샷.json' } }] }));
  await fs.mkdir(path.join(dataDir, 'demo', 'releases', 'r001', 'db'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'demo', 'releases', 'r001', 'db', '스키마-스냅샷.json'), JSON.stringify(SNAP({ database: 'from-release' })));
  const prev = await rel.baseline(project);
  assert.equal(prev.kind, 'previous');
  assert.equal(prev.snap.database, 'from-release');

  // 사람이 올린 것이 있으면 그것이 먼저
  await rel.saveBaseline(project, JSON.stringify(SNAP({ database: 'uploaded' })));
  const up = await rel.baseline(project);
  assert.equal(up.kind, 'upload');
  assert.equal(up.snap.database, 'uploaded');
});

test('기준 스냅샷 저장은 형식을 먼저 확인한다 (엉뚱한 파일로 기준이 망가지지 않게)', async () => {
  const { rel, project, dataDir } = await fixture();
  await assert.rejects(() => rel.saveBaseline(project, '{"hello":1}'), (e) => e.status === 400);
  await assert.rejects(() => fs.access(rel.baselineFile('demo')));         // 파일이 만들어지지 않았다
  assert.equal((await rel.state('demo')).baseline, undefined);
  assert.ok(dataDir);
});

test('묶음 안 파일 읽기는 디렉터리 밖으로 못 나간다', async () => {
  const { rel, project, dataDir } = await fixture();
  await rel.save('demo', (c) => ({ ...c, seq: 1, releases: [{ id: 'r001', status: 'DONE' }] }));
  await fs.mkdir(path.join(dataDir, 'demo', 'releases', 'r001'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'demo', 'releases', 'r001', 'RELEASE.md'), '# ok');
  assert.match(await rel.fileOf(project, 'r001', 'RELEASE.md'), /r001\/RELEASE\.md$/);
  await assert.rejects(() => rel.fileOf(project, 'r001', '../../../../etc/passwd'), (e) => e.status === 400);
  await assert.rejects(() => rel.fileOf(project, 'r999', null), (e) => e.status === 404);
});

test('스냅샷 SQL 은 설정한 스키마를 담고 psql 로 바로 돌릴 수 있다', async () => {
  const { rel, project } = await fixture({ release: { schemas: ['public', 'app'] } });
  const sql = rel.snapshotSqlFor(project);
  assert.match(sql, /psql .* -At -f/);
  assert.match(sql, /'public','app'/);
  assert.match(sql, /대상 스키마: public, app/);
});

test('컨테이너도 host 도 없으면 스냅샷을 뜨지 않고 알려준다', async () => {
  const { rel, project } = await fixture({ preview: { db: { name: 'n', user: 'u' } } });
  await assert.rejects(() => rel.snapshotLive(project, null, '/tmp', rel.recipe(project)), /container 도 host 도 없습니다/);
});

test('재시작으로 끊긴 배포판은 실패로 정리한다 (반쯤 묶인 것을 이어가지 않게)', async () => {
  const { rel } = await fixture();
  await rel.save('demo', (c) => ({ ...c, seq: 2, releases: [{ id: 'r001', status: 'BUILDING' }, { id: 'r002', status: 'DONE' }] }));
  await rel.resetInterrupted();
  const st = await rel.state('demo');
  assert.equal(st.releases.find((x) => x.id === 'r001').status, 'FAILED');
  assert.equal(st.releases.find((x) => x.id === 'r002').status, 'DONE');
});

test('배포판 전용 빌드 명령이 미리보기를 덮고, 안 적으면 표시가 남는다', async () => {
  const pv = { front: { dir: 'fe', build: 'npm run build-develop', dist: 'dist', env: { API: '{backUrl}', KEEP: 'x' } }, back: { dir: 'be', build: './gradlew bootWar -Pprofile=develop' }, db: { container: 'c' } };
  // 안 적은 경우: 미리보기 명령을 쓰지만 buildOverridden 으로 알린다
  const a = await fixture({ preview: pv });
  const ra = a.rel.recipe(a.project);
  assert.equal(ra.front.build, 'npm run build-develop');
  assert.deepEqual(ra.buildOverridden, { front: false, back: false });
  assert.deepEqual(ra.front.env, { KEEP: 'x' });                      // {backUrl} 같은 미리보기 값은 들고 가지 않는다

  // 적은 경우: 운영 프로파일 명령으로 바뀐다
  const b = await fixture({ preview: pv, release: { front: { build: 'npx vue-cli-service build --mode product' }, back: { build: './gradlew bootWar -Pprofile=product' } } });
  const rb = b.rel.recipe(b.project);
  assert.equal(rb.front.build, 'npx vue-cli-service build --mode product');
  assert.equal(rb.back.build, './gradlew bootWar -Pprofile=product');
  assert.equal(rb.front.dir, 'fe');                                   // 안 덮은 값은 미리보기 것을 그대로
  assert.deepEqual(rb.buildOverridden, { front: true, back: true });
});

test('묶을 것이 하나도 없으면 시작하지 않는다', async () => {
  const { rel, project } = await fixture({ preview: null, release: { include: { db: false } } });
  await assert.rejects(() => rel.start(project, {}), (e) => e.status === 409 && /묶을 것이 없습니다/.test(e.message));
});

// ── 소스 기준: 킷을 거치지 않고 기준 브랜치에 직접 푸시된 작업이 빠지지 않게 ──
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
/** 실제 git 저장소로 재는 부분이라 작은 ex 어댑터를 쓴다 */
const gitEx = {
  exec: async (cwd, _m, cmd) => (await run(cmd[0], cmd.slice(1), { cwd })).stdout,
  execOut: async (cwd, _m, cmd) => { try { return (await run(cmd[0], cmd.slice(1), { cwd })).stdout; } catch { return ''; } },
  execRc: async (cwd, _m, cmd) => { try { await run(cmd[0], cmd.slice(1), { cwd }); return 0; } catch { return 1; } },
};

async function repoWithBranch() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devloop-git-'));
  const g = (...a) => run('git', a, { cwd: dir });
  await g('init', '-q', '-b', 'main');
  await g('config', 'user.email', 't@t'); await g('config', 'user.name', '팀원');
  await fs.writeFile(path.join(dir, 'a'), '1'); await g('add', '-A'); await g('commit', '-qm', 'base');
  // 킷이 만든 커밋(버전) - 아직 main 에 안 들어감
  await g('checkout', '-q', '-b', 'claude/devloop-1');
  await fs.writeFile(path.join(dir, 'b'), '1'); await g('add', '-A'); await g('commit', '-qm', 'kit fix');
  const kitSha = (await g('rev-parse', 'HEAD')).stdout.trim();
  // 그 사이 사람이 main 에 직접 푸시
  await g('checkout', '-q', 'main');
  await fs.writeFile(path.join(dir, 'c'), '1'); await g('add', '-A'); await g('commit', '-qm', 'team push');
  const mainSha = (await g('rev-parse', 'HEAD')).stdout.trim();
  return { dir, kitSha, mainSha, g };
}

test('기준 브랜치에 안 들어간 소스는 onBase=false - 묶으면 다른 작업이 빠진다', async () => {
  const { rel, project } = await fixture();
  const { dir, kitSha, mainSha } = await repoWithBranch();
  const src = await rel.sourceBase(gitEx, dir, kitSha, 'main', mainSha);
  assert.equal(src.onBase, false);
  assert.equal(src.sameAsBase, false);
  assert.ok(project);
});

test('기준 브랜치 최신이면 sameAsBase - 직접 푸시된 작업까지 들어 있다', async () => {
  const { rel } = await fixture();
  const { dir, mainSha } = await repoWithBranch();
  const src = await rel.sourceBase(gitEx, dir, mainSha, 'main', mainSha);
  assert.equal(src.onBase, true);
  assert.equal(src.sameAsBase, true);
  assert.equal(src.behind, 0);
});

test('병합됐지만 뒤처진 소스는 빠지는 커밋 수와 작성자를 알려준다', async () => {
  const { rel } = await fixture();
  const { dir, mainSha, g } = await repoWithBranch();
  const older = (await g('rev-parse', 'HEAD~1')).stdout.trim();
  const src = await rel.sourceBase(gitEx, dir, older, 'main', mainSha);
  assert.equal(src.onBase, true);
  assert.equal(src.sameAsBase, false);
  assert.equal(src.behind, 1);
  assert.deepEqual(src.behindAuthors, ['팀원']);
});
