import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { getStoredTheme, setTheme } from '../../../infrastructure/theme/theme-manager';
import { useFleetumLanguage } from '../../i18n/fleetum-language';
import { FleetumLanguageSwitcher } from '../i18n/fleetum-language-switcher';
import '../../styles/access-workspace.css';

export function AccessBrandBar() {
  const [theme, setMode] = useState(getStoredTheme);
  const { language } = useFleetumLanguage();
  const backLabel = language === "en" ? "Back to website" : "Torna al sito";
  return <nav className="access-brand-bar" aria-label="Navigazione accesso"><Link to="/" className="access-brand"><img src={theme === "dark" ? "/brand/fleetum-symbol-for-dark-bg.svg" : "/brand/fleetum-symbol-color.svg"} alt=""/><span>Fleetum</span></Link><div><Link to="/" className="access-back" aria-label={backLabel}><ArrowLeft aria-hidden="true" size={16}/><span>{backLabel}</span></Link><FleetumLanguageSwitcher/><button type="button" className="access-theme" aria-label={language === "en" ? "Change colour theme" : "Cambia tema"} onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); setMode(next); }}>{theme === 'dark' ? <Sun aria-hidden="true" size={18}/> : <Moon aria-hidden="true" size={18}/>}</button></div></nav>;
}
export function AccessShell({title,description,wide=false,children}:{title:string;description:string;wide?:boolean;children:ReactNode}) {
  return <main className={`workspace-shell access-shell${wide?' access-shell-wide':''}`}><div className="access-workspace"><AccessBrandBar/><section className="access-card"><header className="access-header"><p className="workspace-eyebrow">ACCESSO FLEETUM</p><h1>{title}</h1><p>{description}</p></header>{children}</section></div></main>;
}
export function AccessNotice({children,tone='error',focus=false}:{children:ReactNode;tone?:'error'|'success'|'info';focus?:boolean}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if(focus) ref.current?.focus(); },[focus,tone]);
  return <div ref={ref} tabIndex={focus?-1:undefined} className={`access-notice access-notice-${tone}`} role={tone==='error'?'alert':'status'}>{children}</div>;
}
export function AccessPassword({id,name='password',label='Nuova password',error,description,disabled=false}:{id:string;name?:string;label?:string;error?:string;description?:string;disabled?:boolean}) {
  const [visible, setVisible] = useState(false);
  const described = [description?`${id}-hint`:null,error?`${id}-error`:null].filter(Boolean).join(' ') || undefined;
  return <div className="access-field"><label htmlFor={id}>{label}</label><div className="access-password"><input id={id} name={name} type={visible?'text':'password'} autoComplete="new-password" required minLength={8} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={described}/><button type="button" aria-label={`${visible?'Nascondi':'Mostra'} ${label.toLowerCase()}`} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(value => !value)}>{visible?'Nascondi':'Mostra'}</button></div>{description?<p className="access-hint" id={`${id}-hint`}>{description}</p>:null}{error?<p className="access-field-error" id={`${id}-error`}>{error}</p>:null}</div>;
}
