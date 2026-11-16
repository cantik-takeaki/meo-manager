import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('async function loadProtection()'),html.indexOf('// 改ざん防止の正規情報'));
test('差分履歴は対象画面に描画し店舗名の文字をHTMLとして解釈しない',async()=>{
 const els=new Map();const document={getElementById:id=>{if(!els.has(id))els.set(id,{style:{},innerHTML:'',value:''});return els.get(id);}};
 const context=vm.createContext({currentLocationId:'店A',document,encodeURIComponent,Date,escapeHtml:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),fetch:async url=>({json:async()=>url.includes('store-settings')?{info:{title:'店A'},savedAt:'2026-11-16',alerts:[{detectedAt:'2026-11-16',diffs:[{field:'営業時間',saved:'旧',current:'<script>新</script>'}]}]}:{}})});
 vm.runInContext(code,context);await context.loadProtection();
 assert.match(els.get('protectionAlertsList').innerHTML,/営業時間/);assert.match(els.get('protectionAlertsList').innerHTML,/&lt;script&gt;/);assert.equal(els.has('alertsList'),false);
 assert.equal((html.match(/id="protectionAlertsList"/g)||[]).length,1);
});
