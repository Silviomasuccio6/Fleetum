import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useAnchoredMenu } from "../../hooks/use-anchored-menu";

type Option = { value: string; label: string };
type Props = {
  id: string; value: string; options: Option[]; disabled?: boolean;
  describedBy?: string; title?: string; onValueChange: (value: string) => void;
};

/** Select-only combobox; focus stays on the trigger, arrows explore, Enter commits. */
export function AnchoredSelect({ id, value, options, disabled, describedBy, title, onValueChange }: Props) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typeahead = useRef({ text: "", at: 0 });
  const { root, position } = useAnchoredMenu(open, () => setOpen(false));
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const expanded = open && !disabled;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (expanded) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, expanded, listId]);
  const choose = (index: number) => {
    if (disabled || !options[index]) return;
    setOpen(false); trigger.current?.focus();
    onValueChange(options[index].value);
  };
  return <div ref={root} className="anchored-select" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={trigger} id={id} type="button" role="combobox" aria-haspopup="listbox"
      aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
      aria-describedby={describedBy} disabled={disabled} title={title}
      className="site-context-select" onClick={() => { trigger.current?.focus(); setActive(selected); setOpen(!open); }}
      onKeyDown={event => {
        if (event.key === "Tab") { setOpen(false); return; }
        if (event.key === "Escape") { if (expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          if (!expanded) { setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : selected); setOpen(true); return; }
          if (event.key === "Enter" || event.key === " ") { choose(active); return; }
          setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          const now = Date.now(), previous = typeahead.current;
          const text = now - previous.at < 700 ? previous.text + event.key : event.key;
          typeahead.current = { text, at: now };
          const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()));
          if (index >= 0) { setActive(index); setOpen(true); }
        }
      }}><span>{options[selected]?.label}</span><ChevronDown aria-hidden="true" size={14}/></button>
    {expanded ? <div id={listId} role="listbox" aria-label="Sede" className="site-context-options"
      data-above={position.above} style={{ maxHeight: position.maxHeight }}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={option.value === value} data-active={index === active}
        onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()}
        onClick={() => choose(index)}><span>{option.label}</span>{option.value === value ? <Check aria-hidden="true" size={15}/> : null}</div>)}
    </div> : null}
  </div>;
}
