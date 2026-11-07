import assert from "node:assert/strict";
import test from "node:test";
import {captureOperationContext,publishOperationFeedback} from "../src/application/stores/operation-feedback";
import {useSnackbarStore} from "../src/application/stores/snackbar-store";

test("a confirmed save keeps its inline result and emits one finite compact confirmation",()=>{
 const store=useSnackbarStore.getState();store.clear();store.setContext("synthetic-save");let inline="";
 publishOperationFeedback(value=>{inline=value},"Cliente salvato",captureOperationContext());
 assert.equal(inline,"Cliente salvato");assert.equal(useSnackbarStore.getState().items.length,1);
 assert.equal(useSnackbarStore.getState().items[0].durationMs,3000);
});
test("a queue acknowledgment keeps its exact intent and uses informational feedback",()=>{
 useSnackbarStore.getState().clear();let inline="";
 publishOperationFeedback(value=>{inline=value},"Invio email contratto accodato.",captureOperationContext(),"info");
 const item=useSnackbarStore.getState().items[0];assert.equal(inline,"Invio email contratto accodato.");
 assert.equal(item.message,inline);assert.equal(item.tone,"info");assert.equal(item.durationMs,4000);
});
test("an old operation cannot update either the inline feedback or the popup after a context change",()=>{
 useSnackbarStore.getState().setContext("synthetic-a");const scope=captureOperationContext();
 useSnackbarStore.getState().setContext("synthetic-b");useSnackbarStore.getState().setContext("synthetic-a");let writes=0;
 publishOperationFeedback(()=>{writes++},"Vecchio esito",scope);
 assert.equal(writes,0);assert.equal(useSnackbarStore.getState().items.length,0);
});
test("clearing an inline message never manufactures a success notification",()=>{
 useSnackbarStore.getState().clear();let inline:string|null="Previous";
 publishOperationFeedback<string|null>(value=>{inline=value},null,captureOperationContext());
 assert.equal(inline,null);assert.equal(useSnackbarStore.getState().items.length,0);
});
