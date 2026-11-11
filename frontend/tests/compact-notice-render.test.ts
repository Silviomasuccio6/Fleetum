import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {CompactNotice} from '../src/presentation/components/ui/compact-notice';
import {createSnackbarStore} from '../src/application/stores/snackbar-store';
const render=(tone:any,message:string,options:any={},language:'it'|'en'='it')=>{const s=createSnackbarStore();s.getState().push(tone,message,options);return renderToStaticMarkup(React.createElement(CompactNotice,{item:s.getState().items[0],pause:()=>{},keyboard:{current:true},language}))};
test('confirmation uses the compact capsule with a specific message and accessible close action',()=>{const html=render('success','Cliente salvato');assert.match(html,/fleetum-notice--compact/);assert.match(html,/role="status"/);assert.match(html,/Cliente salvato/);assert.match(html,/aria-label="Chiudi notifica"/);assert.doesNotMatch(html,/SUCCESSO|autofocus|autoFocus/)});
test('error preserves its full long explanation and alert semantics',()=>{const message='Veicolo non disponibile. '+('Descrizione sintetica lunga. '.repeat(20));const html=render('error',message);assert.match(html,/role="alert"/);assert.ok(html.includes(message.trim()));assert.match(html,/fleetum-notice--compact/);assert.doesNotMatch(html,/line-clamp/)});
test('loading, warnings and information share an explicit state without false success',()=>{for(const tone of ['loading','warning','info']){const html=render(tone,'Messaggio sintetico');assert.match(html,new RegExp('fleetum-notice--'+tone));assert.doesNotMatch(html,/fleetum-notice--success/)} });
test('description and real action keep a detailed surface and translated close control',()=>{const html=render('info','Verifica richiesta',{description:'Controlla la prenotazione.',action:{label:'Apri dettaglio',run:()=>{}}},'en');assert.match(html,/fleetum-notice--compact/);assert.match(html,/Dismiss notification/);assert.match(html,/Open details/)});
test('message markup is escaped rather than interpreted as a page element',()=>{const html=render('error','<img src=x onerror=synthetic>');assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/)});
test('an inline-owned explanation keeps its visible compact popup without a duplicate live announcement',()=>{
 const s=createSnackbarStore();s.getState().push('error','Verifica richiesta');
 const html=renderToStaticMarkup(React.createElement(CompactNotice,{item:s.getState().items[0],pause:()=>{},keyboard:{current:true},language:'it',announce:false}));
 assert.match(html,/fleetum-notice--compact/);assert.match(html,/Verifica richiesta/);assert.match(html,/aria-live="off"/);assert.doesNotMatch(html,/role="alert"/);
});

import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import ts from 'typescript';
const motionSource=readFileSync(new URL('../src/presentation/components/ui/compact-notice.tsx',import.meta.url),'utf8');const ast=ts.createSourceFile('notice.tsx',motionSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let motion='';function walk(node:ts.Node){if(!motion&&ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect')motion=node.arguments[0].getText(ast);ts.forEachChild(node,walk)}walk(ast);
function motionHarness(keyboard:boolean,reduced:boolean){let entered=0,cancelled=0;const callback=runInNewContext(ts.transpileModule('('+motion+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{keyboard:{current:keyboard},window:{matchMedia:()=>({matches:reduced})},ref:{current:{animate:()=>{entered++;return{cancel:()=>cancelled++}}}}});const cleanup=callback();return{get entered(){return entered},get cancelled(){return cancelled},cleanup};}
test('keyboard-triggered feedback does not play an entrance animation',()=>{assert.equal(motionHarness(true,false).entered,0)});
test('reduced motion skips the positional entrance',()=>{assert.equal(motionHarness(false,true).entered,0)});
test('pointer entrance has a cancellable animation cleaned up on removal',()=>{const h=motionHarness(false,false);assert.equal(h.entered,1);h.cleanup();assert.equal(h.cancelled,1)});
