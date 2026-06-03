const records = [];
async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    location.href = './login.html';
  }
  return res;
}
const payRecords = [];
let payEditingId = null;
let payEditingFile = '';
let payPendingAttachment = null;
const partners = [];
const contactsData = {
  customers: [
    { name:'客户A', contact:'张三', phone:'13800000001', city:'上海', remark:'重要客户', owner:'客户', created:'2026/01/01 10:00:00' },
    { name:'客户B', contact:'李四', phone:'13800000002', city:'杭州', remark:'', owner:'客户', created:'2026/01/02 11:20:00' },
    { name:'客户C', contact:'王五', phone:'13800000003', city:'苏州', remark:'', owner:'客户', created:'2026/01/03 09:10:00' }
  ],
  merchants: [
    { name:'商家A', contact:'刘一', phone:'13900000001', city:'上海', remark:'', owner:'商家', created:'2026/01/01 10:00:00' },
    { name:'商家B', contact:'陈二', phone:'13900000002', city:'杭州', remark:'', owner:'商家', created:'2026/01/02 11:20:00' },
    { name:'商家C', contact:'周三', phone:'13900000003', city:'苏州', remark:'', owner:'商家', created:'2026/01/03 09:10:00' }
  ],
  others: [
    { name:'单位A', contact:'赵一', phone:'13700000001', city:'上海', remark:'', owner:'其它', created:'2026/01/01 10:00:00' },
    { name:'单位B', contact:'钱二', phone:'13700000002', city:'杭州', remark:'', owner:'其它', created:'2026/01/02 11:20:00' },
    { name:'单位C', contact:'孙三', phone:'13700000003', city:'苏州', remark:'', owner:'其它', created:'2026/01/03 09:10:00' }
  ]
};
let contactsLoaded = false;
const entryType = document.getElementById('entry-type');
const entryCategory = document.getElementById('entry-category');
const entryClient = document.getElementById('entry-client');
const entryAmount = document.getElementById('entry-amount');
const entryMethod = document.getElementById('entry-method');
const entryFile = document.getElementById('entry-file');
let ledgerImportData = [];
const ledgerImportModal = document.getElementById('ledger-import-modal');
const ledgerImportRows = document.getElementById('ledger-import-rows');
const ledgerImportSummary = document.getElementById('ledger-import-summary');
const ledgerImportCancel = document.getElementById('ledger-import-cancel');
const ledgerImportCommit = document.getElementById('ledger-import-commit');

if (ledgerImportCancel) {
  ledgerImportCancel.addEventListener('click', () => {
    ledgerImportModal.style.display = 'none';
    entryFile.value = '';
    ledgerImportData = [];
  });
}

if (ledgerImportCommit) {
  ledgerImportCommit.addEventListener('click', async () => {
    if (ledgerImportData.length === 0) return;
    ledgerImportCommit.disabled = true;
    ledgerImportCommit.textContent = '导入中...';
    
    try {
      // First, auto-create missing partners
      const partnersToCreate = new Map(); // partnerName -> type
      ledgerImportData.forEach(d => {
        if (d.willCreate) partnersToCreate.set(d.partner, d.createType);
      });
      
      for (let [pName, pType] of partnersToCreate.entries()) {
        try {
          await apiFetchJSON('/api/contacts', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: pName, type: pType, contact: '', phone: '', email: '', notes: '导入时自动创建' })
          });
        } catch(e) {
          console.error('Failed to create partner', pName, e);
        }
      }
      
      // Reload contacts if any were created
      if (partnersToCreate.size > 0) {
        await loadAllContacts();
      }
      
      const now = new Date();
      const importBaseCreatedAt = Date.now();
      const importTotal = ledgerImportData.length;
      const defaultDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const dateTime = `${defaultDate} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      const defaultMethod = entryMethod.value || '微信'; // Fallback if not selected
      
      for (let i = 0; i < ledgerImportData.length; i++) {
        const d = ledgerImportData[i];
        const type = d.amount >= 0 ? '收入' : '开支';
        let cat = d.subcat;
        if (!cat) {
          const parentCat = categoriesData.find(c => c.name === type);
          cat = (parentCat && parentCat.children && parentCat.children.length > 0) ? parentCat.children[0] : (d.amount >= 0 ? '其它收入' : '其它开支');
        }
        const absAmount = Math.abs(d.amount);
        const rowDate = d.date || defaultDate;
        const method = d.method || defaultMethod;
        const createdAt = importBaseCreatedAt + (importTotal - i);
        
        try {
          await apiFetchJSON('/api/ledger', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
              type, category: cat, doc: d.doc, client: d.partner, 
              amount: absAmount, method, file: '', notes: d.notes, 
              date: rowDate, dateTime, createdAt, createdBy: (getAuthUser()?.name || ''), confirmed: false 
            })
          });
        } catch (e) {
          console.error('Failed to import row', d, e);
        }
      }
      
      ledgerImportModal.style.display = 'none';
      entryFile.value = '';
      ledgerImportData = [];
      loadLedgerFromServer();
    } catch (err) {
      alert('导入出错');
    } finally {
      ledgerImportCommit.disabled = false;
      ledgerImportCommit.textContent = '批量入库';
    }
  });
}

function excelDateToJSDate(serial) {
  if (typeof serial !== 'number') return serial;
  const utc_days  = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;                                        
  const date_info = new Date(utc_value * 1000);
  const fractional_day = serial - Math.floor(serial) + 0.0000001;
  let total_seconds = Math.floor(86400 * fractional_day);
  const seconds = total_seconds % 60;
  total_seconds -= seconds;
  const hours = Math.floor(total_seconds / (60 * 60));
  const minutes = Math.floor(total_seconds / 60) % 60;
  return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
}

function parseLedgerDate(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    const d = excelDateToJSDate(val);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  // match DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  return s;
}

entryFile?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  ledgerImportData = [];
  if (ledgerImportModal) ledgerImportModal.style.display = 'none';
  if (!file) return;
  
  if (/\.(xls|xlsx|csv)$/i.test(file.name)) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        
        // Find headers
        let headerRowIdx = -1;
        let colMap = {};
        for (let i=0; i<Math.min(10, rows.length); i++) {
          const row = rows[i];
          if (!row) continue;
          let dateIdx=-1, docIdx=-1, subcatIdx=-1, partnerIdx=-1, notesIdx=-1, amtIdx=-1, methodIdx=-1;
          row.forEach((cell, idx) => {
            const txt = String(cell||'').replace(/\s+/g,'');
            if (txt.includes('日期')) dateIdx = idx;
            else if (txt.includes('单据') || txt.includes('凭证')) docIdx = idx;
            else if (txt.includes('子类目')) subcatIdx = idx;
            else if (txt.includes('往来单位') || txt.includes('客户')) partnerIdx = idx;
            else if (txt.includes('备注')) notesIdx = idx;
            else if (txt.includes('金额')) amtIdx = idx;
            else if (txt.includes('支付方式') || txt.includes('账户')) methodIdx = idx;
          });
          if (amtIdx !== -1 && partnerIdx !== -1) {
            headerRowIdx = i;
            colMap = { date:dateIdx, doc:docIdx, subcat:subcatIdx, partner:partnerIdx, notes:notesIdx, amt:amtIdx, method:methodIdx };
            break;
          }
        }
        
        if (headerRowIdx === -1) {
          alert('无法在表格中找到“往来单位”和“金额”列');
          entryFile.value = '';
          return;
        }
        
        let newPartnersCount = 0;
        let newPartnersSet = new Set();
        
        for (let i = headerRowIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          
          let rawAmt = row[colMap.amt];
          if (rawAmt === undefined || rawAmt === null || rawAmt === '') continue;
          let amt = parseFloat(String(rawAmt).replace(/[^\d\.\-]/g,''));
          if (isNaN(amt)) continue;
          
          let partner = String(row[colMap.partner] || '').trim();
          if (!partner) continue;
          
          let dateStr = colMap.date !== -1 ? parseLedgerDate(row[colMap.date]) : '';
          let docStr = colMap.doc !== -1 ? String(row[colMap.doc] || '').trim() : '';
          let subcatStr = colMap.subcat !== -1 ? String(row[colMap.subcat] || '').trim() : '';
          let notesStr = colMap.notes !== -1 ? String(row[colMap.notes] || '').trim() : '';
          let methodStr = colMap.method !== -1 ? String(row[colMap.method] || '').trim() : '';
          
          // Validate method
          let validMethod = true;
          if (methodStr && !accountsData.some(a => a.name === methodStr)) {
            validMethod = false;
          }
          
          // Validate subcategory
          let validSubcat = true;
          if (subcatStr) {
            const isIncome = amt >= 0;
            const parentName = isIncome ? '收入' : '开支';
            const catObj = categoriesData.find(c => c.name === parentName);
            const validChildren = catObj ? (catObj.children || []) : [];
            if (!validChildren.includes(subcatStr)) {
              validSubcat = false;
            }
          }
          
          // Advanced Partner Matching
          const normalizePartner = (str) => {
            if (!str) return '';
            // Remove accents and keep only alphanumeric chars, uppercase
            return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          };
          
          const normPartner = normalizePartner(partner);
          const allContactsList = allContacts();
          
          // 1. Exact match
          let match = allContactsList.find(c => c.name === partner);
          
          // 2. Normalized exact match (ignores case, spaces, symbols)
          if (!match && normPartner) {
            match = allContactsList.find(c => {
              const nName = normalizePartner(c.name);
              const nComp = normalizePartner(c.company);
              return (nName && nName === normPartner) || (nComp && nComp === normPartner);
            });
          }
          
          // 3. High-similarity substring match (>= 90% length ratio)
          if (!match && normPartner && normPartner.length > 5) {
            match = allContactsList.find(c => {
              const nName = normalizePartner(c.name);
              const nComp = normalizePartner(c.company);
              
              const checkSim = (n1, n2) => {
                if (!n1 || !n2) return false;
                if (n1.includes(n2) || n2.includes(n1)) {
                  const lenRatio = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
                  return lenRatio >= 0.90; // High similarity required to prevent false positives
                }
                return false;
              };
              
              return checkSim(nName, normPartner) || checkSim(nComp, normPartner);
            });
          }
          
          let exists = !!match;
          let willCreate = false;
          let createType = '';
          
          if (exists) {
            partner = match.name; // Auto-correct the partner name to exactly match the DB!
          } else {
            willCreate = true;
            createType = amt >= 0 ? '客户' : '其它往来单位';
            newPartnersSet.add(`${partner} (${createType})`);
          }
          
          ledgerImportData.push({
            date: dateStr,
            doc: docStr,
            subcat: subcatStr,
            partner: partner,
            notes: notesStr,
            amount: amt,
            method: methodStr,
            validMethod,
            validSubcat,
            willCreate,
            createType
          });
        }
        
        // Check for any invalid methods or subcategories
        const invalidMethods = [...new Set(ledgerImportData.filter(d => !d.validMethod).map(d => d.method))];
        if (invalidMethods.length > 0) {
          alert(`账户不存在，表格无法上传：\n${invalidMethods.join(', ')}\n\n请先在系统设置中添加该账户名称，或修改表格后重新上传使其关联。`);
          entryFile.value = '';
          ledgerImportData = [];
          return;
        }
        
        const invalidSubcats = [...new Set(ledgerImportData.filter(d => !d.validSubcat).map(d => d.subcat))];
        if (invalidSubcats.length > 0) {
          alert(`子类目不匹配，表格无法上传：\n${invalidSubcats.join(', ')}\n\n请修改为系统分类管理中存在的子类目后再上传表格。`);
          entryFile.value = '';
          ledgerImportData = [];
          return;
        }
        
        if (ledgerImportData.length > 0 && ledgerImportModal) {
          ledgerImportRows.innerHTML = '';
          ledgerImportData.forEach(d => {
            const tr = document.createElement('tr');
            
            const tdDate = document.createElement('td'); tdDate.style.padding = '6px'; tdDate.style.borderBottom = '1px solid #334155';
            tdDate.textContent = d.date;
            const tdDoc = document.createElement('td'); tdDoc.style.padding = '6px'; tdDoc.style.borderBottom = '1px solid #334155';
            tdDoc.textContent = d.doc;
            const tdPartner = document.createElement('td'); tdPartner.style.padding = '6px'; tdPartner.style.borderBottom = '1px solid #334155';
            if (d.willCreate) {
              tdPartner.innerHTML = `<span>${d.partner}</span> <span style="color:#ef4444; font-size:10px; background:#450a0a; padding:2px 4px; border-radius:4px">新${d.createType}</span>`;
            } else {
              tdPartner.textContent = d.partner;
            }
            const tdNotes = document.createElement('td'); tdNotes.style.padding = '6px'; tdNotes.style.borderBottom = '1px solid #334155';
            tdNotes.textContent = d.notes;
            const tdAmt = document.createElement('td'); tdAmt.style.padding = '6px'; tdAmt.style.borderBottom = '1px solid #334155'; tdAmt.style.textAlign = 'right';
            tdAmt.textContent = d.amount.toFixed(2);
            tdAmt.style.color = d.amount >= 0 ? 'var(--green)' : 'var(--orange)';
            const tdMethod = document.createElement('td'); tdMethod.style.padding = '6px'; tdMethod.style.borderBottom = '1px solid #334155';
            tdMethod.textContent = d.method;
            
            tr.append(tdDate, tdDoc, tdPartner, tdNotes, tdAmt, tdMethod);
            ledgerImportRows.appendChild(tr);
          });
          
          ledgerImportSummary.innerHTML = `已解析 <b>${ledgerImportData.length}</b> 条记录。<br>`;
          if (newPartnersSet.size > 0) {
            ledgerImportSummary.innerHTML += `<span style="color:#f59e0b">将自动创建 ${newPartnersSet.size} 个新往来单位。</span>`;
          }
          ledgerImportModal.style.display = 'flex';
        } else {
          alert('未解析到有效数据行');
          entryFile.value = '';
        }
      } catch (e) {
        console.error(e);
        alert('解析Excel失败');
        entryFile.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }
});
const entryNotes = document.getElementById('entry-notes');
const entryForm = document.getElementById('entry-form');
const entrySubmitBtn = entryForm?.querySelector('button[type="submit"]');
const rows = document.getElementById('rows');
const homeChartRows = document.getElementById('home-chart-rows');
const salesChartSvg = document.getElementById('sales-chart-svg');
const salesPeriodSel = document.getElementById('sales-period');
const homePeriodSel = document.getElementById('home-period');
const filterType = document.getElementById('filter-type');
const filterKey = document.getElementById('filter-key');
const filterStart = document.getElementById('filter-start');
const filterEnd = document.getElementById('filter-end');
const ledgerPager = document.getElementById('global-pager-controls') || document.getElementById('ledger-pager');
const ledgerTableWrap = document.getElementById('ledger-table-wrap');
const ldType = document.getElementById('ld-type');
const ldTypeDD = document.getElementById('ld-type-dd');
const ldTypeList = document.getElementById('ld-type-list');
const ldTypeLabel = document.getElementById('ld-type-label');
const ldCat = document.getElementById('ld-cat');
const ldCatDD = document.getElementById('ld-cat-dd');
const ldCatList = document.getElementById('ld-cat-list');
const ldCatLabel = document.getElementById('ld-cat-label');
const ldOwner = document.getElementById('ld-owner');
const ldOwnerDD = document.getElementById('ld-owner-dd');
const ldOwnerList = document.getElementById('ld-owner-list');
const ldOwnerLabel = document.getElementById('ld-owner-label');
const ldMethod = document.getElementById('ld-method');
const ldMethodDD = document.getElementById('ld-method-dd');
const ldMethodList = document.getElementById('ld-method-list');
const ldMethodLabel = document.getElementById('ld-method-label');
const ldConfirm = document.getElementById('ld-confirm');
const ldConfirmDD = document.getElementById('ld-confirm-dd');
const ldConfirmList = document.getElementById('ld-confirm-list');
const ldConfirmLabel = document.getElementById('ld-confirm-label');
const ledgerNotesModal = document.getElementById('ledger-notes-modal');
const ledgerNotesContent = document.getElementById('ledger-notes-content');
let ledgerPage = 1;
const ledgerPageSize = 100;
function updateLedgerHeaderCover() {}
let ledgerHdrType = 'all';
let ledgerHdrCat = '';
let ledgerHdrOwner = '';
let ledgerHdrMethod = '';
let ledgerHdrConfirm = 'all';
function clientOwner(name) {
  const all = [...contactsData.customers, ...contactsData.merchants, ...contactsData.others];
  const obj = all.find(x => (x.name||'') === (name||''));
  return obj ? (obj.owner || '') : '';
}
function openLedgerTypeFilter() {
  ldTypeDD.style.display = 'block';
  ldTypeList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className='dd-item'; row.textContent = label;
    row.addEventListener('click', () => {
      ledgerHdrType = val;
      ldTypeDD.style.display='none';
      setLabel(ldTypeLabel, '类型', val!=='all');
      ledgerPage = 1;
      applyFilters();
      ldCatLabel && setLabel(ldCatLabel, '子类目', !!ledgerHdrCat);
    });
    ldTypeList.appendChild(row);
  };
  addItem('全部', 'all');
  addItem('收入', '收入');
  addItem('开支', '开支');
}
function openLedgerCatFilter() {
  ldCatDD.style.display = 'block';
  ldCatList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className='dd-item'; row.textContent = label;
    row.addEventListener('click', () => {
      ledgerHdrCat = val;
      ldCatDD.style.display='none';
      setLabel(ldCatLabel, '子类目', !!val);
      ledgerPage = 1;
      applyFilters();
    });
    ldCatList.appendChild(row);
  };
  addItem('全部', '');
  const types = ledgerHdrType==='all' ? categoriesData.map(c=>c.name) : [ledgerHdrType];
  types.forEach(t => {
    const children = (categoriesData.find(c=>c.name===t)?.children) || [];
    children.forEach(n => addItem(n, n));
  });
}
function openLedgerOwnerFilter() {
  ldOwnerDD.style.display = 'block';
  ldOwnerList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className='dd-item'; row.textContent = label;
    row.addEventListener('click', () => {
      ledgerHdrOwner = val;
      ldOwnerDD.style.display='none';
      setLabel(ldOwnerLabel, '往来单位', !!val);
      ledgerPage = 1;
      applyFilters();
    });
    ldOwnerList.appendChild(row);
  };
  addItem('全部', '');
  addItem('客户', '客户');
  addItem('商家', '商家');
  addItem('其它往来单位', '其它');
}
function openLedgerMethodFilter() {
  ldMethodDD.style.display = 'block';
  ldMethodList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className = 'dd-item'; row.textContent = label;
    row.addEventListener('click', () => {
      ledgerHdrMethod = val;
      ldMethodDD.style.display = 'none';
      setLabel(ldMethodLabel, val || '支付方式', !!val);
      ledgerPage = 1;
      applyFilters();
    });
    ldMethodList.appendChild(row);
  };
  addItem('全部', '');
  [...new Set((records || []).map(r => (r.method || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).forEach(name => addItem(name, name));
}
function openLedgerConfirmFilter() {
  ldConfirmDD.style.display = 'block';
  ldConfirmList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className = 'dd-item'; row.textContent = label;
    row.addEventListener('click', () => {
      ledgerHdrConfirm = val;
      ldConfirmDD.style.display = 'none';
      setLabel(ldConfirmLabel, val === 'all' ? '操作' : (val === 'confirmed' ? '已确认' : '未确认'), val !== 'all');
      ledgerPage = 1;
      applyFilters();
    });
    ldConfirmList.appendChild(row);
  };
  addItem('全部', 'all');
  addItem('已确认', 'confirmed');
  addItem('未确认', 'unconfirmed');
}
function openLedgerNotesModal(text) {
  if (!ledgerNotesModal || !ledgerNotesContent || !text) return;
  ledgerNotesContent.textContent = text;
  ledgerNotesModal.style.display = 'flex';
}

window.downloadLedgerTemplate = function() {
  if (typeof XLSX === 'undefined') {
    alert('Excel 库未加载，请刷新页面后重试');
    return;
  }
  const ws_data = [
    ["日期", "单据凭证号", "子类目", "往来单位", "备注", "金额", "支付方式"],
    ["", "", "", "", "", "", "银行账户 BBVA"]
  ];
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "批量导入模板");
  XLSX.writeFile(wb, "批量导入模板.xlsx");
};

ldType?.addEventListener('click', (e) => { e.stopPropagation(); openLedgerTypeFilter(); });
ldCat?.addEventListener('click', (e) => { e.stopPropagation(); openLedgerCatFilter(); });
ldOwner?.addEventListener('click', (e) => { e.stopPropagation(); openLedgerOwnerFilter(); });
ldMethod?.addEventListener('click', (e) => { e.stopPropagation(); openLedgerMethodFilter(); });
ldConfirm?.addEventListener('click', (e) => { e.stopPropagation(); openLedgerConfirmFilter(); });
const accRows = document.getElementById('acc-rows');
const accAdd = document.getElementById('acc-add');
const accountsData = [
  { name:'现金账户', balance:0, desc:'系统预置账户', created:'2026/02/08 00:00:00', initialSet:false },
  { name:'银行账户 BBVA', balance:0, desc:'系统预置账户', created:'2026/02/08 00:00:00', initialSet:false },
  { name:'银行账户 Santander', balance:0, desc:'系统预置账户', created:'2026/02/08 00:00:00', initialSet:false },
  { name:'人民币账号1', balance:0, desc:'系统预置账户', created:'2026/02/08 00:00:00', initialSet:false },
  { name:'人民币账户 中智', balance:0, desc:'系统预置账户', created:'2026/02/08 00:00:00', initialSet:false }
];
function loadJSON(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key) || ''); return v ?? def; } catch { return def; }
}
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}
function normalizePayRecordAttachment(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  const rawFile = String(
    rec.file
    || rec.fileUrl
    || rec.file_url
    || rec.attachment
    || rec.attachmentUrl
    || rec.attachment_url
    || ''
  ).trim();
  const fileName = String(
    rec.fileName
    || rec.attachmentName
    || (rawFile ? rawFile.split('/').pop() : '')
    || ''
  ).trim();
  return {
    ...rec,
    file: rawFile,
    fileUrl: rawFile,
    fileName
  };
}
function initPersist() {
  const recs = loadJSON('records', []);
  if (Array.isArray(recs)) {
    recs.forEach(r => { if (r && typeof r.fileUrl === 'string' && /^blob:/i.test(r.fileUrl)) delete r.fileUrl; });
    recs.forEach(r => {
      if (r && !r.createdAt) {
        const ts = Date.parse(r.dateTime || r.date || '');
        if (!isNaN(ts)) r.createdAt = ts;
      }
    });
    records.splice(0, records.length, ...recs);
  }
  const pays = loadJSON('payRecords', []);
  if (Array.isArray(pays)) {
    pays.forEach(r => {
      if (r && !r.createdAt) {
        const h0 = (r.history && r.history[0] && (r.history[0].date || r.history[0].dateTime)) || null;
        const ts = Date.parse(h0 || r.date || '');
        if (!isNaN(ts)) r.createdAt = ts;
      }
    });
    payRecords.splice(0, payRecords.length, ...pays.map(normalizePayRecordAttachment));
  }
  const contactsSaved = loadJSON('contactsData', null);
  if (contactsSaved && typeof contactsSaved === 'object') {
    ['customers','merchants','others'].forEach(k => { if (Array.isArray(contactsSaved[k])) contactsData[k] = contactsSaved[k]; });
  }
  const accs = loadJSON('accountsData', null);
  if (Array.isArray(accs)) { accountsData.splice(0, accountsData.length, ...accs); }
  const cats = loadJSON('categoriesData', null);
  if (Array.isArray(cats)) { categoriesData.splice(0, categoriesData.length, ...cats); }
  const roles = loadJSON('rolesData', null);
  if (Array.isArray(roles)) { rolesData.splice(0, rolesData.length, ...roles); }
  const ensureRole = (name, desc) => {
    if (!rolesData.some(r => r.name === name)) {
      const maxId = rolesData.reduce((m,r)=>Math.max(m, r.id||0), 0);
      const now = new Date();
      const created = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      rolesData.push({ id:maxId+1, name, desc, created, immutable:true });
    }
  };
  ensureRole('财务','系统预置角色');
  ensureRole('股东','系统预置角色');
  ensureRole('后台管理人员','系统预置角色');
  saveJSON('rolesData', rolesData);
  const sales = loadJSON('salesData', null);
  if (Array.isArray(sales)) { salesData.splice(0, salesData.length, ...sales); }
}
function refreshAccountOptions() {
  entryMethod.innerHTML = '<option value=\"\">请选择</option>';
  accountsData.slice().reverse().forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.name; opt.textContent = a.name;
    entryMethod.appendChild(opt);
  });
}
function renderAccounts() {
  accRows.innerHTML = '';
  const list = accountsData.map((a, i) => ({ a, i }));
  list.slice().reverse().forEach(({ a, i }) => {
    const tr = document.createElement('tr');
    const ops = document.createElement('td');
    ops.className = 'actions';
    const edit = document.createElement('a'); edit.href='#'; edit.textContent='编辑'; edit.className='link-blue';
    const del = document.createElement('a'); del.href='#'; del.textContent='删除'; del.className='link-red';
    ops.append(edit, document.createTextNode(' '), del);
    if (!a.initialSet) {
      const initBtn = document.createElement('a');
      initBtn.href='#'; initBtn.textContent='初始设置'; initBtn.className='link-orange';
      ops.append(document.createTextNode(' '), initBtn);
      initBtn.addEventListener('click', e => {
        e.preventDefault();
        pendingAccInitIndex = i;
        accInitAmount.value = '';
        accInitModal.style.display = 'flex';
      });
    }
    [a.name, a.balance.toFixed(2), a.desc || '', a.created].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
    tr.appendChild(ops);
    accRows.appendChild(tr);
    edit.addEventListener('click', e => {
      e.preventDefault();
      pendingAccEditIndex = i;
      accEditName.value = a.name || '';
      accEditDesc.value = a.desc || '';
      accEditModal.style.display = 'flex';
    });
    del.addEventListener('click', e => {
      e.preventDefault();
      const used = records.some(r => r.method === a.name);
      if (used) { alert('该账户有相关信息正在使用中无法被删除'); return; }
      pendingAccDeleteIndex = i;
      accDeleteModal.style.display = 'flex';
    });
  });
}
const accInitModal = document.getElementById('acc-init-modal');
const accInitAmount = document.getElementById('acc-init-amount');
const accInitCancel = document.getElementById('acc-init-cancel');
const accInitOk = document.getElementById('acc-init-ok');
let pendingAccInitIndex = null;
const accCreateModal = document.getElementById('acc-create-modal');
const accCreateForm = document.getElementById('acc-create-form');
const accCreateCancel = document.getElementById('acc-create-cancel');
const accCreateName = document.getElementById('acc-create-name');
const accCreateDesc = document.getElementById('acc-create-desc');
const accDeleteModal = document.getElementById('acc-delete-modal');
const accDeleteCancel = document.getElementById('acc-delete-cancel');
const accDeleteOk = document.getElementById('acc-delete-ok');
let pendingAccDeleteIndex = null;
const accEditModal = document.getElementById('acc-edit-modal');
const accEditForm = document.getElementById('acc-edit-form');
const accEditCancel = document.getElementById('acc-edit-cancel');
const accEditName = document.getElementById('acc-edit-name');
const accEditDesc = document.getElementById('acc-edit-desc');
let pendingAccEditIndex = null;
accInitCancel?.addEventListener('click', () => {
  accInitModal.style.display = 'none';
  pendingAccInitIndex = null;
});
accInitOk?.addEventListener('click', async () => {
  if (pendingAccInitIndex != null) {
    const amt = parseFloat(accInitAmount.value || '0');
    if (isNaN(amt)) return;
    accountsData[pendingAccInitIndex].balance = amt;
    accountsData[pendingAccInitIndex].initialSet = true;
    accInitModal.style.display = 'none';
    await apiAccountInit(accountsData[pendingAccInitIndex]?.name || '', amt);
    await apiAccountsList();
    refreshAccountOptions();
    renderAccounts();
    saveJSON('accountsData', accountsData);
    pendingAccInitIndex = null;
  }
});
accCreateCancel?.addEventListener('click', () => {
  accCreateModal.style.display = 'none';
});
accCreateForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const name = (accCreateName?.value || '').trim();
  const desc = (accCreateDesc?.value || '').trim();
  if (!name) return;
  if (accountsData.some(a => a.name === name)) { alert('账户名称已存在'); return; }
  const now = new Date();
  const created = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  accountsData.push({ name, balance:0, desc, created, initialSet:false });
  accCreateModal.style.display = 'none';
  await apiAccountCreate({ name, balance:0, desc, created, initialSet:false });
  await apiAccountsList();
  refreshAccountOptions();
  renderAccounts();
  saveJSON('accountsData', accountsData);
});
accEditCancel?.addEventListener('click', () => {
  accEditModal.style.display = 'none';
  pendingAccEditIndex = null;
});
accEditForm?.addEventListener('submit', async e => {
  e.preventDefault();
  if (pendingAccEditIndex == null) return;
  const name = (accEditName?.value || '').trim();
  const desc = (accEditDesc?.value || '').trim();
  if (!name) return;
  const oldName = accountsData[pendingAccEditIndex].name;
  if (name !== oldName && accountsData.some((x, i) => x.name === name && i !== pendingAccEditIndex)) { alert('账户名称已存在'); return; }
  accountsData[pendingAccEditIndex].name = name;
  accountsData[pendingAccEditIndex].desc = desc;
  records.forEach(r => { if (r.method === oldName) r.method = name; });
  accEditModal.style.display = 'none';
  pendingAccEditIndex = null;
  await apiAccountUpdateByName({ name: oldName, newName: name, desc });
  await apiAccountsList();
  refreshAccountOptions();
  renderAccounts();
  saveJSON('accountsData', accountsData);
  saveJSON('records', records);
});
accDeleteCancel?.addEventListener('click', () => {
  accDeleteModal.style.display = 'none';
  pendingAccDeleteIndex = null;
});
accDeleteOk?.addEventListener('click', async () => {
  if (pendingAccDeleteIndex != null) {
    const name = accountsData[pendingAccDeleteIndex]?.name || '';
    const ok = await apiAccountDeleteByName(name);
    if (ok) accountsData.splice(pendingAccDeleteIndex,1);
    await apiAccountsList();
    refreshAccountOptions();
    renderAccounts();
    saveJSON('accountsData', accountsData);
  }
  accDeleteModal.style.display = 'none';
  pendingAccDeleteIndex = null;
});
const clientDD = document.getElementById('client-dd');
const clientSearch = document.getElementById('client-search');
const clientList = document.getElementById('client-list');
const clientPlus = document.getElementById('client-plus');
const clientWrap = document.getElementById('client-wrap');
const clientModal = document.getElementById('client-modal');
const clientModalForm = document.getElementById('client-modal-form');
const clientCancel = document.getElementById('client-cancel');
let clientModalTab = 'customers';
const fileViewer = document.getElementById('file-viewer');
const fileViewerBox = document.getElementById('file-viewer-box');
function showFileViewer(url) {
  if (!fileViewer || !fileViewerBox || !url) return;
  fileViewerBox.innerHTML = '';
  const full = document.createElement('img');
  full.src = String(url);
  full.alt = '预览图片';
  fileViewerBox.appendChild(full);
  fileViewer.style.zIndex = '20000';
  try { document.body.appendChild(fileViewer); } catch {}
  fileViewer.style.display = 'flex';
}
window.showFileViewer = showFileViewer;
function openUploadedFile(url, fileName = '') {
  if (!fileViewer || !fileViewerBox || !url) return;
  const lowerName = String(fileName || url || '').toLowerCase();
  fileViewerBox.innerHTML = '';
  if (/\.pdf($|[?#])/i.test(lowerName)) {
    const emb = document.createElement('embed');
    emb.src = String(url);
    emb.type = 'application/pdf';
    fileViewerBox.appendChild(emb);
  } else {
    const full = document.createElement('img');
    full.src = String(url);
    full.alt = '预览图片';
    fileViewerBox.appendChild(full);
  }
  fileViewer.style.zIndex = '20000';
  try { document.body.appendChild(fileViewer); } catch {}
  fileViewer.style.display = 'flex';
}
function allContacts() {
  return [...contactsData.customers, ...contactsData.merchants, ...contactsData.others];
}
function renderClientDropdown() {
  const q = (clientSearch.value || '').trim().toLowerCase();
  const data = allContacts().filter(x => {
    if (!q) return true;
    return [x.name, x.company, x.contact, x.phone, x.city, (x.remark||'')].some(v => String(v||'').toLowerCase().includes(q));
  });
  clientList.innerHTML = '';
  data.forEach(item => {
    const row = document.createElement('div');
    row.className = 'dd-item';
    const left = document.createElement('div');
    left.textContent = item.name;
    const right = document.createElement('div');
    right.style.color = '#94a3b8';
    right.textContent = `${item.contact || ''} ${item.phone || ''} ${item.city || ''}`.trim();
    row.append(left, right);
    row.addEventListener('click', () => {
      entryClient.value = item.name;
      clientDD.style.display = 'none';
    });
    clientList.appendChild(row);
  });
}
function openClientDropdown() {
  clientDD.style.display = 'block';
  clientSearch.value = '';
  renderClientDropdown();
  const entryCard = document.getElementById('entry-form')?.closest('.card');
  if (entryCard) {
    const cr = entryCard.getBoundingClientRect();
    const gap = 16;
    clientDD.style.position = 'fixed';
    clientDD.style.left = `${Math.max(0, cr.left - cr.width - gap)}px`;
    clientDD.style.top = `${cr.top}px`;
    clientDD.style.width = `${cr.width}px`;
    clientDD.style.height = `${cr.height}px`;
    clientDD.style.zIndex = '90';
    const head = clientDD.querySelector('.dd-head');
    const list = clientDD.querySelector('.dd-list');
    const headH = head ? head.getBoundingClientRect().height : 48;
    if (list) { list.style.maxHeight = `${cr.height - headH - 24}px`; list.style.overflow = 'auto'; }
  }
  clientSearch.focus();
}
entryClient.addEventListener('focus', openClientDropdown);
entryClient.addEventListener('click', openClientDropdown);
clientSearch.addEventListener('input', renderClientDropdown);
document.addEventListener('click', (e) => {
  if (!clientWrap.contains(e.target) && !clientDD.contains(e.target)) clientDD.style.display = 'none';
});
clientPlus?.addEventListener('click', () => {
  clientDD.style.display = 'none';
  clientModal.style.display = 'flex';
  clientModalTab = 'customers';
  document.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.getAttribute('data-target') === clientModalTab));
});
document.querySelectorAll('.pill[data-target]').forEach(p => {
  p.addEventListener('click', () => {
    clientModalTab = p.getAttribute('data-target');
    document.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
  });
});
clientCancel?.addEventListener('click', () => {
  clientModal.style.display = 'none';
});
clientModalForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('m-name').value.trim();
  const company = document.getElementById('m-company').value.trim();
  const code = document.getElementById('m-code').value.trim();
  const contact = document.getElementById('m-contact').value.trim();
  const phone = document.getElementById('m-phone').value.trim();
  const country = document.getElementById('m-country').value.trim();
  const address = document.getElementById('m-address').value.trim();
  const zip = document.getElementById('m-zip').value.trim();
  const city = document.getElementById('m-city').value.trim();
  const remark = document.getElementById('m-remark').value.trim();
  if (!name) return;
  const now = new Date();
  const created = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const ownerLabel = clientModalTab==='customers'?'客户':clientModalTab==='merchants'?'商家':'其它';
  const payload = { name, contact, phone, city, remark, owner: ownerLabel, created, company, code, country, address, zip };
  try {
    const id = await apiContactsCreate(payload);
    contactsData[clientModalTab].push({ id, ...payload });
    await apiContactsList(clientModalTab, '', 1, 5000);
  } catch (err) {
    if (err?.data?.error === 'duplicate_name' || err?.message === 'duplicate_name') {
      alert('店铺名称已经存在，请确认后重试');
      return;
    }
    alert('保存失败，请刷新后重试');
    return;
  }
  ['m-name','m-company','m-code','m-contact','m-phone','m-country','m-address','m-zip','m-city','m-remark'].forEach(id => document.getElementById(id).value='');
  clientModal.style.display = 'none';
  entryClient.value = name;
  renderClientDropdown();
  if (location.hash === '#contacts') renderContacts();
  saveJSON('contactsData', contactsData);
});
fileViewer.addEventListener('click', (e) => {
  if (e.target === fileViewer) fileViewer.style.display = 'none';
});
function getCatChildrenByName(name) {
  const cat = categoriesData.find(c => c.name === name);
  return cat ? cat.children : [];
}
function refreshLedgerTypeOptions() {
  // Deprecated: entryType is now hidden input controlled by buttons
  // But we might need to set initial state?
  // Let's ensure default is '收入' if empty
  if (!entryType.value) {
    entryType.value = '收入';
    const switchEl = document.getElementById('entry-type-switch');
    if (switchEl) {
      const btn = switchEl.querySelector('[data-value="收入"]');
      if (btn) btn.classList.add('active');
    }
    setCategories();
  }
}

// Entry Type Switch Logic
const entryTypeSwitch = document.getElementById('entry-type-switch');
if (entryTypeSwitch) {
  const btns = entryTypeSwitch.querySelectorAll('.type-item');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      btns.forEach(b => b.classList.remove('active'));
      // Add active to clicked
      btn.classList.add('active');
      // Set hidden input value
      entryType.value = btn.dataset.value;
      // Trigger change event or call setCategories directly
      setCategories();
    });
  });
}

function setCategories() {
  const t = entryType.value;
  const list = getCatChildrenByName(t);
  const prev = entryCategory.value;
  entryCategory.innerHTML = '<option value="">请选择子类目</option>';
  list.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    entryCategory.appendChild(opt);
  });
  if (list.includes(prev)) entryCategory.value = prev;
}
// entryType.addEventListener('change', setCategories); // No longer needed as hidden input doesn't fire change on programmatic update usually
const entryDoc = document.getElementById('entry-doc');
const docDD = document.getElementById('doc-dd');
const docDDList = document.getElementById('doc-dd-list');

entryCategory.addEventListener('change', () => { entryDoc?.focus(); });
function linkDocToPayable() {
  const doc = (entryDoc?.value || '').trim();
  const type = entryType.value;
  if (!doc) return;
  // Let it find any matching document regardless of current type selection
  const rec = payRecords.find(r => (r.doc||'') === doc);
  if (rec) {
    // Auto set type
    if (rec.type === '应收账款' && type !== '收入') {
      entryType.value = '收入';
      document.querySelectorAll('.type-item.recv').forEach(el => {
        if(el.closest('#page-ledger')) el.click();
      });
    } else if (rec.type === '应付账款' && type !== '支出') {
      entryType.value = '支出';
      document.querySelectorAll('.type-item.pay').forEach(el => {
        if(el.closest('#page-ledger')) el.click();
      });
    }
    entryClient.value = rec.partner || '';
    const remaining = Math.max(0, (rec.amount||0) - (rec.paid||0));
    entryAmount.value = (remaining || rec.amount || 0).toFixed(2);
    if (typeof clientDD !== 'undefined' && clientDD) clientDD.style.display = 'none';
    entryMethod?.focus();
  }
}

function updateDocDropdown() {
  const v = (entryDoc?.value || '').trim();
  if (v.length < 3) {
    if (docDD) docDD.style.display = 'none';
    return;
  }
  
  // Fuzzy search payRecords
  let matches = payRecords.filter(r => {
    return (r.doc || '').toLowerCase().includes(v.toLowerCase()) || 
           (r.partner || '').toLowerCase().includes(v.toLowerCase());
  });
  
  // Sort: unpaid first
  matches.sort((a, b) => {
    const aRemaining = Math.max(0, (a.amount||0) - (a.paid||0));
    const bRemaining = Math.max(0, (b.amount||0) - (b.paid||0));
    const aUnpaid = (!a.settled && aRemaining > 0) ? 1 : 0;
    const bUnpaid = (!b.settled && bRemaining > 0) ? 1 : 0;
    if (aUnpaid !== bUnpaid) return bUnpaid - aUnpaid; // unpaid (1) comes before paid (0)
    return bRemaining - aRemaining; // sort by remaining amount desc
  });
  
  if (matches.length === 0) {
    if (docDD) docDD.style.display = 'none';
    return;
  }
  
  docDDList.innerHTML = '';
  matches.forEach(r => {
    const remaining = Math.max(0, (r.amount||0) - (r.paid||0));
    const isUnpaid = !r.settled && remaining > 0;
    const item = document.createElement('div');
    item.className = 'dd-item';
    const isRecv = /应收/.test(r.type || '');
    if (!isUnpaid) item.style.color = '#ffffff';
    else if (isRecv) item.style.color = 'var(--green)';
    else item.style.color = 'var(--orange)';
    
    const left = document.createElement('div');
    left.innerHTML = `<div style="font-weight:bold">${r.doc || '无单号'}</div><div style="font-size:12px; opacity:0.8">${r.partner || '未知客户'} (${r.type || ''})</div>`;
    
    const right = document.createElement('div');
    right.style.textAlign = 'right';
    right.innerHTML = `<div>总: ${(r.amount||0).toFixed(2)}</div><div style="font-size:12px; opacity:0.8">欠: ${remaining.toFixed(2)}</div>`;
    
    item.appendChild(left);
    item.appendChild(right);
    
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur
      entryDoc.value = r.doc || '';
      docDD.style.display = 'none';
      linkDocToPayable();
    });
    
    docDDList.appendChild(item);
  });
  
  if (docDD) docDD.style.display = 'block';
}

entryDoc?.addEventListener('input', updateDocDropdown);
entryDoc?.addEventListener('focus', updateDocDropdown);

entryDoc?.addEventListener('blur', () => {
  setTimeout(() => { if (docDD) docDD.style.display = 'none'; }, 150);
  linkDocToPayable();
});
entryDoc?.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') {
    if (docDD) docDD.style.display = 'none';
    linkDocToPayable();
    entryMethod?.focus();
  }
});
function adjustSelect(sel, delta) {
  if (!sel) return;
  const len = sel.options.length;
  let idx = sel.selectedIndex;
  idx = Math.max(0, Math.min(len-1, idx + delta));
  sel.selectedIndex = idx;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}
entryMethod?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); adjustSelect(entryMethod, 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); adjustSelect(entryMethod, -1); }
  else if (e.key === 'Enter') { e.preventDefault(); entryMethod.blur(); }
});
let ledgerEditingId = null;
let ledgerEditingFile = '';
let ledgerEditingDate = '';
let ledgerEditingDateTime = '';
let ledgerEditingCreatedBy = '';

function setLedgerEdit(rec) {
  ledgerEditingId = rec.id || null;
  ledgerEditingFile = rec.file || '';
  ledgerEditingDate = rec.date || '';
  ledgerEditingDateTime = rec.dateTime || '';
  ledgerEditingCreatedBy = rec.createdBy || '';
  if (entryType) entryType.value = rec.type || '';
  setCategories();
  if (entryCategory) entryCategory.value = rec.category || '';
  if (entryDoc) entryDoc.value = rec.doc || '';
  if (entryClient) entryClient.value = rec.client || '';
  if (entryAmount) entryAmount.value = Number(rec.amount || 0).toFixed(2);
  if (entryMethod) entryMethod.value = rec.method || '';
  if (entryNotes) entryNotes.value = rec.notes || '';
  if (entryFile) entryFile.value = '';
  if (entrySubmitBtn) entrySubmitBtn.textContent = '保存修改';
  entryForm?.scrollIntoView({ behavior:'smooth', block:'start' });
}
function clearLedgerEdit() {
  ledgerEditingId = null;
  ledgerEditingFile = '';
  ledgerEditingDate = '';
  ledgerEditingDateTime = '';
  ledgerEditingCreatedBy = '';
  if (entrySubmitBtn) entrySubmitBtn.textContent = '提交';
}
async function uploadLedgerAttachment(fileObj) {
  if (!fileObj) throw new Error('missing_file');
  const fileName = String(fileObj.name || '').trim().toLowerCase();
  const mimeType = String(fileObj.type || '').trim().toLowerCase();
  const extOk = ['.jpg', '.jpeg', '.png', '.pdf'].some(ext => fileName.endsWith(ext));
  const mimeOk = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'].includes(mimeType);
  if (!(extOk || mimeOk)) throw new Error('bad_type');
  const fd = new FormData();
  fd.append('file', fileObj);
  const token = getAuthToken();
  const r = await fetch(API_BASE + '/api/upload', {
    method: 'POST',
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
    body: fd
  });
  if (!r.ok) throw new Error('upload_failed');
  const d = await r.json();
  return d.url || '';
}
async function saveLedgerAttachmentForRow(rec, fileObj) {
  const fileUrl = await uploadLedgerAttachment(fileObj);
  if (!fileUrl) throw new Error('upload_failed');
  if (!rec?.id) throw new Error('not_found');
  const res = await fetchWithAuth('/api/ledger/' + String(rec.id) + '/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: fileUrl })
  });
  if (!res.ok && res.status !== 404) {
    if (res.status === 400) throw new Error('not_editable');
    if (res.status === 404) throw new Error('not_found');
    throw new Error('save_failed');
  }
  if (!res.ok && res.status === 404) {
    const fallback = await fetchWithAuth('/api/ledger/' + String(rec.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: rec.type || '',
        category: rec.category || '',
        doc: rec.doc || '',
        client: rec.client || '',
        amount: Number(rec.amount || 0),
        method: rec.method || '',
        file: fileUrl,
        notes: rec.notes || '',
        date: rec.date || '',
        dateTime: rec.dateTime || '',
        createdBy: rec.createdBy || ''
      })
    });
    if (!fallback.ok) {
      if (fallback.status === 400) throw new Error('not_editable');
      if (fallback.status === 404) throw new Error('not_found');
      throw new Error('save_failed');
    }
  }
  await loadLedgerFromServer(true);
}
function render(data) {
  rows.innerHTML = '';
  if (!data.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty';
    const td = document.createElement('td');
    td.colSpan = 11;
    td.textContent = '暂无流水记录';
    tr.appendChild(td);
    rows.appendChild(tr);
    return;
  }
  for (const r of data) {
    const tr = document.createElement('tr');
    const rowEditable = r.confirmed === false && r.id;
    const canUpdate = rowEditable && can('ledger', 'update');
    const canDelete = rowEditable && can('ledger', 'delete');
    const canConfirm = rowEditable && can('ledger', 'confirm');
    const amt = (r.type === '开支' || r.type === '支出') ? (-r.amount).toFixed(2) : r.amount.toFixed(2);
    const makeTd = (text) => {
      const td = document.createElement('td');
      td.textContent = text;
      return td;
    };
    const makeClampTd = (text, options = {}) => {
      const td = document.createElement('td');
      td.className = 'ledger-clamp-cell';
      td.title = text || '';
      const box = document.createElement('div');
      box.className = 'ledger-clamp-text';
      box.textContent = text || '';
      if (options.clickable && text) {
        td.style.cursor = 'pointer';
        td.title = '点击查看完整内容';
        td.addEventListener('click', () => options.onClick?.(text));
      }
      td.appendChild(box);
      return td;
    };
    const makeStackTd = (mainText, subText) => {
      const td = document.createElement('td');
      td.className = 'ledger-stack-cell';
      td.innerHTML = `<div class="ledger-stack-main">${mainText || ''}</div><div class="ledger-stack-sub">${subText || ''}</div>`;
      td.title = [mainText || '', subText || ''].filter(Boolean).join('\n');
      return td;
    };
    tr.appendChild(makeTd(r.type || ''));
    tr.appendChild(makeTd(r.category || ''));
    const tdDoc = document.createElement('td');
    tdDoc.innerHTML = `<div>${r.doc || ''}</div><div style="font-size:12px; color:#94a3b8; margin-top:4px">${r.date || ''}</div>`;
    tr.appendChild(tdDoc);
    tr.appendChild(makeClampTd(r.client || ''));
    tr.appendChild(makeTd(amt));
    tr.appendChild(makeTd(r.method || ''));
    const tdFile = document.createElement('td');
    tdFile.style.minWidth = '72px';
    if (r.fileUrl) {
      if ((r.fileType || '').includes('pdf') || /\.pdf$/i.test(r.fileName||'')) {
        const span = document.createElement('span');
        span.className = 'thumb-pdf';
        span.textContent = 'PDF';
        span.addEventListener('click', () => {
          fileViewerBox.innerHTML = '';
          const emb = document.createElement('embed');
          emb.src = r.fileUrl;
          emb.type = 'application/pdf';
          fileViewerBox.appendChild(emb);
          fileViewer.style.display = 'flex';
        });
        tdFile.appendChild(span);
      } else {
        const img = document.createElement('img');
        img.className = 'thumb-img';
        img.src = r.fileUrl;
        img.alt = r.fileName || '附件';
        img.addEventListener('click', () => {
          fileViewerBox.innerHTML = '';
          const full = document.createElement('img');
          full.src = r.fileUrl;
          fileViewerBox.appendChild(full);
          fileViewer.style.display = 'flex';
        });
        tdFile.appendChild(img);
      }
    } else if (!r.file && canUpdate) {
      const filePicker = document.createElement('input');
      filePicker.type = 'file';
      filePicker.accept = '.jpg,.jpeg,.png,.pdf';
      filePicker.style.display = 'none';
      const idleHtml = '<div style="font-size:13px; line-height:1">📎</div><div style="margin-top:2px; font-weight:700; font-size:11px">上传</div>';
      const busyHtml = '<div style="font-size:13px; line-height:1">⏳</div><div style="margin-top:2px; font-weight:700; font-size:11px">上传中</div>';
      const dropZone = document.createElement('div');
      dropZone.innerHTML = idleHtml;
      dropZone.title = '拖拽或点击上传 JPG / PNG / PDF';
      dropZone.style.width = '52px';
      dropZone.style.minWidth = '52px';
      dropZone.style.padding = '4px 3px';
      dropZone.style.minHeight = '38px';
      dropZone.style.border = '2px dashed #60a5fa';
      dropZone.style.borderRadius = '8px';
      dropZone.style.display = 'flex';
      dropZone.style.flexDirection = 'column';
      dropZone.style.alignItems = 'center';
      dropZone.style.justifyContent = 'center';
      dropZone.style.textAlign = 'center';
      dropZone.style.color = '#cbd5e1';
      dropZone.style.cursor = 'pointer';
      dropZone.style.fontSize = '11px';
      dropZone.style.lineHeight = '1.15';
      dropZone.style.background = 'rgba(59,130,246,0.08)';
      dropZone.style.boxShadow = 'inset 0 0 0 1px rgba(96,165,250,0.15)';
      dropZone.style.transition = 'all 0.15s ease';
      dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.style.borderColor = '#38bdf8';
        dropZone.style.color = '#ffffff';
        dropZone.style.background = 'rgba(59,130,246,0.18)';
        dropZone.style.transform = 'scale(1.02)';
        dropZone.style.boxShadow = '0 0 0 2px rgba(56,189,248,0.16)';
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = '#60a5fa';
        dropZone.style.color = '#cbd5e1';
        dropZone.style.background = 'rgba(59,130,246,0.08)';
        dropZone.style.transform = 'none';
        dropZone.style.boxShadow = 'inset 0 0 0 1px rgba(96,165,250,0.15)';
      });
      dropZone.addEventListener('click', () => filePicker.click());
      filePicker.addEventListener('change', async () => {
        const fileObj = filePicker.files?.[0];
        if (!fileObj) return;
        dropZone.innerHTML = busyHtml;
        try {
          await saveLedgerAttachmentForRow(r, fileObj);
        } catch (err) {
          if (err?.message === 'bad_type') alert('仅支持 JPG、PNG 或 PDF 文件');
          else if (err?.message === 'not_editable') alert('当前本地测试环境下，这条记录需要上线后才能补传附件');
          else alert('上传失败，请重试');
          dropZone.innerHTML = idleHtml;
        }
        filePicker.value = '';
      });
      dropZone.addEventListener('drop', async e => {
        e.preventDefault();
        dropZone.style.borderColor = '#60a5fa';
        dropZone.style.color = '#cbd5e1';
        dropZone.style.background = 'rgba(59,130,246,0.08)';
        dropZone.style.transform = 'none';
        dropZone.style.boxShadow = 'inset 0 0 0 1px rgba(96,165,250,0.15)';
        const fileObj = e.dataTransfer?.files?.[0];
        if (!fileObj) return;
        dropZone.innerHTML = busyHtml;
        try {
          await saveLedgerAttachmentForRow(r, fileObj);
        } catch (err) {
          if (err?.message === 'bad_type') alert('仅支持 JPG、PNG 或 PDF 文件');
          else if (err?.message === 'not_editable') alert('当前本地测试环境下，这条记录需要上线后才能补传附件');
          else alert('上传失败，请重试');
          dropZone.innerHTML = idleHtml;
        }
      });
      tdFile.appendChild(filePicker);
      tdFile.appendChild(dropZone);
    } else {
      tdFile.textContent = r.file ? r.file : '-';
    }
    tr.appendChild(tdFile);
    tr.appendChild(makeStackTd(r.createdBy || '-', `确认：${r.confirmedBy || (r.confirmed === false ? '未确认' : r.createdBy || '-')}`));
    tr.appendChild(makeClampTd(r.notes || '', { clickable: true, onClick: openLedgerNotesModal }));
    const uploadDate = r.dateTime ? r.dateTime.split(' ')[0] : (r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : '');
    tr.appendChild(makeTd(uploadDate));
    const tdOps = document.createElement('td');
    tdOps.style.textAlign = 'center';
    if (canUpdate || canDelete || canConfirm) {
      const opsWrap = document.createElement('div');
      opsWrap.style.display = 'inline-flex';
      opsWrap.style.alignItems = 'center';
      opsWrap.style.justifyContent = 'center';
      opsWrap.style.gap = '8px';
      if (canUpdate) {
        const editBtn = document.createElement('button'); editBtn.type = 'button'; editBtn.textContent = '修改'; editBtn.className = 'btn-sm btn-outline-blue';
        editBtn.addEventListener('click', e => {
          e.preventDefault();
          setLedgerEdit(r);
        });
        opsWrap.appendChild(editBtn);
      }
      if (canConfirm) {
        const okBtn = document.createElement('button'); okBtn.type = 'button'; okBtn.textContent = '确认'; okBtn.className = 'btn-sm btn-outline-green';
        okBtn.addEventListener('click', async e => {
          e.preventDefault();
          try {
            await apiFetchJSON('/api/ledger/' + String(r.id) + '/confirm', { method:'PUT' });
            clearLedgerEdit();
            loadLedgerFromServer(true);
            loadPayablesFromServer();
            apiAccountsList().then(() => { refreshAccountOptions(); renderAccounts(); });
          } catch {}
        });
        opsWrap.appendChild(okBtn);
      }
      if (canDelete) {
        const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.textContent = '删除'; delBtn.className = 'btn-sm btn-outline-red';
        delBtn.addEventListener('click', async e => {
          e.preventDefault();
          openConfirm('确定要彻底删除这条记录吗？删除后相关的统计将被抹除且不可恢复。', async () => {
            try {
              await apiFetchJSON('/api/ledger/' + String(r.id), { method: 'DELETE' });
              loadLedgerFromServer(true);
              if (document.getElementById('page-home')?.style.display === 'block') {
                renderHomeChart(homePeriodSel?.value || 'month');
                renderSalesChart(salesPeriodSel?.value || 'month');
              }
            } catch (err) {
              console.error(err);
              alert('删除失败');
            }
          });
        });
        opsWrap.appendChild(delBtn);
      }
      tdOps.appendChild(opsWrap);
    }
    tr.appendChild(tdOps);
    if (r.type === '收入') tr.classList.add('row-income');
    if (r.type === '开支' || r.type === '支出') tr.classList.add('row-expense');
    rows.appendChild(tr);
  }
}
function getFilters() {
  const t = filterType.value;
  const key = filterKey.value.trim().toLocaleLowerCase();
  const s = filterStart.value ? new Date(filterStart.value) : null;
  const e = filterEnd.value ? new Date(filterEnd.value) : null;
  return { t, key, s, e };
}
function buildAmountSearchTexts(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return [];
  return Array.from(new Set([
    String(value ?? '').trim(),
    String(num),
    num.toFixed(2)
  ].filter(Boolean))).map(x => x.toLocaleLowerCase());
}
function applyFilters(preserveScroll = false) {
  const { t, key, s, e } = getFilters();
  const outAll = records.filter(r => {
    if (t !== 'all' && r.type !== t) return false;
    if (ledgerHdrType !== 'all') {
      if (ledgerHdrType === '开支') { if (!(r.type === '开支' || r.type === '支出')) return false; }
      else if (r.type !== ledgerHdrType) return false;
    }
    if (ledgerHdrCat && r.category !== ledgerHdrCat) return false;
    if (ledgerHdrOwner) {
      const owner = clientOwner(r.client || '');
      if (owner !== ledgerHdrOwner) return false;
    }
    if (ledgerHdrMethod && (r.method || '') !== ledgerHdrMethod) return false;
    if (ledgerHdrConfirm === 'confirmed' && r.confirmed === false) return false;
    if (ledgerHdrConfirm === 'unconfirmed' && r.confirmed !== false) return false;
    if (key) {
      const client = (r.client || '').toLocaleLowerCase();
      const notes = (r.notes || '').toLocaleLowerCase();
      const amountTexts = buildAmountSearchTexts(r.amount);
      if (!(client.includes(key) || notes.includes(key) || amountTexts.some(v => v.includes(key)))) return false;
    }
    const d = new Date(r.date);
    if (s && d < s) return false;
    if (e && d > e) return false;
    return true;
  });
  function ts(r) {
    const t1 = r.createdAt || 0;
    const t2 = r.dateTime ? Date.parse(r.dateTime) : 0;
    const t3 = r.date ? Date.parse(r.date) : 0;
    return t1 || t2 || t3 || 0;
  }
  outAll.sort((a,b) => ts(b) - ts(a));
  const total = outAll.length;
  const totalPages = Math.max(1, Math.ceil(total / ledgerPageSize));
  if (ledgerPage > totalPages) ledgerPage = totalPages;
  const startIdx = (ledgerPage - 1) * ledgerPageSize;
  const out = outAll.slice(startIdx, startIdx + ledgerPageSize);
  
  const currentScroll = ledgerTableWrap ? ledgerTableWrap.scrollTop : 0;
  
  render(out);
  
  if (ledgerTableWrap) {
    if (preserveScroll) {
      ledgerTableWrap.scrollTop = currentScroll;
    } else {
      ledgerTableWrap.scrollTop = 0;
    }
  }
  updateLedgerHeaderCover();
  const gp = document.getElementById('global-pager'); if (gp) gp.style.display = 'flex';
  if (ledgerPager) {
    ledgerPager.innerHTML = '';
    ledgerPager.style.display = 'flex';
    const makeBtn = (label, page, disabled=false, active=false) => {
      const b = document.createElement('a');
      b.href = '#'; b.textContent = label;
      b.style.padding = '4px 8px';
      b.style.border = '1px solid #334155';
      b.style.borderRadius = '4px';
      b.style.color = active ? '#000' : '#cbd5e1';
      b.style.background = active ? '#cbd5e1' : 'transparent';
      b.style.pointerEvents = disabled ? 'none' : 'auto';
      b.style.opacity = disabled ? '0.4' : '1';
      b.addEventListener('click', e => { e.preventDefault(); ledgerPage = page; applyFilters(); });
      ledgerPager.appendChild(b);
    };
    makeBtn('«', Math.max(1, ledgerPage-1), ledgerPage<=1);
    const maxButtons = 9;
    let start = Math.max(1, ledgerPage - Math.floor(maxButtons/2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    for (let p = start; p <= end; p++) makeBtn(String(p), p, false, p===ledgerPage);
    makeBtn('»', Math.min(totalPages, ledgerPage+1), ledgerPage>=totalPages);
  }
  const infoEl = document.getElementById('pay-footer-info');
  if (infoEl) {
    const totalCount = (records || []).length;
    const todayStr = (() => { const d = new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; })();
    const toTs = r => r.createdAt || (r.dateTime ? Date.parse(r.dateTime) : 0) || (r.date ? Date.parse(r.date) : 0) || 0;
    const todayCount = (records || []).filter(r => {
      const t = toTs(r); if (!t) return false;
      const d = new Date(t); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${dd}` === todayStr;
    }).length;
    const latestTs = Math.max(0, ...((records||[]).map(toTs)));
    const latestCount = latestTs ? (records || []).filter(r => toTs(r) === latestTs).length : 0;
    const mk = (text) => { const s = document.createElement('span'); s.className = 'info-pill'; s.textContent = text; return s; };
    infoEl.innerHTML = '';
    infoEl.appendChild(mk(`共 ${totalCount} 条记录`));
    infoEl.appendChild(mk(`今日上传 ${todayCount} 条`));
    infoEl.appendChild(mk(`最后次上传 ${latestCount || 1} 条`));
  }
}
filterKey.addEventListener('input', applyFilters);
filterType.addEventListener('change', () => { ledgerPage = 1; applyFilters(); });
filterStart.addEventListener('change', () => { ledgerPage = 1; applyFilters(); });
filterEnd.addEventListener('change', () => { ledgerPage = 1; applyFilters(); });
document.getElementById('system-clear-ledger')?.addEventListener('click', async () => {
  if (!confirm('确认清空收支记账的所有数据？此操作不可撤销。')) return;
  try {
    await apiFetchJSON('/api/ledger', { method:'DELETE' });
    records.splice(0, records.length);
    saveJSON('records', records);
    loadLedgerFromServer();
    loadPayablesFromServer();
    apiAccountsList().then(() => { refreshAccountOptions(); renderAccounts(); });
    renderContacts();
  } catch {}
});
document.getElementById('system-clear-pay')?.addEventListener('click', async () => {
  if (!confirm('确定清空应收/应付所有记录？此操作不可恢复')) return;
  try {
    await apiFetchJSON('/api/payables', { method:'DELETE' });
    payRecords.splice(0, payRecords.length);
    saveJSON('payRecords', payRecords);
    payPage = 1;
    loadPayablesFromServer();
    renderContacts();
  } catch {}
});
document.getElementById('entry-form').addEventListener('submit', async e => {
  e.preventDefault();
  [document.getElementById('entry-doc'), entryClient, entryAmount, entryMethod].forEach(el => el?.classList.remove('invalid'));
  const u = getAuthUser(); const roleName = u?.role || '';
  if (roleName !== '超级管理员') {
    const role = rolesData.find(r => r.name === roleName);
    const allowed = !!(role && role.perms && role.perms.ledger && role.perms.ledger.view);
    if (!allowed) { alert('当前角色无“收支记账”权限'); return; }
  }

  const type = entryType.value;
  const category = entryCategory.value;
  const doc = (document.getElementById('entry-doc')?.value || '').trim();
  const clientVal = (entryClient.value || '').trim();
  const amountStr = (entryAmount.value || '').trim();
  const method = entryMethod.value;
  if (!type || !category) return;
  const invalidEls = [];
  if (!doc) invalidEls.push(document.getElementById('entry-doc'));
  if (!clientVal) invalidEls.push(entryClient);
  if (!amountStr) invalidEls.push(entryAmount);
  if (!method) invalidEls.push(entryMethod);
  if (invalidEls.length) {
    invalidEls.forEach(el => {
      if (!el) return;
      el.classList.add('invalid');
      const clear = () => el.classList.remove('invalid');
      el.addEventListener('input', clear, { once: true });
      el.addEventListener('change', clear, { once: true });
    });
    invalidEls[0]?.focus();
    return;
  }
  const amount = parseFloat(amountStr || '0');
  const fileObj = entryFile.files[0] || null;
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const dateTime = `${date} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  let fileUrl = '';
  if (fileObj) {
    try {
      fileUrl = await uploadLedgerAttachment(fileObj);
    } catch(e) {
      if (e?.message === 'bad_type') { alert('单条记录仅支持 JPG/PNG 或 PDF 文件'); return; }
      console.warn('upload failed', e);
    }
  }
  
  try {
    if (ledgerEditingId) {
      const finalFile = fileUrl || ledgerEditingFile;
      const finalDate = ledgerEditingDate || date;
      const finalDateTime = ledgerEditingDateTime || dateTime;
      await apiFetchJSON('/api/ledger/' + String(ledgerEditingId), {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ type, category, doc, client: clientVal, amount, method, file: finalFile, notes: entryNotes.value.trim(), date: finalDate, dateTime: finalDateTime, createdBy: ledgerEditingCreatedBy })
      });
      clearLedgerEdit();
    } else {
      await apiFetchJSON('/api/ledger', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ type, category, doc, client: clientVal, amount, method, file: fileUrl, notes: entryNotes.value.trim(), date, dateTime, createdBy: (getAuthUser()?.name || ''), confirmed:false })
      });
    }
  } catch {}
  loadLedgerFromServer(true);
  document.getElementById('entry-doc').value = '';
  entryClient.value = '';
  entryAmount.value = '';
  entryMethod.value = '';
  entryFile.value = '';
  entryNotes.value = '';
  [document.getElementById('entry-doc'), entryClient, entryAmount, entryMethod].forEach(el => el?.classList.remove('invalid'));
  // ledgerPage = 1; // Removed to preserve current page after edit/save
  // applyFilters(); // Removed because loadLedgerFromServer(true) already calls applyFilters(true)
  saveJSON('records', records.map(r => {
    const { fileUrl, ...rest } = r;
    return rest;
  }));
  saveJSON('accountsData', accountsData);
  if (document.getElementById('page-home')?.style.display === 'block') {
    renderHomeChart(homePeriodSel?.value || 'month');
    renderSalesChart(salesPeriodSel?.value || 'month');
  }
});
const payRows = document.getElementById('pay-rows');
const payType = document.getElementById('pay-type');
const payPartner = document.getElementById('pay-partner');
const partnerAdd = document.getElementById('partner-add');
const payDoc = document.getElementById('pay-doc');
const paySales = document.getElementById('pay-sales');
const payAmount = document.getElementById('pay-amount');
const payTrust = document.getElementById('pay-trust');
const payNotes = document.getElementById('pay-notes');
const payForm = document.getElementById('pay-form');
const paySubmitBtn = payForm?.querySelector('button[type="submit"]');
function payDocExists(doc, recType, excludeId) {
  const d = String(doc || '').trim();
  if (!d) return false;
  return payRecords.some(r => String(r.doc||'').trim() === d && r.type === recType && (!excludeId || r.id !== excludeId));
}
function setPayDocInvalid(flag) {
  if (!payDoc) return;
  payDoc.style.color = flag ? 'var(--red)' : '';
  const lbl = document.getElementById('pay-label-doc');
  if (lbl) {
    if (flag) lbl.classList.add('invalid-label'); else lbl.classList.remove('invalid-label');
  }
}
function validatePayDoc(showAlert) {
  const type = payType?.value || '';
  const doc = (payDoc?.value || '').trim();
  if (!type || !doc) { setPayDocInvalid(false); return; }
  const exists = payDocExists(doc, type, payEditingId);
  setPayDocInvalid(exists);
  if (exists && showAlert) alert('凭证号已存在');
}
payDoc?.addEventListener('input', () => validatePayDoc(false));
payDoc?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    validatePayDoc(true);
    if (payDoc.style.color) { e.preventDefault(); e.stopPropagation(); }
  }
});
payType?.addEventListener('change', () => validatePayDoc(false));
const payImportFile = document.getElementById('pay-import-file');
payImportFile?.addEventListener('click', () => { try { payImportFile.value = ''; } catch {} });
const payImportHint = document.getElementById('pay-import-hint');
const payImportModal = document.getElementById('pay-import-modal');
const payImportRows = document.getElementById('pay-import-rows');
const payImportSummary = document.getElementById('pay-import-summary');
const payImportCancel = document.getElementById('pay-import-cancel');
const payImportCommit = document.getElementById('pay-import-commit');
const sumRecvEl = document.getElementById('sum-recv');
const sumPayEl = document.getElementById('sum-pay');
const payFilterKey = document.getElementById('pay-filter-key');
const payExportBtn = document.getElementById('pay-export');
const payClearBtn = document.getElementById('pay-clear');
const PAY_IMPORT_HINT_DEFAULT = '图片/PDF作为单条附件，Excel/CSV作为批量导入';
function setPayImportHintText(text) {
  if (payImportHint) payImportHint.textContent = text || PAY_IMPORT_HINT_DEFAULT;
}
function isPayablesAttachmentFile(fileObj) {
  if (!fileObj) return false;
  const fileName = String(fileObj.name || '').trim().toLowerCase();
  const mimeType = String(fileObj.type || '').trim().toLowerCase();
  const extOk = ['.jpg', '.jpeg', '.png', '.pdf'].some(ext => fileName.endsWith(ext));
  const mimeOk = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'].includes(mimeType);
  return extOk || mimeOk;
}
function isPayablesImportSheet(fileObj) {
  const fileName = String(fileObj?.name || '').trim().toLowerCase();
  return ['.csv', '.xls', '.xlsx'].some(ext => fileName.endsWith(ext));
}
let paySubmitLock = false;
let payLastPageData = [];
const payPager = document.getElementById('global-pager-controls') || document.getElementById('pay-pager');
const payFooterInfo = document.getElementById('pay-footer-info');
const payTableWrap = document.getElementById('pay-table-wrap');
const thType = document.getElementById('th-type');
const thTypeDD = document.getElementById('th-type-dd');
const thTypeList = document.getElementById('th-type-list');
const thTypeLabel = document.getElementById('th-type-label');
const thPartner = document.getElementById('th-partner');
const thPartnerDD = document.getElementById('th-partner-dd');
const thPartnerList = document.getElementById('th-partner-list');
const thPartnerLabel = document.getElementById('th-partner-label');
const thSales = document.getElementById('th-sales');
const thSalesDD = document.getElementById('th-sales-dd');
const thSalesList = document.getElementById('th-sales-list');
const thSalesLabel = document.getElementById('th-sales-label');
const thArrears = document.getElementById('th-arrears');
const thArrearsDD = document.getElementById('th-arrears-dd');
const thArrearsList = document.getElementById('th-arrears-list');
const thArrearsLabel = document.getElementById('th-arrears-label');
const thTrust = document.getElementById('th-trust');
const thTrustDD = document.getElementById('th-trust-dd');
const thTrustList = document.getElementById('th-trust-list');
const thTrustLabel = document.getElementById('th-trust-label');
const thAction = document.getElementById('th-action');
const thActionDD = document.getElementById('th-action-dd');
const thActionList = document.getElementById('th-action-list');
const thActionLabel = document.getElementById('th-action-label');
let payFilterPartnerName = '';
let payFilterSalesName = '';
let payFilterStatus = 'all';
let payFilterType = 'all';
let payFilterOverdue = 'all';
let payFilterAction = 'all';
let payPage = 1;
const payPageSize = 100;
function setLabel(el, text, active) {
  if (!el) return;
  el.textContent = text + ' ▾';
  el.style.color = active ? '#ef4444' : '';
}
function openTypeFilter() {
  thTypeDD.style.display = 'block';
  thTypeList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className='dd-item'; row.textContent = label;
    row.addEventListener('click', () => { payFilterType = val; thTypeDD.style.display='none'; setLabel(thTypeLabel, val==='all'?'款项类型':'应'+(val==='recv'?'收':'付'), val!=='all'); payPage = 1; renderPayables(); });
    thTypeList.appendChild(row);
  };
  addItem('全部', 'all');
  addItem('应收', 'recv');
  addItem('应付', 'pay');
}
function openSalesFilter() {
  thSalesDD.style.display = 'block';
  thSalesList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className='dd-item'; row.textContent = label;
    row.addEventListener('click', () => { payFilterSalesName = val; thSalesDD.style.display='none'; setLabel(thSalesLabel, val ? (val==='__none__'?'无业务员':val) : '业务员', !!val); payPage = 1; renderPayables(); });
    thSalesList.appendChild(row);
  };
  addItem('全部', '');
  addItem('无业务员', '__none__');
  (salesData || []).forEach(s => addItem(s.name, s.name));
}
function openPartnerFilter() {
  thPartnerDD.style.display = 'block';
  thPartnerList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className = 'dd-item'; row.textContent = label;
    row.addEventListener('click', () => {
      payFilterPartnerName = val;
      thPartnerDD.style.display = 'none';
      setLabel(thPartnerLabel, val || '往来单位', !!val);
      payPage = 1;
      renderPayables();
    });
    thPartnerList.appendChild(row);
  };
  addItem('全部', '');
  [...new Set((payRecords || []).map(r => String(r.partner || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .forEach(name => addItem(name, name));
}
function openArrearsFilter() {
  thArrearsDD.style.display = 'block';
  thArrearsList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className='dd-item'; row.textContent = label;
    row.addEventListener('click', () => { payFilterStatus = val; thArrearsDD.style.display='none'; setLabel(thArrearsLabel, val==='all'?'欠款':(val==='arrears'?'欠款订单':'订单完成'), val!=='all'); payPage = 1; renderPayables(); });
    thArrearsList.appendChild(row);
  };
  addItem('全部订单', 'all');
  addItem('欠款订单', 'arrears');
  addItem('订单完成', 'done');
}
function openTrustFilter() {
  thTrustDD.style.display = 'block';
  thTrustList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className='dd-item'; row.textContent = label;
    row.addEventListener('click', () => { payFilterOverdue = val; thTrustDD.style.display='none'; setLabel(thTrustLabel, val==='all'?'信任天数':(val==='overdue'?'已逾期':'未逾期'), val!=='all'); payPage = 1; renderPayables(); });
    thTrustList.appendChild(row);
  };
  addItem('全部', 'all');
  addItem('已逾期', 'overdue');
  addItem('未逾期', 'not');
}
function openActionFilter() {
  thActionDD.style.display = 'block';
  thActionList.innerHTML = '';
  const addItem = (label, val) => {
    const row = document.createElement('div'); row.className = 'dd-item'; row.textContent = label;
    row.addEventListener('click', () => {
      payFilterAction = val;
      thActionDD.style.display = 'none';
      setLabel(thActionLabel, val === 'all' ? '操作' : (val === 'confirmed' ? '已确认' : '未确认'), val !== 'all');
      payPage = 1;
      renderPayables();
    });
    thActionList.appendChild(row);
  };
  addItem('全部', 'all');
  addItem('已确认', 'confirmed');
  addItem('未确认', 'unconfirmed');
}
thType?.addEventListener('click', (e) => { e.stopPropagation(); openTypeFilter(); });
thPartner?.addEventListener('click', (e) => { e.stopPropagation(); openPartnerFilter(); });
thSales?.addEventListener('click', (e) => { e.stopPropagation(); openSalesFilter(); });
thArrears?.addEventListener('click', (e) => { e.stopPropagation(); openArrearsFilter(); });
thTrust?.addEventListener('click', (e) => { e.stopPropagation(); openTrustFilter(); });
thAction?.addEventListener('click', (e) => { e.stopPropagation(); openActionFilter(); });
const typeSwitch = document.getElementById('type-switch');
const typeItems = typeSwitch ? typeSwitch.querySelectorAll('.type-item') : [];
function setPayType(val) {
  payType.value = val;
  typeItems.forEach(btn => {
    const is = btn.getAttribute('data-type') === val;
    btn.classList.toggle('active', is);
    btn.classList.toggle('recv', is && val === '应收账款');
    btn.classList.toggle('pay', is && val === '应付账款');
  });
}
typeItems.forEach(btn => {
  btn.addEventListener('click', () => setPayType(btn.getAttribute('data-type')));
});
setPayType('应收账款');
const payWrap = document.getElementById('pay-wrap');
const payDD = document.getElementById('pay-dd');
const paySearch = document.getElementById('pay-search');
const payList = document.getElementById('pay-list');
partnerAdd?.addEventListener('click', () => {
  const name = payPartner.value.trim();
  if (!name) return;
  if (!partners.includes(name)) partners.push(name);
});
function renderPayDropdown() {
  const q = (paySearch?.value || payPartner.value || '').trim().toLowerCase();
  const data = allContacts().filter(x => {
    if (!q) return true;
    return [x.name, x.company, x.contact, x.phone, x.city, (x.remark||'')].some(v => String(v||'').toLowerCase().includes(q));
  });
  payList.innerHTML = '';
  data.forEach(item => {
    const row = document.createElement('div');
    row.className = 'dd-item';
    const left = document.createElement('div');
    left.textContent = item.name;
    const right = document.createElement('div');
    right.style.color = '#94a3b8';
    right.textContent = `${item.contact || ''} ${item.phone || ''} ${item.city || ''}`.trim();
    row.append(left, right);
    row.addEventListener('click', () => {
      payPartner.value = item.name;
      if (paySales) {
        const bound = (item.sales || '').trim();
        paySales.value = bound && [...paySales.options].some(o => o.value === bound) ? bound : '';
      }
      payDD.style.display = 'none';
      document.getElementById('pay-label-partner')?.classList.remove('invalid-label');
    });
    payList.appendChild(row);
  });
}
function openPayDropdown() {
  const card = document.getElementById('pay-form')?.closest('.card') || document.querySelector('#page-payables .row .card:nth-child(2)');
  const cr = card?.getBoundingClientRect();
  const ddHead = payDD.querySelector('.dd-head');
  if (ddHead) ddHead.style.display = 'block';
  payDD.style.display = 'block';
  payDD.style.position = 'fixed';
  if (cr) {
    const gap = 16;
    payDD.style.left = `${Math.max(0, cr.left - cr.width - gap)}px`;
    payDD.style.top = `${cr.top}px`;
    payDD.style.width = `${cr.width}px`;
    payDD.style.height = `${cr.height}px`;
    const head = payDD.querySelector('.dd-head');
    const list = payDD.querySelector('.dd-list');
    const headH = head ? head.getBoundingClientRect().height : 48;
    if (list) { list.style.maxHeight = `${cr.height - headH - 24}px`; list.style.overflow = 'auto'; }
  }
  payDD.style.zIndex = '90';
  renderPayDropdown();
}
payPartner.addEventListener('focus', openPayDropdown);
payPartner.addEventListener('click', openPayDropdown);
payPartner.addEventListener('input', renderPayDropdown);
payPartner.addEventListener('input', () => {
  if ((payPartner.value || '').trim()) document.getElementById('pay-label-partner')?.classList.remove('invalid-label');
});
paySearch?.addEventListener('input', renderPayDropdown);
document.addEventListener('click', (e) => {
  if (!payWrap?.contains(e.target) && !payDD?.contains(e.target)) payDD.style.display = 'none';
  if (!thType?.contains(e.target)) thTypeDD.style.display = 'none';
  if (!thPartner?.contains(e.target)) thPartnerDD.style.display = 'none';
  if (!thSales?.contains(e.target)) thSalesDD.style.display = 'none';
  if (!thArrears?.contains(e.target)) thArrearsDD.style.display = 'none';
  if (!thTrust?.contains(e.target)) thTrustDD.style.display = 'none';
  if (!thAction?.contains(e.target)) thActionDD.style.display = 'none';
  if (!ldType?.contains(e.target)) ldTypeDD.style.display = 'none';
  if (!ldCat?.contains(e.target)) ldCatDD.style.display = 'none';
  if (!ldOwner?.contains(e.target)) ldOwnerDD.style.display = 'none';
  if (!ldMethod?.contains(e.target)) ldMethodDD.style.display = 'none';
  if (!ldConfirm?.contains(e.target)) ldConfirmDD.style.display = 'none';
});
const payHistoryModal = document.getElementById('pay-history-modal');
const payHistoryHead = document.getElementById('pay-history-head');
const payHistoryList = document.getElementById('pay-history-list');
const payHistoryClose = document.getElementById('pay-history-close');
const payHistoryNotesText = document.getElementById('pay-history-notes-text');
const payHistoryNotesInput = document.getElementById('pay-history-notes-input');
const payHistoryNotesAdd = document.getElementById('pay-history-notes-add');
const payHistoryAttachment = document.getElementById('pay-history-attachment');
const payHistoryAttachmentContent = document.getElementById('pay-history-attachment-content');
let payHistoryCurrentRec = null;
function renderPayHistoryAttachment(rec) {
  if (!payHistoryAttachment || !payHistoryAttachmentContent) return;
  const fileUrl = rec.fileUrl || rec.file || '';
  const fileName = rec.fileName || rec.file || '查看附件';
  payHistoryAttachment.style.display = 'block';
  payHistoryAttachmentContent.innerHTML = '';
  if (fileUrl) {
    const lowerName = String(fileName).toLowerCase();
    if (/\.pdf($|[?#])/i.test(lowerName)) {
      const pdfBtn = document.createElement('div');
      pdfBtn.className = 'thumb-pdf';
      pdfBtn.textContent = `PDF: ${String(fileName).split('/').pop()}`;
      pdfBtn.style.display = 'inline-block';
      pdfBtn.style.maxWidth = '100%';
      pdfBtn.title = '点击查看附件';
      pdfBtn.addEventListener('click', () => openUploadedFile(fileUrl, fileName));
      payHistoryAttachmentContent.appendChild(pdfBtn);
    } else {
      const img = document.createElement('img');
      img.src = fileUrl;
      img.alt = String(fileName).split('/').pop() || '附件';
      img.style.maxWidth = '160px';
      img.style.maxHeight = '160px';
      img.style.borderRadius = '8px';
      img.style.border = '1px solid #334155';
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => openUploadedFile(fileUrl, fileName));
      payHistoryAttachmentContent.appendChild(img);
    }
    return;
  }
  const empty = document.createElement('div');
  empty.textContent = '暂无附件';
  empty.style.color = '#94a3b8';
  payHistoryAttachmentContent.appendChild(empty);
}
function buildPayHistoryRowText(h) {
  const amt = typeof h.amount === 'number' ? h.amount.toFixed(2) : (h.amount || '');
  return `${h.date || ''}  ${h.user || ''}${h.kind ? '  操作：' + h.kind : ''}${amt ? '  金额：'+amt : ''}${h.method ? '  方式：'+h.method : ''}${h.notes ? '  备注：'+h.notes : ''}`;
}
function openPayHistory(rec) {
  const latestRec = payRecords.find(x => (rec?.id && x.id === rec.id) || ((x.doc || '') === (rec?.doc || '') && (x.type || '') === (rec?.type || ''))) || rec;
  rec = normalizePayRecordAttachment(latestRec);
  const total = (rec.amount || 0);
  const paid = (rec.paid || 0);
  const arrears = Math.max(0, total - paid);
  payHistoryHead.innerHTML = `<div>单据号：${rec.doc || ''}　往来单位：${rec.partner || ''}　金额：${total.toFixed(2)}　已付：${paid.toFixed(2)}　欠款：${arrears.toFixed(2)}</div>`;
  renderPayHistoryAttachment(rec);
  payHistoryNotesText.textContent = rec.notes || '';
  if (payHistoryNotesInput) payHistoryNotesInput.value = '';
  payHistoryCurrentRec = rec;
  const hist = Array.isArray(rec.history) ? rec.history.slice() : [];
  if (rec.confirmed === true && rec.confirmedBy && rec.confirmedAt && !hist.some(h => String(h?.kind || '') === '确认')) {
    hist.push({
      date: rec.confirmedAt,
      user: rec.confirmedBy,
      kind: '确认',
      amount: typeof rec.amount === 'number' ? rec.amount : Number(rec.amount || 0)
    });
  }
  payHistoryList.innerHTML = '';
  if (!hist.length) {
    const div = document.createElement('div'); div.textContent = '暂无历史记录';
    payHistoryList.appendChild(div);
  } else {
    hist.forEach(h => {
      const row = document.createElement('div');
      row.textContent = buildPayHistoryRowText(h);
      payHistoryList.appendChild(row);
    });
  }
  payHistoryModal.style.display = 'flex';
}
payHistoryClose?.addEventListener('click', () => { payHistoryModal.style.display = 'none'; });
payHistoryNotesAdd?.addEventListener('click', () => {
  const rec = payHistoryCurrentRec;
  const text = (payHistoryNotesInput?.value || '').trim();
  if (!rec || !text || rec.confirmed === true) return;
  const now = new Date();
  const dt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const user = (getAuthUser()?.name) || '';
  rec.history = rec.history || [];
  rec.history.push({ date: dt, user, kind: '备注', amount: '', partner: rec.partner, doc: rec.doc, notes: text });
  rec.notes = [rec.notes || '', text].filter(Boolean).join('\n');
  payHistoryNotesText.textContent = rec.notes || '';
  const row = document.createElement('div');
  row.textContent = buildPayHistoryRowText({ date: dt, user, kind: '备注', notes: text });
  payHistoryList.appendChild(row);
  if (payHistoryNotesInput) payHistoryNotesInput.value = '';
  renderPayables();
  saveJSON('payRecords', payRecords);
  if (rec.id && rec.confirmed === false) {
    apiFetchJSON('/api/payables/' + String(rec.id), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) })
      .then(() => loadPayablesFromServer())
      .catch(() => {});
  }
});
const invoiceModal = document.getElementById('invoice-modal');
const invoiceForm = document.getElementById('invoice-form');
const invoiceNoEl = document.getElementById('invoice-no');
const invoiceDateEl = document.getElementById('invoice-date');
const invoiceAmountEl = document.getElementById('invoice-amount');
const invoiceCancel = document.getElementById('invoice-cancel');
let invoiceCurrentRec = null;
function openInvoiceModal(rec) {
  if (rec.confirmed === true) return;
  invoiceCurrentRec = rec;
  if (invoiceNoEl) invoiceNoEl.value = rec.invoiceNo || '';
  if (invoiceDateEl) invoiceDateEl.value = rec.invoiceDate || '';
  if (invoiceAmountEl) invoiceAmountEl.value = ((rec.invoiceAmount||0) > 0) ? Number(rec.invoiceAmount).toFixed(2) : '';
  if (invoiceModal) invoiceModal.style.display = 'flex';
}
invoiceCancel?.addEventListener('click', () => { if (invoiceModal) invoiceModal.style.display = 'none'; });
invoiceForm?.addEventListener('submit', e => {
  e.preventDefault();
  const rec = invoiceCurrentRec; if (!rec) return;
  const no = (invoiceNoEl?.value || '').trim();
  const date = invoiceDateEl?.value || '';
  const amt = parseFloat(invoiceAmountEl?.value || '');
  if (!no || !date || !Number.isFinite(amt)) return;
  rec.invoiceNo = no;
  rec.invoiceDate = date;
  rec.invoiceAmount = Math.max(0, amt);
  rec.history = rec.history || [];
  const now = new Date();
  const dt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  rec.history.push({ date: dt, user: (getAuthUser()?.name)||'', kind: '改为发票', notes: `发票号:${no} 发票日期:${date} 发票金额:${rec.invoiceAmount.toFixed(2)}` });
  saveJSON('payRecords', payRecords);
  renderPayables();
  if (rec.id && rec.confirmed === false) {
    apiFetchJSON('/api/payables/' + String(rec.id), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) })
      .then(() => loadPayablesFromServer())
      .catch(() => {});
  }
  if (invoiceModal) invoiceModal.style.display = 'none';
});
function trustLabelDisplay(rec) {
  if (rec.settled) return { label: '-', overdue: false };
  const dValRaw = rec.trustDays;
  if (dValRaw == null || isNaN(dValRaw)) return { label: '', overdue: false };
  if (dValRaw === 0) return { label: '立即', overdue: false };
  
  // Calculate remaining days
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  
  // Try to parse the creation date or record date
  let createdDate;
  if (rec.date) {
    createdDate = new Date(rec.date);
  } else if (rec.createdAt) {
    createdDate = new Date(rec.createdAt);
  } else {
    return { label: `${dValRaw}天`, overdue: false }; // Fallback
  }
  
  createdDate.setHours(0, 0, 0, 0);
  
  // Time diff in milliseconds
  const diffTime = now.getTime() - createdDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  const remainingDays = dValRaw - diffDays;
  
  if (remainingDays < 0) {
    return { label: `逾期 ${Math.abs(remainingDays)} 天`, overdue: true };
  } else if (remainingDays === 0) {
    return { label: '今天到期', overdue: false, isToday: true };
  } else {
    return { label: `剩 ${remainingDays} 天`, overdue: false };
  }
}
function summarizeNotes(text, perLine, maxLines) {
  const s = String(text || '');
  if (!s) return '';
  const lines = s.split(/\r?\n/);
  const out = [];
  let overflow = false;
  const take = Math.min(maxLines, lines.length);
  for (let i = 0; i < take; i++) {
    const chs = Array.from(lines[i] || '');
    if (chs.length > perLine) { out.push(chs.slice(0, perLine).join('')); overflow = true; }
    else { out.push(lines[i]); }
  }
  if (lines.length > maxLines) overflow = true;
  if (overflow && out.length) out[out.length - 1] = out[out.length - 1] + '…';
  return out.join('\n');
}
function setPayEdit(rec) {
  payEditingId = rec.id || null;
  payEditingFile = rec.file || '';
  payPendingAttachment = null;
  setPayType(rec.type || '应收账款');
  if (payPartner) payPartner.value = rec.partner || '';
  if (payDoc) payDoc.value = rec.doc || '';
  if (paySales) {
    const sv = rec.sales || '';
    paySales.value = [...paySales.options].some(o => o.value === sv) ? sv : '';
  }
  if (payAmount) payAmount.value = Number(rec.amount || 0).toFixed(2);
  if (payTrust) payTrust.value = (rec.trustDays ?? '').toString();
  if (payNotes) payNotes.value = rec.notes || '';
  if (payImportFile) payImportFile.value = '';
  setPayImportHintText(payEditingFile ? `当前已保存附件：${payEditingFile.split('/').pop()}，重新选择图片/PDF可替换` : '');
  if (paySubmitBtn) paySubmitBtn.textContent = '保存修改';
  payForm?.scrollIntoView({ behavior:'smooth', block:'start' });
}
function clearPayEdit() {
  payEditingId = null;
  payEditingFile = '';
  payPendingAttachment = null;
  if (payImportFile) payImportFile.value = '';
  setPayImportHintText('');
  if (paySubmitBtn) paySubmitBtn.textContent = '提交';
}
function renderPayables() {
  const gp = document.getElementById('global-pager'); if (gp) gp.style.display = 'flex';
  if (paySales) {
    const prev = paySales.value;
    paySales.innerHTML = '<option value="">请选择业务员</option>';
    (salesData || []).forEach(s => {
      const opt = document.createElement('option'); opt.value = s.name; opt.textContent = s.name;
      paySales.appendChild(opt);
    });
    if ([...paySales.options].some(o => o.value === prev)) paySales.value = prev;
  }
  let recv = 0, pay = 0;
  for (const r of payRecords) {
    if (r.settled) continue;
    if (/应收/.test(r.type)) recv += r.amount || 0;
    else if (/应付/.test(r.type)) pay += r.amount || 0;
  }
  if (sumRecvEl) sumRecvEl.textContent = recv.toFixed(2);
  if (sumPayEl) sumPayEl.textContent = pay.toFixed(2);
  const key = (payFilterKey?.value || '').trim();
  const keyLower = key.toLocaleLowerCase();
  let listAll = payRecords.filter(r => {
    if (!key) return true;
    const amountTexts = buildAmountSearchTexts(r.amount);
    return [r.partner || '', r.doc || '', r.notes || '']
      .some(v => String(v || '').toLocaleLowerCase().includes(keyLower))
      || amountTexts.some(v => v.includes(keyLower));
  });
  if (payFilterType !== 'all') {
    listAll = listAll.filter(r => (payFilterType === 'recv' ? /应收/.test(r.type) : /应付/.test(r.type)));
  }
  if (payFilterPartnerName) {
    listAll = listAll.filter(r => (r.partner || '') === payFilterPartnerName);
  }
  if (payFilterSalesName) {
    listAll = listAll.filter(r => {
      if (payFilterSalesName === '__none__') return !(r.sales);
      return (r.sales || '') === payFilterSalesName;
    });
  }
  if (payFilterOverdue !== 'all') {
    listAll = listAll.filter(r => {
      const trustDaysVal = r.trustDays ?? null;
      let isOverdue = false;
      if (!r.settled && trustDaysVal != null && trustDaysVal > 0) {
        const start = new Date(r.date);
        const now = new Date();
        const diffDays = Math.floor((now - start) / (1000*60*60*24));
        const overdueDays = diffDays - trustDaysVal;
        if (overdueDays > 0) isOverdue = true;
      }
      return payFilterOverdue === 'overdue' ? isOverdue : !isOverdue;
    });
  }
  if (payFilterStatus !== 'all') {
    listAll = listAll.filter(r => {
      const arrears = Math.max(0, (r.amount || 0) - (r.paid || 0));
      if (payFilterStatus === 'arrears') return arrears > 0;
      if (payFilterStatus === 'done') return arrears === 0;
      return true;
    });
  }
  if (payFilterAction !== 'all') {
    listAll = listAll.filter(r => {
      if (payFilterAction === 'confirmed') return r.confirmed !== false;
      if (payFilterAction === 'unconfirmed') return r.confirmed === false;
      return true;
    });
  }
  const hasBatch = listAll.some(r => r.batchAt);
  const listSorted = hasBatch ? listAll.slice().sort((a,b) => {
    const byBatch = (b.batchAt || 0) - (a.batchAt || 0);
    if (byBatch !== 0) return byBatch;
    const ao = (a.batchOrder != null) ? a.batchOrder : (a.createdAt || 0);
    const bo = (b.batchOrder != null) ? b.batchOrder : (b.createdAt || 0);
    return ao - bo;
  }) : listAll;
  const total = listSorted.length;
  const totalPages = Math.max(1, Math.ceil(total / payPageSize));
  if (payPage > totalPages) payPage = totalPages;
  const startIdx = (payPage - 1) * payPageSize;
  const list = listSorted.slice(startIdx, startIdx + payPageSize);
  payLastPageData = list.slice();
  payRows.innerHTML = '';
  if (!list.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty';
    const td = document.createElement('td'); td.colSpan = 12; td.textContent = '暂无记录';
    tr.appendChild(td); payRows.appendChild(tr);
    return;
  }
  for (const r of list) {
    const tr = document.createElement('tr');
    const typeDisplay = /应收/.test(r.type) ? '应收' : '应付';
    const tl = trustLabelDisplay(r);
    const trustLabel = tl.label;
    const isOverdue = tl.overdue;
    const paid = r.paid || 0;
    const arrears = Math.max(0, (r.amount || 0) - paid);
    const rowEditable = r.confirmed === false && r.id;
    const canUpdate = rowEditable && can('payables', 'update');
    const canDelete = rowEditable && can('payables', 'delete');
    const canConfirm = rowEditable && can('payables', 'confirm');
    const tdType = document.createElement('td'); tdType.textContent = typeDisplay; tr.appendChild(tdType);
    const tdPartner = document.createElement('td'); tdPartner.textContent = r.partner || ''; tr.appendChild(tdPartner);
    const tdDoc = document.createElement('td');
    const docUp = document.createElement('div'); docUp.textContent = (r.doc || '');
    const docDown = document.createElement('div'); docDown.textContent = r.source === 'import' ? parseDateCN(r.date || '') : ''; docDown.style.color = '#9ca3af'; docDown.style.fontSize = '12px';
    tdDoc.appendChild(docUp); if (docDown.textContent) tdDoc.appendChild(docDown);
    tr.appendChild(tdDoc);
    const tdAmount = document.createElement('td'); tdAmount.textContent = (r.amount||0).toFixed(2); tr.appendChild(tdAmount);
    const tdInv = document.createElement('td');
    const invUp = document.createElement('div');
    const invNo = (r.invoiceNo || '');
    if (invNo) {
      invUp.textContent = invNo;
    } else if (r.confirmed === false) {
      const a = document.createElement('a'); a.href='#'; a.textContent='-'; a.className='link-blue';
      a.addEventListener('click', e => { e.preventDefault(); openInvoiceModal(r); });
      invUp.appendChild(a);
    } else {
      invUp.textContent = '-';
    }
    const invDown = document.createElement('div'); invDown.textContent = parseDateCN(r.invoiceDate || ''); invDown.style.color = '#9ca3af'; invDown.style.fontSize = '12px';
    tdInv.appendChild(invUp); tdInv.appendChild(invDown);
    tr.appendChild(tdInv);
    const tdInvAmt = document.createElement('td');
    const invAmtNum = Number(r.invoiceAmount || 0);
    if (invAmtNum > 0 && isFinite(invAmtNum)) {
      tdInvAmt.textContent = invAmtNum.toFixed(2);
    } else if (r.confirmed === false) {
      const a = document.createElement('a'); a.href='#'; a.textContent='-'; a.className='link-blue';
      a.addEventListener('click', e => { e.preventDefault(); openInvoiceModal(r); });
      tdInvAmt.appendChild(a);
    } else {
      tdInvAmt.textContent = '-';
    }
    tr.appendChild(tdInvAmt);
    const tdAr = document.createElement('td'); tdAr.textContent = arrears.toFixed(2); tr.appendChild(tdAr);
    
    const trustInfo = trustLabelDisplay(r);
    const tdTrust = document.createElement('td'); 
    tdTrust.textContent = trustInfo.label; 
    if (trustInfo.overdue) {
      tdTrust.style.color = '#ef4444'; // Red for overdue
      tdTrust.style.fontWeight = 'bold';
    } else if (trustInfo.isToday) {
      tdTrust.style.color = '#f59e0b'; // Orange for today
      tdTrust.style.fontWeight = 'bold';
    } else {
      tdTrust.style.color = '#10b981'; // Green for days left
    }
    if (trustInfo.label === '-' || trustInfo.label === '' || trustInfo.label === '立即') {
      tdTrust.style.color = ''; // Reset color for default states
      tdTrust.style.fontWeight = 'normal';
    }
    tr.appendChild(tdTrust);
    
    const tdNotes = document.createElement('td');
    tdNotes.textContent = summarizeNotes(r.notes, 10, 2);
    tdNotes.style.whiteSpace = 'pre-wrap';
    tdNotes.style.wordBreak = 'break-all';
    tr.appendChild(tdNotes);
    const tdSales = document.createElement('td'); tdSales.textContent = r.sales || '-'; tr.appendChild(tdSales);
    const tdDate = document.createElement('td'); tdDate.textContent = safePayDate(r); tr.appendChild(tdDate);
    const ops = document.createElement('td');
    ops.style.textAlign = 'center';
    const opsWrap = document.createElement('div');
    opsWrap.style.display = 'inline-flex';
    opsWrap.style.alignItems = 'center';
    opsWrap.style.justifyContent = 'center';
    opsWrap.style.gap = '8px';
    if (canUpdate) {
      const editBtn = document.createElement('button'); editBtn.type = 'button'; editBtn.textContent = '修改'; editBtn.className = 'btn-sm btn-outline-blue';
      editBtn.addEventListener('click', e => {
        e.preventDefault();
        setPayEdit(r);
      });
      opsWrap.appendChild(editBtn);
    }
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '详情'; btn.className = 'btn-sm btn-secondary';
    btn.addEventListener('click', e => {
      e.preventDefault();
      openPayHistory(r);
    });
    opsWrap.appendChild(btn);
    if (canConfirm) {
      const okBtn = document.createElement('button'); okBtn.type = 'button'; okBtn.textContent = '确认'; okBtn.className = 'btn-sm btn-outline-green';
      okBtn.addEventListener('click', async e => {
        e.preventDefault();
        try {
          await apiFetchJSON('/api/payables/' + String(r.id) + '/confirm', { method:'PUT' });
          clearPayEdit();
          loadPayablesFromServer();
          renderContacts();
        } catch {}
      });
      opsWrap.appendChild(okBtn);
    }
    if (canDelete) {
      const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.textContent = '删除'; delBtn.className = 'btn-sm btn-outline-red';
      delBtn.addEventListener('click', e => {
        e.preventDefault();
        openConfirm('确定要删除这条应收/应付记录吗？删除后不可恢复。', async () => {
          try {
            await apiFetchJSON('/api/payables/' + String(r.id), { method:'DELETE' });
            clearPayEdit();
            loadPayablesFromServer();
            renderContacts();
          } catch (err) {
            console.error(err);
            alert('删除失败');
          }
        });
      });
      opsWrap.appendChild(delBtn);
    }
    ops.appendChild(opsWrap);
    tr.appendChild(ops);
    if (r.settled) tr.classList.add('pay-row-settled');
    else if (typeDisplay === '应收') tr.classList.add('pay-row-recv');
    else tr.classList.add('pay-row-pay');
    payRows.appendChild(tr);
  }
  if (payTableWrap) payTableWrap.scrollTop = 0;
  if (payPager) {
    payPager.innerHTML = '';
    payPager.style.display = 'flex';
    const makeBtn = (label, page, disabled=false, active=false) => {
      const b = document.createElement('a');
      b.href = '#'; b.textContent = label;
      b.style.padding = '4px 8px';
      b.style.border = '1px solid #334155';
      b.style.borderRadius = '4px';
      b.style.color = active ? '#000' : '#cbd5e1';
      b.style.background = active ? '#cbd5e1' : 'transparent';
      b.style.pointerEvents = disabled ? 'none' : 'auto';
      b.style.opacity = disabled ? '0.4' : '1';
      b.addEventListener('click', e => { e.preventDefault(); payPage = page; renderPayables(); });
      payPager.appendChild(b);
    };
    makeBtn('«', Math.max(1, payPage-1), payPage<=1);
    const maxButtons = 9;
    let start = Math.max(1, payPage - Math.floor(maxButtons/2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    for (let p = start; p <= end; p++) makeBtn(String(p), p, false, p===payPage);
    makeBtn('»', Math.min(totalPages, payPage+1), payPage>=totalPages);
  }
  if (payFooterInfo) {
    const totalCount = payRecords.length;
    const today = formatDateFromTs(Date.now());
    const todayCount = payRecords.filter(r => formatDateFromTs(r.createdAt) === today).length;
    const latestBatch = Math.max(0, ...payRecords.map(r => r.batchAt || 0));
    const latestBatchCount = latestBatch ? payRecords.filter(r => (r.batchAt||0) === latestBatch).length : (payRecords.length ? 1 : 0);
    payFooterInfo.innerHTML = '';
    const mk = (text) => { const s = document.createElement('span'); s.className = 'info-pill'; s.textContent = text; return s; };
    payFooterInfo.appendChild(mk(`共 ${totalCount} 条记录`));
    payFooterInfo.appendChild(mk(`今日上传 ${todayCount} 条`));
    payFooterInfo.appendChild(mk(`最后次上传 ${latestBatchCount} 条`));
  }
}
payFilterKey?.addEventListener('input', () => { payPage = 1; renderPayables(); });
payExportBtn?.addEventListener('click', () => {
  const data = payLastPageData || [];
  if (!data.length) { alert('当前页面无记录可导出'); return; }
  const rows = [];
  rows.push(['款项类型','往来单位','单据/凭证号','业务员','金额','发票号','发票日期','发票金额','欠款','信任天数','备注','日期']);
  data.forEach(r => {
    const typeDisplay = /应收/.test(r.type) ? '应收' : '应付';
    const tl = trustLabelDisplay(r);
    const trustLabel = tl.label;
    const paid = r.paid || 0;
    const arrears = Math.max(0, (r.amount || 0) - paid);
    const invAmtCell = (Number(r.invoiceAmount||0) > 0) ? (r.invoiceAmount||0).toFixed(2) : '-';
    const outDate = (r.source === 'manual') ? (safePayDate(r) || '') : (r.date || '');
    rows.push([typeDisplay, r.partner || '', r.doc || '', r.sales || '', (r.amount||0).toFixed(2), r.invoiceNo || '', r.invoiceDate || '', invAmtCell, arrears.toFixed(2), trustLabel, r.notes || '', outDate]);
  });
  let html = '<html><head><meta charset="UTF-8"></head><body><table border="1">';
  rows.forEach(r => { html += '<tr>' + r.map(c => `<td>${String(c).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td>`).join('') + '</tr>'; });
  html += '</table></body></html>';
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=UTF-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  a.download = `应收应付账款_${ts}.xls`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
payClearBtn?.addEventListener('click', async () => {
  if (!confirm('确定清空应收/应付所有记录？此操作不可恢复')) return;
  try {
    await apiFetchJSON('/api/payables', { method:'DELETE' });
    payRecords.splice(0, payRecords.length);
    saveJSON('payRecords', payRecords);
    payPage = 1;
    loadPayablesFromServer();
    renderContacts();
  } catch {}
});
const handlePayFormSubmit = async (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (paySubmitLock) return;
  paySubmitLock = true;
  document.getElementById('pay-label-partner')?.classList.remove('invalid-label');
  document.getElementById('pay-label-doc')?.classList.remove('invalid-label');
  document.getElementById('pay-label-amount')?.classList.remove('invalid-label');
  if (payImportParsed.length) {
    let covered = 0, inserted = 0, createdCustomers = 0, createdMerchants = 0;
    const batchAt = Date.now();
    let batchOrder = 0;
    payImportParsed.forEach(rec => {
      rec.confirmed = false;
      rec.batchAt = batchAt;
      rec.batchOrder = batchOrder++;
      rec.createdAt = batchAt;
      const existedBefore = [...contactsData.customers, ...contactsData.merchants, ...contactsData.others]
        .some(x => (x.name||'') === (rec.partner||''));
      ensureContactForPartner(rec.partner, rec.type, rec.sales);
      if (!existedBefore && (rec.partner||'').trim()) {
        if (/应付/.test(rec.type)) createdMerchants++; else createdCustomers++;
      }
      const hasKey = (rec.partner||'').trim() && (rec.doc||'').trim();
      if (hasKey) {
        const ex = findExistingPayRecord(rec);
        if (ex) { mergePayRecord(ex, rec); ex.batchAt = batchAt; ex.batchOrder = rec.batchOrder; ex.createdAt = batchAt; covered++; return; }
      }
      payRecords.push(rec); inserted++;
    });
    const uploadList = payImportParsed.slice();
    payImportParsed = [];
      payPendingAttachment = null;
    if (payImportFile) payImportFile.value = '';
      setPayImportHintText('批量导入完成');
    payPage = 1;
    apiFetchJSON('/api/payables/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ records: uploadList }) })
      .then(() => loadPayablesFromServer())
      .catch(() => {});
    renderPayables();
    if (contactsSearch) contactsSearch.value = '';
    renderContacts();
    saveJSON('payRecords', payRecords);
    saveJSON('contactsData', contactsData);
    const gp = document.getElementById('global-pager'); if (gp) gp.style.display = 'flex';
    renderPayables();
    alert(`导入完成：新增记录 ${inserted} 条，覆盖更新 ${covered} 条，新增客户 ${createdCustomers} 条，新增商家 ${createdMerchants} 条。`);
    paySubmitLock = false;
    return;
  }
  const type = payType.value;
  const partner = payPartner.value.trim();
  const doc = payDoc.value.trim();
  const sales = (paySales?.value || '').trim();
  const amountStr = (payAmount.value || '').trim();
  const amount = parseFloat(amountStr || '');
  const trustDays = parseInt(payTrust.value || '0', 10);
  const notes = payNotes.value.trim();
  const invalidLabels = [];
  if (!type) return;
  if (!partner) invalidLabels.push('pay-label-partner');
  if (!doc) invalidLabels.push('pay-label-doc');
  if (!amountStr || !amount) invalidLabels.push('pay-label-amount');
  if (invalidLabels.length) {
    invalidLabels.forEach(id => {
      const el = document.getElementById(id);
      el?.classList.add('invalid-label');
    });
    const focusEl = !partner ? payPartner : (!doc ? payDoc : payAmount);
    focusEl?.focus();
    const clearPartner = () => document.getElementById('pay-label-partner')?.classList.remove('invalid-label');
    const clearDoc = () => document.getElementById('pay-label-doc')?.classList.remove('invalid-label');
    const clearAmount = () => document.getElementById('pay-label-amount')?.classList.remove('invalid-label');
    payPartner.addEventListener('input', clearPartner, { once: true });
    payDoc.addEventListener('input', clearDoc, { once: true });
    payAmount.addEventListener('input', clearAmount, { once: true });
    alert('请补全必填项');
    paySubmitLock = false;
    return;
  }
  if (payDocExists(doc, type, payEditingId)) {
    setPayDocInvalid(true);
    alert('凭证号已存在');
    paySubmitLock = false;
    return;
  }
  let fileUrl = '';
  if (payPendingAttachment) {
    try {
      fileUrl = await uploadLedgerAttachment(payPendingAttachment);
    } catch (e) {
      if (e?.message === 'bad_type') alert('单条记录仅支持 JPG/PNG 或 PDF 文件');
      else alert('附件上传失败，请重试');
      paySubmitLock = false;
      return;
    }
  }
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const dateTime = `${date} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const creator = (getAuthUser()?.name) || '';
  if (payEditingId) {
    const origin = payRecords.find(r => r.id === payEditingId) || {};
    const paidVal = Number(origin.paid || 0);
    const settledVal = amount > 0 && paidVal >= amount;
    const payload = {
      type, partner, doc, sales, amount,
      paid: paidVal,
      trustDays,
      notes,
      date,
      settled: settledVal,
      history: origin.history || [],
      createdAt: origin.createdAt || Date.now(),
      invoiceNo: origin.invoiceNo || '',
      invoiceDate: origin.invoiceDate || '',
      invoiceAmount: Number(origin.invoiceAmount || 0),
      file: fileUrl || origin.file || '',
      source: origin.source || 'manual',
      batchAt: origin.batchAt || 0,
      batchOrder: origin.batchOrder ?? 0,
      confirmed: false
    };
    try {
      await apiFetchJSON('/api/payables/' + String(payEditingId), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      clearPayEdit();
      loadPayablesFromServer();
      renderContacts();
    } catch {
      alert('保存失败，请重试');
      paySubmitLock = false;
      return;
    }
  } else {
    const rec = { type, partner, doc, sales, amount, paid: 0, trustDays, notes, date, settled:false, history: [], createdAt: Date.now(), invoiceNo:'', invoiceDate:'', invoiceAmount:0, file: fileUrl, source:'manual', confirmed:false };
    rec.batchAt = Date.now();
    rec.batchOrder = 0;
    rec.history.push({ date: dateTime, user: creator, kind: '创建', amount, partner, doc, notes });
    try {
      const res = await apiFetchJSON('/api/payables', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) });
      if (res && res.id) rec.id = res.id;
      loadPayablesFromServer();
    } catch {
      alert('保存失败，请重试');
      paySubmitLock = false;
      return;
    }
  }
  payPartner.value = '';
  payDoc.value = '';
  if (paySales) paySales.value = '';
  payAmount.value = '';
  payTrust.value = '30';
  payNotes.value = '';
  payPendingAttachment = null;
  if (payImportFile) payImportFile.value = '';
  setPayImportHintText('');
  document.getElementById('pay-label-partner')?.classList.remove('invalid-label');
  document.getElementById('pay-label-doc')?.classList.remove('invalid-label');
  document.getElementById('pay-label-amount')?.classList.remove('invalid-label');
  payPage = 1;
  renderPayables();
  renderContacts();
  saveJSON('payRecords', payRecords);
  saveJSON('contactsData', contactsData);
  const gp = document.getElementById('global-pager'); if (gp) gp.style.display = 'flex';
  renderPayables();
  paySubmitLock = false;
};
payForm?.addEventListener('submit', handlePayFormSubmit);
paySubmitBtn?.addEventListener('click', handlePayFormSubmit);
let payImportParsed = [];
let payImportInvalidCount = 0;
let payImportRequiredMissingCount = 0;
function parseCSV(text) {
  const rows = [];
  let i = 0, cur = '', inQ = false, row = [];
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i+1] === '"') { cur += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cur += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(cur.trim()); cur = ''; i++; continue; }
    if (ch === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    cur += ch; i++;
  }
  if (cur.length || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows;
}
function parseXLS(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  const rows = [];
  if (!table) return rows;
  table.querySelectorAll('tr').forEach(tr => {
    const row = [];
    tr.querySelectorAll('td,th').forEach(td => row.push(td.textContent.trim()));
    if (row.length) rows.push(row);
  });
  return rows;
}
function parseXLSX(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'array' });
    const wsname = wb.SheetNames[0];
    const ws = wb.Sheets[wsname];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    return rows || [];
  } catch (e) {
    alert('解析 .xlsx 文件失败');
    return [];
  }
}
function parseTrustDays(val) {
  const s = String(val || '').trim();
  if (!s) return NaN;
  if (s.includes('立即')) return 0;
  const m = new RegExp('(\\d+)').exec(s);
  return m ? parseInt(m[1], 10) : NaN;
}
function parseDateCN(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (/^\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2}$/.test(s)) {
    const parts = s.split(/[-\/\.]/);
    const y = parts[0];
    const mm = String(parseInt(parts[1],10)).padStart(2,'0');
    const dd = String(parseInt(parts[2],10)).padStart(2,'0');
    return `${y}-${mm}-${dd}`;
  }
  const mCNFull = new RegExp('(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日').exec(s);
  if (mCNFull) {
    const y = mCNFull[1];
    const mm = String(parseInt(mCNFull[2],10)).padStart(2,'0');
    const dd = String(parseInt(mCNFull[3],10)).padStart(2,'0');
    return `${y}-${mm}-${dd}`;
  }
  const mCN = new RegExp('(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日').exec(s);
  if (mCN) {
    const y = new Date().getFullYear();
    const mm = String(parseInt(mCN[1],10)).padStart(2,'0');
    const dd = String(parseInt(mCN[2],10)).padStart(2,'0');
    return `${y}-${mm}-${dd}`;
  }
  const mMD = new RegExp('(\\d{1,2})[-\\/\\.]?(\\d{1,2})$').exec(s);
  if (mMD) {
    const y = new Date().getFullYear();
    const mm = String(parseInt(mMD[1],10)).padStart(2,'0');
    const dd = String(parseInt(mMD[2],10)).padStart(2,'0');
    return `${y}-${mm}-${dd}`;
  }
  return s;
}
function formatDateFromTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function safePayDate(rec) {
  const t0 = Number(rec.createdAt);
  if (Number.isFinite(t0) && t0 > 0) return formatDateFromTs(t0);
  const t1 = Date.parse(rec.date || rec.invoiceDate || '');
  if (!isNaN(t1)) return formatDateFromTs(t1);
  return formatDateFromTs(Date.now());
}
function rowToRecord(cols) {
  const [typeCol, partner, doc, date, amountCol, invoiceNo, invoiceDate, invoiceAmountCol, trustCol, notes, sales, paidCol] = cols;
  const type = /应付/.test(String(typeCol)) ? '应付账款' : '应收账款';
  const amount = parseFloat(String(amountCol).replace(/,/g,'')) || 0;
  const paidFromSheet = parseFloat(String(paidCol||'').replace(/,/g,'')) || 0;
  const trustDaysIn = parseTrustDays(trustCol);
  const trustDays = Number.isFinite(trustDaysIn) ? trustDaysIn : parseInt(document.getElementById('pay-trust')?.value || '30', 10);
  const now = new Date();
  const creator = (getAuthUser()?.name) || '';
  const createdAt = Date.now();
  const dIn = parseDateCN(date);
  const d = (dIn && new RegExp('^\\d{4}-\\d{2}-\\d{2}$').test(dIn)) ? dIn :
    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const dt = `${d} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const invoiceAmount = parseFloat(String(invoiceAmountCol||'').replace(/,/g,'')) || 0;
  const paid = Math.min(paidFromSheet, amount);
  const rec = { type, partner: String(partner||'').trim(), doc: String(doc||'').trim(), sales, amount, paid, trustDays, notes, date: d, settled:(paid>=amount && amount>0), history: [], createdAt, invoiceNo: (invoiceNo||''), invoiceDate: parseDateCN(invoiceDate||''), invoiceAmount, source: 'import', confirmed:false };
  rec.history.push({ date: dt, user: creator, kind: '创建', amount, partner, doc, notes });
  if (invoiceNo || invoiceAmount) {
    rec.history.push({ date: dt, user: creator, kind: '发票', amount: invoiceAmount, partner, doc, notes: `发票号:${invoiceNo||'-'} 发票日期:${rec.invoiceDate||'-'}` });
  }
  if (paid > 0) {
    rec.history.push({ date: dt, user: creator, kind: '银行付款', amount: paid, partner, doc, notes: '' });
  }
  return rec;
}
function previewImport(rows) {
  const headerRow = rows[0] ? rows[0].map(x => String(x).trim()) : [];
  const hasHeader = headerRow.some(x => /类型|款项|往来单位|凭证|发票|日期/.test(x));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  function idxOf(names) {
    for (const n of names) {
      const i = headerRow.findIndex(h => h && h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  }
  const idx = {
    type: hasHeader ? idxOf(['应收应付']) : 0,
    partner: hasHeader ? idxOf(['往来单位']) : 1,
    doc: hasHeader ? idxOf(['单据凭证号']) : 2,
    date: hasHeader ? idxOf(['出单日期']) : 3,
    amount: hasHeader ? idxOf(['订单金额']) : 4,
    invoiceNo: hasHeader ? idxOf(['发票号']) : 5,
    invoiceDate: hasHeader ? idxOf(['发票日期']) : 6,
    invoiceAmount: hasHeader ? idxOf(['发票金额']) : 7,
    trustDays: hasHeader ? idxOf(['信任天数']) : 8,
    notes: hasHeader ? idxOf(['备注']) : 9,
    sales: hasHeader ? idxOf(['业务员']) : 10,
    paid: hasHeader ? idxOf(['支付情况','已支付','支付金额','支付']) : -1,
  };
  const selectedType = payType?.value || '';
  const selectedFlag = /应付/.test(selectedType) ? '应付' : '应收';
  payImportParsed = [];
  payImportInvalidCount = 0;
  payImportRows.innerHTML = '';
  let cntTypeMismatch = 0;
  let cntUpdatedEst = 0;
  let cntNewCustomersEst = 0;
  let cntNewMerchantsEst = 0;
  let parsedVisibleCount = 0;
  let requiredMissingCount = 0;
  const existCustomers = new Set((contactsData.customers||[]).map(x => String(x.name||'').trim()));
  const existMerchants = new Set((contactsData.merchants||[]).map(x => String(x.name||'').trim()));
  dataRows.forEach(row => {
    let rowType = String(row[idx.type] ?? '').trim();
    const originalTypeEmpty = !rowType;
    if (!rowType) rowType = selectedFlag;
    const partnerName = String(row[idx.partner] ?? '').trim();
    const docVal = String(row[idx.doc] ?? '').trim();
    const amtVal = String(row[idx.amount] ?? '').trim();
    if (![rowType, partnerName, docVal, amtVal].some(v => String(v||'').trim())) return;
    const colsX = [
      row[idx.type] ?? '',
      partnerName,
      row[idx.doc] ?? '',
      row[idx.date] ?? '',
      row[idx.amount] ?? '',
      row[idx.invoiceNo] ?? '',
      row[idx.invoiceDate] ?? '',
      row[idx.invoiceAmount] ?? '',
      row[idx.trustDays] ?? '',
      row[idx.notes] ?? '',
      row[idx.sales] ?? '',
      (idx.paid >= 0 ? row[idx.paid] : ''),
    ];
    const tr = document.createElement('tr');
    let isErrorRow = false;
    let errorReason = '';
    if (rowType && !rowType.includes(selectedFlag)) { isErrorRow = true; errorReason = '性质不匹配：页面与A列不一致'; cntTypeMismatch++; colsX[0] = selectedFlag; }
    const missType = originalTypeEmpty;
    const missPartner = !partnerName;
    const missDoc = !docVal;
    const missAmount = !amtVal;
    if (missPartner) { isErrorRow = true; errorReason = errorReason ? (errorReason + '；店名为空') : '店名为空'; payImportInvalidCount++; }
    const isRequiredMissing = missType || missPartner || missDoc || missAmount;
    if (isRequiredMissing) requiredMissingCount++;
    const previewCells = [
      row[idx.type] ?? '',
      partnerName,
      row[idx.doc] ?? '',
      row[idx.date] ?? '',
      row[idx.amount] ?? '',
      row[idx.invoiceNo] ?? '',
      row[idx.invoiceDate] ?? '',
      row[idx.invoiceAmount] ?? '',
      row[idx.trustDays] ?? '',
      (idx.paid >= 0 ? row[idx.paid] : ''),
      row[idx.notes] ?? '',
      row[idx.sales] ?? '',
    ];
    previewCells.forEach((v, ci) => {
      const td = document.createElement('td');
      td.textContent = String(v ?? '');
      const needHighlight = (ci === 0 && missType) || (ci === 1 && missPartner) || (ci === 2 && missDoc) || (ci === 4 && missAmount);
      if (needHighlight || (isErrorRow && (ci === 0 || ci === 1))) { td.className = 'error-cell'; td.title = errorReason || '必填项为空'; }
      tr.appendChild(td);
    });
    payImportRows.appendChild(tr);
    if (isRequiredMissing) return;
    parsedVisibleCount++;
    const rec = rowToRecord(colsX);
    payImportParsed.push(rec);
    const existsRec = findExistingPayRecord(rec);
    if (existsRec) cntUpdatedEst++;
    const isRecv = /应收/.test(rec.type);
    if (isRecv) {
      if (!existCustomers.has(rec.partner.trim())) cntNewCustomersEst++;
    } else {
      if (!existMerchants.has(rec.partner.trim())) cntNewMerchantsEst++;
    }
  });
  const summary = [
    `已解析 ${parsedVisibleCount} 条`,
    (cntUpdatedEst ? `预计覆盖 ${cntUpdatedEst} 条` : ''),
    ((cntNewCustomersEst+cntNewMerchantsEst) ? `预计新增客户/商家 ${cntNewCustomersEst+cntNewMerchantsEst} 条` : ''),
    (payImportInvalidCount ? `已跳过店名为空 ${payImportInvalidCount} 条` : ''),
    (cntTypeMismatch ? `性质不匹配 ${cntTypeMismatch} 条（A列与页面不一致，不导入）` : ''),
    (requiredMissingCount ? `存在必填项为空 ${requiredMissingCount} 条（应收应付/往来单位/凭证号/订单金额），请修正后再入库` : ''),
  ].filter(Boolean).join(' | ');
  payImportSummary.textContent = summary;
  if (payImportHint) {
    if (requiredMissingCount) payImportHint.textContent = `存在必填项为空 ${requiredMissingCount} 条，无法入库`;
    else payImportHint.textContent = `已选择 ${parsedVisibleCount} 条，点击下方提交完成入库`;
  }
  payImportRequiredMissingCount = requiredMissingCount;
  if (payImportCommit) payImportCommit.disabled = false;
}
payImportFile?.addEventListener('change', () => {
  const file = payImportFile?.files?.[0];
  if (!file) { return; }
  const name = (file.name || '').toLowerCase();
  if (isPayablesAttachmentFile(file)) {
    payPendingAttachment = file;
    payImportParsed = [];
    payImportInvalidCount = 0;
    payImportRequiredMissingCount = 0;
    if (payImportRows) payImportRows.innerHTML = '';
    if (payImportSummary) payImportSummary.textContent = '已切换为单条附件模式';
    try { payImportModal.style.display = 'none'; } catch {}
    setPayImportHintText(`已选择单条附件：${file.name}，点击下方提交保存到当前单据`);
    return;
  }
  if (!isPayablesImportSheet(file)) {
    payPendingAttachment = null;
    alert('不支持的文件类型');
    return;
  }
  payPendingAttachment = null;
  const reader = new FileReader();
  try { payImportModal.style.display = 'flex'; setImportModalWidth(); } catch {}
  if (name.endsWith('.csv')) {
    reader.onload = () => { try { previewImport(parseCSV(reader.result)); setImportModalWidth(); } catch {} };
    reader.readAsText(file, 'utf-8');
  } else if (name.endsWith('.xls')) {
    reader.onload = () => { try { previewImport(parseXLS(reader.result)); setImportModalWidth(); } catch {} };
    reader.readAsText(file, 'utf-8');
  } else if (name.endsWith('.xlsx')) {
    reader.onload = () => { try { previewImport(parseXLSX(reader.result)); setImportModalWidth(); } catch {} };
    reader.readAsArrayBuffer(file);
  } else {
    alert('不支持的文件类型');
  }
});
function setImportModalWidth() {
  const card = document.querySelector('#page-payables .card');
  const modalBox = document.querySelector('#pay-import-modal .modal');
  if (card && modalBox) {
    const w = Math.floor(card.getBoundingClientRect().width);
    modalBox.style.width = w + 'px';
    modalBox.style.maxWidth = 'none';
  }
}
payImportCancel?.addEventListener('click', () => { payImportModal.style.display = 'none'; });
function ensureContactForPartner(name, type, salesName) {
  const pname = String(name || '').trim();
  if (!pname) return;
  const tab = /应付/.test(type) ? 'merchants' : 'customers';
  const ownerLabel = tab === 'merchants' ? '商家' : '客户';
  const existsInTab = (contactsData[tab] || []).some(x => (String(x.name||'').trim()) === pname);
  if (existsInTab) return;
  const now = new Date();
  const created = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  contactsData[tab].push({ name: pname, contact:'', phone:'', city:'', remark:'', owner: ownerLabel, created, company:'', code:'', country:'', address:'', zip:'', sales: (salesName||'').trim() });
}
function findExistingPayRecord(rec) {
  const p = String(rec.partner || '').trim();
  const d = String(rec.doc || '').trim();
  return payRecords.find(r =>
    r.type === rec.type &&
    String(r.partner||'').trim() === p &&
    String(r.doc||'').trim() === d
  );
}
function mergePayRecord(target, src) {
  const now = new Date();
  const dateTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const user = (getAuthUser()?.name) || '';
  target.sales = src.sales || target.sales || '';
  if (!isNaN(src.amount)) target.amount = src.amount;
  if (!isNaN(src.paid)) {
    const newPaid = src.paid;
    target.paid = Math.min(newPaid, target.amount || 0);
  }
  if (!isNaN(src.trustDays)) target.trustDays = src.trustDays;
  target.notes = src.notes || target.notes || '';
  target.date = src.date || target.date;
  target.invoiceNo = src.invoiceNo || target.invoiceNo || '';
  target.invoiceDate = src.invoiceDate || target.invoiceDate || '';
  if (!isNaN(src.invoiceAmount)) target.invoiceAmount = src.invoiceAmount;
  target.settled = (target.paid || 0) >= (target.amount || 0) && (target.amount || 0) > 0;
  target.history = target.history || [];
  target.history.push({ date: dateTime, user, kind: '导入覆盖', amount: src.amount, partner: target.partner, doc: target.doc, notes: '批量导入覆盖现有记录' });
  if (src.invoiceNo || src.invoiceAmount) {
    target.history.push({ date: dateTime, user, kind: '发票', amount: src.invoiceAmount, partner: target.partner, doc: target.doc, notes: `发票号:${src.invoiceNo||'-'} 发票日期:${src.invoiceDate||'-'}` });
  }
  if (src.paid) {
    target.history.push({ date: dateTime, user, kind: '银行付款', amount: src.paid, partner: target.partner, doc: target.doc, notes: '' });
  }
}
let payImportCommitLock = false;
const handlePayImportCommit = async (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (payImportCommitLock) return;
  payImportCommitLock = true;
  if (payImportRequiredMissingCount) { alert(`存在必填项为空 ${payImportRequiredMissingCount} 条，无法入库`); payImportCommitLock = false; return; }
  let createdCustomers = 0, createdMerchants = 0;
  let covered = 0, inserted = 0;
  const batchAt = Date.now();
  let batchOrder = 0;
  const beforeCustomers = new Set((contactsData.customers||[]).map(x => String(x.name||'').trim()));
  const beforeMerchants = new Set((contactsData.merchants||[]).map(x => String(x.name||'').trim()));
  payImportParsed.forEach(rec => {
    rec.batchAt = batchAt;
    rec.batchOrder = batchOrder++;
    rec.createdAt = batchAt;
    const existedBefore = [...contactsData.customers, ...contactsData.merchants, ...contactsData.others]
      .some(x => (x.name||'') === (rec.partner||''));
    ensureContactForPartner(rec.partner, rec.type, rec.sales);
    if (!existedBefore && (rec.partner||'').trim()) {
      if (/应付/.test(rec.type)) createdMerchants++; else createdCustomers++;
    }
    const hasKey = (rec.partner||'').trim() && (rec.doc||'').trim();
    if (hasKey) {
      const ex = findExistingPayRecord(rec);
      if (ex) { mergePayRecord(ex, rec); ex.batchAt = batchAt; ex.batchOrder = rec.batchOrder; ex.createdAt = batchAt; ex.source = 'import'; covered++; return; }
    }
    payRecords.push(rec); inserted++;
  });
  payImportParsed = [];
  payImportInvalidCount = 0;
  payImportModal.style.display = 'none';
  payPage = 1;
  renderPayables();
  renderContacts?.();
  saveJSON('payRecords', payRecords);
  saveJSON('contactsData', contactsData);
  apiFetchJSON('/api/payables/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ records: payRecords.filter(r => r.batchAt === batchAt) }) })
    .then(() => loadPayablesFromServer())
    .catch(() => {});
  const totalChanged = inserted + covered + createdCustomers + createdMerchants;
  if (totalChanged > 0) {
    alert(`导入完成：新增记录 ${inserted} 条，覆盖更新 ${covered} 条，新增客户 ${createdCustomers} 条，新增商家 ${createdMerchants} 条。`);
  }
  payImportCommitLock = false;
};
if (payImportCommit) {
  payImportCommit.addEventListener('click', handlePayImportCommit);
  payImportCommit.onclick = handlePayImportCommit;
}
let contactsTab = 'customers';
const contactsRows = document.getElementById('contacts-rows');
const contactsSearch = document.getElementById('contacts-search');
const confirmModal = document.getElementById('confirm-modal');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmOk = document.getElementById('confirm-ok');
const partnerOrdersRows = document.getElementById('partner-orders-rows');
const partnerOrdersHead = document.getElementById('partner-orders-head');
let contactsPage = 1;
const contactsPageSize = 100;
window.handleContactDrop = async function(event, targetType) {
  event.preventDefault();
  try {
    const dataStr = event.dataTransfer.getData('text/plain');
    if (!dataStr) return;
    const data = JSON.parse(dataStr);
    
    if (data.currentType === targetType) return; // No change needed
    
    // Find the contact in the current list
    const contact = contactsData[data.currentType].find(c => c.id === data.id);
    if (!contact) return;
    
    // Map targetType to owner string
    const ownerMap = {
      'customers': '客户',
      'merchants': '商家',
      'others': '其它'
    };
    const newOwner = ownerMap[targetType] || '客户';
    
    const res = await fetchWithAuth(`/api/contacts/${data.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...contact, owner: newOwner })
    });
    
    if (res.ok) {
      // Show brief success feedback
      const tabBtn = document.querySelector(`#page-contacts .tabs .tab[data-tab="${targetType}"]`);
      if (tabBtn) {
        const origText = tabBtn.textContent;
        tabBtn.textContent = '移动成功';
        setTimeout(() => tabBtn.textContent = origText, 1000);
      }
      
      // Refresh the contacts data
      await loadAllContacts();
      if (contactsTab === data.currentType) {
        renderContacts();
      }
    } else {
      alert('移动失败，请重试');
    }
  } catch (e) {
    console.error('Drop error:', e);
  }
};

let pendingDeleteIndex = null;
let pendingDeleteTab = null;
function partnerTotal(name) {
  let sum = 0;
  payRecords.forEach(r => { if ((r.partner||'') === name) sum += r.amount || 0; });
  return sum.toFixed(2);
}
function partnerArrears(name, ownerLabel) {
  let sum = 0;
  payRecords.forEach(r => {
    if ((r.partner||'') !== name) return;
    const isRecv = /应收/.test(r.type||'');
    const isPay = /应付/.test(r.type||'');
    if (ownerLabel === '客户' && !isRecv) return;
    if (ownerLabel === '商家' && !isPay) return;
    const arrears = Math.max(0, (r.amount||0) - (r.paid||0));
    sum += arrears;
  });
  return sum.toFixed(2);
}
function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${dd} ${hh}:${mm}`;
}
function openAmountHistory(partnerName, ownerLabel) {
  const modal = document.getElementById('amount-history-modal');
  const head = document.getElementById('amount-history-head');
  const rowsEl = document.getElementById('amount-history-rows');
  const list = [];
  payRecords.forEach(r => {
    if ((r.partner||'') !== partnerName) return;
    const ts = r.createdAt || (r.date ? Date.parse(r.date) : 0);
    const amt = Number(r.amount||0);
    const isRecv = /应收/.test(r.type||'');
    const change = isRecv ? amt : -amt;
    const label = isRecv ? `应收账款记录 + ${amt.toFixed(2)}` : `应付账款记录 - ${amt.toFixed(2)}`;
    const user = (r.history && r.history[0] && r.history[0].user) || (getAuthUser()?.name || '');
    list.push({ ts, doc: r.doc || '', change, label, user });
  });
  records.forEach(rec => {
    if ((rec.client||'') !== partnerName) return;
    if (rec.type === '收入') {
      const ts = rec.createdAt || (rec.dateTime ? Date.parse(rec.dateTime) : (rec.date ? Date.parse(rec.date) : 0));
      const amt = Number(rec.amount||0);
      const change = -amt;
      const label = `收支记账收入 - ${amt.toFixed(2)}`;
      const user = getAuthUser()?.name || '';
      list.push({ ts, doc: rec.doc || '', change, label, user });
    }
  });
  list.sort((a,b) => a.ts - b.ts);
  let cum = 0;
  const withCum = list.map(x => { cum += x.change; return { ...x, cum }; });
  rowsEl.innerHTML = '';
  const render = [...withCum].reverse();
  render.forEach((x, idx) => {
    const tr = document.createElement('tr');
    const seq = document.createElement('td'); seq.textContent = String(render.length - idx); tr.appendChild(seq);
    const dt = document.createElement('td'); dt.textContent = formatDateTime(x.ts); tr.appendChild(dt);
    const doc = document.createElement('td'); doc.textContent = x.doc || '-'; tr.appendChild(doc);
    const change = document.createElement('td'); change.textContent = x.label; tr.appendChild(change);
    const arrears = document.createElement('td'); arrears.textContent = Number.isFinite(x.cum) ? x.cum.toFixed(2) : '-'; tr.appendChild(arrears);
    const user = document.createElement('td'); user.textContent = x.user || '-'; tr.appendChild(user);
    rowsEl.appendChild(tr);
  });
  head.textContent = `往来单位：${partnerName}`;
  modal.style.display = 'flex';
  document.getElementById('amount-history-close')?.addEventListener('click', () => { modal.style.display = 'none'; });
}
function openPartnerOrders(name) {
  const modal = document.getElementById('partner-orders-modal');
  const head = document.getElementById('partner-orders-head');
  const rowsEl = document.getElementById('partner-orders-rows');
  head.textContent = '往来单位：' + (name || '');
  const list = payRecords.filter(r => (r.partner || '') === (name || ''));
  rowsEl.innerHTML = '';
  list.forEach(r => {
    const tr = document.createElement('tr');
    const paid = r.paid || 0;
    const arrears = Math.max(0, (r.amount || 0) - paid);
    [r.type, r.partner || '', r.doc || '', (r.amount||0).toFixed(2), paid.toFixed(2), arrears.toFixed(2), r.date || ''].forEach((v,i) => {
      const td = document.createElement('td');
      td.textContent = String(v);
      if (i===5 && arrears>0) td.style.color = '#ef4444';
      tr.appendChild(td);
    });
    rowsEl.appendChild(tr);
  });
  modal.style.display = 'flex';
  document.getElementById('partner-orders-close')?.addEventListener('click', () => { modal.style.display = 'none'; });
}
async function renderContacts() {
  const key = (contactsSearch?.value || '').trim();
  
  if (key) {
    // Search across all tabs
    await Promise.all([
      apiContactsList('customers', key, 1, 1000),
      apiContactsList('merchants', key, 1, 1000),
      apiContactsList('others', key, 1, 1000)
    ]);
    
    // Auto-switch tab if current tab has no results but others do
    const currList = contactsData[contactsTab] || [];
    if (currList.length === 0) {
      const tabs = ['customers', 'merchants', 'others'];
      for (const t of tabs) {
        if (contactsData[t] && contactsData[t].length > 0) {
          contactsTab = t;
          document.querySelectorAll('#page-contacts .tabs .tab').forEach(x => {
            x.classList.toggle('active', x.getAttribute('data-tab') === t);
          });
          break;
        }
      }
    }
  } else {
    // Just load current tab if no search key
    await apiContactsList(contactsTab, '', 1, 5000);
  }

  const fresh = contactsData[contactsTab] || [];
  const filtered = fresh.filter(x => {
    if (!key) return true;
    const k = String(key).toLowerCase();
    return [x.name, x.company, x.code, x.contact, x.phone, x.sales]
      .some(v => String(v||'').toLowerCase().includes(k));
  });
  const ordered = filtered.slice(); // Removed reverse()
  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / contactsPageSize));
  if (contactsPage > totalPages) contactsPage = totalPages;
  const startIdx = (contactsPage - 1) * contactsPageSize;
  const data = ordered.slice(startIdx, startIdx + contactsPageSize);
  const gp = document.getElementById('global-pager');
  const sel = document.getElementById('ct-sales');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">请选择业务员</option>';
    (salesData || []).forEach(s => {
      const opt = document.createElement('option'); opt.value = s.name; opt.textContent = s.name;
      sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  }
  contactsRows.innerHTML = '';
  
  if (data.length === 0) {
    const emptyTr = document.createElement('tr');
    emptyTr.className = 'empty';
    const emptyTd = document.createElement('td');
    emptyTd.colSpan = 13;
    emptyTd.textContent = key ? '往来单位中没有搜索结果' : '暂无数据';
    emptyTr.appendChild(emptyTd);
    contactsRows.appendChild(emptyTr);
  }
  
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const tr = document.createElement('tr');
    
    // Serial Number Calculation: Total - Global Index
    // Global Index = startIdx + i
    // Example: Total 100. Page 1 (startIdx 0). Item 0 -> 100 - 0 = 100.
    const serialNum = total - (startIdx + i);
    const tdSerial = document.createElement('td');
    tdSerial.textContent = serialNum;
    tdSerial.style.color = '#94a3b8';
    tdSerial.style.fontWeight = '500';
    tr.appendChild(tdSerial);

    const ops = document.createElement('td');
    ops.className = 'actions';
    ops.innerHTML = '<a href="#" class="link-blue">编辑</a><a href="#" class="link-red">删除</a><a href="#" class="link-green">订单记录</a><a href="#" class="link-orange">金额记录</a>';
    
    // Removed: r.code (税号), r.contact (联系人), r.phone (电话)
    
    // Format created date to YYYY-MM-DD
    let createdDate = r.created || '';
    if (createdDate.length > 10) {
      createdDate = createdDate.substring(0, 10);
    }
    
    const cells = [r.name, r.company || '', r.city, r.remark || '', r.sales || '-', partnerTotal(r.name), partnerArrears(r.name, r.owner || ''), createdDate];
    cells.forEach((v, idx) => {
      const td = document.createElement('td');
      if (idx === 0 || idx === 1) { // 店名 and 公司名称
        const text = String(v || '');
        if (text.length > 30) {
          td.textContent = text.substring(0, 30) + '...';
          td.title = text; // Show full text on hover
        } else {
          td.textContent = text;
        }
        td.style.maxWidth = '250px';
        td.style.whiteSpace = 'nowrap';
        td.style.overflow = 'hidden';
        td.style.textOverflow = 'ellipsis';
      } else if (idx === 6) { // 欠款金额
        const num = parseFloat(String(v));
        if (isFinite(num) && num <= 0) {
          td.textContent = '-';
        } else {
          td.textContent = Number.isFinite(num) ? num.toFixed(2) : String(v||'');
          td.style.color = '#ef4444';
        }
      } else {
        td.textContent = String(v || '');
      }
      tr.appendChild(td);
    });
    tr.appendChild(ops);
    
    // Add drag and drop functionality
    tr.draggable = true;
    tr.style.cursor = 'grab';
    tr.addEventListener('dragstart', (e) => {
      tr.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({ id: r.id, currentType: contactsTab }));
    });
    tr.addEventListener('dragend', (e) => {
      tr.style.opacity = '1';
    });
    
    contactsRows.appendChild(tr);
    const del = ops.querySelector('.link-red');
    del.addEventListener('click', e => {
      e.preventDefault();
      const name = r.name || '';
      const ownerLabel = r.owner || '';
      const inUse = payRecords.some(x => (x.partner||'') === name) || records.some(x => (x.client||'') === name) || (parseFloat(partnerArrears(name, ownerLabel)) > 0);
      if (inUse) { alert('该客户正在使用中，无法被删除'); return; }
      pendingDeleteIndex = contactsData[contactsTab].indexOf(r);
      pendingDeleteTab = contactsTab;
      confirmModal.style.display = 'flex';
    });
    const edit = ops.querySelector('.link-blue');
    edit.addEventListener('click', e => {
      e.preventDefault();
      const i = contactsData[contactsTab].indexOf(r);
      if (i>=0) {
        editingIndex = i;
        editingTab = contactsTab;
        fillContactsForm(r);
        if (ctModalTitle) ctModalTitle.textContent = '编辑' + (contactsTab==='customers'?'客户':contactsTab==='merchants'?'商家':'往来单位');
        if (ctSubmitBtn) ctSubmitBtn.textContent = '保存';
        if (ctModal) ctModal.style.display = 'flex';
      }
    });
    const ordersLink = ops.querySelector('.link-green');
    ordersLink.addEventListener('click', e => {
      e.preventDefault();
      const n = encodeURIComponent(r.name || '');
      location.hash = '#partner-orders:' + n;
    });
    const amountLink = ops.querySelector('.link-orange');
    amountLink.addEventListener('click', e => {
      e.preventDefault();
      openAmountHistory(r.name, r.owner || '');
    });
  }
  const pager = document.getElementById('global-pager-controls');
  const isContactsVisible = (document.getElementById('page-contacts')?.style.display === 'block');
  if (pager && isContactsVisible) {
    pager.innerHTML = '';
    const makeBtn = (label, page, disabled=false, active=false) => {
      const b = document.createElement('a');
      b.href = '#'; b.textContent = label;
      b.style.padding = '4px 8px';
      b.style.border = '1px solid #334155';
      b.style.borderRadius = '4px';
      b.style.color = active ? '#000' : '#cbd5e1';
      b.style.background = active ? '#cbd5e1' : 'transparent';
      b.style.pointerEvents = disabled ? 'none' : 'auto';
      b.style.opacity = disabled ? '0.4' : '1';
      b.addEventListener('click', e => { e.preventDefault(); contactsPage = page; renderContacts(); });
      pager.appendChild(b);
    };
    makeBtn('«', Math.max(1, contactsPage-1), contactsPage<=1);
    const maxButtons = 9;
    let start = Math.max(1, contactsPage - Math.floor(maxButtons/2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    for (let p = start; p <= end; p++) makeBtn(String(p), p, false, p===contactsPage);
    makeBtn('»', Math.min(totalPages, contactsPage+1), contactsPage>=totalPages);
  }
  const infoEl = document.getElementById('pay-footer-info');
  if (infoEl) {
    const todayStr = (() => { const d = new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; })();
    const toTs = x => { const t = Date.parse(x.created || ''); return Number.isFinite(t) ? t : 0; };
    const listAll = fresh || [];
    const totalCount = listAll.length;
    const todayCount = listAll.filter(x => {
      const t = toTs(x); if (!t) return false;
      const d = new Date(t); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${dd}` === todayStr;
    }).length;
    const latestTs = Math.max(0, ...(listAll.map(toTs)));
    const latestCount = latestTs ? listAll.filter(x => toTs(x) === latestTs).length : (totalCount ? 1 : 0);
    const mk = (text) => { const s = document.createElement('span'); s.className = 'info-pill'; s.textContent = text; return s; };
    infoEl.innerHTML = '';
    infoEl.appendChild(mk(`共 ${totalCount} 条记录`));
    infoEl.appendChild(mk(`今日上传 ${todayCount} 条`));
    infoEl.appendChild(mk(`最后次上传 ${latestCount} 条`));
  }
}
confirmCancel?.addEventListener('click', () => {
  confirmModal.style.display = 'none';
  pendingDeleteIndex = null;
  pendingDeleteTab = null;
});
confirmOk?.addEventListener('click', async () => {
  if (pendingDeleteIndex !== null && pendingDeleteTab) {
    const target = contactsData[pendingDeleteTab][pendingDeleteIndex];
    const name = target?.name || '';
    const ownerLabel = target?.owner || '';
    const inUse = payRecords.some(x => (x.partner||'') === name) || records.some(x => (x.client||'') === name) || (parseFloat(partnerArrears(name, ownerLabel)) > 0);
    if (inUse) {
      alert('该客户正在使用中，无法被删除');
    } else {
      const ok = await apiContactsDeleteByName(ownerLabel || (pendingDeleteTab==='customers'?'客户':pendingDeleteTab==='merchants'?'商家':'其它'), name);
      if (ok) contactsData[pendingDeleteTab].splice(pendingDeleteIndex,1);
      await apiContactsList(pendingDeleteTab, contactsSearch?.value || '', 1, 5000);
      renderContacts();
      saveJSON('contactsData', contactsData);
    }
  }
  confirmModal.style.display = 'none';
  pendingDeleteIndex = null;
  pendingDeleteTab = null;
});
document.querySelectorAll('.tab[data-tab]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    contactsTab = b.getAttribute('data-tab');
    contactsPage = 1;
    renderContacts();
  });
});
contactsSearch?.addEventListener('input', () => { contactsPage = 1; renderContacts(); });
const ctForm = document.getElementById('contacts-form');
const ctSubmitBtn = document.getElementById('contacts-submit');
const ctSubmitTop = document.getElementById('contacts-submit-top');
const ctModal = document.getElementById('contacts-modal');
const ctModalClose = document.getElementById('ct-modal-close');
const ctModalTitle = document.getElementById('ct-modal-title');
let tempContactNotes = [];
let editingNoteId = null;

if (ctModalClose) ctModalClose.addEventListener('click', () => { if (ctModal) ctModal.style.display = 'none'; });

let editingIndex = null;
let editingTab = null;
function fillContactsForm(r) {
  tempContactNotes = [];
  editingNoteId = null;
  document.getElementById('ct-id').value = r.id || '';
  document.getElementById('ct-name').value = r.name || '';
  document.getElementById('ct-company').value = r.company || '';
  document.getElementById('ct-code').value = r.code || '';
  document.getElementById('ct-contact').value = r.contact || '';
  document.getElementById('ct-phone').value = r.phone || '';
  document.getElementById('ct-country').value = r.country || '';
  document.getElementById('ct-address').value = r.address || '';
  document.getElementById('ct-zip').value = r.zip || '';
  document.getElementById('ct-city').value = r.city || '';
  document.getElementById('ct-remark').value = r.remark || '';
  document.getElementById('ct-email').value = r.email || '';
  document.getElementById('ct-province').value = r.province || '';
  document.getElementById('ct-ship-address').value = r.ship_address || '';
  document.getElementById('ct-ship-zip').value = r.ship_zip || '';
  document.getElementById('ct-ship-city').value = r.ship_city || '';
  document.getElementById('ct-ship-province').value = r.ship_province || '';
  document.getElementById('ct-ship-country').value = r.ship_country || '';
  document.getElementById('ct-ship-phone').value = r.ship_phone || '';
  document.getElementById('ct-ship-contact').value = r.ship_contact || '';
  document.getElementById('ct-invoice-nota').value = r.invoice_nota || '';
  const ctShipSame = document.getElementById('ct-ship-same');
  if (ctShipSame) {
    const sAddr = r.ship_address || '';
    const sZip = r.ship_zip || '';
    const sCity = r.ship_city || '';
    const sProv = r.ship_province || '';
    const sCountry = r.ship_country || '';
    const sPhone = r.ship_phone || '';
    const sContact = r.ship_contact || '';
    
    const cAddr = r.address || '';
    const cZip = r.zip || '';
    const cCity = r.city || '';
    const cProv = r.province || '';
    const cCountry = r.country || '';
    const cPhone = r.phone || '';
    const cContact = r.contact || '';
    
    // Check if identical and at least one field has content
    const isSame = (sAddr === cAddr && sZip === cZip && sCity === cCity && sProv === cProv && sCountry === cCountry && sPhone === cPhone && sContact === cContact);
    const hasContent = (sAddr || sZip || sCity || sProv || sCountry || sPhone || sContact);
    
    ctShipSame.checked = isSame && hasContent;
  }
  const ctSales = document.getElementById('ct-sales'); if (ctSales) ctSales.value = r.sales || '';
  const ctPrice = document.getElementById('ct-price'); if (ctPrice) ctPrice.value = r.use_price || 'price1';
  // Default is_iva to true if undefined
  const ctIva = document.getElementById('ct-iva'); 
  if (ctIva) {
    if (r.is_iva === false || String(r.is_iva) === 'false') {
      ctIva.value = 'false';
    } else {
      ctIva.value = 'true';
    }
  }
  loadContactNotes(r.id);
}
function clearContactsForm() {
  tempContactNotes = [];
  editingNoteId = null;
  document.getElementById('ct-id').value = '';
  ['ct-name','ct-company','ct-code','ct-contact','ct-phone','ct-country','ct-address','ct-zip','ct-city','ct-remark','ct-email','ct-province','ct-ship-address','ct-ship-zip','ct-ship-city','ct-ship-province','ct-ship-country','ct-ship-phone','ct-ship-contact','ct-invoice-nota'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const ctShipSame = document.getElementById('ct-ship-same'); if(ctShipSame) ctShipSame.checked = false;
  const ctSales = document.getElementById('ct-sales'); if (ctSales) ctSales.value = '';
  const ctPrice = document.getElementById('ct-price'); if (ctPrice) ctPrice.value = 'price1';
  const ctIva = document.getElementById('ct-iva'); if (ctIva) ctIva.value = 'true';
  document.querySelectorAll('.group.error').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.shake').forEach(el => el.classList.remove('shake'));
  loadContactNotes(null);
  document.getElementById('ct-note-input-area').style.display = 'none';
}
// Upload Contacts Logic
const ctUploadBtn = document.getElementById('contacts-upload-btn');
const ctUploadModal = document.getElementById('contacts-upload-modal');
const ctUploadConfirm = document.getElementById('ct-upload-confirm');
const ctUploadFile = document.getElementById('ct-upload-file');
const ctUploadType = document.getElementById('ct-upload-type');

ctUploadBtn?.addEventListener('click', () => {
  if (ctUploadModal) {
    ctUploadType.value = contactsTab; // default to current tab
    ctUploadFile.value = '';
    ctUploadModal.style.display = 'flex';
  }
});

ctUploadConfirm?.addEventListener('click', async () => {
  if (!ctUploadFile.files.length) return alert('请先选择文件');
  
  const file = ctUploadFile.files[0];
  const typeVal = ctUploadType.value;
  const ownerLabel = typeVal === 'merchants' ? '商家' : (typeVal === 'others' ? '其它' : '客户');
  
  ctUploadConfirm.disabled = true;
  ctUploadConfirm.textContent = '上传中...';
  
  try {
    // Get existing contacts to check for matches
    const params = new URLSearchParams({ tab: typeVal, size: '5000' });
    const existList = await apiFetchJSON('/api/contacts?' + params.toString());
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);
        
        if (json.length === 0) {
          alert('表格为空');
          return;
        }
        
        let successCount = 0;
        let updateCount = 0;
        
        for (const row of json) {
          const name = String(row['店名'] || '').trim();
          const company = String(row['公司名称'] || '').trim();
          if (!name && !company) continue; // Skip empty rows
          
          const code = String(row['税号'] || '').trim();
          const email = String(row['邮箱'] || '').trim();
          const is_iva = String(row['是否 IVA'] || '').trim() === '是';
          
          let use_price = 'price1';
          const priceVal = String(row['使用价格'] || '').trim();
          if (['1', '价格1', 'price1'].includes(priceVal)) use_price = 'price1';
          else if (['2', '价格2', 'price2'].includes(priceVal)) use_price = 'price2';
          else if (['3', '价格3', 'price3'].includes(priceVal)) use_price = 'price3';
          else if (['4', '价格4', 'price4'].includes(priceVal)) use_price = 'price4';
          
          const sales = String(row['业务员'] || '').trim();
          const address = String(row['街道地址'] || '').trim();
          const zip = String(row['邮编'] || '').trim();
          const city = String(row['城市'] || '').trim();
          const province = String(row['省份'] || '').trim();
          const country = String(row['国家'] || '').trim();
          const phone = String(row['电话'] || '').trim();
          const contact = String(row['联系人'] || '').trim();
          const remark = String(row['备注 (开票时提示)'] || '').trim();
          const sameAddr = String(row['与公司地址相同'] || '').trim() === '是';
          
          const contactObj = {
            name: name || company, // Fallback if no store name
            company, code, email, is_iva, use_price, sales, address, zip, city, province, country, phone, contact, remark,
            owner: ownerLabel,
            ship_address: sameAddr ? address : '',
            ship_zip: sameAddr ? zip : '',
            ship_city: sameAddr ? city : '',
            ship_province: sameAddr ? province : '',
            ship_country: sameAddr ? country : '',
            ship_phone: sameAddr ? phone : '',
            ship_contact: sameAddr ? contact : ''
          };
          
          // Check if exists by company (if company is provided)
          const exist = company ? existList.find(c => c.company === company) : null;
          
          if (exist) {
            // Update
            await apiFetchJSON('/api/contacts/by-company', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(contactObj)
            });
            updateCount++;
          } else {
            // Create
            const now = new Date();
            contactObj.created = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
            await apiFetchJSON('/api/contacts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(contactObj)
            });
            successCount++;
          }
        }
        
        alert(`上传完成！\n新增: ${successCount} 条\n更新: ${updateCount} 条`);
        ctUploadModal.style.display = 'none';
        await apiContactsList(contactsTab, contactsSearch?.value || '', 1, 5000);
        renderContacts();
        
      } catch (err) {
        console.error(err);
        alert('解析或上传失败，请检查表格格式');
      } finally {
        ctUploadConfirm.disabled = false;
        ctUploadConfirm.textContent = '一键上传';
      }
    };
    reader.readAsArrayBuffer(file);
    
  } catch (err) {
    console.error(err);
    alert('获取现有联系人失败，请重试');
    ctUploadConfirm.disabled = false;
    ctUploadConfirm.textContent = '一键上传';
  }
});

ctSubmitTop?.addEventListener('click', () => {
  clearContactsForm();
  editingIndex = null;
  editingTab = null;
  if (ctModalTitle) ctModalTitle.textContent = '新增' + (contactsTab==='customers'?'客户':contactsTab==='merchants'?'商家':'往来单位');
  if (ctSubmitBtn) ctSubmitBtn.textContent = '保存';
  if (ctModal) ctModal.style.display = 'flex';
});
ctForm?.addEventListener('submit', async e => {
  e.preventDefault();
  
  // Clear previous errors
  document.querySelectorAll('.group.error').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.shake').forEach(el => el.classList.remove('shake'));

  const name = document.getElementById('ct-name').value.trim();
  const company = document.getElementById('ct-company').value.trim();
  const code = document.getElementById('ct-code').value.trim();
  const contact = document.getElementById('ct-contact').value.trim();
  const phone = document.getElementById('ct-phone').value.trim();
  const country = document.getElementById('ct-country').value.trim();
  const address = document.getElementById('ct-address').value.trim();
  const zip = document.getElementById('ct-zip').value.trim();
  const city = document.getElementById('ct-city').value.trim();
  const remark = document.getElementById('ct-remark').value.trim();
  const invoice_nota = (document.getElementById('ct-invoice-nota')?.value || '').trim();
  const email = (document.getElementById('ct-email')?.value || '').trim();
  const province = (document.getElementById('ct-province')?.value || '').trim();
  const ship_address = (document.getElementById('ct-ship-address')?.value || '').trim();
  const ship_zip = (document.getElementById('ct-ship-zip')?.value || '').trim();
  const ship_city = (document.getElementById('ct-ship-city')?.value || '').trim();
  const ship_province = (document.getElementById('ct-ship-province')?.value || '').trim();
  const ship_country = (document.getElementById('ct-ship-country')?.value || '').trim();
  const ship_phone = (document.getElementById('ct-ship-phone')?.value || '').trim();
  const ship_contact = (document.getElementById('ct-ship-contact')?.value || '').trim();
  const sales = (document.getElementById('ct-sales')?.value || '').trim();
  const use_price = (document.getElementById('ct-price')?.value || 'price1').trim();
  const is_iva = (document.getElementById('ct-iva')?.value === 'true');

  // Validation
  let isValid = true;
  const requiredFields = [
    { id: 'ct-name', val: name }
  ];

  requiredFields.forEach(f => {
    if (!f.val) {
      isValid = false;
      const el = document.getElementById(f.id);
      if (el) {
        const group = el.closest('.group');
        if (group) {
          group.classList.add('error');
          // Trigger shake reflow
          void group.offsetWidth; 
          group.classList.add('shake');
        }
      }
    }
  });

  if (!isValid) return;

  try {
    if (editingIndex !== null) {
      const target = contactsData[editingTab]?.[editingIndex];
      const id = document.getElementById('ct-id').value;
      await apiContactsUpdateById(id, { name, company, code, contact, phone, city, remark, invoice_nota, owner: contactsTab==='customers'?'客户':contactsTab==='merchants'?'商家':'其它', country, address, zip, sales: sales||'', use_price, is_iva, email, province, ship_address, ship_zip, ship_city, ship_province, ship_country, ship_phone, ship_contact });
      if (target) {
        target.name = name;
        target.company = company;
        target.code = code;
        target.contact = contact;
        target.phone = phone;
        target.country = country;
        target.address = address;
        target.zip = zip;
        target.city = city;
        target.remark = remark;
        target.invoice_nota = invoice_nota;
        target.sales = sales || '';
        target.use_price = use_price;
        target.is_iva = is_iva;
        target.email = email;
        target.province = province;
        target.ship_address = ship_address;
        target.ship_zip = ship_zip;
        target.ship_city = ship_city;
        target.ship_province = ship_province;
        target.ship_country = ship_country;
        target.ship_phone = ship_phone;
        target.ship_contact = ship_contact;
      }
      editingIndex = null;
      editingTab = null;
      ctSubmitBtn.textContent = '保存';
    } else {
      const now = new Date();
      const created = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      const newContact = { name, contact, phone, city, remark, invoice_nota, owner: contactsTab==='customers'?'客户':contactsTab==='merchants'?'商家':'其它', created, company, code, country, address, zip, sales: sales || '', use_price, is_iva, email, province, ship_address, ship_zip, ship_city, ship_province, ship_country, ship_phone, ship_contact };
      const newId = await apiContactsCreate(newContact);
      contactsData[contactsTab].push(newContact);
      if (newId && tempContactNotes.length > 0) {
        for (const n of tempContactNotes) {
          await apiFetchJSON(`/api/contacts/${newId}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: n.note })
          });
        }
      }
    }
  } catch (err) {
    if (err?.data?.error === 'duplicate_name' || err?.message === 'duplicate_name') {
      alert('店铺名称已经存在，请确认后重试');
      return;
    }
    alert('保存失败，请刷新后重试');
    return;
  }
  clearContactsForm();
  if (ctModal) ctModal.style.display = 'none';
  await apiContactsList(contactsTab, contactsSearch?.value || '', 1, 5000);
  renderContacts();
  saveJSON('contactsData', contactsData);
});
const ctShipSame = document.getElementById('ct-ship-same');
if (ctShipSame) {
  ctShipSame.addEventListener('change', () => {
    if (ctShipSame.checked) {
      document.getElementById('ct-ship-address').value = document.getElementById('ct-address').value;
      document.getElementById('ct-ship-zip').value = document.getElementById('ct-zip').value;
      document.getElementById('ct-ship-city').value = document.getElementById('ct-city').value;
      document.getElementById('ct-ship-province').value = document.getElementById('ct-province').value;
      document.getElementById('ct-ship-country').value = document.getElementById('ct-country').value;
      document.getElementById('ct-ship-phone').value = document.getElementById('ct-phone').value;
      document.getElementById('ct-ship-contact').value = document.getElementById('ct-contact').value;
    }
  });
}
const catList = document.getElementById('cat-list');
const addCatBtn = document.getElementById('add-cat');
const categoriesData = [
  { name:'收入', children:['服务收入(现金)','服务收入(银行)','银行储蓄','现金借贷','订单收入','其它收入'] },
  { name:'开支', children:['现金开支','员工工资','出差补贴','人工开支','其它开支'] }
];

// Helper for Custom Modals
const catModal = document.getElementById('cat-modal');
const catModalTitle = document.getElementById('cat-modal-title');
const catModalInput = document.getElementById('cat-modal-input');
const catModalOk = document.getElementById('cat-modal-ok');
const catModalCancel = document.getElementById('cat-modal-cancel');
let catModalCallback = null;

function openPrompt(title, value, cb) {
  if (catModal) {
    catModalTitle.textContent = title;
    catModalInput.value = value || '';
    catModalCallback = cb;
    catModal.style.display = 'flex';
    catModalInput.focus();
  } else {
    const v = prompt(title, value);
    if (v !== null) cb(v);
  }
}

if (catModalOk) {
  catModalOk.onclick = () => {
    if (catModalCallback) catModalCallback(catModalInput.value);
    catModal.style.display = 'none';
    catModalCallback = null;
  };
}
if (catModalCancel) {
  catModalCancel.onclick = () => {
    catModal.style.display = 'none';
    catModalCallback = null;
  };
}

const genericConfirmModal = document.getElementById('generic-confirm-modal');
const genericConfirmMsg = document.getElementById('generic-confirm-msg');
const genericConfirmOk = document.getElementById('generic-confirm-ok');
let genericConfirmCallback = null;

function openConfirm(msg, cb) {
  if (genericConfirmModal) {
    genericConfirmMsg.textContent = msg;
    genericConfirmCallback = cb;
    genericConfirmModal.style.display = 'flex';
  } else {
    if (confirm(msg)) cb();
  }
}

if (genericConfirmOk) {
  genericConfirmOk.onclick = () => {
    if (genericConfirmCallback) genericConfirmCallback();
    genericConfirmModal.style.display = 'none';
    genericConfirmCallback = null;
  };
}
document.querySelectorAll('.close-generic-confirm').forEach(b => {
  b.onclick = () => {
    genericConfirmModal.style.display = 'none';
    genericConfirmCallback = null;
  };
});

function renderCats() {
  catList.innerHTML = '';
  categoriesData.forEach((cat, idx) => {
    const panel = document.createElement('div');
    panel.className = 'cat-panel';
    
    // Parent Handle
    const handle = document.createElement('span');
    handle.textContent = '☰';
    handle.style.cssText = 'cursor:grab; margin-right:12px; color:#64748b; font-size:16px; user-select:none';
    handle.draggable = true;
    
    handle.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({type:'parent', idx}));
      panel.style.opacity = '0.5';
    });
    handle.addEventListener('dragend', () => panel.style.opacity = '1');
    
    panel.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    panel.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;
      try {
        const data = JSON.parse(dataStr);
        if (data.type !== 'parent') return;
        const fromIdx = data.idx;
        const toIdx = idx;
        if (fromIdx === toIdx) return;
        const item = categoriesData.splice(fromIdx, 1)[0];
        categoriesData.splice(toIdx, 0, item);
        saveJSON('categoriesData', categoriesData);
        apiCategoriesSave();
        renderCats();
      } catch(ex){}
    });

    const header = document.createElement('div');
    header.className = 'cat-header';
    const title = document.createElement('div');
    title.className = 'cat-title';
    title.textContent = cat.name;
    const actions = document.createElement('div');
    actions.className = 'cat-actions';
    const addBtn = document.createElement('button'); addBtn.className = 'btn-icon btn-green'; addBtn.textContent = '+'; addBtn.title = '新增二级类目';
    const editBtn = document.createElement('button'); editBtn.className = 'btn-icon btn-blue'; editBtn.textContent = '✎'; editBtn.title = '编辑一级类目';
    const delBlocked = (cat.name === '收入' || cat.name === '开支');
    actions.append(addBtn, editBtn);
    let delBtn = null;
    if (!delBlocked) {
      delBtn = document.createElement('button'); delBtn.className = 'btn-icon btn-red'; delBtn.textContent = '🗑'; delBtn.title = '删除一级类目';
      actions.append(delBtn);
    }
    
    header.append(handle, title, actions);
    
    const items = document.createElement('div');
    items.className = 'cat-items';
    cat.children.forEach((name, j) => {
      const row = document.createElement('div');
      row.className = 'cat-item';
      
      // Child Handle
      const cHandle = document.createElement('span');
      cHandle.textContent = '☰';
      cHandle.style.cssText = 'cursor:grab; margin-right:10px; color:#94a3b8; font-size:12px; user-select:none';
      cHandle.draggable = true;
      
      cHandle.addEventListener('dragstart', e => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({type:'child', pIdx:idx, cIdx:j}));
        row.style.opacity = '0.5';
      });
      cHandle.addEventListener('dragend', () => row.style.opacity = '1');
      
      row.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;
        try {
          const data = JSON.parse(dataStr);
          if (data.type !== 'child') return;
          const fromPIdx = data.pIdx;
          const fromCIdx = data.cIdx;
          const toPIdx = idx;
          const toCIdx = j;
          if (fromPIdx !== toPIdx) return;
          if (fromCIdx === toCIdx) return;
          const item = categoriesData[fromPIdx].children.splice(fromCIdx, 1)[0];
          categoriesData[toPIdx].children.splice(toCIdx, 0, item);
          saveJSON('categoriesData', categoriesData);
          apiCategoriesSave();
          renderCats();
        } catch(ex){}
      });

      const nm = document.createElement('div'); nm.className = 'cat-name'; nm.textContent = name;
      const ops = document.createElement('div'); ops.className = 'cat-actions';
      const e = document.createElement('button'); e.className = 'btn-icon btn-blue'; e.textContent = '✎'; e.title = '编辑';
      const d = document.createElement('button'); d.className = 'btn-icon btn-red'; d.textContent = '🗑'; d.title = '删除';
      ops.append(e, d);
      
      row.append(cHandle, nm, ops);
      items.appendChild(row);
      e.addEventListener('click', () => {
        openPrompt('编辑名称', name, (val) => {
          if (val && val.trim()) { categoriesData[idx].children[j] = val.trim(); renderCats(); saveJSON('categoriesData', categoriesData); apiCategoriesSave(); }
        });
      });
      d.addEventListener('click', () => {
        openConfirm('确定删除该子类目？', () => {
          categoriesData[idx].children.splice(j,1);
          renderCats();
          saveJSON('categoriesData', categoriesData);
          apiCategoriesSave();
        });
      });
    });
    panel.append(header, items);
    catList.appendChild(panel);
    addBtn.addEventListener('click', () => {
      openPrompt('新增二级类目名称', '', (val) => {
        if (val && val.trim()) { categoriesData[idx].children.push(val.trim()); renderCats(); saveJSON('categoriesData', categoriesData); apiCategoriesSave(); }
      });
    });
    editBtn.addEventListener('click', () => {
      openPrompt('编辑一级类目名称', cat.name, (val) => {
        if (val && val.trim()) { categoriesData[idx].name = val.trim(); renderCats(); saveJSON('categoriesData', categoriesData); apiCategoriesSave(); }
      });
    });
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        openConfirm('确定删除该一级类目？', () => {
          categoriesData.splice(idx,1); renderCats(); saveJSON('categoriesData', categoriesData); apiCategoriesSave();
        });
      });
    }
  });
  refreshLedgerTypeOptions();
  setCategories();
}
addCatBtn?.addEventListener('click', () => {
  openPrompt('新增一级类目名称', '', (val) => {
    if (val && val.trim()) { categoriesData.push({ name: val.trim(), children: [] }); renderCats(); saveJSON('categoriesData', categoriesData); apiCategoriesSave(); }
  });
});
const roleRows = document.getElementById('role-rows');
const roleSearch = document.getElementById('role-search');
const rolePageSize = document.getElementById('role-page-size');
const rolePrev = document.getElementById('role-prev');
const roleNext = document.getElementById('role-next');
const rolePageEl = document.getElementById('role-page');
const roleSummary = document.getElementById('role-summary');
const roleCreate = document.getElementById('role-create');
const roleModal = document.getElementById('role-modal');
const roleForm = document.getElementById('role-form');
const roleCancel = document.getElementById('role-cancel');
const rolesData = [];
const permStructure = [
  { mod: 'home', label: '首页' },
  { 
    group: '日常运营', 
    children: [
      { mod: 'tasks', label: '任务信息' },
      { mod: 'daily_orders', label: '订单管理' },
      { mod: 'finished_stock', label: '商品库存' },
      { mod: 'finished_stock_adjust', label: '库存调整' },
      { mod: 'raw_stock', label: '原材料库存' },
      { mod: 'production_review', label: '审核生产' },
      { mod: 'event_records', label: '事件记录' },
      { mod: 'knowledge_base', label: '知识库' }
    ]
  },
  {
    group: '销售',
    children: [
      { mod: 'sales_order', label: '出单系统' },
      { mod: 'sales_invoice', label: '发票' },
      { mod: 'sales_products', label: '商品列表' },
      { mod: 'sales_stats', label: '商品销售统计', extra_actions: [{ act: 'assigned_only', label: '只可查看勾选的商品' }] }
    ]
  },
  {
    mod: 'ledger',
    label: '收支记账',
    extra_actions: [
      { act: 'update', label: '可修改记录' },
      { act: 'delete', label: '可删除记录' },
      { act: 'confirm', label: '可确认记录' }
    ]
  },
  {
    mod: 'payables',
    label: '应收/应付账款',
    extra_actions: [
      { act: 'update', label: '可修改记录' },
      { act: 'delete', label: '可删除记录' },
      { act: 'confirm', label: '可确认记录' }
    ]
  },
  { mod: 'contacts', label: '往来单位' },
  { mod: 'categories', label: '分类管理' },
  { mod: 'accounts', label: '账户管理' },
  { mod: 'sales_accounts', label: '业务员管理' },
  {
    group: '系统设置',
    children: [
      { mod: 'company_info', label: '公司信息' },
      { mod: 'user_accounts', label: '帐号管理' },
      { mod: 'role_accounts', label: '角色管理' },
      { mod: 'system', label: '基础设置' }
    ]
  }
];

const editablePermModules = new Set([
  'tasks',
  'daily_orders',
  'finished_stock',
  'finished_stock_adjust',
  'raw_stock',
  'production_review',
  'event_records',
  'knowledge_base',
  'sales_order',
  'sales_invoice',
  'sales_products',
  'ledger',
  'payables',
  'contacts',
  'categories',
  'accounts',
  'sales_accounts',
  'company_info',
  'user_accounts',
  'role_accounts',
  'system'
]);

function moduleSupportsEdit(mod) {
  return editablePermModules.has(String(mod || ''));
}

function hasLegacyModifyPerm(modPerms) {
  if (!modPerms || typeof modPerms !== 'object') return false;
  return Object.keys(modPerms).some(act => act !== 'view' && act !== 'assigned_only');
}

function hasModuleEditPerm(perms, mod) {
  const modPerms = perms?.[mod] || {};
  return !!(modPerms.edit || hasLegacyModifyPerm(modPerms));
}

function isModifyAction(action) {
  const act = String(action || '').trim();
  return !!act && act !== 'view' && act !== 'assigned_only';
}

function hasGranularRecordPerm(modPerms) {
  if (!modPerms || typeof modPerms !== 'object') return false;
  return ['update', 'delete', 'confirm'].some(act => Object.prototype.hasOwnProperty.call(modPerms, act));
}

function allTruePerms() {
  const p = {};
  permStructure.forEach(item => {
    if (item.group && item.children) {
      item.children.forEach(c => p[c.mod] = moduleSupportsEdit(c.mod) ? { view: true, edit: true } : { view: true });
    } else if (item.mod) {
      p[item.mod] = moduleSupportsEdit(item.mod) ? { view: true, edit: true } : { view: true };
    }
  });
  return p;
}
function getRoleByName(name) { return rolesData.find(r => r.name === name); }
function currentUserRole() {
  const u = getAuthUser();
  if (!u) return null;
  const roleName = u.role || (u.name==='aaaaaa'?'超级管理员':'');
  return getRoleByName(roleName) || null;
}
function currentPerms() {
  const r = currentUserRole();
  if (!r || r.name==='超级管理员') return allTruePerms();
  return r.perms || {};
}
function can(module, action) {
  const u = getAuthUser();
  const roleName = (u?.role) || getUserRoleName(u?.name || '');
  if (roleName === '超级管理员') return true;
  const role = rolesData.find(r => r.name === roleName);
  const perms = role?.perms || {};
  const m = perms[module] || {};
  if (!action || action === 'view') return !!m.view;
  if (action === 'assigned_only') return !!m.assigned_only;
  if (['update', 'delete', 'confirm'].includes(action)) {
    if (hasGranularRecordPerm(m)) return !!m[action];
    if (action === 'update' && (m.edit || m[action])) return true;
    return !!m[action];
  }
  if (isModifyAction(action) && m.edit) return true;
  return !!m[action];
}
const rolePermsModal = document.getElementById('role-perms-modal');
const rolePermsForm = document.getElementById('role-perms-form');
const rolePermsCancel = document.getElementById('role-perms-cancel');
const permsWrap = document.getElementById('perms-wrap');
const rolePermsPageEl = document.getElementById('page-role-perms');
const rolePermsBack = document.getElementById('role-perms-back');
const rolePermsFormPage = document.getElementById('role-perms-form-page');
const permsPageWrap = document.getElementById('perms-page-wrap');
let editingPermRole = null;
function appendPermCheckbox(row, mod, act, checked, labelText) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.mod = mod;
  cb.dataset.act = act;
  cb.checked = !!checked;
  cb.style.marginRight = '8px';
  row.append(cb, document.createTextNode(labelText));
  return cb;
}

function bindPermCheckboxDeps(viewCb, editCb) {
  if (!viewCb || !editCb) return;
  if (editCb.checked) viewCb.checked = true;
  viewCb.addEventListener('change', () => {
    if (!viewCb.checked) editCb.checked = false;
  });
  editCb.addEventListener('change', () => {
    if (editCb.checked) viewCb.checked = true;
  });
}

function bindExtraPermCheckboxDeps(viewCb, extraCbs = []) {
  if (!viewCb || !extraCbs.length) return;
  extraCbs.forEach(cb => {
    if (cb.checked) viewCb.checked = true;
    cb.addEventListener('change', () => {
      if (cb.checked) viewCb.checked = true;
    });
  });
  viewCb.addEventListener('change', () => {
    if (!viewCb.checked) extraCbs.forEach(cb => { cb.checked = false; });
  });
}

function createPermRow(item, perms) {
  const row = document.createElement('label');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.cursor = 'pointer';
  row.style.flexWrap = 'wrap';
  row.style.gap = '10px';
  const viewCb = appendPermCheckbox(row, item.mod, 'view', !!(perms[item.mod] && perms[item.mod].view), item.label);
  let editCb = null;
  const extraCbs = [];
  if (moduleSupportsEdit(item.mod)) {
    const editWrap = document.createElement('span');
    editWrap.style.display = 'inline-flex';
    editWrap.style.alignItems = 'center';
    editCb = appendPermCheckbox(editWrap, item.mod, 'edit', hasModuleEditPerm(perms, item.mod), '是否可修改');
    row.appendChild(editWrap);
  }
  (item.extra_actions || []).forEach(extra => {
    const extraRow = document.createElement('span');
    extraRow.style.display = 'inline-flex';
    extraRow.style.alignItems = 'center';
    extraCbs.push(appendPermCheckbox(extraRow, item.mod, extra.act, !!(perms[item.mod] && perms[item.mod][extra.act]), extra.label));
    row.appendChild(extraRow);
  });
  bindPermCheckboxDeps(viewCb, editCb);
  bindExtraPermCheckboxDeps(viewCb, extraCbs);
  return row;
}
function collectRolePerms(container) {
  const newPerms = {};
  permStructure.forEach(item => {
    if (item.group && item.children) item.children.forEach(c => newPerms[c.mod] = {});
    else if (item.mod) newPerms[item.mod] = {};
  });
  container?.querySelectorAll('input[type=checkbox]').forEach(cb => {
    const mod = cb.dataset.mod;
    const act = cb.dataset.act || 'view';
    if (!mod || !cb.checked) return;
    if (!newPerms[mod]) newPerms[mod] = {};
    newPerms[mod][act] = true;
  });
  return newPerms;
}
function openPermsEditor(role) {
  editingPermRole = role;
  permsPageWrap.innerHTML = '';
  const perms = role.perms || {};
  
  permStructure.forEach(item => {
    const box = document.createElement('div'); 
    box.className = 'cat-panel';
    box.style.marginBottom = '16px';
    
    if (item.group) {
      const top = document.createElement('div'); 
      top.className = 'cat-header'; 
      top.textContent = item.group;
      const cont = document.createElement('div'); 
      cont.style.padding = '12px 16px';
      cont.style.display = 'flex';
      cont.style.flexWrap = 'wrap';
      cont.style.gap = '16px';
      
      item.children.forEach(c => {
        cont.appendChild(createPermRow(c, perms));
      });
      box.append(top, cont);
    } else {
      const cont = document.createElement('div'); 
      cont.style.padding = '12px 16px';
      cont.appendChild(createPermRow(item, perms));
      box.appendChild(cont);
    }
    
    permsPageWrap.appendChild(box);
  });
  location.hash = '#role-perms';
}
rolePermsCancel?.addEventListener('click', () => { rolePermsModal.style.display='none'; editingPermRole=null; });
rolePermsForm?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!editingPermRole) return;
  const newPerms = collectRolePerms(permsWrap);
  editingPermRole.perms = newPerms;
  await apiRoleUpdatePerms(editingPermRole.id, newPerms);
  rolePermsModal.style.display='none';
  editingPermRole = null;
  renderRoles();
});
rolePermsBack?.addEventListener('click', () => { location.hash = '#role-accounts'; });
rolePermsFormPage?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!editingPermRole) return;
  const newPerms = collectRolePerms(permsPageWrap);
  editingPermRole.perms = newPerms;
  await apiRoleUpdatePerms(editingPermRole.id, newPerms);
  
  // Show success feedback
  const saveBtn = document.getElementById('role-perms-save');
  if (saveBtn) {
    const origText = saveBtn.textContent;
    saveBtn.textContent = '保存成功！';
    saveBtn.style.background = '#16a34a';
    setTimeout(() => {
      saveBtn.textContent = origText;
      saveBtn.style.background = '';
      editingPermRole = null;
      location.hash = '#role-accounts';
      renderRoles();
    }, 800);
  } else {
    editingPermRole = null;
    location.hash = '#role-accounts';
    renderRoles();
  }
});
let rolePage = 1;
async function apiRolesList() {
  try {
    const list = await apiFetchJSON('/api/roles');
    if (Array.isArray(list)) {
      rolesData.splice(0, rolesData.length, ...list.map(r => ({ id:r.id, name:r.name, desc:r.desc||'', created:r.created||'', immutable: !!r.immutable, perms: r.perms || {} })));
      saveJSON('rolesData', rolesData);
    }
  } catch {}
}
async function apiRoleCreate(obj) {
  try { const r = await apiFetchJSON('/api/roles', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) }); return r?.id; } catch { return null; }
}
async function apiRoleDelete(id) {
  try { const r = await fetch(API_BASE + '/api/roles/'+String(id), { method:'DELETE' }); return r.ok; } catch { return false; }
}
async function apiRoleUpdatePerms(id, perms) {
  try { await apiFetchJSON('/api/roles/'+String(id)+'/perms', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ perms }) }); } catch {}
}
function renderRoles() {
  const key = (roleSearch?.value || '').trim();
  const size = parseInt(rolePageSize?.value || '10', 10);
  const data = rolesData.filter(r => {
    if (!key) return true;
    return [r.name, r.desc, String(r.id)].some(v => (v||'').includes(key));
  }).sort((a,b)=>b.id-a.id);
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total/size));
  if (rolePage > totalPages) rolePage = totalPages;
  const start = (rolePage-1)*size;
  const pageData = data.slice(start, start+size);
  roleRows.innerHTML = '';
  pageData.forEach(r => {
    const tr = document.createElement('tr');
    [r.id, r.name, r.desc, r.created].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
    const ops = document.createElement('td'); ops.className='actions';
    if ((r.name || '') === '超级管理员') {
      const tip = document.createElement('span'); tip.className='tag'; tip.textContent='不可编辑/删除';
      ops.append(tip);
    } else {
      const edit = document.createElement('a'); edit.href='#'; edit.textContent='编辑'; edit.className='link-blue';
      ops.append(edit);
      edit.addEventListener('click', e => { e.preventDefault(); openPermsEditor(r); });
    }
    tr.appendChild(ops);
    roleRows.appendChild(tr);
  });
  roleSummary.textContent = `显示 ${Math.min(total,start+1)} 到 ${Math.min(total,start+pageData.length)} 项，共 ${total} 项`;
  rolePageEl.textContent = String(rolePage);
}
roleSearch?.addEventListener('input', () => { rolePage = 1; renderRoles(); });
rolePageSize?.addEventListener('change', () => { rolePage = 1; renderRoles(); });
rolePrev?.addEventListener('click', () => { if (rolePage > 1) { rolePage--; renderRoles(); } });
roleNext?.addEventListener('click', () => {
  const size = parseInt(rolePageSize?.value || '10',10);
  const totalPages = Math.max(1, Math.ceil(rolesData.filter(r => (roleSearch?.value||'') ? [r.name,r.desc,String(r.id)].some(v => v.includes(roleSearch.value)) : true).length/size));
  if (rolePage < totalPages) { rolePage++; renderRoles(); }
});
roleCreate?.addEventListener('click', () => {
  roleModal.style.display = 'flex';
  document.getElementById('r-name').value='';
  document.getElementById('r-desc').value='';
});
roleCancel?.addEventListener('click', () => { roleModal.style.display = 'none'; });
roleForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('r-name').value.trim();
  const desc = document.getElementById('r-desc').value.trim();
  if (!name) return;
  const now = new Date();
  const created = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  await apiRoleCreate({ name, desc, created, perms:{} });
  await apiRolesList();
  roleModal.style.display = 'none';
  rolePage = 1;
  renderRoles();
});
const userRows = document.getElementById('user-rows');
const userSearch = document.getElementById('user-search');
const userPageSize = document.getElementById('user-page-size');
const userPrev = document.getElementById('user-prev');
const userNext = document.getElementById('user-next');
const userPageEl = document.getElementById('user-page');
const userSummary = document.getElementById('user-summary');
const userCreate = document.getElementById('user-create');
const userModal = document.getElementById('user-modal');
const userForm = document.getElementById('user-form');
const userCancel = document.getElementById('user-cancel');
const userModalTitle = document.getElementById('user-modal-title');
const userSaveBtn = document.getElementById('user-save');
const userAccounts = [];
(function syncInitialPasswords(){
  const m = getPwdMap();
  userAccounts.forEach(u => { if (u.password) m[u.name] = u.password; });
  setPwdMap(m);
})();
let userPage = 1;
let editingUserId = null;
function fillUserRoleOptions(selectedRole = '') {
  const roleSel = document.getElementById('u-role');
  if (!roleSel) return;
  roleSel.innerHTML = '<option value="">选择角色</option>';
  rolesData.forEach(r => {
    const opt = document.createElement('option'); opt.value = r.name; opt.textContent = r.name;
    roleSel.appendChild(opt);
  });
  roleSel.value = selectedRole || '';
}
function openUserModalForCreate() {
  editingUserId = null;
  if (userModalTitle) userModalTitle.textContent = '创建账号';
  if (userSaveBtn) userSaveBtn.textContent = '保存';
  document.getElementById('u-name').value = '';
  fillUserRoleOptions('');
  userModal.style.display = 'flex';
}
function openUserModalForEdit(user) {
  if (!user) return;
  editingUserId = Number(user.id || 0) || null;
  if (userModalTitle) userModalTitle.textContent = '编辑账号';
  if (userSaveBtn) userSaveBtn.textContent = '保存修改';
  document.getElementById('u-name').value = user.name || '';
  fillUserRoleOptions(user.role || '');
  userModal.style.display = 'flex';
}
async function submitUserAccountForm() {
  const name = document.getElementById('u-name').value.trim();
  const role = document.getElementById('u-role').value.trim() || '普通用户';
  if (!name) return;
  if (editingUserId != null) {
    const existing = userAccounts.find(x => x.id === editingUserId);
    const oldName = existing?.name || '';
    const ok = await apiUserUpdate(editingUserId, { name, role, enabled: existing?.enabled });
    if (!ok) return alert('保存失败，请检查账号名称是否重复或权限是否允许');
    if (existing) {
      existing.name = name;
      existing.role = role;
    }
    const au = getAuthUser();
    if (au && au.name === oldName) {
      setAuthUser({ ...au, name, role });
      try {
        const remembered = JSON.parse(localStorage.getItem('rememberedUser') || 'null');
        if (remembered && remembered.name === oldName) {
          localStorage.setItem('rememberedUser', JSON.stringify({ ...remembered, name }));
        }
      } catch {}
    }
    const pwdMap = getPwdMap();
    if (oldName && oldName !== name && Object.prototype.hasOwnProperty.call(pwdMap, oldName)) {
      pwdMap[name] = pwdMap[oldName];
      delete pwdMap[oldName];
      setPwdMap(pwdMap);
    }
  } else {
    const now = new Date();
    const created = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    await apiUserCreate({ name, role, created, password:'111111' });
  }
  await apiUsersList();
  userModal.style.display = 'none';
  editingUserId = null;
  userPage = 1;
  renderUserAccounts();
}
function renderUserAccounts() {
  const key = (userSearch?.value || '').trim();
  const size = parseInt(userPageSize?.value || '10', 10);
  const data = userAccounts.filter(u => {
    if (!key) return true;
    return [u.name, u.role, String(u.id)].some(v => (v||'').includes(key));
  }).sort((a,b)=>b.id-a.id);
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total/size));
  if (userPage > totalPages) userPage = totalPages;
  const start = (userPage-1)*size;
  const pageData = data.slice(start, start+size);
  if (!userRows) return;
  userRows.innerHTML = '';
  pageData.forEach(u => {
    const tr = document.createElement('tr');
    const tdId = document.createElement('td'); tdId.textContent = String(u.id); tr.appendChild(tdId);
    const tdName = document.createElement('td'); tdName.textContent = u.name; tr.appendChild(tdName);
    const tdRole = document.createElement('td');
    tdRole.textContent = u.name === 'aaaaaa' ? '超级管理员' : (u.role || '');
    tr.appendChild(tdRole);
    const tdCreated = document.createElement('td'); tdCreated.textContent = u.created || ''; tr.appendChild(tdCreated);
    const tdStatus = document.createElement('td');
    const sw = document.createElement('div'); sw.className = 'switch' + (u.enabled ? '' : ' off');
    const btn = document.createElement('button'); btn.textContent = u.enabled ? 'ON' : 'OFF';
    btn.addEventListener('click', async () => { u.enabled = !u.enabled; await apiUserUpdate(u.id, { role: u.role, enabled: u.enabled }); renderUserAccounts(); saveJSON('userAccounts', userAccounts); });
    sw.appendChild(btn); tdStatus.appendChild(sw); tr.appendChild(tdStatus);
    const tdOps = document.createElement('td');
    if (u.name === 'aaaaaa') {
      tdOps.textContent = '请使用修改密码';
    } else {
      const edit = document.createElement('a'); edit.href='#'; edit.textContent='编辑'; edit.className='link-blue';
      edit.addEventListener('click', e => {
        e.preventDefault();
        openUserModalForEdit(u);
      });
      tdOps.appendChild(edit);
      const reset = document.createElement('a'); reset.href='#'; reset.textContent='重置密码'; reset.className='link-blue';
      reset.style.marginLeft = '8px';
      reset.addEventListener('click', e => {
        e.preventDefault();
        pendingResetUser = u;
        resetMsg.textContent = `已经将帐号 ${u.name} 密码重置，重置后密码为“111111”`;
        resetModal.style.display = 'flex';
      });
      tdOps.appendChild(reset);
    }
    if (u.id !== 1) {
      const del = document.createElement('a'); del.href='#'; del.textContent='删除'; del.className='link-red'; del.style.marginLeft='8px';
      del.addEventListener('click', async e => {
        e.preventDefault();
        if (!confirm(`确定删除账号 ${u.name}？`)) return;
        const ok = await apiUserDelete(u.id);
        if (ok) {
           await apiUsersList();
           renderUserAccounts();
           alert('删除成功');
        } else {
           alert('删除失败');
        }
      });
      tdOps.appendChild(del);
    }
    tr.appendChild(tdOps);
    userRows.appendChild(tr);
  });
  if (userSummary) userSummary.textContent = `显示 ${Math.min(total,start+1)} 到 ${Math.min(total,start+pageData.length)} 项，共 ${total} 项`;
  if (userPageEl) userPageEl.textContent = String(userPage);
}
userSearch?.addEventListener('input', () => { userPage = 1; renderUserAccounts(); });
userPageSize?.addEventListener('change', () => { userPage = 1; renderUserAccounts(); });
userPrev?.addEventListener('click', () => { if (userPage > 1) { userPage--; renderUserAccounts(); } });
userNext?.addEventListener('click', () => {
  const size = parseInt(userPageSize?.value || '10',10);
  const totalPages = Math.max(1, Math.ceil(userAccounts.filter(u => (userSearch?.value||'') ? [u.name,u.role,String(u.id)].some(v => v.includes(userSearch.value)) : true).length/size));
  if (userPage < totalPages) { userPage++; renderUserAccounts(); }
});
userCreate?.addEventListener('click', () => {
  openUserModalForCreate();
});
userCancel?.addEventListener('click', () => { userModal.style.display = 'none'; editingUserId = null; });
userForm?.addEventListener('submit', async e => {
  e.preventDefault();
  await submitUserAccountForm();
});
userSaveBtn?.addEventListener('click', async e => {
  e.preventDefault();
  await submitUserAccountForm();
});
const salesRows = document.getElementById('sales-rows');
const salesSearch = document.getElementById('sales-search');
const salesCreate = document.getElementById('sales-create');
const salesModal = document.getElementById('sales-modal');
const salesForm = document.getElementById('sales-form');
const salesCancel = document.getElementById('sales-cancel');
const sName = document.getElementById('s-name');
const sRegion = document.getElementById('s-region');
const sPhone = document.getElementById('s-phone');
const sBase = document.getElementById('s-base');
const sRate = document.getElementById('s-rate');
const sCommission = document.getElementById('s-commission');
const salesData = [];
let editingSalesId = null;
function renderSales() {
  const key = (salesSearch?.value || '').trim();
  const data = salesData.filter(x => {
    if (!key) return true;
    return [x.name, x.region, x.phone].some(v => (v||'').includes(key));
  }).sort((a,b)=>b.id-a.id);
  if (!salesRows) return;
  salesRows.innerHTML = '';
  data.forEach(s => {
    const tr = document.createElement('tr');
    const related = payRecords.filter(r => (r.sales || '') === (s.name || ''));
    const docs = Array.from(new Set(related.map(r => (r.doc || '')).filter(Boolean)));
    const ordersCount = docs.length;
    const totalAmount = related.reduce((sum, r) => sum + (r.amount || 0), 0);
    const arrearsAmount = related.reduce((sum, r) => sum + Math.max(0, (r.amount || 0) - (r.paid || 0)), 0);
    const cells = [s.id, s.name, s.region || '', s.phone || '', (s.base||0).toFixed(2), (s.rate||0), (s.commission||0).toFixed(2)];
    cells.forEach(v => { const td = document.createElement('td'); td.textContent = String(v); tr.appendChild(td); });
    const tdOrders = document.createElement('td');
    const aOrders = document.createElement('a'); aOrders.href='#'; aOrders.textContent=String(ordersCount); aOrders.className='link-blue';
    tdOrders.appendChild(aOrders); tr.appendChild(tdOrders);
    const tdTotal = document.createElement('td'); tdTotal.textContent = totalAmount.toFixed(2); tr.appendChild(tdTotal);
    const tdArrears = document.createElement('td'); tdArrears.textContent = arrearsAmount.toFixed(2); tdArrears.style.color = '#ef4444'; tr.appendChild(tdArrears);
    const tdCreated = document.createElement('td'); tdCreated.textContent = s.created || ''; tr.appendChild(tdCreated);
    const ops = document.createElement('td'); ops.className='actions';
    const edit = document.createElement('a'); edit.href='#'; edit.textContent='编辑'; edit.className='link-blue';
    const del = document.createElement('a'); del.href='#'; del.textContent='删除'; del.className='link-red';
    ops.append(edit, document.createTextNode(' '), del);
    tr.appendChild(ops);
    salesRows.appendChild(tr);
    aOrders.addEventListener('click', e => { e.preventDefault(); openSalesOrders(s.name); });
    edit.addEventListener('click', e => {
      e.preventDefault();
      editingSalesId = s.id;
      sName.value = s.name || '';
      sRegion.value = s.region || '';
      sPhone.value = s.phone || '';
      sBase.value = s.base != null ? s.base : '';
      sRate.value = s.rate != null ? s.rate : '';
      sCommission.value = s.commission != null ? s.commission : '';
      salesModal.style.display = 'flex';
    });
    del.addEventListener('click', async e => {
      e.preventDefault();
      if (!confirm('确定删除该业务员？')) return;
      const i = salesData.findIndex(x => x.id === s.id);
      if (i>=0) {
        const ok = await apiSalesDelete(s.id);
        if (ok) salesData.splice(i,1);
        await apiSalesList(salesSearch?.value || '');
        renderSales();
        saveJSON('salesData', salesData);
      }
    });
    tdArrears.addEventListener('click', e => { e.preventDefault(); openSalesArrears(s.name); });
  });
  const sel = document.getElementById('ct-sales');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">请选择业务员</option>';
    salesData.forEach(s => {
      const opt = document.createElement('option'); opt.value = s.name; opt.textContent = s.name;
      sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  }
}
salesCreate?.addEventListener('click', () => {
  editingSalesId = null;
  sName.value=''; sRegion.value=''; sPhone.value=''; sBase.value=''; sRate.value=''; sCommission.value='';
  salesModal.style.display = 'flex';
});
salesCancel?.addEventListener('click', () => { salesModal.style.display = 'none'; editingSalesId = null; });
salesForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const name = sName.value.trim();
  const region = sRegion.value.trim();
  const phone = sPhone.value.trim();
  const base = parseFloat(sBase.value || '0');
  const rate = parseFloat(sRate.value || '0');
  const commission = parseFloat(sCommission.value || '0');
  if (!name || !phone) return;
  if (editingSalesId != null) {
    const s = salesData.find(x => x.id === editingSalesId);
    if (s) { s.name=name; s.region=region; s.phone=phone; s.base=isNaN(base)?0:base; s.rate=isNaN(rate)?0:rate; s.commission=isNaN(commission)?0:commission; }
    await apiSalesUpdate(editingSalesId, { name, region, phone, base:isNaN(base)?0:base, rate:isNaN(rate)?0:rate, commission:isNaN(commission)?0:commission });
  } else {
    const maxId = salesData.reduce((m,x)=>Math.max(m,x.id||0),0);
    const now = new Date();
    const created = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    salesData.push({ id:maxId+1, name, region, phone, base:isNaN(base)?0:base, rate:isNaN(rate)?0:rate, commission:isNaN(commission)?0:commission, created });
    await apiSalesCreate({ name, region, phone, base:isNaN(base)?0:base, rate:isNaN(rate)?0:rate, commission:isNaN(commission)?0:commission, created });
  }
  salesModal.style.display = 'none';
  editingSalesId = null;
  await apiSalesList(salesSearch?.value || '');
  renderSales();
  saveJSON('salesData', salesData);
});
salesSearch?.addEventListener('input', async () => { await apiSalesList(salesSearch?.value || ''); renderSales(); });
const salesOrdersModal = document.getElementById('sales-orders-modal');
const salesOrdersRows = document.getElementById('sales-orders-rows');
const salesOrdersHead = document.getElementById('sales-orders-head');
const salesOrdersClose = document.getElementById('sales-orders-close');
const salesArrearsModal = document.getElementById('sales-arrears-modal');
const salesArrearsRows = document.getElementById('sales-arrears-rows');
const salesArrearsHead = document.getElementById('sales-arrears-head');
const salesArrearsClose = document.getElementById('sales-arrears-close');
function openSalesOrders(name) {
  salesOrdersHead.textContent = '业务员：' + (name || '');
  const list = payRecords.filter(r => (r.sales || '') === (name || ''));
  salesOrdersRows.innerHTML = '';
  list.forEach(r => {
    const tr = document.createElement('tr');
    const paid = r.paid || 0;
    const arrears = Math.max(0, (r.amount || 0) - paid);
    [r.type, r.partner || '', r.doc || '', (r.amount||0).toFixed(2), paid.toFixed(2), arrears.toFixed(2), r.date || ''].forEach((v,i) => {
      const td = document.createElement('td');
      td.textContent = String(v);
      if (i===5 && arrears>0) td.style.color = '#ef4444';
      tr.appendChild(td);
    });
    salesOrdersRows.appendChild(tr);
  });
  salesOrdersModal.style.display = 'flex';
}
function openSalesArrears(name) {
  salesArrearsHead.textContent = '业务员：' + (name || '');
  const list = payRecords.filter(r => (r.sales || '') === (name || '') && Math.max(0,(r.amount||0) - (r.paid||0)) > 0);
  salesArrearsRows.innerHTML = '';
  list.forEach(r => {
    const tr = document.createElement('tr');
    const paid = r.paid || 0;
    const remain = Math.max(0, (r.amount || 0) - paid);
    [r.type, r.partner || '', r.doc || '', (r.amount||0).toFixed(2), paid.toFixed(2), remain.toFixed(2), r.date || ''].forEach((v,i) => {
      const td = document.createElement('td');
      td.textContent = String(v);
      if (i===5) td.style.color = '#ef4444';
      tr.appendChild(td);
    });
    salesArrearsRows.appendChild(tr);
  });
  salesArrearsModal.style.display = 'flex';
}
salesOrdersClose?.addEventListener('click', () => { salesOrdersModal.style.display = 'none'; });
salesArrearsClose?.addEventListener('click', () => { salesArrearsModal.style.display = 'none'; });
const logoutBtn = document.getElementById('logout-btn');
const authUserTag = document.getElementById('auth-user-tag');
function getAuthUser() {
  try { return JSON.parse(localStorage.getItem('authUser') || 'null'); } catch { return null; }
}
function setAuthUI() {
  const u = getAuthUser();
  if (u) {
    authUserTag.style.display = 'inline-block';
    authUserTag.textContent = '当前用户：' + u.name;
    logoutBtn.style.display = 'block';
  } else {
    authUserTag.style.display = 'none';
    logoutBtn.style.display = 'none';
  }
}
function setAuthUser(u) {
  if (u) localStorage.setItem('authUser', JSON.stringify(u));
  else localStorage.removeItem('authUser');
  setAuthUI();
}
function getUserRoleName(name) {
  if (name === 'aaaaaa') return '超级管理员';
  const au = getAuthUser();
  if (au && au.name === name) return au.role || '';
  return '';
}
function getPwdMap() {
  try { return JSON.parse(localStorage.getItem('userPasswords') || '{}'); } catch { return {}; }
}
function setPwdMap(map) {
  localStorage.setItem('userPasswords', JSON.stringify(map || {}));
}
const API_BASE = '';
function getAuthToken() { try { return localStorage.getItem('authToken') || ''; } catch { return ''; } }
async function apiFetchJSON(path, opts) {
  const token = getAuthToken();
  const headers = Object.assign({}, (opts && opts.headers) || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API_BASE + path, { ...(opts||{}), headers });
  if (r.status === 401) { location.href = './login.html'; throw new Error('unauthorized'); }
  if (!r.ok) {
    let data = null;
    try { data = await r.json(); } catch {}
    const err = new Error(data?.error || 'network_error');
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return await r.json();
}
async function loadLedgerFromServer(preserveScroll = false) {
  try {
    const list = await apiFetchJSON('/api/ledger');
    if (Array.isArray(list)) {
      records.splice(0, records.length, ...list.map(r => {
        const createdRaw = Number(r.created_at);
        const createdAt = Number.isFinite(createdRaw) && createdRaw > 0 ? createdRaw : (Date.parse(r.date_time || r.date || '') || Date.now());
        return {
          id: r.id,
          type: r.type || '',
          category: r.category || '',
          doc: r.doc || '',
          client: r.client || '',
          amount: Number(r.amount || 0),
          method: r.method || '',
          file: r.file || '',
          fileUrl: (r.file && r.file.startsWith('/')) ? r.file : '',
          fileName: r.file ? r.file.split('/').pop() : '',
          notes: r.notes || '',
          date: r.date || '',
          dateTime: r.date_time || '',
          createdAt,
          createdBy: r.created_by || '',
          confirmedBy: r.confirmed_by || '',
          confirmed: r.confirmed !== false,
          entry: '手动'
        };
      }));
      saveJSON('records', records);
      applyFilters(preserveScroll);
      const hm = document.getElementById('page-home');
      if (hm && hm.style.display === 'block') {
      renderHomeChart(homePeriodSel?.value || 'month');
      renderSalesChart(salesPeriodSel?.value || 'month');
    }
    }
  } catch {}
}
async function loadPayablesFromServer() {
  try {
    const list = await apiFetchJSON('/api/payables');
    if (Array.isArray(list)) {
      payRecords.splice(0, payRecords.length, ...list.map(r => {
        const createdRaw = Number(r.created_at);
        const createdAt = Number.isFinite(createdRaw) && createdRaw > 0 ? createdRaw : (Date.parse(r.date || '') || Date.now());
        return normalizePayRecordAttachment({
          id: r.id,
          type: r.type, partner: r.partner, doc: r.doc, sales: r.sales,
          amount: Number(r.amount||0), paid: Number(r.paid||0),
          trustDays: r.trust_days ?? null, notes: r.notes || '',
          date: r.date || '', settled: !!r.settled, history: r.history || [],
          createdAt, invoiceNo: r.invoice_no || '',
          invoiceDate: r.invoice_date || '', invoiceAmount: Number(r.invoice_amount||0),
          file: r.file || '',
          fileUrl: r.file || r.file_url || r.attachment || '',
          file_url: r.file_url || '',
          attachment: r.attachment || '',
          attachmentUrl: r.attachmentUrl || r.attachment_url || '',
          fileName: r.file ? r.file.split('/').pop() : '',
          source: r.source || 'import', batchAt: r.batch_at || 0, batchOrder: r.batch_order ?? 0,
          confirmed: r.confirmed !== false,
          confirmedBy: r.confirmed_by || '',
          confirmedAt: r.confirmed_at || ''
        });
      }));
      saveJSON('payRecords', payRecords);
      renderPayables();
    }
  } catch {}
}
async function loadAllContacts() {
  await Promise.all([
    apiContactsList('customers', '', 1, 5000),
    apiContactsList('merchants', '', 1, 5000),
    apiContactsList('others', '', 1, 5000)
  ]);
  contactsLoaded = true;
}
function hasPlaceholderContacts() {
  return !!(
    contactsData.customers?.some(x => x.name === '客户A') ||
    contactsData.merchants?.some(x => x.name === '商家A') ||
    contactsData.others?.some(x => x.name === '单位A')
  );
}
async function ensureRealContactsLoaded() {
  if (contactsLoaded && !hasPlaceholderContacts()) return;
  await loadAllContacts();
}
async function apiContactsList(tab, q, page, size) {
  try {
    const params = new URLSearchParams({ tab: tab||'customers', q: q||'', page: String(page||1), size: String(size||100) });
    const list = await apiFetchJSON('/api/contacts?' + params.toString());
    const key = tab==='merchants'?'merchants':(tab==='others'?'others':'customers');
    if (Array.isArray(list)) contactsData[key] = list.map(x => ({
      id: x.id,
      name:x.name, contact:x.contact, phone:x.phone, city:x.city, remark:x.remark, owner:x.owner, created:x.created,
      company:x.company, code:x.code, country:x.country, address:x.address, zip:x.zip, sales:x.sales,
      use_price: x.use_price, is_iva: x.is_iva,
      invoice_nota: x.invoice_nota,
      email: x.email, province: x.province,
      ship_address: x.ship_address, ship_zip: x.ship_zip, ship_city: x.ship_city,
      ship_province: x.ship_province, ship_country: x.ship_country,
      ship_phone: x.ship_phone, ship_contact: x.ship_contact
    }));
    contactsLoaded = true;
  } catch {}
}
async function apiContactsCreate(obj) {
  const r = await apiFetchJSON('/api/contacts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) });
  return r.id;
}
async function apiContactsUpdateById(id, obj) {
  await apiFetchJSON('/api/contacts/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) });
}
async function apiContactsDeleteByName(owner, name) {
  try {
    const params = new URLSearchParams({ owner, name });
    const r = await fetch(API_BASE + '/api/contacts/by-name?' + params.toString(), { method:'DELETE' });
    return r.ok;
  } catch { return false; }
}
function ownerLabelOfTab(tab) {
  return tab==='merchants' ? '商家' : (tab==='others' ? '其它' : '客户');
}
async function apiAccountsList() {
  try {
    const list = await apiFetchJSON('/api/accounts');
    if (Array.isArray(list)) {
      accountsData.splice(0, accountsData.length, ...list.map(x => ({ name:x.name, balance:Number(x.balance||0), desc:x.desc||'', created:x.created||'', initialSet: !!x.initial_set })));
    }
  } catch {}
}
async function apiAccountCreate(obj) {
  try { await apiFetchJSON('/api/accounts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) }); } catch {}
}
async function apiAccountUpdateByName(obj) {
  try { await apiFetchJSON('/api/accounts/by-name', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) }); } catch {}
}
async function apiAccountInit(name, amount) {
  try { await apiFetchJSON('/api/accounts/init', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, amount }) }); } catch {}
}
async function apiAccountDeleteByName(name) {
  try {
    const params = new URLSearchParams({ name });
    const r = await fetch(API_BASE + '/api/accounts/by-name?' + params.toString(), { method:'DELETE' });
    return r.ok;
  } catch { return false; }
}
async function apiCategoriesList() {
  try {
    const list = await apiFetchJSON('/api/categories');
    if (Array.isArray(list)) {
      categoriesData.splice(0, categoriesData.length, ...list.map(x => ({ name: x.name, children: Array.isArray(x.children) ? x.children : [] })));
    }
  } catch {}
}
async function apiCategoriesSave() {
  try {
    await apiFetchJSON('/api/categories', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ list: categoriesData }) });
  } catch {}
}
async function apiSalesList(q) {
  try {
    const params = new URLSearchParams({ q: q||'' });
    const list = await apiFetchJSON('/api/sales?' + params.toString());
    if (Array.isArray(list)) {
      salesData.splice(0, salesData.length, ...list.map(x => ({ id:x.id, name:x.name, region:x.region||'', phone:x.phone||'', base:Number(x.base||0), rate:Number(x.rate||0), commission:Number(x.commission||0), created:x.created||'' })));
    }
  } catch {}
}
async function apiSalesCreate(obj) {
  try { const r = await apiFetchJSON('/api/sales', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) }); return r?.id; } catch { return null; }
}
async function apiSalesUpdate(id, obj) {
  try { await apiFetchJSON('/api/sales/' + String(id||0), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) }); } catch {}
}
async function apiSalesDelete(id) {
  try { const r = await fetch(API_BASE + '/api/sales/' + String(id||0), { method:'DELETE' }); return r.ok; } catch { return false; }
}
async function apiUsersList() {
  try {
    const list = await apiFetchJSON('/api/users');
    if (Array.isArray(list)) userAccounts.splice(0, userAccounts.length, ...list.map(u => ({ id:u.id, name:u.name, role:u.role||'', created:u.created||'', enabled: !!u.enabled })));
  } catch {}
}
async function apiUserCreate(obj) {
  try { const r = await apiFetchJSON('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) }); return r?.id; } catch { return null; }
}
async function apiUserUpdate(id, obj) {
  try {
    await apiFetchJSON('/api/users/'+String(id), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj) });
    return true;
  } catch {
    return false;
  }
}
async function apiUserDelete(id) {
  try { await apiFetchJSON('/api/users/'+String(id), { method:'DELETE' }); return true; } catch { return false; }
}
async function apiUserResetPassword(id, password) {
  try { await apiFetchJSON('/api/users/'+String(id)+'/reset-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password }) }); } catch {}
}
const logoutModal = document.getElementById('logout-modal');
const logoutCancel = document.getElementById('logout-cancel');
const logoutOk = document.getElementById('logout-ok');
const resetModal = document.getElementById('reset-modal');
const resetMsg = document.getElementById('reset-msg');
const resetCancel = document.getElementById('reset-cancel');
const resetOk = document.getElementById('reset-ok');
let pendingResetUser = null;
logoutBtn?.addEventListener('click', () => {
  logoutModal.style.display = 'flex';
});
authUserTag?.addEventListener('click', () => {
  const u = getAuthUser();
  const cpUser = document.getElementById('cp-user');
  const oldEl = document.getElementById('cp-old');
  const n1 = document.getElementById('cp-new1');
  const n2 = document.getElementById('cp-new2');
  if (cpUser) cpUser.textContent = u?.name || '';
  if (oldEl) oldEl.value = '';
  if (n1) n1.value = '';
  if (n2) n2.value = '';
  document.getElementById('change-pwd-modal').style.display = 'flex';
});
logoutCancel?.addEventListener('click', () => {
  logoutModal.style.display = 'none';
});
logoutOk?.addEventListener('click', () => {
  logoutModal.style.display = 'none';
  setAuthUser(null);
  localStorage.removeItem('authToken');
  location.href = './login.html';
});
resetCancel?.addEventListener('click', () => {
  resetModal.style.display = 'none';
  pendingResetUser = null;
});
resetOk?.addEventListener('click', async () => {
  if (pendingResetUser) {
    await apiUserResetPassword(pendingResetUser.id, '111111');
    await apiUsersList();
    apiUsersList().then(() => renderUserAccounts());
  }
  resetModal.style.display = 'none';
  pendingResetUser = null;
});
const cpCancel = document.getElementById('cp-cancel');
const cpOk = document.getElementById('cp-ok');
cpCancel?.addEventListener('click', () => {
  document.getElementById('change-pwd-modal').style.display = 'none';
});
cpOk?.addEventListener('click', async () => {
  const u = getAuthUser();
  const name = u?.name || '';
  const old = document.getElementById('cp-old').value || '';
  const n1 = document.getElementById('cp-new1').value || '';
  const n2 = document.getElementById('cp-new2').value || '';
  if (!name || !old || !n1 || !n2) return;
  if (n1 !== n2) { alert('两次输入的新密码不一致'); return; }
  
  try {
    const res = await fetchWithAuth('/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: old, newPassword: n1 })
    });
    if (!res.ok) {
      const data = await res.json();
      if (data.error === 'bad_credentials') {
        alert('当前密码不正确');
      } else {
        alert('修改失败');
      }
      return;
    }
    document.getElementById('change-pwd-modal').style.display = 'none';
    alert('修改密码成功');
  } catch (err) {
    alert('修改失败，请检查网络');
  }
});
function tsOf(rec) {
  const ts = Date.parse(rec.date || rec.dateTime || '') || rec.createdAt;
  return isNaN(ts) ? Date.now() : ts;
}
function formatLabel(ts, mode) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  if (mode === 'year') return String(y);
  if (mode === 'month') return `${y}-${m}`;
  return `${m}-${dd}`;
}
function buckets(mode) {
  const now = new Date();
  const list = [];
  if (mode === 'year') {
    for (let i=11;i>=0;i--) { const y = now.getFullYear() - i; list.push({ key: String(y), start: new Date(y,0,1).getTime(), end: new Date(y,11,31,23,59,59).getTime() }); }
  } else if (mode === 'day') {
    for (let i=29;i>=0;i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()-i); const s=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); const e=s+24*3600*1000-1; list.push({ key: formatLabel(s,'day'), start:s, end:e }); }
  } else {
    for (let i=11;i>=0;i--) { const d = new Date(now.getFullYear(), now.getMonth()-i, 1); const s=d.getTime(); const e=new Date(d.getFullYear(), d.getMonth()+1, 1).getTime()-1; list.push({ key: formatLabel(s,'month'), start:s, end:e }); }
  }
  return list;
}
async function renderHomeChart(mode='month') {
  if (!homeChartRows) return;
  let data = [];
  try {
    const range = mode==='day' ? 30 : 12;
    let baseDate = '';
    if (mode === 'month') baseDate = homeMonthPicker?.value || '';
    if (mode === 'year') baseDate = homeYearPicker?.value || '';
    
    data = await apiFetchJSON(`/api/analytics/ledger-summary?period=${mode}&range=${range}&baseDate=${encodeURIComponent(baseDate)}`);
  } catch {
    return;
  }
  const maxVal = Math.max(1, ...data.map(x => Math.max(x.income, x.expense)));
  const h = 220;
  homeChartRows.innerHTML = '';
  data.forEach(x => {
    const col = document.createElement('div');
    col.style.display='flex'; col.style.flexDirection='column'; col.style.alignItems='center'; col.style.gap='8px';
    const bars = document.createElement('div');
    bars.style.display='flex'; bars.style.gap='4px'; bars.style.alignItems='flex-end';
    const mkBar = (val,color) => {
      const b = document.createElement('div');
      const pixelHeight = val > 0 ? Math.max(2, Math.round(h * val / maxVal)) : 0;
      b.style.width='14px'; b.style.height=pixelHeight+'px';
      b.style.background=color; b.style.border='1px solid #334155'; b.style.borderRadius='4px';
      const tag = document.createElement('div');
      tag.textContent = (val||0).toFixed(2);
      tag.style.color='#cbd5e1'; tag.style.fontSize='10px'; tag.style.textAlign='center'; tag.style.whiteSpace='nowrap';
      tag.style.marginBottom='4px';
      const wrap = document.createElement('div');
      wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.alignItems='center'; wrap.style.margin='0'; wrap.style.padding='0'; wrap.style.minWidth='35px';
      if (val > 0) wrap.appendChild(tag); 
      wrap.appendChild(b);
      return wrap;
    };
    bars.appendChild(mkBar(x.income,'#16a34a'));
    bars.appendChild(mkBar(x.expense,'#f59e0b'));
    const labelWrap = document.createElement('div');
    labelWrap.style.display = 'flex'; labelWrap.style.flexDirection = 'column'; labelWrap.style.alignItems = 'center'; labelWrap.style.gap = '2px';
    const label = document.createElement('div'); label.textContent = x.label; label.style.color='#94a3b8'; label.style.fontSize='12px';
    
    const profitVal = (x.income || 0) - (x.expense || 0);
    const profit = document.createElement('div');
    profit.textContent = profitVal.toFixed(2);
    profit.style.fontSize = '11px';
    profit.style.fontWeight = 'bold';
    profit.style.color = profitVal >= 0 ? '#16a34a' : '#ef4444'; // green if >= 0, red if negative
    
    labelWrap.appendChild(label);
    labelWrap.appendChild(profit);
    col.appendChild(bars); col.appendChild(labelWrap);
    homeChartRows.appendChild(col);
  });
}
const homeMonthPicker = document.getElementById('home-month-picker');
const homeYearPicker = document.getElementById('home-year-picker');

function updateHomePeriodUI() {
  const v = homePeriodSel?.value || 'month';
  if (v === 'month') {
    if(homeMonthPicker) homeMonthPicker.style.display = 'block';
    if(homeYearPicker) homeYearPicker.style.display = 'none';
  } else if (v === 'year') {
    if(homeMonthPicker) homeMonthPicker.style.display = 'none';
    if(homeYearPicker) homeYearPicker.style.display = 'block';
  } else {
    if(homeMonthPicker) homeMonthPicker.style.display = 'none';
    if(homeYearPicker) homeYearPicker.style.display = 'none';
  }
}

// Initial setup
setTimeout(() => updateHomePeriodUI(), 100);

homePeriodSel?.addEventListener('change', () => { 
  updateHomePeriodUI();
  const v=homePeriodSel.value||'month'; 
  renderHomeChart(v); 
});

homeMonthPicker?.addEventListener('change', () => {
  if (homePeriodSel.value === 'month') renderHomeChart('month');
});

homeYearPicker?.addEventListener('change', () => {
  if (homePeriodSel.value === 'year') renderHomeChart('year');
});

const salesMonthPicker = document.getElementById('sales-month-picker');
const salesYearPicker = document.getElementById('sales-year-picker');

function updateSalesPeriodUI() {
  const v = salesPeriodSel?.value || 'month';
  if (v === 'month') {
    if(salesMonthPicker) salesMonthPicker.style.display = 'block';
    if(salesYearPicker) salesYearPicker.style.display = 'none';
  } else if (v === 'year') {
    if(salesMonthPicker) salesMonthPicker.style.display = 'none';
    if(salesYearPicker) salesYearPicker.style.display = 'block';
  } else {
    if(salesMonthPicker) salesMonthPicker.style.display = 'none';
    if(salesYearPicker) salesYearPicker.style.display = 'none';
  }
}

// Initial setup
setTimeout(() => updateSalesPeriodUI(), 100);

salesPeriodSel?.addEventListener('change', () => { 
  updateSalesPeriodUI();
  const v=salesPeriodSel.value||'month'; 
  renderSalesChart(v); 
});

salesMonthPicker?.addEventListener('change', () => {
  if (salesPeriodSel.value === 'month') renderSalesChart('month');
});

salesYearPicker?.addEventListener('change', () => {
  if (salesPeriodSel.value === 'year') renderSalesChart('year');
});

async function renderSalesChart(mode='month') {
  if (!salesChartSvg) return;
  let data = [];
  try {
    const range = mode==='day' ? 30 : 12;
    let baseDate = '';
    if (mode === 'month') baseDate = salesMonthPicker?.value || '';
    if (mode === 'year') baseDate = salesYearPicker?.value || '';
    
    data = await apiFetchJSON(`/api/analytics/sales-summary?period=${mode}&range=${range}&baseDate=${encodeURIComponent(baseDate)}`);
  } catch {
    return;
  }
  
  const svg = salesChartSvg;
  svg.innerHTML = '';
  if (!data || data.length === 0) return;
  
  // ensure container has width
  const w = Math.max(600, svg.clientWidth || 800);
  const h = svg.clientHeight || 300;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  
  const padding = { top: 40, right: 40, bottom: 40, left: 40 };
  const innerW = w - padding.left - padding.right;
  const innerH = h - padding.top - padding.bottom;
  
  const maxVal = Math.max(1, ...data.map(d => d.amount));
  
  const stepX = innerW / Math.max(1, data.length - 1);
  
  let points = [];
  data.forEach((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + innerH - (d.amount / maxVal) * innerH;
    points.push(`${x},${y}`);
  });
  
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', points.join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', '#3b82f6');
  polyline.setAttribute('stroke-width', '3');
  svg.appendChild(polyline);
  
  data.forEach((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + innerH - (d.amount / maxVal) * innerH;
    
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '5');
    circle.setAttribute('fill', '#111827');
    circle.setAttribute('stroke', '#3b82f6');
    circle.setAttribute('stroke-width', '2');
    svg.appendChild(circle);
    
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y - 12);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#e2e8f0');
    text.setAttribute('font-size', '12px');
    text.textContent = d.amount.toFixed(2);
    svg.appendChild(text);
    
    const xText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xText.setAttribute('x', x);
    xText.setAttribute('y', h - 10);
    xText.setAttribute('text-anchor', 'middle');
    xText.setAttribute('fill', '#94a3b8');
    xText.setAttribute('font-size', '12px');
    xText.textContent = d.label;
    svg.appendChild(xText);
  });
}


// Sales Order UI Logic
const soCustomer = document.getElementById('so-customer');
const soCustomerRemark = document.getElementById('so-customer-remark');
const soCustomerDD = document.getElementById('so-customer-dd');
const soCustomerList = document.getElementById('so-customer-list');
let currentSoCustomer = null;
const soCustomerSearch = document.getElementById('so-customer-search');
const soDate = document.getElementById('so-date');
const soTrust = document.getElementById('so-trust');
const soInvoiceNo = document.getElementById('so-invoice-no');
const soNotes = document.getElementById('so-notes');
const soAddItem = document.getElementById('so-add-item');
const soItems = document.getElementById('so-items');
const soTotal = document.getElementById('so-total');
const soSave = document.getElementById('so-save');
const invRows = document.getElementById('inv-rows');
const invSearch = document.getElementById('inv-search');
const invRefresh = document.getElementById('inv-refresh');
const invPager = document.getElementById('inv-pager');

if (soDate && !soDate.value) soDate.valueAsDate = new Date();

// Fetch next invoice number
async function loadNextInvoiceNo() {
  if (!soInvoiceNo) return;
  try {
    const res = await fetchWithAuth('/api/invoices/next-no');
    if (res.ok) {
      const data = await res.json();
      soInvoiceNo.textContent = data.nextNo;
      soInvoiceNo.dataset.nextNo = data.nextNo;
    }
  } catch {}
}

function renderSoCustomerDropdown() {
  if (!soCustomerList) return;
  const q = (soCustomerSearch?.value || soCustomer.value || '').trim().toLowerCase();
  const all = [
    ...(contactsData.customers||[]),
    ...(contactsData.merchants||[]),
    ...(contactsData.others||[])
  ].filter(x => {
    if (!q) return true;
    return [x.name, x.company, x.contact, x.phone, x.city, (x.remark||'')].some(v => String(v||'').toLowerCase().includes(q));
  });
  
  soCustomerList.innerHTML = '';
  if (all.length === 0) {
    const div = document.createElement('div');
    div.className = 'dd-item';
    div.textContent = '无匹配结果';
    div.style.color = '#94a3b8';
    soCustomerList.appendChild(div);
    return;
  }
  
  all.forEach(item => {
    const div = document.createElement('div');
    div.className = 'dd-item';
    
    const left = document.createElement('div');
    left.textContent = item.name;
    
    const right = document.createElement('div');
    right.style.color = '#94a3b8';
    right.style.fontSize = '12px';
    right.textContent = `${item.contact || ''} ${item.phone || ''} ${item.city || ''}`.trim();
    
    div.append(left, right);
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    
    div.addEventListener('click', () => {
      soCustomer.value = item.name;
      currentSoCustomer = item;
      if (soCustomerRemark) soCustomerRemark.textContent = item.remark || '';
      // Update Use Price
      if (soUsePrice) {
        const p = item.use_price || 'price1';
        const map = { price1:'价格1', price2:'价格2', price3:'价格3', price4:'价格4' };
        soUsePrice.value = map[p] || p;
      }
      // New Logic for Salesperson
      if (soSales) {
        if (item.sales) {
          soSales.value = item.sales;
          soSales.disabled = true;
        } else {
          soSales.value = '';
          soSales.disabled = false;
        }
      }
      soCustomerDD.style.display = 'none';
    });
    soCustomerList.appendChild(div);
  });
}

function openSoCustomerDropdown() {
  if (!soCustomerDD) return;
  // Position logic (mimic Payables but adapted for single card)
  // Since we are in a single card, popping to the left is risky if sidebar is there.
  // But let's try to position it intelligently.
  // For now, standard dropdown behavior (below input) but wider?
  // The user asked for "left popup".
  // If I use fixed position relative to the input, I can place it anywhere.
  
  const rect = soCustomer.getBoundingClientRect();
  // If we want it on the left of the input:
  // left = rect.left - width - gap
  // Check if there is space: rect.left is roughly 240+24+padding.
  // If dropdown width is e.g. 280px.
  // 240+24 = 264. So there is ~260px space? Tight.
  
  // Let's stick to standard dropdown for now but ensure it works well.
  // Or maybe the user means "align left"?
  // "左边要弹出一个弹窗" -> "Pop up a window on the left".
  
  soCustomerDD.style.display = 'block';
  renderSoCustomerDropdown();
}

if (soCustomer) {
  soCustomer.addEventListener('focus', openSoCustomerDropdown);
  soCustomer.addEventListener('click', openSoCustomerDropdown);
  soCustomer.addEventListener('input', () => {
    openSoCustomerDropdown();
    renderSoCustomerDropdown();
    if (soCustomerRemark) soCustomerRemark.textContent = '';
  });
  document.addEventListener('click', e => {
    if (!soCustomer.contains(e.target) && !soCustomerDD.contains(e.target)) {
      soCustomerDD.style.display = 'none';
    }
  });
}
if (soCustomerSearch) {
  soCustomerSearch.addEventListener('input', renderSoCustomerDropdown);
}

function updateSoTotal() {
  if (!soItems || !soTotal) return;
  let subtotal = 0;
  let totalTax = 0;
  
  Array.from(soItems.children).forEach(tr => {
    const qty = parseFloat(tr.querySelector('.qty').value)||0;
    const price = parseFloat(tr.querySelector('.price').value)||0;
    const amt = qty * price;
    
    // Calculate Tax
    let taxRate = parseFloat(tr.dataset.taxRate);
    if (isNaN(taxRate)) taxRate = 0.10;
    if (taxRate >= 1) taxRate = taxRate / 100;
    
    const taxAmt = amt * taxRate;
    
    tr.querySelector('.iva-amt').textContent = taxAmt.toFixed(2);
    tr.querySelector('.amt').textContent = amt.toFixed(2);
    
    subtotal += amt;
    totalTax += taxAmt;
  });
  
  const grandTotal = subtotal + totalTax;
  
  const soSubtotal = document.getElementById('so-subtotal');
  const soTax = document.getElementById('so-tax');
  
  if (soSubtotal) soSubtotal.textContent = subtotal.toFixed(2);
  if (soTax) soTax.textContent = totalTax.toFixed(2);
  soTotal.textContent = grandTotal.toFixed(2) + '€';
}

const soSales = document.getElementById('so-sales');
const soUsePrice = document.getElementById('so-use-price');
const editSales = document.getElementById('edit-sales');
const editUsePrice = document.getElementById('edit-use-price');
const ctSales = document.getElementById('ct-sales');
// paySales already defined above

async function loadSalesPeople() {
  await apiSalesList(); // Ensure salesData is loaded
  renderSalesPeopleOptions();
}

function renderSalesPeopleOptions() {
  const opts = '<option value="">请选择业务员</option>' + 
    salesData.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  
  [soSales, editSales, ctSales, paySales].forEach(el => {
    if (el) {
      const val = el.value;
      el.innerHTML = opts;
      el.value = val; // Restore value if possible
    }
  });
}

// Product Selector Logic
const prodSelModal = document.getElementById('prod-selector-modal');
const prodSelSearch = document.getElementById('prod-sel-search');
const prodSelList = document.getElementById('prod-sel-list');
const prodSelClose = document.getElementById('prod-sel-close');

let prodSelPage = 1;
const prodSelPageSize = 50;
let prodSelTotal = 0;

function getActiveProductSelectorCustomer() {
  if (editModal && editModal.style.display === 'flex' && currentEditCustomer) return currentEditCustomer;
  if (currentSoCustomer) return currentSoCustomer;
  if (!currentSoCustomer && soCustomer?.value) {
    const all = [
      ...(contactsData.customers||[]),
      ...(contactsData.merchants||[]),
      ...(contactsData.others||[])
    ];
    currentSoCustomer = all.find(c => c.name === soCustomer.value);
    return currentSoCustomer || null;
  }
  return null;
}

function getProductPriceByCustomer(prod, customer) {
  const tier = customer?.use_price || 'price1';
  if (prod && prod[tier] !== undefined && prod[tier] !== null && prod[tier] !== '') return Number(prod[tier] || 0);
  return Number(prod?.price1 || prod?.price || 0);
}

async function loadProductSelector(page = 1) {
  if (!prodSelList) return;
  prodSelPage = page;
  const q = (prodSelSearch?.value || '').trim();
  const res = await fetchWithAuth(`/api/products?page=${prodSelPage}&size=${prodSelPageSize}&q=${encodeURIComponent(q)}`);
  if (res.ok) {
    const data = await res.json();
    prodSelTotal = data.total || 0;
    renderProductSelector(data.list || []);
  }
}

function renderProductSelector(list) {
  prodSelList.innerHTML = '';
  if (list.length === 0) {
    prodSelList.innerHTML = '<div style="color:#94a3b8; grid-column:1/-1; text-align:center; padding:20px">无匹配商品</div>';
    return;
  }
  
  // Sort list by sku (numeric)
  list.sort((a,b) => {
    const na = parseInt(a.sku||'0', 10);
    const nb = parseInt(b.sku||'0', 10);
    return na - nb;
  });
  
  // Determine customer tier
  let usePrice = 'price1';
  const activeCustomer = getActiveProductSelectorCustomer();
  if (activeCustomer && activeCustomer.use_price) usePrice = activeCustomer.use_price;

  // Create Table Structure
  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.innerHTML = `
    <thead>
      <tr style="border-bottom:1px solid #334155; color:#94a3b8; font-size:12px; text-align:left">
        <th style="padding:8px; width:40px; text-align:center"><input type="checkbox" id="prod-sel-select-all" onclick="toggleAllProdSelection(this)"></th>
        <th style="padding:8px">图片</th>
        <th style="padding:8px">编号</th>
        <th style="padding:8px">名称</th>
        <th style="padding:8px">中文名称</th>
        <th style="padding:8px">规格</th>
        <th style="padding:8px; text-align:right">价格</th>
        <th style="padding:8px; text-align:right">库存</th>
      </tr>
    </thead>
    <tbody id="prod-sel-tbody"></tbody>
  `;
  const tbody = table.querySelector('tbody');

  list.forEach(p => {
    // Determine display price
    let displayPrice = Number(p.price1 || 0);
    if (p[usePrice] !== undefined && p[usePrice] !== null && p[usePrice] !== '') {
      displayPrice = Number(p[usePrice]);
    }

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #1e293b';
    tr.style.cursor = 'pointer';
    tr.onmouseover = () => tr.style.background = '#1e293b';
    tr.onmouseout = () => tr.style.background = 'transparent';
    
    // Check if already selected in global set
    const isSelected = window.selectedProducts && window.selectedProducts.has(p.id);
    
    tr.innerHTML = `
      <td style="padding:8px; text-align:center">
        <input type="checkbox" class="prod-sel-checkbox" value="${p.id}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleProdSelection(${p.id})">
      </td>
      <td style="padding:8px">
        ${p.image ? `<img src="${p.image}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; border:1px solid #334155">` : '<div style="width:48px; height:48px; background:#0f172a; border-radius:4px; border:1px solid #334155"></div>'}
      </td>
      <td style="padding:8px; color:#94a3b8">${p.sku||''}</td>
      <td style="padding:8px; color:#e2e8f0; font-weight:500">${p.name}</td>
      <td style="padding:8px; color:#94a3b8">${p.name_cn||''}</td>
      <td style="padding:8px; color:#94a3b8">${p.spec||''}</td>
      <td style="padding:8px; text-align:right; color:var(--blue); font-weight:600">€${displayPrice.toFixed(2)}</td>
      <td style="padding:8px; text-align:right; color:#64748b">${Number(p.stock||0)}</td>
    `;
    
    // Store product data on the row for easy access
    tr.dataset.prod = JSON.stringify(p);
    
    // Click row to toggle selection
    tr.addEventListener('click', (e) => {
      if (e.target.tagName.toLowerCase() !== 'input') {
        const cb = tr.querySelector('.prod-sel-checkbox');
        cb.checked = !cb.checked;
        toggleProdSelection(p.id, p);
      }
    });
    
    tbody.appendChild(tr);
  });
  
  prodSelList.style.display = 'block'; // Ensure it's not grid
  prodSelList.appendChild(table);
  
  // Render Pager
  const totalPages = Math.ceil(prodSelTotal / prodSelPageSize);
  if (totalPages > 1) {
    const pager = document.createElement('div');
    pager.style.display = 'flex';
    pager.style.justifyContent = 'center';
    pager.style.gap = '12px';
    pager.style.alignItems = 'center';
    pager.style.padding = '12px 0';
    pager.style.marginTop = '12px';
    pager.style.borderTop = '1px solid #334155';
    
    pager.innerHTML = `
      <button class="btn-secondary" style="padding:4px 12px" ${prodSelPage <= 1 ? 'disabled' : ''} onclick="loadProductSelector(${prodSelPage - 1})">上一页</button>
      <span style="color:#cbd5e1; font-size:13px">第 ${prodSelPage} / ${totalPages} 页</span>
      <button class="btn-secondary" style="padding:4px 12px" ${prodSelPage >= totalPages ? 'disabled' : ''} onclick="loadProductSelector(${prodSelPage + 1})">下一页</button>
    `;
    prodSelList.appendChild(pager);
  }

  // Update select all checkbox state
  updateSelectAllCheckbox();
}

// Multi-select product logic
window.selectedProducts = new Map();

window.toggleProdSelection = function(id, prodObj) {
  if (!prodObj) {
    // If clicked from checkbox directly, we need to find the prod obj from the row dataset
    const cb = document.querySelector(`.prod-sel-checkbox[value="${id}"]`);
    if (cb && cb.closest('tr')) {
      prodObj = JSON.parse(cb.closest('tr').dataset.prod);
      if (!cb.checked) {
        window.selectedProducts.delete(id);
      } else {
        window.selectedProducts.set(id, prodObj);
      }
    }
  } else {
    // Clicked from row
    const cb = document.querySelector(`.prod-sel-checkbox[value="${id}"]`);
    if (cb) {
      if (cb.checked) {
        window.selectedProducts.set(id, prodObj);
      } else {
        window.selectedProducts.delete(id);
      }
    }
  }
  updateSelectAllCheckbox();
};

window.toggleAllProdSelection = function(el) {
  const checkboxes = document.querySelectorAll('.prod-sel-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = el.checked;
    const id = parseInt(cb.value, 10);
    const prodObj = JSON.parse(cb.closest('tr').dataset.prod);
    if (el.checked) {
      window.selectedProducts.set(id, prodObj);
    } else {
      window.selectedProducts.delete(id);
    }
  });
};

function updateSelectAllCheckbox() {
  const selectAllCb = document.getElementById('prod-sel-select-all');
  const checkboxes = document.querySelectorAll('.prod-sel-checkbox');
  if (selectAllCb && checkboxes.length > 0) {
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    selectAllCb.checked = allChecked;
  }
}

window.confirmProductSelection = function() {
  if (window.selectedProducts.size === 0) {
    alert('请先选择至少一个商品');
    return;
  }
  
  const selectedArray = Array.from(window.selectedProducts.values());
  
  if (typeof window.onProdSelect === 'function') {
    // Call the callback with the array, or loop if it only supports single
    // For safety, we loop through them to support existing single-item handlers
    // But we need to close the modal ourselves since the handler might not
    selectedArray.forEach(p => {
      window.onProdSelect(p, true); // true indicates it's part of a batch
    });
    prodSelModal.style.display = 'none';
    if (typeof window.onProdSelectDone === 'function') window.onProdSelectDone(selectedArray);
  } else {
    // Default fallback for Sales Invoice
    selectedArray.forEach(p => {
      addSoItem(p);
    });
    prodSelModal.style.display = 'none';
  }
};

if (soAddItem) {
  soAddItem.addEventListener('click', () => {
    if (!soCustomer.value.trim()) {
      alert('请先选择客户');
      return;
    }
    window.onProdSelect = null; // Clear any previous callbacks!
    window.selectedProducts.clear(); // Clear previous selections
    prodSelModal.style.display = 'flex';
    prodSelSearch.value = '';
    loadProductSelector();
  });
}
if (prodSelClose) {
  prodSelClose.addEventListener('click', () => {
    prodSelModal.style.display = 'none';
    window.onProdSelect = null;
  });
}
if (prodSelSearch) prodSelSearch.addEventListener('input', () => loadProductSelector());

function addSoItem(p) {
  // Determine Price
  let price = Number(p.price1 || 0);
  if (!currentSoCustomer && soCustomer.value) {
     // Try to find customer
     const all = [
      ...(contactsData.customers||[]),
      ...(contactsData.merchants||[]),
      ...(contactsData.others||[])
    ];
    currentSoCustomer = all.find(c => c.name === soCustomer.value);
  }
  
  if (currentSoCustomer) {
    const tier = currentSoCustomer.use_price || 'price1';
    // If p has price2, price3 etc. 
    // Assuming p structure has price1, price2, price3... based on product schema.
    // If not, fallback to price1.
    if (p[tier] !== undefined && p[tier] !== null && p[tier] !== '') {
      price = Number(p[tier]);
    }
  }

  // Determine Tax Rate
  let taxRate = 0.10; // Default 10%
  if (p.tax_rate !== undefined && p.tax_rate !== null && p.tax_rate !== '') {
    taxRate = Number(p.tax_rate);
    // Fix: if taxRate is percentage integer (e.g. 10, 21), convert to decimal
    if (taxRate >= 1) taxRate = taxRate / 100;
  }
  
  // "If Is IVA (true), add tax. If No (false), do NOT add tax."
  if (currentSoCustomer) {
    // Check if is_iva is false explicitly
    if (currentSoCustomer.is_iva === false) {
      taxRate = 0;
    }
  }

  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid #1e293b';
  tr.dataset.taxRate = taxRate; // Store tax rate
  tr.dataset.productId = p.id || '';
  tr.dataset.sku = p.sku || '';
  
  tr.innerHTML = `
    <td style="padding:10px 16px"><input type="text" class="name light-input" style="width:100%; background:transparent; border:none; color:#e2e8f0" value="${p.name}"></td>
    <td style="padding:10px 16px"><input type="text" class="name-cn light-input" style="width:100%; background:transparent; border:none; color:#94a3b8" value="${p.name_cn||''}" placeholder="中文名"></td>
    <td style="padding:10px 16px"><input type="text" class="desc light-input" style="width:100%; background:transparent; border:none; color:#94a3b8" value="${p.spec || p.description || ''}" placeholder="规格"></td>
    <td style="padding:10px 16px"><input type="number" class="qty light-input" style="width:100%; text-align:center; background:#0f172a; border:1px solid #334155" value="1" min="1"></td>
    <td style="padding:10px 16px"><input type="number" class="price light-input" style="width:100%; text-align:center; background:#0f172a; border:1px solid #334155" value="${price.toFixed(2)}" min="0" step="0.01"></td>
    <td class="iva-amt" style="padding:10px 16px; text-align:right; font-family:monospace; color:#94a3b8">0.00</td>
    <td class="amt" style="padding:10px 16px; text-align:right; font-family:monospace; color:#e2e8f0">${price.toFixed(2)}</td>
    <td style="padding:10px 16px; text-align:center"><button type="button" class="btn-red btn-icon" style="width:24px;height:24px;padding:0;font-size:12px">×</button></td>
  `;
  tr.querySelector('.btn-red').addEventListener('click', () => { tr.remove(); updateSoTotal(); });
  tr.querySelectorAll('input').forEach(i => {
    i.addEventListener('input', updateSoTotal);
    i.addEventListener('focus', function() { this.select(); });
  });
  soItems.appendChild(tr);
  updateSoTotal();
}

if (soSave) {
  soSave.addEventListener('click', async () => {
    const customer = (soCustomer.value||'').trim();
    if (!customer) { alert('请选择客户'); return; }
    const items = [];
    Array.from(soItems.children).forEach(tr => {
      const name = (tr.querySelector('.name').value||'').trim();
      const desc = (tr.querySelector('.desc').value||'').trim();
      const qty = parseFloat(tr.querySelector('.qty').value)||0;
      const price = parseFloat(tr.querySelector('.price').value)||0;
      // Get tax_rate from dataset
      let taxRate = parseFloat(tr.dataset.taxRate);
      if (isNaN(taxRate)) taxRate = 0.10; // Fallback
      if (taxRate >= 1) taxRate = taxRate / 100; // Safety fix for integer percentages
      
      const productId = tr.dataset.productId || '';
      const sku = tr.dataset.sku || '';
      if (name) items.push({ name, description: desc, qty, price, total: qty*price, tax_rate: taxRate, productId, sku });
    });
    if (items.length === 0) { alert('请至少添加一个商品'); return; }
    
    const editId = soInvoiceNo.dataset.id;
    let res;
    
    const sales = soSales ? soSales.value : '';

    if (editId) {
      // Update existing invoice
      res = await fetchWithAuth(`/api/invoices/${editId}`, {
        method: 'PUT',
        body: JSON.stringify({
          customer,
          date: soDate.value,
          items,
          notes: soNotes.value,
          sales,
          trust_days: parseInt(soTrust.value||'30', 10)
        })
      });
    } else {
      // Create new invoice
      res = await fetchWithAuth('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customer,
          date: soDate.value,
          items,
          notes: soNotes.value,
          sales,
          trust_days: parseInt(soTrust.value||'30', 10),
          invoice_no: soInvoiceNo.dataset.nextNo
        })
      });
    }

    if (res.ok) {
      alert(editId ? '订单已更新' : '订单已保存');
      soCustomer.value = '';
      if (soUsePrice) soUsePrice.value = '';
      soNotes.value = '';
      soItems.innerHTML = '';
      if (soSales) {
      soSales.value = '';
      soSales.disabled = false;
    }
    updateSoTotal();
      delete soInvoiceNo.dataset.id; // Clear edit mode
      loadNextInvoiceNo();
      location.hash = '#sales-invoice';
    } else {
      const err = await res.json().catch(()=>({}));
      if (err.error === 'cannot_edit_paid_invoice') {
        alert('无法修改：订单已全额付款');
      } else {
        alert('保存失败');
      }
    }
  });
}

  let invPage = 1;
  let invTotal = 0;
  const invPageSize = 100;
  let currentInvoices = [];

  function normalizeInvoiceCustomerText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[\s\-.,，。/()（）]/g, '');
  }
  function hasCompleteInvoiceCustomerInfo(contact) {
    if (!contact) return false;
    return !!(
      contact.company ||
      contact.code ||
      contact.address ||
      contact.zip ||
      contact.city ||
      contact.country ||
      contact.ship_address ||
      contact.ship_zip ||
      contact.ship_city ||
      contact.ship_country
    );
  }
  function findInvoiceCustomerContact(customerName) {
    const target = String(customerName || '').trim();
    const targetKey = normalizeInvoiceCustomerText(target);
    const allContacts = [
      ...(contactsData.customers || []),
      ...(contactsData.merchants || []),
      ...(contactsData.others || [])
    ];
    return allContacts.find(c => {
      const name = String(c.name || '').trim();
      const company = String(c.company || '').trim();
      const code = String(c.code || '').trim();
      const nameKey = normalizeInvoiceCustomerText(name);
      const companyKey = normalizeInvoiceCustomerText(company);
      const codeKey = normalizeInvoiceCustomerText(code);
      return name === target || company === target || code === target || (!!targetKey && (nameKey === targetKey || companyKey === targetKey || codeKey === targetKey));
    }) || null;
  }
  async function getInvoiceCustomerContact(customerName) {
    let contact = findInvoiceCustomerContact(customerName);
    if (hasCompleteInvoiceCustomerInfo(contact)) return contact;
    const q = String(customerName || '').trim();
    if (!q) return contact;
    for (const tab of ['customers', 'merchants', 'others']) {
      try {
        const list = await apiFetchJSON('/api/contacts?' + new URLSearchParams({ tab, q, page: '1', size: '50' }).toString());
        const arr = Array.isArray(list) ? list : [];
        if (arr.length) {
          const mapped = arr.map(x => ({
            id: x.id,
            name:x.name, contact:x.contact, phone:x.phone, city:x.city, remark:x.remark, owner:x.owner, created:x.created,
            company:x.company, code:x.code, country:x.country, address:x.address, zip:x.zip, sales:x.sales,
            use_price: x.use_price, is_iva: x.is_iva,
            invoice_nota: x.invoice_nota,
            email: x.email, province: x.province,
            ship_address: x.ship_address, ship_zip: x.ship_zip, ship_city: x.ship_city,
            ship_province: x.ship_province, ship_country: x.ship_country,
            ship_phone: x.ship_phone, ship_contact: x.ship_contact
          }));
          contactsData[tab] = mapped;
          contact = findInvoiceCustomerContact(customerName) || contact;
          if (hasCompleteInvoiceCustomerInfo(contact)) return contact;
        }
      } catch {}
    }
    return contact;
  }

  async function loadInvoices() {
    if (!invRows) return;
    const q = (invSearch?.value||'').trim();
    try { await ensureRealContactsLoaded(); } catch {}
    const res = await fetchWithAuth(`/api/invoices?page=${invPage}&size=${invPageSize}&q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data = await res.json();
      const list = data.list || [];
      invTotal = data.total || 0;
      currentInvoices = list;
      invRows.innerHTML = '';
      renderInvPager();
      
      if (list.length === 0) {
        invRows.innerHTML = '<tr class="empty"><td colspan="8">暂无发票数据</td></tr>';
        return;
      }
      list.forEach((x, i) => {
        const tr = document.createElement('tr');
        
        const total = Number(x.total_amount||0);
        const paid = Number(x.paid_amount||0);
        let status = '';
        let statusColor = '';
        
        if (paid >= total && total > 0) {
          status = '已付款';
          statusColor = '#10b981'; // Green
        } else if (paid > 0) {
          status = '部分付款';
          statusColor = '#f59e0b'; // Orange
        } else {
          status = '未付款';
          statusColor = '#ef4444'; // Red
        }
        
        // Fix: Ensure customer, date, total are displayed correctly
        // Some old data might have different field names or be empty
        const displayCustomer = x.customer || x.client || '-';
        const displayDate = x.date || x.invoice_date || '-';
        
        // Find company name
        let companyName = x.company_name || '-';
        const cust = findInvoiceCustomerContact(displayCustomer);
        if ((!companyName || companyName === '-') && cust?.company) companyName = cust.company;
        if ((!companyName || companyName === '-') && displayCustomer && displayCustomer !== '-') companyName = displayCustomer;
        const showCompanyName = companyName && companyName !== '-' && companyName !== displayCustomer;
        
        const isPaid = (paid >= total && total > 0);
        const editBtn = isPaid 
          ? `<button class="light-btn" style="font-size:12px; padding:4px 8px; opacity:0.5; cursor:not-allowed" title="已付款不可修改">修改</button>`
          : `<button class="light-btn" style="font-size:12px; padding:4px 8px" onclick="editInvoice('${x.id}')">修改</button>`;
        
        const shipBtnClass = x.shipping_printed ? 'light-btn' : 'light-btn btn-blue';
        const shipBtn = `<button class="${shipBtnClass}" style="font-size:12px; padding:4px 8px" onclick="printShippingLabel('${x.id}')">打印收货地址</button>`;
        
        const seq = invTotal - ((invPage - 1) * invPageSize + i);
        
        let remarkHtml = x.notes || '';
        if (cust && cust.remark) {
          if (remarkHtml) remarkHtml += '<br>';
          remarkHtml += `<span style="color:#eab308; font-size:11px">(${cust.remark})</span>`;
        }
        const deliveredHtml = x.delivered
          ? `<div style="display:flex; align-items:flex-start; gap:8px">
              <input type="checkbox" checked disabled style="margin-top:2px">
              <div style="font-size:12px; line-height:1.45">
                <div>${x.delivered_at || '-'}</div>
                <div style="color:#94a3b8; margin-top:2px">${x.delivered_by || '-'}</div>
              </div>
            </div>`
          : `<label style="display:inline-flex; align-items:center; justify-content:center; width:100%">
              <input type="checkbox" onchange="setInvoiceDelivered('${x.id}', this)">
            </label>`;

        tr.innerHTML = `
          <td>${seq}</td>
          <td>${x.invoice_no||''}</td>
          <td>
            <div>${displayCustomer}</div>
            ${showCompanyName ? `<div style="margin-top:2px; font-size:12px; color:#94a3b8">${companyName}</div>` : ''}
          </td>
          <td>${displayDate}</td>
          <td style="color:#e2e8f0; font-weight:600">€${total.toFixed(2)}</td>
          <td><span style="color:${statusColor}; background:${statusColor}20; padding:2px 8px; border-radius:4px; font-size:12px">${status}</span></td>
          <td style="color:#94a3b8; font-size:12px">${remarkHtml}</td>
          <td>${deliveredHtml}</td>
          <td style="display:flex; gap:8px; justify-content:center">
            <button class="light-btn" style="font-size:12px; padding:4px 8px" onclick="previewInvoice('${x.id}')">预览</button>
            ${shipBtn}
            ${editBtn}
          </td>
        `;
        invRows.appendChild(tr);
      });
    }
  }

  function renderInvPager() {
    if (!invPager) return;
    invPager.innerHTML = '';
    // Always show pager, even if only 1 page
    const totalPages = Math.max(1, Math.ceil(invTotal / invPageSize));
    
    const createBtn = (text, page, disabled=false) => {
      const btn = document.createElement('button');
      btn.className = 'light-btn';
      btn.textContent = text;
      btn.disabled = disabled;
      if (page === invPage) {
        btn.style.background = '#0b1524';
        btn.style.cursor = 'default';
      } else {
        btn.addEventListener('click', () => {
          invPage = page;
          loadInvoices();
        });
      }
      return btn;
    };
    
    invPager.appendChild(createBtn('上一页', invPage-1, invPage<=1));
    
    let start = Math.max(1, invPage - 2);
    let end = Math.min(totalPages, invPage + 2);
    
    if (start > 1) {
      invPager.appendChild(createBtn('1', 1));
      if (start > 2) {
        const span = document.createElement('span');
        span.textContent = '...';
        span.style.color = '#94a3b8';
        span.style.padding = '0 4px';
        invPager.appendChild(span);
      }
    }
    
    for (let i = start; i <= end; i++) {
      invPager.appendChild(createBtn(String(i), i));
    }
    
    if (end < totalPages) {
      if (end < totalPages - 1) {
        const span = document.createElement('span');
        span.textContent = '...';
        span.style.color = '#94a3b8';
        span.style.padding = '0 4px';
        invPager.appendChild(span);
      }
      invPager.appendChild(createBtn(String(totalPages), totalPages));
    }
    
    invPager.appendChild(createBtn('下一页', invPage+1, invPage>=totalPages));
  }

  window.setInvoiceDelivered = async function(id, checkboxEl) {
    if (!checkboxEl || !checkboxEl.checked) return;
    checkboxEl.disabled = true;
    try {
      const now = new Date();
      const deliveredAt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
      const res = await fetchWithAuth(`/api/invoices/${id}/delivered`, {
        method: 'PUT',
        body: JSON.stringify({ delivered_at: deliveredAt })
      });
      if (!res.ok) throw new Error('deliver_failed');
      await loadInvoices();
    } catch (_) {
      checkboxEl.checked = false;
      checkboxEl.disabled = false;
    }
  };


// Invoice Actions
const invPrevModal = document.getElementById('invoice-preview-modal');
const invPrevClose = document.getElementById('inv-prev-close');
const invPrevPrint = document.getElementById('inv-prev-print');
const invPaper = document.getElementById('invoice-paper');
const invPreviewShell = document.getElementById('invoice-preview-shell');
const invPreviewStage = document.getElementById('invoice-preview-stage');
let invoicePrintFrame = null;

function updateInvoicePreviewScale() {
  if (!invPrevModal || !invPaper || !invPreviewShell || !invPreviewStage) return;
  if (invPrevModal.style.display === 'none') return;
  invPaper.style.transform = 'scale(1)';
  invPreviewStage.style.width = 'auto';
  invPreviewStage.style.height = 'auto';
  const shellRect = invPreviewShell.getBoundingClientRect();
  const maxWidth = Math.max(320, shellRect.width - 8);
  const maxHeight = Math.max(400, window.innerHeight - 180);
  const baseWidth = invPaper.offsetWidth;
  const baseHeight = invPaper.offsetHeight;
  if (!baseWidth || !baseHeight) return;
  const scale = Math.min(maxWidth / baseWidth, maxHeight / baseHeight, 1);
  invPaper.style.transform = `scale(${scale})`;
  invPreviewStage.style.width = `${Math.ceil(baseWidth * scale)}px`;
  invPreviewStage.style.height = `${Math.ceil(baseHeight * scale)}px`;
}

function getInvoicePrintStyles() {
  return `
    @page { size: A4 portrait; margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      width: 210mm;
      min-height: 297mm;
      background: #ffffff;
      color: #000000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-family: sans-serif;
    }
    body {
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .invoice-paper {
      background: #fff;
      color: #000;
      width: 210mm;
      min-height: 297mm;
      padding: 12mm 14mm 14mm;
      font-family: sans-serif;
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
    }
    .invoice-paper h1 { margin:0 0 2px; font-size:24px; text-align:right; font-weight:800; letter-spacing:-0.5px; }
    .invoice-paper .inv-meta-right { text-align:right; color:#000; font-size:12px; line-height:1.2; margin-bottom:18px; }
    .invoice-paper .inv-status { color:#ef4444; font-size:11px; font-weight:600; text-transform:uppercase; margin-top:2px; }
    .invoice-paper .meta-grid { display:flex; justify-content:space-between; gap:16mm; margin-bottom:18px; align-items:flex-start; }
    .invoice-paper .company-info, .invoice-paper .customer-info { font-size:12px; line-height:1.3; color:#333; }
    .invoice-paper .company-info { flex:1; min-width:0; }
    .invoice-paper .customer-info { flex:1; min-width:0; text-align:right; }
    .invoice-paper .company-name { font-size:14px; font-weight:800; margin-bottom:2px; text-transform:uppercase; color:#000; }
    .invoice-paper .customer-label { font-weight:700; color:#000; margin-bottom:2px; }
    .invoice-paper .dates-grid { text-align:right; font-size:11px; margin-bottom:18px; line-height:1.4; color:#000; }
    .invoice-paper table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11px; }
    .invoice-paper th { background:#2c3e50 !important; color:#fff !important; padding:6px 8px; text-align:left; font-weight:600; }
    .invoice-paper td { border-bottom:1px solid #eee; padding:8px 8px; vertical-align:top; color:#333; }
    .invoice-paper .item-idx { width:30px; text-align:center; }
    .invoice-paper .item-name { font-weight:700; color:#000; font-size:12px; }
    .invoice-paper .item-desc { color:#666; font-size:10px; margin-top:1px; }
    .invoice-paper .totals-area { display:flex; justify-content:flex-end; margin-bottom:24px; }
    .invoice-paper .totals-table { width:280px; font-size:12px; border-collapse:collapse; }
    .invoice-paper .totals-table td { padding:4px 0; border:none; }
    .invoice-paper .totals-table .total-label { text-align:right; padding-right:16px; font-weight:700; color:#000; }
    .invoice-paper .totals-table .total-val { text-align:right; font-weight:600; color:#000; }
    .invoice-paper .grand-total { background:#f3f4f6 !important; font-weight:800; padding:8px !important; margin-top:4px; }
    .invoice-paper .footer-area { font-size:11px; color:#000; display:flex; justify-content:space-between; align-items:flex-end; margin-top:auto; padding-top:20px; min-height:150px; }
    .invoice-paper .notes-area { max-width:60%; overflow-wrap:anywhere; word-break:break-word; }
    .invoice-paper .notes-label { font-weight:800; margin-bottom:2px; }
    .invoice-paper .payment-info { margin-top:12px; font-size:11px; line-height:1.3; }
    .invoice-paper .payment-label { font-weight:700; margin-bottom:2px; }
  `;
}

function buildInvoicePrintHtml(titleText) {
  const paperHtml = invPaper ? invPaper.outerHTML : '';
  const safeTitle = String(titleText || 'Factura').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <style>${getInvoicePrintStyles()}</style>
</head>
<body>
  ${paperHtml}
</body>
</html>`;
}

function printInvoiceDocument(titleText) {
  if (!invPaper) return;
  const originalTitle = document.title;
  const restoreTitle = () => {
    document.title = originalTitle;
    document.body.classList.remove('printing-invoice');
  };
  document.title = titleText || originalTitle;
  document.body.classList.add('printing-invoice');
  window.addEventListener('afterprint', restoreTitle, { once: true });
  setTimeout(() => {
    try {
      window.print();
    } catch {}
    setTimeout(restoreTitle, 4000);
  }, 100);
}

if (invPrevClose) invPrevClose.addEventListener('click', () => invPrevModal.style.display = 'none');
if (invPrevPrint) {
  invPrevPrint.addEventListener('click', () => {
    let invNo = document.getElementById('prev-no').textContent || 'Factura';
    invNo = invNo.trim();
    if (!invNo.startsWith('Factura')) {
      invNo = 'Factura-' + invNo;
    }
    invNo = invNo.replace(/\s+/g, '');
    setTimeout(() => {
      printInvoiceDocument(invNo);
    }, 100);
  });
}

window.addEventListener('resize', () => {
  updateInvoicePreviewScale();
});

function normalizeInvoicePreviewText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function splitInvoiceDescriptionAndLote(text) {
  const desc = normalizeInvoicePreviewText(text);
  const match = desc.match(/^(.*?)(?:\s+)?Lote[:：]\s*([^\s]+)\s*$/i);
  if (!match) return { baseDesc: desc, lote: '' };
  return {
    baseDesc: normalizeInvoicePreviewText(match[1]),
    lote: normalizeInvoicePreviewText(match[2])
  };
}

function mergeInvoicePreviewItems(items) {
  const merged = [];
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach(item => {
    const name = normalizeInvoicePreviewText(item?.name);
    const { baseDesc, lote } = splitInvoiceDescriptionAndLote(item?.description);
    let taxRate = Number(item?.tax_rate);
    if (isNaN(taxRate) || item?.tax_rate === undefined || item?.tax_rate === null || item?.tax_rate === '') taxRate = 0.10;
    if (taxRate >= 1) taxRate = taxRate / 100;
    const price = Number(item?.price || 0);
    const key = [name, baseDesc, lote, price.toFixed(6), taxRate.toFixed(6)].join('||');
    if (!map.has(key)) {
      const mergedItem = {
        ...item,
        name,
        description: [baseDesc, lote ? `Lote:${lote}` : ''].filter(Boolean).join(' '),
        qty: Number(item?.qty || 0),
        price,
        tax_rate: taxRate
      };
      map.set(key, mergedItem);
      merged.push(mergedItem);
      return;
    }
    const target = map.get(key);
    target.qty = Number(target.qty || 0) + Number(item?.qty || 0);
  });
  return merged;
}

window.previewInvoice = async function(id) {
  const inv = currentInvoices.find(x => String(x.id) === String(id));
  if (!inv) return;
  try { await ensureRealContactsLoaded(); } catch {}
  let invoiceCustomer = null;

  // Load Company Info for Header
  try {
    const ci = await apiFetchJSON('/api/company-info');
    if (ci) {
      const infoHtml = `
        <div class="company-name">${ci.name || 'EMPRESA'}</div>
        CIF: ${ci.tax_id || ''}<br>
        ${ci.street || ''}<br>
        ${ci.zip || ''} ${ci.city || ''} ${ci.country || ''}<br>
        ${ci.phone || ''}${ci.email ? '<br>' + ci.email : ''}
      `;
      const el = document.getElementById('prev-company-info');
      if (el) el.innerHTML = infoHtml;
      
      const payHtml = `
        <div class="payment-label">Forma de pago</div>
        ${ci.bank_name || ''}<br>
        ${ci.iban || ''}<br>
        SWIFT: ${ci.swift || ''}
      `;
      const payEl = document.getElementById('prev-payment-info');
      if (payEl) payEl.innerHTML = payHtml;
    }
  } catch {}
  
  // Load Customer Info
  let customerInfoHtml = '';
  try {
    const cust = await getInvoiceCustomerContact(inv.customer);
    invoiceCustomer = cust;
    const companyName = inv.company_name || cust?.company || cust?.name || inv.customer || '';
    const customerCode = inv.customer_code || cust?.code || '';
    const customerAddress = inv.customer_address || cust?.address || cust?.ship_address || '';
    const customerZip = inv.customer_zip || cust?.zip || cust?.ship_zip || '';
    const customerCity = inv.customer_city || cust?.city || cust?.ship_city || '';
    const customerCountry = inv.customer_country || cust?.country || cust?.ship_country || '';
    if (cust) {
      customerInfoHtml = `
        <div class="customer-label">Facturado a</div>
        <div style="font-weight:700">${companyName}</div>
        ${customerCode ? `<div>${customerCode}</div>` : ''}
        ${customerAddress ? `<div>${customerAddress}</div>` : ''}
        ${customerZip ? `<div>${customerZip}</div>` : ''}
        ${customerCity ? `<div>${customerCity}</div>` : ''}
        ${customerCountry ? `<div>${customerCountry}</div>` : ''}
      `;
    } else if (companyName) {
      customerInfoHtml = `
        <div class="customer-label">Facturado a</div>
        <div style="font-weight:700">${companyName}</div>
        ${customerCode ? `<div>${customerCode}</div>` : ''}
        ${customerAddress ? `<div>${customerAddress}</div>` : ''}
        ${customerZip ? `<div>${customerZip}</div>` : ''}
        ${customerCity ? `<div>${customerCity}</div>` : ''}
        ${customerCountry ? `<div>${customerCountry}</div>` : ''}
      `;
    } else {
       customerInfoHtml = `
        <div class="customer-label">Facturado a</div>
        <div style="font-weight:700">${inv.customer || ''}</div>
      `;
    }
  } catch {
    customerInfoHtml = `
      <div class="customer-label">Facturado a</div>
      <div style="font-weight:700">${inv.customer || ''}</div>
    `;
  }
  const custEl = document.getElementById('prev-customer-info');
  if (custEl) custEl.innerHTML = customerInfoHtml;

  document.getElementById('prev-no').textContent = inv.invoice_no || '';
  
  // Update status based on payment
  const total = Number(inv.total_amount||0);
  const paid = Number(inv.paid_amount||0);
  const statusEl = document.getElementById('prev-status');
  if (statusEl) {
    if (paid >= total && total > 0) {
      statusEl.textContent = 'PAGADA';
      statusEl.style.color = '#10b981'; // Green
      statusEl.style.borderColor = '#10b981';
    } else if (paid > 0) {
      statusEl.textContent = 'PAGADA PARCIALMENTE';
      statusEl.style.color = '#f59e0b'; // Orange
      statusEl.style.borderColor = '#f59e0b';
    } else {
      statusEl.textContent = 'POR PAGAR';
      statusEl.style.color = '#ef4444'; // Red
      statusEl.style.borderColor = '#ef4444';
    }
  }
  
  // Format dates: YYYY-MM-DD -> DD/MM/YYYY
  const formatDate = (d) => {
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return d;
  };
  
  const dateStr = formatDate(inv.date);
  document.getElementById('prev-date').textContent = dateStr;
  
  const prevSalesEl = document.getElementById('prev-sales');
  if (prevSalesEl) prevSalesEl.textContent = inv.sales || '';

  document.getElementById('prev-notes').textContent = invoiceCustomer?.invoice_nota || inv.notes || '';
  
  const tbody = document.getElementById('prev-items');
  tbody.innerHTML = '';
  const rawItems = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  const items = mergeInvoicePreviewItems(rawItems);
  
  let subtotal = 0;
  let taxDetails = {}; // key: tax rate, value: tax amount
  
  items.forEach((item, idx) => {
    const qty = Number(item.qty||0);
    const price = Number(item.price||0);
    // Use item.tax_rate if available (0.1, 0.21 etc), otherwise default to 0 if not set? 
    // Or prompt implies some products have specific tax. 
    // Let's assume item has tax_rate property. If not, maybe default 0 or check if user set it?
    // For now, let's look for tax_rate in item.
    let taxRate = Number(item.tax_rate);
    if (isNaN(taxRate) || item.tax_rate === undefined || item.tax_rate === null || item.tax_rate === '') taxRate = 0.10;
    if (taxRate >= 1) taxRate = taxRate / 100;
    
    // If taxRate is 0, we don't show tax for this line? 
    // "Impuesto (税收) 没有税收的客户 这里不显示" -> If customer has no tax, all items 0 tax.
    // "这个产品的税率是 10% ，那发票这里应该是就是计算是10%"
    
    const rowVal = qty * price;
    subtotal += rowVal;
    
    const taxAmt = rowVal * taxRate;
    
    // Accumulate tax details
    if (taxRate > 0) {
      const key = (taxRate * 100).toFixed(2); // "21.00", "10.00"
      if (!taxDetails[key]) taxDetails[key] = 0;
      taxDetails[key] += taxAmt;
    }

    const tr = document.createElement('tr');
    let taxDisplay = '';
    if (taxRate > 0) {
      taxDisplay = `IVA ${(taxRate*100).toFixed(2)}%`;
    }
    
    tr.innerHTML = `
      <td class="item-idx">${idx + 1}</td>
      <td>
        <div class="item-name">${item.name||''}</div>
        <div class="item-desc">${item.description||''}</div>
      </td>
      <td style="text-align:right">${qty}</td>
      <td style="text-align:right">${price.toFixed(2)}</td>
      <td style="text-align:right">${taxDisplay}</td>
      <td style="text-align:right">${rowVal.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Calculate total tax
  let totalTax = 0;
  Object.values(taxDetails).forEach(v => totalTax += v);
  const grandTotal = subtotal + totalTax;
  
  document.getElementById('prev-subtotal').textContent = subtotal.toFixed(2);
  
  // Render Tax Rows
  const taxRowsContainer = document.getElementById('prev-tax-rows');
  if (taxRowsContainer) {
    taxRowsContainer.innerHTML = '';
    Object.keys(taxDetails).sort((a,b)=>Number(b)-Number(a)).forEach(rate => {
      const amt = taxDetails[rate];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="total-label">IVA (${rate}%)</td>
        <td class="total-val">${amt.toFixed(2)}</td>
      `;
      taxRowsContainer.appendChild(tr);
    });
    // If no tax, maybe show 0? Or nothing? 
    // "没有税收的客户 这里不显示" -> if taxDetails empty, nothing shown.
  } else {
    // Fallback for old template structure if element not found (though we will update html next)
    const prevTaxEl = document.getElementById('prev-tax');
    if (prevTaxEl) prevTaxEl.textContent = totalTax.toFixed(2);
  }

  document.getElementById('prev-grand-total').textContent = grandTotal.toFixed(2) + '€';
  document.getElementById('prev-grand-total-2').textContent = grandTotal.toFixed(2) + '€';
  
  invPrevModal.style.display = 'flex';
  requestAnimationFrame(() => {
    updateInvoicePreviewScale();
    requestAnimationFrame(() => updateInvoicePreviewScale());
  });
};

window.printInvoice = function(id) {
  previewInvoice(id);
  setTimeout(() => window.print(), 500);
};

let pendingEditInvoiceId = null;

// Invoice Edit Modal Logic
const editModal = document.getElementById('invoice-edit-modal');
const editClose = document.getElementById('edit-modal-close');
const editItems = document.getElementById('edit-items');
const editAddItem = document.getElementById('edit-add-item');
const editSave = document.getElementById('edit-save');
const editCustomer = document.getElementById('edit-customer');
const editCustomerDd = document.getElementById('edit-customer-dd');
const editCustomerSearch = document.getElementById('edit-customer-search');
const editCustomerList = document.getElementById('edit-customer-list');
let currentEditCustomer = null;

if (editClose) editClose.addEventListener('click', () => editModal.style.display = 'none');

// Re-implement customer search for edit modal
if (editCustomer) {
  editCustomer.addEventListener('focus', () => {
    editCustomerSearch.value = '';
    renderEditCustomerList();
    editCustomerDd.style.display = 'block';
    editCustomerSearch.focus();
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!editCustomer.contains(e.target) && !editCustomerDd.contains(e.target)) {
      editCustomerDd.style.display = 'none';
    }
  });
}

if (editCustomerSearch) {
  editCustomerSearch.addEventListener('input', () => renderEditCustomerList(editCustomerSearch.value));
}

function renderEditCustomerList(filter = '') {
  const list = [
    ...(contactsData.customers||[]),
    ...(contactsData.merchants||[]),
    ...(contactsData.others||[])
  ];
  editCustomerList.innerHTML = '';
  const f = filter.toLowerCase();
  list.forEach(c => {
    if (!f || c.name.toLowerCase().includes(f) || (c.company||'').toLowerCase().includes(f)) {
      const div = document.createElement('div');
      div.className = 'dd-item';
      div.textContent = c.name + (c.company ? ` (${c.company})` : '');
      div.onclick = () => {
        editCustomer.value = c.name;
        currentEditCustomer = c;
        // Update Use Price
        if (editUsePrice) {
          const p = c.use_price || 'price1';
          const map = { price1:'价格1', price2:'价格2', price3:'价格3', price4:'价格4' };
          editUsePrice.value = map[p] || p;
        }
      // New Logic for Salesperson
        if (editSales) {
          if (c.sales) {
            editSales.value = c.sales;
            editSales.disabled = true;
          } else {
            editSales.value = '';
            editSales.disabled = false;
          }
        }
        editCustomerDd.style.display = 'none';
        // Re-calc tax for existing items
        Array.from(editItems.children).forEach(tr => {
          // If customer is not IVA, taxRate becomes 0. Else use stored or default.
          // But we don't store original tax rate easily if we overwrite it.
          // Let's assume standard behavior: update tax based on new customer preference.
          let taxRate = 0.10; // Default fallback
          const stored = parseFloat(tr.dataset.taxRate);
          if (!isNaN(stored)) taxRate = stored;
          
          if (c.is_iva === false) taxRate = 0;
          else if (taxRate === 0 && stored !== 0) taxRate = 0.10; // Try to restore if previously 0? Hard to know.
          // Simplest: Just apply is_iva=false logic.
          
          tr.dataset.taxRate = taxRate;
          const qty = parseFloat(tr.querySelector('.qty').value)||0;
          const price = parseFloat(tr.querySelector('.price').value)||0;
          const taxAmt = qty * price * taxRate;
          tr.querySelector('.iva-amt').textContent = taxAmt.toFixed(2);
        });
        updateEditTotal();
      };
      editCustomerList.appendChild(div);
    }
  });
}

window.editInvoice = function(id) {
  const inv = currentInvoices.find(x => String(x.id) === String(id));
  if (!inv) return;
  
  // Fill basic info
  document.getElementById('edit-id').value = inv.id;
  document.getElementById('edit-invoice-no').textContent = inv.invoice_no;
  editCustomer.value = inv.customer || '';
  document.getElementById('edit-date').value = inv.date || '';
  document.getElementById('edit-notes').value = inv.notes || '';
  
  // Find customer object
  const allContacts = [
    ...(contactsData.customers||[]),
    ...(contactsData.merchants||[]),
    ...(contactsData.others||[])
  ];
  currentEditCustomer = allContacts.find(c => c.name === (inv.customer||''));
  
  // Update Use Price
  if (editUsePrice) {
    if (currentEditCustomer) {
      const p = currentEditCustomer.use_price || 'price1';
      const map = { price1:'价格1', price2:'价格2', price3:'价格3', price4:'价格4' };
      editUsePrice.value = map[p] || p;
    } else {
      editUsePrice.value = '';
    }
  }

  // Handle Sales
  if (editSales) {
      // Prioritize invoice record, then customer record
      if (inv.sales) {
          editSales.value = inv.sales;
          // Lock if customer has sales? Or just if invoice has sales? 
          // User said "When customer info already set salesperson... lock it".
          // If the invoice has a sales value that matches the customer's bound sales, lock it.
          // If the invoice has a sales value but customer has none (or different), maybe allow edit?
          // Simplest interpretation: If customer has bound sales, lock. Else unlock.
          // But we must populate with inv.sales first.
          if (currentEditCustomer && currentEditCustomer.sales) {
              editSales.disabled = true;
          } else {
              editSales.disabled = false;
          }
      } else {
           // No sales on invoice. Check customer.
           if (currentEditCustomer && currentEditCustomer.sales) {
               editSales.value = currentEditCustomer.sales;
               editSales.disabled = true;
           } else {
               editSales.value = '';
               editSales.disabled = false;
           }
      }
  }

  // Clear items
  editItems.innerHTML = '';
  
  // Parse and add items
  let items = [];
  try {
    items = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  } catch (e) { items = []; }
  
  if (Array.isArray(items)) {
    items.forEach(item => addEditItem(item));
  }
  
  updateEditTotal();
  editModal.style.display = 'flex';
};

function addEditItem(p = {}) {
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid #1e293b';
  
  // Determine tax rate
  let taxRate = 0.10;
  if (p.tax_rate !== undefined && p.tax_rate !== null && p.tax_rate !== '') {
    taxRate = Number(p.tax_rate);
    if (taxRate >= 1) taxRate = taxRate / 100;
  }
  // Apply customer override
  if (currentEditCustomer && currentEditCustomer.is_iva === false) {
    taxRate = 0;
  }
  tr.dataset.taxRate = taxRate;
  tr.dataset.productId = p.productId || '';
  tr.dataset.sku = p.sku || '';
  
  const qty = Number(p.qty) || 0;
  const price = p.price !== undefined && p.price !== null && p.price !== '' ? Number(p.price) : getProductPriceByCustomer(p, currentEditCustomer);
  const taxAmt = qty * price * taxRate;
  const total = qty * price; // Excl tax in row total display usually, or incl? 
  // In sales order table: "金额" column usually is total without tax or with? 
  // Looking at addSoItem: total = qty*price. And footer adds tax.
  // So row total is subtotal.
  
  tr.innerHTML = `
    <td style="padding:10px 16px"><input type="text" class="name light-input" style="width:100%; background:transparent; border:none; color:#e2e8f0" value="${p.name || ''}"></td>
    <td style="padding:10px 16px"><input type="text" class="desc light-input" style="width:100%; background:transparent; border:none; color:#94a3b8" value="${p.description||''}" placeholder="规格"></td>
    <td style="padding:10px 16px"><input type="number" class="qty light-input" style="width:100%; text-align:center; background:#0f172a; border:1px solid #334155" value="${qty}" min="1"></td>
    <td style="padding:10px 16px"><input type="number" class="price light-input" style="width:100%; text-align:center; background:#0f172a; border:1px solid #334155" value="${price.toFixed(2)}" min="0" step="0.01"></td>
    <td class="iva-amt" style="padding:10px 16px; text-align:right; font-family:monospace; color:#94a3b8">${taxAmt.toFixed(2)}</td>
    <td class="amt" style="padding:10px 16px; text-align:right; font-family:monospace; color:#e2e8f0">${total.toFixed(2)}</td>
    <td style="padding:10px 16px; text-align:center"><button type="button" class="btn-red btn-icon" style="width:24px;height:24px;padding:0;font-size:12px">×</button></td>
  `;
  
  // Events
  tr.querySelector('.btn-red').addEventListener('click', () => { tr.remove(); updateEditTotal(); });
  const inputs = tr.querySelectorAll('input');
  inputs.forEach(i => {
    i.addEventListener('focus', function() { this.select(); });
    if (i.classList.contains('qty') || i.classList.contains('price')) {
      i.addEventListener('input', () => {
        const q = parseFloat(tr.querySelector('.qty').value) || 0;
        const pr = parseFloat(tr.querySelector('.price').value) || 0;
        const r = parseFloat(tr.dataset.taxRate) || 0;
        tr.querySelector('.amt').textContent = (q * pr).toFixed(2);
        tr.querySelector('.iva-amt').textContent = (q * pr * r).toFixed(2);
        updateEditTotal();
      });
    }
  });
  
  editItems.appendChild(tr);
}

if (editAddItem) {
  editAddItem.addEventListener('click', () => {
    if (!editCustomer.value.trim()) {
      alert('请先选择客户');
      return;
    }
    window.onProdSelect = (p) => {
      addEditItem({
        ...p,
        qty: 1,
        price: getProductPriceByCustomer(p, currentEditCustomer),
        description: p.spec || p.description || ''
      });
    };
    window.selectedProducts.clear();
    prodSelModal.style.display = 'flex';
    prodSelSearch.value = '';
    loadProductSelector();
  });
}

function updateEditTotal() {
  let sub = 0, tax = 0;
  Array.from(editItems.children).forEach(tr => {
    const q = parseFloat(tr.querySelector('.qty').value) || 0;
    const p = parseFloat(tr.querySelector('.price').value) || 0;
    const r = parseFloat(tr.dataset.taxRate) || 0;
    sub += q * p;
    tax += q * p * r;
  });
  document.getElementById('edit-subtotal').textContent = sub.toFixed(2);
  document.getElementById('edit-tax').textContent = tax.toFixed(2);
  document.getElementById('edit-total').textContent = (sub + tax).toFixed(2);
}

if (editSave) {
  editSave.addEventListener('click', async () => {
    const id = document.getElementById('edit-id').value;
    const customer = editCustomer.value.trim();
    if (!customer) { alert('请选择客户'); return; }
    
    const items = [];
    Array.from(editItems.children).forEach(tr => {
      const name = tr.querySelector('.name').value.trim();
      const desc = tr.querySelector('.desc').value.trim();
      const qty = parseFloat(tr.querySelector('.qty').value) || 0;
      const price = parseFloat(tr.querySelector('.price').value) || 0;
      const taxRate = parseFloat(tr.dataset.taxRate) || 0;
      
      const productId = tr.dataset.productId || '';
      const sku = tr.dataset.sku || '';
      
      if (name) items.push({ name, description: desc, qty, price, total: qty*price, tax_rate: taxRate, productId, sku });
    });
    
    if (items.length === 0) { alert('请至少添加一个商品'); return; }
    
    const res = await fetchWithAuth(`/api/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        customer,
        date: document.getElementById('edit-date').value,
        items,
        notes: document.getElementById('edit-notes').value,
        sales: editSales ? editSales.value : '',
        trust_days: parseInt(document.getElementById('edit-trust').value||'30', 10)
      })
    });
    
    if (res.ok) {
      alert('修改已保存');
      editModal.style.display = 'none';
      loadInvoices();
    } else {
      const err = await res.json().catch(()=>({}));
      alert(err.error === 'cannot_edit_paid_invoice' ? '无法修改：订单已全额付款' : '保存失败');
    }
  });
}

// Deprecated old edit logic
async function loadInvoiceForEdit(id) {
  // ... kept for compatibility if needed, but window.editInvoice is overwritten
}

if (invRefresh) invRefresh.addEventListener('click', () => { invPage=1; loadInvoices(); });
if (invSearch) invSearch.addEventListener('change', () => { invPage=1; loadInvoices(); });

async function route() {
  return handleRoute();
}
// window.addEventListener('hashchange', route); // Disabled in favor of handleRoute
document.querySelectorAll('.nav a').forEach(a => {
  a.addEventListener('click', () => setTimeout(() => handleRoute(), 0));
});
initPersist();
setAuthUI();
loadLedgerFromServer();
loadPayablesFromServer();
applyFilters();
window.addEventListener('resize', updateLedgerHeaderCover);
document.getElementById('partner-orders-back')?.addEventListener('click', () => { location.hash = '#contacts'; });
renderContacts();
apiCategoriesList().then(() => renderCats());
apiAccountsList().then(() => { refreshAccountOptions(); renderAccounts(); });
apiSalesList().then(() => renderSales());
apiRolesList().then(() => { renderRoles(); route(); });
apiUsersList().then(() => renderUserAccounts());
refreshLedgerTypeOptions();
setCategories();
(function initPageByHash(){
  const h = location.hash || '#home';
  const isPayables = (h === '#payables');
  const gp = document.getElementById('global-pager');
  if (!isPayables && gp) gp.style.display = 'none';
  if (isPayables) renderPayables();
})();
accAdd?.addEventListener('click', () => {
  const nameEl = document.getElementById('acc-create-name');
  const descEl = document.getElementById('acc-create-desc');
  const modal = document.getElementById('acc-create-modal');
  if (nameEl) nameEl.value = '';
  if (descEl) descEl.value = '';
  if (modal) modal.style.display = 'flex';
});
function showAccCreate() {
  const nameEl = document.getElementById('acc-create-name');
  const descEl = document.getElementById('acc-create-desc');
  const modal = document.getElementById('acc-create-modal');
  if (nameEl) nameEl.value = '';
  if (descEl) descEl.value = '';
  if (modal) modal.style.display = 'flex';
}
document.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('#acc-add');
  if (!btn) return;
  const nameEl = document.getElementById('acc-create-name');
  const descEl = document.getElementById('acc-create-desc');
  const modal = document.getElementById('acc-create-modal');
  if (nameEl) nameEl.value = '';
  if (descEl) descEl.value = '';
  if (modal) modal.style.display = 'flex';
  e.preventDefault();
});

// Company Info
async function loadCompanyInfo() {
  try {
    const data = await apiFetchJSON('/api/company-info');
    if (data) {
      document.getElementById('ci-name').value = data.name || '';
      document.getElementById('ci-tax').value = data.tax_id || '';
      document.getElementById('ci-phone').value = data.phone || '';
      document.getElementById('ci-email').value = data.email || '';
      document.getElementById('ci-street').value = data.street || '';
      document.getElementById('ci-zip').value = data.zip || '';
      document.getElementById('ci-city').value = data.city || '';
      document.getElementById('ci-country').value = data.country || '';
      document.getElementById('ci-bank').value = data.bank_name || '';
      document.getElementById('ci-iban').value = data.iban || '';
      document.getElementById('ci-swift').value = data.swift || '';
    }
  } catch {}
  syncCompanyInfoAccess();
}
function canEditCompanyInfo() {
  const u = getAuthUser();
  const roleName = (u?.role) || getUserRoleName(u?.name || '');
  return roleName === '超级管理员';
}
function syncCompanyInfoAccess() {
  const readOnly = !canEditCompanyInfo();
  ['ci-name','ci-tax','ci-phone','ci-email','ci-street','ci-zip','ci-city','ci-country','ci-bank','ci-iban','ci-swift']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.readOnly = readOnly;
    });
  const saveBtn = document.querySelector('#company-info-form button[type="submit"]');
  if (saveBtn) saveBtn.style.display = readOnly ? 'none' : '';
}

const companyInfoForm = document.getElementById('company-info-form');
if (companyInfoForm) {
  companyInfoForm.addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('ci-name').value.trim(),
      tax_id: document.getElementById('ci-tax').value.trim(),
      phone: document.getElementById('ci-phone').value.trim(),
      email: document.getElementById('ci-email').value.trim(),
      street: document.getElementById('ci-street').value.trim(),
      zip: document.getElementById('ci-zip').value.trim(),
      city: document.getElementById('ci-city').value.trim(),
      country: document.getElementById('ci-country').value.trim(),
      bank_name: document.getElementById('ci-bank').value.trim(),
      iban: document.getElementById('ci-iban').value.trim(),
      swift: document.getElementById('ci-swift').value.trim(),
    };
    try {
      await apiFetchJSON('/api/company-info', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      alert('公司信息已保存');
    } catch {
      alert('保存失败');
    }
  });
}

// Appended from index.html
accAdd?.addEventListener('click', () => {
  const nameEl = document.getElementById('acc-create-name');
  const descEl = document.getElementById('acc-create-desc');
  const modal = document.getElementById('acc-create-modal');
  if (nameEl) nameEl.value = '';
  if (descEl) descEl.value = '';
  if (modal) modal.style.display = 'flex';
});
function showAccCreate() {
  const nameEl = document.getElementById('acc-create-name');
  const descEl = document.getElementById('acc-create-desc');
  const modal = document.getElementById('acc-create-modal');
  if (nameEl) nameEl.value = '';
  if (descEl) descEl.value = '';
  if (modal) modal.style.display = 'flex';
}
document.addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('#acc-add');
  if (!btn) return;
  const nameEl = document.getElementById('acc-create-name');
  const descEl = document.getElementById('acc-create-desc');
  const modal = document.getElementById('acc-create-modal');
  if (nameEl) nameEl.value = '';
  if (descEl) descEl.value = '';
  if (modal) modal.style.display = 'flex';
  e.preventDefault();
});

// Products Logic
let prodPage = 1;
let prodTotal = 0;
const prodPageSize = 50;
const prodSearch = document.getElementById('prod-search');
const prodRefresh = document.getElementById('prod-refresh');
const prodAdd = document.getElementById('prod-add');
const prodRows = document.getElementById('prod-rows');
const prodPager = document.getElementById('prod-pager');
const prodModal = document.getElementById('product-modal');
const prodForm = document.getElementById('prod-form');
const prodCancel = document.getElementById('prod-cancel');
const prodPrev = document.getElementById('prod-prev');
const prodNext = document.getElementById('prod-next');
const prodFile = document.getElementById('prod-file');
const prodFileName = document.getElementById('prod-file-name');
const prodPreview = document.getElementById('prod-preview');
const prodDividendUsersWrap = document.getElementById('prod-dividend-users');
const appToast = document.getElementById('app-toast');
const appToastText = document.getElementById('app-toast-text');
let productDividendUserOptions = [];
let currentProductPageList = [];
let currentProductModalIndex = -1;
let currentProductModalStandaloneEdit = false;
let appToastTimer = null;
const salesStatsStart = document.getElementById('sales-stats-start');
const salesStatsEnd = document.getElementById('sales-stats-end');
const salesStatsSearch = document.getElementById('sales-stats-search');
const salesStatsDividendUserWrap = document.getElementById('sales-stats-dividend-user-wrap');
const salesStatsDividendUser = document.getElementById('sales-stats-dividend-user');
const salesStatsRefresh = document.getElementById('sales-stats-refresh');
const salesStatsRows = document.getElementById('sales-stats-rows');
const salesStatsSummary = document.getElementById('sales-stats-summary');
const salesStatsHeadRow = document.getElementById('sales-stats-head-row');
let salesStatsDividendUsersLoaded = false;

function formatMoney(val) {
  return Number(val || 0).toFixed(2);
}

function formatOptionalMoney(val) {
  if (val === undefined || val === null || val === '') return '-';
  const num = Number(val);
  if (!Number.isFinite(num) || num === 0) return '-';
  return num.toFixed(2);
}

function showAppToast(message = '保存成功！') {
  if (!appToast || !appToastText) return;
  appToastText.textContent = message;
  appToast.style.display = 'flex';
  if (appToastTimer) clearTimeout(appToastTimer);
  requestAnimationFrame(() => appToast.classList.add('show'));
  appToastTimer = setTimeout(() => {
    appToast.classList.remove('show');
    setTimeout(() => {
      if (!appToast.classList.contains('show')) appToast.style.display = 'none';
    }, 220);
  }, 1800);
}

function updateTopProductionReviewAlert(count = 0) {
  productionPendingCount = Number(count || 0);
  const alertBtn = document.getElementById('top-production-review-alert');
  const badge = document.getElementById('top-production-review-alert-badge');
  if (!alertBtn || !badge) return;
  const canViewReview = typeof can !== 'function' ? true : can('production_review', 'view');
  badge.textContent = String(productionPendingCount);
  alertBtn.style.display = canViewReview && productionPendingCount > 0 ? 'inline-flex' : 'none';
}
window.updateTopProductionReviewAlert = updateTopProductionReviewAlert;

function openProductionReviewCenter() {
  pendingFinishedStockTab = 'review';
  if (location.hash !== '#finished-stock') {
    location.hash = '#finished-stock';
    return;
  }
  const page = document.getElementById('page-finished-stock');
  if (page) page.style.display = 'block';
  switchFinishedStockTab('review', document.getElementById('fs-tab-review'));
}
window.openProductionReviewCenter = openProductionReviewCenter;

function normalizeDividendUsers(val) {
  if (Array.isArray(val)) return val.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof val === 'string') {
    const text = val.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(v => String(v || '').trim()).filter(Boolean) : [];
    } catch {
      return text.split(',').map(v => String(v || '').trim()).filter(Boolean);
    }
  }
  return [];
}

function isDividendProduct(item) {
  return normalizeDividendUsers(item?.dividend_users).length > 0 || !!item?.dividend_enabled;
}

function isAssignedSalesStatsView() {
  const u = getAuthUser();
  const roleName = (u?.role) || getUserRoleName(u?.name || '');
  return roleName !== '超级管理员' && can('sales_stats', 'assigned_only');
}

async function ensureProductDividendUsersLoaded() {
  if (productDividendUserOptions.length) return productDividendUserOptions;
  try {
    const list = await apiFetchJSON('/api/auth/users');
    productDividendUserOptions = (Array.isArray(list) ? list : [])
      .map(x => ({ name: String(x.name || '').trim(), role: String(x.role || '').trim() }))
      .filter(x => x.name);
  } catch {
    productDividendUserOptions = [];
  }
  return productDividendUserOptions;
}

function renderProductDividendUsers(selectedNames = []) {
  if (!prodDividendUsersWrap) return;
  const selectedSet = new Set((Array.isArray(selectedNames) ? selectedNames : []).map(v => String(v || '').trim()).filter(Boolean));
  const merged = [...productDividendUserOptions];
  selectedSet.forEach(name => {
    if (!merged.some(user => user.name === name)) merged.push({ name, role: '已停用/缺失' });
  });
  if (!merged.length) {
    prodDividendUsersWrap.innerHTML = '<div style="color:#64748b; font-size:12px">暂无可选账号</div>';
    return;
  }
  prodDividendUsersWrap.innerHTML = merged.map(user => `
    <label style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border:1px solid #334155; border-radius:8px; background:#0f172a; color:#e2e8f0; font-size:12px; cursor:pointer">
      <input type="checkbox" class="prod-dividend-user" value="${escapeHtml(user.name)}" ${selectedSet.has(user.name) ? 'checked' : ''}>
      <span>${escapeHtml(user.name)}</span>
      <span style="color:#64748b">${escapeHtml(user.role || '')}</span>
    </label>
  `).join('');
}

if (prodFile) {
  prodFile.addEventListener('change', () => {
    const file = prodFile.files[0];
    if (file) {
      prodFileName.textContent = file.name;
      const reader = new FileReader();
      reader.onload = e => {
        document.getElementById('prod-image').value = e.target.result;
        prodPreview.src = e.target.result;
        prodPreview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      prodFileName.textContent = '未选择文件';
      prodPreview.style.display = 'none';
    }
  });
}

async function loadProducts() {
  if (!prodRows) return;
  const q = (prodSearch?.value||'').trim();
  const res = await fetchWithAuth(`/api/products?page=${prodPage}&size=${prodPageSize}&q=${encodeURIComponent(q)}`);
  if (res.ok) {
    const data = await res.json();
    const list = data.list || [];
    currentProductPageList = list;
    prodTotal = data.total || 0;
    renderProducts(list);
    renderProdPager();
  }
}

function renderProducts(list) {
  prodRows.innerHTML = '';
  if (list.length === 0) {
    prodRows.innerHTML = '<tr class="empty"><td colspan="17">暂无商品数据</td></tr>';
    return;
  }
  list.forEach((x, idx) => {
    const displayIndex = prodTotal - (prodPage - 1) * prodPageSize - idx;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${displayIndex}</td>
      <td style="padding:0; width:50px; height:50px">${x.image ? `<img src="${x.image}" class="thumb-img" onclick="showFileViewer('${x.image}')" style="width:100%; height:100%; object-fit:contain; display:block">` : ''}</td>
      <td>${x.sku||''}</td>
      <td>${x.barcode||''}</td>
      <td>${x.name||''}</td>
      <td>${x.name_cn||''}</td>
      <td>${x.spec||''}</td>
      <td>${formatOptionalMoney(x.price1)}</td>
      <td>${formatOptionalMoney(x.price2)}</td>
      <td>${formatOptionalMoney(x.cost_price)}</td>
      <td>${isDividendProduct(x) ? '是' : '-'}</td>
      <td>${Number(x.stock||0)}</td>
      <td>
        <button class="light-btn btn-blue prod-edit-btn" style="font-size:12px;padding:4px 8px;margin-right:4px">编辑</button>
        <button class="light-btn btn-red prod-del-btn" style="font-size:12px;padding:4px 8px">删除</button>
      </td>
    `;
    const editBtn = tr.querySelector('.prod-edit-btn');
    const delBtn = tr.querySelector('.prod-del-btn');
    editBtn.addEventListener('click', () => openProdModal(x, idx));
    delBtn.addEventListener('click', () => deleteProduct(x));
    prodRows.appendChild(tr);
  });
}

function renderProdPager() {
  if (!prodPager) return;
  prodPager.innerHTML = '';
  const totalPages = Math.ceil(prodTotal / prodPageSize);
  if (totalPages <= 1) return;
  
  const createBtn = (text, page, disabled=false) => {
    const btn = document.createElement('button');
    btn.className = 'light-btn';
    btn.textContent = text;
    btn.disabled = disabled;
    if (page === prodPage) btn.style.background = '#0b1524'; // active style
    else btn.addEventListener('click', () => {
      prodPage = page;
      loadProducts();
    });
    return btn;
  };
  
  prodPager.appendChild(createBtn('上一页', prodPage-1, prodPage<=1));
  const span = document.createElement('span');
  span.style.padding = '8px';
  span.textContent = `${prodPage} / ${totalPages}`;
  prodPager.appendChild(span);
  prodPager.appendChild(createBtn('下一页', prodPage+1, prodPage>=totalPages));
}

function updateProductModalNav() {
  const total = currentProductPageList.length;
  const canNavigate = currentProductModalIndex >= 0;
  const subtitle = document.getElementById('prod-modal-subtitle');
  if (subtitle) {
    subtitle.textContent = currentProductModalStandaloneEdit
      ? '当前商品详情，可直接修改提醒数量等信息'
      : (canNavigate
          ? `当前页第 ${currentProductModalIndex + 1} / ${total} 个商品，可直接连续切换`
          : '新增商品');
  }
  if (prodPrev) {
    prodPrev.disabled = !canNavigate || currentProductModalIndex <= 0;
    prodPrev.style.display = currentProductModalStandaloneEdit ? 'none' : 'inline-flex';
  }
  if (prodNext) {
    prodNext.disabled = !canNavigate || currentProductModalIndex < 0 || currentProductModalIndex >= total - 1;
    prodNext.style.display = currentProductModalStandaloneEdit ? 'none' : 'inline-flex';
  }
}

async function openProdModal(x, listIndex = -1) {
  if (!prodModal) return;
  const isEdit = !!x;
  currentProductModalStandaloneEdit = isEdit && listIndex < 0;
  currentProductModalIndex = isEdit && listIndex >= 0 ? listIndex : -1;
  const stockInput = document.getElementById('prod-stock');
  document.getElementById('prod-modal-title').textContent = isEdit ? '编辑商品' : '新增商品';
  document.getElementById('prod-id').value = isEdit ? x.id : '';
  document.getElementById('prod-sku').value = x?.sku||'';
  document.getElementById('prod-barcode').value = x?.barcode||'';
  document.getElementById('prod-name').value = x?.name||'';
  document.getElementById('prod-name-cn').value = x?.name_cn||'';
  document.getElementById('prod-spec').value = x?.spec||'';
  document.getElementById('prod-created-at').value = x?.created_at ? new Date(Number(x.created_at)).toLocaleString() : '';
  document.getElementById('prod-tax').value = x?.tax_rate||'10';
  document.getElementById('prod-p1').value = x?.price1||'';
  document.getElementById('prod-p2').value = x?.price2||'';
  document.getElementById('prod-p3').value = x?.price3||'';
  document.getElementById('prod-p4').value = x?.price4||'';
  document.getElementById('prod-cost').value = x?.cost_price||'';
  document.getElementById('prod-stock').value = x?.stock||'0';
  document.getElementById('prod-remind-stock').value = Math.max(0, Number(x?.remind_stock || 0));
  await ensureProductDividendUsersLoaded();
  renderProductDividendUsers(normalizeDividendUsers(x?.dividend_users));
  if (stockInput) {
    stockInput.readOnly = true;
    stockInput.title = '库存请在商品库存页面调整';
  }
  document.getElementById('prod-image').value = x?.image||'';
  document.getElementById('prod-desc').value = x?.description||'';
  document.getElementById('prod-notes').value = x?.notes||'';
  
  if (prodFile) prodFile.value = ''; // Always clear file input on open
  
  if (x?.image) {
    prodPreview.src = x.image;
    prodPreview.style.display = 'block';
    prodFileName.textContent = '已上传图片';
  } else {
    prodPreview.style.display = 'none';
    prodFileName.textContent = '未选择文件';
  }
  
  // Clear validation styles
  document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  document.querySelectorAll('.invalid-label').forEach(el => el.classList.remove('invalid-label'));
  
  updateProductModalNav();
  prodModal.style.display = 'flex';
}

async function openProdModalFromFinishedStock(encodedProduct) {
  if (!can('sales_products', 'edit')) {
    alert('当前角色无商品编辑权限');
    return;
  }
  try {
    const product = JSON.parse(decodeURIComponent(String(encodedProduct || '')));
    await openProdModal(product, -1);
  } catch (e) {
    console.error(e);
    alert('商品详情打开失败，请刷新后重试');
  }
}

async function deleteProduct(x) {
  if (!confirm('确定删除该商品吗？')) return;
  const res = await fetchWithAuth(`/api/products/${x.id}`, { method: 'DELETE' });
  if (res.ok) {
    loadProducts();
  } else {
    alert('删除失败');
  }
}

if (prodAdd) prodAdd.addEventListener('click', () => openProdModal(null));
if (prodCancel) prodCancel.addEventListener('click', () => prodModal.style.display = 'none');
if (prodPrev) prodPrev.addEventListener('click', async () => {
  if (currentProductModalIndex <= 0) return;
  await openProdModal(currentProductPageList[currentProductModalIndex - 1], currentProductModalIndex - 1);
});
if (prodNext) prodNext.addEventListener('click', async () => {
  if (currentProductModalIndex < 0 || currentProductModalIndex >= currentProductPageList.length - 1) return;
  await openProdModal(currentProductPageList[currentProductModalIndex + 1], currentProductModalIndex + 1);
});
if (prodRefresh) prodRefresh.addEventListener('click', () => { prodPage=1; loadProducts(); });
if (prodSearch) prodSearch.addEventListener('change', () => { prodPage=1; loadProducts(); });

if (prodForm) {
  prodForm.addEventListener('submit', async e => {
    e.preventDefault();
    
    // Validation
    const reqFields = [
      { id:'prod-sku', label:'货号' },
      { id:'prod-name', label:'商品名称' },
      { id:'prod-p1', label:'价格1' },
      { id:'prod-tax', label:'税率' }
    ];
    let hasError = false;
    reqFields.forEach(f => {
      const el = document.getElementById(f.id);
      const val = (el.value||'').trim();
      const label = el.parentElement.querySelector('.label');
      
      el.classList.remove('invalid');
      if (label) label.classList.remove('invalid-label');
      
      if (!val) {
        hasError = true;
        el.classList.add('invalid');
        if (label) label.classList.add('invalid-label');
      }
    });
    
    if (hasError) return;

    const btn = document.getElementById('prod-save-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '保存中...';
    }

    try {
      const id = document.getElementById('prod-id').value;
      let imageUrl = document.getElementById('prod-image').value;
      
      const fileObj = prodFile.files[0];
      if (fileObj) {
        const fd = new FormData();
        fd.append('file', fileObj);
        try {
          const token = getAuthToken();
          const r = await fetch(API_BASE + '/api/upload', {
            method: 'POST',
            headers: token ? { 'Authorization': 'Bearer ' + token } : {},
            body: fd
          });
          if (r.ok) {
            const d = await r.json();
            imageUrl = d.url;
          } else {
            alert('图片上传失败，请重试');
            if (btn) { btn.disabled = false; btn.textContent = '保存'; }
            return;
          }
        } catch(e) {
          console.warn('product image upload failed', e);
          alert('图片上传失败，请检查网络');
          if (btn) { btn.disabled = false; btn.textContent = '保存'; }
          return;
        }
      }

      const dividendUsers = Array.from(document.querySelectorAll('.prod-dividend-user:checked')).map(el => String(el.value || '').trim()).filter(Boolean);
      const data = {
        sku: document.getElementById('prod-sku').value,
        barcode: document.getElementById('prod-barcode').value,
        name: document.getElementById('prod-name').value,
        name_cn: document.getElementById('prod-name-cn').value,
        spec: document.getElementById('prod-spec').value,
        tax_rate: document.getElementById('prod-tax').value,
        price1: document.getElementById('prod-p1').value,
        price2: document.getElementById('prod-p2').value,
        price3: document.getElementById('prod-p3').value,
        price4: document.getElementById('prod-p4').value,
        cost_price: document.getElementById('prod-cost').value,
        dividend_enabled: dividendUsers.length > 0,
        dividend_users: dividendUsers,
        stock: id ? (document.getElementById('prod-stock').value || '0') : '0',
        remind_stock: Math.max(0, Number(document.getElementById('prod-remind-stock').value || 0)),
        image: imageUrl,
        description: document.getElementById('prod-desc').value,
        notes: document.getElementById('prod-notes').value
      };
      
      const url = id ? `/api/products/${id}` : '/api/products';
      const method = id ? 'PUT' : 'POST';
      
      const res = await fetchWithAuth(url, {
        method,
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (res.ok) {
        await loadProducts();
        if (document.getElementById('page-finished-stock')?.style.display === 'block') {
          await loadFinishedStock(fsPage);
        }
        salesStatsDividendUsersLoaded = false;
        if (id) {
          const savedId = Number(id);
          const refreshedIndex = currentProductPageList.findIndex(item => Number(item?.id || 0) === savedId);
          if (refreshedIndex >= 0) {
            await openProdModal(currentProductPageList[refreshedIndex], refreshedIndex);
          }
        } else {
          document.getElementById('prod-id').value = '';
        }
        showAppToast('保存成功！');
      } else {
        try {
          const err = await res.json();
          if (err.error === 'duplicate_sku') alert('货号已存在');
          else alert('保存失败：' + (err.error || '请刷新后重试'));
        } catch { alert('保存失败，请刷新后重试'); }
      }
    } catch (e) {
      console.error(e);
      alert('保存出错: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '保存';
      }
    }
  });
}

function initSalesStatsFilters() {
  const now = new Date();
  const end = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`;
  if (salesStatsStart && !salesStatsStart.value) salesStatsStart.value = start;
  if (salesStatsEnd && !salesStatsEnd.value) salesStatsEnd.value = end;
}

function renderSalesStatsSummary(summary = {}, total = 0) {
  if (!salesStatsSummary) return;
  const assignedView = isAssignedSalesStatsView();
  const selectedDividendUser = String(salesStatsDividendUser?.value || '').trim();
  const cards = (assignedView || selectedDividendUser)
    ? [
        { label: '商品数', value: String(total || 0) },
        { label: '销售量', value: String(Number(summary.qty || 0)) }
      ]
    : [
        { label: '商品数', value: String(total || 0) },
        { label: '总销量', value: String(Number(summary.qty || 0)) },
        { label: '未税销售额', value: formatMoney(summary.sales_amount) },
        { label: '税额', value: formatMoney(summary.tax_amount) },
        { label: '总成本', value: formatMoney(summary.cost_amount) },
        { label: '总利润', value: formatMoney(summary.profit_amount) }
      ];
  salesStatsSummary.style.gridTemplateColumns = (assignedView || selectedDividendUser)
    ? 'repeat(2,minmax(140px,220px))'
    : 'repeat(6,minmax(120px,1fr))';
  salesStatsSummary.innerHTML = cards.map(card => `
    <div style="background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:14px 16px">
      <div style="font-size:12px; color:#94a3b8">${card.label}</div>
      <div style="margin-top:6px; font-size:20px; font-weight:700; color:#e2e8f0">${card.value}</div>
    </div>
  `).join('');
}

async function ensureSalesStatsDividendUsersLoaded() {
  if (!salesStatsDividendUser || salesStatsDividendUsersLoaded) return;
  if (isAssignedSalesStatsView()) {
    salesStatsDividendUsersLoaded = true;
    salesStatsDividendUser.innerHTML = '<option value="">全部</option>';
    return;
  }
  try {
    const data = await apiFetchJSON('/api/sales-stats/dividend-users');
    const list = Array.isArray(data?.list) ? data.list : [];
    const currentValue = String(salesStatsDividendUser.value || '');
    salesStatsDividendUser.innerHTML = `<option value="">全部</option>` + list.map(name => `
      <option value="${escapeHtml(name)}">${escapeHtml(name)}</option>
    `).join('');
    if (list.includes(currentValue)) salesStatsDividendUser.value = currentValue;
    salesStatsDividendUsersLoaded = true;
  } catch {
    salesStatsDividendUser.innerHTML = '<option value="">全部</option>';
  }
}

function renderSalesStatsLayout() {
  const assignedView = isAssignedSalesStatsView();
  if (salesStatsDividendUserWrap) salesStatsDividendUserWrap.style.display = assignedView ? 'none' : 'flex';
  if (salesStatsHeadRow) {
    salesStatsHeadRow.innerHTML = assignedView ? `
      <th>序号</th>
      <th>货号</th>
      <th>名称</th>
      <th>中文名称</th>
      <th>规格</th>
      <th>分红商品</th>
      <th>销量</th>
      <th>发票数</th>
    ` : `
      <th>序号</th>
      <th>货号</th>
      <th>名称</th>
      <th>中文名称</th>
      <th>规格</th>
      <th>分红商品</th>
      <th>销量</th>
      <th>销售额(未税)</th>
      <th>税额</th>
      <th>销售额(含税)</th>
      <th>成本价</th>
      <th>成本合计</th>
      <th>利润</th>
      <th>发票数</th>
    `;
  }
}

function renderSalesStats(list = []) {
  if (!salesStatsRows) return;
  const assignedView = isAssignedSalesStatsView();
  if (!list.length) {
    salesStatsRows.innerHTML = `<tr class="empty"><td colspan="${assignedView ? 8 : 14}">暂无统计数据</td></tr>`;
    return;
  }
  salesStatsRows.innerHTML = list.map((x, idx) => assignedView ? `
    <tr>
      <td>${idx + 1}</td>
      <td>${x.sku || ''}</td>
      <td>${x.name || ''}</td>
      <td>${x.name_cn || ''}</td>
      <td>${x.spec || ''}</td>
      <td>${isDividendProduct(x) ? '是' : '否'}</td>
      <td>${Number(x.sales_qty || 0)}</td>
      <td>${Number(x.invoice_count || 0)}</td>
    </tr>
  ` : `
    <tr>
      <td>${idx + 1}</td>
      <td>${x.sku || ''}</td>
      <td>${x.name || ''}</td>
      <td>${x.name_cn || ''}</td>
      <td>${x.spec || ''}</td>
      <td>${isDividendProduct(x) ? '是' : '否'}</td>
      <td>${Number(x.sales_qty || 0)}</td>
      <td>${formatMoney(x.sales_amount)}</td>
      <td>${formatMoney(x.tax_amount)}</td>
      <td>${formatMoney(x.gross_amount)}</td>
      <td>${formatMoney(x.cost_price)}</td>
      <td>${formatMoney(x.cost_amount)}</td>
      <td style="color:${Number(x.profit_amount || 0) >= 0 ? '#22c55e' : '#ef4444'}; font-weight:600">${formatMoney(x.profit_amount)}</td>
      <td>${Number(x.invoice_count || 0)}</td>
    </tr>
  `).join('');
}

async function loadSalesStats() {
  if (!salesStatsRows) return;
  initSalesStatsFilters();
  renderSalesStatsLayout();
  await ensureSalesStatsDividendUsersLoaded();
  salesStatsRows.innerHTML = `<tr class="empty"><td colspan="${isAssignedSalesStatsView() ? 8 : 14}">加载中...</td></tr>`;
  const params = new URLSearchParams({
    start: salesStatsStart?.value || '',
    end: salesStatsEnd?.value || '',
    q: salesStatsSearch?.value?.trim() || '',
    dividend_user: isAssignedSalesStatsView() ? '' : (salesStatsDividendUser?.value || '')
  });
  const res = await fetchWithAuth(`/api/sales-stats/products?${params.toString()}`);
  if (!res.ok) {
    salesStatsRows.innerHTML = `<tr class="empty"><td colspan="${isAssignedSalesStatsView() ? 8 : 14}">加载失败</td></tr>`;
    return;
  }
  const data = await res.json();
  renderSalesStatsSummary(data.summary || {}, data.total || 0);
  renderSalesStats(data.list || []);
}

salesStatsRefresh?.addEventListener('click', () => loadSalesStats());
salesStatsSearch?.addEventListener('change', () => loadSalesStats());
salesStatsDividendUser?.addEventListener('change', () => loadSalesStats());
salesStatsStart?.addEventListener('change', () => loadSalesStats());
salesStatsEnd?.addEventListener('change', () => loadSalesStats());

// Init Route
route();

// Note Delete Modal Logic
let pendingDeleteNoteId = null;
let pendingDeleteNoteIdx = null;
let pendingDeleteNoteContactId = null;
const noteDeleteModal = document.getElementById('note-delete-modal');
const noteDeleteOk = document.getElementById('note-delete-ok');
const noteDeleteCancel = document.getElementById('note-delete-cancel');

if (noteDeleteCancel) {
  noteDeleteCancel.addEventListener('click', () => {
    noteDeleteModal.style.display = 'none';
    pendingDeleteNoteId = null;
    pendingDeleteNoteIdx = null;
    pendingDeleteNoteContactId = null;
  });
}

if (noteDeleteOk) {
  noteDeleteOk.addEventListener('click', async () => {
    if (pendingDeleteNoteContactId) {
      // Real delete
      try {
        await apiFetchJSON(`/api/contacts/notes/${pendingDeleteNoteId}`, { method: 'DELETE' });
        loadContactNotes(pendingDeleteNoteContactId);
      } catch (e) {
        alert('删除失败');
      }
    } else {
      // Temp delete
      if (pendingDeleteNoteIdx !== null) {
        tempContactNotes.splice(pendingDeleteNoteIdx, 1);
        loadContactNotes(null);
      }
    }
    noteDeleteModal.style.display = 'none';
    pendingDeleteNoteId = null;
    pendingDeleteNoteIdx = null;
    pendingDeleteNoteContactId = null;
  });
}

// Contact Notes Logic
async function loadContactNotes(id) {
  const rows = document.getElementById('ct-notes-rows');
  rows.innerHTML = '<tr><td colspan="4" style="padding:12px; text-align:center; color:#64748b">加载中...</td></tr>';
  
  let list = [];
  if (id) {
    try {
      list = await apiFetchJSON(`/api/contacts/${id}/notes`);
    } catch (e) {
      console.error(e);
      rows.innerHTML = '<tr class="empty"><td colspan="4" style="padding:12px; text-align:center; color:#ef4444">加载失败</td></tr>';
      return;
    }
  } else {
    // Use temp notes
    list = tempContactNotes;
  }
  
  rows.innerHTML = '';
  if (list.length === 0) {
    rows.innerHTML = '<tr class="empty"><td colspan="4" style="padding:12px; text-align:center; color:#64748b">暂无备注</td></tr>';
    return;
  }
  
  list.forEach((n, idx) => {
    const tr = document.createElement('tr');
    const d = new Date(Number(n.created_at));
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    tr.innerHTML = `
      <td style="padding:8px; white-space:pre-wrap; vertical-align:top">${String(n.note||'')}</td>
      <td style="padding:8px; vertical-align:top">${String(n.created_by||'')}</td>
      <td style="padding:8px; vertical-align:top">${dateStr}</td>
      <td style="padding:8px; text-align:center; vertical-align:top; display:flex; gap:4px; justify-content:center">
        <button class="btn-icon btn-blue" style="width:24px; height:24px; font-size:12px; display:flex; align-items:center; justify-content:center">✎</button>
        <button class="btn-icon btn-red" style="width:24px; height:24px; font-size:12px; display:flex; align-items:center; justify-content:center">×</button>
      </td>
    `;
    tr.querySelector('.btn-blue').addEventListener('click', () => {
      editingNoteId = id ? n.id : idx;
      document.getElementById('ct-note-text').value = n.note || '';
      document.getElementById('ct-note-input-area').style.display = 'flex';
      document.getElementById('ct-note-text').focus();
    });
    tr.querySelector('.btn-red').addEventListener('click', () => {
      pendingDeleteNoteId = id ? n.id : null;
      pendingDeleteNoteIdx = idx;
      pendingDeleteNoteContactId = id;
      document.getElementById('note-delete-modal').style.display = 'flex';
    });
    rows.appendChild(tr);
  });
}

// Re-bind listeners to support replacing old ones (using onclick to avoid duplicate listeners)
const btnNew = document.getElementById('ct-note-new-btn');
if (btnNew) btnNew.onclick = () => {
  editingNoteId = null;
  document.getElementById('ct-note-input-area').style.display = 'flex';
  document.getElementById('ct-note-text').value = '';
  document.getElementById('ct-note-text').focus();
};

const btnCancel = document.getElementById('ct-note-cancel');
if (btnCancel) btnCancel.onclick = () => {
  editingNoteId = null;
  document.getElementById('ct-note-input-area').style.display = 'none';
  document.getElementById('ct-note-text').value = '';
};

const btnSave = document.getElementById('ct-note-save');
if (btnSave) btnSave.onclick = async () => {
  const id = document.getElementById('ct-id').value;
  const note = document.getElementById('ct-note-text').value.trim();
  
  if (!note) { alert('请输入备注内容'); return; }
  
  if (id) {
    // Save to server
    try {
      if (editingNoteId) {
        // Update existing
        await apiFetchJSON(`/api/contacts/notes/${editingNoteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note })
        });
      } else {
        // Create new
        await apiFetchJSON(`/api/contacts/${id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note })
        });
      }
      editingNoteId = null;
      document.getElementById('ct-note-text').value = '';
      document.getElementById('ct-note-input-area').style.display = 'none';
      loadContactNotes(id);
    } catch (e) {
      alert('保存失败');
    }
  } else {
    // Save to temp
    const user = getAuthUser();
    if (editingNoteId !== null) {
      // Update temp
      if (tempContactNotes[editingNoteId]) {
        tempContactNotes[editingNoteId].note = note;
      }
    } else {
      // Create temp
      tempContactNotes.push({
        note,
        created_at: Date.now(),
        created_by: user ? user.name : 'Unknown'
      });
    }
    editingNoteId = null;
    document.getElementById('ct-note-text').value = '';
    document.getElementById('ct-note-input-area').style.display = 'none';
    loadContactNotes(null);
  }
};


// New Shipping Label Logic
const shipPrevModal = document.getElementById('shipping-preview-modal');
const shipContent = document.getElementById('ship-content');
const shipPrevPrint = document.getElementById('ship-prev-print');
const shipPrevClose = document.getElementById('ship-prev-close');
let currentShippingInvId = null;
let shippingPrintPageStyle = null;
let shippingPrintFrame = null;

function setShippingPrintPage(enabled) {
  if (enabled) {
    if (shippingPrintPageStyle) return;
    shippingPrintPageStyle = document.createElement('style');
    shippingPrintPageStyle.id = 'shipping-print-page-style';
    shippingPrintPageStyle.textContent = '@media print { @page { size: A4 landscape; margin: 0; } html, body { width: 297mm !important; height: 210mm !important; } }';
    document.head.appendChild(shippingPrintPageStyle);
    return;
  }
  if (shippingPrintPageStyle) {
    shippingPrintPageStyle.remove();
    shippingPrintPageStyle = null;
  }
}

function fitShippingText(element, maxFontSize, minFontSize, maxLines) {
  if (!element) return;
  element.style.fontSize = `${maxFontSize}px`;
  const fits = fontSize => {
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || fontSize * 1.1;
    const maxHeight = lineHeight * maxLines + 2;
    return element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= maxHeight;
  };
  for (let size = maxFontSize; size >= minFontSize; size -= 1) {
    element.style.fontSize = `${size}px`;
    if (fits(size)) return;
  }
  element.style.fontSize = `${minFontSize}px`;
}

function fitShippingLabel() {
  const paper = document.getElementById('shipping-paper');
  if (!paper || !shipContent) return;
  const stackEl = shipContent.querySelector('.s-stack');
  shipContent.style.transform = 'scale(1)';
  shipContent.style.transformOrigin = 'center center';
  const addressEl = shipContent.querySelector('.s-address');
  const cityEl = shipContent.querySelector('.s-city');
  const metaEls = Array.from(shipContent.querySelectorAll('.s-meta'));
  const phoneEl = shipContent.querySelector('.s-phone');
  const contactEl = shipContent.querySelector('.s-contact');
  fitShippingText(addressEl, 72, 24, 4);
  fitShippingText(cityEl, 58, 24, 2);
  metaEls.forEach(el => fitShippingText(el, 40, 18, 3));
  fitShippingText(phoneEl, 58, 20, 2);
  fitShippingText(contactEl, 30, 18, 3);
  if (stackEl) {
    const widthScale = (shipContent.clientWidth - 8) / Math.max(stackEl.scrollWidth, 1);
    const heightScale = (shipContent.clientHeight - 8) / Math.max(stackEl.scrollHeight, 1);
    const scale = Math.min(widthScale, heightScale, 1);
    shipContent.style.transform = `scale(${Math.max(scale, 0.55)})`;
  }
}

function shippingLabelText(...parts) {
  return parts.map(x => String(x || '').trim()).filter(Boolean).join(' ');
}

function buildShippingLabelHtml(data) {
  const companyLine = shippingLabelText(data.company || data.name || '');
  const addressLine = shippingLabelText(data.address);
  const cityLine = shippingLabelText(data.zip, data.city);
  const regionLine = shippingLabelText(data.province, data.country);
  const phoneLine = data.phone ? `Tel: ${String(data.phone).trim()}` : '';
  const contactLine = shippingLabelText(data.contact);
  const blocks = [];
  if (companyLine) blocks.push(`<div class="s-meta s-block">${companyLine}</div>`);
  if (addressLine) blocks.push(`<div class="s-address s-block">${addressLine}</div>`);
  if (cityLine) blocks.push(`<div class="s-city s-block">${cityLine}</div>`);
  if (regionLine) blocks.push(`<div class="s-meta s-block">${regionLine}</div>`);
  if (phoneLine) blocks.push(`<div class="s-phone s-block">${phoneLine}</div>`);
  if (contactLine) blocks.push(`<div class="s-contact s-block">${contactLine}</div>`);
  if (!blocks.length && data.name) {
    blocks.push(`<div class="s-meta s-block">${String(data.name).trim()}</div>`);
  }
  return `<div class="s-stack">${blocks.join('')}</div>`;
}

function buildShippingPrintHtml(invNo) {
  const contentHtml = shipContent ? shipContent.innerHTML : '';
  const safeTitle = `Etiqueta-${invNo}`.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <style>
    @page { size: 297mm 210mm; margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      width: 297mm;
      height: 210mm;
      overflow: hidden;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    }
    body {
      display: flex;
      align-items: stretch;
      justify-content: stretch;
    }
    .shipping-paper {
      background: #fff;
      color: #000;
      width: 297mm;
      height: 210mm;
      padding: 14mm 16mm 12mm;
      margin: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      position: relative;
      box-sizing: border-box;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .shipping-paper .s-stack {
      width: 100%;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.9em;
      box-sizing: border-box;
    }
    .shipping-paper .s-block {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-wrap: anywhere;
      word-break: break-word;
      text-align: center;
      margin: 0;
    }
    .shipping-paper .s-address {
      font-size: 72px;
      font-weight: 800;
      line-height: 1.08;
      text-transform: lowercase;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .shipping-paper .s-city {
      font-size: 58px;
      font-weight: 800;
      text-transform: uppercase;
      line-height: 1.06;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .shipping-paper .s-meta {
      font-size: 40px;
      font-weight: 400;
      line-height: 1.1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .shipping-paper .s-phone {
      font-size: 58px;
      font-weight: 800;
      line-height: 1.03;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .shipping-paper .s-contact {
      font-size: 30px;
      line-height: 1.15;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div class="shipping-paper">
    <div id="ship-print-content" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;transform-origin:center center">${contentHtml}</div>
  </div>
  <script>
    (function() {
      function fitShippingElement(element, maxFontSize, minFontSize, maxLines) {
        if (!element) return;
        element.style.fontSize = maxFontSize + 'px';
        function fits() {
          var style = window.getComputedStyle(element);
          var lineHeight = parseFloat(style.lineHeight) || (parseFloat(element.style.fontSize) || maxFontSize) * 1.1;
          var maxHeight = lineHeight * maxLines + 2;
          return element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= maxHeight;
        }
        for (var size = maxFontSize; size >= minFontSize; size -= 1) {
          element.style.fontSize = size + 'px';
          if (fits()) return;
        }
        element.style.fontSize = minFontSize + 'px';
      }
      var content = document.getElementById('ship-print-content');
      var stack = document.querySelector('.s-stack');
      fitShippingElement(document.querySelector('.s-address'), 72, 22, 5);
      fitShippingElement(document.querySelector('.s-city'), 58, 24, 3);
      Array.prototype.forEach.call(document.querySelectorAll('.s-meta'), function(el) {
        fitShippingElement(el, 40, 18, 3);
      });
      fitShippingElement(document.querySelector('.s-phone'), 58, 20, 3);
      fitShippingElement(document.querySelector('.s-contact'), 30, 16, 3);
      if (content && stack) {
        content.style.transform = 'scale(1)';
        var widthScale = (content.clientWidth - 8) / Math.max(stack.scrollWidth, 1);
        var heightScale = (content.clientHeight - 8) / Math.max(stack.scrollHeight, 1);
        var scale = Math.min(widthScale, heightScale, 1);
        content.style.transform = 'scale(' + Math.max(scale, 0.55) + ')';
      }
      window.addEventListener('afterprint', function() {
        setTimeout(function() { window.close(); }, 50);
      });
    })();
  </script>
</body>
</html>`;
}

function printShippingLabelDocument(invNo) {
  if (shippingPrintFrame) {
    shippingPrintFrame.remove();
    shippingPrintFrame = null;
  }
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  shippingPrintFrame = frame;
  const cleanup = () => {
    if (shippingPrintFrame) {
      shippingPrintFrame.remove();
      shippingPrintFrame = null;
    }
  };
  const printWindow = frame.contentWindow;
  if (!printWindow) {
    cleanup();
    return;
  }
  printWindow.document.open();
  printWindow.document.write(buildShippingPrintHtml(invNo));
  printWindow.document.close();
  frame.onload = () => {
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch {}
      setTimeout(cleanup, 4000);
    }, 150);
  };
}

if (shipPrevClose) {
  shipPrevClose.addEventListener('click', () => {
    if (shipPrevModal) shipPrevModal.style.display = 'none';
  });
}

if (shipPrevPrint) {
  shipPrevPrint.addEventListener('click', async () => {
    let invNo = '';
    if (currentShippingInvId) {
      const inv = currentInvoices.find(x => String(x.id) === String(currentShippingInvId));
      if (inv) invNo = inv.invoice_no;
    }
    invNo = invNo || 'ShippingLabel';
    invNo = invNo.trim().replace(/\s+/g, '');
    fitShippingLabel();
    setTimeout(async () => {
      printShippingLabelDocument(invNo);
      if (currentShippingInvId) {
        const inv = currentInvoices.find(x => String(x.id) === String(currentShippingInvId));
        if (inv && !inv.shipping_printed) {
          try {
            await apiFetchJSON(`/api/invoices/${currentShippingInvId}/print-shipping`, { method:'PUT' });
            inv.shipping_printed = true;
            loadInvoices();
          } catch {}
        }
      }
    }, 100);
  });
}

window.printShippingLabel = async function(id) {
  currentShippingInvId = id;
  const inv = currentInvoices.find(x => String(x.id) === String(id));
  if (!inv) return;
  
  try { await ensureRealContactsLoaded(); } catch {}
  let cust = null;
  try {
    cust = await getInvoiceCustomerContact(inv.customer);
  } catch {}
  
  let name = String(inv.customer || '').trim();
  let company = String(inv.company_name || '').trim();
  let address = String(inv.customer_address || '').trim();
  let zip = String(inv.customer_zip || '').trim();
  let city = String(inv.customer_city || '').trim();
  let province = '';
  let country = String(inv.customer_country || '').trim();
  let phone = '';
  let contact = '';
  
  if (cust) {
    name = String(cust.name || '').trim() || name;
    company = String(cust.company || '').trim() || company || name;
    address = String(cust.ship_address || '').trim() || address || String(cust.address || '').trim();
    zip = String(cust.ship_zip || '').trim() || zip || String(cust.zip || '').trim();
    city = String(cust.ship_city || '').trim() || city || String(cust.city || '').trim();
    province = String(cust.ship_province || '').trim() || province || String(cust.province || '').trim();
    country = String(cust.ship_country || '').trim() || country || String(cust.country || '').trim();
    phone = String(cust.ship_phone || '').trim() || phone || String(cust.phone || '').trim();
    contact = String(cust.ship_contact || '').trim() || contact || String(cust.contact || '').trim();
  }
  company = company || name;
  const html = buildShippingLabelHtml({ name, company, address, zip, city, province, country, phone, contact });
  
  if (shipContent) shipContent.innerHTML = html;
  requestAnimationFrame(() => fitShippingLabel());
  if (shipPrevModal) shipPrevModal.style.display = 'flex';
};

// --- Daily Operations Logic ---

// Hash Change Handler for Daily Ops and General Routing
window.addEventListener('hashchange', handleRoute);
window.addEventListener('DOMContentLoaded', handleRoute);

async function handleRoute() {
  const hash = location.hash.slice(1) || 'home';
  if (!getAuthToken() || hash === 'login') {
    location.href = './login.html';
    return;
  }
  const u = getAuthUser(); 
  const roleName = (u?.role) || getUserRoleName(u?.name || '');
  
  // Non-admin accounts must refresh role permissions from server so old local cache
  // cannot keep hiding newly granted modules after a deployment or DB permission update.
  if (u && roleName !== '超级管理员') {
    try { await apiRolesList(); } catch(e) {}
  }
  
  // Ensure contacts are loaded globally once
  if (u && !contactsData.customers) {
    try { await loadAllContacts(); } catch(e) {}
  }
  
  // Hide all pages first
  document.querySelectorAll('[id^="page-"]').forEach(el => el.style.display = 'none');
  const gp = document.getElementById('global-pager'); if (gp) gp.style.display = 'none';
  const uw = document.getElementById('undo-wrap'); if (uw) uw.style.display = 'none';

  // Helper for permission
  const checkView = (module) => {
    if (roleName === '超级管理员') return true;
    const role = rolesData.find(r => r.name === roleName);
    return !!(role && role.perms && role.perms[module] && role.perms[module].view);
  };

  // Update sidebar visibility based on permissions
  document.querySelectorAll('.sidebar .nav a').forEach(a => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('#')) {
          let mod = href.slice(1).replace(/-/g, '_'); // e.g. 'sales-order' -> 'sales_order'
          if (mod === 'logistics') mod = 'daily_orders';
          if (checkView(mod)) {
              a.style.display = 'block';
          } else {
              a.style.display = 'none';
          }
      }
  });
  
  // Hide empty groups
  document.querySelectorAll('.sidebar .nav-group').forEach(group => {
      const children = Array.from(group.querySelectorAll('.nav-children a'));
      const hasVisible = children.some(a => a.style.display !== 'none');
      if (hasVisible) {
          group.style.display = 'block';
      } else {
          group.style.display = 'none';
      }
  });

  const ensureView = (module) => {
    if (!checkView(module)) {
      // Find the first module they can view
      const modulesInOrder = [
        { mod: 'home', hash: 'home' },
        { mod: 'tasks', hash: 'tasks' },
        { mod: 'daily_orders', hash: 'daily-orders' },
        { mod: 'finished_stock', hash: 'finished-stock' },
        { mod: 'raw_stock', hash: 'raw-stock' },
        { mod: 'production_review', hash: 'production-review' },
        { mod: 'event_records', hash: 'event-records' },
        { mod: 'knowledge_base', hash: 'knowledge-base' },
        { mod: 'sales_order', hash: 'sales-order' },
        { mod: 'sales_invoice', hash: 'sales-invoice' },
        { mod: 'sales_products', hash: 'sales-products' },
        { mod: 'sales_stats', hash: 'sales-stats' },
        { mod: 'ledger', hash: 'ledger' },
        { mod: 'payables', hash: 'payables' },
        { mod: 'contacts', hash: 'contacts' },
        { mod: 'categories', hash: 'categories' },
        { mod: 'accounts', hash: 'accounts' },
        { mod: 'sales_accounts', hash: 'sales-accounts' },
        { mod: 'company_info', hash: 'company-info' },
        { mod: 'user_accounts', hash: 'user-accounts' },
        { mod: 'role_accounts', hash: 'role-accounts' },
        { mod: 'system', hash: 'system' }
      ];
      let fallback = '';
      if (role && role.perms) {
          for (let m of modulesInOrder) {
              if (role.perms[m.mod] && role.perms[m.mod].view) {
                  fallback = m.hash;
                  break;
              }
          }
      }
      if (!fallback) fallback = 'empty'; // If no permissions at all
      if (location.hash !== '#' + fallback) {
          location.hash = '#' + fallback;
      }
      return false;
    }
    return true;
  };

  if (hash === 'home') {
    if (!ensureView('home')) return;
    document.getElementById('page-home').style.display = 'block';
    if (typeof homePeriodSel !== 'undefined' && homePeriodSel) homePeriodSel.value = 'month';
    if (typeof renderHomeChart === 'function') renderHomeChart('month');
    if (typeof salesPeriodSel !== 'undefined' && salesPeriodSel) salesPeriodSel.value = 'month';
    if (typeof renderSalesChart === 'function') renderSalesChart('month');
  } 
  else if (hash === 'tasks') {
    if (!ensureView('tasks')) return;
    document.getElementById('page-tasks').style.display = 'block';
    loadTasks(currentTaskTab);
  }
  else if (hash === 'ledger') {
    if (!ensureView('ledger')) return;
    document.getElementById('page-ledger').style.display = 'block';
    try {
      if (typeof ledgerHdrType !== 'undefined') { ledgerHdrType = 'all'; ledgerHdrCat = ''; ledgerHdrOwner = ''; ledgerHdrMethod = ''; ledgerHdrConfirm = 'all'; }
      if (typeof setLabel === 'function') {
        setLabel(document.getElementById('ld-type-label'), '类型', false);
        setLabel(document.getElementById('ld-cat-label'), '子类目', false);
        setLabel(document.getElementById('ld-owner-label'), '往来单位', false);
        setLabel(document.getElementById('ld-method-label'), '支付方式', false);
        setLabel(document.getElementById('ld-confirm-label'), '操作', false);
      }
    } catch {}
    loadLedgerFromServer().then(() => {
      if (typeof applyFilters === 'function') applyFilters();
    });
    loadAllContacts();
  }
  else if (hash === 'payables') {
    if (!ensureView('payables')) return;
    document.getElementById('page-payables').style.display = 'block';
    if (gp) gp.style.display = 'flex';
    try {
      if (typeof payFilterType !== 'undefined') { payFilterType = 'all'; payFilterPartnerName = ''; payFilterSalesName = ''; payFilterStatus = 'all'; payFilterOverdue = 'all'; payFilterAction = 'all'; payPage = 1; }
      const reset = (el, text) => { if (el) { el.textContent = text + ' ▾'; el.style.color = ''; } };
      reset(document.getElementById('th-type-label'), '款项类型');
      reset(document.getElementById('th-partner-label'), '往来单位');
      reset(document.getElementById('th-sales-label'), '业务员');
      reset(document.getElementById('th-arrears-label'), '欠款');
      reset(document.getElementById('th-trust-label'), '信任天数');
      reset(document.getElementById('th-action-label'), '操作');
    } catch {}
    loadPayablesFromServer().then(() => {
      if (typeof renderPayables === 'function') renderPayables();
    });
  }
  else if (hash === 'contacts') {
    if (!ensureView('contacts')) return;
    document.getElementById('page-contacts').style.display = 'block';
    if (gp) gp.style.display = 'flex';
    loadSalesPeople().then(() => {
      if (typeof renderContacts === 'function') renderContacts();
    });
  }
  else if (hash === 'sales-order') {
    if (!ensureView('sales_order')) return;
    document.getElementById('page-sales-order').style.display = 'block';
    Promise.all([loadAllContacts(), loadSalesPeople()]).then(async () => {
      if (typeof loadProductSelector === 'function') await loadProductSelector();
      if (typeof pendingEditInvoiceId !== 'undefined' && pendingEditInvoiceId) {
        await loadInvoiceForEdit(pendingEditInvoiceId);
        pendingEditInvoiceId = null;
      } else {
        if (typeof soCustomer !== 'undefined') soCustomer.value = '';
        if (typeof soUsePrice !== 'undefined') soUsePrice.value = '';
        if (typeof soNotes !== 'undefined') soNotes.value = '';
        if (typeof soItems !== 'undefined') soItems.innerHTML = '';
        if (typeof updateSoTotal === 'function') updateSoTotal();
        if (typeof soInvoiceNo !== 'undefined') delete soInvoiceNo.dataset.id;
        if (typeof loadNextInvoiceNo === 'function') await loadNextInvoiceNo();
      }
    });
  }
  else if (hash === 'sales-invoice') {
    if (!ensureView('sales_invoice')) return;
    document.getElementById('page-sales-invoice').style.display = 'block';
    if (typeof invPage !== 'undefined') invPage = 1;
    loadAllContacts().then(() => {
      loadInvoices();
    });
  }
  else if (hash === 'sales-products') {
    if (!ensureView('sales_products')) return;
    document.getElementById('page-sales-products').style.display = 'block';
    if (typeof prodPage !== 'undefined') prodPage = 1;
    loadProducts();
  }
  else if (hash === 'sales-stats') {
    if (!ensureView('sales_stats')) return;
    document.getElementById('page-sales-stats').style.display = 'block';
    loadSalesStats();
  }
  else if (hash.startsWith('partner-orders')) {
    if (!ensureView('contacts')) return;
    const nameParam = decodeURIComponent((hash.split(':')[1] || '').trim());
    const page = document.getElementById('page-partner-orders');
    if (page) {
        page.style.display = 'block';
        if (typeof partnerOrdersHead !== 'undefined') partnerOrdersHead.textContent = '往来单位：' + (nameParam || '');
        if (typeof partnerOrdersRows !== 'undefined') partnerOrdersRows.innerHTML = '';
        loadPayablesFromServer().then(() => {
          const list = payRecords.filter(r => (r.partner || '') === (nameParam || ''));
          list.forEach(r => {
              const tr = document.createElement('tr');
              const paid = r.paid || 0;
              const arrears = Math.max(0, (r.amount || 0) - paid);
              [r.type, r.partner || '', r.doc || '', (r.amount||0).toFixed(2), (r.invoiceNo||''), (Number(r.invoiceAmount||0).toFixed(2)), paid.toFixed(2), arrears.toFixed(2), r.date || ''].forEach((v,i) => {
              const td = document.createElement('td');
              td.textContent = String(v);
              if (i===7 && arrears>0) td.style.color = '#ef4444';
              tr.appendChild(td);
              });
              partnerOrdersRows.appendChild(tr);
          });
        });
    }
  }
  else if (hash === 'categories') {
    if (!ensureView('categories')) return;
    document.getElementById('page-categories').style.display = 'block';
    apiCategoriesList().then(() => {
      if (typeof renderCats === 'function') renderCats();
    });
  }
  else if (hash === 'accounts') {
    if (!ensureView('accounts')) return;
    document.getElementById('page-accounts').style.display = 'block';
    apiAccountsList().then(() => {
      if (typeof refreshAccountOptions === 'function') refreshAccountOptions();
      if (typeof renderAccounts === 'function') renderAccounts();
    });
  }
  else if (hash === 'user-accounts') {
    if (!ensureView('user_accounts')) return;
    document.getElementById('page-user-accounts').style.display = 'block';
    apiUsersList().then(() => {
      if (typeof renderUserAccounts === 'function') renderUserAccounts();
    });
  }
  else if (hash === 'role-accounts') {
    if (!ensureView('role_accounts')) return;
    document.getElementById('page-role-accounts').style.display = 'block';
    apiRolesList().then(() => {
      if (typeof renderRoles === 'function') renderRoles();
    });
  }
  else if (hash === 'sales-accounts') {
    if (!ensureView('sales_accounts')) return;
    document.getElementById('page-sales-accounts').style.display = 'block';
    apiSalesList().then(() => {
      if (typeof renderSales === 'function') renderSales();
    });
  }
  else if (hash === 'role-perms') {
    if (!ensureView('role_accounts')) return;
    document.getElementById('page-role-perms').style.display = 'block';
  }
  else if (hash === 'system') {
    if (!ensureView('system')) return;
    document.getElementById('page-system').style.display = 'block';
  }
  else if (hash === 'company-info') {
    if (!ensureView('company_info')) return;
    document.getElementById('page-company-info').style.display = 'block';
    syncCompanyInfoAccess();
    loadCompanyInfo();
  }
  else if (hash === 'daily-orders') {
    if (!ensureView('daily_orders')) return;
    document.getElementById('page-daily-orders').style.display = 'block';
    loadDailyOrders();
  }
  else if (hash === 'logistics') {
    if (!ensureView('daily_orders')) return;
    document.getElementById('page-logistics').style.display = 'block';
    loadLogistics();
  }
  else if (hash === 'finished-stock') {
    if (pendingFinishedStockTab === 'review') {
      if (!ensureView('production_review')) return;
    } else if (!ensureView('finished_stock')) return;
    document.getElementById('page-finished-stock').style.display = 'block';
    const targetTab = pendingFinishedStockTab || 'stock';
    pendingFinishedStockTab = '';
    switchFinishedStockTab(targetTab);
  }
  else if (hash === 'raw-stock') {
    if (!ensureView('raw_stock')) return;
    document.getElementById('page-raw-stock').style.display = 'block';
    switchRawStockTab('stock');
  }
  else if (hash === 'production-review') {
    if (!ensureView('production_review')) return;
    pendingFinishedStockTab = 'review';
    location.hash = '#finished-stock';
    return;
  }
  else if (hash === 'event-records') {
    if (!ensureView('event_records')) return;
    document.getElementById('page-event-records').style.display = 'block';
    loadEventRecords('ongoing');
  }
  else if (hash === 'knowledge-base') {
    if (!ensureView('knowledge_base')) return;
    document.getElementById('page-knowledge-base').style.display = 'block';
    loadKnowledgeBase('internal');
  }
  else if (hash.startsWith('stock-history')) {
    if (!ensureView('finished_stock') && !ensureView('raw_stock')) return;
    const id = hash.split('=')[1];
    document.getElementById('page-stock-history').style.display = 'block';
    loadStockHistory(id);
  }
  else {
    const t = document.getElementById('page-' + hash);
    if (t) t.style.display = 'block';
    else {
        const empty = document.getElementById('page-empty');
        if (empty) empty.style.display = 'block';
    }
  }

  // Update nav active state
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  const link = document.querySelector(`.nav a[href="#${hash}"]`);
  if (link) {
      link.classList.add('active');
      const group = link.closest('.nav-group');
      if (group) {
        const h = group.querySelector('.nav-group-header');
        const c = group.querySelector('.nav-children');
        if (h) h.classList.remove('collapsed');
        if (c) c.classList.remove('collapsed');
      }
  }
}

// Tasks
let currentTaskTab = 'new';
let currentTaskPage = 1;
let currentTasksList = [];
let currentAutoTaskList = [];

function formatTaskTimeLimit(limitDays) {
  const val = Number(limitDays || 0);
  if (!val) return '-';
  if (val === 7) return '一周内';
  if (val === 30) return '一个月内';
  return `${val}天内`;
}

function formatDateTimeSafe(ts) {
  const num = Number(ts || 0);
  if (!num) return '-';
  return new Date(num).toLocaleString();
}

function formatDateTimeTwoLines(ts) {
  const num = Number(ts || 0);
  if (!num) return '-';
  const d = new Date(num);
  const dateText = d.toLocaleDateString();
  const timeText = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<div>${escapeHtml(dateText)}</div><div style="font-size:12px; color:#94a3b8; line-height:1.2; margin-top:2px">${escapeHtml(timeText)}</div>`;
}

function formatDateTimeLocalInput(ts) {
  const num = Number(ts || 0);
  if (!num) return '';
  const d = new Date(num);
  const pad = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readDateTimeLocalInput(id) {
  const raw = String(document.getElementById(id)?.value || '').trim();
  if (!raw) return 0;
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function formatAutoTaskInterval(months) {
  const val = Number(months || 0);
  if (val === 0) return '仅限一次';
  return val > 0 ? `每${val}个月` : '-';
}

function syncTaskModeUI(tab) {
  const manualPanel = document.getElementById('task-manual-panel');
  const manualTableWrap = document.getElementById('task-manual-table-wrap');
  const manualPager = document.getElementById('task-pager');
  const autoPanel = document.getElementById('auto-task-panel');
  const createBtn = document.getElementById('task-create-btn');
  const autoCreateBtn = document.getElementById('auto-task-create-btn');
  const isAuto = tab === 'auto';
  if (manualPanel) manualPanel.style.display = 'block';
  if (manualTableWrap) manualTableWrap.style.display = isAuto ? 'none' : 'block';
  if (manualPager) manualPager.style.display = isAuto ? 'none' : 'flex';
  if (autoPanel) autoPanel.style.display = isAuto ? 'block' : 'none';
  if (createBtn) createBtn.style.display = isAuto ? 'none' : 'inline-flex';
  if (autoCreateBtn) autoCreateBtn.style.display = isAuto ? 'inline-flex' : 'none';
}

async function loadAutoTasks() {
  const res = await fetchWithAuth(`/api/auto-tasks?_t=${Date.now()}`);
  if (!res.ok) return;
  const list = await res.json();
  currentAutoTaskList = Array.isArray(list) ? list : [];
  const tbody = document.getElementById('auto-task-rows');
  if (!tbody) return;
  if (!currentAutoTaskList.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="11">暂无自动任务</td></tr>';
    return;
  }
  tbody.innerHTML = currentAutoTaskList.map((t, idx) => `
    <tr>
      <td>${currentAutoTaskList.length - idx}</td>
      <td style="white-space:normal; word-break:break-word; line-height:1.5; font-weight:600">${escapeHtml(t.title || '')}</td>
      <td style="white-space:pre-wrap; word-break:break-word; line-height:1.5; color:#cbd5e1">${escapeHtml(t.description || '')}</td>
      <td style="white-space:normal; word-break:break-word">${escapeHtml(t.assigned_to || '')}</td>
      <td style="white-space:normal">${escapeHtml(formatAutoTaskInterval(t.interval_months))}</td>
      <td style="white-space:normal">${escapeHtml(formatTaskTimeLimit(t.time_limit))}</td>
      <td style="white-space:normal; line-height:1.25">${formatDateTimeTwoLines(t.start_at)}</td>
      <td style="white-space:normal; line-height:1.25">${formatDateTimeTwoLines(t.next_generate_at)}</td>
      <td style="white-space:normal; line-height:1.25"><div style="word-break:break-word">${escapeHtml(t.created_by || '')}</div><div style="font-size:12px; color:#94a3b8; margin-top:2px">${formatDateTimeTwoLines(t.created_at)}</div></td>
      <td style="white-space:normal"><span class="tag ${t.active ? 'green' : 'orange'}">${t.active ? '启用中' : '已停用'}</span></td>
      <td style="white-space:normal">
        <div style="display:flex; flex-direction:column; gap:8px; align-items:stretch">
          <button class="btn-sm btn-secondary" style="width:100%; margin:0" onclick="editAutoTask(${t.id})">编辑</button>
          <button class="btn-sm" style="width:100%; margin:0" onclick="toggleAutoTask(${t.id}, ${t.active ? 'false' : 'true'})">${t.active ? '停用' : '启用'}</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadTasks(tab = 'new', btn = null, page = 1) {
  currentTaskTab = tab;
  currentTaskPage = page;
  syncTaskModeUI(tab);

  if (btn) {
    document.querySelectorAll('#page-tasks .tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  } else {
    // Sync tab button state if loaded without click
    const tBtn = document.querySelector(`#page-tasks .tab[data-tab="${tab}"]`);
    if (tBtn) {
      document.querySelectorAll('#page-tasks .tab').forEach(b => b.classList.remove('active'));
      tBtn.classList.add('active');
    }
  }
  if (tab === 'auto') {
    await loadAutoTasks();
    return;
  }
  
  // Map tab to status
  let status = 'new';
  if (tab === 'review') status = 'review';
  else if (tab === 'completed') status = 'completed';

  const res = await fetchWithAuth(`/api/tasks?status=${status}&page=${page}&size=100&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  
  // Handle response format { list, total, stats }
  const list = data.list || [];
  currentTasksList = list;
  const total = data.total || 0;
  const stats = data.stats || { new_count: 0, review_count: 0 };

  // Update Badges
  const newCount = Number(stats.new_count || 0);
  const reviewCount = Number(stats.review_count || 0);
  const totalCount = newCount + reviewCount;

  const updateBadge = (id, count) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = count;
      el.style.display = count > 0 ? 'inline-block' : 'none';
    }
  };
  updateBadge('nav-task-badge', totalCount);
  updateBadge('tab-new-badge', newCount);
  updateBadge('tab-review-badge', reviewCount);

  const tbody = document.getElementById('task-rows');
  if (!tbody) return;
  
  if (list.length === 0) {
    tbody.innerHTML = '<tr class="empty"><td colspan="8">暂无任务</td></tr>';
    renderTaskPager(0, 1, 100);
    return;
  }
  
  const meRes = await fetchWithAuth('/api/auth/me');
  const me = await meRes.json();
  const isAdmin = me.user?.role === '超级管理员';
  const myName = me.user?.name;
  
  tbody.innerHTML = list.map((t, idx) => {
    let action = '';
    if (t.status === 'pending' || !t.status) {
        if (t.assigned_to === myName || isAdmin) {
            action = `<button class="btn-sm" onclick="completeTask(${t.id})">完成任务</button>`;
        }
        if (t.created_by === myName || isAdmin) {
            action += `<button class="btn-sm btn-secondary" style="margin-left:4px" onclick="editTask(${t.id})">修改</button>`;
        }
    } else if (t.status === 'waiting_audit') {
        if (isAdmin) {
            action = `<button class="btn-sm" onclick="auditTask(${t.id})">确认审核</button>`;
        } else {
            action = '<span style="color:#666;font-size:12px">等待审核</span>';
        }
    }

    let descInfo = t.description || '';
    if (t.completion_desc) {
      descInfo += `<div style="margin-top:4px; font-size:12px; color:#94a3b8; border-top:1px dashed #334155; padding-top:4px">
        <span style="color:#22c55e">完成备注:</span> ${t.completion_desc}
      </div>`;
    }
    if (t.completion_image) {
      if (t.completion_image.startsWith('data:image/')) {
        descInfo += `<div style="margin-top:4px">
          <img src="${t.completion_image}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; cursor:zoom-in; border:1px solid #334155" onclick="showTaskImage(this.src)" title="点击放大">
        </div>`;
      } else {
        descInfo += `<div style="margin-top:4px">
          <a href="${t.completion_image}" download="任务附件" style="display:inline-block; padding:4px 8px; background:#334155; color:#cbd5e1; border-radius:4px; font-size:12px; text-decoration:none">📥 下载附件</a>
        </div>`;
      }
    }

    let assignInfo = t.assigned_to || '';
    if (t.completed_at) {
        assignInfo += `<div style="margin-top:4px; font-size:11px; color:#94a3b8">完成于:<br>${new Date(Number(t.completed_at)).toLocaleString()}</div>`;
    }

    let timeLimitText = '-';
    if (t.time_limit) {
      const limitDays = Number(t.time_limit);
      let label = limitDays + '天内';
      if (limitDays === 7) label = '一周内';
      if (limitDays === 30) label = '一个月';
      
      const deadline = Number(t.created_at) + limitDays * 24 * 60 * 60 * 1000;
      const isOverdue = (t.status === 'pending' || !t.status) && Date.now() > deadline;
      
      timeLimitText = isOverdue ? `<span style="color:#ef4444; font-weight:bold">已逾期</span>` : label;
    }

    return `
    <tr>
      <td>${total - (page - 1) * 100 - idx}</td>
      <td>${t.title||''}</td>
      <td>${descInfo}</td>
      <td>${assignInfo}</td>
      <td>${t.created_by||''}<br><span style="font-size:12px;color:#666">${new Date(Number(t.created_at)).toLocaleString()}</span></td>
      <td>${timeLimitText}</td>
      <td><span class="tag ${t.status==='completed'?'green':(t.status==='waiting_audit'?'orange':'blue')}" style="cursor:pointer; text-decoration:underline" onclick="openTaskDetailsModal(${t.id})" title="点击查看详情">
        ${t.status==='completed'?'已完成':(t.status==='waiting_audit'?'审核中':'新任务')}
      </span></td>
      <td>${action}</td>
    </tr>
  `}).join('');

  renderTaskPager(total, page, 100);
}

function renderTaskPager(total, page, size) {
  const totalPages = Math.ceil(total / size);
  const pager = document.getElementById('task-pager');
  if (!pager) return;
  
  if (totalPages <= 1) {
    pager.style.display = 'none';
    return;
  }
  
  pager.style.display = 'flex';
  let html = '';
  
  // Prev
  html += `<button class="btn-secondary" ${page <= 1 ? 'disabled' : ''} onclick="loadTasks(currentTaskTab, null, ${page - 1})">上一页</button>`;
  
  // Page info
  html += `<span style="font-size:14px; color:#cbd5e1">第 ${page} / ${totalPages} 页</span>`;
  
  // Next
  html += `<button class="btn-secondary" ${page >= totalPages ? 'disabled' : ''} onclick="loadTasks(currentTaskTab, null, ${page + 1})">下一页</button>`;
  
  pager.innerHTML = html;
}

function fallbackTaskUsers() {
  return [
    { name: '超级管理员', role: '超级管理员' },
    { name: 'shuangqun', role: '股东' },
    { name: 'caiwu', role: '财务' },
    { name: 'kefu', role: '客服' }
  ];
}

async function loadAssignableUsers(listId, inputId) {
  const listDiv = document.getElementById(listId);
  if (!listDiv) return;
  listDiv.innerHTML = '加载中...';
  try {
    const r = await fetchWithAuth('/api/auth/users');
    if (!r.ok) throw new Error('API Error: ' + r.status);
    const users = await r.json();
    renderAssignableUsers(Array.isArray(users) && users.length ? users : fallbackTaskUsers(), listId, inputId);
  } catch (e) {
    console.warn('Failed to load users, using fallback:', e);
    renderAssignableUsers(fallbackTaskUsers(), listId, inputId);
  }
}

function renderAssignableUsers(users, listId, inputId) {
  const listDiv = document.getElementById(listId);
  const currentAssign = document.getElementById(inputId)?.value || '';
  if (!listDiv) return;
  listDiv.innerHTML = users.map(u => {
    const selected = u.name === currentAssign;
    return `
      <div class="user-chip" onclick="selectTaskAssignee('${listId}', '${inputId}', '${encodeURIComponent(u.name)}')"
           style="border:1px solid ${selected ? '#1a73e8' : '#334155'}; padding:8px; border-radius:6px; cursor:pointer; text-align:center; background:${selected ? '#1a73e8' : '#0f172a'}; color:${selected ? '#fff' : '#cbd5e1'}; user-select:none; display:flex; flex-direction:column; align-items:center; gap:4px">
        <span style="font-weight:600">${escapeHtml(u.name || '')}</span>
        <span style="font-size:10px; opacity:0.7; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px">${escapeHtml(u.role || '员工')}</span>
      </div>
    `;
  }).join('');
}

window.selectTaskAssignee = function(listId, inputId, encodedName) {
  const name = decodeURIComponent(encodedName || '');
  const input = document.getElementById(inputId);
  if (input) input.value = name;
  const listDiv = document.getElementById(listId);
  if (!listDiv) return;
  Array.from(listDiv.querySelectorAll('.user-chip')).forEach(chip => {
    chip.style.borderColor = '#334155';
    chip.style.background = '#0f172a';
    chip.style.color = '#cbd5e1';
  });
  const target = Array.from(listDiv.querySelectorAll('.user-chip')).find(chip => chip.textContent.includes(name));
  if (target) {
    target.style.borderColor = '#1a73e8';
    target.style.background = '#1a73e8';
    target.style.color = '#fff';
  }
};

function openTaskModal() {
  const m = document.getElementById('task-modal');
  if (!m) return;
  m.style.display = 'flex';
  document.getElementById('task-modal-title').textContent = '创建任务';
  document.getElementById('task-id').value = '';
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value = '';
  document.getElementById('task-assign').value = '';
  const tl = document.getElementById('task-time-limit');
  if (tl) tl.value = '1';
  loadAssignableUsers('task-assign-list', 'task-assign');
}
window.editTask = function(id) {
    const t = currentTasksList.find(x => x.id === id);
    if (!t) return;
    openTaskModal();
    document.getElementById('task-modal-title').textContent = '修改任务';
    document.getElementById('task-id').value = t.id;
    document.getElementById('task-title').value = t.title || '';
    document.getElementById('task-desc').value = t.description || '';
    document.getElementById('task-assign').value = t.assigned_to || '';
    if (document.getElementById('task-time-limit')) {
        document.getElementById('task-time-limit').value = t.time_limit || '1';
    }
    loadAssignableUsers('task-assign-list', 'task-assign');
}
window.openTaskDetailsModal = function(id) {
    const t = currentTasksList.find(x => x.id === id);
    if (!t) return;
    const m = document.getElementById('task-details-modal');
    const c = document.getElementById('task-details-content');
    if (m && c) {
        let statusStr = t.status === 'completed' ? '<span style="color:#22c55e">已完成</span>' : (t.status === 'waiting_audit' ? '<span style="color:#f97316">审核中</span>' : '<span style="color:#3b82f6">新任务</span>');
        let html = `
            <div style="margin-bottom:12px; font-size:18px; font-weight:bold; color:#fff">${t.title || '无标题'}</div>
            <div style="margin-bottom:8px"><strong>状态：</strong> ${statusStr}</div>
            <div style="margin-bottom:8px"><strong>指派给：</strong> ${t.assigned_to || '-'}</div>
            <div style="margin-bottom:8px"><strong>创建人：</strong> ${t.created_by || '-'}</div>
            <div style="margin-bottom:8px"><strong>创建时间：</strong> ${new Date(Number(t.created_at)).toLocaleString()}</div>
        `;
        if (t.time_limit) {
            const limitDays = Number(t.time_limit);
            let label = limitDays + '天内';
            if (limitDays === 7) label = '一周内';
            if (limitDays === 30) label = '一个月';
            html += `<div style="margin-bottom:8px"><strong>时限：</strong> ${label}</div>`;
        }
        if (t.description) {
            html += `<div style="margin-bottom:12px; margin-top:16px; border-top:1px solid #334155; padding-top:12px"><strong>任务描述：</strong><br><div style="white-space:pre-wrap; margin-top:8px; color:#cbd5e1">${t.description}</div></div>`;
        }
        if (t.completion_desc) {
            html += `<div style="margin-bottom:12px; margin-top:16px; border-top:1px dashed #334155; padding-top:12px"><strong>完成备注：</strong><br><div style="white-space:pre-wrap; margin-top:8px; color:#22c55e">${t.completion_desc}</div></div>`;
        }
        if (t.completion_image) {
            if (t.completion_image.startsWith('data:image/')) {
                html += `<div style="margin-bottom:8px"><strong>完成附件：</strong><br><img src="${t.completion_image}" style="max-width:100%; max-height:200px; border-radius:4px; margin-top:8px; cursor:zoom-in; border:1px solid #334155" onclick="showTaskImage(this.src)" title="点击放大"></div>`;
            } else {
                html += `<div style="margin-bottom:8px"><strong>完成附件：</strong><br><a href="${t.completion_image}" download="任务附件" style="display:inline-block; margin-top:8px; padding:6px 12px; background:#334155; color:#cbd5e1; border-radius:4px; font-size:13px; text-decoration:none">📥 下载附件</a></div>`;
            }
        }
        if (t.completed_at) {
            html += `<div style="margin-bottom:8px; color:#94a3b8"><strong>完成时间：</strong> ${new Date(Number(t.completed_at)).toLocaleString()}</div>`;
        }
        c.innerHTML = html;
        m.style.display = 'flex';
    }
}
function closeTaskModal() {
  const m = document.getElementById('task-modal');
  if (m) m.style.display = 'none';
}
async function saveTask() {
  const id = document.getElementById('task-id').value;
  const title = document.getElementById('task-title').value;
  const desc = document.getElementById('task-desc').value;
  const assign = document.getElementById('task-assign').value;
  const timeLimit = document.getElementById('task-time-limit') ? document.getElementById('task-time-limit').value : '0';
  if (!title) return alert('请输入标题');
  if (!assign) return alert('请选择指派人员');
  
  if (id) {
    await fetchWithAuth('/api/tasks/' + id, {
      method: 'PUT',
      body: JSON.stringify({ title, description: desc, assigned_to: assign, time_limit: timeLimit })
    });
  } else {
    await fetchWithAuth('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, desc, assign, timeLimit })
    });
  }
  closeTaskModal();
  loadTasks(currentTaskTab);
  // Update badge immediately after creation if it's new
  if (!id) {
    const badge = document.getElementById('nav-task-badge');
    if (badge) {
      const count = Number(badge.textContent || 0) + 1;
      badge.textContent = count;
      badge.style.display = 'inline-block';
    }
  }
}

function openAutoTaskModal() {
  const m = document.getElementById('auto-task-modal');
  if (!m) return;
  m.style.display = 'flex';
  document.getElementById('auto-task-modal-title').textContent = '添加自动任务';
  document.getElementById('auto-task-id').value = '';
  document.getElementById('auto-task-title').value = '';
  document.getElementById('auto-task-desc').value = '';
  document.getElementById('auto-task-assign').value = '';
  document.getElementById('auto-task-interval').value = '6';
  document.getElementById('auto-task-time-limit').value = '1';
  document.getElementById('auto-task-start-at').value = formatDateTimeLocalInput(Date.now());
  document.getElementById('auto-task-active').checked = true;
  loadAssignableUsers('auto-task-assign-list', 'auto-task-assign');
}
window.editAutoTask = function(id) {
  const t = currentAutoTaskList.find(x => Number(x.id) === Number(id));
  if (!t) return;
  openAutoTaskModal();
  document.getElementById('auto-task-modal-title').textContent = '修改自动任务';
  document.getElementById('auto-task-id').value = t.id;
  document.getElementById('auto-task-title').value = t.title || '';
  document.getElementById('auto-task-desc').value = t.description || '';
  document.getElementById('auto-task-assign').value = t.assigned_to || '';
  document.getElementById('auto-task-interval').value = String(t.interval_months ?? 6);
  document.getElementById('auto-task-time-limit').value = String(t.time_limit || 1);
  document.getElementById('auto-task-start-at').value = formatDateTimeLocalInput(t.start_at || t.created_at || 0);
  document.getElementById('auto-task-active').checked = !!t.active;
  loadAssignableUsers('auto-task-assign-list', 'auto-task-assign');
};
function closeAutoTaskModal() {
  const m = document.getElementById('auto-task-modal');
  if (m) m.style.display = 'none';
}
async function saveAutoTask() {
  const id = document.getElementById('auto-task-id').value;
  const title = document.getElementById('auto-task-title').value.trim();
  const description = document.getElementById('auto-task-desc').value.trim();
  const assigned_to = document.getElementById('auto-task-assign').value.trim();
  const interval_months = document.getElementById('auto-task-interval').value;
  const time_limit = document.getElementById('auto-task-time-limit').value;
  const start_at = readDateTimeLocalInput('auto-task-start-at');
  const active = document.getElementById('auto-task-active').checked;
  if (!title) return alert('请输入标题');
  if (!assigned_to) return alert('请选择指派人员');
  if (!start_at) return alert('请选择开始时间');
  const payload = { title, description, assigned_to, interval_months, time_limit, start_at, active };
  const res = await fetchWithAuth(id ? `/api/auto-tasks/${id}` : '/api/auto-tasks', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload)
  });
  if (!res.ok) return alert('保存失败');
  closeAutoTaskModal();
  loadTasks('auto');
}
window.saveAutoTask = saveAutoTask;
window.toggleAutoTask = async function(id, active) {
  const t = currentAutoTaskList.find(x => Number(x.id) === Number(id));
  if (!t) return;
  const res = await fetchWithAuth(`/api/auto-tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: t.title || '',
      description: t.description || '',
      assigned_to: t.assigned_to || '',
      interval_months: t.interval_months ?? 1,
      time_limit: t.time_limit || 0,
      start_at: t.start_at || t.created_at || Date.now(),
      active: !!active
    })
  });
  if (!res.ok) return alert('操作失败');
  loadTasks('auto');
};
function openCompleteTaskModal(id) {
  const m = document.getElementById('complete-task-modal');
  if (m) {
    m.style.display = 'flex';
    document.getElementById('complete-task-id').value = id;
    document.getElementById('complete-task-image').value = '';
    document.getElementById('complete-task-image-preview').style.display = 'none';
    const filePrev = document.getElementById('complete-task-file-preview');
    if (filePrev) filePrev.style.display = 'none';
    document.getElementById('complete-task-image-base64').value = '';
    document.getElementById('complete-task-desc').value = '';
  }
}

function closeCompleteTaskModal() {
  const m = document.getElementById('complete-task-modal');
  if (m) m.style.display = 'none';
}

window.previewCompleteTaskImage = function(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
      const prevImg = document.getElementById('complete-task-image-preview');
      const prevFile = document.getElementById('complete-task-file-preview');
      
      if (file.type.startsWith('image/')) {
        prevImg.querySelector('img').src = e.target.result;
        prevImg.style.display = 'block';
        if (prevFile) prevFile.style.display = 'none';
      } else {
        prevImg.style.display = 'none';
        if (prevFile) {
          prevFile.innerHTML = `📄 已选择文件: ${file.name}`;
          prevFile.style.display = 'block';
        }
      }
      document.getElementById('complete-task-image-base64').value = e.target.result;
    }
    reader.readAsDataURL(file);
  }
}

window.submitCompleteTask = async function() {
  const id = document.getElementById('complete-task-id').value;
  const image = document.getElementById('complete-task-image-base64').value;
  const desc = document.getElementById('complete-task-desc').value;
  
  const res = await fetchWithAuth(`/api/tasks/${id}/complete`, { 
    method:'PUT',
    body: JSON.stringify({ image, desc })
  });
  
  if (!res.ok) {
    alert('提交失败，请检查网络或重启服务器');
    return;
  }

  closeCompleteTaskModal();
  loadTasks(currentTaskTab);
}

window.showTaskImage = function(src) {
  const lb = document.getElementById('image-lightbox');
  const img = document.getElementById('lightbox-img');
  if (lb && img) {
    img.src = src;
    lb.style.display = 'flex';
  }
}

async function completeTask(id) {
  openCompleteTaskModal(id);
}
async function auditTask(id) {
    if (!confirm('确认审核通过？')) return;
    await fetchWithAuth(`/api/tasks/${id}/audit`, { method:'PUT' });
    loadTasks('review');
}

function openOrderNotesModal(id) {
  const o = currentDailyOrders.find(x => x.id === id);
  if (!o || !o.notes) return;
  const m = document.getElementById('do-notes-modal');
  const c = document.getElementById('do-notes-content');
  if (m && c) {
    c.textContent = o.notes;
    m.style.display = 'flex';
  }
}

function getAllDailyOrderContacts() {
  return [
    ...(contactsData.customers || []),
    ...(contactsData.merchants || []),
    ...(contactsData.others || [])
  ];
}
function getDailyOrderCustomerInfo(name) {
  return getAllDailyOrderContacts().find(c => c.name === name) || null;
}
function getDailyOrderPriceLabel(priceKey) {
  const map = { price1: '价格1', price2: '价格2', price3: '价格3', price4: '价格4' };
  return map[priceKey || 'price1'] || String(priceKey || '价格1');
}

function openOrderDetailsModal(id) {
  const o = currentDailyOrders.find(x => x.id === id);
  if (!o) return;
  const m = document.getElementById('do-details-modal');
  if (m) {
    document.getElementById('do-details-customer').textContent = o.customer;
    document.getElementById('do-details-date').textContent = o.date;
    document.getElementById('do-details-notes').textContent = o.notes || '-';
    document.getElementById('do-details-status').textContent = o.status === 'new' ? '新订单' : (o.status === 'allocated' ? '已配货' : (o.status === 'cancelled' ? '已退单' : '已发货'));
    
    const tbody = document.getElementById('do-details-rows');
    const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
    
    const thead = m.querySelector('thead tr');
    if (o.status === 'new') {
        thead.innerHTML = '<th>商品</th><th>中文名</th><th>数量</th>';
    } else {
        thead.innerHTML = '<th>商品</th><th>中文名</th><th>订货数量</th><th>实际配货数量</th>';
    }

    tbody.innerHTML = items.map(i => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            ${i.image ? `<img src="${i.image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : ''}
            <span>${i.name}</span>
          </div>
        </td>
        <td>${i.cn_name || ''}</td>
        <td>${i.qty}</td>
        ${o.status !== 'new' ? `<td>${i.allocated_qty || 0}</td>` : ''}
      </tr>
    `).join('');
    m.style.display = 'flex';
  }
}

function buildOrderPreviewAllocationDisplay(item, product) {
  const itemDeductions = Array.isArray(item?.deductions) ? item.deductions : [];
  if (itemDeductions.length > 0) {
    const rows = itemDeductions.map(d => ({
      lote: d?.lote ? formatFinishedLote(d.lote) : '无Lote',
      stock: Number(d?.qty || 0)
    }));
    return {
      loteHtml: `<div style="display:flex;flex-direction:column;gap:6px;font-size:18px;font-weight:700;color:#dc2626">` +
        rows.map(row => `<div>${row.lote}</div>`).join('') + `</div>`,
      stockHtml: `<div style="display:flex;flex-direction:column;gap:6px;font-size:18px;font-weight:700;color:#111827">` +
        rows.map(row => `<div>${row.stock}</div>`).join('') + `</div>`
    };
  }
  const needQty = Math.max(0, Number(item?.allocated_qty ?? item?.qty ?? 0));
  const totalStock = Number(product?.stock || 0);
  const rows = buildFinishedStockRows(totalStock, product?.batches || []);
  if (needQty <= 0 || rows.length === 0) {
    return {
      loteHtml: '<span style="font-size:18px; font-weight:700; color:#dc2626">-</span>',
      stockHtml: '<span style="font-size:18px; font-weight:700; color:#111827">-</span>'
    };
  }
  let remaining = needQty;
  const picked = [];
  rows.forEach(row => {
    if (remaining <= 0) return;
    const take = Math.min(remaining, Number(row?.qty || 0));
    if (take <= 0) return;
    picked.push({ lote: row?.lote || '', stock: Number(row?.qty || 0) });
    remaining -= take;
  });
  if (picked.length === 0) {
    return {
      loteHtml: '<span style="font-size:18px; font-weight:700; color:#dc2626">-</span>',
      stockHtml: '<span style="font-size:18px; font-weight:700; color:#111827">-</span>'
    };
  }
  return {
    loteHtml: `<div style="display:flex;flex-direction:column;gap:6px;font-size:18px;font-weight:700;color:#dc2626">` +
      picked.map(row => `<div>${row.lote ? formatFinishedLote(row.lote) : '无Lote'}</div>`).join('') + `</div>`,
    stockHtml: `<div style="display:flex;flex-direction:column;gap:6px;font-size:18px;font-weight:700;color:#111827">` +
      picked.map(row => `<div>${row.stock}</div>`).join('') + `</div>`
  };
}
async function openOrderPreview(id) {
  const o = currentDailyOrders.find(x => x.id === id);
  if (!o) return;
  const m = document.getElementById('do-preview-modal');
  const content = document.getElementById('do-preview-content');
  if (m && content) {
    const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
    let products = [];
    try {
      const itemNames = items.map(i => i.name).filter(Boolean);
      const itemIds = items.map(i => i.productId).filter(Boolean);
      if (itemNames.length > 0 || itemIds.length > 0) {
        const res = await fetchWithAuth('/api/products/batch-stock', {
          method: 'POST',
          body: JSON.stringify({ names: itemNames, ids: itemIds })
        });
        if (res.ok) products = await res.json();
      }
    } catch (e) {
      console.warn('load preview lote failed', e);
    }
    content.innerHTML = `
      <div style="font-family: Arial, sans-serif; color:#000; padding:20px">
        <h2 style="text-align:center; margin-bottom:20px">订单详情</h2>
        <div style="display:flex; justify-content:space-between; margin-bottom:20px">
          <div>
            <div><strong>客户:</strong> ${o.customer}</div>
            <div><strong>日期:</strong> ${o.date}</div>
            ${o.notes ? `<div><strong>备注:</strong> ${o.notes}</div>` : ''}
          </div>
          <div>
            <div><strong>订单号:</strong> #${o.id}</div>
            <div><strong>状态:</strong> ${o.status === 'new' ? '新订单' : (o.status === 'allocated' ? '已配货' : (o.status === 'cancelled' ? '已退单' : '已发货'))}</div>
          </div>
        </div>
        <table style="width:100%; border-collapse:collapse; margin-bottom:20px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="border:1px solid #ddd; padding:8px; text-align:left">商品</th>
              <th style="border:1px solid #ddd; padding:8px; text-align:left">中文名称</th>
              <th style="border:1px solid #ddd; padding:8px; text-align:center; font-size:22px; color:#dc2626">Lote</th>
              <th style="border:1px solid #ddd; padding:8px; text-align:center">商品库存</th>
              <th style="border:1px solid #ddd; padding:8px; text-align:right">下单数量</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(i => {
              const product = products.find(p => p.id == i.productId || p.name === i.name);
              const allocationDisplay = buildOrderPreviewAllocationDisplay(i, product);
              return `
              <tr>
                <td style="border:1px solid #ddd; padding:8px">
                  ${i.image ? `<img src="${i.image}" style="width:32px;height:32px;object-fit:cover;margin-right:8px;vertical-align:middle">` : ''}
                  ${i.name}
                </td>
                <td style="border:1px solid #ddd; padding:8px">${i.cn_name || ''}</td>
                <td style="border:1px solid #ddd; padding:8px; text-align:center">${allocationDisplay.loteHtml}</td>
                <td style="border:1px solid #ddd; padding:8px; text-align:center">${allocationDisplay.stockHtml}</td>
                <td style="border:1px solid #ddd; padding:8px; text-align:right">${i.qty}</td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
        <div style="margin-top:40px; display:flex; justify-content:space-between">
          <div>制单人: ________________</div>
          <div>签收人: ________________</div>
        </div>
      </div>
    `;
    m.style.display = 'flex';
  }
}

function printOrderPreview() {
  const content = document.getElementById('do-preview-content').innerHTML;
  const win = window.open('', '', 'width=800,height=600');
  win.document.write(`
    <html>
      <head>
        <title>打印订单</title>
        <style>
          body { font-family: Arial, sans-serif; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; }
          th { background-color: #f3f4f6; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        ${content}
        <script>
          window.onload = function() { window.print(); window.close(); }
        </script>
      </body>
    </html>
  `);
  win.document.close();
}

// Daily Orders
var currentDailyOrders = [];
var dailyOrdersAbortController = null;
var dailyOrdersAllocatedCount = 0;

function updateDailyOrdersAllocatedBadge(count) {
  const badge = document.getElementById('tab-order-alloc-badge');
  if (!badge) return;
  const total = Number(count || 0) || 0;
  dailyOrdersAllocatedCount = total;
  badge.textContent = String(total);
  badge.style.display = total > 0 ? 'inline-block' : 'none';
}

async function refreshDailyOrdersAllocatedBadge() {
  let total = dailyOrdersAllocatedCount;
  try {
    const res = await fetchWithAuth(`/api/daily-orders?status=allocated&_t=${Date.now()}`);
    if (res.ok) {
      const list = await res.json().catch(() => []);
      total = Array.isArray(list) ? list.length : 0;
    } else {
      updateDailyOrdersAllocatedBadge(total);
      return;
    }
  } catch {
    updateDailyOrdersAllocatedBadge(total);
    return;
  }
  updateDailyOrdersAllocatedBadge(total);
}

async function loadDailyOrders(status = 'new', btn = null) {
  refreshDailyOrdersAllocatedBadge();
  // Update tabs style
  if (btn) {
    // Find parent .tabs container
    const tabs = btn.closest('.tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  } else {
    // If loaded without click (e.g. init), highlight correct tab
    const tabs = document.querySelector('#page-daily-orders .tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      const target = tabs.querySelector(`[data-tab="${status}"]`);
      if (target) target.classList.add('active');
    }
  }

  const tbody = document.getElementById('daily-order-rows');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8">加载中...</td></tr>';
  }

  if (dailyOrdersAbortController) {
    dailyOrdersAbortController.abort();
  }
  dailyOrdersAbortController = new AbortController();

  let list = [];
  try {
    // Fetch data with timestamp to prevent caching
    const res = await fetchWithAuth(`/api/daily-orders?status=${status}&_t=${Date.now()}`, {
      signal: dailyOrdersAbortController.signal
    });
    if (!res.ok) return;
    list = await res.json();
    if (status === 'shipped' && Array.isArray(list)) {
      list.sort((a, b) => {
        const at = Number(a?.logistics_updated_at || a?.shipped_at || 0) || 0;
        const bt = Number(b?.logistics_updated_at || b?.shipped_at || 0) || 0;
        if (bt !== at) return bt - at;
        return Number(b?.id || 0) - Number(a?.id || 0);
      });
    }
    currentDailyOrders = list;
  } catch (err) {
    if (err.name === 'AbortError') return; // Ignore aborted requests
    console.error('Failed to load daily orders:', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#ef4444">加载失败</td></tr>';
    return;
  }
  
  // Update badges
  if (status === 'new') {
    const badge = document.getElementById('tab-order-new-badge');
    const navBadge = document.getElementById('nav-order-badge');
    if (badge) {
      badge.textContent = list.length;
      badge.style.display = list.length > 0 ? 'inline-block' : 'none';
    }
    if (navBadge) {
      navBadge.textContent = list.length;
      navBadge.style.display = list.length > 0 ? 'inline-block' : 'none';
    }
  } else if (status === 'allocated') {
    updateDailyOrdersAllocatedBadge(list.length);
  }

  if (!tbody) return;
  
  if (list.length === 0) {
    tbody.innerHTML = '<tr class="empty"><td colspan="5">暂无订单</td></tr>';
    return;
  }
  
  tbody.innerHTML = list.map((o, idx) => `
    <tr>
      <td>${list.length - idx}</td>
      <td>${o.customer}</td>
      <td>
        <div style="font-size:13px">下单: ${o.date}</div>
        ${o.status === 'shipped' && o.shipped_at ? `<div style="color:#64748b;font-size:12px">发货: ${new Date(Number(o.shipped_at)).toLocaleString()}</div>` : ''}
      </td>
      <td><span class="tag ${o.status==='new'?'red':(o.status==='allocated'?'blue':(o.status==='cancelled'?'gray':'green'))}" style="cursor:pointer; text-decoration:underline" onclick="${(o.status==='new' || o.status==='allocated') ? `editDailyOrder(${o.id})` : `openOrderDetailsModal(${o.id})`}" title="点击查看/修改详情">
        ${o.status==='new'?'新订单':(o.status==='allocated'?'已配货':(o.status==='cancelled'?'已退单':'已发货'))}
      </span></td>
      <td>
        ${(() => {
          const customer = getDailyOrderCustomerInfo(o.customer || '');
          const customerRemark = customer?.remark ? `<div style="color:#ef4444; font-size:14px; font-weight:700; line-height:1.45; word-break:break-all; max-width:180px">${customer.remark}</div>` : '';
          const orderNotes = o.notes ? `<div style="color:#10b981; font-size:13px; cursor:pointer; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-all; max-width:180px; line-height:1.4; margin-top:${customer?.remark ? '6px' : '0'}" onclick="openOrderNotesModal(${o.id})" title="点击查看完整备注">${o.notes}</div>` : '';
          return customerRemark || orderNotes ? customerRemark + orderNotes : '<span style="color:#64748b">-</span>';
        })()}
      </td>
      <td>
        <div style="font-size:13px">创建: ${o.created_by || '-'}</div>
        ${o.status === 'allocated' || o.status === 'shipped' ? `<div style="font-size:13px; color:#64748b">配货: ${o.allocated_by || '-'}</div>` : ''}
        ${o.status === 'shipped' ? `<div style="font-size:13px; color:#64748b">发货: ${o.shipped_by || '-'}</div>` : ''}
      </td>
      <td>${o.status === 'shipped' && o.invoice_no ? o.invoice_no : '-'}</td>
      <td>
        ${o.status==='new' ? `<button class="btn-sm" onclick="openAllocateModal(${o.id})">配货</button> <button class="btn-sm btn-secondary" style="margin-left:4px" onclick="openOrderPreview(${o.id})">预览</button> <button class="btn-sm btn-red" style="margin-left:4px" onclick="cancelDailyOrder(${o.id})">退单</button>` : ''}
        ${o.status==='allocated' ? `<button class="btn-sm" onclick="confirmShip(${o.id})">发货</button> <button class="btn-sm btn-secondary" style="margin-left:4px" onclick="openOrderPreview(${o.id})">预览</button> <button class="btn-sm btn-red" style="margin-left:4px" onclick="cancelDailyOrder(${o.id})">退单</button>` : ''}
        ${o.status==='shipped' ? `<button class="btn-sm btn-secondary" onclick="openOrderPreview(${o.id})">预览</button>` : ''}
        ${o.status==='cancelled' ? `<button class="btn-sm btn-secondary" onclick="openOrderPreview(${o.id})">预览</button>` : ''}
      </td>
    </tr>
  `).join('');
}

var currentLogisticsTab = 'ongoing';
var logisticsCompanies = [];
var logisticsCompaniesLoadedAt = 0;
var logisticsAbortController = null;
var allPartners = [];
var allPartnersLoadedAt = 0;
var partnerSelectTarget = '';
var currentLogisticsRecords = [];
var logisticsCompletedTotalCount = 0;
var logisticsCompletedFilters = { from: '', company: '' };
var logisticsCompletedFilterMenuKey = '';
var logisticsReviewedFilters = { from: '', to: '', company: '', updated: '' };
var logisticsReviewedFilterMenuKey = '';
var logisticsReviewMode = false;
var logisticsReviewSelectedIds = new Set();

function loadLocalLogisticsCompanies() {
  try {
    const list = JSON.parse(localStorage.getItem('logisticsCompanies') || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function saveLocalLogisticsCompanies(list) {
  localStorage.setItem('logisticsCompanies', JSON.stringify(Array.isArray(list) ? list : []));
}
function loadLocalLogisticsRecords() {
  try {
    const list = JSON.parse(localStorage.getItem('logisticsRecords') || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function saveLocalLogisticsRecords(list) {
  localStorage.setItem('logisticsRecords', JSON.stringify(Array.isArray(list) ? list : []));
}

async function apiLogisticsCompaniesList(force = false) {
  const now = Date.now();
  if (!force && logisticsCompaniesLoadedAt && (now - logisticsCompaniesLoadedAt) < 15000 && Array.isArray(logisticsCompanies)) {
    return logisticsCompanies;
  }
  const res = await fetchWithAuth('/api/logistics/companies?_t=' + now);
  if (!res.ok) {
    if (res.status === 404) {
      logisticsCompanies = loadLocalLogisticsCompanies();
      logisticsCompaniesLoadedAt = now;
      return logisticsCompanies;
    }
    return logisticsCompanies;
  }
  const list = await res.json();
  logisticsCompanies = Array.isArray(list) ? list : [];
  logisticsCompaniesLoadedAt = now;
  return logisticsCompanies;
}

async function apiLogisticsCompanyCreate(payload) {
  const res = await fetchWithAuth('/api/logistics/companies', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });
  if (res.status === 404) {
    const list = loadLocalLogisticsCompanies();
    const id = Date.now();
    const next = [{ id, enabled: true, created_at: Date.now(), created_by: (getAuthUser()?.name || ''), ...payload }, ...list];
    saveLocalLogisticsCompanies(next);
    logisticsCompanies = next;
    logisticsCompaniesLoadedAt = Date.now();
    return { ok: true, status: 200 };
  }
  return res;
}

async function apiLogisticsCompanySetEnabled(id, enabled) {
  const res = await fetchWithAuth('/api/logistics/companies/' + String(id || 0), {
    method: 'PUT',
    body: JSON.stringify({ enabled: !!enabled })
  });
  if (res.status === 404) {
    const list = loadLocalLogisticsCompanies().map(x => (String(x.id) === String(id) ? { ...x, enabled: !!enabled } : x));
    saveLocalLogisticsCompanies(list);
    logisticsCompanies = list;
    logisticsCompaniesLoadedAt = Date.now();
    return { ok: true, status: 200 };
  }
  return res;
}

async function loadLogisticsRecords(status) {
  if (logisticsAbortController) logisticsAbortController.abort();
  logisticsAbortController = new AbortController();
  const res = await fetchWithAuth(`/api/logistics/records?status=${encodeURIComponent(status)}&_t=${Date.now()}`, {
    signal: logisticsAbortController.signal
  });
  if (!res.ok) {
    if (res.status === 404) {
      const all = loadLocalLogisticsRecords();
      const filtered = all.filter(x => String(x.status || '') === String(status || 'ongoing'));
      try {
        if (status === 'ongoing') {
          const shippedRes = await fetchWithAuth(`/api/daily-orders?status=shipped&_t=${Date.now()}`);
          if (shippedRes.ok) {
            const shippedList = await shippedRes.json().catch(() => []);
            const map = new Map((Array.isArray(shippedList) ? shippedList : []).map(o => [String(o?.id || ''), String(o?.invoice_no || '').trim()]));
            let changed = false;
            filtered.forEach(r => {
              if (r && (!String(r.invoice_no || '').trim()) && (!String(r.orderNo || '').trim())) {
                const inv = map.get(String(r.order_id || r.id || '')) || '';
                if (inv) {
                  r.orderNo = inv;
                  changed = true;
                }
              }
            });
            if (changed) saveLocalLogisticsRecords(all);
          }
        }
      } catch {}
      return filtered;
    }
    return [];
  }
  const list = await res.json();
  const arr = Array.isArray(list) ? list : [];
  try {
    if (status === 'ongoing') {
      const missing = arr.some(r => r && (!String(r.invoice_no || '').trim()) && (!String(r.orderNo || '').trim()) && (r.order_id || r.id));
      if (missing) {
        const shippedRes = await fetchWithAuth(`/api/daily-orders?status=shipped&_t=${Date.now()}`);
        if (shippedRes.ok) {
          const shippedList = await shippedRes.json().catch(() => []);
          const map = new Map((Array.isArray(shippedList) ? shippedList : []).map(o => [String(o?.id || ''), String(o?.invoice_no || '').trim()]));
          arr.forEach(r => {
            if (r && (!String(r.invoice_no || '').trim()) && (!String(r.orderNo || '').trim())) {
              const inv = map.get(String(r.order_id || r.id || '')) || '';
              if (inv) r.orderNo = inv;
            }
          });
        }
      }
    }
  } catch {}
  try {
    const localAll = loadLocalLogisticsRecords();
    if (Array.isArray(localAll) && localAll.length > 0) {
      const localMap = new Map(localAll.map(x => [String(x?.order_id || x?.id || ''), x]));
      const want = String(status || 'ongoing');
      const seen = new Set();
      const merged = arr.map(r => {
        const key = String(r?.id || r?.order_id || '');
        if (key) seen.add(key);
        const local = localMap.get(key);
        if (!local) return r;
        const localStatus = String(local?.status || '').trim();
        if (localStatus && localStatus !== want) return null;
        return {
          ...r,
          orderNo: String(local?.orderNo || '').trim() ? String(local.orderNo).trim() : r.orderNo,
          shipped_by: String(local?.shipped_by || local?.created_by || '').trim() ? (local.shipped_by || local.created_by) : r.shipped_by,
          logistics_from: String(local?.logistics_from || local?.from || '').trim() ? (local.logistics_from || local.from) : r.logistics_from,
          logistics_to: String(local?.logistics_to || local?.to || '').trim() ? (local.logistics_to || local.to) : r.logistics_to,
          logistics_ship_date: String(local?.logistics_ship_date || local?.ship_date || local?.shipDate || '').trim() ? (local.logistics_ship_date || local.ship_date || local.shipDate) : r.logistics_ship_date,
          logistics_pallet_count: String(local?.logistics_pallet_count || local?.pallet_count || local?.palletCount || '').trim()
            ? (local.logistics_pallet_count || local.pallet_count || local.palletCount)
            : r.logistics_pallet_count,
          logistics_box_count: String(local?.logistics_box_count || local?.box_count || local?.boxCount || '').trim()
            ? (local.logistics_box_count || local.box_count || local.boxCount)
            : r.logistics_box_count,
          logistics_total_weight: String(local?.logistics_total_weight || local?.total_weight || local?.totalWeight || '').trim()
            ? (local.logistics_total_weight || local.total_weight || local.totalWeight)
            : r.logistics_total_weight,
          logistics_arrival_date: String(local?.logistics_arrival_date || local?.arrival_date || local?.arrivalDate || '').trim()
            ? (local.logistics_arrival_date || local.arrival_date || local.arrivalDate)
            : r.logistics_arrival_date,
          logistics_completed_by: String(local?.logistics_completed_by || local?.completed_by || '').trim()
            ? (local.logistics_completed_by || local.completed_by)
            : r.logistics_completed_by,
          logistics_reviewed_by: String(local?.logistics_reviewed_by || local?.reviewed_by || '').trim()
            ? (local.logistics_reviewed_by || local.reviewed_by)
            : r.logistics_reviewed_by,
          logistics_updated_at: Number(local?.updatedAt || 0) || r.logistics_updated_at
        };
      }).filter(Boolean);
      const extras = localAll.filter(x => String(x?.status || '') === want).filter(x => {
        const key = String(x?.order_id || x?.id || '');
        return key && !seen.has(key);
      }).map(x => ({
        id: Number(x?.order_id || x?.id || 0) || 0,
        customer: x?.customer || '',
        notes: x?.notes || '',
        logistics_status: want,
        logistics_updated_at: Number(x?.updatedAt || 0) || Date.now(),
        logistics_company: x?.company || '',
        logistics_from: x?.logistics_from || x?.from || '',
        logistics_to: x?.logistics_to || x?.to || '',
        logistics_ship_date: x?.logistics_ship_date || x?.ship_date || x?.shipDate || '',
        logistics_pallet_count: x?.logistics_pallet_count || x?.pallet_count || x?.palletCount || '',
        logistics_box_count: x?.logistics_box_count || x?.box_count || x?.boxCount || '',
        logistics_total_weight: x?.logistics_total_weight || x?.total_weight || x?.totalWeight || '',
        logistics_arrival_date: x?.logistics_arrival_date || x?.arrival_date || x?.arrivalDate || '',
        logistics_completed_by: x?.logistics_completed_by || x?.completed_by || '',
        logistics_reviewed_by: x?.logistics_reviewed_by || x?.reviewed_by || '',
        shipped_by: x?.shipped_by || x?.created_by || '',
        invoice_no: x?.orderNo || '',
        orderNo: x?.orderNo || '',
        shipped_at: Number(x?.shippedAt || 0) || 0
      }));
      return [...extras, ...merged];
    }
  } catch {}
  return arr;
}

async function loadLogisticsCompanies() {
  const panel = document.getElementById('logistics-company-panel');
  const tbody = document.getElementById('logistics-company-rows');
  if (!panel || !tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8">加载中...</td></tr>';
  let list = [];
  try {
    list = await apiLogisticsCompaniesList(true);
  } catch {}
  if (!Array.isArray(list) || list.length === 0) {
    tbody.innerHTML = '<tr class="empty"><td colspan="6">暂无物流公司</td></tr>';
    return;
  }
  const role = getUserRoleName(getAuthUser()?.name || '');
  const canEdit = role === '超级管理员';
  tbody.innerHTML = list.map((c, idx) => {
    const enabled = c.enabled === true;
    const statusTag = enabled ? `<span class="tag green">启用</span>` : `<span class="tag gray">禁用</span>`;
    const action = canEdit
      ? (enabled
          ? `<button class="btn-sm btn-red" onclick="toggleLogisticsCompany(${c.id}, false)">禁用</button>`
          : `<button class="btn-sm" onclick="toggleLogisticsCompany(${c.id}, true)">启用</button>`)
      : `<span style="color:#64748b">-</span>`;
    return `
      <tr>
        <td>${list.length - idx}</td>
        <td>${escapeHtml(String(c.name || ''))}</td>
        <td>${escapeHtml(String(c.contact || ''))}</td>
        <td>${escapeHtml(String(c.phone || ''))}</td>
        <td>${statusTag}</td>
        <td>${action}</td>
      </tr>
    `;
  }).join('');
}

async function toggleLogisticsCompany(id, enabled) {
  const res = await apiLogisticsCompanySetEnabled(id, enabled);
  if (!res.ok) {
    if (res.status === 403) alert('没有权限执行此操作');
    else alert('操作失败');
    return;
  }
  await apiLogisticsCompaniesList(true);
  loadLogistics('companies');
}

function updateLogisticsReviewButton() {
  const btn = document.getElementById('logistics-review-btn');
  if (!btn) return;
  const selectedCount = logisticsReviewSelectedIds.size;
  const isConfirm = logisticsReviewMode && selectedCount > 0;
  btn.style.display = currentLogisticsTab === 'completed' ? 'inline-flex' : 'none';
  btn.innerHTML = isConfirm
    ? `已选中 <span style="font-size:18px; color:#f97316; font-weight:700; line-height:1">${selectedCount}</span> 确认审核`
    : '审核物流';
  btn.style.background = isConfirm ? '#2563eb' : '#f97316';
  btn.style.borderColor = isConfirm ? '#2563eb' : '#ea580c';
  btn.style.color = '#fff';
}

function updateLogisticsCompletedTabCount(count) {
  const el = document.getElementById('tab-logistics-completed-count');
  const total = Number(count || 0) || 0;
  logisticsCompletedTotalCount = total;
  if (el) {
    el.style.display = 'inline';
    el.textContent = String(total);
  }
  const navBadge = document.getElementById('nav-logistics-completed-badge');
  if (navBadge) {
    navBadge.textContent = String(total);
    navBadge.style.display = total > 0 ? 'inline-block' : 'none';
  }
}

function updateLogisticsOngoingBadgeCount(count) {
  const total = Number(count || 0) || 0;
  const navBadge = document.getElementById('nav-logistics-badge');
  if (navBadge) {
    navBadge.textContent = String(total);
    navBadge.style.display = total > 0 ? 'inline-block' : 'none';
  }
  const tabBadge = document.getElementById('tab-logistics-ongoing-badge');
  if (tabBadge) {
    tabBadge.textContent = String(total);
    tabBadge.style.display = total > 0 ? 'inline-block' : 'none';
  }
}

async function refreshLogisticsCompletedTabCount() {
  const want = 'completed';
  let remoteList = [];
  try {
    const res = await fetchWithAuth(`/api/logistics/records?status=${encodeURIComponent(want)}&_t=${Date.now()}`);
    if (res.ok) {
      const list = await res.json().catch(() => []);
      remoteList = Array.isArray(list) ? list : [];
    } else if (res.status === 404) {
      remoteList = [];
    } else {
      updateLogisticsCompletedTabCount(logisticsCompletedTotalCount);
      return;
    }
  } catch {
    updateLogisticsCompletedTabCount(logisticsCompletedTotalCount);
    return;
  }
  try {
    const localAll = loadLocalLogisticsRecords();
    if (Array.isArray(localAll) && localAll.length > 0) {
      const localMap = new Map(localAll.map(x => [String(x?.order_id || x?.id || ''), x]));
      const seen = new Set();
      let total = 0;
      remoteList.forEach(r => {
        const key = String(r?.id || r?.order_id || '');
        if (key) seen.add(key);
        const local = localMap.get(key);
        const localStatus = String(local?.status || '').trim();
        if (localStatus && localStatus !== want) return;
        total += 1;
      });
      localAll.forEach(x => {
        const key = String(x?.order_id || x?.id || '');
        if (!key || seen.has(key)) return;
        if (String(x?.status || '').trim() !== want) return;
        total += 1;
      });
      updateLogisticsCompletedTabCount(total);
      return;
    }
  } catch {}
  updateLogisticsCompletedTabCount(remoteList.length);
}

function getLogisticsCompletedFilterValue(item, key) {
  if (key === 'from') return String(item?.logistics_from || item?.from || '').trim();
  if (key === 'company') return String(item?.logistics_company || item?.company || '').trim();
  return '';
}

function getLogisticsCompletedFilterOptions(sourceList, key) {
  return Array.from(new Set((Array.isArray(sourceList) ? sourceList : []).map(item => getLogisticsCompletedFilterValue(item, key)).filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
}

function renderLogisticsCompletedFilterHeader(label, key, sourceList) {
  const menuId = `logistics-completed-filter-menu-${key}`;
  const arrowId = `logistics-completed-filter-arrow-${key}`;
  const wrapId = `logistics-completed-filter-wrap-${key}`;
  const options = getLogisticsCompletedFilterOptions(sourceList, key);
  const currentValue = String(logisticsCompletedFilters?.[key] || '').trim();
  const isOpen = logisticsCompletedFilterMenuKey === key;
  const allLabel = key === 'company' ? '全部物流公司' : '全部发出地';
  return `
    <div id="${wrapId}" class="logistics-completed-filter-wrap" style="position:relative; display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none" onclick="toggleLogisticsCompletedFilterMenu('${key}')">
      <span>${label}</span>
      <span id="${arrowId}" style="font-size:12px; color:#94a3b8">${isOpen ? '▼' : '▾'}</span>
      <div id="${menuId}" class="dropdown" style="display:${isOpen ? 'block' : 'none'}; left:0; right:auto; top:calc(100% + 8px); min-width:180px; max-width:260px; z-index:80" onclick="event.stopPropagation()">
        <div class="dd-list" style="max-height:260px">
          <div class="dd-item" onclick="setLogisticsCompletedFilter('${key}', '')" style="${!currentValue ? 'background:#132033; color:#fff' : ''}">${allLabel}</div>
          ${options.map(value => `<div class="dd-item" onclick="setLogisticsCompletedFilter('${key}', '${encodeURIComponent(value)}')" style="${String(value) === currentValue ? 'background:#132033; color:#fff' : ''}">${escapeHtml(value)}</div>`).join('')}
        </div>
      </div>
    </div>`;
}

function syncLogisticsCompletedFilterMenusUI() {
  ['from', 'company'].forEach(key => {
    const menu = document.getElementById(`logistics-completed-filter-menu-${key}`);
    const arrow = document.getElementById(`logistics-completed-filter-arrow-${key}`);
    const isOpen = logisticsCompletedFilterMenuKey === key;
    if (menu) menu.style.display = isOpen ? 'block' : 'none';
    if (arrow) arrow.textContent = isOpen ? '▼' : '▾';
  });
}

function toggleLogisticsCompletedFilterMenu(key) {
  if (currentLogisticsTab !== 'completed') return;
  logisticsCompletedFilterMenuKey = logisticsCompletedFilterMenuKey === key ? '' : key;
  syncLogisticsCompletedFilterMenusUI();
}

function setLogisticsCompletedFilter(key, encodedValue) {
  logisticsCompletedFilters[key] = decodeURIComponent(String(encodedValue || ''));
  logisticsCompletedFilterMenuKey = '';
  renderLogisticsTable(currentLogisticsRecords);
}

function closeLogisticsCompletedFilterMenus() {
  if (!logisticsCompletedFilterMenuKey) return;
  logisticsCompletedFilterMenuKey = '';
  syncLogisticsCompletedFilterMenusUI();
}

function getLogisticsReviewedFilterValue(item, key) {
  if (key === 'from') return String(item?.logistics_from || item?.from || '').trim();
  if (key === 'to') return String(item?.logistics_to || item?.to || '').trim();
  if (key === 'company') return String(item?.logistics_company || item?.company || '').trim();
  if (key === 'updated') return String(Number(item?.logistics_updated_at || 0) || Number(item?.updatedAt || 0) || Number(item?.shipped_at || 0) || 0);
  return '';
}

function formatLogisticsReviewedUpdatedLabel(value) {
  const ts = Number(value || 0) || 0;
  return ts ? new Date(ts).toLocaleString() : '-';
}

function getLogisticsReviewedFilterOptions(sourceList, key) {
  const values = Array.from(new Set((Array.isArray(sourceList) ? sourceList : []).map(item => getLogisticsReviewedFilterValue(item, key)).filter(Boolean)));
  if (key === 'updated') return values.sort((a, b) => Number(b) - Number(a));
  return values.sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
}

function renderLogisticsReviewedFilterHeader(label, key, sourceList) {
  const menuId = `logistics-reviewed-filter-menu-${key}`;
  const arrowId = `logistics-reviewed-filter-arrow-${key}`;
  const wrapId = `logistics-reviewed-filter-wrap-${key}`;
  const options = getLogisticsReviewedFilterOptions(sourceList, key);
  const currentValue = String(logisticsReviewedFilters?.[key] || '').trim();
  const isOpen = logisticsReviewedFilterMenuKey === key;
  return `
    <div id="${wrapId}" class="logistics-reviewed-filter-wrap" style="position:relative; display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none" onclick="toggleLogisticsReviewedFilterMenu('${key}')">
      <span>${label}</span>
      <span id="${arrowId}" style="font-size:12px; color:#94a3b8">${isOpen ? '▼' : '▾'}</span>
      <div id="${menuId}" class="dropdown" style="display:${isOpen ? 'block' : 'none'}; left:0; right:auto; top:calc(100% + 8px); min-width:180px; max-width:260px; z-index:40" onclick="event.stopPropagation()">
        <div class="dd-list" style="max-height:260px">
          <div class="dd-item" onclick="setLogisticsReviewedFilter('${key}', '')" style="${!currentValue ? 'background:#132033; color:#fff' : ''}">全部</div>
          ${options.map(value => `<div class="dd-item" onclick="setLogisticsReviewedFilter('${key}', '${encodeURIComponent(value)}')" style="${String(value) === currentValue ? 'background:#132033; color:#fff' : ''}">${escapeHtml(key === 'updated' ? formatLogisticsReviewedUpdatedLabel(value) : value)}</div>`).join('')}
        </div>
      </div>
    </div>`;
}

function syncLogisticsReviewedFilterMenusUI() {
  ['from', 'to', 'company', 'updated'].forEach(key => {
    const menu = document.getElementById(`logistics-reviewed-filter-menu-${key}`);
    const arrow = document.getElementById(`logistics-reviewed-filter-arrow-${key}`);
    const isOpen = logisticsReviewedFilterMenuKey === key;
    if (menu) menu.style.display = isOpen ? 'block' : 'none';
    if (arrow) arrow.textContent = isOpen ? '▼' : '▾';
  });
}

function toggleLogisticsReviewedFilterMenu(key) {
  if (currentLogisticsTab !== 'reviewed') return;
  logisticsReviewedFilterMenuKey = logisticsReviewedFilterMenuKey === key ? '' : key;
  syncLogisticsReviewedFilterMenusUI();
}

function setLogisticsReviewedFilter(key, encodedValue) {
  logisticsReviewedFilters[key] = decodeURIComponent(String(encodedValue || ''));
  logisticsReviewedFilterMenuKey = '';
  renderLogisticsTable(currentLogisticsRecords);
}

function closeLogisticsReviewedFilterMenus() {
  if (!logisticsReviewedFilterMenuKey) return;
  logisticsReviewedFilterMenuKey = '';
  syncLogisticsReviewedFilterMenusUI();
}

function renderLogisticsTable(rawList) {
  const tbody = document.getElementById('logistics-rows');
  if (!tbody) return;
  const sourceList = Array.isArray(rawList) ? rawList : [];
  const companyHead = document.getElementById('logistics-company-head');
  const fromHead = document.getElementById('logistics-from-head');
  const toHead = document.getElementById('logistics-to-head');
  const updatedHead = document.getElementById('logistics-updated-head');
  const personHead = document.getElementById('logistics-person-head');
  const actionHead = document.getElementById('logistics-action-head');
  const cargoHead = document.getElementById('logistics-cargo-head');
  if (fromHead) {
    fromHead.innerHTML = currentLogisticsTab === 'completed'
      ? renderLogisticsCompletedFilterHeader('发出地', 'from', sourceList)
      : (currentLogisticsTab === 'reviewed'
          ? renderLogisticsReviewedFilterHeader('发出地', 'from', sourceList)
          : '发出地');
  }
  if (toHead) {
    toHead.innerHTML = currentLogisticsTab === 'reviewed'
      ? renderLogisticsReviewedFilterHeader('目的地', 'to', sourceList)
      : '目的地';
  }
  if (updatedHead) {
    updatedHead.innerHTML = currentLogisticsTab === 'reviewed'
      ? renderLogisticsReviewedFilterHeader('更新时间', 'updated', sourceList)
      : '更新时间';
  }
  if (cargoHead) cargoHead.textContent = '货物信息';
  if (personHead) personHead.textContent = currentLogisticsTab === 'ongoing' ? '操作人员' : '人员';
  if (actionHead) actionHead.textContent = '操作';
  if (companyHead) {
    if (currentLogisticsTab === 'completed') {
      companyHead.innerHTML = renderLogisticsCompletedFilterHeader('物流公司', 'company', sourceList);
    } else if (currentLogisticsTab === 'reviewed') {
      companyHead.innerHTML = renderLogisticsReviewedFilterHeader('物流公司', 'company', sourceList);
    } else {
      companyHead.textContent = '物流公司';
    }
  }
  let list = sourceList;
  if (currentLogisticsTab === 'completed') {
    list = sourceList.filter(x => {
      if (logisticsCompletedFilters.from && getLogisticsCompletedFilterValue(x, 'from') !== logisticsCompletedFilters.from) return false;
      if (logisticsCompletedFilters.company && getLogisticsCompletedFilterValue(x, 'company') !== logisticsCompletedFilters.company) return false;
      return true;
    });
  }
  if (currentLogisticsTab === 'reviewed') {
    list = sourceList.filter(x => {
      if (logisticsReviewedFilters.from && getLogisticsReviewedFilterValue(x, 'from') !== logisticsReviewedFilters.from) return false;
      if (logisticsReviewedFilters.to && getLogisticsReviewedFilterValue(x, 'to') !== logisticsReviewedFilters.to) return false;
      if (logisticsReviewedFilters.company && getLogisticsReviewedFilterValue(x, 'company') !== logisticsReviewedFilters.company) return false;
      if (logisticsReviewedFilters.updated && getLogisticsReviewedFilterValue(x, 'updated') !== logisticsReviewedFilters.updated) return false;
      return true;
    });
  }
  if (!Array.isArray(list) || list.length === 0) {
    tbody.innerHTML = '<tr class="empty"><td colspan="9">暂无物流记录</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((x, idx) => {
    const rowId = Number(x.order_id || x.id || 0);
    const rowSelected = currentLogisticsTab === 'completed' && logisticsReviewMode && logisticsReviewSelectedIds.has(String(rowId));
    const rowTextColor = rowSelected ? '#f97316' : '#e2e8f0';
    const rowSubTextColor = rowSelected ? '#fb923c' : '#94a3b8';
    const updatedAt = Number(x.logistics_updated_at || 0) || Number(x.shipped_at || 0) || Number(x.updatedAt || 0) || 0;
    const updatedText = updatedAt ? new Date(updatedAt).toLocaleString() : '-';
    const orderNo = String(x.invoice_no || x.orderNo || (rowId ? `物流单-${String(rowId).padStart(6, '0')}` : '-'));
    const fromText = String(x.logistics_from || x.from || '-');
    const toText = String(x.logistics_to || x.to || '-');
    const companyName = String(x.logistics_company || x.company || '-');
    let shipDateText = String(x.logistics_ship_date || x.ship_date || x.shipDate || '').trim();
    if (!shipDateText) {
      const st = Number(x.shipped_at || x.shippedAt || 0) || 0;
      if (st) shipDateText = new Date(st).toISOString().slice(0, 10);
    }
    if (shipDateText && shipDateText.length > 10) shipDateText = shipDateText.slice(0, 10);
    let arrivalDateText = String(x.logistics_arrival_date || x.arrival_date || x.arrivalDate || '').trim();
    if (arrivalDateText && arrivalDateText.length > 10) arrivalDateText = arrivalDateText.slice(0, 10);
    const palletText = String(x.logistics_pallet_count || x.pallet_count || x.palletCount || '').trim();
    const boxText = String(x.logistics_box_count || x.box_count || x.boxCount || '').trim();
    const weightText = String(x.logistics_total_weight || x.total_weight || x.totalWeight || '').trim();
    const timeMeta = [];
    if (shipDateText) timeMeta.push(`发货日期: ${escapeHtml(shipDateText)}`);
    if (arrivalDateText) timeMeta.push(`到货日期: ${escapeHtml(arrivalDateText)}`);
    const updatedCell = timeMeta.length > 0
      ? `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(updatedText)}</div>${timeMeta.map((text, metaIdx) => `<div style="color:${rowSubTextColor}; font-size:12px; margin-top:${metaIdx === 0 ? 4 : 2}px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${text}</div>`).join('')}`
      : escapeHtml(updatedText);
    const cargoCell = [
      `托盘：${escapeHtml(palletText || '-')}`,
      `总箱数：${escapeHtml(boxText || '-')}`,
      `总重量kg：${escapeHtml(weightText || '-')}`
    ].map((text, cargoIdx) => `<div style="color:${cargoIdx === 0 ? rowTextColor : rowSubTextColor}; font-size:${cargoIdx === 0 ? 13 : 12}px; margin-top:${cargoIdx === 0 ? 0 : 2}px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${text}</div>`).join('');
    const shippedByText = String(x.shipped_by || x.created_by || '-');
    const completedByText = String(x.logistics_completed_by || x.completed_by || x.shipped_by || '-');
    const reviewedByText = String(x.logistics_reviewed_by || x.reviewed_by || '-');
    const personCell = currentLogisticsTab === 'ongoing'
      ? `${escapeHtml(shippedByText)}`
      : (currentLogisticsTab === 'completed'
          ? `<div style="height:21px"></div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">发货人员：${escapeHtml(shippedByText)}</div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">到货人员：${escapeHtml(completedByText)}</div>`
          : (currentLogisticsTab === 'reviewed'
              ? `<div style="height:21px"></div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">发货人员：${escapeHtml(shippedByText)}</div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">到货人员：${escapeHtml(completedByText)}</div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">审核人员：${escapeHtml(reviewedByText)}</div>`
              : '<span style="color:#64748b">-</span>'));
    const actionCell = currentLogisticsTab === 'ongoing'
      ? `<div class="logistics-action-cell"><button class="btn-sm btn-outline-blue" onclick="openLogisticsEditModal(${rowId})">编辑</button><button class="btn-sm btn-outline-green" onclick="openLogisticsCompleteModal(${rowId})">设为已签收</button></div>`
      : (currentLogisticsTab === 'completed'
          ? (logisticsReviewMode
              ? `<label style="display:flex; justify-content:center"><input type="checkbox" ${logisticsReviewSelectedIds.has(String(rowId)) ? 'checked' : ''} onchange="toggleLogisticsReviewSelection(${rowId}, this.checked)"></label>`
              : '<span style="color:#64748b">-</span>')
          : escapeHtml(String(x.notes || '')));
    return `
      <tr style="color:${rowTextColor}">
        <td style="color:${rowTextColor}">${list.length - idx}</td>
        <td style="color:${rowTextColor}"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(orderNo)}</div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(String(x.customer || '-'))}</div></td>
        <td style="color:${rowTextColor}"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(fromText)}</div></td>
        <td style="color:${rowTextColor}"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(toText)}</div></td>
        <td style="color:${rowTextColor}"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(companyName)}</div></td>
        <td style="color:${rowTextColor}">${cargoCell}</td>
        <td style="color:${rowTextColor}">${updatedCell}</td>
        <td style="color:${rowTextColor}">${personCell}</td>
        <td>${actionCell}</td>
      </tr>
    `;
  }).join('');
}

function toggleLogisticsReviewSelection(id, checked) {
  const key = String(id || '').trim();
  if (!key) return;
  if (checked) logisticsReviewSelectedIds.add(key);
  else logisticsReviewSelectedIds.delete(key);
  updateLogisticsReviewButton();
  renderLogisticsTable(currentLogisticsRecords);
}

async function handleLogisticsReviewAction() {
  if (currentLogisticsTab !== 'completed') return;
  if (!logisticsReviewMode) {
    logisticsReviewMode = true;
    logisticsReviewSelectedIds.clear();
    updateLogisticsReviewButton();
    loadLogistics('completed');
    return;
  }
  if (logisticsReviewSelectedIds.size === 0) {
    alert('请先勾选要审核的物流');
    return;
  }
  const ids = Array.from(logisticsReviewSelectedIds).map(x => Number(x)).filter(Boolean);
  if (ids.length === 0) return;
  const btn = document.getElementById('logistics-review-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetchWithAuth('/api/logistics/records/review', {
      method: 'PUT',
      body: JSON.stringify({ ids })
    });
    const userName = String(getAuthUser()?.name || '');
    const now = Date.now();
    if (!res.ok && res.status !== 404) {
      alert('审核失败');
      return;
    }
    const all = loadLocalLogisticsRecords();
    const next = (Array.isArray(all) ? all : []).map(x => {
      const key = String(x?.order_id || x?.id || '');
      if (ids.some(id => String(id) === key)) {
        return { ...x, status: 'reviewed', logistics_status: 'reviewed', logistics_reviewed_by: userName, reviewed_by: userName, updatedAt: now };
      }
      return x;
    });
    saveLocalLogisticsRecords(next);
    logisticsReviewMode = false;
    logisticsReviewSelectedIds.clear();
    updateLogisticsReviewButton();
    loadLogistics('completed');
    updateGlobalBadges();
  } catch (e) {
    console.error(e);
    alert('审核失败：后端不可用或网络异常');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function loadLogistics(status = 'ongoing', btn = null) {
  currentLogisticsTab = status || 'ongoing';
  refreshLogisticsCompletedTabCount();
  if (currentLogisticsTab !== 'completed') {
    logisticsCompletedFilterMenuKey = '';
    logisticsReviewMode = false;
    logisticsReviewSelectedIds.clear();
  }
  if (currentLogisticsTab !== 'reviewed') {
    logisticsReviewedFilterMenuKey = '';
  }
  updateLogisticsReviewButton();
  const createOrderBtn = document.getElementById('logistics-create-order-btn');
  const companyAddBtn = document.getElementById('logistics-company-add-btn');
  if (createOrderBtn) createOrderBtn.style.display = currentLogisticsTab === 'ongoing' ? 'inline-flex' : 'none';
  if (companyAddBtn) companyAddBtn.style.display = currentLogisticsTab === 'companies' ? 'inline-flex' : 'none';
  if (btn) {
    const tabs = btn.closest('.tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  } else {
    const tabs = document.querySelector('#page-logistics .tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      const target = tabs.querySelector(`[data-tab="${currentLogisticsTab}"]`);
      if (target) target.classList.add('active');
    }
  }

  const recordPanel = document.getElementById('logistics-record-panel');
  const companyPanel = document.getElementById('logistics-company-panel');
  const pager = document.getElementById('logistics-pager');
  if (currentLogisticsTab === 'companies') {
    if (recordPanel) recordPanel.style.display = 'none';
    if (pager) pager.style.display = 'none';
    if (companyPanel) companyPanel.style.display = 'block';
    loadLogisticsCompanies();
    return;
  }

  if (recordPanel) recordPanel.style.display = 'block';
  if (pager) pager.style.display = 'flex';
  if (companyPanel) companyPanel.style.display = 'none';

  const tbody = document.getElementById('logistics-rows');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#94a3b8">加载中...</td></tr>';
  (async () => {
    let list = [];
    try {
      list = await loadLogisticsRecords(currentLogisticsTab);
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    currentLogisticsRecords = Array.isArray(list) ? list : [];
    renderLogisticsTable(currentLogisticsRecords);
  })();
}

document.addEventListener('click', e => {
  const target = e.target;
  if (target && typeof target.closest === 'function') {
    if (currentLogisticsTab === 'completed' && target.closest('.logistics-completed-filter-wrap')) return;
    if (currentLogisticsTab === 'reviewed' && target.closest('.logistics-reviewed-filter-wrap')) return;
  }
  if (currentLogisticsTab === 'completed') closeLogisticsCompletedFilterMenus();
  if (currentLogisticsTab === 'reviewed') closeLogisticsReviewedFilterMenus();
});

function openLogisticsCompanyModal() {
  const m = document.getElementById('logistics-company-modal');
  if (!m) return;
  const msg = document.getElementById('lgc-msg');
  if (msg) msg.style.display = 'none';
  const name = document.getElementById('lgc-name');
  const phone = document.getElementById('lgc-phone');
  const contact = document.getElementById('lgc-contact');
  if (name) name.value = '';
  if (phone) phone.value = '';
  if (contact) contact.value = '';
  m.style.display = 'flex';
  if (name) name.focus();
}

function openLogisticsCompleteModal(orderId) {
  const id = Number(orderId || 0);
  if (!id) return;
  const m = document.getElementById('logistics-complete-modal');
  const idEl = document.getElementById('logistics-complete-order-id');
  const dateEl = document.getElementById('logistics-complete-date');
  const okBtn = document.getElementById('logistics-complete-ok');
  if (!m || !idEl || !dateEl) return;
  idEl.value = String(id);
  dateEl.value = new Date().toISOString().slice(0, 10);
  if (okBtn) okBtn.disabled = false;
  m.style.display = 'flex';
}

function closeLogisticsCompleteModal() {
  const m = document.getElementById('logistics-complete-modal');
  if (m) m.style.display = 'none';
}

async function confirmLogisticsComplete() {
  const id = Number(document.getElementById('logistics-complete-order-id')?.value || 0);
  const date = String(document.getElementById('logistics-complete-date')?.value || '').trim();
  if (!id) return;
  if (!date) { alert('请选择货物到达日期'); return; }
  const okBtn = document.getElementById('logistics-complete-ok');
  if (okBtn) okBtn.disabled = true;
  try {
    const res = await fetchWithAuth(`/api/logistics/records/${id}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ arrival_date: date })
    });
    if (!res.ok && res.status !== 404) {
      alert('操作失败');
      return;
    }
    const all = loadLocalLogisticsRecords();
    const userName = String(getAuthUser()?.name || '');
    const now = Date.now();
    const next = (Array.isArray(all) ? all : []).map(x => {
      if (String(x?.order_id || x?.id || '') === String(id)) {
        return {
          ...x,
          status: 'completed',
          logistics_status: 'completed',
          logistics_arrival_date: date,
          arrival_date: date,
          logistics_completed_by: userName,
          completed_by: userName,
          updatedAt: now
        };
      }
      return x;
    });
    saveLocalLogisticsRecords(next);
    closeLogisticsCompleteModal();
    if (currentLogisticsTab === 'ongoing') loadLogistics('ongoing');
    updateGlobalBadges();
  } catch (e) {
    console.error(e);
    alert('操作失败：后端不可用或网络异常');
  } finally {
    if (okBtn) okBtn.disabled = false;
  }
}

function closeLogisticsCompanyModal() {
  const m = document.getElementById('logistics-company-modal');
  if (m) m.style.display = 'none';
}

async function submitLogisticsCompany() {
  const msg = document.getElementById('lgc-msg');
  const name = String(document.getElementById('lgc-name')?.value || '').trim();
  const phone = String(document.getElementById('lgc-phone')?.value || '').trim();
  const contact = String(document.getElementById('lgc-contact')?.value || '').trim();
  if (!name) {
    if (msg) { msg.textContent = '请填写公司名称'; msg.style.display = 'inline-block'; }
    return;
  }
  const res = await apiLogisticsCompanyCreate({ name, phone, contact });
  if (!res.ok) {
    let text = '新增失败';
    if (res.status === 409) text = '公司名称已存在';
    if (msg) { msg.textContent = text; msg.style.display = 'inline-block'; }
    return;
  }
  closeLogisticsCompanyModal();
  await apiLogisticsCompaniesList(true);
  loadLogistics('companies');
  showToast('新增成功');
}

async function apiAllPartnersList(force = false) {
  const now = Date.now();
  if (!force && allPartnersLoadedAt && (now - allPartnersLoadedAt) < 15000 && Array.isArray(allPartners) && allPartners.length > 0) {
    return allPartners;
  }
  const out = [];
  const tabs = [
    { tab: 'customers', owner: '客户' },
    { tab: 'merchants', owner: '商家' },
    { tab: 'others', owner: '其它' }
  ];
  for (const t of tabs) {
    try {
      const r = await fetchWithAuth(`/api/contacts?tab=${encodeURIComponent(t.tab)}&page=1&size=5000&_t=${now}`);
      if (!r.ok) continue;
      const list = await r.json().catch(() => []);
      (Array.isArray(list) ? list : []).forEach(x => {
        const name = String(x?.name || '').trim();
        const company = String(x?.company || '').trim();
        const label = name || company;
        if (!label) return;
        out.push({ label, name, company, owner: t.owner });
      });
    } catch {}
  }
  out.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  allPartners = out;
  allPartnersLoadedAt = now;
  return allPartners;
}

function closePartnerSelect() {
  const m = document.getElementById('partner-select-modal');
  if (m) m.style.display = 'none';
  partnerSelectTarget = '';
}

function updateDoShipOkState() {
  const okBtn = document.getElementById('do-ship-ok');
  const sel = document.getElementById('do-ship-company');
  const fromVal = String(document.getElementById('do-ship-from')?.value || '').trim();
  const toVal = String(document.getElementById('do-ship-to')?.value || '').trim();
  const shipDate = String(document.getElementById('do-ship-date')?.value || '').trim();
  const palletCount = String(document.getElementById('do-ship-pallet-count')?.value || '').trim();
  const boxCount = String(document.getElementById('do-ship-box-count')?.value || '').trim();
  const totalWeight = String(document.getElementById('do-ship-total-weight')?.value || '').trim();
  const companyId = String(sel?.value || '').trim();
  const ok = !!(companyId && fromVal && toVal && shipDate && palletCount && boxCount && totalWeight);
  if (okBtn) okBtn.disabled = !ok;
  if (sel) sel.style.color = companyId ? '' : '#94a3b8';
}

function selectPartnerLabel(label) {
  const v = String(label || '').trim();
  const target = partnerSelectTarget;
  if (!target) return;
  const input = document.getElementById(target);
  if (input) input.value = v;
  updateDoShipOkState();
  closePartnerSelect();
}

function renderPartnerSelectList(q = '') {
  const listEl = document.getElementById('partner-select-list');
  if (!listEl) return;
  const kw = String(q || '').trim().toLowerCase();
  const src = Array.isArray(allPartners) ? allPartners : [];
  const filtered = kw
    ? src.filter(x => (String(x.label || '') + ' ' + String(x.company || '') + ' ' + String(x.owner || '')).toLowerCase().includes(kw))
    : src;
  const show = filtered.slice(0, 200);
  listEl.innerHTML = '';
  if (show.length === 0) {
    listEl.innerHTML = '<div style="padding:12px; color:#94a3b8">暂无匹配往来单位</div>';
    return;
  }
  show.forEach(x => {
    const row = document.createElement('div');
    row.className = 'dd-item';
    const left = document.createElement('div');
    left.textContent = String(x.label || '');
    const right = document.createElement('div');
    right.style.color = '#94a3b8';
    right.style.fontSize = '12px';
    right.textContent = String(x.owner || '');
    row.appendChild(left);
    row.appendChild(right);
    row.addEventListener('click', () => selectPartnerLabel(x.label));
    listEl.appendChild(row);
  });
}

async function openPartnerSelect(kind) {
  const m = document.getElementById('partner-select-modal');
  if (!m) return;
  const title = document.getElementById('partner-select-title');
  const search = document.getElementById('partner-select-search');
  const listEl = document.getElementById('partner-select-list');
  partnerSelectTarget = String(kind || '') === 'to' ? 'do-ship-to' : 'do-ship-from';
  if (title) title.textContent = String(kind || '') === 'to' ? '选择目的地' : '选择出发地';
  if (search) {
    search.value = '';
    search.oninput = () => renderPartnerSelectList(search.value);
  }
  if (listEl) listEl.innerHTML = '<div style="padding:12px; color:#94a3b8">加载中...</div>';
  m.style.display = 'flex';
  await apiAllPartnersList(true);
  renderPartnerSelectList('');
  if (search) search.focus();
}

function closeDoShipModal() {
  const m = document.getElementById('do-ship-modal');
  if (m) m.style.display = 'none';
}

let doShipModalMode = 'ship';

function openDoShipDatePicker() {
  const dateEl = document.getElementById('do-ship-date');
  if (!dateEl || typeof dateEl.showPicker !== 'function') return;
  try {
    dateEl.showPicker();
  } catch (_) {}
}

function updateDoShipCompanySelectColor() {
  const sel = document.getElementById('do-ship-company');
  if (!sel) return;
  sel.style.color = sel.value ? '#e2e8f0' : '#94a3b8';
}

function setDoShipModalMode(mode = 'ship') {
  doShipModalMode = mode === 'edit_logistics'
    ? 'edit_logistics'
    : (mode === 'create_logistics' ? 'create_logistics' : 'ship');
  const titleEl = document.getElementById('do-ship-modal-title');
  const hintEl = document.getElementById('do-ship-modal-hint');
  const okBtn = document.getElementById('do-ship-ok');
  if (doShipModalMode === 'edit_logistics') {
    if (titleEl) titleEl.textContent = '编辑物流';
    if (hintEl) hintEl.textContent = '修改当前物流信息';
    if (okBtn) okBtn.textContent = '保存';
  } else if (doShipModalMode === 'create_logistics') {
    if (titleEl) titleEl.textContent = '创建订单';
    if (hintEl) hintEl.textContent = '填写物流信息后创建新的物流订单';
    if (okBtn) okBtn.textContent = '保存';
  } else {
    if (titleEl) titleEl.textContent = '确认发货';
    if (hintEl) hintEl.textContent = '确认已发货？(发票将自动生成)';
    if (okBtn) okBtn.textContent = '确定';
  }
}

async function populateDoShipCompanyOptions(selectedCompanyId = '') {
  const sel = document.getElementById('do-ship-company');
  if (!sel) return [];
  sel.innerHTML = '';
  const list = await apiLogisticsCompaniesList(true);
  const enabled = (Array.isArray(list) ? list : []).filter(x => x && x.enabled === true);
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = enabled.length === 0 ? '暂无可用物流公司（请先新增并启用）' : '请选择物流公司';
  sel.appendChild(placeholder);
  enabled.forEach(c => {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = String(c.name || '');
    sel.appendChild(opt);
  });
  sel.value = selectedCompanyId ? String(selectedCompanyId) : '';
  updateDoShipCompanySelectColor();
  sel.onchange = () => {
    updateDoShipCompanySelectColor();
    updateDoShipOkState();
  };
  return enabled;
}

async function openDoShipModal(orderId) {
  const m = document.getElementById('do-ship-modal');
  if (!m) return;
  setDoShipModalMode('ship');
  const order = currentDailyOrders.find(x => Number(x?.id) === Number(orderId)) || null;
  const defaultTo = String(order?.customer || '').trim();
  const idEl = document.getElementById('do-ship-id');
  const sel = document.getElementById('do-ship-company');
  const fromEl = document.getElementById('do-ship-from');
  const toEl = document.getElementById('do-ship-to');
  const dateEl = document.getElementById('do-ship-date');
  const palletEl = document.getElementById('do-ship-pallet-count');
  const boxEl = document.getElementById('do-ship-box-count');
  const weightEl = document.getElementById('do-ship-total-weight');
  const okBtn = document.getElementById('do-ship-ok');
  if (idEl) idEl.value = String(orderId || '');
  if (okBtn) okBtn.disabled = true;
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = defaultTo;
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  if (palletEl) palletEl.value = '';
  if (boxEl) boxEl.value = '';
  if (weightEl) weightEl.value = '';
  m.style.display = 'flex';
  if (!sel) return;
  await populateDoShipCompanyOptions('');
  updateDoShipOkState();
  if (dateEl) {
    dateEl.onchange = () => updateDoShipOkState();
    dateEl.onclick = () => openDoShipDatePicker();
    dateEl.onfocus = () => openDoShipDatePicker();
  }
  if (palletEl) palletEl.oninput = () => updateDoShipOkState();
  if (boxEl) boxEl.oninput = () => updateDoShipOkState();
  if (weightEl) weightEl.oninput = () => updateDoShipOkState();
}

async function openLogisticsCreateModal() {
  const m = document.getElementById('do-ship-modal');
  if (!m) return;
  setDoShipModalMode('create_logistics');
  const idEl = document.getElementById('do-ship-id');
  const sel = document.getElementById('do-ship-company');
  const fromEl = document.getElementById('do-ship-from');
  const toEl = document.getElementById('do-ship-to');
  const dateEl = document.getElementById('do-ship-date');
  const palletEl = document.getElementById('do-ship-pallet-count');
  const boxEl = document.getElementById('do-ship-box-count');
  const weightEl = document.getElementById('do-ship-total-weight');
  const okBtn = document.getElementById('do-ship-ok');
  if (idEl) idEl.value = '';
  if (okBtn) okBtn.disabled = true;
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  if (palletEl) palletEl.value = '';
  if (boxEl) boxEl.value = '';
  if (weightEl) weightEl.value = '';
  m.style.display = 'flex';
  if (!sel) return;
  await populateDoShipCompanyOptions('');
  updateDoShipOkState();
  if (dateEl) {
    dateEl.onchange = () => updateDoShipOkState();
    dateEl.onclick = () => openDoShipDatePicker();
    dateEl.onfocus = () => openDoShipDatePicker();
  }
  if (palletEl) palletEl.oninput = () => updateDoShipOkState();
  if (boxEl) boxEl.oninput = () => updateDoShipOkState();
  if (weightEl) weightEl.oninput = () => updateDoShipOkState();
}

async function openLogisticsEditModal(orderId) {
  const id = Number(orderId || 0);
  if (!id) return;
  const m = document.getElementById('do-ship-modal');
  if (!m) return;
  const rec = (Array.isArray(currentLogisticsRecords) ? currentLogisticsRecords : []).find(x => Number(x?.id || x?.order_id || 0) === id)
    || (Array.isArray(loadLocalLogisticsRecords()) ? loadLocalLogisticsRecords() : []).find(x => Number(x?.id || x?.order_id || 0) === id)
    || null;
  if (!rec) { alert('未找到物流记录'); return; }
  setDoShipModalMode('edit_logistics');
  const idEl = document.getElementById('do-ship-id');
  const sel = document.getElementById('do-ship-company');
  const fromEl = document.getElementById('do-ship-from');
  const toEl = document.getElementById('do-ship-to');
  const dateEl = document.getElementById('do-ship-date');
  const palletEl = document.getElementById('do-ship-pallet-count');
  const boxEl = document.getElementById('do-ship-box-count');
  const weightEl = document.getElementById('do-ship-total-weight');
  const okBtn = document.getElementById('do-ship-ok');
  if (idEl) idEl.value = String(id);
  if (okBtn) okBtn.disabled = true;
  if (fromEl) fromEl.value = String(rec.logistics_from || rec.from || '').trim();
  if (toEl) toEl.value = String(rec.logistics_to || rec.to || '').trim();
  if (dateEl) {
    const shipDate = String(rec.logistics_ship_date || rec.ship_date || rec.shipDate || '').trim();
    dateEl.value = shipDate ? shipDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  }
  if (palletEl) palletEl.value = String(rec.logistics_pallet_count || rec.pallet_count || rec.palletCount || '').trim();
  if (boxEl) boxEl.value = String(rec.logistics_box_count || rec.box_count || rec.boxCount || '').trim();
  if (weightEl) weightEl.value = String(rec.logistics_total_weight || rec.total_weight || rec.totalWeight || '').trim();
  m.style.display = 'flex';
  if (!sel) return;
  await populateDoShipCompanyOptions(String(rec.logistics_company_id || rec.company_id || ''));
  updateDoShipOkState();
  if (dateEl) {
    dateEl.onchange = () => updateDoShipOkState();
    dateEl.onclick = () => openDoShipDatePicker();
    dateEl.onfocus = () => openDoShipDatePicker();
  }
  if (palletEl) palletEl.oninput = () => updateDoShipOkState();
  if (boxEl) boxEl.oninput = () => updateDoShipOkState();
  if (weightEl) weightEl.oninput = () => updateDoShipOkState();
}

async function confirmShipSubmit() {
  const id = Number(document.getElementById('do-ship-id')?.value || 0);
  const sel = document.getElementById('do-ship-company');
  const fromVal = String(document.getElementById('do-ship-from')?.value || '').trim();
  const toVal = String(document.getElementById('do-ship-to')?.value || '').trim();
  const shipDate = String(document.getElementById('do-ship-date')?.value || '').trim();
  const palletCount = String(document.getElementById('do-ship-pallet-count')?.value || '').trim();
  const boxCount = String(document.getElementById('do-ship-box-count')?.value || '').trim();
  const totalWeight = String(document.getElementById('do-ship-total-weight')?.value || '').trim();
  const companyId = Number(sel?.value || 0);
  const isEditLogistics = doShipModalMode === 'edit_logistics';
  const isCreateLogistics = doShipModalMode === 'create_logistics';
  if ((!isCreateLogistics && !id) || !companyId) { alert('请选择物流公司'); return; }
  if (!fromVal) { alert('请选择出发地'); return; }
  if (!toVal) { alert('请选择目的地'); return; }
  if (!shipDate) { alert('请选择发货日期'); return; }
  if (!palletCount) { alert('请输入托盘数量'); return; }
  if (!boxCount) { alert('请输入总箱数'); return; }
  if (!totalWeight) { alert('请输入总重量'); return; }
  const okBtn = document.getElementById('do-ship-ok');
  if (okBtn) okBtn.disabled = true;
  const reqBody = {
    logistics_company_id: companyId,
    logistics_from: fromVal,
    logistics_to: toVal,
    logistics_ship_date: shipDate,
    logistics_pallet_count: palletCount,
    logistics_box_count: boxCount,
    logistics_total_weight: totalWeight
  };
  const res = await fetchWithAuth(isCreateLogistics ? '/api/logistics/records' : `/api/daily-orders/${id}/ship`, {
    method: isCreateLogistics ? 'POST' : 'PUT',
    body: JSON.stringify(reqBody)
  });
  if (okBtn) okBtn.disabled = false;
  const createWithLocalFallback = isCreateLogistics && res.status === 404;
  if (!res.ok && !createWithLocalFallback) {
    const data = await res.json().catch(() => null);
    if (data?.error === 'logistics_company_required') alert('请选择物流公司');
    else if (data?.error === 'logistics_from_required') alert('请选择出发地');
    else if (data?.error === 'logistics_to_required') alert('请选择目的地');
    else if (data?.error === 'logistics_ship_date_required') alert('请选择发货日期');
    else if (data?.error === 'logistics_pallet_count_required') alert('请输入托盘数量');
    else if (data?.error === 'logistics_box_count_required') alert('请输入总箱数');
    else if (data?.error === 'logistics_total_weight_required') alert('请输入总重量');
    else if (data?.error === 'bad_logistics_company') alert('物流公司不可用，请选择启用的公司');
    else alert(isCreateLogistics ? '创建物流订单失败' : (isEditLogistics ? '物流信息保存失败' : '发货失败'));
    return;
  }
  if (isCreateLogistics) {
    let newId = 0;
    try {
      const data = await res.json().catch(() => null);
      newId = Number(data?.id || 0) || 0;
    } catch {}
    try {
      const company = (Array.isArray(logisticsCompanies) ? logisticsCompanies : []).find(x => String(x.id) === String(companyId));
      const now = Date.now();
      const all = loadLocalLogisticsRecords();
      const recordId = newId || now;
      const next = [
        {
          id: recordId,
          status: 'ongoing',
          logistics_status: 'ongoing',
          order_id: recordId,
          customer: toVal,
          shipped_by: String(getAuthUser()?.name || ''),
          logistics_from: fromVal,
          logistics_to: toVal,
          logistics_ship_date: shipDate,
          logistics_pallet_count: palletCount,
          logistics_box_count: boxCount,
          logistics_total_weight: totalWeight,
          logistics_company_id: companyId,
          company_id: companyId,
          logistics_company: company?.name || '',
          company: company?.name || '',
          logistics_updated_at: now,
          updatedAt: now,
          orderNo: `物流单-${String(recordId).padStart(6, '0')}`,
          notes: ''
        },
        ...all
      ];
      saveLocalLogisticsRecords(next);
      updateLogisticsOngoingBadgeCount(next.filter(x => String(x?.status || x?.logistics_status || '') === 'ongoing').length);
    } catch {}
    closeDoShipModal();
    if (currentLogisticsTab === 'ongoing') loadLogistics('ongoing');
    updateGlobalBadges();
    showAppToast('物流订单已创建');
    return;
  }
  if (isEditLogistics) {
    try {
      const company = (Array.isArray(logisticsCompanies) ? logisticsCompanies : []).find(x => String(x.id) === String(companyId));
      const now = Date.now();
      const all = loadLocalLogisticsRecords();
      const next = (Array.isArray(all) ? all : []).map(x => {
        if (String(x?.order_id || x?.id || '') === String(id)) {
          return {
            ...x,
            logistics_from: fromVal,
            from: fromVal,
            logistics_to: toVal,
            to: toVal,
            logistics_ship_date: shipDate,
            ship_date: shipDate,
            shipDate,
            logistics_pallet_count: palletCount,
            pallet_count: palletCount,
            palletCount,
            logistics_box_count: boxCount,
            box_count: boxCount,
            boxCount,
            logistics_total_weight: totalWeight,
            total_weight: totalWeight,
            totalWeight,
            logistics_company_id: companyId,
            company_id: companyId,
            logistics_company: company?.name || x?.logistics_company || '',
            company: company?.name || x?.company || '',
            updatedAt: now
          };
        }
        return x;
      });
      saveLocalLogisticsRecords(next);
    } catch {}
    closeDoShipModal();
    if (currentLogisticsTab === 'ongoing') loadLogistics('ongoing');
    showAppToast('物流信息已更新');
    return;
  }
  let shippedInvoiceNo = '';
  try {
    const shippedRes = await fetchWithAuth(`/api/daily-orders?status=shipped&_t=${Date.now()}`);
    if (shippedRes.ok) {
      const shippedList = await shippedRes.json().catch(() => []);
      const shippedOrder = (Array.isArray(shippedList) ? shippedList : []).find(o => Number(o?.id || 0) === id);
      shippedInvoiceNo = String(shippedOrder?.invoice_no || shippedOrder?.invoiceNo || '').trim();
    }
  } catch {}
  try {
    const company = (Array.isArray(logisticsCompanies) ? logisticsCompanies : []).find(x => String(x.id) === String(companyId));
    const order = currentDailyOrders.find(o => Number(o.id) === id);
    const all = loadLocalLogisticsRecords();
    const next = [
      {
        status: 'ongoing',
        order_id: id,
        orderNo: shippedInvoiceNo || order?.invoice_no || '',
        customer: order?.customer || '',
        shipped_by: String(getAuthUser()?.name || ''),
        logistics_from: fromVal,
        logistics_to: toVal,
        logistics_ship_date: shipDate,
        logistics_pallet_count: palletCount,
        logistics_box_count: boxCount,
        logistics_total_weight: totalWeight,
        company: company?.name || '',
        company_id: companyId,
        tracking_no: '',
        updatedAt: Date.now(),
        notes: order?.notes || ''
      },
      ...all
    ];
    saveLocalLogisticsRecords(next);
    updateLogisticsOngoingBadgeCount(next.filter(x => String(x?.status || '') === 'ongoing').length);
  } catch {}
  closeDoShipModal();
  loadDailyOrders('allocated');
  if (currentLogisticsTab === 'ongoing') loadLogistics('ongoing');
  updateGlobalBadges();
  showAppToast('确认发货，发票已生成');
}

async function cancelDailyOrder(id) {
  if (!confirm('确定要退掉这个订单吗？退单后无法恢复。')) return;
  const res = await fetchWithAuth(`/api/daily-orders/${id}`, {
    method: 'DELETE'
  });
  if (res.ok) {
    const currentTab = document.querySelector('#page-daily-orders .tabs .tab.active')?.dataset.tab || 'new';
    loadDailyOrders(currentTab);
  } else {
    alert('退单失败，可能该订单已发货。');
  }
}

function openDailyOrderModal() {
  const m = document.getElementById('daily-order-modal');
  if (m) {
    m.style.display = 'flex';
    document.getElementById('daily-order-modal-title').textContent = '新订单';
    document.getElementById('do-id').value = '';
    document.getElementById('do-notes').value = '';
    document.getElementById('do-items-container').innerHTML = '';
    
    // Setup customer dropdown
    const doCustomer = document.getElementById('do-customer');
    const doCustomerDd = document.getElementById('do-customer-dd');
    const doCustomerSearch = document.getElementById('do-customer-search');
    const doCustomerList = document.getElementById('do-customer-list');
    const doCustomerRemark = document.getElementById('do-customer-remark');
    const doCustomerPrice = document.getElementById('do-customer-price');

    const updateDoCustomerMeta = () => {
      const customer = getDailyOrderCustomerInfo((doCustomer?.value || '').trim());
      if (doCustomerRemark) doCustomerRemark.textContent = customer?.remark || '';
      if (doCustomerPrice) doCustomerPrice.textContent = customer ? `客户价格：${getDailyOrderPriceLabel(customer?.use_price || 'price1')}` : '客户价格：';
      const usePrice = customer?.use_price || 'price1';
      document.querySelectorAll('#do-items-container .do-item-row').forEach(row => {
        const priceInput = row.querySelector('.do-item-price');
        if (!priceInput) return;
        const priceMap = {
          price1: row.querySelector('.do-item-price1')?.value,
          price2: row.querySelector('.do-item-price2')?.value,
          price3: row.querySelector('.do-item-price3')?.value,
          price4: row.querySelector('.do-item-price4')?.value
        };
        const nextPrice = priceMap[usePrice];
        if (nextPrice !== undefined && nextPrice !== null && nextPrice !== '') priceInput.value = Number(nextPrice || 0);
      });
    };

    if (doCustomer) {
        doCustomer.value = ''; // Reset
        doCustomer.oninput = () => updateDoCustomerMeta();
        doCustomer.onfocus = () => {
            doCustomerDd.style.display = 'block';
            doCustomerSearch.focus();
            renderDoCustomerList();
        };
        // Close on click outside is handled globally or we add a specific listener here if needed
        // For simplicity, let's reuse the global click listener logic or add a local one
        setTimeout(() => {
             const closeDd = (e) => {
                if (!m.contains(e.target)) return; // If click outside modal, modal closes anyway
                if (!doCustomer.parentElement.contains(e.target)) {
                    doCustomerDd.style.display = 'none';
                    document.removeEventListener('click', closeDd);
                }
             };
             document.addEventListener('click', closeDd);
        }, 100);
    }
    
    if (doCustomerSearch) {
        doCustomerSearch.oninput = () => renderDoCustomerList(doCustomerSearch.value);
    }

    function renderDoCustomerList(filter = '') {
        const all = getAllDailyOrderContacts();
        
        // Ensure we don't have duplicates or empty list if data isn't ready
        if (all.length === 0) {
            doCustomerList.innerHTML = '<div class="dd-item" style="color:#64748b">加载中或无数据...</div>';
            return;
        }

        const filtered = all.filter(c => {
            const q = filter.toLowerCase();
            return [c.name, c.company, c.contact, c.phone, c.city, (c.remark||'')].some(v => String(v||'').toLowerCase().includes(q));
        });
        
        if (filtered.length === 0) {
            doCustomerList.innerHTML = '<div class="dd-item" style="justify-content:center; color:#64748b">无匹配结果</div>';
            return;
        }

        doCustomerList.innerHTML = filtered.map(c => `
            <div class="dd-item" onclick="selectDoCustomer('${c.name}')">
                <span>${c.name}</span>
                <span style="font-size:12px; color:#64748b">${c.phone||''} ${c.city||''}</span>
            </div>
        `).join('');
    }
    
    window.selectDoCustomer = function(name) {
        doCustomer.value = name;
        doCustomerDd.style.display = 'none';
        updateDoCustomerMeta();
    };

    // Ensure contacts are loaded
    if (!contactsData.customers || contactsData.customers.length === 0) {
         fetchWithAuth('/api/contacts').then(r=>r.json()).then(data => {
             // Assuming api returns flat list, we need to categorize if contactsData structure expects categories
             // Or if contactsData is just flat. Let's check how contactsData is populated elsewhere.
             // Actually loadContacts populates contactsData. Let's call loadContacts if needed or just use the list.
             // For safety, let's fetch and categorize or just use the flat list if structure matches.
             // Re-using loadContacts logic from app.js might be better if available.
             // Let's just fetch flat and use it for now to be robust.
             const list = Array.isArray(data) ? data : (data.list || []);
             // Mock categorizing for the filter above to work if it relies on categories, 
             // BUT simpler is just to assign to a temp all-list.
             // Let's patch contactsData for this modal usage
             contactsData.customers = list.filter(c => c.type === 'customers');
             contactsData.merchants = list.filter(c => c.type === 'merchants');
             contactsData.others = list.filter(c => c.type === 'others');
             // If types are missing, just put all in customers
             if (list.length > 0 && !list[0].type) contactsData.customers = list;
         });
    }
    
    document.getElementById('do-notes').value = '';
    if (doCustomerRemark) doCustomerRemark.textContent = '';
    if (doCustomerPrice) doCustomerPrice.textContent = '客户价格：';
  }
}

async function editDailyOrder(id) {
  const o = currentDailyOrders.find(x => x.id === id);
  if (!o) return;
  openDailyOrderModal();
  document.getElementById('daily-order-modal-title').textContent = '修改订单';
  document.getElementById('do-id').value = o.id;
  document.getElementById('do-customer').value = o.customer || '';
  
  document.getElementById('do-notes').value = o.notes || '';
  
  const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
  const tbody = document.getElementById('do-items-container');
  tbody.innerHTML = '';
  let products = [];
  const itemNames = items.map(i => i.name).filter(Boolean);
  const itemIds = items.map(i => i.productId).filter(Boolean);
  if (itemNames.length > 0 || itemIds.length > 0) {
    try {
      const res = await fetchWithAuth('/api/products/batch-stock', {
        method: 'POST',
        body: JSON.stringify({ names: itemNames, ids: itemIds })
      });
      if (res.ok) products = await res.json();
    } catch {}
  }
  items.forEach(prod => {
    const fullProd = products.find(p => p.id == prod.productId || p.name === prod.name) || {};
    const usePrice = (getDailyOrderCustomerInfo(o.customer || '')?.use_price) || 'price1';
    const priceValue = fullProd[usePrice] !== undefined && fullProd[usePrice] !== null && fullProd[usePrice] !== '' ? fullProd[usePrice] : (prod.price || prod.price1 || 0);
    const tr = document.createElement('tr');
    tr.className = 'do-item-row';
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          ${prod.image ? `<img src="${prod.image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : ''}
          <div>
            <div style="font-weight:600">${prod.name}</div>
            <div style="font-size:12px; color:#94a3b8">${prod.sku || ''}</div>
          </div>
        </div>
        <input type="hidden" class="do-item-name" value="${prod.name}">
        <input type="hidden" class="do-item-image" value="${prod.image || ''}">
        <input type="hidden" class="do-item-cn" value="${prod.cn_name || prod.name_cn || ''}">
        <input type="hidden" class="do-item-desc" value="${prod.description || prod.spec || ''}">
        <input type="hidden" class="do-item-tax" value="${prod.tax_rate !== undefined && prod.tax_rate !== null && prod.tax_rate !== '' ? prod.tax_rate : 0.10}">
        <input type="hidden" class="do-item-pid" value="${prod.productId || prod.id || ''}">
        <input type="hidden" class="do-item-sku" value="${prod.sku || ''}">
        <input type="hidden" class="do-item-price1" value="${fullProd.price1 !== undefined ? fullProd.price1 : (prod.price1 || prod.price || 0)}">
        <input type="hidden" class="do-item-price2" value="${fullProd.price2 !== undefined ? fullProd.price2 : ''}">
        <input type="hidden" class="do-item-price3" value="${fullProd.price3 !== undefined ? fullProd.price3 : ''}">
        <input type="hidden" class="do-item-price4" value="${fullProd.price4 !== undefined ? fullProd.price4 : ''}">
      </td>
      <td><div style="color:#94a3b8; font-size:13px">${prod.cn_name || prod.name_cn || ''}</div></td>
      <td><input type="number" class="do-item-qty" value="${prod.qty || 1}" min="1" style="width:80px"></td>
      <td><input type="number" class="do-item-price" value="${priceValue}" step="0.01" style="width:80px"></td>
      <td><button class="btn-red btn-icon" onclick="this.closest('tr').remove()" style="width:32px; height:32px">×</button></td>
    `;
    tbody.appendChild(tr);
  });
  const doCustomer = document.getElementById('do-customer');
  if (doCustomer) doCustomer.dispatchEvent(new Event('input'));
}

function closeDailyOrderModal() {
  const m = document.getElementById('daily-order-modal');
  if (m) m.style.display = 'none';
}

function openDoProdSelector() {
  const m = document.getElementById('prod-selector-modal');
  if (m) {
    window.selectedProducts.clear();
    m.style.display = 'flex';
    loadProductSelector(1); // Load first page
    // Override the select callback for this context
    window.onProdSelect = function(prod, isBatch) {
      addDoItemRow(prod);
      if (!isBatch) m.style.display = 'none';
    };
  }
}

function addDoItemRow(prod) {
  const tbody = document.getElementById('do-items-container');
  const doCustomer = document.getElementById('do-customer');
  const currentCustomer = getDailyOrderCustomerInfo((doCustomer?.value || '').trim());
  const usePrice = currentCustomer?.use_price || 'price1';
  const displayPrice = prod[usePrice] !== undefined && prod[usePrice] !== null && prod[usePrice] !== '' ? Number(prod[usePrice] || 0) : Number(prod.price1 || 0);
  const tr = document.createElement('tr');
  tr.className = 'do-item-row';
  tr.innerHTML = `
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        ${prod.image ? `<img src="${prod.image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : ''}
        <div>
          <div style="font-weight:600">${prod.name}</div>
          <div style="font-size:12px; color:#94a3b8">${prod.sku || ''}</div>
        </div>
      </div>
      <input type="hidden" class="do-item-name" value="${prod.name}">
      <input type="hidden" class="do-item-image" value="${prod.image || ''}">
      <input type="hidden" class="do-item-cn" value="${prod.name_cn || ''}">
      <input type="hidden" class="do-item-desc" value="${prod.spec || prod.description || ''}">
      <input type="hidden" class="do-item-tax" value="${prod.tax_rate !== undefined && prod.tax_rate !== null && prod.tax_rate !== '' ? prod.tax_rate : 0.10}">
      <input type="hidden" class="do-item-pid" value="${prod.id || ''}">
      <input type="hidden" class="do-item-sku" value="${prod.sku || ''}">
      <input type="hidden" class="do-item-price1" value="${prod.price1 || 0}">
      <input type="hidden" class="do-item-price2" value="${prod.price2 || 0}">
      <input type="hidden" class="do-item-price3" value="${prod.price3 || 0}">
      <input type="hidden" class="do-item-price4" value="${prod.price4 || 0}">
    </td>
    <td><div style="color:#94a3b8; font-size:13px">${prod.name_cn||''}</div></td>
    <td><input type="number" class="do-item-qty" value="1" min="1" style="width:80px"></td>
    <td><input type="number" class="do-item-price" value="${displayPrice}" step="0.01" style="width:80px"></td>
    <td><button class="btn-red btn-icon" onclick="this.closest('tr').remove()" style="width:32px; height:32px">×</button></td>
  `;
  tbody.appendChild(tr);
}

async function saveDailyOrder() {
  const id = document.getElementById('do-id').value;
  const customer = document.getElementById('do-customer').value;
  const notes = document.getElementById('do-notes').value;
  if (!customer) return alert('请选择客户');
  
  const items = [];
  document.querySelectorAll('.do-item-row').forEach(row => {
    const name = row.querySelector('.do-item-name').value;
    const image = row.querySelector('.do-item-image').value;
    const cn_name = row.querySelector('.do-item-cn').value;
    const description = row.querySelector('.do-item-desc').value;
    const tax_rate = Number(row.querySelector('.do-item-tax').value);
    const productId = row.querySelector('.do-item-pid').value;
    const sku = row.querySelector('.do-item-sku').value;
    const qty = row.querySelector('.do-item-qty').value;
    const price = row.querySelector('.do-item-price').value;
    if (name && qty) items.push({ name, image, cn_name, description, tax_rate, productId, sku, qty: Number(qty), price: Number(price) });
  });
  
  if (items.length === 0) return alert('请添加商品');
  
  if (id) {
    await fetchWithAuth('/api/daily-orders/' + id, {
      method: 'PUT',
      body: JSON.stringify({ customer, notes, items })
    });
  } else {
    await fetchWithAuth('/api/daily-orders', {
      method: 'POST',
      body: JSON.stringify({ customer, notes, items })
    });
  }
  closeDailyOrderModal();
  const currentTab = document.querySelector('#page-daily-orders .tabs .tab.active')?.dataset.tab || 'new';
  loadDailyOrders(currentTab);
}

async function openAllocateModal(id) {
  const order = currentDailyOrders.find(o => o.id === id);
  if (!order) return;
  const m = document.getElementById('do-allocate-modal');
  document.getElementById('do-allocate-id').value = id;
  const tbody = document.getElementById('do-allocate-rows');
  const items = Array.isArray(order.items) ? order.items : (typeof order.items === 'string' ? JSON.parse(order.items) : []);
  
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8">加载中...</td></tr>';
  m.style.display = 'flex';
  
  try {
    const itemNames = items.map(i => i.name).filter(Boolean);
    const itemIds = items.map(i => i.productId).filter(Boolean);
    let products = [];
    if (itemNames.length > 0 || itemIds.length > 0) {
      const res = await fetchWithAuth('/api/products/batch-stock', {
        method: 'POST',
        body: JSON.stringify({ names: itemNames, ids: itemIds })
      });
      if (res.ok) {
        products = await res.json();
      }
    }
    
    tbody.innerHTML = items.map((item, idx) => {
      const p = products.find(p => p.id == item.productId || p.name === item.name);
      const nameCn = p ? (p.name_cn || item.name_cn || '') : (item.name_cn || '');
      const totalStock = p ? Number(p.stock || 0) : 0;
      const displayRows = p ? buildFinishedStockRows(totalStock, p.batches) : [];
      const stock = displayRows.length > 0
        ? `<div style="display:flex;flex-direction:column;gap:4px">` + displayRows.map(b => `<div>${b.qty}</div>`).join('') + `</div>`
        : (p ? String(totalStock) : '-');
      const lote = displayRows.length > 0
        ? `<div style="display:flex;flex-direction:column;gap:4px">` + displayRows.map(b => `<div>${b.lote ? formatFinishedLote(b.lote) : '无Lote'}</div>`).join('') + `</div>`
        : '-';
      
      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              ${item.image ? `<img src="${item.image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : ''}
              <span>${item.name}</span>
            </div>
          </td>
          <td>${nameCn}</td>
          <td>${lote}</td>
          <td>${stock}</td>
          <td>${item.qty}</td>
          <td><input type="number" class="alloc-qty" data-idx="${idx}" value="${item.allocated_qty !== undefined ? item.allocated_qty : item.qty}" style="width:80px"></td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ef4444">加载失败</td></tr>';
  }
}
async function confirmAllocate() {
  const id = Number(document.getElementById('do-allocate-id').value);
  const order = currentDailyOrders.find(o => o.id === id);
  if (!order) return;
  const okBtn = document.getElementById('do-allocate-ok');
  const prevOkText = okBtn ? okBtn.textContent : '';
  
  const items = Array.isArray(order.items) ? order.items : (typeof order.items === 'string' ? JSON.parse(order.items) : []);
  document.querySelectorAll('.alloc-qty').forEach(inp => {
    const idx = Number(inp.dataset.idx);
    if (items[idx]) items[idx].allocated_qty = Number(inp.value);
  });
  
  try {
    if (okBtn) {
      okBtn.disabled = true;
      okBtn.textContent = '处理中...';
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    const res = await fetchWithAuth(`/api/daily-orders/${id}/allocate`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
      signal: ac.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error ? `配货失败：${err.error}` : '配货失败');
      return;
    }
    document.getElementById('do-allocate-modal').style.display = 'none';
    loadDailyOrders('new');
  } catch (e) {
    console.error(e);
    alert(e && e.name === 'AbortError' ? '配货超时：后端响应过慢' : '配货失败：后端不可用或网络异常');
  } finally {
    if (okBtn) {
      okBtn.disabled = false;
      okBtn.textContent = prevOkText || '确认配货完成';
    }
  }
}
async function confirmShip(id) {
  openDoShipModal(id);
}

// Finished Stock
let fsPage = 1;
const fsPageSize = 50;
let fsTotal = 0;
let fsCurrentTab = 'stock';
let fsAdjustPage = 1;
let fsAdjustTotal = 0;
let fsRecordPage = 1;
const fsRecordPageSize = 100;
let fsRecordTotal = 0;
let fsAdjustState = null;
const fsRemindModal = document.getElementById('fs-remind-modal');
const fsRemindForm = document.getElementById('fs-remind-form');
const fsRemindInput = document.getElementById('fs-remind-input');
const fsRemindCancel = document.getElementById('fs-remind-cancel');
const fsRemindCancelTop = document.getElementById('fs-remind-cancel-top');
let rsPage = 1;
const rsPageSize = 50;
let rsTotal = 0;
let rsCurrentTab = 'stock';
let rsAdjustPage = 1;
let rsAdjustTotal = 0;
let rsRecordPage = 1;
const rsRecordPageSize = 100;
let rsRecordTotal = 0;
let rsAdjustState = null;
let rsMaterialOptions = [];
let rsMaterialEditId = null;
let rsAddItems = [];
let rsSelPage = 1;
const rsSelPageSize = 100;
let rsSelTotal = 0;
const rsMaterialFile = document.getElementById('rs-material-file');
const rsMaterialIdInput = document.getElementById('rs-material-id');
const rsMaterialImage = document.getElementById('rs-material-image');
const rsMaterialPreview = document.getElementById('rs-material-preview');
const rsMaterialFileName = document.getElementById('rs-material-file-name');
const rsNameModalTitle = document.getElementById('rs-name-modal-title');
const rsNameModalSave = document.getElementById('rs-name-modal-save');
const rsSelModal = document.getElementById('rs-selector-modal');
const rsSelSearch = document.getElementById('rs-sel-search');
const rsSelList = document.getElementById('rs-sel-list');
let eventRecordPage = 1;
const eventRecordPageSize = 50;
let eventRecordTotal = 0;
let eventRecordCurrentTab = 'ongoing';
let currentEventRecordList = [];
let productionReviewPage = 1;
const productionReviewPageSize = 50;
let productionReviewTotal = 0;
let productionReviewCurrentTab = 'pending';
let currentProductionEntryList = [];
let knowledgeBasePage = 1;
const knowledgeBasePageSize = 50;
let knowledgeBaseTotal = 0;
let knowledgeBaseCurrentTab = 'internal';
let currentKnowledgeBaseList = [];
let pendingFinishedStockTab = '';
let productionPendingCount = 0;

if (rsMaterialFile) {
  rsMaterialFile.addEventListener('change', () => {
    const fileObj = rsMaterialFile.files?.[0];
    if (!fileObj) {
      if (rsMaterialPreview) {
        rsMaterialPreview.src = '';
        rsMaterialPreview.style.display = 'none';
      }
      if (rsMaterialFileName) rsMaterialFileName.textContent = '未选择图片';
      return;
    }
    if (rsMaterialFileName) rsMaterialFileName.textContent = fileObj.name;
    const localUrl = URL.createObjectURL(fileObj);
    if (rsMaterialPreview) {
      rsMaterialPreview.src = localUrl;
      rsMaterialPreview.style.display = 'block';
    }
  });
}

function renderLoteLines(loteValue = '') {
  const raw = String(loteValue || '').trim();
  if (!raw) return '-';
  const parts = raw.split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length === 0) return '-';
  return `<div style="display:flex; flex-direction:column; gap:4px">` + parts.map(x => `<div>${x}</div>`).join('') + `</div>`;
}
function formatFinishedLote(loteValue = '') {
  let l = String(loteValue || '').trim();
  const parts = l.split('-');
  if (parts.length === 3) l = parts[2] + parts[1];
  return l;
}
function mergeFinishedBatches(batches = []) {
  const grouped = new Map();
  (Array.isArray(batches) ? batches : []).forEach(batch => {
    const rawLote = String(batch?.lote || '').trim();
    const qty = Number(batch?.qty || 0);
    if (!rawLote || qty <= 0) return;
    const expiry = String(batch?.expiry || '').trim();
    const key = `${rawLote}__${expiry}`;
    if (!grouped.has(key)) {
      grouped.set(key, { lote: rawLote, expiry, qty: 0 });
    }
    grouped.get(key).qty += qty;
  });
  return Array.from(grouped.values()).sort((a, b) => {
    const ea = String(a.expiry || '');
    const eb = String(b.expiry || '');
    return ea.localeCompare(eb) || String(a.lote || '').localeCompare(String(b.lote || ''));
  });
}
function buildFinishedStockRows(totalStock, batches = []) {
  const merged = mergeFinishedBatches(batches);
  const batchedQty = merged.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const unlottedQty = Math.max(0, Number(totalStock || 0) - batchedQty);
  if (unlottedQty > 0) {
    return [{ qty: unlottedQty, lote: '', expiry: '' }, ...merged];
  }
  return merged;
}

function switchFinishedStockTab(tab, btn) {
  const canStock = can('finished_stock', 'view');
  const canAdjust = can('finished_stock_adjust', 'view');
  const canReview = can('production_review', 'view');
  if (tab === 'review' && !canReview) {
    tab = canStock ? 'stock' : (canAdjust ? 'adjust' : 'stock');
    btn = document.getElementById(tab === 'adjust' ? 'fs-tab-adjust' : 'fs-tab-stock');
  }
  if ((tab === 'stock' || tab === 'records') && !canStock) {
    tab = canReview ? 'review' : (canAdjust ? 'adjust' : 'stock');
    btn = document.getElementById(tab === 'review' ? 'fs-tab-review' : (tab === 'adjust' ? 'fs-tab-adjust' : 'fs-tab-stock'));
  }
  if (tab === 'adjust' && !canAdjust) {
    tab = canReview ? 'review' : (canStock ? 'stock' : 'stock');
    btn = document.getElementById(tab === 'review' ? 'fs-tab-review' : 'fs-tab-stock');
  }
  fsCurrentTab = tab === 'records' ? 'records' : (tab === 'adjust' ? 'adjust' : (tab === 'review' ? 'review' : 'stock'));
  const stockPanel = document.getElementById('fs-stock-panel');
  const recordPanel = document.getElementById('fs-records-panel');
  const adjustPanel = document.getElementById('fs-adjust-panel');
  const reviewPanel = document.getElementById('fs-review-panel');
  const stockToolbar = document.getElementById('fs-stock-toolbar');
  const addBtn = document.getElementById('fs-add-btn');
  const stockTab = document.getElementById('fs-tab-stock');
  const recordsTab = document.getElementById('fs-tab-records');
  const adjustTab = document.getElementById('fs-tab-adjust');
  const reviewTab = document.getElementById('fs-tab-review');
  if (stockTab) stockTab.style.display = canStock ? 'inline-flex' : 'none';
  if (recordsTab) recordsTab.style.display = canStock ? 'inline-flex' : 'none';
  if (adjustTab) adjustTab.style.display = canAdjust ? 'inline-flex' : 'none';
  if (reviewTab) reviewTab.style.display = canReview ? 'inline-flex' : 'none';
  if (stockPanel) stockPanel.style.display = fsCurrentTab === 'stock' ? 'block' : 'none';
  if (recordPanel) recordPanel.style.display = fsCurrentTab === 'records' ? 'block' : 'none';
  if (adjustPanel) adjustPanel.style.display = fsCurrentTab === 'adjust' ? 'block' : 'none';
  if (reviewPanel) reviewPanel.style.display = fsCurrentTab === 'review' ? 'block' : 'none';
  if (stockToolbar) stockToolbar.style.display = fsCurrentTab === 'stock' || fsCurrentTab === 'adjust' ? 'flex' : 'none';
  if (addBtn) addBtn.style.display = fsCurrentTab === 'stock' ? 'inline-flex' : 'none';
  document.querySelectorAll('#page-finished-stock .tab').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const activeBtn = document.getElementById(
      fsCurrentTab === 'stock' ? 'fs-tab-stock'
      : (fsCurrentTab === 'records' ? 'fs-tab-records'
      : (fsCurrentTab === 'adjust' ? 'fs-tab-adjust' : 'fs-tab-review'))
    );
    if (activeBtn) activeBtn.classList.add('active');
  }
  if (fsCurrentTab === 'stock') loadFinishedStock(1);
  else if (fsCurrentTab === 'records') loadFinishedStockRecords(1);
  else if (fsCurrentTab === 'adjust') loadFinishedStockAdjustments(1);
  else loadProductionEntries('pending');
}
window.switchFinishedStockTab = switchFinishedStockTab;
function handleFsSearchInput() {
  if (fsCurrentTab === 'adjust') loadFinishedStockAdjustments(1);
  else if (fsCurrentTab === 'review') loadProductionEntries(productionReviewCurrentTab, null, 1);
  else loadFinishedStock(1);
}
window.handleFsSearchInput = handleFsSearchInput;

async function loadFinishedStock(page = 1) {
  fsPage = page;
  const q = document.getElementById('fs-search')?.value?.trim() || '';
  const res = await fetchWithAuth(`/api/inventory/finished?page=${fsPage}&size=${fsPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  fsTotal = data.total || 0;
  const remindBtn = document.getElementById('fs-remind-btn');
  if (remindBtn) {
    remindBtn.dataset.currentValue = String(Number(list[0]?.remind_stock || 0));
    remindBtn.style.display = 'none';
  }
  
  const tbody = document.getElementById('finished-stock-rows');
  if (!tbody) return;
  
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px; color:#94a3b8">暂无数据</td></tr>';
    renderFsPager();
    return;
  }
  
  tbody.innerHTML = list.map((p, idx) => {
    const totalStock = Number(p.total_stock || 0);
    const remindStock = Math.max(0, Number(p.remind_stock || 0));
    const isLowStock = remindStock > 0 && totalStock <= remindStock;
    let stockHtml = totalStock;
    let expiryHtml = '';
    let loteHtml = '';
    const displayBatches = buildFinishedStockRows(totalStock, p.batches);
    if (displayBatches.length > 0) {
      stockHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map(b => `<div>${b.qty}</div>`).join('') + `</div>`;
      expiryHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map(b => `<div>${b.expiry || ''}</div>`).join('') + `</div>`;
      loteHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map(b => `<div>${b.lote ? formatFinishedLote(b.lote) : '无Lote'}</div>`).join('') + `</div>`;
    } else if (p.batches && p.batches.length > 0) {
      stockHtml = 0;
    }
    const stockCellHtml = `<div style="${isLowStock ? 'color:#ef4444;font-weight:700' : ''}">${stockHtml}</div>`;
    const remindHtml = remindStock > 0 ? remindStock : '<span style="color:#94a3b8">未设置</span>';
    const viewBtn = `<button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="location.hash='#stock-history?id=${p.id}'">查看</button>`;
    return `
    <tr>
      <td>${fsTotal - (fsPage - 1) * fsPageSize - idx}</td>
      <td style="padding:8px; width:60px; height:60px; text-align:center">${p.image ? `<img src="${p.image}" class="thumb-img" onclick="showFileViewer('${p.image}')" style="width:44px; height:44px; object-fit:contain; display:inline-block; vertical-align:middle">` : ''}</td>
      <td>${p.sku || ''}</td>
      <td>${p.name}</td>
      <td>${p.name_cn || ''}</td>
      <td>${stockCellHtml}</td>
      <td>${remindHtml}</td>
      <td>${loteHtml}</td>
      <td>${expiryHtml}</td>
      <td style="text-align:center">
        ${viewBtn}
      </td>
    </tr>
    `;
  }).join('');
  
  renderFsPager();
}
function openAllFinishedStockReminderModal() {
  const currentValue = Number(document.getElementById('fs-remind-btn')?.dataset.currentValue || 0);
  if (!fsRemindModal || !fsRemindInput) return;
  fsRemindInput.value = String(currentValue);
  fsRemindModal.style.display = 'flex';
  setTimeout(() => {
    fsRemindInput.focus();
    fsRemindInput.select();
  }, 0);
}
function closeAllFinishedStockReminderModal() {
  if (fsRemindModal) fsRemindModal.style.display = 'none';
}
async function setAllFinishedStockReminder() {
  const remindStock = Math.max(0, Number(fsRemindInput?.value || 0));
  if (!Number.isFinite(remindStock)) {
    alert('请输入有效数字');
    return;
  }
  const saveBtn = document.getElementById('fs-remind-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';
  }
  const res = await fetchWithAuth('/api/products-remind-stock-all', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remind_stock: remindStock })
  });
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  }
  if (!res.ok) {
    alert('提醒数量保存失败');
    return;
  }
  const btn = document.getElementById('fs-remind-btn');
  if (btn) btn.dataset.currentValue = String(remindStock);
  closeAllFinishedStockReminderModal();
  showAppToast('已统一设置所有商品提醒数量');
  await loadFinishedStock(fsPage);
}
if (fsRemindCancel) fsRemindCancel.addEventListener('click', closeAllFinishedStockReminderModal);
if (fsRemindCancelTop) fsRemindCancelTop.addEventListener('click', closeAllFinishedStockReminderModal);
if (fsRemindForm) {
  fsRemindForm.addEventListener('submit', async e => {
    e.preventDefault();
    await setAllFinishedStockReminder();
  });
}
window.openAllFinishedStockReminderModal = openAllFinishedStockReminderModal;
window.setAllFinishedStockReminder = setAllFinishedStockReminder;

async function loadFinishedStockAdjustments(page = 1) {
  fsAdjustPage = page;
  const q = document.getElementById('fs-search')?.value?.trim() || '';
  const res = await fetchWithAuth(`/api/inventory/finished?page=${fsAdjustPage}&size=${fsPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  fsAdjustTotal = data.total || 0;
  const tbody = document.getElementById('finished-stock-adjust-rows');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8">暂无数据</td></tr>';
    renderFsAdjustPager();
    return;
  }
  tbody.innerHTML = list.map((p, idx) => {
    const totalStock = Number(p.total_stock || 0);
    let stockHtml = totalStock;
    let expiryHtml = '';
    let loteHtml = '';
    const displayBatches = mergeFinishedBatches(p.batches);
    if (displayBatches.length > 0) {
      stockHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map(b => `<div>${b.qty}</div>`).join('') + `</div>`;
      expiryHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map(b => `<div>${b.expiry || ''}</div>`).join('') + `</div>`;
      loteHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map(b => `<div>${formatFinishedLote(b.lote)}</div>`).join('') + `</div>`;
    } else if (p.batches && p.batches.length > 0) {
      stockHtml = 0;
    }
    return `
    <tr>
      <td>${fsAdjustTotal - (fsAdjustPage - 1) * fsPageSize - idx}</td>
      <td style="padding:8px; width:60px; height:60px; text-align:center">${p.image ? `<img src="${p.image}" class="thumb-img" onclick="showFileViewer('${p.image}')" style="width:44px; height:44px; object-fit:contain; display:inline-block; vertical-align:middle">` : ''}</td>
      <td>${p.sku || ''}</td>
      <td>${p.name}</td>
      <td>${p.name_cn || ''}</td>
      <td>${stockHtml}</td>
      <td>${loteHtml}</td>
      <td>${expiryHtml}</td>
      <td style="text-align:center">${can('finished_stock_adjust', 'view') ? `<button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="openFinishedStockAdjustment('${encodeURIComponent(JSON.stringify(p))}')">调整</button>` : ''}</td>
    </tr>
    `;
  }).join('');
  renderFsAdjustPager();
}
window.loadFinishedStockAdjustments = loadFinishedStockAdjustments;

async function loadFinishedStockRecords(page = 1) {
  fsRecordPage = page;
  const tbody = document.getElementById('finished-stock-record-rows');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" class="empty">加载中...</td></tr>';
  try {
    const res = await fetchWithAuth(`/api/inventory/finished/logs?page=${fsRecordPage}&size=${fsRecordPageSize}&_t=${Date.now()}`);
    if (!res.ok) throw new Error('Failed to load finished stock records');
    const data = await res.json();
    const list = data.list || [];
    fsRecordTotal = data.total || 0;
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty">暂无记录</td></tr>';
      renderFsRecordPager();
      return;
    }
    tbody.innerHTML = list.map((row, idx) => {
      const d = new Date(Number(row.date || 0));
      const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const qty = Number(row.qty || 0);
      const qtyColor = qty >= 0 ? '#10b981' : '#f97316';
      return `
        <tr>
          <td>${fsRecordTotal - (fsRecordPage - 1) * fsRecordPageSize - idx}</td>
          <td>${row.sku || ''}</td>
          <td>${row.name || ''}</td>
          <td>${row.name_cn || ''}</td>
          <td>${dateStr}</td>
          <td>${row.invoice_no || '-'}</td>
          <td>${row.customer || '-'}</td>
          <td style="text-align:right; color:${qtyColor}; font-weight:600">${qty > 0 ? '+' : ''}${qty}</td>
          <td>${renderLoteLines(row.lote)}</td>
          <td style="white-space:pre-wrap; word-break:break-word">${row.notes || '-'}</td>
          <td>${row.user || '-'}</td>
        </tr>
      `;
    }).join('');
    renderFsRecordPager();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="11" class="empty" style="color:#ef4444">加载失败</td></tr>';
  }
}

function renderFsPager() {
  const pager = document.getElementById('fs-pager');
  if (!pager) return;
  const totalPages = Math.ceil(fsTotal / fsPageSize);
  if (totalPages <= 1) {
    pager.style.display = 'none';
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="btn-secondary" ${fsPage <= 1 ? 'disabled' : ''} onclick="loadFinishedStock(${fsPage - 1})">上一页</button>
    <span style="font-size:14px; color:#cbd5e1">第 ${fsPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${fsPage >= totalPages ? 'disabled' : ''} onclick="loadFinishedStock(${fsPage + 1})">下一页</button>
  `;
}

function renderFsRecordPager() {
  const pager = document.getElementById('fs-record-pager');
  if (!pager) return;
  const totalPages = Math.ceil(fsRecordTotal / fsRecordPageSize);
  if (totalPages <= 1) {
    pager.style.display = 'none';
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="btn-secondary" ${fsRecordPage <= 1 ? 'disabled' : ''} onclick="loadFinishedStockRecords(${fsRecordPage - 1})">上一页</button>
    <span style="font-size:14px; color:#cbd5e1">第 ${fsRecordPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${fsRecordPage >= totalPages ? 'disabled' : ''} onclick="loadFinishedStockRecords(${fsRecordPage + 1})">下一页</button>
  `;
}
function renderFsAdjustPager() {
  const pager = document.getElementById('fs-adjust-pager');
  if (!pager) return;
  const totalPages = Math.ceil(fsAdjustTotal / fsPageSize);
  if (totalPages <= 1) {
    pager.style.display = 'none';
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="btn-secondary" ${fsAdjustPage <= 1 ? 'disabled' : ''} onclick="loadFinishedStockAdjustments(${fsAdjustPage - 1})">上一页</button>
    <span style="font-size:14px; color:#cbd5e1">第 ${fsAdjustPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${fsAdjustPage >= totalPages ? 'disabled' : ''} onclick="loadFinishedStockAdjustments(${fsAdjustPage + 1})">下一页</button>
  `;
}
async function loadStockHistory(id) {
  const tbody = document.getElementById('stock-history-rows');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8">加载中...</td></tr>';
  
  try {
    const res = await fetchWithAuth(`/api/inventory/finished/${id}/logs`);
    if (!res.ok) throw new Error('Failed to load logs');
    const logs = await res.json();
    
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8">暂无记录</td></tr>';
      return;
    }
    
    tbody.innerHTML = logs.map((log, i) => {
      const color = log.type === 'in' ? '#10b981' : (log.type === 'adjust' ? '#facc15' : '#f97316');
      const typeLabel = log.type === 'in' ? '入库' : (log.type === 'adjust' ? '库存调整' : '销售出库');
      const d = new Date(log.date);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const user = log.user || '-';
      const invoiceNo = log.invoice_no || '-';
      const customer = log.customer || '-';
      const lote = log.lote || '-';
      
      return `
        <tr style="color:${color}">
          <td>${logs.length - i}</td>
          <td>${dateStr}</td>
          <td>${invoiceNo}</td>
          <td>${customer}</td>
          <td>${lote}</td>
          <td>${Number(log.raw_qty || 0) > 0 ? '+' : ''}${Number(log.raw_qty || 0)}</td>
          <td>${typeLabel}</td>
          <td style="white-space:pre-wrap; word-break:break-word">${log.notes || '-'}</td>
          <td>${user}</td>
        </tr>
      `;
    }).join('');
    
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#ef4444">加载失败</td></tr>';
  }
}
let fsItems = [];
function escapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function openFinishedStockAdjustment(encodedProduct) {
  const p = typeof encodedProduct === 'string' ? JSON.parse(decodeURIComponent(encodedProduct)) : encodedProduct;
  if (!p) return;
  fsAdjustState = {
    productId: p.id,
    name: p.name || '',
    batches: mergeFinishedBatches(p.batches)
  };
  const defaultBatch = fsAdjustState.batches[0] || {};
  document.getElementById('fs-adjust-product-id').value = p.id;
  document.getElementById('fs-adjust-notes').value = '';
  document.getElementById('fs-adjust-tbody').innerHTML = `
    <tr>
      <td>${escapeHtml(p.name || '')}</td>
      <td><input id="fs-adjust-qty" type="number" step="0.01" style="width:100%" placeholder="可填正负数"></td>
      <td>${fsAdjustState.batches.length ? `
        <select id="fs-adjust-lote" style="width:100%">
          ${fsAdjustState.batches.map(b => `<option value="${escapeHtml(b.lote || '')}" ${String(b.lote || '') === String(defaultBatch.lote || '') ? 'selected' : ''}>${escapeHtml(`${formatFinishedLote(b.lote)} / 库存:${b.qty}${b.expiry ? ` / 到期:${b.expiry}` : ''}`)}</option>`).join('')}
        </select>
      ` : `
        <input id="fs-adjust-lote" type="text" value="" style="width:100%" placeholder="输入批次">
      `}</td>
      <td><input id="fs-adjust-expiry" type="date" value="${escapeHtml(defaultBatch.expiry || '')}" style="width:100%"></td>
    </tr>
  `;
  const loteInput = document.getElementById('fs-adjust-lote');
  loteInput?.addEventListener('change', () => {
    if (!fsAdjustState?.batches) return;
    const matched = fsAdjustState.batches.find(b => String(b.lote || '').trim() === loteInput.value.trim());
    if (matched) document.getElementById('fs-adjust-expiry').value = matched.expiry || '';
  });
  document.getElementById('fs-adjust-modal').style.display = 'flex';
}
window.openFinishedStockAdjustment = openFinishedStockAdjustment;
async function saveFinishedStockAdjustment() {
  const productId = Number(document.getElementById('fs-adjust-product-id').value || 0);
  const qty = Number(document.getElementById('fs-adjust-qty').value || 0);
  const lote = (document.getElementById('fs-adjust-lote').value || '').trim();
  const expiry = (document.getElementById('fs-adjust-expiry').value || '').trim();
  const notes = (document.getElementById('fs-adjust-notes').value || '').trim();
  if (!productId || !Number.isFinite(qty) || qty === 0) return alert('请填写有效数量');
  if (!lote) return alert('请选择或输入Lote');
  if (!notes) return alert('请填写备注');
  const res = await fetchWithAuth('/api/inventory/finished/adjust', {
    method: 'PUT',
    body: JSON.stringify({ productId, qty, lote, expiry, notes })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(
      err.error === 'bad_request' ? '请填写完整调整信息'
      : err.error === 'not_found' ? '商品不存在'
      : err.error === 'batch_not_found' ? '所选Lote不存在'
      : '保存失败'
    );
  }
  document.getElementById('fs-adjust-modal').style.display = 'none';
  if (fsCurrentTab === 'adjust') loadFinishedStockAdjustments(fsAdjustPage);
  loadFinishedStock(fsPage);
  loadFinishedStockRecords(1);
}
window.saveFinishedStockAdjustment = saveFinishedStockAdjustment;

function openFinishedStockModal(resetItems = true) {
  const m = document.getElementById('fs-add-modal');
  if (m) {
    m.style.display = 'flex';
    if (resetItems) fsItems = [];
    renderFsItems();
  }
}
function startFinishedStockAdd() {
  fsItems = [];
  renderFsItems();
  openFsProdSelector();
}
window.startFinishedStockAdd = startFinishedStockAdd;

function renderFsItems() {
  const tbody = document.getElementById('fs-items-tbody');
  if (!tbody) return;
  
  if (fsItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">请先选择商品</td></tr>';
    return;
  }
  
  tbody.innerHTML = fsItems.map((item, idx) => `
    <tr>
      <td>${item.name}</td>
      <td><input type="number" class="fs-item-qty" data-idx="${idx}" value="${item.qty||''}" style="width:100%" placeholder="数量"></td>
      <td>
        <div style="display:flex; align-items:center; gap:4px">
          <input type="text" class="fs-item-lote" data-idx="${idx}" value="${item.lote||''}" style="width:100%; flex:1" placeholder="输入批次或选择日期" onchange="updateFsExpiry(${idx}, this.value)">
          <div style="position:relative; width:24px; height:24px; display:flex; align-items:center; justify-content:center; cursor:pointer">
            <span style="font-size:14px">📅</span>
            <input type="date" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer" onchange="const el=document.querySelector('.fs-item-lote[data-idx=\\'${idx}\\']'); el.value=this.value; updateFsExpiry(${idx}, this.value)">
          </div>
        </div>
      </td>
      <td><input type="date" class="fs-item-expiry" data-idx="${idx}" value="${item.expiry||''}" style="width:100%"></td>
      <td style="text-align:center"><button class="btn-sm btn-red" onclick="removeFsItem(${idx})">删除</button></td>
    </tr>
  `).join('');
}

function updateFsExpiry(idx, loteDateStr) {
  // Save current qtys before re-render
  document.querySelectorAll('.fs-item-qty').forEach(el => {
    if (fsItems[el.dataset.idx]) fsItems[el.dataset.idx].qty = el.value;
  });

  fsItems[idx].lote = loteDateStr;
  if (!loteDateStr) return;
  
  const parts = loteDateStr.split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
    if (!isNaN(d.getTime())) {
      // Add 6 months
      d.setMonth(d.getMonth() + 6);
      
      const expYear = d.getFullYear();
      const expMonth = String(d.getMonth() + 1).padStart(2, '0');
      const expDay = String(d.getDate()).padStart(2, '0');
      
      fsItems[idx].expiry = `${expYear}-${expMonth}-${expDay}`;
      renderFsItems();
      return;
    }
  }
  
  // If not a valid date, just save the lote string without updating expiry
  // Don't call renderFsItems() here to avoid losing focus while typing free text
}

function removeFsItem(idx) {
  fsItems.splice(idx, 1);
  renderFsItems();
}

function openFsProdSelector() {
  const m = document.getElementById('prod-selector-modal');
  if (m) {
    window.selectedProducts.clear();
    window.onProdSelectDone = null;
    m.style.display = 'flex';
    prodSelSearch.value = '';
    loadProductSelector(1);
    window.onProdSelect = function(prod, isBatch) {
      if (!fsItems.some(i => i.productId === prod.id)) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const loteDateStr = `${year}-${month}-${day}`;
        
        now.setMonth(now.getMonth() + 6);
        const expYear = now.getFullYear();
        const expMonth = String(now.getMonth() + 1).padStart(2, '0');
        const expDay = String(now.getDate()).padStart(2, '0');
        const expiryDateStr = `${expYear}-${expMonth}-${expDay}`;
        
        fsItems.push({
          productId: prod.id,
          name: prod.name,
          qty: '',
          lote: loteDateStr,
          expiry: expiryDateStr
        });
        renderFsItems();
      }
      if (!isBatch) {
        m.style.display = 'none';
        openFinishedStockModal(false);
      }
    };
    window.onProdSelectDone = function() {
      openFinishedStockModal(false);
    };
  }
}

async function saveFinishedStock() {
  if (fsItems.length === 0) return alert('请选择商品');
  
  // Update qtys and dates from DOM before saving
  document.querySelectorAll('.fs-item-qty').forEach(el => {
    if (fsItems[el.dataset.idx]) fsItems[el.dataset.idx].qty = el.value;
  });
  document.querySelectorAll('.fs-item-lote').forEach(el => {
    if (fsItems[el.dataset.idx]) fsItems[el.dataset.idx].lote = el.value;
  });
  document.querySelectorAll('.fs-item-expiry').forEach(el => {
    if (fsItems[el.dataset.idx]) fsItems[el.dataset.idx].expiry = el.value;
  });
  
  const invalid = fsItems.find(i => !i.qty || Number(i.qty) <= 0 || !i.lote || !i.expiry);
  if (invalid) {
    return alert(`请填写完整的数量、Lote和过期时间 (${invalid.name})`);
  }
  
  await fetchWithAuth('/api/inventory/finished', {
    method: 'POST',
    body: JSON.stringify({ items: fsItems })
  });
  
  document.getElementById('fs-add-modal').style.display = 'none';
  loadFinishedStock();
}

function getDefaultBatchDates() {
  const loteDate = new Date();
  const lote = `${loteDate.getFullYear()}-${String(loteDate.getMonth() + 1).padStart(2, '0')}-${String(loteDate.getDate()).padStart(2, '0')}`;
  const expiryDate = new Date(loteDate.getTime());
  expiryDate.setMonth(expiryDate.getMonth() + 6);
  const expiry = `${expiryDate.getFullYear()}-${String(expiryDate.getMonth() + 1).padStart(2, '0')}-${String(expiryDate.getDate()).padStart(2, '0')}`;
  return { lote, expiry };
}

function syncSelectedRawMaterialsFromItems() {
  window.selectedRawMaterials = new Map(
    rsAddItems
      .filter(item => Number(item?.materialId || 0) > 0)
      .map(item => [Number(item.materialId), { id: Number(item.materialId), name: item.name || '', image: item.image || '', stock: item.stock || 0 }])
  );
}

function renderRawStockItems() {
  const tbody = document.getElementById('rs-items-tbody');
  if (!tbody) return;
  if (rsAddItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">请先选择原材料</td></tr>';
    return;
  }
  tbody.innerHTML = rsAddItems.map((item, idx) => `
    <tr>
      <td>${escapeHtml(item.name || '')}</td>
      <td><input type="number" class="rs-item-qty" data-idx="${idx}" value="${item.qty || ''}" style="width:100%" placeholder="数量"></td>
      <td>
        <div style="display:flex; align-items:center; gap:4px">
          <input type="text" class="rs-item-lote" data-idx="${idx}" value="${item.lote || ''}" style="width:100%; flex:1" placeholder="输入批次或选择日期" onchange="updateRsExpiry(${idx}, this.value)">
          <div style="position:relative; width:24px; height:24px; display:flex; align-items:center; justify-content:center; cursor:pointer">
            <span style="font-size:14px">📅</span>
            <input type="date" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer" onchange="const el=document.querySelector('.rs-item-lote[data-idx=\\'${idx}\\']'); if (el) el.value=this.value; updateRsExpiry(${idx}, this.value)">
          </div>
        </div>
      </td>
      <td><input type="date" class="rs-item-expiry" data-idx="${idx}" value="${item.expiry || ''}" style="width:100%"></td>
      <td style="text-align:center"><button class="btn-sm btn-red" onclick="removeRsItem(${idx})">删除</button></td>
    </tr>
  `).join('');
}

function openRawStockModal(resetItems = true) {
  const modal = document.getElementById('rs-add-modal');
  if (!modal) return;
  if (resetItems) rsAddItems = [];
  renderRawStockItems();
  modal.style.display = 'flex';
}
window.openRawStockModal = openRawStockModal;

function startRawStockAdd() {
  rsAddItems = [];
  renderRawStockItems();
  openRawMaterialSelector();
}
window.startRawStockAdd = startRawStockAdd;

function updateRsExpiry(idx, loteDateStr) {
  document.querySelectorAll('.rs-item-qty').forEach(el => {
    if (rsAddItems[el.dataset.idx]) rsAddItems[el.dataset.idx].qty = el.value;
  });
  rsAddItems[idx].lote = loteDateStr;
  if (!loteDateStr) return;
  const parts = loteDateStr.split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    if (!isNaN(d.getTime())) {
      d.setMonth(d.getMonth() + 6);
      rsAddItems[idx].expiry = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      renderRawStockItems();
    }
  }
}
window.updateRsExpiry = updateRsExpiry;

function removeRsItem(idx) {
  rsAddItems.splice(idx, 1);
  renderRawStockItems();
}
window.removeRsItem = removeRsItem;

async function loadRawMaterialSelector(page = 1) {
  rsSelPage = page;
  if (!rsSelList) return;
  rsSelList.innerHTML = '<div style="padding:16px; color:#94a3b8">加载中...</div>';
  const q = rsSelSearch?.value?.trim() || '';
  const res = await fetchWithAuth(`/api/inventory/raw?page=${rsSelPage}&size=${rsSelPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) {
    rsSelList.innerHTML = '<div style="padding:16px; color:#ef4444">加载失败</div>';
    return;
  }
  const data = await res.json();
  const list = data.list || [];
  rsSelTotal = Number(data.total || 0);
  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.innerHTML = `
    <thead>
      <tr style="border-bottom:1px solid #334155; color:#94a3b8; font-size:12px; text-align:left">
        <th style="padding:8px; width:40px; text-align:center"><input type="checkbox" id="rs-sel-select-all" onclick="toggleAllRawMaterialSelection(this)"></th>
        <th style="padding:8px; width:72px">图片</th>
        <th style="padding:8px">名称</th>
        <th style="padding:8px; text-align:right">库存</th>
      </tr>
    </thead>
    <tbody id="rs-sel-tbody"></tbody>
  `;
  const tbody = table.querySelector('tbody');
  list.forEach(m => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #1e293b';
    tr.style.cursor = 'pointer';
    tr.onmouseover = () => tr.style.background = '#1e293b';
    tr.onmouseout = () => tr.style.background = 'transparent';
    const isSelected = window.selectedRawMaterials && window.selectedRawMaterials.has(m.id);
    tr.dataset.material = JSON.stringify(m);
    tr.innerHTML = `
      <td style="padding:8px; text-align:center">
        <input type="checkbox" class="rs-sel-checkbox" value="${m.id}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleRawMaterialSelection(${m.id})">
      </td>
      <td style="padding:8px">
        ${m.image ? `<img src="${m.image}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; border:1px solid #334155">` : '<div style="width:48px; height:48px; background:#0f172a; border-radius:4px; border:1px solid #334155"></div>'}
      </td>
      <td style="padding:8px; color:#e2e8f0; font-weight:500">${escapeHtml(m.name || '')}</td>
      <td style="padding:8px; text-align:right; color:#64748b">${Number(m.stock || 0)}</td>
    `;
    tr.addEventListener('click', (e) => {
      if (e.target.tagName.toLowerCase() !== 'input') {
        const cb = tr.querySelector('.rs-sel-checkbox');
        cb.checked = !cb.checked;
        toggleRawMaterialSelection(m.id, m);
      }
    });
    tbody.appendChild(tr);
  });
  rsSelList.innerHTML = '';
  rsSelList.appendChild(table);
  const totalPages = Math.ceil(rsSelTotal / rsSelPageSize);
  if (totalPages > 1) {
    const pager = document.createElement('div');
    pager.style.display = 'flex';
    pager.style.justifyContent = 'center';
    pager.style.gap = '12px';
    pager.style.alignItems = 'center';
    pager.style.padding = '12px 0';
    pager.style.marginTop = '12px';
    pager.style.borderTop = '1px solid #334155';
    pager.innerHTML = `
      <button class="btn-secondary" style="padding:4px 12px" ${rsSelPage <= 1 ? 'disabled' : ''} onclick="loadRawMaterialSelector(${rsSelPage - 1})">上一页</button>
      <span style="color:#cbd5e1; font-size:13px">第 ${rsSelPage} / ${totalPages} 页</span>
      <button class="btn-secondary" style="padding:4px 12px" ${rsSelPage >= totalPages ? 'disabled' : ''} onclick="loadRawMaterialSelector(${rsSelPage + 1})">下一页</button>
    `;
    rsSelList.appendChild(pager);
  }
  updateRawMaterialSelectAll();
}
window.loadRawMaterialSelector = loadRawMaterialSelector;

window.selectedRawMaterials = new Map();

window.toggleRawMaterialSelection = function(id, materialObj) {
  if (!materialObj) {
    const cb = document.querySelector(`.rs-sel-checkbox[value="${id}"]`);
    if (cb && cb.closest('tr')) {
      materialObj = JSON.parse(cb.closest('tr').dataset.material);
      if (!cb.checked) window.selectedRawMaterials.delete(id);
      else window.selectedRawMaterials.set(id, materialObj);
    }
  } else {
    const cb = document.querySelector(`.rs-sel-checkbox[value="${id}"]`);
    if (cb) {
      if (cb.checked) window.selectedRawMaterials.set(id, materialObj);
      else window.selectedRawMaterials.delete(id);
    }
  }
  updateRawMaterialSelectAll();
};

window.toggleAllRawMaterialSelection = function(el) {
  const checkboxes = document.querySelectorAll('.rs-sel-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = el.checked;
    const id = parseInt(cb.value, 10);
    const materialObj = JSON.parse(cb.closest('tr').dataset.material);
    if (el.checked) window.selectedRawMaterials.set(id, materialObj);
    else window.selectedRawMaterials.delete(id);
  });
};

function updateRawMaterialSelectAll() {
  const selectAllCb = document.getElementById('rs-sel-select-all');
  const checkboxes = document.querySelectorAll('.rs-sel-checkbox');
  if (selectAllCb && checkboxes.length > 0) {
    selectAllCb.checked = Array.from(checkboxes).every(cb => cb.checked);
  }
}

function openRawMaterialSelector() {
  if (!rsSelModal) return;
  syncSelectedRawMaterialsFromItems();
  rsSelModal.style.display = 'flex';
  if (rsSelSearch) rsSelSearch.value = '';
  loadRawMaterialSelector(1);
}
window.openRawMaterialSelector = openRawMaterialSelector;

window.confirmRawMaterialSelection = function() {
  if (!window.selectedRawMaterials || window.selectedRawMaterials.size === 0) {
    alert('请先选择至少一个原材料');
    return;
  }
  const defaults = getDefaultBatchDates();
  Array.from(window.selectedRawMaterials.values()).forEach(m => {
    if (!rsAddItems.some(item => Number(item.materialId) === Number(m.id))) {
      rsAddItems.push({
        materialId: Number(m.id),
        name: m.name || '',
        image: m.image || '',
        stock: Number(m.stock || 0),
        qty: '',
        lote: defaults.lote,
        expiry: defaults.expiry
      });
    }
  });
  if (rsSelModal) rsSelModal.style.display = 'none';
  openRawStockModal(false);
};

if (rsSelSearch) rsSelSearch.addEventListener('input', () => loadRawMaterialSelector(1));
const rsSelClose = document.getElementById('rs-sel-close');
if (rsSelClose) {
  rsSelClose.addEventListener('click', () => {
    if (rsSelModal) rsSelModal.style.display = 'none';
  });
}

function buildRawBatches(batches) {
  if (!Array.isArray(batches)) return [];
  return batches
    .map(b => ({
      qty: Number(b?.qty || 0),
      expiry: String(b?.expiry || '').trim(),
      lote: String(b?.lote || '').trim()
    }))
    .filter(b => b.qty > 0)
    .sort((a, b) => {
      const expCmp = (a.expiry || '9999-12-31').localeCompare(b.expiry || '9999-12-31');
      if (expCmp !== 0) return expCmp;
      return (a.lote || '').localeCompare(b.lote || '');
    });
}
function renderRawStockLines(batches) {
  const displayBatches = buildRawBatches(batches);
  if (!displayBatches.length) return '-';
  return `<div style="display:flex;flex-direction:column;gap:4px">${displayBatches.map(b => `<div>${escapeHtml(`${b.lote || '无Lote'} / ${b.qty}${b.expiry ? ` / 到期:${b.expiry}` : ''}`)}</div>`).join('')}</div>`;
}
function renderRawExpiryLines(batches) {
  const displayBatches = buildRawBatches(batches);
  if (!displayBatches.length) return '-';
  return `<div style="display:flex;flex-direction:column;gap:4px">${displayBatches.map(b => `<div>${escapeHtml(b.expiry || '-')}</div>`).join('')}</div>`;
}
function formatRawRecordType(type) {
  if (type === 'in') return '入库';
  if (type === 'adjust') return '库存调整';
  return '出库';
}
function syncRawMaterialOptions(list = []) {
  rsMaterialOptions = list.map(x => ({
    id: x.id,
    name: String(x.name || '').trim(),
    image: String(x.image || '').trim()
  })).filter(x => x.name);
  const datalist = document.getElementById('rs-name-options');
  if (datalist) {
    const uniqNames = Array.from(new Set(rsMaterialOptions.map(x => x.name)));
    datalist.innerHTML = uniqNames.map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
  }
}
function switchRawStockTab(tab, btn) {
  rsCurrentTab = tab === 'records' ? 'records' : (tab === 'adjust' ? 'adjust' : 'stock');
  const stockPanel = document.getElementById('rs-stock-panel');
  const recordPanel = document.getElementById('rs-records-panel');
  const adjustPanel = document.getElementById('rs-adjust-panel');
  const toolbar = document.getElementById('rs-stock-toolbar');
  const addNameBtn = document.getElementById('rs-add-name-btn');
  const addStockBtn = document.getElementById('rs-add-stock-btn');
  if (stockPanel) stockPanel.style.display = rsCurrentTab === 'stock' ? 'block' : 'none';
  if (recordPanel) recordPanel.style.display = rsCurrentTab === 'records' ? 'block' : 'none';
  if (adjustPanel) adjustPanel.style.display = rsCurrentTab === 'adjust' ? 'block' : 'none';
  if (toolbar) toolbar.style.display = 'flex';
  if (addNameBtn) addNameBtn.style.display = rsCurrentTab === 'stock' ? 'inline-flex' : 'none';
  if (addStockBtn) addStockBtn.style.display = rsCurrentTab === 'stock' ? 'inline-flex' : 'none';
  document.querySelectorAll('#page-raw-stock .tab').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const activeBtn = document.getElementById(rsCurrentTab === 'stock' ? 'rs-tab-stock' : (rsCurrentTab === 'records' ? 'rs-tab-records' : 'rs-tab-adjust'));
    if (activeBtn) activeBtn.classList.add('active');
  }
  if (rsCurrentTab === 'stock') loadRawStock(1);
  else if (rsCurrentTab === 'records') loadRawStockRecords(1);
  else loadRawStockAdjustments(1);
}
window.switchRawStockTab = switchRawStockTab;
function handleRsSearchInput() {
  if (rsCurrentTab === 'records') loadRawStockRecords(1);
  else if (rsCurrentTab === 'adjust') loadRawStockAdjustments(1);
  else loadRawStock(1);
}
window.handleRsSearchInput = handleRsSearchInput;
async function loadRawStock(page = 1) {
  rsPage = page;
  const q = document.getElementById('rs-search')?.value?.trim() || '';
  const res = await fetchWithAuth(`/api/inventory/raw?page=${rsPage}&size=${rsPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  rsTotal = data.total || 0;
  syncRawMaterialOptions(list);
  const tbody = document.getElementById('raw-stock-rows');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无数据</td></tr>';
    renderRsPager();
    return;
  }
  tbody.innerHTML = list.map((m, idx) => `
    <tr>
      <td>${rsTotal - (rsPage - 1) * rsPageSize - idx}</td>
      <td style="padding:8px; width:60px; height:60px; text-align:center">${m.image ? `<img src="${m.image}" class="thumb-img" onclick="showFileViewer('${m.image}')" style="width:44px; height:44px; object-fit:contain; display:inline-block; vertical-align:middle">` : ''}</td>
      <td>${escapeHtml(m.name || '')}</td>
      <td>${Number(m.stock || 0)}</td>
      <td>${renderRawExpiryLines(m.batches)}</td>
      <td>${renderRawStockLines(m.batches)}</td>
      <td style="text-align:center">
        <div style="display:flex; gap:8px; justify-content:center">
          <button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="openRawMaterialEdit('${encodeURIComponent(JSON.stringify({ id: m.id, name: m.name || '', image: m.image || '' }))}')">编辑</button>
          <button class="btn-secondary" style="padding:4px 8px; font-size:12px; color:#fecaca; border-color:#7f1d1d; background:#450a0a" onclick="confirmDeleteRawMaterial('${encodeURIComponent(JSON.stringify({ id: m.id, name: m.name || '' }))}')">删除</button>
        </div>
      </td>
    </tr>
  `).join('');
  renderRsPager();
}
window.loadRawStock = loadRawStock;
async function loadRawStockAdjustments(page = 1) {
  rsAdjustPage = page;
  const q = document.getElementById('rs-search')?.value?.trim() || '';
  const res = await fetchWithAuth(`/api/inventory/raw?page=${rsAdjustPage}&size=${rsPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  rsAdjustTotal = data.total || 0;
  syncRawMaterialOptions(list);
  const tbody = document.getElementById('raw-stock-adjust-rows');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无数据</td></tr>';
    renderRsAdjustPager();
    return;
  }
  tbody.innerHTML = list.map((m, idx) => `
    <tr>
      <td>${rsAdjustTotal - (rsAdjustPage - 1) * rsPageSize - idx}</td>
      <td style="padding:8px; width:60px; height:60px; text-align:center">${m.image ? `<img src="${m.image}" class="thumb-img" onclick="showFileViewer('${m.image}')" style="width:44px; height:44px; object-fit:contain; display:inline-block; vertical-align:middle">` : ''}</td>
      <td>${escapeHtml(m.name || '')}</td>
      <td>${Number(m.stock || 0)}</td>
      <td>${renderRawExpiryLines(m.batches)}</td>
      <td>${renderRawStockLines(m.batches)}</td>
      <td style="text-align:center"><button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="openRawStockAdjustment('${encodeURIComponent(JSON.stringify(m))}')">调整</button></td>
    </tr>
  `).join('');
  renderRsAdjustPager();
}
window.loadRawStockAdjustments = loadRawStockAdjustments;
async function loadRawStockRecords(page = 1) {
  rsRecordPage = page;
  const q = document.getElementById('rs-search')?.value?.trim() || '';
  const tbody = document.getElementById('raw-stock-record-rows');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="empty">加载中...</td></tr>';
  try {
    const res = await fetchWithAuth(`/api/inventory/raw/logs?page=${rsRecordPage}&size=${rsRecordPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
    if (!res.ok) throw new Error('Failed to load raw stock logs');
    const data = await res.json();
    const list = data.list || [];
    rsRecordTotal = data.total || 0;
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">暂无记录</td></tr>';
      renderRsRecordPager();
      return;
    }
    tbody.innerHTML = list.map((row, idx) => {
      const d = new Date(Number(row.date || 0));
      const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const qty = Number(row.qty || 0);
      const qtyColor = qty >= 0 ? '#10b981' : '#f97316';
      return `
        <tr>
          <td>${rsRecordTotal - (rsRecordPage - 1) * rsRecordPageSize - idx}</td>
          <td>${escapeHtml(row.name || '')}</td>
          <td>${dateStr}</td>
          <td>${formatRawRecordType(row.type)}</td>
          <td style="text-align:right; color:${qtyColor}; font-weight:600">${qty > 0 ? '+' : ''}${qty}</td>
          <td>${escapeHtml(row.expiry || '-')}</td>
          <td style="white-space:pre-wrap; word-break:break-word">${escapeHtml(row.notes || '-')}</td>
          <td>${escapeHtml(row.user || '-')}</td>
        </tr>
      `;
    }).join('');
    renderRsRecordPager();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="8" class="empty" style="color:#ef4444">加载失败</td></tr>';
  }
}
function renderRsPager() {
  const pager = document.getElementById('rs-pager');
  if (!pager) return;
  const totalPages = Math.ceil(rsTotal / rsPageSize);
  if (totalPages <= 1) {
    pager.style.display = 'none';
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="btn-secondary" ${rsPage <= 1 ? 'disabled' : ''} onclick="loadRawStock(${rsPage - 1})">上一页</button>
    <span style="font-size:14px; color:#cbd5e1">第 ${rsPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${rsPage >= totalPages ? 'disabled' : ''} onclick="loadRawStock(${rsPage + 1})">下一页</button>
  `;
}
function renderRsRecordPager() {
  const pager = document.getElementById('rs-record-pager');
  if (!pager) return;
  const totalPages = Math.ceil(rsRecordTotal / rsRecordPageSize);
  if (totalPages <= 1) {
    pager.style.display = 'none';
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="btn-secondary" ${rsRecordPage <= 1 ? 'disabled' : ''} onclick="loadRawStockRecords(${rsRecordPage - 1})">上一页</button>
    <span style="font-size:14px; color:#cbd5e1">第 ${rsRecordPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${rsRecordPage >= totalPages ? 'disabled' : ''} onclick="loadRawStockRecords(${rsRecordPage + 1})">下一页</button>
  `;
}
function renderRsAdjustPager() {
  const pager = document.getElementById('rs-adjust-pager');
  if (!pager) return;
  const totalPages = Math.ceil(rsAdjustTotal / rsPageSize);
  if (totalPages <= 1) {
    pager.style.display = 'none';
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="btn-secondary" ${rsAdjustPage <= 1 ? 'disabled' : ''} onclick="loadRawStockAdjustments(${rsAdjustPage - 1})">上一页</button>
    <span style="font-size:14px; color:#cbd5e1">第 ${rsAdjustPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${rsAdjustPage >= totalPages ? 'disabled' : ''} onclick="loadRawStockAdjustments(${rsAdjustPage + 1})">下一页</button>
  `;
}
function setRawMaterialModalPreview(imageUrl = '', fileName = '未选择图片') {
  if (rsMaterialImage) rsMaterialImage.value = imageUrl || '';
  if (rsMaterialPreview) {
    rsMaterialPreview.src = imageUrl || '';
    rsMaterialPreview.style.display = imageUrl ? 'block' : 'none';
  }
  if (rsMaterialFileName) rsMaterialFileName.textContent = fileName || (imageUrl ? '已保存图片' : '未选择图片');
}
function resetRawMaterialModal() {
  const input = document.getElementById('rs-material-name');
  if (input) input.value = '';
  rsMaterialEditId = null;
  if (rsMaterialIdInput) rsMaterialIdInput.value = '';
  if (rsMaterialFile) rsMaterialFile.value = '';
  setRawMaterialModalPreview('', '未选择图片');
}
function openRawMaterialNameModal() {
  resetRawMaterialModal();
  if (rsNameModalTitle) rsNameModalTitle.textContent = '添加原材料名称';
  if (rsNameModalSave) rsNameModalSave.textContent = '保存';
  document.getElementById('rs-name-modal').style.display = 'flex';
}
window.openRawMaterialNameModal = openRawMaterialNameModal;
function openRawMaterialEdit(raw) {
  let material = null;
  try {
    material = JSON.parse(decodeURIComponent(raw || ''));
  } catch (e) {
    console.warn('failed to decode raw material payload', e);
    return;
  }
  resetRawMaterialModal();
  rsMaterialEditId = Number(material?.id || 0) || null;
  if (rsMaterialIdInput) rsMaterialIdInput.value = rsMaterialEditId || '';
  const input = document.getElementById('rs-material-name');
  if (input) input.value = String(material?.name || '').trim();
  const imageUrl = String(material?.image || '').trim();
  setRawMaterialModalPreview(imageUrl, imageUrl ? '已保存图片' : '未选择图片');
  if (rsNameModalTitle) rsNameModalTitle.textContent = '编辑原材料名称';
  if (rsNameModalSave) rsNameModalSave.textContent = '保存修改';
  document.getElementById('rs-name-modal').style.display = 'flex';
}
window.openRawMaterialEdit = openRawMaterialEdit;
async function saveRawMaterialName() {
  const name = document.getElementById('rs-material-name').value.trim();
  if (!name) return alert('请填写原材料名称');
  const materialId = Number(rsMaterialEditId || rsMaterialIdInput?.value || 0);
  let image = rsMaterialImage?.value || '';
  const fileObj = rsMaterialFile?.files?.[0];
  if (fileObj) {
    const fd = new FormData();
    fd.append('file', fileObj);
    try {
      const token = getAuthToken();
      const r = await fetch(API_BASE + '/api/upload', {
        method: 'POST',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        body: fd
      });
      if (!r.ok) {
        alert('图片上传失败，请重试');
        return;
      }
      const d = await r.json();
      image = d.url || '';
      if (rsMaterialImage) rsMaterialImage.value = image;
    } catch (e) {
      console.warn('raw material image upload failed', e);
      alert('图片上传失败，请检查网络');
      return;
    }
  }
  const res = await fetchWithAuth(materialId ? `/api/inventory/raw/materials/${materialId}` : '/api/inventory/raw/materials', {
    method: materialId ? 'PUT' : 'POST',
    body: JSON.stringify({ name, image })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error === 'duplicate') return alert('原材料名称已存在');
    if (err.error === 'not_found') return alert('原材料不存在');
    return alert(materialId ? '保存修改失败' : '保存失败');
  }
  document.getElementById('rs-name-modal').style.display = 'none';
  if (rsCurrentTab === 'stock') loadRawStock(rsPage);
  else if (rsCurrentTab === 'adjust') loadRawStockAdjustments(rsAdjustPage);
}
window.saveRawMaterialName = saveRawMaterialName;
function confirmDeleteRawMaterial(raw) {
  let material = null;
  try {
    material = JSON.parse(decodeURIComponent(raw || ''));
  } catch (e) {
    console.warn('failed to decode raw material delete payload', e);
    return;
  }
  const mid = Number(material?.id || 0);
  if (!mid) return;
  const name = String(material?.name || '').trim() || '该原材料';
  openConfirm(`确定删除“${name}”吗？删除后不可恢复。`, async () => {
    const res = await fetchWithAuth(`/api/inventory/raw/materials/${mid}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.error === 'has_stock') return alert('该原材料还有库存，不能删除');
      if (err.error === 'has_logs') return alert('该原材料已有出入库记录，不能删除');
      if (err.error === 'not_found') return alert('原材料不存在');
      return alert('删除失败');
    }
    if (rsCurrentTab === 'stock') loadRawStock(1);
    else if (rsCurrentTab === 'adjust') loadRawStockAdjustments(1);
  });
}
window.confirmDeleteRawMaterial = confirmDeleteRawMaterial;

async function loadEventRecords(tab = 'ongoing', btn = null, page = 1) {
  eventRecordCurrentTab = tab === 'completed' ? 'completed' : 'ongoing';
  eventRecordPage = page;
  if (btn) {
    document.querySelectorAll('#page-event-records .tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  } else {
    const tBtn = document.querySelector(`#page-event-records .tab[data-tab="${eventRecordCurrentTab}"]`);
    if (tBtn) {
      document.querySelectorAll('#page-event-records .tab').forEach(b => b.classList.remove('active'));
      tBtn.classList.add('active');
    }
  }
  const q = document.getElementById('event-record-search')?.value?.trim() || '';
  const res = await fetchWithAuth(`/api/event-records?status=${eventRecordCurrentTab}&page=${eventRecordPage}&size=${eventRecordPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  currentEventRecordList = data.list || [];
  eventRecordTotal = data.total || 0;
  const setEventBadge = (id, count) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = count;
      el.style.display = count > 0 ? 'inline-block' : 'none';
    }
  };
  if (eventRecordCurrentTab === 'ongoing') {
    setEventBadge('tab-event-record-ongoing-badge', eventRecordTotal);
    setEventBadge('nav-event-record-badge', eventRecordTotal);
  }
  const tbody = document.getElementById('event-record-rows');
  if (!tbody) return;
  if (!currentEventRecordList.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="7">暂无数据</td></tr>';
    renderEventRecordPager();
    return;
  }
  tbody.innerHTML = currentEventRecordList.map((x, idx) => `
    <tr>
      <td>${eventRecordTotal - (eventRecordPage - 1) * eventRecordPageSize - idx}</td>
      <td title="${escapeHtml(x.name || '')}" style="min-width:260px; max-width:360px">
        <div style="display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; white-space:normal; word-break:break-word; line-height:1.7">${escapeHtml(x.name || '-')}</div>
      </td>
      <td>${escapeHtml(x.record_date || '')}</td>
      <td>${escapeHtml(x.due_date || '')}</td>
      <td title="${escapeHtml(x.notes || '')}" style="min-width:360px; max-width:460px">
        <div style="display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; white-space:normal; word-break:break-word; line-height:1.7">${escapeHtml(x.notes || '-')}</div>
      </td>
      <td>
        <div>${escapeHtml(x.created_by || '')}</div>
        ${eventRecordCurrentTab === 'completed' ? `<div style="margin-top:4px; font-size:12px; color:#94a3b8">确认：${escapeHtml(x.confirmed_by || '-')}</div>` : ''}
      </td>
      <td>
        ${eventRecordCurrentTab === 'ongoing'
          ? `<button class="btn-secondary" style="padding:4px 10px; font-size:12px" onclick="openEventRecordModal(${x.id})">编辑</button><button class="btn-sm" style="margin-left:6px" onclick="markEventRecordCompleted(${x.id})">完成</button>`
          : `<div style="display:flex; flex-direction:column; align-items:flex-start; gap:6px">
               <button class="btn-secondary" style="padding:4px 10px; font-size:12px" onclick="openEventRecordViewModal(${x.id})">查看</button>
               <button class="btn-secondary" style="padding:4px 10px; font-size:12px" onclick="markEventRecordOngoing(${x.id})">恢复进行中</button>
             </div>`}
      </td>
    </tr>
  `).join('');
  renderEventRecordPager();
}
window.loadEventRecords = loadEventRecords;
function renderEventRecordPager() {
  const pager = document.getElementById('event-record-pager');
  if (!pager) return;
  if (eventRecordTotal <= eventRecordPageSize) {
    pager.style.display = 'none';
    pager.innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(eventRecordTotal / eventRecordPageSize));
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="btn-secondary" ${eventRecordPage <= 1 ? 'disabled' : ''} onclick="loadEventRecords('${eventRecordCurrentTab}', null, ${Math.max(1, eventRecordPage - 1)})">上一页</button>
    <span>第 ${eventRecordPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${eventRecordPage >= totalPages ? 'disabled' : ''} onclick="loadEventRecords('${eventRecordCurrentTab}', null, ${Math.min(totalPages, eventRecordPage + 1)})">下一页</button>
  `;
}
function handleEventRecordSearchInput() { loadEventRecords(eventRecordCurrentTab, null, 1); }
window.handleEventRecordSearchInput = handleEventRecordSearchInput;
function openEventRecordModal(id = null) {
  const modal = document.getElementById('event-record-modal');
  const title = document.getElementById('event-record-modal-title');
  const idInput = document.getElementById('event-record-id');
  const nameInput = document.getElementById('event-record-name');
  const dateInput = document.getElementById('event-record-date');
  const dueInput = document.getElementById('event-record-due-date');
  const notesInput = document.getElementById('event-record-notes');
  if (!modal || !title || !idInput || !nameInput || !dateInput || !dueInput || !notesInput) return;
  if (!id) {
    title.textContent = '添加事件';
    idInput.value = '';
    nameInput.value = '';
    dateInput.value = new Date().toISOString().slice(0, 10);
    dueInput.value = '';
    notesInput.value = '';
  } else {
    const item = currentEventRecordList.find(x => Number(x.id) === Number(id));
    if (!item) return;
    title.textContent = '编辑事件';
    idInput.value = String(item.id);
    nameInput.value = item.name || '';
    dateInput.value = item.record_date || '';
    dueInput.value = item.due_date || '';
    notesInput.value = item.notes || '';
  }
  modal.style.display = 'flex';
}
window.openEventRecordModal = openEventRecordModal;
function closeEventRecordModal() {
  const modal = document.getElementById('event-record-modal');
  if (modal) modal.style.display = 'none';
}
window.closeEventRecordModal = closeEventRecordModal;
function openEventRecordViewModal(id) {
  const item = currentEventRecordList.find(x => Number(x.id) === Number(id));
  const modal = document.getElementById('event-record-view-modal');
  if (!item || !modal) return;
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '-';
  };
  setText('event-record-view-name', item.name || '');
  setText('event-record-view-date', item.record_date || '');
  setText('event-record-view-due-date', item.due_date || '');
  setText('event-record-view-notes', item.notes || '');
  setText('event-record-view-created-by', item.created_by || '');
  setText('event-record-view-confirmed-by', item.confirmed_by || '');
  modal.style.display = 'flex';
}
window.openEventRecordViewModal = openEventRecordViewModal;
function closeEventRecordViewModal() {
  const modal = document.getElementById('event-record-view-modal');
  if (modal) modal.style.display = 'none';
}
window.closeEventRecordViewModal = closeEventRecordViewModal;
async function saveEventRecord() {
  const id = Number(document.getElementById('event-record-id')?.value || 0);
  const name = document.getElementById('event-record-name')?.value?.trim() || '';
  const recordDate = document.getElementById('event-record-date')?.value || '';
  const dueDate = document.getElementById('event-record-due-date')?.value || '';
  const notes = document.getElementById('event-record-notes')?.value?.trim() || '';
  if (!name) return alert('请输入事件名称');
  const payload = {
    name,
    record_date: recordDate,
    due_date: dueDate,
    notes,
    status: eventRecordCurrentTab
  };
  const res = await fetchWithAuth(id ? `/api/event-records/${id}` : '/api/event-records', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return alert('保存失败');
  closeEventRecordModal();
  showAppToast('保存成功');
  loadEventRecords(eventRecordCurrentTab, null, 1);
}
window.saveEventRecord = saveEventRecord;
async function markEventRecordCompleted(id) {
  const item = currentEventRecordList.find(x => Number(x.id) === Number(id));
  if (!item) return;
  const res = await fetchWithAuth(`/api/event-records/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: item.name || '',
      record_date: item.record_date || '',
      due_date: item.due_date || '',
      notes: item.notes || '',
      status: 'completed'
    })
  });
  if (!res.ok) return alert('操作失败');
  showAppToast('已标记为完成');
  loadEventRecords(eventRecordCurrentTab, null, 1);
}
window.markEventRecordCompleted = markEventRecordCompleted;
async function markEventRecordOngoing(id) {
  const item = currentEventRecordList.find(x => Number(x.id) === Number(id));
  if (!item) return;
  const res = await fetchWithAuth(`/api/event-records/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: item.name || '',
      record_date: item.record_date || '',
      due_date: item.due_date || '',
      notes: item.notes || '',
      status: 'ongoing'
    })
  });
  if (!res.ok) return alert('操作失败');
  showAppToast('已恢复为进行中');
  loadEventRecords(eventRecordCurrentTab, null, 1);
}
window.markEventRecordOngoing = markEventRecordOngoing;

async function loadProductionEntries(tab = 'pending', btn = null, page = 1) {
  productionReviewCurrentTab = ['approved', 'rejected'].includes(tab) ? tab : 'pending';
  productionReviewPage = page;
  const reviewScope = document.getElementById('fs-review-panel') || document.getElementById('page-production-review');
  if (btn) {
    reviewScope?.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  } else {
    const tBtn = reviewScope?.querySelector(`.tab[data-tab="${productionReviewCurrentTab}"]`);
    if (tBtn) {
      reviewScope?.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      tBtn.classList.add('active');
    }
  }
  const q = document.getElementById('production-review-search')?.value?.trim() || '';
  const res = await fetchWithAuth(`/api/production-entries?status=${productionReviewCurrentTab}&page=${productionReviewPage}&size=${productionReviewPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  currentProductionEntryList = data.list || [];
  productionReviewTotal = data.total || 0;
  const tbody = document.getElementById('production-review-rows');
  if (!tbody) return;
  if (!currentProductionEntryList.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="10">暂无数据</td></tr>';
    renderProductionReviewPager();
    return;
  }
  tbody.innerHTML = currentProductionEntryList.map((x, idx) => `
    <tr>
      <td>${productionReviewTotal - (productionReviewPage - 1) * productionReviewPageSize - idx}</td>
      <td style="text-align:center">${x.photo_url ? `<img src="${x.photo_url}" class="thumb-img" onclick="showFileViewer('${x.photo_url}')" style="width:44px;height:44px;object-fit:cover;display:inline-block;cursor:zoom-in" title="点击放大">` : '-'}</td>
      <td>${escapeHtml(x.product_name || '')}</td>
      <td>${escapeHtml(x.product_name_cn || '')}</td>
      <td>${productionReviewCurrentTab === 'pending'
        ? `<span style="color:#ef4444; font-size:16px; font-weight:800">${escapeHtml(formatProductionReviewLote(x.lote || ''))}</span>`
        : escapeHtml(formatProductionReviewLote(x.lote || ''))}</td>
      <td>${productionReviewCurrentTab === 'pending'
        ? `<span style="color:#ef4444; font-size:16px; font-weight:800">${escapeHtml(x.expiration_date || '')}</span>`
        : escapeHtml(x.expiration_date || '')}</td>
      <td>${productionReviewCurrentTab === 'pending'
        ? `<span style="color:#ef4444; font-size:16px; font-weight:800">${Number(x.box_count || 0)}</span>`
        : Number(x.box_count || 0)}</td>
      <td>${formatDateTime(Number(x.created_at || 0))}</td>
      <td>${escapeHtml(x.created_by || '')}</td>
      <td>
        ${productionReviewCurrentTab === 'pending'
          ? `<button class="btn-sm" onclick="approveProductionEntry(${x.id})">审核</button>
             <button class="btn-secondary" style="margin-left:6px; padding:4px 10px; font-size:12px" onclick="rejectProductionEntry(${x.id})">驳回</button>`
          : productionReviewCurrentTab === 'rejected'
            ? `<span title="${escapeHtml(x.reject_reason || '')}" style="color:#fca5a5">${escapeHtml(x.reject_reason || '已驳回')}</span>`
            : `<div style="color:#10b981">已入库并打印</div><div style="margin-top:4px; font-size:12px; color:#94a3b8">审核人: ${escapeHtml(x.approved_by || '-')}</div>`}
      </td>
    </tr>
  `).join('');
  renderProductionReviewPager();
}
window.loadProductionEntries = loadProductionEntries;
function formatProductionReviewLote(loteValue) {
  let raw = String(loteValue || '').trim();
  const parts = raw.split('-');
  if (parts.length === 3) raw = parts[2] + parts[1];
  return raw || '-';
}
function renderProductionReviewPager() {
  const pager = document.getElementById('production-review-pager');
  if (!pager) return;
  const totalPages = Math.max(1, Math.ceil(productionReviewTotal / productionReviewPageSize));
  pager.innerHTML = `
    <button class="btn-secondary" ${productionReviewPage <= 1 ? 'disabled' : ''} onclick="loadProductionEntries('${productionReviewCurrentTab}', null, ${Math.max(1, productionReviewPage - 1)})">上一页</button>
    <span>第 ${productionReviewPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${productionReviewPage >= totalPages ? 'disabled' : ''} onclick="loadProductionEntries('${productionReviewCurrentTab}', null, ${Math.min(totalPages, productionReviewPage + 1)})">下一页</button>
  `;
}
function handleProductionReviewSearchInput() { loadProductionEntries(productionReviewCurrentTab, null, 1); }
window.handleProductionReviewSearchInput = handleProductionReviewSearchInput;
function buildProductionLabelHtml(entry) {
  const title = escapeHtml(entry.product_name || '');
  const cnName = escapeHtml(entry.product_name_cn || '');
  const lote = escapeHtml(entry.lote || '');
  const expiry = escapeHtml(entry.expiration_date || '');
  const boxCount = Number(entry.box_count || 0);
  const image = entry.photo_url || entry.product_image || '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>生产标签</title>
<style>
  @page { size: 100mm 70mm; margin: 0; }
  body { margin: 0; font-family: Arial, sans-serif; background: #fff; }
  .label { width: 100mm; height: 70mm; box-sizing: border-box; padding: 8mm; display: flex; gap: 6mm; align-items: stretch; }
  .photo { width: 28mm; height: 28mm; border: 1px solid #ccc; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .photo img { width:100%; height:100%; object-fit:cover; }
  .main { flex:1; display:flex; flex-direction:column; justify-content:space-between; }
  .name { font-size: 18px; font-weight: 700; line-height: 1.2; }
  .cn { font-size: 14px; color: #333; margin-top: 2mm; }
  .line { font-size: 16px; margin-top: 2mm; }
  .key { font-weight: 700; }
</style>
</head>
<body>
  <div class="label">
    <div class="photo">${image ? `<img src="${image}">` : ''}</div>
    <div class="main">
      <div>
        <div class="name">${title || '-'}</div>
        <div class="cn">${cnName || '&nbsp;'}</div>
      </div>
      <div>
        <div class="line"><span class="key">Lote:</span> ${lote || '-'}</div>
        <div class="line"><span class="key">到期:</span> ${expiry || '-'}</div>
        <div class="line"><span class="key">箱数:</span> ${boxCount}</div>
      </div>
    </div>
  </div>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 200); };</script>
</body>
</html>`;
}
async function approveProductionEntry(id) {
  openConfirm('确认审核这条新生产记录吗？确认后会自动入库存并触发打印。', async () => {
    const printWin = window.open('', '_blank', 'width=520,height=420');
    const res = await fetchWithAuth(`/api/production-entries/${id}/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' })
    });
    if (!res.ok) {
      if (printWin) printWin.close();
      return alert('审核失败');
    }
    const data = await res.json();
    const entry = data.entry || currentProductionEntryList.find(x => Number(x.id) === Number(id));
    if (printWin && entry) {
      printWin.document.open();
      printWin.document.write(buildProductionLabelHtml(entry));
      printWin.document.close();
    }
    showAppToast('审核通过，已自动入库并触发打印');
    loadProductionEntries(productionReviewCurrentTab, null, 1);
    updateGlobalBadges();
  });
}
window.approveProductionEntry = approveProductionEntry;
async function rejectProductionEntry(id) {
  const reason = prompt('请输入驳回原因', '');
  if (reason === null) return;
  const res = await fetchWithAuth(`/api/production-entries/${id}/review`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reject', reason: String(reason || '').trim() })
  });
  if (!res.ok) return alert('驳回失败');
  showAppToast('已驳回');
  loadProductionEntries(productionReviewCurrentTab, null, 1);
  updateGlobalBadges();
}
window.rejectProductionEntry = rejectProductionEntry;

async function loadKnowledgeBase(tab = 'internal', btn = null, page = 1) {
  knowledgeBaseCurrentTab = tab === 'surrounding' ? 'surrounding' : 'internal';
  knowledgeBasePage = page;
  if (btn) {
    document.querySelectorAll('#page-knowledge-base .tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  } else {
    const tBtn = document.querySelector(`#page-knowledge-base .tab[data-tab="${knowledgeBaseCurrentTab}"]`);
    if (tBtn) {
      document.querySelectorAll('#page-knowledge-base .tab').forEach(b => b.classList.remove('active'));
      tBtn.classList.add('active');
    }
  }
  const q = document.getElementById('knowledge-base-search')?.value?.trim() || '';
  const res = await fetchWithAuth(`/api/knowledge-base?category=${knowledgeBaseCurrentTab}&page=${knowledgeBasePage}&size=${knowledgeBasePageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  currentKnowledgeBaseList = data.list || [];
  knowledgeBaseTotal = data.total || 0;
  const tbody = document.getElementById('knowledge-base-rows');
  if (!tbody) return;
  if (!currentKnowledgeBaseList.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="6">暂无数据</td></tr>';
    renderKnowledgeBasePager();
    return;
  }
  tbody.innerHTML = currentKnowledgeBaseList.map((x, idx) => `
    <tr>
      <td>${knowledgeBaseTotal - (knowledgeBasePage - 1) * knowledgeBasePageSize - idx}</td>
      <td>${escapeHtml(x.title || '')}</td>
      <td style="white-space:pre-wrap; word-break:break-word">${escapeHtml(x.content || '')}</td>
      <td>${formatDateTime(Number(x.created_at || 0))}</td>
      <td>${escapeHtml(x.created_by || '')}</td>
      <td>
        <button class="btn-secondary" style="padding:4px 10px; font-size:12px" onclick="openKnowledgeBaseModal(${x.id})">编辑</button>
      </td>
    </tr>
  `).join('');
  renderKnowledgeBasePager();
}
window.loadKnowledgeBase = loadKnowledgeBase;
function renderKnowledgeBasePager() {
  const pager = document.getElementById('knowledge-base-pager');
  if (!pager) return;
  if (knowledgeBaseTotal <= knowledgeBasePageSize) {
    pager.style.display = 'none';
    pager.innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(knowledgeBaseTotal / knowledgeBasePageSize));
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="btn-secondary" ${knowledgeBasePage <= 1 ? 'disabled' : ''} onclick="loadKnowledgeBase('${knowledgeBaseCurrentTab}', null, ${Math.max(1, knowledgeBasePage - 1)})">上一页</button>
    <span>第 ${knowledgeBasePage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${knowledgeBasePage >= totalPages ? 'disabled' : ''} onclick="loadKnowledgeBase('${knowledgeBaseCurrentTab}', null, ${Math.min(totalPages, knowledgeBasePage + 1)})">下一页</button>
  `;
}
function handleKnowledgeBaseSearchInput() { loadKnowledgeBase(knowledgeBaseCurrentTab, null, 1); }
window.handleKnowledgeBaseSearchInput = handleKnowledgeBaseSearchInput;
function openKnowledgeBaseModal(id = null) {
  const modal = document.getElementById('knowledge-base-modal');
  const title = document.getElementById('knowledge-base-modal-title');
  const idInput = document.getElementById('knowledge-base-id');
  const titleInput = document.getElementById('knowledge-base-title-input');
  const contentInput = document.getElementById('knowledge-base-content-input');
  if (!modal || !title || !idInput || !titleInput || !contentInput) return;
  if (!id) {
    title.textContent = '添加知识库内容';
    idInput.value = '';
    titleInput.value = '';
    contentInput.value = '';
  } else {
    const item = currentKnowledgeBaseList.find(x => Number(x.id) === Number(id));
    if (!item) return;
    title.textContent = '编辑知识库内容';
    idInput.value = String(item.id);
    titleInput.value = item.title || '';
    contentInput.value = item.content || '';
  }
  modal.style.display = 'flex';
}
window.openKnowledgeBaseModal = openKnowledgeBaseModal;
function closeKnowledgeBaseModal() {
  const modal = document.getElementById('knowledge-base-modal');
  if (modal) modal.style.display = 'none';
}
window.closeKnowledgeBaseModal = closeKnowledgeBaseModal;
async function saveKnowledgeBaseEntry() {
  const id = Number(document.getElementById('knowledge-base-id')?.value || 0);
  const title = document.getElementById('knowledge-base-title-input')?.value?.trim() || '';
  const content = document.getElementById('knowledge-base-content-input')?.value?.trim() || '';
  if (!title) return alert('请输入标题');
  if (!content) return alert('请输入内容');
  const payload = { title, content, category: knowledgeBaseCurrentTab };
  const res = await fetchWithAuth(id ? `/api/knowledge-base/${id}` : '/api/knowledge-base', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return alert('保存失败');
  closeKnowledgeBaseModal();
  showAppToast('保存成功');
  loadKnowledgeBase(knowledgeBaseCurrentTab, null, 1);
}
window.saveKnowledgeBaseEntry = saveKnowledgeBaseEntry;
async function saveRawStock() {
  if (rsAddItems.length === 0) return alert('请选择原材料');
  document.querySelectorAll('.rs-item-qty').forEach(el => {
    if (rsAddItems[el.dataset.idx]) rsAddItems[el.dataset.idx].qty = el.value;
  });
  document.querySelectorAll('.rs-item-lote').forEach(el => {
    if (rsAddItems[el.dataset.idx]) rsAddItems[el.dataset.idx].lote = el.value;
  });
  document.querySelectorAll('.rs-item-expiry').forEach(el => {
    if (rsAddItems[el.dataset.idx]) rsAddItems[el.dataset.idx].expiry = el.value;
  });
  const invalid = rsAddItems.find(i => !i.qty || Number(i.qty) <= 0 || !i.lote || !i.expiry);
  if (invalid) {
    return alert(`请填写完整的数量、Lote和过期时间 (${invalid.name})`);
  }
  const res = await fetchWithAuth('/api/inventory/raw', {
    method: 'POST',
    body: JSON.stringify({ items: rsAddItems })
  });
  if (!res.ok) return alert('保存失败');
  document.getElementById('rs-add-modal').style.display = 'none';
  rsAddItems = [];
  loadRawStock(rsPage);
  loadRawStockRecords(1);
}
window.saveRawStock = saveRawStock;
function openRawStockAdjustment(encodedMaterial) {
  const m = typeof encodedMaterial === 'string' ? JSON.parse(decodeURIComponent(encodedMaterial)) : encodedMaterial;
  if (!m) return;
  rsAdjustState = {
    materialId: m.id,
    name: m.name || '',
    batches: buildRawBatches(m.batches)
  };
  const defaultBatch = rsAdjustState.batches[0] || {};
  document.getElementById('rs-adjust-material-id').value = m.id;
  document.getElementById('rs-adjust-notes').value = '';
  document.getElementById('rs-adjust-tbody').innerHTML = `
    <tr>
      <td>${escapeHtml(m.name || '')}</td>
      <td><input id="rs-adjust-qty" type="number" step="0.01" style="width:100%" placeholder="可填正负数"></td>
      <td>${rsAdjustState.batches.length ? `
        <select id="rs-adjust-expiry" style="width:100%">
          ${rsAdjustState.batches.map(b => `<option value="${escapeHtml(b.expiry || '')}" ${String(b.expiry || '') === String(defaultBatch.expiry || '') ? 'selected' : ''}>${escapeHtml(`${b.expiry || '无过期时间'} / 库存:${b.qty}`)}</option>`).join('')}
        </select>
      ` : `
        <input id="rs-adjust-expiry" type="date" value="" style="width:100%">
      `}</td>
    </tr>
  `;
  document.getElementById('rs-adjust-modal').style.display = 'flex';
}
window.openRawStockAdjustment = openRawStockAdjustment;
async function saveRawStockAdjustment() {
  const materialId = Number(document.getElementById('rs-adjust-material-id').value || 0);
  const qty = Number(document.getElementById('rs-adjust-qty').value || 0);
  const expiry = (document.getElementById('rs-adjust-expiry').value || '').trim();
  const notes = (document.getElementById('rs-adjust-notes').value || '').trim();
  if (!materialId || !Number.isFinite(qty) || qty === 0) return alert('请填写有效数量');
  if (!notes) return alert('请填写备注');
  const res = await fetchWithAuth('/api/inventory/raw/adjust', {
    method: 'PUT',
    body: JSON.stringify({ materialId, qty, expiry, notes })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(
      err.error === 'bad_request' ? '请填写完整调整信息'
      : err.error === 'not_found' ? '原材料不存在'
      : err.error === 'batch_not_found' ? '所选批次不存在'
      : '保存失败'
    );
  }
  document.getElementById('rs-adjust-modal').style.display = 'none';
  if (rsCurrentTab === 'adjust') loadRawStockAdjustments(rsAdjustPage);
  loadRawStock(rsPage);
  loadRawStockRecords(1);
}
window.saveRawStockAdjustment = saveRawStockAdjustment;

// Mobile Sidebar Toggle
window.toggleSidebar = function() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('open');
};

// Close sidebar when clicking nav links on mobile
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav a').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.remove('open');
        document.querySelector('.sidebar-overlay').classList.remove('open');
      }
    });
  });
});

// Auto-refresh Badges Logic
async function updateGlobalBadges() {
  if (!localStorage.getItem('authToken')) return;

  try {
    // 1. Task Stats (New + Review)
    let taskCount = 0;
    try {
      const tRes = await fetchWithAuth(`/api/tasks?status=new&size=1&_t=${Date.now()}`);
      if (tRes.ok) {
        const tData = await tRes.json();
        taskCount = Number(tData.stats?.new_count || 0) + Number(tData.stats?.review_count || 0);
      }
    } catch {}

    // 2. Order Stats (New)
    let orderCount = 0;
    try {
      const oRes = await fetchWithAuth(`/api/daily-orders/stats?_t=${Date.now()}`);
      if (oRes.ok) {
        const oStats = await oRes.json();
        orderCount = Number(oStats.new || 0);
      }
    } catch {}

    // 3. Event Record Stats (Ongoing)
    let eventRecordCount = 0;
    try {
      const eRes = await fetchWithAuth(`/api/event-records?status=ongoing&page=1&size=1&_t=${Date.now()}`);
      if (eRes.ok) {
        const eData = await eRes.json();
        eventRecordCount = Number(eData.total || 0);
      }
    } catch {}

    // 4. Production Review Stats (Pending)
    let productionReviewCount = 0;
    try {
      if (typeof can !== 'function' || can('production_review', 'view')) {
        const pRes = await fetchWithAuth(`/api/production-entries?status=pending&page=1&size=1&_t=${Date.now()}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          productionReviewCount = Number(pData.total || 0);
        }
      }
    } catch {}

    // 5. Logistics Stats (Ongoing)
    let logisticsOngoingCount = 0;
    try {
      const r = await fetchWithAuth(`/api/logistics/records?status=ongoing&_t=${Date.now()}`);
      if (r.ok) {
        const list = await r.json().catch(() => []);
        logisticsOngoingCount = Array.isArray(list) ? list.length : 0;
      } else if (r.status === 404) {
        const all = loadLocalLogisticsRecords();
        logisticsOngoingCount = (Array.isArray(all) ? all : []).filter(x => String(x?.status || '') === 'ongoing').length;
      }
    } catch {}

    // 6. Update UI
    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = n;
        el.style.display = n > 0 ? 'inline-block' : 'none';
      }
    };

    setBadge('nav-task-badge', taskCount);
    setBadge('nav-order-badge', orderCount);
    updateLogisticsOngoingBadgeCount(logisticsOngoingCount);
    setBadge('nav-event-record-badge', eventRecordCount);
    setBadge('tab-event-record-ongoing-badge', eventRecordCount);
    setBadge('fs-tab-review-badge', productionReviewCount);
    setBadge('nav-daily-ops-badge', taskCount + orderCount + logisticsOngoingCount + eventRecordCount + productionReviewCount);
    updateTopProductionReviewAlert(productionReviewCount);

  } catch (e) {
    console.error('Badge update failed', e);
  }
}

// Start polling
setInterval(updateGlobalBadges, 30000); // 30 seconds
// Initial call
if (localStorage.getItem('authToken')) {
  updateGlobalBadges();
}
