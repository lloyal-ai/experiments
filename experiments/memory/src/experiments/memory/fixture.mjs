export const instruction = 'Read the reference ledger and answer the assigned lookup accurately. Return only the requested JSON object with id, route, capacity and checksum copied exactly from the ledger. No explanation.';
export const schema = {type:'object',properties:{id:{type:'string'},route:{type:'string'},capacity:{type:'integer'},checksum:{type:'string'}},required:['id','route','capacity','checksum'],additionalProperties:false};
export function fixture(count=8, records=96) {
 const rows=Array.from({length:records},(_,i)=>({id:`site-${String(i+1).padStart(3,'0')}`,route:`sector-${i%11}-${(i*7)%19}`,capacity:100+i*13,checksum:`r${(i*7919+113).toString(16)}`}));
 const shared=instruction+'\n\nReference ledger:\n'+rows.map(r=>JSON.stringify(r)).join('\n');
 return {shared,schema,tasks:Array.from({length:8},(_,i)=>{const expected=rows[Math.floor((i+1)*records/9)];return {id:`task-${i}`,question:`Return the reference ledger entry for ${expected.id}.`,seed:1000+i,expected};}).slice(0,count)};
}
export function checkAnswer(text,expected) {
 try {const a=JSON.parse(text);return Object.keys(expected).every(k=>a[k]===expected[k])&&Object.keys(a).length===Object.keys(expected).length;}
 catch {return false;}
}

// Separate fixture revision: preserve the original eight-task diagnostic.
export function capacityFixture(count=254, records=256) {
 if(!Number.isInteger(count)||count<1||count>254||![256,768].includes(records))throw new Error('Capacity fixture supports 1..254 tasks and 256 or 768 records');
 const base=fixture(1,records);
 const rows=base.shared.split('Reference ledger:\n')[1].split('\n').map(JSON.parse);
 const tasks=Array.from({length:254},(_,i)=>{
  const expected=rows[(i*197+31)%records];
  return {id:`lookup-${String(i).padStart(3,'0')}`,question:`Return the reference ledger entry for ${expected.id}.`,seed:1000+i,expected};
 });
 return {...base,revision:'capacity-ledger-v2',tasks:tasks.slice(0,count),prime:tasks[253]};
}

export function validateOutcomes(outcomes,tasks) {
 const seen=new Set();
 return outcomes.map(o=>{
  const task=tasks.find(t=>t.id===o.key),duplicate=seen.has(o.key);seen.add(o.key);
  return {...o,valid:!!task&&!duplicate&&!o.failed&&checkAnswer(o.result??'',task.expected)};
 });
}
