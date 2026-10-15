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
