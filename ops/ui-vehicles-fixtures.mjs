// Synthetic local data only, never imported by product source.
export function vehiclesFixture({scenario,vehicles,sites,params}) {
  const many=scenario==='many';
  const all=scenario==='empty'?[]:Array.from({length:many?62:vehicles.length},(_,i)=>{
    const source=vehicles[i%vehicles.length],site=sites[i%sites.length];
    return {...source,id:`demo-vehicle-${i+1}`,siteId:site.id,site:many?{...site,name:'Sede dimostrativa per mobilità aziendale e noleggio internazionale — area operativa molto lunga'}:site,plate:`QA${String(101+i)}AA`,brand:many?'Costruttore dimostrativo':source.brand,model:many?'Modello per noleggio con denominazione estesa e allestimento professionale':source.model,year:2020+i%5,isActive:i%7!==3,currentKm:i===0?0:12000+i*1450,maintenanceIntervalKm:15000,registrationDate:'2022-11-15T12:00:00Z',lastRevisionAt:null,revisionDueAt:'2026-11-30T12:00:00Z',purchasePrice:23000+i*1000,residualValue:14000,monthlyFixedCost:145,purchaseDate:'2023-01-20T12:00:00Z',notes:'Dati sintetici per il collaudo della flotta. Nessun dato reale.',booklet:i===0?{id:'qa-booklet-1',fileName:'libretto-sintetico.png',mimeType:'image/png',sizeBytes:128}:null};
  });
  const query=(params.get('search')||'').trim().toLowerCase();
  const filtered=all.filter(v=>`${v.plate} ${v.brand} ${v.model} ${v.site.name} ${v.site.city}`.toLowerCase().includes(query));
  const page=Math.max(1,Number(params.get('page'))||1),pageSize=Math.min(200,Math.max(1,Number(params.get('pageSize'))||20));
  return {data:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,page,pageSize};
}
