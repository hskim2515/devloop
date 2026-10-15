/**
 * DB 스키마 스냅샷과 DDL 생성.
 *
 * <p>왜 필요한가 - 배포판을 넘길 때 소스는 git 이 추적하지만 DB 스키마는 아무도 추적하지 않는다.
 * 그래서 "운영에는 있고 개발에는 없는 컬럼" 이 생기고(실측: lhdt 의 user_group.teneleven_id),
 * 새 테이블 DDL 을 사람이 깜빡하면 배포 직후 500 이 난다(실측: district_request).
 * 여기서 두 DB 의 스키마를 비교해 받는 쪽이 그대로 실행할 수 있는 DDL 을 만든다.
 *
 * <p>설계 두 가지:
 * ① 스냅샷은 **psql 한 번으로 끝나는 SQL 한 문장**이다. 키트가 docker exec 로 뜨는 것과
 *    운영 담당자가 손으로 뜨는 것이 같은 파일이어야 기준점(baseline)을 주고받을 수 있다.
 * ② 생성한 DDL 은 **만들고 더하는 것만** 자동 적용 파일에 넣는다. 지우고 좁히는 것(DROP,
 *    타입 변경, NOT NULL 추가)은 주석으로만 내보낸다 - 조용히 데이터를 잃는 쪽보다
 *    "사람이 봐야 한다" 고 말하는 쪽이 낫다.
 */

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ident = (s) => (/^[a-z_][a-z0-9_$]*$/.test(s) && !RESERVED.has(s) ? s : `"${String(s).replace(/"/g, '""')}"`);
const RESERVED = new Set(['user', 'order', 'group', 'table', 'column', 'select', 'from', 'where', 'default', 'check', 'end', 'desc', 'asc', 'all', 'and', 'or', 'not', 'null', 'to', 'in', 'is', 'as', 'on', 'references', 'primary', 'foreign', 'unique', 'constraint', 'create', 'offset', 'limit', 'window', 'authorization']);
const qname = (schema, name) => `${ident(schema)}.${ident(name)}`;

/**
 * 스냅샷 SQL - `psql -At -f snapshot.sql` 이 JSON 한 덩이를 낸다.
 * 확장(PostGIS 등)이 설치한 객체는 pg_depend 로 전부 걸러낸다 - 안 걸러내면 함수 수천 개가 들어온다.
 */
export function snapshotSql(schemas = ['public']) {
  const S = `(${schemas.map(q).join(',')})`;
  // 확장이 소유한 객체(oid)는 비교 대상이 아니다
  const notExt = (col) => `not exists (select 1 from pg_depend dp where dp.objid = ${col} and dp.deptype = 'e')`;
  return `select json_build_object(
  'version',   1,
  'takenAt',   to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database',  current_database(),
  'server',    (select setting from pg_settings where name = 'server_version'),
  'schemas',   (select json_agg(x) from (select unnest(array${S.replace('(', '[').replace(/\)$/, ']')}) as s) x),
  'extensions', coalesce((select json_agg(json_build_object('name', e.extname, 'version', e.extversion) order by e.extname) from pg_extension e where e.extname <> 'plpgsql'), '[]'::json),
  'enums',     coalesce((select json_agg(x order by x->>'name') from (
       select json_build_object('schema', n.nspname, 'name', t.typname,
              'labels', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)) as x
       from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where t.typtype = 'e' and n.nspname in ${S} and ${notExt('t.oid')}) x), '[]'::json),
  'sequences', coalesce((select json_agg(x order by x->>'name') from (
       select json_build_object('schema', n.nspname, 'name', c.relname,
              'ownedBy', (select cc.relname || '.' || a.attname from pg_depend d
                            join pg_class cc on cc.oid = d.refobjid
                            join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
                          where d.objid = c.oid and d.deptype in ('a','i') limit 1),
              -- deptype 'i' = identity 열이 암시적으로 만든 시퀀스 (serial 은 'a')
              'implicit', exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'i')) as x
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'S' and n.nspname in ${S} and ${notExt('c.oid')}) x), '[]'::json),
  'tables',    coalesce((select json_agg(x order by x->>'name') from (
       select json_build_object('schema', n.nspname, 'name', c.relname,
              'kind', case c.relkind when 'p' then 'partitioned' else 'table' end,
              'partkey', case when c.relkind = 'p' then pg_get_partkeydef(c.oid) end,
              'comment', obj_description(c.oid, 'pg_class')) as x
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r','p') and c.relpersistence = 'p' and n.nspname in ${S} and ${notExt('c.oid')}
         and not exists (select 1 from pg_inherits i where i.inhrelid = c.oid)) x), '[]'::json),
  'columns',   coalesce((select json_agg(x order by x->>'table', (x->>'num')::int) from (
       select json_build_object('schema', n.nspname, 'table', c.relname, 'name', a.attname, 'num', a.attnum,
              'type', format_type(a.atttypid, a.atttypmod),
              'notnull', a.attnotnull,
              'default', pg_get_expr(d.adbin, d.adrelid),
              'identity', nullif(a.attidentity, ''),
              'generated', nullif(a.attgenerated, ''),
              'collation', (select cl.collname from pg_collation cl where cl.oid = a.attcollation and cl.collname <> 'default'),
              'comment', col_description(c.oid, a.attnum)) as x
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
       where a.attnum > 0 and not a.attisdropped and c.relkind in ('r','p') and c.relpersistence = 'p'
         and n.nspname in ${S} and ${notExt('c.oid')}
         and not exists (select 1 from pg_inherits i where i.inhrelid = c.oid)) x), '[]'::json),
  'constraints', coalesce((select json_agg(x order by x->>'table', x->>'name') from (
       select json_build_object('schema', n.nspname, 'table', c.relname, 'name', con.conname,
              'type', con.contype, 'def', pg_get_constraintdef(con.oid)) as x
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ${S} and c.relkind in ('r','p') and ${notExt('con.oid')}) x), '[]'::json),
  'indexes',   coalesce((select json_agg(x order by x->>'table', x->>'name') from (
       select json_build_object('schema', i.schemaname, 'table', i.tablename, 'name', i.indexname, 'def', i.indexdef) as x
       from pg_indexes i
       join pg_class ic on ic.relname = i.indexname
       join pg_namespace ins on ins.oid = ic.relnamespace and ins.nspname = i.schemaname
       where i.schemaname in ${S} and ${notExt('ic.oid')}
         and not exists (select 1 from pg_constraint con where con.conindid = ic.oid)) x), '[]'::json),
  'views',     coalesce((select json_agg(x order by x->>'name') from (
       select json_build_object('schema', n.nspname, 'name', c.relname, 'matview', c.relkind = 'm',
              'def', pg_get_viewdef(c.oid, true), 'comment', obj_description(c.oid, 'pg_class')) as x
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('v','m') and n.nspname in ${S} and ${notExt('c.oid')}) x), '[]'::json),
  'functions', coalesce((select json_agg(x order by x->>'name', x->>'args') from (
       select json_build_object('schema', n.nspname, 'name', p.proname,
              'args', pg_get_function_identity_arguments(p.oid),
              'def', pg_get_functiondef(p.oid)) as x
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ${S} and ${notExt('p.oid')} and p.prokind in ('f','p')) x), '[]'::json),
  'triggers',  coalesce((select json_agg(x order by x->>'table', x->>'name') from (
       select json_build_object('schema', n.nspname, 'table', c.relname, 'name', t.tgname,
              'def', pg_get_triggerdef(t.oid, true)) as x
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal and n.nspname in ${S} and ${notExt('t.oid')}) x), '[]'::json)
)::text`;
}

// ── 스냅샷 읽기 ────────────────────────────────────────────────────────────
export function parseSnapshot(text) {
  const raw = typeof text === 'string' ? JSON.parse(text) : text;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tables)) throw Object.assign(new Error('스키마 스냅샷 형식이 아닙니다 (tables 가 없음) - 스냅샷 SQL 의 출력 그대로 올려 주세요'), { status: 400 });
  const s = { version: 1, extensions: [], enums: [], sequences: [], tables: [], columns: [], constraints: [], indexes: [], views: [], functions: [], triggers: [], ...raw };
  for (const k of ['extensions', 'enums', 'sequences', 'tables', 'columns', 'constraints', 'indexes', 'views', 'functions', 'triggers']) s[k] = s[k] || [];
  return s;
}

const byKey = (rows, key) => { const m = new Map(); for (const r of rows) m.set(key(r), r); return m; };
const K = {
  table: (r) => `${r.schema}.${r.name}`,
  column: (r) => `${r.schema}.${r.table}.${r.name}`,
  constraint: (r) => `${r.schema}.${r.table}.${r.name}`,
  index: (r) => `${r.schema}.${r.name}`,
  view: (r) => `${r.schema}.${r.name}`,
  func: (r) => `${r.schema}.${r.name}(${r.args || ''})`,
  trigger: (r) => `${r.schema}.${r.table}.${r.name}`,
  sequence: (r) => `${r.schema}.${r.name}`,
  enum: (r) => `${r.schema}.${r.name}`,
  ext: (r) => r.name,
};

/** 열 정의 한 줄 (CREATE TABLE 안·ADD COLUMN 뒤에 공용) */
function colDef(c) {
  let s = `${ident(c.name)} ${c.type}`;
  if (c.collation) s += ` COLLATE ${ident(c.collation)}`;
  if (c.generated === 's' && c.default) s += ` GENERATED ALWAYS AS (${c.default}) STORED`;
  else if (c.identity) s += ` GENERATED ${c.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
  else if (c.default != null) s += ` DEFAULT ${c.default}`;
  if (c.notnull && c.generated !== 's') s += ' NOT NULL';
  return s;
}
/** 여러 줄 정의 비교·출력 정규화 - 줄끝 CRLF 와 꼬리 공백은 뜻이 없다(운영 함수 본문이 CRLF 로 들어가 있던 실측 사례) */
const normDef = (s) => String(s ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
/**
 * 비교용 느슨한 정규화. 같은 제약·인덱스를 PostgreSQL 주 버전마다 다르게 출력한다
 * (실측 13 ↔ 17: `(ARRAY['A'::varchar])::text[]` vs `ARRAY[('A'::varchar)::text]`,
 * 파티션 테이블 인덱스의 `ON ONLY`). 뜻이 같은 것을 '변경' 으로 내보내면 확인 파일이
 * 쓸모없는 줄로 차서, 괄호·형변환·공백만 다른 경우는 같다고 본다.
 */
const looseDef = (s) => String(s ?? '')
  .replace(/\bON ONLY\b/g, 'ON')
  .replace(/::(?:character varying|varchar|bpchar|text)(\[\])?/g, '')
  .replace(/[()\[\],\s]+/g, ' ')
  .trim().toLowerCase();
const sameDef = (a, b) => a === b || looseDef(a) === looseDef(b);
const commentOn = (what, target, text) => `COMMENT ON ${what} ${target} IS ${text == null ? 'NULL' : q(text)};`;
/** 이미 있으면 건너뛰는 틀 - 받는 쪽이 몇 번 실행해도 같은 결과여야 한다 */
const guard = (cond, body) => `DO $$ BEGIN\n  IF NOT EXISTS (${cond}) THEN\n${body.map((l) => '    ' + l).join('\n')}\n  END IF;\nEND $$;`;

/**
 * base(받는 쪽) → next(보내는 쪽) 로 맞추는 변경 목록.
 * safe=true 는 만들거나 더하는 것(자동 적용), false 는 지우거나 좁히는 것(사람 확인).
 */
export function diffSchema(baseRaw, nextRaw) {
  const base = parseSnapshot(baseRaw), next = parseSnapshot(nextRaw);
  const out = [];
  const add = (kind, key, safe, sql, note = null, extra = {}) => out.push({ kind, key, safe, sql: Array.isArray(sql) ? sql : [sql], note, ...extra });

  // 확장 · 타입 · 시퀀스
  const bExt = byKey(base.extensions, K.ext);
  for (const e of next.extensions) {
    if (bExt.has(K.ext(e))) continue;
    // 확장은 OS 패키지가 깔려 있어야 생긴다(실측: 운영에 pgrouting 없음). 없다고 나머지 DDL 까지
    // 멈추면 안 되니 경고만 내고 지나간다 - 그 확장을 쓰는 기능은 못 쓴다는 것을 리포트에 남긴다.
    add('extension.add', e.name, true,
      `DO $$ BEGIN\n  CREATE EXTENSION IF NOT EXISTS ${ident(e.name)};\nEXCEPTION WHEN OTHERS THEN\n  RAISE WARNING '확장 ${e.name} 을 설치하지 못했습니다 (%) - OS 패키지가 필요하다. 이 확장을 쓰는 기능은 동작하지 않는다.', SQLERRM;\nEND $$;`,
      'OS 패키지가 없으면 경고만 내고 지나간다', { warn: true });
  }

  const bEnum = byKey(base.enums, K.enum);
  for (const e of next.enums) {
    const b = bEnum.get(K.enum(e));
    const t = qname(e.schema, e.name);
    if (!b) add('enum.add', K.enum(e), true, guard(`select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname=${q(e.schema)} and t.typname=${q(e.name)}`,
      [`CREATE TYPE ${t} AS ENUM (${(e.labels || []).map(q).join(', ')});`]));
    else {
      const have = new Set(b.labels || []);
      for (const l of e.labels || []) if (!have.has(l)) add('enum.value.add', `${K.enum(e)}:${l}`, true, `ALTER TYPE ${t} ADD VALUE IF NOT EXISTS ${q(l)};`);
      const gone = (b.labels || []).filter((l) => !(e.labels || []).includes(l));
      if (gone.length) add('enum.value.remove', K.enum(e), false, `-- ${t} 에서 ${gone.join(', ')} 가 없어졌다 (enum 값은 지울 수 없다 - 타입을 다시 만들어야 한다)`);
    }
  }

  const nextCols = byKey(next.columns, K.column);
  const bSeq = byKey(base.sequences, K.sequence);
  for (const s of next.sequences) {
    if (bSeq.has(K.sequence(s))) continue;
    // identity 열(GENERATED AS IDENTITY)의 시퀀스는 CREATE TABLE 이 암시적으로 만든다.
    // 여기서 또 만들면 이름이 겹쳐 PostgreSQL 이 <이름>_seq1 을 따로 만든다(실측).
    if (s.implicit) continue;
    if (s.ownedBy) {
      const [ot, oc] = String(s.ownedBy).split('.');
      if (nextCols.get(`${s.schema}.${ot}.${oc}`)?.identity) continue;
    }
    // CREATE 는 테이블보다 먼저(열 기본값이 nextval 을 참조한다), OWNED BY 는 테이블보다 나중에
    add('sequence.add', K.sequence(s), true, `CREATE SEQUENCE IF NOT EXISTS ${qname(s.schema, s.name)};`);
    if (s.ownedBy) {
      const [t, c] = String(s.ownedBy).split('.');
      if (nextCols.has(`${s.schema}.${t}.${c}`)) add('sequence.owner', K.sequence(s), true, `ALTER SEQUENCE ${qname(s.schema, s.name)} OWNED BY ${qname(s.schema, t)}.${ident(c)};`, null, { silent: true });
    }
  }
  for (const s of base.sequences) if (!s.implicit && !byKey(next.sequences, K.sequence).has(K.sequence(s))) add('sequence.remove', K.sequence(s), false, `DROP SEQUENCE IF EXISTS ${qname(s.schema, s.name)};`);

  // 함수 (pg_get_functiondef 는 그대로 CREATE OR REPLACE 다)
  const bFn = byKey(base.functions, K.func), nFn = byKey(next.functions, K.func);
  for (const f of next.functions) {
    const b = bFn.get(K.func(f));
    const def = normDef(f.def).replace(/;?$/, ';');
    if (!b) add('function.add', K.func(f), true, def);
    else if (normDef(b.def) !== normDef(f.def)) add('function.change', K.func(f), true, def);
  }
  for (const f of base.functions) if (!nFn.has(K.func(f))) add('function.remove', K.func(f), false, `DROP FUNCTION IF EXISTS ${qname(f.schema, f.name)}(${f.args || ''});`);

  // 테이블 · 열
  const bTab = byKey(base.tables, K.table), nTab = byKey(next.tables, K.table);
  const newTables = new Set();
  for (const t of next.tables) {
    if (bTab.has(K.table(t))) continue;
    newTables.add(K.table(t));
    const cols = next.columns.filter((c) => c.schema === t.schema && c.table === t.name);
    const part = t.kind === 'partitioned' && t.partkey ? ` PARTITION BY ${t.partkey}` : '';
    const sql = [`CREATE TABLE IF NOT EXISTS ${qname(t.schema, t.name)} (\n${cols.map((c) => '    ' + colDef(c)).join(',\n')}\n)${part};`];
    if (t.comment) sql.push(commentOn('TABLE', qname(t.schema, t.name), t.comment));
    for (const c of cols) if (c.comment) sql.push(commentOn('COLUMN', `${qname(t.schema, t.name)}.${ident(c.name)}`, c.comment));
    add('table.add', K.table(t), true, sql, `열 ${cols.length}개`);
  }
  for (const t of base.tables) if (!nTab.has(K.table(t))) add('table.remove', K.table(t), false, `DROP TABLE IF EXISTS ${qname(t.schema, t.name)};`);

  const bCols = byKey(base.columns, K.column);
  for (const c of next.columns) {
    if (newTables.has(`${c.schema}.${c.table}`)) continue;           // CREATE TABLE 이 이미 담았다
    if (!nTab.has(`${c.schema}.${c.table}`) || !bTab.has(`${c.schema}.${c.table}`)) continue;
    const t = qname(c.schema, c.table), b = bCols.get(K.column(c));
    if (!b) {
      const risky = c.notnull && c.default == null && !c.identity && c.generated !== 's';
      const sql = [`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${colDef(c)};`];
      if (c.comment) sql.push(commentOn('COLUMN', `${t}.${ident(c.name)}`, c.comment));
      add('column.add', K.column(c), true, sql, risky ? '기존 행이 있으면 NOT NULL 때문에 실패한다 - 값을 채운 뒤 SET NOT NULL 로 나누어 적용할 것' : null, { warn: risky });
      continue;
    }
    if (b.type !== c.type) add('column.type', K.column(c), false, `ALTER TABLE ${t} ALTER COLUMN ${ident(c.name)} TYPE ${c.type};`, `${b.type} → ${c.type}`);
    if (!b.notnull && c.notnull) add('column.notnull.on', K.column(c), false, `ALTER TABLE ${t} ALTER COLUMN ${ident(c.name)} SET NOT NULL;`, 'NULL 인 행이 있으면 실패한다');
    if (b.notnull && !c.notnull) add('column.notnull.off', K.column(c), true, `ALTER TABLE ${t} ALTER COLUMN ${ident(c.name)} DROP NOT NULL;`);
    if (String(b.default ?? '') !== String(c.default ?? '') && c.generated !== 's' && !c.identity)
      add('column.default', K.column(c), true, c.default == null
        ? `ALTER TABLE ${t} ALTER COLUMN ${ident(c.name)} DROP DEFAULT;`
        : `ALTER TABLE ${t} ALTER COLUMN ${ident(c.name)} SET DEFAULT ${c.default};`, `${b.default ?? '(없음)'} → ${c.default ?? '(없음)'}`);
    if (String(b.comment ?? '') !== String(c.comment ?? ''))
      add('comment.change', K.column(c), true, commentOn('COLUMN', `${t}.${ident(c.name)}`, c.comment));
  }
  for (const c of base.columns) {
    if (!nTab.has(`${c.schema}.${c.table}`) || !bTab.has(`${c.schema}.${c.table}`)) continue;   // 테이블 자체가 사라진 건 위에서
    if (!nextCols.has(K.column(c))) add('column.remove', K.column(c), false, `ALTER TABLE ${qname(c.schema, c.table)} DROP COLUMN IF EXISTS ${ident(c.name)};`);
  }
  for (const t of next.tables) {
    const b = bTab.get(K.table(t));
    if (b && String(b.comment ?? '') !== String(t.comment ?? '')) add('comment.change', K.table(t), true, commentOn('TABLE', qname(t.schema, t.name), t.comment));
  }

  // 제약 · 인덱스 · 트리거
  const bCon = byKey(base.constraints, K.constraint), nCon = byKey(next.constraints, K.constraint);
  for (const c of next.constraints) {
    if (!nTab.has(`${c.schema}.${c.table}`)) continue;
    const b = bCon.get(K.constraint(c));
    const t = qname(c.schema, c.table);
    const addSql = guard(`select 1 from pg_constraint where conname=${q(c.name)} and conrelid=${q(`${c.schema}.${c.table}`)}::regclass`,
      [`ALTER TABLE ${t} ADD CONSTRAINT ${ident(c.name)} ${c.def};`]);
    // 참조 대상의 PK·UNIQUE 가 먼저 생겨야 FOREIGN KEY 가 붙는다 (실측: 알파벳 순서로 내보내니 깨졌다)
    const onNew = newTables.has(`${c.schema}.${c.table}`);
    if (!b) add('constraint.add', K.constraint(c), true, addSql,
      onNew ? null : '기존 데이터가 조건을 어기면 실패한다',
      { rank: c.type === 'p' || c.type === 'u' ? 0 : c.type === 'f' ? 2 : 1, warn: !onNew });
    else if (!sameDef(b.def, c.def)) add('constraint.change', K.constraint(c), false,
      [`ALTER TABLE ${t} DROP CONSTRAINT ${ident(c.name)};`, `ALTER TABLE ${t} ADD CONSTRAINT ${ident(c.name)} ${c.def};`], `${b.def} → ${c.def}`);
  }
  for (const c of base.constraints) if (nTab.has(`${c.schema}.${c.table}`) && bTab.has(`${c.schema}.${c.table}`) && !nCon.has(K.constraint(c)))
    add('constraint.remove', K.constraint(c), false, `ALTER TABLE ${qname(c.schema, c.table)} DROP CONSTRAINT IF EXISTS ${ident(c.name)};`);

  const bIdx = byKey(base.indexes, K.index), nIdx = byKey(next.indexes, K.index);
  const idxIfNotExists = (def) => String(def).replace(/^CREATE (UNIQUE )?INDEX /i, (m, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS `).replace(/;?$/, ';');
  for (const i of next.indexes) {
    if (!nTab.has(`${i.schema}.${i.table}`)) continue;
    const b = bIdx.get(K.index(i));
    if (!b) add('index.add', K.index(i), true, idxIfNotExists(i.def));
    else if (!sameDef(b.def, i.def)) add('index.change', K.index(i), false, [`DROP INDEX IF EXISTS ${qname(i.schema, i.name)};`, idxIfNotExists(i.def)], `${b.def} → ${i.def}`);
  }
  for (const i of base.indexes) if (!nIdx.has(K.index(i)) && nTab.has(`${i.schema}.${i.table}`)) add('index.remove', K.index(i), false, `DROP INDEX IF EXISTS ${qname(i.schema, i.name)};`);

  const bTrg = byKey(base.triggers, K.trigger), nTrg = byKey(next.triggers, K.trigger);
  for (const t of next.triggers) {
    if (!nTab.has(`${t.schema}.${t.table}`)) continue;
    const b = bTrg.get(K.trigger(t));
    const mk = guard(`select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid where g.tgname=${q(t.name)} and c.relname=${q(t.table)}`,
      [normDef(t.def).replace(/;?$/, ';')]);
    if (!b) add('trigger.add', K.trigger(t), true, mk);
    else if (normDef(b.def) !== normDef(t.def)) add('trigger.change', K.trigger(t), false, [`DROP TRIGGER IF EXISTS ${ident(t.name)} ON ${qname(t.schema, t.table)};`, normDef(t.def).replace(/;?$/, ';')], '트리거 정의가 다르다');
  }
  for (const t of base.triggers) if (!nTrg.has(K.trigger(t)) && nTab.has(`${t.schema}.${t.table}`)) add('trigger.remove', K.trigger(t), false, `DROP TRIGGER IF EXISTS ${ident(t.name)} ON ${qname(t.schema, t.table)};`);

  // 뷰 (일반 뷰는 REPLACE, 구체화 뷰는 다시 만들어야 하니 확인 대상)
  const bView = byKey(base.views, K.view), nView = byKey(next.views, K.view);
  for (const v of next.views) {
    const b = bView.get(K.view(v));
    const body = normDef(v.def).replace(/;?$/, '');
    const t = qname(v.schema, v.name);
    if (v.matview) {
      if (!b) add('matview.add', K.view(v), true, [`CREATE MATERIALIZED VIEW IF NOT EXISTS ${t} AS\n${body}\nWITH NO DATA;`, `REFRESH MATERIALIZED VIEW ${t};`], '데이터를 채우는 REFRESH 가 오래 걸릴 수 있다', { warn: true });
      else if (normDef(b.def).replace(/;?$/, '') !== body) add('matview.change', K.view(v), false, [`DROP MATERIALIZED VIEW IF EXISTS ${t};`, `CREATE MATERIALIZED VIEW ${t} AS\n${body}\nWITH DATA;`], '정의가 다르다 - 다시 만들어야 한다');
    } else if (!b) add('view.add', K.view(v), true, `CREATE OR REPLACE VIEW ${t} AS\n${body};`);
    else if (normDef(b.def).replace(/;?$/, '') !== body) add('view.change', K.view(v), true, `CREATE OR REPLACE VIEW ${t} AS\n${body};`, '열 이름·타입이 바뀌었으면 REPLACE 가 실패한다 (그때는 DROP 후 생성)', { warn: true });
  }
  for (const v of base.views) if (!nView.has(K.view(v))) add('view.remove', K.view(v), false, `DROP ${v.matview ? 'MATERIALIZED ' : ''}VIEW IF EXISTS ${qname(v.schema, v.name)};`);

  out.sort((a, b2) => (ORDER.indexOf(a.kind) - ORDER.indexOf(b2.kind)) || ((a.rank || 0) - (b2.rank || 0)) || String(a.key).localeCompare(String(b2.key)));
  return out;
}

/** 적용 순서 - 담는 것이 먼저, 담기는 것이 나중 */
const ORDER = [
  'extension.add', 'enum.add', 'enum.value.add', 'sequence.add', 'function.add', 'function.change',
  'table.add', 'column.add', 'sequence.owner', 'column.default', 'column.notnull.off', 'constraint.add', 'index.add', 'trigger.add',
  'view.add', 'view.change', 'matview.add', 'comment.change',
  // 확인 대상
  'column.type', 'column.notnull.on', 'constraint.change', 'index.change', 'trigger.change', 'matview.change',
  'column.remove', 'constraint.remove', 'index.remove', 'trigger.remove', 'view.remove', 'table.remove',
  'function.remove', 'sequence.remove', 'enum.value.remove',
];

const LABEL = {
  'extension.add': '확장 추가', 'enum.add': '열거 타입 추가', 'enum.value.add': '열거 값 추가', 'enum.value.remove': '열거 값 없어짐',
  'sequence.add': '시퀀스 추가', 'sequence.owner': '시퀀스 소유 열 연결', 'sequence.remove': '시퀀스 삭제', 'function.add': '함수 추가', 'function.change': '함수 변경', 'function.remove': '함수 삭제',
  'table.add': '테이블 추가', 'table.remove': '테이블 삭제', 'column.add': '열 추가', 'column.remove': '열 삭제',
  'column.type': '열 타입 변경', 'column.notnull.on': 'NOT NULL 추가', 'column.notnull.off': 'NOT NULL 해제', 'column.default': '기본값 변경',
  'constraint.add': '제약 추가', 'constraint.change': '제약 변경', 'constraint.remove': '제약 삭제',
  'index.add': '인덱스 추가', 'index.change': '인덱스 변경', 'index.remove': '인덱스 삭제',
  'trigger.add': '트리거 추가', 'trigger.change': '트리거 변경', 'trigger.remove': '트리거 삭제',
  'view.add': '뷰 추가', 'view.change': '뷰 변경', 'view.remove': '뷰 삭제', 'matview.add': '구체화 뷰 추가', 'matview.change': '구체화 뷰 변경',
  'comment.change': '설명 변경',
};
export const changeLabel = (kind) => LABEL[kind] || kind;

// ── DDL 파일 만들기 ────────────────────────────────────────────────────────
const bar = (s) => `-- ${'─'.repeat(2)} ${s} ${'─'.repeat(Math.max(2, 66 - s.length))}`;
const rule = '-- ' + '='.repeat(74);
const stamp = (snap) => `${snap?.database || '?'} @ ${snap?.server?.split(' ')[0] || '?'} (${snap?.takenAt || '시각 모름'})`;

function sectionsOf(changes) {
  const m = new Map();
  for (const c of changes) { if (!m.has(c.kind)) m.set(c.kind, []); m.get(c.kind).push(c); }
  return [...m.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
}

/**
 * 변경 목록 → 적용 SQL · 확인 SQL 두 파일.
 *
 * <p>트랜잭션으로 감싼다(DDL 도 롤백된다) - 중간에 실패하면 반쯤 적용된 DB 가 남지 않게.
 * 단 `ALTER TYPE ... ADD VALUE` 는 트랜잭션 안에서 쓸 수 없어 맨 앞에 따로 둔다.
 */
export function toDdl(changes, { title = '스키마 적용 DDL', base = null, next = null, kit = '', reviewFile = '02-확인필요.sql' } = {}) {
  const safe = changes.filter((c) => c.safe), unsafe = changes.filter((c) => !c.safe);
  const head = (what, extra = []) => [
    rule, `-- ${title} — ${what}`, '--',
    `-- 기준(받는 쪽): ${stamp(base)}`,
    `-- 대상(보내는 쪽): ${stamp(next)}`,
    '--', ...extra, rule, '',
  ].join('\n');

  const body = (list, { comment = false } = {}) => {
    const parts = [];
    for (const [kind, items] of sectionsOf(list)) {
      parts.push(bar(`${changeLabel(kind)} (${items.length})`));
      for (const c of items) {
        if (c.note) parts.push(`-- ${c.key}: ${c.note}`);
        else if (comment) parts.push(`-- ${c.key}`);
        const sql = c.sql.join('\n');
        parts.push(comment ? sql.split('\n').map((l) => (l.startsWith('--') ? l : `-- ${l}`)).join('\n') : sql);
        parts.push('');
      }
    }
    return parts.join('\n');
  };

  const OUTSIDE = new Set(['enum.value.add', 'extension.add']);
  const outer = safe.filter((c) => OUTSIDE.has(c.kind));
  const inner = safe.filter((c) => !OUTSIDE.has(c.kind));
  const apply = [
    head('적용', [
      '-- 만들고 더하는 변경만 들어 있다. 몇 번 실행해도 결과가 같다(IF NOT EXISTS · 존재 확인).',
      `-- 지우거나 좁히는 변경 ${unsafe.length}건은 ${reviewFile} 에 주석으로만 있다 — 사람이 보고 결정할 것.`,
      '--', `-- 적용: psql -v ON_ERROR_STOP=1 -f 이파일`, kit ? `-- 생성: DevLoop ${kit}` : null,
    ].filter(Boolean)),
    outer.length ? `${bar('트랜잭션 밖 - 확장·열거 값 (실패해도 나머지는 적용된다)')}\n${body(outer)}` : '',
    inner.length ? `BEGIN;\n\n${body(inner)}\nCOMMIT;` : '-- 적용할 변경이 없다 (스키마가 같다)',
    '',
  ].filter(Boolean).join('\n');

  const review = [
    head('확인 필요 (적용되지 않음)', [
      '-- 아래는 받는 쪽에서 지워지거나 좁혀지는 변경이다. 데이터를 잃을 수 있어 전부 주석이다.',
      '-- 하나씩 보고 필요한 것만 주석을 풀어 적용할 것. 보내는 쪽에 없는 것이 받는 쪽의',
      '-- 운영 데이터일 수도 있다(그때는 적용하지 말고 보내는 쪽을 맞춰야 한다).',
    ]),
    unsafe.length ? body(unsafe, { comment: true }) : '-- 확인할 변경이 없다',
    '',
  ].join('\n');

  const counts = {};
  for (const c of changes) counts[c.kind] = (counts[c.kind] || 0) + 1;
  return { apply, review, counts, safeCount: safe.length, reviewCount: unsafe.length };
}

/**
 * 저장소에 든 DDL 파일이 대상 DB 에 실제로 적용돼 있는지 거칠게 교차 확인한다.
 *
 * <p>SQL 을 제대로 해석하지 않는다 - `CREATE TABLE x` 와 `ALTER TABLE x ADD COLUMN y` 만
 * 이름으로 긁어 스냅샷에 있는지 본다. 그래도 "DDL 파일은 커밋됐는데 DB 에는 안 들어간" 것을
 * 잡는 데는 충분하다(실측: district_request, user_group.teneleven_id 가 이 경우였다).
 */
export function ddlFileCheck(files, snapRaw) {
  const snap = parseSnapshot(snapRaw);
  const tabs = new Set(snap.tables.map((t) => t.name.toLowerCase()));
  const cols = new Set(snap.columns.map((c) => `${c.table.toLowerCase()}.${c.name.toLowerCase()}`));
  const out = [];
  for (const f of files) {
    const sql = String(f.content || '').replace(/--[^\n]*/g, ' ');
    const missing = [];
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[a-z0-9_"]+\.)?"?([a-z0-9_]+)"?/gi))
      if (!tabs.has(m[1].toLowerCase())) missing.push({ what: 'table', name: m[1] });
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:[a-z0-9_"]+\.)?"?([a-z0-9_]+)"?([\s\S]*?)(?=;|alter\s+table|$)/gi)) {
      const t = m[1].toLowerCase();
      if (!tabs.has(t)) continue;                                  // 테이블 자체가 없는 건 위에서 잡힌다
      for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi))
        if (!cols.has(`${t}.${c[1].toLowerCase()}`)) missing.push({ what: 'column', name: `${m[1]}.${c[1]}` });
    }
    if (missing.length) out.push({ file: f.path, missing: missing.filter((v, i, a) => a.findIndex((x) => x.name === v.name) === i) });
  }
  return out;
}
