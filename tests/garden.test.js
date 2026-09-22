import test from 'node:test';
import assert from 'node:assert/strict';
import {gardenFor, speciesFor} from '../src/garden-model.js';
import {validateHours} from '../server/garden.js';

const visit = {id:'p1',owner:'a',eventId:'e1',status:'done',confirmed:true,when:'2026-09-18T09:00:00Z',completedAt:'2026-09-18T12:00:00Z',hours:2,event:{category:'animals'}};
test('Resources are deterministic and duplicate visits cannot multiply rewards',()=>{
  const plans=[visit,{...visit,id:'duplicate'},{...visit,id:'other',owner:null},{...visit,id:'draft',status:'draft'}];
  const g=gardenFor(plans,'a');
  assert.equal(g.water,130);assert.equal(g.sunlight,100);assert.equal(g.objects.length,1);
  assert.deepEqual(g,gardenFor(plans,'a'));
  assert.equal(g.objects[0].species,'animals');
});
test('Cancelled preparations retain earned water; repeat visits add plants, not preparation awards',()=>{
  const g=gardenFor([visit,{...visit,id:'p2',when:'2026-09-19T09:00:00Z'},{...visit,id:'cancel',eventId:'e2',status:'cancelled',confirmed:false,agreedAt:'2026-09-17'}],'a');
  assert.equal(g.water,260);assert.equal(g.objects.length,2);assert.equal(g.hours,4);
  assert.equal(gardenFor([visit], 'b').water,0);
});
test('Rewards unlock without daily streak requirements',()=>{
  const plans=Array.from({length:10},(_,i)=>({...visit,id:String(i),when:`2026-${String(i+1).padStart(2,'0')}-01`}));
  const g=gardenFor(plans,'a');assert.ok(g.rare&&g.bench&&g.pond);assert.equal(g.level,4);
  assert.equal(speciesFor({id:'11521651',category:'people'}),'elderly');
});
test('Hours are bounded and do not accept coerced or non-finite input',()=>{
  for(const x of [-1,25,Infinity,NaN,'2',{},0.1,null]) assert.throws(()=>validateHours(x));
  assert.equal(validateHours(),0);assert.equal(validateHours(1.5),1.5);
});
