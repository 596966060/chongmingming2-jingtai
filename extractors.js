// extractors.js —— 精简抽取，强化图像预处理
(function(g) {
  // 图像预处理：CLAHE 模拟 + 锐化
  function preprocess(canvas) {
    let ctx=canvas.getContext('2d'), img=ctx.getImageData(0,0,canvas.width,canvas.height), d=img.data, gray=new Uint8Array(d.length/4);
    for(let i=0,j=0;i<d.length;i+=4,j++) gray[j]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    let hist=new Array(256).fill(0); for(let v of gray) hist[v]++;
    let cdf=[], min=0, total=gray.length; cdf[0]=hist[0]; for(let i=1;i<256;i++) cdf[i]=cdf[i-1]+hist[i];
    let minCdf=cdf[0]; for(let i=0;i<256;i++) cdf[i]=Math.round(((cdf[i]-minCdf)/(total-minCdf))*255);
    for(let i=0,j=0;i<d.length;i+=4,j++){ let v=cdf[gray[j]]; d[i]=v; d[i+1]=v; d[i+2]=v; }
    ctx.putImageData(img,0,0);
    return canvas;
  }

  // OCR 引擎（Tesseract）
  function ocrImage(canvas) { return g.Tesseract.recognize(canvas,'chi_sim+eng').then(r=>r.data.text||''); }

  // PDF 转文本（多页）
  function pdfToText(file) {
    return new Promise((res,rej)=>{
      if(!g.pdfjsLib) rej('PDF.js not loaded');
      file.arrayBuffer().then(buf=>{
        g.pdfjsLib.getDocument({data:buf}).promise.then(pdf=>{
          let pages=Math.min(pdf.numPages,8), text='', idx=1;
          function next() {
            if(idx>pages) { res(text.trim()); return; }
            pdf.getPage(idx).then(page=>{
              let viewport=page.getViewport({scale:2.5}), canvas=document.createElement('canvas');
              canvas.width=viewport.width; canvas.height=viewport.height;
              let ctx=canvas.getContext('2d');
              page.render({canvasContext:ctx,viewport:viewport}).promise.then(()=>{
                preprocess(canvas);
                ocrImage(canvas).then(t=>{ text+='\n'+t; idx++; next(); }).catch(()=>{ idx++; next(); });
              }).catch(()=>{ idx++; next(); });
            }).catch(()=>{ idx++; next(); });
          }
          next();
        }).catch(rej);
      }).catch(rej);
    });
  }

  // 图片转文本
  function imageToText(file) {
    return createImageBitmap(file).then(img=>{
      let canvas=document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height;
      let ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
      preprocess(canvas);
      return ocrImage(canvas);
    });
  }

  // 从文件名提取字段（精简版）
  function extractFromFilename(stem) {
    let r={};
    if(!stem) return r;
    let parts=stem.split(/[_\-\s.（(【《】）)】]+/);
    // 日期
    for(let p of parts) {
      let m;
      if(m=p.match(/^20(\d{2})(\d{2})(\d{2})$/)) { r.date=`20${m[1]}-${m[2]}-${m[3]}`; break; }
      if(m=p.match(/^(\d{1,2})[.\-](\d{1,2})$/)) { let y=new Date().getFullYear(); r.date=`${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; break; }
      if(m=p.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)) { r.date=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break; }
    }
    // 路线
    let route=stem.match(/([\u4e00-\u9fa5]{2,6})\s*[-—–~]\s*([\u4e00-\u9fa5]{2,6})/);
    if(route) { r.from_station=route[1]; r.to_station=route[2]; }
    // 中文词
    let words=parts.filter(p=>/[\u4e00-\u9fa5]/.test(p) && p.length>=2 && !['发票','住宿费','火车票','飞机票','打车票','合同','机票','报销','凭证','电子','原件','复印件','扫描件','订单','飞猪','携程','T3出行','滴滴','曹操','网约车','出租车','高铁','动车','列车','车次'].includes(p));
    if(words.length) {
      // 地点
      let place=words.find(w=>/站|路|酒店|宾馆|机场|高铁|广德|德县|城市|省|市|区|县/.test(w));
      if(place) r.place=place;
      // 公司名
      let companies=words.filter(w=>!/站|路|酒店|宾馆|机场|高铁|广德|德县|城市|省|市|区|县/.test(w));
      if(companies.length) { r.buyer=companies[0]; if(companies.length>1 && companies[1]!==companies[0]) r.supplier=companies[1]; }
      // 合同名
      let contract=words.find(w=>/合同|协议|采购|服务|工程/.test(w));
      if(contract) r.contract_name=contract;
    }
    // 金额
    let amt=stem.match(/[¥￥]?\s*(\d{1,6}(?:\.\d{1,2})?)\s*元/);
    if(amt) r.amount=parseFloat(amt[1]).toFixed(2);
    else { let num=stem.match(/\b(\d{2,5}\.\d{1,2})\b/); if(num) r.amount=parseFloat(num[1]).toFixed(2); }
    return r;
  }

  // 类型判断（优先文件名特征）
  function detectType(text, stem) {
    let s=(stem||'').toLowerCase();
    if(/T3出行|滴滴|曹操|网约车|打车|出租车/.test(s)) return '打车票';
    if(/飞机票|航班|机票|飞猪|携程.*机票|登机牌/.test(s)) return '飞机票';
    if(/火车票|高铁|动车|列车|g\d{1,4}|d\d{1,4}|t\d{1,4}|k\d{1,4}|12306|车次/.test(s)) return '火车票';
    if(/住宿|宾馆|酒店|旅店|如家|汉庭|全季/.test(s)) return '住宿费';
    if(/合同|协议|甲方|乙方|采购合同|服务合同/.test(s)) return '合同';
    // OCR 内容辅助
    let t=text||'';
    if(/T3出行|滴滴|网约车|出租车/.test(t)) return '打车票';
    if(/航空运输电子客票|行程单|旅客姓名|登机牌|航班|机票/.test(t)) return '飞机票';
    if(/车次|高铁|动车|火车票|出发站|到达站|中国铁路/.test(t)) return '火车票';
    if(/住宿|宾馆|酒店|旅店|入住/.test(t)) return '住宿费';
    if(/合同|协议|甲方|乙方/.test(t)) return '合同';
    return '发票';
  }

  // 发票字段抽取（仅关键字段）
  function extractInvoice(text) {
    let r={date:null, buyer:null, supplier:null, amount:null, place:null};
    // 日期
    let m=text.match(/(?:开票日期|日期)[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
    if(!m) m=text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if(m) { let y=+m[1], mo=+m[2], d=+m[3]; if(y>=2000&&y<=2030&&mo>=1&&mo<=12&&d<=31) r.date=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
    // 购买方
    let b=text.match(/购买方\s*(?:名称)?[：:]\s*([^\n]{2,30})/);
    if(b) r.buyer=b[1].trim();
    // 销售方
    let s=text.match(/销售方\s*(?:名称)?[：:]\s*([^\n]{2,30})/);
    if(s) r.supplier=s[1].trim();
    // 金额
    let am=text.match(/价税合计[^\d]*[¥￥]?\s*(\d+\.\d{2})/);
    if(!am) am=text.match(/[¥￥]\s*(\d+\.\d{2})/);
    if(am) r.amount=parseFloat(am[1]).toFixed(2);
    return r;
  }

  // 火车票抽取
  function extractTrain(text) {
    let r={date:null, from_station:null, to_station:null, price:null};
    let m=text.match(/(?:乘车日期|出发日期)[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
    if(!m) m=text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if(m) { let y=+m[1],mo=+m[2],d=+m[3]; if(y>=2000&&y<=2030&&mo>=1&&mo<=12&&d<=31) r.date=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
    let f=text.match(/出发站[：:\s]*([\u4e00-\u9fa5]{2,8})/); if(f) r.from_station=f[1];
    let t=text.match(/到达站[：:\s]*([\u4e00-\u9fa5]{2,8})/); if(t) r.to_station=t[1];
    let p=text.match(/[¥￥]\s*(\d+\.\d{2})/); if(p) r.price=parseFloat(p[1]).toFixed(2);
    return r;
  }

  // 合同抽取
  function extractContract(text) {
    let r={sign_date:null, contract_name:null, party_a:null, party_b:null, amount:null};
    let m=text.match(/(?:签订|签署|签约).*?(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
    if(!m) m=text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if(m) { let y=+m[1],mo=+m[2],d=+m[3]; if(y>=2000&&y<=2030&&mo>=1&&mo<=12&&d<=31) r.sign_date=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
    let cn=text.match(/合同名称[：:]\s*([^\n]{2,25})/); if(cn) r.contract_name=cn[1].trim();
    let a=text.match(/甲方[：:]\s*([^\n]{2,25})/); if(a) r.party_a=a[1].trim();
    let b=text.match(/乙方[：:]\s*([^\n]{2,25})/); if(b) r.party_b=b[1].trim();
    let am=text.match(/合同金额[：:]\s*[¥￥]?\s*(\d[\d,]*\.?\d*)/); if(am) r.amount=parseFloat(am[1].replace(/,/g,'')).toFixed(2);
    return r;
  }

  // 主入口
  function extractFromFile(file) {
    return new Promise((resolve)=>{
      let stem=file.name.replace(/\.[^.]+$/,''), ext=file.name.split('.').pop().toLowerCase();
      let process=(text)=>{
        let type=detectType(text, stem);
        let data;
        if(type==='火车票') data=extractTrain(text);
        else if(type==='合同') data=extractContract(text);
        else data=extractInvoice(text);
        // 补充文件名信息
        let fn=extractFromFilename(stem);
        Object.keys(fn).forEach(k=>{ if(!data[k]) data[k]=fn[k]; });
        // 合同特殊处理
        if(type==='合同') { data.party_a=data.party_a||fn.buyer; data.party_b=data.party_b||fn.supplier; }
        data._raw_text=text;
        resolve({data, type});
      };
      if(ext==='pdf') {
        pdfToText(file).then(t=>process(t)).catch(()=>process(''));
      } else if(['jpg','jpeg','png','bmp'].includes(ext)) {
        imageToText(file).then(t=>process(t)).catch(()=>process(''));
      } else {
        process('');
      }
    });
  }

  g.EX = { extractFromFile, extractFromFilename, detectType, preprocess };
})(window);
