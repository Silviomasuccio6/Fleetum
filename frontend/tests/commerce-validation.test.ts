import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseTiers,validatePricing} from '../src/presentation/components/pricing/pricing-validation';
import {ContractTemplateEditor} from '../src/presentation/components/contracts/contract-template-editor';
import {rentalPricingCreateListSchema,rentalPricingCreatePackageSchema,rentalPricingCreateExtraPolicySchema} from '../../backend/src/interfaces/http/validators/rental-bookings-validators';
import {translateText,reverseTranslateText} from '../src/presentation/i18n/fleetum-language';
const list=()=>({name:'Synthetic plan',baseRateAmount:'0',vatRate:'22',discountPercent:'0',priority:'100',scope:'GLOBAL',validFrom:'2026-10-23',validTo:'2026-12-31'});
test('price list boundaries agree with server schema and retain a zero base rate',()=>{
 const f={...list(),name:'a'.repeat(150)};assert.deepEqual(validatePricing('list',f),{});assert.equal(rentalPricingCreateListSchema.safeParse(f).success,true);
 assert.ok(validatePricing('list',{...f,name:'a'.repeat(151)}).name);assert.ok(validatePricing('list',{...f,baseRateAmount:''}).baseRateAmount);
 for(const [key,value] of [['vatRate','101'],['discountPercent','-1'],['priority','1.5'],['baseRateAmount','NaN']])assert.ok(validatePricing('list',{...f,[key]:value})[key]);
});
test('pricing requires scoped references and rejects impossible or reversed calendar dates',()=>{
 for(const [scope,key]of [['SITE','siteId'],['VEHICLE','vehicleId'],['VEHICLE_CATEGORY','vehicleCategory']])assert.ok(validatePricing('list',{...list(),scope})[key]);
 assert.ok(validatePricing('list',{...list(),validFrom:'2026-02-30'}).validFrom);assert.ok(validatePricing('list',{...list(),validTo:'2026-01-01'}).validTo);
 assert.deepEqual(validatePricing('list',{...list(),validFrom:'2028-02-29',validTo:'2028-02-29'}),{});
});
test('limited and unlimited mileage keep the server domain rules',()=>{
 const f={name:'Mileage',type:'LIMITED',kmIncluded:'100',sortOrder:'0'};assert.deepEqual(validatePricing('package',f),{});assert.equal(rentalPricingCreatePackageSchema.safeParse(f).success,true);
 for(const kmIncluded of ['0','-1','1.5','NaN'])assert.ok(validatePricing('package',{...f,kmIncluded}).kmIncluded);
 const unlimited={...f,type:'UNLIMITED',kmIncluded:undefined};assert.deepEqual(validatePricing('package',unlimited),{});assert.equal(rentalPricingCreatePackageSchema.safeParse(unlimited).success,true);
});
test('tier parser retains comma/equal/wildcard syntax and policies match the server',()=>{
 const tiers=parseTiers('1-100=0,40\n101-*:0.30');assert.deepEqual(tiers,[{fromKm:1,toKm:100,ratePerKm:.4,sortOrder:0},{fromKm:101,toKm:null,ratePerKm:.3,sortOrder:1}]);
 assert.equal(rentalPricingCreateExtraPolicySchema.safeParse({name:'Tiered',type:'TIERED',tiers}).success,true);
 const f={name:'Tiered',type:'TIERED',tiersText:'1-100=0,40\n101-*:0.30',sortOrder:'0'};assert.deepEqual(validatePricing('policy',f),{});
 for(const tiersText of ['','broken','1.5-100:0.4','10-1:0.2','1-100:-1'])assert.ok(validatePricing('policy',{...f,tiersText}).tiersText);
 assert.deepEqual(validatePricing('policy',{name:'Free extra',type:'FLAT',flatRatePerKm:'0',sortOrder:'0'}),{});
});
test('contract template keeps all thirteen controlled fields and escapes preview text',()=>{
 const value={name:'Template',content:'<script>unsafe</script>',emailSubject:'Subject',emailBody:'Body',companyName:'Synthetic',companyAddress:'Test address',companyVat:'00000000000',companyEmail:'qa@example.invalid',companyPhone:'000',brandPrimary:'#123456',brandAccent:'#abcdef',brandFont:'helvetica'};
 const html=renderToStaticMarkup(React.createElement(ContractTemplateEditor,{value,onChange:()=>{},busy:false,logoUrl:null,logoName:'',onUpload:()=>{},onRemove:()=>{},preview:{content:value.content,emailSubject:'Subject',emailBody:'Body'}}));
 for(const key of Object.keys(value))assert.ok(html.includes('id="contract-template-'+key+'"'),key);
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.equal((html.match(/<code>/g)||[]).length,23);
});
test('commerce controls, validation and dynamic accessible names translate both ways',()=>{
 for(const text of ['Nome listino','Nome pacchetto','Nome tariffario','Pacchetto predefinito','Tariffario predefinito','Anteprima compilata','Logo intestazione','Sezioni listino','Firma contratto','Canvas firma contratto','Modalità sola lettura.','Inserisci un nome tra 2 e 150 caratteri.'])assert.notEqual(translateText(text,'en'),text,text);
 assert.equal(translateText('Apri listino Synthetic','en'),'Open price list Synthetic');assert.equal(reverseTranslateText('Open price list Synthetic'),'Apri listino Synthetic');assert.equal(translateText('Nome listino','it'),'Nome listino');
});
