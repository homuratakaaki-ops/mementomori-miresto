const assert = require('node:assert/strict');
const fs = require('node:fs');
const gs = require('../js/gacha-status.js');
const render = require('../js/render-character.js');
const data = require('../data/mementomori-skills.json');
const news = require('../data/news.json');
const ids = ['fortina', 'valriede', 'sonya', 'belle', 'luke', 'karol', 'lily'];
let count = 0;
for (const id of ids) {
  const c = data.characters.find(c => c.id === id);
  const entries = c.pickupHistory.filter(e => e.date === '2026-11-09');
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.startTime, '14:30');
  assert.equal(e.announced, true);
  assert.equal(e.kind, id === 'lily' ? '復刻' : '星の導き');
  assert.equal(e.endDate, undefined);
  assert.equal(e.endTime, undefined);
  assert.equal(c.pickupCount, e.round);
  for (const [at, state] of [['2026-11-09T14:29', 'upcoming'], ['2026-11-09T14:30', 'ongoing'], ['2026-12-01T14:29', 'ongoing'], ['2026-12-01T14:30', 'waiting']]) {
    assert.equal(gs.gachaStatus(c, at).state, state);
    assert.equal(gs.arcanaGachaSummary(c, at).state, state);
    count += 2;
  }
  const html = render.renderMetaHtml(c, news, '2026-11-09T14:29');
  assert.ok(html.includes(`${e.round}回目${id === 'lily' ? '' : '（星の導き）'} 2026/11/9（予定）`));
  assert.ok(!html.includes(`${e.round}回目（星の導き）`) || id !== 'lily');
  count++;
}
// 全収録の星の導きに種別を表示。通常のPU/復刻には誤って付けない。
for (const kind of ['星の導き', '復刻', 'PU']) {
  const c = {id: 'fixture', name: 'fixture', pickupCount: 4, pickupHistory: [{date: '2026-11-09', kind, round: 4, announced: true, startTime: '14:30'}]};
  const html = render.renderMetaHtml(c, {items: []}, '2026-11-08T12:00');
  assert.equal(html.includes('4回目（星の導き）'), kind === '星の導き');
  count++;
}
assert.equal(news.items.filter(i => i.id === '2026-11-07-hoshi-no-michibiki-announcement').length, 1);
assert.equal(news.items.filter(i => i.id === '2026-11-07-lily-announcement').length, 1);
console.log(`${count} assertions passed; seven announcements, kind labels, unchanged 22-day fallback`);
