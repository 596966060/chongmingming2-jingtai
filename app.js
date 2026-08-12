// app.js —— 完整版（确保日期不为空）
function getExt(f) { let m=String(f).match(/\.[^.]+$/); return m?m[0].toLowerCase():'.pdf'; }

function guessType(name) {
  let n=name.toLowerCase();
  if(/飞机票|航班|机票|飞猪/.test(n)) return '飞机票';
  if(/T3出行|滴滴|曹操|网约车|打车|出租车/.test(n)) return '打车票';
  if(/火车票|高铁|动车|列车|g\d|d\d|t\d|k\d/.test(n)) return '火车票';
  if(/住宿|宾馆|酒店|旅店/.test(n)) return '住宿费';
  if(/合同|协议|甲方|乙方/.test(n)) return '合同';
  return '发票';
}

let results=[];

async function handleFiles(files) {
  let list=Array.from(files).filter(f=>/\.(pdf|jpg|jpeg|png|bmp|docx|doc)$/i.test(f.name));
  if(!list.length) return toast('请选择支持的文件');
  results=[]; clearTable();
  for(let i=0;i<list.length;i++) {
    let file=list[i]; updateProgress(i+1,list.length,file.name);
    try {
      let {data,type}=await EX.extractFromFile(file);
      let fnType=guessType(file.name);
      if(!data._raw_text || data._raw_text.length<20) type=fnType;
      if(/T3出行|滴滴|打车/.test(file.name)) type='打车票';
      if(type==='发票' && fnType!=='发票') type=fnType;
      
      // 确保日期不为空
      if (!data.date || data.date === '0000-01-01') {
        let stem = file.name.replace(/\.[^.]+$/, '');
        let fn = EX.extractFromFilename(stem);
        data.date = fn.date || (() => { let d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
      }
      if (!data.sign_date) data.sign_date = data.date; // 合同用

      let newName=FN.generateFilename(data, type, getExt(file.name));
      let ocrPreview = (data._raw_text || '').substring(0, 100).replace(/\n/g,' ') + (data._raw_text.length>100?'...':'');
      results.push({file,data,type,newName, ocrPreview});
      addRow(i,file.name,newName,type,data, ocrPreview);
    } catch(e) {
      console.error(e);
      let stem=file.name.replace(/\.[^.]+$/,'');
      let fn=EX.extractFromFilename(stem);
      let type=guessType(file.name);
      let data={date:fn.date||'2025-01-01', buyer:fn.buyer, supplier:fn.supplier, place:fn.place, from_station:fn.from_station, to_station:fn.to_station, contract_name:fn.contract_name, party_a:fn.buyer, party_b:fn.supplier, amount:fn.amount};
      let newName=FN.generateFilename(data, type, getExt(file.name));
      results.push({file,data,type,newName, ocrPreview:'OCR失败'});
      addRow(i,file.name,newName,type,data, 'OCR失败');
    }
  }
  hideProgress();
}

// DOM 操作函数
function clearTable(){ document.querySelector('#resultTable tbody').innerHTML=''; }
function addRow(i,orig,renamed,type,data,ocrText){
  let tr=document.createElement('tr'); tr.dataset.index=i;
  tr.innerHTML=`<td>${orig}</td><td class="editable" onclick="editRow(${i})">${renamed}</td><td>${type}</td><td>${data.date||data.sign_date||''}</td><td>${data.amount||''}</td><td style="max-width:150px;font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${ocrText}">${ocrText}</td><td><button class="btn-small" onclick="deleteRow(${i})">删除</button></td>`;
  document.querySelector('#resultTable tbody').appendChild(tr);
}
window.editRow=function(i){ let item=results[i]; if(!item)return; document.getElementById('editOrig').value=item.file.name; document.getElementById('editNew').value=item.newName; document.getElementById('editDate').value=item.data.date||item.data.sign_date||''; document.getElementById('editAmount').value=item.data.amount||''; document.getElementById('editBuyer').value=item.data.buyer||item.data.party_a||''; document.getElementById('editSupplier').value=item.data.supplier||item.data.party_b||''; document.getElementById('editPlace').value=item.data.place||item.data.from_station||''; document.getElementById('editModal').classList.remove('hidden'); };
window.saveEdit=function(){ let item=results[currentEditIndex]; if(!item)return; item.data.date=document.getElementById('editDate').value; item.data.sign_date=document.getElementById('editDate').value; item.data.amount=document.getElementById('editAmount').value; item.data.buyer=document.getElementById('editBuyer').value; item.data.supplier=document.getElementById('editSupplier').value; item.data.place=document.getElementById('editPlace').value; item.data.party_a=document.getElementById('editBuyer').value; item.data.party_b=document.getElementById('editSupplier').value; let type=item.type; item.newName=FN.generateFilename(item.data,type,getExt(item.file.name)); document.querySelector(`tr[data-index="${currentEditIndex}"] .editable`).textContent=item.newName; closeEdit(); };
window.closeEdit=function(){ document.getElementById('editModal').classList.add('hidden'); };
window.deleteRow=function(i){ results.splice(i,1); clearTable(); results.forEach((item,idx)=>{ addRow(idx,item.file.name,item.newName,item.type,item.data,item.ocrPreview||''); }); };
function updateProgress(c,t,n){ let bar=document.getElementById('progress'); if(!bar)return; bar.classList.remove('hidden'); bar.textContent=`(${c}/${t}) ${n}`; }
function hideProgress(){ let bar=document.getElementById('progress'); if(bar)bar.classList.add('hidden'); }
function toast(msg){ let t=document.getElementById('toast'); if(!t)return; t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),2500); }

document.addEventListener('DOMContentLoaded',()=>{
  let input=document.getElementById('fileInput');
  if(input) input.addEventListener('change',e=>handleFiles(e.target.files));
  let dz=document.getElementById('dropZone');
  if(dz){
    dz.addEventListener('click',()=>document.getElementById('fileInput').click());
    dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag-over');});
    dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
    dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-over');handleFiles(e.dataTransfer.files);});
  }
  document.getElementById('downloadZip')?.addEventListener('click',()=>EXPORT.downloadZip(results));
  document.getElementById('downloadCsv')?.addEventListener('click',()=>EXPORT.downloadCsv(results));
  document.getElementById('downloadExcel')?.addEventListener('click',()=>EXPORT.downloadExcel(results));
});
let currentEditIndex=null;
