/* ============================================================
   filenames.js —— 按用户四条命名规则
   1. 住宿/打车：日期_销售方简写_购买方简写_类型_地点_金额元
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

// 公司名简写：去掉"有限公司"等后缀，取前6字
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
  // 去掉"（"开头
  s = s.replace(/[（(].*$/, '').trim();
  if (s.length > 6) s = s.slice(0, 6);
  return s;
}

// 地点简写：去掉"市/区/县/站/机场"等后缀
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

// ---------- 类型判断 ----------
function docType(text) {
  const t = String(text || '');

  // 飞机票（优先级最高，避免被发票关键词吞掉）
  if (/航空运输电子客票|行程单|旅客姓名|电子客票|登机牌|航班|机票|飞猪|携程.*机票|airline|flight/i.test(t)) return '飞机票';

  // T3出行/网约车
  if (/T3出行|滴滴|曹操出行|高德打车|美团打车|网约车|打车|出租车.*发票|出租汽车/.test(t)) return '打车票';

  // 火车票
  if (/车\s*次|检\s*票|候\s*车|动\s*车|高\s*铁|火\s*车\s*票|硬\s*卧|软\s*卧|硬\s*座|二\s*等\s*座|一\s*等\s*座|商\s*务\s*座|无\s*座|出\s*发\s*站|到\s*达\s*站|网络购票|铁路电子客票|中国铁路|12306|票价[：:\s]*[¥￥]?\d|列\s*车\s*号|乘\s*车\s*日|席\s*别|始\s*发\s*站|终\s*到\s*站|补\s*票|开\s*车\s*时\s*间|出\s*发\s*时\s*间|铁\s*路\s*客\s*票/.test(t)) return '火车票';

  // 住宿
  if (/住宿|宾馆|酒店|旅店|入住|如家|汉庭|全季|民宿/.test(t)) return '住宿费';

  // 合同
  if (/合同|协议|甲方|乙方|买方|卖方|采购合同|服务合同/.test(t)) return '合同';

  return '发票';
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
  if (!name) name = '0000-01-01_未命名';
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
  if (!name) name = '0000-01-01_未命名';
  return name + ext;
}

// ---------- 3️ 合同 ----------
// 规则：签订日期_项目名称_甲方_乙方_金额元
function genContract(data, docTypeStr, ext) {
  const date   = (data.sign_date && /^\d{4}-\d{2}-\d{2}$/.test(data.sign_date)) ? data.sign_date : '';
  const name   = (data.contract_name || '合同').slice(0, 15);
  const a      = abbrCompany(data.party_a);
  const b      = abbrCompany(data.party_b);
  const amount = fmtAmt(data.amount);

  const parts = [date, name, a, b, amount].filter(Boolean);
  let fname = cleanIllegal(parts.join('_'));
  if (!fname) fname = '0000-01-01_未命名';
  return fname + ext;
}

// ---------- 4️⃣ 普通发票 ----------
// 规则：日期_销售方简写_购买方简写_金额元
function genInvoice(data, docTypeStr, ext) {
  const date   = (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) ? data.date : '';
  const seller = abbrCompany(data.supplier);
  const buyer  = abbrCompany(data.buyer);
  const amount = fmtAmt(data.amount);

  const parts = [date, seller, buyer, amount].filter(Boolean);
  let name = cleanIllegal(parts.join('_'));
  if (!name) name = '0000-01-01_未命名';
  return name + ext;
}

// ---------- 统一出口 ----------
function generateFilename(data, docTypeStr, ext) {
  var result;
  if (docTypeStr === '合同') result = genContract(data, docTypeStr, ext);
  else if (docTypeStr === '飞机票' || docTypeStr === '火车票' || docTypeStr === '打车票') result = genTraffic(data, docTypeStr, ext);
  else if (docTypeStr === '住宿费') result = genConsume(data, docTypeStr, ext);
  else result = genInvoice(data, docTypeStr, ext);

  // 安全检查：如果生成的文件名只包含类型名（没有实质信息），标记为需要 fallback
  var stem = result.replace(/\.[^.]+$/, '');
  var bareTypes = ['发票', '火车票', '飞机票', '打车票', '住宿费', '合同', '0000-01-01_未命名'];
  if (bareTypes.indexOf(stem) !== -1) {
    return '__FALLBACK__' + result;
  }
  return result;
}

window.FN = { generateFilename, docType, abbrCompany, abbrPlace };
