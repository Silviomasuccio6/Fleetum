import { useEffect, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { SnackbarItem, useSnackbarStore } from "../../../application/stores/snackbar-store";

const PlatformToast = ({ item }: { item: SnackbarItem }) => {
  const remove = useSnackbarStore((state) => state.remove);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => remove(item.id), item.tone === "error" ? 7000 : 4000);
    return () => window.clearTimeout(timer);
  }, [item.id, item.tone, paused, remove]);
  const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? TriangleAlert : Info;
  return (
    <div className="satin-toast" data-tone={item.tone} role={item.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
      <Icon size={18} aria-hidden="true" /><p>{item.message}</p>
      <button type="button" onClick={() => remove(item.id)} aria-label="Chiudi notifica"><X size={15} /></button>
    </div>
  );
};

export const PlatformSnackbarViewport = () => {
  const items = useSnackbarStore((state) => state.items);
  return <div className="satin-toasts" aria-label="Notifiche">{items.map((item) => <PlatformToast item={item} key={item.id} />)}</div>;
};
