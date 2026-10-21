// Presentation only: consumes read-only round snapshots, never changes game rules.
const ordinary=['水源就是生命線！','佈線前先看距離，太遠很花時間','地上栓比較好找，地下栓看路面蓋子','記住這條路，下次出勤就用得到'];
const grumbles=['動作快！火不會等你！','這條路都不熟，回去背轄區！','再慢就換人上！','我換個新生來都比你好！'];
export function commanderBubbleLines(text){const chars=[...text];if(chars.length>28)chars.splice(27,chars.length-27,'…');return chars.length?[chars.slice(0,14).join(''),...(chars.length>14?[chars.slice(14).join('')]:[])]:[];}
export function createCommanderDialogue(siteName){
 let queue=[{text:`各車注意！火警地點 ${siteName}，快佔消防栓！`,priority:4,scold:false}],active=null,nextAt=0,lastScold=-Infinity,normalCount=0,normalIndex=0,scoldIndex=0,previous=null,idleSince=0,idleAt=-Infinity,idleIndex=0,stolen=0,stolenIndex=0,dispatched=false,finalWarning=false;
 const spoken=new Map(),passing=new Map();
 const eligible=(q,now)=>now-(spoken.get(q.text)??-Infinity)>=30&&(!q.scold||now-lastScold>=10);
 function push(text,now,scold=false,priority=1){const q={text,scold,priority};if(eligible(q,now)&&!queue.some(v=>v.text===text))queue.push(q);}
 function enqueue(kind,now){if(kind==='cancel')push('拉一半又收？水帶不用錢喔！',now,true,2);}
 function choose(list,index,now,scold){for(let i=0;i<list.length;i++){const q={text:list[(index+i)%list.length],scold,priority:0};if(eligible(q,now))return {q,index:(index+i+1)%list.length};}return null;}
 function update({seconds:now,player,water=[],construction=null,npcActive=false,events=[]}){
  const moved=previous&&Math.hypot(player.x-previous.x,player.y-previous.y)>.01;
  if(!previous||moved||construction)idleSince=now;
  if(!construction&&now-idleSince>=8&&now-idleAt>=8){push(['站在那邊看風景喔？動起來！','你是來散步的嗎？'][idleIndex++%2],now,true,2);idleAt=now;}
  if(npcActive&&!dispatched){dispatched=true;push('友隊到場了，動作快！',now);}
  if(now>=150&&!finalWarning){finalWarning=true;push('剩 30 秒，最後衝刺！',now,false,3);}
  for(const e of events){
   const road=(e.waterName||'附近').replace(/(?:口地上|旁地下)消防栓$/,'');
   if(e.type==='capture'){stolen=0;if(e.interceptBonus)push('截胡成功！幹得好！',now,false,3);else if(e.combo>=3)push(`漂亮！連續佈線 ${e.combo} 支！`,now,false,2);else push(`好！${road}那支拿下了！`,now);}
   if(e.type==='stolen'){push(`${road}那支被搶了，換下一支！`,now);if(++stolen>=2){push(['又被搶？你在幹嘛！','人家都搶光了你還在逛！'][stolenIndex++%2],now,true,2);stolen=0;}}
   if(e.type==='wave')push('增援範圍擴大，往外找！',now);
  }
  for(const w of water){const near=Math.hypot(w.x-player.x,w.y-player.y)<=5;if(near){if(!passing.has(w.id))passing.set(w.id,{stopped:false});if(!moved||construction)passing.get(w.id).stopped=true;}else if(passing.has(w.id)){if(!passing.get(w.id).stopped&&!w.owner)push('消防栓就在你腳邊啦！',now,true,2);passing.delete(w.id);}}
  previous={x:player.x,y:player.y};
  if(now>=nextAt){
   queue=queue.filter(q=>eligible(q,now)).sort((a,b)=>b.priority-a.priority);let q=queue.shift();
   if(!q){let selection=normalCount>=3?choose(grumbles,scoldIndex,now,true):null;if(selection){q=selection.q;scoldIndex=selection.index;normalCount=0;}else{selection=choose(ordinary,normalIndex,now,false);if(selection){q=selection.q;normalIndex=selection.index;normalCount++;}else{selection=choose(grumbles,scoldIndex,now,true);if(selection){q=selection.q;scoldIndex=selection.index;normalCount=0;}}}}
   if(q){active={...q,until:now+4};nextAt=now+5;spoken.set(q.text,now);if(q.scold)lastScold=now;}
  }
  return text(now);
 }
 function text(now){return active&&now<active.until?active.text:'';}
 return {update,enqueue,text};
}
