const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, 'build-status-guides.mjs'), 'utf8');
const start = source.indexOf('const FORBIDDEN_WORDS =');
const end = source.indexOf('/* ------------------------------------------------------------------', start);
assert.ok(start >= 0 && end > start);
const context = {};
vm.runInNewContext(source.slice(start, end), context);
const check = (html) => {
  const errors = [];
  context.validateWording('fixture', html, errors);
  return errors;
};
const title = '公式FAQ「攻撃力が最も高いキャラに付与されるバフが、予想していたキャラに付与されない」';
const card = (id, text) => `<section class="guide-card" id="${id}" aria-labelledby="${id}-title">${text}</section>`;

assert.equal(check(card('sources', `<p>${title}</p><a href="https://mementomori.zendesk.com/hc/ja/articles/46712691050777">${title}</a>`)).length, 0);
assert.ok(check(card('mechanism', title)).some(x => x.includes('予想')));
assert.ok(check(card('sources', title + '<p>次回は強くなると予想する</p>')).some(x => x.includes('予想')));
assert.ok(check(card('sources', title) + card('mechanism', '効果を予想する')).some(x => x.includes('予想')));
assert.ok(check(card('sources-other', title)).some(x => x.includes('予想')));
assert.ok(check(card('sources', '公式FAQ「別の予想記事」')).some(x => x.includes('予想')));
assert.ok(check(card('sources', title + '<p>おすすめ JSON</p>')).some(x => x.includes('おすすめ')));
assert.ok(check(card('sources', title + '<p>おすすめ JSON</p>')).some(x => x.includes('JSON')));
console.log('PASS: exact official FAQ title is allowed only in the sources card; body and other wording checks remain active.');
