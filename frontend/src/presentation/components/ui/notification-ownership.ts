import {translateText} from '../../i18n/fleetum-language';
const normal=(text:string)=>(text??'').replace(/\s+/g,' ').trim();
export function claimedInline(message:string,language:'it'|'en'){
 const texts=[normal(message),normal(translateText(message,language))];
 const front=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(element=>element.getClientRects().length>0).at(-1)??document;
 return Array.from(front.querySelectorAll<HTMLElement>('[role="alert"],[role="status"]')).some(element=>
  !element.closest('.fleetum-notices')&&element.getClientRects().length>0&&texts.includes(normal(element.textContent??'')));
}
