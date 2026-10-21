#!/usr/bin/env node
// Derive the playable mission pool only from the authorized public JSON files.
import fs from 'node:fs';
import {resolveFireSite,selectObjectives,missionCandidates} from '../missions.mjs';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
const sites=read('data/sites.json'),base=read('data/base.json');
const cells=new Map(base.cells.map(k=>[k,read(`data/c/${k}.json`)]));
const water=read('data/w/index.json').flatMap(k=>read(`data/w/${k}.json`).map(([x,y,k])=>({x,y,k})));
const counts=sites.map(site=>{
 const a=Math.floor(site.x/base.cs),b=Math.floor(site.y/base.cs),buildings=[];
 for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)buildings.push(...(cells.get(`${a+i}_${b+j}`)?.builds||[]));
 const fire=resolveFireSite(site,buildings);
 return selectObjectives(water,fire,300,15).length;
});
const eligible=counts.flatMap((n,i)=>n>=10?[i]:[]);
fs.writeFileSync(new URL('data/mission-pool.json',root),JSON.stringify({minimum:10,eligible,counts})+'\n');
const fixture=read('tests/fixtures/v2-balance-samples.json');
fixture.samples=fixture.samples.map(sample=>{
 if(eligible.includes(sample.siteIndex))return sample;
 const candidates=missionCandidates(sites,base.stations.find(s=>s.name===sample.station));
 const start=candidates.indexOf(sites[sample.siteIndex]);
 for(let n=1;n<=candidates.length;n++){
  const index=sites.indexOf(candidates[(start+n)%candidates.length]);
  if(eligible.includes(index))return {...sample,siteIndex:index,originalSiteIndex:sample.siteIndex,replacementReason:'resolved fire has fewer than 10 hydrants within 300m'};
 }
 throw Error('No eligible mission for '+sample.station);
});
fs.writeFileSync(new URL('tests/fixtures/v3-balance-samples.json',root),JSON.stringify(fixture,null,2)+'\n');
console.log(JSON.stringify({sites:sites.length,eligible:eligible.length,excluded:counts.flatMap((n,i)=>n<10?[{siteIndex:i,count:n}]:[]),replacements:fixture.samples.filter(s=>s.originalSiteIndex!==undefined)},null,2));
