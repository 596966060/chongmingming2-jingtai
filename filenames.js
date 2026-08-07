/* ============================================================
   filenames.js —— 严格按用户三条命名规则（增强占位处理）
   ============================================================ */

// ---------- 工具 ----------
function cleanIllegal(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '');
}
function collapse_(name) {
  return name.replace(/_+/g, '_').replace(/^_|_$/g, '');
}
function fmtAmt(val) {
  if (!val) return '';
  const n = parseFloat(String(val).replace(/[^\d.\-]/g, ''));
  if (isNaN(n)) return '';
  return Math.abs(n - Math.round(n)) < 0.005
    ? Math.round(n) + '元'
    : n.toFixed(2) + '元';
}

// ---------- 类型判断（供外部调用） ----------
function docType(text) {
  const t = String(text || '').toLowerCase();
  if (/飞机票|航班|登机牌|行程单|机票|air|flight|飞猪|携程.*机票/.test(t)) return '飞机票';
  if (/火车票|高铁|动车|列车|铁路|g\d+|d\d+|t\d+|k\d+|12306/.test(t)) return '火车票';
  if (/住宿|宾馆|酒店|旅店|入住|如家|汉庭|全季/.test(t)) return '住宿费';
  if (/打车|出租车|网约车|滴滴|车费|用车|T3出行|曹操出行/.test(t)) return '打车票';
  if (/合同|协议|甲方|乙方|买方|卖方|采购合同|服务合同/.test(t)) return '合同';
  return '发票';
}

// ---------- 合同方缩写 ----------
function abbrParty(name) {
  if (!name) return '';
  let s = String(name)
    .replace(/[（(][^）)]{1,8}[）)]/g, '')
    .replace(/\s+/g, '');
  const sfx = ['有限责任公司','股份有限公司','集团有限公司','总公司','分公司','有限公司'];
  for (const x of sfx) if (s.endsWith(x)) { s = s.slice(0, -x.length); break; }
  if (s.length > 6) s = s.slice(0, 6);
  return s;
}

// ---------- 1️⃣ 住宿 / 打车 ----------
function genConsume(data, docTypeStr, ext) {
  const date   = (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : '';
  const seller = (data.supplier || '').slice(0, 6);
  const buyer  = (data.buyer    || '').slice(0, 6);
  const type   = docTypeStr;
  const place  = (data.place || data.from_station || '').slice(0, 10);
  const amount = fmtAmt(data.amount);

  const parts = [date, seller, buyer, type, place, amount].filter(Boolean);
  let name = collapse_(cleanIllegal(parts.join('_')));
  if (!date) name = '0000-01-01_' + (name || '未命名');
  return (name || `consume_${Date.now()}`) + ext;
}

// ---------- 2️⃣ 飞机票 / 火车票 ----------
function genTraffic(data, docTypeStr, ext) {
  const date   = (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : '';
  const from   = (data.from_station || '').slice(0, 10);
  const to     = (data.to_station   || '').slice(0, 10);
  const route  = (from && to) ? `${from}-${to}` : (from || to || '');
  const type   = docTypeStr;
  const amount = fmtAmt(data.amount);

  const parts = [date, route, type, amount].filter(Boolean);
  let name = collapse_(cleanIllegal(parts.join('_')));
  if (!date) name = '0000-01-01_' + (name || '未命名');
  return (name || `traffic_${Date.now()}`) + ext;
}

// ---------- 3️⃣ 合同 ----------
function genContract(data, docTypeStr, ext) {
  const date   = (data.sign_date && /^\d{4}-\d{2}-\d{2}$/.test(data.sign_date)) ? data.sign_date : '';
  const name   = (data.contract_name || '合同').slice(0, 15);
  const a      = abbrParty(data.party_a);
  const b      = abbrParty(data.party_b);
  const amount = fmtAmt(data.amount);

  const parts = [date, name, a, b, amount].filter(Boolean);
  let fname = collapse_(cleanIllegal(parts.join('_')));
  if (!date) fname = '0000-01-01_' + (fname || '未命名');
  return (fname || `contract_${Date.now()}`) + ext;
}

// ---------- 统一出口 ----------
function generateFilename(data, docTypeStr, ext) {
  if (docTypeStr === '合同') return genContract(data, docTypeStr, ext);
  if (docTypeStr === '飞机票' || docTypeStr === '火车票') return genTraffic(data, docTypeStr, ext);
  return genConsume(data, docTypeStr, ext);
}

window.FN = { generateFilename, docType };
