// filenames.js —— 确保日期有效
function cleanIllegal(n) { return n.replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/_+/g,'_').replace(/^_|_$/g,''); }
function fmtAmt(v) { if (!v) return ''; let n=parseFloat(String(v).replace(/[^\d.\-]/g,'')); return isNaN(n)?'':(Math.abs(n-Math.round(n))<0.005?Math.round(n)+'元':n.toFixed(2)+'元'); }
function abbr(s) { 
  if (!s) return '';
  s = String(s).replace(/[（(][^）)]{1,10}[）)]/g,'').replace(/\s+/g,'').trim();
  ['有限责任公司','股份有限公司','集团有限公司','总公司','分公司','有限公司','集团'].forEach(x=>{if(s.endsWith(x)) s=s.slice(0,-x.length);});
  s = s.replace(/[（(].*$/,'').trim();
  return s.length>6 ? s.slice(0,6) : s;
}
function place(s) { if(!s)return''; let p=String(s).replace(/\s+/g,'').trim(); ['市','区','县','站','机场','高铁站','火车站'].forEach(x=>{if(p.endsWith(x)&&p.length>2)p=p.slice(0,-x.length);}); return p.length>4?p.slice(0,4):p; }

function getValidDate(d) {
  if (d && d !== '0000-01-01' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  let now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function genConsume(data, type, ext) {
  let date = getValidDate(data.date);
  let parts=[date, abbr(data.supplier)||'未知', abbr(data.buyer)||'未知', type, place(data.place), fmtAmt(data.amount)].filter(Boolean);
  return cleanIllegal(parts.join('_')) + ext;
}
function genTraffic(data, type, ext) {
  let date = getValidDate(data.date);
  let from=place(data.from_station), to=place(data.to_station), route=(from&&to)?from+'-'+to:(from||to||'');
  let parts=[date, route, type, fmtAmt(data.amount||data.price)].filter(Boolean);
  return cleanIllegal(parts.join('_')) + ext;
}
function genContract(data, type, ext) {
  let date = getValidDate(data.sign_date || data.date);
  let name=data.contract_name||'';
  let parts=[date, name||'合同', abbr(data.party_a)||'甲方', abbr(data.party_b)||'乙方', fmtAmt(data.amount)].filter(Boolean);
  return cleanIllegal(parts.join('_')) + ext;
}
function genInvoice(data, type, ext) {
  let date = getValidDate(data.date);
  let parts=[date, abbr(data.supplier), abbr(data.buyer), fmtAmt(data.amount)].filter(Boolean);
  let name=cleanIllegal(parts.join('_')) || (place(data.place)||'发票');
  return name+ext;
}

window.FN = {
  generateFilename(data, type, ext) {
    if (type==='合同') return genContract(data,type,ext);
    if (['飞机票','火车票','打车票'].includes(type)) return genTraffic(data,type,ext);
    if (type==='住宿费') return genConsume(data,type,ext);
    return genInvoice(data,type,ext);
  }
};
