const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(process.argv[2] || require('node:path').join(__dirname, '../js/guide-slides.js'),'utf8');
function fixture({reduced=false,ready='complete'}={}) {
 const listeners=new Map();
 function el(active=false){const ev={},attrs={},cls=new Set(active?['is-active']:[]);return {hidden:true,dataset:{duration:'2000'},classList:{contains:k=>cls.has(k),add:k=>cls.add(k),remove:k=>cls.delete(k)},addEventListener:(k,fn)=>ev[k]=fn,emit:(k,event={})=>ev[k]?.(event),setAttribute:(k,v)=>attrs[k]=v,getAttribute:k=>attrs[k],removeAttribute:k=>delete attrs[k],matches:()=>false};}
 const root=el(),viewport=el(),controls=el(),toggle=el(),prev=el(),next=el(),dots=Array.from({length:5},()=>el()),slides=Array.from({length:5},(_,i)=>el(i===0));
 slides.forEach(s=>{const img=el();img.setAttribute('loading','lazy');s.querySelector=()=>img;});
 controls.querySelector=s=>({'[data-slides-toggle]':toggle,'[data-slides-prev]':prev,'[data-slides-next]':next})[s];controls.querySelectorAll=()=>dots;
 root.querySelector=s=>s==='.guide-slides-viewport'?viewport:controls;root.querySelectorAll=()=>slides;root.contains=t=>[toggle,prev,next,...dots].includes(t);
 const timers=new Map();let id=0,observer;
 const doc={readyState:ready,hidden:false,querySelectorAll:()=>[root],addEventListener:(k,f)=>listeners.set(k,f)};
 const win={matchMedia:()=>({matches:reduced}),setTimeout:f=>{timers.set(++id,f);return id;},clearTimeout:i=>timers.delete(i),IntersectionObserver:class{constructor(f){observer=f;}observe(){}}};
 vm.runInNewContext(src,{document:doc,window:win});
 const tick=()=>{const list=[...timers.values()];timers.clear();list.forEach(f=>f());};
 return {root,toggle,prev,next,dots,slides,controls,timers,doc,tick,fire:(k,e)=>listeners.get(k)?.(e),view:r=>observer([{intersectionRatio:r}]),index:()=>slides.findIndex(s=>s.classList.contains('is-active'))};
}
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
for(const ready of ['loading','interactive','complete']) test('初期化 '+ready,()=>{const f=fixture({ready});if(ready==='loading'){assert.equal(f.timers.size,0);f.fire('DOMContentLoaded');}assert.equal(f.controls.hidden,false);assert.equal(f.timers.size,1);f.tick();assert.equal(f.index(),1);});
test('次へタップ後も自動送り',()=>{const f=fixture();f.root.emit('pointerdown');f.root.emit('focusin',{target:f.next});f.next.emit('click');assert.equal(f.index(),1);assert.equal(f.timers.size,1);f.tick();assert.equal(f.index(),2);});
test('キーボード停止からタッチへ切替',()=>{const f=fixture();f.toggle.matches=()=>true;f.root.emit('focusin',{target:f.toggle});assert.equal(f.timers.size,0);f.root.emit('pointerdown');assert.equal(f.timers.size,1);});
test('停止→再生はタップフォーカスが残っても動作',()=>{const f=fixture();f.root.emit('focusin',{target:f.toggle});f.toggle.emit('click');assert.equal(f.timers.size,0);f.toggle.emit('click');assert.equal(f.timers.size,1);});
test('前後・ドット・5枚ループ',()=>{const f=fixture();f.prev.emit('click');assert.equal(f.index(),4);f.tick();assert.equal(f.index(),0);f.dots[3].emit('click');assert.equal(f.index(),3);f.next.emit('click');assert.equal(f.index(),4);});
test('キーボードフォーカス中断と退出で再開',()=>{const f=fixture();f.next.matches=()=>true;f.root.emit('focusin',{target:f.next});assert.equal(f.timers.size,0);f.root.emit('focusout',{relatedTarget:null});assert.equal(f.timers.size,1);});
test('画面外中断・復帰、一時停止の選択を維持',()=>{const f=fixture();f.view(0);assert.equal(f.timers.size,0);f.view(1);assert.equal(f.timers.size,1);f.toggle.emit('click');f.view(0);f.view(1);assert.equal(f.timers.size,0);});
test('非表示タブ→復帰',()=>{const f=fixture();f.doc.hidden=true;f.fire('visibilitychange');assert.equal(f.timers.size,0);f.doc.hidden=false;f.fire('visibilitychange');assert.equal(f.timers.size,1);});
test('reduceは自動再生なし・手動再生可能',()=>{const f=fixture({reduced:true});assert.equal(f.timers.size,0);f.root.emit('focusin',{target:f.toggle});f.toggle.emit('click');assert.equal(f.timers.size,1);});
console.log(count+' scenarios passed');
