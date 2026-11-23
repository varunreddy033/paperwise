import assert from 'node:assert/strict';
import { detectWithRules, buildShield, restore, leakCheck, sanitizeModelEntities, mergeEntities } from '../public/privacy.js';
import { SAMPLES } from '../public/samples.js';
for (const s of SAMPLES) {
  const ents = detectWithRules(s.text);
  const sh = buildShield(s.text, ents);
  console.log('\n==', s.id); for (const i of sh.items) console.log(' ', i.token.padEnd(14), JSON.stringify(i.text));
  assert.deepEqual(leakCheck(sh.redacted, sh.vault), []);
  assert.equal(restore(sh.redacted, sh.vault).replace(/\s+/g,' '), s.text.replace(/\s+/g,' '));
}
// model entities: hallucinations dropped, loose types mapped
const t = 'Ravi lives at 12 MG Road, Pune';
const m = sanitizeModelEntities(t, [{text:'12 MG Road, Pune',type:'location'},{text:'Bob',type:'PERSON'},{text:'Ravi',type:'name'}]);
assert.equal(m.length, 2); assert.equal(m[0].type,'ADDRESS'); assert.equal(m[1].type,'PERSON');
const sh = buildShield(t, mergeEntities(m));
assert.equal(sh.redacted, '[PERSON_1] lives at [ADDRESS_1]');
assert.deepEqual(restore({a:['Hi [PERSON_1]', 'PERSON_1 at [ADDRESS_1]', '[PERSON_9]']}, sh.vault), {a:['Hi Ravi','Ravi at 12 MG Road, Pune','[PERSON_9]']});
console.log('\nALL PASS');
// false-positive filter
const fp = sanitizeModelEntities('pay Rs. 150.00 before 02-12-2026. DOB: 14/03/1980', [{text:'150.00',type:'OTHER'},{text:'02-12-2026',type:'DOB'},{text:'14/03/1980',type:'DOB'}]);
assert.deepEqual(fp.map(e=>e.text), ['14/03/1980']);
console.log('FP FILTER PASS');
