import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const html=readFileSync(fileURLToPath(new URL('../holy-angel-planner-test.html',import.meta.url)),'utf8');
const tests=[
['Japanese language',/<html lang="ja">/.test(html)],
['Mobile viewport',/name="viewport"/.test(html)],
['Noindex preview',/name="robots" content="noindex,nofollow"/.test(html)],
['Not a public page',/開発用テスト・保存なし/.test(html)],
['Game probability caveat',/独立と仮定した予測モデル/.test(html)],
['No external script tags',!/<script\b[^>]+src=/.test(html)],
['No external fetch',!/(\bfetch\(|XMLHttpRequest|navigator\.sendBeacon)/.test(html)],
['No ads',!/adsbygoogle|googlesyndication|doubleclick/.test(html)],
['No storage before sync approval',!/localStorage|sessionStorage|indexedDB/.test(html)],
['Equipment module linked',/from '\.\/js\/holy-angel-planner-core\.mjs'/.test(html)],
['Probability module linked',/from '\.\/js\/holy-angel-multi-stop\.mjs'/.test(html)],
['Calendar module linked',/from '\.\/js\/holy-angel-calendar\.mjs'/.test(html)],
['Target level',/name="target"/.test(html)],
['Inventory 4 types', ['chalice','medal','wing','fruit'].every(k=>html.includes('name="'+k+'"'))],
['Ticket input',/name="tickets"/.test(html)],
['Starting gauge',/name="gauge"/.test(html)],
['Start JST datetime',/type="datetime-local"/.test(html)],
['Today free used input',/name="usedToday"/.test(html)],
['Complete versus stop strategies',/value="stop-on-target"/.test(html)&&/value="complete-cycle"/.test(html)],
['Four-relic needs dynamically computed',/Math\.max\(0,plan\.relics\[k\]-inventory\[k\]\)/.test(html)],
['No injected markup for error message',/errors\.textContent=/.test(html)],
['Results textContent',/\.textContent=/.test(html)],
['No innerHTML injection',!/\.innerHTML\s*=/.test(html)],
['Save not falsely claimed',/クラウド保存.*未実装/.test(html)],
['Error area role alert',/id="error" role="alert"/.test(html)],
['Future manual steps input',/540=40/.test(html)],
['Unused parts editable',/name="parts"/.test(html)],
['Current level options populated',/for\(let lv=240;lv<=530;lv\+=10\)/.test(html)],
];
for(const [name,ok] of tests)assert.ok(ok,name);
const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(match,'One module script must exist');
assert.equal((html.match(/<script\b/g)||[]).length,1,'One script tag only');
console.log('PASS '+(tests.length+2)+' mobile preview static checks');
