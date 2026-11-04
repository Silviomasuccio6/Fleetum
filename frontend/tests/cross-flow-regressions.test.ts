import {createElement} from "react";
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {DashboardOverview} from '../src/presentation/components/dashboard/dashboard-overview';
import {translateTextNode,translateElementAttributes} from '../src/presentation/components/i18n/global-text-translator';
import {CustomerCollection} from '../src/presentation/components/customers/customer-workspace';

test('upcoming dashboard work excludes finished and already dispatched pickups',()=>{
 const rows=['CLOSED','CANCELED','NO_SHOW','IN_RENT','CONFIRMED'].map(status=>({id:status,code:'PICKUP_'+status,customer:'Synthetic '+status,status,pickupAt:'2026-11-01T09:00:00Z',returnAt:'2026-11-03T09:00:00Z'}));
 const html=renderToStaticMarkup(DashboardOverview({booking:{kpis:{},lists:{nextPickups:rows,nextReturns:rows.map(row=>({...row,code:row.code.replace('PICKUP','RETURN')})),criticalBookings:[]}},canOpenBookings:true,canOpenCustomers:true,onNavigate(){}}));
 for(const status of ['CLOSED','CANCELED','NO_SHOW','IN_RENT'])assert.ok(!html.includes('PICKUP_'+status),'pickup '+status);
 for(const status of ['CLOSED','CANCELED','NO_SHOW'])assert.ok(!html.includes('RETURN_'+status),'return '+status);
 assert.ok(html.includes('PICKUP_CONFIRMED'));assert.ok(html.includes('RETURN_IN_RENT'));
});
test('native non-translatable business data keeps its exact spelling in both languages',()=>{
 let value='Veicoli';const node={parentElement:{tagName:'STRONG',closest(selector:string){return selector.includes('translate')?{}:null}},get textContent(){return value},set textContent(next:string){value=next}}as unknown as Text;
 for(const language of ['en','it','en']as const){translateTextNode(node,language);assert.equal(value,'Veicoli')}
});
test('opaque data attributes are not translated',()=>{
 const attrs=new Map([['title','Veicoli'],['aria-label','Veicoli']]);const node={closest(selector:string){return selector.includes('translate')?{}:null},getAttribute:(key:string)=>attrs.get(key)||null,setAttribute:(key:string,value:string)=>attrs.set(key,value)}as unknown as Element;
 translateElementAttributes(node,'en');assert.equal(attrs.get('title'),'Veicoli');assert.equal(attrs.get('aria-label'),'Veicoli');
});
test('Italian labels with an English homograph keep their Italian meaning',()=>{
 let value='Note';const node={parentElement:{tagName:'SPAN'},get textContent(){return value},set textContent(next:string){value=next}}as unknown as Text;translateTextNode(node,'it');assert.equal(value,'Note');translateTextNode(node,'en');translateTextNode(node,'it');assert.equal(value,'Note');
});
test('customer identities are explicitly opaque in the rendered collection',()=>{
 const html=renderToStaticMarkup(CustomerCollection({rows:[{id:'synthetic',customerType:'PERSONA_GIURIDICA',companyName:'Veicoli',updatedAt:'2026-10-25T10:00:00Z',contractsTotal:0,attachmentsTotal:0}]as any,onOpen(){}}));assert.match(html,/<strong[^>]*translate="no"[^>]*>Veicoli<\/strong>/);
});

import {WeekView} from '../src/presentation/components/calendar/views/WeekView';
import {DayView} from '../src/presentation/components/calendar/views/DayView';
import {MonthView} from '../src/presentation/components/calendar/views/MonthView';
import {CalendarSidebar} from '../src/presentation/components/calendar/CalendarSidebar';
test('calendar views expose native date buttons without an incomplete ARIA grid',()=>{
 const date=new Date(2026,9,25);const noop=()=>{};const props={viewDate:date,miniDate:date,selDay:date,events:[],calendars:[],onPickDay:noop,onEventClick:noop,onEventResizeEnd:noop,onEventMoveEnd:noop,onCreateAt:noop,onMiniNav:noop,onToggleCalendar:noop,onCreateEvent:noop,hasEventsOnDate:()=>false};
 for(const View of [WeekView,DayView,MonthView,CalendarSidebar]){
  const html=renderToStaticMarkup(createElement(View as any,props));assert.ok(!html.includes('role="grid"'),View.name+' must not advertise unsupported grid navigation');
  if(View!==DayView){assert.match(html,/aria-label="[^"]*2026[^"]*"/);assert.match(html,/aria-pressed="true"/)}
 }
});

test('calendar date labels follow the selected interface language',()=>{
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{Object.defineProperty(globalThis,'window',{value:{},configurable:true});
 for(const language of ['it','en']){Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>language},configurable:true});
 const date=new Date(2026,9,25),noop=()=>{},props={viewDate:date,miniDate:date,selDay:date,events:[],calendars:[],onPickDay:noop,onEventClick:noop,onEventResizeEnd:noop,onEventMoveEnd:noop,onCreateAt:noop,onMiniNav:noop,onToggleCalendar:noop,onCreateEvent:noop,hasEventsOnDate:()=>false};
 for(const View of [WeekView,DayView,MonthView,CalendarSidebar]){const html=renderToStaticMarkup(createElement(View as any,props));assert.ok(html.includes(language==='en'?'Sunday':'domenica'),View.name+' '+language)}
 }}finally{if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else Reflect.deleteProperty(globalThis,'localStorage')}
});
