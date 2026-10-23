/** 時刻境界・旧版互換・隔離ビルド・ブラウザ検証。
 * node scripts/verify-gacha-time.cjs
 * node scripts/verify-gacha-time.cjs --browser
 * ブラウザ検証は playwright（または PLAYWRIGHT_MODULE の絶対パス）が必要。
 * 実データは変更せず OS の一時フォルダ内の隔離コピーだけを変更する。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const gs = require('../js/gacha-status.js');
const detail = require('../js/render-character.js');
const cards = require('../js/render-character-index.js');
const canonical = fs.readFileSync(path.join(ROOT, 'data/mementomori-skills.json'));
const data = JSON.parse(canonical);
const news = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/news.json'), 'utf8'));
const baseline = 'c271f7718c21f764837f174de8d15474e6261035';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const entry = { date: '2026-10-22', startTime: '14:30', endDate: '2026-11-09', endTime: '14:29', endTimeSource: 'テスト用公式告知 2026-10-23確認', kind: '復刻', round: 2 };
const character = { ...data.characters.find(c => c.id === 'cerberus_candy'), pickupHistory: [entry], pickupCount: 2 };

test('終了最終分と終了境界・表示文', () => {
  for (const [time, ongoing] of [['14:28', true], ['14:29', true], ['14:30', false], ['20:00', false]]) {
    const at = `2026-11-09T${time}`;
    assert.equal(gs.isOngoing(entry, at), ongoing);
    assert.equal(gs.gachaStatusText(character, at), ongoing ? '復刻中（〜11/9 14:29）' : '復刻待ち');
    assert.equal(gs.periodSuffix(entry, at), ongoing ? '（開催中〜11/9 14:29）' : '（終了）');
    assert.ok(detail.renderMetaHtml(character, {}, at).includes(`2026/10/22〜11/9${ongoing ? '（開催中〜11/9 14:29）' : '（終了）'}`));
  }
});
test('announcedあり・なしの開始時刻境界', () => {
  for (const announced of [false, true]) {
    const e = { ...entry, announced };
    const c = { ...character, pickupHistory: [e] };
    assert.equal(gs.isOngoing(e, '2026-10-22T14:29'), false);
    assert.equal(gs.isOngoing(e, '2026-10-22T14:30'), true);
    assert.equal(gs.hasPastPickup(c, '2026-10-22T14:29'), false);
    assert.equal(gs.isUpcoming(e, '2026-10-22T14:29'), announced);
  }
});
test('日付繰越・22日安全装置・JST・月単位の旧履歴', () => {
  assert.equal(gs.isOngoing({ ...entry, endTime: '23:59' }, '2026-11-10T00:00'), false);
  assert.equal(gs.isOngoing(entry, '2026-11-09T05:29:59Z'), true);
  assert.equal(gs.isOngoing(entry, '2026-11-09T05:30:00Z'), false);
  const e = { ...entry, announced: true, endDate: undefined, endTime: undefined };
  assert.equal(gs.isOngoing(e, '2026-11-13T14:29'), true);
  assert.equal(gs.isOngoing(e, '2026-11-13T14:30'), false);
  assert.equal(gs.hasPastPickup({ pickupHistory: [{ date: '2026-10', kind: 'PU' }] }, '2026-10-01'), true);
});
test('現行120体 × 92日 × 6時刻をc271f77と照合', () => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(git('show', `${baseline}:js/gacha-status.js`), context);
  const old = context.module.exports;
  const mismatches = [];
  let count = 0;
  function snapshot(api, c, at) {
    return JSON.stringify({ status: api.gachaStatus(c, at), past: api.hasPastPickup(c, at),
      warnings: api.announcementWarnings(c, at), rounds: (c.pickupHistory || []).map(e => ({
        ongoing: api.isOngoing(e, at), upcoming: api.isUpcoming(e, at), suffix: api.periodSuffix(e, at)
      })) });
  }
  for (let day = Date.parse('2026-10-01'); day <= Date.parse('2026-12-31'); day += 86400000) {
    for (const time of ['00:00', '06:00', '14:29', '14:30', '15:00', '23:59']) {
      const at = new Date(day).toISOString().slice(0, 10) + 'T' + time;
      for (const c of data.characters) {
        count++;
        if (snapshot(old, c, at) !== snapshot(gs, c, at)) mismatches.push(`${c.id} ${at}`);
      }
    }
  }
  console.log(`  ${count}比較 / 不一致${mismatches.length}件`);
  assert.deepEqual(mismatches, []);
});
test('未来表示の重複除去・複数回・予定の再出現', () => {
  const c = { ...character, pickupHistory: [entry, { ...entry, date: '2026-11-20', endDate: '2026-11-30', announced: true }] };
  const timeline = gs.displayTimeline(c.pickupHistory, '2026-11-09T14:29', at => {
    const s = gs.gachaStatus(c, at); return { text: s.text, cls: s.state };
  });
  assert.deepEqual(timeline.map(t => t.at), ['2026-11-09T14:30:00+09:00', '2026-11-20T14:30:00+09:00', '2026-11-30T14:30:00+09:00']);
  assert.equal(timeline[0].cls, 'upcoming');
  assert.match(detail.renderMetaHtml(c, {}, '2026-11-09T14:29'), /class="badge upcoming"[^>]* hidden>/);
  assert.equal(gs.displayTimeline([entry], '2026-12-01', () => ({ text: '同じ', cls: '' })).length, 0);
});

const outputRoot = path.join(ROOT, '.local-verify');
fs.mkdirSync(outputRoot, { recursive: true });
// build-ads は配下のHTMLも走査するため、隔離コピーはリポジトリの外に置く。
const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'miresto-gacha-time-'));
process.on('exit', () => {
  const parent = path.resolve(require('node:os').tmpdir());
  if (path.dirname(path.resolve(fixture)) === parent && path.basename(fixture).startsWith('miresto-gacha-time-')) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
const files = git('ls-files', '-z').split('\0').filter(Boolean);
for (const file of [...files, 'js/gacha-switch.js']) {
  const dest = path.join(fixture, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), dest);
}
const fixtureJson = path.join(fixture, 'data/mementomori-skills.json');
function build(at, expected = 0) {
  const env = { ...process.env };
  delete env.MIRESTO_NOW; delete env.MIRESTO_TODAY;
  if (at) env.MIRESTO_NOW = at;
  const result = spawnSync(process.execPath, ['scripts/build-character-pages.mjs'], { cwd: fixture, env, encoding: 'utf8' });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return result;
}
function writeFixture(e) {
  const copy = JSON.parse(canonical);
  Object.assign(copy.characters.find(c => c.id === character.id), { pickupHistory: [e], pickupCount: 2 });
  fs.writeFileSync(fixtureJson, JSON.stringify(copy, null, 2));
}
const indexPath = 'pages/characters/index.html';
const detailPath = `pages/characters/${character.pageSlug}.html`;
const read = p => fs.readFileSync(path.join(fixture, p), 'utf8');
const hash = p => createHash('sha256').update(fs.readFileSync(path.join(fixture, p))).digest('hex');
test('本番設定の生成HTMLは表示文の差0（許可した属性・読み込み・hidden CSS以外の差0）', () => {
  build();
  const strip = html => html.replace(/\r\n/g, '\n')
    .replace(/  <script src="\.\.\/\.\.\/js\/gacha-switch\.js\?v=[^"]+" defer><\/script>\n/g, '')
    .replace(/ data-gacha-timeline="[^"]*"/g, '')
    .replace(/\?v=[a-f0-9]{8}/g, '')
    .replace(/    \.badge\[data-gacha-timeline\]\[hidden\] \{ display: none; \}\n\n/g, '');
  const changed = [];
  for (const file of files.filter(f => f.endsWith('.html'))) {
    if (strip(read(file)) !== strip(git('show', `${baseline}:${file}`))) changed.push(file);
  }
  console.log(`  表示文・その他の差 ${changed.length}ページ`);
  assert.deepEqual(changed, []);
  const before = files.map(hash);
  build();
  assert.deepEqual(files.map(hash), before);
});
test('不正な時刻・終了日欠落・出典欠落・開始終了逆転でビルド停止', () => {
  for (const [patch, message] of [
    [{ endDate: undefined }, 'endDate が必要'], [{ endTimeSource: '' }, 'endTimeSource'],
    [{ endTimeSource: undefined }, 'endTimeSource'], [{ startTime: '24:00' }, 'HH:MM'],
    [{ endTime: '14:60' }, 'HH:MM'], [{ endTime: 1429 }, 'HH:MM'],
    [{ date: '2026-11-09', startTime: '14:30' }, '開始が終了より後']
  ]) {
    writeFixture({ ...entry, ...patch });
    const before = hash(detailPath);
    const result = build('2026-11-09T14:29', 1);
    assert.ok((result.stdout + result.stderr).includes(message));
    assert.equal(hash(detailPath), before);
  }
});
const snapshots = new Map();
test('テストデータの境界前後を実ビルドし一覧・詳細を共有描画と照合', () => {
  writeFixture({ ...entry, announced: true });
  for (const at of ['2026-10-22T14:29', '2026-10-22T14:30', '2026-11-09T14:29', '2026-11-09T14:30']) {
    build(at);
    const c = { ...character, pickupHistory: [{ ...entry, announced: true }] };
    assert.ok(read(indexPath).replace(/\r\n/g, '\n').includes(cards.renderCard(c, at).trim()));
    assert.ok(read(detailPath).includes(detail.renderMetaHtml(c, news, at)));
    snapshots.set(at, { index: read(indexPath), detail: read(detailPath) });
  }
  const before = files.map(hash);
  build('2026-11-09T14:30');
  assert.deepEqual(files.map(hash), before);
});

async function browserTests() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const http = require('node:http');
  let current = snapshots.get('2026-11-09T14:29');
  const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
    const full = path.resolve(fixture, relative);
    if (!full.startsWith(fixture + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const content = relative === indexPath ? current.index : relative === detailPath ? current.detail : fs.readFileSync(full);
      const ext = path.extname(full);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[ext] || 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const base = `http://127.0.0.1:${server.address().port}/`;
    const context = await browser.newContext();
    await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    async function open(file, at, ctx = context) {
      const page = await ctx.newPage();
      await page.clock.install({ time: new Date(at + '+09:00') });
      await page.goto(base + file);
      return page;
    }
    const card = p => p.locator('.card').filter({ has: p.locator(`a[href="./${character.pageSlug}.html"]`) }).locator('.badge').nth(1);
    const state = async (page, type) => type === 'index' ? card(page).evaluate(e => ({ text: e.textContent, cls: e.className, hidden: e.hidden }))
      : page.locator('#characterMeta .badge').evaluateAll(es => es.filter(e => !e.hidden).map(e => ({ text: e.textContent, cls: e.className })));
    for (const [before, after, clock] of [
      ['2026-10-22T14:29', '2026-10-22T14:30', '2026-10-22T14:29:50'],
      ['2026-11-09T14:29', '2026-11-09T14:30', '2026-11-09T14:29:50']
    ]) {
      current = snapshots.get(before);
      for (const [type, file] of [['index', indexPath], ['detail', detailPath]]) {
        const page = await open(file, clock);
        await page.clock.runFor(10000);
        const switched = await state(page, type);
        current = snapshots.get(after);
        const staticPage = await open(file, after + ':00');
        assert.deepEqual(switched, await state(staticPage, type));
        await staticPage.close();
        current = snapshots.get(before);
        if (type === 'detail' && before.startsWith('2026-10-22')) {
          assert.equal(await page.locator('#characterMeta .upcoming').isVisible(), false);
        }
        if (type === 'index') {
          await page.locator(`[data-attribute="${character.attribute}"]`).click();
          assert.deepEqual(await state(page, type), switched);
        }
        await page.close();
      }
    }
    console.log('PASS page.clock開始・終了境界 / 静的HTML一致 / 属性タブ再描画');
    // 再描画した新しいカードにもタイマーが登録されること。
    current = snapshots.get('2026-11-09T14:29');
    const rerender = await open(indexPath, '2026-11-09T14:29:50');
    await rerender.locator(`[data-attribute="${character.attribute}"]`).click();
    await rerender.clock.runFor(10000);
    assert.equal(await card(rerender).textContent(), '復刻待ち');
    await rerender.close();
    // タイマーを進めず壁時計だけを変え、visibilitychange経由で追従させる。
    for (const [type, file] of [['index', indexPath], ['detail', detailPath]]) {
      const resumed = await open(file, '2026-11-09T14:29:50');
      await resumed.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await resumed.clock.setSystemTime(new Date('2026-11-09T14:30:00+09:00'));
      await resumed.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const delayedLoad = await open(file, '2026-11-09T14:30:00');
      assert.deepEqual(await state(resumed, type), await state(delayedLoad, type));
      if (type === 'index') assert.equal(await card(resumed).textContent(), '復刻待ち');
      else assert.ok((await resumed.locator('#characterMeta').textContent()).includes('（終了）'));
      await delayedLoad.close();
      await resumed.close();
    }
    console.log('PASS 一覧再描画後タイマー / 非表示→復帰イベント');
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    for (const [type, file] of [['index', indexPath], ['detail', detailPath]]) {
      const staticPage = await noJs.newPage();
      await staticPage.goto(base + file);
      if (type === 'index') assert.equal(await card(staticPage).textContent(), '復刻中（〜11/9 14:29）');
      else assert.ok((await staticPage.locator('#characterMeta').textContent()).includes('（開催中〜11/9 14:29）'));
    }
    await noJs.close();
    const broken = await context.newPage();
    await broken.clock.install({ time: new Date('2026-11-09T14:30:00+09:00') });
    await broken.setContent('<span class="badge" data-gacha-timeline="broken">静的</span><span class="badge" id="partial">静的</span>');
    await broken.locator('#partial').evaluate(el => el.dataset.gachaTimeline = JSON.stringify([
      { at: '2026-11-09T14:30:00+09:00', text: '適用禁止', cls: 'badge' },
      { at: '2026-11-09T24:30:00+09:00', text: '', cls: 'badge' }
    ]));
    await broken.addScriptTag({ path: path.join(ROOT, 'js/gacha-switch.js') });
    assert.deepEqual(await broken.locator('span').allTextContents(), ['静的', '静的']);
    await broken.close();
    console.log('PASS JS無効 / 壊れた属性の静的表示保持');
    for (const width of [320, 390, 1280]) {
      for (const [type, file] of [['index', indexPath], ['detail', detailPath]]) {
        const page = await open(file, '2026-11-09T14:29:00');
        await page.setViewportSize({ width, height: 900 });
        const target = type === 'index' ? card(page) : page.locator('#characterMeta');
        await target.scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const box = await target.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width);
        await page.screenshot({ path: path.join(outputRoot, `gacha-time-${type}-${width}.png`) });
        await page.close();
      }
    }
    console.log('PASS 320/390/1280px スクリーンショット6枚');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
(async () => {
  if (process.argv.includes('--browser')) await browserTests();
  assert.deepEqual(fs.readFileSync(path.join(ROOT, 'data/mementomori-skills.json')), canonical);
  console.log(`${passed} groups passed; temporary fixture removed on exit`);
})().catch(error => { console.error(error); process.exitCode = 1; });
