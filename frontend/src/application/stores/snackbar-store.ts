import { create } from "zustand";

export type SnackbarTone = "success" | "error" | "info" | "warning" | "loading";
export type SnackbarOptions = {
  key?: string; scope?: string; title?: string; description?: string;
  action?: { label: string; run: () => void }; origin?: "operation" | "transport";
};
export type SnackbarItem = {
  id: string; tone: SnackbarTone; message: string; title: string; description?: string;
  action?: SnackbarOptions["action"]; key: string; scope: string; origin: "operation" | "transport";
  revision: number; order: number; readyAt: number; durationMs: number | null; closing: boolean;
};
export type SnackbarState = {
  items: SnackbarItem[]; context: string; rotation: number; pulse: number;
  push: (tone: SnackbarTone, message: string, options?: SnackbarOptions) => string;
  remove: (id: string) => void; dismiss: (id: string) => void; clear: () => void;
  setContext: (context: string) => void; advance: () => void; tick: () => void;
};

// Never render HTML or raw implementation details in user-facing feedback.
export function safeNotificationText(value: string): string {
  if (/\b(?:PrismaClient|TypeError:|ReferenceError:|SELECT\s+.+\s+FROM|INSERT\s+INTO)\b|(?:\/Users\/|\/private\/|[A-Z]:\\)|\n\s+at\s/.test(value)) {
    return "Operazione non completata. Verifica l’esito prima di riprovare.";
  }
  return value.replace(/\bBearer\s+\S+|\b(?:sk_live_|sk_test_|whsec_)[\w-]+|\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[riservato]")
    .replace(/\b(password|token|secret|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[riservato]").trim();
}
const priority: Record<SnackbarTone, number> = { error: 0, warning: 1, loading: 2, info: 3, success: 4 };
export function visibleNotifications(state: Pick<SnackbarState, "items" | "rotation">, now = Date.now()) {
  const ready = state.items.filter(item => item.readyAt <= now).sort((a,b) => priority[a.tone]-priority[b.tone] || a.order-b.order);
  if (!ready.length) return [];
  const start = state.rotation % ready.length;
  return [...ready.slice(start), ...ready.slice(0,start)].slice(0,3);
}
export const createSnackbarStore = () => {
  let serial = 0;
  return create<SnackbarState>((set, get) => ({
    items: [], context: "initial", rotation: 0, pulse: 0,
    push: (tone, raw, options = {}) => {
      const state = get();
      if (options.scope !== undefined && options.scope !== state.context) return "";
      const message = safeNotificationText(raw);
      if (!message) return "";
      const title = safeNotificationText(options.title ?? message);
      const description = options.description ? safeNotificationText(options.description) : undefined;
      const key = options.key ?? JSON.stringify([tone,title,description]);
      const previous = state.items.find(item => item.key === key && !item.closing);
      const action = options.action ? {...options.action, label:safeNotificationText(options.action.label)} : undefined;
      if (previous && previous.tone===tone && previous.title===title && previous.description===description && previous.action?.run===action?.run) return previous.id;
      const durationMs = action || ["error","warning","loading"].includes(tone) ? null : tone === "success" ? (message.length>110?8000:4000) : (message.length>160?8000:5000);
      const item: SnackbarItem = {id:previous?.id ?? `notice-${++serial}`,tone,message,title,description,action,key,scope:state.context,
        origin:options.origin ?? "operation",revision:(previous?.revision ?? 0)+1,order:previous?.order ?? serial,
        readyAt:Date.now()+(options.origin==="transport"?120:0),durationMs,closing:false};
      set({items:previous?state.items.map(old=>old.id===previous.id?item:old):[...state.items,item],rotation:0});
      return item.id;
    },
    remove: id => set(state=>({items:state.items.filter(item=>item.id!==id),rotation:0})),
    dismiss: id => set(state=>({items:state.items.map(item=>item.id===id&&!item.closing?{...item,closing:true,durationMs:120,revision:item.revision+1}:item)})),
    clear: () => set({items:[],rotation:0}),
    setContext: context => {if(get().context!==context)set({context,items:[],rotation:0});},
    advance: () => set(state=>({rotation:state.rotation+3})),
    tick: () => set(state=>({pulse:state.pulse+1}))
  }));
};
export const useSnackbarStore = createSnackbarStore();
const notify = (tone: SnackbarTone, message: string, options?: SnackbarOptions) => useSnackbarStore.getState().push(tone,message,options);
export const snackbar = {
  success: (message:string,options?:SnackbarOptions)=>notify("success",message,options),
  error: (message:string,options?:SnackbarOptions)=>notify("error",message,options),
  info: (message:string,options?:SnackbarOptions)=>notify("info",message,options),
  warning: (message:string,options?:SnackbarOptions)=>notify("warning",message,options),
  loading: (message:string,options?:SnackbarOptions)=>notify("loading",message,options),
  dismiss: (id:string)=>useSnackbarStore.getState().dismiss(id),
  capture: ()=>useSnackbarStore.getState().context,
  start: (message:string, options:SnackbarOptions={})=>{
    const scope=options.scope??useSnackbarStore.getState().context;
    const key=options.key??`operation-${globalThis.crypto.randomUUID()}`;
    const id=notify("loading",message,{...options,scope,key});
    return {id, success:(text:string)=>notify("success",text,{scope,key}),error:(text:string)=>notify("error",text,{scope,key}),
      info:(text:string)=>notify("info",text,{scope,key}),warning:(text:string)=>notify("warning",text,{scope,key})};
  }
};
