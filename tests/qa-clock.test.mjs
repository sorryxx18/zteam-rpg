import test from 'node:test';
import assert from 'node:assert/strict';

const {localTestRate} = await import('../qa-clock.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
test('本機快轉 helper 存在，僅精確 loopback hostname 加 test=1 啟用五倍速',()=>{
  assert.equal(typeof localTestRate,'function');
  for(const hostname of ['localhost','127.0.0.1','[::1]','::1']){
    for(const search of ['?test=1','?other=yes&test=1'])assert.equal(localTestRate({hostname,search}),5,hostname+search);
    for(const search of ['', '?test=0','?test=5','?test=true','?test=01','?TEST=1','?testing=1'])assert.equal(localTestRate({hostname,search}),1,hostname+search);
  }
  for(const hostname of ['example.com','sorryxx18.github.io','localhost.evil.com','evil.localhost','foo.localhost','localhost.','127evil','127.0.0.1.evil','127.0.0.2','0.0.0.0',''])assert.equal(localTestRate({hostname,search:'?test=1'}),1,hostname);
  for(const url of ['http://localhost:8000/?test=1','http://127.0.0.1:8000/?test=1','http://[::1]:8000/?test=1'])assert.equal(localTestRate(new URL(url)),5);
  assert.equal(localTestRate(new URL('https://localhost@public.example/?test=1')),1);
});
