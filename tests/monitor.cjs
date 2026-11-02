const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const state = {LOCATION_A:'A',LOCATION_B:'B',MAPS_API_KEY:'test',DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/123/token'};
let now = new Date('2026-11-02T03:30:00Z'), seconds = 1800, fail = false, maps = 0, alerts = 0;
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
const props = {getProperties:()=>({...state}),getProperty:k=>state[k]??null,setProperty:(k,v)=>{state[k]=v;}};
const format = (date,tz,pattern) => {
  const local = new Date(date.getTime()+330*60000);
  return pattern==='EEE' ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][local.getUTCDay()]
    : pattern==='H' ? String(local.getUTCHours()) : local.toISOString().slice(0,pattern==='yyyy-MM'?7:10);
};
const ctx = vm.createContext({Date:Clock,console,Utilities:{formatDate:format},
  PropertiesService:{getScriptProperties:()=>props},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  UrlFetchApp:{fetch:(url)=>{ if(url.includes('routes.googleapis.com')) { maps++; if(fail) throw Error('network');
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({routes:[{duration:seconds+'s'}]})}; }
    alerts++; return {getResponseCode:()=>200}; }}});
vm.runInContext(readFileSync(require('node:path').join(__dirname,'../Code.gs'),'utf8'),ctx);
const run = expr => vm.runInContext(expr,ctx);
run('checkTraffic()'); assert.equal(alerts,0);
now = new Date(now.getTime()+300000); run('checkTraffic()'); assert.equal(alerts,1);
run('checkTraffic()'); assert.equal(maps,2);
now = new Date('2026-11-02T12:30:00Z'); seconds=2400; run('checkTraffic()'); assert.equal(alerts,1); // Strictly below 40.
seconds=2300; now=new Date(now.getTime()+300000);run('checkTraffic()');
fail=true;now=new Date(now.getTime()+300000);assert.throws(()=>run('checkTraffic()'));
assert.equal(JSON.parse(state.STATE_evening).streak,0);
fail=false;now=new Date(now.getTime()+300000);run('checkTraffic()');assert.equal(alerts,1);
now=new Date(now.getTime()+300000);run('checkTraffic()');assert.equal(alerts,2);
const count=maps;
now=new Date('2026-11-07T03:30:00Z');run('checkTraffic()');assert.equal(maps,count); // Saturday.
now=new Date('2026-11-03T05:30:00Z');run('checkTraffic()');assert.equal(maps,count); // 11:00 excluded.
now=new Date('2026-11-03T03:30:00Z');state.MAPS_USAGE=JSON.stringify({month:'2026-11',count:1500});
assert.throws(()=>run('checkTraffic()'),/cap/);assert.equal(maps,count);
seconds=1800;now=new Date('2026-12-01T03:30:00Z');run('checkTraffic()');assert.equal(JSON.parse(state.MAPS_USAGE).count,1);
now=new Date(now.getTime()+11*60000);run('checkTraffic()');assert.equal(JSON.parse(state.STATE_morning).streak,1);
console.log('Passed: windows, weekends, thresholds, confirmation, duplicate suppression, API failure, stale readings, cap and month reset.');
