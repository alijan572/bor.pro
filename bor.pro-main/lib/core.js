export const uid = (prefix='id') => `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
export const cents = value => Math.round((Number(String(value ?? 0).replace(',', '.')) || 0) * 100);
export const money = minor => (Number(minor || 0) / 100).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const qty = n => Number(n || 0).toLocaleString('ru-RU', {maximumFractionDigits: 3});
export const percent = (a,b) => b ? `${(a / b * 100).toLocaleString('ru-RU',{maximumFractionDigits:2})}%` : '—';
export const rubToByn = (rubMinor, coefficient) => coefficient > 0 ? Math.round(rubMinor * coefficient / 1000) : null;
export const bynToRub = (bynMinor, coefficient) => coefficient > 0 ? Math.round(bynMinor * 1000 / coefficient) : null;
export const round99 = minor => minor <= 0 ? minor : Math.floor(minor / 100) * 100 + 99;

export function itemStats(db, itemId, cutoff='9999-12-31') {
  const item = db.items.find(x=>x.id===itemId);
  const moves = db.movements.filter(x=>x.itemId===itemId && x.date<=cutoff);
  const sum = type => moves.filter(x=>x.type===type).reduce((s,x)=>s+x.qty,0);
  const received=sum('receipt'), defects=sum('defect')+sum('return_defect');
  const sold=sum('sale'), customerReturns=sum('customer_return');
  const writeoffs=sum('writeoff'), supplierReturns=sum('supplier_return');
  const goodReceived=received-sum('defect');
  const available=goodReceived-sold+customerReturns-sum('return_defect')-writeoffs-supplierReturns;
  return { ordered:item?.orderedQty||0, received, defects, goodReceived, sold:sold-customerReturns, writeoffs, supplierReturns, available };
}

export function shipmentStats(db, shipmentId, cutoff='9999-12-31') {
  const shipment=db.shipments.find(x=>x.id===shipmentId);
  const items=db.items.filter(x=>x.shipmentId===shipmentId);
  const rows=items.map(i=>({...i,...itemStats(db,i.id,cutoff)}));
  const total=k=>rows.reduce((s,r)=>s+Number(r[k]||0),0);
  const ordered=total('ordered'), received=total('received'), goodReceived=total('goodReceived');
  const shortage=shipment?.receptionClosed ? Math.max(ordered-received,0):0;
  const expected=shipment?.receptionClosed ? 0:Math.max(ordered-received,0);
  const surplus=Math.max(received-ordered,0);
  const sales=db.sales.filter(s=>s.shipmentIds?.includes(shipmentId) && s.date<=cutoff);
  const returns=db.returns.filter(r=>sales.some(s=>s.id===r.saleId) && r.date<=cutoff);
  const revenue=sales.reduce((s,x)=>s+(x.revenueRubMinor ?? x.totalMinor),0)-returns.reduce((sum,x)=>{const sale=sales.find(s=>s.id===x.saleId);const rub=sale?.currency==='RUB'?x.refundMinor:Math.round(x.refundMinor*1000/(sale?.coefficient||1000));return sum+(x.refundRubMinor ?? rub)},0);
  const cogs=sales.reduce((s,x)=>s+x.cogsMinor,0)-returns.reduce((s,x)=>s+x.cogsMinor,0);
  const gross=revenue-cogs;
  return {ordered,received,expected,shortage,surplus,defects:total('defects'),sold:total('sold'),available:total('available'),goodReceived,revenue,cogs,gross,margin:percent(gross,revenue),markup:percent(gross,cogs),soldPercent:percent(total('sold'),goodReceived),rows};
}

export function fifoAllocations(db, itemName, wantedQty, preferredItemId=null) {
  const candidates=db.items.filter(i=>i.name.toLowerCase()===itemName.toLowerCase()).map(i=>({...i,available:itemStats(db,i.id).available,shipment:db.shipments.find(s=>s.id===i.shipmentId)})).filter(i=>i.available>0).sort((a,b)=>{
    if (a.id===preferredItemId) return -1; if (b.id===preferredItemId) return 1;
    return (a.shipment?.date||'').localeCompare(b.shipment?.date||'');
  });
  let left=Number(wantedQty); const allocations=[];
  for (const item of candidates) { const take=Math.min(left,item.available); if(take>0) allocations.push({itemId:item.id,qty:take,unitCostMinor:item.purchaseMinor,shipmentId:item.shipmentId}); left-=take; if(left<=0) break; }
  return {allocations,left};
}

export function validateBackup(data) {
  const required=['meta','settings','factories','suppliers','shipments','items','movements','sales','returns','expenses','compensations','audit'];
  if(!data || typeof data!=='object') return {ok:false,error:'Файл не содержит резервную копию.'};
  if(!required.every(k=>k in data)) return {ok:false,error:'В резервной копии не хватает обязательных разделов.'};
  if(!Number.isInteger(data.meta?.schemaVersion) || data.meta.schemaVersion<1) return {ok:false,error:'Неизвестная версия структуры данных.'};
  if(!required.slice(2).every(k=>Array.isArray(data[k]))) return {ok:false,error:'Повреждена структура списков.'};
  return {ok:true,counts:Object.fromEntries(required.slice(2).map(k=>[k,data[k].length]))};
}
