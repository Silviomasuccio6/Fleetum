import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedSearchSections,matchSections} from '../src/presentation/components/layout/section-search-model';
const entries=[
 {label:'Prenotazioni',to:'/booking',group:'Operatività'},
 {label:'Statistiche',to:'/statistiche',group:'Gestione'},
 {label:'Clienti',to:'/anagrafiche/clienti',group:'Anagrafiche'},
 {label:'Piano e fatturazione',to:'/upgrade',group:'Gestione'},
 {label:'Profilo azienda',to:'/profilo/azienda',group:'Azienda'},
 {label:'Profilo e impostazioni',to:'/profilo',group:'Account'},
 {label:'Non classificata',to:'/unknown',group:'Altro'},
];
test('search excludes ungranted sections, billing outside company view and unknown destinations',()=>{
 const result=allowedSearchSections(entries,['vehicles:read'],false,false);
 assert.deepEqual(result.map(e=>e.to),['/booking','/anagrafiche/clienti','/profilo']);
});
test('wildcard does not bypass company scope or grant unknown destinations',()=>{
 const result=allowedSearchSections(entries,['*'],false,false);
 assert.equal(result.some(e=>e.to==='/profilo/azienda'||e.to==='/upgrade'||e.to==='/unknown'),false);
 assert.equal(allowedSearchSections(entries,['*'],true,true).length,6);
});
test('lookup tolerates accents, case, surrounding spaces and matches multiple words',()=>{
 assert.deepEqual(matchSections(entries,' OPERATIVITA preno '),[entries[0]]);
 assert.deepEqual(matchSections(entries,'gestione fatturazione'),[entries[3]]);
 assert.deepEqual(matchSections(entries,'cliente inesistente'),[]);
 assert.equal(matchSections(entries,' ').length,entries.length);
});
test('a context change recomputes the catalogue rather than retaining formerly allowed entries',()=>{
 assert.ok(allowedSearchSections(entries,['*'],true,true).some(e=>e.to==='/profilo/azienda'));
 assert.deepEqual(matchSections(allowedSearchSections(entries,[],false,false),'azienda'),[]);
});
