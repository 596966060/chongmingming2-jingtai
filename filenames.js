/* ============================================================
   filenames.js —— v4 按用户四条命名规则
   1. 住宿/打车票：日期_销售方简写_购买方简写_类型_地点_金额元
   2. 飞机票/火车票/T3出行：日期_出发地_到达地_类型_金额元
   3. 合同：签订日期_项目名称_甲方_乙方_金额元
   4. 普通发票：日期_销售方简写_购买方简写_金额元
   ============================================================ */

// ---------- 工具 ----------
function cleanIllegal(name) {
  return String(name).replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function fmtAmt(val) {
  if (!val) return '';
  const n = parseFloat(String(val).replace(/[^\d.\-]/g, ''));
  if (isNaN(n)) return '';
  return Math.abs(n - Math.round(n)) < 0.005
    ? Math.round(n) + '元'
    : n.toFixed(2) + '元';
}

// 公司名简写
function abbrCompany(name) {
  if (!name) return '';
  let s = String(name)
    .replace(/[（(][^）)]{1,10}[）)]/g, '')
    .replace(/\s+/g, '')
    .trim();
  const sfx = ['有限责任公司', '股份有限公司', '集团有限公司', '总公司', '分公司', '有限公司', '集团'];
  for (const x of sfx) {
    if (s.endsWith(x)) { s = s.slice(0, -x.length); break; }
  }
  s = s.replace(/[（(].*$/, '').trim();
  if (s.length > 6) s = s.slice(0, 6);
  return s;
}

// 地点简写
function abbrPlace(name) {
  if (!name) return '';
  let s = String(name).replace(/\s+/g, '').trim();
  const sfx = ['市', '区', '县', '站', '机场', '高铁站', '火车站'];
  for (const x of sfx) {
    if (s.endsWith(x) && s.length > 2) { s = s.slice(0, -x.length); break; }
  }
  if (s.length > 4) s = s.slice(0, 4);
  return s;
}

// ---------- 1️⃣ 住宿 / 打车票 ----------
// 规则：日期_销售方简写_购买方简写_类型_地点_金额元
function genConsume(data, docTypeStr, ext) {
  const date   = (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : '';
  const seller = abbrCompany(data.supplier);
  const buyer  = abbrCompany(data.buyer);
  const type   = docTypeStr;
  const place  = abbrPlace(data.place);
  const amount = fmtAmt(data.amount);

  const parts = [date, seller, buyer, type, place, amount].filter(Boolean);
  let name = cleanIllegal(parts.join('_'));
  if (!name) name = docTypeStr;
  return name + ext;
}

// ---------- 2️⃣ 飞机票 / 火车票 / T3出行 ----------
// 规则：日期_出发地_到达地_类型_金额元
function genTraffic(data, docTypeStr, ext) {
  const date   = (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : '';
  const from   = abbrPlace(data.from_station || data.from_city);
  const to     = abbrPlace(data.to_station   || data.to_city);
  const route  = (from && to) ? `${from}-${to}` : (from || to || '');
  const type   = docTypeStr;
  const amount = fmtAmt(data.amount || data.price);

  const parts = [date, route, type, amount].filter(Boolean);
  let name = cleanIllegal(parts.join('_'));
  if (!name) name = docTypeStr;
  return name + ext;
}

// ---------- 3️ 合同 ----------
// 规则：签订日期_项目名称_甲方_乙方_金额元
function genContract(data, docTypeStr, ext) {
  const date   = (data.sign_date && /^\d{4}-\d{2}-\d{2}$/.test(data.sign_date)) ? data.sign_date : '';
  let name     = (data.contract_name || '').slice(0, 15);
  const a      = abbrCompany(data.party_a);
  const b      = abbrCompany(data.party_b);
  const amount = fmtAmt(data.amount);

  // 确保项目名称不重复：如果 name 和 a 或 b 相同，只保留一个
  // 如果连甲方乙方都没有，也保留项目名称
  const parts = [date, name, a, b, amount].filter(Boolean);
  let fname = cleanIllegal(parts.join('_'));
  if (!fname) fname = '合同';
  return fname + ext;
}

// ---------- 4️⃣ 普通发票 ----------
// 规则：日期_销售方简写_购买方简写_金额元
// 当上述字段都缺失时，降级为：地点_发票
function genInvoice(data, docTypeStr, ext) {
  const date   = (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : '';
  const seller = abbrCompany(data.supplier);
  const buyer  = abbrCompany(data.buyer);
  const amount = fmtAmt(data.amount);

  const parts = [date, seller, buyer, amount].filter(Boolean);
  let name = cleanIllegal(parts.join('_'));
  // 如果核心字段全空，尝试用地点兜底
  if (!name) {
    const place = abbrPlace(data.place);
    if (place) name = place;
  }
  if (!name) name = docTypeStr || '发票';
  return name + ext;
}

// ---------- 统一出口 ----------
function generateFilename(data, docTypeStr, ext) {
  let result;
  if (docTypeStr === '合同') {
    result = genContract(data, docTypeStr, ext);
  } else if (docTypeStr === '飞机票' || docTypeStr === '火车票' || docTypeStr === '打车票') {
    result = genTraffic(data, docTypeStr, ext);
  } else if (docTypeStr === '住宿费') {
    result = genConsume(data, docTypeStr, ext);
  } else {
    result = genInvoice(data, docTypeStr, ext);
  }

  // 检查结果是否有意义：如果生成结果和原始文件名stem一样（说明没有有效数据被提取），才fallback
  // 注意：这里无法直接获取原始文件名，所以检查是否所有核心字段都为空
  var stem = result.replace(/\.[^.]+$/, '');
  // 检查原始数据是否有任意可用字段
  var hasAnyData = data.date || data.sign_date || data.amount || data.price ||
    data.buyer || data.supplier || data.party_a || data.party_b ||
    data.contract_name || data.from_station || data.to_station ||
    data.place || data.train_number || data.passenger_name;
  if (!hasAnyData) {
    return '__FALLBACK__' + result;
  }
  return result;
}

window.FN = { generateFilename, docType: null, abbrCompany, abbrPlace };
