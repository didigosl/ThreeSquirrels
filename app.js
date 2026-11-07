var _a, _b, _c;
const COMPANY_LOAN_CATEGORY = "公司向他人借款";
const COMPANY_REPAYMENT_CATEGORY = "还款（还款给他人）";
const LEGACY_COMPANY_LOAN_CATEGORIES = ["借贷（公司向他人借款）", "借贷(公司向他人借款)", "公司向他人借款"];
const records = [];
function syncMobileTableLabels() {
  document.querySelectorAll("table").forEach((table) => {
    if (table.closest(".invoice-paper")) return;
    const headerRow = table.querySelector("thead > tr");
    const body = table.querySelector("tbody");
    if (!headerRow || !body) return;
    const labels = [...headerRow.children].map((cell) => String(cell.textContent || "").replace(/\s*▾\s*$/, "").trim());
    if (!labels.some(Boolean)) return;
    [...body.rows].forEach((row) => {
      [...row.cells].forEach((cell, index) => {
        if (!cell.hasAttribute("data-label") && labels[index]) {
          cell.setAttribute("data-label", labels[index]);
        }
      });
    });
  });
}
let mobileTableLabelSyncQueued = false;
const mobileTableLabelObserver = new MutationObserver(() => {
  if (mobileTableLabelSyncQueued) return;
  mobileTableLabelSyncQueued = true;
  requestAnimationFrame(() => {
    mobileTableLabelSyncQueued = false;
    syncMobileTableLabels();
  });
});
mobileTableLabelObserver.observe(document.body, { childList: true, subtree: true });
syncMobileTableLabels();
async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem("authToken");
  const headers = { ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && typeof options.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    location.href = "./login.html";
  }
  return res;
}
const payRecords = [];
let payEditingId = null;
let payEditingFile = "";
let payPendingAttachment = null;
const partners = [];
const contactsData = {
  customers: [
    { name: "\u5BA2\u6237A", contact: "\u5F20\u4E09", phone: "13800000001", city: "\u4E0A\u6D77", remark: "\u91CD\u8981\u5BA2\u6237", owner: "\u5BA2\u6237", created: "2026/01/01 10:00:00" },
    { name: "\u5BA2\u6237B", contact: "\u674E\u56DB", phone: "13800000002", city: "\u676D\u5DDE", remark: "", owner: "\u5BA2\u6237", created: "2026/01/02 11:20:00" },
    { name: "\u5BA2\u6237C", contact: "\u738B\u4E94", phone: "13800000003", city: "\u82CF\u5DDE", remark: "", owner: "\u5BA2\u6237", created: "2026/01/03 09:10:00" }
  ],
  merchants: [
    { name: "\u5546\u5BB6A", contact: "\u5218\u4E00", phone: "13900000001", city: "\u4E0A\u6D77", remark: "", owner: "\u5546\u5BB6", created: "2026/01/01 10:00:00" },
    { name: "\u5546\u5BB6B", contact: "\u9648\u4E8C", phone: "13900000002", city: "\u676D\u5DDE", remark: "", owner: "\u5546\u5BB6", created: "2026/01/02 11:20:00" },
    { name: "\u5546\u5BB6C", contact: "\u5468\u4E09", phone: "13900000003", city: "\u82CF\u5DDE", remark: "", owner: "\u5546\u5BB6", created: "2026/01/03 09:10:00" }
  ],
  others: [
    { name: "\u5355\u4F4DA", contact: "\u8D75\u4E00", phone: "13700000001", city: "\u4E0A\u6D77", remark: "", owner: "\u5176\u5B83", created: "2026/01/01 10:00:00" },
    { name: "\u5355\u4F4DB", contact: "\u94B1\u4E8C", phone: "13700000002", city: "\u676D\u5DDE", remark: "", owner: "\u5176\u5B83", created: "2026/01/02 11:20:00" },
    { name: "\u5355\u4F4DC", contact: "\u5B59\u4E09", phone: "13700000003", city: "\u82CF\u5DDE", remark: "", owner: "\u5176\u5B83", created: "2026/01/03 09:10:00" }
  ]
};
let contactsLoaded = false;
const entryType = document.getElementById("entry-type");
const entryCategory = document.getElementById("entry-category");
const entryClient = document.getElementById("entry-client");
const entryAmount = document.getElementById("entry-amount");
const entryMethod = document.getElementById("entry-method");
const entrySkipAccountBalance = document.getElementById("entry-skip-account-balance");
const entryFile = document.getElementById("entry-file");
let ledgerImportData = [];
const ledgerImportModal = document.getElementById("ledger-import-modal");
const ledgerImportRows = document.getElementById("ledger-import-rows");
const ledgerImportSummary = document.getElementById("ledger-import-summary");
const ledgerImportCancel = document.getElementById("ledger-import-cancel");
const ledgerImportCommit = document.getElementById("ledger-import-commit");
if (ledgerImportCancel) {
  ledgerImportCancel.addEventListener("click", () => {
    ledgerImportModal.style.display = "none";
    entryFile.value = "";
    ledgerImportData = [];
  });
}
if (ledgerImportCommit) {
  ledgerImportCommit.addEventListener("click", async () => {
    var _a2;
    if (ledgerImportData.length === 0) return;
    ledgerImportCommit.disabled = true;
    ledgerImportCommit.textContent = "\u5BFC\u5165\u4E2D...";
    try {
      const partnersToCreate = /* @__PURE__ */ new Map();
      ledgerImportData.forEach((d) => {
        if (d.willCreate) partnersToCreate.set(d.partner, d.createType);
      });
      for (let [pName, pType] of partnersToCreate.entries()) {
        try {
          await apiFetchJSON("/api/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: pName, type: pType, contact: "", phone: "", email: "", notes: "\u5BFC\u5165\u65F6\u81EA\u52A8\u521B\u5EFA" })
          });
        } catch (e) {
          console.error("Failed to create partner", pName, e);
        }
      }
      if (partnersToCreate.size > 0) {
        await loadAllContacts();
      }
      const now = /* @__PURE__ */ new Date();
      const importBaseCreatedAt = Date.now();
      const importTotal = ledgerImportData.length;
      const defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const dateTime = `${defaultDate} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      const defaultMethod = entryMethod.value || "\u5FAE\u4FE1";
      for (let i = 0; i < ledgerImportData.length; i++) {
        const d = ledgerImportData[i];
        const type = d.amount >= 0 ? "\u6536\u5165" : "\u5F00\u652F";
        let cat = d.subcat;
        if (!cat) {
          const parentCat = categoriesData.find((c) => c.name === type);
          cat = parentCat && parentCat.children && parentCat.children.length > 0 ? parentCat.children[0] : d.amount >= 0 ? "\u5176\u5B83\u6536\u5165" : "\u5176\u5B83\u5F00\u652F";
        }
        const absAmount = Math.abs(d.amount);
        const rowDate = d.date || defaultDate;
        const method = d.method || defaultMethod;
        const createdAt = importBaseCreatedAt + (importTotal - i);
        try {
          await apiFetchJSON("/api/ledger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type,
              category: cat,
              doc: d.doc,
              client: d.partner,
              amount: absAmount,
              method,
              file: "",
              notes: d.notes,
              date: rowDate,
              dateTime,
              createdAt,
              createdBy: ((_a2 = getAuthUser()) == null ? void 0 : _a2.name) || "",
              confirmed: false
            })
          });
        } catch (e) {
          console.error("Failed to import row", d, e);
        }
      }
      ledgerImportModal.style.display = "none";
      entryFile.value = "";
      ledgerImportData = [];
      loadLedgerFromServer();
    } catch (err) {
      alert("\u5BFC\u5165\u51FA\u9519");
    } finally {
      ledgerImportCommit.disabled = false;
      ledgerImportCommit.textContent = "\u6279\u91CF\u5165\u5E93";
    }
  });
}
function excelDateToJSDate(serial) {
  if (typeof serial !== "number") return serial;
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1e3);
  const fractional_day = serial - Math.floor(serial) + 1e-7;
  let total_seconds = Math.floor(86400 * fractional_day);
  const seconds = total_seconds % 60;
  total_seconds -= seconds;
  const hours = Math.floor(total_seconds / (60 * 60));
  const minutes = Math.floor(total_seconds / 60) % 60;
  return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
}
function parseLedgerDate(val) {
  if (!val) return "";
  if (typeof val === "number") {
    const d = excelDateToJSDate(val);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return s;
}
entryFile == null ? void 0 : entryFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  ledgerImportData = [];
  if (ledgerImportModal) ledgerImportModal.style.display = "none";
  if (!file) return;
  if (/\.(xls|xlsx|csv)$/i.test(file.name)) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows2 = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        let headerRowIdx = -1;
        let colMap = {};
        for (let i = 0; i < Math.min(10, rows2.length); i++) {
          const row = rows2[i];
          if (!row) continue;
          let dateIdx = -1, docIdx = -1, subcatIdx = -1, partnerIdx = -1, notesIdx = -1, amtIdx = -1, methodIdx = -1;
          row.forEach((cell, idx) => {
            const txt = String(cell || "").replace(/\s+/g, "");
            if (txt.includes("\u65E5\u671F")) dateIdx = idx;
            else if (txt.includes("\u5355\u636E") || txt.includes("\u51ED\u8BC1")) docIdx = idx;
            else if (txt.includes("\u5B50\u7C7B\u76EE")) subcatIdx = idx;
            else if (txt.includes("\u5F80\u6765\u5355\u4F4D") || txt.includes("\u5BA2\u6237")) partnerIdx = idx;
            else if (txt.includes("\u5907\u6CE8")) notesIdx = idx;
            else if (txt.includes("\u91D1\u989D")) amtIdx = idx;
            else if (txt.includes("\u652F\u4ED8\u65B9\u5F0F") || txt.includes("\u8D26\u6237")) methodIdx = idx;
          });
          if (amtIdx !== -1 && partnerIdx !== -1) {
            headerRowIdx = i;
            colMap = { date: dateIdx, doc: docIdx, subcat: subcatIdx, partner: partnerIdx, notes: notesIdx, amt: amtIdx, method: methodIdx };
            break;
          }
        }
        if (headerRowIdx === -1) {
          alert("\u65E0\u6CD5\u5728\u8868\u683C\u4E2D\u627E\u5230\u201C\u5F80\u6765\u5355\u4F4D\u201D\u548C\u201C\u91D1\u989D\u201D\u5217");
          entryFile.value = "";
          return;
        }
        let newPartnersCount = 0;
        let newPartnersSet = /* @__PURE__ */ new Set();
        for (let i = headerRowIdx + 1; i < rows2.length; i++) {
          const row = rows2[i];
          if (!row || row.length === 0) continue;
          let rawAmt = row[colMap.amt];
          if (rawAmt === void 0 || rawAmt === null || rawAmt === "") continue;
          let amt = parseFloat(String(rawAmt).replace(/[^\d\.\-]/g, ""));
          if (isNaN(amt)) continue;
          let partner = String(row[colMap.partner] || "").trim();
          if (!partner) continue;
          let dateStr = colMap.date !== -1 ? parseLedgerDate(row[colMap.date]) : "";
          let docStr = colMap.doc !== -1 ? String(row[colMap.doc] || "").trim() : "";
          let subcatStr = colMap.subcat !== -1 ? String(row[colMap.subcat] || "").trim() : "";
          let notesStr = colMap.notes !== -1 ? String(row[colMap.notes] || "").trim() : "";
          let methodStr = colMap.method !== -1 ? String(row[colMap.method] || "").trim() : "";
          let validMethod = true;
          if (methodStr && !accountsData.some((a) => a.name === methodStr)) {
            validMethod = false;
          }
          let validSubcat = true;
          if (subcatStr) {
            const isIncome = amt >= 0;
            const parentName = isIncome ? "\u6536\u5165" : "\u5F00\u652F";
            const catObj = categoriesData.find((c) => c.name === parentName);
            const validChildren = catObj ? catObj.children || [] : [];
            if (!validChildren.includes(subcatStr)) {
              validSubcat = false;
            }
          }
          const normalizePartner = (str) => {
            if (!str) return "";
            return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          };
          const normPartner = normalizePartner(partner);
          const allContactsList = allContacts();
          let match = allContactsList.find((c) => c.name === partner);
          if (!match && normPartner) {
            match = allContactsList.find((c) => {
              const nName = normalizePartner(c.name);
              const nComp = normalizePartner(c.company);
              return nName && nName === normPartner || nComp && nComp === normPartner;
            });
          }
          if (!match && normPartner && normPartner.length > 5) {
            match = allContactsList.find((c) => {
              const nName = normalizePartner(c.name);
              const nComp = normalizePartner(c.company);
              const checkSim = (n1, n2) => {
                if (!n1 || !n2) return false;
                if (n1.includes(n2) || n2.includes(n1)) {
                  const lenRatio = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
                  return lenRatio >= 0.9;
                }
                return false;
              };
              return checkSim(nName, normPartner) || checkSim(nComp, normPartner);
            });
          }
          let exists = !!match;
          let willCreate = false;
          let createType = "";
          if (exists) {
            partner = match.name;
          } else {
            willCreate = true;
            createType = amt >= 0 ? "\u5BA2\u6237" : "\u5176\u5B83\u5F80\u6765\u5355\u4F4D";
            newPartnersSet.add(`${partner} (${createType})`);
          }
          ledgerImportData.push({
            date: dateStr,
            doc: docStr,
            subcat: subcatStr,
            partner,
            notes: notesStr,
            amount: amt,
            method: methodStr,
            validMethod,
            validSubcat,
            willCreate,
            createType
          });
        }
        const invalidMethods = [...new Set(ledgerImportData.filter((d) => !d.validMethod).map((d) => d.method))];
        if (invalidMethods.length > 0) {
          alert(`\u8D26\u6237\u4E0D\u5B58\u5728\uFF0C\u8868\u683C\u65E0\u6CD5\u4E0A\u4F20\uFF1A
${invalidMethods.join(", ")}

\u8BF7\u5148\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u6DFB\u52A0\u8BE5\u8D26\u6237\u540D\u79F0\uFF0C\u6216\u4FEE\u6539\u8868\u683C\u540E\u91CD\u65B0\u4E0A\u4F20\u4F7F\u5176\u5173\u8054\u3002`);
          entryFile.value = "";
          ledgerImportData = [];
          return;
        }
        const invalidSubcats = [...new Set(ledgerImportData.filter((d) => !d.validSubcat).map((d) => d.subcat))];
        if (invalidSubcats.length > 0) {
          alert(`\u5B50\u7C7B\u76EE\u4E0D\u5339\u914D\uFF0C\u8868\u683C\u65E0\u6CD5\u4E0A\u4F20\uFF1A
${invalidSubcats.join(", ")}

\u8BF7\u4FEE\u6539\u4E3A\u7CFB\u7EDF\u5206\u7C7B\u7BA1\u7406\u4E2D\u5B58\u5728\u7684\u5B50\u7C7B\u76EE\u540E\u518D\u4E0A\u4F20\u8868\u683C\u3002`);
          entryFile.value = "";
          ledgerImportData = [];
          return;
        }
        if (ledgerImportData.length > 0 && ledgerImportModal) {
          ledgerImportRows.innerHTML = "";
          ledgerImportData.forEach((d) => {
            const tr = document.createElement("tr");
            const tdDate = document.createElement("td");
            tdDate.style.padding = "6px";
            tdDate.style.borderBottom = "1px solid #334155";
            tdDate.textContent = formatDisplayDate(d.date);
            const tdDoc = document.createElement("td");
            tdDoc.style.padding = "6px";
            tdDoc.style.borderBottom = "1px solid #334155";
            tdDoc.textContent = d.doc;
            const tdPartner = document.createElement("td");
            tdPartner.style.padding = "6px";
            tdPartner.style.borderBottom = "1px solid #334155";
            if (d.willCreate) {
              tdPartner.innerHTML = `<span>${d.partner}</span> <span style="color:#ef4444; font-size:10px; background:#450a0a; padding:2px 4px; border-radius:4px">\u65B0${d.createType}</span>`;
            } else {
              tdPartner.textContent = d.partner;
            }
            const tdNotes = document.createElement("td");
            tdNotes.style.padding = "6px";
            tdNotes.style.borderBottom = "1px solid #334155";
            tdNotes.textContent = d.notes;
            const tdAmt = document.createElement("td");
            tdAmt.style.padding = "6px";
            tdAmt.style.borderBottom = "1px solid #334155";
            tdAmt.style.textAlign = "right";
            tdAmt.textContent = d.amount.toFixed(2);
            tdAmt.style.color = d.amount >= 0 ? "var(--green)" : "var(--orange)";
            const tdMethod = document.createElement("td");
            tdMethod.style.padding = "6px";
            tdMethod.style.borderBottom = "1px solid #334155";
            tdMethod.textContent = getAccountDisplayName(d.method);
            tr.append(tdDate, tdDoc, tdPartner, tdNotes, tdAmt, tdMethod);
            ledgerImportRows.appendChild(tr);
          });
          ledgerImportSummary.innerHTML = `\u5DF2\u89E3\u6790 <b>${ledgerImportData.length}</b> \u6761\u8BB0\u5F55\u3002<br>`;
          if (newPartnersSet.size > 0) {
            ledgerImportSummary.innerHTML += `<span style="color:#f59e0b">\u5C06\u81EA\u52A8\u521B\u5EFA ${newPartnersSet.size} \u4E2A\u65B0\u5F80\u6765\u5355\u4F4D\u3002</span>`;
          }
          ledgerImportModal.style.display = "flex";
        } else {
          alert("\u672A\u89E3\u6790\u5230\u6709\u6548\u6570\u636E\u884C");
          entryFile.value = "";
        }
      } catch (e2) {
        console.error(e2);
        alert("\u89E3\u6790Excel\u5931\u8D25");
        entryFile.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  }
});
const entryNotes = document.getElementById("entry-notes");
const entryForm = document.getElementById("entry-form");
const entrySubmitBtn = entryForm == null ? void 0 : entryForm.querySelector('button[type="submit"]');
const rows = document.getElementById("rows");
const homeChartRows = document.getElementById("home-chart-rows");
const salesChartSvg = document.getElementById("sales-chart-svg");
const salesPeriodSel = document.getElementById("sales-period");
const homePeriodSel = document.getElementById("home-period");
const filterType = document.getElementById("filter-type");
const filterKey = document.getElementById("filter-key");
const filterStart = document.getElementById("filter-start");
const filterEnd = document.getElementById("filter-end");
const ledgerPager = document.getElementById("global-pager-controls") || document.getElementById("ledger-pager");
const ledgerTableWrap = document.getElementById("ledger-table-wrap");
const ledgerTopTypeLabel = document.getElementById("ledger-top-type-label");
const ledgerTopIncomeBtn = document.getElementById("ledger-top-income-btn");
const ledgerTopExpenseBtn = document.getElementById("ledger-top-expense-btn");
const ldType = document.getElementById("ld-type");
const ldTypeDD = document.getElementById("ld-type-dd");
const ldTypeList = document.getElementById("ld-type-list");
const ldTypeLabel = document.getElementById("ld-type-label");
const ldCat = document.getElementById("ld-cat");
const ldCatDD = document.getElementById("ld-cat-dd");
const ldCatList = document.getElementById("ld-cat-list");
const ldCatLabel = document.getElementById("ld-cat-label");
const ldOwner = document.getElementById("ld-owner");
const ldOwnerDD = document.getElementById("ld-owner-dd");
const ldOwnerList = document.getElementById("ld-owner-list");
const ldOwnerLabel = document.getElementById("ld-owner-label");
const ldMethod = document.getElementById("ld-method");
const ldMethodDD = document.getElementById("ld-method-dd");
const ldMethodList = document.getElementById("ld-method-list");
const ldMethodLabel = document.getElementById("ld-method-label");
const ldConfirm = document.getElementById("ld-confirm");
const ldConfirmDD = document.getElementById("ld-confirm-dd");
const ldConfirmList = document.getElementById("ld-confirm-list");
const ldConfirmLabel = document.getElementById("ld-confirm-label");
const ledgerNotesModal = document.getElementById("ledger-notes-modal");
const ledgerNotesContent = document.getElementById("ledger-notes-content");
let ledgerPage = 1;
const ledgerPageSize = 100;
function updateLedgerHeaderCover() {
}
let ledgerHdrType = "all";
let ledgerHdrCat = "";
let pendingLedgerCategory = "";
let ledgerHdrOwner = "";
let ledgerHdrMethod = "";
let ledgerHdrConfirm = "all";
function getLedgerLocaleText(key) {
  const isEs = getCurrentAppLocale() === "es-ES";
  const map = {
    type: isEs ? "Tipo" : "\u7C7B\u578B",
    all: isEs ? "Todos" : "\u5168\u90E8",
    income: isEs ? "Ingreso" : "\u6536\u5165",
    expense: isEs ? "Gasto" : "\u5F00\u652F",
    category: isEs ? "Subcategor\u00EDas" : "\u5B50\u7C7B\u76EE",
    method: isEs ? "Forma de pago" : "\u652F\u4ED8\u65B9\u5F0F"
  };
  return map[key] || "";
}
function getLedgerEntryLocaleText(key) {
  const isEs = getCurrentAppLocale() === "es-ES";
  const map = {
    formTitle: isEs ? "Registro manual" : "\u5F55\u5165\u6D41\u6C34",
    typeLabel: isEs ? "* Tipo" : "* \u7C7B\u578B",
    income: isEs ? "Ingreso" : "\u6536\u5165",
    expense: isEs ? "Gasto" : "\u5F00\u652F",
    categoryLabel: isEs ? "* Subcategor\u00EDas" : "* \u5B50\u7C7B\u76EE",
    docLabel: isEs ? "* N\u00FAmero de pedido (selecci\u00F3n m\u00FAltiple)" : "* \u8BA2\u5355\u53F7\uFF08\u53EF\u591A\u9009\uFF09",
    docPlaceholder: isEs ? "Seleccione uno o varios pedidos" : "\u8BF7\u9009\u62E9\u4E00\u4E2A\u6216\u591A\u4E2A\u8BA2\u5355\u53F7",
    clientLabel: isEs ? "* Contraparte" : "* \u5F80\u6765\u5355\u4F4D",
    clientPlaceholder: isEs ? "Seleccione contraparte" : "\u8BF7\u9009\u62E9\u5F80\u6765\u5355\u4F4D",
    clientSearchPlaceholder: isEs ? "Buscar aqu\u00ED" : "\u8FD9\u91CC\u641C\u7D22",
    amountLabel: isEs ? "* Importe" : "* \u91D1\u989D",
    methodLabel: isEs ? "* Forma de pago" : "* \u652F\u4ED8\u65B9\u5F0F",
    filesLabel: isEs ? "Archivos" : "\u9644\u4EF6 / \u6279\u91CF\u5BFC\u5165",
    fileHint: isEs ? "Imagen/PDF como adjunto individual, Excel/CSV para importaci\u00F3n por lotes" : "\u56FE\u7247/PDF\u4F5C\u4E3A\u5355\u6761\u9644\u4EF6\uFF0CExcel/CSV\u4F5C\u4E3A\u6279\u91CF\u5BFC\u5165",
    notesLabel: isEs ? "Notas" : "\u5907\u6CE8",
    notesPlaceholder: isEs ? "Opcional" : "\u53EF\u9009",
    submitCreate: isEs ? "Guardar" : "\u63D0\u4EA4",
    submitEdit: isEs ? "Guardar cambios" : "\u4FDD\u5B58\u4FEE\u6539"
  };
  return map[key] || "";
}
function syncLedgerEntryFormLocale() {
  const formTitle = document.getElementById("entry-form-title");
  const typeLabel = document.getElementById("entry-type-label");
  const incomeBtn = document.getElementById("entry-type-income-btn");
  const expenseBtn = document.getElementById("entry-type-expense-btn");
  const categoryLabel = document.getElementById("entry-category-label");
  const docLabel = document.getElementById("entry-doc-label");
  const clientLabel = document.getElementById("entry-client-label");
  const amountLabel = document.getElementById("entry-amount-label");
  const methodLabel = document.getElementById("entry-method-label");
  const filesLabel = document.getElementById("entry-files-label");
  const fileHint = document.getElementById("entry-file-hint");
  const notesLabel = document.getElementById("entry-notes-label");
  if (formTitle) formTitle.textContent = getLedgerEntryLocaleText("formTitle");
  if (typeLabel) typeLabel.textContent = getLedgerEntryLocaleText("typeLabel");
  if (incomeBtn) incomeBtn.textContent = getLedgerEntryLocaleText("income");
  if (expenseBtn) expenseBtn.textContent = getLedgerEntryLocaleText("expense");
  if (categoryLabel) categoryLabel.textContent = getLedgerEntryLocaleText("categoryLabel");
  if (docLabel) docLabel.textContent = getLedgerEntryLocaleText("docLabel");
  if (entryDoc) entryDoc.placeholder = getLedgerEntryLocaleText("docPlaceholder");
  if (clientLabel) clientLabel.textContent = getLedgerEntryLocaleText("clientLabel");
  if (entryClient) entryClient.placeholder = getLedgerEntryLocaleText("clientPlaceholder");
  if (typeof clientSearch !== "undefined" && clientSearch) clientSearch.placeholder = getLedgerEntryLocaleText("clientSearchPlaceholder");
  if (amountLabel) {
    const matchedTotal = document.getElementById("entry-matched-orders-total");
    if (matchedTotal && amountLabel.firstChild) amountLabel.firstChild.nodeValue = `${getLedgerEntryLocaleText("amountLabel")} `;
    else amountLabel.textContent = getLedgerEntryLocaleText("amountLabel");
  }
  if (methodLabel) methodLabel.textContent = getLedgerEntryLocaleText("methodLabel");
  if (filesLabel) filesLabel.textContent = getLedgerEntryLocaleText("filesLabel");
  if (fileHint) fileHint.textContent = getLedgerEntryLocaleText("fileHint");
  if (notesLabel) notesLabel.textContent = getLedgerEntryLocaleText("notesLabel");
  if (entryNotes) entryNotes.placeholder = getLedgerEntryLocaleText("notesPlaceholder");
  if (entrySubmitBtn) entrySubmitBtn.textContent = ledgerEditingId ? getLedgerEntryLocaleText("submitEdit") : getLedgerEntryLocaleText("submitCreate");
  if (typeof setCategories === "function") setCategories();
  if (typeof refreshAccountOptions === "function") refreshAccountOptions();
}
function syncLedgerLocale() {
  if (ledgerTopTypeLabel) ledgerTopTypeLabel.textContent = getLedgerLocaleText("type");
  if (ledgerTopIncomeBtn) ledgerTopIncomeBtn.textContent = getLedgerLocaleText("income");
  if (ledgerTopExpenseBtn) ledgerTopExpenseBtn.textContent = getLedgerLocaleText("expense");
  setLabel(ldTypeLabel, getLedgerLocaleText("type"), ledgerHdrType !== "all");
  setLabel(ldCatLabel, ledgerHdrCat ? getCategoryDisplayName(ledgerHdrCat) : getLedgerLocaleText("category"), !!ledgerHdrCat);
  setLabel(ldMethodLabel, ledgerHdrMethod ? getAccountDisplayName(ledgerHdrMethod) : getLedgerLocaleText("method"), !!ledgerHdrMethod);
  syncLedgerEntryFormLocale();
}
function clientOwner(name) {
  const all = [...contactsData.customers, ...contactsData.merchants, ...contactsData.others];
  const obj = all.find((x) => (x.name || "") === (name || ""));
  return obj ? obj.owner || "" : "";
}
function openLedgerTypeFilter() {
  ldTypeDD.style.display = "block";
  ldTypeList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      ledgerHdrType = val;
      ldTypeDD.style.display = "none";
      setLabel(ldTypeLabel, getLedgerLocaleText("type"), val !== "all");
      ledgerPage = 1;
      applyFilters();
      ldCatLabel && setLabel(ldCatLabel, ledgerHdrCat ? getCategoryDisplayName(ledgerHdrCat) : getLedgerLocaleText("category"), !!ledgerHdrCat);
    });
    ldTypeList.appendChild(row);
  };
  addItem(getLedgerLocaleText("all"), "all");
  addItem(getLedgerLocaleText("income"), "\u6536\u5165");
  addItem(getLedgerLocaleText("expense"), "\u5F00\u652F");
}
function openLedgerCatFilter() {
  ldCatDD.style.display = "block";
  ldCatList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      ledgerHdrCat = val;
      ldCatDD.style.display = "none";
      setLabel(ldCatLabel, val ? getCategoryDisplayName(val) : getLedgerLocaleText("category"), !!val);
      ledgerPage = 1;
      applyFilters();
    });
    ldCatList.appendChild(row);
  };
  addItem(getLedgerLocaleText("all"), "");
  const types = ledgerHdrType === "all" ? categoriesData.map((c) => c.name) : [ledgerHdrType];
  types.forEach((t) => {
    var _a2;
    const children = ((_a2 = categoriesData.find((c) => c.name === t)) == null ? void 0 : _a2.children) || [];
    children.forEach((n) => addItem(getCategoryDisplayName(n, t), n));
  });
}
function openLedgerOwnerFilter() {
  ldOwnerDD.style.display = "block";
  ldOwnerList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      ledgerHdrOwner = val;
      ldOwnerDD.style.display = "none";
      setLabel(ldOwnerLabel, "\u5F80\u6765\u5355\u4F4D", !!val);
      ledgerPage = 1;
      applyFilters();
    });
    ldOwnerList.appendChild(row);
  };
  addItem("\u5168\u90E8", "");
  addItem("\u5BA2\u6237", "\u5BA2\u6237");
  addItem("\u5546\u5BB6", "\u5546\u5BB6");
  addItem("\u5176\u5B83\u5F80\u6765\u5355\u4F4D", "\u5176\u5B83");
}
function openLedgerMethodFilter() {
  ldMethodDD.style.display = "block";
  ldMethodList.innerHTML = "";
  const addItem = (label, val, chipLabel = label) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      ledgerHdrMethod = val;
      ldMethodDD.style.display = "none";
      setLabel(ldMethodLabel, chipLabel || getLedgerLocaleText("method"), !!val);
      ledgerPage = 1;
      applyFilters();
    });
    ldMethodList.appendChild(row);
  };
  addItem(getLedgerLocaleText("all"), "");
  [...new Set((records || []).map((r) => (r.method || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).forEach((name) => addItem(getAccountDisplayName(name), name, getAccountDisplayName(name)));
}
function openLedgerConfirmFilter() {
  ldConfirmDD.style.display = "block";
  ldConfirmList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      ledgerHdrConfirm = val;
      ldConfirmDD.style.display = "none";
      setLabel(ldConfirmLabel, val === "all" ? "\u64CD\u4F5C" : val === "confirmed" ? "\u5DF2\u786E\u8BA4" : "\u672A\u786E\u8BA4", val !== "all");
      ledgerPage = 1;
      applyFilters();
    });
    ldConfirmList.appendChild(row);
  };
  addItem("\u5168\u90E8", "all");
  addItem("\u5DF2\u786E\u8BA4", "confirmed");
  addItem("\u672A\u786E\u8BA4", "unconfirmed");
}
function openLedgerNotesModal(text) {
  if (!ledgerNotesModal || !ledgerNotesContent || !text) return;
  ledgerNotesContent.textContent = text;
  ledgerNotesModal.style.display = "flex";
}
window.downloadLedgerTemplate = function() {
  if (typeof XLSX === "undefined") {
    alert("Excel \u5E93\u672A\u52A0\u8F7D\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5");
    return;
  }
    const ws_data = [
      ["Fecha / 日期", "Numero de documento / 单据 / 凭证号", "Subcategorias / 子类目", "Entidad / 往来单位", "Observaciones / 备注", "Importe / 金额", "Forma de pago / 支付方式"],
      ["", "", "", "", "", "", "\u94F6\u884C\u8D26\u6237 BBVA"]
    ];
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "\u6279\u91CF\u5BFC\u5165\u6A21\u677F");
  XLSX.writeFile(wb, "\u6279\u91CF\u5BFC\u5165\u6A21\u677F.xlsx");
};
ldType == null ? void 0 : ldType.addEventListener("click", (e) => {
  e.stopPropagation();
  openLedgerTypeFilter();
});
ldCat == null ? void 0 : ldCat.addEventListener("click", (e) => {
  e.stopPropagation();
  openLedgerCatFilter();
});
ldOwner == null ? void 0 : ldOwner.addEventListener("click", (e) => {
  e.stopPropagation();
  openLedgerOwnerFilter();
});
ldMethod == null ? void 0 : ldMethod.addEventListener("click", (e) => {
  e.stopPropagation();
  openLedgerMethodFilter();
});
ldConfirm == null ? void 0 : ldConfirm.addEventListener("click", (e) => {
  e.stopPropagation();
  openLedgerConfirmFilter();
});
const accRows = document.getElementById("acc-rows");
const accAdd = document.getElementById("acc-add");
const accountSpanishNameOverrides = {};
const accountsData = [
  { name: "\u73B0\u91D1\u8D26\u6237", nameEs: "", balance: 0, desc: "\u7CFB\u7EDF\u9884\u7F6E\u8D26\u6237", created: "2026/02/08 00:00:00", initialSet: false },
  { name: "\u94F6\u884C\u8D26\u6237 BBVA", nameEs: "", balance: 0, desc: "\u7CFB\u7EDF\u9884\u7F6E\u8D26\u6237", created: "2026/02/08 00:00:00", initialSet: false },
  { name: "\u94F6\u884C\u8D26\u6237 Santander", nameEs: "", balance: 0, desc: "\u7CFB\u7EDF\u9884\u7F6E\u8D26\u6237", created: "2026/02/08 00:00:00", initialSet: false },
  { name: "\u4EBA\u6C11\u5E01\u8D26\u53F71", nameEs: "", balance: 0, desc: "\u7CFB\u7EDF\u9884\u7F6E\u8D26\u6237", created: "2026/02/08 00:00:00", initialSet: false },
  { name: "\u4EBA\u6C11\u5E01\u8D26\u6237 \u4E2D\u667A", nameEs: "", balance: 0, desc: "\u7CFB\u7EDF\u9884\u7F6E\u8D26\u6237", created: "2026/02/08 00:00:00", initialSet: false }
];
function getCurrentAppLocale() {
  var _a2, _b2;
  return normalizeAppLocale(((_a2 = getAuthUser()) == null ? void 0 : _a2.locale) || ((_b2 = window.getAppLocale) == null ? void 0 : _b2.call(window)) || "zh-CN");
}
function getAccountSpanishNameOverride(name) {
  const key = String(name || "").trim();
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(accountSpanishNameOverrides, key) ? String(accountSpanishNameOverrides[key] || "").trim() : null;
}
function getAccountSpanishName(account) {
  const zhName = String((account == null ? void 0 : account.name) || "").trim();
  const raw = String((account == null ? void 0 : account.nameEs) || (account == null ? void 0 : account.name_es) || "").trim();
  if (raw) return raw;
  const override = getAccountSpanishNameOverride(zhName);
  return override == null ? "" : override;
}
function normalizeAccountItem(account) {
  if (!account || typeof account !== "object") return { name: "", nameEs: "", balance: 0, desc: "", created: "", initialSet: false };
  return {
    ...account,
    name: String(account.name || "").trim(),
    nameEs: getAccountSpanishName(account),
    balance: Number(account.balance || 0),
    desc: String(account.desc || account.description || "").trim(),
    created: String(account.created || "").trim(),
    initialSet: !!account.initialSet || !!account.initial_set
  };
}
function getAccountDisplayName(accountOrName) {
  const locale = getCurrentAppLocale();
  if (typeof accountOrName === "string") {
    const zhName = String(accountOrName || "").trim();
    const account = accountsData.find((item) => item.name === zhName);
    const esName = getAccountSpanishName(account || { name: zhName });
    return locale === "es-ES" ? esName || zhName : zhName;
  }
  const zhName = String((accountOrName == null ? void 0 : accountOrName.name) || "").trim();
  const esName = getAccountSpanishName(accountOrName);
  return locale === "es-ES" ? esName || zhName : zhName;
}
function loadJSON(key, def) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "");
    return v != null ? v : def;
  } catch (e) {
    return def;
  }
}
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}
function setAccountSpanishNameOverride(name, nameEs) {
  const key = String(name || "").trim();
  if (!key) return;
  accountSpanishNameOverrides[key] = String(nameEs || "").trim();
  saveJSON("accountSpanishNameOverrides", accountSpanishNameOverrides);
}
function renameAccountSpanishNameOverride(oldName, newName, nameEs) {
  const oldKey = String(oldName || "").trim();
  const newKey = String(newName || "").trim();
  if (oldKey && oldKey !== newKey) delete accountSpanishNameOverrides[oldKey];
  if (newKey) accountSpanishNameOverrides[newKey] = String(nameEs || "").trim();
  saveJSON("accountSpanishNameOverrides", accountSpanishNameOverrides);
}
function deleteAccountSpanishNameOverride(name) {
  const key = String(name || "").trim();
  if (!key) return;
  delete accountSpanishNameOverrides[key];
  saveJSON("accountSpanishNameOverrides", accountSpanishNameOverrides);
}
function normalizePayRecordAttachment(rec) {
  if (!rec || typeof rec !== "object") return rec;
  const rawFile = String(
    rec.file || rec.fileUrl || rec.file_url || rec.attachment || rec.attachmentUrl || rec.attachment_url || ""
  ).trim();
  const fileName = String(
    rec.fileName || rec.attachmentName || (rawFile ? rawFile.split("/").pop() : "") || ""
  ).trim();
  return {
    ...rec,
    file: rawFile,
    fileUrl: rawFile,
    fileName
  };
}
function initPersist() {
  const recs = loadJSON("records", []);
  if (Array.isArray(recs)) {
    recs.forEach((r) => {
      if (r && typeof r.fileUrl === "string" && /^blob:/i.test(r.fileUrl)) delete r.fileUrl;
    });
    recs.forEach((r) => {
      if (r && !r.createdAt) {
        const ts = Date.parse(r.dateTime || r.date || "");
        if (!isNaN(ts)) r.createdAt = ts;
      }
    });
    records.splice(0, records.length, ...recs);
  }
  const pays = loadJSON("payRecords", []);
  if (Array.isArray(pays)) {
    pays.forEach((r) => {
      if (r && !r.createdAt) {
        const h0 = r.history && r.history[0] && (r.history[0].date || r.history[0].dateTime) || null;
        const ts = Date.parse(h0 || r.date || "");
        if (!isNaN(ts)) r.createdAt = ts;
      }
    });
    payRecords.splice(0, payRecords.length, ...pays.map(normalizePayRecordAttachment));
  }
  const contactsSaved = loadJSON("contactsData", null);
  if (contactsSaved && typeof contactsSaved === "object") {
    ["customers", "merchants", "others"].forEach((k) => {
      if (Array.isArray(contactsSaved[k])) contactsData[k] = contactsSaved[k];
    });
  }
  const accs = loadJSON("accountsData", null);
  if (Array.isArray(accs)) {
    accountsData.splice(0, accountsData.length, ...accs.map(normalizeAccountItem));
  }
  const accNameOverrides = loadJSON("accountSpanishNameOverrides", null);
  if (accNameOverrides && typeof accNameOverrides === "object") {
    Object.keys(accountSpanishNameOverrides).forEach((key) => delete accountSpanishNameOverrides[key]);
    Object.assign(accountSpanishNameOverrides, accNameOverrides);
  }
  const cats = loadJSON("categoriesData", null);
  if (Array.isArray(cats)) {
    categoriesData.splice(0, categoriesData.length, ...cats);
  }
  const catNameOverrides = loadJSON("categorySpanishNameOverrides", null);
  if (catNameOverrides && typeof catNameOverrides === "object") {
    categorySpanishNameOverrides.parents = { ...(catNameOverrides.parents || {}) };
    categorySpanishNameOverrides.children = { ...(catNameOverrides.children || {}) };
  }
  const roles = loadJSON("rolesData", null);
  if (Array.isArray(roles)) {
    rolesData.splice(0, rolesData.length, ...roles);
  }
  const ensureRole = (name, desc) => {
    if (!rolesData.some((r) => r.name === name)) {
      const maxId = rolesData.reduce((m, r) => Math.max(m, r.id || 0), 0);
      const now = /* @__PURE__ */ new Date();
      const created = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      rolesData.push({ id: maxId + 1, name, desc, created, immutable: true });
    }
  };
  ensureRole("\u8D22\u52A1", "\u7CFB\u7EDF\u9884\u7F6E\u89D2\u8272");
  ensureRole("\u80A1\u4E1C", "\u7CFB\u7EDF\u9884\u7F6E\u89D2\u8272");
  ensureRole("\u540E\u53F0\u7BA1\u7406\u4EBA\u5458", "\u7CFB\u7EDF\u9884\u7F6E\u89D2\u8272");
  saveJSON("rolesData", rolesData);
  const sales = loadJSON("salesData", null);
  if (Array.isArray(sales)) {
    salesData.splice(0, salesData.length, ...sales);
  }
}
function refreshAccountOptions() {
  const selectedValue = (entryMethod == null ? void 0 : entryMethod.value) || "";
  entryMethod.innerHTML = `<option value="">${getCurrentAppLocale() === "es-ES" ? "Seleccione" : "\u8BF7\u9009\u62E9"}</option>`;
  accountsData.slice().reverse().forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.name;
    opt.textContent = getAccountDisplayName(a);
    entryMethod.appendChild(opt);
  });
  if (entryMethod) entryMethod.value = selectedValue;
}
function resetAccCreateForm() {
  if (accCreateName) accCreateName.value = "";
  if (accCreateNameEs) accCreateNameEs.value = "";
  if (accCreateDesc) accCreateDesc.value = "";
}
function resetAccEditForm() {
  if (accEditName) accEditName.value = "";
  if (accEditNameEs) accEditNameEs.value = "";
  if (accEditDesc) accEditDesc.value = "";
}
function renderAccounts() {
  accRows.innerHTML = "";
  const list = accountsData.map((a, i) => ({ a, i }));
  list.slice().reverse().forEach(({ a, i }) => {
    const tr = document.createElement("tr");
    const ops = document.createElement("td");
    ops.className = "actions";
    const edit = document.createElement("a");
    edit.href = "#";
    edit.textContent = "\u7F16\u8F91";
    edit.className = "link-blue";
    const del = document.createElement("a");
    del.href = "#";
    del.textContent = "\u5220\u9664";
    del.className = "link-red";
    const ledgerLink = document.createElement("a");
    ledgerLink.href = "#";
    ledgerLink.textContent = "\u6D41\u6C34";
    ledgerLink.className = "link-blue";
    ops.append(ledgerLink, document.createTextNode(" "), edit, document.createTextNode(" "), del);
    ledgerLink.addEventListener("click", (e) => {
      e.preventDefault();
      openAccountLedger(a.name);
    });
    if (!a.initialSet) {
      const initBtn = document.createElement("a");
      initBtn.href = "#";
      initBtn.textContent = "\u521D\u59CB\u8BBE\u7F6E";
      initBtn.className = "link-orange";
      ops.append(document.createTextNode(" "), initBtn);
      initBtn.addEventListener("click", (e) => {
        e.preventDefault();
        pendingAccInitIndex = i;
        accInitAmount.value = "";
        accInitModal.style.display = "flex";
      });
    }
    [a.name || "", getAccountSpanishName(a), a.balance.toFixed(2), a.desc || "", a.created].forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });
    tr.appendChild(ops);
    accRows.appendChild(tr);
    edit.addEventListener("click", (e) => {
      e.preventDefault();
      pendingAccEditIndex = i;
      accEditName.value = a.name || "";
      accEditNameEs.value = getAccountSpanishName(a);
      accEditDesc.value = a.desc || "";
      accEditModal.style.display = "flex";
    });
    del.addEventListener("click", (e) => {
      e.preventDefault();
      const used = records.some((r) => r.method === a.name);
      if (used) {
        alert("\u8BE5\u8D26\u6237\u6709\u76F8\u5173\u4FE1\u606F\u6B63\u5728\u4F7F\u7528\u4E2D\u65E0\u6CD5\u88AB\u5220\u9664");
        return;
      }
      pendingAccDeleteIndex = i;
      accDeleteModal.style.display = "flex";
    });
  });
}
async function openAccountLedger(accountName) {
  location.hash = `#account-ledger:${encodeURIComponent(accountName || "")}`;
}
let accountLedgerRows = [];
let accountLedgerPage = 1;
const ACCOUNT_LEDGER_PAGE_SIZE = 200;
let debtLedgerRows = [];
let debtLedgerPage = 1;
const DEBT_LEDGER_PAGE_SIZE = 200;
function renderAccountLedgerRows() {
  const rowsEl = document.getElementById("account-ledger-rows");
  const pager = document.getElementById("account-ledger-pager");
  if (!rowsEl || !pager) return;
  rowsEl.innerHTML = "";
  pager.innerHTML = "";
  if (!accountLedgerRows.length) {
    rowsEl.innerHTML = '<tr class="empty"><td colspan="9">暂无流水记录</td></tr>';
    return;
  }
  const totalPages = Math.ceil(accountLedgerRows.length / ACCOUNT_LEDGER_PAGE_SIZE);
  accountLedgerPage = Math.max(1, Math.min(accountLedgerPage, totalPages));
  const start = (accountLedgerPage - 1) * ACCOUNT_LEDGER_PAGE_SIZE;
  accountLedgerRows.slice(start, start + ACCOUNT_LEDGER_PAGE_SIZE).forEach((item) => {
    const tr = document.createElement("tr");
    const amount = item.type === "支出" || item.type === "开支"
      ? -Number(item.amount || 0)
      : Number(item.amount || 0);
    const amountTd = document.createElement("td");
    amountTd.innerHTML = `<div>${amount.toFixed(2)}</div>`;
    if (item.skipAccountBalance) {
      const hint = document.createElement("div");
      hint.textContent = "本次不计算";
      hint.style.cssText = "color:#f59e0b;font-size:12px;margin-top:3px";
      amountTd.appendChild(hint);
    }
    [
      item.date ? formatDisplayDate(item.date) : "-",
      item.client || "-",
      getCategoryDisplayName(item.category || "") || "-",
      item.doc || "-",
      amountTd,
      item.category === COMPANY_LOAN_CATEGORY
        ? Number(item.repaidAmount || 0).toFixed(2)
        : "-",
      getAccountDisplayName(item.method || "") || "-",
      item.notes || "-",
      Number(item.balance || 0).toFixed(2)
    ].forEach((value) => {
      if (value instanceof HTMLElement) {
        tr.appendChild(value);
      } else {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.appendChild(td);
      }
    });
    rowsEl.appendChild(tr);
  });
  const info = document.createElement("span");
  info.textContent = `共 ${accountLedgerRows.length} 条，第 ${accountLedgerPage}/${totalPages} 页`;
  info.style.cssText = "color:#94a3b8;font-size:13px;margin:0 8px";
  const makeButton = (text, page, disabled) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.textContent = text;
    button.disabled = disabled;
    button.addEventListener("click", () => {
      accountLedgerPage = page;
      renderAccountLedgerRows();
    });
    return button;
  };
  pager.append(
    makeButton("上一页", accountLedgerPage - 1, accountLedgerPage <= 1),
    info,
    makeButton("下一页", accountLedgerPage + 1, accountLedgerPage >= totalPages)
  );
}
async function renderAccountLedgerPage(accountName) {
  const title = document.getElementById("account-ledger-title");
  const rowsEl = document.getElementById("account-ledger-rows");
  if (!rowsEl) return;
  if (title) title.textContent = `${accountName} - 账户流水`;
  rowsEl.innerHTML = '<tr class="empty"><td colspan="9">加载中...</td></tr>';
  try {
    accountLedgerRows = await apiFetchJSON(`/api/accounts/${encodeURIComponent(accountName)}/ledger`);
    if (!Array.isArray(accountLedgerRows)) accountLedgerRows = [];
    accountLedgerPage = 1;
    renderAccountLedgerRows();
  } catch (e) {
    rowsEl.innerHTML = '<tr class="empty"><td colspan="9">流水加载失败</td></tr>';
  }
}
const accountLedgerClose = document.getElementById("account-ledger-close");
accountLedgerClose?.addEventListener("click", () => {
  location.hash = "#accounts";
});
function renderDebtLedgerRows() {
  const rowsEl = document.getElementById("debt-ledger-rows");
  const pager = document.getElementById("debt-ledger-pager");
  if (!rowsEl || !pager) return;
  rowsEl.innerHTML = "";
  pager.innerHTML = "";
  if (!debtLedgerRows.length) {
    rowsEl.innerHTML = '<tr class="empty"><td colspan="9">暂无借款流水</td></tr>';
    return;
  }
  const totalPages = Math.ceil(debtLedgerRows.length / DEBT_LEDGER_PAGE_SIZE);
  debtLedgerPage = Math.max(1, Math.min(debtLedgerPage, totalPages));
  const start = (debtLedgerPage - 1) * DEBT_LEDGER_PAGE_SIZE;
  debtLedgerRows.slice(start, start + DEBT_LEDGER_PAGE_SIZE).forEach((item) => {
    const tr = document.createElement("tr");
    const amount = item.type === "支出" || item.type === "开支"
      ? -Number(item.amount || 0)
      : Number(item.amount || 0);
    const amountTd = document.createElement("td");
    amountTd.textContent = amount.toFixed(2);
    if (item.skipAccountBalance) {
      const hint = document.createElement("div");
      hint.textContent = "本次不计算";
      hint.style.cssText = "color:#f59e0b;font-size:12px;margin-top:3px";
      amountTd.appendChild(hint);
    }
    [
      item.date ? formatDisplayDate(item.date) : "-",
      item.client || "-",
      item.type || "-",
      getCategoryDisplayName(item.category || "") || "-",
      item.doc || "-",
      amountTd,
      getAccountDisplayName(item.method || "") || "-",
      item.notes || "-",
      Number(item.balance || 0).toFixed(2)
    ].forEach((value) => {
      if (value instanceof HTMLElement) {
        tr.appendChild(value);
      } else {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.appendChild(td);
      }
    });
    rowsEl.appendChild(tr);
  });
  const info = document.createElement("span");
  info.textContent = `共 ${debtLedgerRows.length} 条，第 ${debtLedgerPage}/${totalPages} 页`;
  info.style.cssText = "color:#94a3b8;font-size:13px;margin:0 8px";
  const makeButton = (text, page, disabled) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.textContent = text;
    button.disabled = disabled;
    button.addEventListener("click", () => {
      debtLedgerPage = page;
      renderDebtLedgerRows();
    });
    return button;
  };
  pager.append(
    makeButton("上一页", debtLedgerPage - 1, debtLedgerPage <= 1),
    info,
    makeButton("下一页", debtLedgerPage + 1, debtLedgerPage >= totalPages)
  );
}
async function renderDebtLedgerPage() {
  const rowsEl = document.getElementById("debt-ledger-rows");
  if (!rowsEl) return;
  rowsEl.innerHTML = '<tr class="empty"><td colspan="9">加载中...</td></tr>';
  try {
    await loadLedgerFromServer(true);
    const sorted = records
      .filter((item) => item.category === COMPANY_LOAN_CATEGORY || item.category === COMPANY_REPAYMENT_CATEGORY)
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    let balance = 0;
    debtLedgerRows = sorted.map((item) => {
      const delta = item.category === COMPANY_LOAN_CATEGORY
        ? Number(item.amount || 0)
        : -Number(item.amount || 0);
      balance += delta;
      return { ...item, balance: Number(balance.toFixed(2)) };
    }).reverse();
    debtLedgerPage = 1;
    renderDebtLedgerRows();
  } catch (e) {
    rowsEl.innerHTML = '<tr class="empty"><td colspan="9">借款流水加载失败</td></tr>';
  }
}
document.getElementById("debt-ledger-close")?.addEventListener("click", () => {
  location.hash = "#shareholder-summary";
});
const accInitModal = document.getElementById("acc-init-modal");
const accInitAmount = document.getElementById("acc-init-amount");
const accInitCancel = document.getElementById("acc-init-cancel");
const accInitOk = document.getElementById("acc-init-ok");
let pendingAccInitIndex = null;
const accCreateModal = document.getElementById("acc-create-modal");
const accCreateForm = document.getElementById("acc-create-form");
const accCreateCancel = document.getElementById("acc-create-cancel");
const accCreateName = document.getElementById("acc-create-name");
const accCreateNameEs = document.getElementById("acc-create-name-es");
const accCreateDesc = document.getElementById("acc-create-desc");
const accDeleteModal = document.getElementById("acc-delete-modal");
const accDeleteCancel = document.getElementById("acc-delete-cancel");
const accDeleteOk = document.getElementById("acc-delete-ok");
let pendingAccDeleteIndex = null;
const accEditModal = document.getElementById("acc-edit-modal");
const accEditForm = document.getElementById("acc-edit-form");
const accEditCancel = document.getElementById("acc-edit-cancel");
const accEditName = document.getElementById("acc-edit-name");
const accEditNameEs = document.getElementById("acc-edit-name-es");
const accEditDesc = document.getElementById("acc-edit-desc");
let pendingAccEditIndex = null;
accInitCancel == null ? void 0 : accInitCancel.addEventListener("click", () => {
  accInitModal.style.display = "none";
  pendingAccInitIndex = null;
});
accInitOk == null ? void 0 : accInitOk.addEventListener("click", async () => {
  var _a2;
  if (pendingAccInitIndex != null) {
    const amt = parseFloat(accInitAmount.value || "0");
    if (isNaN(amt)) return;
    accountsData[pendingAccInitIndex].balance = amt;
    accountsData[pendingAccInitIndex].initialSet = true;
    accInitModal.style.display = "none";
    await apiAccountInit(((_a2 = accountsData[pendingAccInitIndex]) == null ? void 0 : _a2.name) || "", amt);
    await apiAccountsList();
    refreshAccountOptions();
    renderAccounts();
    saveJSON("accountsData", accountsData);
    pendingAccInitIndex = null;
  }
});
accCreateCancel == null ? void 0 : accCreateCancel.addEventListener("click", () => {
  accCreateModal.style.display = "none";
  resetAccCreateForm();
});
accCreateForm == null ? void 0 : accCreateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = ((accCreateName == null ? void 0 : accCreateName.value) || "").trim();
  const nameEs = ((accCreateNameEs == null ? void 0 : accCreateNameEs.value) || "").trim();
  const desc = ((accCreateDesc == null ? void 0 : accCreateDesc.value) || "").trim();
  if (!name) return;
  if (accountsData.some((a) => a.name === name)) {
    alert("\u8D26\u6237\u540D\u79F0\u5DF2\u5B58\u5728");
    return;
  }
  const now = /* @__PURE__ */ new Date();
  const created = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  accountsData.push(normalizeAccountItem({ name, nameEs, balance: 0, desc, created, initialSet: false }));
  setAccountSpanishNameOverride(name, nameEs);
  accCreateModal.style.display = "none";
  resetAccCreateForm();
  await apiAccountCreate({ name, nameEs, balance: 0, desc, created, initialSet: false });
  await apiAccountsList();
  refreshAccountOptions();
  renderAccounts();
  saveJSON("accountsData", accountsData);
});
accEditCancel == null ? void 0 : accEditCancel.addEventListener("click", () => {
  accEditModal.style.display = "none";
  pendingAccEditIndex = null;
  resetAccEditForm();
});
accEditForm == null ? void 0 : accEditForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (pendingAccEditIndex == null) return;
  const submitBtn = accEditForm.querySelector('button[type="submit"]');
  const submitText = submitBtn ? String(submitBtn.textContent || "保存") : "保存";
  const name = ((accEditName == null ? void 0 : accEditName.value) || "").trim();
  const nameEs = ((accEditNameEs == null ? void 0 : accEditNameEs.value) || "").trim();
  const desc = ((accEditDesc == null ? void 0 : accEditDesc.value) || "").trim();
  if (!name) return;
  const oldName = accountsData[pendingAccEditIndex].name;
  if (name !== oldName && accountsData.some((x, i) => x.name === name && i !== pendingAccEditIndex)) {
    alert("\u8D26\u6237\u540D\u79F0\u5DF2\u5B58\u5728");
    return;
  }
  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "\u4FDD\u5B58\u4E2D...";
    }
    await apiAccountUpdateByName({ name: oldName, newName: name, nameEs, desc });
    renameAccountSpanishNameOverride(oldName, name, nameEs);
    accountsData[pendingAccEditIndex].name = name;
    accountsData[pendingAccEditIndex].nameEs = nameEs;
    accountsData[pendingAccEditIndex].desc = desc;
    records.forEach((r) => {
      if (r.method === oldName) r.method = name;
    });
    await apiAccountsList();
    refreshAccountOptions();
    renderAccounts();
    saveJSON("accountsData", accountsData);
    saveJSON("records", records);
    accEditModal.style.display = "none";
    pendingAccEditIndex = null;
    resetAccEditForm();
    showAppToast("\u8D26\u6237\u4FDD\u5B58\u6210\u529F");
  } catch (err) {
    const code = String((err == null ? void 0 : err.message) || "");
    if (code === "not_found") {
      alert("\u8D26\u6237\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u5176\u4ED6\u4EBA\u4FEE\u6539\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    } else if (code === "bad_request") {
      alert("\u4FDD\u5B58\u53C2\u6570\u4E0D\u6B63\u786E");
    } else {
      alert("\u8D26\u6237\u4FDD\u5B58\u5931\u8D25");
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitText;
    }
  }
});
accDeleteCancel == null ? void 0 : accDeleteCancel.addEventListener("click", () => {
  accDeleteModal.style.display = "none";
  pendingAccDeleteIndex = null;
});
accDeleteOk == null ? void 0 : accDeleteOk.addEventListener("click", async () => {
  var _a2;
  if (pendingAccDeleteIndex != null) {
    const name = ((_a2 = accountsData[pendingAccDeleteIndex]) == null ? void 0 : _a2.name) || "";
    const ok = await apiAccountDeleteByName(name);
    if (ok) {
      deleteAccountSpanishNameOverride(name);
      accountsData.splice(pendingAccDeleteIndex, 1);
    }
    await apiAccountsList();
    refreshAccountOptions();
    renderAccounts();
    saveJSON("accountsData", accountsData);
  }
  accDeleteModal.style.display = "none";
  pendingAccDeleteIndex = null;
});
const clientDD = document.getElementById("client-dd");
const clientSearch = document.getElementById("client-search");
const clientList = document.getElementById("client-list");
const clientPlus = document.getElementById("client-plus");
const clientWrap = document.getElementById("client-wrap");
const clientModal = document.getElementById("client-modal");
const clientModalForm = document.getElementById("client-modal-form");
const clientCancel = document.getElementById("client-cancel");
let clientModalTab = "customers";
const fileViewer = document.getElementById("file-viewer");
const fileViewerBox = document.getElementById("file-viewer-box");
function showFileViewer(url) {
  if (!fileViewer || !fileViewerBox || !url) return;
  fileViewerBox.innerHTML = "";
  const full = document.createElement("img");
  full.src = String(url);
  full.alt = "\u9884\u89C8\u56FE\u7247";
  fileViewerBox.appendChild(full);
  fileViewer.style.zIndex = "20000";
  try {
    document.body.appendChild(fileViewer);
  } catch (e) {
  }
  fileViewer.style.display = "flex";
}
window.showFileViewer = showFileViewer;
function openUploadedFile(url, fileName = "") {
  if (!fileViewer || !fileViewerBox || !url) return;
  const lowerName = String(fileName || url || "").toLowerCase();
  fileViewerBox.innerHTML = "";
  if (/\.pdf($|[?#])/i.test(lowerName)) {
    const emb = document.createElement("embed");
    emb.src = String(url);
    emb.type = "application/pdf";
    fileViewerBox.appendChild(emb);
  } else {
    const full = document.createElement("img");
    full.src = String(url);
    full.alt = "\u9884\u89C8\u56FE\u7247";
    fileViewerBox.appendChild(full);
  }
  fileViewer.style.zIndex = "20000";
  try {
    document.body.appendChild(fileViewer);
  } catch (e) {
  }
  fileViewer.style.display = "flex";
}
function allContacts() {
  return [...contactsData.customers, ...contactsData.merchants, ...contactsData.others];
}
function renderClientDropdown() {
  const q = (clientSearch.value || "").trim().toLowerCase();
  const data = allContacts().filter((x) => {
    if (!q) return true;
    return [x.name, x.company, x.contact, x.phone, x.city, x.remark || ""].some((v) => String(v || "").toLowerCase().includes(q));
  });
  clientList.innerHTML = "";
  data.forEach((item) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    const left = document.createElement("div");
    left.textContent = item.name;
    const right = document.createElement("div");
    right.style.color = "#94a3b8";
    right.textContent = `${item.contact || ""} ${item.phone || ""} ${item.city || ""}`.trim();
    row.append(left, right);
    row.addEventListener("click", () => {
      entryClient.value = item.name;
      clientDD.style.display = "none";
      if ((docDD == null ? void 0 : docDD.style.display) === "block") updateDocDropdown();
    });
    clientList.appendChild(row);
  });
}
function positionLedgerSidePanel(panel, listEl, headEl = null) {
  var _a2;
  if (!panel) return;
  const entryCard = (_a2 = document.getElementById("entry-form")) == null ? void 0 : _a2.closest(".card");
  if (!entryCard) return;
  const cr = entryCard.getBoundingClientRect();
  const gap = 16;
  panel.style.position = "fixed";
  panel.style.left = `${Math.max(0, cr.left - cr.width - gap)}px`;
  panel.style.top = `${cr.top}px`;
  panel.style.width = `${cr.width}px`;
  panel.style.height = `${cr.height}px`;
  panel.style.zIndex = "90";
  if (listEl) {
    const headH = headEl ? headEl.getBoundingClientRect().height : 0;
    listEl.style.maxHeight = `${Math.max(120, cr.height - headH - 24)}px`;
    listEl.style.overflow = "auto";
  }
}
function openClientDropdown() {
  clientDD.style.display = "block";
  clientSearch.value = "";
  renderClientDropdown();
  const head = clientDD.querySelector(".dd-head");
  const list = clientDD.querySelector(".dd-list");
  positionLedgerSidePanel(clientDD, list, head);
  clientSearch.focus();
}
entryClient.addEventListener("focus", openClientDropdown);
entryClient.addEventListener("click", openClientDropdown);
clientSearch.addEventListener("input", renderClientDropdown);
document.addEventListener("click", (e) => {
  if (!clientWrap.contains(e.target) && !clientDD.contains(e.target)) clientDD.style.display = "none";
});
clientPlus == null ? void 0 : clientPlus.addEventListener("click", () => {
  clientDD.style.display = "none";
  clientModal.style.display = "flex";
  clientModalTab = "customers";
  document.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p.getAttribute("data-target") === clientModalTab));
});
document.querySelectorAll(".pill[data-target]").forEach((p) => {
  p.addEventListener("click", () => {
    clientModalTab = p.getAttribute("data-target");
    document.querySelectorAll(".pill").forEach((x) => x.classList.remove("active"));
    p.classList.add("active");
  });
});
clientCancel == null ? void 0 : clientCancel.addEventListener("click", () => {
  clientModal.style.display = "none";
});
clientModalForm == null ? void 0 : clientModalForm.addEventListener("submit", async (e) => {
  var _a2;
  e.preventDefault();
  const name = document.getElementById("m-name").value.trim();
  const company = document.getElementById("m-company").value.trim();
  const code = document.getElementById("m-code").value.trim();
  const contact = document.getElementById("m-contact").value.trim();
  const phone = document.getElementById("m-phone").value.trim();
  const country = document.getElementById("m-country").value.trim();
  const address = document.getElementById("m-address").value.trim();
  const zip = document.getElementById("m-zip").value.trim();
  const city = document.getElementById("m-city").value.trim();
  const remark = document.getElementById("m-remark").value.trim();
  if (!name) return;
  const now = /* @__PURE__ */ new Date();
  const created = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const ownerLabel = clientModalTab === "customers" ? "\u5BA2\u6237" : clientModalTab === "merchants" ? "\u5546\u5BB6" : "\u5176\u5B83";
  const payload = { name, contact, phone, city, remark, owner: ownerLabel, created, company, code, country, address, zip };
  try {
    const id = await apiContactsCreate(payload);
    contactsData[clientModalTab].push({ id, ...payload });
    await apiContactsList(clientModalTab, "", 1, 5e3);
  } catch (err) {
    if (((_a2 = err == null ? void 0 : err.data) == null ? void 0 : _a2.error) === "duplicate_name" || (err == null ? void 0 : err.message) === "duplicate_name") {
      alert("\u5E97\u94FA\u540D\u79F0\u5DF2\u7ECF\u5B58\u5728\uFF0C\u8BF7\u786E\u8BA4\u540E\u91CD\u8BD5");
      return;
    }
    alert("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    return;
  }
  ["m-name", "m-company", "m-code", "m-contact", "m-phone", "m-country", "m-address", "m-zip", "m-city", "m-remark"].forEach((id) => document.getElementById(id).value = "");
  clientModal.style.display = "none";
  entryClient.value = name;
  renderClientDropdown();
  if (location.hash === "#contacts") renderContacts();
  saveJSON("contactsData", contactsData);
});
fileViewer.addEventListener("click", (e) => {
  if (e.target === fileViewer) fileViewer.style.display = "none";
});
function getCatChildrenByName(name) {
  const cat = categoriesData.find((c) => c.name === name);
  return cat ? cat.children : [];
}
function normalizeLedgerEntryType(value) {
  const normalized = String(value || "").trim();
  if (normalized === "\u5F00\u652F" || normalized === "\u652F\u51FA") return "\u5F00\u652F";
  return "\u6536\u5165";
}
function setLedgerEntryType(value) {
  const nextType = normalizeLedgerEntryType(value);
  if (entryType) entryType.value = nextType;
  const switchEl = document.getElementById("entry-type-switch");
  if (switchEl) {
    switchEl.querySelectorAll(".type-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === nextType);
    });
  }
  setCategories();
  if (typeof updateDocDropdown === "function" && docDD && docDD.style.display === "block") updateDocDropdown();
  return nextType;
}
function refreshLedgerTypeOptions() {
  if (!entryType.value) {
    setLedgerEntryType("\u6536\u5165");
  }
}
const entryTypeSwitch = document.getElementById("entry-type-switch");
if (entryTypeSwitch) {
  const btns = entryTypeSwitch.querySelectorAll(".type-item");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setLedgerEntryType(btn.dataset.value);
    });
  });
}
function setCategories() {
  const t = entryType.value;
  const list = getCatChildrenByName(t);
  const prev = entryCategory.value;
  entryCategory.innerHTML = `<option value="">${getCurrentAppLocale() === "es-ES" ? "Seleccione" : "\u8BF7\u9009\u62E9\u5B50\u7C7B\u76EE"}</option>`;
  list.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = getCategoryDisplayName(c, t);
    entryCategory.appendChild(opt);
  });
  if (list.includes(prev)) entryCategory.value = prev;
}
const entryDoc = document.getElementById("entry-doc");
const docDD = document.getElementById("doc-dd");
const docDDList = document.getElementById("doc-dd-list");
let ledgerSelectedDocs = [];
entryCategory.addEventListener("change", () => {
  entryDoc == null ? void 0 : entryDoc.focus();
  if (entryCategory.value === COMPANY_REPAYMENT_CATEGORY) {
    loadLedgerFromServer(true).then(() => updateDocDropdown()).catch(() => {});
  }
});
function normalizeLedgerDocList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,\n，、]/);
  return [...new Set(source.map((v) => String(v || "").trim()).filter(Boolean))];
}
function syncLedgerDocInput() {
  if (entryDoc) entryDoc.value = ledgerSelectedDocs.join(", ");
  updateLedgerMatchedOrderTotal();
}
function updateLedgerMatchedOrderTotal() {
  const el = document.getElementById("entry-matched-orders-total");
  if (!el) return;
  const selected = ledgerSelectedDocs.map((doc) => findLedgerMatchRecord(doc)).filter(Boolean);
  if (!selected.length) {
    el.textContent = "";
    return;
  }
  const selectedTotal = selected.reduce((sum, r) => sum + Math.max(0, Number(r.amount || 0) - Number(r.paid || 0)), 0);
  const currentAmount = Number(entryAmount?.value || 0);
  const difference = currentAmount - selectedTotal;
  const color = Math.abs(difference) < 0.005 ? "var(--green)" : difference > 0 ? "var(--orange)" : "#ef4444";
  el.style.color = color;
  el.textContent = `已选欠款合计：${selectedTotal.toFixed(2)}，差额：${difference.toFixed(2)}`;
}
function setLedgerSelectedDocs(value, options = {}) {
  ledgerSelectedDocs = normalizeLedgerDocList(value);
  syncLedgerDocInput();
  if (options.updateAmount !== false) {
    const selected = ledgerSelectedDocs.map((doc) => findLedgerMatchRecord(doc)).filter(Boolean);
    if (selected.length) {
      const firstType = selected[0].type === "应收账款" ? "收入" : "开支";
      if (normalizeLedgerEntryType(entryType.value) !== firstType) setLedgerEntryType(firstType);
      const partners = [...new Set(selected.map((r) => String(r.partner || "").trim()).filter(Boolean))];
      if (partners.length === 1 && entryClient) entryClient.value = partners[0];
      const remaining = selected.reduce((sum, r) => sum + Math.max(0, Number(r.amount || 0) - Number(r.paid || 0)), 0);
      if (remaining > 0 && entryAmount && !ledgerEditingId && !options.keepAmount) entryAmount.value = remaining.toFixed(2);
    }
  }
  updateLedgerMatchedOrderTotal();
}
function linkDocToPayable() {
  setLedgerSelectedDocs((entryDoc == null ? void 0 : entryDoc.value) || "", { keepAmount: true });
  if (ledgerSelectedDocs.length && typeof clientDD !== "undefined" && clientDD) clientDD.style.display = "none";
}
function findLedgerMatchRecord(doc) {
  const normalizedDoc = String(doc || "").trim();
  if (entryCategory.value === COMPANY_REPAYMENT_CATEGORY) {
    return records.find((r) =>
      r.type === "收入" &&
      r.category === COMPANY_LOAN_CATEGORY &&
      String(r.doc || "").trim() === normalizedDoc
    );
  }
  return payRecords.find((r) => String(r.doc || "").trim() === normalizedDoc);
}
entryAmount == null ? void 0 : entryAmount.addEventListener("input", updateLedgerMatchedOrderTotal);
function getLedgerDocMatches(query = "", partner = "") {
  const rawQuery = String(query || "").trim().toLowerCase();
  const selectedText = ledgerSelectedDocs.join(", ").toLowerCase();
  const q = rawQuery === selectedText ? "" : rawQuery;
  const partnerName = String(partner || "").trim();
  const selectedType = normalizeLedgerEntryType(entryType.value);
  if (entryCategory.value === COMPANY_REPAYMENT_CATEGORY) {
    const normalizedPartner = partnerName.replace(/\s+/g, "").toLowerCase();
    const loanMatches = records.filter((r) => {
      const remaining = Math.max(0, Number(r.amount || 0) - Number(r.repaidAmount || 0));
      if (r.type !== "收入" || r.category !== COMPANY_LOAN_CATEGORY || remaining <= 0) return false;
      const recordClient = String(r.client || "").trim().replace(/\s+/g, "").toLowerCase();
      if (normalizedPartner && recordClient !== normalizedPartner && !recordClient.includes(normalizedPartner) && !normalizedPartner.includes(recordClient)) return false;
      if (!q) return true;
      return [r.doc || "", r.client || "", r.notes || ""].some((v) => String(v || "").toLowerCase().includes(q));
    }).map((r) => ({
      ...r,
      client: r.client || "",
      partner: r.client || "",
      paid: Number(r.repaidAmount || 0),
      type: "公司借款"
    }));
    loanMatches.sort((a, b) => String(a.doc || "").localeCompare(String(b.doc || ""), "zh-CN", { numeric: true }));
    return loanMatches;
  }
  const payableType = selectedType === "收入" ? "应收账款" : "应付账款";
  const matches = payRecords.filter((r) => {
    const recordPartner = String(r.partner || "").trim();
    if (partnerName && recordPartner !== partnerName) return false;
    if (r.type !== payableType) return false;
    if (Math.max(0, Number(r.amount || 0) - Number(r.paid || 0)) <= 0) return false;
    if (!q) return true;
    return [r.doc || "", r.partner || "", r.notes || ""].some((v) => String(v || "").toLowerCase().includes(q));
  });
  const orderSortKey = (value) => {
    const text = String(value || "").trim();
    const numbers = text.match(/\d+/g) || [];
    return {
      number: numbers.length ? Number(numbers[0]) : Number.POSITIVE_INFINITY,
      year: numbers.length > 1 ? Number(numbers[numbers.length - 1]) : Number.POSITIVE_INFINITY,
      text
    };
  };
  matches.sort((a, b) => {
    const aKey = orderSortKey(a.doc);
    const bKey = orderSortKey(b.doc);
    if (aKey.number !== bKey.number) return aKey.number - bKey.number;
    if (aKey.year !== bKey.year) return aKey.year - bKey.year;
    return aKey.text.localeCompare(bKey.text, "zh-CN", { numeric: true });
  });
  return matches;
}
function updateDocDropdown() {
  const v = ((entryDoc == null ? void 0 : entryDoc.value) || "").trim();
  const partner = ((entryClient == null ? void 0 : entryClient.value) || "").trim();
  if (!partner && v.length < 3) {
    if (docDD) docDD.style.display = "none";
    return;
  }
  const matches = getLedgerDocMatches(v, partner);
  docDDList.innerHTML = "";
  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dd-item";
    empty.style.justifyContent = "center";
    empty.style.color = "#94a3b8";
    empty.textContent = partner ? "\u8BE5\u5F80\u6765\u5355\u4F4D\u6682\u65E0\u5339\u914D\u8BA2\u5355" : "\u6682\u65E0\u5339\u914D\u8BA2\u5355";
    docDDList.appendChild(empty);
  }
  matches.forEach((r) => {
    const remaining = Math.max(0, (r.amount || 0) - (r.paid || 0));
    const isUnpaid = !r.settled && remaining > 0;
    const item = document.createElement("div");
    item.className = "dd-item";
    const isRecv = /应收/.test(r.type || "");
    if (!isUnpaid) item.style.color = "#ffffff";
    else if (isRecv) item.style.color = "var(--green)";
    else item.style.color = "var(--orange)";
    const left = document.createElement("div");
    const selected = ledgerSelectedDocs.includes(String(r.doc || "").trim());
    left.innerHTML = `<div style="font-weight:bold"><span style="display:inline-block;width:18px;color:${selected ? "var(--blue)" : "#94a3b8"}">${selected ? "✓" : "□"}</span>${r.doc || "\u65E0\u5355\u53F7"}</div><div style="font-size:12px; opacity:0.8">${r.partner || "\u672A\u77E5\u5BA2\u6237"} (${r.type || ""})</div>`;
    const right = document.createElement("div");
    right.style.textAlign = "right";
    right.innerHTML = `<div>\u603B: ${(r.amount || 0).toFixed(2)}</div><div style="font-size:12px; opacity:0.8">\u6B20: ${remaining.toFixed(2)}</div>`;
    item.appendChild(left);
    item.appendChild(right);
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const doc = String(r.doc || "").trim();
      const next = ledgerSelectedDocs.includes(doc) ? ledgerSelectedDocs.filter((v) => v !== doc) : [...ledgerSelectedDocs, doc];
      setLedgerSelectedDocs(next);
      updateDocDropdown();
    });
    docDDList.appendChild(item);
  });
  if (docDD) {
    docDD.style.display = "block";
    positionLedgerSidePanel(docDD, docDDList);
  }
}
entryDoc == null ? void 0 : entryDoc.addEventListener("input", () => {
  ledgerSelectedDocs = normalizeLedgerDocList(entryDoc.value);
  updateDocDropdown();
});
entryDoc == null ? void 0 : entryDoc.addEventListener("focus", updateDocDropdown);
entryDoc == null ? void 0 : entryDoc.addEventListener("click", updateDocDropdown);
entryDoc == null ? void 0 : entryDoc.addEventListener("blur", () => {
  setTimeout(() => {
    if (docDD) docDD.style.display = "none";
  }, 150);
  linkDocToPayable();
});
entryDoc == null ? void 0 : entryDoc.addEventListener("keyup", (e) => {
  if (e.key === "Enter") {
    if (docDD) docDD.style.display = "none";
    linkDocToPayable();
    entryMethod == null ? void 0 : entryMethod.focus();
  }
});
function adjustSelect(sel, delta) {
  if (!sel) return;
  const len = sel.options.length;
  let idx = sel.selectedIndex;
  idx = Math.max(0, Math.min(len - 1, idx + delta));
  sel.selectedIndex = idx;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}
entryMethod == null ? void 0 : entryMethod.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    adjustSelect(entryMethod, 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    adjustSelect(entryMethod, -1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    entryMethod.blur();
  }
});
let ledgerEditingId = null;
let ledgerEditingFile = "";
let ledgerEditingDate = "";
let ledgerEditingDateTime = "";
let ledgerEditingCreatedBy = "";
function setLedgerEdit(rec) {
  ledgerEditingId = rec.id || null;
  ledgerEditingFile = rec.file || "";
  ledgerEditingDate = rec.date || "";
  ledgerEditingDateTime = rec.dateTime || "";
  ledgerEditingCreatedBy = rec.createdBy || "";
  setLedgerEntryType(rec.type || "\u6536\u5165");
  if (entryCategory) entryCategory.value = rec.category || "";
  setLedgerSelectedDocs(rec.doc || "", { updateAmount: false });
  if (entryClient) entryClient.value = rec.client || "";
  if (entryAmount) entryAmount.value = Number(rec.amount || 0).toFixed(2);
  if (entrySkipAccountBalance) entrySkipAccountBalance.checked = rec.skipAccountBalance === true;
  updateLedgerMatchedOrderTotal();
  if (entryMethod) entryMethod.value = rec.method || "";
  if (entryNotes) entryNotes.value = rec.notes || "";
  if (entryFile) entryFile.value = "";
  syncLedgerEntryFormLocale();
  entryForm == null ? void 0 : entryForm.scrollIntoView({ behavior: "smooth", block: "start" });
}
function clearLedgerEdit() {
  ledgerEditingId = null;
  ledgerEditingFile = "";
  ledgerEditingDate = "";
  ledgerEditingDateTime = "";
  ledgerEditingCreatedBy = "";
  if (entrySkipAccountBalance) entrySkipAccountBalance.checked = false;
  ledgerSelectedDocs = [];
  syncLedgerDocInput();
  syncLedgerEntryFormLocale();
}
async function uploadLedgerAttachment(fileObj) {
  if (!fileObj) throw new Error("missing_file");
  const fileName = String(fileObj.name || "").trim().toLowerCase();
  const mimeType = String(fileObj.type || "").trim().toLowerCase();
  const extOk = [".jpg", ".jpeg", ".png", ".pdf"].some((ext) => fileName.endsWith(ext));
  const mimeOk = ["image/jpeg", "image/jpg", "image/png", "application/pdf"].includes(mimeType);
  if (!(extOk || mimeOk)) throw new Error("bad_type");
  const fd = new FormData();
  fd.append("file", fileObj);
  const token = getAuthToken();
  const r = await fetch(API_BASE + "/api/upload", {
    method: "POST",
    headers: token ? { "Authorization": "Bearer " + token } : {},
    body: fd
  });
  if (!r.ok) throw new Error("upload_failed");
  const d = await r.json();
  return d.url || "";
}
async function saveLedgerAttachmentForRow(rec, fileObj) {
  const fileUrl = await uploadLedgerAttachment(fileObj);
  if (!fileUrl) throw new Error("upload_failed");
  if (!(rec == null ? void 0 : rec.id)) throw new Error("not_found");
  const res = await fetchWithAuth("/api/ledger/" + String(rec.id) + "/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: fileUrl })
  });
  if (!res.ok && res.status !== 404) {
    if (res.status === 400) throw new Error("not_editable");
    if (res.status === 404) throw new Error("not_found");
    throw new Error("save_failed");
  }
  if (!res.ok && res.status === 404) {
    const fallback = await fetchWithAuth("/api/ledger/" + String(rec.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: rec.type || "",
        category: rec.category || "",
        doc: rec.doc || "",
        client: rec.client || "",
        amount: Number(rec.amount || 0),
        method: rec.method || "",
        file: fileUrl,
        notes: rec.notes || "",
        date: rec.date || "",
        dateTime: rec.dateTime || "",
        createdBy: rec.createdBy || ""
      })
    });
    if (!fallback.ok) {
      if (fallback.status === 400) throw new Error("not_editable");
      if (fallback.status === 404) throw new Error("not_found");
      throw new Error("save_failed");
    }
  }
  await loadLedgerFromServer(true);
}
function render(data) {
  rows.innerHTML = "";
  if (!data.length) {
    const tr = document.createElement("tr");
    tr.className = "empty";
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "\u6682\u65E0\u6D41\u6C34\u8BB0\u5F55";
    tr.appendChild(td);
    rows.appendChild(tr);
    return;
  }
  for (const r of data) {
    const tr = document.createElement("tr");
    const rowEditable = r.confirmed === false && r.id;
    const canForceUpdate = r.confirmed !== false && !!r.id && canCurrentUserForceEditFinancialModule("ledger");
    const canUpdate = (rowEditable && can("ledger", "update")) || canForceUpdate;
    const canDelete = rowEditable && can("ledger", "delete");
    const canConfirm = rowEditable && can("ledger", "confirm");
    const amt = r.type === "\u5F00\u652F" || r.type === "\u652F\u51FA" ? (-r.amount).toFixed(2) : r.amount.toFixed(2);
    const makeTd = (text) => {
      const td = document.createElement("td");
      td.textContent = text;
      return td;
    };
    const makeClampTd = (text, options = {}) => {
      const td = document.createElement("td");
      td.className = "ledger-clamp-cell";
      td.title = text || "";
      const box = document.createElement("div");
      box.className = "ledger-clamp-text";
      box.textContent = text || "";
      if (options.clickable && text) {
        td.style.cursor = "pointer";
        td.title = "\u70B9\u51FB\u67E5\u770B\u5B8C\u6574\u5185\u5BB9";
        td.addEventListener("click", () => {
          var _a2;
          return (_a2 = options.onClick) == null ? void 0 : _a2.call(options, text);
        });
      }
      td.appendChild(box);
      return td;
    };
    const makeStackTd = (mainText, subText) => {
      const td = document.createElement("td");
      td.className = "ledger-stack-cell";
      td.innerHTML = `<div class="ledger-stack-main">${mainText || ""}</div><div class="ledger-stack-sub">${subText || ""}</div>`;
      td.title = [mainText || "", subText || ""].filter(Boolean).join("\n");
      return td;
    };
    tr.appendChild(makeTd(r.type || ""));
    tr.appendChild(makeTd(getCategoryDisplayName(r.category || "")));
    const tdDoc = document.createElement("td");
    tdDoc.innerHTML = `<div>${r.doc || ""}</div><div style="font-size:12px; color:#94a3b8; margin-top:4px">${formatDisplayDate(r.date || "")}</div>`;
    tr.appendChild(tdDoc);
    tr.appendChild(makeClampTd(r.client || ""));
    const amountTd = document.createElement("td");
    amountTd.innerHTML = `<div>${amt}</div>`;
    if (r.skipAccountBalance) {
      const skipHint = document.createElement("div");
      skipHint.textContent = "本次不计算";
      skipHint.style.cssText = "margin-top:4px;color:#f59e0b;font-size:12px";
      amountTd.appendChild(skipHint);
    }
    tr.appendChild(amountTd);
    tr.appendChild(makeTd(getAccountDisplayName(r.method || "")));
    const tdFile = document.createElement("td");
    tdFile.style.minWidth = "72px";
    if (r.fileUrl) {
      if ((r.fileType || "").includes("pdf") || /\.pdf$/i.test(r.fileName || "")) {
        const span = document.createElement("span");
        span.className = "thumb-pdf";
        span.textContent = "PDF";
        span.addEventListener("click", () => {
          fileViewerBox.innerHTML = "";
          const emb = document.createElement("embed");
          emb.src = r.fileUrl;
          emb.type = "application/pdf";
          fileViewerBox.appendChild(emb);
          fileViewer.style.display = "flex";
        });
        tdFile.appendChild(span);
      } else {
        const img = document.createElement("img");
        img.className = "thumb-img";
        img.src = r.fileUrl;
        img.alt = r.fileName || "\u9644\u4EF6";
        img.addEventListener("click", () => {
          fileViewerBox.innerHTML = "";
          const full = document.createElement("img");
          full.src = r.fileUrl;
          fileViewerBox.appendChild(full);
          fileViewer.style.display = "flex";
        });
        tdFile.appendChild(img);
      }
    } else if (!r.file && canUpdate) {
      const filePicker = document.createElement("input");
      filePicker.type = "file";
      filePicker.accept = ".jpg,.jpeg,.png,.pdf";
      filePicker.style.display = "none";
      const idleHtml = '<div style="font-size:13px; line-height:1">\u{1F4CE}</div><div style="margin-top:2px; font-weight:700; font-size:11px">\u4E0A\u4F20</div>';
      const busyHtml = '<div style="font-size:13px; line-height:1">\u23F3</div><div style="margin-top:2px; font-weight:700; font-size:11px">\u4E0A\u4F20\u4E2D</div>';
      const dropZone = document.createElement("div");
      dropZone.innerHTML = idleHtml;
      dropZone.title = "\u62D6\u62FD\u6216\u70B9\u51FB\u4E0A\u4F20 JPG / PNG / PDF";
      dropZone.style.width = "52px";
      dropZone.style.minWidth = "52px";
      dropZone.style.padding = "4px 3px";
      dropZone.style.minHeight = "38px";
      dropZone.style.border = "2px dashed #60a5fa";
      dropZone.style.borderRadius = "8px";
      dropZone.style.display = "flex";
      dropZone.style.flexDirection = "column";
      dropZone.style.alignItems = "center";
      dropZone.style.justifyContent = "center";
      dropZone.style.textAlign = "center";
      dropZone.style.color = "#cbd5e1";
      dropZone.style.cursor = "pointer";
      dropZone.style.fontSize = "11px";
      dropZone.style.lineHeight = "1.15";
      dropZone.style.background = "rgba(59,130,246,0.08)";
      dropZone.style.boxShadow = "inset 0 0 0 1px rgba(96,165,250,0.15)";
      dropZone.style.transition = "all 0.15s ease";
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.style.borderColor = "#38bdf8";
        dropZone.style.color = "#ffffff";
        dropZone.style.background = "rgba(59,130,246,0.18)";
        dropZone.style.transform = "scale(1.02)";
        dropZone.style.boxShadow = "0 0 0 2px rgba(56,189,248,0.16)";
      });
      dropZone.addEventListener("dragleave", () => {
        dropZone.style.borderColor = "#60a5fa";
        dropZone.style.color = "#cbd5e1";
        dropZone.style.background = "rgba(59,130,246,0.08)";
        dropZone.style.transform = "none";
        dropZone.style.boxShadow = "inset 0 0 0 1px rgba(96,165,250,0.15)";
      });
      dropZone.addEventListener("click", () => filePicker.click());
      filePicker.addEventListener("change", async () => {
        var _a2;
        const fileObj = (_a2 = filePicker.files) == null ? void 0 : _a2[0];
        if (!fileObj) return;
        dropZone.innerHTML = busyHtml;
        try {
          await saveLedgerAttachmentForRow(r, fileObj);
        } catch (err) {
          if ((err == null ? void 0 : err.message) === "bad_type") alert("\u4EC5\u652F\u6301 JPG\u3001PNG \u6216 PDF \u6587\u4EF6");
          else if ((err == null ? void 0 : err.message) === "not_editable") alert("\u5F53\u524D\u672C\u5730\u6D4B\u8BD5\u73AF\u5883\u4E0B\uFF0C\u8FD9\u6761\u8BB0\u5F55\u9700\u8981\u4E0A\u7EBF\u540E\u624D\u80FD\u8865\u4F20\u9644\u4EF6");
          else alert("\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
          dropZone.innerHTML = idleHtml;
        }
        filePicker.value = "";
      });
      dropZone.addEventListener("drop", async (e) => {
        var _a2, _b2;
        e.preventDefault();
        dropZone.style.borderColor = "#60a5fa";
        dropZone.style.color = "#cbd5e1";
        dropZone.style.background = "rgba(59,130,246,0.08)";
        dropZone.style.transform = "none";
        dropZone.style.boxShadow = "inset 0 0 0 1px rgba(96,165,250,0.15)";
        const fileObj = (_b2 = (_a2 = e.dataTransfer) == null ? void 0 : _a2.files) == null ? void 0 : _b2[0];
        if (!fileObj) return;
        dropZone.innerHTML = busyHtml;
        try {
          await saveLedgerAttachmentForRow(r, fileObj);
        } catch (err) {
          if ((err == null ? void 0 : err.message) === "bad_type") alert("\u4EC5\u652F\u6301 JPG\u3001PNG \u6216 PDF \u6587\u4EF6");
          else if ((err == null ? void 0 : err.message) === "not_editable") alert("\u5F53\u524D\u672C\u5730\u6D4B\u8BD5\u73AF\u5883\u4E0B\uFF0C\u8FD9\u6761\u8BB0\u5F55\u9700\u8981\u4E0A\u7EBF\u540E\u624D\u80FD\u8865\u4F20\u9644\u4EF6");
          else alert("\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
          dropZone.innerHTML = idleHtml;
        }
      });
      tdFile.appendChild(filePicker);
      tdFile.appendChild(dropZone);
    } else {
      tdFile.textContent = r.file ? r.file : "-";
    }
    tr.appendChild(tdFile);
    tr.appendChild(makeStackTd(r.createdBy || "-", `\u786E\u8BA4\uFF1A${r.confirmedBy || (r.confirmed === false ? "\u672A\u786E\u8BA4" : r.createdBy || "-")}`));
    tr.appendChild(makeClampTd(r.notes || "", { clickable: true, onClick: openLedgerNotesModal }));
    const uploadDate = r.dateTime ? formatDisplayDate(r.dateTime.split(" ")[0]) : r.createdAt ? formatDisplayDate(Number(r.createdAt)) : "";
    tr.appendChild(makeTd(uploadDate));
    const tdOps = document.createElement("td");
    tdOps.style.textAlign = "center";
    if (canUpdate || canDelete || canConfirm) {
      const opsWrap = document.createElement("div");
      opsWrap.style.display = "inline-flex";
      opsWrap.style.alignItems = "center";
      opsWrap.style.justifyContent = "center";
      opsWrap.style.gap = "8px";
      if (canUpdate) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.textContent = "\u4FEE\u6539";
        editBtn.className = "btn-sm btn-outline-blue";
        editBtn.addEventListener("click", (e) => {
          e.preventDefault();
          setLedgerEdit(r);
        });
        opsWrap.appendChild(editBtn);
      }
      if (canConfirm) {
        const okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.textContent = "\u786E\u8BA4";
        okBtn.className = "btn-sm btn-outline-green";
        okBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          try {
            await apiFetchJSON("/api/ledger/" + String(r.id) + "/confirm", { method: "PUT" });
            clearLedgerEdit();
            loadLedgerFromServer(true);
            loadPayablesFromServer();
            apiAccountsList().then(() => {
              refreshAccountOptions();
              renderAccounts();
            });
          } catch (e2) {
          }
        });
        opsWrap.appendChild(okBtn);
      }
      if (canDelete) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.textContent = "\u5220\u9664";
        delBtn.className = "btn-sm btn-outline-red";
        delBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          openConfirm("\u786E\u5B9A\u8981\u5F7B\u5E95\u5220\u9664\u8FD9\u6761\u8BB0\u5F55\u5417\uFF1F\u5220\u9664\u540E\u76F8\u5173\u7684\u7EDF\u8BA1\u5C06\u88AB\u62B9\u9664\u4E14\u4E0D\u53EF\u6062\u590D\u3002", async () => {
            var _a2;
            try {
              await apiFetchJSON("/api/ledger/" + String(r.id), { method: "DELETE" });
              loadLedgerFromServer(true);
              if (((_a2 = document.getElementById("page-home")) == null ? void 0 : _a2.style.display) === "block") {
                renderHomeChart((homePeriodSel == null ? void 0 : homePeriodSel.value) || "month");
                renderSalesChart((salesPeriodSel == null ? void 0 : salesPeriodSel.value) || "month");
              }
            } catch (err) {
              console.error(err);
              alert("\u5220\u9664\u5931\u8D25");
            }
          });
        });
        opsWrap.appendChild(delBtn);
      }
      tdOps.appendChild(opsWrap);
    }
    tr.appendChild(tdOps);
    if (r.type === "\u6536\u5165") tr.classList.add("row-income");
    if (r.type === "\u5F00\u652F" || r.type === "\u652F\u51FA") tr.classList.add("row-expense");
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
    String(value != null ? value : "").trim(),
    String(num),
    num.toFixed(2)
  ].filter(Boolean))).map((x) => x.toLocaleLowerCase());
}
function applyFilters(preserveScroll = false) {
  const { t, key, s, e } = getFilters();
  const outAll = records.filter((r) => {
    if (t !== "all" && r.type !== t) return false;
    if (ledgerHdrType !== "all") {
      if (ledgerHdrType === "\u5F00\u652F") {
        if (!(r.type === "\u5F00\u652F" || r.type === "\u652F\u51FA")) return false;
      } else if (r.type !== ledgerHdrType) return false;
    }
    if (ledgerHdrCat && r.category !== ledgerHdrCat) return false;
    if (ledgerHdrOwner) {
      const owner = clientOwner(r.client || "");
      if (owner !== ledgerHdrOwner) return false;
    }
    if (ledgerHdrMethod && (r.method || "") !== ledgerHdrMethod) return false;
    if (ledgerHdrConfirm === "confirmed" && r.confirmed === false) return false;
    if (ledgerHdrConfirm === "unconfirmed" && r.confirmed !== false) return false;
    if (key) {
      const client = (r.client || "").toLocaleLowerCase();
      const notes = (r.notes || "").toLocaleLowerCase();
      const amountTexts = buildAmountSearchTexts(r.amount);
      if (!(client.includes(key) || notes.includes(key) || amountTexts.some((v) => v.includes(key)))) return false;
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
  outAll.sort((a, b) => ts(b) - ts(a));
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
  const gp = document.getElementById("global-pager");
  if (gp) gp.style.display = "flex";
  if (ledgerPager) {
    ledgerPager.innerHTML = "";
    ledgerPager.style.display = "flex";
    const makeBtn = (label, page, disabled = false, active = false) => {
      const b = document.createElement("a");
      b.href = "#";
      b.textContent = label;
      b.style.padding = "4px 8px";
      b.style.border = "1px solid #334155";
      b.style.borderRadius = "4px";
      b.style.color = active ? "#000" : "#cbd5e1";
      b.style.background = active ? "#cbd5e1" : "transparent";
      b.style.pointerEvents = disabled ? "none" : "auto";
      b.style.opacity = disabled ? "0.4" : "1";
      b.addEventListener("click", (e2) => {
        e2.preventDefault();
        ledgerPage = page;
        applyFilters();
      });
      ledgerPager.appendChild(b);
    };
    makeBtn("\xAB", Math.max(1, ledgerPage - 1), ledgerPage <= 1);
    const maxButtons = 9;
    let start = Math.max(1, ledgerPage - Math.floor(maxButtons / 2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    for (let p = start; p <= end; p++) makeBtn(String(p), p, false, p === ledgerPage);
    makeBtn("\xBB", Math.min(totalPages, ledgerPage + 1), ledgerPage >= totalPages);
  }
  const infoEl = document.getElementById("pay-footer-info");
  if (infoEl) {
    const totalCount = (records || []).length;
    const todayStr = (() => {
      const d = /* @__PURE__ */ new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    })();
    const toTs = (r) => r.createdAt || (r.dateTime ? Date.parse(r.dateTime) : 0) || (r.date ? Date.parse(r.date) : 0) || 0;
    const todayCount = (records || []).filter((r) => {
      const t2 = toTs(r);
      if (!t2) return false;
      const d = new Date(t2);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}` === todayStr;
    }).length;
    const latestTs = Math.max(0, ...(records || []).map(toTs));
    const latestCount = latestTs ? (records || []).filter((r) => toTs(r) === latestTs).length : 0;
    const mk = (text) => {
      const s2 = document.createElement("span");
      s2.className = "info-pill";
      s2.textContent = text;
      return s2;
    };
    infoEl.innerHTML = "";
    infoEl.appendChild(mk(`\u5171 ${totalCount} \u6761\u8BB0\u5F55`));
    infoEl.appendChild(mk(`\u4ECA\u65E5\u4E0A\u4F20 ${todayCount} \u6761`));
    infoEl.appendChild(mk(`\u6700\u540E\u6B21\u4E0A\u4F20 ${latestCount || 1} \u6761`));
  }
}
filterKey.addEventListener("input", applyFilters);
filterType.addEventListener("change", () => {
  ledgerPage = 1;
  applyFilters();
});
filterStart.addEventListener("change", () => {
  ledgerPage = 1;
  applyFilters();
});
filterEnd.addEventListener("change", () => {
  ledgerPage = 1;
  applyFilters();
});
(_a = document.getElementById("system-clear-ledger")) == null ? void 0 : _a.addEventListener("click", async () => {
  if (!confirm("\u786E\u8BA4\u6E05\u7A7A\u6536\u652F\u8BB0\u8D26\u7684\u6240\u6709\u6570\u636E\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002")) return;
  try {
    await apiFetchJSON("/api/ledger", { method: "DELETE" });
    records.splice(0, records.length);
    saveJSON("records", records);
    loadLedgerFromServer();
    loadPayablesFromServer();
    apiAccountsList().then(() => {
      refreshAccountOptions();
      renderAccounts();
    });
    renderContacts();
  } catch (e) {
  }
});
(_b = document.getElementById("system-clear-pay")) == null ? void 0 : _b.addEventListener("click", async () => {
  if (!confirm("\u786E\u5B9A\u6E05\u7A7A\u5E94\u6536/\u5E94\u4ED8\u6240\u6709\u8BB0\u5F55\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D")) return;
  try {
    await apiFetchJSON("/api/payables", { method: "DELETE" });
    payRecords.splice(0, payRecords.length);
    saveJSON("payRecords", payRecords);
    payPage = 1;
    loadPayablesFromServer();
    renderContacts();
  } catch (e) {
  }
});
document.getElementById("entry-form").addEventListener("submit", async (e) => {
  var _a2, _b2, _c2, _d;
  e.preventDefault();
  [document.getElementById("entry-doc"), entryClient, entryAmount, entryMethod].forEach((el) => el == null ? void 0 : el.classList.remove("invalid"));
  const u = getAuthUser();
  const roleName = (u == null ? void 0 : u.role) || "";
  if (roleName !== "\u8D85\u7EA7\u7BA1\u7406\u5458") {
    const role = rolesData.find((r) => r.name === roleName);
    const allowed = !!(role && role.perms && role.perms.ledger && role.perms.ledger.view);
    if (!allowed) {
      alert("\u5F53\u524D\u89D2\u8272\u65E0\u201C\u6536\u652F\u8BB0\u8D26\u201D\u6743\u9650");
      return;
    }
  }
  const type = entryType.value;
  const category = entryCategory.value;
  const doc = normalizeLedgerDocList(ledgerSelectedDocs.length ? ledgerSelectedDocs : (((_a2 = document.getElementById("entry-doc")) == null ? void 0 : _a2.value) || "")).join(", ");
  const clientVal = (entryClient.value || "").trim();
  const amountStr = (entryAmount.value || "").trim();
  const method = entryMethod.value;
  if (!type || !category) return;
  const invalidEls = [];
  if (!doc) invalidEls.push(document.getElementById("entry-doc"));
  if (!clientVal) invalidEls.push(entryClient);
  if (!amountStr) invalidEls.push(entryAmount);
  if (!method) invalidEls.push(entryMethod);
  if (invalidEls.length) {
    invalidEls.forEach((el) => {
      if (!el) return;
      el.classList.add("invalid");
      const clear = () => el.classList.remove("invalid");
      el.addEventListener("input", clear, { once: true });
      el.addEventListener("change", clear, { once: true });
    });
    (_b2 = invalidEls[0]) == null ? void 0 : _b2.focus();
    return;
  }
  const amount = parseFloat(amountStr || "0");
  const fileObj = entryFile.files[0] || null;
  const now = /* @__PURE__ */ new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dateTime = `${date} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  let fileUrl = "";
  if (fileObj) {
    try {
      fileUrl = await uploadLedgerAttachment(fileObj);
    } catch (e2) {
      if ((e2 == null ? void 0 : e2.message) === "bad_type") {
        alert("\u5355\u6761\u8BB0\u5F55\u4EC5\u652F\u6301 JPG/PNG \u6216 PDF \u6587\u4EF6");
        return;
      }
      console.warn("upload failed", e2);
    }
  }
  try {
    if (ledgerEditingId) {
      const finalFile = fileUrl || ledgerEditingFile;
      const finalDate = ledgerEditingDate || date;
      const finalDateTime = ledgerEditingDateTime || dateTime;
      await apiFetchJSON("/api/ledger/" + String(ledgerEditingId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, category, doc, client: clientVal, amount, method, skipAccountBalance: entrySkipAccountBalance?.checked === true, file: finalFile, notes: entryNotes.value.trim(), date: finalDate, dateTime: finalDateTime, createdBy: ledgerEditingCreatedBy })
      });
      clearLedgerEdit();
    } else {
      await apiFetchJSON("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, category, doc, client: clientVal, amount, method, skipAccountBalance: entrySkipAccountBalance?.checked === true, file: fileUrl, notes: entryNotes.value.trim(), date, dateTime, createdBy: ((_c2 = getAuthUser()) == null ? void 0 : _c2.name) || "", confirmed: false })
      });
    }
  } catch (e2) {
  }
  await Promise.all([
    loadLedgerFromServer(true),
    loadPayablesFromServer(),
    apiAccountsList()
  ]);
  refreshAccountOptions();
  if (location.hash === "#accounts" && typeof renderAccounts === "function") renderAccounts();
  document.getElementById("entry-doc").value = "";
  ledgerSelectedDocs = [];
  entryClient.value = "";
  entryAmount.value = "";
  if (entrySkipAccountBalance) entrySkipAccountBalance.checked = false;
  updateLedgerMatchedOrderTotal();
  entryMethod.value = "";
  entryFile.value = "";
  entryNotes.value = "";
  [document.getElementById("entry-doc"), entryClient, entryAmount, entryMethod].forEach((el) => el == null ? void 0 : el.classList.remove("invalid"));
  saveJSON("records", records.map((r) => {
    const { fileUrl: fileUrl2, ...rest } = r;
    return rest;
  }));
  saveJSON("accountsData", accountsData);
  if (((_d = document.getElementById("page-home")) == null ? void 0 : _d.style.display) === "block") {
    renderHomeChart((homePeriodSel == null ? void 0 : homePeriodSel.value) || "month");
    renderSalesChart((salesPeriodSel == null ? void 0 : salesPeriodSel.value) || "month");
  }
});
const payRows = document.getElementById("pay-rows");
const payType = document.getElementById("pay-type");
const payPartner = document.getElementById("pay-partner");
const partnerAdd = document.getElementById("partner-add");
const payDoc = document.getElementById("pay-doc");
const paySales = document.getElementById("pay-sales");
const payAmount = document.getElementById("pay-amount");
const payTrust = document.getElementById("pay-trust");
const payNotes = document.getElementById("pay-notes");
const payForm = document.getElementById("pay-form");
const paySubmitBtn = payForm == null ? void 0 : payForm.querySelector('button[type="submit"]');
const payFormTitle = document.getElementById("pay-form-title");
const payTypeLabel = document.getElementById("pay-type-label");
const payTypeRecvBtn = document.getElementById("pay-type-recv-btn");
const payTypePayBtn = document.getElementById("pay-type-pay-btn");
const payImportLabel = document.getElementById("pay-import-label");
const payImportModalTitle = document.getElementById("pay-import-modal-title");
function syncPayablesLocale() {
  const isEs = getCurrentAppLocale() === "es-ES";
  if (payFormTitle) payFormTitle.textContent = isEs ? "Registro de cuentas por cobrar/pagar" : "\u5E94\u6536 / \u5E94\u4ED8\u5F55\u5165";
  if (payTypeLabel) payTypeLabel.textContent = isEs ? "Cobrar Y Pagar" : "\u5E94\u6536\u5E94\u4ED8";
  if (payTypeRecvBtn) payTypeRecvBtn.textContent = isEs ? "Cobrar" : "\u5E94\u6536\u8D26\u6B3E";
  if (payTypePayBtn) payTypePayBtn.textContent = isEs ? "Pagar" : "\u5E94\u4ED8\u8D26\u6B3E";
  if (payImportLabel) payImportLabel.textContent = isEs ? "Importaci\u00F3n por lotes" : "\u6279\u91CF\u5BFC\u5165";
  if (payImportModalTitle) payImportModalTitle.textContent = isEs ? "Importaci\u00F3n por lotes" : "\u6279\u91CF\u5BFC\u5165\u9884\u89C8";
  const payLabelDoc = document.getElementById("pay-label-doc");
  if (payLabelDoc) payLabelDoc.textContent = isEs ? "* N\u00FAmero de documento" : "* \u5355\u636E / \u51ED\u8BC1\u53F7";
  if (payDoc) payDoc.placeholder = isEs ? "N\u00FAmero de documento" : "\u5355\u636E / \u51ED\u8BC1\u53F7";
}
function payDocExists(doc, recType, excludeId) {
  const d = String(doc || "").trim();
  if (!d) return false;
  return payRecords.some((r) => String(r.doc || "").trim() === d && r.type === recType && (!excludeId || r.id !== excludeId));
}
function setPayDocInvalid(flag) {
  if (!payDoc) return;
  payDoc.style.color = flag ? "var(--red)" : "";
  const lbl = document.getElementById("pay-label-doc");
  if (lbl) {
    if (flag) lbl.classList.add("invalid-label");
    else lbl.classList.remove("invalid-label");
  }
}
function validatePayDoc(showAlert) {
  const type = (payType == null ? void 0 : payType.value) || "";
  const doc = ((payDoc == null ? void 0 : payDoc.value) || "").trim();
  if (!type || !doc) {
    setPayDocInvalid(false);
    return;
  }
  const exists = payDocExists(doc, type, payEditingId);
  setPayDocInvalid(exists);
  if (exists && showAlert) alert("\u51ED\u8BC1\u53F7\u5DF2\u5B58\u5728");
}
payDoc == null ? void 0 : payDoc.addEventListener("input", () => validatePayDoc(false));
payDoc == null ? void 0 : payDoc.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    validatePayDoc(true);
    if (payDoc.style.color) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
});
payType == null ? void 0 : payType.addEventListener("change", () => validatePayDoc(false));
const payImportFile = document.getElementById("pay-import-file");
payImportFile == null ? void 0 : payImportFile.addEventListener("click", () => {
  try {
    payImportFile.value = "";
  } catch (e) {
  }
});
const payImportHint = document.getElementById("pay-import-hint");
const payImportModal = document.getElementById("pay-import-modal");
const payImportRows = document.getElementById("pay-import-rows");
const payImportSummary = document.getElementById("pay-import-summary");
const payImportCancel = document.getElementById("pay-import-cancel");
const payImportCommit = document.getElementById("pay-import-commit");
const sumRecvEl = document.getElementById("sum-recv");
const sumPayEl = document.getElementById("sum-pay");
syncPayablesLocale();
const payFilterKey = document.getElementById("pay-filter-key");
const payExportBtn = document.getElementById("pay-export");
const payClearBtn = document.getElementById("pay-clear");
const PAY_IMPORT_HINT_DEFAULT = "\u56FE\u7247/PDF\u4F5C\u4E3A\u5355\u6761\u9644\u4EF6\uFF0CExcel/CSV\u4F5C\u4E3A\u6279\u91CF\u5BFC\u5165";
function setPayImportHintText(text) {
  if (payImportHint) payImportHint.textContent = text || PAY_IMPORT_HINT_DEFAULT;
}
function isPayablesAttachmentFile(fileObj) {
  if (!fileObj) return false;
  const fileName = String(fileObj.name || "").trim().toLowerCase();
  const mimeType = String(fileObj.type || "").trim().toLowerCase();
  const extOk = [".jpg", ".jpeg", ".png", ".pdf"].some((ext) => fileName.endsWith(ext));
  const mimeOk = ["image/jpeg", "image/jpg", "image/png", "application/pdf"].includes(mimeType);
  return extOk || mimeOk;
}
function isPayablesImportSheet(fileObj) {
  const fileName = String((fileObj == null ? void 0 : fileObj.name) || "").trim().toLowerCase();
  return [".csv", ".xls", ".xlsx"].some((ext) => fileName.endsWith(ext));
}
let paySubmitLock = false;
let payLastPageData = [];
const payPager = document.getElementById("global-pager-controls") || document.getElementById("pay-pager");
const payFooterInfo = document.getElementById("pay-footer-info");
const payTableWrap = document.getElementById("pay-table-wrap");
const thType = document.getElementById("th-type");
const thTypeDD = document.getElementById("th-type-dd");
const thTypeList = document.getElementById("th-type-list");
const thTypeLabel = document.getElementById("th-type-label");
const thPartner = document.getElementById("th-partner");
const thPartnerDD = document.getElementById("th-partner-dd");
const thPartnerList = document.getElementById("th-partner-list");
const thPartnerLabel = document.getElementById("th-partner-label");
const thSales = document.getElementById("th-sales");
const thSalesDD = document.getElementById("th-sales-dd");
const thSalesList = document.getElementById("th-sales-list");
const thSalesLabel = document.getElementById("th-sales-label");
const thArrears = document.getElementById("th-arrears");
const thArrearsDD = document.getElementById("th-arrears-dd");
const thArrearsList = document.getElementById("th-arrears-list");
const thArrearsLabel = document.getElementById("th-arrears-label");
const thTrust = document.getElementById("th-trust");
const thTrustDD = document.getElementById("th-trust-dd");
const thTrustList = document.getElementById("th-trust-list");
const thTrustLabel = document.getElementById("th-trust-label");
const thAction = document.getElementById("th-action");
const thActionDD = document.getElementById("th-action-dd");
const thActionList = document.getElementById("th-action-list");
const thActionLabel = document.getElementById("th-action-label");
let payFilterPartnerName = "";
let payFilterSalesName = "";
let payFilterStatus = "all";
let payFilterType = "all";
let payFilterOverdue = "all";
let payFilterAction = "all";
let payPage = 1;
const payPageSize = 100;
function setLabel(el, text, active) {
  if (!el) return;
  el.textContent = text + " \u25BE";
  el.style.color = active ? "#ef4444" : "";
}
function isPayableOverdueRecord(r) {
  var _a2;
  const trustDaysVal = (_a2 = r == null ? void 0 : r.trustDays) != null ? _a2 : null;
  if ((r == null ? void 0 : r.settled) || trustDaysVal == null || trustDaysVal <= 0) return false;
  const start = new Date(r.date);
  const now = /* @__PURE__ */ new Date();
  const diffDays = Math.floor((now - start) / (1e3 * 60 * 60 * 24));
  return diffDays - trustDaysVal > 0;
}
function isSpecialPayableRecord(r) {
  return ["逃单", "作废"].includes(String(r?.specialStatus || r?.special_status || "").trim());
}
function getFilteredPayableRecords(options = {}) {
  const ignore = new Set(Array.isArray(options.ignore) ? options.ignore : []);
  const key = ((payFilterKey == null ? void 0 : payFilterKey.value) || "").trim();
  const keyLower = key.toLocaleLowerCase();
  let listAll = payRecords.filter((r) => {
    if (!key || ignore.has("key")) return true;
    const amountTexts = buildAmountSearchTexts(r.amount);
    return [r.partner || "", r.doc || "", r.notes || ""].some((v) => String(v || "").toLocaleLowerCase().includes(keyLower)) || amountTexts.some((v) => v.includes(keyLower));
  });
  if (!ignore.has("type") && payFilterType !== "all") {
    listAll = listAll.filter((r) => payFilterType === "recv" ? /应收/.test(r.type) : /应付/.test(r.type));
  }
  if (!ignore.has("partner") && payFilterPartnerName) {
    listAll = listAll.filter((r) => (r.partner || "") === payFilterPartnerName);
  }
  if (!ignore.has("sales") && payFilterSalesName) {
    listAll = listAll.filter((r) => {
      if (payFilterSalesName === "__none__") return !r.sales;
      return (r.sales || "") === payFilterSalesName;
    });
  }
  if (!ignore.has("overdue") && payFilterOverdue !== "all") {
    listAll = listAll.filter((r) => payFilterOverdue === "overdue" ? isPayableOverdueRecord(r) : !isPayableOverdueRecord(r));
  }
  if (!ignore.has("status") && payFilterStatus !== "all") {
    listAll = listAll.filter((r) => {
      const arrears = isSpecialPayableRecord(r) ? 0 : Math.max(0, (r.amount || 0) - (r.paid || 0));
      if (payFilterStatus === "arrears") return arrears > 0;
      if (payFilterStatus === "done") return arrears === 0;
      return true;
    });
  }
  if (!ignore.has("action") && payFilterAction !== "all") {
    listAll = listAll.filter((r) => {
      if (payFilterAction === "confirmed") return r.confirmed !== false;
      if (payFilterAction === "unconfirmed") return r.confirmed === false;
      return true;
    });
  }
  return listAll;
}
function hasActivePayableFilters() {
  return !!(String((payFilterKey == null ? void 0 : payFilterKey.value) || "").trim() || payFilterType !== "all" || payFilterPartnerName || payFilterSalesName || payFilterOverdue !== "all" || payFilterStatus !== "all" || payFilterAction !== "all");
}
function openTypeFilter() {
  thTypeDD.style.display = "block";
  thTypeList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      payFilterType = val;
      thTypeDD.style.display = "none";
      setLabel(thTypeLabel, val === "all" ? "\u6B3E\u9879\u7C7B\u578B" : "\u5E94" + (val === "recv" ? "\u6536" : "\u4ED8"), val !== "all");
      payPage = 1;
      renderPayables();
    });
    thTypeList.appendChild(row);
  };
  const sourceList = getFilteredPayableRecords({ ignore: ["type"] });
  addItem("\u5168\u90E8", "all");
  if (sourceList.some((r) => /应收/.test(r.type))) addItem("\u5E94\u6536", "recv");
  if (sourceList.some((r) => /应付/.test(r.type))) addItem("\u5E94\u4ED8", "pay");
}
function openSalesFilter() {
  thSalesDD.style.display = "block";
  thSalesList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      payFilterSalesName = val;
      thSalesDD.style.display = "none";
      setLabel(thSalesLabel, val ? val === "__none__" ? "\u65E0\u4E1A\u52A1\u5458" : val : "\u4E1A\u52A1\u5458", !!val);
      payPage = 1;
      renderPayables();
    });
    thSalesList.appendChild(row);
  };
  const sourceList = getFilteredPayableRecords({ ignore: ["sales"] });
  addItem("\u5168\u90E8", "");
  if (sourceList.some((r) => !r.sales)) addItem("\u65E0\u4E1A\u52A1\u5458", "__none__");
  Array.from(new Set(sourceList.map((r) => String(r.sales || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).forEach((name) => addItem(name, name));
}
function openPartnerFilter() {
  thPartnerDD.style.display = "block";
  thPartnerList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      payFilterPartnerName = val;
      thPartnerDD.style.display = "none";
      setLabel(thPartnerLabel, val || "\u5F80\u6765\u5355\u4F4D", !!val);
      payPage = 1;
      renderPayables();
    });
    thPartnerList.appendChild(row);
  };
  const sourceList = getFilteredPayableRecords({ ignore: ["partner"] });
  addItem("\u5168\u90E8", "");
  [...new Set(sourceList.map((r) => String(r.partner || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).forEach((name) => addItem(name, name));
}
function openArrearsFilter() {
  thArrearsDD.style.display = "block";
  thArrearsList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      payFilterStatus = val;
      thArrearsDD.style.display = "none";
      setLabel(thArrearsLabel, val === "all" ? "\u6B20\u6B3E" : val === "arrears" ? "\u6B20\u6B3E\u8BA2\u5355" : "\u8BA2\u5355\u5B8C\u6210", val !== "all");
      payPage = 1;
      renderPayables();
    });
    thArrearsList.appendChild(row);
  };
  const sourceList = getFilteredPayableRecords({ ignore: ["status"] });
  addItem("\u5168\u90E8\u8BA2\u5355", "all");
  if (sourceList.some((r) => !isSpecialPayableRecord(r) && Math.max(0, (r.amount || 0) - (r.paid || 0)) > 0)) addItem("\u6B20\u6B3E\u8BA2\u5355", "arrears");
  if (sourceList.some((r) => isSpecialPayableRecord(r) || Math.max(0, (r.amount || 0) - (r.paid || 0)) === 0)) addItem("\u8BA2\u5355\u5B8C\u6210", "done");
}
function openTrustFilter() {
  thTrustDD.style.display = "block";
  thTrustList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      payFilterOverdue = val;
      thTrustDD.style.display = "none";
      setLabel(thTrustLabel, val === "all" ? "\u4FE1\u4EFB\u5929\u6570" : val === "overdue" ? "\u5DF2\u903E\u671F" : "\u672A\u903E\u671F", val !== "all");
      payPage = 1;
      renderPayables();
    });
    thTrustList.appendChild(row);
  };
  const sourceList = getFilteredPayableRecords({ ignore: ["overdue"] });
  addItem("\u5168\u90E8", "all");
  if (sourceList.some((r) => isPayableOverdueRecord(r))) addItem("\u5DF2\u903E\u671F", "overdue");
  if (sourceList.some((r) => !isPayableOverdueRecord(r))) addItem("\u672A\u903E\u671F", "not");
}
function openActionFilter() {
  thActionDD.style.display = "block";
  thActionList.innerHTML = "";
  const addItem = (label, val) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    row.textContent = label;
    row.addEventListener("click", () => {
      payFilterAction = val;
      thActionDD.style.display = "none";
      setLabel(thActionLabel, val === "all" ? "\u64CD\u4F5C" : val === "confirmed" ? "\u5DF2\u786E\u8BA4" : "\u672A\u786E\u8BA4", val !== "all");
      payPage = 1;
      renderPayables();
    });
    thActionList.appendChild(row);
  };
  const sourceList = getFilteredPayableRecords({ ignore: ["action"] });
  addItem("\u5168\u90E8", "all");
  if (sourceList.some((r) => r.confirmed !== false)) addItem("\u5DF2\u786E\u8BA4", "confirmed");
  if (sourceList.some((r) => r.confirmed === false)) addItem("\u672A\u786E\u8BA4", "unconfirmed");
}
thType == null ? void 0 : thType.addEventListener("click", (e) => {
  e.stopPropagation();
  openTypeFilter();
});
thPartner == null ? void 0 : thPartner.addEventListener("click", (e) => {
  e.stopPropagation();
  openPartnerFilter();
});
thSales == null ? void 0 : thSales.addEventListener("click", (e) => {
  e.stopPropagation();
  openSalesFilter();
});
thArrears == null ? void 0 : thArrears.addEventListener("click", (e) => {
  e.stopPropagation();
  openArrearsFilter();
});
thTrust == null ? void 0 : thTrust.addEventListener("click", (e) => {
  e.stopPropagation();
  openTrustFilter();
});
thAction == null ? void 0 : thAction.addEventListener("click", (e) => {
  e.stopPropagation();
  openActionFilter();
});
const typeSwitch = document.getElementById("type-switch");
const typeItems = typeSwitch ? typeSwitch.querySelectorAll(".type-item") : [];
function setPayType(val) {
  payType.value = val;
  typeItems.forEach((btn) => {
    const is = btn.getAttribute("data-type") === val;
    btn.classList.toggle("active", is);
    btn.classList.toggle("recv", is && val === "\u5E94\u6536\u8D26\u6B3E");
    btn.classList.toggle("pay", is && val === "\u5E94\u4ED8\u8D26\u6B3E");
  });
}
typeItems.forEach((btn) => {
  btn.addEventListener("click", () => setPayType(btn.getAttribute("data-type")));
});
setPayType("\u5E94\u6536\u8D26\u6B3E");
const payWrap = document.getElementById("pay-wrap");
const payDD = document.getElementById("pay-dd");
const paySearch = document.getElementById("pay-search");
const payList = document.getElementById("pay-list");
partnerAdd == null ? void 0 : partnerAdd.addEventListener("click", () => {
  const name = payPartner.value.trim();
  if (!name) return;
  if (!partners.includes(name)) partners.push(name);
});
function renderPayDropdown() {
  const q = ((paySearch == null ? void 0 : paySearch.value) || payPartner.value || "").trim().toLowerCase();
  const data = allContacts().filter((x) => {
    if (!q) return true;
    return [x.name, x.company, x.contact, x.phone, x.city, x.remark || ""].some((v) => String(v || "").toLowerCase().includes(q));
  });
  payList.innerHTML = "";
  data.forEach((item) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    const left = document.createElement("div");
    left.textContent = item.name;
    const right = document.createElement("div");
    right.style.color = "#94a3b8";
    right.textContent = `${item.contact || ""} ${item.phone || ""} ${item.city || ""}`.trim();
    row.append(left, right);
    row.addEventListener("click", () => {
      var _a2;
      payPartner.value = item.name;
      if (paySales) {
        const bound = (item.sales || "").trim();
        paySales.value = bound && [...paySales.options].some((o) => o.value === bound) ? bound : "";
      }
      payDD.style.display = "none";
      (_a2 = document.getElementById("pay-label-partner")) == null ? void 0 : _a2.classList.remove("invalid-label");
    });
    payList.appendChild(row);
  });
}
function openPayDropdown() {
  var _a2;
  const card = ((_a2 = document.getElementById("pay-form")) == null ? void 0 : _a2.closest(".card")) || document.querySelector("#page-payables .row .card:nth-child(2)");
  const cr = card == null ? void 0 : card.getBoundingClientRect();
  const ddHead = payDD.querySelector(".dd-head");
  if (ddHead) ddHead.style.display = "block";
  payDD.style.display = "block";
  payDD.style.position = "fixed";
  if (cr) {
    const gap = 16;
    payDD.style.left = `${Math.max(0, cr.left - cr.width - gap)}px`;
    payDD.style.top = `${cr.top}px`;
    payDD.style.width = `${cr.width}px`;
    payDD.style.height = `${cr.height}px`;
    const head = payDD.querySelector(".dd-head");
    const list = payDD.querySelector(".dd-list");
    const headH = head ? head.getBoundingClientRect().height : 48;
    if (list) {
      list.style.maxHeight = `${cr.height - headH - 24}px`;
      list.style.overflow = "auto";
    }
  }
  payDD.style.zIndex = "90";
  renderPayDropdown();
}
payPartner.addEventListener("focus", openPayDropdown);
payPartner.addEventListener("click", openPayDropdown);
payPartner.addEventListener("input", renderPayDropdown);
payPartner.addEventListener("input", () => {
  var _a2;
  if ((payPartner.value || "").trim()) (_a2 = document.getElementById("pay-label-partner")) == null ? void 0 : _a2.classList.remove("invalid-label");
});
paySearch == null ? void 0 : paySearch.addEventListener("input", renderPayDropdown);
document.addEventListener("click", (e) => {
  if (!(payWrap == null ? void 0 : payWrap.contains(e.target)) && !(payDD == null ? void 0 : payDD.contains(e.target))) payDD.style.display = "none";
  if (!(thType == null ? void 0 : thType.contains(e.target))) thTypeDD.style.display = "none";
  if (!(thPartner == null ? void 0 : thPartner.contains(e.target))) thPartnerDD.style.display = "none";
  if (!(thSales == null ? void 0 : thSales.contains(e.target))) thSalesDD.style.display = "none";
  if (!(thArrears == null ? void 0 : thArrears.contains(e.target))) thArrearsDD.style.display = "none";
  if (!(thTrust == null ? void 0 : thTrust.contains(e.target))) thTrustDD.style.display = "none";
  if (!(thAction == null ? void 0 : thAction.contains(e.target))) thActionDD.style.display = "none";
  if (!(ldType == null ? void 0 : ldType.contains(e.target))) ldTypeDD.style.display = "none";
  if (!(ldCat == null ? void 0 : ldCat.contains(e.target))) ldCatDD.style.display = "none";
  if (!(ldOwner == null ? void 0 : ldOwner.contains(e.target))) ldOwnerDD.style.display = "none";
  if (!(ldMethod == null ? void 0 : ldMethod.contains(e.target))) ldMethodDD.style.display = "none";
  if (!(ldConfirm == null ? void 0 : ldConfirm.contains(e.target))) ldConfirmDD.style.display = "none";
});
const payHistoryModal = document.getElementById("pay-history-modal");
const payHistoryHead = document.getElementById("pay-history-head");
const payHistoryList = document.getElementById("pay-history-list");
const payHistoryClose = document.getElementById("pay-history-close");
const payHistoryNotesText = document.getElementById("pay-history-notes-text");
const payHistoryNotesInput = document.getElementById("pay-history-notes-input");
const payHistoryNotesAdd = document.getElementById("pay-history-notes-add");
const payHistoryAttachment = document.getElementById("pay-history-attachment");
const payHistoryAttachmentContent = document.getElementById("pay-history-attachment-content");
let payHistoryCurrentRec = null;
function renderPayHistoryAttachment(rec) {
  if (!payHistoryAttachment || !payHistoryAttachmentContent) return;
  const fileUrl = rec.fileUrl || rec.file || "";
  const fileName = rec.fileName || rec.file || "\u67E5\u770B\u9644\u4EF6";
  payHistoryAttachment.style.display = "block";
  payHistoryAttachmentContent.innerHTML = "";
  if (fileUrl) {
    const lowerName = String(fileName).toLowerCase();
    if (/\.pdf($|[?#])/i.test(lowerName)) {
      const pdfBtn = document.createElement("div");
      pdfBtn.className = "thumb-pdf";
      pdfBtn.textContent = `PDF: ${String(fileName).split("/").pop()}`;
      pdfBtn.style.display = "inline-block";
      pdfBtn.style.maxWidth = "100%";
      pdfBtn.title = "\u70B9\u51FB\u67E5\u770B\u9644\u4EF6";
      pdfBtn.addEventListener("click", () => openUploadedFile(fileUrl, fileName));
      payHistoryAttachmentContent.appendChild(pdfBtn);
    } else {
      const img = document.createElement("img");
      img.src = fileUrl;
      img.alt = String(fileName).split("/").pop() || "\u9644\u4EF6";
      img.style.maxWidth = "160px";
      img.style.maxHeight = "160px";
      img.style.borderRadius = "8px";
      img.style.border = "1px solid #334155";
      img.style.cursor = "pointer";
      img.addEventListener("click", () => openUploadedFile(fileUrl, fileName));
      payHistoryAttachmentContent.appendChild(img);
    }
    return;
  }
  const empty = document.createElement("div");
  empty.textContent = "\u6682\u65E0\u9644\u4EF6";
  empty.style.color = "#94a3b8";
  payHistoryAttachmentContent.appendChild(empty);
}
function buildPayHistoryRowText(h) {
  const amt = typeof h.amount === "number" ? h.amount.toFixed(2) : h.amount || "";
  return `${formatDisplayDateTimeValue(h.date) || ""}  ${h.user || ""}${h.kind ? "  \u64CD\u4F5C\uFF1A" + h.kind : ""}${amt ? "  \u91D1\u989D\uFF1A" + amt : ""}${h.method ? "  \u65B9\u5F0F\uFF1A" + getAccountDisplayName(h.method) : ""}${h.notes ? "  \u5907\u6CE8\uFF1A" + h.notes : ""}`;
}
function openPayHistory(rec) {
  const latestRec = payRecords.find((x) => (rec == null ? void 0 : rec.id) && x.id === rec.id || (x.doc || "") === ((rec == null ? void 0 : rec.doc) || "") && (x.type || "") === ((rec == null ? void 0 : rec.type) || "")) || rec;
  rec = normalizePayRecordAttachment(latestRec);
  const total = rec.amount || 0;
  const paid = rec.paid || 0;
  const arrears = Math.max(0, total - paid);
  payHistoryHead.innerHTML = `<div>\u5355\u636E\u53F7\uFF1A${rec.doc || ""}\u3000\u5F80\u6765\u5355\u4F4D\uFF1A${rec.partner || ""}\u3000\u91D1\u989D\uFF1A${total.toFixed(2)}\u3000\u5DF2\u4ED8\uFF1A${paid.toFixed(2)}\u3000\u6B20\u6B3E\uFF1A${arrears.toFixed(2)}</div>`;
  renderPayHistoryAttachment(rec);
  payHistoryNotesText.textContent = rec.notes || "";
  if (payHistoryNotesInput) payHistoryNotesInput.value = "";
  payHistoryCurrentRec = rec;
  const hist = Array.isArray(rec.history) ? rec.history.slice() : [];
  if (rec.confirmed === true && rec.confirmedBy && rec.confirmedAt && !hist.some((h) => String((h == null ? void 0 : h.kind) || "") === "\u786E\u8BA4")) {
    hist.push({
      date: rec.confirmedAt,
      user: rec.confirmedBy,
      kind: "\u786E\u8BA4",
      amount: typeof rec.amount === "number" ? rec.amount : Number(rec.amount || 0)
    });
  }
  payHistoryList.innerHTML = "";
  if (!hist.length) {
    const div = document.createElement("div");
    div.textContent = "\u6682\u65E0\u5386\u53F2\u8BB0\u5F55";
    payHistoryList.appendChild(div);
  } else {
    hist.forEach((h) => {
      const row = document.createElement("div");
      row.textContent = buildPayHistoryRowText(h);
      payHistoryList.appendChild(row);
    });
  }
  payHistoryModal.style.display = "flex";
}
payHistoryClose == null ? void 0 : payHistoryClose.addEventListener("click", () => {
  payHistoryModal.style.display = "none";
});
payHistoryNotesAdd == null ? void 0 : payHistoryNotesAdd.addEventListener("click", () => {
  var _a2;
  const rec = payHistoryCurrentRec;
  const text = ((payHistoryNotesInput == null ? void 0 : payHistoryNotesInput.value) || "").trim();
  if (!rec || !text || rec.confirmed === true) return;
  const now = /* @__PURE__ */ new Date();
  const dt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const user = ((_a2 = getAuthUser()) == null ? void 0 : _a2.name) || "";
  rec.history = rec.history || [];
  rec.history.push({ date: dt, user, kind: "\u5907\u6CE8", amount: "", partner: rec.partner, doc: rec.doc, notes: text });
  rec.notes = [rec.notes || "", text].filter(Boolean).join("\n");
  payHistoryNotesText.textContent = rec.notes || "";
  const row = document.createElement("div");
  row.textContent = buildPayHistoryRowText({ date: dt, user, kind: "\u5907\u6CE8", notes: text });
  payHistoryList.appendChild(row);
  if (payHistoryNotesInput) payHistoryNotesInput.value = "";
  renderPayables();
  saveJSON("payRecords", payRecords);
  if (rec.id && rec.confirmed === false) {
    apiFetchJSON("/api/payables/" + String(rec.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) }).then(() => loadPayablesFromServer()).catch(() => {
    });
  }
});
const invoiceModal = document.getElementById("invoice-modal");
const invoiceForm = document.getElementById("invoice-form");
const invoiceNoEl = document.getElementById("invoice-no");
const invoiceDateEl = document.getElementById("invoice-date");
const invoiceAmountEl = document.getElementById("invoice-amount");
const invoiceCancel = document.getElementById("invoice-cancel");
let invoiceCurrentRec = null;
function openInvoiceModal(rec) {
  if (rec.confirmed === true) return;
  invoiceCurrentRec = rec;
  if (invoiceNoEl) invoiceNoEl.value = rec.invoiceNo || "";
  if (invoiceDateEl) invoiceDateEl.value = rec.invoiceDate || "";
  if (invoiceAmountEl) invoiceAmountEl.value = (rec.invoiceAmount || 0) > 0 ? Number(rec.invoiceAmount).toFixed(2) : "";
  if (invoiceModal) invoiceModal.style.display = "flex";
}
invoiceCancel == null ? void 0 : invoiceCancel.addEventListener("click", () => {
  if (invoiceModal) invoiceModal.style.display = "none";
});
invoiceForm == null ? void 0 : invoiceForm.addEventListener("submit", (e) => {
  var _a2;
  e.preventDefault();
  const rec = invoiceCurrentRec;
  if (!rec) return;
  const no = ((invoiceNoEl == null ? void 0 : invoiceNoEl.value) || "").trim();
  const date = (invoiceDateEl == null ? void 0 : invoiceDateEl.value) || "";
  const amt = parseFloat((invoiceAmountEl == null ? void 0 : invoiceAmountEl.value) || "");
  if (!no || !date || !Number.isFinite(amt)) return;
  rec.invoiceNo = no;
  rec.invoiceDate = date;
  rec.invoiceAmount = Math.max(0, amt);
  rec.history = rec.history || [];
  const now = /* @__PURE__ */ new Date();
  const dt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  rec.history.push({ date: dt, user: ((_a2 = getAuthUser()) == null ? void 0 : _a2.name) || "", kind: "\u6539\u4E3A\u53D1\u7968", notes: `\u53D1\u7968\u53F7:${no} \u53D1\u7968\u65E5\u671F:${date} \u53D1\u7968\u91D1\u989D:${rec.invoiceAmount.toFixed(2)}` });
  saveJSON("payRecords", payRecords);
  renderPayables();
  if (rec.id && rec.confirmed === false) {
    apiFetchJSON("/api/payables/" + String(rec.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) }).then(() => loadPayablesFromServer()).catch(() => {
    });
  }
  if (invoiceModal) invoiceModal.style.display = "none";
});
function trustLabelDisplay(rec) {
  if (rec.settled) return { label: "-", overdue: false };
  const dValRaw = rec.trustDays;
  if (dValRaw == null || isNaN(dValRaw)) return { label: "", overdue: false };
  if (dValRaw === 0) return { label: "\u7ACB\u5373", overdue: false };
  const now = /* @__PURE__ */ new Date();
  now.setHours(0, 0, 0, 0);
  let createdDate;
  if (rec.date) {
    createdDate = new Date(rec.date);
  } else if (rec.createdAt) {
    createdDate = new Date(rec.createdAt);
  } else {
    return { label: `${dValRaw}\u5929`, overdue: false };
  }
  createdDate.setHours(0, 0, 0, 0);
  const diffTime = now.getTime() - createdDate.getTime();
  const diffDays = Math.floor(diffTime / (1e3 * 60 * 60 * 24));
  const remainingDays = dValRaw - diffDays;
  if (remainingDays < 0) {
    return { label: `\u903E\u671F ${Math.abs(remainingDays)} \u5929`, overdue: true };
  } else if (remainingDays === 0) {
    return { label: "\u4ECA\u5929\u5230\u671F", overdue: false, isToday: true };
  } else {
    return { label: `\u5269 ${remainingDays} \u5929`, overdue: false };
  }
}
function summarizeNotes(text, perLine, maxLines) {
  const s = String(text || "");
  if (!s) return "";
  const lines = s.split(/\r?\n/);
  const out = [];
  let overflow = false;
  const take = Math.min(maxLines, lines.length);
  for (let i = 0; i < take; i++) {
    const chs = Array.from(lines[i] || "");
    if (chs.length > perLine) {
      out.push(chs.slice(0, perLine).join(""));
      overflow = true;
    } else {
      out.push(lines[i]);
    }
  }
  if (lines.length > maxLines) overflow = true;
  if (overflow && out.length) out[out.length - 1] = out[out.length - 1] + "\u2026";
  return out.join("\n");
}
function setPayEdit(rec) {
  var _a2;
  payEditingId = rec.id || null;
  payEditingFile = rec.file || "";
  payPendingAttachment = null;
  setPayType(rec.type || "\u5E94\u6536\u8D26\u6B3E");
  if (payPartner) payPartner.value = rec.partner || "";
  if (payDoc) payDoc.value = rec.doc || "";
  if (paySales) {
    const sv = rec.sales || "";
    paySales.value = [...paySales.options].some((o) => o.value === sv) ? sv : "";
  }
  if (payAmount) payAmount.value = Number(rec.amount || 0).toFixed(2);
  if (payTrust) payTrust.value = ((_a2 = rec.trustDays) != null ? _a2 : "").toString();
  if (payNotes) payNotes.value = rec.notes || "";
  if (payImportFile) payImportFile.value = "";
  setPayImportHintText(payEditingFile ? `\u5F53\u524D\u5DF2\u4FDD\u5B58\u9644\u4EF6\uFF1A${payEditingFile.split("/").pop()}\uFF0C\u91CD\u65B0\u9009\u62E9\u56FE\u7247/PDF\u53EF\u66FF\u6362` : "");
  if (paySubmitBtn) paySubmitBtn.textContent = "\u4FDD\u5B58\u4FEE\u6539";
  payForm == null ? void 0 : payForm.scrollIntoView({ behavior: "smooth", block: "start" });
}
function clearPayEdit() {
  payEditingId = null;
  payEditingFile = "";
  payPendingAttachment = null;
  if (payImportFile) payImportFile.value = "";
  setPayImportHintText("");
  if (paySubmitBtn) paySubmitBtn.textContent = "\u63D0\u4EA4";
}
async function findInvoiceRecordByNumber(invoiceNo) {
  const targetNo = String(invoiceNo || "").trim();
  if (!targetNo) return null;
  const existing = currentInvoices.find((x) => String((x == null ? void 0 : x.invoice_no) || "").trim() === targetNo);
  if (existing) return existing;
  for (const type of ["factura", "albaran"]) {
    try {
      const res = await fetchWithAuth(`/api/invoices?page=1&size=20&q=${encodeURIComponent(targetNo)}&type=${encodeURIComponent(type)}`);
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data == null ? void 0 : data.list) ? data.list : [];
      const matched = list.find((x) => String((x == null ? void 0 : x.invoice_no) || "").trim() === targetNo);
      if (!matched) continue;
      const existingIndex = currentInvoices.findIndex((x) => String((x == null ? void 0 : x.id) || "") === String(matched.id || ""));
      if (existingIndex >= 0) currentInvoices[existingIndex] = matched;
      else currentInvoices.push(matched);
      return matched;
    } catch (e) {
    }
  }
  return null;
}
async function openPayableInvoicePreviewByNumber(invoiceNo) {
  const targetNo = String(invoiceNo || "").trim();
  if (!targetNo) return;
  const inv = await findInvoiceRecordByNumber(targetNo);
  if (!inv) {
    showAppToast("\u672A\u627E\u5230\u5BF9\u5E94\u53D1\u7968");
    return;
  }
  await previewInvoice(inv.id);
}
async function openDailyOrderInvoicePreviewByNumber(invoiceNo) {
  await openPayableInvoicePreviewByNumber(invoiceNo);
}
function renderPayables() {
  const gp = document.getElementById("global-pager");
  if (gp) gp.style.display = "flex";
  if (paySales) {
    const prev = paySales.value;
    paySales.innerHTML = '<option value="">\u8BF7\u9009\u62E9\u4E1A\u52A1\u5458</option>';
    (salesData || []).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name;
      paySales.appendChild(opt);
    });
    if ([...paySales.options].some((o) => o.value === prev)) paySales.value = prev;
  }
  const listAll = getFilteredPayableRecords();
  let recv = 0, pay = 0;
  const summarySource = hasActivePayableFilters() ? listAll : payRecords;
  for (const r of summarySource) {
    const arrears = r.specialStatus
      ? 0
      : Math.max(0, Number(r.amount || 0) - Number(r.paid || 0));
    if (/应收/.test(r.type)) recv += arrears;
    else if (/应付/.test(r.type)) pay += arrears;
  }
  if (sumRecvEl) sumRecvEl.textContent = recv.toFixed(2);
  if (sumPayEl) sumPayEl.textContent = pay.toFixed(2);
  const hasBatch = listAll.some((r) => r.batchAt);
  const listSorted = hasBatch ? listAll.slice().sort((a, b) => {
    const byBatch = (b.batchAt || 0) - (a.batchAt || 0);
    if (byBatch !== 0) return byBatch;
    const ao = a.batchOrder != null ? a.batchOrder : a.createdAt || 0;
    const bo = b.batchOrder != null ? b.batchOrder : b.createdAt || 0;
    return ao - bo;
  }) : listAll;
  const total = listSorted.length;
  const totalPages = Math.max(1, Math.ceil(total / payPageSize));
  if (payPage > totalPages) payPage = totalPages;
  const startIdx = (payPage - 1) * payPageSize;
  const list = listSorted.slice(startIdx, startIdx + payPageSize);
  payLastPageData = list.slice();
  payRows.innerHTML = "";
  if (!list.length) {
    const tr = document.createElement("tr");
    tr.className = "empty";
    const td = document.createElement("td");
    td.colSpan = 12;
    td.textContent = "\u6682\u65E0\u8BB0\u5F55";
    tr.appendChild(td);
    payRows.appendChild(tr);
    return;
  }
  for (const r of list) {
    const tr = document.createElement("tr");
    const typeDisplay = /应收/.test(r.type) ? "\u5E94\u6536" : "\u5E94\u4ED8";
    const tl = trustLabelDisplay(r);
    const trustLabel = tl.label;
    const isOverdue = tl.overdue;
    const paid = r.paid || 0;
    const arrears = r.specialStatus
      ? 0
      : Math.max(0, (r.amount || 0) - paid);
    const rowEditable = r.confirmed === false && r.id;
    const canForceUpdate = r.confirmed !== false && !!r.id && canCurrentUserForceEditFinancialModule("payables");
    const canUpdate = !r.specialStatus && ((rowEditable && can("payables", "update")) || canForceUpdate);
    const canDelete = !r.specialStatus && rowEditable && can("payables", "delete");
    const canConfirm = !r.specialStatus && rowEditable && can("payables", "confirm");
    const tdType = document.createElement("td");
    tdType.textContent = typeDisplay;
    tr.appendChild(tdType);
    const tdPartner = document.createElement("td");
    tdPartner.textContent = r.partner || "";
    tr.appendChild(tdPartner);
    const tdDoc = document.createElement("td");
    const docUp = document.createElement("div");
    const docNo = String(r.doc || "").trim();
    const payableInvoiceNo = String(r.invoiceNo || r.doc || "").trim();
    if (/应收/.test(r.type || "") && docNo && payableInvoiceNo) {
      const docLink = document.createElement("a");
      docLink.href = "#";
      docLink.textContent = docNo;
      docLink.className = "link-blue";
      docLink.addEventListener("click", async (e) => {
        e.preventDefault();
        await openPayableInvoicePreviewByNumber(payableInvoiceNo);
      });
      docUp.appendChild(docLink);
    } else {
      docUp.textContent = docNo;
    }
    const docDown = document.createElement("div");
    docDown.textContent = r.source === "import" ? formatDisplayDate(parseDateCN(r.date || "")) : "";
    docDown.style.color = "#9ca3af";
    docDown.style.fontSize = "12px";
    tdDoc.appendChild(docUp);
    if (docDown.textContent) tdDoc.appendChild(docDown);
    tr.appendChild(tdDoc);
    const tdAmount = document.createElement("td");
    tdAmount.textContent = (r.amount || 0).toFixed(2);
    tr.appendChild(tdAmount);
    const tdInv = document.createElement("td");
    const invUp = document.createElement("div");
    const invNo = r.invoiceNo || "";
    if (/应收/.test(r.type || "") && invNo) {
      const invLink = document.createElement("a");
      invLink.href = "#";
      invLink.textContent = invNo;
      invLink.className = "link-blue";
      invLink.addEventListener("click", async (e) => {
        e.preventDefault();
        await openPayableInvoicePreviewByNumber(invNo);
      });
      invUp.appendChild(invLink);
    } else if (r.confirmed === false) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = "-";
      a.className = "link-blue";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openInvoiceModal(r);
      });
      invUp.appendChild(a);
    } else {
      invUp.textContent = "-";
    }
    const invDown = document.createElement("div");
    invDown.textContent = formatDisplayDate(parseDateCN(r.invoiceDate || ""));
    invDown.style.color = "#9ca3af";
    invDown.style.fontSize = "12px";
    tdInv.appendChild(invUp);
    tdInv.appendChild(invDown);
    tr.appendChild(tdInv);
    const tdInvAmt = document.createElement("td");
    const invAmtNum = Number(r.invoiceAmount || 0);
    if (invAmtNum > 0 && isFinite(invAmtNum)) {
      tdInvAmt.textContent = invAmtNum.toFixed(2);
    } else if (r.confirmed === false) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = "-";
      a.className = "link-blue";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openInvoiceModal(r);
      });
      tdInvAmt.appendChild(a);
    } else {
      tdInvAmt.textContent = "-";
    }
    tr.appendChild(tdInvAmt);
    const tdAr = document.createElement("td");
    tdAr.textContent = arrears.toFixed(2);
    tr.appendChild(tdAr);
    const trustInfo = trustLabelDisplay(r);
    const tdTrust = document.createElement("td");
    tdTrust.textContent = trustInfo.label;
    if (trustInfo.overdue) {
      tdTrust.style.color = "#ef4444";
      tdTrust.style.fontWeight = "bold";
    } else if (trustInfo.isToday) {
      tdTrust.style.color = "#f59e0b";
      tdTrust.style.fontWeight = "bold";
    } else {
      tdTrust.style.color = "#10b981";
    }
    if (trustInfo.label === "-" || trustInfo.label === "" || trustInfo.label === "\u7ACB\u5373") {
      tdTrust.style.color = "";
      tdTrust.style.fontWeight = "normal";
    }
    tr.appendChild(tdTrust);
    const tdNotes = document.createElement("td");
    const noteText = summarizeNotes(r.notes, 10, 2);
    tdNotes.textContent = r.specialStatus
      ? `[${r.specialStatus}]${noteText ? ` ${noteText}` : ""}`
      : noteText;
    tdNotes.style.whiteSpace = "pre-wrap";
    tdNotes.style.wordBreak = "break-all";
    tr.appendChild(tdNotes);
    const tdSales = document.createElement("td");
    tdSales.textContent = r.sales || "-";
    tr.appendChild(tdSales);
    const tdDate = document.createElement("td");
    tdDate.textContent = safePayDate(r);
    tr.appendChild(tdDate);
    const ops = document.createElement("td");
    ops.style.textAlign = "center";
    const opsWrap = document.createElement("div");
    opsWrap.style.display = "inline-flex";
    opsWrap.style.alignItems = "center";
    opsWrap.style.justifyContent = "center";
    opsWrap.style.gap = "8px";
    if (canUpdate) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "\u4FEE\u6539";
      editBtn.className = "btn-sm btn-outline-blue";
      editBtn.addEventListener("click", (e) => {
        e.preventDefault();
        setPayEdit(r);
      });
      opsWrap.appendChild(editBtn);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "\u8BE6\u60C5";
    btn.className = "btn-sm btn-secondary";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openPayHistory(r);
    });
    opsWrap.appendChild(btn);
    if (isCurrentUserAdmin() && !r.specialStatus) {
      const specialBtn = document.createElement("button");
      specialBtn.type = "button";
      specialBtn.textContent = "特殊处理";
      specialBtn.className = "btn-sm btn-outline-orange";
      const specialWrap = document.createElement("span");
      specialWrap.style.display = "inline-flex";
      specialWrap.style.alignItems = "center";
      specialWrap.style.gap = "4px";
      specialWrap.style.position = "relative";
      const specialControls = document.createElement("span");
      specialControls.style.display = "none";
      specialControls.style.alignItems = "center";
      specialControls.style.gap = "4px";
      specialControls.style.position = "absolute";
      specialControls.style.left = "0";
      specialControls.style.top = "0";
      specialControls.style.zIndex = "20";
      const specialSelect = document.createElement("select");
      specialSelect.innerHTML = '<option value="">请选择</option><option value="逃单">逃单</option><option value="作废">作废</option>';
      specialSelect.style.width = "100%";
      specialSelect.style.height = "100%";
      const saveSpecialTreatment = async (specialStatus) => {
        if (!specialStatus) return;
        const shouldSave = confirm(`确认将该订单标记为“${specialStatus}”并关闭吗？`);
        if (!shouldSave) {
          specialSelect.value = "";
          return;
        }
        specialSelect.disabled = true;
        specialControls.style.display = "inline-flex";
        try {
          await apiFetchJSON(`/api/payables/${String(r.id)}/special-treatment`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ specialStatus })
          });
          await loadPayablesFromServer();
          renderContacts();
        } catch (err) {
          alert("特殊处理保存失败");
          specialSelect.disabled = false;
          specialSelect.value = "";
        }
      };
      specialWrap.addEventListener("mouseenter", () => {
        specialControls.style.display = "inline-flex";
      });
      specialWrap.addEventListener("mouseleave", () => {
        if (!specialSelect.disabled && !specialSelect.value) {
          specialControls.style.display = "none";
        }
      });
      specialSelect.addEventListener("change", () => {
        saveSpecialTreatment(specialSelect.value);
      });
      specialControls.appendChild(specialSelect);
      specialWrap.appendChild(specialBtn);
      specialWrap.appendChild(specialControls);
      opsWrap.appendChild(specialWrap);
    }
    if (canConfirm) {
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.textContent = "\u786E\u8BA4";
      okBtn.className = "btn-sm btn-outline-green";
      okBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await apiFetchJSON("/api/payables/" + String(r.id) + "/confirm", { method: "PUT" });
          clearPayEdit();
          loadPayablesFromServer();
          renderContacts();
        } catch (e2) {
        }
      });
      opsWrap.appendChild(okBtn);
    }
    if (canDelete) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "\u5220\u9664";
      delBtn.className = "btn-sm btn-outline-red";
      delBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openConfirm("\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u6761\u5E94\u6536/\u5E94\u4ED8\u8BB0\u5F55\u5417\uFF1F\u5220\u9664\u540E\u4E0D\u53EF\u6062\u590D\u3002", async () => {
          try {
            await apiFetchJSON("/api/payables/" + String(r.id), { method: "DELETE" });
            clearPayEdit();
            loadPayablesFromServer();
            renderContacts();
          } catch (err) {
            console.error(err);
            alert("\u5220\u9664\u5931\u8D25");
          }
        });
      });
      opsWrap.appendChild(delBtn);
    }
    ops.appendChild(opsWrap);
    tr.appendChild(ops);
    if (r.specialStatus) tr.classList.add("pay-row-special", "pay-row-settled");
    else if (r.settled) tr.classList.add("pay-row-settled");
    else if (typeDisplay === "\u5E94\u6536") tr.classList.add("pay-row-recv");
    else tr.classList.add("pay-row-pay");
    payRows.appendChild(tr);
  }
  if (payTableWrap) payTableWrap.scrollTop = 0;
  if (payPager) {
    payPager.innerHTML = "";
    payPager.style.display = "flex";
    const makeBtn = (label, page, disabled = false, active = false) => {
      const b = document.createElement("a");
      b.href = "#";
      b.textContent = label;
      b.style.padding = "4px 8px";
      b.style.border = "1px solid #334155";
      b.style.borderRadius = "4px";
      b.style.color = active ? "#000" : "#cbd5e1";
      b.style.background = active ? "#cbd5e1" : "transparent";
      b.style.pointerEvents = disabled ? "none" : "auto";
      b.style.opacity = disabled ? "0.4" : "1";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        payPage = page;
        renderPayables();
      });
      payPager.appendChild(b);
    };
    makeBtn("\xAB", Math.max(1, payPage - 1), payPage <= 1);
    const maxButtons = 9;
    let start = Math.max(1, payPage - Math.floor(maxButtons / 2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    for (let p = start; p <= end; p++) makeBtn(String(p), p, false, p === payPage);
    makeBtn("\xBB", Math.min(totalPages, payPage + 1), payPage >= totalPages);
  }
  if (payFooterInfo) {
    const totalCount = payRecords.length;
    const today = formatDateFromTs(Date.now());
    const todayCount = payRecords.filter((r) => formatDateFromTs(r.createdAt) === today).length;
    const latestBatch = Math.max(0, ...payRecords.map((r) => r.batchAt || 0));
    const latestBatchCount = latestBatch ? payRecords.filter((r) => (r.batchAt || 0) === latestBatch).length : payRecords.length ? 1 : 0;
    payFooterInfo.innerHTML = "";
    const mk = (text) => {
      const s = document.createElement("span");
      s.className = "info-pill";
      s.textContent = text;
      return s;
    };
    payFooterInfo.appendChild(mk(`\u5171 ${totalCount} \u6761\u8BB0\u5F55`));
    payFooterInfo.appendChild(mk(`\u4ECA\u65E5\u4E0A\u4F20 ${todayCount} \u6761`));
    payFooterInfo.appendChild(mk(`\u6700\u540E\u6B21\u4E0A\u4F20 ${latestBatchCount} \u6761`));
  }
}
payFilterKey == null ? void 0 : payFilterKey.addEventListener("input", () => {
  payPage = 1;
  renderPayables();
});
payExportBtn == null ? void 0 : payExportBtn.addEventListener("click", () => {
  const filteredList = getFilteredPayableRecords();
  const hasBatch = filteredList.some((r) => r.batchAt);
  const data = hasBatch ? filteredList.slice().sort((a, b) => {
    const byBatch = (b.batchAt || 0) - (a.batchAt || 0);
    if (byBatch !== 0) return byBatch;
    const ao = a.batchOrder != null ? a.batchOrder : a.createdAt || 0;
    const bo = b.batchOrder != null ? b.batchOrder : b.createdAt || 0;
    return ao - bo;
  }) : filteredList;
  if (!data.length) {
    alert("\u5F53\u524D\u65E0\u8BB0\u5F55\u53EF\u5BFC\u51FA");
    return;
  }
  const rows2 = [];
  rows2.push(["\u6B3E\u9879\u7C7B\u578B", "\u5F80\u6765\u5355\u4F4D", "\u5355\u636E/\u51ED\u8BC1\u53F7", "\u4E1A\u52A1\u5458", "\u91D1\u989D", "\u53D1\u7968\u53F7", "\u53D1\u7968\u65E5\u671F", "\u53D1\u7968\u91D1\u989D", "\u6B20\u6B3E", "\u4FE1\u4EFB\u5929\u6570", "\u5907\u6CE8", "\u65E5\u671F"]);
  data.forEach((r) => {
    const typeDisplay = /应收/.test(r.type) ? "\u5E94\u6536" : "\u5E94\u4ED8";
    const tl = trustLabelDisplay(r);
    const trustLabel = tl.label;
    const paid = r.paid || 0;
    const arrears = Math.max(0, (r.amount || 0) - paid);
    const invAmtCell = Number(r.invoiceAmount || 0) > 0 ? (r.invoiceAmount || 0).toFixed(2) : "-";
    const outDate = r.source === "manual" ? safePayDate(r) || "" : r.date || "";
    rows2.push([typeDisplay, r.partner || "", r.doc || "", r.sales || "", (r.amount || 0).toFixed(2), r.invoiceNo || "", r.invoiceDate || "", invAmtCell, arrears.toFixed(2), trustLabel, r.notes || "", outDate]);
  });
  let html = '<html><head><meta charset="UTF-8"></head><body><table border="1">';
  rows2.forEach((r) => {
    html += "<tr>" + r.map((c) => `<td>${String(c).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`).join("") + "</tr>";
  });
  html += "</table></body></html>";
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=UTF-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const now = /* @__PURE__ */ new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  a.download = `\u5E94\u6536\u5E94\u4ED8\u8D26\u6B3E_${ts}.xls`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
payClearBtn == null ? void 0 : payClearBtn.addEventListener("click", async () => {
  if (!confirm("\u786E\u5B9A\u6E05\u7A7A\u5E94\u6536/\u5E94\u4ED8\u6240\u6709\u8BB0\u5F55\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D")) return;
  try {
    await apiFetchJSON("/api/payables", { method: "DELETE" });
    payRecords.splice(0, payRecords.length);
    saveJSON("payRecords", payRecords);
    payPage = 1;
    loadPayablesFromServer();
    renderContacts();
  } catch (e) {
  }
});
const handlePayFormSubmit = async (e) => {
  var _a2, _b2, _c2, _d, _e, _f, _g, _h;
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (paySubmitLock) return;
  paySubmitLock = true;
  (_a2 = document.getElementById("pay-label-partner")) == null ? void 0 : _a2.classList.remove("invalid-label");
  (_b2 = document.getElementById("pay-label-doc")) == null ? void 0 : _b2.classList.remove("invalid-label");
  (_c2 = document.getElementById("pay-label-amount")) == null ? void 0 : _c2.classList.remove("invalid-label");
  if (payImportParsed.length) {
    let covered = 0, inserted = 0, createdCustomers = 0, createdMerchants = 0;
    const batchAt = Date.now();
    let batchOrder = 0;
    payImportParsed.forEach((rec) => {
      rec.confirmed = false;
      rec.batchAt = batchAt;
      rec.batchOrder = batchOrder++;
      rec.createdAt = batchAt;
      const existedBefore = [...contactsData.customers, ...contactsData.merchants, ...contactsData.others].some((x) => (x.name || "") === (rec.partner || ""));
      ensureContactForPartner(rec.partner, rec.type, rec.sales);
      if (!existedBefore && (rec.partner || "").trim()) {
        if (/应付/.test(rec.type)) createdMerchants++;
        else createdCustomers++;
      }
      const hasKey = (rec.partner || "").trim() && (rec.doc || "").trim();
      if (hasKey) {
        const ex = findExistingPayRecord(rec);
        if (ex) {
          mergePayRecord(ex, rec);
          ex.batchAt = batchAt;
          ex.batchOrder = rec.batchOrder;
          ex.createdAt = batchAt;
          covered++;
          return;
        }
      }
      payRecords.push(rec);
      inserted++;
    });
    const uploadList = payImportParsed.slice();
    payImportParsed = [];
    payPendingAttachment = null;
    if (payImportFile) payImportFile.value = "";
    setPayImportHintText("\u6279\u91CF\u5BFC\u5165\u5B8C\u6210");
    payPage = 1;
    apiFetchJSON("/api/payables/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records: uploadList }) }).then(() => loadPayablesFromServer()).catch(() => {
    });
    renderPayables();
    if (contactsSearch) contactsSearch.value = "";
    renderContacts();
    saveJSON("payRecords", payRecords);
    saveJSON("contactsData", contactsData);
    const gp2 = document.getElementById("global-pager");
    if (gp2) gp2.style.display = "flex";
    renderPayables();
    alert(`\u5BFC\u5165\u5B8C\u6210\uFF1A\u65B0\u589E\u8BB0\u5F55 ${inserted} \u6761\uFF0C\u8986\u76D6\u66F4\u65B0 ${covered} \u6761\uFF0C\u65B0\u589E\u5BA2\u6237 ${createdCustomers} \u6761\uFF0C\u65B0\u589E\u5546\u5BB6 ${createdMerchants} \u6761\u3002`);
    paySubmitLock = false;
    return;
  }
  const type = payType.value;
  const partner = payPartner.value.trim();
  const doc = payDoc.value.trim();
  const sales = ((paySales == null ? void 0 : paySales.value) || "").trim();
  const amountStr = (payAmount.value || "").trim();
  const amount = parseFloat(amountStr || "");
  const trustDays = parseInt(payTrust.value || "0", 10);
  const notes = payNotes.value.trim();
  const invalidLabels = [];
  if (!type) return;
  if (!partner) invalidLabels.push("pay-label-partner");
  if (!doc) invalidLabels.push("pay-label-doc");
  if (!amountStr || !amount) invalidLabels.push("pay-label-amount");
  if (invalidLabels.length) {
    invalidLabels.forEach((id) => {
      const el = document.getElementById(id);
      el == null ? void 0 : el.classList.add("invalid-label");
    });
    const focusEl = !partner ? payPartner : !doc ? payDoc : payAmount;
    focusEl == null ? void 0 : focusEl.focus();
    const clearPartner = () => {
      var _a3;
      return (_a3 = document.getElementById("pay-label-partner")) == null ? void 0 : _a3.classList.remove("invalid-label");
    };
    const clearDoc = () => {
      var _a3;
      return (_a3 = document.getElementById("pay-label-doc")) == null ? void 0 : _a3.classList.remove("invalid-label");
    };
    const clearAmount = () => {
      var _a3;
      return (_a3 = document.getElementById("pay-label-amount")) == null ? void 0 : _a3.classList.remove("invalid-label");
    };
    payPartner.addEventListener("input", clearPartner, { once: true });
    payDoc.addEventListener("input", clearDoc, { once: true });
    payAmount.addEventListener("input", clearAmount, { once: true });
    alert("\u8BF7\u8865\u5168\u5FC5\u586B\u9879");
    paySubmitLock = false;
    return;
  }
  if (payDocExists(doc, type, payEditingId)) {
    setPayDocInvalid(true);
    alert("\u51ED\u8BC1\u53F7\u5DF2\u5B58\u5728");
    paySubmitLock = false;
    return;
  }
  let fileUrl = "";
  if (payPendingAttachment) {
    try {
      fileUrl = await uploadLedgerAttachment(payPendingAttachment);
    } catch (e2) {
      if ((e2 == null ? void 0 : e2.message) === "bad_type") alert("\u5355\u6761\u8BB0\u5F55\u4EC5\u652F\u6301 JPG/PNG \u6216 PDF \u6587\u4EF6");
      else alert("\u9644\u4EF6\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      paySubmitLock = false;
      return;
    }
  }
  const now = /* @__PURE__ */ new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dateTime = `${date} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const creator = ((_d = getAuthUser()) == null ? void 0 : _d.name) || "";
  if (payEditingId) {
    const origin = payRecords.find((r) => r.id === payEditingId) || {};
    const paidVal = Number(origin.paid || 0);
    const settledVal = amount > 0 && paidVal >= amount;
    const payload = {
      type,
      partner,
      doc,
      sales,
      amount,
      paid: paidVal,
      trustDays,
      notes,
      date,
      settled: settledVal,
      history: origin.history || [],
      createdAt: origin.createdAt || Date.now(),
      invoiceNo: origin.invoiceNo || "",
      invoiceDate: origin.invoiceDate || "",
      invoiceAmount: Number(origin.invoiceAmount || 0),
      file: fileUrl || origin.file || "",
      source: origin.source || "manual",
      batchAt: origin.batchAt || 0,
      batchOrder: (_e = origin.batchOrder) != null ? _e : 0,
      confirmed: origin.confirmed === false ? false : true
    };
    try {
      await apiFetchJSON("/api/payables/" + String(payEditingId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      clearPayEdit();
      loadPayablesFromServer();
      renderContacts();
    } catch (e2) {
      alert("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      paySubmitLock = false;
      return;
    }
  } else {
    const rec = { type, partner, doc, sales, amount, paid: 0, trustDays, notes, date, settled: false, history: [], createdAt: Date.now(), invoiceNo: "", invoiceDate: "", invoiceAmount: 0, file: fileUrl, source: "manual", confirmed: false };
    rec.batchAt = Date.now();
    rec.batchOrder = 0;
    rec.history.push({ date: dateTime, user: creator, kind: "\u521B\u5EFA", amount, partner, doc, notes });
    try {
      const res = await apiFetchJSON("/api/payables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) });
      if (res && res.id) rec.id = res.id;
      loadPayablesFromServer();
    } catch (e2) {
      alert("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      paySubmitLock = false;
      return;
    }
  }
  payPartner.value = "";
  payDoc.value = "";
  if (paySales) paySales.value = "";
  payAmount.value = "";
  payTrust.value = "30";
  payNotes.value = "";
  payPendingAttachment = null;
  if (payImportFile) payImportFile.value = "";
  setPayImportHintText("");
  (_f = document.getElementById("pay-label-partner")) == null ? void 0 : _f.classList.remove("invalid-label");
  (_g = document.getElementById("pay-label-doc")) == null ? void 0 : _g.classList.remove("invalid-label");
  (_h = document.getElementById("pay-label-amount")) == null ? void 0 : _h.classList.remove("invalid-label");
  payPage = 1;
  renderPayables();
  renderContacts();
  saveJSON("payRecords", payRecords);
  saveJSON("contactsData", contactsData);
  const gp = document.getElementById("global-pager");
  if (gp) gp.style.display = "flex";
  renderPayables();
  paySubmitLock = false;
};
payForm == null ? void 0 : payForm.addEventListener("submit", handlePayFormSubmit);
paySubmitBtn == null ? void 0 : paySubmitBtn.addEventListener("click", handlePayFormSubmit);
let payImportParsed = [];
let payImportInvalidCount = 0;
let payImportRequiredMissingCount = 0;
function parseCSV(text) {
  const rows2 = [];
  let i = 0, cur = "", inQ = false, row = [];
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cur.trim());
      rows2.push(row);
      row = [];
      cur = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.length || row.length) {
    row.push(cur.trim());
    rows2.push(row);
  }
  return rows2;
}
function parseXLS(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  const rows2 = [];
  if (!table) return rows2;
  table.querySelectorAll("tr").forEach((tr) => {
    const row = [];
    tr.querySelectorAll("td,th").forEach((td) => row.push(td.textContent.trim()));
    if (row.length) rows2.push(row);
  });
  return rows2;
}
function parseXLSX(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: "array" });
    const wsname = wb.SheetNames[0];
    const ws = wb.Sheets[wsname];
    const rows2 = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    return rows2 || [];
  } catch (e) {
    alert("\u89E3\u6790 .xlsx \u6587\u4EF6\u5931\u8D25");
    return [];
  }
}
function parseTrustDays(val) {
  const s = String(val || "").trim();
  if (!s) return NaN;
  if (s.includes("\u7ACB\u5373")) return 0;
  const m = new RegExp("(\\d+)").exec(s);
  return m ? parseInt(m[1], 10) : NaN;
}
function parseDateCN(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  if (/^\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2}$/.test(s)) {
    const parts = s.split(/[-\/\.]/);
    const y = parts[0];
    const mm = String(parseInt(parts[1], 10)).padStart(2, "0");
    const dd = String(parseInt(parts[2], 10)).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  const mCNFull = new RegExp("(\\d{4})\\s*\u5E74\\s*(\\d{1,2})\\s*\u6708\\s*(\\d{1,2})\\s*\u65E5").exec(s);
  if (mCNFull) {
    const y = mCNFull[1];
    const mm = String(parseInt(mCNFull[2], 10)).padStart(2, "0");
    const dd = String(parseInt(mCNFull[3], 10)).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  const mCN = new RegExp("(\\d{1,2})\\s*\u6708\\s*(\\d{1,2})\\s*\u65E5").exec(s);
  if (mCN) {
    const y = (/* @__PURE__ */ new Date()).getFullYear();
    const mm = String(parseInt(mCN[1], 10)).padStart(2, "0");
    const dd = String(parseInt(mCN[2], 10)).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  const mMD = new RegExp("(\\d{1,2})[-\\/\\.]?(\\d{1,2})$").exec(s);
  if (mMD) {
    const y = (/* @__PURE__ */ new Date()).getFullYear();
    const mm = String(parseInt(mMD[1], 10)).padStart(2, "0");
    const dd = String(parseInt(mMD[2], 10)).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  return s;
}
function formatDateFromTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function padDisplayDatePart(value) {
  return String(value || "").padStart(2, "0");
}
function extractDisplayDateParts(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hours: value.getHours(),
      minutes: value.getMinutes(),
      seconds: value.getSeconds(),
      hasTime: true
    };
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const parts = raw.split("-");
    return {
      day: Number(parts[0]),
      month: Number(parts[1]),
      year: Number(parts[2]),
      hours: 0,
      minutes: 0,
      seconds: 0,
      hasTime: false
    };
  }
  const dayFirstMatch = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dayFirstMatch) {
    return {
      day: Number(dayFirstMatch[1]),
      month: Number(dayFirstMatch[2]),
      year: Number(dayFirstMatch[3]),
      hours: Number(dayFirstMatch[4] || 0),
      minutes: Number(dayFirstMatch[5] || 0),
      seconds: Number(dayFirstMatch[6] || 0),
      hasTime: Boolean(dayFirstMatch[4])
    };
  }
  const directMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (directMatch) {
    return {
      year: Number(directMatch[1]),
      month: Number(directMatch[2]),
      day: Number(directMatch[3]),
      hours: Number(directMatch[4] || 0),
      minutes: Number(directMatch[5] || 0),
      seconds: Number(directMatch[6] || 0),
      hasTime: Boolean(directMatch[4])
    };
  }
  const maybeTs = Number(raw);
  if (Number.isFinite(maybeTs) && raw.length >= 11) {
    const d = new Date(maybeTs);
    if (!Number.isNaN(d.getTime())) {
      return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hours: d.getHours(),
        minutes: d.getMinutes(),
        seconds: d.getSeconds(),
        hasTime: true
      };
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
    hours: parsed.getHours(),
    minutes: parsed.getMinutes(),
    seconds: parsed.getSeconds(),
    hasTime: /[T\s]\d{1,2}:\d{2}/.test(raw)
  };
}
function formatDisplayDate(value) {
  const parts = extractDisplayDateParts(value);
  if (!parts) return value ? String(value) : "";
  return `${padDisplayDatePart(parts.day)}-${padDisplayDatePart(parts.month)}-${parts.year}`;
}
function formatInventoryDisplayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const dayFirst = raw.match(/^(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{4})$/);
  if (dayFirst) {
    return `${padDisplayDatePart(dayFirst[1])}-${padDisplayDatePart(dayFirst[2])}-${dayFirst[3]}`;
  }
  const isoLike = raw.match(/^(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})$/);
  if (isoLike) {
    return `${padDisplayDatePart(isoLike[3])}-${padDisplayDatePart(isoLike[2])}-${isoLike[1]}`;
  }
  const formatted = formatDisplayDate(raw);
  return formatted || raw.replace(/\//g, "-");
}
function formatDisplayTime(value, options = {}) {
  const parts = extractDisplayDateParts(value);
  if (!parts || !parts.hasTime) return "";
  const base = `${padDisplayDatePart(parts.hours)}:${padDisplayDatePart(parts.minutes)}`;
  return options.seconds ? `${base}:${padDisplayDatePart(parts.seconds)}` : base;
}
function formatDisplayDateTimeValue(value, options = {}) {
  const parts = extractDisplayDateParts(value);
  if (!parts) return value ? String(value) : "";
  const dateText = formatDisplayDate(value);
  const timeText = formatDisplayTime(value, options);
  return timeText ? `${dateText} ${timeText}` : dateText;
}
function toSortableDateValue(value) {
  const parts = extractDisplayDateParts(value);
  if (!parts) return "9999-12-31";
  return `${parts.year}-${padDisplayDatePart(parts.month)}-${padDisplayDatePart(parts.day)}`;
}
function safePayDate(rec) {
  const t0 = Number(rec.createdAt);
  if (Number.isFinite(t0) && t0 > 0) return formatDateFromTs(t0);
  const t1 = Date.parse(rec.date || rec.invoiceDate || "");
  if (!isNaN(t1)) return formatDateFromTs(t1);
  return formatDateFromTs(Date.now());
}
function rowToRecord(cols) {
  var _a2, _b2;
  const [typeCol, partner, doc, date, amountCol, invoiceNo, invoiceDate, invoiceAmountCol, trustCol, notes, sales, paidCol] = cols;
  const type = /应付/.test(String(typeCol)) ? "\u5E94\u4ED8\u8D26\u6B3E" : "\u5E94\u6536\u8D26\u6B3E";
  const amount = parseFloat(String(amountCol).replace(/,/g, "")) || 0;
  const paidFromSheet = parseFloat(String(paidCol || "").replace(/,/g, "")) || 0;
  const trustDaysIn = parseTrustDays(trustCol);
  const trustDays = Number.isFinite(trustDaysIn) ? trustDaysIn : parseInt(((_a2 = document.getElementById("pay-trust")) == null ? void 0 : _a2.value) || "30", 10);
  const now = /* @__PURE__ */ new Date();
  const creator = ((_b2 = getAuthUser()) == null ? void 0 : _b2.name) || "";
  const createdAt = Date.now();
  const dIn = parseDateCN(date);
  const d = dIn && new RegExp("^\\d{4}-\\d{2}-\\d{2}$").test(dIn) ? dIn : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dt = `${d} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const invoiceAmount = parseFloat(String(invoiceAmountCol || "").replace(/,/g, "")) || 0;
  const paid = Math.min(paidFromSheet, amount);
  const rec = { type, partner: String(partner || "").trim(), doc: String(doc || "").trim(), sales, amount, paid, trustDays, notes, date: d, settled: paid >= amount && amount > 0, history: [], createdAt, invoiceNo: invoiceNo || "", invoiceDate: parseDateCN(invoiceDate || ""), invoiceAmount, source: "import", confirmed: false };
  rec.history.push({ date: dt, user: creator, kind: "\u521B\u5EFA", amount, partner, doc, notes });
  if (invoiceNo || invoiceAmount) {
    rec.history.push({ date: dt, user: creator, kind: "\u53D1\u7968", amount: invoiceAmount, partner, doc, notes: `\u53D1\u7968\u53F7:${invoiceNo || "-"} \u53D1\u7968\u65E5\u671F:${rec.invoiceDate || "-"}` });
  }
  if (paid > 0) {
    rec.history.push({ date: dt, user: creator, kind: "\u94F6\u884C\u4ED8\u6B3E", amount: paid, partner, doc, notes: "" });
  }
  return rec;
}
function previewImport(rows2) {
  const headerRow = rows2[0] ? rows2[0].map((x) => String(x).trim()) : [];
  const hasHeader = headerRow.some((x) => /类型|款项|往来单位|凭证|发票|日期/.test(x));
  const dataRows = hasHeader ? rows2.slice(1) : rows2;
  function idxOf(names) {
    for (const n of names) {
      const i = headerRow.findIndex((h) => h && h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  }
  const idx = {
    type: hasHeader ? idxOf(["\u5E94\u6536\u5E94\u4ED8"]) : 0,
    partner: hasHeader ? idxOf(["\u5F80\u6765\u5355\u4F4D"]) : 1,
    doc: hasHeader ? idxOf(["\u5355\u636E\u51ED\u8BC1\u53F7"]) : 2,
    date: hasHeader ? idxOf(["\u51FA\u5355\u65E5\u671F"]) : 3,
    amount: hasHeader ? idxOf(["\u8BA2\u5355\u91D1\u989D"]) : 4,
    invoiceNo: hasHeader ? idxOf(["\u53D1\u7968\u53F7"]) : 5,
    invoiceDate: hasHeader ? idxOf(["\u53D1\u7968\u65E5\u671F"]) : 6,
    invoiceAmount: hasHeader ? idxOf(["\u53D1\u7968\u91D1\u989D"]) : 7,
    trustDays: hasHeader ? idxOf(["\u4FE1\u4EFB\u5929\u6570"]) : 8,
    notes: hasHeader ? idxOf(["\u5907\u6CE8"]) : 9,
    sales: hasHeader ? idxOf(["\u4E1A\u52A1\u5458"]) : 10,
    paid: hasHeader ? idxOf(["\u652F\u4ED8\u60C5\u51B5", "\u5DF2\u652F\u4ED8", "\u652F\u4ED8\u91D1\u989D", "\u652F\u4ED8"]) : -1
  };
  const selectedType = (payType == null ? void 0 : payType.value) || "";
  const selectedFlag = /应付/.test(selectedType) ? "\u5E94\u4ED8" : "\u5E94\u6536";
  payImportParsed = [];
  payImportInvalidCount = 0;
  payImportRows.innerHTML = "";
  let cntTypeMismatch = 0;
  let cntUpdatedEst = 0;
  let cntNewCustomersEst = 0;
  let cntNewMerchantsEst = 0;
  let parsedVisibleCount = 0;
  let requiredMissingCount = 0;
  const existCustomers = new Set((contactsData.customers || []).map((x) => String(x.name || "").trim()));
  const existMerchants = new Set((contactsData.merchants || []).map((x) => String(x.name || "").trim()));
  dataRows.forEach((row) => {
    var _a2, _b2, _c2, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
    let rowType = String((_a2 = row[idx.type]) != null ? _a2 : "").trim();
    const originalTypeEmpty = !rowType;
    if (!rowType) rowType = selectedFlag;
    const partnerName = String((_b2 = row[idx.partner]) != null ? _b2 : "").trim();
    const docVal = String((_c2 = row[idx.doc]) != null ? _c2 : "").trim();
    const amtVal = String((_d = row[idx.amount]) != null ? _d : "").trim();
    if (![rowType, partnerName, docVal, amtVal].some((v) => String(v || "").trim())) return;
    const colsX = [
      (_e = row[idx.type]) != null ? _e : "",
      partnerName,
      (_f = row[idx.doc]) != null ? _f : "",
      (_g = row[idx.date]) != null ? _g : "",
      (_h = row[idx.amount]) != null ? _h : "",
      (_i = row[idx.invoiceNo]) != null ? _i : "",
      (_j = row[idx.invoiceDate]) != null ? _j : "",
      (_k = row[idx.invoiceAmount]) != null ? _k : "",
      (_l = row[idx.trustDays]) != null ? _l : "",
      (_m = row[idx.notes]) != null ? _m : "",
      (_n = row[idx.sales]) != null ? _n : "",
      idx.paid >= 0 ? row[idx.paid] : ""
    ];
    const tr = document.createElement("tr");
    let isErrorRow = false;
    let errorReason = "";
    if (rowType && !rowType.includes(selectedFlag)) {
      isErrorRow = true;
      errorReason = "\u6027\u8D28\u4E0D\u5339\u914D\uFF1A\u9875\u9762\u4E0EA\u5217\u4E0D\u4E00\u81F4";
      cntTypeMismatch++;
      colsX[0] = selectedFlag;
    }
    const missType = originalTypeEmpty;
    const missPartner = !partnerName;
    const missDoc = !docVal;
    const missAmount = !amtVal;
    if (missPartner) {
      isErrorRow = true;
      errorReason = errorReason ? errorReason + "\uFF1B\u5E97\u540D\u4E3A\u7A7A" : "\u5E97\u540D\u4E3A\u7A7A";
      payImportInvalidCount++;
    }
    const isRequiredMissing = missType || missPartner || missDoc || missAmount;
    if (isRequiredMissing) requiredMissingCount++;
    const previewCells = [
      (_o = row[idx.type]) != null ? _o : "",
      partnerName,
      (_p = row[idx.doc]) != null ? _p : "",
      (_q = row[idx.date]) != null ? _q : "",
      (_r = row[idx.amount]) != null ? _r : "",
      (_s = row[idx.invoiceNo]) != null ? _s : "",
      (_t = row[idx.invoiceDate]) != null ? _t : "",
      (_u = row[idx.invoiceAmount]) != null ? _u : "",
      (_v = row[idx.trustDays]) != null ? _v : "",
      idx.paid >= 0 ? row[idx.paid] : "",
      (_w = row[idx.notes]) != null ? _w : "",
      (_x = row[idx.sales]) != null ? _x : ""
    ];
    previewCells.forEach((v, ci) => {
      const td = document.createElement("td");
      td.textContent = String(v != null ? v : "");
      const needHighlight = ci === 0 && missType || ci === 1 && missPartner || ci === 2 && missDoc || ci === 4 && missAmount;
      if (needHighlight || isErrorRow && (ci === 0 || ci === 1)) {
        td.className = "error-cell";
        td.title = errorReason || "\u5FC5\u586B\u9879\u4E3A\u7A7A";
      }
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
    `\u5DF2\u89E3\u6790 ${parsedVisibleCount} \u6761`,
    cntUpdatedEst ? `\u9884\u8BA1\u8986\u76D6 ${cntUpdatedEst} \u6761` : "",
    cntNewCustomersEst + cntNewMerchantsEst ? `\u9884\u8BA1\u65B0\u589E\u5BA2\u6237/\u5546\u5BB6 ${cntNewCustomersEst + cntNewMerchantsEst} \u6761` : "",
    payImportInvalidCount ? `\u5DF2\u8DF3\u8FC7\u5E97\u540D\u4E3A\u7A7A ${payImportInvalidCount} \u6761` : "",
    cntTypeMismatch ? `\u6027\u8D28\u4E0D\u5339\u914D ${cntTypeMismatch} \u6761\uFF08A\u5217\u4E0E\u9875\u9762\u4E0D\u4E00\u81F4\uFF0C\u4E0D\u5BFC\u5165\uFF09` : "",
    requiredMissingCount ? `\u5B58\u5728\u5FC5\u586B\u9879\u4E3A\u7A7A ${requiredMissingCount} \u6761\uFF08\u5E94\u6536\u5E94\u4ED8/\u5F80\u6765\u5355\u4F4D/\u51ED\u8BC1\u53F7/\u8BA2\u5355\u91D1\u989D\uFF09\uFF0C\u8BF7\u4FEE\u6B63\u540E\u518D\u5165\u5E93` : ""
  ].filter(Boolean).join(" | ");
  payImportSummary.textContent = summary;
  if (payImportHint) {
    if (requiredMissingCount) payImportHint.textContent = `\u5B58\u5728\u5FC5\u586B\u9879\u4E3A\u7A7A ${requiredMissingCount} \u6761\uFF0C\u65E0\u6CD5\u5165\u5E93`;
    else payImportHint.textContent = `\u5DF2\u9009\u62E9 ${parsedVisibleCount} \u6761\uFF0C\u70B9\u51FB\u4E0B\u65B9\u63D0\u4EA4\u5B8C\u6210\u5165\u5E93`;
  }
  payImportRequiredMissingCount = requiredMissingCount;
  if (payImportCommit) payImportCommit.disabled = false;
}
payImportFile == null ? void 0 : payImportFile.addEventListener("change", () => {
  var _a2;
  const file = (_a2 = payImportFile == null ? void 0 : payImportFile.files) == null ? void 0 : _a2[0];
  if (!file) {
    return;
  }
  const name = (file.name || "").toLowerCase();
  if (isPayablesAttachmentFile(file)) {
    payPendingAttachment = file;
    payImportParsed = [];
    payImportInvalidCount = 0;
    payImportRequiredMissingCount = 0;
    if (payImportRows) payImportRows.innerHTML = "";
    if (payImportSummary) payImportSummary.textContent = "\u5DF2\u5207\u6362\u4E3A\u5355\u6761\u9644\u4EF6\u6A21\u5F0F";
    try {
      payImportModal.style.display = "none";
    } catch (e) {
    }
    setPayImportHintText(`\u5DF2\u9009\u62E9\u5355\u6761\u9644\u4EF6\uFF1A${file.name}\uFF0C\u70B9\u51FB\u4E0B\u65B9\u63D0\u4EA4\u4FDD\u5B58\u5230\u5F53\u524D\u5355\u636E`);
    return;
  }
  if (!isPayablesImportSheet(file)) {
    payPendingAttachment = null;
    alert("\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u7C7B\u578B");
    return;
  }
  payPendingAttachment = null;
  const reader = new FileReader();
  try {
    payImportModal.style.display = "flex";
    setImportModalWidth();
  } catch (e) {
  }
  if (name.endsWith(".csv")) {
    reader.onload = () => {
      try {
        previewImport(parseCSV(reader.result));
        setImportModalWidth();
      } catch (e) {
      }
    };
    reader.readAsText(file, "utf-8");
  } else if (name.endsWith(".xls")) {
    reader.onload = () => {
      try {
        previewImport(parseXLS(reader.result));
        setImportModalWidth();
      } catch (e) {
      }
    };
    reader.readAsText(file, "utf-8");
  } else if (name.endsWith(".xlsx")) {
    reader.onload = () => {
      try {
        previewImport(parseXLSX(reader.result));
        setImportModalWidth();
      } catch (e) {
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert("\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u7C7B\u578B");
  }
});
function setImportModalWidth() {
  const card = document.querySelector("#page-payables .card");
  const modalBox = document.querySelector("#pay-import-modal .modal");
  if (card && modalBox) {
    const w = Math.floor(card.getBoundingClientRect().width);
    modalBox.style.width = w + "px";
    modalBox.style.maxWidth = "none";
  }
}
payImportCancel == null ? void 0 : payImportCancel.addEventListener("click", () => {
  payImportModal.style.display = "none";
});
function ensureContactForPartner(name, type, salesName) {
  const pname = String(name || "").trim();
  if (!pname) return;
  const tab = /应付/.test(type) ? "merchants" : "customers";
  const ownerLabel = tab === "merchants" ? "\u5546\u5BB6" : "\u5BA2\u6237";
  const existsInTab = (contactsData[tab] || []).some((x) => String(x.name || "").trim() === pname);
  if (existsInTab) return;
  const now = /* @__PURE__ */ new Date();
  const created = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  contactsData[tab].push({ name: pname, contact: "", phone: "", city: "", remark: "", owner: ownerLabel, created, company: "", code: "", country: "", address: "", zip: "", sales: (salesName || "").trim() });
}
function findExistingPayRecord(rec) {
  const p = String(rec.partner || "").trim();
  const d = String(rec.doc || "").trim();
  return payRecords.find(
    (r) => r.type === rec.type && String(r.partner || "").trim() === p && String(r.doc || "").trim() === d
  );
}
function mergePayRecord(target, src) {
  var _a2;
  const now = /* @__PURE__ */ new Date();
  const dateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const user = ((_a2 = getAuthUser()) == null ? void 0 : _a2.name) || "";
  target.sales = src.sales || target.sales || "";
  if (!isNaN(src.amount)) target.amount = src.amount;
  if (!isNaN(src.paid)) {
    const newPaid = src.paid;
    target.paid = Math.min(newPaid, target.amount || 0);
  }
  if (!isNaN(src.trustDays)) target.trustDays = src.trustDays;
  target.notes = src.notes || target.notes || "";
  target.date = src.date || target.date;
  target.invoiceNo = src.invoiceNo || target.invoiceNo || "";
  target.invoiceDate = src.invoiceDate || target.invoiceDate || "";
  if (!isNaN(src.invoiceAmount)) target.invoiceAmount = src.invoiceAmount;
  target.settled = (target.paid || 0) >= (target.amount || 0) && (target.amount || 0) > 0;
  target.history = target.history || [];
  target.history.push({ date: dateTime, user, kind: "\u5BFC\u5165\u8986\u76D6", amount: src.amount, partner: target.partner, doc: target.doc, notes: "\u6279\u91CF\u5BFC\u5165\u8986\u76D6\u73B0\u6709\u8BB0\u5F55" });
  if (src.invoiceNo || src.invoiceAmount) {
    target.history.push({ date: dateTime, user, kind: "\u53D1\u7968", amount: src.invoiceAmount, partner: target.partner, doc: target.doc, notes: `\u53D1\u7968\u53F7:${src.invoiceNo || "-"} \u53D1\u7968\u65E5\u671F:${src.invoiceDate || "-"}` });
  }
  if (src.paid) {
    target.history.push({ date: dateTime, user, kind: "\u94F6\u884C\u4ED8\u6B3E", amount: src.paid, partner: target.partner, doc: target.doc, notes: "" });
  }
}
let payImportCommitLock = false;
const handlePayImportCommit = async (e) => {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (payImportCommitLock) return;
  payImportCommitLock = true;
  if (payImportRequiredMissingCount) {
    alert(`\u5B58\u5728\u5FC5\u586B\u9879\u4E3A\u7A7A ${payImportRequiredMissingCount} \u6761\uFF0C\u65E0\u6CD5\u5165\u5E93`);
    payImportCommitLock = false;
    return;
  }
  let createdCustomers = 0, createdMerchants = 0;
  let covered = 0, inserted = 0;
  const batchAt = Date.now();
  let batchOrder = 0;
  const beforeCustomers = new Set((contactsData.customers || []).map((x) => String(x.name || "").trim()));
  const beforeMerchants = new Set((contactsData.merchants || []).map((x) => String(x.name || "").trim()));
  payImportParsed.forEach((rec) => {
    rec.batchAt = batchAt;
    rec.batchOrder = batchOrder++;
    rec.createdAt = batchAt;
    const existedBefore = [...contactsData.customers, ...contactsData.merchants, ...contactsData.others].some((x) => (x.name || "") === (rec.partner || ""));
    ensureContactForPartner(rec.partner, rec.type, rec.sales);
    if (!existedBefore && (rec.partner || "").trim()) {
      if (/应付/.test(rec.type)) createdMerchants++;
      else createdCustomers++;
    }
    const hasKey = (rec.partner || "").trim() && (rec.doc || "").trim();
    if (hasKey) {
      const ex = findExistingPayRecord(rec);
      if (ex) {
        mergePayRecord(ex, rec);
        ex.batchAt = batchAt;
        ex.batchOrder = rec.batchOrder;
        ex.createdAt = batchAt;
        ex.source = "import";
        covered++;
        return;
      }
    }
    payRecords.push(rec);
    inserted++;
  });
  payImportParsed = [];
  payImportInvalidCount = 0;
  payImportModal.style.display = "none";
  payPage = 1;
  renderPayables();
  renderContacts == null ? void 0 : renderContacts();
  saveJSON("payRecords", payRecords);
  saveJSON("contactsData", contactsData);
  apiFetchJSON("/api/payables/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records: payRecords.filter((r) => r.batchAt === batchAt) }) }).then(() => loadPayablesFromServer()).catch(() => {
  });
  const totalChanged = inserted + covered + createdCustomers + createdMerchants;
  if (totalChanged > 0) {
    alert(`\u5BFC\u5165\u5B8C\u6210\uFF1A\u65B0\u589E\u8BB0\u5F55 ${inserted} \u6761\uFF0C\u8986\u76D6\u66F4\u65B0 ${covered} \u6761\uFF0C\u65B0\u589E\u5BA2\u6237 ${createdCustomers} \u6761\uFF0C\u65B0\u589E\u5546\u5BB6 ${createdMerchants} \u6761\u3002`);
  }
  payImportCommitLock = false;
};
if (payImportCommit) {
  payImportCommit.addEventListener("click", handlePayImportCommit);
  payImportCommit.onclick = handlePayImportCommit;
}
let contactsTab = "customers";
const contactsRows = document.getElementById("contacts-rows");
const contactsSearch = document.getElementById("contacts-search");
const confirmModal = document.getElementById("confirm-modal");
const confirmCancel = document.getElementById("confirm-cancel");
const confirmOk = document.getElementById("confirm-ok");
const partnerOrdersRows = document.getElementById("partner-orders-rows");
const partnerOrdersHead = document.getElementById("partner-orders-head");
let contactsPage = 1;
const contactsPageSize = 100;
window.handleContactDrop = async function(event, targetType) {
  event.preventDefault();
  try {
    const dataStr = event.dataTransfer.getData("text/plain");
    if (!dataStr) return;
    const data = JSON.parse(dataStr);
    if (data.currentType === targetType) return;
    const contact = contactsData[data.currentType].find((c) => c.id === data.id);
    if (!contact) return;
    const ownerMap = {
      "customers": "\u5BA2\u6237",
      "merchants": "\u5546\u5BB6",
      "others": "\u5176\u5B83"
    };
    const newOwner = ownerMap[targetType] || "\u5BA2\u6237";
    const res = await fetchWithAuth(`/api/contacts/${data.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...contact, owner: newOwner })
    });
    if (res.ok) {
      const tabBtn = document.querySelector(`#page-contacts .tabs .tab[data-tab="${targetType}"]`);
      if (tabBtn) {
        const origText = tabBtn.textContent;
        tabBtn.textContent = "\u79FB\u52A8\u6210\u529F";
        setTimeout(() => tabBtn.textContent = origText, 1e3);
      }
      await loadAllContacts();
      if (contactsTab === data.currentType) {
        renderContacts();
      }
    } else {
      alert("\u79FB\u52A8\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
    }
  } catch (e) {
    console.error("Drop error:", e);
  }
};
let pendingDeleteIndex = null;
let pendingDeleteTab = null;
function partnerTotal(name) {
  let sum = 0;
  payRecords.forEach((r) => {
    if ((r.partner || "") === name) sum += r.amount || 0;
  });
  return sum.toFixed(2);
}
function partnerArrears(name, ownerLabel) {
  let sum = 0;
  payRecords.forEach((r) => {
    if ((r.partner || "") !== name) return;
    const isRecv = /应收/.test(r.type || "");
    const isPay = /应付/.test(r.type || "");
    if (ownerLabel === "\u5BA2\u6237" && !isRecv) return;
    if (ownerLabel === "\u5546\u5BB6" && !isPay) return;
    const arrears = Math.max(0, (r.amount || 0) - (r.paid || 0));
    sum += arrears;
  });
  return sum.toFixed(2);
}
function formatDateTime(ts) {
  if (!ts) return "";
  return formatDisplayDateTimeValue(ts);
}
function openAmountHistory(partnerName, ownerLabel) {
  var _a2;
  const modal = document.getElementById("amount-history-modal");
  const head = document.getElementById("amount-history-head");
  const rowsEl = document.getElementById("amount-history-rows");
  const list = [];
  payRecords.forEach((r) => {
    var _a3;
    if ((r.partner || "") !== partnerName) return;
    const ts = r.createdAt || (r.date ? Date.parse(r.date) : 0);
    const amt = Number(r.amount || 0);
    const isRecv = /应收/.test(r.type || "");
    const change = isRecv ? amt : -amt;
    const label = isRecv ? `\u5E94\u6536\u8D26\u6B3E\u8BB0\u5F55 + ${amt.toFixed(2)}` : `\u5E94\u4ED8\u8D26\u6B3E\u8BB0\u5F55 - ${amt.toFixed(2)}`;
    const user = r.history && r.history[0] && r.history[0].user || (((_a3 = getAuthUser()) == null ? void 0 : _a3.name) || "");
    list.push({ ts, doc: r.doc || "", change, label, user });
  });
  records.forEach((rec) => {
    var _a3;
    if ((rec.client || "") !== partnerName) return;
    if (rec.type === "\u6536\u5165") {
      const ts = rec.createdAt || (rec.dateTime ? Date.parse(rec.dateTime) : rec.date ? Date.parse(rec.date) : 0);
      const amt = Number(rec.amount || 0);
      const change = -amt;
      const label = `\u6536\u652F\u8BB0\u8D26\u6536\u5165 - ${amt.toFixed(2)}`;
      const user = ((_a3 = getAuthUser()) == null ? void 0 : _a3.name) || "";
      list.push({ ts, doc: rec.doc || "", change, label, user });
    }
  });
  list.sort((a, b) => a.ts - b.ts);
  let cum = 0;
  const withCum = list.map((x) => {
    cum += x.change;
    return { ...x, cum };
  });
  rowsEl.innerHTML = "";
  const render2 = [...withCum].reverse();
  render2.forEach((x, idx) => {
    const tr = document.createElement("tr");
    const seq = document.createElement("td");
    seq.textContent = String(render2.length - idx);
    tr.appendChild(seq);
    const dt = document.createElement("td");
    dt.textContent = formatDateTime(x.ts);
    tr.appendChild(dt);
    const doc = document.createElement("td");
    doc.textContent = x.doc || "-";
    tr.appendChild(doc);
    const change = document.createElement("td");
    change.textContent = x.label;
    tr.appendChild(change);
    const arrears = document.createElement("td");
    arrears.textContent = Number.isFinite(x.cum) ? x.cum.toFixed(2) : "-";
    tr.appendChild(arrears);
    const user = document.createElement("td");
    user.textContent = x.user || "-";
    tr.appendChild(user);
    rowsEl.appendChild(tr);
  });
  head.textContent = `\u5F80\u6765\u5355\u4F4D\uFF1A${partnerName}`;
  modal.style.display = "flex";
  (_a2 = document.getElementById("amount-history-close")) == null ? void 0 : _a2.addEventListener("click", () => {
    modal.style.display = "none";
  });
}
function openPartnerOrders(name) {
  var _a2;
  const modal = document.getElementById("partner-orders-modal");
  const head = document.getElementById("partner-orders-head");
  const rowsEl = document.getElementById("partner-orders-rows");
  head.textContent = "\u5F80\u6765\u5355\u4F4D\uFF1A" + (name || "");
  const list = payRecords.filter((r) => (r.partner || "") === (name || ""));
  rowsEl.innerHTML = "";
  list.forEach((r) => {
    const tr = document.createElement("tr");
    const paid = r.paid || 0;
    const arrears = Math.max(0, (r.amount || 0) - paid);
    [r.type, r.partner || "", r.doc || "", (r.amount || 0).toFixed(2), paid.toFixed(2), arrears.toFixed(2), r.date || ""].forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = String(v);
      if (i === 5 && arrears > 0) td.style.color = "#ef4444";
      tr.appendChild(td);
    });
    rowsEl.appendChild(tr);
  });
  modal.style.display = "flex";
  (_a2 = document.getElementById("partner-orders-close")) == null ? void 0 : _a2.addEventListener("click", () => {
    modal.style.display = "none";
  });
}
async function renderContacts() {
  var _a2;
  const key = ((contactsSearch == null ? void 0 : contactsSearch.value) || "").trim();
  if (key) {
    await Promise.all([
      apiContactsList("customers", key, 1, 1e3),
      apiContactsList("merchants", key, 1, 1e3),
      apiContactsList("others", key, 1, 1e3)
    ]);
    const currList = contactsData[contactsTab] || [];
    if (currList.length === 0) {
      const tabs = ["customers", "merchants", "others"];
      for (const t of tabs) {
        if (contactsData[t] && contactsData[t].length > 0) {
          contactsTab = t;
          document.querySelectorAll("#page-contacts .tabs .tab").forEach((x) => {
            x.classList.toggle("active", x.getAttribute("data-tab") === t);
          });
          break;
        }
      }
    }
  } else {
    await apiContactsList(contactsTab, "", 1, 5e3);
  }
  const fresh = contactsData[contactsTab] || [];
  const filtered = fresh.filter((x) => {
    if (!key) return true;
    const k = String(key).toLowerCase();
    return [x.name, x.company, x.code, x.contact, x.phone, x.sales].some((v) => String(v || "").toLowerCase().includes(k));
  });
  const ordered = filtered.slice();
  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / contactsPageSize));
  if (contactsPage > totalPages) contactsPage = totalPages;
  const startIdx = (contactsPage - 1) * contactsPageSize;
  const data = ordered.slice(startIdx, startIdx + contactsPageSize);
  const gp = document.getElementById("global-pager");
  const sel = document.getElementById("ct-sales");
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">\u8BF7\u9009\u62E9\u4E1A\u52A1\u5458</option>';
    (salesData || []).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }
  contactsRows.innerHTML = "";
  if (data.length === 0) {
    const emptyTr = document.createElement("tr");
    emptyTr.className = "empty";
    const emptyTd = document.createElement("td");
    emptyTd.colSpan = 13;
    emptyTd.textContent = key ? "\u5F80\u6765\u5355\u4F4D\u4E2D\u6CA1\u6709\u641C\u7D22\u7ED3\u679C" : "\u6682\u65E0\u6570\u636E";
    emptyTr.appendChild(emptyTd);
    contactsRows.appendChild(emptyTr);
  }
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const tr = document.createElement("tr");
    const serialNum = total - (startIdx + i);
    const tdSerial = document.createElement("td");
    tdSerial.textContent = serialNum;
    tdSerial.style.color = "#94a3b8";
    tdSerial.style.fontWeight = "500";
    tr.appendChild(tdSerial);
    const ops = document.createElement("td");
    ops.className = "actions";
    ops.innerHTML = '<a href="#" class="link-blue">\u7F16\u8F91</a><a href="#" class="link-red">\u5220\u9664</a><a href="#" class="link-blue link-merge">\u5408\u5E76</a><a href="#" class="link-green">\u8BA2\u5355\u8BB0\u5F55</a><a href="#" class="link-orange">\u91D1\u989D\u8BB0\u5F55</a>';
    let createdDate = r.created || "";
    if (createdDate.length > 10) {
      createdDate = createdDate.substring(0, 10);
    }
    const cells = [r.name, r.company || "", r.city, r.remark || "", r.sales || "-", partnerTotal(r.name), partnerArrears(r.name, r.owner || ""), createdDate];
    cells.forEach((v, idx) => {
      const td = document.createElement("td");
      if (idx === 0 || idx === 1) {
        const text = String(v || "");
        if (idx === 1) {
          const companyValue = document.createElement("span");
          companyValue.className = "contact-company-value";
          companyValue.textContent = text;
          companyValue.title = text;
          td.appendChild(companyValue);
        } else if (text.length > 30) {
          td.textContent = text.substring(0, 30) + "...";
          td.title = text;
        } else {
          td.textContent = text;
        }
        td.style.maxWidth = "250px";
        td.style.whiteSpace = "nowrap";
        td.style.overflow = "hidden";
        td.style.textOverflow = "ellipsis";
      } else if (idx === 6) {
        const num = parseFloat(String(v));
        if (isFinite(num) && num <= 0) {
          td.textContent = "-";
        } else {
          td.textContent = Number.isFinite(num) ? num.toFixed(2) : String(v || "");
          td.style.color = "#ef4444";
        }
      } else {
        td.textContent = String(v || "");
      }
      tr.appendChild(td);
    });
    tr.appendChild(ops);
    tr.draggable = true;
    tr.style.cursor = "grab";
    tr.addEventListener("dragstart", (e) => {
      tr.style.opacity = "0.5";
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({ id: r.id, currentType: contactsTab }));
    });
    tr.addEventListener("dragend", (e) => {
      tr.style.opacity = "1";
    });
    contactsRows.appendChild(tr);
    const del = ops.querySelector(".link-red");
    del.addEventListener("click", (e) => {
      e.preventDefault();
      pendingDeleteIndex = contactsData[contactsTab].indexOf(r);
      pendingDeleteTab = contactsTab;
      confirmModal.style.display = "flex";
    });
    const edit = ops.querySelector(".link-blue");
    edit.addEventListener("click", (e) => {
      e.preventDefault();
      const i2 = contactsData[contactsTab].indexOf(r);
      if (i2 >= 0) {
        editingIndex = i2;
        editingTab = contactsTab;
        fillContactsForm(r);
        if (ctModalTitle) ctModalTitle.textContent = "\u7F16\u8F91" + (contactsTab === "customers" ? "\u5BA2\u6237" : contactsTab === "merchants" ? "\u5546\u5BB6" : "\u5F80\u6765\u5355\u4F4D");
        if (ctSubmitBtn) ctSubmitBtn.textContent = "\u4FDD\u5B58";
        if (ctModal) ctModal.style.display = "flex";
      }
    });
    const mergeLink = ops.querySelector(".link-merge");
    mergeLink == null ? void 0 : mergeLink.addEventListener("click", (e) => {
      e.preventDefault();
      const sourceName = String((r == null ? void 0 : r.name) || "").trim();
      if (!sourceName) return alert("\u6E90\u5BA2\u6237\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
      const targetName = String(prompt(`\u8BF7\u8F93\u5165\u8981\u628A\u201C${sourceName}\u201D\u5408\u5E76\u5230\u54EA\u4E2A${contactsTab === "customers" ? "\u5BA2\u6237" : contactsTab === "merchants" ? "\u5546\u5BB6" : "\u5F80\u6765\u5355\u4F4D"}\u540D\u79F0\uFF1F`, "") || "").trim();
      if (!targetName) return;
      if (targetName === sourceName) return alert("\u4E0D\u80FD\u5408\u5E76\u5230\u81EA\u5DF1");
      openConfirm(`\u786E\u8BA4\u628A\u201C${sourceName}\u201D\u5408\u5E76\u5230\u201C${targetName}\u201D\u5417\uFF1F
\u8FD9\u4F1A\u8F6C\u79FB\u5386\u53F2\u8BB0\u5F55\u5E76\u5220\u9664\u6E90\u8BB0\u5F55\uFF0C\u4E14\u4E0D\u53EF\u6062\u590D\u3002`, async () => {
        const result = await apiContactsMerge(r.id, targetName);
        if (!(result == null ? void 0 : result.ok)) {
          if ((result == null ? void 0 : result.error) === "target_not_found") return alert(`\u672A\u627E\u5230\u76EE\u6807\u540D\u79F0\uFF1A${targetName}`);
          if ((result == null ? void 0 : result.error) === "same_contact") return alert("\u4E0D\u80FD\u5408\u5E76\u5230\u81EA\u5DF1");
          return alert("\u5408\u5E76\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
        }
        await apiContactsList(contactsTab, (contactsSearch == null ? void 0 : contactsSearch.value) || "", 1, 5e3);
        renderContacts();
        saveJSON("contactsData", contactsData);
        alert(formatContactMergeMessage(result));
      });
    });
    const ordersLink = ops.querySelector(".link-green");
    ordersLink.addEventListener("click", (e) => {
      e.preventDefault();
      const n = encodeURIComponent(r.name || "");
      location.hash = "#partner-orders:" + n;
    });
    const amountLink = ops.querySelector(".link-orange");
    amountLink.addEventListener("click", (e) => {
      e.preventDefault();
      openAmountHistory(r.name, r.owner || "");
    });
  }
  const pager = document.getElementById("global-pager-controls");
  const isContactsVisible = ((_a2 = document.getElementById("page-contacts")) == null ? void 0 : _a2.style.display) === "block";
  if (pager && isContactsVisible) {
    pager.innerHTML = "";
    const makeBtn = (label, page, disabled = false, active = false) => {
      const b = document.createElement("a");
      b.href = "#";
      b.textContent = label;
      b.style.padding = "4px 8px";
      b.style.border = "1px solid #334155";
      b.style.borderRadius = "4px";
      b.style.color = active ? "#000" : "#cbd5e1";
      b.style.background = active ? "#cbd5e1" : "transparent";
      b.style.pointerEvents = disabled ? "none" : "auto";
      b.style.opacity = disabled ? "0.4" : "1";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        contactsPage = page;
        renderContacts();
      });
      pager.appendChild(b);
    };
    makeBtn("\xAB", Math.max(1, contactsPage - 1), contactsPage <= 1);
    const maxButtons = 9;
    let start = Math.max(1, contactsPage - Math.floor(maxButtons / 2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    for (let p = start; p <= end; p++) makeBtn(String(p), p, false, p === contactsPage);
    makeBtn("\xBB", Math.min(totalPages, contactsPage + 1), contactsPage >= totalPages);
  }
  const infoEl = document.getElementById("pay-footer-info");
  if (infoEl) {
    const todayStr = (() => {
      const d = /* @__PURE__ */ new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    })();
    const toTs = (x) => {
      const t = Date.parse(x.created || "");
      return Number.isFinite(t) ? t : 0;
    };
    const listAll = fresh || [];
    const totalCount = listAll.length;
    const todayCount = listAll.filter((x) => {
      const t = toTs(x);
      if (!t) return false;
      const d = new Date(t);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}` === todayStr;
    }).length;
    const latestTs = Math.max(0, ...listAll.map(toTs));
    const latestCount = latestTs ? listAll.filter((x) => toTs(x) === latestTs).length : totalCount ? 1 : 0;
    const mk = (text) => {
      const s = document.createElement("span");
      s.className = "info-pill";
      s.textContent = text;
      return s;
    };
    infoEl.innerHTML = "";
    infoEl.appendChild(mk(`\u5171 ${totalCount} \u6761\u8BB0\u5F55`));
    infoEl.appendChild(mk(`\u4ECA\u65E5\u4E0A\u4F20 ${todayCount} \u6761`));
    infoEl.appendChild(mk(`\u6700\u540E\u6B21\u4E0A\u4F20 ${latestCount} \u6761`));
  }
}
confirmCancel == null ? void 0 : confirmCancel.addEventListener("click", () => {
  confirmModal.style.display = "none";
  pendingDeleteIndex = null;
  pendingDeleteTab = null;
});
confirmOk == null ? void 0 : confirmOk.addEventListener("click", async () => {
  if (pendingDeleteIndex !== null && pendingDeleteTab) {
    const target = contactsData[pendingDeleteTab][pendingDeleteIndex];
    const name = (target == null ? void 0 : target.name) || "";
    const ownerLabel = (target == null ? void 0 : target.owner) || "";
    const result = await apiContactsDeleteByName(ownerLabel || (pendingDeleteTab === "customers" ? "\u5BA2\u6237" : pendingDeleteTab === "merchants" ? "\u5546\u5BB6" : "\u5176\u5B83"), name);
    if (!(result == null ? void 0 : result.ok)) {
      if ((result == null ? void 0 : result.error) === "in_use") alert(formatContactUsageMessage(result == null ? void 0 : result.usage));
      else alert("\u5220\u9664\u5931\u8D25");
    } else {
      contactsData[pendingDeleteTab].splice(pendingDeleteIndex, 1);
      await apiContactsList(pendingDeleteTab, (contactsSearch == null ? void 0 : contactsSearch.value) || "", 1, 5e3);
      renderContacts();
      saveJSON("contactsData", contactsData);
    }
  }
  confirmModal.style.display = "none";
  pendingDeleteIndex = null;
  pendingDeleteTab = null;
});
document.querySelectorAll(".tab[data-tab]").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    contactsTab = b.getAttribute("data-tab");
    contactsPage = 1;
    renderContacts();
  });
});
contactsSearch == null ? void 0 : contactsSearch.addEventListener("input", () => {
  contactsPage = 1;
  renderContacts();
});
const ctForm = document.getElementById("contacts-form");
const ctSubmitBtn = document.getElementById("contacts-submit");
const ctSubmitTop = document.getElementById("contacts-submit-top");
const ctModal = document.getElementById("contacts-modal");
const ctModalClose = document.getElementById("ct-modal-close");
const ctModalTitle = document.getElementById("ct-modal-title");
let tempContactNotes = [];
let editingNoteId = null;
if (ctModalClose) ctModalClose.addEventListener("click", () => {
  if (ctModal) ctModal.style.display = "none";
});
let editingIndex = null;
let editingTab = null;
let currentContactShippingAddresses = [];
let currentContactShippingEditIndex = -1;
let currentContactShippingFieldEntryId = "";
function makeContactShippingAddressId() {
  return `ship_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeContactShippingAddressEntry(entry = {}, index = 0) {
  const x = entry && typeof entry === "object" ? entry : {};
  return {
    id: String(x.id || makeContactShippingAddressId()),
    address: String(x.address || "").trim(),
    zip: String(x.zip || "").trim(),
    city: String(x.city || "").trim(),
    province: String(x.province || "").trim(),
    country: String(x.country || "").trim(),
    phone: String(x.phone || "").trim(),
    contact: String(x.contact || "").trim(),
    business_hours: String(x.business_hours || x.businessHours || "").trim(),
    is_default: x.is_default === void 0 ? index === 0 : Boolean(x.is_default)
  };
}
function contactShippingAddressHasContent(entry = {}) {
  return !!(entry.address || entry.zip || entry.city || entry.province || entry.country || entry.phone || entry.contact || entry.business_hours);
}
function parseContactShippingAddresses(contact = null) {
  let list = contact == null ? void 0 : contact.shipping_addresses;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch (e) {
      list = [];
    }
  }
  list = (Array.isArray(list) ? list : []).map((item, index) => normalizeContactShippingAddressEntry(item, index)).filter(contactShippingAddressHasContent);
  if (list.length === 0 && contact) {
    const legacy = normalizeContactShippingAddressEntry({
      address: contact.ship_address,
      zip: contact.ship_zip,
      city: contact.ship_city,
      province: contact.ship_province,
      country: contact.ship_country,
      phone: contact.ship_phone,
      contact: contact.ship_contact,
      is_default: true
    }, 0);
    if (contactShippingAddressHasContent(legacy)) list = [legacy];
  }
  if (list.length > 0) {
    const defaultIndex = list.findIndex((item) => item.is_default);
    list = list.map((item, index) => ({ ...item, is_default: index === (defaultIndex >= 0 ? defaultIndex : 0) }));
  }
  return list;
}
function getDefaultContactShippingAddress(contact = null) {
  const list = parseContactShippingAddresses(contact);
  return list.find((item) => item.is_default) || list[0] || null;
}
function syncLegacyShippingFieldsFromList(target, shippingAddresses = []) {
  const list = (Array.isArray(shippingAddresses) ? shippingAddresses : []).map((item, index) => normalizeContactShippingAddressEntry(item, index)).filter(contactShippingAddressHasContent);
  const defaultEntry = list.find((item) => item.is_default) || list[0] || null;
  target.shipping_addresses = list;
  target.ship_address = defaultEntry ? defaultEntry.address : "";
  target.ship_zip = defaultEntry ? defaultEntry.zip : "";
  target.ship_city = defaultEntry ? defaultEntry.city : "";
  target.ship_province = defaultEntry ? defaultEntry.province : "";
  target.ship_country = defaultEntry ? defaultEntry.country : "";
  target.ship_phone = defaultEntry ? defaultEntry.phone : "";
  target.ship_contact = defaultEntry ? defaultEntry.contact : "";
  return target;
}
function getCurrentContactShippingAddressFields() {
  return normalizeContactShippingAddressEntry({
    id: currentContactShippingEditIndex >= 0 && currentContactShippingAddresses[currentContactShippingEditIndex] ? currentContactShippingAddresses[currentContactShippingEditIndex].id : currentContactShippingFieldEntryId || makeContactShippingAddressId(),
    address: (document.getElementById("ct-ship-address") || {}).value || "",
    zip: (document.getElementById("ct-ship-zip") || {}).value || "",
    city: (document.getElementById("ct-ship-city") || {}).value || "",
    province: (document.getElementById("ct-ship-province") || {}).value || "",
    country: (document.getElementById("ct-ship-country") || {}).value || "",
    phone: (document.getElementById("ct-ship-phone") || {}).value || "",
    contact: (document.getElementById("ct-ship-contact") || {}).value || "",
    business_hours: (document.getElementById("ct-ship-business-hours") || {}).value || "",
    is_default: currentContactShippingEditIndex >= 0 ? !!(currentContactShippingAddresses[currentContactShippingEditIndex] || {}).is_default : currentContactShippingAddresses.length === 0
  });
}
function setCurrentContactShippingAddressFields(entry = null) {
  const item = entry || { address: "", zip: "", city: "", province: "", country: "", phone: "", contact: "", business_hours: "" };
  currentContactShippingFieldEntryId = String(item.id || "");
  document.getElementById("ct-ship-address").value = item.address || "";
  document.getElementById("ct-ship-zip").value = item.zip || "";
  document.getElementById("ct-ship-city").value = item.city || "";
  document.getElementById("ct-ship-province").value = item.province || "";
  document.getElementById("ct-ship-country").value = item.country || "";
  document.getElementById("ct-ship-phone").value = item.phone || "";
  document.getElementById("ct-ship-contact").value = item.contact || "";
  document.getElementById("ct-ship-business-hours").value = item.business_hours || "";
}
function clearCurrentContactShippingAddressFields() {
  setCurrentContactShippingAddressFields(null);
  currentContactShippingEditIndex = -1;
  currentContactShippingFieldEntryId = "";
  const addBtn = document.getElementById("ct-ship-address-add");
  if (addBtn) addBtn.textContent = "添加地址";
}
function renderContactShippingAddressList() {
  const listEl = document.getElementById("ct-shipping-address-list");
  const addBtn = document.getElementById("ct-ship-address-add");
  if (!listEl) return;
  if (addBtn) addBtn.textContent = currentContactShippingEditIndex >= 0 ? "更新地址" : "添加地址";
  listEl.innerHTML = "";
  if (!currentContactShippingAddresses.length) {
    listEl.innerHTML = '<div style="padding:12px; text-align:center; color:#64748b">暂无送货地址</div>';
    return;
  }
  currentContactShippingAddresses.forEach((item, index) => {
    const row = document.createElement("div");
    row.style.border = "1px solid var(--line)";
    row.style.borderRadius = "8px";
    row.style.padding = "10px";
    row.style.background = index === currentContactShippingEditIndex ? "rgba(37,99,235,0.12)" : "rgba(15,23,42,0.85)";
    const title = document.createElement("div");
    title.style.display = "flex";
    title.style.justifyContent = "space-between";
    title.style.alignItems = "center";
    title.style.gap = "8px";
    title.innerHTML = `<div style="color:#e2e8f0; font-size:13px">${escapeHtml(item.address || "未填写街道地址")}</div><div style="display:flex; gap:6px; align-items:center">${item.is_default ? '<span style="font-size:12px; color:#22c55e">默认地址</span>' : ""}</div>`;
    const sub = document.createElement("div");
    sub.style.marginTop = "6px";
    sub.style.fontSize = "12px";
    sub.style.color = "#94a3b8";
    sub.textContent = [item.zip, item.city, item.province, item.country, item.contact, item.phone, item.business_hours ? `营业时间: ${item.business_hours}` : ""].filter(Boolean).join("  ");
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "8px";
    actions.innerHTML = `<button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px">${item.is_default ? "默认中" : "设默认"}</button><button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px">编辑</button><button type="button" class="btn-secondary" style="padding:4px 10px; font-size:12px; color:#f87171">删除</button>`;
    const [defaultBtn, editBtn, deleteBtn] = actions.querySelectorAll("button");
    defaultBtn.disabled = item.is_default;
    defaultBtn.addEventListener("click", () => {
      currentContactShippingAddresses = currentContactShippingAddresses.map((addr, addrIndex) => ({ ...addr, is_default: addrIndex === index }));
      renderContactShippingAddressList();
    });
    editBtn.addEventListener("click", () => {
      currentContactShippingEditIndex = index;
      setCurrentContactShippingAddressFields(item);
      renderContactShippingAddressList();
    });
    deleteBtn.addEventListener("click", () => {
      currentContactShippingAddresses.splice(index, 1);
      if (!currentContactShippingAddresses.some((addr) => addr.is_default) && currentContactShippingAddresses[0]) currentContactShippingAddresses[0].is_default = true;
      if (currentContactShippingEditIndex === index) clearCurrentContactShippingAddressFields();
      else if (currentContactShippingEditIndex > index) currentContactShippingEditIndex -= 1;
      renderContactShippingAddressList();
    });
    row.appendChild(title);
    row.appendChild(sub);
    row.appendChild(actions);
    listEl.appendChild(row);
  });
}
function collectContactShippingAddressesForSubmit() {
  let list = currentContactShippingAddresses.map((item, index) => normalizeContactShippingAddressEntry(item, index)).filter(contactShippingAddressHasContent);
  const currentEntry = getCurrentContactShippingAddressFields();
  if (contactShippingAddressHasContent(currentEntry)) {
    if (currentContactShippingEditIndex >= 0 && list[currentContactShippingEditIndex]) list[currentContactShippingEditIndex] = { ...currentEntry, is_default: !!list[currentContactShippingEditIndex].is_default };
    else if (currentEntry.id) {
      const boundIndex = list.findIndex((item) => String(item.id || "") === String(currentEntry.id || ""));
      if (boundIndex >= 0) list[boundIndex] = { ...currentEntry, is_default: !!list[boundIndex].is_default };
      else if (!list.some((item) => item.address === currentEntry.address && item.zip === currentEntry.zip && item.city === currentEntry.city && item.contact === currentEntry.contact && item.phone === currentEntry.phone && item.business_hours === currentEntry.business_hours)) list.push({ ...currentEntry, is_default: list.length === 0 });
    }
    else if (!list.some((item) => item.address === currentEntry.address && item.zip === currentEntry.zip && item.city === currentEntry.city && item.contact === currentEntry.contact && item.phone === currentEntry.phone && item.business_hours === currentEntry.business_hours)) list.push({ ...currentEntry, is_default: list.length === 0 });
  }
  if (list.length > 0) {
    const defaultIndex = list.findIndex((item) => item.is_default);
    list = list.map((item, index) => ({ ...item, is_default: index === (defaultIndex >= 0 ? defaultIndex : 0) }));
  }
  return list;
}
function decorateContactShippingData(contact = {}) {
  return syncLegacyShippingFieldsFromList({ ...contact }, parseContactShippingAddresses(contact));
}
function fillContactsForm(r) {
  const contactData = decorateContactShippingData(r || {});
  tempContactNotes = [];
  editingNoteId = null;
  document.getElementById("ct-id").value = contactData.id || "";
  document.getElementById("ct-name").value = contactData.name || "";
  document.getElementById("ct-company").value = contactData.company || "";
  document.getElementById("ct-code").value = contactData.code || "";
  document.getElementById("ct-contact").value = contactData.contact || "";
  document.getElementById("ct-phone").value = contactData.phone || "";
  document.getElementById("ct-country").value = contactData.country || "";
  document.getElementById("ct-address").value = contactData.address || "";
  document.getElementById("ct-zip").value = contactData.zip || "";
  document.getElementById("ct-city").value = contactData.city || "";
  document.getElementById("ct-remark").value = contactData.remark || "";
  document.getElementById("ct-email").value = contactData.email || "";
  document.getElementById("ct-province").value = contactData.province || "";
  document.getElementById("ct-invoice-nota").value = contactData.invoice_nota || "";
  currentContactShippingAddresses = parseContactShippingAddresses(contactData);
  const defaultShippingIndex = currentContactShippingAddresses.findIndex((item) => item.is_default);
  const defaultShippingEntry = currentContactShippingAddresses[defaultShippingIndex >= 0 ? defaultShippingIndex : 0] || null;
  currentContactShippingEditIndex = -1;
  currentContactShippingFieldEntryId = String((defaultShippingEntry == null ? void 0 : defaultShippingEntry.id) || "");
  setCurrentContactShippingAddressFields(defaultShippingEntry);
  renderContactShippingAddressList();
  const ctShipSame2 = document.getElementById("ct-ship-same");
  if (ctShipSame2) {
    const defaultShip = getDefaultContactShippingAddress(contactData) || {};
    const sAddr = defaultShip.address || "";
    const sZip = defaultShip.zip || "";
    const sCity = defaultShip.city || "";
    const sProv = defaultShip.province || "";
    const sCountry = defaultShip.country || "";
    const sPhone2 = defaultShip.phone || "";
    const sContact = defaultShip.contact || "";
    const cAddr = contactData.address || "";
    const cZip = contactData.zip || "";
    const cCity = contactData.city || "";
    const cProv = contactData.province || "";
    const cCountry = contactData.country || "";
    const cPhone = contactData.phone || "";
    const cContact = contactData.contact || "";
    const isSame = sAddr === cAddr && sZip === cZip && sCity === cCity && sProv === cProv && sCountry === cCountry && sPhone2 === cPhone && sContact === cContact;
    const hasContent = sAddr || sZip || sCity || sProv || sCountry || sPhone2 || sContact;
    ctShipSame2.checked = isSame && hasContent;
  }
  const ctSales2 = document.getElementById("ct-sales");
  if (ctSales2) ctSales2.value = contactData.sales || "";
  const ctPrice = document.getElementById("ct-price");
  if (ctPrice) ctPrice.value = contactData.use_price || "price1";
  const ctIva = document.getElementById("ct-iva");
  if (ctIva) {
    if (contactData.is_iva === false || String(contactData.is_iva) === "false") {
      ctIva.value = "false";
    } else {
      ctIva.value = "true";
    }
  }
  loadContactNotes(contactData.id);
}
function clearContactsForm() {
  tempContactNotes = [];
  editingNoteId = null;
  document.getElementById("ct-id").value = "";
  ["ct-name", "ct-company", "ct-code", "ct-contact", "ct-phone", "ct-country", "ct-address", "ct-zip", "ct-city", "ct-remark", "ct-email", "ct-province", "ct-ship-address", "ct-ship-zip", "ct-ship-city", "ct-ship-province", "ct-ship-country", "ct-ship-phone", "ct-ship-contact", "ct-ship-business-hours", "ct-invoice-nota"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  currentContactShippingAddresses = [];
  currentContactShippingEditIndex = -1;
  currentContactShippingFieldEntryId = "";
  renderContactShippingAddressList();
  const ctShipSame2 = document.getElementById("ct-ship-same");
  if (ctShipSame2) ctShipSame2.checked = false;
  const ctSales2 = document.getElementById("ct-sales");
  if (ctSales2) ctSales2.value = "";
  const ctPrice = document.getElementById("ct-price");
  if (ctPrice) ctPrice.value = "price1";
  const ctIva = document.getElementById("ct-iva");
  if (ctIva) ctIva.value = "true";
  document.querySelectorAll(".group.error").forEach((el) => el.classList.remove("error"));
  document.querySelectorAll(".shake").forEach((el) => el.classList.remove("shake"));
  loadContactNotes(null);
  document.getElementById("ct-note-input-area").style.display = "none";
}
const ctUploadBtn = document.getElementById("contacts-upload-btn");
const ctUploadModal = document.getElementById("contacts-upload-modal");
const ctUploadConfirm = document.getElementById("ct-upload-confirm");
const ctUploadFile = document.getElementById("ct-upload-file");
const ctUploadType = document.getElementById("ct-upload-type");
ctUploadBtn == null ? void 0 : ctUploadBtn.addEventListener("click", () => {
  if (ctUploadModal) {
    ctUploadType.value = contactsTab;
    ctUploadFile.value = "";
    ctUploadModal.style.display = "flex";
  }
});
ctUploadConfirm == null ? void 0 : ctUploadConfirm.addEventListener("click", async () => {
  if (!ctUploadFile.files.length) return alert("\u8BF7\u5148\u9009\u62E9\u6587\u4EF6");
  const file = ctUploadFile.files[0];
  const typeVal = ctUploadType.value;
  const ownerLabel = typeVal === "merchants" ? "\u5546\u5BB6" : typeVal === "others" ? "\u5176\u5B83" : "\u5BA2\u6237";
  ctUploadConfirm.disabled = true;
  ctUploadConfirm.textContent = "\u4E0A\u4F20\u4E2D...";
  try {
    const params = new URLSearchParams({ tab: typeVal, size: "5000" });
    const existList = await apiFetchJSON("/api/contacts?" + params.toString());
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);
        if (json.length === 0) {
          alert("\u8868\u683C\u4E3A\u7A7A");
          return;
        }
        let successCount = 0;
        let updateCount = 0;
        for (const row of json) {
          const name = String(row["\u5E97\u540D"] || "").trim();
          const company = String(row["\u516C\u53F8\u540D\u79F0"] || "").trim();
          if (!name && !company) continue;
          const code = String(row["\u7A0E\u53F7"] || "").trim();
          const email = String(row["\u90AE\u7BB1"] || "").trim();
          const is_iva = String(row["\u662F\u5426 IVA"] || "").trim() === "\u662F";
          let use_price = "price1";
          const priceVal = String(row["\u4F7F\u7528\u4EF7\u683C"] || "").trim();
          if (["1", "\u4EF7\u683C1", "price1"].includes(priceVal)) use_price = "price1";
          else if (["2", "\u4EF7\u683C2", "price2"].includes(priceVal)) use_price = "price2";
          else if (["3", "\u4EF7\u683C3", "price3"].includes(priceVal)) use_price = "price3";
          else if (["4", "\u4EF7\u683C4", "price4"].includes(priceVal)) use_price = "price4";
          const sales = String(row["\u4E1A\u52A1\u5458"] || "").trim();
          const address = String(row["\u8857\u9053\u5730\u5740"] || "").trim();
          const zip = String(row["\u90AE\u7F16"] || "").trim();
          const city = String(row["\u57CE\u5E02"] || "").trim();
          const province = String(row["\u7701\u4EFD"] || "").trim();
          const country = String(row["\u56FD\u5BB6"] || "").trim();
          const phone = String(row["\u7535\u8BDD"] || "").trim();
          const contact = String(row["\u8054\u7CFB\u4EBA"] || "").trim();
          const remark = String(row["\u5907\u6CE8 (\u5F00\u7968\u65F6\u63D0\u793A)"] || "").trim();
          const sameAddr = String(row["\u4E0E\u516C\u53F8\u5730\u5740\u76F8\u540C"] || "").trim() === "\u662F";
          const contactObj = {
            name: name || company,
            // Fallback if no store name
            company,
            code,
            email,
            is_iva,
            use_price,
            sales,
            address,
            zip,
            city,
            province,
            country,
            phone,
            contact,
            remark,
            owner: ownerLabel,
            ship_address: sameAddr ? address : "",
            ship_zip: sameAddr ? zip : "",
            ship_city: sameAddr ? city : "",
            ship_province: sameAddr ? province : "",
            ship_country: sameAddr ? country : "",
            ship_phone: sameAddr ? phone : "",
            ship_contact: sameAddr ? contact : ""
          };
          const exist = company ? existList.find((c) => c.company === company) : null;
          if (exist) {
            await apiFetchJSON("/api/contacts/by-company", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(contactObj)
            });
            updateCount++;
          } else {
            const now = /* @__PURE__ */ new Date();
            contactObj.created = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
            await apiFetchJSON("/api/contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(contactObj)
            });
            successCount++;
          }
        }
        alert(`\u4E0A\u4F20\u5B8C\u6210\uFF01
\u65B0\u589E: ${successCount} \u6761
\u66F4\u65B0: ${updateCount} \u6761`);
        ctUploadModal.style.display = "none";
        await apiContactsList(contactsTab, (contactsSearch == null ? void 0 : contactsSearch.value) || "", 1, 5e3);
        renderContacts();
      } catch (err) {
        console.error(err);
        alert("\u89E3\u6790\u6216\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8868\u683C\u683C\u5F0F");
      } finally {
        ctUploadConfirm.disabled = false;
        ctUploadConfirm.textContent = "\u4E00\u952E\u4E0A\u4F20";
      }
    };
    reader.readAsArrayBuffer(file);
  } catch (err) {
    console.error(err);
    alert("\u83B7\u53D6\u73B0\u6709\u8054\u7CFB\u4EBA\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
    ctUploadConfirm.disabled = false;
    ctUploadConfirm.textContent = "\u4E00\u952E\u4E0A\u4F20";
  }
});
ctSubmitTop == null ? void 0 : ctSubmitTop.addEventListener("click", () => {
  clearContactsForm();
  editingIndex = null;
  editingTab = null;
  if (ctModalTitle) ctModalTitle.textContent = "\u65B0\u589E" + (contactsTab === "customers" ? "\u5BA2\u6237" : contactsTab === "merchants" ? "\u5546\u5BB6" : "\u5F80\u6765\u5355\u4F4D");
  if (ctSubmitBtn) ctSubmitBtn.textContent = "\u4FDD\u5B58";
  if (ctModal) ctModal.style.display = "flex";
});
ctForm == null ? void 0 : ctForm.addEventListener("submit", async (e) => {
  var _a2, _b2, _c2, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
  e.preventDefault();
  document.querySelectorAll(".group.error").forEach((el) => el.classList.remove("error"));
  document.querySelectorAll(".shake").forEach((el) => el.classList.remove("shake"));
  const name = document.getElementById("ct-name").value.trim();
  const company = document.getElementById("ct-company").value.trim();
  const code = document.getElementById("ct-code").value.trim();
  const contact = document.getElementById("ct-contact").value.trim();
  const phone = document.getElementById("ct-phone").value.trim();
  const country = document.getElementById("ct-country").value.trim();
  const address = document.getElementById("ct-address").value.trim();
  const zip = document.getElementById("ct-zip").value.trim();
  const city = document.getElementById("ct-city").value.trim();
  const remark = document.getElementById("ct-remark").value.trim();
  const invoice_nota = (((_a2 = document.getElementById("ct-invoice-nota")) == null ? void 0 : _a2.value) || "").trim();
  const email = (((_b2 = document.getElementById("ct-email")) == null ? void 0 : _b2.value) || "").trim();
  const province = (((_c2 = document.getElementById("ct-province")) == null ? void 0 : _c2.value) || "").trim();
  const ship_address = (((_d = document.getElementById("ct-ship-address")) == null ? void 0 : _d.value) || "").trim();
  const ship_zip = (((_e = document.getElementById("ct-ship-zip")) == null ? void 0 : _e.value) || "").trim();
  const ship_city = (((_f = document.getElementById("ct-ship-city")) == null ? void 0 : _f.value) || "").trim();
  const ship_province = (((_g = document.getElementById("ct-ship-province")) == null ? void 0 : _g.value) || "").trim();
  const ship_country = (((_h = document.getElementById("ct-ship-country")) == null ? void 0 : _h.value) || "").trim();
  const ship_phone = (((_i = document.getElementById("ct-ship-phone")) == null ? void 0 : _i.value) || "").trim();
  const ship_contact = (((_j = document.getElementById("ct-ship-contact")) == null ? void 0 : _j.value) || "").trim();
  const shipping_addresses = collectContactShippingAddressesForSubmit();
  const shippingTarget = syncLegacyShippingFieldsFromList({
    ship_address,
    ship_zip,
    ship_city,
    ship_province,
    ship_country,
    ship_phone,
    ship_contact
  }, shipping_addresses);
  const sales = (((_k = document.getElementById("ct-sales")) == null ? void 0 : _k.value) || "").trim();
  const use_price = (((_l = document.getElementById("ct-price")) == null ? void 0 : _l.value) || "price1").trim();
  const is_iva = ((_m = document.getElementById("ct-iva")) == null ? void 0 : _m.value) === "true";
  let isValid = true;
  const requiredFields = [
    { id: "ct-name", val: name }
  ];
  requiredFields.forEach((f) => {
    if (!f.val) {
      isValid = false;
      const el = document.getElementById(f.id);
      if (el) {
        const group = el.closest(".group");
        if (group) {
          group.classList.add("error");
          void group.offsetWidth;
          group.classList.add("shake");
        }
      }
    }
  });
  if (!isValid) return;
  try {
    if (editingIndex !== null) {
      const target = (_n = contactsData[editingTab]) == null ? void 0 : _n[editingIndex];
      const id = document.getElementById("ct-id").value;
      await apiContactsUpdateById(id, { name, company, code, contact, phone, city, remark, invoice_nota, owner: contactsTab === "customers" ? "\u5BA2\u6237" : contactsTab === "merchants" ? "\u5546\u5BB6" : "\u5176\u5B83", country, address, zip, sales: sales || "", use_price, is_iva, email, province, ship_address: shippingTarget.ship_address, ship_zip: shippingTarget.ship_zip, ship_city: shippingTarget.ship_city, ship_province: shippingTarget.ship_province, ship_country: shippingTarget.ship_country, ship_phone: shippingTarget.ship_phone, ship_contact: shippingTarget.ship_contact, shipping_addresses });
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
        target.sales = sales || "";
        target.use_price = use_price;
        target.is_iva = is_iva;
        target.email = email;
        target.province = province;
        syncLegacyShippingFieldsFromList(target, shipping_addresses);
      }
      currentContactShippingAddresses = shipping_addresses.map((item, index) => normalizeContactShippingAddressEntry(item, index));
      editingIndex = null;
      editingTab = null;
      ctSubmitBtn.textContent = "\u4FDD\u5B58";
    } else {
      const now = /* @__PURE__ */ new Date();
      const created = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      const newContact = { name, contact, phone, city, remark, invoice_nota, owner: contactsTab === "customers" ? "\u5BA2\u6237" : contactsTab === "merchants" ? "\u5546\u5BB6" : "\u5176\u5B83", created, company, code, country, address, zip, sales: sales || "", use_price, is_iva, email, province, ship_address: shippingTarget.ship_address, ship_zip: shippingTarget.ship_zip, ship_city: shippingTarget.ship_city, ship_province: shippingTarget.ship_province, ship_country: shippingTarget.ship_country, ship_phone: shippingTarget.ship_phone, ship_contact: shippingTarget.ship_contact, shipping_addresses };
      const newId = await apiContactsCreate(newContact);
      syncLegacyShippingFieldsFromList(newContact, shipping_addresses);
      newContact.id = newId || "";
      contactsData[contactsTab].push(newContact);
      if (newId && tempContactNotes.length > 0) {
        for (const n of tempContactNotes) {
          await apiFetchJSON(`/api/contacts/${newId}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note: n.note })
          });
        }
      }
    }
  } catch (err) {
    if (((_o = err == null ? void 0 : err.data) == null ? void 0 : _o.error) === "duplicate_name" || (err == null ? void 0 : err.message) === "duplicate_name") {
      alert("\u5E97\u94FA\u540D\u79F0\u5DF2\u7ECF\u5B58\u5728\uFF0C\u8BF7\u786E\u8BA4\u540E\u91CD\u8BD5");
      return;
    }
    alert("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    return;
  }
  clearContactsForm();
  if (ctModal) ctModal.style.display = "none";
  await apiContactsList(contactsTab, (contactsSearch == null ? void 0 : contactsSearch.value) || "", 1, 5e3);
  renderContacts();
  saveJSON("contactsData", contactsData);
});
const ctShipAddressAddBtn = document.getElementById("ct-ship-address-add");
const ctShipAddressClearBtn = document.getElementById("ct-ship-address-clear");
ctShipAddressAddBtn == null ? void 0 : ctShipAddressAddBtn.addEventListener("click", () => {
  const entry = getCurrentContactShippingAddressFields();
  if (!contactShippingAddressHasContent(entry)) {
    alert("请先填写送货地址");
    return;
  }
  if (currentContactShippingEditIndex >= 0 && currentContactShippingAddresses[currentContactShippingEditIndex]) {
    currentContactShippingAddresses[currentContactShippingEditIndex] = { ...entry, is_default: !!currentContactShippingAddresses[currentContactShippingEditIndex].is_default };
    renderContactShippingAddressList();
  } else {
    currentContactShippingAddresses.push({ ...entry, is_default: currentContactShippingAddresses.length === 0 });
    clearCurrentContactShippingAddressFields();
    renderContactShippingAddressList();
  }
});
ctShipAddressClearBtn == null ? void 0 : ctShipAddressClearBtn.addEventListener("click", () => {
  clearCurrentContactShippingAddressFields();
});
const ctShipSame = document.getElementById("ct-ship-same");
if (ctShipSame) {
  ctShipSame.addEventListener("change", () => {
    if (ctShipSame.checked) {
      document.getElementById("ct-ship-address").value = document.getElementById("ct-address").value;
      document.getElementById("ct-ship-zip").value = document.getElementById("ct-zip").value;
      document.getElementById("ct-ship-city").value = document.getElementById("ct-city").value;
      document.getElementById("ct-ship-province").value = document.getElementById("ct-province").value;
      document.getElementById("ct-ship-country").value = document.getElementById("ct-country").value;
      document.getElementById("ct-ship-phone").value = document.getElementById("ct-phone").value;
      document.getElementById("ct-ship-contact").value = document.getElementById("ct-contact").value;
      if (currentContactShippingEditIndex >= 0 && currentContactShippingAddresses[currentContactShippingEditIndex]) {
        currentContactShippingAddresses[currentContactShippingEditIndex] = {
          ...currentContactShippingAddresses[currentContactShippingEditIndex],
          ...getCurrentContactShippingAddressFields()
        };
        renderContactShippingAddressList();
      }
    }
  });
}
const catList = document.getElementById("cat-list");
const addCatBtn = document.getElementById("add-cat");
const categoriesData = [
  { name: "\u6536\u5165", children: ["\u670D\u52A1\u6536\u5165(\u73B0\u91D1)", "\u670D\u52A1\u6536\u5165(\u94F6\u884C)", "\u94F6\u884C\u50A8\u84C4", COMPANY_LOAN_CATEGORY, "\u8BA2\u5355\u6536\u5165", "\u5176\u5B83\u6536\u5165"] },
  { name: "\u5F00\u652F", children: ["\u73B0\u91D1\u5F00\u652F", "\u5458\u5DE5\u5DE5\u8D44", "\u51FA\u5DEE\u8865\u8D34", "\u4EBA\u5DE5\u5F00\u652F", "\u5176\u5B83\u5F00\u652F"] }
];
if (!categoriesData[1].children.includes(COMPANY_REPAYMENT_CATEGORY)) {
  categoriesData[1].children.splice(4, 0, COMPANY_REPAYMENT_CATEGORY);
}
const categorySpanishNameOverrides = { parents: {}, children: {} };
const catModal = document.getElementById("cat-modal");
const catModalTitle = document.getElementById("cat-modal-title");
const catModalInput = document.getElementById("cat-modal-input");
const catModalInputEs = document.getElementById("cat-modal-input-es");
const catModalOk = document.getElementById("cat-modal-ok");
const catModalCancel = document.getElementById("cat-modal-cancel");
let catModalCallback = null;
function getCategoryChildOverrideKey(parentName, childName) {
  return `${String(parentName || "").trim()}__${String(childName || "").trim()}`;
}
function getCategoryParentSpanishName(name) {
  const key = String(name || "").trim();
  return key ? String((categorySpanishNameOverrides.parents || {})[key] || "").trim() : "";
}
function getCategoryChildSpanishName(parentName, childName) {
  const key = getCategoryChildOverrideKey(parentName, childName);
  return key ? String((categorySpanishNameOverrides.children || {})[key] || "").trim() : "";
}
function getCategoryParentByChildName(childName) {
  const key = String(childName || "").trim();
  const parent = categoriesData.find((cat) => Array.isArray(cat.children) && cat.children.includes(key));
  return parent ? String(parent.name || "").trim() : "";
}
function getCategoryDisplayName(name, parentName = "") {
  const zhName = String(name || "").trim();
  if (!zhName) return "";
  const locale = getCurrentAppLocale();
  const resolvedParent = String(parentName || "").trim() || getCategoryParentByChildName(zhName);
  const esName = resolvedParent ? getCategoryChildSpanishName(resolvedParent, zhName) : getCategoryParentSpanishName(zhName);
  return locale === "es-ES" ? esName || zhName : zhName;
}
function formatCategoryNameMarkup(zhName, esName) {
  const zh = String(zhName || "").trim();
  const es = String(esName || "").trim();
  if (!es) return `<div>${zh}</div>`;
  return `<div>${zh}</div><div style="margin-top:4px; font-size:12px; color:#94a3b8">${es}</div>`;
}
function setCategoryParentSpanishName(name, nameEs) {
  const key = String(name || "").trim();
  if (!key) return;
  categorySpanishNameOverrides.parents[key] = String(nameEs || "").trim();
  saveJSON("categorySpanishNameOverrides", categorySpanishNameOverrides);
}
function renameCategoryParentSpanishName(oldName, newName, nameEs) {
  const oldKey = String(oldName || "").trim();
  const newKey = String(newName || "").trim();
  const nextEs = String(nameEs || "").trim();
  const nextChildren = {};
  Object.keys(categorySpanishNameOverrides.children || {}).forEach((key) => {
    if (key.startsWith(`${oldKey}__`)) {
      const childName = key.slice(oldKey.length + 2);
      nextChildren[`${newKey}__${childName}`] = categorySpanishNameOverrides.children[key];
    } else {
      nextChildren[key] = categorySpanishNameOverrides.children[key];
    }
  });
  categorySpanishNameOverrides.children = nextChildren;
  if (oldKey && oldKey !== newKey) delete categorySpanishNameOverrides.parents[oldKey];
  if (newKey) categorySpanishNameOverrides.parents[newKey] = nextEs;
  saveJSON("categorySpanishNameOverrides", categorySpanishNameOverrides);
}
function deleteCategoryParentSpanishName(name) {
  const key = String(name || "").trim();
  if (!key) return;
  delete categorySpanishNameOverrides.parents[key];
  Object.keys(categorySpanishNameOverrides.children || {}).forEach((childKey) => {
    if (childKey.startsWith(`${key}__`)) delete categorySpanishNameOverrides.children[childKey];
  });
  saveJSON("categorySpanishNameOverrides", categorySpanishNameOverrides);
}
function setCategoryChildSpanishName(parentName, childName, nameEs) {
  const key = getCategoryChildOverrideKey(parentName, childName);
  if (!key.trim()) return;
  categorySpanishNameOverrides.children[key] = String(nameEs || "").trim();
  saveJSON("categorySpanishNameOverrides", categorySpanishNameOverrides);
}
function renameCategoryChildSpanishName(parentName, oldChildName, newChildName, nameEs) {
  const oldKey = getCategoryChildOverrideKey(parentName, oldChildName);
  const newKey = getCategoryChildOverrideKey(parentName, newChildName);
  if (oldKey && oldKey !== newKey) delete categorySpanishNameOverrides.children[oldKey];
  if (newKey) categorySpanishNameOverrides.children[newKey] = String(nameEs || "").trim();
  saveJSON("categorySpanishNameOverrides", categorySpanishNameOverrides);
}
function deleteCategoryChildSpanishName(parentName, childName) {
  const key = getCategoryChildOverrideKey(parentName, childName);
  if (!key) return;
  delete categorySpanishNameOverrides.children[key];
  saveJSON("categorySpanishNameOverrides", categorySpanishNameOverrides);
}
function openPrompt(title, value, valueEs, cb) {
  if (catModal) {
    catModalTitle.textContent = title;
    catModalInput.value = value || "";
    if (catModalInputEs) catModalInputEs.value = valueEs || "";
    catModalCallback = cb;
    catModal.style.display = "flex";
    catModalInput.focus();
  } else {
    const v = prompt(title, value);
    if (v !== null) cb(v, valueEs || "");
  }
}
if (catModalOk) {
  catModalOk.onclick = () => {
    if (catModalCallback) catModalCallback(catModalInput.value, catModalInputEs ? catModalInputEs.value : "");
    catModal.style.display = "none";
    catModalCallback = null;
  };
}
if (catModalCancel) {
  catModalCancel.onclick = () => {
    catModal.style.display = "none";
    catModalCallback = null;
  };
}
const genericConfirmModal = document.getElementById("generic-confirm-modal");
const genericConfirmMsg = document.getElementById("generic-confirm-msg");
const genericConfirmOk = document.getElementById("generic-confirm-ok");
const genericConfirmCloseButtons = Array.from(document.querySelectorAll(".close-generic-confirm"));
let genericConfirmCallback = null;
let genericConfirmCancelCallback = null;
function resetGenericConfirmOptions() {
  if (genericConfirmOk) genericConfirmOk.textContent = "确定";
  genericConfirmCloseButtons.forEach((b) => {
    b.textContent = "取消";
  });
}
function openConfirm(msg, cb, options = null) {
  if (genericConfirmModal) {
    genericConfirmMsg.textContent = msg;
    genericConfirmCallback = cb;
    genericConfirmCancelCallback = options && typeof options.onCancel === "function" ? options.onCancel : null;
    if (genericConfirmOk) genericConfirmOk.textContent = (options == null ? void 0 : options.okText) || "确定";
    genericConfirmCloseButtons.forEach((b) => {
      b.textContent = (options == null ? void 0 : options.cancelText) || "取消";
    });
    genericConfirmModal.style.display = "flex";
  } else {
    if (confirm(msg)) cb();
    else if (options && typeof options.onCancel === "function") options.onCancel();
  }
}
if (genericConfirmOk) {
  genericConfirmOk.onclick = () => {
    if (genericConfirmCallback) genericConfirmCallback();
    genericConfirmModal.style.display = "none";
    genericConfirmCallback = null;
    genericConfirmCancelCallback = null;
    resetGenericConfirmOptions();
  };
}
genericConfirmCloseButtons.forEach((b) => {
  b.onclick = () => {
    genericConfirmModal.style.display = "none";
    genericConfirmCallback = null;
    if (genericConfirmCancelCallback) genericConfirmCancelCallback();
    genericConfirmCancelCallback = null;
    resetGenericConfirmOptions();
  };
});
function renderCats() {
  catList.innerHTML = "";
  categoriesData.forEach((cat, idx) => {
    const panel = document.createElement("div");
    panel.className = "cat-panel";
    const handle = document.createElement("span");
    handle.textContent = "\u2630";
    handle.style.cssText = "cursor:grab; margin-right:12px; color:#64748b; font-size:16px; user-select:none";
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "parent", idx }));
      panel.style.opacity = "0.5";
    });
    handle.addEventListener("dragend", () => panel.style.opacity = "1");
    panel.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    panel.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dataStr = e.dataTransfer.getData("text/plain");
      if (!dataStr) return;
      try {
        const data = JSON.parse(dataStr);
        if (data.type !== "parent") return;
        const fromIdx = data.idx;
        const toIdx = idx;
        if (fromIdx === toIdx) return;
        const item = categoriesData.splice(fromIdx, 1)[0];
        categoriesData.splice(toIdx, 0, item);
        saveJSON("categoriesData", categoriesData);
        apiCategoriesSave();
        renderCats();
      } catch (ex) {
      }
    });
    const header = document.createElement("div");
    header.className = "cat-header";
    const title = document.createElement("div");
    title.className = "cat-title";
    title.innerHTML = formatCategoryNameMarkup(cat.name, getCategoryParentSpanishName(cat.name));
    const actions = document.createElement("div");
    actions.className = "cat-actions";
    const addBtn = document.createElement("button");
    addBtn.className = "btn-icon btn-green";
    addBtn.textContent = "+";
    addBtn.title = "\u65B0\u589E\u4E8C\u7EA7\u7C7B\u76EE";
    const editBtn = document.createElement("button");
    editBtn.className = "btn-icon btn-blue";
    editBtn.textContent = "\u270E";
    editBtn.title = "\u7F16\u8F91\u4E00\u7EA7\u7C7B\u76EE";
    const delBlocked = cat.name === "\u6536\u5165" || cat.name === "\u5F00\u652F";
    actions.append(addBtn, editBtn);
    let delBtn = null;
    if (!delBlocked) {
      delBtn = document.createElement("button");
      delBtn.className = "btn-icon btn-red";
      delBtn.textContent = "\u{1F5D1}";
      delBtn.title = "\u5220\u9664\u4E00\u7EA7\u7C7B\u76EE";
      actions.append(delBtn);
    }
    header.append(handle, title, actions);
    const items = document.createElement("div");
    items.className = "cat-items";
    cat.children.forEach((name, j) => {
      const row = document.createElement("div");
      row.className = "cat-item";
      const cHandle = document.createElement("span");
      cHandle.textContent = "\u2630";
      cHandle.style.cssText = "cursor:grab; margin-right:10px; color:#94a3b8; font-size:12px; user-select:none";
      cHandle.draggable = true;
      cHandle.addEventListener("dragstart", (e2) => {
        e2.stopPropagation();
        e2.dataTransfer.effectAllowed = "move";
        e2.dataTransfer.setData("text/plain", JSON.stringify({ type: "child", pIdx: idx, cIdx: j }));
        row.style.opacity = "0.5";
      });
      cHandle.addEventListener("dragend", () => row.style.opacity = "1");
      row.addEventListener("dragover", (e2) => {
        e2.preventDefault();
        e2.stopPropagation();
        e2.dataTransfer.dropEffect = "move";
      });
      row.addEventListener("drop", (e2) => {
        e2.preventDefault();
        e2.stopPropagation();
        const dataStr = e2.dataTransfer.getData("text/plain");
        if (!dataStr) return;
        try {
          const data = JSON.parse(dataStr);
          if (data.type !== "child") return;
          const fromPIdx = data.pIdx;
          const fromCIdx = data.cIdx;
          const toPIdx = idx;
          const toCIdx = j;
          if (fromPIdx !== toPIdx) return;
          if (fromCIdx === toCIdx) return;
          const item = categoriesData[fromPIdx].children.splice(fromCIdx, 1)[0];
          categoriesData[toPIdx].children.splice(toCIdx, 0, item);
          saveJSON("categoriesData", categoriesData);
          apiCategoriesSave();
          renderCats();
        } catch (ex) {
        }
      });
      const nm = document.createElement("div");
      nm.className = "cat-name";
      nm.innerHTML = formatCategoryNameMarkup(name, getCategoryChildSpanishName(cat.name, name));
      const ops = document.createElement("div");
      ops.className = "cat-actions";
      const e = document.createElement("button");
      e.className = "btn-icon btn-blue";
      e.textContent = "\u270E";
      e.title = "\u7F16\u8F91";
      const d = document.createElement("button");
      d.className = "btn-icon btn-red";
      d.textContent = "\u{1F5D1}";
      d.title = "\u5220\u9664";
      ops.append(e, d);
      row.append(cHandle, nm, ops);
      items.appendChild(row);
      e.addEventListener("click", () => {
        openPrompt("\u7F16\u8F91\u540D\u79F0", name, getCategoryChildSpanishName(cat.name, name), (val, valEs) => {
          if (val && val.trim()) {
            const nextName = val.trim();
            categoriesData[idx].children[j] = nextName;
            renameCategoryChildSpanishName(cat.name, name, nextName, valEs);
            renderCats();
            saveJSON("categoriesData", categoriesData);
            apiCategoriesSave();
          }
        });
      });
      d.addEventListener("click", () => {
        openConfirm("\u786E\u5B9A\u5220\u9664\u8BE5\u5B50\u7C7B\u76EE\uFF1F", () => {
          deleteCategoryChildSpanishName(cat.name, name);
          categoriesData[idx].children.splice(j, 1);
          renderCats();
          saveJSON("categoriesData", categoriesData);
          apiCategoriesSave();
        });
      });
    });
    panel.append(header, items);
    catList.appendChild(panel);
    addBtn.addEventListener("click", () => {
      openPrompt("\u65B0\u589E\u4E8C\u7EA7\u7C7B\u76EE\u540D\u79F0", "", "", (val, valEs) => {
        if (val && val.trim()) {
          const nextName = val.trim();
          categoriesData[idx].children.push(nextName);
          setCategoryChildSpanishName(cat.name, nextName, valEs);
          renderCats();
          saveJSON("categoriesData", categoriesData);
          apiCategoriesSave();
        }
      });
    });
    editBtn.addEventListener("click", () => {
      openPrompt("\u7F16\u8F91\u4E00\u7EA7\u7C7B\u76EE\u540D\u79F0", cat.name, getCategoryParentSpanishName(cat.name), (val, valEs) => {
        if (val && val.trim()) {
          const nextName = val.trim();
          const oldName = cat.name;
          categoriesData[idx].name = nextName;
          renameCategoryParentSpanishName(oldName, nextName, valEs);
          renderCats();
          saveJSON("categoriesData", categoriesData);
          apiCategoriesSave();
        }
      });
    });
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        openConfirm("\u786E\u5B9A\u5220\u9664\u8BE5\u4E00\u7EA7\u7C7B\u76EE\uFF1F", () => {
          deleteCategoryParentSpanishName(cat.name);
          categoriesData.splice(idx, 1);
          renderCats();
          saveJSON("categoriesData", categoriesData);
          apiCategoriesSave();
        });
      });
    }
  });
  refreshLedgerTypeOptions();
  setCategories();
}
addCatBtn == null ? void 0 : addCatBtn.addEventListener("click", () => {
  openPrompt("\u65B0\u589E\u4E00\u7EA7\u7C7B\u76EE\u540D\u79F0", "", "", (val, valEs) => {
    if (val && val.trim()) {
      const nextName = val.trim();
      categoriesData.push({ name: nextName, children: [] });
      setCategoryParentSpanishName(nextName, valEs);
      renderCats();
      saveJSON("categoriesData", categoriesData);
      apiCategoriesSave();
    }
  });
});
const roleRows = document.getElementById("role-rows");
const roleSearch = document.getElementById("role-search");
const rolePageSize = document.getElementById("role-page-size");
const rolePrev = document.getElementById("role-prev");
const roleNext = document.getElementById("role-next");
const rolePageEl = document.getElementById("role-page");
const roleSummary = document.getElementById("role-summary");
const roleCreate = document.getElementById("role-create");
const roleModal = document.getElementById("role-modal");
const roleForm = document.getElementById("role-form");
const roleCancel = document.getElementById("role-cancel");
const rolesData = [];
const permStructure = [
  { mod: "home", label: "\u9996\u9875" },
  {
    group: "\u65E5\u5E38\u8FD0\u8425",
    children: [
      { mod: "tasks", label: "\u4EFB\u52A1\u4FE1\u606F" },
      { mod: "daily_orders", label: "\u8BA2\u5355\u7BA1\u7406" },
      { mod: "finished_stock", label: "\u5546\u54C1\u5E93\u5B58" },
      { mod: "finished_stock_adjust", label: "\u5E93\u5B58\u8C03\u6574" },
      { mod: "raw_stock", label: "\u539F\u6750\u6599\u5E93\u5B58" },
      { mod: "production_review", label: "\u5BA1\u6838\u751F\u4EA7" },
      { mod: "event_records", label: "\u4E8B\u4EF6\u8BB0\u5F55" },
      { mod: "knowledge_base", label: "\u77E5\u8BC6\u5E93" },
      { mod: "warehouse_production", label: "\u4ED3\u5E93\u751F\u6210\u5F55\u5165" },
      { mod: "employee_checkin", label: "\u5458\u5DE5\u7B7E\u5230" }
    ]
  },
  {
    group: "\u9500\u552E",
    children: [
      { mod: "sales_order", label: "\u51FA\u5355\u7CFB\u7EDF" },
      { mod: "sales_invoice", label: "\u53D1\u7968" },
      { mod: "sales_products", label: "\u5546\u54C1\u5217\u8868" },
      { mod: "sales_stats", label: "\u5546\u54C1\u9500\u552E\u7EDF\u8BA1", extra_actions: [{ act: "assigned_only", label: "\u53EA\u53EF\u67E5\u770B\u52FE\u9009\u7684\u5546\u54C1" }] }
    ]
  },
  {
    mod: "ledger",
    label: "\u6536\u652F\u8BB0\u8D26",
    extra_actions: [
      { act: "update", label: "\u53EF\u4FEE\u6539\u8BB0\u5F55" },
      { act: "delete", label: "\u53EF\u5220\u9664\u8BB0\u5F55" },
      { act: "confirm", label: "\u53EF\u786E\u8BA4\u8BB0\u5F55" }
    ]
  },
  {
    mod: "payables",
    label: "\u5E94\u6536/\u5E94\u4ED8\u8D26\u6B3E",
    extra_actions: [
      { act: "update", label: "\u53EF\u4FEE\u6539\u8BB0\u5F55" },
      { act: "delete", label: "\u53EF\u5220\u9664\u8BB0\u5F55" },
      { act: "confirm", label: "\u53EF\u786E\u8BA4\u8BB0\u5F55" }
    ]
  },
  { mod: "contacts", label: "\u5F80\u6765\u5355\u4F4D" },
  { mod: "categories", label: "\u5206\u7C7B\u7BA1\u7406" },
  { mod: "accounts", label: "\u8D26\u6237\u7BA1\u7406" },
  { mod: "sales_accounts", label: "\u4E1A\u52A1\u5458\u7BA1\u7406" },
  {
    group: "\u7CFB\u7EDF\u8BBE\u7F6E",
    children: [
      { mod: "company_info", label: "\u516C\u53F8\u4FE1\u606F" },
      { mod: "user_accounts", label: "\u5E10\u53F7\u7BA1\u7406" },
      { mod: "role_accounts", label: "\u89D2\u8272\u7BA1\u7406" },
      { mod: "system", label: "\u57FA\u7840\u8BBE\u7F6E" }
    ]
  }
];
const editablePermModules = /* @__PURE__ */ new Set([
  "tasks",
  "daily_orders",
  "finished_stock",
  "finished_stock_adjust",
  "raw_stock",
  "production_review",
  "event_records",
  "knowledge_base",
  "warehouse_production",
  "employee_checkin",
  "sales_order",
  "sales_invoice",
  "sales_products",
  "ledger",
  "payables",
  "contacts",
  "categories",
  "accounts",
  "sales_accounts",
  "company_info",
  "user_accounts",
  "role_accounts",
  "system"
]);
function moduleSupportsEdit(mod) {
  return editablePermModules.has(String(mod || ""));
}
function getPermEntry(perms, mod) {
  const allPerms = perms && typeof perms === "object" ? perms : {};
  const moduleName = String(mod || "").trim();
  if (!moduleName) return {};
  if (moduleName === "employee_checkin") {
    return allPerms.employee_checkin || allPerms.warehouse_production || {};
  }
  return allPerms[moduleName] || {};
}
function hasLegacyModifyPerm(modPerms) {
  if (!modPerms || typeof modPerms !== "object") return false;
  return Object.keys(modPerms).some((act) => act !== "view" && act !== "assigned_only");
}
function hasModuleEditPerm(perms, mod) {
  const modPerms = getPermEntry(perms, mod);
  return !!(modPerms.edit || hasLegacyModifyPerm(modPerms));
}
function isModifyAction(action) {
  const act = String(action || "").trim();
  return !!act && act !== "view" && act !== "assigned_only";
}
function hasGranularRecordPerm(modPerms) {
  if (!modPerms || typeof modPerms !== "object") return false;
  return ["update", "delete", "confirm"].some((act) => Object.prototype.hasOwnProperty.call(modPerms, act));
}
function allTruePerms() {
  const p = {};
  permStructure.forEach((item) => {
    if (item.group && item.children) {
      item.children.forEach((c) => p[c.mod] = moduleSupportsEdit(c.mod) ? { view: true, edit: true } : { view: true });
    } else if (item.mod) {
      p[item.mod] = moduleSupportsEdit(item.mod) ? { view: true, edit: true } : { view: true };
    }
  });
  return p;
}
function getRoleByName(name) {
  return rolesData.find((r) => r.name === name);
}
function currentUserRole() {
  const u = getAuthUser();
  if (!u) return null;
  const roleName = u.role || (u.name === "aaaaaa" ? "\u8D85\u7EA7\u7BA1\u7406\u5458" : "");
  return getRoleByName(roleName) || null;
}
function currentPerms() {
  const r = currentUserRole();
  if (!r || r.name === "\u8D85\u7EA7\u7BA1\u7406\u5458") return allTruePerms();
  return r.perms || {};
}
function can(module, action) {
  const u = getAuthUser();
  const roleName = (u == null ? void 0 : u.role) || getUserRoleName((u == null ? void 0 : u.name) || "");
  if (roleName === "\u8D85\u7EA7\u7BA1\u7406\u5458") return true;
  const role = rolesData.find((r) => r.name === roleName);
  const perms = (role == null ? void 0 : role.perms) || {};
  const m = getPermEntry(perms, module);
  if (!action || action === "view") return !!m.view;
  if (action === "assigned_only") return !!m.assigned_only;
  if (["update", "delete", "confirm"].includes(action)) {
    if (hasGranularRecordPerm(m)) return !!m[action];
    if (action === "update" && (m.edit || m[action])) return true;
    return !!m[action];
  }
  if (isModifyAction(action) && m.edit) return true;
  return !!m[action];
}
const rolePermsModal = document.getElementById("role-perms-modal");
const rolePermsForm = document.getElementById("role-perms-form");
const rolePermsCancel = document.getElementById("role-perms-cancel");
const permsWrap = document.getElementById("perms-wrap");
const rolePermsPageEl = document.getElementById("page-role-perms");
const rolePermsBack = document.getElementById("role-perms-back");
const rolePermsFormPage = document.getElementById("role-perms-form-page");
const permsPageWrap = document.getElementById("perms-page-wrap");
let editingPermRole = null;
function appendPermCheckbox(row, mod, act, checked, labelText) {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.dataset.mod = mod;
  cb.dataset.act = act;
  cb.checked = !!checked;
  cb.style.marginRight = "8px";
  row.append(cb, document.createTextNode(labelText));
  return cb;
}
function bindPermCheckboxDeps(viewCb, editCb) {
  if (!viewCb || !editCb) return;
  if (editCb.checked) viewCb.checked = true;
  viewCb.addEventListener("change", () => {
    if (!viewCb.checked) editCb.checked = false;
  });
  editCb.addEventListener("change", () => {
    if (editCb.checked) viewCb.checked = true;
  });
}
function bindExtraPermCheckboxDeps(viewCb, extraCbs = []) {
  if (!viewCb || !extraCbs.length) return;
  extraCbs.forEach((cb) => {
    if (cb.checked) viewCb.checked = true;
    cb.addEventListener("change", () => {
      if (cb.checked) viewCb.checked = true;
    });
  });
  viewCb.addEventListener("change", () => {
    if (!viewCb.checked) extraCbs.forEach((cb) => {
      cb.checked = false;
    });
  });
}
function createPermRow(item, perms) {
  const row = document.createElement("label");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.cursor = "pointer";
  row.style.flexWrap = "wrap";
  row.style.gap = "10px";
  const itemPerms = getPermEntry(perms, item.mod);
  const viewCb = appendPermCheckbox(row, item.mod, "view", !!itemPerms.view, item.label);
  let editCb = null;
  const extraCbs = [];
  if (moduleSupportsEdit(item.mod)) {
    const editWrap = document.createElement("span");
    editWrap.style.display = "inline-flex";
    editWrap.style.alignItems = "center";
    editCb = appendPermCheckbox(editWrap, item.mod, "edit", hasModuleEditPerm(perms, item.mod), "\u662F\u5426\u53EF\u4FEE\u6539");
    row.appendChild(editWrap);
  }
  (item.extra_actions || []).forEach((extra) => {
    const extraRow = document.createElement("span");
    extraRow.style.display = "inline-flex";
    extraRow.style.alignItems = "center";
    extraCbs.push(appendPermCheckbox(extraRow, item.mod, extra.act, !!itemPerms[extra.act], extra.label));
    row.appendChild(extraRow);
  });
  bindPermCheckboxDeps(viewCb, editCb);
  bindExtraPermCheckboxDeps(viewCb, extraCbs);
  return row;
}
function collectRolePerms(container) {
  const newPerms = {};
  permStructure.forEach((item) => {
    if (item.group && item.children) item.children.forEach((c) => newPerms[c.mod] = {});
    else if (item.mod) newPerms[item.mod] = {};
  });
  container == null ? void 0 : container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    const mod = cb.dataset.mod;
    const act = cb.dataset.act || "view";
    if (!mod || !cb.checked) return;
    if (!newPerms[mod]) newPerms[mod] = {};
    newPerms[mod][act] = true;
  });
  return newPerms;
}
function openPermsEditor(role) {
  editingPermRole = role;
  permsPageWrap.innerHTML = "";
  const perms = role.perms || {};
  permStructure.forEach((item) => {
    const box = document.createElement("div");
    box.className = "cat-panel";
    box.style.marginBottom = "16px";
    if (item.group) {
      const top = document.createElement("div");
      top.className = "cat-header";
      top.textContent = item.group;
      const cont = document.createElement("div");
      cont.style.padding = "12px 16px";
      cont.style.display = "flex";
      cont.style.flexWrap = "wrap";
      cont.style.gap = "16px";
      item.children.forEach((c) => {
        cont.appendChild(createPermRow(c, perms));
      });
      box.append(top, cont);
    } else {
      const cont = document.createElement("div");
      cont.style.padding = "12px 16px";
      cont.appendChild(createPermRow(item, perms));
      box.appendChild(cont);
    }
    permsPageWrap.appendChild(box);
  });
  location.hash = "#role-perms";
}
rolePermsCancel == null ? void 0 : rolePermsCancel.addEventListener("click", () => {
  rolePermsModal.style.display = "none";
  editingPermRole = null;
});
rolePermsForm == null ? void 0 : rolePermsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingPermRole) return;
  const newPerms = collectRolePerms(permsWrap);
  editingPermRole.perms = newPerms;
  await apiRoleUpdatePerms(editingPermRole.id, newPerms);
  rolePermsModal.style.display = "none";
  editingPermRole = null;
  renderRoles();
});
rolePermsBack == null ? void 0 : rolePermsBack.addEventListener("click", () => {
  location.hash = "#role-accounts";
});
rolePermsFormPage == null ? void 0 : rolePermsFormPage.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingPermRole) return;
  const newPerms = collectRolePerms(permsPageWrap);
  editingPermRole.perms = newPerms;
  await apiRoleUpdatePerms(editingPermRole.id, newPerms);
  const saveBtn = document.getElementById("role-perms-save");
  if (saveBtn) {
    const origText = saveBtn.textContent;
    saveBtn.textContent = "\u4FDD\u5B58\u6210\u529F\uFF01";
    saveBtn.style.background = "#16a34a";
    setTimeout(() => {
      saveBtn.textContent = origText;
      saveBtn.style.background = "";
      editingPermRole = null;
      location.hash = "#role-accounts";
      renderRoles();
    }, 800);
  } else {
    editingPermRole = null;
    location.hash = "#role-accounts";
    renderRoles();
  }
});
let rolePage = 1;
async function apiRolesList() {
  try {
    const list = await apiFetchJSON("/api/roles");
    if (Array.isArray(list)) {
      rolesData.splice(0, rolesData.length, ...list.map((r) => ({ id: r.id, name: r.name, desc: r.desc || "", created: r.created || "", immutable: !!r.immutable, perms: r.perms || {} })));
      saveJSON("rolesData", rolesData);
    }
  } catch (e) {
  }
}
async function apiRoleCreate(obj) {
  try {
    const r = await apiFetchJSON("/api/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
    return r == null ? void 0 : r.id;
  } catch (e) {
    return null;
  }
}
async function apiRoleDelete(id) {
  try {
    const r = await fetch(API_BASE + "/api/roles/" + String(id), { method: "DELETE" });
    return r.ok;
  } catch (e) {
    return false;
  }
}
async function apiRoleUpdatePerms(id, perms) {
  try {
    await apiFetchJSON("/api/roles/" + String(id) + "/perms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ perms }) });
  } catch (e) {
  }
}
function renderRoles() {
  const key = ((roleSearch == null ? void 0 : roleSearch.value) || "").trim();
  const size = parseInt((rolePageSize == null ? void 0 : rolePageSize.value) || "10", 10);
  const data = rolesData.filter((r) => {
    if (!key) return true;
    return [r.name, r.desc, String(r.id)].some((v) => (v || "").includes(key));
  }).sort((a, b) => b.id - a.id);
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (rolePage > totalPages) rolePage = totalPages;
  const start = (rolePage - 1) * size;
  const pageData = data.slice(start, start + size);
  roleRows.innerHTML = "";
  pageData.forEach((r) => {
    const tr = document.createElement("tr");
    [r.id, r.name, r.desc, r.created].forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });
    const ops = document.createElement("td");
    ops.className = "actions";
    if ((r.name || "") === "\u8D85\u7EA7\u7BA1\u7406\u5458") {
      const tip = document.createElement("span");
      tip.className = "tag";
      tip.textContent = "\u4E0D\u53EF\u7F16\u8F91/\u5220\u9664";
      ops.append(tip);
    } else {
      const edit = document.createElement("a");
      edit.href = "#";
      edit.textContent = "\u7F16\u8F91";
      edit.className = "link-blue";
      ops.append(edit);
      edit.addEventListener("click", (e) => {
        e.preventDefault();
        openPermsEditor(r);
      });
    }
    tr.appendChild(ops);
    roleRows.appendChild(tr);
  });
  roleSummary.textContent = `\u663E\u793A ${Math.min(total, start + 1)} \u5230 ${Math.min(total, start + pageData.length)} \u9879\uFF0C\u5171 ${total} \u9879`;
  rolePageEl.textContent = String(rolePage);
}
roleSearch == null ? void 0 : roleSearch.addEventListener("input", () => {
  rolePage = 1;
  renderRoles();
});
rolePageSize == null ? void 0 : rolePageSize.addEventListener("change", () => {
  rolePage = 1;
  renderRoles();
});
rolePrev == null ? void 0 : rolePrev.addEventListener("click", () => {
  if (rolePage > 1) {
    rolePage--;
    renderRoles();
  }
});
roleNext == null ? void 0 : roleNext.addEventListener("click", () => {
  const size = parseInt((rolePageSize == null ? void 0 : rolePageSize.value) || "10", 10);
  const totalPages = Math.max(1, Math.ceil(rolesData.filter((r) => (roleSearch == null ? void 0 : roleSearch.value) || "" ? [r.name, r.desc, String(r.id)].some((v) => v.includes(roleSearch.value)) : true).length / size));
  if (rolePage < totalPages) {
    rolePage++;
    renderRoles();
  }
});
roleCreate == null ? void 0 : roleCreate.addEventListener("click", () => {
  roleModal.style.display = "flex";
  document.getElementById("r-name").value = "";
  document.getElementById("r-desc").value = "";
});
roleCancel == null ? void 0 : roleCancel.addEventListener("click", () => {
  roleModal.style.display = "none";
});
roleForm == null ? void 0 : roleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("r-name").value.trim();
  const desc = document.getElementById("r-desc").value.trim();
  if (!name) return;
  const now = /* @__PURE__ */ new Date();
  const created = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  await apiRoleCreate({ name, desc, created, perms: {} });
  await apiRolesList();
  roleModal.style.display = "none";
  rolePage = 1;
  renderRoles();
});
const userRows = document.getElementById("user-rows");
const userSearch = document.getElementById("user-search");
const userPageSize = document.getElementById("user-page-size");
const userPrev = document.getElementById("user-prev");
const userNext = document.getElementById("user-next");
const userPageEl = document.getElementById("user-page");
const userSummary = document.getElementById("user-summary");
const userCreate = document.getElementById("user-create");
const userModal = document.getElementById("user-modal");
const userForm = document.getElementById("user-form");
const userCancel = document.getElementById("user-cancel");
const userModalTitle = document.getElementById("user-modal-title");
const userSaveBtn = document.getElementById("user-save");
const dailyOrderActionAssignCard = document.getElementById("daily-order-action-assign-card");
const dailyOrderActionAssignRows = document.getElementById("daily-order-action-assign-rows");
const dailyOrderActionAssignSave = document.getElementById("daily-order-action-assign-save");
const userAccounts = [];
const DAILY_ORDER_ACTION_LABELS = {
  enable_allocation: "\u53EF\u914D\u8D27",
  allocate: "\u914D\u8D27",
  ready_to_ship: "\u53EF\u53D1\u8D27",
  contact_logistics: "\u8054\u7CFB\u7269\u6D41",
  ship: "\u786E\u8BA4\u5DF2\u53D1\u8D27",
  ship_without_voucher: "\u5141\u8BB8\u4E0D\u4E0A\u4F20\u56FE\u7247\u786E\u8BA4\u5DF2\u53D1\u8D27"
};
const DAILY_ORDER_ACTION_HINTS = {
  enable_allocation: "\u7EDF\u8BA1\u65B0\u8BA2\u5355\u91CC\u8FD8\u672A\u8BBE\u4E3A\u201C\u53EF\u914D\u8D27\u201D\u7684\u8BB0\u5F55",
  allocate: "\u7EDF\u8BA1\u5DF2\u8BBE\u4E3A\u201C\u53EF\u914D\u8D27\u201D\u3001\u7B49\u5F85\u771F\u6B63\u914D\u8D27\u7684\u8BA2\u5355",
  ready_to_ship: "\u7EDF\u8BA1\u5DF2\u914D\u8D27\u3001\u7B49\u5F85\u8F6C\u5165\u5F85\u53D1\u8D27\u7684\u8BA2\u5355",
  contact_logistics: "\u7EDF\u8BA1\u5F85\u53D1\u8D27\u4E2D\u8FD8\u6CA1\u8054\u7CFB\u7269\u6D41\u7684\u8BA2\u5355",
  ship: "\u7EDF\u8BA1\u5F85\u53D1\u8D27\u4E2D\u9700\u8981\u786E\u8BA4\u5DF2\u53D1\u8D27\u7684\u8BA2\u5355",
  ship_without_voucher: "\u6307\u5B9A\u54EA\u4E2A\u8D26\u53F7\u53EF\u4EE5\u5728\u4E0D\u4E0A\u4F20\u53D1\u8D27\u56FE\u7247\u7684\u60C5\u51B5\u4E0B\u76F4\u63A5\u786E\u8BA4\u5DF2\u53D1\u8D27"
};
let dailyOrderActionAssignments = {
  enable_allocation: "",
  allocate: "",
  ready_to_ship: "",
  contact_logistics: "",
  ship: "",
  ship_without_voucher: "aaaaaa"
};
let dailyOrderActionPendingTotal = 0;
let dailyOrderActionPendingCounts = {
  enable_allocation: 0,
  allocate: 0,
  ready_to_ship: 0,
  contact_logistics: 0,
  ship: 0,
  ship_without_voucher: 0
};
function normalizeDailyOrderActionAssigneeList(value) {
  if (Array.isArray(value)) return [...new Set(value.map((v) => String(v || "").trim()).filter(Boolean))];
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return [...new Set(parsed.map((v) => String(v || "").trim()).filter(Boolean))];
  } catch (e) {
  }
  return [...new Set(text.split(",").map((v) => String(v || "").trim()).filter(Boolean))];
}
function normalizeDailyOrderActionAssigneeValue(value) {
  return normalizeDailyOrderActionAssigneeList(value).join(",");
}
function normalizeDailyOrderActionAssignmentsMap(assignments, includeDefaultShipWithoutVoucher = false) {
  const next = {
    enable_allocation: "",
    allocate: "",
    ready_to_ship: "",
    contact_logistics: "",
    ship: "",
    ship_without_voucher: includeDefaultShipWithoutVoucher ? "aaaaaa" : ""
  };
  Object.keys(next).forEach((key) => {
    const fallbackValue = key === "ship_without_voucher" && includeDefaultShipWithoutVoucher ? "aaaaaa" : "";
    next[key] = normalizeDailyOrderActionAssigneeValue((assignments == null ? void 0 : assignments[key]) || fallbackValue);
  });
  return next;
}
(function syncInitialPasswords() {
  const m = getPwdMap();
  userAccounts.forEach((u) => {
    if (u.password) m[u.name] = u.password;
  });
  setPwdMap(m);
})();
let userPage = 1;
let editingUserId = null;
function normalizeAppLocale(locale) {
  return String(locale || "").trim() === "es-ES" ? "es-ES" : "zh-CN";
}
function getLocaleLabel(locale) {
  return normalizeAppLocale(locale) === "es-ES" ? "\u897F\u73ED\u7259\u8BED" : "\u4E2D\u6587";
}
function isCurrentUserAdmin() {
  const u = getAuthUser();
  const roleName = (u == null ? void 0 : u.role) || getUserRoleName((u == null ? void 0 : u.name) || "");
  return roleName === "\u8D85\u7EA7\u7BA1\u7406\u5458";
}
function getDailyOrderActionAssignee(actionKey) {
  return normalizeDailyOrderActionAssigneeValue((dailyOrderActionAssignments == null ? void 0 : dailyOrderActionAssignments[actionKey]) || "");
}
function getDailyOrderActionAssigneeList(actionKey) {
  return normalizeDailyOrderActionAssigneeList(getDailyOrderActionAssignee(actionKey));
}
function canHandleDailyOrderAction(actionKey) {
  if (isCurrentUserAdmin()) return true;
  const assignedUsers = getDailyOrderActionAssigneeList(actionKey);
  if (!assignedUsers.length) return true;
  const currentUser = String(((getAuthUser() || {}).name) || "").trim();
  return !!currentUser && assignedUsers.includes(currentUser);
}
function canShipWithoutVoucher() {
  const assignedUsers = getDailyOrderActionAssigneeList("ship_without_voucher");
  if (!assignedUsers.length) return false;
  const currentUser = String(((getAuthUser() || {}).name) || "").trim();
  return !!currentUser && assignedUsers.includes(currentUser);
}
function getDailyOrderActionDisabledAttrs(actionKey) {
  if (canHandleDailyOrderAction(actionKey)) return "";
  const assignedTo = getDailyOrderActionAssigneeList(actionKey).join("、");
  const title = assignedTo ? ` title=\"已指派给 ${escapeHtml(assignedTo)}\"` : "";
  return ` disabled${title}`;
}
function getDailyOrderActionDisabledStyle(actionKey) {
  return canHandleDailyOrderAction(actionKey) ? "" : "opacity:0.45; cursor:not-allowed; pointer-events:none;";
}
function renderDailyOrderActionAssignPanel() {
  if (!dailyOrderActionAssignCard || !dailyOrderActionAssignRows)
    return;
  const visible = isCurrentUserAdmin();
  dailyOrderActionAssignCard.style.display = visible ? "block" : "none";
  if (!visible)
    return;
  const enabledUsers = userAccounts.filter((u) => !!u.enabled).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  dailyOrderActionAssignRows.innerHTML = Object.keys(DAILY_ORDER_ACTION_LABELS).map((actionKey) => {
    const selectedUsers = getDailyOrderActionAssigneeList(actionKey);
    const selectedSet = new Set(selectedUsers);
    const selectedSummary = selectedUsers.length ? selectedUsers.map((name) => {
      const matchedUser = enabledUsers.find((u) => u.name === name);
      return matchedUser ? `${name}${matchedUser.role ? ` (${matchedUser.role})` : ""}` : name;
    }).join("、") : "未指定（保持原权限）";
    const chipsHtml = [
      `<button type="button" onclick="toggleDailyOrderActionAssignee('${escapeHtml(actionKey)}','')" style="padding:6px 10px; border-radius:999px; border:1px solid ${selectedUsers.length ? "#334155" : "#1d4ed8"}; background:${selectedUsers.length ? "#0f172a" : "#1d4ed8"}; color:${selectedUsers.length ? "#cbd5e1" : "#fff"}; cursor:pointer">未指定</button>`,
      ...enabledUsers.map((u) => {
        const selected = selectedSet.has(u.name);
        return `<button type="button" onclick="toggleDailyOrderActionAssignee('${escapeHtml(actionKey)}','${encodeURIComponent(u.name)}')" style="padding:6px 10px; border-radius:999px; border:1px solid ${selected ? "#1d4ed8" : "#334155"}; background:${selected ? "#1d4ed8" : "#0f172a"}; color:${selected ? "#fff" : "#cbd5e1"}; cursor:pointer">${escapeHtml(u.name)}${u.role ? ` (${escapeHtml(u.role)})` : ""}</button>`;
      })
    ].join("");
    return `
      <tr>
        <td>${escapeHtml(DAILY_ORDER_ACTION_LABELS[actionKey] || actionKey)}</td>
        <td>
          <div style="display:flex; flex-direction:column; gap:8px">
            <div style="font-size:12px; color:#94a3b8; line-height:1.5">${escapeHtml(selectedSummary)}</div>
            <div style="display:flex; flex-wrap:wrap; gap:8px">${chipsHtml}</div>
          </div>
        </td>
        <td style="color:#94a3b8">${escapeHtml(DAILY_ORDER_ACTION_HINTS[actionKey] || "-")}</td>
      </tr>
    `;
  }).join("");
}
window.toggleDailyOrderActionAssignee = function(actionKey, encodedName) {
  if (!isCurrentUserAdmin()) return;
  const key = String(actionKey || "").trim();
  if (!key || !Object.prototype.hasOwnProperty.call(DAILY_ORDER_ACTION_LABELS, key)) return;
  const name = decodeURIComponent(String(encodedName || ""));
  if (!name) {
    dailyOrderActionAssignments[key] = "";
    renderDailyOrderActionAssignPanel();
    return;
  }
  const next = getDailyOrderActionAssigneeList(key);
  const idx = next.indexOf(name);
  if (idx >= 0) next.splice(idx, 1);
  else next.push(name);
  dailyOrderActionAssignments[key] = normalizeDailyOrderActionAssigneeValue(next);
  renderDailyOrderActionAssignPanel();
};
function formatDailyOrderPendingBreakdown(counts) {
  const locale = getCurrentAppLocale();
  const parts = Object.keys(DAILY_ORDER_ACTION_LABELS).map((actionKey) => {
    const count = Number((counts == null ? void 0 : counts[actionKey]) || 0) || 0;
    if (count <= 0)
      return "";
    const label = typeof window.t === "function" ? window.t(DAILY_ORDER_ACTION_LABELS[actionKey] || actionKey) : DAILY_ORDER_ACTION_LABELS[actionKey] || actionKey;
    return locale === "es-ES" ? `${count} ${label}` : `${count}个${label}`;
  }).filter(Boolean);
  return parts.join(locale === "es-ES" ? ", " : "，");
}
function fillUserRoleOptions(selectedRole = "") {
  const roleSel = document.getElementById("u-role");
  if (!roleSel) return;
  roleSel.innerHTML = '<option value="">\u9009\u62E9\u89D2\u8272</option>';
  rolesData.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = r.name;
    roleSel.appendChild(opt);
  });
  roleSel.value = selectedRole || "";
}
function fillUserLocaleOptions(selectedLocale = "zh-CN") {
  const localeSel = document.getElementById("u-locale");
  if (!localeSel) return;
  localeSel.value = normalizeAppLocale(selectedLocale);
}
function openUserModalForCreate() {
  var _a2, _b2;
  editingUserId = null;
  if (userModalTitle) userModalTitle.textContent = "\u521B\u5EFA\u8D26\u53F7";
  if (userSaveBtn) userSaveBtn.textContent = "\u4FDD\u5B58";
  document.getElementById("u-name").value = "";
  fillUserRoleOptions("");
  document.getElementById("u-holding-percent").value = "0";
  fillUserLocaleOptions(((_a2 = getAuthUser()) == null ? void 0 : _a2.locale) || ((_b2 = window.getAppLocale) == null ? void 0 : _b2.call(window)) || "zh-CN");
  userModal.style.display = "flex";
}
function openUserModalForEdit(user) {
  if (!user) return;
  editingUserId = Number(user.id || 0) || null;
  if (userModalTitle) userModalTitle.textContent = "\u7F16\u8F91\u8D26\u53F7";
  if (userSaveBtn) userSaveBtn.textContent = "\u4FDD\u5B58\u4FEE\u6539";
  document.getElementById("u-name").value = user.name || "";
  fillUserRoleOptions(user.role || "");
  document.getElementById("u-holding-percent").value = Number(user.holdingPercent || 0).toFixed(2);
  fillUserLocaleOptions(user.locale || "zh-CN");
  userModal.style.display = "flex";
}
async function submitUserAccountForm() {
  var _a2;
  const name = document.getElementById("u-name").value.trim();
  const role = document.getElementById("u-role").value.trim() || "\u666E\u901A\u7528\u6237";
  const holdingPercent = Number(document.getElementById("u-holding-percent")?.value || 0);
  const locale = normalizeAppLocale(((_a2 = document.getElementById("u-locale")) == null ? void 0 : _a2.value) || "zh-CN");
  if (!name) return;
  if (!Number.isFinite(holdingPercent) || holdingPercent < 0 || holdingPercent > 100) {
    return alert("\u80A1\u4EFD\u6BD4\u4F8B\u5FC5\u987B\u662F 0 \u5230 100 \u4E4B\u95F4\u7684\u6570\u5B57");
  }
  if (editingUserId != null) {
    const existing = userAccounts.find((x) => x.id === editingUserId);
    const oldName = (existing == null ? void 0 : existing.name) || "";
    const ok = await apiUserUpdate(editingUserId, { name, role, locale, holdingPercent, enabled: existing == null ? void 0 : existing.enabled });
    if (!ok) return alert("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8D26\u53F7\u540D\u79F0\u662F\u5426\u91CD\u590D\u6216\u6743\u9650\u662F\u5426\u5141\u8BB8");
    if (existing) {
      existing.name = name;
      existing.role = role;
      existing.locale = locale;
      existing.holdingPercent = holdingPercent;
    }
    const au = getAuthUser();
    if (au && au.name === oldName) {
      setAuthUser({ ...au, name, role, locale });
      if (typeof window.setAppLocale === "function") window.setAppLocale(locale);
      try {
        const remembered = JSON.parse(localStorage.getItem("rememberedUser") || "null");
        if (remembered && remembered.name === oldName) {
          localStorage.setItem("rememberedUser", JSON.stringify({ ...remembered, name }));
        }
      } catch (e) {
      }
    }
    const pwdMap = getPwdMap();
    if (oldName && oldName !== name && Object.prototype.hasOwnProperty.call(pwdMap, oldName)) {
      pwdMap[name] = pwdMap[oldName];
      delete pwdMap[oldName];
      setPwdMap(pwdMap);
    }
  } else {
    const now = /* @__PURE__ */ new Date();
    const created = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    await apiUserCreate({ name, role, locale, holdingPercent, created, password: "111111" });
  }
  await apiUsersList();
  userModal.style.display = "none";
  editingUserId = null;
  userPage = 1;
  renderUserAccounts();
}
function renderUserAccounts() {
  const key = ((userSearch == null ? void 0 : userSearch.value) || "").trim();
  const size = parseInt((userPageSize == null ? void 0 : userPageSize.value) || "10", 10);
  const data = userAccounts.filter((u) => {
    if (!key) return true;
    return [u.name, u.role, getLocaleLabel(u.locale), String(u.id)].some((v) => (v || "").includes(key));
  }).sort((a, b) => b.id - a.id);
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (userPage > totalPages) userPage = totalPages;
  const start = (userPage - 1) * size;
  const pageData = data.slice(start, start + size);
  if (!userRows) return;
  userRows.innerHTML = "";
  pageData.forEach((u) => {
    const tr = document.createElement("tr");
    const tdId = document.createElement("td");
    tdId.textContent = String(u.id);
    tr.appendChild(tdId);
    const tdName = document.createElement("td");
    tdName.textContent = u.name;
    tr.appendChild(tdName);
    const tdRole = document.createElement("td");
    tdRole.textContent = u.name === "aaaaaa" ? "\u8D85\u7EA7\u7BA1\u7406\u5458" : u.role || "";
    tr.appendChild(tdRole);
    const tdLocale = document.createElement("td");
    tdLocale.textContent = getLocaleLabel(u.locale);
    tr.appendChild(tdLocale);
    const tdCreated = document.createElement("td");
    tdCreated.textContent = u.created || "";
    tr.appendChild(tdCreated);
    const tdStatus = document.createElement("td");
    const sw = document.createElement("div");
    sw.className = "switch" + (u.enabled ? "" : " off");
    const btn = document.createElement("button");
    btn.textContent = u.enabled ? "ON" : "OFF";
    btn.addEventListener("click", async () => {
      u.enabled = !u.enabled;
      await apiUserUpdate(u.id, { role: u.role, locale: u.locale, enabled: u.enabled });
      renderUserAccounts();
      saveJSON("userAccounts", userAccounts);
    });
    sw.appendChild(btn);
    tdStatus.appendChild(sw);
    tr.appendChild(tdStatus);
    const tdOps = document.createElement("td");
    if (u.name === "aaaaaa") {
      tdOps.textContent = "\u8BF7\u4F7F\u7528\u4FEE\u6539\u5BC6\u7801";
    } else {
      const edit = document.createElement("a");
      edit.href = "#";
      edit.textContent = "\u7F16\u8F91";
      edit.className = "link-blue";
      edit.addEventListener("click", (e) => {
        e.preventDefault();
        openUserModalForEdit(u);
      });
      tdOps.appendChild(edit);
      const reset = document.createElement("a");
      reset.href = "#";
      reset.textContent = "\u91CD\u7F6E\u5BC6\u7801";
      reset.className = "link-blue";
      reset.style.marginLeft = "8px";
      reset.addEventListener("click", (e) => {
        e.preventDefault();
        pendingResetUser = u;
        resetMsg.textContent = `\u5DF2\u7ECF\u5C06\u5E10\u53F7 ${u.name} \u5BC6\u7801\u91CD\u7F6E\uFF0C\u91CD\u7F6E\u540E\u5BC6\u7801\u4E3A\u201C111111\u201D`;
        resetModal.style.display = "flex";
      });
      tdOps.appendChild(reset);
    }
    if (u.id !== 1) {
      const del = document.createElement("a");
      del.href = "#";
      del.textContent = "\u5220\u9664";
      del.className = "link-red";
      del.style.marginLeft = "8px";
      del.addEventListener("click", async (e) => {
        e.preventDefault();
        if (!confirm(`\u786E\u5B9A\u5220\u9664\u8D26\u53F7 ${u.name}\uFF1F`)) return;
        const ok = await apiUserDelete(u.id);
        if (ok) {
          await apiUsersList();
          renderUserAccounts();
          alert("\u5220\u9664\u6210\u529F");
        } else {
          alert("\u5220\u9664\u5931\u8D25");
        }
      });
      tdOps.appendChild(del);
    }
    tr.appendChild(tdOps);
    userRows.appendChild(tr);
  });
  if (userSummary) userSummary.textContent = `\u663E\u793A ${Math.min(total, start + 1)} \u5230 ${Math.min(total, start + pageData.length)} \u9879\uFF0C\u5171 ${total} \u9879`;
  if (userPageEl) userPageEl.textContent = String(userPage);
  renderDailyOrderActionAssignPanel();
}
userSearch == null ? void 0 : userSearch.addEventListener("input", () => {
  userPage = 1;
  renderUserAccounts();
});
userPageSize == null ? void 0 : userPageSize.addEventListener("change", () => {
  userPage = 1;
  renderUserAccounts();
});
userPrev == null ? void 0 : userPrev.addEventListener("click", () => {
  if (userPage > 1) {
    userPage--;
    renderUserAccounts();
  }
});
userNext == null ? void 0 : userNext.addEventListener("click", () => {
  const size = parseInt((userPageSize == null ? void 0 : userPageSize.value) || "10", 10);
  const totalPages = Math.max(1, Math.ceil(userAccounts.filter((u) => (userSearch == null ? void 0 : userSearch.value) || "" ? [u.name, u.role, getLocaleLabel(u.locale), String(u.id)].some((v) => (v || "").includes(userSearch.value)) : true).length / size));
  if (userPage < totalPages) {
    userPage++;
    renderUserAccounts();
  }
});
dailyOrderActionAssignSave == null ? void 0 : dailyOrderActionAssignSave.addEventListener("click", async () => {
  if (!isCurrentUserAdmin())
    return;
  const payload = normalizeDailyOrderActionAssignmentsMap(dailyOrderActionAssignments, false);
  const oldText = dailyOrderActionAssignSave.textContent || "\u4FDD\u5B58\u6307\u6D3E";
  dailyOrderActionAssignSave.disabled = true;
  dailyOrderActionAssignSave.textContent = "\u4FDD\u5B58\u4E2D...";
  try {
    await apiSaveDailyOrderActionAssignments(payload);
    await apiDailyOrderPendingOps();
    updateTopOrderActionAlert(dailyOrderActionPendingTotal);
    showAppToast("\u8BA2\u5355\u64CD\u4F5C\u6307\u6D3E\u5DF2\u4FDD\u5B58");
  } catch (e) {
    alert("\u4FDD\u5B58\u8BA2\u5355\u64CD\u4F5C\u6307\u6D3E\u5931\u8D25");
  } finally {
    dailyOrderActionAssignSave.disabled = false;
    dailyOrderActionAssignSave.textContent = oldText;
  }
});
userCreate == null ? void 0 : userCreate.addEventListener("click", () => {
  openUserModalForCreate();
});
userCancel == null ? void 0 : userCancel.addEventListener("click", () => {
  userModal.style.display = "none";
  editingUserId = null;
});
userForm == null ? void 0 : userForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitUserAccountForm();
});
userSaveBtn == null ? void 0 : userSaveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  await submitUserAccountForm();
});
const salesRows = document.getElementById("sales-rows");
const salesSearch = document.getElementById("sales-search");
const salesCreate = document.getElementById("sales-create");
const salesModal = document.getElementById("sales-modal");
const salesForm = document.getElementById("sales-form");
const salesCancel = document.getElementById("sales-cancel");
const sName = document.getElementById("s-name");
const sRegion = document.getElementById("s-region");
const sPhone = document.getElementById("s-phone");
const sBase = document.getElementById("s-base");
const sRate = document.getElementById("s-rate");
const sCommission = document.getElementById("s-commission");
const salesData = [];
let editingSalesId = null;
function syncSalespersonNameInOpenFields(oldName = "", newName = "") {
  const from = String(oldName || "").trim();
  const to = String(newName || "").trim();
  if (!from || !to || from === to) return;
  [soSales, editSales, ctSales, paySales].forEach((el) => {
    if (el && String(el.value || "").trim() === from) el.value = to;
  });
}
function syncSalespersonNameInLocalData(oldName = "", newName = "") {
  const from = String(oldName || "").trim();
  const to = String(newName || "").trim();
  if (!from || !to || from === to) return;
  ["customers", "merchants", "others"].forEach((tab) => {
    (contactsData[tab] || []).forEach((item) => {
      if (String((item == null ? void 0 : item.sales) || "").trim() === from) item.sales = to;
    });
  });
  payRecords.forEach((item) => {
    if (String((item == null ? void 0 : item.sales) || "").trim() === from) item.sales = to;
  });
}
function renderSales() {
  const key = ((salesSearch == null ? void 0 : salesSearch.value) || "").trim();
  const data = salesData.filter((x) => {
    if (!key) return true;
    return [x.name, x.region, x.phone].some((v) => (v || "").includes(key));
  }).sort((a, b) => b.id - a.id);
  if (!salesRows) return;
  salesRows.innerHTML = "";
  data.forEach((s) => {
    const tr = document.createElement("tr");
    const related = payRecords.filter((r) => (r.sales || "") === (s.name || ""));
    const docs = Array.from(new Set(related.map((r) => r.doc || "").filter(Boolean)));
    const ordersCount = docs.length;
    const totalAmount = related.reduce((sum, r) => sum + (r.amount || 0), 0);
    const arrearsAmount = related.reduce((sum, r) => sum + Math.max(0, (r.amount || 0) - (r.paid || 0)), 0);
    const cells = [s.id, s.name, s.region || "", s.phone || "", (s.base || 0).toFixed(2), s.rate || 0, (s.commission || 0).toFixed(2)];
    cells.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = String(v);
      tr.appendChild(td);
    });
    const tdOrders = document.createElement("td");
    const aOrders = document.createElement("a");
    aOrders.href = "#";
    aOrders.textContent = String(ordersCount);
    aOrders.className = "link-blue";
    tdOrders.appendChild(aOrders);
    tr.appendChild(tdOrders);
    const tdTotal = document.createElement("td");
    tdTotal.textContent = totalAmount.toFixed(2);
    tr.appendChild(tdTotal);
    const tdArrears = document.createElement("td");
    tdArrears.textContent = arrearsAmount.toFixed(2);
    tdArrears.style.color = "#ef4444";
    tr.appendChild(tdArrears);
    const tdCreated = document.createElement("td");
    tdCreated.textContent = s.created || "";
    tr.appendChild(tdCreated);
    const ops = document.createElement("td");
    ops.className = "actions";
    const edit = document.createElement("a");
    edit.href = "#";
    edit.textContent = "\u7F16\u8F91";
    edit.className = "link-blue";
    const del = document.createElement("a");
    del.href = "#";
    del.textContent = "\u5220\u9664";
    del.className = "link-red";
    ops.append(edit, document.createTextNode(" "), del);
    tr.appendChild(ops);
    salesRows.appendChild(tr);
    aOrders.addEventListener("click", (e) => {
      e.preventDefault();
      openSalesOrders(s.name);
    });
    edit.addEventListener("click", (e) => {
      e.preventDefault();
      editingSalesId = s.id;
      sName.value = s.name || "";
      sRegion.value = s.region || "";
      sPhone.value = s.phone || "";
      sBase.value = s.base != null ? s.base : "";
      sRate.value = s.rate != null ? s.rate : "";
      sCommission.value = s.commission != null ? s.commission : "";
      salesModal.style.display = "flex";
    });
    del.addEventListener("click", async (e) => {
      var _a2, _b2;
      e.preventDefault();
      if (!confirm("\u786E\u5B9A\u5220\u9664\u8BE5\u4E1A\u52A1\u5458\uFF1F")) return;
      const i = salesData.findIndex((x) => x.id === s.id);
      if (i >= 0) {
        try {
          await apiSalesDelete(s.id);
          salesData.splice(i, 1);
          await apiSalesList((salesSearch == null ? void 0 : salesSearch.value) || "");
          renderSales();
          saveJSON("salesData", salesData);
        } catch (err) {
          if (((_a2 = err == null ? void 0 : err.data) == null ? void 0 : _a2.error) === "user_bound") return showAppToast("\u8BE5\u4E1A\u52A1\u5458\u540D\u4E0B\u6709\u7528\u6237\uFF0C\u4E0D\u53EF\u5220\u9664");
          if (((_b2 = err == null ? void 0 : err.data) == null ? void 0 : _b2.error) === "in_use") return showAppToast("\u8BE5\u4E1A\u52A1\u5458\u5DF2\u88AB\u4E1A\u52A1\u5355\u636E\u4F7F\u7528\uFF0C\u6682\u4E0D\u53EF\u5220\u9664");
          return showAppToast("\u5220\u9664\u5931\u8D25");
        }
      }
    });
    tdArrears.addEventListener("click", (e) => {
      e.preventDefault();
      openSalesArrears(s.name);
    });
  });
  const sel = document.getElementById("ct-sales");
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">\u8BF7\u9009\u62E9\u4E1A\u52A1\u5458</option>';
    salesData.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }
}
salesCreate == null ? void 0 : salesCreate.addEventListener("click", () => {
  editingSalesId = null;
  sName.value = "";
  sRegion.value = "";
  sPhone.value = "";
  sBase.value = "";
  sRate.value = "";
  sCommission.value = "";
  salesModal.style.display = "flex";
});
salesCancel == null ? void 0 : salesCancel.addEventListener("click", () => {
  salesModal.style.display = "none";
  editingSalesId = null;
});
salesForm == null ? void 0 : salesForm.addEventListener("submit", async (e) => {
  var _a2;
  e.preventDefault();
  const name = sName.value.trim();
  const region = sRegion.value.trim();
  const phone = sPhone.value.trim();
  const base = parseFloat(sBase.value || "0");
  const rate = parseFloat(sRate.value || "0");
  const commission = parseFloat(sCommission.value || "0");
  if (!name || !phone) return;
  try {
    if (editingSalesId != null) {
      const s = salesData.find((x) => x.id === editingSalesId);
      const oldName = String((s == null ? void 0 : s.name) || "").trim();
      const result = await apiSalesUpdate(editingSalesId, { name, region, phone, base: isNaN(base) ? 0 : base, rate: isNaN(rate) ? 0 : rate, commission: isNaN(commission) ? 0 : commission });
      syncSalespersonNameInOpenFields(oldName, (result == null ? void 0 : result.name) || name);
      syncSalespersonNameInLocalData(oldName, (result == null ? void 0 : result.name) || name);
    } else {
      const now = /* @__PURE__ */ new Date();
      const created = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      await apiSalesCreate({ name, region, phone, base: isNaN(base) ? 0 : base, rate: isNaN(rate) ? 0 : rate, commission: isNaN(commission) ? 0 : commission, created });
    }
  } catch (err) {
    if (((_a2 = err == null ? void 0 : err.data) == null ? void 0 : _a2.error) === "duplicate_name") return showAppToast("\u4E1A\u52A1\u5458\u540D\u5B57\u5DF2\u5B58\u5728");
    return showAppToast("\u4FDD\u5B58\u5931\u8D25");
  }
  salesModal.style.display = "none";
  editingSalesId = null;
  await apiSalesList((salesSearch == null ? void 0 : salesSearch.value) || "");
  renderSales();
  saveJSON("salesData", salesData);
});
salesSearch == null ? void 0 : salesSearch.addEventListener("input", async () => {
  await apiSalesList((salesSearch == null ? void 0 : salesSearch.value) || "");
  renderSales();
});
const salesOrdersModal = document.getElementById("sales-orders-modal");
const salesOrdersRows = document.getElementById("sales-orders-rows");
const salesOrdersHead = document.getElementById("sales-orders-head");
const salesOrdersClose = document.getElementById("sales-orders-close");
const salesArrearsModal = document.getElementById("sales-arrears-modal");
const salesArrearsRows = document.getElementById("sales-arrears-rows");
const salesArrearsHead = document.getElementById("sales-arrears-head");
const salesArrearsClose = document.getElementById("sales-arrears-close");
function openSalesOrders(name) {
  salesOrdersHead.textContent = "\u4E1A\u52A1\u5458\uFF1A" + (name || "");
  const list = payRecords.filter((r) => (r.sales || "") === (name || ""));
  salesOrdersRows.innerHTML = "";
  list.forEach((r) => {
    const tr = document.createElement("tr");
    const paid = r.paid || 0;
    const arrears = Math.max(0, (r.amount || 0) - paid);
    [r.type, r.partner || "", r.doc || "", (r.amount || 0).toFixed(2), paid.toFixed(2), arrears.toFixed(2), r.date || ""].forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = String(v);
      if (i === 5 && arrears > 0) td.style.color = "#ef4444";
      tr.appendChild(td);
    });
    salesOrdersRows.appendChild(tr);
  });
  salesOrdersModal.style.display = "flex";
}
function openSalesArrears(name) {
  salesArrearsHead.textContent = "\u4E1A\u52A1\u5458\uFF1A" + (name || "");
  const list = payRecords.filter((r) => (r.sales || "") === (name || "") && Math.max(0, (r.amount || 0) - (r.paid || 0)) > 0);
  salesArrearsRows.innerHTML = "";
  list.forEach((r) => {
    const tr = document.createElement("tr");
    const paid = r.paid || 0;
    const remain = Math.max(0, (r.amount || 0) - paid);
    [r.type, r.partner || "", r.doc || "", (r.amount || 0).toFixed(2), paid.toFixed(2), remain.toFixed(2), r.date || ""].forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = String(v);
      if (i === 5) td.style.color = "#ef4444";
      tr.appendChild(td);
    });
    salesArrearsRows.appendChild(tr);
  });
  salesArrearsModal.style.display = "flex";
}
salesOrdersClose == null ? void 0 : salesOrdersClose.addEventListener("click", () => {
  salesOrdersModal.style.display = "none";
});
salesArrearsClose == null ? void 0 : salesArrearsClose.addEventListener("click", () => {
  salesArrearsModal.style.display = "none";
});
const logoutBtn = document.getElementById("logout-btn");
const authUserTag = document.getElementById("auth-user-tag");
const authUserRow = document.getElementById("auth-user-row");
const authLanguageSwitch = document.getElementById("auth-language-switch");
const authLanguageButtons = authLanguageSwitch ? Array.from(authLanguageSwitch.querySelectorAll("[data-locale]")) : [];
function getAuthUser() {
  try {
    return JSON.parse(localStorage.getItem("authUser") || "null");
  } catch (e) {
    return null;
  }
}
function getResolvedAppLocale() {
  var _a2, _b2;
  return normalizeAppLocale(((_a2 = getAuthUser()) == null ? void 0 : _a2.locale) || ((_b2 = window.getAppLocale) == null ? void 0 : _b2.call(window)) || "zh-CN");
}
function setAuthUI() {
  const u = getAuthUser();
  if (u) {
    if (authUserRow) authUserRow.style.display = "flex";
    authUserTag.style.display = "inline-block";
    authUserTag.textContent = String(u.name || "");
    if (authLanguageSwitch) {
      authLanguageSwitch.style.display = "inline-flex";
      setAuthLanguageToggleValue(normalizeAppLocale(u.locale || "zh-CN"));
    }
    logoutBtn.style.display = "block";
  } else {
    if (authUserRow) authUserRow.style.display = "none";
    authUserTag.style.display = "none";
    if (authLanguageSwitch) authLanguageSwitch.style.display = "none";
    logoutBtn.style.display = "none";
  }
}
function setAuthUser(u) {
  if (u) localStorage.setItem("authUser", JSON.stringify(u));
  else localStorage.removeItem("authUser");
  setAuthUI();
}
function setAuthLanguageToggleValue(locale) {
  const nextLocale = normalizeAppLocale(locale);
  authLanguageButtons.forEach((btn) => {
    const isActive = String(btn.dataset.locale || "") === nextLocale;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}
function syncAuthLocaleFromUser() {
  const locale = getResolvedAppLocale();
  if (typeof window.setAppLocale === "function") window.setAppLocale(locale);
}
function getUserRoleName(name) {
  if (name === "aaaaaa") return "\u8D85\u7EA7\u7BA1\u7406\u5458";
  const au = getAuthUser();
  if (au && au.name === name) return au.role || "";
  return "";
}
function getPwdMap() {
  try {
    return JSON.parse(localStorage.getItem("userPasswords") || "{}");
  } catch (e) {
    return {};
  }
}
function setPwdMap(map) {
  localStorage.setItem("userPasswords", JSON.stringify(map || {}));
}
const API_BASE = "";
function getAuthToken() {
  try {
    return localStorage.getItem("authToken") || "";
  } catch (e) {
    return "";
  }
}
let authSessionCheckPromise = null;
async function ensureAuthSession() {
  const token = getAuthToken();
  if (!token) return false;
  if (authSessionCheckPromise) return authSessionCheckPromise;
  authSessionCheckPromise = (async () => {
    try {
      const r = await fetch(API_BASE + "/api/auth/me", {
        headers: { Authorization: "Bearer " + token }
      });
      if (!r.ok) {
        localStorage.removeItem("authToken");
        setAuthUser(null);
        location.href = "./login.html";
        return false;
      }
      const data = await r.json().catch(() => ({}));
      if (data == null ? void 0 : data.user) setAuthUser(data.user);
      return true;
    } catch (e) {
      return false;
    } finally {
      authSessionCheckPromise = null;
    }
  })();
  return authSessionCheckPromise;
}
async function apiFetchJSON(path, opts) {
  const token = getAuthToken();
  const headers = Object.assign({}, opts && opts.headers || {});
  if (token) headers["Authorization"] = "Bearer " + token;
  const r = await fetch(API_BASE + path, { ...opts || {}, headers });
  if (r.status === 401) {
    location.href = "./login.html";
    throw new Error("unauthorized");
  }
  if (!r.ok) {
    let data = null;
    try {
      data = await r.json();
    } catch (e) {
    }
    const err = new Error((data == null ? void 0 : data.error) || "network_error");
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return await r.json();
}
async function loadLedgerFromServer(preserveScroll = false) {
  try {
    const list = await apiFetchJSON("/api/ledger");
    if (Array.isArray(list)) {
      records.splice(0, records.length, ...list.map((r) => {
        const createdRaw = Number(r.created_at);
        const createdAt = Number.isFinite(createdRaw) && createdRaw > 0 ? createdRaw : Date.parse(r.date_time || r.date || "") || Date.now();
        return {
          id: r.id,
          type: r.type || "",
          category: LEGACY_COMPANY_LOAN_CATEGORIES.includes(String(r.category || "").trim()) ? COMPANY_LOAN_CATEGORY : (r.category || ""),
          doc: r.doc || "",
          client: r.client || "",
          amount: Number(r.amount || 0),
          repaidAmount: Number(r.repaid_amount || 0),
          loanSettled: r.loan_settled === true || Number(r.repaid_amount || 0) >= Number(r.amount || 0),
          method: r.method || "",
          file: r.file || "",
          fileUrl: r.file && r.file.startsWith("/") ? r.file : "",
          fileName: r.file ? r.file.split("/").pop() : "",
          notes: r.notes || "",
          skipAccountBalance: r.skip_account_balance === true,
          date: r.date || "",
          dateTime: r.date_time || "",
          createdAt,
          createdBy: r.created_by || "",
          confirmedBy: r.confirmed_by || "",
          confirmed: r.confirmed !== false,
          entry: "\u624B\u52A8"
        };
      }));
      saveJSON("records", records);
      applyFilters(preserveScroll);
      const hm = document.getElementById("page-home");
      if (hm && hm.style.display === "block") {
        renderHomeChart((homePeriodSel == null ? void 0 : homePeriodSel.value) || "month");
        renderSalesChart((salesPeriodSel == null ? void 0 : salesPeriodSel.value) || "month");
      }
    }
  } catch (e) {
  }
}
async function loadPayablesFromServer() {
  try {
    const list = await apiFetchJSON("/api/payables");
    if (Array.isArray(list)) {
      payRecords.splice(0, payRecords.length, ...list.map((r) => {
        var _a2, _b2;
        const createdRaw = Number(r.created_at);
        const createdAt = Number.isFinite(createdRaw) && createdRaw > 0 ? createdRaw : Date.parse(r.date || "") || Date.now();
        return normalizePayRecordAttachment({
          id: r.id,
          type: r.type,
          partner: r.partner,
          doc: r.doc,
          sales: r.sales,
          amount: Number(r.amount || 0),
          paid: ["逃单", "作废"].includes(String(r.special_status || r.specialStatus || "").trim())
            ? Number(r.amount || 0)
            : Number(r.paid || 0),
          trustDays: (_a2 = r.trust_days) != null ? _a2 : null,
          notes: r.notes || "",
          date: r.date || "",
          settled: !!r.settled,
          history: r.history || [],
          createdAt,
          invoiceNo: r.invoice_no || "",
          invoiceDate: r.invoice_date || "",
          invoiceAmount: Number(r.invoice_amount || 0),
          file: r.file || "",
          fileUrl: r.file || r.file_url || r.attachment || "",
          file_url: r.file_url || "",
          attachment: r.attachment || "",
          attachmentUrl: r.attachmentUrl || r.attachment_url || "",
          fileName: r.file ? r.file.split("/").pop() : "",
          source: r.source || "import",
          batchAt: r.batch_at || 0,
          batchOrder: (_b2 = r.batch_order) != null ? _b2 : 0,
          confirmed: r.confirmed !== false,
          confirmedBy: r.confirmed_by || "",
          confirmedAt: r.confirmed_at || "",
          specialStatus: String(r.special_status || r.specialStatus || "").trim()
        });
      }));
      saveJSON("payRecords", payRecords);
      renderPayables();
    }
  } catch (e) {
  }
}
async function loadAllContacts() {
  await Promise.all([
    apiContactsList("customers", "", 1, 5e3),
    apiContactsList("merchants", "", 1, 5e3),
    apiContactsList("others", "", 1, 5e3)
  ]);
  contactsLoaded = true;
}
function hasPlaceholderContacts() {
  var _a2, _b2, _c2;
  return !!(((_a2 = contactsData.customers) == null ? void 0 : _a2.some((x) => x.name === "\u5BA2\u6237A")) || ((_b2 = contactsData.merchants) == null ? void 0 : _b2.some((x) => x.name === "\u5546\u5BB6A")) || ((_c2 = contactsData.others) == null ? void 0 : _c2.some((x) => x.name === "\u5355\u4F4DA")));
}
async function ensureRealContactsLoaded() {
  if (contactsLoaded && !hasPlaceholderContacts()) return;
  await loadAllContacts();
}
async function apiContactsList(tab, q, page, size) {
  try {
    const params = new URLSearchParams({ tab: tab || "customers", q: q || "", page: String(page || 1), size: String(size || 100) });
    const list = await apiFetchJSON("/api/contacts?" + params.toString());
    const key = tab === "merchants" ? "merchants" : tab === "others" ? "others" : "customers";
    if (Array.isArray(list)) contactsData[key] = list.map((x) => ({
      id: x.id,
      name: x.name,
      contact: x.contact,
      phone: x.phone,
      city: x.city,
      remark: x.remark,
      owner: x.owner,
      created: x.created,
      company: x.company,
      code: x.code,
      country: x.country,
      address: x.address,
      zip: x.zip,
      sales: x.sales,
      use_price: x.use_price,
      is_iva: x.is_iva,
      invoice_nota: x.invoice_nota,
      email: x.email,
      province: x.province,
      ship_address: x.ship_address,
      ship_zip: x.ship_zip,
      ship_city: x.ship_city,
      ship_province: x.ship_province,
      ship_country: x.ship_country,
      ship_phone: x.ship_phone,
      ship_contact: x.ship_contact,
      shipping_addresses: Array.isArray(x.shipping_addresses) ? x.shipping_addresses : []
    }));
    contactsLoaded = true;
  } catch (e) {
  }
}
async function apiContactsCreate(obj) {
  const r = await apiFetchJSON("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  return r.id;
}
async function apiContactsUpdateById(id, obj) {
  await apiFetchJSON("/api/contacts/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
}
async function apiContactsDeleteByName(owner, name) {
  try {
    const params = new URLSearchParams({ owner, name });
    const r = await fetch(API_BASE + "/api/contacts/by-name?" + params.toString(), { method: "DELETE" });
    if (r.ok) return { ok: true };
    let err = null;
    try {
      err = await r.json();
    } catch (e) {
    }
    return { ok: false, error: (err == null ? void 0 : err.error) || "delete_failed", usage: (err == null ? void 0 : err.usage) || null };
  } catch (e) {
    return { ok: false, error: "network_error", usage: null };
  }
}
async function apiContactsMerge(sourceId, targetName) {
  try {
    const r = await fetch(API_BASE + "/api/contacts/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId, target_name: targetName })
    });
    if (r.ok) return await r.json();
    let err = null;
    try {
      err = await r.json();
    } catch (e) {
    }
    return { ok: false, error: (err == null ? void 0 : err.error) || "merge_failed" };
  } catch (e) {
    return { ok: false, error: "network_error" };
  }
}
function formatContactUsageMessage(usage) {
  const u = usage || {};
  const parts = [];
  if (Number(u.daily_orders || 0) > 0) parts.push(`\u8BA2\u5355 ${u.daily_orders} \u6761`);
  if (Number(u.invoices || 0) > 0) parts.push(`\u53D1\u7968 ${u.invoices} \u6761`);
  if (Number(u.payables || 0) > 0) parts.push(`\u5E94\u6536\u5E94\u4ED8 ${u.payables} \u6761`);
  if (Number(u.ledger || 0) > 0) parts.push(`\u8D22\u52A1\u8BB0\u5F55 ${u.ledger} \u6761`);
  return parts.length ? `\u8BE5\u5BA2\u6237\u6B63\u5728\u4F7F\u7528\u4E2D\uFF0C\u65E0\u6CD5\u88AB\u5220\u9664\u3002
${parts.join("\uFF0C")}` : "\u8BE5\u5BA2\u6237\u6B63\u5728\u4F7F\u7528\u4E2D\uFF0C\u65E0\u6CD5\u88AB\u5220\u9664";
}
function formatContactMergeMessage(result) {
  const refs = (result == null ? void 0 : result.moved_refs) || {};
  const parts = [];
  if (Number(refs.daily_orders || 0) > 0) parts.push(`\u8BA2\u5355 ${refs.daily_orders} \u6761`);
  if (Number(refs.invoices || 0) > 0) parts.push(`\u53D1\u7968 ${refs.invoices} \u6761`);
  if (Number(refs.payables || 0) > 0) parts.push(`\u5E94\u6536\u5E94\u4ED8 ${refs.payables} \u6761`);
  if (Number(refs.ledger || 0) > 0) parts.push(`\u8D22\u52A1\u8BB0\u5F55 ${refs.ledger} \u6761`);
  if (Number((result == null ? void 0 : result.moved_notes) || 0) > 0) parts.push(`\u5BA2\u6237\u7B14\u8BB0 ${result.moved_notes} \u6761`);
  return parts.length ? `\u5DF2\u5408\u5E76\u5230\u201C${(result == null ? void 0 : result.target_name) || ""}\u201D\u3002
${parts.join("\uFF0C")}` : `\u5DF2\u5408\u5E76\u5230\u201C${(result == null ? void 0 : result.target_name) || ""}\u201D\u3002`;
}
function ownerLabelOfTab(tab) {
  return tab === "merchants" ? "\u5546\u5BB6" : tab === "others" ? "\u5176\u5B83" : "\u5BA2\u6237";
}
async function apiAccountsList() {
  try {
    const list = await apiFetchJSON("/api/accounts");
    if (Array.isArray(list)) {
      accountsData.splice(0, accountsData.length, ...list.map((x) => normalizeAccountItem({ name: x.name, nameEs: x.name_es, balance: x.balance, desc: x.desc, created: x.created, initial_set: x.initial_set })));
      saveJSON("accountsData", accountsData);
    }
  } catch (e) {
  }
}
let shareholderSummaryData = null;
function openCompanyDebtRecords() {
  location.hash = "#debt-ledger";
}
async function loadShareholderSummary() {
  shareholderSummaryData = await apiFetchJSON("/api/shareholder-summary");
  renderHomeBusinessMetrics(shareholderSummaryData.metrics || {});
  renderShareholderSummary();
}
function renderHomeBusinessMetrics(metrics) {
  const container = document.getElementById("home-business-metrics");
  if (!container) return;
  container.innerHTML = "";
  [
    ["本月营业额", metrics.monthSales, "#2dd4bf"],
    ["本月收入", metrics.monthIncome, "#60a5fa"],
    ["本月支出", metrics.monthExpense, "#fb7185"]
  ].forEach(([label, value, color]) => {
    const card = document.createElement("div");
    card.style.cssText = "background:#0b1524;border:1px solid #233048;border-radius:10px;padding:14px;min-height:78px";
    const title = document.createElement("div");
    title.style.cssText = "color:#94a3b8;font-size:13px";
    title.textContent = label;
    const amount = document.createElement("strong");
    amount.style.cssText = `display:block;margin-top:8px;font-size:22px;color:${color}`;
    amount.textContent = formatMoney(value);
    card.append(title, amount);
    container.appendChild(card);
  });
}
function showNetAssetsBreakdown(metrics) {
  const modal = document.getElementById("net-assets-modal");
  const body = document.getElementById("net-assets-modal-body");
  const close = document.getElementById("net-assets-modal-close");
  if (!modal || !body) return;
  const accountBalance = Number(metrics.accountBalance || 0);
  const receivable = Number(metrics.receivable || 0);
  const debt = Number(metrics.debt || 0);
  const netAssets = Number(metrics.netAssets || 0);
  body.innerHTML = `
    <div>净资产不是单独填写的金额，而是按下面的方式计算：</div>
    <div style="margin-top:10px;color:#cbd5e1">账户资金余额 + 应收未收 - 外债欠款</div>
    <div style="margin-top:10px">${formatMoney(accountBalance)} + ${formatMoney(receivable)} - ${formatMoney(debt)} = <strong style="color:#a78bfa">${formatMoney(netAssets)}</strong></div>
    <div style="margin-top:12px;color:#94a3b8;font-size:13px">也就是说，公司现在手里的钱，加上别人还没有付给公司的钱，再减去公司需要偿还的外债，就是当前净资产。</div>
  `;
  if (close && !close.dataset.bound) {
    close.dataset.bound = "1";
    close.addEventListener("click", () => {
      modal.style.display = "none";
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.style.display = "none";
    });
  }
  modal.style.display = "flex";
}
function renderShareholderInvestmentRatioChart(shareholders, totalInvested) {
  const chart = document.getElementById("shareholder-investment-ratio-chart");
  if (!chart) return;
  chart.innerHTML = "";
  const total = Number(totalInvested || 0);
  const items = (Array.isArray(shareholders) ? shareholders : [])
    .map((item, index) => ({
      name: item.shareholder || "未指定股东",
      amount: Math.max(0, Number(item.amount || 0)),
      color: [
        "#38bdf8",
        "#a78bfa",
        "#f472b6",
        "#f59e0b",
        "#34d399",
        "#fb7185"
      ][index % 6]
    }))
    .filter((item) => item.amount > 0);
  if (!items.length || total <= 0) {
    chart.innerHTML = '<span style="color:#64748b;font-size:12px">暂无投入比例</span>';
    return;
  }
  let cursor = 0;
  const segments = items.map((item) => {
    const percent = item.amount / total * 100;
    const segment = `${item.color} ${cursor}% ${cursor + percent}%`;
    cursor += percent;
    return { ...item, percent, segment };
  });
  const stage = document.createElement("div");
  stage.style.cssText = "position:relative;width:min(100%,420px);height:230px";
  const ring = document.createElement("div");
  ring.title = "各股东投入比例";
  ring.style.cssText = `width:140px;height:140px;border-radius:50%;background:conic-gradient(${segments.map((item) => item.segment).join(",")});position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)`;
  const ringCenter = document.createElement("div");
  ringCenter.textContent = "100%";
  ringCenter.style.cssText = "position:absolute;inset:28px;border-radius:50%;background:#111c2d;display:flex;align-items:center;justify-content:center;color:#e2e8f0;font-size:16px;font-weight:600";
  ring.appendChild(ringCenter);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 420 230");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.cssText = "position:absolute;inset:0;overflow:visible";
  let angle = 0;
  segments.forEach((item) => {
    const sweep = item.percent / 100 * Math.PI * 2;
    const middle = angle + sweep / 2;
    const centerX = 210;
    const centerY = 115;
    const lineStartRadius = 74;
    const lineEndRadius = 101;
    const startX = centerX + Math.sin(middle) * lineStartRadius;
    const startY = centerY - Math.cos(middle) * lineStartRadius;
    const endX = centerX + Math.sin(middle) * lineEndRadius;
    const endY = centerY - Math.cos(middle) * lineEndRadius;
    const rightSide = Math.sin(middle) >= 0;
    const textX = endX + (rightSide ? 7 : -7);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", startX);
    line.setAttribute("y1", startY);
    line.setAttribute("x2", endX);
    line.setAttribute("y2", endY);
    line.setAttribute("stroke", item.color);
    line.setAttribute("stroke-width", "1.5");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", textX);
    text.setAttribute("y", endY + 4);
    text.setAttribute("text-anchor", rightSide ? "start" : "end");
    text.setAttribute("fill", "#cbd5e1");
    text.setAttribute("font-size", "12");
    text.textContent = `${item.name} ${item.percent.toFixed(1)}%`;
    svg.append(line, text);
    angle += sweep;
  });
  stage.append(svg, ring);
  chart.appendChild(stage);
}
function renderShareholderSummary() {
  const data = shareholderSummaryData || {};
  const metrics = data.metrics || {};
  const metricEl = document.getElementById("shareholder-metrics");
  const rowsEl = document.getElementById("shareholder-summary-rows");
  const investmentRowsEl = document.getElementById("shareholder-investment-rows");
  const addBtn = document.getElementById("shareholder-investment-add");
  if (!metricEl || !rowsEl || !investmentRowsEl) return;

  const metricItems = [
    ["项目累计投入", metrics.totalInvested, "#38bdf8"],
    ["账户资金余额", metrics.accountBalance, "#22c55e"],
    ["外债欠款", metrics.debt, "#f97316"],
    ["当前净资产", metrics.netAssets, "#a78bfa"],
    ["应收未收", metrics.receivable, "#facc15"]
  ];
  metricEl.innerHTML = "";
  metricItems.forEach(([label, value, color]) => {
    const card = document.createElement("div");
    card.style.cssText = "background:#0b1524;border:1px solid #233048;border-radius:10px;padding:14px;min-height:78px";
    const title = document.createElement("div");
    title.style.cssText = "color:#94a3b8;font-size:13px";
    title.textContent = label;
    const amount = document.createElement("strong");
    amount.style.cssText = `display:block;margin-top:8px;font-size:22px;color:${color}`;
    amount.textContent = formatMoney(value);
    card.append(title, amount);
    if (label === "当前净资产") {
      card.style.cursor = "pointer";
      card.title = "点击查看净资产计算过程";
      card.addEventListener("click", () => showNetAssetsBreakdown(metrics));
    }
    if (label === "外债欠款") {
      card.style.cursor = "pointer";
      card.title = "查看公司向他人借款记录";
      card.addEventListener("click", openCompanyDebtRecords);
    }
    metricEl.appendChild(card);
  });

  const shareholderRows = Array.isArray(data.shareholders) ? data.shareholders : [];
  renderShareholderInvestmentRatioChart(shareholderRows, metrics.totalInvested);
  rowsEl.innerHTML = "";
  if (!shareholderRows.length) {
    rowsEl.innerHTML = '<tr class="empty"><td colspan="4">暂无股东投入记录，请由管理员添加</td></tr>';
  } else {
    shareholderRows.forEach((item) => {
      const tr = document.createElement("tr");
      [item.shareholder || "未指定股东", formatMoney(item.amount)].forEach((text) => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
      const holdingTd = document.createElement("td");
      holdingTd.textContent = `${Number(item.holdingPercent || 0).toFixed(2)}%`;
      tr.appendChild(holdingTd);
      const investmentShareTd = document.createElement("td");
      const totalInvested = Number(metrics.totalInvested || 0);
      investmentShareTd.textContent = totalInvested > 0
        ? `${(Number(item.amount || 0) / totalInvested * 100).toFixed(1)}%`
        : "-";
      tr.appendChild(investmentShareTd);
      rowsEl.appendChild(tr);
    });
  }

  const investments = Array.isArray(data.investments) ? data.investments : [];
  const canDeleteInvestment = isCurrentUserAdmin();
  const actionHeader = document.getElementById("shareholder-investment-action-header");
  if (actionHeader) actionHeader.style.display = canDeleteInvestment ? "" : "none";
  investmentRowsEl.innerHTML = "";
  if (!investments.length) {
    investmentRowsEl.innerHTML = `<tr class="empty"><td colspan="${canDeleteInvestment ? 6 : 5}">暂无记录</td></tr>`;
  } else {
    investments.slice(0, 100).forEach((item) => {
      const tr = document.createElement("tr");
      const amount = document.createElement("td");
      amount.textContent = `${item.kind === "撤资" ? "-" : "+"}${formatMoney(item.amount)}`;
      amount.style.color = item.kind === "撤资" ? "#fb7185" : "#4ade80";
      [item.investmentDate || "-", item.shareholder || "-", item.kind || "投入", item.notes || "-"].forEach((value) => {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.appendChild(td);
      });
      tr.insertBefore(amount, tr.children[3]);
      if (canDeleteInvestment) {
        const actionTd = document.createElement("td");
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btn-sm btn-danger";
        deleteBtn.textContent = "删除";
        deleteBtn.addEventListener("click", () => {
          openConfirm("确定删除这条股东投入记录吗？", async () => {
            await apiFetchJSON(`/api/shareholder-investments/${item.id}`, { method: "DELETE" });
            await loadShareholderSummary();
          });
        });
        actionTd.appendChild(deleteBtn);
        tr.appendChild(actionTd);
      }
      investmentRowsEl.appendChild(tr);
    });
  }
  if (addBtn) {
    addBtn.style.display = canDeleteInvestment ? "inline-flex" : "none";
    if (!addBtn.dataset.bound) {
      addBtn.dataset.bound = "1";
      addBtn.addEventListener("click", openShareholderInvestmentModal);
    }
  }
}
function openShareholderInvestmentModal() {
  if (!isCurrentUserAdmin()) return;
  const modal = document.getElementById("shareholder-investment-modal");
  const select = document.getElementById("shareholder-investment-shareholder");
  const date = document.getElementById("shareholder-investment-date");
  const data = shareholderSummaryData || {};
  if (!modal || !select) return;
  select.innerHTML = "";
  (data.shareholderUsers || []).forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  if (!select.options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无股东账号";
    select.appendChild(option);
  }
  if (date) date.value = new Date().toISOString().slice(0, 10);
  modal.style.display = "flex";
}
function closeShareholderInvestmentModal() {
  const modal = document.getElementById("shareholder-investment-modal");
  if (modal) modal.style.display = "none";
}
async function saveShareholderInvestment() {
  const payload = {
    shareholder: document.getElementById("shareholder-investment-shareholder")?.value || "",
    kind: document.getElementById("shareholder-investment-kind")?.value || "投入",
    amount: Number(document.getElementById("shareholder-investment-amount")?.value || 0),
    investmentDate: document.getElementById("shareholder-investment-date")?.value || "",
    notes: document.getElementById("shareholder-investment-notes")?.value || ""
  };
  try {
    await apiFetchJSON("/api/shareholder-investments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    closeShareholderInvestmentModal();
    await loadShareholderSummary();
    showAppToast("股东投入记录已保存");
  } catch (e) {
    alert("保存失败，请检查金额和股东信息");
  }
}
document.getElementById("shareholder-investment-cancel")?.addEventListener("click", closeShareholderInvestmentModal);
document.getElementById("shareholder-investment-save")?.addEventListener("click", saveShareholderInvestment);
async function apiAccountCreate(obj) {
  try {
    await apiFetchJSON("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  } catch (e) {
  }
}
async function apiAccountUpdateByName(obj) {
  return await apiFetchJSON("/api/accounts/by-name", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
}
async function apiAccountInit(name, amount) {
  try {
    await apiFetchJSON("/api/accounts/init", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, amount }) });
  } catch (e) {
  }
}
async function apiAccountDeleteByName(name) {
  try {
    const params = new URLSearchParams({ name });
    const r = await fetch(API_BASE + "/api/accounts/by-name?" + params.toString(), { method: "DELETE" });
    return r.ok;
  } catch (e) {
    return false;
  }
}
async function apiCategoriesList() {
  try {
    const list = await apiFetchJSON("/api/categories");
    if (Array.isArray(list)) {
      categoriesData.splice(0, categoriesData.length, ...list.map((x) => ({
        name: x.name,
        children: Array.isArray(x.children)
          ? x.children.map((child) => LEGACY_COMPANY_LOAN_CATEGORIES.includes(String(child || "").trim()) ? COMPANY_LOAN_CATEGORY : child)
          : []
      })));
      const income = categoriesData.find((item) => item.name === "收入");
      if (income && !income.children.includes(COMPANY_LOAN_CATEGORY)) income.children.splice(Math.min(3, income.children.length), 0, COMPANY_LOAN_CATEGORY);
      const expense = categoriesData.find((item) => item.name === "开支");
      if (expense && !expense.children.includes(COMPANY_REPAYMENT_CATEGORY)) expense.children.splice(Math.min(4, expense.children.length), 0, COMPANY_REPAYMENT_CATEGORY);
      saveJSON("categoriesData", categoriesData);
    }
  } catch (e) {
  }
}
async function apiCategoriesSave() {
  try {
    await apiFetchJSON("/api/categories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list: categoriesData }) });
  } catch (e) {
  }
}
async function apiSalesList(q) {
  try {
    const params = new URLSearchParams({ q: q || "" });
    const list = await apiFetchJSON("/api/sales?" + params.toString());
    if (Array.isArray(list)) {
      salesData.splice(0, salesData.length, ...list.map((x) => ({ id: x.id, name: x.name, region: x.region || "", phone: x.phone || "", base: Number(x.base || 0), rate: Number(x.rate || 0), commission: Number(x.commission || 0), created: x.created || "" })));
    }
  } catch (e) {
  }
}
async function apiSalesCreate(obj) {
  try {
    const r = await apiFetchJSON("/api/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
    return r == null ? void 0 : r.id;
  } catch (e) {
    return null;
  }
}
async function apiSalesUpdate(id, obj) {
  return await apiFetchJSON("/api/sales/" + String(id || 0), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
}
async function apiSalesDelete(id) {
  return await apiFetchJSON("/api/sales/" + String(id || 0), { method: "DELETE" });
}
async function apiUsersList() {
  try {
    const list = await apiFetchJSON("/api/users");
    if (Array.isArray(list)) userAccounts.splice(0, userAccounts.length, ...list.map((u) => ({ id: u.id, name: u.name, role: u.role || "", locale: normalizeAppLocale(u.locale), created: u.created || "", enabled: !!u.enabled, holdingPercent: Number(u.holding_percent ?? u.holdingPercent ?? 0) })));
  } catch (e) {
  }
}
async function apiDailyOrderActionAssignments() {
  try {
    const data = await apiFetchJSON("/api/daily-orders/action-assignments");
    dailyOrderActionAssignments = normalizeDailyOrderActionAssignmentsMap(data == null ? void 0 : data.assignments, true);
  } catch (e) {
  }
  renderDailyOrderActionAssignPanel();
  return dailyOrderActionAssignments;
}
async function apiSaveDailyOrderActionAssignments(assignments) {
  const res = await apiFetchJSON("/api/daily-orders/action-assignments", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assignments || {})
  });
  dailyOrderActionAssignments = normalizeDailyOrderActionAssignmentsMap(res == null ? void 0 : res.assignments, false);
  renderDailyOrderActionAssignPanel();
  return dailyOrderActionAssignments;
}
async function apiDailyOrderPendingOps() {
  try {
    const data = await apiFetchJSON("/api/daily-orders/pending-ops");
    dailyOrderActionPendingTotal = Number((data == null ? void 0 : data.total) || 0) || 0;
    dailyOrderActionPendingCounts = {
      enable_allocation: Number((data == null ? void 0 : data.counts) && data.counts.enable_allocation || 0) || 0,
      allocate: Number((data == null ? void 0 : data.counts) && data.counts.allocate || 0) || 0,
      ready_to_ship: Number((data == null ? void 0 : data.counts) && data.counts.ready_to_ship || 0) || 0,
      contact_logistics: Number((data == null ? void 0 : data.counts) && data.counts.contact_logistics || 0) || 0,
      ship: Number((data == null ? void 0 : data.counts) && data.counts.ship || 0) || 0,
      ship_without_voucher: 0
    };
    if (data == null ? void 0 : data.assignments) {
      dailyOrderActionAssignments = normalizeDailyOrderActionAssignmentsMap(data.assignments, true);
    }
    return data || { total: 0, counts: {} };
  } catch (e) {
    dailyOrderActionPendingTotal = 0;
    dailyOrderActionPendingCounts = {
      enable_allocation: 0,
      allocate: 0,
      ready_to_ship: 0,
      contact_logistics: 0,
      ship: 0,
      ship_without_voucher: 0
    };
    return { total: 0, counts: {} };
  }
}
async function apiUserCreate(obj) {
  try {
    const r = await apiFetchJSON("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
    return r == null ? void 0 : r.id;
  } catch (e) {
    return null;
  }
}
async function apiUserUpdate(id, obj) {
  try {
    await apiFetchJSON("/api/users/" + String(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
    return true;
  } catch (err) {
    return false;
  }
}
async function apiUserDelete(id) {
  try {
    await apiFetchJSON("/api/users/" + String(id), { method: "DELETE" });
    return true;
  } catch (e) {
    return false;
  }
}
async function apiUserResetPassword(id, password) {
  try {
    await apiFetchJSON("/api/users/" + String(id) + "/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  } catch (e) {
  }
}
async function apiUpdateMyLocale(locale) {
  try {
    const res = await apiFetchJSON("/api/users/me/locale", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: normalizeAppLocale(locale) }) });
    return normalizeAppLocale(res == null ? void 0 : res.locale);
  } catch (e) {
    return null;
  }
}
const logoutModal = document.getElementById("logout-modal");
const logoutCancel = document.getElementById("logout-cancel");
const logoutOk = document.getElementById("logout-ok");
const resetModal = document.getElementById("reset-modal");
const resetMsg = document.getElementById("reset-msg");
const resetCancel = document.getElementById("reset-cancel");
const resetOk = document.getElementById("reset-ok");
let pendingResetUser = null;
logoutBtn == null ? void 0 : logoutBtn.addEventListener("click", () => {
  logoutModal.style.display = "flex";
});
authUserTag == null ? void 0 : authUserTag.addEventListener("click", () => {
  const u = getAuthUser();
  const cpUser = document.getElementById("cp-user");
  const oldEl = document.getElementById("cp-old");
  const n1 = document.getElementById("cp-new1");
  const n2 = document.getElementById("cp-new2");
  if (cpUser) cpUser.textContent = (u == null ? void 0 : u.name) || "";
  if (oldEl) oldEl.value = "";
  if (n1) n1.value = "";
  if (n2) n2.value = "";
  document.getElementById("change-pwd-modal").style.display = "flex";
});
logoutCancel == null ? void 0 : logoutCancel.addEventListener("click", () => {
  logoutModal.style.display = "none";
});
logoutOk == null ? void 0 : logoutOk.addEventListener("click", () => {
  logoutModal.style.display = "none";
  financialEditOverrideSettings = { ...financialEditOverrideDefaults };
  financialEditOverrideSettingsLoaded = false;
  setAuthUser(null);
  localStorage.removeItem("authToken");
  location.href = "./login.html";
});
resetCancel == null ? void 0 : resetCancel.addEventListener("click", () => {
  resetModal.style.display = "none";
  pendingResetUser = null;
});
resetOk == null ? void 0 : resetOk.addEventListener("click", async () => {
  if (pendingResetUser) {
    await apiUserResetPassword(pendingResetUser.id, "111111");
    await apiUsersList();
    apiUsersList().then(() => renderUserAccounts());
  }
  resetModal.style.display = "none";
  pendingResetUser = null;
});
const cpCancel = document.getElementById("cp-cancel");
const cpOk = document.getElementById("cp-ok");
cpCancel == null ? void 0 : cpCancel.addEventListener("click", () => {
  document.getElementById("change-pwd-modal").style.display = "none";
});
cpOk == null ? void 0 : cpOk.addEventListener("click", async () => {
  const u = getAuthUser();
  const name = (u == null ? void 0 : u.name) || "";
  const old = document.getElementById("cp-old").value || "";
  const n1 = document.getElementById("cp-new1").value || "";
  const n2 = document.getElementById("cp-new2").value || "";
  if (!name || !old || !n1 || !n2) return;
  if (n1 !== n2) {
    alert("\u4E24\u6B21\u8F93\u5165\u7684\u65B0\u5BC6\u7801\u4E0D\u4E00\u81F4");
    return;
  }
  try {
    const res = await fetchWithAuth("/api/users/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword: old, newPassword: n1 })
    });
    if (!res.ok) {
      const data = await res.json();
      if (data.error === "bad_credentials") {
        alert("\u5F53\u524D\u5BC6\u7801\u4E0D\u6B63\u786E");
      } else {
        alert("\u4FEE\u6539\u5931\u8D25");
      }
      return;
    }
    document.getElementById("change-pwd-modal").style.display = "none";
    alert("\u4FEE\u6539\u5BC6\u7801\u6210\u529F");
  } catch (err) {
    alert("\u4FEE\u6539\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC");
  }
});
function tsOf(rec) {
  const ts = Date.parse(rec.date || rec.dateTime || "") || rec.createdAt;
  return isNaN(ts) ? Date.now() : ts;
}
function formatLabel(ts, mode) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (mode === "year") return String(y);
  if (mode === "month") return `${y}-${m}`;
  return `${m}-${dd}`;
}
function buckets(mode) {
  const now = /* @__PURE__ */ new Date();
  const list = [];
  if (mode === "year") {
    for (let i = 11; i >= 0; i--) {
      const y = now.getFullYear() - i;
      list.push({ key: String(y), start: new Date(y, 0, 1).getTime(), end: new Date(y, 11, 31, 23, 59, 59).getTime() });
    }
  } else if (mode === "day") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const e = s + 24 * 3600 * 1e3 - 1;
      list.push({ key: formatLabel(s, "day"), start: s, end: e });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const s = d.getTime();
      const e = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1;
      list.push({ key: formatLabel(s, "month"), start: s, end: e });
    }
  }
  return list;
}
async function renderHomeChart(mode = "month") {
  if (!homeChartRows) return;
  let data = [];
  try {
    const range = mode === "day" ? 30 : 12;
    let baseDate = "";
    if (mode === "month") baseDate = (homeMonthPicker == null ? void 0 : homeMonthPicker.value) || "";
    if (mode === "year") baseDate = (homeYearPicker == null ? void 0 : homeYearPicker.value) || "";
    data = await apiFetchJSON(`/api/analytics/ledger-summary?period=${mode}&range=${range}&baseDate=${encodeURIComponent(baseDate)}`);
  } catch (e) {
    return;
  }
  const maxVal = Math.max(1, ...data.map((x) => Math.max(x.income, x.expense)));
  const h = 220;
  homeChartRows.innerHTML = "";
  data.forEach((x) => {
    const col = document.createElement("div");
    col.style.display = "flex";
    col.style.flexDirection = "column";
    col.style.alignItems = "center";
    col.style.flex = "1 1 0";
    col.style.minWidth = "0";
    col.style.gap = "8px";
    const bars = document.createElement("div");
    bars.style.display = "flex";
    bars.style.gap = "clamp(2px, 0.5vw, 4px)";
    bars.style.alignItems = "flex-end";
    const mkBar = (val, color) => {
      const b = document.createElement("div");
      const pixelHeight = val > 0 ? Math.max(2, Math.round(h * val / maxVal)) : 0;
      b.style.width = "clamp(6px, 1.2vw, 14px)";
      b.style.height = pixelHeight + "px";
      b.style.background = color;
      b.style.border = "1px solid #334155";
      b.style.borderRadius = "4px";
      const tag = document.createElement("div");
      tag.textContent = (val || 0).toFixed(2);
      tag.style.color = "#cbd5e1";
      tag.style.fontSize = "10px";
      tag.style.textAlign = "center";
      tag.style.whiteSpace = "nowrap";
      tag.style.marginBottom = "4px";
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "center";
      wrap.style.margin = "0";
      wrap.style.padding = "0";
      wrap.style.minWidth = "35px";
      if (val > 0) wrap.appendChild(tag);
      wrap.appendChild(b);
      return wrap;
    };
    bars.appendChild(mkBar(x.income, "#16a34a"));
    bars.appendChild(mkBar(x.expense, "#f59e0b"));
    const labelWrap = document.createElement("div");
    labelWrap.style.display = "flex";
    labelWrap.style.flexDirection = "column";
    labelWrap.style.alignItems = "center";
    labelWrap.style.gap = "2px";
    const label = document.createElement("div");
    label.textContent = x.label;
    label.style.color = "#94a3b8";
    label.style.fontSize = "clamp(9px, 1vw, 12px)";
    const profitVal = (x.income || 0) - (x.expense || 0);
    const profit = document.createElement("div");
    profit.textContent = profitVal.toFixed(2);
    profit.style.fontSize = "11px";
    profit.style.fontWeight = "bold";
    profit.style.color = profitVal >= 0 ? "#16a34a" : "#ef4444";
    labelWrap.appendChild(label);
    labelWrap.appendChild(profit);
    col.appendChild(bars);
    col.appendChild(labelWrap);
    homeChartRows.appendChild(col);
  });
}
const homeMonthPicker = document.getElementById("home-month-picker");
const homeYearPicker = document.getElementById("home-year-picker");
function updateHomePeriodUI() {
  const v = (homePeriodSel == null ? void 0 : homePeriodSel.value) || "month";
  if (v === "month") {
    if (homeMonthPicker) homeMonthPicker.style.display = "block";
    if (homeYearPicker) homeYearPicker.style.display = "none";
  } else if (v === "year") {
    if (homeMonthPicker) homeMonthPicker.style.display = "none";
    if (homeYearPicker) homeYearPicker.style.display = "block";
  } else {
    if (homeMonthPicker) homeMonthPicker.style.display = "none";
    if (homeYearPicker) homeYearPicker.style.display = "none";
  }
}
setTimeout(() => updateHomePeriodUI(), 100);
homePeriodSel == null ? void 0 : homePeriodSel.addEventListener("change", () => {
  updateHomePeriodUI();
  const v = homePeriodSel.value || "month";
  renderHomeChart(v);
});
homeMonthPicker == null ? void 0 : homeMonthPicker.addEventListener("change", () => {
  if (homePeriodSel.value === "month") renderHomeChart("month");
});
homeYearPicker == null ? void 0 : homeYearPicker.addEventListener("change", () => {
  if (homePeriodSel.value === "year") renderHomeChart("year");
});
const salesMonthPicker = document.getElementById("sales-month-picker");
const salesYearPicker = document.getElementById("sales-year-picker");
function updateSalesPeriodUI() {
  const v = (salesPeriodSel == null ? void 0 : salesPeriodSel.value) || "month";
  if (v === "month") {
    if (salesMonthPicker) salesMonthPicker.style.display = "block";
    if (salesYearPicker) salesYearPicker.style.display = "none";
  } else if (v === "year") {
    if (salesMonthPicker) salesMonthPicker.style.display = "none";
    if (salesYearPicker) salesYearPicker.style.display = "block";
  } else {
    if (salesMonthPicker) salesMonthPicker.style.display = "none";
    if (salesYearPicker) salesYearPicker.style.display = "none";
  }
}
setTimeout(() => updateSalesPeriodUI(), 100);
salesPeriodSel == null ? void 0 : salesPeriodSel.addEventListener("change", () => {
  updateSalesPeriodUI();
  const v = salesPeriodSel.value || "month";
  renderSalesChart(v);
});
salesMonthPicker == null ? void 0 : salesMonthPicker.addEventListener("change", () => {
  if (salesPeriodSel.value === "month") renderSalesChart("month");
});
salesYearPicker == null ? void 0 : salesYearPicker.addEventListener("change", () => {
  if (salesPeriodSel.value === "year") renderSalesChart("year");
});
async function renderSalesChart(mode = "month") {
  if (!salesChartSvg) return;
  const averageEl = document.getElementById("sales-average");
  let data = [];
  try {
    const range = mode === "day" ? 30 : 12;
    let baseDate = "";
    if (mode === "month") baseDate = (salesMonthPicker == null ? void 0 : salesMonthPicker.value) || "";
    if (mode === "year") baseDate = (salesYearPicker == null ? void 0 : salesYearPicker.value) || "";
    data = await apiFetchJSON(`/api/analytics/sales-summary?period=${mode}&range=${range}&baseDate=${encodeURIComponent(baseDate)}`);
  } catch (e) {
    if (averageEl) averageEl.textContent = "平均：-";
    return;
  }
  const salesData = Array.isArray(data) ? data : [];
  const averageSales = salesData.length
    ? salesData.reduce((sum, item) => sum + Number(item.amount || 0), 0) / salesData.length
    : 0;
  if (averageEl) averageEl.textContent = `平均：${formatMoney(averageSales)}`;
  const svg = salesChartSvg;
  svg.innerHTML = "";
  if (salesData.length === 0) return;
  const w = Math.max(600, svg.clientWidth || 800);
  const h = svg.clientHeight || 300;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const padding = { top: 40, right: 40, bottom: 40, left: 40 };
  const innerW = w - padding.left - padding.right;
  const innerH = h - padding.top - padding.bottom;
  const maxVal = Math.max(1, ...salesData.map((d) => d.amount));
  const stepX = innerW / Math.max(1, salesData.length - 1);
  let points = [];
  salesData.forEach((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + innerH - d.amount / maxVal * innerH;
    points.push(`${x},${y}`);
  });
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points.join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#3b82f6");
  polyline.setAttribute("stroke-width", "3");
  svg.appendChild(polyline);
  salesData.forEach((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + innerH - d.amount / maxVal * innerH;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", "5");
    circle.setAttribute("fill", "#111827");
    circle.setAttribute("stroke", "#3b82f6");
    circle.setAttribute("stroke-width", "2");
    svg.appendChild(circle);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x);
    text.setAttribute("y", y - 12);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#e2e8f0");
    text.setAttribute("font-size", "12px");
    text.textContent = d.amount.toFixed(2);
    svg.appendChild(text);
    const xText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    xText.setAttribute("x", x);
    xText.setAttribute("y", h - 10);
    xText.setAttribute("text-anchor", "middle");
    xText.setAttribute("fill", "#94a3b8");
    xText.setAttribute("font-size", "12px");
    xText.textContent = d.label;
    svg.appendChild(xText);
  });
}
const soCustomer = document.getElementById("so-customer");
const soCustomerRemark = document.getElementById("so-customer-remark");
const soCustomerDD = document.getElementById("so-customer-dd");
const soCustomerList = document.getElementById("so-customer-list");
let currentSoCustomer = null;
const soCustomerSearch = document.getElementById("so-customer-search");
const soDate = document.getElementById("so-date");
const soTrust = document.getElementById("so-trust");
const soInvoiceNo = document.getElementById("so-invoice-no");
const soNotes = document.getElementById("so-notes");
const soAddItem = document.getElementById("so-add-item");
const soItems = document.getElementById("so-items");
const soTotal = document.getElementById("so-total");
const soSave = document.getElementById("so-save");
const invRows = document.getElementById("inv-rows");
const invSearch = document.getElementById("inv-search");
const invRefresh = document.getElementById("inv-refresh");
const invPager = document.getElementById("inv-pager");
const albRows = document.getElementById("alb-rows");
const albSearch = document.getElementById("alb-search");
const albRefresh = document.getElementById("alb-refresh");
const albPager = document.getElementById("alb-pager");
let soDraggingRow = null;
let currentInvoiceListType = "factura";
if (soDate && !soDate.value) soDate.valueAsDate = /* @__PURE__ */ new Date();
function normalizeSalesInvoiceType(rawValue) {
  return String(rawValue || "").trim().toLowerCase() === "albaran" ? "albaran" : "factura";
}
function getSalesInvoiceTypeLabel(type) {
  return normalizeSalesInvoiceType(type) === "albaran" ? "Albaran" : "Factura";
}
function getSalesInvoicePreviewTitle(type) {
  return normalizeSalesInvoiceType(type) === "albaran" ? "ALBARAN" : "FACTURA";
}
function getSalesInvoiceDateLabel(type) {
  return normalizeSalesInvoiceType(type) === "albaran" ? "Fecha del albaran" : "Fecha de la factura";
}
function normalizeInvoiceDiscountValue(rawValue, fallback = 0) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = Number(fallback);
  if (!Number.isFinite(value)) value = 0;
  if (value > 0 && value < 1) value *= 100;
  return Math.max(0, Math.min(100, value));
}
function getInvoiceDiscountFactor(rawValue, fallback = 0) {
  return 1 - normalizeInvoiceDiscountValue(rawValue, fallback) / 100;
}
function getInvoiceDiscountedAmount(qty, price, discount) {
  return Number(qty || 0) * Number(price || 0) * getInvoiceDiscountFactor(discount);
}
function normalizeInvoiceManualDiscountValue(rawValue, fallback = 0) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = Number(fallback);
  if (!Number.isFinite(value)) value = 0;
  return Math.max(0, Number(value.toFixed(2)));
}
function formatInvoiceDiscountDisplay(rawValue) {
  const value = normalizeInvoiceDiscountValue(rawValue, 0);
  if (value <= 0) return "";
  const text = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
  return `-${text}%`;
}
function normalizeInvoicePreviewLanguage(rawValue) {
  return String(rawValue || "").trim().toLowerCase() === "zh" ? "zh" : "es";
}
function getInvoicePreviewTexts(invoiceType = "factura", language = "es") {
  const normalizedType = normalizeSalesInvoiceType(invoiceType);
  const lang = normalizeInvoicePreviewLanguage(language);
  const isAlbaran = normalizedType === "albaran";
  if (lang === "zh") {
    return {
      modalTitle: isAlbaran ? "Albaran\u4E2D\u6587\u9884\u89C8" : "\u53D1\u7968\u4E2D\u6587\u9884\u89C8",
      docTitle: isAlbaran ? "\u8D27\u5355" : "\u53D1\u7968",
      dateLabel: isAlbaran ? "\u65E5\u671F" : "\u53D1\u7968\u65E5\u671F",
      customerLabel: isAlbaran ? "\u6536\u8D27\u65B9" : "\u5F00\u7968\u7ED9",
      paymentLabel: "\u4ED8\u6B3E\u65B9\u5F0F",
      itemNameLabel: "\u5546\u54C1",
      qtyLabel: "\u6570\u91CF",
      priceLabel: "\u5355\u4EF7",
      discountLabel: "\u6298\u6263",
      discountAmountLabel: "\u6298\u6263\u91D1\u989D",
      taxLabel: "\u7A0E\u7387",
      valueLabel: "\u91D1\u989D",
      totalQtyLabel: "\u4E00\u5171\uFF1A",
      subtotalLabel: "\u5408\u8BA1",
      grandTotalLabel: "\u5E94\u4ED8\u603B\u989D",
      grandTotal2Label: "\u5E94\u4ED8\u91D1\u989D",
      notesLabel: "\u5907\u6CE8\uFF1A",
      statusPending: "\u5F85\u4ED8\u6B3E",
      statusPartial: "\u90E8\u5206\u4ED8\u6B3E",
      statusPaid: "\u5DF2\u4ED8\u6B3E",
      taxRowLabel: (rate) => `\u7A0E\u989D (${rate}%)`,
      taxDisplay: (rate) => formatInvoicePreviewPercent(rate)
    };
  }
  return {
    modalTitle: isAlbaran ? "Albaran\u897F\u8BED\u9884\u89C8" : "\u53D1\u7968\u897F\u8BED\u9884\u89C8",
    docTitle: getSalesInvoicePreviewTitle(normalizedType),
    dateLabel: getSalesInvoiceDateLabel(normalizedType),
    customerLabel: "Facturado a",
    paymentLabel: "Forma de pago",
    itemNameLabel: "Articulo",
    qtyLabel: "Cantidad",
    priceLabel: "Precio",
    discountLabel: "Descuento",
    discountAmountLabel: "Descuento",
    taxLabel: "Impuesto",
    valueLabel: "Valor",
    totalQtyLabel: "Total:",
    subtotalLabel: "Total",
    grandTotalLabel: "Total a pagar",
    grandTotal2Label: "Valor a pagar",
    notesLabel: "Nota:",
    statusPending: "POR PAGAR",
    statusPartial: "PAGADA PARCIALMENTE",
    statusPaid: "PAGADA",
    taxRowLabel: (rate) => `IVA (${rate}%)`,
    taxDisplay: (rate) => formatInvoicePreviewPercent(rate)
  };
}
function getCurrentSalesOrderInvoiceType() {
  return normalizeSalesInvoiceType((soInvoiceNo == null ? void 0 : soInvoiceNo.dataset.invoiceType) || "factura");
}
function formatInvoicePreviewQty(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num - Math.round(num)) < 1e-9) return String(Math.round(num));
  return num.toFixed(2).replace(/\.?0+$/, "");
}
function formatInvoicePreviewPercent(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0%";
  const percent = num * 100;
  if (Math.abs(percent - Math.round(percent)) < 1e-9) return `${Math.round(percent)}%`;
  return `${percent.toFixed(2).replace(/\.?0+$/, "")}%`;
}
function getEditManualDiscountInput() {
  return document.getElementById("edit-manual-discount-amount");
}
function getEditManualDiscountAmount(limit = Number.POSITIVE_INFINITY) {
  const rawValue = normalizeInvoiceManualDiscountValue((getEditManualDiscountInput() || {}).value, 0);
  if (!Number.isFinite(limit)) return rawValue;
  return Math.min(rawValue, Math.max(0, Number(limit || 0)));
}
function updateSalesOrderInvoiceNoStyle(invoiceType) {
  if (!soInvoiceNo) return;
  const normalizedType = normalizeSalesInvoiceType(invoiceType);
  soInvoiceNo.style.color = normalizedType === "albaran" ? "#ffffff" : "var(--blue)";
  soInvoiceNo.style.cursor = (soInvoiceNo == null ? void 0 : soInvoiceNo.dataset.id) ? "default" : "pointer";
  soInvoiceNo.title = (soInvoiceNo == null ? void 0 : soInvoiceNo.dataset.id) ? `${getSalesInvoiceTypeLabel(normalizedType)} \u8BA2\u5355\u7F16\u53F7` : `\u70B9\u51FB\u5207\u6362\u4E3A${normalizedType === "albaran" ? "Factura" : "Albaran"}`;
}
async function loadNextInvoiceNo(forceType = "") {
  if (!soInvoiceNo) return;
  try {
    const invoiceType = normalizeSalesInvoiceType(forceType || getCurrentSalesOrderInvoiceType());
    const res = await fetchWithAuth(`/api/invoices/next-no?type=${encodeURIComponent(invoiceType)}`);
    if (res.ok) {
      const data = await res.json();
      soInvoiceNo.textContent = data.nextNo;
      soInvoiceNo.dataset.nextNo = data.nextNo;
      soInvoiceNo.dataset.invoiceType = normalizeSalesInvoiceType(data.invoiceType || invoiceType);
      updateSalesOrderInvoiceNoStyle(soInvoiceNo.dataset.invoiceType);
    }
  } catch (e) {
  }
}
soInvoiceNo == null ? void 0 : soInvoiceNo.addEventListener("click", async () => {
  if (soInvoiceNo == null ? void 0 : soInvoiceNo.dataset.id) return;
  const nextType = getCurrentSalesOrderInvoiceType() === "albaran" ? "factura" : "albaran";
  await loadNextInvoiceNo(nextType);
});
function renderSoCustomerDropdown() {
  if (!soCustomerList) return;
  const q = ((soCustomerSearch == null ? void 0 : soCustomerSearch.value) || soCustomer.value || "").trim().toLowerCase();
  const all = [
    ...contactsData.customers || [],
    ...contactsData.merchants || [],
    ...contactsData.others || []
  ].filter((x) => {
    if (!q) return true;
    return [x.name, x.company, x.contact, x.phone, x.city, x.remark || ""].some((v) => String(v || "").toLowerCase().includes(q));
  });
  soCustomerList.innerHTML = "";
  if (all.length === 0) {
    const div = document.createElement("div");
    div.className = "dd-item";
    div.textContent = "\u65E0\u5339\u914D\u7ED3\u679C";
    div.style.color = "#94a3b8";
    soCustomerList.appendChild(div);
    return;
  }
  all.forEach((item) => {
    const div = document.createElement("div");
    div.className = "dd-item";
    const left = document.createElement("div");
    left.textContent = item.name;
    const right = document.createElement("div");
    right.style.color = "#94a3b8";
    right.style.fontSize = "12px";
    right.textContent = `${item.contact || ""} ${item.phone || ""} ${item.city || ""}`.trim();
    div.append(left, right);
    div.style.display = "flex";
    div.style.justifyContent = "space-between";
    div.style.alignItems = "center";
    div.addEventListener("click", () => {
      soCustomer.value = item.name;
      currentSoCustomer = item;
      if (soCustomerRemark) soCustomerRemark.textContent = item.remark || "";
      if (soUsePrice) {
        const p = item.use_price || "price1";
        const map = { price1: "\u4EF7\u683C1", price2: "\u4EF7\u683C2", price3: "\u4EF7\u683C3", price4: "\u4EF7\u683C4" };
        soUsePrice.value = map[p] || p;
      }
      if (soSales) {
        if (item.sales) {
          soSales.value = item.sales;
          soSales.disabled = true;
        } else {
          soSales.value = "";
          soSales.disabled = false;
        }
      }
      soCustomerDD.style.display = "none";
    });
    soCustomerList.appendChild(div);
  });
}
function openSoCustomerDropdown() {
  if (!soCustomerDD) return;
  const rect = soCustomer.getBoundingClientRect();
  soCustomerDD.style.display = "block";
  renderSoCustomerDropdown();
}
if (soCustomer) {
  soCustomer.addEventListener("focus", openSoCustomerDropdown);
  soCustomer.addEventListener("click", openSoCustomerDropdown);
  soCustomer.addEventListener("input", () => {
    openSoCustomerDropdown();
    renderSoCustomerDropdown();
    if (soCustomerRemark) soCustomerRemark.textContent = "";
  });
  document.addEventListener("click", (e) => {
    if (!soCustomer.contains(e.target) && !soCustomerDD.contains(e.target)) {
      soCustomerDD.style.display = "none";
    }
  });
}
if (soCustomerSearch) {
  soCustomerSearch.addEventListener("input", renderSoCustomerDropdown);
}
function updateSoTotal() {
  if (!soItems || !soTotal) return;
  let subtotal = 0;
  let discountAmount = 0;
  let totalTax = 0;
  Array.from(soItems.children).forEach((tr) => {
    const qty = parseFloat(tr.querySelector(".qty").value) || 0;
    const price = parseFloat(tr.querySelector(".price").value) || 0;
    const discount = normalizeInvoiceDiscountValue((tr.querySelector(".discount") || {}).value, 0);
    const rawAmount = Number(qty || 0) * Number(price || 0);
    const amt = getInvoiceDiscountedAmount(qty, price, discount);
    let taxRate = parseFloat(tr.dataset.taxRate);
    if (isNaN(taxRate)) taxRate = 0.1;
    if (taxRate >= 1) taxRate = taxRate / 100;
    const taxAmt = amt * taxRate;
    tr.querySelector(".iva-amt").textContent = taxAmt.toFixed(2);
    tr.querySelector(".amt").textContent = amt.toFixed(2);
    subtotal += amt;
    discountAmount += Math.max(0, rawAmount - amt);
    totalTax += taxAmt;
  });
  const grandTotal = subtotal + totalTax;
  const soSubtotal = document.getElementById("so-subtotal");
  const soDiscountAmount = document.getElementById("so-discount-amount");
  const soTax = document.getElementById("so-tax");
  if (soSubtotal) soSubtotal.textContent = subtotal.toFixed(2);
  if (soDiscountAmount) soDiscountAmount.textContent = discountAmount.toFixed(2);
  if (soTax) soTax.textContent = totalTax.toFixed(2);
  soTotal.textContent = grandTotal.toFixed(2) + "\u20AC";
}
function clearSoItemDropHints() {
  Array.from(soItems.children).forEach((row) => {
    row.style.borderTop = "none";
    row.style.borderBottom = "1px solid #1e293b";
  });
}
function attachSoItemDragHandlers(tr) {
  const handle = tr.querySelector(".so-item-drag");
  tr.draggable = false;
  if (!handle) return;
  handle.draggable = true;
  handle.addEventListener("dragstart", (e) => {
    var _a2;
    soDraggingRow = tr;
    tr.style.opacity = "0.45";
    tr.style.background = "rgba(59,130,246,0.08)";
    handle.style.cursor = "grabbing";
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tr.dataset.productId || ((_a2 = tr.querySelector(".name")) == null ? void 0 : _a2.value) || "row");
    }
  });
  tr.addEventListener("dragover", (e) => {
    if (!soDraggingRow || soDraggingRow === tr) return;
    e.preventDefault();
    clearSoItemDropHints();
    const rect = tr.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    tr.style.borderTop = insertBefore ? "2px solid #3b82f6" : "none";
    tr.style.borderBottom = insertBefore ? "1px solid #1e293b" : "2px solid #3b82f6";
  });
  tr.addEventListener("drop", (e) => {
    if (!soDraggingRow || soDraggingRow === tr) return;
    e.preventDefault();
    const rect = tr.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    soItems.insertBefore(soDraggingRow, insertBefore ? tr : tr.nextSibling);
    clearSoItemDropHints();
  });
  handle.addEventListener("dragend", () => {
    clearSoItemDropHints();
    if (soDraggingRow) {
      soDraggingRow.style.opacity = "";
      soDraggingRow.style.background = "";
    }
    handle.style.cursor = "grab";
    soDraggingRow = null;
  });
}
if (soItems) {
  soItems.addEventListener("dragover", (e) => {
    if (!soDraggingRow) return;
    e.preventDefault();
    const rows2 = Array.from(soItems.children).filter((row) => row !== soDraggingRow);
    if (!rows2.length) return;
    clearSoItemDropHints();
    const lastRow = rows2[rows2.length - 1];
    const rect = lastRow.getBoundingClientRect();
    if (e.clientY >= rect.top + rect.height / 2) {
      lastRow.style.borderBottom = "2px solid #3b82f6";
    }
  });
  soItems.addEventListener("drop", (e) => {
    if (!soDraggingRow) return;
    e.preventDefault();
    const rows2 = Array.from(soItems.children).filter((row) => row !== soDraggingRow);
    if (!rows2.length) {
      soItems.appendChild(soDraggingRow);
    } else {
      const lastRow = rows2[rows2.length - 1];
      const rect = lastRow.getBoundingClientRect();
      if (e.clientY >= rect.top + rect.height / 2) {
        soItems.appendChild(soDraggingRow);
      }
    }
    clearSoItemDropHints();
  });
}
const soSales = document.getElementById("so-sales");
const soUsePrice = document.getElementById("so-use-price");
const editSales = document.getElementById("edit-sales");
const editUsePrice = document.getElementById("edit-use-price");
const ctSales = document.getElementById("ct-sales");
async function loadSalesPeople() {
  await apiSalesList();
  renderSalesPeopleOptions();
}
function renderSalesPeopleOptions() {
  const opts = '<option value="">\u8BF7\u9009\u62E9\u4E1A\u52A1\u5458</option>' + salesData.map((s) => `<option value="${s.name}">${s.name}</option>`).join("");
  [soSales, editSales, ctSales, paySales].forEach((el) => {
    if (el) {
      const val = el.value;
      el.innerHTML = opts;
      el.value = val;
    }
  });
}
const prodSelModal = document.getElementById("prod-selector-modal");
const prodSelSearch = document.getElementById("prod-sel-search");
const prodSelList = document.getElementById("prod-sel-list");
const prodSelClose = document.getElementById("prod-sel-close");
let prodSelPage = 1;
const prodSelPageSize = 50;
let prodSelTotal = 0;
let prodSelectorMode = "default";
function isDailyOrderProdSelectorMode() {
  return prodSelectorMode === "daily_order";
}
function getProdSelectionQtyForRow(row, fallback = 1) {
  const qtyInput = row == null ? void 0 : row.querySelector(".prod-sel-order-qty");
  const nextQty = Math.max(1, parseInt((qtyInput == null ? void 0 : qtyInput.value) || fallback || 1, 10) || 1);
  return nextQty;
}
function buildSelectedProductPayload(prodObj, row = null) {
  const base = prodObj && typeof prodObj === "object" ? { ...prodObj } : {};
  if (isDailyOrderProdSelectorMode()) {
    base.order_qty = getProdSelectionQtyForRow(row, base.order_qty || base.qty || 1);
  }
  return base;
}
function getActiveProductSelectorCustomer() {
  if (editModal && editModal.style.display === "flex" && currentEditCustomer) return currentEditCustomer;
  if (currentSoCustomer) return currentSoCustomer;
  if (!currentSoCustomer && (soCustomer == null ? void 0 : soCustomer.value)) {
    const all = [
      ...contactsData.customers || [],
      ...contactsData.merchants || [],
      ...contactsData.others || []
    ];
    currentSoCustomer = all.find((c) => c.name === soCustomer.value);
    return currentSoCustomer || null;
  }
  return null;
}
function getProductPriceByCustomer(prod, customer) {
  const tier = (customer == null ? void 0 : customer.use_price) || "price1";
  if (prod && prod[tier] !== void 0 && prod[tier] !== null && prod[tier] !== "") return Number(prod[tier] || 0);
  return Number((prod == null ? void 0 : prod.price1) || (prod == null ? void 0 : prod.price) || 0);
}
async function loadProductSelector(page = 1) {
  if (!prodSelList) return;
  prodSelPage = page;
  const q = ((prodSelSearch == null ? void 0 : prodSelSearch.value) || "").trim();
  const res = await fetchWithAuth(`/api/products?page=${prodSelPage}&size=${prodSelPageSize}&q=${encodeURIComponent(q)}`);
  if (res.ok) {
    const data = await res.json();
    prodSelTotal = data.total || 0;
    renderProductSelector(data.list || []);
  }
}
function renderProductSelector(list) {
  prodSelList.innerHTML = "";
  if (list.length === 0) {
    prodSelList.innerHTML = '<div style="color:#94a3b8; grid-column:1/-1; text-align:center; padding:20px">\u65E0\u5339\u914D\u5546\u54C1</div>';
    return;
  }
  list.sort((a, b) => {
    const na = parseInt(a.sku || "0", 10);
    const nb = parseInt(b.sku || "0", 10);
    return na - nb;
  });
  let usePrice = "price1";
  const activeCustomer = getActiveProductSelectorCustomer();
  if (activeCustomer && activeCustomer.use_price) usePrice = activeCustomer.use_price;
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.innerHTML = `
    <thead>
      <tr style="border-bottom:1px solid #334155; color:#94a3b8; font-size:12px; text-align:left">
        <th style="padding:8px; width:40px; text-align:center"><input type="checkbox" id="prod-sel-select-all" onclick="toggleAllProdSelection(this)"></th>
        <th style="padding:8px">\u56FE\u7247</th>
        <th style="padding:8px">\u7F16\u53F7</th>
        <th style="padding:8px">\u540D\u79F0</th>
        <th style="padding:8px">\u4E2D\u6587\u540D\u79F0</th>
        <th style="padding:8px">\u89C4\u683C</th>
        <th style="padding:8px; text-align:right">\u4EF7\u683C</th>
        <th style="padding:8px; text-align:right">\u5E93\u5B58</th>
        ${isDailyOrderProdSelectorMode() ? '<th style="padding:8px; text-align:center; width:110px">\u4E0B\u5355\u6570\u91CF</th>' : ""}
      </tr>
    </thead>
    <tbody id="prod-sel-tbody"></tbody>
  `;
  const tbody = table.querySelector("tbody");
  list.forEach((p) => {
    let displayPrice = Number(p.price1 || 0);
    if (p[usePrice] !== void 0 && p[usePrice] !== null && p[usePrice] !== "") {
      displayPrice = Number(p[usePrice]);
    }
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #1e293b";
    tr.style.cursor = "pointer";
    tr.onmouseover = () => tr.style.background = "#1e293b";
    tr.onmouseout = () => tr.style.background = "transparent";
    const isSelected = window.selectedProducts && window.selectedProducts.has(p.id);
    const selectedQty = isSelected ? Math.max(1, parseInt((window.selectedProducts.get(p.id) || {}).order_qty || (window.selectedProducts.get(p.id) || {}).qty || 1, 10) || 1) : 1;
    tr.innerHTML = `
      <td style="padding:8px; text-align:center">
        <input type="checkbox" class="prod-sel-checkbox" value="${p.id}" ${isSelected ? "checked" : ""} onclick="event.stopPropagation(); toggleProdSelection(${p.id})">
      </td>
      <td style="padding:8px">
        ${p.image ? `<img src="${p.image}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; border:1px solid #334155">` : '<div style="width:48px; height:48px; background:#0f172a; border-radius:4px; border:1px solid #334155"></div>'}
      </td>
      <td style="padding:8px; color:#94a3b8">${p.sku || ""}</td>
      <td style="padding:8px; color:#e2e8f0; font-weight:500">${p.name}</td>
      <td style="padding:8px; color:#94a3b8">${p.name_cn || ""}</td>
      <td style="padding:8px; color:#94a3b8">${p.spec || ""}</td>
      <td style="padding:8px; text-align:right; color:var(--blue); font-weight:600">\u20AC${displayPrice.toFixed(2)}</td>
      <td style="padding:8px; text-align:right; color:#64748b">${Number(p.stock || 0)}</td>
      ${isDailyOrderProdSelectorMode() ? `<td style="padding:8px; text-align:center"><input type="number" class="prod-sel-order-qty light-input" value="${selectedQty}" min="1" step="1" style="width:84px; text-align:center; background:#0f172a; border:1px solid #334155" onclick="event.stopPropagation()"></td>` : ""}
    `;
    tr.dataset.prod = JSON.stringify(p);
    const qtyInput = tr.querySelector(".prod-sel-order-qty");
    if (qtyInput) {
      qtyInput.addEventListener("input", () => {
        const nextQty = getProdSelectionQtyForRow(tr, 1);
        qtyInput.value = String(nextQty);
        if (window.selectedProducts && window.selectedProducts.has(p.id)) {
          window.selectedProducts.set(p.id, buildSelectedProductPayload(p, tr));
        }
      });
      qtyInput.addEventListener("focus", () => qtyInput.select());
    }
    tr.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() !== "input") {
        const cb = tr.querySelector(".prod-sel-checkbox");
        cb.checked = !cb.checked;
        toggleProdSelection(p.id, buildSelectedProductPayload(p, tr));
      }
    });
    tbody.appendChild(tr);
  });
  prodSelList.style.display = "block";
  prodSelList.appendChild(table);
  const totalPages = Math.ceil(prodSelTotal / prodSelPageSize);
  if (totalPages > 1) {
    const pager = document.createElement("div");
    pager.style.display = "flex";
    pager.style.justifyContent = "center";
    pager.style.gap = "12px";
    pager.style.alignItems = "center";
    pager.style.padding = "12px 0";
    pager.style.marginTop = "12px";
    pager.style.borderTop = "1px solid #334155";
    pager.innerHTML = `
      <button class="btn-secondary" style="padding:4px 12px" ${prodSelPage <= 1 ? "disabled" : ""} onclick="loadProductSelector(${prodSelPage - 1})">\u4E0A\u4E00\u9875</button>
      <span style="color:#cbd5e1; font-size:13px">\u7B2C ${prodSelPage} / ${totalPages} \u9875</span>
      <button class="btn-secondary" style="padding:4px 12px" ${prodSelPage >= totalPages ? "disabled" : ""} onclick="loadProductSelector(${prodSelPage + 1})">\u4E0B\u4E00\u9875</button>
    `;
    prodSelList.appendChild(pager);
  }
  updateSelectAllCheckbox();
}
window.selectedProducts = /* @__PURE__ */ new Map();
window.toggleProdSelection = function(id, prodObj) {
  if (!prodObj) {
    const cb = document.querySelector(`.prod-sel-checkbox[value="${id}"]`);
    if (cb && cb.closest("tr")) {
      prodObj = buildSelectedProductPayload(JSON.parse(cb.closest("tr").dataset.prod), cb.closest("tr"));
      if (!cb.checked) {
        window.selectedProducts.delete(id);
      } else {
        window.selectedProducts.set(id, prodObj);
      }
    }
  } else {
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
  const checkboxes = document.querySelectorAll(".prod-sel-checkbox");
  checkboxes.forEach((cb) => {
    cb.checked = el.checked;
    const id = parseInt(cb.value, 10);
    const prodObj = buildSelectedProductPayload(JSON.parse(cb.closest("tr").dataset.prod), cb.closest("tr"));
    if (el.checked) {
      window.selectedProducts.set(id, prodObj);
    } else {
      window.selectedProducts.delete(id);
    }
  });
};
function updateSelectAllCheckbox() {
  const selectAllCb = document.getElementById("prod-sel-select-all");
  const checkboxes = document.querySelectorAll(".prod-sel-checkbox");
  if (selectAllCb && checkboxes.length > 0) {
    const allChecked = Array.from(checkboxes).every((cb) => cb.checked);
    selectAllCb.checked = allChecked;
  }
}
window.confirmProductSelection = function() {
  if (window.selectedProducts.size === 0) {
    alert("\u8BF7\u5148\u9009\u62E9\u81F3\u5C11\u4E00\u4E2A\u5546\u54C1");
    return;
  }
  const selectedArray = Array.from(window.selectedProducts.values());
  if (typeof window.onProdSelect === "function") {
    selectedArray.forEach((p) => {
      window.onProdSelect(p, true);
    });
    prodSelModal.style.display = "none";
    prodSelectorMode = "default";
    if (typeof window.onProdSelectDone === "function") window.onProdSelectDone(selectedArray);
  } else {
    selectedArray.forEach((p) => {
      addSoItem(p);
    });
    prodSelModal.style.display = "none";
    prodSelectorMode = "default";
  }
};
const invoiceLoteChoiceCache = /* @__PURE__ */ new Map();
const invoiceLoteSummaryCache = /* @__PURE__ */ new Map();
function clearInvoiceLoteCaches(productRef = null) {
  if (!productRef) {
    invoiceLoteChoiceCache.clear();
    invoiceLoteSummaryCache.clear();
    return;
  }
  const cacheKey = getInvoiceLoteCacheKey(productRef);
  if (!cacheKey) return;
  invoiceLoteChoiceCache.delete(cacheKey);
  invoiceLoteSummaryCache.delete(cacheKey);
}
function getInvoiceItemEditorFields(item = {}) {
  const rawDescription = String((item == null ? void 0 : item.description) || (item == null ? void 0 : item.spec) || "").trim();
  const parsed = splitInvoiceDescriptionAndLote(rawDescription);
  const fallbackLote = getInvoiceItemStockMetaDerivedLote(item);
  return {
    description: String(parsed.baseDesc || rawDescription).trim(),
    lote: String((item == null ? void 0 : item.lote) || parsed.lote || fallbackLote || "").trim()
  };
}
function getInvoiceItemStockMetaDerivedLote(item = {}) {
  const uniqueLotes = /* @__PURE__ */ new Map();
  const appendRows = (rows = []) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const lote = String((row == null ? void 0 : row.lote) || "").trim();
      const loteKey = normalizeComparableLoteKey(lote);
      if (!lote || !loteKey || uniqueLotes.has(loteKey)) return;
      uniqueLotes.set(loteKey, lote);
    });
  };
  appendRows(item == null ? void 0 : item.deductions);
  appendRows(item == null ? void 0 : item.allocation_plan);
  return uniqueLotes.size === 1 ? String(uniqueLotes.values().next().value || "").trim() : "";
}
function createInvoiceLoteInputHtml(currentValue = "") {
  const displayValue = String(formatFinishedLote(currentValue) || currentValue || "").trim();
  return `
    <div class="invoice-lote-combo" style="position:relative">
      <input type="text" class="lote light-input" style="width:100%; text-align:center; background:#0f172a; border:1px solid #334155; padding-right:28px" value="${escapeHtml(displayValue)}" placeholder="\u53EF\u9009\u53EF\u8F93" autocomplete="off">
      <button type="button" class="invoice-lote-toggle" style="position:absolute; top:50%; right:6px; transform:translateY(-50%); width:18px; height:18px; padding:0; border:none; background:transparent; color:#cbd5e1; cursor:pointer; font-size:11px; line-height:1">\u25BC</button>
      <div class="dropdown invoice-lote-menu" style="display:none; left:0; right:auto; top:calc(100% + 6px); min-width:220px; max-width:320px; max-height:220px; overflow-y:auto; z-index:90"></div>
    </div>
  `;
}
function closeInvoiceLoteMenus(exceptMenu = null) {
  document.querySelectorAll(".invoice-lote-menu").forEach((menu) => {
    if (exceptMenu && menu === exceptMenu) return;
    menu.style.display = "none";
  });
}
function renderInvoiceLoteOptions(combo, choices = [], currentValue = "") {
  const menu = combo == null ? void 0 : combo.querySelector(".invoice-lote-menu");
  if (!menu) return;
  const optionMap = /* @__PURE__ */ new Map();
  (Array.isArray(choices) ? choices : []).forEach((choice) => {
    const value = String((choice == null ? void 0 : choice.value) || "").trim();
    const displayValue = String(formatFinishedLote(value) || value).trim();
    if (!displayValue || optionMap.has(displayValue)) return;
    optionMap.set(displayValue, String((choice == null ? void 0 : choice.label) || displayValue).trim());
  });
  const current = String(formatFinishedLote(currentValue) || currentValue || "").trim();
  if (current && !optionMap.has(current)) optionMap.set(current, current);
  const items = Array.from(optionMap.entries());
  menu.innerHTML = items.length ? items.map(([value, label]) => {
    const safeValue = escapeHtml(value);
    const safeLabel = escapeHtml(label);
    const activeStyle = value === current ? "background:#172554;color:#fff;" : "color:#e2e8f0;";
    return `<button type="button" class="invoice-lote-option" data-value="${safeValue}" title="${safeLabel}" style="display:block; width:100%; text-align:left; white-space:nowrap; padding:8px 10px; border:none; background:transparent; ${activeStyle} cursor:pointer; border-bottom:1px solid rgba(148,163,184,0.12)">${safeLabel}</button>`;
  }).join("") : `<div style="padding:8px 10px; color:#94a3b8">\u65E0\u53EF\u9009 Lote\uFF0C\u53EF\u76F4\u63A5\u8F93\u5165</div>`;
}
function bindInvoiceLoteCombo(row) {
  const combo = row == null ? void 0 : row.querySelector(".invoice-lote-combo");
  const input = combo == null ? void 0 : combo.querySelector(".lote");
  const toggle = combo == null ? void 0 : combo.querySelector(".invoice-lote-toggle");
  const menu = combo == null ? void 0 : combo.querySelector(".invoice-lote-menu");
  if (!combo || !input || !toggle || !menu || combo.dataset.bound === "1") return;
  combo.dataset.bound = "1";
  combo._choices = [];
  const openMenu = () => {
    renderInvoiceLoteOptions(combo, combo._choices || [], String(input.value || "").trim());
    closeInvoiceLoteMenus(menu);
    menu.style.display = "block";
  };
  const closeMenu = () => {
    menu.style.display = "none";
  };
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu.style.display === "block") {
      closeMenu();
    } else {
      openMenu();
      input.focus();
    }
  });
  input.addEventListener("focus", () => {
    openMenu();
  });
  input.addEventListener("input", () => {
    renderInvoiceLoteOptions(combo, combo._choices || [], String(input.value || "").trim());
    menu.style.display = "block";
  });
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest(".invoice-lote-option");
    if (!btn) return;
    input.value = String(formatFinishedLote(btn.dataset.value || "") || btn.dataset.value || "").trim();
    closeMenu();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function getInvoiceLoteCacheKey(productRef = {}) {
  const productId = Number((productRef == null ? void 0 : productRef.productId) || (productRef == null ? void 0 : productRef.id) || 0);
  const productSku = String((productRef == null ? void 0 : productRef.sku) || "").trim();
  const productName = String((productRef == null ? void 0 : productRef.name) || "").trim();
  const normalizedProductName = productName.replace(/^\(\d+\)\s*/, "").trim();
  return productId ? `id:${productId}` : productSku ? `sku:${productSku}` : normalizedProductName ? `name:${normalizedProductName}` : "";
}
function normalizeComparableLoteKey(loteValue = "") {
  return String(formatFinishedLote(loteValue) || loteValue || "").trim().toLowerCase();
}
async function fetchInvoiceLoteSummary(productRef = {}) {
  const productId = Number((productRef == null ? void 0 : productRef.productId) || (productRef == null ? void 0 : productRef.id) || 0);
  const productSku = String((productRef == null ? void 0 : productRef.sku) || "").trim();
  const productName = String((productRef == null ? void 0 : productRef.name) || "").trim();
  const normalizedProductName = productName.replace(/^\(\d+\)\s*/, "").trim();
  const queryNames = productId ? [] : [...new Set([productName, normalizedProductName].filter(Boolean))];
  const cacheKey = getInvoiceLoteCacheKey(productRef);
  if (!cacheKey) return [];
  if (invoiceLoteSummaryCache.has(cacheKey)) return invoiceLoteSummaryCache.get(cacheKey);
  let summary = { choices: [], totalStock: 0 };
  try {
    const res = await fetchWithAuth(`/api/products/batch-stock?_t=${Date.now()}`, {
      method: "POST",
      body: JSON.stringify({
        ids: productId ? [productId] : [],
        skus: productId ? [] : productSku ? [productSku] : [],
        names: queryNames
      })
    });
    if (res.ok) {
      const list = await res.json();
      const matched = Array.isArray(list) ? list.find((row) => {
        const rowId = Number((row == null ? void 0 : row.id) || 0);
        const rowSku = String((row == null ? void 0 : row.sku) || "").trim();
        const rowName = String((row == null ? void 0 : row.name) || "").trim();
        return productId && rowId === productId || productSku && rowSku === productSku || normalizedProductName && rowName === normalizedProductName || productName && rowName === productName;
      }) : null;
      const mergedBatches = mergeFinishedBatches((matched == null ? void 0 : matched.batches) || []);
      const choices = mergedBatches.map((batch) => {
        const value = String((batch == null ? void 0 : batch.lote) || "").trim();
        if (!value) return null;
        const qty = Math.max(0, Number((batch == null ? void 0 : batch.qty) || 0));
        const expiry = String((batch == null ? void 0 : batch.expiry) || "").trim();
        return {
          value,
          expiry,
          qty,
          label: `${formatFinishedLote(value) || value} / \u5E93\u5B58:${qty}${expiry ? ` / \u5230\u671F:${expiry}` : ""}`
        };
      }).filter(Boolean);
      const batchTotal = choices.reduce((sum, choice) => sum + Math.max(0, Number((choice == null ? void 0 : choice.qty) || 0)), 0);
      summary = {
        choices,
        totalStock: Math.max(0, Math.max(Number((matched == null ? void 0 : matched.stock) || 0), batchTotal))
      };
    }
  } catch (e) {
  }
  invoiceLoteSummaryCache.set(cacheKey, summary);
  invoiceLoteChoiceCache.set(cacheKey, summary.choices);
  return summary;
}
async function fetchInvoiceLoteChoices(productRef = {}) {
  const cacheKey = getInvoiceLoteCacheKey(productRef);
  if (!cacheKey) return [];
  if (invoiceLoteChoiceCache.has(cacheKey)) return invoiceLoteChoiceCache.get(cacheKey);
  const summary = await fetchInvoiceLoteSummary(productRef);
  return Array.isArray(summary == null ? void 0 : summary.choices) ? summary.choices : [];
}
async function populateInvoiceLoteChoices(row, productRef = {}) {
  var _a2;
  if (!row) return;
  const combo = row.querySelector(".invoice-lote-combo");
  const input = row.querySelector(".lote");
  if (!combo || !input) return;
  const currentValue = String(input.value || "").trim();
  const choices = await fetchInvoiceLoteChoices(productRef);
  if (!row.isConnected) return;
  if (!currentValue && row.dataset.autoPickLote !== "0" && choices.length > 0) {
    input.value = String(formatFinishedLote(((_a2 = choices[0]) == null ? void 0 : _a2.value) || "") || ((_a2 = choices[0]) == null ? void 0 : _a2.value) || "").trim();
  }
  combo._choices = choices;
  renderInvoiceLoteOptions(combo, choices, String(input.value || "").trim());
}
document.addEventListener("click", (e) => {
  const combo = e.target.closest(".invoice-lote-combo");
  if (!combo) closeInvoiceLoteMenus();
});
if (soAddItem) {
  soAddItem.addEventListener("click", () => {
    if (!soCustomer.value.trim()) {
      alert("\u8BF7\u5148\u9009\u62E9\u5BA2\u6237");
      return;
    }
    prodSelectorMode = "default";
    window.onProdSelect = null;
    window.selectedProducts.clear();
    prodSelModal.style.display = "flex";
    prodSelSearch.value = "";
    loadProductSelector();
  });
}
if (prodSelClose) {
  prodSelClose.addEventListener("click", () => {
    prodSelModal.style.display = "none";
    window.onProdSelect = null;
    prodSelectorMode = "default";
  });
}
if (prodSelSearch) prodSelSearch.addEventListener("input", () => loadProductSelector());
function addSoItem(p) {
  let price = Number(p.price1 || 0);
  if (!currentSoCustomer && soCustomer.value) {
    const all = [
      ...contactsData.customers || [],
      ...contactsData.merchants || [],
      ...contactsData.others || []
    ];
    currentSoCustomer = all.find((c) => c.name === soCustomer.value);
  }
  if (currentSoCustomer) {
    const tier = currentSoCustomer.use_price || "price1";
    if (p[tier] !== void 0 && p[tier] !== null && p[tier] !== "") {
      price = Number(p[tier]);
    }
  }
  let taxRate = 0.1;
  if (p.tax_rate !== void 0 && p.tax_rate !== null && p.tax_rate !== "") {
    taxRate = Number(p.tax_rate);
    if (taxRate >= 1) taxRate = taxRate / 100;
  }
  if (currentSoCustomer) {
    if (currentSoCustomer.is_iva === false) {
      taxRate = 0;
    }
  }
  const discount = normalizeInvoiceDiscountValue(p.discount, 0);
  const editorFields = getInvoiceItemEditorFields(p);
  const tr = document.createElement("tr");
  tr.style.borderBottom = "1px solid #1e293b";
  tr.dataset.taxRate = taxRate;
  tr.dataset.productId = p.id || "";
  tr.dataset.sku = p.sku || "";
  tr.dataset.productName = p.name || "";
  tr.innerHTML = `
    <td style="padding:10px 8px; text-align:center; vertical-align:middle">
      <button type="button" class="so-item-drag" title="\u62D6\u52A8\u6392\u5E8F" style="width:26px; height:26px; padding:0; border:1px solid #334155; border-radius:6px; background:#172554; cursor:grab; display:inline-flex; flex-direction:column; justify-content:center; align-items:center; gap:3px">
        <span style="display:block; width:12px; height:2px; background:#bfdbfe; border-radius:999px"></span>
        <span style="display:block; width:12px; height:2px; background:#bfdbfe; border-radius:999px"></span>
        <span style="display:block; width:12px; height:2px; background:#bfdbfe; border-radius:999px"></span>
      </button>
    </td>
    <td style="padding:10px 16px"><input type="text" class="name light-input" style="width:100%; background:transparent; border:none; color:#e2e8f0" value="${p.name}"></td>
    <td style="padding:10px 16px"><input type="text" class="name-cn light-input" style="width:100%; background:transparent; border:none; color:#94a3b8" value="${p.name_cn || ""}" placeholder="\u4E2D\u6587\u540D"></td>
    <td style="padding:10px 16px"><input type="text" class="desc light-input" style="width:100%; background:transparent; border:none; color:#94a3b8" value="${editorFields.description}" placeholder="\u89C4\u683C"></td>
    <td style="padding:10px 16px">${createInvoiceLoteInputHtml(editorFields.lote)}</td>
    <td style="padding:10px 16px"><input type="number" class="qty light-input" style="width:100%; text-align:center; background:#0f172a; border:1px solid #334155" value="1" min="1"></td>
    <td style="padding:10px 16px"><input type="number" class="price light-input" style="width:100%; text-align:center; background:#0f172a; border:1px solid #334155" value="${price.toFixed(2)}" min="0" step="0.01"></td>
    <td style="padding:10px 16px"><input type="text" inputmode="decimal" class="discount light-input" style="width:100%; min-width:88px; text-align:center; background:#0f172a; border:1px solid #334155; box-sizing:border-box" value="${discount}" placeholder="0"></td>
    <td class="iva-amt" style="padding:10px 16px; text-align:right; font-family:monospace; color:#94a3b8">${(getInvoiceDiscountedAmount(1, price, discount) * taxRate).toFixed(2)}</td>
    <td class="amt" style="padding:10px 16px; text-align:right; font-family:monospace; color:#e2e8f0">${getInvoiceDiscountedAmount(1, price, discount).toFixed(2)}</td>
    <td style="padding:10px 16px; text-align:center"><button type="button" class="btn-red btn-icon" style="width:24px;height:24px;padding:0;font-size:12px">\xD7</button></td>
  `;
  tr.querySelector(".btn-red").addEventListener("click", () => {
    tr.remove();
    updateSoTotal();
  });
  tr.querySelectorAll("input").forEach((i) => {
    i.addEventListener("input", updateSoTotal);
    i.addEventListener("focus", function() {
      this.select();
    });
  });
  bindInvoiceLoteCombo(tr);
  attachSoItemDragHandlers(tr);
  soItems.appendChild(tr);
  populateInvoiceLoteChoices(tr, p);
  updateSoTotal();
}
if (soSave) {
  soSave.addEventListener("click", async () => {
    const customer = (soCustomer.value || "").trim();
    if (!customer) {
      alert("\u8BF7\u9009\u62E9\u5BA2\u6237");
      return;
    }
    const items = [];
    Array.from(soItems.children).forEach((tr) => {
      var _a2, _b2;
      const name = (tr.querySelector(".name").value || "").trim();
      const nameCn = (((_a2 = tr.querySelector(".name-cn")) == null ? void 0 : _a2.value) || "").trim();
      const desc = (tr.querySelector(".desc").value || "").trim();
      const lote = (((_b2 = tr.querySelector(".lote")) == null ? void 0 : _b2.value) || "").trim();
      const qty = parseFloat(tr.querySelector(".qty").value) || 0;
      const price = parseFloat(tr.querySelector(".price").value) || 0;
      const discount = normalizeInvoiceDiscountValue((tr.querySelector(".discount") || {}).value, 0);
      let taxRate = parseFloat(tr.dataset.taxRate);
      if (isNaN(taxRate)) taxRate = 0.1;
      if (taxRate >= 1) taxRate = taxRate / 100;
      const productId = tr.dataset.productId || "";
      const sku = tr.dataset.sku || "";
      if (name) items.push({ name, name_cn: nameCn, description: desc, lote, qty, price, discount, total: getInvoiceDiscountedAmount(qty, price, discount), tax_rate: taxRate, productId, sku });
    });
    if (items.length === 0) {
      alert("\u8BF7\u81F3\u5C11\u6DFB\u52A0\u4E00\u4E2A\u5546\u54C1");
      return;
    }
    const editId = soInvoiceNo.dataset.id;
    let res;
    const sales = soSales ? soSales.value : "";
    if (editId) {
      res = await fetchWithAuth(`/api/invoices/${editId}`, {
        method: "PUT",
        body: JSON.stringify({
          customer,
          date: soDate.value,
          items,
          notes: soNotes.value,
          sales,
          trust_days: parseInt(soTrust.value || "30", 10)
        })
      });
    } else {
      res = await fetchWithAuth("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          invoice_type: getCurrentSalesOrderInvoiceType(),
          customer,
          date: soDate.value,
          items,
          notes: soNotes.value,
          sales,
          trust_days: parseInt(soTrust.value || "30", 10)
        })
      });
    }
    if (res.ok) {
      const savedInvoiceType = editId ? normalizeSalesInvoiceType((soInvoiceNo == null ? void 0 : soInvoiceNo.dataset.invoiceType) || getCurrentSalesOrderInvoiceType()) : getCurrentSalesOrderInvoiceType();
      showAppToast(editId ? "\u8BA2\u5355\u5DF2\u66F4\u65B0" : "\u8BA2\u5355\u5DF2\u4FDD\u5B58");
      soCustomer.value = "";
      if (soUsePrice) soUsePrice.value = "";
      soNotes.value = "";
      soItems.innerHTML = "";
      if (soSales) {
        soSales.value = "";
        soSales.disabled = false;
      }
      updateSoTotal();
      delete soInvoiceNo.dataset.id;
      soInvoiceNo.dataset.invoiceType = "factura";
      loadNextInvoiceNo("factura");
      location.hash = savedInvoiceType === "albaran" ? "#sales-albaran" : "#sales-invoice";
    } else {
      const err = await res.json().catch(() => ({}));
      if (err.error === "cannot_edit_paid_invoice") {
        alert("\u65E0\u6CD5\u4FEE\u6539\uFF1A\u8BA2\u5355\u5DF2\u5168\u989D\u4ED8\u6B3E");
      } else if (err.error === "insufficient_stock") {
        alert(formatInsufficientStockMessage(err));
      } else {
        alert("\u4FDD\u5B58\u5931\u8D25");
      }
    }
  });
}
let invPage = 1;
let invTotal = 0;
const invPageSize = 100;
let currentInvoices = [];
function normalizeInvoiceCustomerText(text) {
  return String(text || "").toLowerCase().replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").replace(/[\s\-.,，。/()（）]/g, "");
}
function hasCompleteInvoiceCustomerInfo(contact) {
  if (!contact) return false;
  return !!(contact.company || contact.code || contact.address || contact.zip || contact.city || contact.country || contact.ship_address || contact.ship_zip || contact.ship_city || contact.ship_country);
}
function findInvoiceCustomerContact(customerName) {
  const target = String(customerName || "").trim();
  const targetKey = normalizeInvoiceCustomerText(target);
  const allContacts2 = [
    ...contactsData.customers || [],
    ...contactsData.merchants || [],
    ...contactsData.others || []
  ];
  return allContacts2.find((c) => {
    const name = String(c.name || "").trim();
    const company = String(c.company || "").trim();
    const code = String(c.code || "").trim();
    const nameKey = normalizeInvoiceCustomerText(name);
    const companyKey = normalizeInvoiceCustomerText(company);
    const codeKey = normalizeInvoiceCustomerText(code);
    return name === target || company === target || code === target || !!targetKey && (nameKey === targetKey || companyKey === targetKey || codeKey === targetKey);
  }) || null;
}
async function getInvoiceCustomerContact(customerName) {
  let contact = findInvoiceCustomerContact(customerName);
  if (hasCompleteInvoiceCustomerInfo(contact)) return contact;
  const q = String(customerName || "").trim();
  if (!q) return contact;
  for (const tab of ["customers", "merchants", "others"]) {
    try {
      const list = await apiFetchJSON("/api/contacts?" + new URLSearchParams({ tab, q, page: "1", size: "50" }).toString());
      const arr = Array.isArray(list) ? list : [];
      if (arr.length) {
        const mapped = arr.map((x) => ({
          id: x.id,
          name: x.name,
          contact: x.contact,
          phone: x.phone,
          city: x.city,
          remark: x.remark,
          owner: x.owner,
          created: x.created,
          company: x.company,
          code: x.code,
          country: x.country,
          address: x.address,
          zip: x.zip,
          sales: x.sales,
          use_price: x.use_price,
          is_iva: x.is_iva,
          invoice_nota: x.invoice_nota,
          email: x.email,
          province: x.province,
          ship_address: x.ship_address,
          ship_zip: x.ship_zip,
          ship_city: x.ship_city,
          ship_province: x.ship_province,
          ship_country: x.ship_country,
          ship_phone: x.ship_phone,
          ship_contact: x.ship_contact,
          shipping_addresses: Array.isArray(x.shipping_addresses) ? x.shipping_addresses : []
        }));
        contactsData[tab] = mapped;
        contact = findInvoiceCustomerContact(customerName) || contact;
        if (hasCompleteInvoiceCustomerInfo(contact)) return contact;
      }
    } catch (e) {
    }
  }
  return contact;
}
function getInvoiceListConfig(invoiceType = "factura") {
  const normalizedType = normalizeSalesInvoiceType(invoiceType);
  return normalizedType === "albaran" ? {
    type: "albaran",
    rowsEl: albRows,
    pagerEl: albPager,
    searchEl: albSearch,
    emptyText: "\u6682\u65E0Albaran\u6570\u636E",
    showDelivered: false
  } : {
    type: "factura",
    rowsEl: invRows,
    pagerEl: invPager,
    searchEl: invSearch,
    emptyText: "\u6682\u65E0\u53D1\u7968\u6570\u636E",
    showDelivered: true
  };
}
function roundInvoiceMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
function getInvoicePaymentStatus(totalValue, paidValue) {
  const total = roundInvoiceMoney(totalValue);
  const paid = roundInvoiceMoney(paidValue);
  if (total > 0 && paid >= total) {
    return { key: "paid", color: "#10b981" };
  }
  if (paid > 0) {
    return { key: "partial", color: "#f59e0b" };
  }
  return { key: "pending", color: "#ef4444" };
}
async function loadInvoices(invoiceType = currentInvoiceListType || "factura") {
  var _a2;
  const config = getInvoiceListConfig(invoiceType);
  if (!config.rowsEl) return;
  currentInvoiceListType = config.type;
  const q = (((_a2 = config.searchEl) == null ? void 0 : _a2.value) || "").trim();
  try {
    await ensureRealContactsLoaded();
  } catch (e) {
  }
  const res = await fetchWithAuth(`/api/invoices?page=${invPage}&size=${invPageSize}&q=${encodeURIComponent(q)}&type=${encodeURIComponent(config.type)}`);
  if (res.ok) {
    const data = await res.json();
    const list = data.list || [];
    invTotal = data.total || 0;
    currentInvoices = list;
    config.rowsEl.innerHTML = "";
    renderInvPager(config.type);
    if (list.length === 0) {
      config.rowsEl.innerHTML = `<tr class="empty"><td colspan="${config.showDelivered ? 9 : 9}">${config.emptyText}</td></tr>`;
      return;
    }
    list.forEach((x, i) => {
      const tr = document.createElement("tr");
      const total = Number(x.total_amount || 0);
      const paid = Number(x.paid_amount || 0);
      const paymentStatus = getInvoicePaymentStatus(total, paid);
      const status = paymentStatus.key === "paid" ? "\u5DF2\u4ED8\u6B3E" : paymentStatus.key === "partial" ? "\u90E8\u5206\u4ED8\u6B3E" : "\u672A\u4ED8\u6B3E";
      const statusColor = paymentStatus.color;
      const displayCustomer = x.customer || x.client || "-";
      const displayDate = x.date || x.invoice_date || "-";
      let companyName = x.company_name || "-";
      const cust = findInvoiceCustomerContact(displayCustomer);
      if ((!companyName || companyName === "-") && (cust == null ? void 0 : cust.company)) companyName = cust.company;
      if ((!companyName || companyName === "-") && displayCustomer && displayCustomer !== "-") companyName = displayCustomer;
      const showCompanyName = companyName && companyName !== "-" && companyName !== displayCustomer;
      const isPaid = paymentStatus.key === "paid";
      const editBtn = isPaid ? `<button class="light-btn" style="font-size:12px; padding:4px 8px; opacity:0.5; cursor:not-allowed" title="\u5DF2\u4ED8\u6B3E\u4E0D\u53EF\u4FEE\u6539">\u4FEE\u6539</button>` : `<button class="light-btn" style="font-size:12px; padding:4px 8px" onclick="editInvoice('${x.id}')">\u4FEE\u6539</button>`;
      const shipBtnClass = x.shipping_printed ? "light-btn" : "light-btn btn-blue";
      const shipBtn = `<button class="${shipBtnClass}" style="font-size:12px; padding:4px 8px" onclick="printShippingLabel('${x.id}')">\u6253\u5370\u6536\u8D27\u5730\u5740</button>`;
      const seq = invTotal - ((invPage - 1) * invPageSize + i);
      let remarkHtml = x.notes || "";
      if (cust && cust.remark) {
        if (remarkHtml) remarkHtml += "<br>";
        remarkHtml += `<span style="color:#eab308; font-size:11px">(${cust.remark})</span>`;
      }
      const deliveredHtml = x.delivered ? `<div style="display:flex; align-items:flex-start; gap:8px">
              <input type="checkbox" checked disabled style="margin-top:2px">
              <div style="font-size:12px; line-height:1.45">
                <div>${x.delivered_at || "-"}</div>
                <div style="color:#94a3b8; margin-top:2px">${x.delivered_by || "-"}</div>
              </div>
            </div>` : `<label style="display:inline-flex; align-items:center; justify-content:center; width:100%">
              <input type="checkbox" onchange="setInvoiceDelivered('${x.id}', this)">
            </label>`;
      if (config.showDelivered) {
        tr.innerHTML = `
            <td>${seq}</td>
            <td>${x.invoice_no || ""}</td>
            <td>
              <div>${displayCustomer}</div>
              ${showCompanyName ? `<div style="margin-top:2px; font-size:12px; color:#94a3b8">${companyName}</div>` : ""}
            </td>
            <td>${displayDate}</td>
            <td style="color:#e2e8f0; font-weight:600">\u20AC${total.toFixed(2)}</td>
            <td><span style="color:${statusColor}; background:${statusColor}20; padding:2px 8px; border-radius:4px; font-size:12px">${status}</span></td>
            <td style="color:#94a3b8; font-size:12px">${remarkHtml}</td>
            <td>${deliveredHtml}</td>
            <td style="display:flex; gap:8px; justify-content:center">
              <button class="light-btn" style="font-size:12px; padding:4px 8px" onclick="previewInvoice('${x.id}')">\u9884\u89C8</button>
              ${shipBtn}
              ${editBtn}
            </td>
          `;
      } else {
        tr.innerHTML = `
            <td>${seq}</td>
            <td>${x.invoice_no || ""}</td>
            <td>${displayCustomer}</td>
            <td>${companyName || "-"}</td>
            <td>${displayDate}</td>
            <td style="color:#e2e8f0; font-weight:600">\u20AC${total.toFixed(2)}</td>
            <td><span style="color:${statusColor}; background:${statusColor}20; padding:2px 8px; border-radius:4px; font-size:12px">${status}</span></td>
            <td style="color:#94a3b8; font-size:12px">${remarkHtml}</td>
            <td style="display:flex; gap:8px; justify-content:center">
              <button class="light-btn" style="font-size:12px; padding:4px 8px" onclick="previewInvoice('${x.id}','es')">\u897F\u8BED\u9884\u89C8</button>
              <button class="light-btn" style="font-size:12px; padding:4px 8px" onclick="previewInvoice('${x.id}','zh')">\u4E2D\u6587\u9884\u89C8</button>
              ${shipBtn}
              ${editBtn}
            </td>
          `;
      }
      config.rowsEl.appendChild(tr);
    });
  }
}
function renderInvPager(invoiceType = currentInvoiceListType || "factura") {
  const config = getInvoiceListConfig(invoiceType);
  if (!config.pagerEl) return;
  config.pagerEl.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(invTotal / invPageSize));
  const createBtn = (text, page, disabled = false) => {
    const btn = document.createElement("button");
    btn.className = "light-btn";
    btn.textContent = text;
    btn.disabled = disabled;
    if (page === invPage) {
      btn.style.background = "#0b1524";
      btn.style.cursor = "default";
    } else {
      btn.addEventListener("click", () => {
        invPage = page;
        loadInvoices(config.type);
      });
    }
    return btn;
  };
  config.pagerEl.appendChild(createBtn("\u4E0A\u4E00\u9875", invPage - 1, invPage <= 1));
  let start = Math.max(1, invPage - 2);
  let end = Math.min(totalPages, invPage + 2);
  if (start > 1) {
    config.pagerEl.appendChild(createBtn("1", 1));
    if (start > 2) {
      const span = document.createElement("span");
      span.textContent = "...";
      span.style.color = "#94a3b8";
      span.style.padding = "0 4px";
      config.pagerEl.appendChild(span);
    }
  }
  for (let i = start; i <= end; i++) {
    config.pagerEl.appendChild(createBtn(String(i), i));
  }
  if (end < totalPages) {
    if (end < totalPages - 1) {
      const span = document.createElement("span");
      span.textContent = "...";
      span.style.color = "#94a3b8";
      span.style.padding = "0 4px";
      config.pagerEl.appendChild(span);
    }
    config.pagerEl.appendChild(createBtn(String(totalPages), totalPages));
  }
  config.pagerEl.appendChild(createBtn("\u4E0B\u4E00\u9875", invPage + 1, invPage >= totalPages));
}
window.setInvoiceDelivered = async function(id, checkboxEl) {
  if (!checkboxEl || !checkboxEl.checked) return;
  checkboxEl.disabled = true;
  try {
    const now = /* @__PURE__ */ new Date();
    const deliveredAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const res = await fetchWithAuth(`/api/invoices/${id}/delivered`, {
      method: "PUT",
      body: JSON.stringify({ delivered_at: deliveredAt })
    });
    if (!res.ok) throw new Error("deliver_failed");
    await loadInvoices(currentInvoiceListType);
  } catch (_) {
    checkboxEl.checked = false;
    checkboxEl.disabled = false;
  }
};
const invPrevModal = document.getElementById("invoice-preview-modal");
const invPrevClose = document.getElementById("inv-prev-close");
const invPrevPrint = document.getElementById("inv-prev-print");
const invPrevExportPdf = document.getElementById("inv-prev-export-pdf");
const invPaper = document.getElementById("invoice-paper");
const invPreviewShell = document.getElementById("invoice-preview-shell");
const invPreviewStage = document.getElementById("invoice-preview-stage");
let invoicePrintFrame = null;
let invoicePrintWindow = null;
const defaultInvoiceDocumentTitle = document.title;
let invoicePreviewDocumentTitle = "";
function setInvoicePreviewDocumentTitle(titleText) {
  const nextTitle = String(titleText || "").trim();
  document.__i18nTitleOverride = nextTitle;
  document.title = nextTitle || defaultInvoiceDocumentTitle;
}
function buildInvoicePrintTitle(invoiceNo) {
  const raw = String(invoiceNo || "").trim();
  if (!raw) return "Factura";
  return raw.replace(/[\\/:*?"<>|]+/g, "-");
}
function getInvoiceTypeFromRecord(inv) {
  return normalizeSalesInvoiceType((inv == null ? void 0 : inv.invoice_type) || (String((inv == null ? void 0 : inv.invoice_no) || "").trim().startsWith("Albaran-") ? "albaran" : "factura"));
}
function applyInvoicePreviewDocumentTitle(invoiceNo) {
  invoicePreviewDocumentTitle = buildInvoicePrintTitle(invoiceNo);
  setInvoicePreviewDocumentTitle(invoicePreviewDocumentTitle || defaultInvoiceDocumentTitle);
  return invoicePreviewDocumentTitle;
}
function restoreInvoicePreviewDocumentTitle() {
  invoicePreviewDocumentTitle = "";
  setInvoicePreviewDocumentTitle("");
}
function updateInvoicePreviewScale() {
  if (!invPrevModal || !invPaper || !invPreviewShell || !invPreviewStage) return;
  if (invPrevModal.style.display === "none") return;
  invPreviewStage.style.transform = "scale(1)";
  invPreviewStage.style.width = "auto";
  invPreviewStage.style.height = "auto";
  const maxWidth = Math.max(320, invPreviewShell.clientWidth - 8);
  const baseWidth = invPaper.offsetWidth;
  const baseHeight = invPaper.offsetHeight;
  if (!baseWidth || !baseHeight) return;
  const scale = Math.min(maxWidth / baseWidth, 1);
  invPreviewStage.style.transform = `scale(${scale})`;
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
    .invoice-paper table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11px; table-layout:fixed; }
    .invoice-paper th { background:#2c3e50 !important; color:#fff !important; padding:6px 8px; text-align:left; font-weight:600; }
    .invoice-paper td { border-bottom:1px solid #eee; padding:8px 8px; vertical-align:top; color:#333; }
    .invoice-paper .item-idx { width:28px; text-align:center; }
    .invoice-paper .item-main-col { width:auto; min-width:0; }
    .invoice-paper .item-qty-col { width:44px; text-align:right; white-space:nowrap; padding-left:6px; padding-right:6px; }
    .invoice-paper .item-price-col { width:58px; text-align:right; white-space:nowrap; padding-left:6px; padding-right:6px; }
    .invoice-paper .item-discount-col { width:48px; text-align:right; white-space:nowrap; padding-left:6px; padding-right:6px; }
    .invoice-paper .item-tax-col { width:50px; text-align:right; white-space:nowrap; padding-left:6px; padding-right:6px; }
    .invoice-paper .item-value-col { width:68px; text-align:right; white-space:nowrap; padding-left:6px; padding-right:6px; }
    .invoice-paper .item-name { font-weight:700; color:#000; font-size:12px; white-space:normal; overflow-wrap:anywhere; word-break:break-word; }
    .invoice-paper .item-desc { color:#666; font-size:10px; margin-top:1px; white-space:normal; overflow-wrap:anywhere; word-break:break-word; }
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
function buildInvoicePrintHtml(titleText, autoPrint = false) {
  const paperHtml = invPaper ? invPaper.outerHTML : "";
  const safeTitle = String(titleText || "Factura").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <style>${getInvoicePrintStyles()}</style>
</head>
<body>
  ${paperHtml}
  ${autoPrint ? `<script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        try {
          window.focus();
          window.print();
        } catch {}
      }, 150);
    });
    window.addEventListener('afterprint', function() {
      setTimeout(function() {
        try { window.close(); } catch {}
      }, 80);
    });
  <\/script>` : ""}
</body>
</html>`;
}
function absolutizeExportHtmlUrls(html) {
  const sourceHtml = String(html || "").trim();
  if (!sourceHtml) return sourceHtml;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sourceHtml, "text/html");
    const baseOrigin = window.location.origin;
    doc.querySelectorAll("[src], [href]").forEach((node) => {
      ["src", "href"].forEach((attr) => {
        const rawValue = String(node.getAttribute(attr) || "").trim();
        if (!rawValue || /^([a-z]+:)?\/\//i.test(rawValue) || rawValue.startsWith("data:") || rawValue.startsWith("blob:") || rawValue.startsWith("mailto:") || rawValue.startsWith("tel:")) return;
        if (rawValue.startsWith("/")) {
          node.setAttribute(attr, `${baseOrigin}${rawValue}`);
          return;
        }
        node.setAttribute(attr, new URL(rawValue, `${baseOrigin}/`).toString());
      });
    });
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch (e) {
    return sourceHtml;
  }
}
async function exportHtmlPdfToDesktop(html, fileName) {
  const resolvedName = String(fileName || "document").trim() || "document";
  const normalizedHtml = absolutizeExportHtmlUrls(html);
  const res = await fetchWithAuth(`${API_BASE}/api/pdf-export-desktop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html: normalizedHtml,
      fileName: resolvedName
    })
  });
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
    }
    throw new Error((data == null ? void 0 : data.error) || "pdf_export_failed");
  }
  const disposition = String(res.headers.get("Content-Disposition") || "");
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const fallbackMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const savedName = utf8Match ? decodeURIComponent(utf8Match[1]) : fallbackMatch ? fallbackMatch[1] : `${resolvedName}.pdf`;
  const blob = await res.blob();
  downloadBlobFile(blob, savedName);
  showAppToast(`PDF已开始下载：${savedName}`);
  return { ok: true, fileName: savedName, mode: "browser_download" };
}
function printInvoiceDocument(titleText, preferredWindow = null) {
  if (!invPaper) return;
  const resolvedTitle = titleText || invoicePreviewDocumentTitle || defaultInvoiceDocumentTitle;
  setInvoicePreviewDocumentTitle(resolvedTitle);
  let printWindow = preferredWindow;
  if ((!printWindow || printWindow.closed) && invoicePrintWindow && !invoicePrintWindow.closed) {
    try {
      invoicePrintWindow.close();
    } catch (e) {
    }
  }
  if (!printWindow || printWindow.closed) {
    try {
      printWindow = window.open("", "_blank", "width=960,height=720");
    } catch (e) {
    }
  }
  if (printWindow && !printWindow.closed) {
    invoicePrintWindow = printWindow;
    printWindow.document.open();
    printWindow.document.write(buildInvoicePrintHtml(resolvedTitle, true));
    printWindow.document.close();
    return;
  }
  if (invoicePrintFrame) {
    invoicePrintFrame.remove();
    invoicePrintFrame = null;
  }
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);
  invoicePrintFrame = frame;
  const cleanup = () => {
    if (invoicePrintFrame) {
      invoicePrintFrame.remove();
      invoicePrintFrame = null;
    }
  };
  const frameWindow = frame.contentWindow;
  if (!frameWindow) {
    cleanup();
    return;
  }
  frameWindow.document.open();
  frameWindow.document.write(buildInvoicePrintHtml(resolvedTitle));
  frameWindow.document.close();
  frame.onload = () => {
    setTimeout(() => {
      try {
        frameWindow.focus();
        frameWindow.print();
      } catch (e) {
      }
      setTimeout(cleanup, 4e3);
    }, 150);
  };
}
if (invPrevClose) invPrevClose.addEventListener("click", () => {
  invPrevModal.style.display = "none";
  restoreInvoicePreviewDocumentTitle();
});
if (invPrevPrint) {
  invPrevPrint.addEventListener("click", () => {
    var _a2;
    const invNo = buildInvoicePrintTitle(((_a2 = document.getElementById("prev-no")) == null ? void 0 : _a2.textContent) || "");
    const printWindow = window.open("", "_blank", "width=960,height=720");
    printInvoiceDocument(invNo, printWindow);
  });
}
if (invPrevExportPdf) {
  invPrevExportPdf.addEventListener("click", async () => {
    var _a2;
    if (invPrevExportPdf.disabled) return;
    const defaultText = invPrevExportPdf.textContent;
    invPrevExportPdf.disabled = true;
    invPrevExportPdf.textContent = "导出中...";
    try {
      const invNo = buildInvoicePrintTitle(((_a2 = document.getElementById("prev-no")) == null ? void 0 : _a2.textContent) || "");
      await exportHtmlPdfToDesktop(buildInvoicePrintHtml(invNo, false), invNo || "Factura");
    } catch (e) {
      alert((e == null ? void 0 : e.message) || "导出PDF失败");
    } finally {
      invPrevExportPdf.disabled = false;
      invPrevExportPdf.textContent = defaultText;
    }
  });
}
window.addEventListener("resize", () => {
  updateInvoicePreviewScale();
});
function normalizeInvoicePreviewText(text) {
  return String(text || "")
    .replace(/\uFF08/g, "(")
    .replace(/\uFF09/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}
function splitInvoiceDescriptionAndLote(text) {
  const desc = normalizeInvoicePreviewText(text);
  const match = desc.match(/^(.*?)(?:\s+)?Lote[:：]\s*([^\s]+)\s*$/i);
  if (!match) return { baseDesc: desc, lote: "" };
  return {
    baseDesc: normalizeInvoicePreviewText(match[1]),
    lote: normalizeInvoicePreviewText(match[2])
  };
}
function mergeInvoicePreviewItems(items) {
  const merged = [];
  const map = /* @__PURE__ */ new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const name = normalizeInvoicePreviewText(item == null ? void 0 : item.name);
    const nameCn = normalizeInvoicePreviewText(item == null ? void 0 : item.name_cn);
    const { baseDesc, lote: parsedLote } = splitInvoiceDescriptionAndLote(item == null ? void 0 : item.description);
    const lote = normalizeInvoicePreviewText((item == null ? void 0 : item.lote) || parsedLote);
    let taxRate = Number(item == null ? void 0 : item.tax_rate);
    if (isNaN(taxRate) || (item == null ? void 0 : item.tax_rate) === void 0 || (item == null ? void 0 : item.tax_rate) === null || (item == null ? void 0 : item.tax_rate) === "") taxRate = 0.1;
    if (taxRate >= 1) taxRate = taxRate / 100;
    const price = Number((item == null ? void 0 : item.price) || 0);
    const discount = normalizeInvoiceDiscountValue(item == null ? void 0 : item.discount, 0);
    const key = [name, baseDesc, lote, price.toFixed(6), discount.toFixed(4), taxRate.toFixed(6)].join("||");
    if (!map.has(key)) {
      const mergedItem = {
        ...item,
        name,
        name_cn: nameCn,
        lote,
        discount,
        description: [baseDesc, lote ? `Lote:${lote}` : ""].filter(Boolean).join(" "),
        qty: Number((item == null ? void 0 : item.qty) || 0),
        price,
        tax_rate: taxRate
      };
      map.set(key, mergedItem);
      merged.push(mergedItem);
      return;
    }
    const target = map.get(key);
    target.qty = Number(target.qty || 0) + Number((item == null ? void 0 : item.qty) || 0);
  });
  return merged;
}
async function hydrateInvoicePreviewItems(items) {
  const sourceItems = Array.isArray(items) ? items : [];
  const missingCnItems = sourceItems.filter(
    (item) => !normalizeInvoicePreviewText(item == null ? void 0 : item.name_cn) && !normalizeInvoicePreviewText(item == null ? void 0 : item.cn_name)
  );
  if (!missingCnItems.length) return sourceItems;
  const ids = [...new Set(missingCnItems.map((item) => Number((item == null ? void 0 : item.productId) || 0)).filter(Boolean))];
  const names = [...new Set(missingCnItems.map((item) => normalizeInvoicePreviewText(item == null ? void 0 : item.name)).filter(Boolean))];
  if (!ids.length && !names.length) return sourceItems;
  try {
    const res = await fetchWithAuth("/api/products/batch-stock", {
      method: "POST",
      body: JSON.stringify({ ids, names })
    });
    if (!res.ok) return sourceItems;
    const list = await res.json().catch(() => []);
    const byId = /* @__PURE__ */ new Map();
    const byName = /* @__PURE__ */ new Map();
    (Array.isArray(list) ? list : []).forEach((prod) => {
      const cnName = normalizeInvoicePreviewText(prod == null ? void 0 : prod.name_cn);
      if (!cnName) return;
      const pid = Number((prod == null ? void 0 : prod.id) || 0);
      const name = normalizeInvoicePreviewText(prod == null ? void 0 : prod.name);
      if (pid) byId.set(pid, cnName);
      if (name) byName.set(name, cnName);
    });
    return sourceItems.map((item) => {
      const existingCn = normalizeInvoicePreviewText(item == null ? void 0 : item.name_cn) || normalizeInvoicePreviewText(item == null ? void 0 : item.cn_name);
      if (existingCn) return item;
      const pid = Number((item == null ? void 0 : item.productId) || 0);
      const name = normalizeInvoicePreviewText(item == null ? void 0 : item.name);
      const nextCn = (pid ? byId.get(pid) : "") || byName.get(name) || "";
      return nextCn ? { ...item, name_cn: nextCn } : item;
    });
  } catch (e) {
    return sourceItems;
  }
}
window.previewInvoice = async function(id, language = "es") {
  const inv = currentInvoices.find((x) => String(x.id) === String(id));
  if (!inv) return;
  try {
    await ensureRealContactsLoaded();
  } catch (e) {
  }
  let invoiceCustomer = null;
  const invoiceType = getInvoiceTypeFromRecord(inv);
  const previewTexts = getInvoicePreviewTexts(invoiceType, language);
  try {
    const ci = await apiFetchJSON("/api/company-info");
    if (ci) {
      const infoHtml = `
        <div class="company-name">${ci.name || "EMPRESA"}</div>
        CIF: ${ci.tax_id || ""}<br>
        ${ci.street || ""}<br>
        ${ci.zip || ""} ${ci.city || ""} ${ci.country || ""}<br>
        ${ci.phone || ""}${ci.email ? "<br>" + ci.email : ""}
      `;
      const el = document.getElementById("prev-company-info");
      if (el) el.innerHTML = infoHtml;
      const payHtml = `
        <div class="payment-label">${previewTexts.paymentLabel}</div>
        ${ci.bank_name || ""}<br>
        ${ci.iban || ""}<br>
        SWIFT: ${ci.swift || ""}
      `;
      const payEl = document.getElementById("prev-payment-info");
      if (payEl) payEl.innerHTML = payHtml;
    }
  } catch (e) {
  }
  let customerInfoHtml = "";
  try {
    const cust = await getInvoiceCustomerContact(inv.customer);
    invoiceCustomer = cust;
    const companyName = inv.company_name || (cust == null ? void 0 : cust.company) || (cust == null ? void 0 : cust.name) || inv.customer || "";
    const customerCode = inv.customer_code || (cust == null ? void 0 : cust.code) || "";
    const customerAddress = inv.customer_address || (cust == null ? void 0 : cust.address) || (cust == null ? void 0 : cust.ship_address) || "";
    const customerZip = inv.customer_zip || (cust == null ? void 0 : cust.zip) || (cust == null ? void 0 : cust.ship_zip) || "";
    const customerCity = inv.customer_city || (cust == null ? void 0 : cust.city) || (cust == null ? void 0 : cust.ship_city) || "";
    const customerCountry = inv.customer_country || (cust == null ? void 0 : cust.country) || (cust == null ? void 0 : cust.ship_country) || "";
    if (cust) {
      customerInfoHtml = `
        <div class="customer-label">${previewTexts.customerLabel}</div>
        <div style="font-weight:700">${companyName}</div>
        ${customerCode ? `<div>${customerCode}</div>` : ""}
        ${customerAddress ? `<div>${customerAddress}</div>` : ""}
        ${customerZip ? `<div>${customerZip}</div>` : ""}
        ${customerCity ? `<div>${customerCity}</div>` : ""}
        ${customerCountry ? `<div>${customerCountry}</div>` : ""}
      `;
    } else if (companyName) {
      customerInfoHtml = `
        <div class="customer-label">${previewTexts.customerLabel}</div>
        <div style="font-weight:700">${companyName}</div>
        ${customerCode ? `<div>${customerCode}</div>` : ""}
        ${customerAddress ? `<div>${customerAddress}</div>` : ""}
        ${customerZip ? `<div>${customerZip}</div>` : ""}
        ${customerCity ? `<div>${customerCity}</div>` : ""}
        ${customerCountry ? `<div>${customerCountry}</div>` : ""}
      `;
    } else {
      customerInfoHtml = `
        <div class="customer-label">${previewTexts.customerLabel}</div>
        <div style="font-weight:700">${inv.customer || ""}</div>
      `;
    }
  } catch (e) {
    customerInfoHtml = `
      <div class="customer-label">${previewTexts.customerLabel}</div>
      <div style="font-weight:700">${inv.customer || ""}</div>
    `;
  }
  const custEl = document.getElementById("prev-customer-info");
  if (custEl) custEl.innerHTML = customerInfoHtml;
  const previewModalTitle = document.getElementById("invoice-preview-modal-title");
  const previewDocTitle = document.getElementById("prev-doc-title");
  const previewDateLabel = document.getElementById("prev-date-label");
  if (previewModalTitle) previewModalTitle.textContent = previewTexts.modalTitle;
  if (previewDocTitle) previewDocTitle.textContent = previewTexts.docTitle;
  if (previewDateLabel) previewDateLabel.textContent = previewTexts.dateLabel;
  const itemNameLabelEl = document.getElementById("prev-item-name-label");
  if (itemNameLabelEl) itemNameLabelEl.textContent = previewTexts.itemNameLabel;
  const qtyLabelEl = document.getElementById("prev-qty-label");
  if (qtyLabelEl) qtyLabelEl.textContent = previewTexts.qtyLabel;
  const priceLabelEl = document.getElementById("prev-price-label");
  if (priceLabelEl) priceLabelEl.textContent = previewTexts.priceLabel;
  const discountLabelEl = document.getElementById("prev-discount-label");
  if (discountLabelEl) discountLabelEl.textContent = previewTexts.discountLabel;
  const discountAmountLabelEl = document.getElementById("prev-discount-amount-label");
  if (discountAmountLabelEl) discountAmountLabelEl.textContent = previewTexts.discountAmountLabel;
  const taxLabelEl = document.getElementById("prev-tax-label");
  if (taxLabelEl) taxLabelEl.textContent = previewTexts.taxLabel;
  const valueLabelEl = document.getElementById("prev-value-label");
  if (valueLabelEl) valueLabelEl.textContent = previewTexts.valueLabel;
  const totalQtyLabelEl = document.getElementById("prev-total-qty-label");
  if (totalQtyLabelEl) totalQtyLabelEl.textContent = previewTexts.totalQtyLabel;
  const subtotalLabelEl = document.getElementById("prev-subtotal-label");
  if (subtotalLabelEl) subtotalLabelEl.textContent = previewTexts.subtotalLabel;
  const grandTotalLabelEl = document.getElementById("prev-grand-total-label");
  if (grandTotalLabelEl) grandTotalLabelEl.textContent = previewTexts.grandTotalLabel;
  const grandTotal2LabelEl = document.getElementById("prev-grand-total-2-label");
  if (grandTotal2LabelEl) grandTotal2LabelEl.textContent = previewTexts.grandTotal2Label;
  const notesLabelEl = document.getElementById("prev-notes-label");
  if (notesLabelEl) notesLabelEl.textContent = previewTexts.notesLabel;
  document.getElementById("prev-no").textContent = inv.invoice_no || "";
  applyInvoicePreviewDocumentTitle(inv.invoice_no || "");
  const total = Number(inv.total_amount || 0);
  const manualDiscountAmount = normalizeInvoiceManualDiscountValue(inv.manual_discount_amount, 0);
  const paid = Number(inv.paid_amount || 0);
  const statusEl = document.getElementById("prev-status");
  if (statusEl) {
    const paymentStatus = getInvoicePaymentStatus(total, paid);
    if (paymentStatus.key === "paid") {
      statusEl.textContent = previewTexts.statusPaid;
      statusEl.style.color = paymentStatus.color;
      statusEl.style.borderColor = paymentStatus.color;
    } else if (paymentStatus.key === "partial") {
      statusEl.textContent = previewTexts.statusPartial;
      statusEl.style.color = paymentStatus.color;
      statusEl.style.borderColor = paymentStatus.color;
    } else {
      statusEl.textContent = previewTexts.statusPending;
      statusEl.style.color = paymentStatus.color;
      statusEl.style.borderColor = paymentStatus.color;
    }
  }
  const formatDate = (d) => formatDisplayDate(d);
  const dateStr = formatDate(inv.date);
  document.getElementById("prev-date").textContent = dateStr;
  const prevSalesEl = document.getElementById("prev-sales");
  if (prevSalesEl) {
    prevSalesEl.textContent = "";
    prevSalesEl.style.display = "none";
  }
  document.getElementById("prev-notes").textContent = (invoiceCustomer == null ? void 0 : invoiceCustomer.invoice_nota) || inv.notes || "";
  const tbody = document.getElementById("prev-items");
  tbody.innerHTML = "";
  const rawItems = Array.isArray(inv.items) ? inv.items : typeof inv.items === "string" ? JSON.parse(inv.items) : [];
  const hydratedItems = await hydrateInvoicePreviewItems(rawItems);
  const items = mergeInvoicePreviewItems(hydratedItems);
  let totalQty = 0;
  let subtotal = 0;
  let discountAmount = 0;
  let taxDetails = {};
  items.forEach((item, idx) => {
    const qty = Number(item.qty || 0);
    totalQty += qty;
    const price = Number(item.price || 0);
    const discount = normalizeInvoiceDiscountValue(item.discount, 0);
    const rawAmount = Number(qty || 0) * Number(price || 0);
    const displayName = normalizeInvoicePreviewLanguage(language) === "zh" ? normalizeInvoicePreviewText(item == null ? void 0 : item.name_cn) || normalizeInvoicePreviewText(item == null ? void 0 : item.cn_name) || normalizeInvoicePreviewText(item == null ? void 0 : item.name) : normalizeInvoicePreviewText(item == null ? void 0 : item.name);
    let taxRate = Number(item.tax_rate);
    if (isNaN(taxRate) || item.tax_rate === void 0 || item.tax_rate === null || item.tax_rate === "") taxRate = 0.1;
    if (taxRate >= 1) taxRate = taxRate / 100;
    const rowVal = getInvoiceDiscountedAmount(qty, price, discount);
    subtotal += rowVal;
    discountAmount += Math.max(0, rawAmount - rowVal);
    const taxAmt = rowVal * taxRate;
    if (taxRate > 0) {
      const key = (taxRate * 100).toFixed(2);
      if (!taxDetails[key]) taxDetails[key] = 0;
      taxDetails[key] += taxAmt;
    }
    const tr = document.createElement("tr");
    let taxDisplay = "";
    if (taxRate > 0) {
      taxDisplay = previewTexts.taxDisplay(taxRate);
    }
    tr.innerHTML = `
      <td class="item-idx">${idx + 1}</td>
      <td class="item-main-col">
        <div class="item-name">${displayName || ""}</div>
        <div class="item-desc">${item.description || ""}</div>
      </td>
      <td class="item-qty-col">${formatInvoicePreviewQty(qty)}</td>
      <td class="item-price-col">${price.toFixed(2)}</td>
      <td class="item-discount-col">${formatInvoiceDiscountDisplay(discount)}</td>
      <td class="item-tax-col">${taxDisplay}</td>
      <td class="item-value-col">${rowVal.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
  const totalQtyEl = document.getElementById("prev-total-qty");
  if (totalQtyEl) totalQtyEl.textContent = formatInvoicePreviewQty(totalQty);
  let totalTax = 0;
  Object.values(taxDetails).forEach((v) => totalTax += v);
  const grandTotal = Math.max(0, subtotal + totalTax - manualDiscountAmount);
  document.getElementById("prev-subtotal").textContent = subtotal.toFixed(2);
  const prevDiscountAmountEl = document.getElementById("prev-discount-amount");
  if (prevDiscountAmountEl) prevDiscountAmountEl.textContent = (discountAmount + manualDiscountAmount).toFixed(2);
  const taxRowsContainer = document.getElementById("prev-tax-rows");
  if (taxRowsContainer) {
    taxRowsContainer.innerHTML = "";
    Object.keys(taxDetails).sort((a, b) => Number(b) - Number(a)).forEach((rate) => {
      const amt = taxDetails[rate];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="total-label">${previewTexts.taxRowLabel(rate)}</td>
        <td class="total-val">${amt.toFixed(2)}</td>
      `;
      taxRowsContainer.appendChild(tr);
    });
  } else {
    const prevTaxEl = document.getElementById("prev-tax");
    if (prevTaxEl) prevTaxEl.textContent = totalTax.toFixed(2);
  }
  document.getElementById("prev-grand-total").textContent = grandTotal.toFixed(2) + "\u20AC";
  document.getElementById("prev-grand-total-2").textContent = grandTotal.toFixed(2) + "\u20AC";
  invPrevModal.style.display = "flex";
  requestAnimationFrame(() => {
    updateInvoicePreviewScale();
    requestAnimationFrame(() => updateInvoicePreviewScale());
  });
};
window.printInvoice = function(id) {
  const printWindow = window.open("", "_blank", "width=960,height=720");
  previewInvoice(id).then(() => {
    var _a2;
    const invNo = buildInvoicePrintTitle(((_a2 = document.getElementById("prev-no")) == null ? void 0 : _a2.textContent) || "");
    printInvoiceDocument(invNo, printWindow);
  }).catch(() => {
    try {
      if (printWindow && !printWindow.closed) printWindow.close();
    } catch (e) {
    }
  });
};
let pendingEditInvoiceId = null;
const editModal = document.getElementById("invoice-edit-modal");
const editClose = document.getElementById("edit-modal-close");
const editModalTitle = document.getElementById("edit-modal-title");
const editInvoiceNo = document.getElementById("edit-invoice-no");
const editConvertToFacturaBtn = document.getElementById("edit-convert-to-factura");
const editItems = document.getElementById("edit-items");
const editAddItem = document.getElementById("edit-add-item");
const editSave = document.getElementById("edit-save");
const editCustomer = document.getElementById("edit-customer");
const editCustomerDd = document.getElementById("edit-customer-dd");
const editCustomerSearch = document.getElementById("edit-customer-search");
const editCustomerList = document.getElementById("edit-customer-list");
let currentEditCustomer = null;
let editDraggingRow = null;
let currentEditInvoiceType = "factura";
let pendingEditInvoiceType = "factura";
let currentEditConvertedInvoiceNo = "";
let currentEditMode = "invoice";
let currentEditDailyOrderId = 0;
let currentEditDailyOrderStatus = "";
const editDateWrap = (document.getElementById("edit-date") || {}).parentElement || null;
const editTrustWrap = (document.getElementById("edit-trust") || {}).parentElement || null;
if (editClose) editClose.addEventListener("click", () => editModal.style.display = "none");
function updateEditInvoiceHeader(invoiceType = "factura") {
  currentEditInvoiceType = normalizeSalesInvoiceType(invoiceType);
  if (editModalTitle) editModalTitle.textContent = currentEditInvoiceType === "albaran" ? "\u4FEE\u6539Albaran" : "\u4FEE\u6539\u53D1\u7968";
  if (editInvoiceNo) editInvoiceNo.style.color = currentEditInvoiceType === "albaran" ? "#ffffff" : "var(--blue)";
  refreshEditConvertButton();
}
function applyInvoiceEditorMode(mode = "invoice") {
  currentEditMode = mode === "daily_order" ? "daily_order" : "invoice";
  if (currentEditMode === "daily_order") {
    if (editModalTitle) editModalTitle.textContent = "\u4FEE\u6539\u8BA2\u5355";
    if (editConvertToFacturaBtn) editConvertToFacturaBtn.style.display = "none";
    if (editTrustWrap) editTrustWrap.style.display = "none";
  } else {
    if (editTrustWrap) editTrustWrap.style.display = "";
    updateEditInvoiceHeader(currentEditInvoiceType || "factura");
  }
  if (editDateWrap) editDateWrap.style.display = "";
  if (editSave) editSave.textContent = currentEditMode === "daily_order" ? "\u4FDD\u5B58\u8BA2\u5355" : "\u4FDD\u5B58\u4FEE\u6539";
}
function refreshEditConvertButton() {
  if (!editConvertToFacturaBtn) return;
  if (currentEditMode === "daily_order") {
    editConvertToFacturaBtn.style.display = "none";
    return;
  }
  const canConvert = currentEditInvoiceType === "albaran";
  editConvertToFacturaBtn.style.display = canConvert ? "inline-flex" : "none";
  if (!canConvert) return;
  if (currentEditConvertedInvoiceNo) {
    editConvertToFacturaBtn.textContent = `\u53D1\u7968\u53F7\uFF1A${currentEditConvertedInvoiceNo}`;
    editConvertToFacturaBtn.style.background = "#0f172a";
    editConvertToFacturaBtn.style.color = "#93c5fd";
    editConvertToFacturaBtn.style.borderColor = "#2563eb";
    editConvertToFacturaBtn.style.cursor = "default";
    editConvertToFacturaBtn.disabled = true;
    return;
  }
  editConvertToFacturaBtn.disabled = false;
  editConvertToFacturaBtn.style.cursor = "";
  const active = pendingEditInvoiceType === "factura";
  editConvertToFacturaBtn.textContent = active ? "\u5DF2\u9009\u8F6C\u6210\u53D1\u7968" : "\u8F6C\u6210\u53D1\u7968";
  editConvertToFacturaBtn.style.background = active ? "var(--blue)" : "";
  editConvertToFacturaBtn.style.color = active ? "#ffffff" : "";
  editConvertToFacturaBtn.style.borderColor = active ? "var(--blue)" : "";
}
if (editCustomer) {
  editCustomer.addEventListener("focus", () => {
    editCustomerSearch.value = "";
    renderEditCustomerList();
    editCustomerDd.style.display = "block";
    editCustomerSearch.focus();
  });
  document.addEventListener("click", (e) => {
    if (!editCustomer.contains(e.target) && !editCustomerDd.contains(e.target)) {
      editCustomerDd.style.display = "none";
    }
  });
}
if (editCustomerSearch) {
  editCustomerSearch.addEventListener("input", () => renderEditCustomerList(editCustomerSearch.value));
}
function renderEditCustomerList(filter = "") {
  const list = [
    ...contactsData.customers || [],
    ...contactsData.merchants || [],
    ...contactsData.others || []
  ];
  editCustomerList.innerHTML = "";
  const f = filter.toLowerCase();
  list.forEach((c) => {
    if (!f || c.name.toLowerCase().includes(f) || (c.company || "").toLowerCase().includes(f)) {
      const div = document.createElement("div");
      div.className = "dd-item";
      div.textContent = c.name + (c.company ? ` (${c.company})` : "");
      div.onclick = () => {
        editCustomer.value = c.name;
        currentEditCustomer = c;
        if (editUsePrice) {
          const p = c.use_price || "price1";
          const map = { price1: "\u4EF7\u683C1", price2: "\u4EF7\u683C2", price3: "\u4EF7\u683C3", price4: "\u4EF7\u683C4" };
          editUsePrice.value = map[p] || p;
        }
        if (editSales) {
          if (c.sales) {
            editSales.value = c.sales;
            editSales.disabled = true;
          } else {
            editSales.value = "";
            editSales.disabled = false;
          }
        }
        editCustomerDd.style.display = "none";
        Array.from(editItems.children).forEach((tr) => {
          let taxRate = 0.1;
          const stored = parseFloat(tr.dataset.taxRate);
          if (!isNaN(stored)) taxRate = stored;
          if (c.is_iva === false) taxRate = 0;
          else if (taxRate === 0 && stored !== 0) taxRate = 0.1;
          tr.dataset.taxRate = taxRate;
          const qty = parseFloat(tr.querySelector(".qty").value) || 0;
          const price = parseFloat(tr.querySelector(".price").value) || 0;
          const discount = normalizeInvoiceDiscountValue((tr.querySelector(".discount") || {}).value, 0);
          const taxAmt = getInvoiceDiscountedAmount(qty, price, discount) * taxRate;
          tr.querySelector(".iva-amt").textContent = taxAmt.toFixed(2);
        });
        updateEditTotal();
      };
      editCustomerList.appendChild(div);
    }
  });
}
function syncInvoiceEditorCustomerState(customerName = "", salesValue = "") {
  editCustomer.value = customerName || "";
  const allContacts2 = [
    ...contactsData.customers || [],
    ...contactsData.merchants || [],
    ...contactsData.others || []
  ];
  currentEditCustomer = allContacts2.find((c) => c.name === (customerName || ""));
  if (editUsePrice) {
    if (currentEditCustomer) {
      const p = currentEditCustomer.use_price || "price1";
      const map = { price1: "\u4EF7\u683C1", price2: "\u4EF7\u683C2", price3: "\u4EF7\u683C3", price4: "\u4EF7\u683C4" };
      editUsePrice.value = map[p] || p;
    } else {
      editUsePrice.value = "";
    }
  }
  if (editSales) {
    if (salesValue) {
      editSales.value = salesValue;
      editSales.disabled = !!(currentEditCustomer && currentEditCustomer.sales);
    } else if (currentEditCustomer && currentEditCustomer.sales) {
      editSales.value = currentEditCustomer.sales;
      editSales.disabled = true;
    } else {
      editSales.value = "";
      editSales.disabled = false;
    }
  }
}
function buildDailyOrderInvoiceEditorRows(order = {}, products = []) {
  const orderItems = Array.isArray(order == null ? void 0 : order.items) ? order.items : typeof (order == null ? void 0 : order.items) === "string" ? JSON.parse(order.items) : [];
  const rows = [];
  orderItems.forEach((item) => {
    var _a2;
    const fullProd = products.find((p) => p.id == item.productId || p.name === item.name) || {};
    const usePrice = ((_a2 = getDailyOrderCustomerInfo(order.customer || "")) == null ? void 0 : _a2.use_price) || "price1";
    const priceValue = fullProd[usePrice] !== void 0 && fullProd[usePrice] !== null && fullProd[usePrice] !== "" ? Number(fullProd[usePrice] || 0) : Number(item.price || item.price1 || 0);
    const allocationRows = currentEditDailyOrderStatus === "allocated" || currentEditDailyOrderStatus === "ready_to_ship" ? getDailyOrderItemAllocationRows(item, fullProd) : [];
    const actualQty = getDailyOrderItemActualQty(item) || Number(item.qty || 1);
    const derivedLote = getInvoiceItemStockMetaDerivedLote(item);
    if (allocationRows.length > 1) {
      allocationRows.forEach((row) => {
        rows.push({
          ...item,
          image: item.image || fullProd.image || "",
          qty: Math.max(0, Number(row.qty || 0)),
          price: priceValue,
          lote: String(row.lote || "").trim(),
          description: item.description || item.spec || "",
          __preserveEmptyLote: true
        });
      });
      return;
    }
    rows.push({
      ...item,
      image: item.image || fullProd.image || "",
      qty: currentEditDailyOrderStatus === "allocated" || currentEditDailyOrderStatus === "ready_to_ship" ? actualQty : getDailyOrderItemOrderedQty(item) || actualQty,
      price: priceValue,
      lote: allocationRows.length === 1 ? String(allocationRows[0].lote || "").trim() : String(derivedLote || item.lote || "").trim(),
      description: item.description || item.spec || "",
      __preserveEmptyLote: true
    });
  });
  return rows;
}
function collectDailyOrderItemsFromInvoiceEditor() {
  const grouped = new Map();
  Array.from(editItems.children).forEach((tr) => {
    var _a2;
    const name = String((tr.querySelector(".name") || {}).value || "").trim();
    const nameCn = String(tr.dataset.nameCn || "").trim();
    const image = String(tr.dataset.productImage || "").trim();
    const description = String((tr.querySelector(".desc") || {}).value || "").trim();
    const lote = String(((_a2 = tr.querySelector(".lote")) == null ? void 0 : _a2.value) || "").trim();
    const qty = Math.max(0, Number((tr.querySelector(".qty") || {}).value || 0));
    const price = Number((tr.querySelector(".price") || {}).value || 0);
    const taxRate = Number(tr.dataset.taxRate || 0);
    const productId = tr.dataset.productId || "";
    const sku = tr.dataset.sku || "";
    if (!name || qty <= 0) return;
    const key = [productId, sku, name, description, price.toFixed(4), taxRate.toFixed(4)].join("__");
    if (!grouped.has(key)) {
      grouped.set(key, {
        name,
        image,
        cn_name: nameCn,
        description,
        tax_rate: taxRate,
        productId,
        sku,
        qty: 0,
        price,
        allocation_plan: []
      });
    }
    const bucket = grouped.get(key);
    bucket.qty += qty;
    if (lote) bucket.allocation_plan.push({ lote, expiry: "", qty });
  });
  return Array.from(grouped.values()).map((item) => ({
    ...item,
    qty: Math.max(0, Number(item.qty || 0)),
    price: Number(item.price || 0),
    allocated_qty: currentEditDailyOrderStatus === "allocated" || currentEditDailyOrderStatus === "ready_to_ship" ? Math.max(0, Number(item.qty || 0)) : void 0,
    allocation_plan: currentEditDailyOrderStatus === "allocated" || currentEditDailyOrderStatus === "ready_to_ship" ? item.allocation_plan : [],
    deductions: []
  }));
}
window.editInvoice = function(id) {
  const inv = currentInvoices.find((x) => String(x.id) === String(id));
  if (!inv) return;
  const invoiceType = getInvoiceTypeFromRecord(inv);
  currentEditDailyOrderId = 0;
  currentEditDailyOrderStatus = "";
  applyInvoiceEditorMode("invoice");
  clearInvoiceLoteCaches();
  document.getElementById("edit-id").value = inv.id;
  editInvoiceNo.textContent = inv.invoice_no;
  editInvoiceNo.dataset.originalNo = String(inv.invoice_no || "");
  editInvoiceNo.dataset.invoiceType = invoiceType;
  currentEditConvertedInvoiceNo = String(inv.converted_invoice_no || "").trim();
  pendingEditInvoiceType = invoiceType;
  updateEditInvoiceHeader(invoiceType);
  syncInvoiceEditorCustomerState(inv.customer || "", inv.sales || "");
  document.getElementById("edit-date").value = inv.date || "";
  document.getElementById("edit-notes").value = inv.notes || "";
  const editManualDiscountInput = getEditManualDiscountInput();
  if (editManualDiscountInput) editManualDiscountInput.value = normalizeInvoiceManualDiscountValue(inv.manual_discount_amount, 0).toFixed(2);
  editItems.innerHTML = "";
  let items = [];
  try {
    items = Array.isArray(inv.items) ? inv.items : typeof inv.items === "string" ? JSON.parse(inv.items) : [];
  } catch (e) {
    items = [];
  }
  if (Array.isArray(items)) {
    items.forEach((item) => addEditItem({ ...item, __preserveEmptyLote: true }));
  }
  updateEditTotal();
  validateEditStockHints();
  editModal.style.display = "flex";
};
async function openDailyOrderInvoiceEditor(id) {
  const order = currentDailyOrders.find((x) => String(x.id) === String(id));
  if (!order) return;
  currentEditDailyOrderId = Number(order.id || 0) || 0;
  currentEditDailyOrderStatus = String(order.status || "").trim();
  currentEditConvertedInvoiceNo = "";
  pendingEditInvoiceType = "factura";
  currentEditInvoiceType = "factura";
  applyInvoiceEditorMode("daily_order");
  clearInvoiceLoteCaches();
  document.getElementById("edit-id").value = order.id;
  editInvoiceNo.textContent = order.order_no || `ORD-${order.id}`;
  editInvoiceNo.dataset.originalNo = "";
  editInvoiceNo.dataset.invoiceType = "";
  syncInvoiceEditorCustomerState(order.customer || "", order.sales || "");
  document.getElementById("edit-date").value = order.date || "";
  document.getElementById("edit-notes").value = order.notes || "";
  const editManualDiscountInput = getEditManualDiscountInput();
  if (editManualDiscountInput) editManualDiscountInput.value = normalizeInvoiceManualDiscountValue(order.manual_discount_amount, 0).toFixed(2);
  if (document.getElementById("edit-trust")) document.getElementById("edit-trust").value = "30";
  editItems.innerHTML = "";
  let products = [];
  const rawItems = Array.isArray(order.items) ? order.items : typeof order.items === "string" ? JSON.parse(order.items) : [];
  const itemNames = rawItems.map((i) => i.name).filter(Boolean);
  const itemIds = rawItems.map((i) => i.productId).filter(Boolean);
  if (itemNames.length > 0 || itemIds.length > 0) {
    try {
      const res = await fetchWithAuth("/api/products/batch-stock", {
        method: "POST",
        body: JSON.stringify({ names: itemNames, ids: itemIds })
      });
      if (res.ok) products = await res.json();
    } catch (e) {
    }
  }
  buildDailyOrderInvoiceEditorRows(order, products).forEach((item) => addEditItem(item));
  updateEditTotal();
  validateEditStockHints();
  editModal.style.display = "flex";
}
if (editConvertToFacturaBtn) {
  editConvertToFacturaBtn.addEventListener("click", () => {
    if (currentEditInvoiceType !== "albaran") return;
    if (currentEditConvertedInvoiceNo) return;
    pendingEditInvoiceType = pendingEditInvoiceType === "factura" ? "albaran" : "factura";
    refreshEditConvertButton();
    validateEditStockHints();
  });
}
function clearEditRowStockHint(row) {
  const hint = row == null ? void 0 : row.querySelector(".qty-stock-warning");
  const qtyInput = row == null ? void 0 : row.querySelector(".qty");
  if (hint) {
    hint.textContent = "";
    hint.style.display = "none";
  }
  if (qtyInput) qtyInput.style.borderColor = "#334155";
}
function showEditRowStockHint(row, message = "\u6570\u91CF\u4E0D\u8DB3") {
  const hint = row == null ? void 0 : row.querySelector(".qty-stock-warning");
  const qtyInput = row == null ? void 0 : row.querySelector(".qty");
  if (hint) {
    hint.textContent = message;
    hint.style.display = "block";
  }
  if (qtyInput) qtyInput.style.borderColor = "#ef4444";
}
function shouldValidateEditStockInline() {
  return currentEditInvoiceType === "albaran" && pendingEditInvoiceType === "factura";
}
async function validateEditStockHints() {
  var _a2, _b2, _c2;
  const rows2 = Array.from((editItems == null ? void 0 : editItems.children) || []);
  rows2.forEach(clearEditRowStockHint);
  if (!shouldValidateEditStockInline()) return true;
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows2) {
    const name = String(((_a2 = row.querySelector(".name")) == null ? void 0 : _a2.value) || "").trim();
    const qty = Math.max(0, Number(((_b2 = row.querySelector(".qty")) == null ? void 0 : _b2.value) || 0));
    if (!name || qty <= 0) continue;
    const productRef = {
      productId: row.dataset.productId || "",
      sku: row.dataset.sku || "",
      name: row.dataset.productName || name
    };
    const summary = await fetchInvoiceLoteSummary(productRef);
    const productKey = getInvoiceLoteCacheKey(productRef) || `name:${name}`;
    const loteValue = String(((_c2 = row.querySelector(".lote")) == null ? void 0 : _c2.value) || "").trim();
    const loteKey = normalizeComparableLoteKey(loteValue);
    const groupKey = `${productKey}::${loteKey || "__ALL__"}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        rows: [],
        requested: 0,
        available: loteKey ? Array.isArray(summary == null ? void 0 : summary.choices) ? summary.choices.reduce((sum, choice) => normalizeComparableLoteKey((choice == null ? void 0 : choice.value) || "") === loteKey ? sum + Math.max(0, Number((choice == null ? void 0 : choice.qty) || 0)) : sum, 0) : 0 : Math.max(0, Number((summary == null ? void 0 : summary.totalStock) || 0))
      });
    }
    const group = groups.get(groupKey);
    group.rows.push(row);
    group.requested += qty;
  }
  let valid = true;
  groups.forEach((group) => {
    if (Number(group.requested || 0) > Number(group.available || 0)) {
      valid = false;
      group.rows.forEach((row) => showEditRowStockHint(row));
    }
  });
  return valid;
}
function clearEditItemDropHints() {
  Array.from(editItems.children).forEach((row) => {
    row.style.borderTop = "none";
    row.style.borderBottom = "1px solid #1e293b";
  });
}
function attachEditItemDragHandlers(tr) {
  const handle = tr.querySelector(".edit-item-drag");
  tr.draggable = false;
  if (!handle) return;
  handle.draggable = true;
  handle.addEventListener("dragstart", (e) => {
    var _a2;
    editDraggingRow = tr;
    tr.style.opacity = "0.45";
    tr.style.background = "rgba(59,130,246,0.08)";
    handle.style.cursor = "grabbing";
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tr.dataset.productId || ((_a2 = tr.querySelector(".name")) == null ? void 0 : _a2.value) || "row");
    }
  });
  tr.addEventListener("dragover", (e) => {
    if (!editDraggingRow || editDraggingRow === tr) return;
    e.preventDefault();
    clearEditItemDropHints();
    const rect = tr.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    tr.style.borderTop = insertBefore ? "2px solid #3b82f6" : "none";
    tr.style.borderBottom = insertBefore ? "1px solid #1e293b" : "2px solid #3b82f6";
  });
  tr.addEventListener("drop", (e) => {
    if (!editDraggingRow || editDraggingRow === tr) return;
    e.preventDefault();
    const rect = tr.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    editItems.insertBefore(editDraggingRow, insertBefore ? tr : tr.nextSibling);
    clearEditItemDropHints();
  });
  handle.addEventListener("dragend", () => {
    clearEditItemDropHints();
    if (editDraggingRow) {
      editDraggingRow.style.opacity = "";
      editDraggingRow.style.background = "";
    }
    handle.style.cursor = "grab";
    editDraggingRow = null;
  });
}
if (editItems) {
  editItems.addEventListener("dragover", (e) => {
    if (!editDraggingRow) return;
    e.preventDefault();
    const rows2 = Array.from(editItems.children).filter((row) => row !== editDraggingRow);
    if (!rows2.length) return;
    clearEditItemDropHints();
    const lastRow = rows2[rows2.length - 1];
    const rect = lastRow.getBoundingClientRect();
    if (e.clientY >= rect.top + rect.height / 2) {
      lastRow.style.borderBottom = "2px solid #3b82f6";
    }
  });
  editItems.addEventListener("drop", (e) => {
    if (!editDraggingRow) return;
    e.preventDefault();
    const rows2 = Array.from(editItems.children).filter((row) => row !== editDraggingRow);
    if (!rows2.length) {
      editItems.appendChild(editDraggingRow);
    } else {
      const lastRow = rows2[rows2.length - 1];
      const rect = lastRow.getBoundingClientRect();
      if (e.clientY >= rect.top + rect.height / 2) {
        editItems.appendChild(editDraggingRow);
      }
    }
    clearEditItemDropHints();
  });
}
function addEditItem(p = {}) {
  const tr = document.createElement("tr");
  tr.style.borderBottom = "1px solid #1e293b";
  tr.dataset.autoPickLote = p.__preserveEmptyLote === true ? "0" : "1";
  let taxRate = 0.1;
  if (p.tax_rate !== void 0 && p.tax_rate !== null && p.tax_rate !== "") {
    taxRate = Number(p.tax_rate);
    if (taxRate >= 1) taxRate = taxRate / 100;
  }
  if (currentEditCustomer && currentEditCustomer.is_iva === false) {
    taxRate = 0;
  }
  tr.dataset.taxRate = taxRate;
  tr.dataset.productId = p.productId || p.id || "";
  tr.dataset.sku = p.sku || "";
  tr.dataset.nameCn = p.name_cn || "";
  tr.dataset.productImage = p.image || "";
  tr.dataset.productName = p.name || "";
  const editorFields = getInvoiceItemEditorFields(p);
  const qty = Number(p.qty) || 0;
  const price = p.price !== void 0 && p.price !== null && p.price !== "" ? Number(p.price) : getProductPriceByCustomer(p, currentEditCustomer);
  const discount = normalizeInvoiceDiscountValue(p.discount, 0);
  const total = getInvoiceDiscountedAmount(qty, price, discount);
  const taxAmt = total * taxRate;
  tr.innerHTML = `
    <td style="padding:10px 6px; text-align:center; vertical-align:middle">
      <button type="button" class="edit-item-drag" title="\u62D6\u52A8\u6392\u5E8F" style="width:26px; height:26px; padding:0; border:1px solid #334155; border-radius:6px; background:#172554; cursor:grab; display:inline-flex; flex-direction:column; justify-content:center; align-items:center; gap:3px">
        <span style="display:block; width:12px; height:2px; background:#bfdbfe; border-radius:999px"></span>
        <span style="display:block; width:12px; height:2px; background:#bfdbfe; border-radius:999px"></span>
        <span style="display:block; width:12px; height:2px; background:#bfdbfe; border-radius:999px"></span>
      </button>
    </td>
    <td style="padding:10px 10px"><input type="text" class="name light-input" style="width:100%; min-width:0; background:transparent; border:none; color:#e2e8f0" value="${p.name || ""}"></td>
    <td style="padding:10px 8px"><input type="text" class="desc light-input" style="width:100%; min-width:0; background:transparent; border:none; color:#94a3b8" value="${editorFields.description}" placeholder="\u89C4\u683C"></td>
    <td style="padding:10px 8px">${createInvoiceLoteInputHtml(editorFields.lote)}</td>
    <td style="padding:10px 8px">
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px">
        <input type="number" class="qty light-input" style="width:100%; min-width:0; text-align:center; background:#0f172a; border:1px solid #334155" value="${qty}" min="1">
        <div class="qty-stock-warning" style="display:none; font-size:12px; color:#ef4444">\u6570\u91CF\u4E0D\u8DB3</div>
      </div>
    </td>
    <td style="padding:10px 8px"><input type="number" class="price light-input" style="width:100%; min-width:0; text-align:center; background:#0f172a; border:1px solid #334155" value="${price.toFixed(2)}" min="0" step="0.01"></td>
    <td style="padding:10px 8px"><input type="text" inputmode="decimal" class="discount light-input" style="width:100%; min-width:0; text-align:center; background:#0f172a; border:1px solid #334155; box-sizing:border-box" value="${discount}" placeholder="0"></td>
    <td class="iva-amt" style="padding:10px 8px; text-align:right; font-family:monospace; color:#94a3b8">${taxAmt.toFixed(2)}</td>
    <td class="amt" style="padding:10px 8px; text-align:right; font-family:monospace; color:#e2e8f0">${total.toFixed(2)}</td>
    <td style="padding:10px 6px; text-align:center"><button type="button" class="btn-red btn-icon" style="width:24px;height:24px;padding:0;font-size:12px">\xD7</button></td>
  `;
  tr.querySelector(".btn-red").addEventListener("click", () => {
    tr.remove();
    updateEditTotal();
    validateEditStockHints();
  });
  const inputs = tr.querySelectorAll("input");
  inputs.forEach((i) => {
    i.addEventListener("focus", function() {
      this.select();
    });
    if (i.classList.contains("qty") || i.classList.contains("price") || i.classList.contains("discount")) {
      i.addEventListener("input", () => {
        const q = parseFloat(tr.querySelector(".qty").value) || 0;
        const pr = parseFloat(tr.querySelector(".price").value) || 0;
        const discount2 = normalizeInvoiceDiscountValue((tr.querySelector(".discount") || {}).value, 0);
        const r = parseFloat(tr.dataset.taxRate) || 0;
        const discountedTotal = getInvoiceDiscountedAmount(q, pr, discount2);
        tr.querySelector(".amt").textContent = discountedTotal.toFixed(2);
        tr.querySelector(".iva-amt").textContent = (discountedTotal * r).toFixed(2);
        updateEditTotal();
        if (i.classList.contains("qty")) validateEditStockHints();
      });
    } else if (i.classList.contains("name") || i.classList.contains("lote")) {
      i.addEventListener("input", () => validateEditStockHints());
    }
  });
  bindInvoiceLoteCombo(tr);
  attachEditItemDragHandlers(tr);
  editItems.appendChild(tr);
  populateInvoiceLoteChoices(tr, p).finally(() => validateEditStockHints());
}
if (editAddItem) {
  editAddItem.addEventListener("click", () => {
    if (!editCustomer.value.trim()) {
      alert("\u8BF7\u5148\u9009\u62E9\u5BA2\u6237");
      return;
    }
    prodSelectorMode = "default";
    window.onProdSelect = (p) => {
      addEditItem({
        ...p,
        qty: 1,
        price: getProductPriceByCustomer(p, currentEditCustomer),
        description: p.spec || p.description || ""
      });
    };
    window.selectedProducts.clear();
    prodSelModal.style.display = "flex";
    prodSelSearch.value = "";
    loadProductSelector();
  });
}
function updateEditTotal() {
  let sub = 0, tax = 0;
  Array.from(editItems.children).forEach((tr) => {
    const q = parseFloat(tr.querySelector(".qty").value) || 0;
    const p = parseFloat(tr.querySelector(".price").value) || 0;
    const discount = normalizeInvoiceDiscountValue((tr.querySelector(".discount") || {}).value, 0);
    const r = parseFloat(tr.dataset.taxRate) || 0;
    const discountedTotal = getInvoiceDiscountedAmount(q, p, discount);
    sub += discountedTotal;
    tax += discountedTotal * r;
  });
  const manualDiscountAmount = getEditManualDiscountAmount(sub + tax);
  document.getElementById("edit-subtotal").textContent = sub.toFixed(2);
  document.getElementById("edit-tax").textContent = tax.toFixed(2);
  const manualDiscountInput = getEditManualDiscountInput();
  if (manualDiscountInput && document.activeElement !== manualDiscountInput) {
    manualDiscountInput.value = manualDiscountAmount.toFixed(2);
  }
  document.getElementById("edit-total").textContent = Math.max(0, sub + tax - manualDiscountAmount).toFixed(2);
}
const editManualDiscountAmountInput = getEditManualDiscountInput();
if (editManualDiscountAmountInput) {
  editManualDiscountAmountInput.addEventListener("focus", function() {
    this.select();
  });
  editManualDiscountAmountInput.addEventListener("input", () => updateEditTotal());
  editManualDiscountAmountInput.addEventListener("blur", () => {
    const subtotal = Number((document.getElementById("edit-subtotal") || {}).textContent || 0);
    const tax = Number((document.getElementById("edit-tax") || {}).textContent || 0);
    editManualDiscountAmountInput.value = getEditManualDiscountAmount(subtotal + tax).toFixed(2);
    updateEditTotal();
  });
}
if (editSave) {
  editSave.addEventListener("click", async () => {
    const id = document.getElementById("edit-id").value;
    const customer = editCustomer.value.trim();
    if (!customer) {
      alert("\u8BF7\u9009\u62E9\u5BA2\u6237");
      return;
    }
    const items = currentEditMode === "daily_order" ? collectDailyOrderItemsFromInvoiceEditor() : [];
    if (currentEditMode !== "daily_order") {
      Array.from(editItems.children).forEach((tr) => {
        var _a2;
        const name = tr.querySelector(".name").value.trim();
        const nameCn = String(tr.dataset.nameCn || "").trim();
        const desc = tr.querySelector(".desc").value.trim();
        const lote = (((_a2 = tr.querySelector(".lote")) == null ? void 0 : _a2.value) || "").trim();
        const qty = parseFloat(tr.querySelector(".qty").value) || 0;
        const price = parseFloat(tr.querySelector(".price").value) || 0;
        const discount = normalizeInvoiceDiscountValue((tr.querySelector(".discount") || {}).value, 0);
        const taxRate = parseFloat(tr.dataset.taxRate) || 0;
        const productId = tr.dataset.productId || "";
        const sku = tr.dataset.sku || "";
        if (name) items.push({ name, name_cn: nameCn, description: desc, lote, qty, price, discount, total: getInvoiceDiscountedAmount(qty, price, discount), tax_rate: taxRate, productId, sku });
      });
    }
    if (items.length === 0) {
      alert("\u8BF7\u81F3\u5C11\u6DFB\u52A0\u4E00\u4E2A\u5546\u54C1");
      return;
    }
    if (currentEditMode !== "daily_order" && !await validateEditStockHints()) return;
    const manualDiscountAmount = getEditManualDiscountAmount(
      Number((document.getElementById("edit-subtotal") || {}).textContent || 0) + Number((document.getElementById("edit-tax") || {}).textContent || 0)
    );
    const originalText = editSave.textContent || (currentEditMode === "daily_order" ? "\u4FDD\u5B58\u8BA2\u5355" : "\u4FDD\u5B58\u4FEE\u6539");
    editSave.disabled = true;
    editSave.textContent = "\u4FDD\u5B58\u4E2D...";
    try {
      if (currentEditMode === "daily_order") {
        const saveDailyOrderEdit = async (allowAutoSupplement = false) => {
          const res = await fetchWithAuth(`/api/daily-orders/${currentEditDailyOrderId || id}`, {
            method: "PUT",
            body: JSON.stringify({
              customer,
              notes: document.getElementById("edit-notes").value,
              items,
              manual_discount_amount: manualDiscountAmount,
              allow_auto_supplement: allowAutoSupplement
            })
          });
          if (res.ok) {
            editModal.style.display = "none";
            showAppToast("\u4FDD\u5B58\u6210\u529F");
            const currentTab = (document.querySelector("#page-daily-orders .tabs .tab.active") || {}).dataset?.tab || "allocated";
            loadDailyOrders(currentTab);
            return;
          }
          const err = await res.json().catch(() => ({}));
          if (err.error === "cannot_edit_shipped") {
            alert("\u5DF2\u53D1\u8D27\u8BA2\u5355\u4E0D\u53EF\u518D\u4FEE\u6539");
            return;
          }
          if (err.error === "insufficient_stock") {
            if (err.auto_supplement_available && !allowAutoSupplement) {
              const confirmed = await openInsufficientStockSupplementConfirm(err);
              if (confirmed) {
                await saveDailyOrderEdit(true);
              }
              return;
            }
            alert(formatInsufficientStockSupplementMessage(err));
            return;
          }
          alert("\u4FDD\u5B58\u5931\u8D25");
        };
        await saveDailyOrderEdit(false);
        return;
      }
        const targetInvoiceType = currentEditConvertedInvoiceNo ? "albaran" : pendingEditInvoiceType || currentEditInvoiceType || "factura";
        const saveInvoiceEdit = async (allowAutoSupplement = false) => {
          const res = await fetchWithAuth(`/api/invoices/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              invoice_type: targetInvoiceType,
              invoice_no: (editInvoiceNo == null ? void 0 : editInvoiceNo.dataset.originalNo) || (editInvoiceNo == null ? void 0 : editInvoiceNo.textContent) || "",
              customer,
              date: document.getElementById("edit-date").value,
              items,
              notes: document.getElementById("edit-notes").value,
              sales: editSales ? editSales.value : "",
              trust_days: parseInt(document.getElementById("edit-trust").value || "30", 10),
              manual_discount_amount: manualDiscountAmount,
              allow_auto_supplement: allowAutoSupplement
            })
          });
          if (res.ok) {
            const saved = await res.json().catch(() => ({}));
            currentEditConvertedInvoiceNo = String((saved == null ? void 0 : saved.converted_invoice_no) || currentEditConvertedInvoiceNo || "").trim();
            const savedType = normalizeSalesInvoiceType((saved == null ? void 0 : saved.invoice_type) || targetInvoiceType);
            editModal.style.display = "none";
            showAppToast("\u4FDD\u5B58\u6210\u529F");
            if (savedType === "factura" && currentInvoiceListType === "albaran") {
              location.hash = "#sales-invoice";
            } else {
              loadInvoices(savedType === "albaran" ? "albaran" : currentInvoiceListType);
            }
            return;
          }
          const err = await res.json().catch(() => ({}));
          if (err.error === "cannot_edit_paid_invoice") {
            alert("\u65E0\u6CD5\u4FEE\u6539\uFF1A\u8BA2\u5355\u5DF2\u5168\u989D\u4ED8\u6B3E");
            return;
          }
          if (err.error === "insufficient_stock") {
            await validateEditStockHints();
            if (err.auto_supplement_available && !allowAutoSupplement) {
              const confirmed = await openInsufficientStockSupplementConfirm(err);
              if (confirmed) {
                await saveInvoiceEdit(true);
              }
              return;
            }
            const detail = formatInsufficientStockSupplementMessage(err);
            showAppToast(detail);
            alert(detail);
            return;
          }
          if (err.error === "not_found") {
            alert("\u8FD9\u5F20\u53D1\u7968\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u5220\u9664");
            return;
          }
          showAppToast("\u4FDD\u5B58\u5931\u8D25");
          alert("\u4FDD\u5B58\u5931\u8D25");
        };
        await saveInvoiceEdit(false);
    } catch (err) {
      showAppToast("\u4FDD\u5B58\u5931\u8D25");
      alert("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    } finally {
      editSave.disabled = false;
      editSave.textContent = originalText;
    }
  });
}
async function loadInvoiceForEdit(id) {
}
if (invRefresh) invRefresh.addEventListener("click", () => {
  invPage = 1;
  loadInvoices("factura");
});
if (invSearch) invSearch.addEventListener("change", () => {
  invPage = 1;
  loadInvoices("factura");
});
if (albRefresh) albRefresh.addEventListener("click", () => {
  invPage = 1;
  loadInvoices("albaran");
});
if (albSearch) albSearch.addEventListener("change", () => {
  invPage = 1;
  loadInvoices("albaran");
});
async function route() {
  return handleRoute();
}
let initialRouteStarted = false;
function startInitialRoute() {
  if (initialRouteStarted) return;
  initialRouteStarted = true;
  setTimeout(() => route(), 0);
}
document.querySelectorAll(".nav a").forEach((a) => {
  a.addEventListener("click", () => setTimeout(() => handleRoute(), 0));
});
initPersist();
setAuthUI();
syncAuthLocaleFromUser();
apiAccountsList().then(() => {
  if (typeof refreshAccountOptions === "function") refreshAccountOptions();
  if (((location.hash || "#home") === "#accounts") && typeof renderAccounts === "function") renderAccounts();
});
window.addEventListener("resize", updateLedgerHeaderCover);
(_c = document.getElementById("partner-orders-back")) == null ? void 0 : _c.addEventListener("click", () => {
  location.hash = "#contacts";
});
renderContacts();
refreshLedgerTypeOptions();
setCategories();
(function initPageByHash() {
  const h = location.hash || "#home";
  const isPayables = h === "#payables";
  const gp = document.getElementById("global-pager");
  if (!isPayables && gp) gp.style.display = "none";
})();
accAdd == null ? void 0 : accAdd.addEventListener("click", () => {
  const modal = document.getElementById("acc-create-modal");
  resetAccCreateForm();
  if (modal) modal.style.display = "flex";
});
function showAccCreate() {
  const modal = document.getElementById("acc-create-modal");
  resetAccCreateForm();
  if (modal) modal.style.display = "flex";
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest("#acc-add");
  if (!btn) return;
  const modal = document.getElementById("acc-create-modal");
  resetAccCreateForm();
  if (modal) modal.style.display = "flex";
  e.preventDefault();
});
const systemLanguageSelect = document.getElementById("system-language");
const systemLedgerForceEditToggle = document.getElementById("system-ledger-force-edit-toggle");
const systemPayablesForceEditToggle = document.getElementById("system-payables-force-edit-toggle");
const financialEditOverrideDefaults = Object.freeze({
  ledger_force_edit_enabled: false,
  payables_force_edit_enabled: false,
  can_manage: false
});
let financialEditOverrideSettings = { ...financialEditOverrideDefaults };
let financialEditOverrideSettingsLoaded = false;
function syncLocaleSelectorValues(locale) {
  const nextLocale = normalizeAppLocale(locale);
  if (systemLanguageSelect) systemLanguageSelect.value = nextLocale;
  setAuthLanguageToggleValue(nextLocale);
}
function refreshLocaleSensitiveUI(locale) {
  const nextLocale = normalizeAppLocale(locale);
  if (typeof window.setAppLocale === "function") window.setAppLocale(nextLocale);
  syncPayablesLocale();
  syncProductionPlanLocale();
  syncLedgerLocale();
  updateTopProductionReviewAlert(productionPendingCount);
  updateTopOrderActionAlert(dailyOrderActionPendingTotal);
  syncLocaleSelectorValues(nextLocale);
  setAuthUI();
}
async function saveCurrentUserLocale(locale) {
  const prevLocale = getResolvedAppLocale();
  const nextLocale = normalizeAppLocale(locale);
  refreshLocaleSensitiveUI(nextLocale);
  const savedLocale = await apiUpdateMyLocale(nextLocale);
  if (!savedLocale) {
    refreshLocaleSensitiveUI(prevLocale);
    alert("\u8BED\u8A00\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25");
    return null;
  }
  const authUser = getAuthUser();
  if (authUser) setAuthUser({ ...authUser, locale: savedLocale });
  refreshLocaleSensitiveUI(savedLocale);
  return savedLocale;
}
async function loadSystemLanguageSettings() {
  syncLocaleSelectorValues(getResolvedAppLocale());
}
function normalizeFinancialEditOverrideSettings(data) {
  const source = data && typeof data === "object" ? data : {};
  const currentUserName = String(((getAuthUser() || {}).name) || "").trim();
  return {
    ledger_force_edit_enabled: !!source.ledger_force_edit_enabled,
    payables_force_edit_enabled: !!source.payables_force_edit_enabled,
    can_manage: !!source.can_manage || currentUserName === "aaaaaa"
  };
}
function isFinancialEditOverrideManager() {
  const currentUserName = String(((getAuthUser() || {}).name) || "").trim();
  return currentUserName === "aaaaaa" || !!financialEditOverrideSettings.can_manage;
}
function renderFinancialEditOverrideToggle(button, enabled, canManage, loadingText = "") {
  if (!button) return;
  button.disabled = !canManage || !!loadingText;
  button.textContent = loadingText || (enabled ? "开" : "关");
  button.className = `setting-toggle ${enabled ? "is-on" : "is-off"}`;
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
  button.title = enabled ? "已开启，点击关闭" : "已关闭，点击开启";
  button.style.opacity = !canManage && !loadingText ? "0.7" : "1";
}
function renderFinancialEditOverrideControls() {
  const canManage = isFinancialEditOverrideManager();
  renderFinancialEditOverrideToggle(systemLedgerForceEditToggle, !!financialEditOverrideSettings.ledger_force_edit_enabled, canManage);
  renderFinancialEditOverrideToggle(systemPayablesForceEditToggle, !!financialEditOverrideSettings.payables_force_edit_enabled, canManage);
}
async function loadFinancialEditOverrideSettings(force = false) {
  if (financialEditOverrideSettingsLoaded && !force) {
    renderFinancialEditOverrideControls();
    return financialEditOverrideSettings;
  }
  try {
    const data = await apiFetchJSON("/api/system/financial-edit-overrides");
    financialEditOverrideSettings = normalizeFinancialEditOverrideSettings(data);
    financialEditOverrideSettingsLoaded = true;
  } catch (e) {
    const currentUserName = String(((getAuthUser() || {}).name) || "").trim();
    financialEditOverrideSettings = {
      ...financialEditOverrideDefaults,
      can_manage: currentUserName === "aaaaaa"
    };
    financialEditOverrideSettingsLoaded = false;
  }
  renderFinancialEditOverrideControls();
  return financialEditOverrideSettings;
}
async function updateFinancialEditOverrideSettings(nextSettings, loadingKey = "") {
  const previous = { ...financialEditOverrideSettings };
  financialEditOverrideSettings = normalizeFinancialEditOverrideSettings(nextSettings);
  financialEditOverrideSettings.can_manage = previous.can_manage;
  renderFinancialEditOverrideControls();
  if (loadingKey === "ledger") renderFinancialEditOverrideToggle(systemLedgerForceEditToggle, !!financialEditOverrideSettings.ledger_force_edit_enabled, true, "保存中...");
  if (loadingKey === "payables") renderFinancialEditOverrideToggle(systemPayablesForceEditToggle, !!financialEditOverrideSettings.payables_force_edit_enabled, true, "保存中...");
  try {
    const data = await apiFetchJSON("/api/system/financial-edit-overrides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ledger_force_edit_enabled: !!financialEditOverrideSettings.ledger_force_edit_enabled,
        payables_force_edit_enabled: !!financialEditOverrideSettings.payables_force_edit_enabled
      })
    });
    financialEditOverrideSettings = normalizeFinancialEditOverrideSettings(data);
    financialEditOverrideSettingsLoaded = true;
    renderFinancialEditOverrideControls();
    if ((document.getElementById("page-ledger") || {}).style.display === "block") loadLedgerFromServer(true);
    if ((document.getElementById("page-payables") || {}).style.display === "block") loadPayablesFromServer();
    return true;
  } catch (e) {
    financialEditOverrideSettings = previous;
    renderFinancialEditOverrideControls();
    alert("保存失败，请重试");
    return false;
  }
}
function canCurrentUserForceEditFinancialModule(moduleName) {
  const currentUser = String(((getAuthUser() || {}).name) || "").trim();
  if (currentUser !== "aaaaaa") return false;
  if (String(moduleName || "").trim() === "ledger") return !!financialEditOverrideSettings.ledger_force_edit_enabled;
  if (String(moduleName || "").trim() === "payables") return !!financialEditOverrideSettings.payables_force_edit_enabled;
  return false;
}
systemLanguageSelect == null ? void 0 : systemLanguageSelect.addEventListener("change", async () => {
  await saveCurrentUserLocale(systemLanguageSelect.value);
});
authLanguageButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const nextLocale = normalizeAppLocale(btn.dataset.locale || "zh-CN");
    if (nextLocale === getResolvedAppLocale()) return;
    await saveCurrentUserLocale(nextLocale);
  });
});
systemLedgerForceEditToggle == null ? void 0 : systemLedgerForceEditToggle.addEventListener("click", async () => {
  if (!isFinancialEditOverrideManager()) return;
  await updateFinancialEditOverrideSettings({
    ...financialEditOverrideSettings,
    ledger_force_edit_enabled: !financialEditOverrideSettings.ledger_force_edit_enabled
  }, "ledger");
});
systemPayablesForceEditToggle == null ? void 0 : systemPayablesForceEditToggle.addEventListener("click", async () => {
  if (!isFinancialEditOverrideManager()) return;
  await updateFinancialEditOverrideSettings({
    ...financialEditOverrideSettings,
    payables_force_edit_enabled: !financialEditOverrideSettings.payables_force_edit_enabled
  }, "payables");
});
async function loadCompanyInfo() {
  try {
    const data = await apiFetchJSON("/api/company-info");
    if (data) {
      document.getElementById("ci-name").value = data.name || "";
      document.getElementById("ci-tax").value = data.tax_id || "";
      document.getElementById("ci-phone").value = data.phone || "";
      document.getElementById("ci-email").value = data.email || "";
      document.getElementById("ci-street").value = data.street || "";
      document.getElementById("ci-zip").value = data.zip || "";
      document.getElementById("ci-city").value = data.city || "";
      document.getElementById("ci-country").value = data.country || "";
      document.getElementById("ci-bank").value = data.bank_name || "";
      document.getElementById("ci-iban").value = data.iban || "";
      document.getElementById("ci-swift").value = data.swift || "";
    }
  } catch (e) {
  }
  syncCompanyInfoAccess();
}
function canEditCompanyInfo() {
  const u = getAuthUser();
  const roleName = (u == null ? void 0 : u.role) || getUserRoleName((u == null ? void 0 : u.name) || "");
  return roleName === "\u8D85\u7EA7\u7BA1\u7406\u5458";
}
function syncCompanyInfoAccess() {
  const readOnly = !canEditCompanyInfo();
  ["ci-name", "ci-tax", "ci-phone", "ci-email", "ci-street", "ci-zip", "ci-city", "ci-country", "ci-bank", "ci-iban", "ci-swift"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.readOnly = readOnly;
  });
  const saveBtn = document.querySelector('#company-info-form button[type="submit"]');
  if (saveBtn) saveBtn.style.display = readOnly ? "none" : "";
}
const companyInfoForm = document.getElementById("company-info-form");
if (companyInfoForm) {
  companyInfoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById("ci-name").value.trim(),
      tax_id: document.getElementById("ci-tax").value.trim(),
      phone: document.getElementById("ci-phone").value.trim(),
      email: document.getElementById("ci-email").value.trim(),
      street: document.getElementById("ci-street").value.trim(),
      zip: document.getElementById("ci-zip").value.trim(),
      city: document.getElementById("ci-city").value.trim(),
      country: document.getElementById("ci-country").value.trim(),
      bank_name: document.getElementById("ci-bank").value.trim(),
      iban: document.getElementById("ci-iban").value.trim(),
      swift: document.getElementById("ci-swift").value.trim()
    };
    try {
      await apiFetchJSON("/api/company-info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      alert("\u516C\u53F8\u4FE1\u606F\u5DF2\u4FDD\u5B58");
    } catch (e2) {
      alert("\u4FDD\u5B58\u5931\u8D25");
    }
  });
}
accAdd == null ? void 0 : accAdd.addEventListener("click", () => {
  const modal = document.getElementById("acc-create-modal");
  resetAccCreateForm();
  if (modal) modal.style.display = "flex";
});
function showAccCreate() {
  const modal = document.getElementById("acc-create-modal");
  resetAccCreateForm();
  if (modal) modal.style.display = "flex";
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest("#acc-add");
  if (!btn) return;
  const modal = document.getElementById("acc-create-modal");
  resetAccCreateForm();
  if (modal) modal.style.display = "flex";
  e.preventDefault();
});
let prodPage = 1;
let prodTotal = 0;
const prodPageSize = 50;
const prodSearch = document.getElementById("prod-search");
const prodExport = document.getElementById("prod-export");
const prodRefresh = document.getElementById("prod-refresh");
const prodAdd = document.getElementById("prod-add");
const prodRows = document.getElementById("prod-rows");
const prodPager = document.getElementById("prod-pager");
const prodModal = document.getElementById("product-modal");
const prodForm = document.getElementById("prod-form");
const prodCancel = document.getElementById("prod-cancel");
const prodPrev = document.getElementById("prod-prev");
const prodNext = document.getElementById("prod-next");
const prodFile = document.getElementById("prod-file");
const prodFileName = document.getElementById("prod-file-name");
const prodPreview = document.getElementById("prod-preview");
const prodPrintSmallLabelRow = document.getElementById("prod-print-small-label-row");
const prodPrintSmallLabelEnabled = document.getElementById("prod-print-small-label-enabled");
const prodPrintSmallLabelCopies = document.getElementById("prod-print-small-label-copies");
const prodPrintLargeLabelRow = document.getElementById("prod-print-large-label-row");
const prodPrintLargeLabelEnabled = document.getElementById("prod-print-large-label-enabled");
const prodPrintLargeLabelCopies = document.getElementById("prod-print-large-label-copies");
const prodRawMaterialId = document.getElementById("prod-raw-material-id");
const prodRawMaterialName = document.getElementById("prod-raw-material-name");
const prodDividendUsersWrap = document.getElementById("prod-dividend-users");
const appToast = document.getElementById("app-toast");
const appToastText = document.getElementById("app-toast-text");
let productDividendUserOptions = [];
let currentProductPageList = [];
let exportingProducts = false;
const prodExportDefaultText = prodExport ? String(prodExport.textContent || "导出excel") : "导出excel";
const PRODUCT_PRINT_PREFS_CACHE_KEY = "product_print_prefs_cache_v1";
let currentProductModalIndex = -1;
let currentProductModalStandaloneEdit = false;
let productRawMaterialSelectActive = false;
let appToastTimer = null;
let productPrintPrefsCache = {};
function loadProductPrintPrefsCache() {
  try {
    const raw = localStorage.getItem(PRODUCT_PRINT_PREFS_CACHE_KEY) || "";
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}
function saveProductPrintPrefsCache() {
  try {
    localStorage.setItem(PRODUCT_PRINT_PREFS_CACHE_KEY, JSON.stringify(productPrintPrefsCache || {}));
  } catch (e) {
  }
}
function readProductPrintFlag(source, key, fallback = false) {
  if (!source || typeof source !== "object") return fallback;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  return !!source[key];
}
function readProductPrintCopies(source, key, fallback = 1) {
  if (!source || typeof source !== "object") return fallback;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return fallback;
  const raw = Number(source[key] || 0);
  return raw > 0 ? Math.max(1, Math.round(raw)) : 0;
}
function mergeProductPrintPrefs(product) {
  const source = product && typeof product === "object" ? product : {};
  const productId = Number(source.id || 0);
  const cached = productId > 0 ? productPrintPrefsCache[String(productId)] || {} : {};
  return {
    ...source,
    print_small_label_enabled: readProductPrintFlag(source, "print_small_label_enabled", readProductPrintFlag(cached, "print_small_label_enabled", false)),
    print_small_label_copies: readProductPrintCopies(source, "print_small_label_copies", readProductPrintCopies(cached, "print_small_label_copies", 1)),
    print_large_label_enabled: readProductPrintFlag(source, "print_large_label_enabled", readProductPrintFlag(cached, "print_large_label_enabled", false)),
    print_large_label_copies: readProductPrintCopies(source, "print_large_label_copies", readProductPrintCopies(cached, "print_large_label_copies", 1))
  };
}
function updateProductPrintPrefsCache(productId, prefs = {}) {
  const id = Number(productId || 0);
  if (id <= 0) return;
  productPrintPrefsCache[String(id)] = {
    print_small_label_enabled: !!prefs.print_small_label_enabled,
    print_small_label_copies: prefs.print_small_label_enabled ? Math.max(1, parseInt(prefs.print_small_label_copies, 10) || 1) : 0,
    print_large_label_enabled: !!prefs.print_large_label_enabled,
    print_large_label_copies: prefs.print_large_label_enabled ? Math.max(1, parseInt(prefs.print_large_label_copies, 10) || 1) : 0
  };
  saveProductPrintPrefsCache();
}
productPrintPrefsCache = loadProductPrintPrefsCache();
const salesStatsStart = document.getElementById("sales-stats-start");
const salesStatsEnd = document.getElementById("sales-stats-end");
const salesStatsSearch = document.getElementById("sales-stats-search");
const salesStatsDividendUserWrap = document.getElementById("sales-stats-dividend-user-wrap");
const salesStatsDividendUser = document.getElementById("sales-stats-dividend-user");
const salesStatsRefresh = document.getElementById("sales-stats-refresh");
const salesStatsRows = document.getElementById("sales-stats-rows");
const salesStatsSummary = document.getElementById("sales-stats-summary");
const salesStatsHeadRow = document.getElementById("sales-stats-head-row");
let salesStatsDividendUsersLoaded = false;
function formatMoney(val) {
  return Number(val || 0).toFixed(2);
}
function formatOptionalMoney(val) {
  if (val === void 0 || val === null || val === "") return "-";
  const num = Number(val);
  if (!Number.isFinite(num) || num === 0) return "-";
  return num.toFixed(2);
}
function showAppToast(message = "\u4FDD\u5B58\u6210\u529F\uFF01") {
  if (!appToast || !appToastText) return;
  appToastText.textContent = message;
  appToast.style.display = "flex";
  if (appToastTimer) clearTimeout(appToastTimer);
  requestAnimationFrame(() => appToast.classList.add("show"));
  appToastTimer = setTimeout(() => {
    appToast.classList.remove("show");
    setTimeout(() => {
      if (!appToast.classList.contains("show")) appToast.style.display = "none";
    }, 220);
  }, 1800);
}
function updateTopProductionReviewAlert(count = 0) {
  productionPendingCount = Number(count || 0);
  const alertBtn = document.getElementById("top-production-review-alert");
  const badge = document.getElementById("top-production-review-alert-badge");
  const alertText = document.getElementById("top-production-review-alert-text");
  if (!alertBtn || !badge) return;
  const canViewReview = typeof can !== "function" ? true : can("production_review", "view");
  if (alertText) alertText.textContent = getCurrentAppLocale() === "es-ES" ? "Revisar" : "\u65B0\u751F\u4EA7\u9700\u8981\u5BA1\u6838";
  badge.textContent = String(productionPendingCount);
  alertBtn.style.display = canViewReview && productionPendingCount > 0 ? "inline-flex" : "none";
}
window.updateTopProductionReviewAlert = updateTopProductionReviewAlert;
function updateTopOrderActionAlert(count = 0) {
  dailyOrderActionPendingTotal = Number(count || 0) || 0;
  const alertBtn = document.getElementById("top-order-action-alert");
  const badge = document.getElementById("top-order-action-alert-badge");
  const alertText = document.getElementById("top-order-action-alert-text");
  const alertSubtext = document.getElementById("top-order-action-alert-subtext");
  if (!alertBtn || !badge || !alertText || !alertSubtext)
    return;
  const breakdown = formatDailyOrderPendingBreakdown(dailyOrderActionPendingCounts);
  alertText.textContent = breakdown || (getCurrentAppLocale() === "es-ES" ? "0 operaciones" : "0个可配货");
  alertSubtext.textContent = "";
  alertSubtext.style.display = "none";
  badge.textContent = String(dailyOrderActionPendingTotal);
  alertBtn.style.display = dailyOrderActionPendingTotal > 0 ? "inline-flex" : "none";
}
window.updateTopOrderActionAlert = updateTopOrderActionAlert;
function openDailyOrderActionCenter() {
  if (location.hash !== "#daily-orders") {
    location.hash = "#daily-orders";
    return;
  }
  const page = document.getElementById("page-daily-orders");
  if (page)
    page.style.display = "block";
}
window.openDailyOrderActionCenter = openDailyOrderActionCenter;
function openProductionReviewCenter() {
  pendingFinishedStockTab = "review";
  if (location.hash !== "#finished-stock") {
    location.hash = "#finished-stock";
    return;
  }
  const page = document.getElementById("page-finished-stock");
  if (page) page.style.display = "block";
  switchFinishedStockTab("review", document.getElementById("fs-tab-review"));
}
window.openProductionReviewCenter = openProductionReviewCenter;
function normalizeDividendUsers(val) {
  if (Array.isArray(val)) return val.map((v) => String(v || "").trim()).filter(Boolean);
  if (typeof val === "string") {
    const text = val.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map((v) => String(v || "").trim()).filter(Boolean) : [];
    } catch (e) {
      return text.split(",").map((v) => String(v || "").trim()).filter(Boolean);
    }
  }
  return [];
}
function isDividendProduct(item) {
  return normalizeDividendUsers(item == null ? void 0 : item.dividend_users).length > 0 || !!(item == null ? void 0 : item.dividend_enabled);
}
function isAssignedSalesStatsView() {
  const u = getAuthUser();
  const roleName = (u == null ? void 0 : u.role) || getUserRoleName((u == null ? void 0 : u.name) || "");
  return roleName !== "\u8D85\u7EA7\u7BA1\u7406\u5458" && can("sales_stats", "assigned_only");
}
async function ensureProductDividendUsersLoaded() {
  if (productDividendUserOptions.length) return productDividendUserOptions;
  try {
    const list = await apiFetchJSON("/api/auth/users");
    productDividendUserOptions = (Array.isArray(list) ? list : []).map((x) => ({ name: String(x.name || "").trim(), role: String(x.role || "").trim() })).filter((x) => x.name);
  } catch (e) {
    productDividendUserOptions = [];
  }
  return productDividendUserOptions;
}
function renderProductDividendUsers(selectedNames = []) {
  if (!prodDividendUsersWrap) return;
  const selectedSet = new Set((Array.isArray(selectedNames) ? selectedNames : []).map((v) => String(v || "").trim()).filter(Boolean));
  const merged = [...productDividendUserOptions];
  selectedSet.forEach((name) => {
    if (!merged.some((user) => user.name === name)) merged.push({ name, role: "\u5DF2\u505C\u7528/\u7F3A\u5931" });
  });
  if (!merged.length) {
    prodDividendUsersWrap.innerHTML = '<div style="color:#64748b; font-size:12px">\u6682\u65E0\u53EF\u9009\u8D26\u53F7</div>';
    return;
  }
  prodDividendUsersWrap.innerHTML = merged.map((user) => `
    <label style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border:1px solid #334155; border-radius:8px; background:#0f172a; color:#e2e8f0; font-size:12px; cursor:pointer">
      <input type="checkbox" class="prod-dividend-user" value="${escapeHtml(user.name)}" ${selectedSet.has(user.name) ? "checked" : ""}>
      <span>${escapeHtml(user.name)}</span>
      <span style="color:#64748b">${escapeHtml(user.role || "")}</span>
    </label>
  `).join("");
}
if (prodFile) {
  prodFile.addEventListener("change", () => {
    const file = prodFile.files[0];
    if (file) {
      prodFileName.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (e) => {
        document.getElementById("prod-image").value = e.target.result;
        prodPreview.src = e.target.result;
        prodPreview.style.display = "block";
      };
      reader.readAsDataURL(file);
    } else {
      prodFileName.textContent = "\u672A\u9009\u62E9\u6587\u4EF6";
      prodPreview.style.display = "none";
    }
  });
}
async function loadProducts() {
  if (!prodRows) return;
  const q = ((prodSearch == null ? void 0 : prodSearch.value) || "").trim();
  const res = await fetchWithAuth(`/api/products?page=${prodPage}&size=${prodPageSize}&q=${encodeURIComponent(q)}`);
  if (res.ok) {
    const data = await res.json();
    const list = Array.isArray(data.list) ? data.list.map((item) => mergeProductPrintPrefs(item)) : [];
    currentProductPageList = list;
    prodTotal = data.total || 0;
    renderProducts(list);
    renderProdPager();
  }
}
async function fetchAllProductsForExport(q = "") {
  const keyword = String(q || "").trim();
  const pageSize = 500;
  let page = 1;
  let total = 0;
  const all = [];
  do {
    const res = await fetchWithAuth(`/api/products?page=${page}&size=${pageSize}&q=${encodeURIComponent(keyword)}`);
    if (!res.ok) throw new Error("load_failed");
    const data = await res.json();
    const list = Array.isArray(data == null ? void 0 : data.list) ? data.list : [];
    total = Math.max(0, Number((data == null ? void 0 : data.total) || 0));
    all.push(...list);
    if (!list.length) break;
    page += 1;
  } while (all.length < total);
  return all;
}
function downloadBlobFile(blob, fileName) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setProductExportLoading(loading) {
  if (!prodExport) return;
  prodExport.disabled = !!loading;
  prodExport.textContent = loading ? "导出中..." : prodExportDefaultText;
}
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });
}
async function convertImageSourceToThumbnailDataUrl(src, maxSize = 40) {
  const img = await loadImageElement(src);
  const naturalWidth = Math.max(1, Number(img.naturalWidth || img.width || 1));
  const naturalHeight = Math.max(1, Number(img.naturalHeight || img.height || 1));
  const scale = Math.min(maxSize / naturalWidth, maxSize / naturalHeight, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_failed");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
async function getExcelImageData(src) {
  const raw = String(src || "").trim();
  if (!raw) return null;
  if (/^data:image\//i.test(raw)) {
    return { base64: await convertImageSourceToThumbnailDataUrl(raw), extension: "png" };
  }
  const imageUrl = new URL(raw, window.location.href).href;
  const res = await fetch(imageUrl, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("image_fetch_failed");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    return { base64: await convertImageSourceToThumbnailDataUrl(objectUrl), extension: "png" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
async function mapWithConcurrency(list, limit, mapper) {
  const items = Array.isArray(list) ? list : [];
  const size = Math.max(1, Number(limit) || 1);
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await mapper(items[index], index);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(size, items.length || 0); i += 1) workers.push(worker());
  await Promise.all(workers);
  return result;
}
function styleProductExportCell(cell, alignment = {}) {
  cell.border = {
    top: { style: "thin", color: { argb: "CBD5E1" } },
    left: { style: "thin", color: { argb: "CBD5E1" } },
    bottom: { style: "thin", color: { argb: "CBD5E1" } },
    right: { style: "thin", color: { argb: "CBD5E1" } }
  };
  cell.alignment = Object.assign({ vertical: "middle", horizontal: "left", wrapText: false }, alignment || {});
  cell.font = { name: "Arial", size: 11 };
}
async function exportProductsToWorkbook(rows = []) {
  if (typeof ExcelJS === "undefined" || !ExcelJS.Workbook) throw new Error("exceljs_missing");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ThreeSquirrels";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("商品列表", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = [
    { header: "图片", key: "image", width: 12 },
    { header: "货号", key: "sku", width: 18 },
    { header: "名称", key: "name", width: 28 },
    { header: "中文名称", key: "nameCn", width: 28 },
    { header: "规格", key: "spec", width: 22 },
    { header: "价格1", key: "price1", width: 12 },
    { header: "价格2", key: "price2", width: 12 }
  ];
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    styleProductExportCell(cell, { horizontal: "center" });
    cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "0F172A" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "E2E8F0" }
    };
  });
  rows.forEach((item) => {
    const row = sheet.addRow({
      image: "",
      sku: String(item.sku || ""),
      name: String(item.name || ""),
      nameCn: String(item.name_cn || ""),
      spec: String(item.spec || ""),
      price1: Number(item.price1 || 0),
      price2: Number(item.price2 || 0)
    });
    row.height = 42;
    row.eachCell((cell, colNumber) => {
      styleProductExportCell(cell, colNumber === 1 ? { horizontal: "center" } : {});
      if (colNumber === 6 || colNumber === 7) cell.numFmt = "0.00";
    });
  });
  const imageRows = await mapWithConcurrency(rows, 8, async (item) => {
    try {
      return item && item.image ? await getExcelImageData(item.image) : null;
    } catch (e) {
      return null;
    }
  });
  imageRows.forEach((imageData, index) => {
    if (!imageData) return;
    const imageId = workbook.addImage(imageData);
    const rowIndex = index + 1;
    sheet.addImage(imageId, {
      tl: { col: 0.15, row: rowIndex + 0.12 },
      ext: { width: 38, height: 38 },
      editAs: "oneCell"
    });
  });
  return workbook;
}
async function chooseProductExportTarget(fileName) {
  if (typeof window.showSaveFilePicker !== "function") return null;
  try {
    return await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{
        description: "Excel 文件",
        accept: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
        }
      }]
    });
  } catch (e) {
    if (e && e.name === "AbortError") return "aborted";
    throw e;
  }
}
async function saveProductWorkbookBuffer(buffer, fileName, targetHandle) {
  const normalizedBuffer = buffer instanceof Uint8Array ? buffer : buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  if (targetHandle && targetHandle !== "aborted") {
    const writable = await targetHandle.createWritable();
    await writable.write(normalizedBuffer);
    await writable.close();
    return;
  }
  downloadBlobFile(new Blob([normalizedBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
}
async function exportProductsExcel() {
  if (exportingProducts) return;
  if (!window.confirm("确认导出当前商品列表为 Excel 吗？")) return;
  const now = new Date();
  const fileName = `商品列表-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}.xlsx`;
  const exportTarget = await chooseProductExportTarget(fileName);
  if (exportTarget === "aborted") return;
  exportingProducts = true;
  setProductExportLoading(true);
  try {
    const q = ((prodSearch == null ? void 0 : prodSearch.value) || "").trim();
    const rows = await fetchAllProductsForExport(q);
    if (!rows.length) {
      alert("当前没有可导出的商品数据");
      return;
    }
    const workbook = await exportProductsToWorkbook(rows);
    const buffer = await workbook.xlsx.writeBuffer();
    await saveProductWorkbookBuffer(buffer, fileName, exportTarget);
    showAppToast("商品列表已导出");
  } catch (e) {
    alert("导出 Excel 失败");
  } finally {
    exportingProducts = false;
    setProductExportLoading(false);
  }
}
function renderProducts(list) {
  prodRows.innerHTML = "";
  if (list.length === 0) {
    prodRows.innerHTML = '<tr class="empty"><td colspan="17">\u6682\u65E0\u5546\u54C1\u6570\u636E</td></tr>';
    return;
  }
  list.forEach((x, idx) => {
    const displayIndex = prodTotal - (prodPage - 1) * prodPageSize - idx;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${displayIndex}</td>
      <td style="padding:0; width:50px; height:50px">${x.image ? `<img src="${x.image}" class="thumb-img" onclick="showFileViewer('${x.image}')" style="width:100%; height:100%; object-fit:contain; display:block">` : ""}</td>
      <td>${x.sku || ""}</td>
      <td>${x.barcode || ""}</td>
      <td>${x.name || ""}</td>
      <td>${x.name_cn || ""}</td>
      <td>${x.spec || ""}</td>
      <td>${formatOptionalMoney(x.price1)}</td>
      <td>${formatOptionalMoney(x.price2)}</td>
      <td>${formatOptionalMoney(x.cost_price)}</td>
      <td>${isDividendProduct(x) ? "\u662F" : "-"}</td>
      <td>${Number(x.stock || 0)}</td>
      <td>
        <div style="display:flex; align-items:center; justify-content:center; gap:8px">
          <button class="btn-icon-outline-blue prod-edit-btn" style="width:32px; min-width:32px; height:32px; border-radius:8px; margin:0" title="\u7F16\u8F91\u5546\u54C1">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
          </button>
          <button class="btn-icon-outline-red prod-del-btn" style="width:32px; min-width:32px; height:32px; border-radius:8px; margin:0" title="\u5220\u9664\u5546\u54C1">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </td>
    `;
    const editBtn = tr.querySelector(".prod-edit-btn");
    const delBtn = tr.querySelector(".prod-del-btn");
    editBtn.addEventListener("click", () => openProdModal(x, idx));
    delBtn.addEventListener("click", () => deleteProduct(x));
    prodRows.appendChild(tr);
  });
}
function renderProdPager() {
  if (!prodPager) return;
  prodPager.innerHTML = "";
  const totalPages = Math.ceil(prodTotal / prodPageSize);
  if (totalPages <= 1) return;
  const createBtn = (text, page, disabled = false) => {
    const btn = document.createElement("button");
    btn.className = "light-btn";
    btn.textContent = text;
    btn.disabled = disabled;
    if (page === prodPage) btn.style.background = "#0b1524";
    else btn.addEventListener("click", () => {
      prodPage = page;
      loadProducts();
    });
    return btn;
  };
  prodPager.appendChild(createBtn("\u4E0A\u4E00\u9875", prodPage - 1, prodPage <= 1));
  const span = document.createElement("span");
  span.style.padding = "8px";
  span.textContent = `${prodPage} / ${totalPages}`;
  prodPager.appendChild(span);
  prodPager.appendChild(createBtn("\u4E0B\u4E00\u9875", prodPage + 1, prodPage >= totalPages));
}
function updateProductModalNav() {
  const total = currentProductPageList.length;
  const canNavigate = currentProductModalIndex >= 0;
  const subtitle = document.getElementById("prod-modal-subtitle");
  if (subtitle) {
    subtitle.textContent = currentProductModalStandaloneEdit ? "\u5F53\u524D\u5546\u54C1\u8BE6\u60C5\uFF0C\u53EF\u76F4\u63A5\u4FEE\u6539\u63D0\u9192\u6570\u91CF\u7B49\u4FE1\u606F" : canNavigate ? `\u5F53\u524D\u9875\u7B2C ${currentProductModalIndex + 1} / ${total} \u4E2A\u5546\u54C1\uFF0C\u53EF\u76F4\u63A5\u8FDE\u7EED\u5207\u6362` : "\u65B0\u589E\u5546\u54C1";
  }
  if (prodPrev) {
    prodPrev.disabled = !canNavigate || currentProductModalIndex <= 0;
    prodPrev.style.display = currentProductModalStandaloneEdit ? "none" : "inline-flex";
  }
  if (prodNext) {
    prodNext.disabled = !canNavigate || currentProductModalIndex < 0 || currentProductModalIndex >= total - 1;
    prodNext.style.display = currentProductModalStandaloneEdit ? "none" : "inline-flex";
  }
}
function setProductRawMaterialSelection(material = null) {
  const materialId = Number((material == null ? void 0 : material.id) || 0);
  const materialName = String((material == null ? void 0 : material.name) || "").trim();
  if (prodRawMaterialId) prodRawMaterialId.value = materialId > 0 ? String(materialId) : "";
  if (prodRawMaterialName) prodRawMaterialName.value = materialName;
}
function syncProductPrintCopyInputState() {
  if (prodPrintSmallLabelCopies) {
    const smallEnabled = !!(prodPrintSmallLabelEnabled == null ? void 0 : prodPrintSmallLabelEnabled.checked);
    prodPrintSmallLabelCopies.disabled = !smallEnabled;
    if (smallEnabled) {
      const nextValue = Math.max(1, parseInt(prodPrintSmallLabelCopies.value, 10) || 1);
      prodPrintSmallLabelCopies.value = String(nextValue);
    } else {
      prodPrintSmallLabelCopies.value = "1";
    }
  }
  if (prodPrintLargeLabelCopies) {
    const largeEnabled = !!(prodPrintLargeLabelEnabled == null ? void 0 : prodPrintLargeLabelEnabled.checked);
    prodPrintLargeLabelCopies.disabled = !largeEnabled;
    if (largeEnabled) {
      const nextValue = Math.max(1, parseInt(prodPrintLargeLabelCopies.value, 10) || 1);
      prodPrintLargeLabelCopies.value = String(nextValue);
    } else {
      prodPrintLargeLabelCopies.value = "1";
    }
  }
}
function bindProductPrintToggleRow(rowEl, checkboxEl, copiesEl) {
  if (!rowEl || !checkboxEl) return;
  rowEl.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target === checkboxEl || target === copiesEl) return;
      if (copiesEl && copiesEl.contains(target)) return;
      if (target.closest("label")) return;
    }
    checkboxEl.checked = !checkboxEl.checked;
    syncProductPrintCopyInputState();
  });
}
window.openProductRawMaterialSelector = function() {
  if (!rsSelModal) return;
  productRawMaterialSelectActive = true;
  productionPlanMaterialSelectTargetId = 0;
  window.selectedRawMaterials = /* @__PURE__ */ new Map();
  const selectedId = Number((prodRawMaterialId == null ? void 0 : prodRawMaterialId.value) || 0);
  const selectedName = String((prodRawMaterialName == null ? void 0 : prodRawMaterialName.value) || "").trim();
  if (selectedId > 0 || selectedName) {
    window.selectedRawMaterials.set(selectedId || Date.now(), {
      id: selectedId || 0,
      name: selectedName
    });
  }
  if (rsSelTitle) rsSelTitle.textContent = "\u9009\u62E9\u539F\u6750\u6599";
  if (rsSelConfirm) rsSelConfirm.textContent = "\u786E\u8BA4\u9009\u62E9";
  if (rsSelSearch) rsSelSearch.value = "";
  rsSelModal.style.display = "flex";
  loadRawMaterialSelector(1);
};
async function openProdModal(x, listIndex = -1) {
  if (!prodModal) return;
  productRawMaterialSelectActive = false;
  const nextProduct = x ? mergeProductPrintPrefs(x) : null;
  const isEdit = !!nextProduct;
  currentProductModalStandaloneEdit = isEdit && listIndex < 0;
  currentProductModalIndex = isEdit && listIndex >= 0 ? listIndex : -1;
  const stockInput = document.getElementById("prod-stock");
  document.getElementById("prod-modal-title").textContent = isEdit ? "\u7F16\u8F91\u5546\u54C1" : "\u65B0\u589E\u5546\u54C1";
  document.getElementById("prod-id").value = isEdit ? nextProduct.id : "";
  document.getElementById("prod-sku").value = (nextProduct == null ? void 0 : nextProduct.sku) || "";
  document.getElementById("prod-barcode").value = (nextProduct == null ? void 0 : nextProduct.barcode) || "";
  document.getElementById("prod-name").value = (nextProduct == null ? void 0 : nextProduct.name) || "";
  document.getElementById("prod-name-cn").value = (nextProduct == null ? void 0 : nextProduct.name_cn) || "";
  document.getElementById("prod-spec").value = (nextProduct == null ? void 0 : nextProduct.spec) || "";
  document.getElementById("prod-created-at").value = (nextProduct == null ? void 0 : nextProduct.created_at) ? formatDisplayDateTimeValue(Number(nextProduct.created_at)) : "";
  document.getElementById("prod-tax").value = (nextProduct == null ? void 0 : nextProduct.tax_rate) || "10";
  document.getElementById("prod-p1").value = (nextProduct == null ? void 0 : nextProduct.price1) || "";
  document.getElementById("prod-p2").value = (nextProduct == null ? void 0 : nextProduct.price2) || "";
  document.getElementById("prod-p3").value = (nextProduct == null ? void 0 : nextProduct.price3) || "";
  document.getElementById("prod-p4").value = (nextProduct == null ? void 0 : nextProduct.price4) || "";
  document.getElementById("prod-cost").value = (nextProduct == null ? void 0 : nextProduct.cost_price) || "";
  document.getElementById("prod-weight-kg").value = (nextProduct == null ? void 0 : nextProduct.weight_kg) || "";
  document.getElementById("prod-stock").value = (nextProduct == null ? void 0 : nextProduct.stock) || "0";
  document.getElementById("prod-remind-stock").value = Math.max(0, Number((nextProduct == null ? void 0 : nextProduct.remind_stock) || 0));
  setProductRawMaterialSelection({
    id: Number((nextProduct == null ? void 0 : nextProduct.raw_material_id) || 0),
    name: (nextProduct == null ? void 0 : nextProduct.raw_material_name) || ""
  });
  await ensureProductDividendUsersLoaded();
  renderProductDividendUsers(normalizeDividendUsers(nextProduct == null ? void 0 : nextProduct.dividend_users));
  if (stockInput) {
    stockInput.readOnly = true;
    stockInput.title = "\u5E93\u5B58\u8BF7\u5728\u5546\u54C1\u5E93\u5B58\u9875\u9762\u8C03\u6574";
  }
  document.getElementById("prod-image").value = (nextProduct == null ? void 0 : nextProduct.image) || "";
  document.getElementById("prod-desc").value = (nextProduct == null ? void 0 : nextProduct.description) || "";
  document.getElementById("prod-notes").value = (nextProduct == null ? void 0 : nextProduct.notes) || "";
  document.getElementById("prod-product-code").value = (nextProduct == null ? void 0 : nextProduct.product_code) || "";
  document.getElementById("prod-ingredients").value = (nextProduct == null ? void 0 : nextProduct.ingredients) || "";
  document.getElementById("prod-nutrition").value = (nextProduct == null ? void 0 : nextProduct.nutrition_facts) || "";
  document.getElementById("prod-allergens").value = (nextProduct == null ? void 0 : nextProduct.allergens) || "";
  document.getElementById("prod-print-label-enabled").checked = (nextProduct == null ? void 0 : nextProduct.print_label_enabled) !== false;
  if (prodPrintSmallLabelEnabled) prodPrintSmallLabelEnabled.checked = !!(nextProduct == null ? void 0 : nextProduct.print_small_label_enabled);
  if (prodPrintSmallLabelCopies) prodPrintSmallLabelCopies.value = String(Math.max(1, parseInt((nextProduct == null ? void 0 : nextProduct.print_small_label_copies) || 1, 10) || 1));
  if (prodPrintLargeLabelEnabled) prodPrintLargeLabelEnabled.checked = !!(nextProduct == null ? void 0 : nextProduct.print_large_label_enabled);
  if (prodPrintLargeLabelCopies) prodPrintLargeLabelCopies.value = String(Math.max(1, parseInt((nextProduct == null ? void 0 : nextProduct.print_large_label_copies) || 1, 10) || 1));
  syncProductPrintCopyInputState();
  if (prodFile) prodFile.value = "";
  if (nextProduct == null ? void 0 : nextProduct.image) {
    prodPreview.src = nextProduct.image;
    prodPreview.style.display = "block";
    prodFileName.textContent = "\u5DF2\u4E0A\u4F20\u56FE\u7247";
  } else {
    prodPreview.style.display = "none";
    prodFileName.textContent = "\u672A\u9009\u62E9\u6587\u4EF6";
  }
  document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  document.querySelectorAll(".invalid-label").forEach((el) => el.classList.remove("invalid-label"));
  updateProductModalNav();
  prodModal.style.display = "flex";
}
async function openProdModalFromFinishedStock(encodedProduct) {
  if (!can("sales_products", "edit")) {
    alert("\u5F53\u524D\u89D2\u8272\u65E0\u5546\u54C1\u7F16\u8F91\u6743\u9650");
    return;
  }
  try {
    const product = JSON.parse(decodeURIComponent(String(encodedProduct || "")));
    await openProdModal(product, -1);
  } catch (e) {
    console.error(e);
    alert("\u5546\u54C1\u8BE6\u60C5\u6253\u5F00\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
}
async function deleteProduct(x) {
  if (!confirm("\u786E\u5B9A\u5220\u9664\u8BE5\u5546\u54C1\u5417\uFF1F")) return;
  const res = await fetchWithAuth(`/api/products/${x.id}`, { method: "DELETE" });
  if (res.ok) {
    loadProducts();
  } else {
    alert("\u5220\u9664\u5931\u8D25");
  }
}
if (prodAdd) prodAdd.addEventListener("click", () => openProdModal(null));
if (prodCancel) prodCancel.addEventListener("click", () => prodModal.style.display = "none");
if (prodPrev) prodPrev.addEventListener("click", async () => {
  if (currentProductModalIndex <= 0) return;
  await openProdModal(currentProductPageList[currentProductModalIndex - 1], currentProductModalIndex - 1);
});
if (prodNext) prodNext.addEventListener("click", async () => {
  if (currentProductModalIndex < 0 || currentProductModalIndex >= currentProductPageList.length - 1) return;
  await openProdModal(currentProductPageList[currentProductModalIndex + 1], currentProductModalIndex + 1);
});
if (prodRefresh) prodRefresh.addEventListener("click", () => {
  prodPage = 1;
  loadProducts();
});
if (prodExport) prodExport.addEventListener("click", exportProductsExcel);
if (prodSearch) prodSearch.addEventListener("change", () => {
  prodPage = 1;
  loadProducts();
});
bindProductPrintToggleRow(prodPrintSmallLabelRow, prodPrintSmallLabelEnabled, prodPrintSmallLabelCopies);
bindProductPrintToggleRow(prodPrintLargeLabelRow, prodPrintLargeLabelEnabled, prodPrintLargeLabelCopies);
if (prodPrintSmallLabelEnabled) prodPrintSmallLabelEnabled.addEventListener("change", syncProductPrintCopyInputState);
if (prodPrintLargeLabelEnabled) prodPrintLargeLabelEnabled.addEventListener("change", syncProductPrintCopyInputState);
if (prodPrintSmallLabelCopies) prodPrintSmallLabelCopies.addEventListener("change", syncProductPrintCopyInputState);
if (prodPrintLargeLabelCopies) prodPrintLargeLabelCopies.addEventListener("change", syncProductPrintCopyInputState);
if (prodForm) {
  prodForm.addEventListener("submit", async (e) => {
    var _a2;
    e.preventDefault();
    const reqFields = [
      { id: "prod-sku", label: "\u8D27\u53F7" },
      { id: "prod-name", label: "\u5546\u54C1\u540D\u79F0" },
      { id: "prod-p1", label: "\u4EF7\u683C1" },
      { id: "prod-tax", label: "\u7A0E\u7387" }
    ];
    let hasError = false;
    reqFields.forEach((f) => {
      const el = document.getElementById(f.id);
      const val = (el.value || "").trim();
      const label = el.parentElement.querySelector(".label");
      el.classList.remove("invalid");
      if (label) label.classList.remove("invalid-label");
      if (!val) {
        hasError = true;
        el.classList.add("invalid");
        if (label) label.classList.add("invalid-label");
      }
    });
    if (hasError) return;
    const btn = document.getElementById("prod-save-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "\u4FDD\u5B58\u4E2D...";
    }
    try {
      const id = document.getElementById("prod-id").value;
      let imageUrl = document.getElementById("prod-image").value;
      const fileObj = prodFile.files[0];
      if (fileObj) {
        const fd = new FormData();
        fd.append("file", fileObj);
        try {
          const token = getAuthToken();
          const r = await fetch(API_BASE + "/api/upload", {
            method: "POST",
            headers: token ? { "Authorization": "Bearer " + token } : {},
            body: fd
          });
          if (r.ok) {
            const d = await r.json();
            imageUrl = d.url;
          } else {
            alert("\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
            if (btn) {
              btn.disabled = false;
              btn.textContent = "\u4FDD\u5B58";
            }
            return;
          }
        } catch (e2) {
          console.warn("product image upload failed", e2);
          alert("\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC");
          if (btn) {
            btn.disabled = false;
            btn.textContent = "\u4FDD\u5B58";
          }
          return;
        }
      }
      const dividendUsers = Array.from(document.querySelectorAll(".prod-dividend-user:checked")).map((el) => String(el.value || "").trim()).filter(Boolean);
      const rawMaterialId = Math.max(0, Number((prodRawMaterialId == null ? void 0 : prodRawMaterialId.value) || 0));
      const rawMaterialName = String((prodRawMaterialName == null ? void 0 : prodRawMaterialName.value) || "").trim();
      const printSmallLabelEnabled = !!(prodPrintSmallLabelEnabled == null ? void 0 : prodPrintSmallLabelEnabled.checked);
      const printSmallLabelCopies = printSmallLabelEnabled ? Math.max(1, parseInt((prodPrintSmallLabelCopies == null ? void 0 : prodPrintSmallLabelCopies.value) || "1", 10) || 1) : 0;
      const printLargeLabelEnabled = !!(prodPrintLargeLabelEnabled == null ? void 0 : prodPrintLargeLabelEnabled.checked);
      const printLargeLabelCopies = printLargeLabelEnabled ? Math.max(1, parseInt((prodPrintLargeLabelCopies == null ? void 0 : prodPrintLargeLabelCopies.value) || "1", 10) || 1) : 0;
      const data = {
        sku: document.getElementById("prod-sku").value,
        barcode: document.getElementById("prod-barcode").value,
        name: document.getElementById("prod-name").value,
        name_cn: document.getElementById("prod-name-cn").value,
        spec: document.getElementById("prod-spec").value,
        tax_rate: document.getElementById("prod-tax").value,
        price1: document.getElementById("prod-p1").value,
        price2: document.getElementById("prod-p2").value,
        price3: document.getElementById("prod-p3").value,
        price4: document.getElementById("prod-p4").value,
        cost_price: document.getElementById("prod-cost").value,
        weight_kg: Math.max(0, Number(document.getElementById("prod-weight-kg").value || 0)),
        dividend_enabled: dividendUsers.length > 0,
        dividend_users: dividendUsers,
        stock: id ? document.getElementById("prod-stock").value || "0" : "0",
        remind_stock: Math.max(0, Number(document.getElementById("prod-remind-stock").value || 0)),
        raw_material_id: rawMaterialId || null,
        raw_material_name: rawMaterialName,
        image: imageUrl,
        description: document.getElementById("prod-desc").value,
        notes: document.getElementById("prod-notes").value,
        product_code: document.getElementById("prod-product-code").value,
        ingredients: document.getElementById("prod-ingredients").value,
        nutrition_facts: document.getElementById("prod-nutrition").value,
        allergens: document.getElementById("prod-allergens").value,
        print_label_enabled: !!document.getElementById("prod-print-label-enabled").checked,
        print_small_label_enabled: printSmallLabelEnabled,
        print_small_label_copies: printSmallLabelCopies,
        print_large_label_enabled: printLargeLabelEnabled,
        print_large_label_copies: printLargeLabelCopies
      };
      const url = id ? `/api/products/${id}` : "/api/products";
      const method = id ? "PUT" : "POST";
      const res = await fetchWithAuth(url, {
        method,
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) {
        const savedPayload = await res.json().catch(() => ({}));
        const savedProductId = Number((savedPayload == null ? void 0 : savedPayload.id) || id || 0);
        updateProductPrintPrefsCache(savedProductId, {
          print_small_label_enabled: printSmallLabelEnabled,
          print_small_label_copies: printSmallLabelCopies,
          print_large_label_enabled: printLargeLabelEnabled,
          print_large_label_copies: printLargeLabelCopies
        });
        await loadProducts();
        if (((_a2 = document.getElementById("page-finished-stock")) == null ? void 0 : _a2.style.display) === "block") {
          await loadFinishedStock(fsPage);
        }
        salesStatsDividendUsersLoaded = false;
        if (id) {
          const savedId = Number(id);
          const refreshedIndex = currentProductPageList.findIndex((item) => Number((item == null ? void 0 : item.id) || 0) === savedId);
          if (refreshedIndex >= 0) {
            await openProdModal(currentProductPageList[refreshedIndex], refreshedIndex);
          }
        } else {
          document.getElementById("prod-id").value = "";
        }
        showAppToast("\u4FDD\u5B58\u6210\u529F\uFF01");
      } else {
        try {
          const err = await res.json();
          if (err.error === "duplicate_sku") alert("\u8D27\u53F7\u5DF2\u5B58\u5728");
          else alert("\u4FDD\u5B58\u5931\u8D25\uFF1A" + (err.error || "\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5"));
        } catch (e2) {
          alert("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
        }
      }
    } catch (e2) {
      console.error(e2);
      alert("\u4FDD\u5B58\u51FA\u9519: " + e2.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "\u4FDD\u5B58";
      }
    }
  });
}
function initSalesStatsFilters() {
  const now = /* @__PURE__ */ new Date();
  const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  if (salesStatsStart && !salesStatsStart.value) salesStatsStart.value = start;
  if (salesStatsEnd && !salesStatsEnd.value) salesStatsEnd.value = end;
}
function renderSalesStatsSummary(summary = {}, total = 0) {
  if (!salesStatsSummary) return;
  const assignedView = isAssignedSalesStatsView();
  const selectedDividendUser = String((salesStatsDividendUser == null ? void 0 : salesStatsDividendUser.value) || "").trim();
  const cards = assignedView || selectedDividendUser ? [
    { label: "\u5546\u54C1\u6570", value: String(total || 0) },
    { label: "\u9500\u552E\u91CF", value: String(Number(summary.qty || 0)) }
  ] : [
    { label: "\u5546\u54C1\u6570", value: String(total || 0) },
    { label: "\u603B\u9500\u91CF", value: String(Number(summary.qty || 0)) },
    { label: "\u672A\u7A0E\u9500\u552E\u989D", value: formatMoney(summary.sales_amount) },
    { label: "\u7A0E\u989D", value: formatMoney(summary.tax_amount) },
    { label: "\u603B\u6210\u672C", value: formatMoney(summary.cost_amount) },
    { label: "\u603B\u5229\u6DA6", value: formatMoney(summary.profit_amount) }
  ];
  salesStatsSummary.style.gridTemplateColumns = assignedView || selectedDividendUser ? "repeat(2,minmax(140px,220px))" : "repeat(6,minmax(120px,1fr))";
  salesStatsSummary.innerHTML = cards.map((card) => `
    <div style="background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:14px 16px">
      <div style="font-size:12px; color:#94a3b8">${card.label}</div>
      <div style="margin-top:6px; font-size:20px; font-weight:700; color:#e2e8f0">${card.value}</div>
    </div>
  `).join("");
}
async function ensureSalesStatsDividendUsersLoaded() {
  if (!salesStatsDividendUser || salesStatsDividendUsersLoaded) return;
  if (isAssignedSalesStatsView()) {
    salesStatsDividendUsersLoaded = true;
    salesStatsDividendUser.innerHTML = '<option value="">\u5168\u90E8</option>';
    return;
  }
  try {
    const data = await apiFetchJSON("/api/sales-stats/dividend-users");
    const list = Array.isArray(data == null ? void 0 : data.list) ? data.list : [];
    const currentValue = String(salesStatsDividendUser.value || "");
    salesStatsDividendUser.innerHTML = `<option value="">\u5168\u90E8</option>` + list.map((name) => `
      <option value="${escapeHtml(name)}">${escapeHtml(name)}</option>
    `).join("");
    if (list.includes(currentValue)) salesStatsDividendUser.value = currentValue;
    salesStatsDividendUsersLoaded = true;
  } catch (e) {
    salesStatsDividendUser.innerHTML = '<option value="">\u5168\u90E8</option>';
  }
}
function renderSalesStatsLayout() {
  const assignedView = isAssignedSalesStatsView();
  if (salesStatsDividendUserWrap) salesStatsDividendUserWrap.style.display = assignedView ? "none" : "flex";
  if (salesStatsHeadRow) {
    salesStatsHeadRow.innerHTML = assignedView ? `
      <th>\u5E8F\u53F7</th>
      <th>\u8D27\u53F7</th>
      <th>\u540D\u79F0</th>
      <th>\u4E2D\u6587\u540D\u79F0</th>
      <th>\u89C4\u683C</th>
      <th>\u5206\u7EA2\u5546\u54C1</th>
      <th>\u9500\u91CF</th>
      <th>\u53D1\u7968\u6570</th>
    ` : `
      <th>\u5E8F\u53F7</th>
      <th>\u8D27\u53F7</th>
      <th>\u540D\u79F0</th>
      <th>\u4E2D\u6587\u540D\u79F0</th>
      <th>\u89C4\u683C</th>
      <th>\u5206\u7EA2\u5546\u54C1</th>
      <th>\u9500\u91CF</th>
      <th>\u9500\u552E\u989D(\u672A\u7A0E)</th>
      <th>\u7A0E\u989D</th>
      <th>\u9500\u552E\u989D(\u542B\u7A0E)</th>
      <th>\u6210\u672C\u4EF7</th>
      <th>\u6210\u672C\u5408\u8BA1</th>
      <th>\u5229\u6DA6</th>
      <th>\u53D1\u7968\u6570</th>
    `;
  }
}
function renderSalesStats(list = []) {
  if (!salesStatsRows) return;
  const assignedView = isAssignedSalesStatsView();
  if (!list.length) {
    salesStatsRows.innerHTML = `<tr class="empty"><td colspan="${assignedView ? 8 : 14}">\u6682\u65E0\u7EDF\u8BA1\u6570\u636E</td></tr>`;
    return;
  }
  salesStatsRows.innerHTML = list.map((x, idx) => assignedView ? `
    <tr>
      <td>${idx + 1}</td>
      <td>${x.sku || ""}</td>
      <td>${x.name || ""}</td>
      <td>${x.name_cn || ""}</td>
      <td>${x.spec || ""}</td>
      <td>${isDividendProduct(x) ? "\u662F" : "\u5426"}</td>
      <td>${Number(x.sales_qty || 0)}</td>
      <td>${Number(x.invoice_count || 0)}</td>
    </tr>
  ` : `
    <tr>
      <td>${idx + 1}</td>
      <td>${x.sku || ""}</td>
      <td>${x.name || ""}</td>
      <td>${x.name_cn || ""}</td>
      <td>${x.spec || ""}</td>
      <td>${isDividendProduct(x) ? "\u662F" : "\u5426"}</td>
      <td>${Number(x.sales_qty || 0)}</td>
      <td>${formatMoney(x.sales_amount)}</td>
      <td>${formatMoney(x.tax_amount)}</td>
      <td>${formatMoney(x.gross_amount)}</td>
      <td>${formatMoney(x.cost_price)}</td>
      <td>${formatMoney(x.cost_amount)}</td>
      <td style="color:${Number(x.profit_amount || 0) >= 0 ? "#22c55e" : "#ef4444"}; font-weight:600">${formatMoney(x.profit_amount)}</td>
      <td>${Number(x.invoice_count || 0)}</td>
    </tr>
  `).join("");
}
async function loadSalesStats() {
  var _a2;
  if (!salesStatsRows) return;
  initSalesStatsFilters();
  renderSalesStatsLayout();
  await ensureSalesStatsDividendUsersLoaded();
  salesStatsRows.innerHTML = `<tr class="empty"><td colspan="${isAssignedSalesStatsView() ? 8 : 14}">\u52A0\u8F7D\u4E2D...</td></tr>`;
  const params = new URLSearchParams({
    start: (salesStatsStart == null ? void 0 : salesStatsStart.value) || "",
    end: (salesStatsEnd == null ? void 0 : salesStatsEnd.value) || "",
    q: ((_a2 = salesStatsSearch == null ? void 0 : salesStatsSearch.value) == null ? void 0 : _a2.trim()) || "",
    dividend_user: isAssignedSalesStatsView() ? "" : (salesStatsDividendUser == null ? void 0 : salesStatsDividendUser.value) || ""
  });
  const res = await fetchWithAuth(`/api/sales-stats/products?${params.toString()}`);
  if (!res.ok) {
    salesStatsRows.innerHTML = `<tr class="empty"><td colspan="${isAssignedSalesStatsView() ? 8 : 14}">\u52A0\u8F7D\u5931\u8D25</td></tr>`;
    return;
  }
  const data = await res.json();
  renderSalesStatsSummary(data.summary || {}, data.total || 0);
  renderSalesStats(data.list || []);
}
salesStatsRefresh == null ? void 0 : salesStatsRefresh.addEventListener("click", () => loadSalesStats());
salesStatsSearch == null ? void 0 : salesStatsSearch.addEventListener("change", () => loadSalesStats());
salesStatsDividendUser == null ? void 0 : salesStatsDividendUser.addEventListener("change", () => loadSalesStats());
salesStatsStart == null ? void 0 : salesStatsStart.addEventListener("change", () => loadSalesStats());
salesStatsEnd == null ? void 0 : salesStatsEnd.addEventListener("change", () => loadSalesStats());
let pendingDeleteNoteId = null;
let pendingDeleteNoteIdx = null;
let pendingDeleteNoteContactId = null;
const noteDeleteModal = document.getElementById("note-delete-modal");
const noteDeleteOk = document.getElementById("note-delete-ok");
const noteDeleteCancel = document.getElementById("note-delete-cancel");
if (noteDeleteCancel) {
  noteDeleteCancel.addEventListener("click", () => {
    noteDeleteModal.style.display = "none";
    pendingDeleteNoteId = null;
    pendingDeleteNoteIdx = null;
    pendingDeleteNoteContactId = null;
  });
}
if (noteDeleteOk) {
  noteDeleteOk.addEventListener("click", async () => {
    if (pendingDeleteNoteContactId) {
      try {
        await apiFetchJSON(`/api/contacts/notes/${pendingDeleteNoteId}`, { method: "DELETE" });
        loadContactNotes(pendingDeleteNoteContactId);
      } catch (e) {
        alert("\u5220\u9664\u5931\u8D25");
      }
    } else {
      if (pendingDeleteNoteIdx !== null) {
        tempContactNotes.splice(pendingDeleteNoteIdx, 1);
        loadContactNotes(null);
      }
    }
    noteDeleteModal.style.display = "none";
    pendingDeleteNoteId = null;
    pendingDeleteNoteIdx = null;
    pendingDeleteNoteContactId = null;
  });
}
async function loadContactNotes(id) {
  const rows2 = document.getElementById("ct-notes-rows");
  rows2.innerHTML = '<tr><td colspan="4" style="padding:12px; text-align:center; color:#64748b">\u52A0\u8F7D\u4E2D...</td></tr>';
  let list = [];
  if (id) {
    try {
      list = await apiFetchJSON(`/api/contacts/${id}/notes`);
    } catch (e) {
      console.error(e);
      rows2.innerHTML = '<tr class="empty"><td colspan="4" style="padding:12px; text-align:center; color:#ef4444">\u52A0\u8F7D\u5931\u8D25</td></tr>';
      return;
    }
  } else {
    list = tempContactNotes;
  }
  rows2.innerHTML = "";
  if (list.length === 0) {
    rows2.innerHTML = '<tr class="empty"><td colspan="4" style="padding:12px; text-align:center; color:#64748b">\u6682\u65E0\u5907\u6CE8</td></tr>';
    return;
  }
  list.forEach((n, idx) => {
    const tr = document.createElement("tr");
    const d = new Date(Number(n.created_at));
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    tr.innerHTML = `
      <td style="padding:8px; white-space:pre-wrap; vertical-align:top">${String(n.note || "")}</td>
      <td style="padding:8px; vertical-align:top">${String(n.created_by || "")}</td>
      <td style="padding:8px; vertical-align:top">${dateStr}</td>
      <td style="padding:8px; text-align:center; vertical-align:top; display:flex; gap:4px; justify-content:center">
        <button class="btn-icon btn-blue" style="width:24px; height:24px; font-size:12px; display:flex; align-items:center; justify-content:center">\u270E</button>
        <button class="btn-icon btn-red" style="width:24px; height:24px; font-size:12px; display:flex; align-items:center; justify-content:center">\xD7</button>
      </td>
    `;
    tr.querySelector(".btn-blue").addEventListener("click", () => {
      editingNoteId = id ? n.id : idx;
      document.getElementById("ct-note-text").value = n.note || "";
      document.getElementById("ct-note-input-area").style.display = "flex";
      document.getElementById("ct-note-text").focus();
    });
    tr.querySelector(".btn-red").addEventListener("click", () => {
      pendingDeleteNoteId = id ? n.id : null;
      pendingDeleteNoteIdx = idx;
      pendingDeleteNoteContactId = id;
      document.getElementById("note-delete-modal").style.display = "flex";
    });
    rows2.appendChild(tr);
  });
}
const btnNew = document.getElementById("ct-note-new-btn");
if (btnNew) btnNew.onclick = () => {
  editingNoteId = null;
  document.getElementById("ct-note-input-area").style.display = "flex";
  document.getElementById("ct-note-text").value = "";
  document.getElementById("ct-note-text").focus();
};
const btnCancel = document.getElementById("ct-note-cancel");
if (btnCancel) btnCancel.onclick = () => {
  editingNoteId = null;
  document.getElementById("ct-note-input-area").style.display = "none";
  document.getElementById("ct-note-text").value = "";
};
const btnSave = document.getElementById("ct-note-save");
if (btnSave) btnSave.onclick = async () => {
  const id = document.getElementById("ct-id").value;
  const note = document.getElementById("ct-note-text").value.trim();
  if (!note) {
    alert("\u8BF7\u8F93\u5165\u5907\u6CE8\u5185\u5BB9");
    return;
  }
  if (id) {
    try {
      if (editingNoteId) {
        await apiFetchJSON(`/api/contacts/notes/${editingNoteId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note })
        });
      } else {
        await apiFetchJSON(`/api/contacts/${id}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note })
        });
      }
      editingNoteId = null;
      document.getElementById("ct-note-text").value = "";
      document.getElementById("ct-note-input-area").style.display = "none";
      loadContactNotes(id);
    } catch (e) {
      alert("\u4FDD\u5B58\u5931\u8D25");
    }
  } else {
    const user = getAuthUser();
    if (editingNoteId !== null) {
      if (tempContactNotes[editingNoteId]) {
        tempContactNotes[editingNoteId].note = note;
      }
    } else {
      tempContactNotes.push({
        note,
        created_at: Date.now(),
        created_by: user ? user.name : "Unknown"
      });
    }
    editingNoteId = null;
    document.getElementById("ct-note-text").value = "";
    document.getElementById("ct-note-input-area").style.display = "none";
    loadContactNotes(null);
  }
};
const shipPrevModal = document.getElementById("shipping-preview-modal");
const shipContent = document.getElementById("ship-content");
const shipPrevPrint = document.getElementById("ship-prev-print");
const shipPrevExportPdf = document.getElementById("ship-prev-export-pdf");
const shipPrevClose = document.getElementById("ship-prev-close");
let currentShippingInvId = null;
let currentShippingLabelNo = "";
let shippingPrintPageStyle = null;
let shippingPrintFrame = null;
function setShippingPrintPage(enabled) {
  if (enabled) {
    if (shippingPrintPageStyle) return;
    shippingPrintPageStyle = document.createElement("style");
    shippingPrintPageStyle.id = "shipping-print-page-style";
    shippingPrintPageStyle.textContent = "@media print { @page { size: A4 landscape; margin: 0; } html, body { width: 297mm !important; height: 210mm !important; } }";
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
  const fits = (fontSize) => {
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
  const paper = document.getElementById("shipping-paper");
  if (!paper || !shipContent) return;
  const stackEl = shipContent.querySelector(".s-stack");
  shipContent.style.transform = "scale(1)";
  shipContent.style.transformOrigin = "center center";
  const addressEl = shipContent.querySelector(".s-address");
  const cityEl = shipContent.querySelector(".s-city");
  const metaEls = Array.from(shipContent.querySelectorAll(".s-meta"));
  const phoneEl = shipContent.querySelector(".s-phone");
  const contactEl = shipContent.querySelector(".s-contact");
  fitShippingText(addressEl, 72, 24, 4);
  fitShippingText(cityEl, 58, 24, 2);
  metaEls.forEach((el) => fitShippingText(el, 40, 18, 3));
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
  return parts.map((x) => String(x || "").trim()).filter(Boolean).join(" ");
}
function buildShippingLabelHtml(data) {
  const companyLine = shippingLabelText(data.company || data.name || "");
  const addressLine = shippingLabelText(data.address);
  const cityLine = shippingLabelText(data.zip, data.city);
  const regionLine = shippingLabelText(data.province, data.country);
  const phoneLine = data.phone ? `Tel: ${String(data.phone).trim()}` : "";
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
  return `<div class="s-stack">${blocks.join("")}</div>`;
}
function buildShippingPrintHtml(invNo) {
  const contentHtml = shipContent ? shipContent.innerHTML : "";
  const safeTitle = `Etiqueta-${invNo}`.replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  <\/script>
</body>
</html>`;
}
function printShippingLabelDocument(invNo) {
  if (shippingPrintFrame) {
    shippingPrintFrame.remove();
    shippingPrintFrame = null;
  }
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
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
      } catch (e) {
      }
      setTimeout(cleanup, 4e3);
    }, 150);
  };
}
if (shipPrevClose) {
  shipPrevClose.addEventListener("click", () => {
    if (shipPrevModal) shipPrevModal.style.display = "none";
  });
}
if (shipPrevPrint) {
  shipPrevPrint.addEventListener("click", async () => {
    let invNo = "";
    if (currentShippingLabelNo) invNo = currentShippingLabelNo;
    if (currentShippingInvId) {
      const inv = currentInvoices.find((x) => String(x.id) === String(currentShippingInvId));
      if (inv) invNo = inv.invoice_no;
    }
    invNo = invNo || "ShippingLabel";
    invNo = invNo.trim().replace(/\s+/g, "");
    fitShippingLabel();
    setTimeout(async () => {
      printShippingLabelDocument(invNo);
      if (currentShippingInvId) {
        const inv = currentInvoices.find((x) => String(x.id) === String(currentShippingInvId));
        if (inv && !inv.shipping_printed) {
          try {
            await apiFetchJSON(`/api/invoices/${currentShippingInvId}/print-shipping`, { method: "PUT" });
            inv.shipping_printed = true;
            loadInvoices(currentInvoiceListType);
          } catch (e) {
          }
        }
      }
    }, 100);
  });
}
if (shipPrevExportPdf) {
  shipPrevExportPdf.addEventListener("click", async () => {
    try {
      let invNo = "";
      if (currentShippingLabelNo) invNo = currentShippingLabelNo;
      if (currentShippingInvId) {
        const inv = currentInvoices.find((x) => String(x.id) === String(currentShippingInvId));
        if (inv) invNo = inv.invoice_no;
      }
      invNo = (invNo || "ShippingLabel").trim().replace(/\s+/g, "");
      fitShippingLabel();
      await exportHtmlPdfToDesktop(buildShippingPrintHtml(invNo), `Etiqueta-${invNo}`);
      if (currentShippingInvId) {
        const inv = currentInvoices.find((x) => String(x.id) === String(currentShippingInvId));
        if (inv && !inv.shipping_printed) {
          try {
            await apiFetchJSON(`/api/invoices/${currentShippingInvId}/print-shipping`, { method: "PUT" });
            inv.shipping_printed = true;
            loadInvoices(currentInvoiceListType);
          } catch (e) {
          }
        }
      }
    } catch (e) {
      alert((e == null ? void 0 : e.message) || "导出PDF失败");
    }
  });
}
window.printShippingLabel = async function(id) {
  currentShippingInvId = id;
  currentShippingLabelNo = "";
  const inv = currentInvoices.find((x) => String(x.id) === String(id));
  if (!inv) return;
  try {
    await ensureRealContactsLoaded();
  } catch (e) {
  }
  let cust = null;
  try {
    cust = await getInvoiceCustomerContact(inv.customer);
  } catch (e) {
  }
  let name = String(inv.customer || "").trim();
  let company = String(inv.company_name || "").trim();
  let address = String(inv.customer_address || "").trim();
  let zip = String(inv.customer_zip || "").trim();
  let city = String(inv.customer_city || "").trim();
  let province = "";
  let country = String(inv.customer_country || "").trim();
  let phone = "";
  let contact = "";
  if (cust) {
    const defaultShip = getDefaultContactShippingAddress(cust) || null;
    name = String(cust.name || "").trim() || name;
    company = String(cust.company || "").trim() || company || name;
    address = String((defaultShip == null ? void 0 : defaultShip.address) || cust.ship_address || "").trim() || address || String(cust.address || "").trim();
    zip = String((defaultShip == null ? void 0 : defaultShip.zip) || cust.ship_zip || "").trim() || zip || String(cust.zip || "").trim();
    city = String((defaultShip == null ? void 0 : defaultShip.city) || cust.ship_city || "").trim() || city || String(cust.city || "").trim();
    province = String((defaultShip == null ? void 0 : defaultShip.province) || cust.ship_province || "").trim() || province || String(cust.province || "").trim();
    country = String((defaultShip == null ? void 0 : defaultShip.country) || cust.ship_country || "").trim() || country || String(cust.country || "").trim();
    phone = String((defaultShip == null ? void 0 : defaultShip.phone) || cust.ship_phone || "").trim() || phone || String(cust.phone || "").trim();
    contact = String((defaultShip == null ? void 0 : defaultShip.contact) || cust.ship_contact || "").trim() || contact || String(cust.contact || "").trim();
  }
  company = company || name;
  const html = buildShippingLabelHtml({ name, company, address, zip, city, province, country, phone, contact });
  if (shipContent) shipContent.innerHTML = html;
  requestAnimationFrame(() => fitShippingLabel());
  if (shipPrevModal) shipPrevModal.style.display = "flex";
};
window.printDailyOrderShippingLabel = async function(id) {
  currentShippingInvId = null;
  const order = currentDailyOrders.find((x) => String((x == null ? void 0 : x.id) || "") === String(id || ""));
  if (!order) return;
  try {
    await ensureRealContactsLoaded();
  } catch (e) {
  }
  let cust = null;
  try {
    cust = await getInvoiceCustomerContact(order.customer);
  } catch (e) {
  }
  const fallbackCustomer = getDailyOrderCustomerInfo(String(order.customer || "").trim()) || null;
  let name = String(order.customer || "").trim();
  let company = "";
  let address = "";
  let zip = "";
  let city = "";
  let province = "";
  let country = "";
  let phone = "";
  let contact = "";
  if (cust || fallbackCustomer) {
    const source = cust || fallbackCustomer;
    const defaultShip = getDefaultContactShippingAddress(source) || null;
    name = String(source.name || "").trim() || name;
    company = String(source.company || "").trim() || company || name;
    address = String((defaultShip == null ? void 0 : defaultShip.address) || source.ship_address || "").trim() || address || String(source.address || "").trim();
    zip = String((defaultShip == null ? void 0 : defaultShip.zip) || source.ship_zip || "").trim() || zip || String(source.zip || "").trim();
    city = String((defaultShip == null ? void 0 : defaultShip.city) || source.ship_city || "").trim() || city || String(source.city || "").trim();
    province = String((defaultShip == null ? void 0 : defaultShip.province) || source.ship_province || "").trim() || province || String(source.province || "").trim();
    country = String((defaultShip == null ? void 0 : defaultShip.country) || source.ship_country || "").trim() || country || String(source.country || "").trim();
    phone = String((defaultShip == null ? void 0 : defaultShip.phone) || source.ship_phone || "").trim() || phone || String(source.phone || "").trim();
    contact = String((defaultShip == null ? void 0 : defaultShip.contact) || source.ship_contact || "").trim() || contact || String(source.contact || "").trim();
  }
  company = company || name;
  currentShippingLabelNo = String(order.order_no || order.invoice_no || order.customer || `order-${id}`).trim().replace(/\s+/g, "");
  const html = buildShippingLabelHtml({ name, company, address, zip, city, province, country, phone, contact });
  if (shipContent) shipContent.innerHTML = html;
  requestAnimationFrame(() => fitShippingLabel());
  if (shipPrevModal) shipPrevModal.style.display = "flex";
};
const warehouseExitModal = document.getElementById("warehouse-exit-modal");
const warehouseExitPasswordInput = document.getElementById("warehouse-exit-password");
const warehouseExitError = document.getElementById("warehouse-exit-error");
const warehouseExitUser = document.getElementById("warehouse-exit-user");
const warehouseExitConfirmBtn = document.getElementById("warehouse-exit-confirm");
const warehouseProductionFrame = document.getElementById("warehouse-production-frame");
const employeeCheckinFrame = document.getElementById("employee-checkin-frame");
const employeeCheckinCheckinFrame = document.getElementById("employee-checkin-checkin-frame");
const employeeCheckinFullscreenRefreshBtn = document.getElementById("employee-checkin-fullscreen-refresh");
const warehouseProductionDefaultReturnHash = "knowledge-base";
let warehouseExitUnlocked = false;
let warehousePendingExitHash = warehouseProductionDefaultReturnHash;
let lastHandledHash = "";
let routeAuthRetryCount = 0;
let employeeCheckinFullscreenRefreshing = false;
function isWarehouseProtectedHash(hash) {
  return hash === "warehouse-production" || hash === "employee-checkin-checkin";
}
function requiresWarehouseExitPassword() {
  return false;
}
function clearWarehouseExitFeedback() {
  if (warehouseExitError) {
    warehouseExitError.style.display = "none";
    warehouseExitError.textContent = "";
  }
}
function closeWarehouseExitModal() {
  if (!warehouseExitModal) return;
  warehouseExitModal.style.display = "none";
  clearWarehouseExitFeedback();
  if (warehouseExitPasswordInput) warehouseExitPasswordInput.value = "";
  if (warehouseExitConfirmBtn) {
    warehouseExitConfirmBtn.disabled = false;
    warehouseExitConfirmBtn.textContent = "\u786E\u8BA4\u9000\u51FA";
  }
}
window.closeWarehouseExitModal = closeWarehouseExitModal;
function openWarehouseExitModal(targetHash = warehouseProductionDefaultReturnHash) {
  warehousePendingExitHash = String(targetHash || warehouseProductionDefaultReturnHash).replace(/^#/, "") || warehouseProductionDefaultReturnHash;
  const user = getAuthUser();
  if (warehouseExitUser) warehouseExitUser.textContent = "\u5F53\u524D\u8D26\u53F7\uFF1A" + ((user == null ? void 0 : user.name) || "-");
  clearWarehouseExitFeedback();
  if (warehouseExitPasswordInput) warehouseExitPasswordInput.value = "";
  if (warehouseExitConfirmBtn) {
    warehouseExitConfirmBtn.disabled = false;
    warehouseExitConfirmBtn.textContent = "\u786E\u8BA4\u9000\u51FA";
  }
  if (warehouseExitModal) warehouseExitModal.style.display = "flex";
  setTimeout(() => {
    try {
      warehouseExitPasswordInput == null ? void 0 : warehouseExitPasswordInput.focus();
    } catch (e) {
    }
  }, 0);
}
function requestExitWarehouseProduction(targetHash = warehouseProductionDefaultReturnHash) {
  if (!requiresWarehouseExitPassword()) {
    warehouseExitUnlocked = true;
    const nextHash = String(targetHash || warehouseProductionDefaultReturnHash).replace(/^#/, "") || warehouseProductionDefaultReturnHash;
    if (location.hash === "#" + nextHash) {
      handleRoute();
    } else {
      location.hash = "#" + nextHash;
    }
    return;
  }
  openWarehouseExitModal(targetHash);
}
window.requestExitWarehouseProduction = requestExitWarehouseProduction;
async function confirmWarehouseExit() {
  const user = getAuthUser();
  const name = String((user == null ? void 0 : user.name) || "").trim();
  const password = (warehouseExitPasswordInput == null ? void 0 : warehouseExitPasswordInput.value) || "";
  if (!name) {
    if (warehouseExitError) {
      warehouseExitError.textContent = "\u5F53\u524D\u767B\u5F55\u4FE1\u606F\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002";
      warehouseExitError.style.display = "block";
    }
    return;
  }
  if (!password) {
    if (warehouseExitError) {
      warehouseExitError.textContent = "\u8BF7\u8F93\u5165\u5F53\u524D\u767B\u5F55\u5BC6\u7801\u3002";
      warehouseExitError.style.display = "block";
    }
    try {
      warehouseExitPasswordInput == null ? void 0 : warehouseExitPasswordInput.focus();
    } catch (e) {
    }
    return;
  }
  clearWarehouseExitFeedback();
  if (warehouseExitConfirmBtn) {
    warehouseExitConfirmBtn.disabled = true;
    warehouseExitConfirmBtn.textContent = "\u6821\u9A8C\u4E2D...";
  }
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password })
    });
    if (!res.ok) {
      if (warehouseExitError) {
        warehouseExitError.textContent = res.status === 401 ? "\u5BC6\u7801\u4E0D\u6B63\u786E\uFF0C\u65E0\u6CD5\u9000\u51FA\u5F53\u524D\u9875\u9762\u3002" : `\u6821\u9A8C\u5931\u8D25\uFF08HTTP ${res.status}\uFF09\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002`;
        warehouseExitError.style.display = "block";
      }
      return;
    }
    const data = await res.json().catch(() => null);
    if (!(data == null ? void 0 : data.token) || !(data == null ? void 0 : data.user)) {
      if (warehouseExitError) {
        warehouseExitError.textContent = "\u5BC6\u7801\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002";
        warehouseExitError.style.display = "block";
      }
      return;
    }
    localStorage.setItem("authToken", data.token);
    setAuthUser(data.user);
    warehouseExitUnlocked = true;
    closeWarehouseExitModal();
    const nextHash = warehousePendingExitHash || warehouseProductionDefaultReturnHash;
    warehousePendingExitHash = warehouseProductionDefaultReturnHash;
    if (location.hash === "#" + nextHash) {
      handleRoute();
    } else {
      location.hash = "#" + nextHash;
    }
  } catch (e) {
    if (warehouseExitError) {
      warehouseExitError.textContent = "\u5F53\u524D\u7F51\u7EDC\u4E0D\u53EF\u7528\uFF0C\u6682\u65F6\u65E0\u6CD5\u6821\u9A8C\u9000\u51FA\u5BC6\u7801\u3002";
      warehouseExitError.style.display = "block";
    }
  } finally {
    if (warehouseExitConfirmBtn) {
      warehouseExitConfirmBtn.disabled = false;
      warehouseExitConfirmBtn.textContent = "\u786E\u8BA4\u9000\u51FA";
    }
  }
}
window.confirmWarehouseExit = confirmWarehouseExit;
warehouseExitPasswordInput == null ? void 0 : warehouseExitPasswordInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    confirmWarehouseExit();
  }
});
function ensureWarehouseProductionFrameLoaded() {
  if (!warehouseProductionFrame) return;
  if (!warehouseProductionFrame.dataset.loaded) {
    warehouseProductionFrame.src = "./warehouse-production.html?v=20260806-warehouse-layout-fix4";
    warehouseProductionFrame.dataset.loaded = "1";
  }
}
function ensureEmployeeCheckinFrameLoaded() {
  if (!employeeCheckinFrame) return;
  if (!employeeCheckinFrame.dataset.loaded) {
    employeeCheckinFrame.src = "./employee-checkin.html?view=manage";
    employeeCheckinFrame.dataset.loaded = "1";
  }
}
function ensureEmployeeCheckinCheckinFrameLoaded() {
  if (!employeeCheckinCheckinFrame) return;
  if (!employeeCheckinCheckinFrame.dataset.loaded) {
    employeeCheckinCheckinFrame.src = "./employee-checkin.html?view=checkin";
    employeeCheckinCheckinFrame.dataset.loaded = "1";
  }
}
function setEmployeeCheckinFullscreenRefreshing(loading) {
  employeeCheckinFullscreenRefreshing = !!loading;
  if (!employeeCheckinFullscreenRefreshBtn) return;
  employeeCheckinFullscreenRefreshBtn.disabled = employeeCheckinFullscreenRefreshing;
  employeeCheckinFullscreenRefreshBtn.classList.toggle("is-refreshing", employeeCheckinFullscreenRefreshing);
}
function refreshEmployeeCheckinFullscreen() {
  if (!employeeCheckinCheckinFrame || employeeCheckinFullscreenRefreshing) return;
  ensureEmployeeCheckinCheckinFrameLoaded();
  const currentSrc = String(employeeCheckinCheckinFrame.getAttribute("src") || "./employee-checkin.html?view=checkin").trim() || "./employee-checkin.html?view=checkin";
  const nextUrl = new URL(currentSrc, window.location.href);
  nextUrl.searchParams.set("_refresh", String(Date.now()));
  setEmployeeCheckinFullscreenRefreshing(true);
  const finishRefresh = () => {
    employeeCheckinCheckinFrame.removeEventListener("load", finishRefresh);
    setEmployeeCheckinFullscreenRefreshing(false);
  };
  employeeCheckinCheckinFrame.addEventListener("load", finishRefresh, { once: true });
  setTimeout(() => {
    if (employeeCheckinFullscreenRefreshing) setEmployeeCheckinFullscreenRefreshing(false);
  }, 8000);
  try {
    employeeCheckinCheckinFrame.src = nextUrl.pathname + nextUrl.search;
  } catch (e) {
    setEmployeeCheckinFullscreenRefreshing(false);
  }
}
window.refreshEmployeeCheckinFullscreen = refreshEmployeeCheckinFullscreen;
window.addEventListener("hashchange", handleRoute);
window.addEventListener("DOMContentLoaded", startInitialRoute);
if (document.readyState !== "loading") startInitialRoute();
async function handleRoute() {
  var _a2;
  const hash = location.hash.slice(1) || "home";
  if (isWarehouseProtectedHash(lastHandledHash) && !isWarehouseProtectedHash(hash) && requiresWarehouseExitPassword() && !warehouseExitUnlocked) {
    warehousePendingExitHash = hash || warehouseProductionDefaultReturnHash;
    if (location.hash !== "#" + lastHandledHash) {
      location.hash = "#" + lastHandledHash;
    }
    openWarehouseExitModal(warehousePendingExitHash);
    return;
  }
  if (!isWarehouseProtectedHash(hash)) {
    warehouseExitUnlocked = false;
    closeWarehouseExitModal();
  }
  if (!getAuthToken() || hash === "login") {
    location.href = "./login.html";
    return;
  }
  const earlyPage = document.getElementById("page-" + hash);
  if (earlyPage) {
    document.querySelectorAll('[id^="page-"]').forEach((el) => {
      el.style.display = "none";
    });
    earlyPage.style.display = "block";
  }
  const authOk = await ensureAuthSession();
  if (!authOk) {
    if (getAuthToken() && routeAuthRetryCount < 3) {
      routeAuthRetryCount += 1;
      setTimeout(() => handleRoute(), 800 * routeAuthRetryCount);
    }
    return;
  }
  routeAuthRetryCount = 0;
  await loadFinancialEditOverrideSettings();
  const u = getAuthUser();
  const roleName = (u == null ? void 0 : u.role) || getUserRoleName((u == null ? void 0 : u.name) || "");
  const role = rolesData.find((r) => r.name === roleName) || null;
  if (u && roleName !== "\u8D85\u7EA7\u7BA1\u7406\u5458") {
    try {
      await apiRolesList();
    } catch (e) {
    }
  }
  if (u && !contactsData.customers) {
    try {
      await loadAllContacts();
    } catch (e) {
    }
  }
  document.querySelectorAll('[id^="page-"]').forEach((el) => el.style.display = "none");
  const gp = document.getElementById("global-pager");
  if (gp) gp.style.display = "none";
  const uw = document.getElementById("undo-wrap");
  if (uw) uw.style.display = "none";
  const checkView = (module) => {
    if (roleName === "\u8D85\u7EA7\u7BA1\u7406\u5458") return true;
    if (module === "shareholder_summary") return roleName === "\u80A1\u4E1C";
    return !!getPermEntry(role == null ? void 0 : role.perms, module).view;
  };
  document.querySelectorAll(".sidebar .nav a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href && href.startsWith("#")) {
      let mod = href.slice(1).replace(/-/g, "_");
      if (mod === "logistics") mod = "daily_orders";
      if (mod === "sales_albaran") mod = "sales_invoice";
      if (mod === "employee_checkin_checkin") mod = "employee_checkin";
      if (checkView(mod)) {
        a.style.display = "block";
      } else {
        a.style.display = "none";
      }
    }
  });
  document.querySelectorAll(".sidebar .nav-group").forEach((group) => {
    const children = Array.from(group.querySelectorAll(".nav-children a"));
    const hasVisible = children.some((a) => a.style.display !== "none");
    if (hasVisible) {
      group.style.display = "block";
    } else {
      group.style.display = "none";
    }
  });
  const ensureView = (module) => {
    if (!checkView(module)) {
      const modulesInOrder = [
        { mod: "home", hash: "home" },
        { mod: "tasks", hash: "tasks" },
        { mod: "daily_orders", hash: "daily-orders" },
        { mod: "finished_stock", hash: "finished-stock" },
        { mod: "raw_stock", hash: "raw-stock" },
        { mod: "production_review", hash: "production-review" },
        { mod: "event_records", hash: "event-records" },
        { mod: "knowledge_base", hash: "knowledge-base" },
        { mod: "warehouse_production", hash: "warehouse-production" },
        { mod: "employee_checkin", hash: "employee-checkin" },
        { mod: "employee_checkin", hash: "employee-checkin-checkin" },
        { mod: "sales_order", hash: "sales-order" },
        { mod: "sales_invoice", hash: "sales-albaran" },
        { mod: "sales_invoice", hash: "sales-invoice" },
        { mod: "sales_products", hash: "sales-products" },
        { mod: "sales_stats", hash: "sales-stats" },
        { mod: "ledger", hash: "ledger" },
        { mod: "payables", hash: "payables" },
        { mod: "contacts", hash: "contacts" },
        { mod: "categories", hash: "categories" },
        { mod: "accounts", hash: "accounts" },
        { mod: "shareholder_summary", hash: "shareholder-summary" },
        { mod: "sales_accounts", hash: "sales-accounts" },
        { mod: "company_info", hash: "company-info" },
        { mod: "user_accounts", hash: "user-accounts" },
        { mod: "role_accounts", hash: "role-accounts" },
        { mod: "system", hash: "system" }
      ];
      let fallback = "";
      if (role && role.perms) {
        for (let m of modulesInOrder) {
          if (role.perms[m.mod] && role.perms[m.mod].view) {
            fallback = m.hash;
            break;
          }
        }
      }
      if (!fallback) fallback = "empty";
      if (location.hash !== "#" + fallback) {
        location.hash = "#" + fallback;
      }
      return false;
    }
    return true;
  };
  if (hash === "home") {
    if (!ensureView("home")) return;
    document.getElementById("page-home").style.display = "block";
    loadShareholderSummary().catch(() => {});
    if (typeof homePeriodSel !== "undefined" && homePeriodSel) homePeriodSel.value = "month";
    if (typeof renderHomeChart === "function") renderHomeChart("month");
    if (typeof salesPeriodSel !== "undefined" && salesPeriodSel) salesPeriodSel.value = "month";
    if (typeof renderSalesChart === "function") renderSalesChart("month");
  } else if (hash === "tasks") {
    if (!ensureView("tasks")) return;
    document.getElementById("page-tasks").style.display = "block";
    loadTasks(currentTaskTab);
  } else if (hash === "ledger") {
    if (!ensureView("ledger")) return;
    document.getElementById("page-ledger").style.display = "block";
    const selectedLedgerCategory = pendingLedgerCategory;
    pendingLedgerCategory = "";
    apiAccountsList().then(() => {
      if (typeof refreshAccountOptions === "function") refreshAccountOptions();
    });
    try {
      if (typeof ledgerHdrType !== "undefined") {
        ledgerHdrType = "all";
        ledgerHdrCat = selectedLedgerCategory || "";
        ledgerHdrOwner = "";
        ledgerHdrMethod = "";
        ledgerHdrConfirm = "all";
      }
      if (typeof setLabel === "function") {
        setLabel(document.getElementById("ld-type-label"), getLedgerLocaleText("type"), false);
        setLabel(document.getElementById("ld-cat-label"), ledgerHdrCat ? getCategoryDisplayName(ledgerHdrCat) : getLedgerLocaleText("category"), !!ledgerHdrCat);
        setLabel(document.getElementById("ld-owner-label"), "\u5F80\u6765\u5355\u4F4D", false);
        setLabel(document.getElementById("ld-method-label"), getLedgerLocaleText("method"), false);
        setLabel(document.getElementById("ld-confirm-label"), "\u64CD\u4F5C", false);
      }
      syncLedgerLocale();
    } catch (e) {
    }
    Promise.all([apiCategoriesList(), loadLedgerFromServer()]).then(() => {
      setCategories();
      if (typeof applyFilters === "function") applyFilters();
    });
    loadAllContacts();
  } else if (hash === "payables") {
    if (!ensureView("payables")) return;
    document.getElementById("page-payables").style.display = "block";
    syncPayablesLocale();
    if (gp) gp.style.display = "flex";
    try {
      if (typeof payFilterType !== "undefined") {
        payFilterType = "all";
        payFilterPartnerName = "";
        payFilterSalesName = "";
        payFilterStatus = "all";
        payFilterOverdue = "all";
        payFilterAction = "all";
        payPage = 1;
      }
      const reset = (el, text) => {
        if (el) {
          el.textContent = text + " \u25BE";
          el.style.color = "";
        }
      };
      reset(document.getElementById("th-type-label"), "\u6B3E\u9879\u7C7B\u578B");
      reset(document.getElementById("th-partner-label"), "\u5F80\u6765\u5355\u4F4D");
      reset(document.getElementById("th-sales-label"), "\u4E1A\u52A1\u5458");
      reset(document.getElementById("th-arrears-label"), "\u6B20\u6B3E");
      reset(document.getElementById("th-trust-label"), "\u4FE1\u4EFB\u5929\u6570");
      reset(document.getElementById("th-action-label"), "\u64CD\u4F5C");
    } catch (e) {
    }
    loadPayablesFromServer().then(() => {
      if (typeof renderPayables === "function") renderPayables();
    });
  } else if (hash === "contacts") {
    if (!ensureView("contacts")) return;
    document.getElementById("page-contacts").style.display = "block";
    if (gp) gp.style.display = "flex";
    loadSalesPeople().then(() => {
      if (typeof renderContacts === "function") renderContacts();
    });
  } else if (hash === "sales-order") {
    if (!ensureView("sales_order")) return;
    document.getElementById("page-sales-order").style.display = "block";
    Promise.all([loadAllContacts(), loadSalesPeople()]).then(async () => {
      if (typeof loadProductSelector === "function") await loadProductSelector();
      if (typeof pendingEditInvoiceId !== "undefined" && pendingEditInvoiceId) {
        await loadInvoiceForEdit(pendingEditInvoiceId);
        pendingEditInvoiceId = null;
      } else {
        if (typeof soCustomer !== "undefined") soCustomer.value = "";
        if (typeof soUsePrice !== "undefined") soUsePrice.value = "";
        if (typeof soNotes !== "undefined") soNotes.value = "";
        if (typeof soItems !== "undefined") soItems.innerHTML = "";
        if (typeof soInvoiceNo !== "undefined" && soInvoiceNo) soInvoiceNo.dataset.invoiceType = "factura";
        if (typeof updateSoTotal === "function") updateSoTotal();
        if (typeof soInvoiceNo !== "undefined") delete soInvoiceNo.dataset.id;
        if (typeof loadNextInvoiceNo === "function") await loadNextInvoiceNo("factura");
      }
    });
  } else if (hash === "sales-albaran") {
    if (!ensureView("sales_invoice")) return;
    document.getElementById("page-sales-albaran").style.display = "block";
    if (typeof invPage !== "undefined") invPage = 1;
    loadAllContacts().then(() => {
      loadInvoices("albaran");
    });
  } else if (hash === "sales-invoice") {
    if (!ensureView("sales_invoice")) return;
    document.getElementById("page-sales-invoice").style.display = "block";
    if (typeof invPage !== "undefined") invPage = 1;
    loadAllContacts().then(() => {
      loadInvoices("factura");
    });
  } else if (hash === "sales-products") {
    if (!ensureView("sales_products")) return;
    document.getElementById("page-sales-products").style.display = "block";
    if (typeof prodPage !== "undefined") prodPage = 1;
    loadProducts();
  } else if (hash === "sales-stats") {
    if (!ensureView("sales_stats")) return;
    document.getElementById("page-sales-stats").style.display = "block";
    loadSalesStats();
  } else if (hash.startsWith("partner-orders")) {
    if (!ensureView("contacts")) return;
    const nameParam = decodeURIComponent((hash.split(":")[1] || "").trim());
    const page = document.getElementById("page-partner-orders");
    if (page) {
      page.style.display = "block";
      if (typeof partnerOrdersHead !== "undefined") partnerOrdersHead.textContent = "\u5F80\u6765\u5355\u4F4D\uFF1A" + (nameParam || "");
      if (typeof partnerOrdersRows !== "undefined") partnerOrdersRows.innerHTML = "";
      loadPayablesFromServer().then(() => {
        const list = payRecords.filter((r) => (r.partner || "") === (nameParam || ""));
        list.forEach((r) => {
          const tr = document.createElement("tr");
          const paid = r.paid || 0;
          const arrears = Math.max(0, (r.amount || 0) - paid);
          [r.type, r.partner || "", r.doc || "", (r.amount || 0).toFixed(2), r.invoiceNo || "", Number(r.invoiceAmount || 0).toFixed(2), paid.toFixed(2), arrears.toFixed(2), r.date || ""].forEach((v, i) => {
            const td = document.createElement("td");
            td.textContent = String(v);
            if (i === 7 && arrears > 0) td.style.color = "#ef4444";
            tr.appendChild(td);
          });
          partnerOrdersRows.appendChild(tr);
        });
      });
    }
  } else if (hash === "categories") {
    if (!ensureView("categories")) return;
    document.getElementById("page-categories").style.display = "block";
    apiCategoriesList().then(() => {
      if (typeof renderCats === "function") renderCats();
    });
  } else if (hash === "accounts") {
    if (!ensureView("accounts")) return;
    document.getElementById("page-accounts").style.display = "block";
    apiAccountsList().then(() => {
      if (typeof refreshAccountOptions === "function") refreshAccountOptions();
      if (typeof renderAccounts === "function") renderAccounts();
    });
  } else if (hash.startsWith("account-ledger:")) {
    if (!ensureView("accounts")) return;
    const accountName = decodeURIComponent(hash.slice("account-ledger:".length) || "");
    if (!accountName) {
      location.hash = "#accounts";
      return;
    }
    document.getElementById("page-account-ledger").style.display = "block";
    renderAccountLedgerPage(accountName);
  } else if (hash === "debt-ledger") {
    if (!ensureView("shareholder_summary")) return;
    document.getElementById("page-debt-ledger").style.display = "block";
    renderDebtLedgerPage();
  } else if (hash === "shareholder-summary") {
    if (!ensureView("shareholder_summary")) return;
    document.getElementById("page-shareholder-summary").style.display = "block";
    loadShareholderSummary().catch((e) => {
      const rows = document.getElementById("shareholder-summary-rows");
      if (rows) rows.innerHTML = '<tr class="empty"><td colspan="3">股东数据加载失败</td></tr>';
    });
  } else if (hash === "user-accounts") {
    if (!ensureView("user_accounts")) return;
    document.getElementById("page-user-accounts").style.display = "block";
    Promise.all([apiUsersList(), apiDailyOrderActionAssignments()]).then(() => {
      if (typeof renderUserAccounts === "function") renderUserAccounts();
    });
  } else if (hash === "role-accounts") {
    if (!ensureView("role_accounts")) return;
    document.getElementById("page-role-accounts").style.display = "block";
    apiRolesList().then(() => {
      if (typeof renderRoles === "function") renderRoles();
    });
  } else if (hash === "sales-accounts") {
    if (!ensureView("sales_accounts")) return;
    document.getElementById("page-sales-accounts").style.display = "block";
    apiSalesList().then(() => {
      if (typeof renderSales === "function") renderSales();
    });
  } else if (hash === "role-perms") {
    if (!ensureView("role_accounts")) return;
    document.getElementById("page-role-perms").style.display = "block";
  } else if (hash === "system") {
    if (!ensureView("system")) return;
    document.getElementById("page-system").style.display = "block";
    loadSystemLanguageSettings();
    loadFinancialEditOverrideSettings(true);
  } else if (hash === "company-info") {
    if (!ensureView("company_info")) return;
    document.getElementById("page-company-info").style.display = "block";
    syncCompanyInfoAccess();
    loadCompanyInfo();
  } else if (hash === "daily-orders") {
    if (!ensureView("daily_orders")) return;
    document.getElementById("page-daily-orders").style.display = "block";
    loadDailyOrders();
  } else if (hash === "logistics") {
    if (!ensureView("daily_orders")) return;
    document.getElementById("page-logistics").style.display = "block";
    loadLogistics();
  } else if (hash === "finished-stock") {
    if (pendingFinishedStockTab === "review") {
      if (!ensureView("production_review")) return;
    } else if (!ensureView("finished_stock")) return;
    document.getElementById("page-finished-stock").style.display = "block";
    const targetTab = pendingFinishedStockTab || "stock";
    pendingFinishedStockTab = "";
    switchFinishedStockTab(targetTab);
  } else if (hash.startsWith("raw-stock-audit-detail")) {
    if (!ensureView("raw_stock")) return;
    const auditId = Number((hash.split("=")[1] || "").trim() || 0);
    if (!auditId) {
      location.hash = "#raw-stock";
      return;
    }
    document.getElementById("page-raw-stock-audit-detail").style.display = "block";
    openRawStockAuditDetail(auditId);
  } else if (hash === "raw-stock") {
    if (!ensureView("raw_stock")) return;
    document.getElementById("page-raw-stock").style.display = "block";
    switchRawStockTab("stock");
  } else if (hash === "production-review") {
    if (!ensureView("production_review")) return;
    pendingFinishedStockTab = "review";
    location.hash = "#finished-stock";
    return;
  } else if (hash === "event-records") {
    if (!ensureView("event_records")) return;
    document.getElementById("page-event-records").style.display = "block";
    loadEventRecords("ongoing");
  } else if (hash === "knowledge-base") {
    if (!ensureView("knowledge_base")) return;
    document.getElementById("page-knowledge-base").style.display = "block";
    loadKnowledgeBase("internal");
  } else if (hash === "warehouse-production") {
    if (!ensureView("warehouse_production")) return;
    document.getElementById("page-warehouse-production").style.display = "block";
    ensureWarehouseProductionFrameLoaded();
  } else if (hash === "employee-checkin") {
    if (!ensureView("employee_checkin")) return;
    document.getElementById("page-employee-checkin").style.display = "block";
    ensureEmployeeCheckinFrameLoaded();
  } else if (hash === "employee-checkin-checkin") {
    if (!ensureView("employee_checkin")) return;
    document.getElementById("page-employee-checkin-checkin").style.display = "block";
    ensureEmployeeCheckinCheckinFrameLoaded();
  } else if (hash.startsWith("stock-history")) {
    if (!ensureView("finished_stock") && !ensureView("raw_stock")) return;
    const id = hash.split("=")[1];
    document.getElementById("page-stock-history").style.display = "block";
    loadStockHistory(id);
  } else {
    const t = document.getElementById("page-" + hash);
    if (t) t.style.display = "block";
    else {
      const empty = document.getElementById("page-empty");
      if (empty) empty.style.display = "block";
    }
  }
  document.querySelectorAll(".nav a").forEach((a) => a.classList.remove("active"));
  const navHash = hash === "employee-checkin-checkin" ? "employee-checkin" : hash;
  const link = document.querySelector(`.nav a[href="#${navHash}"]`);
  if (link) {
    link.classList.add("active");
    const group = link.closest(".nav-group");
    if (group) {
      const h = group.querySelector(".nav-group-header");
      const c = group.querySelector(".nav-children");
      if (h) h.classList.remove("collapsed");
      if (c) c.classList.remove("collapsed");
    }
  }
  lastHandledHash = hash;
  (_a2 = window.applyI18n) == null ? void 0 : _a2.call(window, document.body);
}
let currentTaskTab = "new";
let currentTaskPage = 1;
let currentTasksList = [];
let currentAutoTaskList = [];
let currentProductionPlanList = [];
let productionPlanProductOptions = [];
let productionPlanSelectedIds = /* @__PURE__ */ new Set();
let productionPlanProductsLoadingPromise = null;
let productionPlanMaterialSelectTargetId = 0;
let productionPlanInvalidMaterialIds = /* @__PURE__ */ new Set();
let productionPlanInvalidQtyIds = /* @__PURE__ */ new Set();
let currentProductionPlanCurrentWeekIds = /* @__PURE__ */ new Set();
let currentProductionPlanNextWeekIds = /* @__PURE__ */ new Set();
let currentProductionPlanFutureGroups = [];
let currentCompletedProductionPlanGroups = [];
let productionPlanDragState = { planId: 0, tbodyId: "", overPlanId: 0, dropPosition: "after" };
let productionPlanQtyPopoverEl = null;
let productionPlanQtyPopoverHideTimer = null;
let productionPlanQtyActiveInput = null;
const productionPlanQtyQuickOptions = ["100", "200", "300", "400", "500", "600", "700"];
function updateProductionPlanSelectedSummary() {
  var _a2;
  const summaryEl = document.getElementById("production-plan-selected-summary");
  if (!summaryEl) return;
  const mode = String(((_a2 = document.getElementById("production-plan-mode")) == null ? void 0 : _a2.value) || "").trim();
  summaryEl.textContent = mode === "group" ? `\u5DF2\u9009\u62E9 ${productionPlanSelectedIds.size} \u4E2A\u5546\u54C1` : `\u5DF2\u9009\u62E9 ${productionPlanSelectedIds.size} \u4E2A\u5546\u54C1`;
}
function formatTaskTimeLimit(limitDays) {
  const val = Number(limitDays || 0);
  if (!val) return "-";
  if (val === 7) return "\u4E00\u5468\u5185";
  if (val === 30) return "\u4E00\u4E2A\u6708\u5185";
  return `${val}\u5929\u5185`;
}
function formatDateTimeSafe(ts) {
  const num = Number(ts || 0);
  if (!num) return "-";
  return formatDisplayDateTimeValue(num) || "-";
}
function formatDateTimeTwoLines(ts) {
  const num = Number(ts || 0);
  if (!num) return "-";
  const dateText = formatDisplayDate(num);
  const timeText = formatDisplayTime(num);
  return `<div>${escapeHtml(dateText)}</div><div style="font-size:12px; color:#94a3b8; line-height:1.2; margin-top:2px">${escapeHtml(timeText)}</div>`;
}
function formatDateTimeLocalInput(ts) {
  const num = Number(ts || 0);
  if (!num) return "";
  const d = new Date(num);
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function readDateTimeLocalInput(id) {
  var _a2;
  const raw = String(((_a2 = document.getElementById(id)) == null ? void 0 : _a2.value) || "").trim();
  if (!raw) return 0;
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : 0;
}
function formatAutoTaskInterval(months) {
  const val = Number(months || 0);
  if (val === 0) return "\u4EC5\u9650\u4E00\u6B21";
  if (val === -1) return "\u6BCF\u4E00\u5929";
  if (val === -2) return "\u6BCF\u4E00\u5468";
  return val > 0 ? `\u6BCF${val}\u4E2A\u6708` : "-";
}
function getTaskWeekStartTs(offsetWeeks = 0, nowTs = Date.now()) {
  const d = new Date(Number(nowTs || Date.now()));
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + offsetWeeks * 7);
  return d.getTime();
}
function getTaskWeekEndTs(offsetWeeks = 0, nowTs = Date.now()) {
  return getTaskWeekStartTs(offsetWeeks, nowTs) + 6 * 24 * 60 * 60 * 1e3;
}
function getProductionPlanWeekType(weekStart) {
  return Number(weekStart || 0) === getTaskWeekStartTs(1) ? "next" : "current";
}
function formatProductionPlanPeriod(item = {}) {
  const startTs = Number(item.plan_start || item.week_start || 0);
  const endRaw = Number(item.plan_end || item.plan_start || item.week_start || 0);
  if (!startTs) return "";
  const endTs = endRaw >= startTs ? endRaw : startTs;
  const formatProductionPlanDisplayDate = (ts) => {
    const text = formatDateFromTs(ts);
    if (!text) return "";
    const parts = String(text).split("-");
    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : text;
  };
  const startText = formatProductionPlanDisplayDate(startTs);
  const endText = formatProductionPlanDisplayDate(endTs);
  if (!startText) return "";
  return endText && endText !== startText ? `${startText} \u81F3 ${endText}` : startText;
}
function formatProductionPlanWeekdayCell(item = {}) {
  const baseTs = Number(item.plan_start || item.week_start || 0);
  if (!baseTs) return { weekday: "-", date: "-" };
  const dateObj = new Date(baseTs);
  const weekdays = getCurrentAppLocale() === "es-ES" ? ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"] : ["\u661F\u671F\u65E5", "\u661F\u671F\u4E00", "\u661F\u671F\u4E8C", "\u661F\u671F\u4E09", "\u661F\u671F\u56DB", "\u661F\u671F\u4E94", "\u661F\u671F\u516D"];
  const weekday = weekdays[dateObj.getDay()] || "-";
  const dateText = formatDateFromTs(baseTs);
  const parts = String(dateText).split("-");
  return {
    weekday,
    date: parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : dateText || "-"
  };
}
function formatProductionPlanTitlePeriod(list = []) {
  if (!Array.isArray(list) || !list.length) return "";
  const starts = list.map((item) => Number(item.plan_start || item.week_start || 0)).filter((ts) => ts > 0);
  const ends = list.map((item) => Number(item.plan_end || item.plan_start || item.week_start || 0)).filter((ts) => ts > 0);
  if (!starts.length) return "";
  const startTs = Math.min(...starts);
  const endTs = ends.length ? Math.max(...ends) : startTs;
  return formatProductionPlanPeriod({ plan_start: startTs, plan_end: endTs });
}
function setProductionPlanSelectedProducts(ids = []) {
  productionPlanSelectedIds = new Set(ids.map((v) => Number(v || 0)).filter((v) => v > 0));
  updateProductionPlanSelectedSummary();
  renderProductionPlanProductOptions();
}
function getProductionPlanGroupItems(groupKey = "") {
  const normalizedKey = String(groupKey || "").trim();
  const idSet = normalizedKey === "current" ? currentProductionPlanCurrentWeekIds : normalizedKey === "next" ? currentProductionPlanNextWeekIds : null;
  if (!idSet) return [];
  return currentProductionPlanList.filter((item) => idSet.has(Number(item.id || 0)));
}
function syncProductionPlanGroupEditButtons() {
  const currentBtn = document.getElementById("production-plan-current-edit-btn");
  const nextBtn = document.getElementById("production-plan-next-edit-btn");
  const canEditPlan = typeof can !== "function" ? true : can("tasks", "edit");
  const currentWeek = getProductionPlanGroupItems("current");
  const nextWeek = getProductionPlanGroupItems("next");
  if (currentBtn) {
    currentBtn.style.display = currentWeek.length ? "inline-flex" : "none";
    currentBtn.disabled = !canEditPlan;
  }
  if (nextBtn) {
    nextBtn.style.display = nextWeek.length ? "inline-flex" : "none";
    nextBtn.disabled = !canEditPlan;
  }
}
function renderFutureProductionPlanGroups(groups = []) {
  const listEl = document.getElementById("production-plan-future-list");
  if (!listEl) return;
  if (!Array.isArray(groups) || !groups.length) {
    listEl.innerHTML = "";
    return;
  }
  const canEditPlan = typeof can !== "function" ? true : can("tasks", "edit");
  listEl.innerHTML = groups.map((group, groupIdx) => {
    const items = Array.isArray(group.items) ? group.items : [];
    const tbodyId = `production-plan-future-rows-${groupIdx}`;
    return `
      <div class="card table-wrap" style="padding-top:0; display:block; margin-top:16px">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin:4px 0 10px 0">
          <div style="font-weight:700">\u540E\u7EED\u751F\u4EA7\u8BA1\u5212<span style="margin-left:8px; font-size:12px; color:#94a3b8; font-weight:500">${escapeHtml(formatProductionPlanTitlePeriod(items))}</span></div>
          <button class="btn-sm btn-secondary" style="margin:0" onclick="editProductionPlanGroup('${escapeHtml(String(group.key || ""))}')" ${canEditPlan ? "" : "disabled"}>\u7F16\u8F91\u8BA1\u5212</button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th style="width:40px"></th>
              <th style="width:60px">\u5E8F\u53F7</th>
              <th style="width:96px">\u661F\u671F</th>
              <th style="width:72px">\u56FE\u7247</th>
              <th>\u5546\u54C1\u540D\u79F0</th>
              <th>\u539F\u6599\u540D\u79F0</th>
              <th style="width:160px">\u751F\u4EA7\u91CF\uFF08\u539F\u6599\uFF09kg</th>
              <th style="width:220px">\u64CD\u4F5C</th>
            </tr>
          </thead>
          <tbody id="${tbodyId}" ondragover="handleProductionPlanDragOver('${tbodyId}', event)" ondrop="handleProductionPlanDrop('${tbodyId}', event)"></tbody>
        </table>
      </div>
    `;
  }).join("");
  const productMetaMap = new Map(productionPlanProductOptions.map((prod) => [Number(prod.id || 0), prod]));
  groups.forEach((group, groupIdx) => {
    const tbodyId = `production-plan-future-rows-${groupIdx}`;
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const items = Array.isArray(group.items) ? group.items : [];
    tbody.innerHTML = items.map((item, idx) => buildProductionPlanRowHtml(item, idx, productMetaMap, { tbodyId, showDragHandle: true })).join("");
  });
}
function rerenderProductionPlanTablesFromState() {
  const currentWeek = currentProductionPlanList.filter((item) => currentProductionPlanCurrentWeekIds.has(Number(item.id || 0)));
  const nextWeek = currentProductionPlanList.filter((item) => currentProductionPlanNextWeekIds.has(Number(item.id || 0)));
  const panel = document.getElementById("production-plan-panel");
  const currentSection = document.getElementById("production-plan-current-section");
  const nextSection = document.getElementById("production-plan-next-section");
  const currentTitlePeriod = document.getElementById("production-plan-current-title-period");
  const nextTitlePeriod = document.getElementById("production-plan-next-title-period");
  if (currentSection) currentSection.style.display = currentWeek.length ? "block" : "none";
  if (nextSection) nextSection.style.display = nextWeek.length ? "block" : "none";
  if (panel) panel.style.display = currentWeek.length || nextWeek.length || currentProductionPlanFutureGroups.length ? "block" : "none";
  if (currentTitlePeriod) currentTitlePeriod.textContent = formatProductionPlanTitlePeriod(currentWeek);
  if (nextTitlePeriod) nextTitlePeriod.textContent = formatProductionPlanTitlePeriod(nextWeek);
  syncProductionPlanGroupEditButtons();
  renderProductionPlanTableRows(currentWeek, "production-plan-current-rows");
  renderProductionPlanTableRows(nextWeek, "production-plan-next-rows");
  renderFutureProductionPlanGroups(currentProductionPlanFutureGroups);
}
function clearProductionPlanDragMarkers(tbodyId = "") {
  const tbody = tbodyId ? document.getElementById(tbodyId) : null;
  const rows2 = tbody ? tbody.querySelectorAll("tr[data-plan-id]") : document.querySelectorAll("#production-plan-current-rows tr[data-plan-id], #production-plan-next-rows tr[data-plan-id]");
  rows2.forEach((row) => row.classList.remove("plan-row-dragging", "plan-drop-before", "plan-drop-after"));
}
function applyProductionPlanOrderToState(tbodyId, orderedIds = []) {
  const itemMap = new Map(currentProductionPlanList.map((item) => [Number(item.id || 0), item]));
  const currentWeek = currentProductionPlanList.filter((item) => currentProductionPlanCurrentWeekIds.has(Number(item.id || 0)));
  const nextWeek = currentProductionPlanList.filter((item) => currentProductionPlanNextWeekIds.has(Number(item.id || 0)));
  const orderedItems = orderedIds.map((id) => itemMap.get(Number(id || 0))).filter(Boolean);
  if (tbodyId === "production-plan-current-rows") {
    currentProductionPlanList = [...orderedItems, ...nextWeek];
    return;
  }
  if (tbodyId === "production-plan-next-rows") {
    currentProductionPlanList = [...currentWeek, ...orderedItems];
    return;
  }
  const futureGroupIndex = currentProductionPlanFutureGroups.findIndex((group, idx) => `production-plan-future-rows-${idx}` === tbodyId);
  if (futureGroupIndex >= 0) {
    currentProductionPlanFutureGroups[futureGroupIndex].items = orderedItems;
    currentProductionPlanList = [
      ...currentWeek,
      ...nextWeek,
      ...currentProductionPlanFutureGroups.flatMap((group) => Array.isArray(group.items) ? group.items : [])
    ];
  }
}
function buildProductionPlanRowHtml(item, idx, productMetaMap, options = {}) {
  const itemId = Number(item.id || 0);
  const readOnly = options.readOnly === true;
  const tbodyId = String(options.tbodyId || "").trim();
  const showDragHandle = options.showDragHandle === true && !readOnly;
  const canEditPlan = readOnly ? false : typeof can !== "function" ? true : can("tasks", "edit");
  const confirmed = String(item.status || "") === "confirmed";
  const materialName = String(item.material_name || "").trim();
  const materialQtyValue = Number(item.material_qty || 0);
  const materialQty = materialQtyValue > 0 ? String(item.material_qty) : "";
  const materialInvalid = !readOnly && productionPlanInvalidMaterialIds.has(itemId);
  const qtyInvalid = !readOnly && productionPlanInvalidQtyIds.has(itemId);
  const productMeta = productMetaMap.get(Number(item.product_id || 0)) || {};
  const productImage = String(productMeta.image || "").trim();
  const productNameCn = String(productMeta.name_cn || "").trim();
  const weekdayInfo = formatProductionPlanWeekdayCell(item);
  const editHtml = !readOnly ? `<button class="btn-icon-outline-blue" style="width:32px; min-width:32px; height:32px; border-radius:8px; margin:0" title="\u7F16\u8F91\u8BA1\u5212" onclick="editProductionPlan(${item.id})" ${canEditPlan ? "" : "disabled"}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg></button>` : "";
  const deleteHtml = !readOnly && !confirmed ? `<button class="btn-icon-outline-red" style="width:32px; min-width:32px; height:32px; border-radius:8px; margin:0" title="\u5220\u9664\u8BA1\u5212" onclick="deleteProductionPlan(${item.id})" ${canEditPlan ? "" : "disabled"}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>` : "";
  const dragHandleHtml = showDragHandle ? `<button class="plan-drag-handle" type="button" draggable="${canEditPlan ? "true" : "false"}" title="\u6309\u4F4F\u62D6\u52A8\u6392\u5E8F" ondragstart="startProductionPlanDrag(${item.id}, '${tbodyId}', event)" ondragend="endProductionPlanDrag('${tbodyId}', event)" ${canEditPlan ? "" : "disabled"}>\u2630</button>` : "";
  const confirmedByText = String(item.confirmed_by || "").trim() || "-";
  const confirmedAtHtml = Number(item.confirmed_at || 0) ? `<div style="margin-top:6px">${formatDateTimeTwoLines(item.confirmed_at)}</div>` : '<div style="margin-top:6px; color:#94a3b8">-</div>';
  const actionHtml = readOnly ? `<div style="font-size:12px; color:#94a3b8"><div>${escapeHtml(`\u786E\u8BA4\uFF1A${confirmedByText}`)}</div><div style="margin-top:4px">\u5B8C\u6210\u65F6\u95F4\uFF1A</div>${confirmedAtHtml}</div>` : confirmed ? `<div style="display:flex; gap:6px; align-items:center">${editHtml}<button class="btn-sm btn-secondary" style="flex:1; margin:0" disabled>${escapeHtml(`\u786E\u8BA4\uFF1A${confirmedByText}`)}</button></div>` : `<div style="display:flex; gap:6px; align-items:center">${deleteHtml}${editHtml}<button class="btn-sm" style="flex:1; margin:0" onclick="confirmProductionPlan(${item.id})" ${canEditPlan ? "" : "disabled"}>\u786E\u8BA4\u751F\u4EA7</button></div>`;
  return `
    <tr data-plan-id="${itemId}">
      ${showDragHandle ? `<td style="width:40px; text-align:center">${dragHandleHtml}</td>` : ""}
      <td>${idx + 1}</td>
      <td style="width:96px">
        <div style="font-weight:600; color:#e2e8f0">${escapeHtml(weekdayInfo.weekday)}</div>
        <div style="margin-top:4px; font-size:12px; color:#94a3b8">${escapeHtml(weekdayInfo.date)}</div>
      </td>
      <td style="padding:8px">
        ${productImage ? `<img src="${escapeHtml(productImage)}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; border:1px solid #334155">` : '<div style="width:48px; height:48px; background:#0f172a; border-radius:4px; border:1px solid #334155"></div>'}
      </td>
      <td><div>${escapeHtml(item.product_name || "")}</div>${productNameCn ? `<div style="margin-top:4px; font-size:12px; color:#94a3b8">${escapeHtml(productNameCn)}</div>` : ""}</td>
      <td>
        ${readOnly ? `<div style="min-height:34px; display:flex; align-items:center; color:${materialName ? "#e2e8f0" : "#94a3b8"}">${escapeHtml(materialName || "-")}</div>` : `<button
              class="btn-secondary${materialInvalid ? " invalid" : ""}"
              style="width:100%; margin:0; text-align:left; justify-content:flex-start; min-height:34px; white-space:normal; color:${materialInvalid ? "#ef4444" : materialName ? "#e2e8f0" : "#94a3b8"}"
              onclick="openProductionPlanMaterialSelector(${item.id})"
              ${canEditPlan ? "" : "disabled"}
            >${escapeHtml(materialName || (materialInvalid ? "\u8BF7\u9009\u62E9\u539F\u6599\u540D\u79F0" : "\u70B9\u51FB\u9009\u62E9"))}</button>`}
      </td>
      <td>
        ${readOnly ? `<div style="min-height:34px; display:flex; align-items:center; color:${materialQty ? "#e2e8f0" : "#94a3b8"}">${escapeHtml(materialQty || "-")}</div>` : `<input
              type="number"
              step="0.01"
              class="${qtyInvalid ? "invalid" : ""}"
              value="${escapeHtml(materialQty)}"
              placeholder="${qtyInvalid ? "\u8BF7\u8F93\u5165\u751F\u4EA7\u91CFkg" : "\u8F93\u5165kg"}"
              ${canEditPlan ? "" : "disabled"}
              onchange="updateProductionPlanMaterialQty(${item.id}, this.value)"
              onfocus="showProductionPlanMaterialQtyOptions(${item.id}, this)"
              onclick="showProductionPlanMaterialQtyOptions(${item.id}, this)"
              onblur="hideProductionPlanMaterialQtyOptionsLater()"
              style="width:100%; min-width:110px; color:${qtyInvalid ? "#ef4444" : "#e2e8f0"}"
            >`}
      </td>
      <td>${actionHtml}</td>
    </tr>
  `;
}
async function ensureProductionPlanProductsLoaded(force = false) {
  const listEl = document.getElementById("production-plan-product-list");
  if (!listEl) return;
  if (!force && productionPlanProductOptions.length) {
    updateProductionPlanSelectedSummary();
    renderProductionPlanProductOptions();
    return;
  }
  if (!force && productionPlanProductsLoadingPromise) {
    await productionPlanProductsLoadingPromise;
    return;
  }
  listEl.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px 0">\u5546\u54C1\u52A0\u8F7D\u4E2D...</div>';
  productionPlanProductsLoadingPromise = (async () => {
    const pageSize = 1e3;
    const nextList = [];
    let page = 1;
    let total = 0;
    try {
      do {
        const res = await fetchWithAuth(`/api/products?page=${page}&size=${pageSize}`);
        if (!res.ok) throw new Error(`http_${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data.list) ? data.list : [];
        total = Number(data.total || 0);
        nextList.push(...list);
        if (!list.length || nextList.length >= total) break;
        page += 1;
      } while (page <= 20);
      productionPlanProductOptions = nextList.sort((a, b) => {
        const aSku = String(a.sku || "").trim();
        const bSku = String(b.sku || "").trim();
        const na = parseInt(aSku || "0", 10);
        const nb = parseInt(bSku || "0", 10);
        if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === aSku && String(nb) === bSku) return na - nb;
        return aSku.localeCompare(bSku, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
      });
      updateProductionPlanSelectedSummary();
      renderProductionPlanProductOptions();
    } catch (e) {
      productionPlanProductOptions = [];
      updateProductionPlanSelectedSummary();
      listEl.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px 0">\u5546\u54C1\u5217\u8868\u52A0\u8F7D\u5931\u8D25</div>';
    } finally {
      productionPlanProductsLoadingPromise = null;
    }
  })();
  await productionPlanProductsLoadingPromise;
}
function renderProductionPlanProductOptions() {
  const listEl = document.getElementById("production-plan-product-list");
  if (!listEl) return;
  updateProductionPlanSelectedSummary();
  if (!productionPlanProductOptions.length) {
    listEl.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px 0">\u6682\u65E0\u5546\u54C1</div>';
    return;
  }
  const list = productionPlanProductOptions;
  const allSelected = list.length > 0 && list.every((prod) => productionPlanSelectedIds.has(Number(prod.id || 0)));
  listEl.innerHTML = `
    <table style="width:100%; border-collapse:collapse">
      <thead>
        <tr style="border-bottom:1px solid #334155; color:#94a3b8; font-size:12px; text-align:left">
          <th style="padding:8px; width:40px; text-align:center"><input type="checkbox" ${allSelected ? "checked" : ""} onclick="toggleAllProductionPlanProducts(this)"></th>
          <th style="padding:8px; width:64px">\u56FE\u7247</th>
          <th style="padding:8px">\u7F16\u53F7</th>
          <th style="padding:8px">\u540D\u79F0</th>
          <th style="padding:8px">\u4E2D\u6587\u540D\u79F0</th>
          <th style="padding:8px">\u89C4\u683C</th>
          <th style="padding:8px; text-align:right">\u5E93\u5B58</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((prod) => {
    const prodId = Number(prod.id || 0);
    const checked = productionPlanSelectedIds.has(prodId);
    const rowBg = checked ? "rgba(26,115,232,0.16)" : "transparent";
    return `
            <tr onclick="toggleProductionPlanProduct(${prodId}, event)" style="border-bottom:1px solid #1e293b; cursor:pointer; background:${rowBg}">
              <td style="padding:8px; text-align:center">
                <input type="checkbox" ${checked ? "checked" : ""} onclick="event.stopPropagation()" onchange="toggleProductionPlanProduct(${prodId})">
              </td>
              <td style="padding:8px">
                ${prod.image ? `<img src="${prod.image}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; border:1px solid #334155">` : '<div style="width:48px; height:48px; background:#0f172a; border-radius:4px; border:1px solid #334155"></div>'}
              </td>
              <td style="padding:8px; color:#94a3b8">${escapeHtml(String(prod.sku || ""))}</td>
              <td style="padding:8px; color:#e2e8f0; font-weight:500">${escapeHtml(String(prod.name || ""))}</td>
              <td style="padding:8px; color:#94a3b8">${escapeHtml(String(prod.name_cn || ""))}</td>
              <td style="padding:8px; color:#94a3b8">${escapeHtml(String(prod.spec || ""))}</td>
              <td style="padding:8px; text-align:right; color:#64748b">${escapeHtml(String(Number(prod.stock || 0)))}</td>
            </tr>
          `;
  }).join("")}
      </tbody>
    </table>
  `;
}
window.toggleProductionPlanProduct = function(id, evt) {
  if (evt && typeof evt.stopPropagation === "function") evt.stopPropagation();
  const productId = Number(id || 0);
  if (!productId) return;
  if (productionPlanSelectedIds.has(productId)) productionPlanSelectedIds.delete(productId);
  else productionPlanSelectedIds.add(productId);
  renderProductionPlanProductOptions();
};
window.toggleAllProductionPlanProducts = function(checkbox) {
  const shouldSelectAll = !!(checkbox == null ? void 0 : checkbox.checked);
  if (shouldSelectAll) {
    productionPlanSelectedIds = new Set(
      productionPlanProductOptions.map((prod) => Number(prod.id || 0)).filter((id) => id > 0)
    );
  } else {
    productionPlanSelectedIds = /* @__PURE__ */ new Set();
  }
  renderProductionPlanProductOptions();
};
function syncTaskModeUI(tab) {
  const manualPanel = document.getElementById("task-manual-panel");
  const manualTableWrap = document.getElementById("task-manual-table-wrap");
  const manualPager = document.getElementById("task-pager");
  const autoPanel = document.getElementById("auto-task-panel");
  const productionPanel = document.getElementById("production-plan-panel");
  const productionCompletedPanel = document.getElementById("production-plan-completed-panel");
  const globalPager = document.getElementById("global-pager");
  const globalPagerControls = document.getElementById("global-pager-controls");
  const globalPagerInfo = document.getElementById("pay-footer-info");
  const createBtn = document.getElementById("task-create-btn");
  const autoCreateBtn = document.getElementById("auto-task-create-btn");
  const productionCreateBtn = document.getElementById("production-plan-create-btn");
  const isAuto = tab === "auto";
  const isProductionPlan = tab === "production-plan";
  const isProductionCompleted = tab === "production-completed";
  if (manualPanel) manualPanel.style.display = "block";
  if (manualTableWrap) manualTableWrap.style.display = isAuto || isProductionPlan || isProductionCompleted ? "none" : "block";
  if (manualPager) manualPager.style.display = isAuto || isProductionPlan || isProductionCompleted ? "none" : "flex";
  if (autoPanel) autoPanel.style.display = isAuto ? "block" : "none";
  if (productionPanel) productionPanel.style.display = isProductionPlan ? "block" : "none";
  if (productionCompletedPanel) productionCompletedPanel.style.display = isProductionCompleted && currentCompletedProductionPlanGroups.length ? "block" : "none";
  if (createBtn) createBtn.style.display = isAuto || isProductionPlan || isProductionCompleted ? "none" : "inline-flex";
  if (autoCreateBtn) autoCreateBtn.style.display = isAuto ? "inline-flex" : "none";
  if (productionCreateBtn) productionCreateBtn.style.display = isProductionPlan ? "inline-flex" : "none";
  if ((isProductionPlan || isProductionCompleted) && globalPager) globalPager.style.display = "none";
  if ((isProductionPlan || isProductionCompleted) && globalPagerControls) globalPagerControls.innerHTML = "";
  if ((isProductionPlan || isProductionCompleted) && globalPagerInfo) globalPagerInfo.innerHTML = "";
}
function syncProductionPlanLocale() {
  const isEs = getCurrentAppLocale() === "es-ES";
  const createBtn = document.getElementById("production-plan-create-btn");
  const tabBtn = document.getElementById("task-tab-production-plan");
  const currentTitleText = document.getElementById("production-plan-current-title-text");
  const nextTitleText = document.getElementById("production-plan-next-title-text");
  const currentWeekdayHeader = document.getElementById("production-plan-current-weekday-header");
  const nextWeekdayHeader = document.getElementById("production-plan-next-weekday-header");
  if (createBtn) createBtn.textContent = isEs ? "+ Nuevo plan" : "+ \u65B0\u5EFA\u8BA1\u5212";
  if (tabBtn) tabBtn.textContent = isEs ? "Produccion" : "\u751F\u4EA7\u8BA1\u5212";
  if (currentTitleText) currentTitleText.textContent = isEs ? "Produccion" : "\u672C\u5468\u751F\u4EA7";
  if (nextTitleText) nextTitleText.textContent = isEs ? "Plan para proxima semana" : "\u4E0B\u5468\u751F\u4EA7\u8BA1\u5212";
  if (currentWeekdayHeader) currentWeekdayHeader.textContent = isEs ? "Semana" : "\u661F\u671F";
  if (nextWeekdayHeader) nextWeekdayHeader.textContent = isEs ? "Semana" : "\u661F\u671F";
}
syncProductionPlanLocale();
async function loadCompletedProductionPlans() {
  const panel = document.getElementById("production-plan-completed-panel");
  const listEl = document.getElementById("production-plan-completed-list");
  if (!panel || !listEl) return;
  listEl.innerHTML = '<div style="padding:16px; color:#94a3b8">\u52A0\u8F7D\u4E2D...</div>';
  panel.style.display = currentTaskTab === "production-completed" ? "block" : "none";
  const res = await fetchWithAuth(`/api/production-plans/completed?_t=${Date.now()}`);
  if (!res.ok) {
    currentCompletedProductionPlanGroups = [];
    listEl.innerHTML = "";
    panel.style.display = "none";
    return;
  }
  const data = await res.json();
  currentCompletedProductionPlanGroups = Array.isArray(data.groups) ? data.groups : [];
  renderCompletedProductionPlanGroups(currentCompletedProductionPlanGroups);
}
async function loadAutoTasks() {
  const res = await fetchWithAuth(`/api/auto-tasks?_t=${Date.now()}`);
  if (!res.ok) return;
  const list = await res.json();
  currentAutoTaskList = Array.isArray(list) ? list : [];
  const tbody = document.getElementById("auto-task-rows");
  if (!tbody) return;
  if (!currentAutoTaskList.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="11">\u6682\u65E0\u81EA\u52A8\u4EFB\u52A1</td></tr>';
    return;
  }
  tbody.innerHTML = currentAutoTaskList.map((t, idx) => `
    <tr>
      <td>${currentAutoTaskList.length - idx}</td>
      <td style="white-space:normal; word-break:break-word; line-height:1.5; font-weight:600">${escapeHtml(t.title || "")}</td>
      <td style="white-space:pre-wrap; word-break:break-word; line-height:1.5; color:#cbd5e1">${escapeHtml(t.description || "")}</td>
      <td style="white-space:normal; word-break:break-word">${escapeHtml(t.assigned_to || "")}</td>
      <td style="white-space:normal">${escapeHtml(formatAutoTaskInterval(t.interval_months))}</td>
      <td style="white-space:normal">${escapeHtml(formatTaskTimeLimit(t.time_limit))}</td>
      <td style="white-space:normal; line-height:1.25">${formatDateTimeTwoLines(t.start_at)}</td>
      <td style="white-space:normal; line-height:1.25">${formatDateTimeTwoLines(t.next_generate_at)}</td>
      <td style="white-space:normal; line-height:1.25"><div style="word-break:break-word">${escapeHtml(t.created_by || "")}</div><div style="font-size:12px; color:#94a3b8; margin-top:2px">${formatDateTimeTwoLines(t.created_at)}</div></td>
      <td style="white-space:normal"><span class="tag ${t.active ? "green" : "orange"}">${t.active ? "\u542F\u7528\u4E2D" : "\u5DF2\u505C\u7528"}</span></td>
      <td style="white-space:normal">
        <div style="display:flex; flex-direction:column; gap:8px; align-items:stretch">
          <button class="btn-sm btn-secondary" style="width:100%; margin:0" onclick="editAutoTask(${t.id})">\u7F16\u8F91</button>
          <button class="btn-sm" style="width:100%; margin:0" onclick="toggleAutoTask(${t.id}, ${t.active ? "false" : "true"})">${t.active ? "\u505C\u7528" : "\u542F\u7528"}</button>
        </div>
      </td>
    </tr>
  `).join("");
}
function renderProductionPlanTableRows(list, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!Array.isArray(list) || !list.length) {
    tbody.innerHTML = "";
    return;
  }
  const productMetaMap = new Map(productionPlanProductOptions.map((prod) => [Number(prod.id || 0), prod]));
  tbody.innerHTML = list.map((item, idx) => buildProductionPlanRowHtml(item, idx, productMetaMap, { tbodyId, showDragHandle: true })).join("");
}
window.startProductionPlanDrag = function(id, tbodyId, event) {
  if (!(event == null ? void 0 : event.dataTransfer)) return;
  productionPlanDragState = { planId: Number(id || 0), tbodyId: String(tbodyId || ""), overPlanId: 0, dropPosition: "after" };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(id || ""));
  clearProductionPlanDragMarkers(tbodyId);
  requestAnimationFrame(() => {
    const row = document.querySelector(`#${tbodyId} tr[data-plan-id="${Number(id || 0)}"]`);
    if (row) row.classList.add("plan-row-dragging");
  });
};
window.handleProductionPlanDragOver = function(tbodyId, event) {
  if (productionPlanDragState.tbodyId !== String(tbodyId || "")) return;
  event.preventDefault();
  const row = event.target.closest(`tbody#${tbodyId} tr[data-plan-id]`);
  if (!row) return;
  const overPlanId = Number(row.dataset.planId || 0);
  if (!overPlanId || overPlanId === productionPlanDragState.planId) return;
  const rect = row.getBoundingClientRect();
  const dropPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  clearProductionPlanDragMarkers(tbodyId);
  const draggingRow = document.querySelector(`#${tbodyId} tr[data-plan-id="${productionPlanDragState.planId}"]`);
  if (draggingRow) draggingRow.classList.add("plan-row-dragging");
  row.classList.add(dropPosition === "before" ? "plan-drop-before" : "plan-drop-after");
  productionPlanDragState.overPlanId = overPlanId;
  productionPlanDragState.dropPosition = dropPosition;
};
window.handleProductionPlanDrop = async function(tbodyId, event) {
  if (productionPlanDragState.tbodyId !== String(tbodyId || "")) return;
  event.preventDefault();
  const { planId, overPlanId, dropPosition } = productionPlanDragState;
  const tbody = document.getElementById(tbodyId);
  const dragRow = tbody == null ? void 0 : tbody.querySelector(`tr[data-plan-id="${planId}"]`);
  const overRow = tbody == null ? void 0 : tbody.querySelector(`tr[data-plan-id="${overPlanId}"]`);
  if (!tbody || !dragRow || !overRow || planId === overPlanId) {
    clearProductionPlanDragMarkers(tbodyId);
    return;
  }
  const prevList = currentProductionPlanList.slice();
  if (dropPosition === "before") tbody.insertBefore(dragRow, overRow);
  else tbody.insertBefore(dragRow, overRow.nextSibling);
  const orderedIds = [...tbody.querySelectorAll("tr[data-plan-id]")].map((row) => Number(row.dataset.planId || 0)).filter((id) => id > 0);
  applyProductionPlanOrderToState(tbodyId, orderedIds);
  rerenderProductionPlanTablesFromState();
  clearProductionPlanDragMarkers(tbodyId);
  productionPlanDragState = { planId: 0, tbodyId: "", overPlanId: 0, dropPosition: "after" };
  const res = await fetchWithAuth("/api/production-plans/reorder", {
    method: "PUT",
    body: JSON.stringify({ ids: orderedIds })
  });
  if (!res.ok) {
    currentProductionPlanList = prevList;
    rerenderProductionPlanTablesFromState();
    showAppToast("\u6392\u5E8F\u4FDD\u5B58\u5931\u8D25");
    await loadProductionPlans();
    return;
  }
  showAppToast("\u6392\u5E8F\u5DF2\u66F4\u65B0");
};
window.endProductionPlanDrag = function(tbodyId) {
  clearProductionPlanDragMarkers(tbodyId);
  productionPlanDragState = { planId: 0, tbodyId: "", overPlanId: 0, dropPosition: "after" };
};
function renderCompletedProductionPlanGroups(groups = []) {
  const panel = document.getElementById("production-plan-completed-panel");
  const listEl = document.getElementById("production-plan-completed-list");
  if (!panel || !listEl) return;
  if (!Array.isArray(groups) || !groups.length) {
    listEl.innerHTML = "";
    panel.style.display = "none";
    return;
  }
  const productMetaMap = new Map(productionPlanProductOptions.map((prod) => [Number(prod.id || 0), prod]));
  listEl.innerHTML = groups.map((group, groupIdx) => {
    const items = Array.isArray(group.items) ? group.items : [];
    const periodText = formatProductionPlanPeriod({ plan_start: Number(group.plan_start || 0), plan_end: Number(group.plan_end || 0) });
    const groupCompletedAt = Number(group.completed_at || 0);
    const groupCompletedHtml = groupCompletedAt ? `<span style="margin-left:12px; font-size:12px; color:#94a3b8; font-weight:500">\u5B8C\u6210\u65F6\u95F4\uFF1A${formatDateTimeSafe(groupCompletedAt)}</span>` : "";
    return `
      <div class="card table-wrap" style="padding-top:0; ${groupIdx > 0 ? "margin-top:16px;" : ""}">
        <div style="font-weight:700; margin:4px 0 10px 0">\u751F\u4EA7\u5DF2\u5B8C\u6210<span style="margin-left:8px; font-size:12px; color:#94a3b8; font-weight:500">${escapeHtml(periodText)}</span>${groupCompletedHtml}</div>
        <table class="table">
          <thead>
            <tr>
              <th style="width:60px">\u5E8F\u53F7</th>
              <th style="width:96px">\u661F\u671F</th>
              <th style="width:72px">\u56FE\u7247</th>
              <th>\u5546\u54C1\u540D\u79F0</th>
              <th>\u539F\u6599\u540D\u79F0</th>
              <th style="width:160px">\u751F\u4EA7\u91CF\uFF08\u539F\u6599\uFF09kg</th>
              <th style="width:180px">\u786E\u8BA4\u4FE1\u606F</th>
            </tr>
          </thead>
          <tbody>${items.map((item, idx) => buildProductionPlanRowHtml(item, idx, productMetaMap, { readOnly: true })).join("")}</tbody>
        </table>
      </div>
    `;
  }).join("");
  panel.style.display = currentTaskTab === "production-completed" ? "block" : "none";
}
async function updateProductionPlanInlineFields(id, fields = {}, successText = "\u4FDD\u5B58\u6210\u529F") {
  const item = currentProductionPlanList.find((x) => Number(x.id) === Number(id));
  if (!item) {
    showAppToast("\u8BA1\u5212\u4E0D\u5B58\u5728");
    return false;
  }
  if ("material_name" in fields && String(fields.material_name || "").trim()) {
    productionPlanInvalidMaterialIds.delete(Number(id));
  }
  if ("material_qty" in fields) {
    const qtyValue = Number(fields.material_qty || 0);
    if (Number.isFinite(qtyValue) && qtyValue > 0) productionPlanInvalidQtyIds.delete(Number(id));
  }
  rerenderProductionPlanTablesFromState();
  const payload = {
    start_date: formatDateFromTs(Number(item.plan_start || item.week_start || 0)),
    end_date: formatDateFromTs(Number(item.plan_end || item.plan_start || item.week_start || 0)),
    product_ids: [Number(item.product_id || 0)],
    ...fields
  };
  const res = await fetchWithAuth(`/api/production-plans/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    showAppToast("\u4FDD\u5B58\u5931\u8D25");
    await loadProductionPlans();
    return false;
  }
  await loadProductionPlans();
  showAppToast(successText);
  return true;
}
function ensureProductionPlanQtyPopover() {
  if (productionPlanQtyPopoverEl) return productionPlanQtyPopoverEl;
  productionPlanQtyPopoverEl = document.createElement("div");
  productionPlanQtyPopoverEl.style.position = "fixed";
  productionPlanQtyPopoverEl.style.zIndex = "460";
  productionPlanQtyPopoverEl.style.display = "none";
  productionPlanQtyPopoverEl.style.background = "#0f172a";
  productionPlanQtyPopoverEl.style.border = "1px solid #334155";
  productionPlanQtyPopoverEl.style.borderRadius = "10px";
  productionPlanQtyPopoverEl.style.boxShadow = "0 12px 32px rgba(2, 6, 23, 0.45)";
  productionPlanQtyPopoverEl.style.padding = "8px";
  productionPlanQtyPopoverEl.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
  productionPlanQtyPopoverEl.style.gap = "6px";
  productionPlanQtyPopoverEl.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.body.appendChild(productionPlanQtyPopoverEl);
  return productionPlanQtyPopoverEl;
}
function hideProductionPlanMaterialQtyOptions() {
  if (productionPlanQtyPopoverHideTimer) {
    clearTimeout(productionPlanQtyPopoverHideTimer);
    productionPlanQtyPopoverHideTimer = null;
  }
  if (productionPlanQtyPopoverEl) productionPlanQtyPopoverEl.style.display = "none";
  productionPlanQtyActiveInput = null;
}
window.hideProductionPlanMaterialQtyOptionsLater = function() {
  if (productionPlanQtyPopoverHideTimer) clearTimeout(productionPlanQtyPopoverHideTimer);
  productionPlanQtyPopoverHideTimer = setTimeout(() => {
    hideProductionPlanMaterialQtyOptions();
  }, 160);
};
window.showProductionPlanMaterialQtyOptions = function(id, inputEl) {
  if (!inputEl || inputEl.disabled) return;
  if (productionPlanQtyPopoverHideTimer) {
    clearTimeout(productionPlanQtyPopoverHideTimer);
    productionPlanQtyPopoverHideTimer = null;
  }
  const popover = ensureProductionPlanQtyPopover();
  productionPlanQtyActiveInput = inputEl;
  popover.innerHTML = productionPlanQtyQuickOptions.map((value) => `<button type="button" onclick="selectProductionPlanMaterialQtyOption(${Number(id || 0)}, '${value}')" style="height:32px; border:1px solid #334155; border-radius:8px; background:#111827; color:#e2e8f0; cursor:pointer">${value}</button>`).join("");
  popover.style.display = "grid";
  const rect = inputEl.getBoundingClientRect();
  popover.style.width = `${Math.max(rect.width, 180)}px`;
  popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 180) - 12))}px`;
  popover.style.top = `${Math.min(window.innerHeight - 12, rect.bottom + 6)}px`;
};
window.openProductionPlanMaterialSelector = function(id) {
  if (!rsSelModal) return;
  productionPlanMaterialSelectTargetId = Number(id || 0);
  window.selectedRawMaterials = /* @__PURE__ */ new Map();
  const item = currentProductionPlanList.find((x) => Number(x.id) === productionPlanMaterialSelectTargetId);
  const currentMaterialName = String((item == null ? void 0 : item.material_name) || "").trim();
  const matched = rsMaterialOptions.find((x) => String(x.name || "").trim() === currentMaterialName);
  if (matched) window.selectedRawMaterials.set(Number(matched.id), matched);
  const titleEl = document.getElementById("rs-sel-title");
  const confirmEl = document.getElementById("rs-sel-confirm");
  if (titleEl) titleEl.textContent = "\u9009\u62E9\u539F\u6599\u540D\u79F0";
  if (confirmEl) confirmEl.textContent = "\u786E\u8BA4\u9009\u62E9";
  if (rsSelSearch) rsSelSearch.value = currentMaterialName;
  rsSelModal.style.display = "flex";
  loadRawMaterialSelector(1);
};
window.updateProductionPlanMaterialQty = async function(id, rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) {
    await updateProductionPlanInlineFields(id, { material_qty: "" }, "\u751F\u4EA7\u91CF\u5DF2\u6E05\u7A7A");
    return;
  }
  const qty = Number(text);
  if (!Number.isFinite(qty) || qty < 0) {
    showAppToast("\u8BF7\u8F93\u5165\u6B63\u786E\u7684kg\u6570\u91CF");
    await loadProductionPlans();
    return;
  }
  await updateProductionPlanInlineFields(id, { material_qty: qty }, "\u751F\u4EA7\u91CF\u5DF2\u66F4\u65B0");
};
window.selectProductionPlanMaterialQtyOption = async function(id, value) {
  if (productionPlanQtyActiveInput) productionPlanQtyActiveInput.value = value;
  hideProductionPlanMaterialQtyOptions();
  await updateProductionPlanMaterialQty(id, value);
};
document.addEventListener("pointerdown", (event) => {
  var _a2;
  if (!productionPlanQtyPopoverEl || productionPlanQtyPopoverEl.style.display === "none") return;
  const target = event.target;
  if (productionPlanQtyPopoverEl.contains(target)) return;
  if (productionPlanQtyActiveInput && ((_a2 = productionPlanQtyActiveInput.contains) == null ? void 0 : _a2.call(productionPlanQtyActiveInput, target))) return;
  if (productionPlanQtyActiveInput === target) return;
  hideProductionPlanMaterialQtyOptions();
});
async function loadProductionPlans() {
  const tzOffsetMinutes = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  const res = await fetchWithAuth(`/api/production-plans?tz_offset_minutes=${encodeURIComponent(tzOffsetMinutes)}&_t=${Date.now()}`);
  if (!res.ok) {
    showAppToast("\u751F\u4EA7\u8BA1\u5212\u52A0\u8F7D\u5931\u8D25");
    return;
  }
  const data = await res.json();
  const currentWeek = Array.isArray(data.currentWeek) ? data.currentWeek : [];
  const nextWeek = Array.isArray(data.nextWeek) ? data.nextWeek : [];
  const futureGroups = Array.isArray(data.futureGroups) ? data.futureGroups : [];
  const panel = document.getElementById("production-plan-panel");
  const currentSection = document.getElementById("production-plan-current-section");
  const nextSection = document.getElementById("production-plan-next-section");
  const currentTitlePeriod = document.getElementById("production-plan-current-title-period");
  const nextTitlePeriod = document.getElementById("production-plan-next-title-period");
  currentProductionPlanCurrentWeekIds = new Set(currentWeek.map((item) => Number(item.id || 0)).filter((id) => id > 0));
  currentProductionPlanNextWeekIds = new Set(nextWeek.map((item) => Number(item.id || 0)).filter((id) => id > 0));
  currentProductionPlanFutureGroups = futureGroups.map((group, idx) => ({
    key: String(group.key || `future-${idx}`),
    items: Array.isArray(group.items) ? group.items : []
  }));
  currentProductionPlanList = [...currentWeek, ...nextWeek, ...currentProductionPlanFutureGroups.flatMap((group) => group.items || [])];
  currentProductionPlanList.forEach((item) => {
    const itemId = Number(item.id || 0);
    if (String(item.material_name || "").trim()) productionPlanInvalidMaterialIds.delete(itemId);
    if (Number(item.material_qty || 0) > 0) productionPlanInvalidQtyIds.delete(itemId);
  });
  if (currentSection) currentSection.style.display = currentWeek.length ? "block" : "none";
  if (nextSection) nextSection.style.display = nextWeek.length ? "block" : "none";
  if (panel) panel.style.display = currentWeek.length || nextWeek.length || currentProductionPlanFutureGroups.length ? "block" : "none";
  syncProductionPlanLocale();
  if (currentTitlePeriod) currentTitlePeriod.textContent = formatProductionPlanTitlePeriod(currentWeek);
  if (nextTitlePeriod) nextTitlePeriod.textContent = formatProductionPlanTitlePeriod(nextWeek);
  syncProductionPlanGroupEditButtons();
  renderProductionPlanTableRows(currentWeek, "production-plan-current-rows");
  renderProductionPlanTableRows(nextWeek, "production-plan-next-rows");
  renderFutureProductionPlanGroups(currentProductionPlanFutureGroups);
}
async function loadTasks(tab = "new", btn = null, page = 1) {
  var _a2, _b2;
  currentTaskTab = tab;
  currentTaskPage = page;
  syncTaskModeUI(tab);
  if (btn) {
    document.querySelectorAll("#page-tasks .tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  } else {
    const tBtn = document.querySelector(`#page-tasks .tab[data-tab="${tab}"]`);
    if (tBtn) {
      document.querySelectorAll("#page-tasks .tab").forEach((b) => b.classList.remove("active"));
      tBtn.classList.add("active");
    }
  }
  if (tab === "auto") {
    await loadAutoTasks();
    return;
  }
  if (tab === "production-plan") {
    await ensureProductionPlanProductsLoaded();
    await loadProductionPlans();
    return;
  }
  if (tab === "production-completed") {
    await ensureProductionPlanProductsLoaded();
    await loadCompletedProductionPlans();
    return;
  }
  let status = "new";
  if (tab === "review") status = "review";
  else if (tab === "completed") status = "completed";
  const res = await fetchWithAuth(`/api/tasks?status=${status}&page=${page}&size=100&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  currentTasksList = list;
  const total = data.total || 0;
  const stats = data.stats || { new_count: 0, review_count: 0 };
  const newCount = Number(stats.new_count || 0);
  const reviewCount = Number(stats.review_count || 0);
  const totalCount = newCount + reviewCount;
  const updateBadge = (id, count) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = count;
      el.style.display = count > 0 ? "inline-block" : "none";
    }
  };
  updateBadge("nav-task-badge", totalCount);
  updateBadge("tab-new-badge", newCount);
  updateBadge("tab-review-badge", reviewCount);
  const tbody = document.getElementById("task-rows");
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr class="empty"><td colspan="8">\u6682\u65E0\u4EFB\u52A1</td></tr>';
    renderTaskPager(0, 1, 100);
    return;
  }
  const meRes = await fetchWithAuth("/api/auth/me");
  const me = await meRes.json();
  const isAdmin = ((_a2 = me.user) == null ? void 0 : _a2.role) === "\u8D85\u7EA7\u7BA1\u7406\u5458";
  const myName = (_b2 = me.user) == null ? void 0 : _b2.name;
  tbody.innerHTML = list.map((t, idx) => {
    let action = "";
    if (t.status === "pending" || !t.status) {
      if (t.assigned_to === myName || isAdmin) {
        action = `<button class="btn-sm" onclick="completeTask(${t.id})">\u5B8C\u6210\u4EFB\u52A1</button>`;
      }
      if (t.created_by === myName || isAdmin) {
        action += `<button class="btn-sm btn-secondary" style="margin-left:4px" onclick="editTask(${t.id})">\u4FEE\u6539</button>`;
      }
    } else if (t.status === "waiting_audit") {
      if (isAdmin) {
        action = `<button class="btn-sm" onclick="auditTask(${t.id})">\u786E\u8BA4\u5BA1\u6838</button>`;
      } else {
        action = '<span style="color:#666;font-size:12px">\u7B49\u5F85\u5BA1\u6838</span>';
      }
    }
    let descInfo = t.description || "";
    if (t.completion_desc) {
      descInfo += `<div style="margin-top:4px; font-size:12px; color:#94a3b8; border-top:1px dashed #334155; padding-top:4px">
        <span style="color:#22c55e">\u5B8C\u6210\u5907\u6CE8:</span> ${t.completion_desc}
      </div>`;
    }
    if (t.completion_image) {
      if (t.completion_image.startsWith("data:image/")) {
        descInfo += `<div style="margin-top:4px">
          <img src="${t.completion_image}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; cursor:zoom-in; border:1px solid #334155" onclick="showTaskImage(this.src)" title="\u70B9\u51FB\u653E\u5927">
        </div>`;
      } else {
        descInfo += `<div style="margin-top:4px">
          <a href="${t.completion_image}" download="\u4EFB\u52A1\u9644\u4EF6" style="display:inline-block; padding:4px 8px; background:#334155; color:#cbd5e1; border-radius:4px; font-size:12px; text-decoration:none">\u{1F4E5} \u4E0B\u8F7D\u9644\u4EF6</a>
        </div>`;
      }
    }
    let assignInfo = t.assigned_to || "";
    if (t.completed_at) {
      assignInfo += `<div style="margin-top:4px; font-size:11px; color:#94a3b8">\u5B8C\u6210\u4E8E:<br>${formatDisplayDateTimeValue(Number(t.completed_at))}</div>`;
    }
    let timeLimitText = "-";
    if (t.time_limit) {
      const limitDays = Number(t.time_limit);
      let label = limitDays + "\u5929\u5185";
      if (limitDays === 7) label = "\u4E00\u5468\u5185";
      if (limitDays === 30) label = "\u4E00\u4E2A\u6708";
      const deadline = Number(t.created_at) + limitDays * 24 * 60 * 60 * 1e3;
      const isOverdue = (t.status === "pending" || !t.status) && Date.now() > deadline;
      timeLimitText = isOverdue ? `<span style="color:#ef4444; font-weight:bold">\u5DF2\u903E\u671F</span>` : label;
    }
    return `
    <tr>
      <td>${total - (page - 1) * 100 - idx}</td>
      <td>${t.title || ""}</td>
      <td>${descInfo}</td>
      <td>${assignInfo}</td>
      <td>${t.created_by || ""}<br><span style="font-size:12px;color:#666">${formatDisplayDateTimeValue(Number(t.created_at))}</span></td>
      <td>${timeLimitText}</td>
      <td><span class="tag ${t.status === "completed" ? "green" : t.status === "waiting_audit" ? "orange" : "blue"}" style="cursor:pointer; text-decoration:underline" onclick="openTaskDetailsModal(${t.id})" title="\u70B9\u51FB\u67E5\u770B\u8BE6\u60C5">
        ${t.status === "completed" ? "\u5DF2\u5B8C\u6210" : t.status === "waiting_audit" ? "\u5BA1\u6838\u4E2D" : "\u65B0\u4EFB\u52A1"}
      </span></td>
      <td>${action}</td>
    </tr>
  `;
  }).join("");
  renderTaskPager(total, page, 100);
}
function renderTaskPager(total, page, size) {
  const totalPages = Math.ceil(total / size);
  const pager = document.getElementById("task-pager");
  if (!pager) return;
  if (totalPages <= 1) {
    pager.style.display = "none";
    return;
  }
  pager.style.display = "flex";
  let html = "";
  html += `<button class="btn-secondary" ${page <= 1 ? "disabled" : ""} onclick="loadTasks(currentTaskTab, null, ${page - 1})">\u4E0A\u4E00\u9875</button>`;
  html += `<span style="font-size:14px; color:#cbd5e1">\u7B2C ${page} / ${totalPages} \u9875</span>`;
  html += `<button class="btn-secondary" ${page >= totalPages ? "disabled" : ""} onclick="loadTasks(currentTaskTab, null, ${page + 1})">\u4E0B\u4E00\u9875</button>`;
  pager.innerHTML = html;
}
function fallbackTaskUsers() {
  return [
    { name: "\u8D85\u7EA7\u7BA1\u7406\u5458", role: "\u8D85\u7EA7\u7BA1\u7406\u5458" },
    { name: "shuangqun", role: "\u80A1\u4E1C" },
    { name: "caiwu", role: "\u8D22\u52A1" },
    { name: "kefu", role: "\u5BA2\u670D" }
  ];
}
async function loadAssignableUsers(listId, inputId) {
  const listDiv = document.getElementById(listId);
  if (!listDiv) return;
  listDiv.innerHTML = "\u52A0\u8F7D\u4E2D...";
  try {
    const r = await fetchWithAuth("/api/auth/users");
    if (!r.ok) throw new Error("API Error: " + r.status);
    const users = await r.json();
    renderAssignableUsers(Array.isArray(users) && users.length ? users : fallbackTaskUsers(), listId, inputId);
  } catch (e) {
    console.warn("Failed to load users, using fallback:", e);
    renderAssignableUsers(fallbackTaskUsers(), listId, inputId);
  }
}
function renderAssignableUsers(users, listId, inputId) {
  var _a2;
  const listDiv = document.getElementById(listId);
  const currentAssign = ((_a2 = document.getElementById(inputId)) == null ? void 0 : _a2.value) || "";
  if (!listDiv) return;
  listDiv.innerHTML = users.map((u) => {
    const selected = u.name === currentAssign;
    return `
      <div class="user-chip" onclick="selectTaskAssignee('${listId}', '${inputId}', '${encodeURIComponent(u.name)}')"
           style="border:1px solid ${selected ? "#1a73e8" : "#334155"}; padding:8px; border-radius:6px; cursor:pointer; text-align:center; background:${selected ? "#1a73e8" : "#0f172a"}; color:${selected ? "#fff" : "#cbd5e1"}; user-select:none; display:flex; flex-direction:column; align-items:center; gap:4px">
        <span style="font-weight:600">${escapeHtml(u.name || "")}</span>
        <span style="font-size:10px; opacity:0.7; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px">${escapeHtml(u.role || "\u5458\u5DE5")}</span>
      </div>
    `;
  }).join("");
}
window.selectTaskAssignee = function(listId, inputId, encodedName) {
  const name = decodeURIComponent(encodedName || "");
  const input = document.getElementById(inputId);
  if (input) input.value = name;
  const listDiv = document.getElementById(listId);
  if (!listDiv) return;
  Array.from(listDiv.querySelectorAll(".user-chip")).forEach((chip) => {
    chip.style.borderColor = "#334155";
    chip.style.background = "#0f172a";
    chip.style.color = "#cbd5e1";
  });
  const target = Array.from(listDiv.querySelectorAll(".user-chip")).find((chip) => chip.textContent.includes(name));
  if (target) {
    target.style.borderColor = "#1a73e8";
    target.style.background = "#1a73e8";
    target.style.color = "#fff";
  }
};
function openTaskModal() {
  const m = document.getElementById("task-modal");
  if (!m) return;
  m.style.display = "flex";
  document.getElementById("task-modal-title").textContent = "\u521B\u5EFA\u4EFB\u52A1";
  document.getElementById("task-id").value = "";
  document.getElementById("task-title").value = "";
  document.getElementById("task-desc").value = "";
  document.getElementById("task-assign").value = "";
  const tl = document.getElementById("task-time-limit");
  if (tl) tl.value = "1";
  loadAssignableUsers("task-assign-list", "task-assign");
}
window.editTask = function(id) {
  const t = currentTasksList.find((x) => x.id === id);
  if (!t) return;
  openTaskModal();
  document.getElementById("task-modal-title").textContent = "\u4FEE\u6539\u4EFB\u52A1";
  document.getElementById("task-id").value = t.id;
  document.getElementById("task-title").value = t.title || "";
  document.getElementById("task-desc").value = t.description || "";
  document.getElementById("task-assign").value = t.assigned_to || "";
  if (document.getElementById("task-time-limit")) {
    document.getElementById("task-time-limit").value = t.time_limit || "1";
  }
  loadAssignableUsers("task-assign-list", "task-assign");
};
window.openTaskDetailsModal = function(id) {
  const t = currentTasksList.find((x) => x.id === id);
  if (!t) return;
  const m = document.getElementById("task-details-modal");
  const c = document.getElementById("task-details-content");
  if (m && c) {
    let statusStr = t.status === "completed" ? '<span style="color:#22c55e">\u5DF2\u5B8C\u6210</span>' : t.status === "waiting_audit" ? '<span style="color:#f97316">\u5BA1\u6838\u4E2D</span>' : '<span style="color:#3b82f6">\u65B0\u4EFB\u52A1</span>';
    let html = `
            <div style="margin-bottom:12px; font-size:18px; font-weight:bold; color:#fff">${t.title || "\u65E0\u6807\u9898"}</div>
            <div style="margin-bottom:8px"><strong>\u72B6\u6001\uFF1A</strong> ${statusStr}</div>
            <div style="margin-bottom:8px"><strong>\u6307\u6D3E\u7ED9\uFF1A</strong> ${t.assigned_to || "-"}</div>
            <div style="margin-bottom:8px"><strong>\u521B\u5EFA\u4EBA\uFF1A</strong> ${t.created_by || "-"}</div>
            <div style="margin-bottom:8px"><strong>\u521B\u5EFA\u65F6\u95F4\uFF1A</strong> ${formatDisplayDateTimeValue(Number(t.created_at))}</div>
        `;
    if (t.time_limit) {
      const limitDays = Number(t.time_limit);
      let label = limitDays + "\u5929\u5185";
      if (limitDays === 7) label = "\u4E00\u5468\u5185";
      if (limitDays === 30) label = "\u4E00\u4E2A\u6708";
      html += `<div style="margin-bottom:8px"><strong>\u65F6\u9650\uFF1A</strong> ${label}</div>`;
    }
    if (t.description) {
      html += `<div style="margin-bottom:12px; margin-top:16px; border-top:1px solid #334155; padding-top:12px"><strong>\u4EFB\u52A1\u63CF\u8FF0\uFF1A</strong><br><div style="white-space:pre-wrap; margin-top:8px; color:#cbd5e1">${t.description}</div></div>`;
    }
    if (t.completion_desc) {
      html += `<div style="margin-bottom:12px; margin-top:16px; border-top:1px dashed #334155; padding-top:12px"><strong>\u5B8C\u6210\u5907\u6CE8\uFF1A</strong><br><div style="white-space:pre-wrap; margin-top:8px; color:#22c55e">${t.completion_desc}</div></div>`;
    }
    if (t.completion_image) {
      if (t.completion_image.startsWith("data:image/")) {
        html += `<div style="margin-bottom:8px"><strong>\u5B8C\u6210\u9644\u4EF6\uFF1A</strong><br><img src="${t.completion_image}" style="max-width:100%; max-height:200px; border-radius:4px; margin-top:8px; cursor:zoom-in; border:1px solid #334155" onclick="showTaskImage(this.src)" title="\u70B9\u51FB\u653E\u5927"></div>`;
      } else {
        html += `<div style="margin-bottom:8px"><strong>\u5B8C\u6210\u9644\u4EF6\uFF1A</strong><br><a href="${t.completion_image}" download="\u4EFB\u52A1\u9644\u4EF6" style="display:inline-block; margin-top:8px; padding:6px 12px; background:#334155; color:#cbd5e1; border-radius:4px; font-size:13px; text-decoration:none">\u{1F4E5} \u4E0B\u8F7D\u9644\u4EF6</a></div>`;
      }
    }
    if (t.completed_at) {
      html += `<div style="margin-bottom:8px; color:#94a3b8"><strong>\u5B8C\u6210\u65F6\u95F4\uFF1A</strong> ${formatDisplayDateTimeValue(Number(t.completed_at))}</div>`;
    }
    c.innerHTML = html;
    m.style.display = "flex";
  }
};
function closeTaskModal() {
  const m = document.getElementById("task-modal");
  if (m) m.style.display = "none";
}
async function openProductionPlanModal() {
  const m = document.getElementById("production-plan-modal");
  if (!m) return;
  const nextWeekStart = getTaskWeekStartTs(1);
  m.style.display = "flex";
  document.getElementById("production-plan-modal-title").textContent = getCurrentAppLocale() === "es-ES" ? "Nuevo plan" : "\u65B0\u5EFA\u8BA1\u5212";
  document.getElementById("production-plan-id").value = "";
  document.getElementById("production-plan-mode").value = "create";
  document.getElementById("production-plan-group-ids").value = "";
  document.getElementById("production-plan-single-product-id").value = "";
  document.getElementById("production-plan-start-date").value = formatDateFromTs(nextWeekStart);
  document.getElementById("production-plan-end-date").value = formatDateFromTs(nextWeekStart + 5 * 24 * 60 * 60 * 1e3);
  setProductionPlanSelectedProducts([]);
  syncProductionPlanModalMode("create");
  await ensureProductionPlanProductsLoaded();
}
window.openProductionPlanDatePicker = function(inputId) {
  const inputEl = document.getElementById(String(inputId || "").trim());
  if (!inputEl) return;
  if (typeof inputEl.showPicker === "function") {
    try {
      inputEl.showPicker();
      return;
    } catch (_) {
    }
  }
  inputEl.focus();
  inputEl.click();
};
function renderProductionPlanSingleProductCard(item) {
  const cardEl = document.getElementById("production-plan-single-product-card");
  if (!cardEl) return;
  const productId = Number((item == null ? void 0 : item.product_id) || 0);
  const matchedProduct = productionPlanProductOptions.find((prod) => Number(prod.id || 0) === productId) || productionPlanProductOptions.find((prod) => String(prod.name || prod.name_cn || "").trim() === String((item == null ? void 0 : item.product_name) || "").trim()) || {};
  const productImage = String(matchedProduct.image || "").trim();
  const productName = String((item == null ? void 0 : item.product_name) || matchedProduct.name || matchedProduct.name_cn || "-").trim() || "-";
  const productNameCn = String(matchedProduct.name_cn || "").trim();
  cardEl.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px">
      ${productImage ? `<img src="${escapeHtml(productImage)}" style="width:52px; height:52px; object-fit:cover; border-radius:8px; border:1px solid #334155">` : '<div style="width:52px; height:52px; border-radius:8px; border:1px solid #334155; background:#0f172a"></div>'}
      <div style="min-width:0">
        <div style="font-weight:600; color:#e2e8f0">${escapeHtml(productName)}</div>
        ${productNameCn ? `<div style="margin-top:4px; font-size:12px; color:#94a3b8">${escapeHtml(productNameCn)}</div>` : ""}
      </div>
    </div>
  `;
}
function syncProductionPlanModalMode(mode, item = null) {
  const dateLabelEl = document.getElementById("production-plan-date-label");
  const dateGridEl = document.getElementById("production-plan-date-grid");
  const endWrapEl = document.getElementById("production-plan-end-date-wrap");
  const productSelectGroupEl = document.getElementById("production-plan-product-select-group");
  const singleProductGroupEl = document.getElementById("production-plan-single-product-group");
  const singleProductIdEl = document.getElementById("production-plan-single-product-id");
  if (dateLabelEl) dateLabelEl.textContent = mode === "single" ? "\u8BA1\u5212\u65E5\u671F" : "\u8BA1\u5212\u5468\u671F";
  if (dateGridEl) dateGridEl.style.gridTemplateColumns = mode === "single" ? "1fr" : "1fr 1fr";
  if (endWrapEl) endWrapEl.style.display = mode === "single" ? "none" : "";
  if (productSelectGroupEl) productSelectGroupEl.style.display = mode === "single" ? "none" : "block";
  if (singleProductGroupEl) singleProductGroupEl.style.display = mode === "single" ? "block" : "none";
  if (singleProductIdEl) singleProductIdEl.value = mode === "single" ? String(Number((item == null ? void 0 : item.product_id) || 0) || "") : "";
  if (mode === "single" && item) {
    renderProductionPlanSingleProductCard(item);
  }
  updateProductionPlanSelectedSummary();
}
window.editProductionPlan = async function(id) {
  const item = currentProductionPlanList.find((x) => Number(x.id) === Number(id));
  if (!item) return;
  await openProductionPlanModal();
  document.getElementById("production-plan-modal-title").textContent = `\u7F16\u8F91\uFF1A${item.product_name || "-"}`;
  document.getElementById("production-plan-id").value = String(item.id || "");
  document.getElementById("production-plan-mode").value = "single";
  document.getElementById("production-plan-start-date").value = formatDateFromTs(Number(item.plan_start || item.week_start || Date.now()));
  document.getElementById("production-plan-end-date").value = formatDateFromTs(Number(item.plan_start || item.week_start || Date.now()));
  setProductionPlanSelectedProducts([]);
  syncProductionPlanModalMode("single", item);
};
window.editProductionPlanGroup = async function(groupKey) {
  let list = getProductionPlanGroupItems(groupKey);
  if (!list.length) {
    const futureGroup = currentProductionPlanFutureGroups.find((group) => String(group.key || "") === String(groupKey || ""));
    list = Array.isArray(futureGroup == null ? void 0 : futureGroup.items) ? futureGroup.items : [];
  }
  if (!list.length) return showAppToast("\u8BA1\u5212\u4E0D\u5B58\u5728");
  await openProductionPlanModal();
  const starts = list.map((item) => Number(item.plan_start || item.week_start || 0)).filter((ts) => ts > 0);
  const ends = list.map((item) => Number(item.plan_end || item.plan_start || item.week_start || 0)).filter((ts) => ts > 0);
  document.getElementById("production-plan-modal-title").textContent = "\u7F16\u8F91\u8BA1\u5212";
  document.getElementById("production-plan-id").value = "";
  document.getElementById("production-plan-mode").value = "group";
  document.getElementById("production-plan-group-ids").value = list.map((item) => Number(item.id || 0)).filter(Boolean).join(",");
  if (starts.length) document.getElementById("production-plan-start-date").value = formatDateFromTs(Math.min(...starts));
  if (ends.length) document.getElementById("production-plan-end-date").value = formatDateFromTs(Math.max(...ends));
  setProductionPlanSelectedProducts([]);
  syncProductionPlanModalMode("group");
};
function closeProductionPlanModal() {
  const m = document.getElementById("production-plan-modal");
  if (m) m.style.display = "none";
}
async function saveProductionPlan() {
  var _a2, _b2, _c2, _d, _e, _f;
  const id = String(((_a2 = document.getElementById("production-plan-id")) == null ? void 0 : _a2.value) || "").trim();
  const mode = String(((_b2 = document.getElementById("production-plan-mode")) == null ? void 0 : _b2.value) || "create").trim();
  const groupIds = String(((_c2 = document.getElementById("production-plan-group-ids")) == null ? void 0 : _c2.value) || "").split(",").map((v) => parseInt(v, 10)).filter((v) => v > 0);
  const startDate = String(((_d = document.getElementById("production-plan-start-date")) == null ? void 0 : _d.value) || "").trim();
  const rawEndDate = String(((_e = document.getElementById("production-plan-end-date")) == null ? void 0 : _e.value) || "").trim();
  const singleProductId = parseInt(((_f = document.getElementById("production-plan-single-product-id")) == null ? void 0 : _f.value) || "0", 10);
  const endDate = mode === "single" ? startDate : rawEndDate;
  const productIds = mode === "single" ? singleProductId > 0 ? [singleProductId] : [] : [...productionPlanSelectedIds];
  if (!startDate) return showAppToast("\u8BF7\u9009\u62E9\u8BA1\u5212\u65E5\u671F");
  if (mode !== "single" && !endDate) return showAppToast("\u8BF7\u9009\u62E9\u8BA1\u5212\u65E5\u671F");
  if (mode !== "single" && endDate < startDate) return showAppToast("\u7ED3\u675F\u65E5\u671F\u4E0D\u80FD\u65E9\u4E8E\u5F00\u59CB\u65E5\u671F");
  if (!productIds.length && mode !== "group") return showAppToast(mode === "single" ? "\u5546\u54C1\u4E0D\u5B58\u5728" : "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5546\u54C1");
  if (mode === "single" && id && productIds.length !== 1) return showAppToast("\u7F16\u8F91\u65F6\u53EA\u80FD\u9009\u62E9\u5F53\u524D\u5546\u54C1");
  if (mode === "group" && !groupIds.length) return showAppToast("\u8BA1\u5212\u4E0D\u5B58\u5728");
  const url = mode === "group" ? "/api/production-plans/group" : id ? `/api/production-plans/${id}` : "/api/production-plans";
  const method = mode === "group" || id ? "PUT" : "POST";
  const res = await fetchWithAuth(url, {
    method,
    body: JSON.stringify({
      ids: mode === "group" ? groupIds : void 0,
      start_date: startDate,
      end_date: endDate,
      product_ids: productIds
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if ((err == null ? void 0 : err.error) === "confirmed_not_removable") return showAppToast("\u5DF2\u786E\u8BA4\u751F\u4EA7\u7684\u5546\u54C1\u4E0D\u53EF\u4ECE\u8BA1\u5212\u4E2D\u79FB\u9664");
    if ((err == null ? void 0 : err.error) === "server_error") return showAppToast("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    return showAppToast(id || mode === "group" ? "\u4FEE\u6539\u5931\u8D25" : "\u4FDD\u5B58\u5931\u8D25");
  }
  closeProductionPlanModal();
  await loadProductionPlans();
  showAppToast(id || mode === "group" ? "\u4FEE\u6539\u6210\u529F" : "\u4FDD\u5B58\u6210\u529F");
}
window.confirmProductionPlan = function(id) {
  const item = currentProductionPlanList.find((x) => Number(x.id) === Number(id));
  if (!item) return showAppToast("\u8BA1\u5212\u4E0D\u5B58\u5728");
  const missingMaterial = !String(item.material_name || "").trim();
  const missingQty = !(Number(item.material_qty || 0) > 0);
  if (missingMaterial || missingQty) {
    if (missingMaterial) productionPlanInvalidMaterialIds.add(Number(id));
    if (missingQty) productionPlanInvalidQtyIds.add(Number(id));
    rerenderProductionPlanTablesFromState();
    return showAppToast("\u8BF7\u5148\u586B\u5199\u539F\u6599\u540D\u79F0\u548C\u751F\u4EA7\u91CF");
  }
  openConfirm("\u786E\u8BA4\u8FD9\u6761\u8BA1\u5212\u5DF2\u8FDB\u5165\u751F\u4EA7\u5417\uFF1F", async () => {
    const res = await fetchWithAuth(`/api/production-plans/${id}/confirm`, { method: "PUT" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if ((err == null ? void 0 : err.error) === "material_not_found") return showAppToast("\u6240\u9009\u539F\u6750\u6599\u4E0D\u5B58\u5728");
      if ((err == null ? void 0 : err.error) === "insufficient_material_stock") {
        const materialName = String((err == null ? void 0 : err.materialName) || item.material_name || "").trim();
        const availableQty = Number((err == null ? void 0 : err.availableQty) || 0);
        return showAppToast(`${materialName || "\u539F\u6750\u6599"}\u5E93\u5B58\u4E0D\u8DB3\uFF0C\u5F53\u524D\u53EF\u7528 ${availableQty} kg`);
      }
      if ((err == null ? void 0 : err.error) === "bad_request") return showAppToast("\u8BF7\u5148\u586B\u5199\u6B63\u786E\u7684\u539F\u6599\u540D\u79F0\u548C\u751F\u4EA7\u91CF");
      return showAppToast("\u786E\u8BA4\u751F\u4EA7\u5931\u8D25");
    }
    await loadProductionPlans();
    showAppToast("\u5DF2\u786E\u8BA4\u751F\u4EA7");
  });
};
window.deleteProductionPlan = function(id) {
  const item = currentProductionPlanList.find((x) => Number(x.id) === Number(id));
  if (!item) return showAppToast("\u8BA1\u5212\u4E0D\u5B58\u5728");
  openConfirm("\u786E\u5B9A\u5220\u9664\u8FD9\u6761\u751F\u4EA7\u8BA1\u5212\u5417\uFF1F\u5220\u9664\u540E\u4E0D\u53EF\u6062\u590D\u3002", async () => {
    const res = await fetchWithAuth(`/api/production-plans/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if ((err == null ? void 0 : err.error) === "confirmed_not_deletable") return showAppToast("\u5DF2\u786E\u8BA4\u751F\u4EA7\u7684\u8BA1\u5212\u4E0D\u53EF\u5220\u9664");
      return showAppToast("\u5220\u9664\u5931\u8D25");
    }
    currentProductionPlanList = currentProductionPlanList.filter((x) => Number(x.id) !== Number(id));
    currentProductionPlanCurrentWeekIds.delete(Number(id));
    currentProductionPlanNextWeekIds.delete(Number(id));
    currentProductionPlanFutureGroups = currentProductionPlanFutureGroups.map((group) => ({ ...group, items: (Array.isArray(group.items) ? group.items : []).filter((x) => Number(x.id || 0) !== Number(id)) })).filter((group) => Array.isArray(group.items) && group.items.length);
    productionPlanInvalidMaterialIds.delete(Number(id));
    productionPlanInvalidQtyIds.delete(Number(id));
    rerenderProductionPlanTablesFromState();
    await loadProductionPlans();
    showAppToast("\u5220\u9664\u6210\u529F");
  });
};
async function saveTask() {
  const id = document.getElementById("task-id").value;
  const title = document.getElementById("task-title").value;
  const desc = document.getElementById("task-desc").value;
  const assign = document.getElementById("task-assign").value;
  const timeLimit = document.getElementById("task-time-limit") ? document.getElementById("task-time-limit").value : "0";
  if (!title) return alert("\u8BF7\u8F93\u5165\u6807\u9898");
  if (!assign) return alert("\u8BF7\u9009\u62E9\u6307\u6D3E\u4EBA\u5458");
  if (id) {
    await fetchWithAuth("/api/tasks/" + id, {
      method: "PUT",
      body: JSON.stringify({ title, description: desc, assigned_to: assign, time_limit: timeLimit })
    });
  } else {
    await fetchWithAuth("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, desc, assign, timeLimit })
    });
  }
  closeTaskModal();
  loadTasks(currentTaskTab);
  if (!id) {
    const badge = document.getElementById("nav-task-badge");
    if (badge) {
      const count = Number(badge.textContent || 0) + 1;
      badge.textContent = count;
      badge.style.display = "inline-block";
    }
  }
}
function openAutoTaskModal() {
  const m = document.getElementById("auto-task-modal");
  if (!m) return;
  m.style.display = "flex";
  document.getElementById("auto-task-modal-title").textContent = "\u6DFB\u52A0\u81EA\u52A8\u4EFB\u52A1";
  document.getElementById("auto-task-id").value = "";
  document.getElementById("auto-task-title").value = "";
  document.getElementById("auto-task-desc").value = "";
  document.getElementById("auto-task-assign").value = "";
  document.getElementById("auto-task-interval").value = "6";
  document.getElementById("auto-task-time-limit").value = "1";
  document.getElementById("auto-task-start-at").value = formatDateTimeLocalInput(Date.now());
  document.getElementById("auto-task-active").checked = true;
  loadAssignableUsers("auto-task-assign-list", "auto-task-assign");
}
window.editAutoTask = function(id) {
  var _a2;
  const t = currentAutoTaskList.find((x) => Number(x.id) === Number(id));
  if (!t) return;
  openAutoTaskModal();
  document.getElementById("auto-task-modal-title").textContent = "\u4FEE\u6539\u81EA\u52A8\u4EFB\u52A1";
  document.getElementById("auto-task-id").value = t.id;
  document.getElementById("auto-task-title").value = t.title || "";
  document.getElementById("auto-task-desc").value = t.description || "";
  document.getElementById("auto-task-assign").value = t.assigned_to || "";
  document.getElementById("auto-task-interval").value = String((_a2 = t.interval_months) != null ? _a2 : 6);
  document.getElementById("auto-task-time-limit").value = String(t.time_limit || 1);
  document.getElementById("auto-task-start-at").value = formatDateTimeLocalInput(t.start_at || t.created_at || 0);
  document.getElementById("auto-task-active").checked = !!t.active;
  loadAssignableUsers("auto-task-assign-list", "auto-task-assign");
};
function closeAutoTaskModal() {
  const m = document.getElementById("auto-task-modal");
  if (m) m.style.display = "none";
}
async function saveAutoTask() {
  const id = document.getElementById("auto-task-id").value;
  const title = document.getElementById("auto-task-title").value.trim();
  const description = document.getElementById("auto-task-desc").value.trim();
  const assigned_to = document.getElementById("auto-task-assign").value.trim();
  const interval_months = document.getElementById("auto-task-interval").value;
  const time_limit = document.getElementById("auto-task-time-limit").value;
  const start_at = readDateTimeLocalInput("auto-task-start-at");
  const active = document.getElementById("auto-task-active").checked;
  if (!title) return alert("\u8BF7\u8F93\u5165\u6807\u9898");
  if (!assigned_to) return alert("\u8BF7\u9009\u62E9\u6307\u6D3E\u4EBA\u5458");
  if (!start_at) return alert("\u8BF7\u9009\u62E9\u5F00\u59CB\u65F6\u95F4");
  const payload = { title, description, assigned_to, interval_months, time_limit, start_at, active };
  const res = await fetchWithAuth(id ? `/api/auto-tasks/${id}` : "/api/auto-tasks", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload)
  });
  if (!res.ok) return alert("\u4FDD\u5B58\u5931\u8D25");
  closeAutoTaskModal();
  loadTasks("auto");
}
window.saveAutoTask = saveAutoTask;
window.toggleAutoTask = async function(id, active) {
  var _a2;
  const t = currentAutoTaskList.find((x) => Number(x.id) === Number(id));
  if (!t) return;
  const res = await fetchWithAuth(`/api/auto-tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      title: t.title || "",
      description: t.description || "",
      assigned_to: t.assigned_to || "",
      interval_months: (_a2 = t.interval_months) != null ? _a2 : 1,
      time_limit: t.time_limit || 0,
      start_at: t.start_at || t.created_at || Date.now(),
      active: !!active
    })
  });
  if (!res.ok) return alert("\u64CD\u4F5C\u5931\u8D25");
  loadTasks("auto");
};
function openCompleteTaskModal(id) {
  const m = document.getElementById("complete-task-modal");
  if (m) {
    m.style.display = "flex";
    document.getElementById("complete-task-id").value = id;
    document.getElementById("complete-task-image").value = "";
    document.getElementById("complete-task-image-preview").style.display = "none";
    const filePrev = document.getElementById("complete-task-file-preview");
    if (filePrev) filePrev.style.display = "none";
    document.getElementById("complete-task-image-base64").value = "";
    document.getElementById("complete-task-desc").value = "";
  }
}
function closeCompleteTaskModal() {
  const m = document.getElementById("complete-task-modal");
  if (m) m.style.display = "none";
}
window.previewCompleteTaskImage = function(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
      const prevImg = document.getElementById("complete-task-image-preview");
      const prevFile = document.getElementById("complete-task-file-preview");
      if (file.type.startsWith("image/")) {
        prevImg.querySelector("img").src = e.target.result;
        prevImg.style.display = "block";
        if (prevFile) prevFile.style.display = "none";
      } else {
        prevImg.style.display = "none";
        if (prevFile) {
          prevFile.innerHTML = `\u{1F4C4} \u5DF2\u9009\u62E9\u6587\u4EF6: ${file.name}`;
          prevFile.style.display = "block";
        }
      }
      document.getElementById("complete-task-image-base64").value = e.target.result;
    };
    reader.readAsDataURL(file);
  }
};
window.submitCompleteTask = async function() {
  const id = document.getElementById("complete-task-id").value;
  const image = document.getElementById("complete-task-image-base64").value;
  const desc = document.getElementById("complete-task-desc").value;
  const res = await fetchWithAuth(`/api/tasks/${id}/complete`, {
    method: "PUT",
    body: JSON.stringify({ image, desc })
  });
  if (!res.ok) {
    alert("\u63D0\u4EA4\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216\u91CD\u542F\u670D\u52A1\u5668");
    return;
  }
  closeCompleteTaskModal();
  loadTasks(currentTaskTab);
};
window.showTaskImage = function(src) {
  const lb = document.getElementById("image-lightbox");
  const img = document.getElementById("lightbox-img");
  if (lb && img) {
    img.src = src;
    lb.style.display = "flex";
  }
};
async function completeTask(id) {
  openCompleteTaskModal(id);
}
async function auditTask(id) {
  if (!confirm("\u786E\u8BA4\u5BA1\u6838\u901A\u8FC7\uFF1F")) return;
  await fetchWithAuth(`/api/tasks/${id}/audit`, { method: "PUT" });
  loadTasks("review");
}
function openOrderNotesModal(id) {
  const o = currentDailyOrders.find((x) => x.id === id);
  if (!o || !o.notes) return;
  const m = document.getElementById("do-notes-modal");
  const c = document.getElementById("do-notes-content");
  if (m && c) {
    c.textContent = o.notes;
    m.style.display = "flex";
  }
}
function getAllDailyOrderContacts() {
  return [
    ...contactsData.customers || [],
    ...contactsData.merchants || [],
    ...contactsData.others || []
  ];
}
function getDailyOrderCustomerInfo(name) {
  return getAllDailyOrderContacts().find((c) => c.name === name) || null;
}
function getDailyOrderPriceLabel(priceKey) {
  const map = { price1: "\u4EF7\u683C1", price2: "\u4EF7\u683C2", price3: "\u4EF7\u683C3", price4: "\u4EF7\u683C4" };
  return map[priceKey || "price1"] || String(priceKey || "\u4EF7\u683C1");
}
function openOrderDetailsModal(id) {
  const o = currentDailyOrders.find((x) => x.id === id);
  if (!o) return;
  const m = document.getElementById("do-details-modal");
  if (m) {
    document.getElementById("do-details-customer").textContent = o.customer;
    document.getElementById("do-details-date").textContent = formatDisplayDate(o.date);
    document.getElementById("do-details-notes").textContent = o.notes || "-";
    document.getElementById("do-details-notes").style.whiteSpace = "pre-wrap";
    document.getElementById("do-details-notes").style.wordBreak = "break-word";
    document.getElementById("do-details-status").textContent = getDailyOrderStatusLabel(o.status);
    const tbody = document.getElementById("do-details-rows");
    const items = typeof o.items === "string" ? JSON.parse(o.items) : o.items || [];
    const thead = m.querySelector("thead tr");
    if (o.status === "new") {
      thead.innerHTML = "<th>\u5546\u54C1</th><th>\u4E2D\u6587\u540D</th><th>\u6570\u91CF</th>";
    } else {
      thead.innerHTML = "<th>\u5546\u54C1</th><th>\u4E2D\u6587\u540D</th><th>\u8BA2\u8D27\u6570\u91CF</th><th>\u5B9E\u9645\u914D\u8D27\u6570\u91CF</th>";
    }
    tbody.innerHTML = items.map((i) => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            ${i.image ? `<img src="${i.image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : ""}
            <span>${i.name}</span>
          </div>
        </td>
        <td>${i.cn_name || ""}</td>
        <td>${i.qty}</td>
        ${o.status !== "new" ? `<td>${i.allocated_qty || 0}</td>` : ""}
      </tr>
    `).join("");
    m.style.display = "flex";
  }
}
function getDailyOrderItemActualQty(item) {
  var _a2, _b2;
  const deductions = Array.isArray(item == null ? void 0 : item.deductions) ? item.deductions : [];
  const deductionQty = deductions.reduce((sum, row) => sum + Math.max(0, Number((row == null ? void 0 : row.qty) || 0)), 0);
  if (deductionQty > 0) return deductionQty;
  const plan = Array.isArray(item == null ? void 0 : item.allocation_plan) ? item.allocation_plan : [];
  const planQty = plan.reduce((sum, row) => sum + Math.max(0, Number((row == null ? void 0 : row.qty) || 0)), 0);
  if (planQty > 0) return planQty;
  return Math.max(0, Number((_b2 = (_a2 = item == null ? void 0 : item.allocated_qty) != null ? _a2 : item == null ? void 0 : item.qty) != null ? _b2 : 0));
}
function getDailyOrderItemOrderedQty(item) {
  return Math.max(0, Number((item == null ? void 0 : item.qty) || 0));
}
function getDailyOrderItemAllocationRows(item, product = null) {
  const grouped = /* @__PURE__ */ new Map();
  const pushRow = (loteValue, expiryValue, qtyValue) => {
    const qty = Math.max(0, Number(qtyValue || 0));
    if (qty <= 0) return;
    const lote = String(loteValue || "").trim();
    const expiry = String(expiryValue || "").trim();
    const key = `${lote || "__unlotted__"}__${expiry}`;
    if (!grouped.has(key)) grouped.set(key, { lote, expiry, qty: 0 });
    grouped.get(key).qty += qty;
  };
  const plan = Array.isArray(item == null ? void 0 : item.allocation_plan) ? item.allocation_plan : [];
  if (plan.length > 0) {
    plan.forEach((row) => pushRow((row == null ? void 0 : row.lote) || "", (row == null ? void 0 : row.expiry) || "", (row == null ? void 0 : row.qty) || 0));
    return Array.from(grouped.values());
  }
  const deductions = Array.isArray(item == null ? void 0 : item.deductions) ? item.deductions : [];
  if (deductions.length > 0) {
    deductions.forEach((row) => pushRow((row == null ? void 0 : row.lote) || "", (row == null ? void 0 : row.expiry) || "", (row == null ? void 0 : row.qty) || 0));
    return Array.from(grouped.values());
  }
  const needQty = getDailyOrderItemActualQty(item);
  const totalStock = Number((product == null ? void 0 : product.stock) || 0);
  const rows2 = buildFinishedStockRows(totalStock, (product == null ? void 0 : product.batches) || []);
  if (needQty <= 0 || rows2.length === 0) return [];
  let remaining = needQty;
  rows2.forEach((row) => {
    if (remaining <= 0) return;
    const take = Math.min(remaining, Math.max(0, Number((row == null ? void 0 : row.qty) || 0)));
    if (take <= 0) return;
    pushRow((row == null ? void 0 : row.lote) || "", (row == null ? void 0 : row.expiry) || "", take);
    remaining -= take;
  });
  return Array.from(grouped.values());
}
function buildOrderPreviewAllocationDisplay(item, product) {
  const rows2 = getDailyOrderItemAllocationRows(item, product);
  const orderedQty = getDailyOrderItemOrderedQty(item);
  if (rows2.length === 0) {
    return {
      loteHtml: '<span style="font-size:15px; font-weight:700; color:#dc2626">-</span>',
      qtyHtml: `<span style="font-size:15px; font-weight:700; color:#111827">${orderedQty > 0 ? orderedQty : "-"}</span>`
    };
  }
  if (rows2.length === 1) {
    return {
      loteHtml: `<div style="display:flex;flex-direction:column;gap:3px;font-size:15px;font-weight:700;color:#dc2626;line-height:1.25"><div>${rows2[0].lote ? formatFinishedLote(rows2[0].lote) : "\u65E0Lote"}</div></div>`,
      qtyHtml: `<span style="font-size:15px; font-weight:700; color:#111827">${orderedQty > 0 ? orderedQty : "-"}</span>`
    };
  }
  return {
    loteHtml: `<div style="display:flex;flex-direction:column;gap:3px;font-size:15px;font-weight:700;color:#dc2626;line-height:1.25">` + rows2.map((row) => `<div>${row.lote ? formatFinishedLote(row.lote) : "\u65E0Lote"}</div>`).join("") + `</div>`,
    qtyHtml: `<div style="display:flex;flex-direction:column;gap:3px;font-size:15px;font-weight:700;color:#111827;line-height:1.25">` + rows2.map((row) => `<div>${row.qty}</div>`).join("") + `</div>`
  };
}
async function openOrderPreview(id) {
  const o = currentDailyOrders.find((x) => x.id === id);
  if (!o) return;
  const m = document.getElementById("do-preview-modal");
  const content = document.getElementById("do-preview-content");
  if (m && content) {
    const items = typeof o.items === "string" ? JSON.parse(o.items) : o.items || [];
    const grandTotal = items.reduce((sum, item) => sum + getDailyOrderItemOrderedQty(item), 0);
    let products = [];
    try {
      const itemNames = items.map((i) => i.name).filter(Boolean);
      const itemIds = items.map((i) => i.productId).filter(Boolean);
      const itemSkus = items.map((i) => i.sku).filter(Boolean);
      if (itemNames.length > 0 || itemIds.length > 0 || itemSkus.length > 0) {
        const res = await fetchWithAuth("/api/products/batch-stock", {
          method: "POST",
          body: JSON.stringify({ names: itemNames, ids: itemIds, skus: itemSkus })
        });
        if (res.ok) products = await res.json();
      }
    } catch (e) {
      console.warn("load preview lote failed", e);
    }
    const productsById = new Map();
    const productsBySku = new Map();
    const productsByName = new Map();
    products.forEach((product) => {
      const pid = Number(product == null ? void 0 : product.id) || 0;
      const sku = String((product == null ? void 0 : product.sku) || "").trim();
      const name = String((product == null ? void 0 : product.name) || "").trim().toLowerCase();
      if (pid > 0) productsById.set(pid, product);
      if (sku) productsBySku.set(sku, product);
      if (name) productsByName.set(name, product);
    });
    content.innerHTML = `
      <style>
        .order-preview-paper { font-family: Arial, sans-serif; color:#111827; padding:8px 12px 12px; }
        .order-preview-paper table { width:100%; border-collapse:collapse; margin-bottom:12px; }
        .order-preview-paper thead tr { background:#f3f4f6; }
        .order-preview-paper th {
          border:1px solid #d1d5db;
          padding:8px 10px;
          color:#475569;
          font-size:14px;
          font-weight:700;
        }
        .order-preview-paper td {
          border:1px solid #d1d5db;
          padding:7px 10px;
          color:#111827;
          font-size:14px;
          font-weight:600;
          line-height:1.28;
          background:#fff;
          vertical-align:top;
        }
        .order-preview-paper tbody tr:hover td {
          background:#f3f4f6;
        }
        .order-preview-paper .preview-head {
          display:flex;
          justify-content:space-between;
          margin-bottom:14px;
          color:#111827;
          font-size:15px;
          font-weight:700;
          line-height:1.4;
          align-items:flex-start;
        }
        .order-preview-paper .preview-head h2 {
          text-align:center;
          margin:0 0 12px;
          font-size:24px;
          color:#111827;
        }
        .order-preview-paper .preview-notes {
          max-width:520px;
        }
        .order-preview-paper .preview-notes-text {
          white-space:pre-wrap;
          word-break:break-word;
        }
        .order-preview-paper .preview-item-main {
          display:flex;
          align-items:flex-start;
          gap:8px;
        }
        .order-preview-paper .preview-item-code {
          font-size:13px;
          line-height:1.25;
          font-weight:700;
          color:#374151;
          word-break:break-word;
        }
        .order-preview-paper .preview-item-copy {
          display:flex;
          flex-direction:column;
          gap:3px;
          min-width:0;
        }
        .order-preview-paper .preview-item-main img {
          width:34px;
          height:34px;
          object-fit:cover;
          border-radius:6px;
          flex:0 0 34px;
          margin-top:1px;
        }
        .order-preview-paper .preview-item-name {
          font-size:13px;
          line-height:1.25;
          font-weight:700;
          word-break:break-word;
        }
        .order-preview-paper .preview-item-cn {
          font-size:13px;
          line-height:1.25;
          word-break:break-word;
        }
        .order-preview-paper .preview-foot {
          margin-top:20px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          color:#111827;
          font-size:15px;
          font-weight:700;
          gap:16px;
        }
      </style>
      <div class="order-preview-paper">
        <h2 class="preview-head-title" style="text-align:center; margin:0 0 12px; font-size:24px; color:#111827">\u914D\u8D27\u5355</h2>
        <div class="preview-head">
          <div>
            <div><strong>\u5BA2\u6237:</strong> ${o.customer}</div>
            <div><strong>\u65E5\u671F:</strong> ${formatDisplayDate(o.date)}</div>
            <div><strong>\u72B6\u6001:</strong> ${getDailyOrderStatusLabel(o.status)}</div>
          </div>
          <div class="preview-notes">
            ${o.notes ? `<div><strong>\u5907\u6CE8:</strong> <span class="preview-notes-text">${escapeHtml(o.notes)}</span></div>` : `<div><strong>\u5907\u6CE8:</strong> -</div>`}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="text-align:left; width:120px">\u8D27\u53F7</th>
              <th style="text-align:left">\u5546\u54C1</th>
              <th style="text-align:right">\u4E0B\u5355\u6570\u91CF</th>
              <th style="text-align:center; font-size:16px; color:#dc2626">Lote</th>
              <th style="text-align:right">\u914D\u8D27\u6570\u91CF</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((i) => {
      const product = productsById.get(Number(i.productId) || 0) || productsBySku.get(String(i.sku || "").trim()) || productsByName.get(String(i.name || "").trim().toLowerCase()) || null;
      const productSku = String((i == null ? void 0 : i.sku) || (product == null ? void 0 : product.sku) || "").trim();
      const nameCn = String((i == null ? void 0 : i.cn_name) || (i == null ? void 0 : i.name_cn) || (product == null ? void 0 : product.name_cn) || "").trim();
      const orderedQty = getDailyOrderItemOrderedQty(i);
      const allocationDisplay = buildOrderPreviewAllocationDisplay(i, product);
      return `
              <tr>
                <td style="text-align:left"><div class="preview-item-code">${escapeHtml(productSku || "-")}</div></td>
                <td style="text-align:left">
                  <div class="preview-item-main">
                    ${i.image ? `<img src="${i.image}">` : ""}
                    <div class="preview-item-copy">
                      <div class="preview-item-name">${escapeHtml(i.name || "")}</div>
                      ${nameCn ? `<div class="preview-item-cn">${escapeHtml(nameCn)}</div>` : ""}
                    </div>
                  </div>
                </td>
                <td style="text-align:right"><span style="font-size:15px; font-weight:700; color:#111827">${orderedQty > 0 ? orderedQty : "-"}</span></td>
                <td style="text-align:center">${allocationDisplay.loteHtml}</td>
                <td style="text-align:right">${allocationDisplay.qtyHtml}</td>
              </tr>
            `;
    }).join("")}
          </tbody>
        </table>
        <div class="preview-foot">
          <div>\u5236\u5355\u4EBA: ${o.created_by || "____________"}</div>
          <div style="text-align:center">\u603B\u8BA1\u7BB1\u6570\uFF1A${grandTotal}</div>
          <div>\u914D\u8D27\u5458: ________________</div>
        </div>
      </div>
    `;
    m.style.display = "flex";
    syncModalBodyScrollLock();
  }
}
function syncModalBodyScrollLock() {
  const hasVisibleModal = Array.from(document.querySelectorAll(".modal-overlay")).some((el) => {
    if (!el) return false;
    return getComputedStyle(el).display !== "none";
  });
  document.body.style.overflow = hasVisibleModal ? "hidden" : "";
}
function closeAllocateModal() {
  const m = document.getElementById("do-allocate-modal");
  if (m) m.style.display = "none";
  syncModalBodyScrollLock();
}
window.closeAllocateModal = closeAllocateModal;
function closeOrderPreviewModal() {
  const m = document.getElementById("do-preview-modal");
  if (m) m.style.display = "none";
  syncModalBodyScrollLock();
}
window.closeOrderPreviewModal = closeOrderPreviewModal;
function printOrderPreview() {
  const content = document.getElementById("do-preview-content").innerHTML;
  const win = window.open("", "", "width=800,height=600");
  win.document.write(`
    <html>
      <head>
        <title>\u6253\u5370\u8BA2\u5355</title>
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
        <\/script>
      </body>
    </html>
  `);
  win.document.close();
}
var currentDailyOrders = [];
var dailyOrderAllocateState = [];
var dailyOrdersAbortController = null;
var dailyOrdersAllocatedCount = 0;
var dailyOrdersReadyToShipCount = 0;
function getDailyOrderStatusLabel(status = "") {
  const value = String(status || "").trim();
  if (value === "new") return "新订单";
  if (value === "allocated") return "已配货";
  if (value === "ready_to_ship") return "待发货";
  if (value === "cancelled") return "已退单";
  if (value === "shipped") return "已发货";
  return value || "-";
}
function updateDailyOrdersAllocatedBadge(count) {
  const badge = document.getElementById("tab-order-alloc-badge");
  if (!badge) return;
  const total = Number(count || 0) || 0;
  dailyOrdersAllocatedCount = total;
  badge.textContent = String(total);
  badge.style.display = total > 0 ? "inline-block" : "none";
}
function updateDailyOrdersReadyToShipBadge(count) {
  const badge = document.getElementById("tab-order-ready-ship-badge");
  if (!badge) return;
  const total = Number(count || 0) || 0;
  dailyOrdersReadyToShipCount = total;
  badge.textContent = String(total);
  badge.style.display = total > 0 ? "inline-block" : "none";
}
async function refreshDailyOrdersAllocatedBadge() {
  let total = dailyOrdersAllocatedCount;
  let readyShipTotal = dailyOrdersReadyToShipCount;
  try {
    const [allocatedRes, readyShipRes] = await Promise.all([
      fetchWithAuth(`/api/daily-orders?status=allocated&_t=${Date.now()}`),
      fetchWithAuth(`/api/daily-orders?status=ready_to_ship&_t=${Date.now()}`)
    ]);
    if (allocatedRes.ok) {
      const list = await allocatedRes.json().catch(() => []);
      total = Array.isArray(list) ? list.length : 0;
    }
    if (readyShipRes.ok) {
      const list = await readyShipRes.json().catch(() => []);
      readyShipTotal = Array.isArray(list) ? list.length : 0;
    }
    updateDailyOrdersAllocatedBadge(total);
    updateDailyOrdersReadyToShipBadge(readyShipTotal);
    return;
  } catch (e) {
    updateDailyOrdersAllocatedBadge(total);
    updateDailyOrdersReadyToShipBadge(readyShipTotal);
    return;
  }
}
async function loadDailyOrders(status = "new", btn = null) {
  await apiDailyOrderActionAssignments();
  refreshDailyOrdersAllocatedBadge();
  const showVoucherColumn = status === "shipped";
  const showInvoiceNoColumn = status === "ready_to_ship" || status === "shipped" || status === "cancelled";
  const dailyOrderVoucherHeader = document.getElementById("daily-order-voucher-header");
  const dailyOrderNoHeader = document.getElementById("daily-order-no-header");
  const dailyOrderColSpan = showVoucherColumn ? 9 : 8;
  if (dailyOrderVoucherHeader) {
    dailyOrderVoucherHeader.style.display = showVoucherColumn ? "" : "none";
  }
  if (dailyOrderNoHeader) {
    dailyOrderNoHeader.textContent = showInvoiceNoColumn ? "发票号" : "单号";
  }
  if (btn) {
    const tabs = btn.closest(".tabs");
    if (tabs) {
      tabs.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    }
  } else {
    const tabs = document.querySelector("#page-daily-orders .tabs");
    if (tabs) {
      tabs.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      const target = tabs.querySelector(`[data-tab="${status}"]`);
      if (target) target.classList.add("active");
    }
  }
  const tbody = document.getElementById("daily-order-rows");
  if (tbody) {
    tbody.dataset.voucherColumn = showVoucherColumn ? "1" : "0";
    tbody.innerHTML = `<tr><td colspan="${dailyOrderColSpan}" style="text-align:center; padding:20px; color:#94a3b8">\u52A0\u8F7D\u4E2D...</td></tr>`;
  }
  if (dailyOrdersAbortController) {
    dailyOrdersAbortController.abort();
  }
  dailyOrdersAbortController = new AbortController();
  let list = [];
  try {
    const res = await fetchWithAuth(`/api/daily-orders?status=${status}&_t=${Date.now()}`, {
      signal: dailyOrdersAbortController.signal
    });
    if (!res.ok) return;
    list = await res.json();
    if (status === "shipped" && Array.isArray(list)) {
      list.sort((a, b) => {
        const at = Number((a == null ? void 0 : a.logistics_updated_at) || (a == null ? void 0 : a.shipped_at) || 0) || 0;
        const bt = Number((b == null ? void 0 : b.logistics_updated_at) || (b == null ? void 0 : b.shipped_at) || 0) || 0;
        if (bt !== at) return bt - at;
        return Number((b == null ? void 0 : b.id) || 0) - Number((a == null ? void 0 : a.id) || 0);
      });
    }
    currentDailyOrders = list;
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("Failed to load daily orders:", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="${dailyOrderColSpan}" style="text-align:center; padding:20px; color:#ef4444">\u52A0\u8F7D\u5931\u8D25</td></tr>`;
    return;
  }
  if (status === "new") {
    const badge = document.getElementById("tab-order-new-badge");
    const navBadge = document.getElementById("nav-order-badge");
    if (badge) {
      badge.textContent = list.length;
      badge.style.display = list.length > 0 ? "inline-block" : "none";
    }
    if (navBadge) {
      navBadge.textContent = list.length;
      navBadge.style.display = list.length > 0 ? "inline-block" : "none";
    }
  } else if (status === "allocated") {
    updateDailyOrdersAllocatedBadge(list.length);
  } else if (status === "ready_to_ship") {
    updateDailyOrdersReadyToShipBadge(list.length);
  }
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = `<tr class="empty"><td colspan="${dailyOrderColSpan}">\u6682\u65E0\u8BA2\u5355</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((o, idx) => {
    const isAllocationReadyRow = o.status === "new" && o.allocation_enabled === true;
    const canOpenPreviewFromDate = ["new", "allocated", "ready_to_ship", "shipped", "cancelled"].includes(String(o.status || "").trim());
    const customerInfo = getDailyOrderCustomerInfo(o.customer || "");
    const customerName = escapeHtml(String(o.customer || "-"));
    const customerCompany = escapeHtml(String((customerInfo == null ? void 0 : customerInfo.company) || "-"));
    const voucherUrl = String(o.logistics_voucher_url || "").trim();
    const voucherThumbHtml = o.status === "shipped" && voucherUrl ? `<img src="${escapeHtml(voucherUrl)}" alt="发货单" style="width:52px; height:52px; object-fit:cover; border-radius:8px; border:1px solid #334155; cursor:zoom-in; display:block; margin-left:auto" onclick='showTaskImage(${JSON.stringify(voucherUrl)})' title="点击放大查看">` : '<span style="color:#64748b">-</span>';
    const statusTagClass = o.status === "new" ? isAllocationReadyRow ? "green" : "red" : o.status === "allocated" || o.status === "ready_to_ship" ? "blue" : o.status === "cancelled" ? "gray" : "green";
    const customerRemarkColor = isAllocationReadyRow ? "var(--green)" : "#ef4444";
    const orderNotesColor = isAllocationReadyRow ? "var(--green)" : "#10b981";
    const secondaryTextColor = isAllocationReadyRow ? "var(--green)" : "#64748b";
    const invoiceNo = String(o.invoice_no || "").trim();
    const invoiceNoHtml = showInvoiceNoColumn && invoiceNo ? `<a href="#" class="link-blue" onclick='openDailyOrderInvoicePreviewByNumber(${JSON.stringify(invoiceNo)}); return false;'>${escapeHtml(invoiceNo)}</a>` : "-";
    const enableAllocationAttrs = getDailyOrderActionDisabledAttrs("enable_allocation");
    const enableAllocationStyle = getDailyOrderActionDisabledStyle("enable_allocation");
    const allocateAttrs = getDailyOrderActionDisabledAttrs("allocate");
    const allocateStyle = getDailyOrderActionDisabledStyle("allocate");
    const readyToShipAttrs = getDailyOrderActionDisabledAttrs("ready_to_ship");
    const readyToShipStyle = getDailyOrderActionDisabledStyle("ready_to_ship");
    const contactLogisticsAttrs = getDailyOrderActionDisabledAttrs("contact_logistics");
    const contactLogisticsStyle = getDailyOrderActionDisabledStyle("contact_logistics");
    const shipAttrs = getDailyOrderActionDisabledAttrs("ship");
    const shipStyle = getDailyOrderActionDisabledStyle("ship");
    const isPickupPending = String((o == null ? void 0 : o.logistics_status) || "").trim() === "pickup_pending";
    const pickupPendingElapsed = isPickupPending ? formatPickupPendingElapsed((o == null ? void 0 : o.logistics_updated_at) || 0) : "";
    const pickupPendingHours = isPickupPending ? Math.floor(Math.max(0, Date.now() - (Number((o == null ? void 0 : o.logistics_updated_at) || 0) || 0)) / 36e5) : 0;
    const pickupPendingOver24h = pickupPendingHours >= 24;
    const pickupPendingLabel = typeof window.t === "function" ? window.t("\u5F85\u63D0\u8D27") : "\u5F85\u63D0\u8D27";
    const contactLogisticsLabel = typeof window.t === "function" ? window.t("\u8054\u7CFB\u7269\u6D41") : "\u8054\u7CFB\u7269\u6D41";
    const pickupPendingButtonText = isPickupPending ? `<span style="display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1.15"><span>${pickupPendingLabel}</span><span style="font-size:12px; margin-top:2px; ${pickupPendingOver24h ? "color:#ef4444; font-weight:700;" : ""}">${pickupPendingElapsed || "&nbsp;"}</span></span>` : contactLogisticsLabel;
    const pickupPendingButtonStyle = isPickupPending ? `margin-left:4px; min-width:112px; white-space:normal; padding:6px 10px; ${contactLogisticsStyle}` : `margin-left:4px; ${contactLogisticsStyle}`;
    return `
    <tr class="${isAllocationReadyRow ? "order-row-alloc-ready" : ""}">
      <td>${list.length - idx}</td>
      <td>
        <div style="font-size:14px; line-height:1.45; white-space:pre-wrap; word-break:break-word">${customerName}</div>
        <div style="font-size:14px; line-height:1.45; white-space:pre-wrap; word-break:break-word; margin-top:2px">${customerCompany}</div>
      </td>
      <td>
        <div style="font-size:13px${canOpenPreviewFromDate ? "; cursor:pointer; text-decoration:underline" : ""}" ${canOpenPreviewFromDate ? `onclick="openOrderPreview(${o.id})" title="点击打开预览"` : ""}>\u4E0B\u5355: ${formatDisplayDate(o.date)}</div>
        ${o.status === "shipped" && o.shipped_at ? `<div style="color:${secondaryTextColor};font-size:12px">\u53D1\u8D27: ${formatDisplayDateTimeValue(Number(o.shipped_at))}</div>` : ""}
      </td>
      <td><span class="tag ${statusTagClass}" style="cursor:pointer; text-decoration:underline" onclick="${o.status === "allocated" || o.status === "ready_to_ship" ? `openDailyOrderInvoiceEditor(${o.id})` : o.status === "new" ? `editDailyOrder(${o.id})` : `openOrderDetailsModal(${o.id})`}" title="\u70B9\u51FB\u67E5\u770B/\u4FEE\u6539\u8BE6\u60C5">
        ${getDailyOrderStatusLabel(o.status)}
      </span></td>
      <td>
        ${(() => {
    const customer = getDailyOrderCustomerInfo(o.customer || "");
    const customerRemark = (customer == null ? void 0 : customer.remark) ? `<div style="color:${customerRemarkColor}; font-size:14px; font-weight:700; line-height:1.45; white-space:pre-wrap; word-break:break-word; max-width:180px">${escapeHtml(customer.remark)}</div>` : "";
    const orderNotes = o.notes ? `<div style="color:${orderNotesColor}; font-size:13px; cursor:pointer; white-space:pre-wrap; word-break:break-word; max-width:180px; line-height:1.4; margin-top:${(customer == null ? void 0 : customer.remark) ? "6px" : "0"}" onclick="openOrderNotesModal(${o.id})" title="\u70B9\u51FB\u67E5\u770B\u5B8C\u6574\u5907\u6CE8">${escapeHtml(o.notes)}</div>` : "";
    return customerRemark || orderNotes ? customerRemark + orderNotes : `<span style="color:${secondaryTextColor}">-</span>`;
  })()}
      </td>
      <td>
        <div style="font-size:13px">\u521B\u5EFA: ${o.created_by || "-"}</div>
        ${o.status === "allocated" || o.status === "ready_to_ship" || o.status === "shipped" ? `<div style="font-size:13px; color:${secondaryTextColor}">\u914D\u8D27: ${o.allocated_by || "-"}</div>` : ""}
        ${o.status === "shipped" ? `<div style="font-size:13px; color:${secondaryTextColor}">\u53D1\u8D27: ${o.shipped_by || "-"}</div>` : ""}
      </td>
      <td>${invoiceNoHtml}</td>
      ${showVoucherColumn ? `<td>${voucherThumbHtml}</td>` : ""}
      <td>
            ${o.status === "new" ? `${o.allocation_enabled ? `<button class="btn-sm btn-secondary" style="opacity:0.75; cursor:default" disabled>\u53EF\u914D\u8D27</button> <button class="btn-sm" style="margin-left:4px; ${allocateStyle}" onclick="openAllocateModal(${o.id})"${allocateAttrs}>\u914D\u8D27</button>` : `<button class="btn-sm btn-secondary" style="${enableAllocationStyle}" onclick="enableDailyOrderAllocation(${o.id})"${enableAllocationAttrs}>\u53EF\u914D\u8D27</button> <button class="btn-sm" style="margin-left:4px; opacity:0.45; cursor:not-allowed; pointer-events:none" disabled>\u914D\u8D27</button>`} <button class="btn-sm btn-secondary" style="margin-left:4px; width:32px; min-width:32px; height:32px; min-height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; vertical-align:middle" onclick="cancelDailyOrder(${o.id})" title="\u9000\u5355"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ff5a52" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>` : ""}
            ${o.status === "allocated" ? `<button class="btn-sm" style="${readyToShipStyle}" onclick="markDailyOrderReadyToShip(${o.id})"${readyToShipAttrs}>\u53EF\u53D1\u8D27</button> <button class="btn-sm btn-secondary" style="margin-left:4px; width:32px; min-width:32px; height:32px; min-height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; vertical-align:middle" onclick="cancelDailyOrder(${o.id})" title="\u9000\u5355"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ff5a52" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>` : ""}
            ${o.status === "ready_to_ship" ? `<button class="btn-sm btn-secondary" style="margin-left:0; padding:6px 10px" onclick="printDailyOrderShippingLabel(${o.id})" title="\u6253\u5370\u6536\u8D27\u5730\u5740"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V4h12v5"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v6H6z"/><path d="M17 12h.01"/></svg></button> <button class="btn-sm ${isPickupPending ? "btn-secondary" : "btn-green"}" style="${pickupPendingButtonStyle}" onclick="openContactLogisticsModal(${o.id})"${contactLogisticsAttrs}>${pickupPendingButtonText}</button> <button class="btn-sm ${isPickupPending ? "" : "btn-secondary"}" style="margin-left:4px; ${shipStyle}" onclick="confirmShip(${o.id})"${shipAttrs}>\u786E\u8BA4\u53D1\u8D27</button> <button class="btn-sm btn-secondary" style="margin-left:4px; width:32px; min-width:32px; height:32px; min-height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; vertical-align:middle" onclick="cancelDailyOrder(${o.id})" title="\u9000\u5355"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ff5a52" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>` : ""}
          ${o.status === "shipped" ? `` : ""}
          ${o.status === "cancelled" ? `<button class="btn-sm" style="margin-left:4px" onclick="restoreDailyOrder(${o.id})">\u6062\u590D</button>` : ""}
      </td>
    </tr>
  `;
  }).join("");
}
async function enableDailyOrderAllocation(id) {
  const targetId = Number(id || 0);
  if (!targetId) return;
  try {
    const res = await fetchWithAuth(`/api/daily-orders/${targetId}/enable-allocation`, {
      method: "PUT"
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if ((err == null ? void 0 : err.error) === "bad_status") alert("\u53EA\u6709\u65B0\u8BA2\u5355\u624D\u80FD\u8BBE\u4E3A\u53EF\u914D\u8D27");
      else alert("\u8BBE\u7F6E\u53EF\u914D\u8D27\u5931\u8D25");
      return;
    }
    loadDailyOrders("new");
  } catch (e) {
    console.error(e);
    alert("\u8BBE\u7F6E\u53EF\u914D\u8D27\u5931\u8D25");
  }
}
async function markDailyOrderReadyToShip(id) {
  const targetId = Number(id || 0);
  if (!targetId) return;
  openReadyToShipPrepareModal(targetId);
}
var currentLogisticsTab = "ongoing";
var logisticsCompanies = [];
var logisticsCompaniesLoadedAt = 0;
var logisticsAbortController = null;
var allPartners = [];
var allPartnersLoadedAt = 0;
var partnerSelectTarget = "";
var partnerSelectMode = "field";
const DO_SHIP_DEFAULT_FROM_KEY = "ts_do_ship_default_from";
var currentLogisticsRecords = [];
var logisticsCompletedTotalCount = 0;
var logisticsCompletedFilters = { from: "", company: "" };
var logisticsCompletedFilterMenuKey = "";
var logisticsReviewedFilters = { from: "", to: "", company: "", updated: "" };
var logisticsReviewedFilterMenuKey = "";
var logisticsReviewMode = false;
var logisticsReviewSelectedIds = /* @__PURE__ */ new Set();
var logisticsOngoingBadgeCountCache = null;
var currentLogisticsCompanyEditId = 0;
var navTaskBadgeCountCache = null;
var navOrderBadgeCountCache = null;
var globalBadgesRequestSeq = 0;
function ensureLogisticsReviewSelectedIds() {
  if (!(logisticsReviewSelectedIds instanceof Set)) logisticsReviewSelectedIds = /* @__PURE__ */ new Set();
  return logisticsReviewSelectedIds;
}
function readBadgeCountCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch (e) {
    return null;
  }
}
function writeBadgeCountCache(key, count) {
  try {
    localStorage.setItem(key, String(Number(count || 0) || 0));
  } catch (e) {
  }
}
function formatPickupPendingElapsed(startTs) {
  const start = Number(startTs || 0) || 0;
  if (start <= 0) return "";
  const diffMs = Math.max(0, Date.now() - start);
  const totalHours = Math.floor(diffMs / 36e5);
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}${getCurrentAppLocale() === "es-ES" ? "dia" : "天"}${hours}h`;
}
function updateNavDailyOpsBadgeCount() {
  const total = (Number(navTaskBadgeCountCache || 0) || 0) + (Number(navOrderBadgeCountCache || 0) || 0) + (Number(logisticsOngoingBadgeCountCache || 0) || 0);
  const el = document.getElementById("nav-daily-ops-badge");
  if (el) {
    el.textContent = String(total);
    el.style.display = total > 0 ? "inline-block" : "none";
  }
}
function updateNavTaskBadgeCount(count) {
  const total = Number(count || 0) || 0;
  navTaskBadgeCountCache = total;
  writeBadgeCountCache("nav-task-badge-cache", total);
  const el = document.getElementById("nav-task-badge");
  if (el) {
    el.textContent = String(total);
    el.style.display = total > 0 ? "inline-block" : "none";
  }
  updateNavDailyOpsBadgeCount();
}
function updateNavOrderBadgeCount(count) {
  const total = Number(count || 0) || 0;
  navOrderBadgeCountCache = total;
  writeBadgeCountCache("nav-order-badge-cache", total);
  const el = document.getElementById("nav-order-badge");
  if (el) {
    el.textContent = String(total);
    el.style.display = total > 0 ? "inline-block" : "none";
  }
  updateNavDailyOpsBadgeCount();
}
function loadLocalLogisticsCompanies() {
  try {
    const list = JSON.parse(localStorage.getItem("logisticsCompanies") || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}
function saveLocalLogisticsCompanies(list) {
  localStorage.setItem("logisticsCompanies", JSON.stringify(Array.isArray(list) ? list : []));
}
function mergeLogisticsCompaniesWithLocal(remoteList) {
  const remote = Array.isArray(remoteList) ? remoteList : [];
  const local = loadLocalLogisticsCompanies();
  return remote.map((item) => {
    const idKey = String((item == null ? void 0 : item.id) || "");
    const localMatch = (Array.isArray(local) ? local : []).find((x) => String((x == null ? void 0 : x.id) || "") === idKey);
    return localMatch ? { ...item, ...localMatch, id: item.id } : { ...item };
  });
}
function loadLocalLogisticsRecords() {
  try {
    const list = JSON.parse(localStorage.getItem("logisticsRecords") || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}
function saveLocalLogisticsRecords(list) {
  localStorage.setItem("logisticsRecords", JSON.stringify(Array.isArray(list) ? list : []));
}
function getLogisticsRecordStatus(record) {
  return String((record == null ? void 0 : record.status) || (record == null ? void 0 : record.logistics_status) || "").trim();
}
function mergeLogisticsRecordsWithLocal(status, remoteList) {
  const arr = Array.isArray(remoteList) ? remoteList : [];
  try {
    const localAll = loadLocalLogisticsRecords();
    if (Array.isArray(localAll) && localAll.length > 0) {
      const localMap = new Map(localAll.map((x) => [String((x == null ? void 0 : x.order_id) || (x == null ? void 0 : x.id) || ""), x]));
      const merged = arr.map((r) => {
        const key = String((r == null ? void 0 : r.id) || (r == null ? void 0 : r.order_id) || "");
        const local = localMap.get(key);
        if (!local) return r;
        return {
          ...r,
          orderNo: String((local == null ? void 0 : local.orderNo) || "").trim() ? String(local.orderNo).trim() : r.orderNo,
          shipped_by: String((local == null ? void 0 : local.shipped_by) || (local == null ? void 0 : local.created_by) || "").trim() ? local.shipped_by || local.created_by : r.shipped_by,
          logistics_from: String((local == null ? void 0 : local.logistics_from) || (local == null ? void 0 : local.from) || "").trim() ? local.logistics_from || local.from : r.logistics_from,
          logistics_to: String((local == null ? void 0 : local.logistics_to) || (local == null ? void 0 : local.to) || "").trim() ? local.logistics_to || local.to : r.logistics_to,
          logistics_ship_date: String((local == null ? void 0 : local.logistics_ship_date) || (local == null ? void 0 : local.ship_date) || (local == null ? void 0 : local.shipDate) || "").trim() ? local.logistics_ship_date || local.ship_date || local.shipDate : r.logistics_ship_date,
          logistics_pallet_count: String((local == null ? void 0 : local.logistics_pallet_count) || (local == null ? void 0 : local.pallet_count) || (local == null ? void 0 : local.palletCount) || "").trim() ? local.logistics_pallet_count || local.pallet_count || local.palletCount : r.logistics_pallet_count,
          logistics_box_count: String((local == null ? void 0 : local.logistics_box_count) || (local == null ? void 0 : local.box_count) || (local == null ? void 0 : local.boxCount) || "").trim() ? local.logistics_box_count || local.box_count || local.boxCount : r.logistics_box_count,
          logistics_total_weight: String((local == null ? void 0 : local.logistics_total_weight) || (local == null ? void 0 : local.total_weight) || (local == null ? void 0 : local.totalWeight) || "").trim() ? local.logistics_total_weight || local.total_weight || local.totalWeight : r.logistics_total_weight,
          logistics_arrival_date: String((local == null ? void 0 : local.logistics_arrival_date) || (local == null ? void 0 : local.arrival_date) || (local == null ? void 0 : local.arrivalDate) || "").trim() ? local.logistics_arrival_date || local.arrival_date || local.arrivalDate : r.logistics_arrival_date,
          logistics_completed_by: String((local == null ? void 0 : local.logistics_completed_by) || (local == null ? void 0 : local.completed_by) || "").trim() ? local.logistics_completed_by || local.completed_by : r.logistics_completed_by,
          logistics_reviewed_by: String((local == null ? void 0 : local.logistics_reviewed_by) || (local == null ? void 0 : local.reviewed_by) || "").trim() ? local.logistics_reviewed_by || local.reviewed_by : r.logistics_reviewed_by,
          logistics_updated_at: Number((local == null ? void 0 : local.updatedAt) || 0) || r.logistics_updated_at
        };
      });
      return merged;
    }
  } catch (e) {
  }
  return arr;
}
async function apiLogisticsCompaniesList(force = false) {
  const now = Date.now();
  if (!force && logisticsCompaniesLoadedAt && now - logisticsCompaniesLoadedAt < 15e3 && Array.isArray(logisticsCompanies)) {
    return logisticsCompanies;
  }
  const localCached = loadLocalLogisticsCompanies();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 2500) : 0;
  try {
    const res = await fetchWithAuth("/api/logistics/companies?_t=" + now, controller ? { signal: controller.signal } : {});
    if (!res.ok) {
      logisticsCompanies = localCached;
      logisticsCompaniesLoadedAt = now;
      return logisticsCompanies;
    }
    const list = await res.json();
    logisticsCompanies = mergeLogisticsCompaniesWithLocal(Array.isArray(list) ? list : []);
    saveLocalLogisticsCompanies(logisticsCompanies);
    logisticsCompaniesLoadedAt = now;
    return logisticsCompanies;
  } catch (e) {
    logisticsCompanies = localCached;
    logisticsCompaniesLoadedAt = now;
    return logisticsCompanies;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
async function apiLogisticsCompanyCreate(payload) {
  var _a2;
  const res = await fetchWithAuth("/api/logistics/companies", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
  if (res.status === 404) {
    const list = loadLocalLogisticsCompanies();
    const id = Date.now();
    const next = [{
      id,
      enabled: true,
      generate_logistics_order: (payload == null ? void 0 : payload.generate_logistics_order) !== false,
      created_at: Date.now(),
      created_by: ((_a2 = getAuthUser()) == null ? void 0 : _a2.name) || "",
      ...payload
    }, ...list];
    saveLocalLogisticsCompanies(next);
    logisticsCompanies = next;
    logisticsCompaniesLoadedAt = Date.now();
    return { ok: true, status: 200 };
  }
  return res;
}
async function apiLogisticsCompanyUpdate(id, payload) {
  const res = await fetchWithAuth("/api/logistics/companies/" + String(id || 0), {
    method: "PUT",
    body: JSON.stringify(payload || {})
  });
  if (res.status === 404) {
    const list = loadLocalLogisticsCompanies().map((x) => String(x.id) === String(id) ? { ...x, ...payload, generate_logistics_order: (payload == null ? void 0 : payload.generate_logistics_order) !== false } : x);
    saveLocalLogisticsCompanies(list);
    logisticsCompanies = list;
    logisticsCompaniesLoadedAt = Date.now();
    return { ok: true, status: 200 };
  }
  return res;
}
async function apiLogisticsCompanySetEnabled(id, enabled) {
  const res = await fetchWithAuth("/api/logistics/companies/" + String(id || 0), {
    method: "PUT",
    body: JSON.stringify({ enabled: !!enabled })
  });
  if (res.status === 404) {
    const list = loadLocalLogisticsCompanies().map((x) => String(x.id) === String(id) ? { ...x, enabled: !!enabled } : x);
    saveLocalLogisticsCompanies(list);
    logisticsCompanies = list;
    logisticsCompaniesLoadedAt = Date.now();
    return { ok: true, status: 200 };
  }
  return res;
}
function renderLogisticsCompaniesRows(tbody, list) {
  var _a2;
  if (!tbody) return;
  if (!Array.isArray(list) || list.length === 0) {
    tbody.innerHTML = '<tr class="empty"><td colspan="6">\u6682\u65E0\u7269\u6D41\u516C\u53F8</td></tr>';
    return;
  }
  const role = getUserRoleName(((_a2 = getAuthUser()) == null ? void 0 : _a2.name) || "");
  const canEdit = role === "\u8D85\u7EA7\u7BA1\u7406\u5458";
  tbody.innerHTML = list.map((c, idx) => {
    const enabled = c.enabled === true;
    const statusTag = enabled ? `<span class="tag green">\u542F\u7528</span>` : `<span class="tag gray">\u7981\u7528</span>`;
    const action = canEdit ? `<div style="display:flex; align-items:center; gap:8px">
          <button class="btn-sm" title="\u7F16\u8F91" style="min-width:32px; padding:4px 8px" onclick="openLogisticsCompanyModal(${c.id})">\u270E</button>
          ${enabled ? `<button class="btn-sm btn-red" onclick="toggleLogisticsCompany(${c.id}, false)">\u7981\u7528</button>` : `<button class="btn-sm" onclick="toggleLogisticsCompany(${c.id}, true)">\u542F\u7528</button>`}
        </div>` : `<span style="color:#64748b">-</span>`;
    return `
      <tr>
        <td>${list.length - idx}</td>
        <td>${escapeHtml(String(c.name || ""))}</td>
        <td>${escapeHtml(String(c.contact || ""))}</td>
        <td>${escapeHtml(String(c.phone || ""))}</td>
        <td>${statusTag}</td>
        <td>${action}</td>
      </tr>
    `;
  }).join("");
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
      const filtered = all.filter((x) => getLogisticsRecordStatus(x) === String(status || "ongoing"));
      try {
        if (status === "ongoing") {
          const shippedRes = await fetchWithAuth(`/api/daily-orders?status=shipped&_t=${Date.now()}`);
          if (shippedRes.ok) {
            const shippedList = await shippedRes.json().catch(() => []);
            const map = new Map((Array.isArray(shippedList) ? shippedList : []).map((o) => [String((o == null ? void 0 : o.id) || ""), String((o == null ? void 0 : o.invoice_no) || "").trim()]));
            let changed = false;
            filtered.forEach((r) => {
              if (r && !String(r.invoice_no || "").trim() && !String(r.orderNo || "").trim()) {
                const inv = map.get(String(r.order_id || r.id || "")) || "";
                if (inv) {
                  r.orderNo = inv;
                  changed = true;
                }
              }
            });
            if (changed) saveLocalLogisticsRecords(all);
          }
        }
      } catch (e) {
      }
      return filtered;
    }
    return [];
  }
  const list = await res.json();
  const arr = Array.isArray(list) ? list : [];
  try {
    if (status === "ongoing") {
      const missing = arr.some((r) => r && !String(r.invoice_no || "").trim() && !String(r.orderNo || "").trim() && (r.order_id || r.id));
      if (missing) {
        const shippedRes = await fetchWithAuth(`/api/daily-orders?status=shipped&_t=${Date.now()}`);
        if (shippedRes.ok) {
          const shippedList = await shippedRes.json().catch(() => []);
          const map = new Map((Array.isArray(shippedList) ? shippedList : []).map((o) => [String((o == null ? void 0 : o.id) || ""), String((o == null ? void 0 : o.invoice_no) || "").trim()]));
          arr.forEach((r) => {
            if (r && !String(r.invoice_no || "").trim() && !String(r.orderNo || "").trim()) {
              const inv = map.get(String(r.order_id || r.id || "")) || "";
              if (inv) r.orderNo = inv;
            }
          });
        }
      }
    }
  } catch (e) {
  }
  return mergeLogisticsRecordsWithLocal(status, arr);
}
async function loadLogisticsCompanies() {
  const panel = document.getElementById("logistics-company-panel");
  const tbody = document.getElementById("logistics-company-rows");
  if (!panel || !tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8">\u52A0\u8F7D\u4E2D...</td></tr>';
  const cached = loadLocalLogisticsCompanies();
  if (Array.isArray(cached) && cached.length > 0) {
    renderLogisticsCompaniesRows(tbody, cached);
  }
  let list = [];
  try {
    list = await apiLogisticsCompaniesList(false);
  } catch (e) {
  }
  renderLogisticsCompaniesRows(tbody, list);
}
async function toggleLogisticsCompany(id, enabled) {
  const res = await apiLogisticsCompanySetEnabled(id, enabled);
  if (!res.ok) {
    if (res.status === 403) alert("\u6CA1\u6709\u6743\u9650\u6267\u884C\u6B64\u64CD\u4F5C");
    else alert("\u64CD\u4F5C\u5931\u8D25");
    return;
  }
  await apiLogisticsCompaniesList(true);
  loadLogistics("companies");
}
function updateLogisticsReviewButton() {
  const btn = document.getElementById("logistics-review-btn");
  if (!btn) return;
  const selectedIds = ensureLogisticsReviewSelectedIds();
  const selectedCount = selectedIds.size;
  const isConfirm = logisticsReviewMode && selectedCount > 0;
  btn.style.display = currentLogisticsTab === "completed" ? "inline-flex" : "none";
  btn.innerHTML = isConfirm ? `\u5DF2\u9009\u4E2D <span style="font-size:18px; color:#f97316; font-weight:700; line-height:1">${selectedCount}</span> \u786E\u8BA4\u5BA1\u6838` : "\u5BA1\u6838\u7269\u6D41";
  btn.style.background = isConfirm ? "#2563eb" : "#f97316";
  btn.style.borderColor = isConfirm ? "#2563eb" : "#ea580c";
  btn.style.color = "#fff";
}
function updateLogisticsCompletedTabCount(count) {
  const el = document.getElementById("tab-logistics-completed-count");
  const total = Number(count || 0) || 0;
  logisticsCompletedTotalCount = total;
  if (el) {
    el.style.display = "inline";
    el.textContent = String(total);
  }
}
function updateLogisticsOngoingBadgeCount(count) {
  const total = Number(count || 0) || 0;
  logisticsOngoingBadgeCountCache = total;
  writeBadgeCountCache("nav-logistics-badge-cache", total);
  const navBadge = document.getElementById("nav-logistics-badge");
  if (navBadge) {
    navBadge.textContent = String(total);
    navBadge.style.display = total > 0 ? "inline-block" : "none";
  }
  const tabBadge = document.getElementById("tab-logistics-ongoing-badge");
  if (tabBadge) {
    tabBadge.textContent = String(total);
    tabBadge.style.display = total > 0 ? "inline-block" : "none";
  }
  updateNavDailyOpsBadgeCount();
}
navTaskBadgeCountCache = readBadgeCountCache("nav-task-badge-cache");
navOrderBadgeCountCache = readBadgeCountCache("nav-order-badge-cache");
logisticsOngoingBadgeCountCache = readBadgeCountCache("nav-logistics-badge-cache");
async function refreshLogisticsCompletedTabCount() {
  const want = "completed";
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
  } catch (e) {
    updateLogisticsCompletedTabCount(logisticsCompletedTotalCount);
    return;
  }
  try {
    const localAll = loadLocalLogisticsRecords();
    if (Array.isArray(localAll) && localAll.length > 0) {
      const localMap = new Map(localAll.map((x) => [String((x == null ? void 0 : x.order_id) || (x == null ? void 0 : x.id) || ""), x]));
      const seen = /* @__PURE__ */ new Set();
      let total = 0;
      remoteList.forEach((r) => {
        const key = String((r == null ? void 0 : r.id) || (r == null ? void 0 : r.order_id) || "");
        if (key) seen.add(key);
        const local = localMap.get(key);
        const localStatus = String((local == null ? void 0 : local.status) || "").trim();
        if (localStatus && localStatus !== want) return;
        total += 1;
      });
      localAll.forEach((x) => {
        const key = String((x == null ? void 0 : x.order_id) || (x == null ? void 0 : x.id) || "");
        if (!key || seen.has(key)) return;
        if (String((x == null ? void 0 : x.status) || "").trim() !== want) return;
        total += 1;
      });
      updateLogisticsCompletedTabCount(total);
      return;
    }
  } catch (e) {
  }
  updateLogisticsCompletedTabCount(remoteList.length);
}
function getLogisticsCompletedFilterValue(item, key) {
  if (key === "from") return String((item == null ? void 0 : item.logistics_from) || (item == null ? void 0 : item.from) || "").trim();
  if (key === "company") return String((item == null ? void 0 : item.logistics_company) || (item == null ? void 0 : item.company) || "").trim();
  return "";
}
function getLogisticsCompletedFilterOptions(sourceList, key) {
  return Array.from(new Set((Array.isArray(sourceList) ? sourceList : []).map((item) => getLogisticsCompletedFilterValue(item, key)).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));
}
function renderLogisticsCompletedFilterHeader(label, key, sourceList) {
  const menuId = `logistics-completed-filter-menu-${key}`;
  const arrowId = `logistics-completed-filter-arrow-${key}`;
  const wrapId = `logistics-completed-filter-wrap-${key}`;
  const options = getLogisticsCompletedFilterOptions(sourceList, key);
  const currentValue = String((logisticsCompletedFilters == null ? void 0 : logisticsCompletedFilters[key]) || "").trim();
  const isOpen = logisticsCompletedFilterMenuKey === key;
  const allLabel = key === "company" ? "\u5168\u90E8\u7269\u6D41\u516C\u53F8" : "\u5168\u90E8\u53D1\u51FA\u5730";
  return `
    <div id="${wrapId}" class="logistics-completed-filter-wrap" style="position:relative; display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none" onclick="toggleLogisticsCompletedFilterMenu('${key}')">
      <span>${label}</span>
      <span id="${arrowId}" style="font-size:12px; color:#94a3b8">${isOpen ? "\u25BC" : "\u25BE"}</span>
      <div id="${menuId}" class="dropdown" style="display:${isOpen ? "block" : "none"}; left:0; right:auto; top:calc(100% + 8px); min-width:180px; max-width:260px; z-index:80" onclick="event.stopPropagation()">
        <div class="dd-list" style="max-height:260px">
          <div class="dd-item" onclick="setLogisticsCompletedFilter('${key}', '')" style="${!currentValue ? "background:#132033; color:#fff" : ""}">${allLabel}</div>
          ${options.map((value) => `<div class="dd-item" onclick="setLogisticsCompletedFilter('${key}', '${encodeURIComponent(value)}')" style="${String(value) === currentValue ? "background:#132033; color:#fff" : ""}">${escapeHtml(value)}</div>`).join("")}
        </div>
      </div>
    </div>`;
}
function syncLogisticsCompletedFilterMenusUI() {
  ["from", "company"].forEach((key) => {
    const menu = document.getElementById(`logistics-completed-filter-menu-${key}`);
    const arrow = document.getElementById(`logistics-completed-filter-arrow-${key}`);
    const isOpen = logisticsCompletedFilterMenuKey === key;
    if (menu) menu.style.display = isOpen ? "block" : "none";
    if (arrow) arrow.textContent = isOpen ? "\u25BC" : "\u25BE";
  });
}
function toggleLogisticsCompletedFilterMenu(key) {
  if (currentLogisticsTab !== "completed") return;
  logisticsCompletedFilterMenuKey = logisticsCompletedFilterMenuKey === key ? "" : key;
  syncLogisticsCompletedFilterMenusUI();
}
function setLogisticsCompletedFilter(key, encodedValue) {
  logisticsCompletedFilters[key] = decodeURIComponent(String(encodedValue || ""));
  logisticsCompletedFilterMenuKey = "";
  renderLogisticsTable(currentLogisticsRecords);
}
function closeLogisticsCompletedFilterMenus() {
  if (!logisticsCompletedFilterMenuKey) return;
  logisticsCompletedFilterMenuKey = "";
  syncLogisticsCompletedFilterMenusUI();
}
function getLogisticsReviewedFilterValue(item, key) {
  if (key === "from") return String((item == null ? void 0 : item.logistics_from) || (item == null ? void 0 : item.from) || "").trim();
  if (key === "to") return String((item == null ? void 0 : item.logistics_to) || (item == null ? void 0 : item.to) || "").trim();
  if (key === "company") return String((item == null ? void 0 : item.logistics_company) || (item == null ? void 0 : item.company) || "").trim();
  if (key === "updated") return String(Number((item == null ? void 0 : item.logistics_updated_at) || 0) || Number((item == null ? void 0 : item.updatedAt) || 0) || Number((item == null ? void 0 : item.shipped_at) || 0) || 0);
  return "";
}
function formatLogisticsReviewedUpdatedLabel(value) {
  const ts = Number(value || 0) || 0;
  return ts ? formatDisplayDateTimeValue(ts) : "-";
}
function getLogisticsReviewedFilterOptions(sourceList, key) {
  const values = Array.from(new Set((Array.isArray(sourceList) ? sourceList : []).map((item) => getLogisticsReviewedFilterValue(item, key)).filter(Boolean)));
  if (key === "updated") return values.sort((a, b) => Number(b) - Number(a));
  return values.sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));
}
function renderLogisticsReviewedFilterHeader(label, key, sourceList) {
  const menuId = `logistics-reviewed-filter-menu-${key}`;
  const arrowId = `logistics-reviewed-filter-arrow-${key}`;
  const wrapId = `logistics-reviewed-filter-wrap-${key}`;
  const options = getLogisticsReviewedFilterOptions(sourceList, key);
  const currentValue = String((logisticsReviewedFilters == null ? void 0 : logisticsReviewedFilters[key]) || "").trim();
  const isOpen = logisticsReviewedFilterMenuKey === key;
  return `
    <div id="${wrapId}" class="logistics-reviewed-filter-wrap" style="position:relative; display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none" onclick="toggleLogisticsReviewedFilterMenu('${key}')">
      <span>${label}</span>
      <span id="${arrowId}" style="font-size:12px; color:#94a3b8">${isOpen ? "\u25BC" : "\u25BE"}</span>
      <div id="${menuId}" class="dropdown" style="display:${isOpen ? "block" : "none"}; left:0; right:auto; top:calc(100% + 8px); min-width:180px; max-width:260px; z-index:40" onclick="event.stopPropagation()">
        <div class="dd-list" style="max-height:260px">
          <div class="dd-item" onclick="setLogisticsReviewedFilter('${key}', '')" style="${!currentValue ? "background:#132033; color:#fff" : ""}">\u5168\u90E8</div>
          ${options.map((value) => `<div class="dd-item" onclick="setLogisticsReviewedFilter('${key}', '${encodeURIComponent(value)}')" style="${String(value) === currentValue ? "background:#132033; color:#fff" : ""}">${escapeHtml(key === "updated" ? formatLogisticsReviewedUpdatedLabel(value) : value)}</div>`).join("")}
        </div>
      </div>
    </div>`;
}
function syncLogisticsReviewedFilterMenusUI() {
  ["from", "to", "company", "updated"].forEach((key) => {
    const menu = document.getElementById(`logistics-reviewed-filter-menu-${key}`);
    const arrow = document.getElementById(`logistics-reviewed-filter-arrow-${key}`);
    const isOpen = logisticsReviewedFilterMenuKey === key;
    if (menu) menu.style.display = isOpen ? "block" : "none";
    if (arrow) arrow.textContent = isOpen ? "\u25BC" : "\u25BE";
  });
}
function toggleLogisticsReviewedFilterMenu(key) {
  if (currentLogisticsTab !== "reviewed") return;
  logisticsReviewedFilterMenuKey = logisticsReviewedFilterMenuKey === key ? "" : key;
  syncLogisticsReviewedFilterMenusUI();
}
function setLogisticsReviewedFilter(key, encodedValue) {
  logisticsReviewedFilters[key] = decodeURIComponent(String(encodedValue || ""));
  logisticsReviewedFilterMenuKey = "";
  renderLogisticsTable(currentLogisticsRecords);
}
function closeLogisticsReviewedFilterMenus() {
  if (!logisticsReviewedFilterMenuKey) return;
  logisticsReviewedFilterMenuKey = "";
  syncLogisticsReviewedFilterMenusUI();
}
function getFilteredLogisticsList(rawList) {
  const sourceList = Array.isArray(rawList) ? rawList : [];
  if (currentLogisticsTab === "completed") {
    return sourceList.filter((x) => {
      if (logisticsCompletedFilters.from && getLogisticsCompletedFilterValue(x, "from") !== logisticsCompletedFilters.from) return false;
      if (logisticsCompletedFilters.company && getLogisticsCompletedFilterValue(x, "company") !== logisticsCompletedFilters.company) return false;
      return true;
    });
  }
  if (currentLogisticsTab === "reviewed") {
    return sourceList.filter((x) => {
      if (logisticsReviewedFilters.from && getLogisticsReviewedFilterValue(x, "from") !== logisticsReviewedFilters.from) return false;
      if (logisticsReviewedFilters.to && getLogisticsReviewedFilterValue(x, "to") !== logisticsReviewedFilters.to) return false;
      if (logisticsReviewedFilters.company && getLogisticsReviewedFilterValue(x, "company") !== logisticsReviewedFilters.company) return false;
      if (logisticsReviewedFilters.updated && getLogisticsReviewedFilterValue(x, "updated") !== logisticsReviewedFilters.updated) return false;
      return true;
    });
  }
  return sourceList;
}
function renderLogisticsReviewHeader(list) {
  const visibleIds = (Array.isArray(list) ? list : []).map((x) => Number(x == null ? void 0 : x.order_id || x == null ? void 0 : x.id || 0)).filter(Boolean);
  const selectedIds = ensureLogisticsReviewSelectedIds();
  const allSelected = logisticsReviewMode && visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(String(id)));
  const disabledAttr = visibleIds.length === 0 ? "disabled" : "";
  return `操作 <input type="checkbox" style="margin-left:8px; vertical-align:middle; cursor:${visibleIds.length > 0 ? "pointer" : "not-allowed"}" ${allSelected ? "checked" : ""} ${disabledAttr} onchange="toggleLogisticsReviewSelectAll(this.checked)" title="全选当前列表">`;
}
function renderLogisticsTable(rawList) {
  const tbody = document.getElementById("logistics-rows");
  if (!tbody) return;
  const sourceList = Array.isArray(rawList) ? rawList : [];
  const companyHead = document.getElementById("logistics-company-head");
  const fromHead = document.getElementById("logistics-from-head");
  const toHead = document.getElementById("logistics-to-head");
  const updatedHead = document.getElementById("logistics-updated-head");
  const personHead = document.getElementById("logistics-person-head");
  const actionHead = document.getElementById("logistics-action-head");
  const cargoHead = document.getElementById("logistics-cargo-head");
  if (fromHead) {
    fromHead.innerHTML = currentLogisticsTab === "completed" ? renderLogisticsCompletedFilterHeader("\u53D1\u51FA\u5730", "from", sourceList) : currentLogisticsTab === "reviewed" ? renderLogisticsReviewedFilterHeader("\u53D1\u51FA\u5730", "from", sourceList) : "\u53D1\u51FA\u5730";
  }
  if (toHead) {
    toHead.innerHTML = currentLogisticsTab === "reviewed" ? renderLogisticsReviewedFilterHeader("\u76EE\u7684\u5730", "to", sourceList) : "\u76EE\u7684\u5730";
  }
  if (updatedHead) {
    updatedHead.innerHTML = currentLogisticsTab === "reviewed" ? renderLogisticsReviewedFilterHeader("\u66F4\u65B0\u65F6\u95F4", "updated", sourceList) : "\u66F4\u65B0\u65F6\u95F4";
  }
  if (cargoHead) cargoHead.textContent = "\u8D27\u7269\u4FE1\u606F";
  if (personHead) personHead.textContent = currentLogisticsTab === "ongoing" ? "\u64CD\u4F5C\u4EBA\u5458" : "\u4EBA\u5458";
  let list = getFilteredLogisticsList(sourceList);
  if (actionHead) {
    actionHead.innerHTML = currentLogisticsTab === "completed" ? renderLogisticsReviewHeader(list) : "\u64CD\u4F5C";
  }
  if (companyHead) {
    if (currentLogisticsTab === "completed") {
      companyHead.innerHTML = renderLogisticsCompletedFilterHeader("\u7269\u6D41\u516C\u53F8", "company", sourceList);
    } else if (currentLogisticsTab === "reviewed") {
      companyHead.innerHTML = renderLogisticsReviewedFilterHeader("\u7269\u6D41\u516C\u53F8", "company", sourceList);
    } else {
      companyHead.textContent = "\u7269\u6D41\u516C\u53F8";
    }
  }
  if (!Array.isArray(list) || list.length === 0) {
    tbody.innerHTML = '<tr class="empty"><td colspan="9">\u6682\u65E0\u7269\u6D41\u8BB0\u5F55</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((x, idx) => {
    const rowId = Number(x.order_id || x.id || 0);
    const rowSelected = currentLogisticsTab === "completed" && logisticsReviewMode && logisticsReviewSelectedIds.has(String(rowId));
    const rowTextColor = rowSelected ? "#f97316" : "#e2e8f0";
    const rowSubTextColor = rowSelected ? "#fb923c" : "#94a3b8";
    const updatedAt = Number(x.logistics_updated_at || 0) || Number(x.shipped_at || 0) || Number(x.updatedAt || 0) || 0;
    const updatedText = updatedAt ? formatDisplayDateTimeValue(updatedAt) : "-";
    const orderNo = String(x.invoice_no || x.orderNo || (rowId ? `\u7269\u6D41\u5355-${String(rowId).padStart(6, "0")}` : "-"));
    const fromText = String(x.logistics_from || x.from || "-");
    const toText = String(x.logistics_to || x.to || "-");
    const companyName = String(x.logistics_company || x.company || "-");
    let shipDateText = String(x.logistics_ship_date || x.ship_date || x.shipDate || "").trim();
    if (!shipDateText) {
      const st = Number(x.shipped_at || x.shippedAt || 0) || 0;
      if (st) shipDateText = formatDateFromTs(st);
    }
    if (shipDateText && shipDateText.length > 10) shipDateText = shipDateText.slice(0, 10);
    let arrivalDateText = String(x.logistics_arrival_date || x.arrival_date || x.arrivalDate || "").trim();
    if (arrivalDateText && arrivalDateText.length > 10) arrivalDateText = arrivalDateText.slice(0, 10);
    const palletText = String(x.logistics_pallet_count || x.pallet_count || x.palletCount || "").trim();
    const boxText = String(x.logistics_box_count || x.box_count || x.boxCount || "").trim();
    const weightText = String(x.logistics_total_weight || x.total_weight || x.totalWeight || "").trim();
    const timeMeta = [];
    if (shipDateText) timeMeta.push(`\u53D1\u8D27\u65E5\u671F: ${escapeHtml(formatDisplayDate(shipDateText))}`);
    if (arrivalDateText) timeMeta.push(`\u5230\u8D27\u65E5\u671F: ${escapeHtml(formatDisplayDate(arrivalDateText))}`);
    const updatedCell = timeMeta.length > 0 ? `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(updatedText)}</div>${timeMeta.map((text, metaIdx) => `<div style="color:${rowSubTextColor}; font-size:12px; margin-top:${metaIdx === 0 ? 4 : 2}px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${text}</div>`).join("")}` : escapeHtml(updatedText);
    const cargoCell = [
      `\u6258\u76D8\uFF1A${escapeHtml(palletText || "-")}`,
      `\u603B\u7BB1\u6570\uFF1A${escapeHtml(boxText || "-")}`,
      `\u603B\u91CD\u91CFkg\uFF1A${escapeHtml(weightText || "-")}`
    ].map((text, cargoIdx) => `<div style="color:${cargoIdx === 0 ? rowTextColor : rowSubTextColor}; font-size:${cargoIdx === 0 ? 13 : 12}px; margin-top:${cargoIdx === 0 ? 0 : 2}px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${text}</div>`).join("");
    const shippedByText = String(x.shipped_by || x.created_by || "-");
    const completedByText = String(x.logistics_completed_by || x.completed_by || x.shipped_by || "-");
    const reviewedByText = String(x.logistics_reviewed_by || x.reviewed_by || "-");
    const personCell = currentLogisticsTab === "ongoing" ? `${escapeHtml(shippedByText)}` : currentLogisticsTab === "completed" ? `<div style="height:21px"></div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">\u53D1\u8D27\u4EBA\u5458\uFF1A${escapeHtml(shippedByText)}</div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">\u5230\u8D27\u4EBA\u5458\uFF1A${escapeHtml(completedByText)}</div>` : currentLogisticsTab === "reviewed" ? `<div style="height:21px"></div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">\u53D1\u8D27\u4EBA\u5458\uFF1A${escapeHtml(shippedByText)}</div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">\u5230\u8D27\u4EBA\u5458\uFF1A${escapeHtml(completedByText)}</div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">\u5BA1\u6838\u4EBA\u5458\uFF1A${escapeHtml(reviewedByText)}</div>` : '<span style="color:#64748b">-</span>';
    const actionCell = currentLogisticsTab === "ongoing" ? `<div class="logistics-action-cell"><button class="btn-sm btn-outline-blue" onclick="openLogisticsEditModal(${rowId})">\u7F16\u8F91</button><button class="btn-sm btn-outline-green" onclick="openLogisticsCompleteModal(${rowId})">\u8BBE\u4E3A\u5DF2\u7B7E\u6536</button></div>` : currentLogisticsTab === "completed" ? logisticsReviewMode ? `<label style="display:flex; justify-content:center"><input type="checkbox" ${logisticsReviewSelectedIds.has(String(rowId)) ? "checked" : ""} onchange="toggleLogisticsReviewSelection(${rowId}, this.checked)"></label>` : '<span style="color:#64748b">-</span>' : escapeHtml(String(x.notes || ""));
    return `
      <tr style="color:${rowTextColor}">
        <td style="color:${rowTextColor}">${list.length - idx}</td>
        <td style="color:${rowTextColor}"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(orderNo)}</div><div style="color:${rowSubTextColor}; font-size:12px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(String(x.customer || "-"))}</div></td>
        <td style="color:${rowTextColor}"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(fromText)}</div></td>
        <td style="color:${rowTextColor}"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(toText)}</div></td>
        <td style="color:${rowTextColor}"><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(companyName)}</div></td>
        <td style="color:${rowTextColor}">${cargoCell}</td>
        <td style="color:${rowTextColor}">${updatedCell}</td>
        <td style="color:${rowTextColor}">${personCell}</td>
        <td>${actionCell}</td>
      </tr>
    `;
  }).join("");
}
function toggleLogisticsReviewSelection(id, checked) {
  const key = String(id || "").trim();
  if (!key) return;
  const selectedIds = ensureLogisticsReviewSelectedIds();
  if (checked) selectedIds.add(key);
  else selectedIds.delete(key);
  updateLogisticsReviewButton();
  renderLogisticsTable(currentLogisticsRecords);
}
function toggleLogisticsReviewSelectAll(checked) {
  if (currentLogisticsTab !== "completed") return;
  const selectedIds = ensureLogisticsReviewSelectedIds();
  const visibleIds = getFilteredLogisticsList(currentLogisticsRecords).map((x) => Number(x == null ? void 0 : x.order_id || x == null ? void 0 : x.id || 0)).filter(Boolean);
  if (!logisticsReviewMode) {
    logisticsReviewMode = true;
    selectedIds.clear();
  }
  visibleIds.forEach((id) => {
    const key = String(id);
    if (checked) selectedIds.add(key);
    else selectedIds.delete(key);
  });
  updateLogisticsReviewButton();
  renderLogisticsTable(currentLogisticsRecords);
}
async function handleLogisticsReviewAction() {
  var _a2;
  if (currentLogisticsTab !== "completed") return;
  const selectedIds = ensureLogisticsReviewSelectedIds();
  if (!logisticsReviewMode) {
    logisticsReviewMode = true;
    selectedIds.clear();
    updateLogisticsReviewButton();
    loadLogistics("completed");
    return;
  }
  if (selectedIds.size === 0) {
    alert("\u8BF7\u5148\u52FE\u9009\u8981\u5BA1\u6838\u7684\u7269\u6D41");
    return;
  }
  const ids = Array.from(selectedIds).map((x) => Number(x)).filter(Boolean);
  if (ids.length === 0) return;
  const btn = document.getElementById("logistics-review-btn");
  if (btn) btn.disabled = true;
  try {
    const res = await fetchWithAuth("/api/logistics/records/review", {
      method: "PUT",
      body: JSON.stringify({ ids })
    });
    const userName = String(((_a2 = getAuthUser()) == null ? void 0 : _a2.name) || "");
    const now = Date.now();
    if (!res.ok && res.status !== 404) {
      alert("\u5BA1\u6838\u5931\u8D25");
      return;
    }
    const all = loadLocalLogisticsRecords();
    const next = (Array.isArray(all) ? all : []).map((x) => {
      const key = String((x == null ? void 0 : x.order_id) || (x == null ? void 0 : x.id) || "");
      if (ids.some((id) => String(id) === key)) {
        return { ...x, status: "reviewed", logistics_status: "reviewed", logistics_reviewed_by: userName, reviewed_by: userName, updatedAt: now };
      }
      return x;
    });
    saveLocalLogisticsRecords(next);
    logisticsReviewMode = false;
    selectedIds.clear();
    updateLogisticsReviewButton();
    loadLogistics("completed");
    updateGlobalBadges();
  } catch (e) {
    console.error(e);
    alert("\u5BA1\u6838\u5931\u8D25\uFF1A\u540E\u7AEF\u4E0D\u53EF\u7528\u6216\u7F51\u7EDC\u5F02\u5E38");
  } finally {
    if (btn) btn.disabled = false;
  }
}
function loadLogistics(status = "ongoing", btn = null) {
  currentLogisticsTab = status || "ongoing";
  refreshLogisticsCompletedTabCount();
  if (currentLogisticsTab !== "completed") {
    logisticsCompletedFilterMenuKey = "";
    logisticsReviewMode = false;
    ensureLogisticsReviewSelectedIds().clear();
  }
  if (currentLogisticsTab !== "reviewed") {
    logisticsReviewedFilterMenuKey = "";
  }
  updateLogisticsReviewButton();
  const createOrderBtn = document.getElementById("logistics-create-order-btn");
  const companyAddBtn = document.getElementById("logistics-company-add-btn");
  if (createOrderBtn) createOrderBtn.style.display = currentLogisticsTab === "ongoing" ? "inline-flex" : "none";
  if (companyAddBtn) companyAddBtn.style.display = currentLogisticsTab === "companies" ? "inline-flex" : "none";
  if (btn) {
    const tabs = btn.closest(".tabs");
    if (tabs) {
      tabs.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    }
  } else {
    const tabs = document.querySelector("#page-logistics .tabs");
    if (tabs) {
      tabs.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      const target = tabs.querySelector(`[data-tab="${currentLogisticsTab}"]`);
      if (target) target.classList.add("active");
    }
  }
  const recordPanel = document.getElementById("logistics-record-panel");
  const companyPanel = document.getElementById("logistics-company-panel");
  const pager = document.getElementById("logistics-pager");
  if (currentLogisticsTab === "companies") {
    if (recordPanel) recordPanel.style.display = "none";
    if (pager) pager.style.display = "none";
    if (companyPanel) companyPanel.style.display = "block";
    loadLogisticsCompanies();
    return;
  }
  if (recordPanel) recordPanel.style.display = "block";
  if (pager) pager.style.display = "flex";
  if (companyPanel) companyPanel.style.display = "none";
  const tbody = document.getElementById("logistics-rows");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#94a3b8">\u52A0\u8F7D\u4E2D...</td></tr>';
  (async () => {
    let list = [];
    try {
      list = await loadLogisticsRecords(currentLogisticsTab);
    } catch (e) {
      if ((e == null ? void 0 : e.name) === "AbortError") return;
    }
    currentLogisticsRecords = Array.isArray(list) ? list : [];
    if (currentLogisticsTab === "ongoing") {
      updateLogisticsOngoingBadgeCount(currentLogisticsRecords.length);
    }
    renderLogisticsTable(currentLogisticsRecords);
  })();
}
document.addEventListener("click", (e) => {
  const target = e.target;
  if (target && typeof target.closest === "function") {
    if (currentLogisticsTab === "completed" && target.closest(".logistics-completed-filter-wrap")) return;
    if (currentLogisticsTab === "reviewed" && target.closest(".logistics-reviewed-filter-wrap")) return;
  }
  if (currentLogisticsTab === "completed") closeLogisticsCompletedFilterMenus();
  if (currentLogisticsTab === "reviewed") closeLogisticsReviewedFilterMenus();
});
function openLogisticsCompanyModal(companyId = 0) {
  const m = document.getElementById("logistics-company-modal");
  if (!m) return;
  const msg = document.getElementById("lgc-msg");
  const titleEl = document.getElementById("logistics-company-modal-title");
  const submitBtn = document.getElementById("logistics-company-submit-btn");
  if (msg) msg.style.display = "none";
  const name = document.getElementById("lgc-name");
  const phone = document.getElementById("lgc-phone");
  const contact = document.getElementById("lgc-contact");
  const generateOrder = document.getElementById("lgc-generate-order");
  const record = (Array.isArray(logisticsCompanies) ? logisticsCompanies : []).find((x) => String((x == null ? void 0 : x.id) || "") === String(companyId || ""));
  currentLogisticsCompanyEditId = record ? Number(record.id || 0) : 0;
  if (titleEl) titleEl.textContent = currentLogisticsCompanyEditId ? "\u7F16\u8F91\u7269\u6D41\u516C\u53F8" : "\u65B0\u589E\u7269\u6D41\u516C\u53F8";
  if (submitBtn) submitBtn.textContent = currentLogisticsCompanyEditId ? "\u4FDD\u5B58" : "\u786E\u5B9A";
  if (name) name.value = record ? String(record.name || "") : "";
  if (phone) phone.value = record ? String(record.phone || "") : "";
  if (contact) contact.value = record ? String(record.contact || "") : "";
  if (generateOrder) generateOrder.value = (record == null ? void 0 : record.generate_logistics_order) === false ? "false" : "true";
  m.style.display = "flex";
  if (name) name.focus();
}
function openLogisticsCompleteModal(orderId) {
  const id = Number(orderId || 0);
  if (!id) return;
  const m = document.getElementById("logistics-complete-modal");
  const idEl = document.getElementById("logistics-complete-order-id");
  const dateEl = document.getElementById("logistics-complete-date");
  const okBtn = document.getElementById("logistics-complete-ok");
  if (!m || !idEl || !dateEl) return;
  idEl.value = String(id);
  dateEl.value = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (okBtn) okBtn.disabled = false;
  m.style.display = "flex";
}
function closeLogisticsCompleteModal() {
  const m = document.getElementById("logistics-complete-modal");
  if (m) m.style.display = "none";
}
async function confirmLogisticsComplete() {
  var _a2, _b2, _c2;
  const id = Number(((_a2 = document.getElementById("logistics-complete-order-id")) == null ? void 0 : _a2.value) || 0);
  const date = String(((_b2 = document.getElementById("logistics-complete-date")) == null ? void 0 : _b2.value) || "").trim();
  if (!id) return;
  if (!date) {
    alert("\u8BF7\u9009\u62E9\u8D27\u7269\u5230\u8FBE\u65E5\u671F");
    return;
  }
  const okBtn = document.getElementById("logistics-complete-ok");
  if (okBtn) okBtn.disabled = true;
  try {
    const res = await fetchWithAuth(`/api/logistics/records/${id}/complete`, {
      method: "PUT",
      body: JSON.stringify({ arrival_date: date })
    });
    if (!res.ok && res.status !== 404) {
      alert("\u64CD\u4F5C\u5931\u8D25");
      return;
    }
    const all = loadLocalLogisticsRecords();
    const userName = String(((_c2 = getAuthUser()) == null ? void 0 : _c2.name) || "");
    const now = Date.now();
    const next = (Array.isArray(all) ? all : []).map((x) => {
      if (String((x == null ? void 0 : x.order_id) || (x == null ? void 0 : x.id) || "") === String(id)) {
        return {
          ...x,
          status: "completed",
          logistics_status: "completed",
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
    if (currentLogisticsTab === "ongoing") loadLogistics("ongoing");
    updateGlobalBadges();
  } catch (e) {
    console.error(e);
    alert("\u64CD\u4F5C\u5931\u8D25\uFF1A\u540E\u7AEF\u4E0D\u53EF\u7528\u6216\u7F51\u7EDC\u5F02\u5E38");
  } finally {
    if (okBtn) okBtn.disabled = false;
  }
}
function closeLogisticsCompanyModal() {
  const m = document.getElementById("logistics-company-modal");
  currentLogisticsCompanyEditId = 0;
  if (m) m.style.display = "none";
}
async function submitLogisticsCompany() {
  var _a2, _b2, _c2, _d;
  const msg = document.getElementById("lgc-msg");
  const name = String(((_a2 = document.getElementById("lgc-name")) == null ? void 0 : _a2.value) || "").trim();
  const phone = String(((_b2 = document.getElementById("lgc-phone")) == null ? void 0 : _b2.value) || "").trim();
  const contact = String(((_c2 = document.getElementById("lgc-contact")) == null ? void 0 : _c2.value) || "").trim();
  const generateLogisticsOrder = String(((_d = document.getElementById("lgc-generate-order")) == null ? void 0 : _d.value) || "true") !== "false";
  if (!name) {
    if (msg) {
      msg.textContent = "\u8BF7\u586B\u5199\u516C\u53F8\u540D\u79F0";
      msg.style.display = "inline-block";
    }
    return;
  }
  const payload = { name, phone, contact, generate_logistics_order: generateLogisticsOrder };
  const isEdit = currentLogisticsCompanyEditId > 0;
  const res = isEdit ? await apiLogisticsCompanyUpdate(currentLogisticsCompanyEditId, payload) : await apiLogisticsCompanyCreate(payload);
  if (!res.ok) {
    let text = isEdit ? "\u4FDD\u5B58\u5931\u8D25" : "\u65B0\u589E\u5931\u8D25";
    if (res.status === 409) text = "\u516C\u53F8\u540D\u79F0\u5DF2\u5B58\u5728";
    if (msg) {
      msg.textContent = text;
      msg.style.display = "inline-block";
    }
    return;
  }
  closeLogisticsCompanyModal();
  await apiLogisticsCompaniesList(true);
  loadLogistics("companies");
  showAppToast(isEdit ? "\u7269\u6D41\u516C\u53F8\u5DF2\u66F4\u65B0" : "\u65B0\u589E\u6210\u529F");
}
async function apiAllPartnersList(force = false) {
  const now = Date.now();
  if (!force && allPartnersLoadedAt && now - allPartnersLoadedAt < 15e3 && Array.isArray(allPartners) && allPartners.length > 0) {
    return allPartners;
  }
  const out = [];
  const tabs = [
    { tab: "customers", owner: "\u5BA2\u6237" },
    { tab: "merchants", owner: "\u5546\u5BB6" },
    { tab: "others", owner: "\u5176\u5B83" }
  ];
  for (const t of tabs) {
    try {
      const r = await fetchWithAuth(`/api/contacts?tab=${encodeURIComponent(t.tab)}&page=1&size=5000&_t=${now}`);
      if (!r.ok) continue;
      const list = await r.json().catch(() => []);
      (Array.isArray(list) ? list : []).forEach((x) => {
        const name = String((x == null ? void 0 : x.name) || "").trim();
        const company = String((x == null ? void 0 : x.company) || "").trim();
        const label = name || company;
        if (!label) return;
        out.push({ label, name, company, owner: t.owner });
      });
    } catch (e) {
    }
  }
  out.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  allPartners = out;
  allPartnersLoadedAt = now;
  return allPartners;
}
function closePartnerSelect() {
  const m = document.getElementById("partner-select-modal");
  if (m) m.style.display = "none";
  partnerSelectTarget = "";
  partnerSelectMode = "field";
}
function loadDoShipDefaultFrom() {
  try {
    return String(localStorage.getItem(DO_SHIP_DEFAULT_FROM_KEY) || "").trim();
  } catch (e) {
    return "";
  }
}
function saveDoShipDefaultFrom(value) {
  const nextValue = String(value || "").trim();
  try {
    if (nextValue) localStorage.setItem(DO_SHIP_DEFAULT_FROM_KEY, nextValue);
    else localStorage.removeItem(DO_SHIP_DEFAULT_FROM_KEY);
  } catch (e) {
  }
  updateDoShipDefaultFromButton();
}
function updateDoShipDefaultFromButton() {
  const btn = document.getElementById("do-ship-from-default-btn");
  if (!btn) return;
  const defaultFrom = loadDoShipDefaultFrom();
  btn.title = defaultFrom ? `当前默认：${defaultFrom}` : "设置默认出发地";
  btn.style.color = defaultFrom ? "#93c5fd" : "";
  btn.style.borderColor = defaultFrom ? "#2563eb" : "";
}
function updateDoShipOkState() {
  var _a2, _b2, _c2, _d;
  const okBtn = document.getElementById("do-ship-ok");
  if (doShipModalMode === "prepare_ready_ship") {
    const boxCount = String(((_c2 = document.getElementById("do-ship-box-count")) == null ? void 0 : _c2.value) || "").trim();
    const totalWeight = String(((_d = document.getElementById("do-ship-total-weight")) == null ? void 0 : _d.value) || "").trim();
    if (okBtn) okBtn.disabled = !(boxCount && totalWeight);
    return;
  }
  if (doShipModalMode === "ship_voucher") {
    const hasVoucher = !!(doShipVoucherPendingFile || doShipVoucherExistingUrl);
    if (okBtn) okBtn.disabled = !(hasVoucher || canShipWithoutVoucher());
    return;
  }
  const sel = document.getElementById("do-ship-company");
  const toVal = String(((_a2 = document.getElementById("do-ship-to")) == null ? void 0 : _a2.value) || "").trim();
  const shipDate = String(((_b2 = document.getElementById("do-ship-date")) == null ? void 0 : _b2.value) || "").trim();
  const companyId = String((sel == null ? void 0 : sel.value) || "").trim();
  const ok = !!(companyId && toVal && shipDate);
  if (okBtn) okBtn.disabled = !ok;
  if (sel) sel.style.color = companyId ? "#e2e8f0" : "#ef4444";
}
function selectPartnerLabel(label) {
  const v = String(label || "").trim();
  if (!v) return;
  if (partnerSelectMode === "default_from") {
    saveDoShipDefaultFrom(v);
    const fromInput = document.getElementById("do-ship-from");
    if (fromInput) fromInput.value = v;
    updateDoShipOkState();
    closePartnerSelect();
    return;
  }
  const target = partnerSelectTarget;
  if (!target) return;
  const input = document.getElementById(target);
  if (input) input.value = v;
  updateDoShipOkState();
  closePartnerSelect();
}
function renderPartnerSelectList(q = "") {
  const listEl = document.getElementById("partner-select-list");
  if (!listEl) return;
  const kw = String(q || "").trim().toLowerCase();
  const src = Array.isArray(allPartners) ? allPartners : [];
  const filtered = kw ? src.filter((x) => (String(x.label || "") + " " + String(x.company || "") + " " + String(x.owner || "")).toLowerCase().includes(kw)) : src;
  const show = filtered.slice(0, 200);
  listEl.innerHTML = "";
  if (show.length === 0) {
    listEl.innerHTML = '<div style="padding:12px; color:#94a3b8">\u6682\u65E0\u5339\u914D\u5F80\u6765\u5355\u4F4D</div>';
    return;
  }
  show.forEach((x) => {
    const row = document.createElement("div");
    row.className = "dd-item";
    const left = document.createElement("div");
    left.textContent = String(x.label || "");
    const right = document.createElement("div");
    right.style.color = "#94a3b8";
    right.style.fontSize = "12px";
    right.textContent = String(x.owner || "");
    row.appendChild(left);
    row.appendChild(right);
    row.addEventListener("click", () => selectPartnerLabel(x.label));
    listEl.appendChild(row);
  });
}
async function openPartnerSelect(kind) {
  const m = document.getElementById("partner-select-modal");
  if (!m) return;
  const title = document.getElementById("partner-select-title");
  const search = document.getElementById("partner-select-search");
  const listEl = document.getElementById("partner-select-list");
  const normalizedKind = String(kind || "").trim();
  partnerSelectMode = normalizedKind === "default_from" ? "default_from" : "field";
  partnerSelectTarget = normalizedKind === "to" ? "do-ship-to" : "do-ship-from";
  if (title) title.textContent = normalizedKind === "to" ? "\u9009\u62E9\u76EE\u7684\u5730" : normalizedKind === "default_from" ? "\u9009\u62E9\u9ED8\u8BA4\u51FA\u53D1\u5730" : "\u9009\u62E9\u51FA\u53D1\u5730";
  if (search) {
    search.value = "";
    search.oninput = () => renderPartnerSelectList(search.value);
  }
  if (listEl) listEl.innerHTML = '<div style="padding:12px; color:#94a3b8">\u52A0\u8F7D\u4E2D...</div>';
  m.style.display = "flex";
  await apiAllPartnersList(true);
  renderPartnerSelectList("");
  if (search) search.focus();
}
function openDoShipDefaultFromSelect() {
  openPartnerSelect("default_from");
}
function revokeDoShipVoucherPreviewObjectUrl() {
  if (!doShipVoucherPreviewObjectUrl) return;
  try {
    URL.revokeObjectURL(doShipVoucherPreviewObjectUrl);
  } catch (e) {
  }
  doShipVoucherPreviewObjectUrl = "";
}
function renderDoShipVoucherPreview() {
  const thumb = document.getElementById("do-ship-voucher-thumb");
  const removeBtn = document.getElementById("do-ship-voucher-remove");
  const nameEl = document.getElementById("do-ship-voucher-name");
  const linkEl = document.getElementById("do-ship-voucher-link");
  const pendingName = String((doShipVoucherPendingFile == null ? void 0 : doShipVoucherPendingFile.name) || "").trim();
  const previewUrl = doShipVoucherPreviewObjectUrl || doShipVoucherExistingUrl;
  const displayName = pendingName || doShipVoucherExistingName || "未上传凭证";
  if (thumb) {
    thumb.src = previewUrl || "";
    thumb.style.display = previewUrl ? "block" : "none";
  }
  if (removeBtn) removeBtn.style.display = previewUrl ? "block" : "none";
  if (nameEl) nameEl.textContent = displayName;
  if (linkEl) {
    linkEl.href = doShipVoucherExistingUrl || "#";
    linkEl.style.display = doShipVoucherExistingUrl && !doShipVoucherPendingFile ? "inline-block" : "none";
  }
}
function resetDoShipVoucherState(url = "", name = "") {
  revokeDoShipVoucherPreviewObjectUrl();
  doShipVoucherPendingFile = null;
  doShipVoucherExistingUrl = String(url || "").trim();
  doShipVoucherExistingName = String(name || "").trim();
  const cameraInput = document.getElementById("do-ship-voucher-camera");
  const fileInput = document.getElementById("do-ship-voucher-file");
  if (cameraInput) cameraInput.value = "";
  if (fileInput) fileInput.value = "";
  renderDoShipVoucherPreview();
}
function clearDoShipVoucher() {
  resetDoShipVoucherState("", "");
  updateDoShipOkState();
}
window.clearDoShipVoucher = clearDoShipVoucher;
function triggerDoShipVoucherCamera() {
  const input = document.getElementById("do-ship-voucher-camera");
  if (input) input.click();
}
window.triggerDoShipVoucherCamera = triggerDoShipVoucherCamera;
function triggerDoShipVoucherUpload() {
  const input = document.getElementById("do-ship-voucher-file");
  if (input) input.click();
}
window.triggerDoShipVoucherUpload = triggerDoShipVoucherUpload;
async function compressDoShipVoucherImage(fileObj) {
  if (!fileObj) return null;
  const fileName = String(fileObj.name || "").trim().toLowerCase();
  const mimeType = String(fileObj.type || "").trim().toLowerCase();
  const extOk = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"].some((ext) => fileName.endsWith(ext));
  const mimeOk = mimeType.startsWith("image/");
  if (!(extOk || mimeOk)) throw new Error("bad_type");
  if (fileName.endsWith(".heic") || fileName.endsWith(".heif") || mimeType.includes("heic") || mimeType.includes("heif")) {
    return fileObj;
  }
  let objectUrl = "";
  try {
    objectUrl = URL.createObjectURL(fileObj);
    const img = await loadImageElement(objectUrl);
    const naturalWidth = Math.max(1, Number(img.naturalWidth || img.width || 1));
    const naturalHeight = Math.max(1, Number(img.naturalHeight || img.height || 1));
    const maxEdge = 2000;
    const scale = Math.min(maxEdge / naturalWidth, maxEdge / naturalHeight, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_failed");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const compressedBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!(compressedBlob instanceof Blob) || !compressedBlob.size) return fileObj;
    if (compressedBlob.size >= Number(fileObj.size || 0) * 0.98 && scale >= 0.999) return fileObj;
    const nextName = String(fileObj.name || "voucher.jpg").replace(/\.[^.]+$/, "") + ".jpg";
    return new File([compressedBlob], nextName, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
      }
    }
  }
}
async function uploadDoShipVoucherImage(fileObj) {
  const uploadFile = await compressDoShipVoucherImage(fileObj);
  if (!uploadFile) return { url: "", filename: "" };
  const fd = new FormData();
  fd.append("file", uploadFile);
  const token = getAuthToken();
  const r = await fetch(API_BASE + "/api/upload", {
    method: "POST",
    headers: token ? { "Authorization": "Bearer " + token } : {},
    body: fd
  });
  if (!r.ok) throw new Error("upload_failed");
  const d = await r.json();
  return {
    url: String((d == null ? void 0 : d.url) || "").trim(),
    filename: String((d == null ? void 0 : d.filename) || uploadFile.name || "").trim()
  };
}
function handleDoShipVoucherChange(input) {
  var _a2;
  const file = ((_a2 = input == null ? void 0 : input.files) == null ? void 0 : _a2[0]) || null;
  revokeDoShipVoucherPreviewObjectUrl();
  doShipVoucherPendingFile = file;
  if (file) {
    doShipVoucherPreviewObjectUrl = URL.createObjectURL(file);
  }
  renderDoShipVoucherPreview();
  updateDoShipOkState();
}
function bindDoShipVoucherInputs() {
  const cameraInput = document.getElementById("do-ship-voucher-camera");
  const fileInput = document.getElementById("do-ship-voucher-file");
  if (cameraInput && cameraInput.dataset.bound !== "1") {
    cameraInput.dataset.bound = "1";
    cameraInput.addEventListener("change", () => handleDoShipVoucherChange(cameraInput));
  }
  if (fileInput && fileInput.dataset.bound !== "1") {
    fileInput.dataset.bound = "1";
    fileInput.addEventListener("change", () => handleDoShipVoucherChange(fileInput));
  }
}
function closeDoShipModal() {
  const m = document.getElementById("do-ship-modal");
  if (m) m.style.display = "none";
  resetDoShipVoucherState("", "");
}
let doShipModalMode = "ship";
let doShipVoucherPendingFile = null;
let doShipVoucherExistingUrl = "";
let doShipVoucherExistingName = "";
let doShipVoucherPreviewObjectUrl = "";
function selectShipFieldAll(input) {
  if (!input) return;
  try {
    input.focus();
    input.select();
    if (typeof input.setSelectionRange === "function") {
      const end = String(input.value || "").length;
      input.setSelectionRange(0, end);
    }
  } catch (e) {
  }
}
function focusDoShipNextField(currentId) {
  const order = ["do-ship-company", "do-ship-pallet-count", "do-ship-box-count", "do-ship-total-weight", "do-ship-ok"];
  const currentIndex = order.indexOf(String(currentId || ""));
  if (currentIndex < 0) return;
  for (let i = currentIndex + 1; i < order.length; i += 1) {
    const nextEl = document.getElementById(order[i]);
    if (!nextEl || nextEl.disabled || nextEl.offsetParent === null) continue;
    if (nextEl.tagName === "BUTTON") {
      nextEl.focus();
    } else {
      selectShipFieldAll(nextEl);
    }
    return;
  }
}
function bindDoShipEnterAdvance(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.enterAdvanceBound === "1") return;
  input.dataset.enterAdvanceBound = "1";
  input.addEventListener("focus", () => {
    if (input.tagName === "INPUT") setTimeout(() => selectShipFieldAll(input), 0);
  });
  input.addEventListener("click", () => {
    if (input.tagName === "INPUT") selectShipFieldAll(input);
  });
  input.addEventListener("mouseup", (e) => {
    if (input.tagName !== "INPUT") return;
    e.preventDefault();
    selectShipFieldAll(input);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    focusDoShipNextField(inputId);
  });
}
function bindDoShipFieldNavigation() {
  bindDoShipEnterAdvance("do-ship-company");
  bindDoShipEnterAdvance("do-ship-pallet-count");
  bindDoShipEnterAdvance("do-ship-box-count");
  bindDoShipEnterAdvance("do-ship-total-weight");
}
function openDoShipDatePicker() {
  const dateEl = document.getElementById("do-ship-date");
  if (!dateEl || typeof dateEl.showPicker !== "function") return;
  try {
    dateEl.showPicker();
  } catch (_) {
  }
}
function updateDoShipCompanySelectColor() {
  const sel = document.getElementById("do-ship-company");
  if (!sel) return;
  sel.style.color = sel.value ? "#e2e8f0" : "#ef4444";
}
function formatDoShipWeightValue(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "0";
  return String(Math.floor(num));
}
async function computeDailyOrderCargoSummary(order = null) {
  const rawItems = Array.isArray(order == null ? void 0 : order.items) ? order.items : typeof (order == null ? void 0 : order.items) === "string" ? JSON.parse(order.items) : [];
  const ids = rawItems.map((item) => Number(item == null ? void 0 : item.productId) || 0).filter((id) => id > 0);
  const names = rawItems.map((item) => String((item == null ? void 0 : item.name) || "").trim()).filter(Boolean);
  const skus = rawItems.map((item) => String((item == null ? void 0 : item.sku) || "").trim()).filter(Boolean);
  let products = [];
  if (ids.length || names.length || skus.length) {
    try {
      const res = await fetchWithAuth("/api/products/batch-stock", {
        method: "POST",
        body: JSON.stringify({ ids, names, skus })
      });
      if (res.ok) products = await res.json();
    } catch (e) {
    }
  }
  const byId = new Map();
  const byName = new Map();
  const bySku = new Map();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const pid = Number((product == null ? void 0 : product.id) || 0);
    const name = String((product == null ? void 0 : product.name) || "").trim();
    const sku = String((product == null ? void 0 : product.sku) || "").trim();
    if (pid > 0) byId.set(pid, product);
    if (name) byName.set(name.toLowerCase(), product);
    if (sku) bySku.set(sku, product);
  });
  let totalBoxes = 0;
  let goodsWeight = 0;
  rawItems.forEach((item) => {
    const qty = Math.max(0, Number(getDailyOrderItemOrderedQty(item) || getDailyOrderItemActualQty(item) || (item == null ? void 0 : item.qty) || 0));
    totalBoxes += qty;
    const product = byId.get(Number((item == null ? void 0 : item.productId) || 0)) || bySku.get(String((item == null ? void 0 : item.sku) || "").trim()) || byName.get(String((item == null ? void 0 : item.name) || "").trim().toLowerCase()) || null;
    const unitWeight = Math.max(0, Number((item == null ? void 0 : item.weight_kg) || (product == null ? void 0 : product.weight_kg) || 0));
    goodsWeight += qty * unitWeight;
  });
  const palletCount = Math.max(0, Number((order == null ? void 0 : order.logistics_pallet_count) || 0));
  const palletWeight = palletCount * 15;
  const totalWeight = goodsWeight + palletWeight;
  return {
    totalBoxes,
    goodsWeight,
    palletWeight,
    totalWeight,
    totalBoxesText: totalBoxes > 0 ? String(totalBoxes) : "0",
    totalWeightText: formatDoShipWeightValue(totalWeight)
  };
}
function updateReadyToShipPrepareWeight(defaultSummary = null) {
  if (doShipModalMode !== "prepare_ready_ship") return;
  const palletEl = document.getElementById("do-ship-pallet-count");
  const weightEl = document.getElementById("do-ship-total-weight");
  if (!weightEl) return;
  const baseGoodsWeight = Math.max(0, Number((defaultSummary == null ? void 0 : defaultSummary.goodsWeight) || Number(weightEl.dataset.goodsWeight || 0) || 0));
  weightEl.dataset.goodsWeight = String(baseGoodsWeight);
  const palletCount = Math.max(0, Number((palletEl == null ? void 0 : palletEl.value) || 0));
  const nextWeight = baseGoodsWeight + palletCount * 15;
  weightEl.value = formatDoShipWeightValue(nextWeight);
}
function applyDoShipModalLayout() {
  const basicSection = document.getElementById("do-ship-basic-section");
  const cargoSection = document.getElementById("do-ship-cargo-section");
  const voucherSection = document.getElementById("do-ship-voucher-section");
  const exportBtn = document.getElementById("do-ship-export-excel");
  const palletEl = document.getElementById("do-ship-pallet-count");
  const boxEl = document.getElementById("do-ship-box-count");
  const weightEl = document.getElementById("do-ship-total-weight");
  const isPrepare = doShipModalMode === "prepare_ready_ship";
  const isContact = doShipModalMode === "contact_logistics";
  const isVoucherOnly = doShipModalMode === "ship_voucher";
  if (basicSection) basicSection.style.display = isPrepare || isVoucherOnly ? "none" : "grid";
  if (cargoSection) cargoSection.style.display = isVoucherOnly ? "none" : "";
  if (voucherSection) voucherSection.style.display = isPrepare || isContact ? "none" : "";
  if (exportBtn) exportBtn.style.display = isContact ? "" : "none";
  if (boxEl) {
    boxEl.readOnly = false;
    boxEl.style.background = "";
    boxEl.style.color = "";
    boxEl.style.cursor = "";
  }
  if (weightEl) {
    weightEl.readOnly = false;
    weightEl.style.background = "";
    weightEl.style.color = "";
    weightEl.style.cursor = "";
  }
  if (palletEl) {
    palletEl.readOnly = false;
    palletEl.style.background = "";
    palletEl.style.color = "";
    palletEl.style.cursor = "";
  }
}

async function buildContactLogisticsWorkbook(order, payload) {
  if (typeof ExcelJS === "undefined" || !ExcelJS.Workbook) throw new Error("exceljs_missing");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ThreeSquirrels";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Logistica");
  const fromCellText = await buildLogisticsPartyExportCellText(String((payload == null ? void 0 : payload.fromVal) || "").trim());
  const toCellText = await buildLogisticsPartyExportCellText(
    String((payload == null ? void 0 : payload.toVal) || "").trim() || String((order == null ? void 0 : order.customer) || "").trim(),
    getDailyOrderCustomerInfo(String((order == null ? void 0 : order.customer) || "").trim()) || null
  );
  sheet.columns = [
    { width: 18 },
    { width: 42 },
    { width: 42 },
    { width: 14 },
    { width: 16 },
    { width: 20 },
    { width: 18 },
    { width: 16 },
    { width: 20 }
  ];
  const headerRow = sheet.addRow(["Fecha de recogida", "Direccion de recogida\n(incluir horario)", "Direccion de entrega\n(incluir horario)", "Nº de palets", "Nº de bultos", "Peso (kg) aproximado", "Volumen aproximado", "Tipo de carga", "Empresa logistica"]);
  const dataRow = sheet.addRow([
    formatDisplayDate(String((payload == null ? void 0 : payload.shipDate) || "").trim()) || String((payload == null ? void 0 : payload.shipDate) || "").trim() || "-",
    fromCellText || "-",
    toCellText || "-",
    String((payload == null ? void 0 : payload.palletCount) || "").trim() || "0",
    String((payload == null ? void 0 : payload.boxCount) || "").trim() || "0",
    String((payload == null ? void 0 : payload.totalWeight) || "").trim() || "0",
    "-",
    "-",
    String((payload == null ? void 0 : payload.companyName) || "").trim() || "-"
  ]);
  headerRow.height = 56;
  dataRow.height = 180;
  [headerRow, dataRow].forEach((row) => {
    row.eachCell((cell) => {
      styleProductExportCell(cell, { horizontal: "center", vertical: "middle", wrapText: true });
      cell.font = { name: "Arial", size: row.number === 1 ? 13 : 12 };
    });
  });
  return workbook;
}

async function buildLogisticsPartyExportCellText(rawName, fallbackSource = null) {
  const name = String(rawName || "").trim();
  if (!name && !fallbackSource) return "";
  let source = fallbackSource || null;
  if (!source && name) {
    try {
      source = await getInvoiceCustomerContact(name);
    } catch (e) {
    }
  }
  const defaultShip = getDefaultContactShippingAddress(source) || null;
  const companyName = String((source == null ? void 0 : source.company) || (source == null ? void 0 : source.name) || name || "").trim();
  const address = String((defaultShip == null ? void 0 : defaultShip.address) || (source == null ? void 0 : source.ship_address) || (source == null ? void 0 : source.address) || "").trim();
  const zip = String((defaultShip == null ? void 0 : defaultShip.zip) || (source == null ? void 0 : source.ship_zip) || (source == null ? void 0 : source.zip) || "").trim();
  const city = String((defaultShip == null ? void 0 : defaultShip.city) || (source == null ? void 0 : source.ship_city) || (source == null ? void 0 : source.city) || "").trim();
  const province = String((defaultShip == null ? void 0 : defaultShip.province) || (source == null ? void 0 : source.ship_province) || (source == null ? void 0 : source.province) || "").trim();
  const country = String((defaultShip == null ? void 0 : defaultShip.country) || (source == null ? void 0 : source.ship_country) || (source == null ? void 0 : source.country) || "").trim();
  const contact = String((defaultShip == null ? void 0 : defaultShip.contact) || (source == null ? void 0 : source.ship_contact) || (source == null ? void 0 : source.contact) || "").trim();
  const phone = String((defaultShip == null ? void 0 : defaultShip.phone) || (source == null ? void 0 : source.ship_phone) || (source == null ? void 0 : source.phone) || "").trim();
  const businessHours = String((defaultShip == null ? void 0 : defaultShip.business_hours) || "").trim();
  const lines = [
    companyName,
    [address, zip].filter(Boolean).join(" "),
    [city, province].filter(Boolean).join(" "),
    country,
    [contact, phone].filter(Boolean).join(" : "),
    businessHours ? `horario: ${businessHours}` : ""
  ].filter(Boolean);
  return lines.join("\n") || name;
}

async function exportContactLogisticsExcel() {
  const id = Number((document.getElementById("do-ship-id") || {}).value || 0);
  if (!id) {
    alert("未找到订单");
    return;
  }
  const order = currentDailyOrders.find((x) => Number((x == null ? void 0 : x.id) || 0) === id) || null;
  if (!order) {
    alert("未找到待发货订单");
    return;
  }
  const sel = document.getElementById("do-ship-company");
  const fromVal = String((document.getElementById("do-ship-from") || {}).value || "").trim();
  const toVal = String((document.getElementById("do-ship-to") || {}).value || "").trim();
  const shipDate = String((document.getElementById("do-ship-date") || {}).value || "").trim();
  const palletCount = String((document.getElementById("do-ship-pallet-count") || {}).value || "").trim();
  const boxCount = String((document.getElementById("do-ship-box-count") || {}).value || "").trim();
  const totalWeight = String((document.getElementById("do-ship-total-weight") || {}).value || "").trim();
  const companyId = String((sel == null ? void 0 : sel.value) || "").trim();
  const companyName = companyId ? String((sel == null ? void 0 : sel.options[sel.selectedIndex]) ? sel.options[sel.selectedIndex].textContent || "" : "") : "";
  if (!companyId || !toVal || !shipDate) {
    alert("请先填写完整物流信息后再导出");
    return;
  }
  const safeCustomer = toVal.replace(/[\\/:*?"<>|]+/g, "-").trim() || String((order == null ? void 0 : order.customer) || "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "客户名称";
  const fileName = `${safeCustomer}.xlsx`;
  const exportTarget = await chooseProductExportTarget(fileName);
  if (exportTarget === "aborted") return;
  try {
    const workbook = await buildContactLogisticsWorkbook(order, {
      fromVal,
      toVal,
      shipDate,
      companyName,
      palletCount,
      boxCount,
      totalWeight
    });
    const buffer = await workbook.xlsx.writeBuffer();
    await saveProductWorkbookBuffer(buffer, fileName, exportTarget);
    showAppToast("物流信息已导出");
  } catch (e) {
    console.error("exportContactLogisticsExcel failed", e);
    alert("导出 Excel 失败");
  }
}
window.exportContactLogisticsExcel = exportContactLogisticsExcel;
function setDoShipModalMode(mode = "ship") {
  doShipModalMode = mode === "edit_logistics" ? "edit_logistics" : mode === "create_logistics" ? "create_logistics" : mode === "prepare_ready_ship" ? "prepare_ready_ship" : mode === "contact_logistics" ? "contact_logistics" : mode === "ship_voucher" ? "ship_voucher" : "ship";
  const titleEl = document.getElementById("do-ship-modal-title");
  const hintEl = document.getElementById("do-ship-modal-hint");
  const okBtn = document.getElementById("do-ship-ok");
  if (doShipModalMode === "edit_logistics") {
    if (titleEl) titleEl.textContent = "\u7F16\u8F91\u7269\u6D41";
    if (hintEl) hintEl.textContent = "\u4FEE\u6539\u5F53\u524D\u7269\u6D41\u4FE1\u606F";
    if (okBtn) okBtn.textContent = "\u4FDD\u5B58";
  } else if (doShipModalMode === "prepare_ready_ship") {
    if (titleEl) titleEl.textContent = "\u53EF\u53D1\u8D27";
    if (hintEl) hintEl.textContent = "\u8BF7\u786E\u8BA4\u8D27\u7269\u4FE1\u606F\u540E\u8F6C\u5165\u5F85\u53D1\u8D27";
    if (okBtn) okBtn.textContent = "\u786E\u5B9A";
  } else if (doShipModalMode === "contact_logistics") {
    if (titleEl) titleEl.textContent = "\u8054\u7CFB\u7269\u6D41";
    if (hintEl) hintEl.textContent = "\u8BF7\u5148\u586B\u5199\u7269\u6D41\u8054\u7CFB\u4FE1\u606F";
    if (okBtn) okBtn.textContent = "\u4FDD\u5B58";
  } else if (doShipModalMode === "ship_voucher") {
    if (titleEl) titleEl.textContent = "\u786E\u8BA4\u53D1\u8D27";
    if (hintEl) hintEl.textContent = canShipWithoutVoucher() ? "\u5F53\u524D\u8D26\u53F7\u5DF2\u83B7\u5141\u8BB8\uFF0C\u53EF\u4E0D\u4E0A\u4F20\u56FE\u7247\u76F4\u63A5\u786E\u8BA4\u5DF2\u53D1\u8D27" : "\u53EA\u9700\u4E0A\u4F20\u53D1\u8D27\u51ED\u8BC1\u5373\u53EF\u5B8C\u6210\u53D1\u8D27";
    if (okBtn) okBtn.textContent = "\u786E\u5B9A";
  } else if (doShipModalMode === "create_logistics") {
    if (titleEl) titleEl.textContent = "\u521B\u5EFA\u8BA2\u5355";
    if (hintEl) hintEl.textContent = "\u586B\u5199\u7269\u6D41\u4FE1\u606F\u540E\u521B\u5EFA\u65B0\u7684\u7269\u6D41\u8BA2\u5355";
    if (okBtn) okBtn.textContent = "\u4FDD\u5B58";
  } else {
    if (titleEl) titleEl.textContent = "\u786E\u8BA4\u53D1\u8D27";
    if (hintEl) hintEl.textContent = "\u786E\u8BA4\u5DF2\u53D1\u8D27\uFF1F";
    if (okBtn) okBtn.textContent = "\u786E\u5B9A";
  }
  applyDoShipModalLayout();
}
async function populateDoShipCompanyOptions(selectedCompanyId = "") {
  const sel = document.getElementById("do-ship-company");
  if (!sel) return [];
  sel.innerHTML = "";
  const list = await apiLogisticsCompaniesList(true);
  const enabled = (Array.isArray(list) ? list : []).filter((x) => x && x.enabled === true);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.style.color = "#ef4444";
  placeholder.textContent = enabled.length === 0 ? "\u6682\u65E0\u53EF\u7528\u7269\u6D41\u516C\u53F8\uFF08\u8BF7\u5148\u65B0\u589E\u5E76\u542F\u7528\uFF09" : "\u8BF7\u9009\u62E9\u7269\u6D41\u516C\u53F8";
  sel.appendChild(placeholder);
  enabled.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = String(c.name || "");
    sel.appendChild(opt);
  });
  sel.value = selectedCompanyId ? String(selectedCompanyId) : "";
  updateDoShipCompanySelectColor();
  sel.onchange = () => {
    updateDoShipCompanySelectColor();
    updateDoShipOkState();
    focusDoShipNextField("do-ship-company");
  };
  return enabled;
}
async function openDoShipModal(orderId) {
  const m = document.getElementById("do-ship-modal");
  if (!m) return;
  setDoShipModalMode("ship_voucher");
  const order = currentDailyOrders.find((x) => Number(x == null ? void 0 : x.id) === Number(orderId)) || null;
  const idEl = document.getElementById("do-ship-id");
  const sel = document.getElementById("do-ship-company");
  const fromEl = document.getElementById("do-ship-from");
  const toEl = document.getElementById("do-ship-to");
  const dateEl = document.getElementById("do-ship-date");
  const palletEl = document.getElementById("do-ship-pallet-count");
  const boxEl = document.getElementById("do-ship-box-count");
  const weightEl = document.getElementById("do-ship-total-weight");
  const okBtn = document.getElementById("do-ship-ok");
  if (idEl) idEl.value = String(orderId || "");
  if (okBtn) okBtn.disabled = false;
  if (fromEl) fromEl.value = String((order == null ? void 0 : order.logistics_from) || "").trim();
  if (toEl) toEl.value = String((order == null ? void 0 : order.logistics_to) || "").trim();
  if (dateEl) dateEl.value = String((order == null ? void 0 : order.logistics_ship_date) || "").trim();
  if (palletEl) palletEl.value = String((order == null ? void 0 : order.logistics_pallet_count) || "").trim();
  if (boxEl) boxEl.value = String((order == null ? void 0 : order.logistics_box_count) || "").trim();
  if (weightEl) weightEl.value = String((order == null ? void 0 : order.logistics_total_weight) || "").trim();
  resetDoShipVoucherState(String((order == null ? void 0 : order.logistics_voucher_url) || ""), String((order == null ? void 0 : order.logistics_voucher_name) || ""));
  m.style.display = "flex";
  if (!sel) return;
  updateDoShipDefaultFromButton();
  await populateDoShipCompanyOptions(String((order == null ? void 0 : order.logistics_company_id) || ""));
  bindDoShipVoucherInputs();
  updateDoShipOkState();
}

async function openContactLogisticsModal(orderId) {
  const id = Number(orderId || 0);
  if (!id) return;
  const m = document.getElementById("do-ship-modal");
  if (!m) return;
  const order = currentDailyOrders.find((x) => Number((x == null ? void 0 : x.id) || 0) === id) || null;
  if (!order) return;
  setDoShipModalMode("contact_logistics");
  const idEl = document.getElementById("do-ship-id");
  const sel = document.getElementById("do-ship-company");
  const fromEl = document.getElementById("do-ship-from");
  const toEl = document.getElementById("do-ship-to");
  const dateEl = document.getElementById("do-ship-date");
  const palletEl = document.getElementById("do-ship-pallet-count");
  const boxEl = document.getElementById("do-ship-box-count");
  const weightEl = document.getElementById("do-ship-total-weight");
  const okBtn = document.getElementById("do-ship-ok");
  const defaultFrom = loadDoShipDefaultFrom();
  const summary = await computeDailyOrderCargoSummary(order);
  if (idEl) idEl.value = String(id);
  if (okBtn) okBtn.disabled = true;
  if (fromEl) fromEl.value = String((order == null ? void 0 : order.logistics_from) || "").trim() || defaultFrom;
  if (toEl) toEl.value = String((order == null ? void 0 : order.logistics_to) || "").trim() || String((order == null ? void 0 : order.customer) || "").trim();
  if (dateEl) dateEl.value = String((order == null ? void 0 : order.logistics_ship_date) || "").trim() || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (palletEl) palletEl.value = String((order == null ? void 0 : order.logistics_pallet_count) || "").trim();
  if (boxEl) boxEl.value = String((order == null ? void 0 : order.logistics_box_count) || "").trim() || summary.totalBoxesText;
  if (weightEl) {
    weightEl.dataset.goodsWeight = String(summary.goodsWeight || 0);
    weightEl.value = String((order == null ? void 0 : order.logistics_total_weight) || "").trim() || summary.totalWeightText;
  }
  resetDoShipVoucherState(String((order == null ? void 0 : order.logistics_voucher_url) || ""), String((order == null ? void 0 : order.logistics_voucher_name) || ""));
  m.style.display = "flex";
  if (!sel) return;
  updateDoShipDefaultFromButton();
  await populateDoShipCompanyOptions(String((order == null ? void 0 : order.logistics_company_id) || ""));
  bindDoShipFieldNavigation();
  updateDoShipOkState();
  if (dateEl) {
    dateEl.onchange = () => updateDoShipOkState();
    dateEl.onclick = () => openDoShipDatePicker();
    dateEl.onfocus = () => openDoShipDatePicker();
  }
  if (palletEl) {
    palletEl.onchange = () => {
      updateReadyToShipPrepareWeight();
      updateDoShipOkState();
    };
    updateReadyToShipPrepareWeight(summary);
  }
  if (boxEl) boxEl.oninput = () => updateDoShipOkState();
  if (weightEl) weightEl.oninput = () => updateDoShipOkState();
}
window.openContactLogisticsModal = openContactLogisticsModal;
async function openReadyToShipPrepareModal(orderId) {
  const id = Number(orderId || 0);
  if (!id) return;
  const m = document.getElementById("do-ship-modal");
  if (!m) return;
  const order = currentDailyOrders.find((x) => Number((x == null ? void 0 : x.id) || 0) === id) || null;
  if (!order) return;
  setDoShipModalMode("prepare_ready_ship");
  const idEl = document.getElementById("do-ship-id");
  const palletEl = document.getElementById("do-ship-pallet-count");
  const boxEl = document.getElementById("do-ship-box-count");
  const weightEl = document.getElementById("do-ship-total-weight");
  if (idEl) idEl.value = String(id);
  const summary = await computeDailyOrderCargoSummary(order);
  if (palletEl) palletEl.value = String((order == null ? void 0 : order.logistics_pallet_count) || "").trim();
  if (boxEl) boxEl.value = String((order == null ? void 0 : order.logistics_box_count) || "").trim() || summary.totalBoxesText;
  if (weightEl) {
    weightEl.dataset.goodsWeight = String(summary.goodsWeight || 0);
    weightEl.value = String((order == null ? void 0 : order.logistics_total_weight) || "").trim() || summary.totalWeightText;
  }
  resetDoShipVoucherState("", "");
  m.style.display = "flex";
  bindDoShipFieldNavigation();
  updateDoShipOkState();
  if (palletEl) {
    palletEl.onchange = () => {
      updateReadyToShipPrepareWeight();
      updateDoShipOkState();
    };
    updateReadyToShipPrepareWeight(summary);
    setTimeout(() => palletEl.focus(), 0);
  }
  if (boxEl) boxEl.oninput = () => updateDoShipOkState();
  if (weightEl) weightEl.oninput = () => updateDoShipOkState();
}
async function openLogisticsCreateModal() {
  const m = document.getElementById("do-ship-modal");
  if (!m) return;
  setDoShipModalMode("create_logistics");
  const idEl = document.getElementById("do-ship-id");
  const sel = document.getElementById("do-ship-company");
  const fromEl = document.getElementById("do-ship-from");
  const toEl = document.getElementById("do-ship-to");
  const dateEl = document.getElementById("do-ship-date");
  const palletEl = document.getElementById("do-ship-pallet-count");
  const boxEl = document.getElementById("do-ship-box-count");
  const weightEl = document.getElementById("do-ship-total-weight");
  const okBtn = document.getElementById("do-ship-ok");
  const defaultFrom = loadDoShipDefaultFrom();
  if (idEl) idEl.value = "";
  if (okBtn) okBtn.disabled = true;
  if (fromEl) fromEl.value = defaultFrom;
  if (toEl) toEl.value = "";
  if (dateEl) dateEl.value = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (palletEl) palletEl.value = "";
  if (boxEl) boxEl.value = "";
  if (weightEl) weightEl.value = "";
  resetDoShipVoucherState("", "");
  m.style.display = "flex";
  if (!sel) return;
  updateDoShipDefaultFromButton();
  await populateDoShipCompanyOptions("");
  bindDoShipFieldNavigation();
  bindDoShipVoucherInputs();
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
  const m = document.getElementById("do-ship-modal");
  if (!m) return;
  const rec = (Array.isArray(currentLogisticsRecords) ? currentLogisticsRecords : []).find((x) => Number((x == null ? void 0 : x.id) || (x == null ? void 0 : x.order_id) || 0) === id) || (Array.isArray(loadLocalLogisticsRecords()) ? loadLocalLogisticsRecords() : []).find((x) => Number((x == null ? void 0 : x.id) || (x == null ? void 0 : x.order_id) || 0) === id) || null;
  if (!rec) {
    alert("\u672A\u627E\u5230\u7269\u6D41\u8BB0\u5F55");
    return;
  }
  setDoShipModalMode("edit_logistics");
  const idEl = document.getElementById("do-ship-id");
  const sel = document.getElementById("do-ship-company");
  const fromEl = document.getElementById("do-ship-from");
  const toEl = document.getElementById("do-ship-to");
  const dateEl = document.getElementById("do-ship-date");
  const palletEl = document.getElementById("do-ship-pallet-count");
  const boxEl = document.getElementById("do-ship-box-count");
  const weightEl = document.getElementById("do-ship-total-weight");
  const okBtn = document.getElementById("do-ship-ok");
  const defaultFrom = loadDoShipDefaultFrom();
  if (idEl) idEl.value = String(id);
  if (okBtn) okBtn.disabled = true;
  if (fromEl) fromEl.value = String(rec.logistics_from || rec.from || defaultFrom || "").trim();
  if (toEl) toEl.value = String(rec.logistics_to || rec.to || "").trim();
  if (dateEl) {
    const shipDate = String(rec.logistics_ship_date || rec.ship_date || rec.shipDate || "").trim();
    dateEl.value = shipDate ? shipDate.slice(0, 10) : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
  if (palletEl) palletEl.value = String(rec.logistics_pallet_count || rec.pallet_count || rec.palletCount || "").trim();
  if (boxEl) boxEl.value = String(rec.logistics_box_count || rec.box_count || rec.boxCount || "").trim();
  if (weightEl) weightEl.value = String(rec.logistics_total_weight || rec.total_weight || rec.totalWeight || "").trim();
  resetDoShipVoucherState(String(rec.logistics_voucher_url || rec.voucher_url || ""), String(rec.logistics_voucher_name || rec.voucher_name || ""));
  m.style.display = "flex";
  if (!sel) return;
  updateDoShipDefaultFromButton();
  await populateDoShipCompanyOptions(String(rec.logistics_company_id || rec.company_id || ""));
  bindDoShipFieldNavigation();
  bindDoShipVoucherInputs();
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
  var _a2, _b2, _c2, _d, _e, _f, _g, _h, _i;
  const id = Number(((_a2 = document.getElementById("do-ship-id")) == null ? void 0 : _a2.value) || 0);
  const sel = document.getElementById("do-ship-company");
  const fromVal = String(((_b2 = document.getElementById("do-ship-from")) == null ? void 0 : _b2.value) || "").trim();
  const toVal = String(((_c2 = document.getElementById("do-ship-to")) == null ? void 0 : _c2.value) || "").trim();
  const shipDate = String(((_d = document.getElementById("do-ship-date")) == null ? void 0 : _d.value) || "").trim();
  const palletCount = String(((_e = document.getElementById("do-ship-pallet-count")) == null ? void 0 : _e.value) || "").trim();
  const boxCount = String(((_f = document.getElementById("do-ship-box-count")) == null ? void 0 : _f.value) || "").trim();
  const totalWeight = String(((_g = document.getElementById("do-ship-total-weight")) == null ? void 0 : _g.value) || "").trim();
  const companyId = Number((sel == null ? void 0 : sel.value) || 0);
  const isEditLogistics = doShipModalMode === "edit_logistics";
  const isCreateLogistics = doShipModalMode === "create_logistics";
  const isPrepareReadyShip = doShipModalMode === "prepare_ready_ship";
  const isContactLogistics = doShipModalMode === "contact_logistics";
  if (isPrepareReadyShip) {
    const okBtn2 = document.getElementById("do-ship-ok");
    if (okBtn2) okBtn2.disabled = true;
    const res2 = await fetchWithAuth(`/api/daily-orders/${id}/ready-to-ship`, {
      method: "PUT",
      body: JSON.stringify({
        logistics_pallet_count: palletCount || "0",
        logistics_box_count: boxCount || "0",
        logistics_total_weight: totalWeight || "0"
      })
    });
    if (okBtn2) okBtn2.disabled = false;
    const readyShipData = await res2.json().catch(() => null);
    if (!res2.ok) {
      const data = readyShipData;
      if ((data == null ? void 0 : data.error) === "bad_status") alert("\u53EA\u6709\u5DF2\u914D\u8D27\u8BA2\u5355\u624D\u80FD\u8F6C\u5230\u5F85\u53D1\u8D27");
      else if ((data == null ? void 0 : data.error) === "insufficient_stock") {
        const productName = String((data == null ? void 0 : data.product_name) || "\u5546\u54C1");
        const available = Number((data == null ? void 0 : data.edit_available_stock) ?? (data == null ? void 0 : data.available_stock) ?? 0);
        const requested = Number((data == null ? void 0 : data.edit_requested_qty) ?? (data == null ? void 0 : data.requested_qty) ?? 0);
        alert(`${productName} \u53EF\u7528${available}\uFF0C\u9700\u8981${requested}`);
      } else alert("\u8BBE\u7F6E\u5F85\u53D1\u8D27\u5E76\u751F\u6210\u53D1\u7968\u5931\u8D25");
      return;
    }
    closeDoShipModal();
    await loadDailyOrders("ready_to_ship");
    await printDailyOrderShippingLabel(id);
    const readyShipInvoiceNo = String((readyShipData == null ? void 0 : readyShipData.invoice_no) || "").trim();
    showAppToast(readyShipInvoiceNo ? `已转入待发货并生成发票：${readyShipInvoiceNo}` : "\u5DF2\u8F6C\u5165\u5F85\u53D1\u8D27\u5E76\u751F\u6210\u53D1\u7968");
    return;
  }
  if (isContactLogistics) {
    const okBtn2 = document.getElementById("do-ship-ok");
    if (okBtn2) okBtn2.disabled = true;
    const res2 = await fetchWithAuth(`/api/daily-orders/${id}/contact-logistics`, {
      method: "PUT",
      body: JSON.stringify({
        logistics_company_id: companyId,
        logistics_from: fromVal || "-",
        logistics_to: toVal,
        logistics_ship_date: shipDate,
        logistics_pallet_count: palletCount || "0",
        logistics_box_count: boxCount || "0",
        logistics_total_weight: totalWeight || "0"
      })
    });
    if (okBtn2) okBtn2.disabled = false;
    if (!res2.ok) {
      const data = await res2.json().catch(() => null);
      if ((data == null ? void 0 : data.error) === "logistics_company_required") alert("\u8BF7\u9009\u62E9\u7269\u6D41\u516C\u53F8");
      else if ((data == null ? void 0 : data.error) === "logistics_to_required") alert("\u8BF7\u9009\u62E9\u76EE\u7684\u5730");
      else if ((data == null ? void 0 : data.error) === "logistics_ship_date_required") alert("\u8BF7\u9009\u62E9\u53D1\u8D27\u65E5\u671F");
      else if ((data == null ? void 0 : data.error) === "bad_logistics_company") alert("\u7269\u6D41\u516C\u53F8\u4E0D\u53EF\u7528\uFF0C\u8BF7\u9009\u62E9\u542F\u7528\u7684\u516C\u53F8");
      else if ((data == null ? void 0 : data.error) === "bad_status") alert("\u53EA\u6709\u5F85\u53D1\u8D27\u8BA2\u5355\u624D\u80FD\u8054\u7CFB\u7269\u6D41");
      else alert("\u8054\u7CFB\u7269\u6D41\u4FE1\u606F\u4FDD\u5B58\u5931\u8D25");
      return;
    }
    closeDoShipModal();
    await loadDailyOrders("ready_to_ship");
    showAppToast("\u5DF2\u4FDD\u5B58\u7269\u6D41\u4FE1\u606F");
    return;
  }
  if (!id) {
    alert("\u672A\u627E\u5230\u8BA2\u5355");
    return;
  }
  if (doShipModalMode !== "ship_voucher" && !isCreateLogistics && !companyId) {
    alert("\u8BF7\u9009\u62E9\u7269\u6D41\u516C\u53F8");
    return;
  }
  if (doShipModalMode !== "ship_voucher" && !toVal) {
    alert("\u8BF7\u9009\u62E9\u76EE\u7684\u5730");
    return;
  }
  if (doShipModalMode !== "ship_voucher" && !shipDate) {
    alert("\u8BF7\u9009\u62E9\u53D1\u8D27\u65E5\u671F");
    return;
  }
  const okBtn = document.getElementById("do-ship-ok");
  if (okBtn) okBtn.disabled = true;
  const submitFromVal = fromVal || "-";
  const submitPalletCount = palletCount || "0";
  const submitBoxCount = boxCount || "0";
  const submitTotalWeight = totalWeight || "0";
  let logisticsVoucherUrl = doShipVoucherExistingUrl || "";
  let logisticsVoucherName = doShipVoucherExistingName || "";
  if (doShipVoucherPendingFile) {
    try {
      const uploaded = await uploadDoShipVoucherImage(doShipVoucherPendingFile);
      logisticsVoucherUrl = uploaded.url || "";
      logisticsVoucherName = uploaded.filename || doShipVoucherPendingFile.name || "";
      doShipVoucherExistingUrl = logisticsVoucherUrl;
      doShipVoucherExistingName = logisticsVoucherName;
    } catch (e) {
      if (okBtn) okBtn.disabled = false;
      if (String((e == null ? void 0 : e.message) || "") === "bad_type") {
        alert("请上传图片文件");
      } else {
        alert("发货单凭证上传失败");
      }
      return;
    }
  }
  const reqBody = {
    logistics_company_id: companyId,
    logistics_from: submitFromVal,
    logistics_to: toVal,
    logistics_ship_date: shipDate,
    logistics_pallet_count: submitPalletCount,
    logistics_box_count: submitBoxCount,
    logistics_total_weight: submitTotalWeight,
    logistics_voucher_url: logisticsVoucherUrl,
    logistics_voucher_name: logisticsVoucherName
  };
  const res = await fetchWithAuth(isCreateLogistics ? "/api/logistics/records" : `/api/daily-orders/${id}/ship`, {
    method: isCreateLogistics ? "POST" : "PUT",
    body: JSON.stringify(reqBody)
  });
  if (okBtn) okBtn.disabled = false;
  const createWithLocalFallback = isCreateLogistics && res.status === 404;
  if (!res.ok && !createWithLocalFallback) {
    const data = await res.json().catch(() => null);
    if ((data == null ? void 0 : data.error) === "logistics_company_required") alert(doShipModalMode === "ship_voucher" ? "\u8BF7\u5148\u8054\u7CFB\u7269\u6D41" : "\u8BF7\u9009\u62E9\u7269\u6D41\u516C\u53F8");
    else if ((data == null ? void 0 : data.error) === "logistics_from_required") alert("\u8BF7\u9009\u62E9\u51FA\u53D1\u5730");
    else if ((data == null ? void 0 : data.error) === "logistics_to_required") alert(doShipModalMode === "ship_voucher" ? "\u8BF7\u5148\u8054\u7CFB\u7269\u6D41" : "\u8BF7\u9009\u62E9\u76EE\u7684\u5730");
    else if ((data == null ? void 0 : data.error) === "logistics_ship_date_required") alert(doShipModalMode === "ship_voucher" ? "\u8BF7\u5148\u8054\u7CFB\u7269\u6D41" : "\u8BF7\u9009\u62E9\u53D1\u8D27\u65E5\u671F");
    else if ((data == null ? void 0 : data.error) === "logistics_pallet_count_required") alert("\u8BF7\u8F93\u5165\u6258\u76D8\u6570\u91CF");
    else if ((data == null ? void 0 : data.error) === "logistics_box_count_required") alert("\u8BF7\u8F93\u5165\u603B\u7BB1\u6570");
    else if ((data == null ? void 0 : data.error) === "logistics_total_weight_required") alert("\u8BF7\u8F93\u5165\u603B\u91CD\u91CF");
    else if ((data == null ? void 0 : data.error) === "logistics_voucher_required") alert("\u5F53\u524D\u8D26\u53F7\u672A\u83B7\u5141\u8BB8\u8DF3\u8FC7\u4E0A\u4F20\u56FE\u7247\uFF0C\u8BF7\u5148\u4E0A\u4F20\u53D1\u8D27\u51ED\u8BC1");
    else if ((data == null ? void 0 : data.error) === "bad_logistics_company") alert("\u7269\u6D41\u516C\u53F8\u4E0D\u53EF\u7528\uFF0C\u8BF7\u9009\u62E9\u542F\u7528\u7684\u516C\u53F8");
    else if ((data == null ? void 0 : data.error) === "bad_status") alert("\u8BF7\u5148\u5728\u201C\u5F85\u53D1\u8D27\u201D\u9875\u9762\u518D\u786E\u8BA4\u53D1\u8D27");
    else if ((data == null ? void 0 : data.error) === "insufficient_stock") alert(formatInsufficientStockMessage(data));
    else alert(isCreateLogistics ? "\u521B\u5EFA\u7269\u6D41\u8BA2\u5355\u5931\u8D25" : isEditLogistics ? "\u7269\u6D41\u4FE1\u606F\u4FDD\u5B58\u5931\u8D25" : "\u53D1\u8D27\u5931\u8D25");
    return;
  }
  if (isCreateLogistics) {
    let newId = 0;
    try {
      const data = await res.json().catch(() => null);
      newId = Number((data == null ? void 0 : data.id) || 0) || 0;
    } catch (e) {
    }
    try {
      const company = (Array.isArray(logisticsCompanies) ? logisticsCompanies : []).find((x) => String(x.id) === String(companyId));
      const now = Date.now();
      const all = loadLocalLogisticsRecords();
      const recordId = newId || now;
      const next = [
        {
          id: recordId,
          status: "ongoing",
          logistics_status: "ongoing",
          order_id: recordId,
          customer: toVal,
          shipped_by: String(((_h = getAuthUser()) == null ? void 0 : _h.name) || ""),
          logistics_from: fromVal,
          logistics_to: toVal,
          logistics_ship_date: shipDate,
          logistics_pallet_count: palletCount,
          logistics_box_count: boxCount,
          logistics_total_weight: totalWeight,
          logistics_voucher_url: logisticsVoucherUrl,
          logistics_voucher_name: logisticsVoucherName,
          logistics_company_id: companyId,
          company_id: companyId,
          logistics_company: (company == null ? void 0 : company.name) || "",
          company: (company == null ? void 0 : company.name) || "",
          logistics_updated_at: now,
          updatedAt: now,
          orderNo: `\u7269\u6D41\u5355-${String(recordId).padStart(6, "0")}`,
          notes: ""
        },
        ...all
      ];
      saveLocalLogisticsRecords(next);
      updateLogisticsOngoingBadgeCount(next.filter((x) => String((x == null ? void 0 : x.status) || (x == null ? void 0 : x.logistics_status) || "") === "ongoing").length);
    } catch (e) {
    }
    closeDoShipModal();
    if (currentLogisticsTab === "ongoing") loadLogistics("ongoing");
    updateGlobalBadges();
    showAppToast("\u7269\u6D41\u8BA2\u5355\u5DF2\u521B\u5EFA");
    return;
  }
  if (isEditLogistics) {
    try {
      const company = (Array.isArray(logisticsCompanies) ? logisticsCompanies : []).find((x) => String(x.id) === String(companyId));
      const now = Date.now();
      const all = loadLocalLogisticsRecords();
      const next = (Array.isArray(all) ? all : []).map((x) => {
        if (String((x == null ? void 0 : x.order_id) || (x == null ? void 0 : x.id) || "") === String(id)) {
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
            logistics_voucher_url: logisticsVoucherUrl,
            logistics_voucher_name: logisticsVoucherName,
            total_weight: totalWeight,
            totalWeight,
            logistics_company_id: companyId,
            company_id: companyId,
            logistics_company: (company == null ? void 0 : company.name) || (x == null ? void 0 : x.logistics_company) || "",
            company: (company == null ? void 0 : company.name) || (x == null ? void 0 : x.company) || "",
            updatedAt: now
          };
        }
        return x;
      });
      saveLocalLogisticsRecords(next);
    } catch (e) {
    }
    closeDoShipModal();
    if (currentLogisticsTab === "ongoing") loadLogistics("ongoing");
    showAppToast("\u7269\u6D41\u4FE1\u606F\u5DF2\u66F4\u65B0");
    return;
  }
  const finishDailyOrderShipSuccess = async (toastText) => {
    closeDoShipModal();
    await loadDailyOrders("shipped");
    if (currentLogisticsTab === "ongoing") loadLogistics("ongoing");
    updateGlobalBadges();
    showAppToast(toastText);
    if (shippedInvoiceNo) await openDailyOrderInvoicePreviewByNumber(shippedInvoiceNo);
  };
  let shippedInvoiceNo = "";
  try {
    const shippedRes = await fetchWithAuth(`/api/daily-orders?status=shipped&_t=${Date.now()}`);
    if (shippedRes.ok) {
      const shippedList = await shippedRes.json().catch(() => []);
      const shippedOrder = (Array.isArray(shippedList) ? shippedList : []).find((o) => Number((o == null ? void 0 : o.id) || 0) === id);
      shippedInvoiceNo = String((shippedOrder == null ? void 0 : shippedOrder.invoice_no) || (shippedOrder == null ? void 0 : shippedOrder.invoiceNo) || "").trim();
    }
  } catch (e) {
  }
  try {
    const order = currentDailyOrders.find((o) => Number(o.id) === id);
    const effectiveCompanyId = companyId || Number((order == null ? void 0 : order.logistics_company_id) || 0);
    const effectiveFrom = fromVal || String((order == null ? void 0 : order.logistics_from) || "").trim();
    const effectiveTo = toVal || String((order == null ? void 0 : order.logistics_to) || "").trim();
    const effectiveShipDate = shipDate || String((order == null ? void 0 : order.logistics_ship_date) || "").trim();
    const effectivePalletCount = palletCount || String((order == null ? void 0 : order.logistics_pallet_count) || "").trim();
    const effectiveBoxCount = boxCount || String((order == null ? void 0 : order.logistics_box_count) || "").trim();
    const effectiveTotalWeight = totalWeight || String((order == null ? void 0 : order.logistics_total_weight) || "").trim();
    const company = (Array.isArray(logisticsCompanies) ? logisticsCompanies : []).find((x) => String(x.id) === String(effectiveCompanyId));
    const all = loadLocalLogisticsRecords();
    if ((company == null ? void 0 : company.generate_logistics_order) === false) {
      await finishDailyOrderShipSuccess("\u786E\u8BA4\u53D1\u8D27\uFF0C\u672A\u751F\u6210\u7269\u6D41\u8BA2\u5355");
      return;
    }
    const next = [
      {
        status: "ongoing",
        order_id: id,
        orderNo: shippedInvoiceNo || (order == null ? void 0 : order.invoice_no) || "",
        customer: (order == null ? void 0 : order.customer) || "",
        shipped_by: String(((_i = getAuthUser()) == null ? void 0 : _i.name) || ""),
        logistics_from: effectiveFrom,
        logistics_to: effectiveTo,
        logistics_ship_date: effectiveShipDate,
        logistics_pallet_count: effectivePalletCount,
        logistics_box_count: effectiveBoxCount,
        logistics_total_weight: effectiveTotalWeight,
        logistics_voucher_url: logisticsVoucherUrl,
        logistics_voucher_name: logisticsVoucherName,
        company: (company == null ? void 0 : company.name) || "",
        company_id: effectiveCompanyId,
        tracking_no: "",
        updatedAt: Date.now(),
        notes: (order == null ? void 0 : order.notes) || ""
      },
      ...all
    ];
    saveLocalLogisticsRecords(next);
    updateLogisticsOngoingBadgeCount(next.filter((x) => String((x == null ? void 0 : x.status) || "") === "ongoing").length);
  } catch (e) {
  }
  await finishDailyOrderShipSuccess("\u786E\u8BA4\u53D1\u8D27\uFF0C\u53D1\u7968\u5DF2\u751F\u6210");
}
async function cancelDailyOrder(id) {
  openConfirm("\u786E\u5B9A\u8981\u9000\u6389\u8FD9\u4E2A\u8BA2\u5355\u5417\uFF1F\u9000\u5355\u540E\u65E0\u6CD5\u6062\u590D\u3002", async () => {
    var _a2;
    const res = await fetchWithAuth(`/api/daily-orders/${id}`, {
      method: "DELETE"
    });
    if (res.ok) {
      const currentTab = ((_a2 = document.querySelector("#page-daily-orders .tabs .tab.active")) == null ? void 0 : _a2.dataset.tab) || "new";
      loadDailyOrders(currentTab);
    } else {
      alert("\u9000\u5355\u5931\u8D25\uFF0C\u53EF\u80FD\u8BE5\u8BA2\u5355\u5DF2\u53D1\u8D27\u3002");
    }
  });
}
async function restoreDailyOrder(id) {
  openConfirm("\u786E\u5B9A\u8981\u6062\u590D\u8FD9\u4E2A\u8BA2\u5355\u5417\uFF1F\u6062\u590D\u540E\u5C06\u56DE\u5230\u65B0\u8BA2\u5355\u9875\u9762\u3002", async () => {
    const res = await fetchWithAuth(`/api/daily-orders/${id}/restore`, {
      method: "PUT"
    });
    if (res.ok) {
      loadDailyOrders("new");
    } else {
      alert("\u6062\u590D\u5931\u8D25");
    }
  });
}
function openDailyOrderModal() {
  const m = document.getElementById("daily-order-modal");
  if (m) {
    let renderDoCustomerList2 = function(filter = "") {
      const all = getAllDailyOrderContacts();
      if (all.length === 0) {
        doCustomerList.innerHTML = '<div class="dd-item" style="color:#64748b">\u52A0\u8F7D\u4E2D\u6216\u65E0\u6570\u636E...</div>';
        return;
      }
      const filtered = all.filter((c) => {
        const q = filter.toLowerCase();
        return [c.name, c.company, c.contact, c.phone, c.city, c.remark || ""].some((v) => String(v || "").toLowerCase().includes(q));
      });
      if (filtered.length === 0) {
        doCustomerList.innerHTML = '<div class="dd-item" style="justify-content:center; color:#64748b">\u65E0\u5339\u914D\u7ED3\u679C</div>';
        return;
      }
      doCustomerList.innerHTML = filtered.map((c) => `
            <div class="dd-item" onclick="selectDoCustomer('${c.name}')">
                <span>${c.name}</span>
                <span style="font-size:12px; color:#64748b">${c.phone || ""} ${c.city || ""}</span>
            </div>
        `).join("");
    };
    var renderDoCustomerList = renderDoCustomerList2;
    m.style.display = "flex";
    syncModalBodyScrollLock();
    document.getElementById("daily-order-modal-title").textContent = "\u65B0\u8BA2\u5355";
    document.getElementById("do-id").value = "";
    document.getElementById("do-notes").value = "";
    document.getElementById("do-items-container").innerHTML = "";
    const doCustomer = document.getElementById("do-customer");
    const doCustomerDd = document.getElementById("do-customer-dd");
    const doCustomerSearch = document.getElementById("do-customer-search");
    const doCustomerList = document.getElementById("do-customer-list");
    const doCustomerRemark = document.getElementById("do-customer-remark");
    const doCustomerPrice = document.getElementById("do-customer-price");
    const updateDoCustomerMeta = () => {
      const customer = getDailyOrderCustomerInfo(((doCustomer == null ? void 0 : doCustomer.value) || "").trim());
      if (doCustomerRemark) doCustomerRemark.textContent = (customer == null ? void 0 : customer.remark) || "";
      if (doCustomerPrice) doCustomerPrice.textContent = customer ? `\u5BA2\u6237\u4EF7\u683C\uFF1A${getDailyOrderPriceLabel((customer == null ? void 0 : customer.use_price) || "price1")}` : "\u5BA2\u6237\u4EF7\u683C\uFF1A";
      const usePrice = (customer == null ? void 0 : customer.use_price) || "price1";
      document.querySelectorAll("#do-items-container .do-item-row").forEach((row) => {
        var _a2, _b2, _c2, _d;
        const priceInput = row.querySelector(".do-item-price");
        if (!priceInput) return;
        const priceMap = {
          price1: (_a2 = row.querySelector(".do-item-price1")) == null ? void 0 : _a2.value,
          price2: (_b2 = row.querySelector(".do-item-price2")) == null ? void 0 : _b2.value,
          price3: (_c2 = row.querySelector(".do-item-price3")) == null ? void 0 : _c2.value,
          price4: (_d = row.querySelector(".do-item-price4")) == null ? void 0 : _d.value
        };
        const nextPrice = priceMap[usePrice];
        if (nextPrice !== void 0 && nextPrice !== null && nextPrice !== "") priceInput.value = Number(nextPrice || 0);
      });
    };
    if (doCustomer) {
      doCustomer.value = "";
      doCustomer.oninput = () => updateDoCustomerMeta();
      doCustomer.onfocus = () => {
        doCustomerDd.style.display = "block";
        doCustomerSearch.focus();
        renderDoCustomerList2();
      };
      setTimeout(() => {
        const closeDd = (e) => {
          if (!m.contains(e.target)) return;
          if (!doCustomer.parentElement.contains(e.target)) {
            doCustomerDd.style.display = "none";
            document.removeEventListener("click", closeDd);
          }
        };
        document.addEventListener("click", closeDd);
      }, 100);
    }
    if (doCustomerSearch) {
      doCustomerSearch.oninput = () => renderDoCustomerList2(doCustomerSearch.value);
    }
    window.selectDoCustomer = function(name) {
      doCustomer.value = name;
      doCustomerDd.style.display = "none";
      updateDoCustomerMeta();
    };
    if (getAuthToken() && (!contactsData.customers || contactsData.customers.length === 0)) {
      loadAllContacts().catch(() => {
      });
    }
    document.getElementById("do-notes").value = "";
    if (doCustomerRemark) doCustomerRemark.textContent = "";
    if (doCustomerPrice) doCustomerPrice.textContent = "\u5BA2\u6237\u4EF7\u683C\uFF1A";
  }
}
async function editDailyOrder(id) {
  const o = currentDailyOrders.find((x) => x.id === id);
  if (!o) return;
  openDailyOrderModal();
  document.getElementById("daily-order-modal-title").textContent = "\u4FEE\u6539\u8BA2\u5355";
  document.getElementById("do-id").value = o.id;
  document.getElementById("do-customer").value = o.customer || "";
  document.getElementById("do-notes").value = o.notes || "";
  const items = typeof o.items === "string" ? JSON.parse(o.items) : o.items || [];
  const tbody = document.getElementById("do-items-container");
  tbody.innerHTML = "";
  let products = [];
  const itemNames = items.map((i) => i.name).filter(Boolean);
  const itemIds = items.map((i) => i.productId).filter(Boolean);
  if (itemNames.length > 0 || itemIds.length > 0) {
    try {
      const res = await fetchWithAuth("/api/products/batch-stock", {
        method: "POST",
        body: JSON.stringify({ names: itemNames, ids: itemIds })
      });
      if (res.ok) products = await res.json();
    } catch (e) {
    }
  }
  items.forEach((prod) => {
    var _a2;
    const fullProd = products.find((p) => p.id == prod.productId || p.name === prod.name) || {};
    const usePrice = ((_a2 = getDailyOrderCustomerInfo(o.customer || "")) == null ? void 0 : _a2.use_price) || "price1";
    const priceValue = fullProd[usePrice] !== void 0 && fullProd[usePrice] !== null && fullProd[usePrice] !== "" ? fullProd[usePrice] : prod.price || prod.price1 || 0;
    const allocationRows = getDailyOrderItemAllocationRows(prod, fullProd);
    const actualQty = getDailyOrderItemActualQty(prod) || Number(prod.qty || 1);
    const originalAllocQty = getDailyOrderItemActualQty(prod);
    const editRows = o.status === "allocated" || o.status === "ready_to_ship" ? allocationRows.length > 0 ? allocationRows : [{ lote: "", expiry: "", qty: actualQty }] : [];
    const tr = document.createElement("tr");
    tr.className = "do-item-row";
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          ${prod.image ? `<img src="${prod.image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : ""}
          <div>
            <div style="font-weight:600">${prod.name}</div>
            <div style="font-size:12px; color:#94a3b8">${prod.sku || ""}</div>
          </div>
        </div>
        <input type="hidden" class="do-item-name" value="${prod.name}">
        <input type="hidden" class="do-item-image" value="${prod.image || ""}">
        <input type="hidden" class="do-item-cn" value="${prod.cn_name || prod.name_cn || ""}">
        <input type="hidden" class="do-item-desc" value="${prod.description || prod.spec || ""}">
        <input type="hidden" class="do-item-tax" value="${prod.tax_rate !== void 0 && prod.tax_rate !== null && prod.tax_rate !== "" ? prod.tax_rate : 0.1}">
        <input type="hidden" class="do-item-pid" value="${prod.productId || prod.id || ""}">
        <input type="hidden" class="do-item-sku" value="${prod.sku || ""}">
        <input type="hidden" class="do-item-price1" value="${fullProd.price1 !== void 0 ? fullProd.price1 : prod.price1 || prod.price || 0}">
        <input type="hidden" class="do-item-price2" value="${fullProd.price2 !== void 0 ? fullProd.price2 : ""}">
        <input type="hidden" class="do-item-price3" value="${fullProd.price3 !== void 0 ? fullProd.price3 : ""}">
        <input type="hidden" class="do-item-price4" value="${fullProd.price4 !== void 0 ? fullProd.price4 : ""}">
        <input type="hidden" class="do-item-allocated-qty-origin" value="${originalAllocQty}">
        <input type="hidden" class="do-item-allocation-plan" value="${escapeHtml(JSON.stringify(Array.isArray(prod == null ? void 0 : prod.allocation_plan) ? prod.allocation_plan : []))}">
        <input type="hidden" class="do-item-deductions" value="${escapeHtml(JSON.stringify(Array.isArray(prod == null ? void 0 : prod.deductions) ? prod.deductions : []))}">
      </td>
      <td><div style="color:#94a3b8; font-size:13px">${prod.cn_name || prod.name_cn || ""}</div></td>
      <td>${editRows.length > 0 ? `<div style="display:flex; flex-direction:column; gap:10px; color:#e2e8f0; font-size:13px">${editRows.map((row) => `<div>${row.lote ? formatFinishedLote(row.lote) : "\u65E0Lote"}</div>`).join("")}</div>` : '<span style="color:#64748b">-</span>'}</td>
      <td>${editRows.length > 0 ? `<div style="display:flex; flex-direction:column; gap:8px">${editRows.map((row) => `<input type="number" class="do-item-lote-qty" data-lote="${escapeHtml(row.lote || "")}" data-expiry="${escapeHtml(row.expiry || "")}" value="${Math.max(0, Number(row.qty || 0))}" min="0" style="width:80px">`).join("")}</div>` : `<input type="number" class="do-item-qty" value="${actualQty}" min="1" style="width:80px">`}</td>
      <td><input type="number" class="do-item-price" value="${priceValue}" step="0.01" style="width:80px"></td>
      <td><button class="btn-red btn-icon" onclick="this.closest('tr').remove()" style="width:32px; height:32px">\xD7</button></td>
    `;
    tbody.appendChild(tr);
    tr.querySelectorAll(".do-item-qty, .do-item-lote-qty").forEach(bindDailyOrderQtyAutoSelect);
  });
  const doCustomer = document.getElementById("do-customer");
  if (doCustomer) doCustomer.dispatchEvent(new Event("input"));
}
function closeDailyOrderModal() {
  const m = document.getElementById("daily-order-modal");
  if (m) m.style.display = "none";
  syncModalBodyScrollLock();
}
function openDoProdSelector() {
  const m = document.getElementById("prod-selector-modal");
  if (m) {
    prodSelectorMode = "daily_order";
    window.selectedProducts.clear();
    m.style.display = "flex";
    loadProductSelector(1);
    window.onProdSelect = function(prod, isBatch) {
      addDoItemRow(prod);
      if (!isBatch) m.style.display = "none";
    };
  }
}
function bindDailyOrderQtyAutoSelect(input) {
  if (!input || input.dataset.autoSelectBound === "1") return;
  input.dataset.autoSelectBound = "1";
  const selectAll = () => {
    try {
      input.select();
      if (typeof input.setSelectionRange === "function") {
        const end = String(input.value || "").length;
        input.setSelectionRange(0, end);
      }
    } catch (e) {
    }
  };
  const focusNextQtyInput = () => {
    const container = input.closest("#do-items-container") || document.getElementById("do-items-container");
    if (!container) return;
    const qtyInputs = Array.from(container.querySelectorAll(".do-item-qty, .do-item-lote-qty")).filter((el) => el && !el.disabled && el.offsetParent !== null);
    const currentIndex = qtyInputs.indexOf(input);
    if (currentIndex < 0) return;
    const nextInput = qtyInputs[currentIndex + 1];
    if (!nextInput) return;
    nextInput.focus();
    setTimeout(() => {
      try {
        nextInput.select();
        if (typeof nextInput.setSelectionRange === "function") {
          const end = String(nextInput.value || "").length;
          nextInput.setSelectionRange(0, end);
        }
      } catch (e) {
      }
    }, 0);
  };
  input.addEventListener("focus", () => setTimeout(selectAll, 0));
  input.addEventListener("click", selectAll);
  input.addEventListener("mouseup", (e) => {
    e.preventDefault();
    selectAll();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    focusNextQtyInput();
  });
}
function selectNumberInputAll(input) {
  if (!input) return;
  try {
    input.focus();
    input.select();
    if (typeof input.setSelectionRange === "function") {
      const end = String(input.value || "").length;
      input.setSelectionRange(0, end);
    }
  } catch (e) {
  }
}
function getVisibleAllocateQtyInputs() {
  const modal = document.getElementById("do-allocate-modal");
  if (!modal) return [];
  return Array.from(modal.querySelectorAll(".alloc-batch-qty")).filter((el) => el && !el.disabled && el.offsetParent !== null);
}
function focusAllocateConfirmButton() {
  const okBtn = document.getElementById("do-allocate-ok");
  if (!okBtn || okBtn.disabled) return;
  okBtn.focus();
}
function focusFirstAllocateQtyInput() {
  const qtyInputs = getVisibleAllocateQtyInputs();
  if (qtyInputs.length > 0) {
    setTimeout(() => selectNumberInputAll(qtyInputs[0]), 0);
    return;
  }
  setTimeout(() => focusAllocateConfirmButton(), 0);
}
function focusNextAllocateQtyInput(currentInput) {
  const qtyInputs = getVisibleAllocateQtyInputs();
  const currentIndex = qtyInputs.indexOf(currentInput);
  if (currentIndex < 0) {
    focusAllocateConfirmButton();
    return;
  }
  const nextInput = qtyInputs[currentIndex + 1];
  if (nextInput) {
    setTimeout(() => selectNumberInputAll(nextInput), 0);
    return;
  }
  setTimeout(() => focusAllocateConfirmButton(), 0);
}
function bindAllocateQtyAutoAdvance(input) {
  if (!input || input.dataset.allocateAutoAdvanceBound === "1") return;
  input.dataset.allocateAutoAdvanceBound = "1";
  const selectAll = () => selectNumberInputAll(input);
  input.addEventListener("focus", () => setTimeout(selectAll, 0));
  input.addEventListener("click", selectAll);
  input.addEventListener("mouseup", (e) => {
    e.preventDefault();
    selectAll();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    focusNextAllocateQtyInput(input);
  });
}
function addDoItemRow(prod) {
  const tbody = document.getElementById("do-items-container");
  const doCustomer = document.getElementById("do-customer");
  const currentCustomer = getDailyOrderCustomerInfo(((doCustomer == null ? void 0 : doCustomer.value) || "").trim());
  const usePrice = (currentCustomer == null ? void 0 : currentCustomer.use_price) || "price1";
  const displayPrice = prod[usePrice] !== void 0 && prod[usePrice] !== null && prod[usePrice] !== "" ? Number(prod[usePrice] || 0) : Number(prod.price1 || 0);
  const orderQty = Math.max(1, parseInt(prod.order_qty || prod.qty || 1, 10) || 1);
  const tr = document.createElement("tr");
  tr.className = "do-item-row";
  tr.innerHTML = `
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        ${prod.image ? `<img src="${prod.image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : ""}
        <div>
          <div style="font-weight:600">${prod.name}</div>
          <div style="font-size:12px; color:#94a3b8">${prod.sku || ""}</div>
        </div>
      </div>
      <input type="hidden" class="do-item-name" value="${prod.name}">
      <input type="hidden" class="do-item-image" value="${prod.image || ""}">
      <input type="hidden" class="do-item-cn" value="${prod.name_cn || ""}">
      <input type="hidden" class="do-item-desc" value="${prod.spec || prod.description || ""}">
      <input type="hidden" class="do-item-tax" value="${prod.tax_rate !== void 0 && prod.tax_rate !== null && prod.tax_rate !== "" ? prod.tax_rate : 0.1}">
      <input type="hidden" class="do-item-pid" value="${prod.id || ""}">
      <input type="hidden" class="do-item-sku" value="${prod.sku || ""}">
      <input type="hidden" class="do-item-price1" value="${prod.price1 || 0}">
      <input type="hidden" class="do-item-price2" value="${prod.price2 || 0}">
      <input type="hidden" class="do-item-price3" value="${prod.price3 || 0}">
      <input type="hidden" class="do-item-price4" value="${prod.price4 || 0}">
      <input type="hidden" class="do-item-allocated-qty-origin" value="0">
      <input type="hidden" class="do-item-allocation-plan" value="[]">
      <input type="hidden" class="do-item-deductions" value="[]">
    </td>
    <td><div style="color:#94a3b8; font-size:13px">${prod.name_cn || ""}</div></td>
    <td><span style="color:#64748b">-</span></td>
    <td><input type="number" class="do-item-qty" value="${orderQty}" min="1" style="width:80px"></td>
    <td><input type="number" class="do-item-price" value="${displayPrice}" step="0.01" style="width:80px"></td>
    <td><button class="btn-red btn-icon" onclick="this.closest('tr').remove()" style="width:32px; height:32px">\xD7</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelectorAll(".do-item-qty, .do-item-lote-qty").forEach(bindDailyOrderQtyAutoSelect);
}
async function saveDailyOrder() {
  var _a2;
  const id = document.getElementById("do-id").value;
  const customer = document.getElementById("do-customer").value;
  const notes = document.getElementById("do-notes").value;
  if (!customer) return alert("\u8BF7\u9009\u62E9\u5BA2\u6237");
  const items = [];
  document.querySelectorAll(".do-item-row").forEach((row) => {
    var _a3, _b2, _c2;
    const name = row.querySelector(".do-item-name").value;
    const image = row.querySelector(".do-item-image").value;
    const cn_name = row.querySelector(".do-item-cn").value;
    const description = row.querySelector(".do-item-desc").value;
    const tax_rate = Number(row.querySelector(".do-item-tax").value);
    const productId = row.querySelector(".do-item-pid").value;
    const sku = row.querySelector(".do-item-sku").value;
    const price = row.querySelector(".do-item-price").value;
    const originalAllocQty = Math.max(0, Number(((_a3 = row.querySelector(".do-item-allocated-qty-origin")) == null ? void 0 : _a3.value) || 0));
    let allocationPlan = [];
    let deductions = [];
    try {
      allocationPlan = JSON.parse(((_b2 = row.querySelector(".do-item-allocation-plan")) == null ? void 0 : _b2.value) || "[]");
    } catch (e) {
    }
    try {
      deductions = JSON.parse(((_c2 = row.querySelector(".do-item-deductions")) == null ? void 0 : _c2.value) || "[]");
    } catch (e) {
    }
    const loteQtyInputs = Array.from(row.querySelectorAll(".do-item-lote-qty"));
    let nextQty = 0;
    if (loteQtyInputs.length > 0) {
      allocationPlan = loteQtyInputs.map((inp) => {
        const qty = Math.max(0, Number(inp.value || 0));
        nextQty += qty;
        return {
          lote: String(inp.dataset.lote || "").trim(),
          expiry: String(inp.dataset.expiry || "").trim(),
          qty
        };
      }).filter((x) => x.qty > 0);
      deductions = [];
    } else {
      const qty = row.querySelector(".do-item-qty").value;
      nextQty = Math.max(0, Number(qty || 0));
    }
    const payload = { name, image, cn_name, description, tax_rate, productId, sku, qty: nextQty, price: Number(price) };
    if (loteQtyInputs.length > 0) {
      payload.allocated_qty = nextQty;
      payload.allocation_plan = Array.isArray(allocationPlan) ? allocationPlan : [];
      payload.deductions = [];
    } else if (nextQty > 0 && originalAllocQty > 0) {
      payload.allocated_qty = nextQty;
      if (nextQty === originalAllocQty) {
        payload.allocation_plan = Array.isArray(allocationPlan) ? allocationPlan : [];
        payload.deductions = Array.isArray(deductions) ? deductions : [];
      } else {
        payload.allocation_plan = [];
        payload.deductions = [];
      }
    }
    if (name && nextQty) items.push(payload);
  });
  if (items.length === 0) return alert("\u8BF7\u6DFB\u52A0\u5546\u54C1");
  if (id) {
    await fetchWithAuth("/api/daily-orders/" + id, {
      method: "PUT",
      body: JSON.stringify({ customer, notes, items })
    });
  } else {
    await fetchWithAuth("/api/daily-orders", {
      method: "POST",
      body: JSON.stringify({ customer, notes, items })
    });
  }
  closeDailyOrderModal();
  const currentTab = ((_a2 = document.querySelector("#page-daily-orders .tabs .tab.active")) == null ? void 0 : _a2.dataset.tab) || "new";
  loadDailyOrders(currentTab);
}
async function openAllocateModal(id) {
  const order = currentDailyOrders.find((o) => o.id === id);
  if (!order) return;
  if (order.status === "new" && order.allocation_enabled !== true) {
    alert("\u8BF7\u5148\u70B9\u51FB\u201C\u53EF\u914D\u8D27\u201D");
    return;
  }
  const m = document.getElementById("do-allocate-modal");
  const grandTotalEl = document.getElementById("do-allocate-grand-total");
  document.getElementById("do-allocate-id").value = id;
  const tbody = document.getElementById("do-allocate-rows");
  const items = Array.isArray(order.items) ? order.items : typeof order.items === "string" ? JSON.parse(order.items) : [];
  dailyOrderAllocateState = [];
  if (grandTotalEl) grandTotalEl.textContent = "\u603B\u8BA1\u7BB1\u6570\uFF1A0";
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8">\u52A0\u8F7D\u4E2D...</td></tr>';
  m.style.display = "flex";
  syncModalBodyScrollLock();
  try {
    const itemNames = items.map((i) => i.name).filter(Boolean);
    const itemIds = items.map((i) => i.productId).filter(Boolean);
    let products = [];
    if (itemNames.length > 0 || itemIds.length > 0) {
      const res = await fetchWithAuth("/api/products/batch-stock", {
        method: "POST",
        body: JSON.stringify({ names: itemNames, ids: itemIds })
      });
      if (res.ok) {
        products = await res.json();
      }
    }
    dailyOrderAllocateState = items.map((item, idx) => {
      const p = products.find((p2) => p2.id == item.productId || p2.name === item.name);
      const nameCn = p ? p.name_cn || item.name_cn || "" : item.name_cn || "";
      const totalStock = p ? Math.max(Number(p.stock || 0), Array.isArray(p == null ? void 0 : p.batches) ? p.batches.reduce((sum, row) => sum + Math.max(0, Number((row == null ? void 0 : row.qty) || 0)), 0) : 0) : 0;
      const rawBatches = Array.isArray(p == null ? void 0 : p.batches) ? p.batches : [];
      const loteExpiryState = /* @__PURE__ */ new Map();
      rawBatches.forEach((row) => {
        const rawLote = String((row == null ? void 0 : row.lote) || "").trim();
        const qty = Math.max(0, Number((row == null ? void 0 : row.qty) || 0));
        if (!rawLote || qty <= 0) return;
        const loteKey = formatFinishedLote(rawLote) || rawLote;
        const expiry = String((row == null ? void 0 : row.expiry) || "").trim();
        const meta = loteExpiryState.get(loteKey) || { expiry: "", mixed: false };
        if (!meta.expiry) {
          meta.expiry = expiry;
        } else if (expiry && meta.expiry !== expiry) {
          meta.mixed = true;
        } else if (!expiry && meta.expiry) {
          meta.mixed = true;
        }
        loteExpiryState.set(loteKey, meta);
      });
      const displayRows = p ? buildFinishedStockRows(totalStock, rawBatches) : [];
      const choices = displayRows.length > 0 ? displayRows.map((row) => ({
        lote: String((row == null ? void 0 : row.lote) || "").trim(),
        expiry: loteExpiryState.get(String((row == null ? void 0 : row.lote) || "").trim())?.mixed ? "" : String((row == null ? void 0 : row.expiry) || "").trim(),
        stock: Math.max(0, Number((row == null ? void 0 : row.qty) || 0)),
        qty: 0
      })) : [{ lote: "", expiry: "", stock: Math.max(0, totalStock), qty: 0 }];
      const existingPlan = Array.isArray(item == null ? void 0 : item.allocation_plan) && item.allocation_plan.length > 0 ? item.allocation_plan : Array.isArray(item == null ? void 0 : item.deductions) ? item.deductions : [];
      if (existingPlan.length > 0) {
        existingPlan.forEach((planRow) => {
          const lote = String((planRow == null ? void 0 : planRow.lote) || "").trim();
          const expiry = String((planRow == null ? void 0 : planRow.expiry) || "").trim();
          const qty = Math.max(0, Number((planRow == null ? void 0 : planRow.qty) || 0));
          const match = choices.find((choice) => choice.lote === lote && (choice.expiry === expiry || !choice.expiry));
          if (match) match.qty += qty;
        });
      } else {
        let remaining = Math.max(0, Number(item.allocated_qty !== void 0 ? item.allocated_qty : item.qty));
        choices.forEach((choice) => {
          if (remaining <= 0) return;
          const take = Math.min(choice.stock, remaining);
          choice.qty = take;
          remaining -= take;
        });
      }
      return {
        idx,
        item,
        product: p,
        nameCn,
        totalStock,
        choices
      };
    });
    tbody.innerHTML = dailyOrderAllocateState.map((state) => {
      const { idx, item, nameCn, choices } = state;
      const lote = choices.length > 0 ? `<div style="display:flex;flex-direction:column;gap:8px">` + choices.map((choice) => `<div>${choice.lote ? formatFinishedLote(choice.lote) : "\u65E0Lote"}</div>`).join("") + `</div>` : "-";
      const stock = choices.length > 0 ? `<div style="display:flex;flex-direction:column;gap:8px">` + choices.map((choice) => `<div>${choice.stock}</div>`).join("") + `</div>` : "-";
      const allocInputs = choices.length > 0 ? `<div style="display:flex;flex-direction:column;gap:8px">` + choices.map((choice, rowIdx) => `
            <div>
              <input
                type="number"
                min="0"
                max="${choice.stock}"
                step="1"
                class="alloc-batch-qty"
                data-item-idx="${idx}"
                data-row-idx="${rowIdx}"
                data-stock="${choice.stock}"
                value="${choice.qty}"
                oninput="syncAllocateItemTotal(${idx})"
                style="width:88px"
              >
            </div>
          `).join("") + `
            <div id="alloc-total-${idx}" style="font-size:12px; color:#94a3b8">\u5408\u8BA1\uFF1A${choices.reduce((sum, choice) => sum + Number(choice.qty || 0), 0)}</div>
          </div>` : `<div id="alloc-total-${idx}" style="font-size:12px; color:#94a3b8">\u5408\u8BA1\uFF1A0</div>`;
      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              ${item.image ? `<img src="${item.image}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : ""}
              <span>${item.name}</span>
            </div>
          </td>
          <td>${nameCn}</td>
          <td>${lote}</td>
          <td>${stock}</td>
          <td>${item.qty}</td>
          <td>${allocInputs}</td>
        </tr>
      `;
    }).join("");
    tbody.querySelectorAll(".alloc-batch-qty").forEach(bindAllocateQtyAutoAdvance);
    syncAllocateGrandTotal();
    focusFirstAllocateQtyInput();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#ef4444">\u52A0\u8F7D\u5931\u8D25</td></tr>';
    focusAllocateConfirmButton();
  }
}
function syncAllocateGrandTotal() {
  const totalEl = document.getElementById("do-allocate-grand-total");
  if (!totalEl) return;
  let total = 0;
  document.querySelectorAll(".alloc-batch-qty").forEach((inp) => {
    total += Math.max(0, Number(inp.value || 0));
  });
  totalEl.textContent = `\u603B\u8BA1\u7BB1\u6570\uFF1A${total}`;
}
function syncAllocateItemTotal(idx) {
  var _a2;
  const totalEl = document.getElementById(`alloc-total-${idx}`);
  if (!totalEl) return;
  const state = dailyOrderAllocateState.find((x) => Number(x.idx) === Number(idx));
  const orderedQty = Math.max(0, Number(((_a2 = state == null ? void 0 : state.item) == null ? void 0 : _a2.qty) || 0));
  let total = 0;
  document.querySelectorAll(`.alloc-batch-qty[data-item-idx="${idx}"]`).forEach((inp) => {
    total += Math.max(0, Number(inp.value || 0));
  });
  totalEl.textContent = `\u5408\u8BA1\uFF1A${total}`;
  totalEl.style.color = total > orderedQty ? "#ef4444" : "#94a3b8";
  syncAllocateGrandTotal();
}
window.syncAllocateItemTotal = syncAllocateItemTotal;
function formatInsufficientStockMessage(err) {
  const name = String((err == null ? void 0 : err.product_name) || "\u5546\u54C1").trim();
  const available = Number((err == null ? void 0 : err.available_stock) || 0);
  const requested = Number((err == null ? void 0 : err.requested_qty) || 0);
  return `\u5546\u54C1\u5E93\u5B58\u4E0D\u8DB3\uFF1A${name}\uFF0C\u5F53\u524D\u5E93\u5B58 ${available}\uFF0C\u9700\u8981\u6570\u91CF ${requested}`;
}
function formatInsufficientStockSupplementMessage(err) {
  const name = String((err == null ? void 0 : err.product_name) || "\u5546\u54C1").trim();
  const available = Number((err == null ? void 0 : err.available_stock) || 0);
  const requested = Number((err == null ? void 0 : err.requested_qty) || 0);
  const selectedLote = formatFinishedLote((err == null ? void 0 : err.selected_lote) || "") || String((err == null ? void 0 : err.selected_lote) || "").trim();
  const supplementLotes = Array.from(new Set((Array.isArray(err == null ? void 0 : err.supplement_lotes) ? err.supplement_lotes : []).map((lote) => formatFinishedLote(lote) || String(lote || "").trim()).filter(Boolean)));
  if (!selectedLote || !supplementLotes.length || !(err == null ? void 0 : err.auto_supplement_available)) {
    return `库存不足：${name}（可用${available}，需要${requested}）`;
  }
  return `库存不足：${name}（Lote：${selectedLote}可用${available}，需要${requested}），继续下单系统将在Lote：${supplementLotes.join("、")}中扣除缺少的数量`;
}
function openInsufficientStockSupplementConfirm(err) {
  return new Promise((resolve) => {
    openConfirm(
      formatInsufficientStockSupplementMessage(err),
      () => resolve(true),
      {
        okText: "补充并继续",
        cancelText: "取消",
        onCancel: () => resolve(false)
      }
    );
  });
}
async function confirmAllocate() {
  const id = Number(document.getElementById("do-allocate-id").value);
  const order = currentDailyOrders.find((o) => o.id === id);
  if (!order) return;
  const okBtn = document.getElementById("do-allocate-ok");
  const prevOkText = okBtn ? okBtn.textContent : "";
  const items = Array.isArray(order.items) ? order.items : typeof order.items === "string" ? JSON.parse(order.items) : [];
  try {
    for (const state of dailyOrderAllocateState) {
      const idx = Number((state == null ? void 0 : state.idx) || 0);
      const item = items[idx];
      if (!item) continue;
      const plan = [];
      let total = 0;
      document.querySelectorAll(`.alloc-batch-qty[data-item-idx="${idx}"]`).forEach((inp) => {
        var _a2;
        const rowIdx = Number(inp.dataset.rowIdx);
        const choice = (_a2 = state.choices) == null ? void 0 : _a2[rowIdx];
        if (!choice) return;
        const qty = Math.max(0, Number(inp.value || 0));
        const stock = Math.max(0, Number(choice.stock || 0));
        if (qty > stock) throw new Error(`\u914D\u8D27\u6570\u91CF\u4E0D\u80FD\u5927\u4E8E lote \u5E93\u5B58\uFF1A${item.name || "\u5546\u54C1"}`);
        total += qty;
        if (qty > 0) {
          plan.push({
            lote: choice.lote || "",
            expiry: choice.expiry || "",
            qty
          });
        }
      });
      item.allocated_qty = total;
      item.allocation_plan = plan;
      item.deductions = [];
    }
  } catch (e) {
    alert(e.message || "\u914D\u8D27\u6570\u91CF\u4E0D\u6B63\u786E");
    return;
  }
  try {
    if (okBtn) {
      okBtn.disabled = true;
      okBtn.textContent = "\u5904\u7406\u4E2D...";
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15e3);
    const res = await fetchWithAuth(`/api/daily-orders/${id}/allocate`, {
      method: "PUT",
      body: JSON.stringify({ items }),
      signal: ac.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if ((err == null ? void 0 : err.error) === "allocation_not_enabled") {
        alert("\u8BF7\u5148\u70B9\u51FB\u201C\u53EF\u914D\u8D27\u201D");
      } else if ((err == null ? void 0 : err.error) === "insufficient_stock") {
        await openAllocateModal(id);
        alert(formatInsufficientStockMessage(err));
      } else {
        alert(err.error ? `\u914D\u8D27\u5931\u8D25\uFF1A${err.error}` : "\u914D\u8D27\u5931\u8D25");
      }
      return;
    }
    dailyOrderAllocateState = [];
    closeAllocateModal();
    loadDailyOrders("new");
  } catch (e) {
    console.error(e);
    alert(e && e.name === "AbortError" ? "\u914D\u8D27\u8D85\u65F6\uFF1A\u540E\u7AEF\u54CD\u5E94\u8FC7\u6162" : (e == null ? void 0 : e.message) || "\u914D\u8D27\u5931\u8D25\uFF1A\u540E\u7AEF\u4E0D\u53EF\u7528\u6216\u7F51\u7EDC\u5F02\u5E38");
  } finally {
    if (okBtn) {
      okBtn.disabled = false;
      okBtn.textContent = prevOkText || "\u786E\u8BA4\u914D\u8D27\u5B8C\u6210";
    }
  }
}
async function confirmShip(id) {
  openDoShipModal(id);
}
let fsPage = 1;
const fsPageSize = 50;
let fsTotal = 0;
let fsCurrentTab = "stock";
let fsLowStockOnly = false;
let fsAdjustPage = 1;
let fsAdjustTotal = 0;
let fsRecordPage = 1;
const fsRecordPageSize = 100;
let fsRecordTotal = 0;
let fsAdjustState = null;
const fsRemindModal = document.getElementById("fs-remind-modal");
const fsRemindForm = document.getElementById("fs-remind-form");
const fsRemindInput = document.getElementById("fs-remind-input");
const fsRemindCancel = document.getElementById("fs-remind-cancel");
const fsRemindCancelTop = document.getElementById("fs-remind-cancel-top");
let rsPage = 1;
const rsPageSize = 50;
let rsTotal = 0;
let rsCurrentTab = "stock";
let rsAdjustPage = 1;
let rsAdjustTotal = 0;
let rsRecordPage = 1;
const rsRecordPageSize = 100;
let rsRecordTotal = 0;
let rsRecordAll = [];
let rsRecordFiltered = [];
let rsMerchantNameByMaterialName = new Map();
let rsAdjustState = null;
let rsAuditItems = [];
let rsAuditResultPage = 1;
const rsAuditResultPageSize = 100;
let rsAuditResultTotal = 0;
let rsMaterialOptions = [];
let rsMaterialEditId = null;
let rsAddItems = [];
let rsSelectedMerchant = { id: 0, name: "" };
let rsPendingMerchantSelection = { id: 0, name: "" };
const RAW_MATERIAL_CATEGORIES = ["食物原料", "辅料", "包装材料", "清洁用品", "其它"];
let rsSelectedCategory = "其它";
const rsCategorySelect = document.getElementById("rs-category");
const rsMaterialCategorySelect = document.getElementById("rs-material-category");
if (rsCategorySelect) {
  rsCategorySelect.addEventListener("change", () => {
    rsSelectedCategory = RAW_MATERIAL_CATEGORIES.includes(rsCategorySelect.value) ? rsCategorySelect.value : "其它";
    rsAddItems.forEach((item) => { item.category = rsSelectedCategory; });
    renderRawStockItems();
  });
}
let rsSelPage = 1;
const rsSelPageSize = 100;
let rsSelTotal = 0;
const rsMaterialFile = document.getElementById("rs-material-file");
const rsMaterialIdInput = document.getElementById("rs-material-id");
const rsMaterialImage = document.getElementById("rs-material-image");
const rsMaterialPreview = document.getElementById("rs-material-preview");
const rsMaterialFileName = document.getElementById("rs-material-file-name");
const rsNameModalTitle = document.getElementById("rs-name-modal-title");
const rsNameModalSave = document.getElementById("rs-name-modal-save");
const rsSelModal = document.getElementById("rs-selector-modal");
const rsSelTitle = document.getElementById("rs-sel-title");
const rsSelSearch = document.getElementById("rs-sel-search");
const rsSelList = document.getElementById("rs-sel-list");
const rsSelConfirm = document.getElementById("rs-sel-confirm");
const rsMerchantNameInput = document.getElementById("rs-merchant-name");
const rsMaterialMerchantNameInput = document.getElementById("rs-material-merchant-name");
const rsMerchantModal = document.getElementById("rs-merchant-selector-modal");
const rsMerchantSearch = document.getElementById("rs-merchant-search");
const rsMerchantList = document.getElementById("rs-merchant-list");
const rsRecordToolbar = document.getElementById("rs-record-toolbar");
const rsRecordMonthFrom = document.getElementById("rs-record-month-from");
const rsRecordMonthTo = document.getElementById("rs-record-month-to");
const rsRecordTypeFilter = document.getElementById("rs-record-type-filter");
const rsRecordMerchantFilter = document.getElementById("rs-record-merchant-filter");
let eventRecordPage = 1;
const eventRecordPageSize = 50;
let eventRecordTotal = 0;
let eventRecordCurrentTab = "ongoing";
let currentEventRecordList = [];
let eventRecordPendingImageFile = null;
let eventRecordPreviewObjectUrl = "";
let productionReviewPage = 1;
const productionReviewPageSize = 50;
let productionReviewTotal = 0;
let productionReviewCurrentTab = "pending";
let currentProductionEntryList = [];
let knowledgeBasePage = 1;
const knowledgeBasePageSize = 50;
let knowledgeBaseTotal = 0;
let knowledgeBaseCurrentTab = "internal";
let currentKnowledgeBaseList = [];
let pendingFinishedStockTab = "";
let productionPendingCount = 0;
if (rsMaterialFile) {
  rsMaterialFile.addEventListener("change", () => {
    var _a2;
    const fileObj = (_a2 = rsMaterialFile.files) == null ? void 0 : _a2[0];
    if (!fileObj) {
      if (rsMaterialPreview) {
        rsMaterialPreview.src = "";
        rsMaterialPreview.style.display = "none";
      }
      if (rsMaterialFileName) rsMaterialFileName.textContent = "\u672A\u9009\u62E9\u56FE\u7247";
      return;
    }
    if (rsMaterialFileName) rsMaterialFileName.textContent = fileObj.name;
    const localUrl = URL.createObjectURL(fileObj);
    if (rsMaterialPreview) {
      rsMaterialPreview.src = localUrl;
      rsMaterialPreview.style.display = "block";
    }
  });
}
function renderLoteLines(loteValue = "") {
  const raw = String(loteValue || "").trim();
  if (!raw) return "-";
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return "-";
  return `<div style="display:flex; flex-direction:column; gap:4px">` + parts.map((x) => `<div>${x}</div>`).join("") + `</div>`;
}
function formatFinishedLote(loteValue = "") {
  let l = String(loteValue || "").trim();
  const parts = l.split("-");
  if (parts.length === 3) l = parts[2] + parts[1];
  return l;
}
function getFinishedLoteLabel(loteValue = "", fallbackLabel = "\u8865\u5F55\u6279\u6B21") {
  const formatted = formatFinishedLote(loteValue);
  return formatted || fallbackLabel;
}
function mergeFinishedBatches(batches = []) {
  const grouped = /* @__PURE__ */ new Map();
  (Array.isArray(batches) ? batches : []).forEach((batch) => {
    const rawLote = String((batch == null ? void 0 : batch.lote) || "").trim();
    const qty = Number((batch == null ? void 0 : batch.qty) || 0);
    if (!rawLote || qty <= 0) return;
    const expiry = String((batch == null ? void 0 : batch.expiry) || "").trim();
    const displayLote = formatFinishedLote(rawLote) || rawLote;
    const key = displayLote;
    if (!grouped.has(key)) {
      grouped.set(key, { lote: displayLote, expiry, qty: 0 });
    }
    const current = grouped.get(key);
    current.qty += qty;
    if (!current.expiry && expiry) {
      current.expiry = expiry;
    } else if (current.expiry && expiry && toSortableDateValue(expiry).localeCompare(toSortableDateValue(current.expiry)) < 0) {
      current.expiry = expiry;
    }
  });
  return Array.from(grouped.values()).sort((a, b) => {
    const ea = toSortableDateValue(a.expiry || "");
    const eb = toSortableDateValue(b.expiry || "");
    return ea.localeCompare(eb) || String(a.lote || "").localeCompare(String(b.lote || ""));
  });
}
function buildFinishedStockRows(totalStock, batches = []) {
  const merged = mergeFinishedBatches(batches);
  const batchedQty = merged.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const effectiveTotalStock = Math.max(0, Math.max(Number(totalStock || 0), batchedQty));
  const unlottedQty = Math.max(0, effectiveTotalStock - batchedQty);
  if (unlottedQty > 0) {
    return [{ qty: unlottedQty, lote: "", expiry: "" }, ...merged];
  }
  return merged;
}
function switchFinishedStockTab(tab, btn) {
  const canStock = can("finished_stock", "view");
  const canAdjust = can("finished_stock_adjust", "view");
  const canReview = can("production_review", "view");
  if (tab === "review" && !canReview) {
    tab = canStock ? "stock" : canAdjust ? "adjust" : "stock";
    btn = document.getElementById(tab === "adjust" ? "fs-tab-adjust" : "fs-tab-stock");
  }
  if ((tab === "stock" || tab === "records") && !canStock) {
    tab = canReview ? "review" : canAdjust ? "adjust" : "stock";
    btn = document.getElementById(tab === "review" ? "fs-tab-review" : tab === "adjust" ? "fs-tab-adjust" : "fs-tab-stock");
  }
  if (tab === "adjust" && !canAdjust) {
    tab = canReview ? "review" : canStock ? "stock" : "stock";
    btn = document.getElementById(tab === "review" ? "fs-tab-review" : "fs-tab-stock");
  }
  fsCurrentTab = tab === "records" ? "records" : tab === "adjust" ? "adjust" : tab === "review" ? "review" : "stock";
  const stockPanel = document.getElementById("fs-stock-panel");
  const recordPanel = document.getElementById("fs-records-panel");
  const adjustPanel = document.getElementById("fs-adjust-panel");
  const reviewPanel = document.getElementById("fs-review-panel");
  const stockToolbar = document.getElementById("fs-stock-toolbar");
  const addBtn = document.getElementById("fs-add-btn");
  const stockTab = document.getElementById("fs-tab-stock");
  const recordsTab = document.getElementById("fs-tab-records");
  const adjustTab = document.getElementById("fs-tab-adjust");
  const reviewTab = document.getElementById("fs-tab-review");
  if (stockTab) stockTab.style.display = canStock ? "inline-flex" : "none";
  if (recordsTab) recordsTab.style.display = canStock ? "inline-flex" : "none";
  if (adjustTab) adjustTab.style.display = canAdjust ? "inline-flex" : "none";
  if (reviewTab) reviewTab.style.display = canReview ? "inline-flex" : "none";
  if (stockPanel) stockPanel.style.display = fsCurrentTab === "stock" ? "block" : "none";
  if (recordPanel) recordPanel.style.display = fsCurrentTab === "records" ? "block" : "none";
  if (adjustPanel) adjustPanel.style.display = fsCurrentTab === "adjust" ? "block" : "none";
  if (reviewPanel) reviewPanel.style.display = fsCurrentTab === "review" ? "block" : "none";
  if (stockToolbar) stockToolbar.style.display = fsCurrentTab === "stock" || fsCurrentTab === "adjust" ? "flex" : "none";
  if (addBtn) addBtn.style.display = fsCurrentTab === "stock" ? "inline-flex" : "none";
  document.querySelectorAll("#page-finished-stock .tab").forEach((el) => el.classList.remove("active"));
  if (btn) btn.classList.add("active");
  else {
    const activeBtn = document.getElementById(
      fsCurrentTab === "stock" ? "fs-tab-stock" : fsCurrentTab === "records" ? "fs-tab-records" : fsCurrentTab === "adjust" ? "fs-tab-adjust" : "fs-tab-review"
    );
    if (activeBtn) activeBtn.classList.add("active");
  }
  if (fsCurrentTab === "stock") loadFinishedStock(1);
  else if (fsCurrentTab === "records") loadFinishedStockRecords(1);
  else if (fsCurrentTab === "adjust") loadFinishedStockAdjustments(1);
  else loadProductionEntries("pending");
}
window.switchFinishedStockTab = switchFinishedStockTab;
function handleFsSearchInput() {
  if (fsCurrentTab === "adjust") loadFinishedStockAdjustments(1);
  else if (fsCurrentTab === "review") loadProductionEntries(productionReviewCurrentTab, null, 1);
  else loadFinishedStock(1);
}
window.handleFsSearchInput = handleFsSearchInput;
async function loadFinishedStock(page = 1) {
  var _a2, _b2, _c2;
  fsPage = page;
  const q = ((_b2 = (_a2 = document.getElementById("fs-search")) == null ? void 0 : _a2.value) == null ? void 0 : _b2.trim()) || "";
  updateFinishedStockHeaderState();
  const res = await fetchWithAuth(`/api/inventory/finished?page=${fsPage}&size=${fsPageSize}&q=${encodeURIComponent(q)}&low_stock=${fsLowStockOnly ? "1" : "0"}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  fsTotal = data.total || 0;
  const remindBtn = document.getElementById("fs-remind-btn");
  if (remindBtn) {
    remindBtn.dataset.currentValue = String(Number(((_c2 = list[0]) == null ? void 0 : _c2.remind_stock) || 0));
    remindBtn.style.display = "none";
  }
  const tbody = document.getElementById("finished-stock-rows");
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:20px; color:#94a3b8">${fsLowStockOnly ? "\u6682\u65E0\u5C11\u4E8E\u63D0\u9192\u6570\u91CF\u7684\u5546\u54C1" : "\u6682\u65E0\u6570\u636E"}</td></tr>`;
    renderFsPager();
    return;
  }
  tbody.innerHTML = list.map((p, idx) => {
    const totalStock = Number(p.total_stock || 0);
    const remindStock = Math.max(0, Number(p.remind_stock || 0));
    const isLowStock = remindStock > 0 && totalStock <= remindStock;
    let stockHtml = totalStock;
    let expiryHtml = "";
    let loteHtml = "";
    const displayBatches = buildFinishedStockRows(totalStock, p.batches);
    if (displayBatches.length > 0) {
      stockHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map((b) => `<div>${b.qty}</div>`).join("") + `</div>`;
      expiryHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map((b) => `<div>${formatInventoryDisplayDate(b.expiry || "")}</div>`).join("") + `</div>`;
      loteHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map((b) => `<div>${getFinishedLoteLabel(b.lote)}</div>`).join("") + `</div>`;
    } else if (p.batches && p.batches.length > 0) {
      stockHtml = 0;
    }
    const stockCellHtml = `<div style="${isLowStock ? "color:#ef4444;font-weight:700" : ""}">${stockHtml}</div>`;
    const remindHtml = remindStock > 0 ? remindStock : '<span style="color:#94a3b8">\u672A\u8BBE\u7F6E</span>';
    const viewBtn = `<button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="location.hash='#stock-history?id=${p.id}'">\u67E5\u770B</button>`;
    return `
    <tr>
      <td>${fsTotal - (fsPage - 1) * fsPageSize - idx}</td>
      <td style="padding:8px; width:60px; height:60px; text-align:center">${p.image ? `<img src="${p.image}" class="thumb-img" onclick="showFileViewer('${p.image}')" style="width:44px; height:44px; object-fit:contain; display:inline-block; vertical-align:middle">` : ""}</td>
      <td>${p.sku || ""}</td>
      <td>${p.name}</td>
      <td>${p.name_cn || ""}</td>
      <td>${stockCellHtml}</td>
      <td>${remindHtml}</td>
      <td>${loteHtml}</td>
      <td>${expiryHtml}</td>
      <td style="text-align:center">
        ${viewBtn}
      </td>
    </tr>
    `;
  }).join("");
  renderFsPager();
}
function updateFinishedStockHeaderState() {
  const header = document.getElementById("fs-total-stock-header");
  if (!header) return;
  header.textContent = fsLowStockOnly ? "\u603B\u5E93\u5B58 \xB7 \u5C11\u4E8E\u63D0\u9192\u6570\u91CF" : "\u603B\u5E93\u5B58";
  header.style.color = fsLowStockOnly ? "var(--blue)" : "";
}
function toggleFinishedStockLowFilter() {
  fsLowStockOnly = !fsLowStockOnly;
  loadFinishedStock(1);
}
window.toggleFinishedStockLowFilter = toggleFinishedStockLowFilter;
function openAllFinishedStockReminderModal() {
  var _a2;
  const currentValue = Number(((_a2 = document.getElementById("fs-remind-btn")) == null ? void 0 : _a2.dataset.currentValue) || 0);
  if (!fsRemindModal || !fsRemindInput) return;
  fsRemindInput.value = String(currentValue);
  fsRemindModal.style.display = "flex";
  setTimeout(() => {
    fsRemindInput.focus();
    fsRemindInput.select();
  }, 0);
}
function closeAllFinishedStockReminderModal() {
  if (fsRemindModal) fsRemindModal.style.display = "none";
}
async function setAllFinishedStockReminder() {
  const remindStock = Math.max(0, Number((fsRemindInput == null ? void 0 : fsRemindInput.value) || 0));
  if (!Number.isFinite(remindStock)) {
    alert("\u8BF7\u8F93\u5165\u6709\u6548\u6570\u5B57");
    return;
  }
  const saveBtn = document.getElementById("fs-remind-save");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "\u4FDD\u5B58\u4E2D...";
  }
  const res = await fetchWithAuth("/api/products-remind-stock-all", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remind_stock: remindStock })
  });
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = "\u4FDD\u5B58";
  }
  if (!res.ok) {
    alert("\u63D0\u9192\u6570\u91CF\u4FDD\u5B58\u5931\u8D25");
    return;
  }
  const btn = document.getElementById("fs-remind-btn");
  if (btn) btn.dataset.currentValue = String(remindStock);
  closeAllFinishedStockReminderModal();
  showAppToast("\u5DF2\u7EDF\u4E00\u8BBE\u7F6E\u6240\u6709\u5546\u54C1\u63D0\u9192\u6570\u91CF");
  await loadFinishedStock(fsPage);
}
if (fsRemindCancel) fsRemindCancel.addEventListener("click", closeAllFinishedStockReminderModal);
if (fsRemindCancelTop) fsRemindCancelTop.addEventListener("click", closeAllFinishedStockReminderModal);
if (fsRemindForm) {
  fsRemindForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await setAllFinishedStockReminder();
  });
}
window.openAllFinishedStockReminderModal = openAllFinishedStockReminderModal;
window.setAllFinishedStockReminder = setAllFinishedStockReminder;
async function loadFinishedStockAdjustments(page = 1) {
  var _a2, _b2;
  fsAdjustPage = page;
  const q = ((_b2 = (_a2 = document.getElementById("fs-search")) == null ? void 0 : _a2.value) == null ? void 0 : _b2.trim()) || "";
  const res = await fetchWithAuth(`/api/inventory/finished?page=${fsAdjustPage}&size=${fsPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  fsAdjustTotal = data.total || 0;
  const tbody = document.getElementById("finished-stock-adjust-rows");
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8">\u6682\u65E0\u6570\u636E</td></tr>';
    renderFsAdjustPager();
    return;
  }
  tbody.innerHTML = list.map((p, idx) => {
    const totalStock = Number(p.total_stock || 0);
    let stockHtml = totalStock;
    let expiryHtml = "";
    let loteHtml = "";
    const displayBatches = mergeFinishedBatches(p.batches);
    if (displayBatches.length > 0) {
      stockHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map((b) => `<div>${b.qty}</div>`).join("") + `</div>`;
      expiryHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map((b) => `<div>${formatInventoryDisplayDate(b.expiry || "")}</div>`).join("") + `</div>`;
      loteHtml = `<div style="display:flex;flex-direction:column;gap:4px">` + displayBatches.map((b) => `<div>${formatFinishedLote(b.lote)}</div>`).join("") + `</div>`;
    } else if (p.batches && p.batches.length > 0) {
      stockHtml = 0;
    }
    return `
    <tr>
      <td>${fsAdjustTotal - (fsAdjustPage - 1) * fsPageSize - idx}</td>
      <td style="padding:8px; width:60px; height:60px; text-align:center">${p.image ? `<img src="${p.image}" class="thumb-img" onclick="showFileViewer('${p.image}')" style="width:44px; height:44px; object-fit:contain; display:inline-block; vertical-align:middle">` : ""}</td>
      <td>${p.sku || ""}</td>
      <td>${p.name}</td>
      <td>${p.name_cn || ""}</td>
      <td>${stockHtml}</td>
      <td>${loteHtml}</td>
      <td>${expiryHtml}</td>
      <td style="text-align:center">${can("finished_stock_adjust", "view") ? `<button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="openFinishedStockAdjustment('${encodeURIComponent(JSON.stringify(p))}')">\u8C03\u6574</button>` : ""}</td>
    </tr>
    `;
  }).join("");
  renderFsAdjustPager();
}
window.loadFinishedStockAdjustments = loadFinishedStockAdjustments;
async function loadFinishedStockRecords(page = 1) {
  fsRecordPage = page;
  const tbody = document.getElementById("finished-stock-record-rows");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" class="empty">\u52A0\u8F7D\u4E2D...</td></tr>';
  try {
    const res = await fetchWithAuth(`/api/inventory/finished/logs?page=${fsRecordPage}&size=${fsRecordPageSize}&_t=${Date.now()}`);
    if (!res.ok) throw new Error("Failed to load finished stock records");
    const data = await res.json();
    const list = data.list || [];
    fsRecordTotal = data.total || 0;
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty">\u6682\u65E0\u8BB0\u5F55</td></tr>';
      renderFsRecordPager();
      return;
    }
    tbody.innerHTML = list.map((row, idx) => {
      const d = new Date(Number(row.date || 0));
      const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const qty = Number(row.qty || 0);
      const qtyColor = qty >= 0 ? "#10b981" : "#f97316";
      return `
        <tr>
          <td>${fsRecordTotal - (fsRecordPage - 1) * fsRecordPageSize - idx}</td>
          <td>${row.sku || ""}</td>
          <td>${row.name || ""}</td>
          <td>${row.name_cn || ""}</td>
          <td>${dateStr}</td>
          <td>${row.invoice_no || "-"}</td>
          <td>${row.customer || "-"}</td>
          <td style="text-align:right; color:${qtyColor}; font-weight:600">${qty > 0 ? "+" : ""}${qty}</td>
          <td>${renderLoteLines(row.lote)}</td>
          <td style="white-space:pre-wrap; word-break:break-word">${row.notes || "-"}</td>
          <td>${row.user || "-"}</td>
        </tr>
      `;
    }).join("");
    renderFsRecordPager();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="11" class="empty" style="color:#ef4444">\u52A0\u8F7D\u5931\u8D25</td></tr>';
  }
}
function renderFsPager() {
  const pager = document.getElementById("fs-pager");
  if (!pager) return;
  const totalPages = Math.ceil(fsTotal / fsPageSize);
  if (totalPages <= 1) {
    pager.style.display = "none";
    return;
  }
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${fsPage <= 1 ? "disabled" : ""} onclick="loadFinishedStock(${fsPage - 1})">\u4E0A\u4E00\u9875</button>
    <span style="font-size:14px; color:#cbd5e1">\u7B2C ${fsPage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${fsPage >= totalPages ? "disabled" : ""} onclick="loadFinishedStock(${fsPage + 1})">\u4E0B\u4E00\u9875</button>
  `;
}
function renderFsRecordPager() {
  const pager = document.getElementById("fs-record-pager");
  if (!pager) return;
  const totalPages = Math.ceil(fsRecordTotal / fsRecordPageSize);
  if (totalPages <= 1) {
    pager.style.display = "none";
    return;
  }
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${fsRecordPage <= 1 ? "disabled" : ""} onclick="loadFinishedStockRecords(${fsRecordPage - 1})">\u4E0A\u4E00\u9875</button>
    <span style="font-size:14px; color:#cbd5e1">\u7B2C ${fsRecordPage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${fsRecordPage >= totalPages ? "disabled" : ""} onclick="loadFinishedStockRecords(${fsRecordPage + 1})">\u4E0B\u4E00\u9875</button>
  `;
}
function renderFsAdjustPager() {
  const pager = document.getElementById("fs-adjust-pager");
  if (!pager) return;
  const totalPages = Math.ceil(fsAdjustTotal / fsPageSize);
  if (totalPages <= 1) {
    pager.style.display = "none";
    return;
  }
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${fsAdjustPage <= 1 ? "disabled" : ""} onclick="loadFinishedStockAdjustments(${fsAdjustPage - 1})">\u4E0A\u4E00\u9875</button>
    <span style="font-size:14px; color:#cbd5e1">\u7B2C ${fsAdjustPage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${fsAdjustPage >= totalPages ? "disabled" : ""} onclick="loadFinishedStockAdjustments(${fsAdjustPage + 1})">\u4E0B\u4E00\u9875</button>
  `;
}
async function loadStockHistory(id) {
  const tbody = document.getElementById("stock-history-rows");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8">\u52A0\u8F7D\u4E2D...</td></tr>';
  try {
    const res = await fetchWithAuth(`/api/inventory/finished/${id}/logs`);
    if (!res.ok) throw new Error("Failed to load logs");
    const logs = await res.json();
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8">\u6682\u65E0\u8BB0\u5F55</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map((log, i) => {
      const color = log.type === "in" ? "#10b981" : log.type === "adjust" ? "#facc15" : "#f97316";
      const typeLabel = log.type === "in" ? "\u5165\u5E93" : log.type === "adjust" ? "\u5E93\u5B58\u8C03\u6574" : "\u9500\u552E\u51FA\u5E93";
      const d = new Date(log.date);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const user = log.user || "-";
      const invoiceNo = log.invoice_no || "-";
      const customer = log.customer || "-";
      const lote = formatFinishedLote(log.lote || "") || log.lote || "-";
      return `
        <tr style="color:${color}">
          <td>${logs.length - i}</td>
          <td>${dateStr}</td>
          <td>${invoiceNo}</td>
          <td>${customer}</td>
          <td>${lote}</td>
          <td>${Number(log.raw_qty || 0) > 0 ? "+" : ""}${Number(log.raw_qty || 0)}</td>
          <td>${typeLabel}</td>
          <td style="white-space:pre-wrap; word-break:break-word">${log.notes || "-"}</td>
          <td>${user}</td>
        </tr>
      `;
    }).join("");
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#ef4444">\u52A0\u8F7D\u5931\u8D25</td></tr>';
  }
}
let fsItems = [];
function escapeHtml(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function openFinishedStockAdjustment(encodedProduct) {
  const p = typeof encodedProduct === "string" ? JSON.parse(decodeURIComponent(encodedProduct)) : encodedProduct;
  if (!p) return;
  fsAdjustState = {
    productId: p.id,
    name: p.name || "",
    batches: mergeFinishedBatches(p.batches)
  };
  const defaultBatch = fsAdjustState.batches[0] || {};
  document.getElementById("fs-adjust-product-id").value = p.id;
  document.getElementById("fs-adjust-notes").value = "";
  document.getElementById("fs-adjust-tbody").innerHTML = `
    <tr>
      <td>${escapeHtml(p.name || "")}</td>
      <td><input id="fs-adjust-qty" type="number" step="0.01" style="width:100%" placeholder="\u53EF\u586B\u6B63\u8D1F\u6570"></td>
      <td>${fsAdjustState.batches.length ? `
        <select id="fs-adjust-lote" style="width:100%">
          ${fsAdjustState.batches.map((b) => `<option value="${escapeHtml(b.lote || "")}" ${String(b.lote || "") === String(defaultBatch.lote || "") ? "selected" : ""}>${escapeHtml(`${formatFinishedLote(b.lote)} / \u5E93\u5B58:${b.qty}${b.expiry ? ` / \u5230\u671F:${b.expiry}` : ""}`)}</option>`).join("")}
        </select>
      ` : `
        <input id="fs-adjust-lote" type="text" value="" style="width:100%" placeholder="\u8F93\u5165\u6279\u6B21">
      `}</td>
      <td><input id="fs-adjust-expiry" type="date" value="${escapeHtml(defaultBatch.expiry || "")}" style="width:100%"></td>
    </tr>
  `;
  const loteInput = document.getElementById("fs-adjust-lote");
  loteInput == null ? void 0 : loteInput.addEventListener("change", () => {
    if (!(fsAdjustState == null ? void 0 : fsAdjustState.batches)) return;
    const matched = fsAdjustState.batches.find((b) => String(b.lote || "").trim() === loteInput.value.trim());
    if (matched) document.getElementById("fs-adjust-expiry").value = matched.expiry || "";
  });
  document.getElementById("fs-adjust-modal").style.display = "flex";
}
window.openFinishedStockAdjustment = openFinishedStockAdjustment;
async function saveFinishedStockAdjustment() {
  const productId = Number(document.getElementById("fs-adjust-product-id").value || 0);
  const qty = Number(document.getElementById("fs-adjust-qty").value || 0);
  const lote = (document.getElementById("fs-adjust-lote").value || "").trim();
  const expiry = (document.getElementById("fs-adjust-expiry").value || "").trim();
  const notes = (document.getElementById("fs-adjust-notes").value || "").trim();
  if (!productId || !Number.isFinite(qty) || qty === 0) return alert("\u8BF7\u586B\u5199\u6709\u6548\u6570\u91CF");
  if (!lote) return alert("\u8BF7\u9009\u62E9\u6216\u8F93\u5165Lote");
  if (!notes) return alert("\u8BF7\u586B\u5199\u5907\u6CE8");
  const res = await fetchWithAuth("/api/inventory/finished/adjust", {
    method: "PUT",
    body: JSON.stringify({ productId, qty, lote, expiry, notes })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(
      err.error === "bad_request" ? "\u8BF7\u586B\u5199\u5B8C\u6574\u8C03\u6574\u4FE1\u606F" : err.error === "not_found" ? "\u5546\u54C1\u4E0D\u5B58\u5728" : err.error === "batch_not_found" ? "\u6240\u9009Lote\u4E0D\u5B58\u5728" : err.error === "insufficient_batch_stock" ? `\u6240\u9009Lote\u5E93\u5B58\u4E0D\u8DB3\uFF0C\u5F53\u524D\u53EF\u8C03\u6574 ${Number(err.availableQty || 0)}` : "\u4FDD\u5B58\u5931\u8D25"
    );
  }
  clearInvoiceLoteCaches({ productId });
  document.getElementById("fs-adjust-modal").style.display = "none";
  if (fsCurrentTab === "adjust") loadFinishedStockAdjustments(fsAdjustPage);
  loadFinishedStock(fsPage);
  loadFinishedStockRecords(1);
}
window.saveFinishedStockAdjustment = saveFinishedStockAdjustment;
function openFinishedStockModal(resetItems = true) {
  const m = document.getElementById("fs-add-modal");
  if (m) {
    m.style.display = "flex";
    if (resetItems) fsItems = [];
    renderFsItems();
  }
}
function closeFinishedStockModal(resetItems = true) {
  const m = document.getElementById("fs-add-modal");
  if (m) m.style.display = "none";
  if (resetItems) {
    fsItems = [];
    renderFsItems();
  }
  window.onProdSelect = null;
  window.onProdSelectDone = null;
  if (prodSelModal) prodSelModal.style.display = "none";
}
window.closeFinishedStockModal = closeFinishedStockModal;
function startFinishedStockAdd() {
  fsItems = [];
  renderFsItems();
  openFsProdSelector();
}
window.startFinishedStockAdd = startFinishedStockAdd;
function normalizeFinishedStockLoteInput(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { raw: "", display: "" };
  const ymdMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    return { raw, display: formatDisplayDate(raw) || raw };
  }
  const dmyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) {
    const normalized = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    return { raw: normalized, display: raw };
  }
  return { raw, display: raw };
}
function renderFsItems() {
  const tbody = document.getElementById("fs-items-tbody");
  if (!tbody) return;
  if (fsItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">\u8BF7\u5148\u9009\u62E9\u5546\u54C1</td></tr>';
    return;
  }
  tbody.innerHTML = fsItems.map((item, idx) => {
    const loteInput = normalizeFinishedStockLoteInput(item.lote || "");
    return `
    <tr>
      <td>${item.name}</td>
      <td><input type="number" class="fs-item-qty" data-idx="${idx}" value="${item.qty || ""}" style="width:100%" placeholder="\u6570\u91CF"></td>
      <td>
        <div style="display:flex; align-items:center; gap:4px">
          <input type="text" class="fs-item-lote" data-idx="${idx}" data-raw-value="${escapeHtml(loteInput.raw)}" value="${escapeHtml(loteInput.display)}" style="width:100%; flex:1" placeholder="\u8F93\u5165\u6279\u6B21\u6216\u9009\u62E9\u65E5\u671F" onchange="const normalized=normalizeFinishedStockLoteInput(this.value); this.value=normalized.display; this.dataset.rawValue=normalized.raw; updateFsExpiry(${idx}, normalized.raw)">
          <div style="position:relative; width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; border:1px solid #233048; border-radius:8px; background:#0b1524">
            <span style="font-size:18px; line-height:1">\u{1F4C5}</span>
            <input type="date" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer" onchange="const el=document.querySelector('.fs-item-lote[data-idx=\\'${idx}\\']'); const normalized=normalizeFinishedStockLoteInput(this.value); if (el) { el.value=normalized.display; el.dataset.rawValue=normalized.raw; } updateFsExpiry(${idx}, normalized.raw)">
          </div>
        </div>
      </td>
      <td><input type="date" class="fs-item-expiry" data-idx="${idx}" value="${item.expiry || ""}" style="width:100%"></td>
      <td style="text-align:center"><button class="btn-sm btn-red" onclick="removeFsItem(${idx})">\u5220\u9664</button></td>
    </tr>
  `;
  }).join("");
}
function updateFsExpiry(idx, loteDateStr) {
  document.querySelectorAll(".fs-item-qty").forEach((el) => {
    if (fsItems[el.dataset.idx]) fsItems[el.dataset.idx].qty = el.value;
  });
  fsItems[idx].lote = loteDateStr;
  if (!loteDateStr) return;
  const parts = loteDateStr.split("-");
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    if (!isNaN(d.getTime())) {
      d.setMonth(d.getMonth() + 6);
      const expYear = d.getFullYear();
      const expMonth = String(d.getMonth() + 1).padStart(2, "0");
      const expDay = String(d.getDate()).padStart(2, "0");
      fsItems[idx].expiry = `${expYear}-${expMonth}-${expDay}`;
      renderFsItems();
      return;
    }
  }
}
function removeFsItem(idx) {
  fsItems.splice(idx, 1);
  renderFsItems();
}
function openFsProdSelector() {
  const m = document.getElementById("prod-selector-modal");
  if (m) {
    window.selectedProducts.clear();
    window.onProdSelectDone = null;
    m.style.display = "flex";
    prodSelSearch.value = "";
    loadProductSelector(1);
    window.onProdSelect = function(prod, isBatch) {
      if (!fsItems.some((i) => i.productId === prod.id)) {
        const now = /* @__PURE__ */ new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const loteDateStr = `${year}-${month}-${day}`;
        now.setMonth(now.getMonth() + 6);
        const expYear = now.getFullYear();
        const expMonth = String(now.getMonth() + 1).padStart(2, "0");
        const expDay = String(now.getDate()).padStart(2, "0");
        const expiryDateStr = `${expYear}-${expMonth}-${expDay}`;
        fsItems.push({
          productId: prod.id,
          name: prod.name,
          qty: "",
          lote: loteDateStr,
          expiry: expiryDateStr
        });
        renderFsItems();
      }
      if (!isBatch) {
        m.style.display = "none";
        openFinishedStockModal(false);
      }
    };
    window.onProdSelectDone = function() {
      openFinishedStockModal(false);
    };
  }
}
async function saveFinishedStock() {
  if (fsItems.length === 0) return alert("\u8BF7\u9009\u62E9\u5546\u54C1");
  document.querySelectorAll(".fs-item-qty").forEach((el) => {
    if (fsItems[el.dataset.idx]) fsItems[el.dataset.idx].qty = el.value;
  });
  document.querySelectorAll(".fs-item-lote").forEach((el) => {
    if (fsItems[el.dataset.idx]) fsItems[el.dataset.idx].lote = el.dataset.rawValue || el.value;
  });
  document.querySelectorAll(".fs-item-expiry").forEach((el) => {
    if (fsItems[el.dataset.idx]) fsItems[el.dataset.idx].expiry = el.value;
  });
  const invalid = fsItems.find((i) => !i.qty || Number(i.qty) <= 0 || !i.lote || !i.expiry);
  if (invalid) {
    return alert(`\u8BF7\u586B\u5199\u5B8C\u6574\u7684\u6570\u91CF\u3001Lote\u548C\u8FC7\u671F\u65F6\u95F4 (${invalid.name})`);
  }
  await fetchWithAuth("/api/inventory/finished", {
    method: "POST",
    body: JSON.stringify({ items: fsItems })
  });
  clearInvoiceLoteCaches();
  closeFinishedStockModal(true);
  loadFinishedStock();
}
function getDefaultBatchDates() {
  const loteDate = /* @__PURE__ */ new Date();
  const lote = `${loteDate.getFullYear()}-${String(loteDate.getMonth() + 1).padStart(2, "0")}-${String(loteDate.getDate()).padStart(2, "0")}`;
  const expiryDate = new Date(loteDate.getTime());
  expiryDate.setMonth(expiryDate.getMonth() + 6);
  const expiry = `${expiryDate.getFullYear()}-${String(expiryDate.getMonth() + 1).padStart(2, "0")}-${String(expiryDate.getDate()).padStart(2, "0")}`;
  return { lote, expiry };
}
function normalizeRawStockLoteInput(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const displayMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2]}-${displayMatch[1]}`;
  return raw;
}
function getRawStockLoteDisplay(value = "") {
  const normalized = normalizeRawStockLoteInput(value);
  return formatDisplayDate(normalized) || normalized;
}
function renderRawStockMerchantSelection() {
  if (!rsMerchantNameInput) return;
  rsMerchantNameInput.value = String((rsSelectedMerchant == null ? void 0 : rsSelectedMerchant.name) || "").trim();
}
function populateRawMaterialCategorySelect(select, value = "其它") {
  if (!select) return;
  const selected = RAW_MATERIAL_CATEGORIES.includes(String(value || "").trim()) ? String(value).trim() : "其它";
  select.innerHTML = RAW_MATERIAL_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  select.value = selected;
}
function syncRawMaterialCategorySelectors() {
  populateRawMaterialCategorySelect(rsCategorySelect, rsSelectedCategory);
  populateRawMaterialCategorySelect(rsMaterialCategorySelect, rsMaterialCategorySelect?.value || "其它");
}
function renderRawMaterialMerchantSelection() {
  if (!rsMaterialMerchantNameInput) return;
  rsMaterialMerchantNameInput.value = String((rsSelectedMerchant == null ? void 0 : rsSelectedMerchant.name) || "").trim();
}
function syncSelectedRawMaterialsFromItems() {
  window.selectedRawMaterials = new Map(
    rsAddItems.filter((item) => Number((item == null ? void 0 : item.materialId) || 0) > 0).map((item) => [Number(item.materialId), { id: Number(item.materialId), name: item.name || "", image: item.image || "", stock: item.stock || 0, category: item.category || rsSelectedCategory || "其它" }])
  );
}
function renderRawStockItems() {
  const tbody = document.getElementById("rs-items-tbody");
  if (!tbody) return;
  if (rsAddItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">\u8BF7\u5148\u9009\u62E9\u539F\u6750\u6599</td></tr>';
    return;
  }
  tbody.innerHTML = rsAddItems.map((item, idx) => `
    <tr>
      <td>${escapeHtml(item.name || "")}</td>
      <td>${escapeHtml(item.category || rsSelectedCategory || "其它")}</td>
      <td><input type="number" class="rs-item-qty" data-idx="${idx}" value="${item.qty || ""}" style="width:100%" placeholder="\u6570\u91CF"></td>
      <td>
        <div style="display:flex; align-items:center; gap:4px">
          <input type="text" class="rs-item-lote" data-idx="${idx}" value="${escapeHtml(getRawStockLoteDisplay(item.lote || ""))}" style="width:100%; flex:1" placeholder="\u8F93\u5165\u6279\u6B21\u6216\u9009\u62E9\u65E5\u671F" onchange="updateRsExpiry(${idx}, this.value)">
          <div style="position:relative; width:24px; height:24px; display:flex; align-items:center; justify-content:center; cursor:pointer">
            <span style="font-size:14px">\u{1F4C5}</span>
            <input type="date" value="${escapeHtml(normalizeRawStockLoteInput(item.lote || ""))}" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer" onchange="const el=document.querySelector('.rs-item-lote[data-idx=\\'${idx}\\']'); if (el) el.value=(formatDisplayDate(this.value) || this.value); updateRsExpiry(${idx}, this.value)">
          </div>
        </div>
      </td>
      <td><input type="date" class="rs-item-expiry" data-idx="${idx}" value="${item.expiry || ""}" style="width:100%"></td>
      <td style="text-align:center"><button class="btn-sm btn-red" onclick="removeRsItem(${idx})">\u5220\u9664</button></td>
    </tr>
  `).join("");
}
function openRawStockModal(resetItems = true) {
  const modal = document.getElementById("rs-add-modal");
  if (!modal) return;
  if (resetItems) rsAddItems = [];
  syncRawMaterialCategorySelectors();
  renderRawStockItems();
  renderRawStockMerchantSelection();
  modal.style.display = "flex";
}
window.openRawStockModal = openRawStockModal;
function startRawStockAdd() {
  rsAddItems = [];
  rsSelectedMerchant = { id: 0, name: "" };
  rsSelectedCategory = "其它";
  rsPendingMerchantSelection = { id: 0, name: "" };
  renderRawStockItems();
  renderRawStockMerchantSelection();
  syncRawMaterialCategorySelectors();
  openRawMaterialSelector();
}
window.startRawStockAdd = startRawStockAdd;
function updateRsExpiry(idx, loteDateStr) {
  document.querySelectorAll(".rs-item-qty").forEach((el) => {
    if (rsAddItems[el.dataset.idx]) rsAddItems[el.dataset.idx].qty = el.value;
  });
  const normalizedLote = normalizeRawStockLoteInput(loteDateStr);
  rsAddItems[idx].lote = normalizedLote;
  const loteInput = document.querySelector(`.rs-item-lote[data-idx="${idx}"]`);
  if (loteInput) loteInput.value = getRawStockLoteDisplay(normalizedLote);
  if (!normalizedLote) return;
  const parts = normalizedLote.split("-");
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    if (!isNaN(d.getTime())) {
      d.setMonth(d.getMonth() + 6);
      rsAddItems[idx].expiry = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  var _a2;
  rsSelPage = page;
  if (!rsSelList) return;
  rsSelList.innerHTML = '<div style="padding:16px; color:#94a3b8">\u52A0\u8F7D\u4E2D...</div>';
  const q = ((_a2 = rsSelSearch == null ? void 0 : rsSelSearch.value) == null ? void 0 : _a2.trim()) || "";
  const singleSelectMode = productionPlanMaterialSelectTargetId > 0 || productRawMaterialSelectActive;
  const res = await fetchWithAuth(`/api/inventory/raw?page=${rsSelPage}&size=${rsSelPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) {
    rsSelList.innerHTML = '<div style="padding:16px; color:#ef4444">\u52A0\u8F7D\u5931\u8D25</div>';
    return;
  }
  const data = await res.json();
  const list = data.list || [];
  rsSelTotal = Number(data.total || 0);
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.innerHTML = `
    <thead>
      <tr style="border-bottom:1px solid #334155; color:#94a3b8; font-size:12px; text-align:left">
        <th style="padding:8px; width:40px; text-align:center">${singleSelectMode ? "" : '<input type="checkbox" id="rs-sel-select-all" onclick="toggleAllRawMaterialSelection(this)">'}</th>
        <th style="padding:8px; width:72px">\u56FE\u7247</th>
        <th style="padding:8px">\u540D\u79F0</th>
        <th style="padding:8px; text-align:right">\u5E93\u5B58</th>
      </tr>
    </thead>
    <tbody id="rs-sel-tbody"></tbody>
  `;
  const tbody = table.querySelector("tbody");
  list.forEach((m) => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #1e293b";
    tr.style.cursor = "pointer";
    tr.onmouseover = () => tr.style.background = "#1e293b";
    tr.onmouseout = () => tr.style.background = "transparent";
    const isSelected = window.selectedRawMaterials && window.selectedRawMaterials.has(m.id);
    tr.dataset.material = JSON.stringify(m);
    tr.innerHTML = `
      <td style="padding:8px; text-align:center">
        <input type="${singleSelectMode ? "radio" : "checkbox"}" name="rs-sel-choice" class="rs-sel-checkbox" value="${m.id}" ${isSelected ? "checked" : ""} onclick="event.stopPropagation(); toggleRawMaterialSelection(${m.id})">
      </td>
      <td style="padding:8px">
        ${m.image ? `<img src="${m.image}" style="width:48px; height:48px; object-fit:cover; border-radius:4px; border:1px solid #334155">` : '<div style="width:48px; height:48px; background:#0f172a; border-radius:4px; border:1px solid #334155"></div>'}
      </td>
      <td style="padding:8px; color:#e2e8f0; font-weight:500">${escapeHtml(m.name || "")}</td>
      <td style="padding:8px; text-align:right; color:#64748b">${Number(m.stock || 0)}</td>
    `;
    tr.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() !== "input") {
        const cb = tr.querySelector(".rs-sel-checkbox");
        cb.checked = !cb.checked;
        toggleRawMaterialSelection(m.id, m);
      }
    });
    tbody.appendChild(tr);
  });
  rsSelList.innerHTML = "";
  rsSelList.appendChild(table);
  const totalPages = Math.ceil(rsSelTotal / rsSelPageSize);
  if (totalPages > 1) {
    const pager = document.createElement("div");
    pager.style.display = "flex";
    pager.style.justifyContent = "center";
    pager.style.gap = "12px";
    pager.style.alignItems = "center";
    pager.style.padding = "12px 0";
    pager.style.marginTop = "12px";
    pager.style.borderTop = "1px solid #334155";
    pager.innerHTML = `
      <button class="btn-secondary" style="padding:4px 12px" ${rsSelPage <= 1 ? "disabled" : ""} onclick="loadRawMaterialSelector(${rsSelPage - 1})">\u4E0A\u4E00\u9875</button>
      <span style="color:#cbd5e1; font-size:13px">\u7B2C ${rsSelPage} / ${totalPages} \u9875</span>
      <button class="btn-secondary" style="padding:4px 12px" ${rsSelPage >= totalPages ? "disabled" : ""} onclick="loadRawMaterialSelector(${rsSelPage + 1})">\u4E0B\u4E00\u9875</button>
    `;
    rsSelList.appendChild(pager);
  }
  updateRawMaterialSelectAll();
}
window.loadRawMaterialSelector = loadRawMaterialSelector;
window.selectedRawMaterials = /* @__PURE__ */ new Map();
window.toggleRawMaterialSelection = function(id, materialObj) {
  const singleSelectMode = productionPlanMaterialSelectTargetId > 0 || productRawMaterialSelectActive;
  if (!materialObj) {
    const cb = document.querySelector(`.rs-sel-checkbox[value="${id}"]`);
    if (cb && cb.closest("tr")) {
      materialObj = JSON.parse(cb.closest("tr").dataset.material);
      if (!cb.checked) window.selectedRawMaterials.delete(id);
      else {
        if (singleSelectMode) window.selectedRawMaterials = /* @__PURE__ */ new Map();
        window.selectedRawMaterials.set(id, materialObj);
      }
    }
  } else {
    const cb = document.querySelector(`.rs-sel-checkbox[value="${id}"]`);
    if (cb) {
      if (cb.checked) {
        if (singleSelectMode) {
          window.selectedRawMaterials = /* @__PURE__ */ new Map([[id, materialObj]]);
          document.querySelectorAll(".rs-sel-checkbox").forEach((el) => {
            el.checked = String(el.value) === String(id);
          });
        } else {
          window.selectedRawMaterials.set(id, materialObj);
        }
      } else window.selectedRawMaterials.delete(id);
    }
  }
  updateRawMaterialSelectAll();
};
window.toggleAllRawMaterialSelection = function(el) {
  const checkboxes = document.querySelectorAll(".rs-sel-checkbox");
  checkboxes.forEach((cb) => {
    cb.checked = el.checked;
    const id = parseInt(cb.value, 10);
    const materialObj = JSON.parse(cb.closest("tr").dataset.material);
    if (el.checked) window.selectedRawMaterials.set(id, materialObj);
    else window.selectedRawMaterials.delete(id);
  });
};
function updateRawMaterialSelectAll() {
  const selectAllCb = document.getElementById("rs-sel-select-all");
  const checkboxes = document.querySelectorAll(".rs-sel-checkbox");
  if (productionPlanMaterialSelectTargetId > 0 || productRawMaterialSelectActive) return;
  if (selectAllCb && checkboxes.length > 0) {
    selectAllCb.checked = Array.from(checkboxes).every((cb) => cb.checked);
  }
}
function openRawMaterialSelector() {
  if (!rsSelModal) return;
  productRawMaterialSelectActive = false;
  productionPlanMaterialSelectTargetId = 0;
  syncSelectedRawMaterialsFromItems();
  if (rsSelTitle) rsSelTitle.textContent = "\u9009\u62E9\u539F\u6750\u6599";
  if (rsSelConfirm) rsSelConfirm.textContent = "\u786E\u8BA4\u6DFB\u52A0";
  rsSelModal.style.display = "flex";
  if (rsSelSearch) rsSelSearch.value = "";
  loadRawMaterialSelector(1);
}
window.openRawMaterialSelector = openRawMaterialSelector;
function renderRawStockMerchantList(keyword = "") {
  if (!rsMerchantList) return;
  const kw = String(keyword || "").trim().toLowerCase();
  const source = Array.isArray(contactsData.merchants) ? contactsData.merchants : [];
  const list = kw ? source.filter((item) => {
    const haystack = [item.name, item.company, item.contact, item.phone].map((v) => String(v || "").toLowerCase()).join(" ");
    return haystack.includes(kw);
  }) : source.slice();
  rsMerchantList.innerHTML = "";
  if (list.length === 0) {
    rsMerchantList.innerHTML = '<div style="padding:16px; color:#94a3b8">暂无匹配商家</div>';
    return;
  }
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.innerHTML = `
    <thead>
      <tr style="border-bottom:1px solid #334155; color:#94a3b8; font-size:12px; text-align:left">
        <th style="padding:8px; width:44px; text-align:center"></th>
        <th style="padding:8px">商家名称</th>
        <th style="padding:8px">公司名称</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  list.forEach((item) => {
    const merchantId = Number(item.id || 0);
    const merchantName = String(item.name || "").trim();
    const merchantCompany = String(item.company || "").trim();
    const checked = Number((rsPendingMerchantSelection == null ? void 0 : rsPendingMerchantSelection.id) || 0) === merchantId;
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #1e293b";
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td style="padding:8px; text-align:center"><input type="radio" name="rs-merchant-choice" ${checked ? "checked" : ""}></td>
      <td style="padding:8px; color:#e2e8f0; font-weight:500">${escapeHtml(merchantName || "-")}</td>
      <td style="padding:8px; color:#94a3b8">${escapeHtml(merchantCompany || "-")}</td>
    `;
    tr.addEventListener("click", () => {
      rsPendingMerchantSelection = { id: merchantId, name: merchantName };
      renderRawStockMerchantList(rsMerchantSearch ? rsMerchantSearch.value : "");
    });
    tbody.appendChild(tr);
  });
  rsMerchantList.appendChild(table);
}
async function openRawStockMerchantSelector() {
  if (!rsMerchantModal) return;
  await apiContactsList("merchants", "", 1, 5000);
  rsPendingMerchantSelection = {
    id: Number((rsSelectedMerchant == null ? void 0 : rsSelectedMerchant.id) || 0),
    name: String((rsSelectedMerchant == null ? void 0 : rsSelectedMerchant.name) || "").trim()
  };
  if (rsMerchantSearch) rsMerchantSearch.value = "";
  renderRawStockMerchantList("");
  rsMerchantModal.style.display = "flex";
  if (rsMerchantSearch) rsMerchantSearch.focus();
}
window.openRawStockMerchantSelector = openRawStockMerchantSelector;
function confirmRawStockMerchantSelection() {
  rsSelectedMerchant = {
    id: Number((rsPendingMerchantSelection == null ? void 0 : rsPendingMerchantSelection.id) || 0),
    name: String((rsPendingMerchantSelection == null ? void 0 : rsPendingMerchantSelection.name) || "").trim()
  };
  renderRawStockMerchantSelection();
  renderRawMaterialMerchantSelection();
  if (rsMerchantModal) rsMerchantModal.style.display = "none";
}
window.confirmRawStockMerchantSelection = confirmRawStockMerchantSelection;
if (rsMerchantSearch) {
  rsMerchantSearch.addEventListener("input", () => renderRawStockMerchantList(rsMerchantSearch.value));
}
const rsMerchantClose = document.getElementById("rs-merchant-close");
if (rsMerchantClose) {
  rsMerchantClose.addEventListener("click", () => {
    if (rsMerchantModal) rsMerchantModal.style.display = "none";
  });
}
window.confirmRawMaterialSelection = function() {
  var _a2, _b2, _c2, _d;
  if (productRawMaterialSelectActive) {
    const selected = Array.from(((_b2 = (_a2 = window.selectedRawMaterials) == null ? void 0 : _a2.values) == null ? void 0 : _b2.call(_a2)) || []);
    if (!selected.length) {
      showAppToast("\u8BF7\u5148\u9009\u62E9\u539F\u6750\u6599");
      return;
    }
    const selectedMaterial = selected[0];
    setProductRawMaterialSelection({
      id: Number(selectedMaterial.id || 0),
      name: String(selectedMaterial.name || "").trim()
    });
    productRawMaterialSelectActive = false;
    if (rsSelSearch) rsSelSearch.value = "";
    if (rsSelTitle) rsSelTitle.textContent = "\u9009\u62E9\u539F\u6750\u6599";
    if (rsSelConfirm) rsSelConfirm.textContent = "\u786E\u8BA4\u6DFB\u52A0";
    if (rsSelModal) rsSelModal.style.display = "none";
    return;
  }
  if (productionPlanMaterialSelectTargetId > 0) {
    const selected = Array.from(((_d = (_c2 = window.selectedRawMaterials) == null ? void 0 : _c2.values) == null ? void 0 : _d.call(_c2)) || []);
    if (!selected.length) {
      showAppToast("\u8BF7\u5148\u9009\u62E9\u539F\u6599\u540D\u79F0");
      return;
    }
    const selectedMaterial = selected[0];
    const targetId = productionPlanMaterialSelectTargetId;
    if (rsSelModal) rsSelModal.style.display = "none";
    productionPlanMaterialSelectTargetId = 0;
    if (rsSelSearch) rsSelSearch.value = "";
    updateProductionPlanInlineFields(targetId, { material_name: String(selectedMaterial.name || "").trim() }, "\u539F\u6599\u540D\u79F0\u5DF2\u66F4\u65B0");
    return;
  }
  if (!window.selectedRawMaterials || window.selectedRawMaterials.size === 0) {
    showAppToast("\u8BF7\u5148\u9009\u62E9\u81F3\u5C11\u4E00\u4E2A\u539F\u6750\u6599");
    return;
  }
  const defaults = getDefaultBatchDates();
  Array.from(window.selectedRawMaterials.values()).forEach((m) => {
    if (!rsAddItems.some((item) => Number(item.materialId) === Number(m.id))) {
      rsAddItems.push({
        materialId: Number(m.id),
        name: m.name || "",
        image: m.image || "",
        stock: Number(m.stock || 0),
        category: m.category || rsSelectedCategory || "其它",
        qty: "",
        lote: defaults.lote,
        expiry: defaults.expiry
      });
    }
  });
  if (rsSelModal) rsSelModal.style.display = "none";
  openRawStockModal(false);
};
if (rsSelSearch) rsSelSearch.addEventListener("input", () => loadRawMaterialSelector(1));
const rsSelClose = document.getElementById("rs-sel-close");
if (rsSelClose) {
  rsSelClose.addEventListener("click", () => {
    productionPlanMaterialSelectTargetId = 0;
    productRawMaterialSelectActive = false;
    if (rsSelTitle) rsSelTitle.textContent = "\u9009\u62E9\u539F\u6750\u6599";
    if (rsSelConfirm) rsSelConfirm.textContent = "\u786E\u8BA4\u6DFB\u52A0";
    if (rsSelModal) rsSelModal.style.display = "none";
  });
}
function buildRawBatches(batches) {
  if (!Array.isArray(batches)) return [];
  return batches.map((b) => ({
    qty: Number((b == null ? void 0 : b.qty) || 0),
    expiry: String((b == null ? void 0 : b.expiry) || "").trim(),
    lote: String((b == null ? void 0 : b.lote) || "").trim()
  })).filter((b) => b.qty > 0).sort((a, b) => {
    const expCmp = toSortableDateValue(a.expiry || "").localeCompare(toSortableDateValue(b.expiry || ""));
    if (expCmp !== 0) return expCmp;
    return (a.lote || "").localeCompare(b.lote || "");
  });
}
function renderRawLoteLines(batches) {
  const displayBatches = buildRawBatches(batches);
  if (!displayBatches.length) return "";
  const loteLines = displayBatches
    .map((b) => formatDisplayDate(b.lote || "") || "")
    .filter(Boolean);
  if (!loteLines.length) return "";
  return `<div style="display:flex;flex-direction:column;gap:4px">${loteLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>`;
}
function renderRawExpiryLines(batches) {
  const displayBatches = buildRawBatches(batches);
  if (!displayBatches.length) return "-";
  return `<div style="display:flex;flex-direction:column;gap:4px">${displayBatches.map((b) => `<div>${escapeHtml(formatInventoryDisplayDate(b.expiry || "") || "-")}</div>`).join("")}</div>`;
}
function formatRawRecordType(type) {
  if (type === "in") return "\u5165\u5E93";
  if (type === "adjust") return "\u5E93\u5B58\u8C03\u6574";
  if (type === "out") return "\u51FA\u5E93";
  return "\u51FA\u5E93";
}
function syncRawMaterialOptions(list = []) {
  rsMaterialOptions = list.map((x) => ({
    id: x.id,
    name: String(x.name || "").trim(),
    image: String(x.image || "").trim()
  })).filter((x) => x.name);
  const datalist = document.getElementById("rs-name-options");
  if (datalist) {
    const uniqNames = Array.from(new Set(rsMaterialOptions.map((x) => x.name)));
    datalist.innerHTML = uniqNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  }
}
function switchRawStockTab(tab, btn) {
  rsCurrentTab = ["stock", "audit", "records", "adjust", "audit-results"].includes(tab) ? tab : "stock";
  const stockPanel = document.getElementById("rs-stock-panel");
  const auditPanel = document.getElementById("rs-audit-panel");
  const recordPanel = document.getElementById("rs-records-panel");
  const adjustPanel = document.getElementById("rs-adjust-panel");
  const auditResultsPanel = document.getElementById("rs-audit-results-panel");
  const toolbar = document.getElementById("rs-stock-toolbar");
  const addNameBtn = document.getElementById("rs-add-name-btn");
  const addStockBtn = document.getElementById("rs-add-stock-btn");
  if (rsRecordToolbar) rsRecordToolbar.style.display = rsCurrentTab === "records" ? "flex" : "none";
  const auditToolbar = document.getElementById("rs-audit-toolbar");
  if (auditToolbar) auditToolbar.style.display = rsCurrentTab === "audit" ? "flex" : "none";
  if (stockPanel) stockPanel.style.display = rsCurrentTab === "stock" ? "block" : "none";
  if (auditPanel) auditPanel.style.display = rsCurrentTab === "audit" ? "block" : "none";
  if (recordPanel) recordPanel.style.display = rsCurrentTab === "records" ? "block" : "none";
  if (adjustPanel) adjustPanel.style.display = rsCurrentTab === "adjust" ? "block" : "none";
  if (auditResultsPanel) auditResultsPanel.style.display = rsCurrentTab === "audit-results" ? "block" : "none";
  if (toolbar) toolbar.style.display = "flex";
  if (addNameBtn) addNameBtn.style.display = rsCurrentTab === "stock" ? "inline-flex" : "none";
  if (addStockBtn) addStockBtn.style.display = rsCurrentTab === "stock" ? "inline-flex" : "none";
  document.querySelectorAll("#page-raw-stock .tab").forEach((el) => el.classList.remove("active"));
  if (btn) btn.classList.add("active");
  else {
    const activeBtn = document.getElementById(rsCurrentTab === "stock" ? "rs-tab-stock" : rsCurrentTab === "audit" ? "rs-tab-audit" : rsCurrentTab === "records" ? "rs-tab-records" : rsCurrentTab === "adjust" ? "rs-tab-adjust" : "rs-tab-audit-results");
    if (activeBtn) activeBtn.classList.add("active");
  }
  if (rsCurrentTab === "stock") loadRawStock(1);
  else if (rsCurrentTab === "audit") loadRawStockAudit();
  else if (rsCurrentTab === "records") loadRawStockRecords(1);
  else if (rsCurrentTab === "adjust") loadRawStockAdjustments(1);
  else loadRawStockAuditResults(1);
}
window.switchRawStockTab = switchRawStockTab;
function handleRsSearchInput() {
  if (rsCurrentTab === "audit") loadRawStockAudit();
  else if (rsCurrentTab === "audit-results") loadRawStockAuditResults(1);
  else if (rsCurrentTab === "records") loadRawStockRecords(1);
  else if (rsCurrentTab === "adjust") loadRawStockAdjustments(1);
  else loadRawStock(1);
}
window.handleRsSearchInput = handleRsSearchInput;
function populateRawAuditCategorySelect() {
  const select = document.getElementById("rs-audit-category");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">全部分类</option>' + RAW_MATERIAL_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  select.value = RAW_MATERIAL_CATEGORIES.includes(current) ? current : "";
}
async function loadRawStockAudit() {
  const tbody = document.getElementById("raw-stock-audit-rows");
  if (!tbody) return;
  populateRawAuditCategorySelect();
  tbody.innerHTML = '<tr><td colspan="6" class="empty">加载中...</td></tr>';
  const category = String(document.getElementById("rs-audit-category")?.value || "").trim();
  const q = String(document.getElementById("rs-search")?.value || "").trim();
  const res = await fetchWithAuth(`/api/inventory/raw?page=1&size=5000&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty" style="color:#ef4444">加载失败</td></tr>';
    return;
  }
  const data = await res.json();
  const list = (Array.isArray(data.list) ? data.list : []).filter((item) => !category || String(item.category || "其它") === category);
  rsAuditItems = list;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无符合条件的原材料</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.name || "")}</td>
      <td>${escapeHtml(item.category || "其它")}</td>
      <td>${Number(item.pre_stock || 0)}</td>
      <td>${Number(item.stock || 0)}</td>
      <td><input class="rs-audit-qty" data-material-id="${Number(item.id)}" type="number" min="0" step="0.01" value="" onclick="this.select()" onfocus="this.select()" style="width:140px"></td>
    </tr>
  `).join("");
}
window.loadRawStockAudit = loadRawStockAudit;
async function submitRawStockAudit() {
  const inputs = Array.from(document.querySelectorAll("#raw-stock-audit-rows .rs-audit-qty"));
  if (!inputs.length) return alert("暂无可盘点的原材料");
  const items = inputs.map((input) => ({
    material_id: Number(input.dataset.materialId || 0),
    counted_stock: Number(input.value),
    hasValue: String(input.value || "").trim() !== ""
  }));
  if (items.some((item) => !item.material_id || !item.hasValue || !Number.isFinite(item.counted_stock) || item.counted_stock < 0)) {
    return alert("请填写正确的实际库存数量");
  }
  items.forEach((item) => delete item.hasValue);
  if (!confirm(`确认提交 ${items.length} 条盘点结果吗？提交后需要审核，审核通过后才会更新现库存。`)) return;
  const res = await fetchWithAuth("/api/inventory/raw/audit-batch", {
    method: "POST",
    body: JSON.stringify({
      items,
      audit_category: String(document.getElementById("rs-audit-category")?.value || "").trim() || "全部类别"
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(err.error === "not_found" ? "原材料不存在" : "盘点提交失败");
  }
  alert("盘点提交成功");
  switchRawStockTab("audit-results");
}
window.submitRawStockAudit = submitRawStockAudit;
async function loadRawStockAuditResults(page = 1) {
  rsAuditResultPage = page;
  const tbody = document.getElementById("raw-stock-audit-result-rows");
  if (!tbody) return;
  const category = String(document.getElementById("rs-audit-category")?.value || "").trim();
  const res = await fetchWithAuth(`/api/inventory/raw/audit-results?page=${page}&size=${rsAuditResultPageSize}&category=${encodeURIComponent(category)}&_t=${Date.now()}`);
  if (!res.ok) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty" style="color:#ef4444">加载失败</td></tr>';
    return;
  }
  const data = await res.json();
  const list = Array.isArray(data.list) ? data.list : [];
  rsAuditResultTotal = Number(data.total || 0);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无盘点记录</td></tr>';
    renderRsAuditResultPager();
    return;
  }
  tbody.innerHTML = list.map((item, index) => {
    const status = item.status === "approved" ? "已审核" : "待审核";
    const statusColor = item.status === "approved" ? "#10b981" : "#f59e0b";
    return `
      <tr>
        <td>${rsAuditResultTotal - (page - 1) * rsAuditResultPageSize - index}</td>
        <td>盘点记录 #${Number(item.id || 0)}　${escapeHtml(formatDisplayDate(Number(item.audited_at || 0)) || "-")}</td>
        <td>${escapeHtml(item.audit_category || item.category_names || "-")}</td>
        <td>${Number(item.item_count || 0)}</td>
        <td style="color:${statusColor}; font-weight:600">${status}</td>
        <td>${escapeHtml(formatDisplayDate(Number(item.audited_at || 0)) || "-")} ${escapeHtml(formatDisplayTime(Number(item.audited_at || 0)) || "")}</td>
        <td>${escapeHtml(item.audited_by || "-")}</td>
        <td>${escapeHtml(item.approved_by || "-")}</td>
        <td style="text-align:center"><button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="location.hash='#raw-stock-audit-detail?id=${Number(item.id || 0)}'">详情</button></td>
      </tr>
    `;
  }).join("");
  renderRsAuditResultPager();
}
window.loadRawStockAuditResults = loadRawStockAuditResults;
async function openRawStockAuditDetail(sessionId) {
  const res = await fetchWithAuth(`/api/inventory/raw/audit-results/${Number(sessionId || 0)}?_t=${Date.now()}`);
  if (!res.ok) return alert("盘点详情加载失败");
  const data = await res.json();
  const session = data.session || {};
  const items = Array.isArray(data.list) ? data.list : [];
  const panel = document.getElementById("rs-audit-detail-panel");
  const tbody = document.getElementById("raw-stock-audit-detail-rows");
  if (!panel || !tbody) return;
  panel.dataset.sessionId = String(session.id || sessionId);
  panel.dataset.status = String(session.status || "pending");
  const auditDate = formatDisplayDate(Number(session.audited_at || 0)) || "-";
  const auditTime = formatDisplayTime(Number(session.audited_at || 0)) || "";
  document.getElementById("rs-audit-detail-title").textContent =
    `盘点记录 #${Number(session.id || sessionId)}　${auditDate} ${auditTime}`.trim();
  document.getElementById("rs-audit-detail-status").textContent = session.status === "approved" ? "已审核，库存已生效" : "待审核";
  const editable = session.status !== "approved";
  document.getElementById("rs-audit-detail-save").style.display = editable ? "inline-flex" : "none";
  document.getElementById("rs-audit-detail-approve").style.display = editable ? "inline-flex" : "none";
  tbody.innerHTML = items.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.material_name || "")}</td>
      <td>${escapeHtml(item.category || "其它")}</td>
      <td>${Number(item.pre_stock || 0)}</td>
      <td>${Number(item.previous_stock || 0)}</td>
      <td>${editable
        ? `<input class="rs-audit-detail-qty" data-item-id="${Number(item.id)}" data-pre-stock="${Number(item.pre_stock || 0)}" type="number" min="0" step="0.01" value="${Number(item.counted_stock || 0)}" onclick="this.select()" onfocus="this.select()" oninput="updateRawStockAuditPurchaseNeed(this)" style="width:130px">`
        : Number(item.counted_stock || 0)}</td>
      <td>${Number(item.difference || 0)}</td>
      <td class="rs-audit-purchase-need">${Number(item.pre_stock || 0) - Number(item.counted_stock || 0)}</td>
    </tr>
  `).join("");
  panel.style.display = "block";
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.openRawStockAuditDetail = openRawStockAuditDetail;
function updateRawStockAuditPurchaseNeed(input) {
  const row = input?.closest("tr");
  const target = row?.querySelector(".rs-audit-purchase-need");
  if (!target) return;
  const preStock = Number(input.dataset.preStock || 0);
  const actualStock = Number(input.value || 0);
  target.textContent = String(preStock - actualStock);
}
window.updateRawStockAuditPurchaseNeed = updateRawStockAuditPurchaseNeed;
function printRawStockAuditDetail() {
  const panel = document.getElementById("rs-audit-detail-panel");
  if (!panel) return;
  const table = panel.querySelector("table");
  if (!table) return alert("暂无盘点商品可打印");
  const printableTable = table.cloneNode(true);
  printableTable.querySelectorAll("input").forEach((input) => {
    const value = input.value || "";
    const cell = input.parentElement;
    if (cell) cell.textContent = value;
  });
  const title = document.getElementById("rs-audit-detail-title")?.textContent || "盘点详情";
  const status = document.getElementById("rs-audit-detail-status")?.textContent || "";
  let printWin;
  try {
    printWin = window.open("", "_blank", "width=1100,height=800");
  } catch (error) {
    printWin = null;
  }
  if (!printWin || printWin.closed) return alert("请允许浏览器打开打印窗口");
  printWin.document.open();
  printWin.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; font-family: Arial, "Microsoft YaHei", sans-serif; }
    h1 { margin: 0 0 6px; font-size: 20px; }
    .status { margin-bottom: 14px; color: #4b5563; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #9ca3af; padding: 7px 8px; text-align: left; }
    th { background: #e5e7eb; font-weight: 600; }
  </style></head><body><h1>${escapeHtml(title)}</h1><div class="status">${escapeHtml(status)}</div>${printableTable.outerHTML}<script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};<\/script></body></html>`);
  printWin.document.close();
}
window.printRawStockAuditDetail = printRawStockAuditDetail;
function closeRawStockAuditDetail() {
  const panel = document.getElementById("rs-audit-detail-panel");
  if (panel) panel.style.display = "none";
}
window.closeRawStockAuditDetail = closeRawStockAuditDetail;
async function saveRawStockAuditDetail() {
  const panel = document.getElementById("rs-audit-detail-panel");
  if (!panel || panel.dataset.status === "approved") return;
  const items = Array.from(panel.querySelectorAll(".rs-audit-detail-qty")).map((input) => ({
    id: Number(input.dataset.itemId || 0),
    counted_stock: Number(input.value),
    hasValue: String(input.value || "").trim() !== ""
  }));
  if (items.some((item) => !item.id || !item.hasValue || !Number.isFinite(item.counted_stock) || item.counted_stock < 0)) {
    return alert("请填写正确的实际库存数量");
  }
  items.forEach((item) => delete item.hasValue);
  const res = await fetchWithAuth(`/api/inventory/raw/audit-results/${Number(panel.dataset.sessionId || 0)}`, {
    method: "PUT",
    body: JSON.stringify({ items })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(err.error === "already_approved" ? "该盘点记录已审核，不能修改" : "保存盘点结果失败");
  }
  alert("盘点结果已保存");
  await openRawStockAuditDetail(Number(panel.dataset.sessionId || 0));
  loadRawStockAuditResults(rsAuditResultPage);
}
window.saveRawStockAuditDetail = saveRawStockAuditDetail;
async function approveRawStockAuditDetail() {
  const panel = document.getElementById("rs-audit-detail-panel");
  if (!panel || panel.dataset.status === "approved") return;
  if (!confirm("确认审核这条盘点记录吗？审核后将更新现库存，且不能再修改。")) return;
  const res = await fetchWithAuth(`/api/inventory/raw/audit-results/${Number(panel.dataset.sessionId || 0)}/approve`, {
    method: "POST",
    body: JSON.stringify({})
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(err.error === "already_approved" ? "该盘点记录已审核" : "盘点审核失败");
  }
  alert("盘点审核成功，现库存已更新");
  await openRawStockAuditDetail(Number(panel.dataset.sessionId || 0));
  loadRawStockAuditResults(rsAuditResultPage);
}
window.approveRawStockAuditDetail = approveRawStockAuditDetail;
function renderRsAuditResultPager() {
  const pager = document.getElementById("rs-audit-result-pager");
  if (!pager) return;
  const totalPages = Math.ceil(rsAuditResultTotal / rsAuditResultPageSize);
  if (totalPages <= 1) {
    pager.style.display = "none";
    return;
  }
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${rsAuditResultPage <= 1 ? "disabled" : ""} onclick="loadRawStockAuditResults(${rsAuditResultPage - 1})">上一页</button>
    <span style="font-size:14px; color:#cbd5e1">第 ${rsAuditResultPage} / ${totalPages} 页</span>
    <button class="btn-secondary" ${rsAuditResultPage >= totalPages ? "disabled" : ""} onclick="loadRawStockAuditResults(${rsAuditResultPage + 1})">下一页</button>
  `;
}
async function loadRawStock(page = 1) {
  var _a2, _b2;
  rsPage = page;
  const q = ((_b2 = (_a2 = document.getElementById("rs-search")) == null ? void 0 : _a2.value) == null ? void 0 : _b2.trim()) || "";
  const res = await fetchWithAuth(`/api/inventory/raw?page=${rsPage}&size=${rsPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  rsTotal = data.total || 0;
  syncRawMaterialOptions(list);
  const tbody = document.getElementById("raw-stock-rows");
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">\u6682\u65E0\u6570\u636E</td></tr>';
    renderRsPager();
    return;
  }
  tbody.innerHTML = list.map((m, idx) => `
    <tr>
      <td>${rsTotal - (rsPage - 1) * rsPageSize - idx}</td>
      <td style="padding:8px; width:60px; height:60px; text-align:center">${m.image ? `<img src="${m.image}" class="thumb-img" onclick="showFileViewer('${m.image}')" style="width:44px; height:44px; object-fit:contain; display:inline-block; vertical-align:middle">` : ""}</td>
      <td>${escapeHtml(m.name || "")}</td>
      <td>${escapeHtml(m.category || "其它")}</td>
      <td>${escapeHtml(m.merchant_name || "-")}</td>
      <td>${Number(m.pre_stock || 0)}</td>
      <td>${Number(m.stock || 0)}</td>
      <td>${renderRawLoteLines(m.batches)}</td>
      <td>${renderRawExpiryLines(m.batches)}</td>
      <td style="text-align:center">
        <div style="display:flex; gap:8px; justify-content:center">
          <button class="btn-icon-outline-blue" style="width:32px; min-width:32px; height:32px; border-radius:8px; margin:0" title="\u7F16\u8F91\u539F\u6750\u6599" onclick="openRawMaterialEdit('${encodeURIComponent(JSON.stringify({ id: m.id, name: m.name || "", image: m.image || "", category: m.category || "其它", pre_stock: m.pre_stock || 0, merchant_id: m.merchant_id || 0, merchant_name: m.merchant_name || "" }))}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1-1-4 12.5-12.5Z"/></svg></button>
          <button class="btn-icon-outline-red" style="width:32px; min-width:32px; height:32px; border-radius:8px; margin:0" title="\u5220\u9664\u539F\u6750\u6599" onclick="confirmDeleteRawMaterial('${encodeURIComponent(JSON.stringify({ id: m.id, name: m.name || "" }))}')"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
        </div>
      </td>
    </tr>
  `).join("");
  renderRsPager();
}
window.loadRawStock = loadRawStock;
async function loadRawStockAdjustments(page = 1) {
  var _a2, _b2;
  rsAdjustPage = page;
  const q = ((_b2 = (_a2 = document.getElementById("rs-search")) == null ? void 0 : _a2.value) == null ? void 0 : _b2.trim()) || "";
  const res = await fetchWithAuth(`/api/inventory/raw?page=${rsAdjustPage}&size=${rsPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  const list = data.list || [];
  rsAdjustTotal = data.total || 0;
  syncRawMaterialOptions(list);
  const tbody = document.getElementById("raw-stock-adjust-rows");
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">\u6682\u65E0\u6570\u636E</td></tr>';
    renderRsAdjustPager();
    return;
  }
  tbody.innerHTML = list.map((m, idx) => `
    <tr>
      <td>${rsAdjustTotal - (rsAdjustPage - 1) * rsPageSize - idx}</td>
      <td style="padding:8px; width:60px; height:60px; text-align:center">${m.image ? `<img src="${m.image}" class="thumb-img" onclick="showFileViewer('${m.image}')" style="width:44px; height:44px; object-fit:contain; display:inline-block; vertical-align:middle">` : ""}</td>
      <td>${escapeHtml(m.name || "")}</td>
      <td>${escapeHtml(m.merchant_name || "-")}</td>
      <td>${Number(m.stock || 0)}</td>
      <td>${renderRawLoteLines(m.batches)}</td>
      <td>${renderRawExpiryLines(m.batches)}</td>
      <td style="text-align:center"><button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="openRawStockAdjustment('${encodeURIComponent(JSON.stringify(m))}')">\u8C03\u6574</button></td>
    </tr>
  `).join("");
  renderRsAdjustPager();
}
window.loadRawStockAdjustments = loadRawStockAdjustments;
async function loadRawStockRecords(page = 1) {
  var _a2, _b2;
  rsRecordPage = page;
  const q = ((_b2 = (_a2 = document.getElementById("rs-search")) == null ? void 0 : _a2.value) == null ? void 0 : _b2.trim()) || "";
  const tbody = document.getElementById("raw-stock-record-rows");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="empty">\u52A0\u8F7D\u4E2D...</td></tr>';
  try {
    const res = await fetchWithAuth(`/api/inventory/raw/logs?page=1&size=5000&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
    if (!res.ok) throw new Error("Failed to load raw stock logs");
    const data = await res.json();
    await ensureRawStockMerchantNameMap();
    rsRecordAll = (Array.isArray(data.list) ? data.list : []).map((row) => {
      const merchantName = String((row == null ? void 0 : row.merchant_name) || "").trim();
      if (merchantName) return row;
      const materialName = String((row == null ? void 0 : row.name) || "").trim();
      return {
        ...row,
        merchant_name: rsMerchantNameByMaterialName.get(materialName) || ""
      };
    });
    syncRawStockMerchantFilterOptions(rsRecordAll);
    rsRecordFiltered = filterRawStockRecords(rsRecordAll);
    rsRecordTotal = rsRecordFiltered.length;
    const totalPages = Math.max(1, Math.ceil(rsRecordTotal / rsRecordPageSize));
    if (rsRecordPage > totalPages) rsRecordPage = totalPages;
    if (rsRecordFiltered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">\u6682\u65E0\u8BB0\u5F55</td></tr>';
      renderRsRecordPager();
      return;
    }
    renderRawStockRecordRows();
    renderRsRecordPager();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="9" class="empty" style="color:#ef4444">\u52A0\u8F7D\u5931\u8D25</td></tr>';
  }
}
async function ensureRawStockMerchantNameMap() {
  if (rsMerchantNameByMaterialName.size > 0) return;
  try {
    const res = await fetchWithAuth(`/api/inventory/raw?page=1&size=5000&q=&_t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data == null ? void 0 : data.list) ? data.list : [];
    rsMerchantNameByMaterialName = new Map(
      list.map((item) => [String((item == null ? void 0 : item.name) || "").trim(), String((item == null ? void 0 : item.merchant_name) || "").trim()]).filter((entry) => entry[0] && entry[1])
    );
  } catch (e) {
  }
}
function getRawStockRecordMonthValue(row) {
  const dateNum = Number((row == null ? void 0 : row.date) || 0);
  if (!dateNum) return "";
  const d = new Date(dateNum);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function syncRawStockMerchantFilterOptions(list) {
  if (!rsRecordMerchantFilter) return;
  const currentValue = String(rsRecordMerchantFilter.value || "");
  const merchants = Array.from(new Set((Array.isArray(list) ? list : []).map((row) => String((row == null ? void 0 : row.merchant_name) || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  rsRecordMerchantFilter.innerHTML = '<option value="">全部商家</option>' + merchants.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  rsRecordMerchantFilter.value = merchants.includes(currentValue) ? currentValue : "";
}
function filterRawStockRecords(list) {
  const typeValue = String((rsRecordTypeFilter == null ? void 0 : rsRecordTypeFilter.value) || "").trim();
  const merchantValue = String((rsRecordMerchantFilter == null ? void 0 : rsRecordMerchantFilter.value) || "").trim();
  const fromMonth = String((rsRecordMonthFrom == null ? void 0 : rsRecordMonthFrom.value) || "").trim();
  const toMonth = String((rsRecordMonthTo == null ? void 0 : rsRecordMonthTo.value) || "").trim();
  return (Array.isArray(list) ? list : []).filter((row) => {
    const monthValue = getRawStockRecordMonthValue(row);
    if (typeValue && String((row == null ? void 0 : row.type) || "").trim() !== typeValue) return false;
    if (merchantValue && String((row == null ? void 0 : row.merchant_name) || "").trim() !== merchantValue) return false;
    if (fromMonth && monthValue && monthValue < fromMonth) return false;
    if (toMonth && monthValue && monthValue > toMonth) return false;
    return true;
  });
}
function buildRawStockRecordRowHtml(row, idx) {
  const dateNum = Number(row.date || 0);
  const dateText = formatDisplayDate(dateNum) || "-";
  const timeText = formatDisplayTime(dateNum) || "";
  const dateStr = timeText ? `${dateText} ${timeText}` : dateText;
  const qty = Number(row.qty || 0);
  const qtyColor = qty >= 0 ? "#10b981" : "#f97316";
  const productName = String(row.product_name || "").trim();
  const productNameCn = String(row.product_name_cn || "").trim();
  const productNameHtml = productName || productNameCn ? `<div style="display:flex; flex-direction:column; gap:4px"><div>${escapeHtml(productName || "-")}</div>${productNameCn ? `<div style="font-size:12px; color:#94a3b8">${escapeHtml(productNameCn)}</div>` : ""}</div>` : '<span style="color:#64748b">-</span>';
  const loteText = formatFinishedLote(row.lote || "") || String(row.lote || "").trim() || "-";
  const expiryText = formatDisplayDate(row.expiry || "") || row.expiry || "-";
  const userHtml = `<div style="display:flex; flex-direction:column; gap:4px"><div>${escapeHtml(row.user || "-")}</div><div style="font-size:12px; color:#94a3b8">${escapeHtml(dateStr)}</div></div>`;
  return `
    <tr>
      <td>${rsRecordTotal - (rsRecordPage - 1) * rsRecordPageSize - idx}</td>
      <td>${escapeHtml(row.name || "")}</td>
      <td>${escapeHtml(row.merchant_name || "-")}</td>
      <td>${formatRawRecordType(row.type)}</td>
      <td style="text-align:right; color:${qtyColor}; font-weight:600">${qty > 0 ? "+" : ""}${qty}</td>
      <td>${escapeHtml(loteText)}</td>
      <td>${escapeHtml(expiryText)}</td>
      <td style="white-space:normal; word-break:break-word">${productNameHtml}</td>
      <td>${userHtml}</td>
    </tr>
  `;
}
function renderRawStockRecordRows() {
  const tbody = document.getElementById("raw-stock-record-rows");
  if (!tbody) return;
  const startIndex = (rsRecordPage - 1) * rsRecordPageSize;
  const pageList = rsRecordFiltered.slice(startIndex, startIndex + rsRecordPageSize);
  tbody.innerHTML = pageList.map((row, idx) => buildRawStockRecordRowHtml(row, idx)).join("");
}
function buildRawStockRecordsPrintHtml() {
  const fromMonth = String((rsRecordMonthFrom == null ? void 0 : rsRecordMonthFrom.value) || "").trim();
  const toMonth = String((rsRecordMonthTo == null ? void 0 : rsRecordMonthTo.value) || "").trim();
  const typeLabel = rsRecordTypeFilter && rsRecordTypeFilter.selectedIndex >= 0 ? rsRecordTypeFilter.options[rsRecordTypeFilter.selectedIndex].textContent || "全部类型" : "全部类型";
  const merchantLabel = rsRecordMerchantFilter && rsRecordMerchantFilter.selectedIndex >= 0 ? rsRecordMerchantFilter.options[rsRecordMerchantFilter.selectedIndex].textContent || "全部商家" : "全部商家";
  const searchValue = String((document.getElementById("rs-search") == null ? void 0 : document.getElementById("rs-search").value) || "").trim();
  const rowsHtml = rsRecordFiltered.map((row, index) => {
    const dateNum = Number(row.date || 0);
    const dateText = formatDisplayDate(dateNum) || "-";
    const timeText = formatDisplayTime(dateNum) || "";
    const dateStr = timeText ? `${dateText} ${timeText}` : dateText;
    const qty = Number(row.qty || 0);
    const loteText = formatFinishedLote(row.lote || "") || String(row.lote || "").trim() || "-";
    const expiryText = formatDisplayDate(row.expiry || "") || row.expiry || "-";
    const productText = [String(row.product_name || "").trim(), String(row.product_name_cn || "").trim()].filter(Boolean).join(" / ") || "-";
    return `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.name || "-")}</td>
      <td>${escapeHtml(row.merchant_name || "-")}</td>
      <td>${escapeHtml(formatRawRecordType(row.type))}</td>
      <td style="text-align:right">${qty > 0 ? "+" : ""}${qty}</td>
      <td>${escapeHtml(loteText)}</td>
      <td>${escapeHtml(expiryText)}</td>
      <td>${escapeHtml(productText)}</td>
      <td>${escapeHtml(row.user || "-")}<br><span style="font-size:10px; color:#475569">${escapeHtml(dateStr)}</span></td>
    </tr>`;
  }).join("");
  return `<!doctype html>
  <html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>原材料出入库记录</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      body { font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; color:#111827; margin:0; }
      h1 { margin:0 0 10px; font-size:20px; }
      .meta { margin-bottom:10px; font-size:12px; line-height:1.6; }
      table { width:100%; border-collapse:collapse; table-layout:fixed; }
      th, td { border:1px solid #cbd5e1; padding:6px 8px; font-size:11px; vertical-align:top; word-break:break-word; }
      th { background:#f8fafc; text-align:left; }
      .right { text-align:right; }
      <\/style>
  </head>
  <body>
    <h1>原材料出入库记录</h1>
    <div class="meta">
      <div>搜索：${escapeHtml(searchValue || "全部")}</div>
      <div>月份：${escapeHtml(fromMonth || "不限")} 至 ${escapeHtml(toMonth || "不限")}</div>
      <div>类型：${escapeHtml(typeLabel || "全部类型")}　商家：${escapeHtml(merchantLabel || "全部商家")}　记录数：${rsRecordFiltered.length}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:44px">序号</th>
          <th style="width:110px">名称</th>
          <th style="width:90px">商家</th>
          <th style="width:68px">类型</th>
          <th style="width:64px" class="right">数量</th>
          <th style="width:72px">Lote</th>
          <th style="width:86px">过期时间</th>
          <th>商品名称</th>
          <th style="width:120px">操作人</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center">暂无记录</td></tr>'}</tbody>
    </table>
    <script>window.onload = function(){ window.print(); setTimeout(function(){ window.close(); }, 200); };<\/script>
  </body>
  </html>`;
}
function printRawStockRecords() {
  if (!Array.isArray(rsRecordFiltered) || rsRecordFiltered.length === 0) {
    showAppToast("\u6682\u65E0\u53EF\u6253\u5370\u8BB0\u5F55");
    return;
  }
  const printWin = window.open("", "_blank", "width=1100,height=800");
  if (!printWin || printWin.closed) {
    alert("\u6253\u5370\u7A97\u53E3\u88AB\u62E6\u622A");
    return;
  }
  printWin.document.open();
  printWin.document.write(buildRawStockRecordsPrintHtml());
  printWin.document.close();
}
window.printRawStockRecords = printRawStockRecords;
function renderRsPager() {
  const pager = document.getElementById("rs-pager");
  if (!pager) return;
  const totalPages = Math.ceil(rsTotal / rsPageSize);
  if (totalPages <= 1) {
    pager.style.display = "none";
    return;
  }
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${rsPage <= 1 ? "disabled" : ""} onclick="loadRawStock(${rsPage - 1})">\u4E0A\u4E00\u9875</button>
    <span style="font-size:14px; color:#cbd5e1">\u7B2C ${rsPage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${rsPage >= totalPages ? "disabled" : ""} onclick="loadRawStock(${rsPage + 1})">\u4E0B\u4E00\u9875</button>
  `;
}
function renderRsRecordPager() {
  const pager = document.getElementById("rs-record-pager");
  if (!pager) return;
  const totalPages = Math.ceil(rsRecordTotal / rsRecordPageSize);
  if (totalPages <= 1) {
    pager.style.display = "none";
    return;
  }
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${rsRecordPage <= 1 ? "disabled" : ""} onclick="loadRawStockRecords(${rsRecordPage - 1})">\u4E0A\u4E00\u9875</button>
    <span style="font-size:14px; color:#cbd5e1">\u7B2C ${rsRecordPage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${rsRecordPage >= totalPages ? "disabled" : ""} onclick="loadRawStockRecords(${rsRecordPage + 1})">\u4E0B\u4E00\u9875</button>
  `;
}
function renderRsAdjustPager() {
  const pager = document.getElementById("rs-adjust-pager");
  if (!pager) return;
  const totalPages = Math.ceil(rsAdjustTotal / rsPageSize);
  if (totalPages <= 1) {
    pager.style.display = "none";
    return;
  }
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${rsAdjustPage <= 1 ? "disabled" : ""} onclick="loadRawStockAdjustments(${rsAdjustPage - 1})">\u4E0A\u4E00\u9875</button>
    <span style="font-size:14px; color:#cbd5e1">\u7B2C ${rsAdjustPage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${rsAdjustPage >= totalPages ? "disabled" : ""} onclick="loadRawStockAdjustments(${rsAdjustPage + 1})">\u4E0B\u4E00\u9875</button>
  `;
}
function setRawMaterialModalPreview(imageUrl = "", fileName = "\u672A\u9009\u62E9\u56FE\u7247") {
  if (rsMaterialImage) rsMaterialImage.value = imageUrl || "";
  if (rsMaterialPreview) {
    rsMaterialPreview.src = imageUrl || "";
    rsMaterialPreview.style.display = imageUrl ? "block" : "none";
  }
  if (rsMaterialFileName) rsMaterialFileName.textContent = fileName || (imageUrl ? "\u5DF2\u4FDD\u5B58\u56FE\u7247" : "\u672A\u9009\u62E9\u56FE\u7247");
}
function resetRawMaterialModal() {
  const input = document.getElementById("rs-material-name");
  if (input) input.value = "";
  const preStockInput = document.getElementById("rs-material-pre-stock");
  if (preStockInput) preStockInput.value = "0";
  populateRawMaterialCategorySelect(rsMaterialCategorySelect, "其它");
  rsMaterialEditId = null;
  rsSelectedMerchant = { id: 0, name: "" };
  rsPendingMerchantSelection = { id: 0, name: "" };
  if (rsMaterialIdInput) rsMaterialIdInput.value = "";
  if (rsMaterialFile) rsMaterialFile.value = "";
  setRawMaterialModalPreview("", "\u672A\u9009\u62E9\u56FE\u7247");
  renderRawMaterialMerchantSelection();
}
function openRawMaterialNameModal() {
  resetRawMaterialModal();
  if (rsNameModalTitle) rsNameModalTitle.textContent = "\u6DFB\u52A0\u539F\u6750\u6599\u540D\u79F0";
  if (rsNameModalSave) rsNameModalSave.textContent = "\u4FDD\u5B58";
  document.getElementById("rs-name-modal").style.display = "flex";
}
window.openRawMaterialNameModal = openRawMaterialNameModal;
function openRawMaterialEdit(raw) {
  let material = null;
  try {
    material = JSON.parse(decodeURIComponent(raw || ""));
  } catch (e) {
    console.warn("failed to decode raw material payload", e);
    return;
  }
  if (material && !material.category) {
    const row = document.activeElement && document.activeElement.closest ? document.activeElement.closest("tr") : null;
    const cells = row ? row.querySelectorAll("td") : [];
    material.category = String(cells[3]?.textContent || "其它").trim() || "其它";
  }
  resetRawMaterialModal();
  rsMaterialEditId = Number((material == null ? void 0 : material.id) || 0) || null;
  if (rsMaterialIdInput) rsMaterialIdInput.value = rsMaterialEditId || "";
  const input = document.getElementById("rs-material-name");
  if (input) input.value = String((material == null ? void 0 : material.name) || "").trim();
  populateRawMaterialCategorySelect(rsMaterialCategorySelect, String((material == null ? void 0 : material.category) || "其它"));
  const preStockInput = document.getElementById("rs-material-pre-stock");
  if (preStockInput) preStockInput.value = String(Math.max(0, Number((material == null ? void 0 : material.pre_stock) || 0)));
  rsSelectedMerchant = {
    id: Number((material == null ? void 0 : material.merchant_id) || 0) || 0,
    name: String((material == null ? void 0 : material.merchant_name) || "").trim()
  };
  rsPendingMerchantSelection = { ...rsSelectedMerchant };
  renderRawMaterialMerchantSelection();
  const imageUrl = String((material == null ? void 0 : material.image) || "").trim();
  setRawMaterialModalPreview(imageUrl, imageUrl ? "\u5DF2\u4FDD\u5B58\u56FE\u7247" : "\u672A\u9009\u62E9\u56FE\u7247");
  if (rsNameModalTitle) rsNameModalTitle.textContent = "\u7F16\u8F91\u539F\u6750\u6599\u540D\u79F0";
  if (rsNameModalSave) rsNameModalSave.textContent = "\u4FDD\u5B58\u4FEE\u6539";
  document.getElementById("rs-name-modal").style.display = "flex";
}
window.openRawMaterialEdit = openRawMaterialEdit;
async function saveRawMaterialName() {
  var _a2;
  const name = document.getElementById("rs-material-name").value.trim();
  if (!name) return alert("\u8BF7\u586B\u5199\u539F\u6750\u6599\u540D\u79F0");
  const materialId = Number(rsMaterialEditId || (rsMaterialIdInput == null ? void 0 : rsMaterialIdInput.value) || 0);
  const merchantId = Number((rsSelectedMerchant == null ? void 0 : rsSelectedMerchant.id) || 0) || null;
  const merchantName = String((rsSelectedMerchant == null ? void 0 : rsSelectedMerchant.name) || "").trim();
  const category = String((rsMaterialCategorySelect == null ? void 0 : rsMaterialCategorySelect.value) || "其它").trim();
  const preStock = Math.max(0, Number(document.getElementById("rs-material-pre-stock")?.value || 0));
  let image = (rsMaterialImage == null ? void 0 : rsMaterialImage.value) || "";
  const fileObj = (_a2 = rsMaterialFile == null ? void 0 : rsMaterialFile.files) == null ? void 0 : _a2[0];
  if (fileObj) {
    const fd = new FormData();
    fd.append("file", fileObj);
    try {
      const token = getAuthToken();
      const r = await fetch(API_BASE + "/api/upload", {
        method: "POST",
        headers: token ? { "Authorization": "Bearer " + token } : {},
        body: fd
      });
      if (!r.ok) {
        alert("\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
        return;
      }
      const d = await r.json();
      image = d.url || "";
      if (rsMaterialImage) rsMaterialImage.value = image;
    } catch (e) {
      console.warn("raw material image upload failed", e);
      alert("\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC");
      return;
    }
  }
  const res = await fetchWithAuth(materialId ? `/api/inventory/raw/materials/${materialId}` : "/api/inventory/raw/materials", {
    method: materialId ? "PUT" : "POST",
    body: JSON.stringify({ name, image, category, pre_stock: preStock, merchant_id: merchantId, merchant_name: merchantName })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error === "duplicate") return alert("\u539F\u6750\u6599\u540D\u79F0\u5DF2\u5B58\u5728");
    if (err.error === "not_found") return alert("\u539F\u6750\u6599\u4E0D\u5B58\u5728");
    return alert(materialId ? "\u4FDD\u5B58\u4FEE\u6539\u5931\u8D25" : "\u4FDD\u5B58\u5931\u8D25");
  }
  document.getElementById("rs-name-modal").style.display = "none";
  if (rsCurrentTab === "stock") loadRawStock(rsPage);
  else if (rsCurrentTab === "adjust") loadRawStockAdjustments(rsAdjustPage);
}
window.saveRawMaterialName = saveRawMaterialName;
async function openRawMaterialMerchantSelector() {
  await openRawStockMerchantSelector();
}
window.openRawMaterialMerchantSelector = openRawMaterialMerchantSelector;
function confirmDeleteRawMaterial(raw) {
  let material = null;
  try {
    material = JSON.parse(decodeURIComponent(raw || ""));
  } catch (e) {
    console.warn("failed to decode raw material delete payload", e);
    return;
  }
  const mid = Number((material == null ? void 0 : material.id) || 0);
  if (!mid) return;
  const name = String((material == null ? void 0 : material.name) || "").trim() || "\u8BE5\u539F\u6750\u6599";
  openConfirm(`\u786E\u5B9A\u5220\u9664\u201C${name}\u201D\u5417\uFF1F\u5220\u9664\u540E\u4E0D\u53EF\u6062\u590D\u3002`, async () => {
    const res = await fetchWithAuth(`/api/inventory/raw/materials/${mid}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.error === "has_stock") return alert("\u8BE5\u539F\u6750\u6599\u8FD8\u6709\u5E93\u5B58\uFF0C\u4E0D\u80FD\u5220\u9664");
      if (err.error === "has_logs") return alert("\u8BE5\u539F\u6750\u6599\u5DF2\u6709\u51FA\u5165\u5E93\u8BB0\u5F55\uFF0C\u4E0D\u80FD\u5220\u9664");
      if (err.error === "not_found") return alert("\u539F\u6750\u6599\u4E0D\u5B58\u5728");
      return alert("\u5220\u9664\u5931\u8D25");
    }
    if (rsCurrentTab === "stock") loadRawStock(1);
    else if (rsCurrentTab === "adjust") loadRawStockAdjustments(1);
  });
}
window.confirmDeleteRawMaterial = confirmDeleteRawMaterial;
function isEventRecordOverdue(dateStr) {
  const raw = String(dateStr || "").trim();
  if (!raw) return false;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const dueTs = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  const now = /* @__PURE__ */ new Date();
  const todayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return dueTs < todayTs;
}
async function loadEventRecords(tab = "ongoing", btn = null, page = 1) {
  var _a2, _b2;
  eventRecordCurrentTab = tab === "completed" ? "completed" : "ongoing";
  eventRecordPage = page;
  if (btn) {
    document.querySelectorAll("#page-event-records .tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  } else {
    const tBtn = document.querySelector(`#page-event-records .tab[data-tab="${eventRecordCurrentTab}"]`);
    if (tBtn) {
      document.querySelectorAll("#page-event-records .tab").forEach((b) => b.classList.remove("active"));
      tBtn.classList.add("active");
    }
  }
  const q = ((_b2 = (_a2 = document.getElementById("event-record-search")) == null ? void 0 : _a2.value) == null ? void 0 : _b2.trim()) || "";
  const res = await fetchWithAuth(`/api/event-records?status=${eventRecordCurrentTab}&page=${eventRecordPage}&size=${eventRecordPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  currentEventRecordList = data.list || [];
  eventRecordTotal = data.total || 0;
  const setEventBadge = (id, count) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = count;
      el.style.display = count > 0 ? "inline-block" : "none";
    }
  };
  if (eventRecordCurrentTab === "ongoing") {
    setEventBadge("tab-event-record-ongoing-badge", eventRecordTotal);
  }
  const tbody = document.getElementById("event-record-rows");
  if (!tbody) return;
  if (!currentEventRecordList.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="8">\u6682\u65E0\u6570\u636E</td></tr>';
    renderEventRecordPager();
    return;
  }
  tbody.innerHTML = currentEventRecordList.map((x, idx) => {
    const overdue = eventRecordCurrentTab === "ongoing" && isEventRecordOverdue(x.due_date || "");
    const dueStyle = overdue ? "color:#f59e0b; font-weight:700" : "";
    return `
      <tr>
        <td>${eventRecordTotal - (eventRecordPage - 1) * eventRecordPageSize - idx}</td>
        <td title="${escapeHtml(x.name || "")}" style="min-width:260px; max-width:360px">
          <div style="display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; white-space:normal; word-break:break-word; line-height:1.7">${escapeHtml(x.name || "-")}</div>
        </td>
        <td>${escapeHtml(formatDisplayDate(x.record_date || ""))}</td>
        <td style="${dueStyle}">${escapeHtml(formatDisplayDate(x.due_date || ""))}</td>
        <td title="${escapeHtml(x.notes || "")}" style="min-width:360px; max-width:460px">
          <div style="display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; white-space:normal; word-break:break-word; line-height:1.7">${escapeHtml(x.notes || "-")}</div>
        </td>
        <td style="text-align:center">
          ${x.image_url ? `<img src="${x.image_url}" class="thumb-img" onclick="showFileViewer('${x.image_url}')" style="width:44px; height:44px; object-fit:cover; display:inline-block; cursor:zoom-in; border-radius:8px" title="\u70B9\u51FB\u653E\u5927">` : "-"}
        </td>
        <td>
          <div>${escapeHtml(x.created_by || "")}</div>
          ${eventRecordCurrentTab === "completed" ? `<div style="margin-top:4px; font-size:12px; color:#94a3b8">\u786E\u8BA4\uFF1A${escapeHtml(x.confirmed_by || "-")}</div>` : ""}
        </td>
        <td>
          ${eventRecordCurrentTab === "ongoing" ? `<div style="display:flex; align-items:center; gap:8px; justify-content:flex-start">
                 <button class="btn-secondary" style="width:32px; min-width:32px; height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:8px" title="\u7F16\u8F91" aria-label="\u7F16\u8F91" onclick="openEventRecordModal(${x.id})">
                   <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                 </button>
                 <button class="btn-sm" style="width:32px; min-width:32px; height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; margin:0" title="\u5B8C\u6210" aria-label="\u5B8C\u6210" onclick="markEventRecordCompleted(${x.id})">
                   <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                 </button>
               </div>` : `<div style="display:flex; align-items:center; gap:8px; justify-content:flex-start">
                 <button class="btn-secondary" style="width:32px; min-width:32px; height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:8px" title="\u67E5\u770B" aria-label="\u67E5\u770B" onclick="openEventRecordViewModal(${x.id})">
                   <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.06 12C3.2 7.94 7.03 5 12 5s8.8 2.94 9.94 7c-1.14 4.06-4.97 7-9.94 7s-8.8-2.94-9.94-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                 </button>
                 <button class="btn-secondary" style="width:32px; min-width:32px; height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:8px" title="\u6062\u590D\u8FDB\u884C\u4E2D" aria-label="\u6062\u590D\u8FDB\u884C\u4E2D" onclick="markEventRecordOngoing(${x.id})">
                   <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>
                 </button>
               </div>`}
        </td>
      </tr>
    `;
  }).join("");
  renderEventRecordPager();
}
window.loadEventRecords = loadEventRecords;
function renderEventRecordPager() {
  const pager = document.getElementById("event-record-pager");
  if (!pager) return;
  if (eventRecordTotal <= eventRecordPageSize) {
    pager.style.display = "none";
    pager.innerHTML = "";
    return;
  }
  const totalPages = Math.max(1, Math.ceil(eventRecordTotal / eventRecordPageSize));
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${eventRecordPage <= 1 ? "disabled" : ""} onclick="loadEventRecords('${eventRecordCurrentTab}', null, ${Math.max(1, eventRecordPage - 1)})">\u4E0A\u4E00\u9875</button>
    <span>\u7B2C ${eventRecordPage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${eventRecordPage >= totalPages ? "disabled" : ""} onclick="loadEventRecords('${eventRecordCurrentTab}', null, ${Math.min(totalPages, eventRecordPage + 1)})">\u4E0B\u4E00\u9875</button>
  `;
}
function handleEventRecordSearchInput() {
  loadEventRecords(eventRecordCurrentTab, null, 1);
}
window.handleEventRecordSearchInput = handleEventRecordSearchInput;
function setEventRecordImagePreview(url = "") {
  const wrap = document.getElementById("event-record-image-preview-wrap");
  const img = document.getElementById("event-record-image-preview");
  const value = String(url || "").trim();
  if (!wrap || !img) return;
  if (!value) {
    img.src = "";
    wrap.style.display = "none";
    return;
  }
  img.src = value;
  wrap.style.display = "block";
}
function resetEventRecordImageState() {
  if (eventRecordPreviewObjectUrl) {
    try {
      URL.revokeObjectURL(eventRecordPreviewObjectUrl);
    } catch (e) {
    }
    eventRecordPreviewObjectUrl = "";
  }
  eventRecordPendingImageFile = null;
  const fileInput = document.getElementById("event-record-image-file");
  if (fileInput) fileInput.value = "";
}
async function uploadEventRecordImage(fileObj) {
  if (!fileObj) return "";
  const fileName = String(fileObj.name || "").trim().toLowerCase();
  const mimeType = String(fileObj.type || "").trim().toLowerCase();
  const extOk = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"].some((ext) => fileName.endsWith(ext));
  const mimeOk = mimeType.startsWith("image/");
  if (!(extOk || mimeOk)) throw new Error("bad_type");
  const fd = new FormData();
  fd.append("file", fileObj);
  const token = getAuthToken();
  const r = await fetch(API_BASE + "/api/upload", {
    method: "POST",
    headers: token ? { "Authorization": "Bearer " + token } : {},
    body: fd
  });
  if (!r.ok) throw new Error("upload_failed");
  const d = await r.json();
  return d.url || "";
}
function handleEventRecordImageChange(input) {
  var _a2, _b2;
  const file = ((_a2 = input == null ? void 0 : input.files) == null ? void 0 : _a2[0]) || null;
  eventRecordPendingImageFile = file;
  if (eventRecordPreviewObjectUrl) {
    try {
      URL.revokeObjectURL(eventRecordPreviewObjectUrl);
    } catch (e) {
    }
    eventRecordPreviewObjectUrl = "";
  }
  if (file) {
    eventRecordPreviewObjectUrl = URL.createObjectURL(file);
    setEventRecordImagePreview(eventRecordPreviewObjectUrl);
  } else {
    setEventRecordImagePreview(((_b2 = document.getElementById("event-record-image-url")) == null ? void 0 : _b2.value) || "");
  }
}
window.handleEventRecordImageChange = handleEventRecordImageChange;
function openEventRecordModal(id = null) {
  const modal = document.getElementById("event-record-modal");
  const title = document.getElementById("event-record-modal-title");
  const idInput = document.getElementById("event-record-id");
  const nameInput = document.getElementById("event-record-name");
  const dateInput = document.getElementById("event-record-date");
  const dueInput = document.getElementById("event-record-due-date");
  const notesInput = document.getElementById("event-record-notes");
  const imageUrlInput = document.getElementById("event-record-image-url");
  const imageFileInput = document.getElementById("event-record-image-file");
  if (!modal || !title || !idInput || !nameInput || !dateInput || !dueInput || !notesInput || !imageUrlInput) return;
  resetEventRecordImageState();
  if (!id) {
    title.textContent = "\u6DFB\u52A0\u4E8B\u4EF6";
    idInput.value = "";
    nameInput.value = "";
    dateInput.value = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    dueInput.value = "";
    notesInput.value = "";
    imageUrlInput.value = "";
    setEventRecordImagePreview("");
  } else {
    const item = currentEventRecordList.find((x) => Number(x.id) === Number(id));
    if (!item) return;
    title.textContent = "\u7F16\u8F91\u4E8B\u4EF6";
    idInput.value = String(item.id);
    nameInput.value = item.name || "";
    dateInput.value = item.record_date || "";
    dueInput.value = item.due_date || "";
    notesInput.value = item.notes || "";
    imageUrlInput.value = item.image_url || "";
    setEventRecordImagePreview(item.image_url || "");
  }
  if (imageFileInput && !imageFileInput.dataset.bound) {
    imageFileInput.addEventListener("change", () => handleEventRecordImageChange(imageFileInput));
    imageFileInput.dataset.bound = "1";
  }
  modal.style.display = "flex";
}
window.openEventRecordModal = openEventRecordModal;
function closeEventRecordModal() {
  const modal = document.getElementById("event-record-modal");
  resetEventRecordImageState();
  if (modal) modal.style.display = "none";
}
window.closeEventRecordModal = closeEventRecordModal;
function openEventRecordViewModal(id) {
  const item = currentEventRecordList.find((x) => Number(x.id) === Number(id));
  const modal = document.getElementById("event-record-view-modal");
  if (!item || !modal) return;
  const setText = (id2, value) => {
    const el = document.getElementById(id2);
    if (el) el.textContent = value || "-";
  };
  setText("event-record-view-name", item.name || "");
  setText("event-record-view-date", formatDisplayDate(item.record_date || ""));
  setText("event-record-view-due-date", formatDisplayDate(item.due_date || ""));
  setText("event-record-view-notes", item.notes || "");
  setText("event-record-view-created-by", item.created_by || "");
  setText("event-record-view-confirmed-by", item.confirmed_by || "");
  const imageGroup = document.getElementById("event-record-view-image-group");
  const imageEl = document.getElementById("event-record-view-image");
  if (imageGroup && imageEl) {
    const imageUrl = String(item.image_url || "").trim();
    imageEl.src = imageUrl;
    imageGroup.style.display = imageUrl ? "block" : "none";
  }
  modal.style.display = "flex";
}
window.openEventRecordViewModal = openEventRecordViewModal;
function closeEventRecordViewModal() {
  const modal = document.getElementById("event-record-view-modal");
  if (modal) modal.style.display = "none";
}
window.closeEventRecordViewModal = closeEventRecordViewModal;
async function saveEventRecord() {
  var _a2, _b2, _c2, _d, _e, _f, _g, _h, _i;
  const id = Number(((_a2 = document.getElementById("event-record-id")) == null ? void 0 : _a2.value) || 0);
  const name = ((_c2 = (_b2 = document.getElementById("event-record-name")) == null ? void 0 : _b2.value) == null ? void 0 : _c2.trim()) || "";
  const recordDate = ((_d = document.getElementById("event-record-date")) == null ? void 0 : _d.value) || "";
  const dueDate = ((_e = document.getElementById("event-record-due-date")) == null ? void 0 : _e.value) || "";
  const notes = ((_g = (_f = document.getElementById("event-record-notes")) == null ? void 0 : _f.value) == null ? void 0 : _g.trim()) || "";
  let imageUrl = ((_i = (_h = document.getElementById("event-record-image-url")) == null ? void 0 : _h.value) == null ? void 0 : _i.trim()) || "";
  if (!name) return alert("\u8BF7\u8F93\u5165\u4E8B\u4EF6\u540D\u79F0");
  if (eventRecordPendingImageFile) {
    try {
      imageUrl = await uploadEventRecordImage(eventRecordPendingImageFile);
    } catch (e) {
      if (String((e == null ? void 0 : e.message) || "") === "bad_type") return alert("\u8BF7\u4E0A\u4F20\u56FE\u7247\u6587\u4EF6");
      return alert("\u56FE\u7247\u4E0A\u4F20\u5931\u8D25");
    }
  }
  const payload = {
    name,
    record_date: recordDate,
    due_date: dueDate,
    notes,
    image_url: imageUrl,
    status: eventRecordCurrentTab
  };
  const res = await fetchWithAuth(id ? `/api/event-records/${id}` : "/api/event-records", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return alert("\u4FDD\u5B58\u5931\u8D25");
  closeEventRecordModal();
  showAppToast("\u4FDD\u5B58\u6210\u529F");
  loadEventRecords(eventRecordCurrentTab, null, 1);
}
window.saveEventRecord = saveEventRecord;
async function markEventRecordCompleted(id) {
  const item = currentEventRecordList.find((x) => Number(x.id) === Number(id));
  if (!item) return;
  const res = await fetchWithAuth(`/api/event-records/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: item.name || "",
      record_date: item.record_date || "",
      due_date: item.due_date || "",
      notes: item.notes || "",
      image_url: item.image_url || "",
      status: "completed"
    })
  });
  if (!res.ok) return alert("\u64CD\u4F5C\u5931\u8D25");
  showAppToast("\u5DF2\u6807\u8BB0\u4E3A\u5B8C\u6210");
  loadEventRecords(eventRecordCurrentTab, null, 1);
}
window.markEventRecordCompleted = markEventRecordCompleted;
async function markEventRecordOngoing(id) {
  const item = currentEventRecordList.find((x) => Number(x.id) === Number(id));
  if (!item) return;
  const res = await fetchWithAuth(`/api/event-records/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: item.name || "",
      record_date: item.record_date || "",
      due_date: item.due_date || "",
      notes: item.notes || "",
      image_url: item.image_url || "",
      status: "ongoing"
    })
  });
  if (!res.ok) return alert("\u64CD\u4F5C\u5931\u8D25");
  showAppToast("\u5DF2\u6062\u590D\u4E3A\u8FDB\u884C\u4E2D");
  loadEventRecords(eventRecordCurrentTab, null, 1);
}
window.markEventRecordOngoing = markEventRecordOngoing;
async function loadProductionEntries(tab = "pending", btn = null, page = 1) {
  var _a2, _b2;
  productionReviewCurrentTab = ["approved", "rejected"].includes(tab) ? tab : "pending";
  productionReviewPage = page;
  const reviewScope = document.getElementById("fs-review-panel") || document.getElementById("page-production-review");
  if (btn) {
    reviewScope == null ? void 0 : reviewScope.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  } else {
    const tBtn = reviewScope == null ? void 0 : reviewScope.querySelector(`.tab[data-tab="${productionReviewCurrentTab}"]`);
    if (tBtn) {
      reviewScope == null ? void 0 : reviewScope.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      tBtn.classList.add("active");
    }
  }
  const q = ((_b2 = (_a2 = document.getElementById("production-review-search")) == null ? void 0 : _a2.value) == null ? void 0 : _b2.trim()) || "";
  const res = await fetchWithAuth(`/api/production-entries?status=${productionReviewCurrentTab}&page=${productionReviewPage}&size=${productionReviewPageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  currentProductionEntryList = data.list || [];
  productionReviewTotal = data.total || 0;
  const tbody = document.getElementById("production-review-rows");
  if (!tbody) return;
  if (!currentProductionEntryList.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="10">\u6682\u65E0\u6570\u636E</td></tr>';
    renderProductionReviewPager();
    return;
  }
  tbody.innerHTML = currentProductionEntryList.map((x, idx) => `
    <tr>
      <td>${productionReviewTotal - (productionReviewPage - 1) * productionReviewPageSize - idx}</td>
      <td style="text-align:center">${x.photo_url ? `<img src="${x.photo_url}" class="thumb-img" onclick="showFileViewer('${x.photo_url}')" style="width:44px;height:44px;object-fit:cover;display:inline-block;cursor:zoom-in" title="\u70B9\u51FB\u653E\u5927">` : "-"}</td>
      <td>${escapeHtml(x.product_name || "")}</td>
      <td>${escapeHtml(x.product_name_cn || "")}</td>
      <td>${productionReviewCurrentTab === "pending" ? `<span style="color:#ef4444; font-size:16px; font-weight:800">${escapeHtml(formatProductionReviewLote(x.lote || ""))}</span>` : escapeHtml(formatProductionReviewLote(x.lote || ""))}</td>
      <td>${productionReviewCurrentTab === "pending" ? `<span style="color:#ef4444; font-size:16px; font-weight:800">${escapeHtml(formatDisplayDate(x.expiration_date || ""))}</span>` : escapeHtml(formatDisplayDate(x.expiration_date || ""))}</td>
      <td>${productionReviewCurrentTab === "pending" ? `<span style="color:#ef4444; font-size:16px; font-weight:800">${Number(x.box_count || 0)}</span>` : Number(x.box_count || 0)}</td>
      <td>${formatDateTime(Number(x.created_at || 0))}</td>
      <td>${escapeHtml(x.created_by || "")}</td>
      <td>
        <span style="display:inline-block; margin-right:6px; color:#94a3b8; font-size:12px; white-space:nowrap">${escapeHtml(formatProductionPrintCountText(x))}</span>
        <button class="btn-secondary" style="padding:4px 8px; font-size:12px" onclick="printProductionEntryLabels(${x.id})" title="\u6253\u5370\u6807\u7B7E" aria-label="\u6253\u5370\u6807\u7B7E">&#128424;</button>
        ${productionReviewCurrentTab === "pending" ? `<button class="btn-sm" style="margin-left:6px" onclick="approveProductionEntry(${x.id})">\u5BA1\u6838</button>
             <button class="btn-secondary" style="margin-left:6px; padding:4px 10px; font-size:12px" onclick="rejectProductionEntry(${x.id})">\u9A73\u56DE</button>` : productionReviewCurrentTab === "rejected" ? `<span title="${escapeHtml(x.reject_reason || "")}" style="margin-left:6px; color:#fca5a5">${escapeHtml(x.reject_reason || "\u5DF2\u9A73\u56DE")}</span>` : `<div style="margin-top:4px; color:#10b981">\u5DF2\u5165\u5E93\u5E76\u6253\u5370</div><div style="margin-top:4px; font-size:12px; color:#94a3b8">\u5BA1\u6838\u4EBA: ${escapeHtml(x.approved_by || "-")}</div>`}
      </td>
    </tr>
  `).join("");
  renderProductionReviewPager();
}
window.loadProductionEntries = loadProductionEntries;
function formatProductionReviewLote(loteValue) {
  let raw = String(loteValue || "").trim();
  const parts = raw.split("-");
  if (parts.length === 3) raw = parts[2] + parts[1];
  return raw || "-";
}
function renderProductionReviewPager() {
  const pager = document.getElementById("production-review-pager");
  if (!pager) return;
  const totalPages = Math.max(1, Math.ceil(productionReviewTotal / productionReviewPageSize));
  pager.innerHTML = `
    <button class="btn-secondary" ${productionReviewPage <= 1 ? "disabled" : ""} onclick="loadProductionEntries('${productionReviewCurrentTab}', null, ${Math.max(1, productionReviewPage - 1)})">\u4E0A\u4E00\u9875</button>
    <span>\u7B2C ${productionReviewPage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${productionReviewPage >= totalPages ? "disabled" : ""} onclick="loadProductionEntries('${productionReviewCurrentTab}', null, ${Math.min(totalPages, productionReviewPage + 1)})">\u4E0B\u4E00\u9875</button>
  `;
}
function handleProductionReviewSearchInput() {
  loadProductionEntries(productionReviewCurrentTab, null, 1);
}
window.handleProductionReviewSearchInput = handleProductionReviewSearchInput;
function buildSimpleBarcodeSvg(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return `<div style="width:100%; height:28mm; display:flex; align-items:center; justify-content:center; font-size:12px; color:#666;">无条码</div>`;
  }
  const codes = Array.from(raw).map((ch) => ch.charCodeAt(0));
  const pattern = codes.map((code, idx) => {
    const seed = (code + idx * 17).toString(2).padStart(8, "0");
    return seed.replace(/[01]/g, (bit, pos) => {
      if (bit === "0") return pos % 3 === 0 ? "1" : "0";
      return pos % 2 === 0 ? "1" : "0";
    });
  }).join("10");
  let x = 0;
  const bars = [];
  for (let i = 0; i < pattern.length; i++) {
    const isBar = pattern[i] === "1";
    const width = i % 3 === 0 ? 1.6 : i % 2 === 0 ? 1.2 : 0.8;
    if (isBar) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="100" fill="#000"></rect>`);
    x += width;
  }
  const totalWidth = Math.max(80, x + 4);
  return `<svg class="barcode-svg" viewBox="0 0 ${totalWidth} 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars.join("")}</svg>`;
}
function buildProductionLabelHtml(entry) {
  const productCode = escapeHtml(String(entry.product_code || "").trim());
  const cnNameRaw = String(entry.product_name_cn || "").trim();
  const cnName = escapeHtml(cnNameRaw);
  const productName = escapeHtml(String(entry.product_name || "").trim());
  const specRaw = String(entry.product_spec || "").trim();
  const spec = escapeHtml(specRaw);
  const ingredients = escapeHtml(String(entry.product_ingredients || "").trim()).replace(/\n/g, "<br>");
  const nutrition = escapeHtml(String(entry.product_nutrition_facts || "").trim());
  const allergens = escapeHtml(String(entry.product_allergens || "").trim());
  const lote = escapeHtml(formatProductionReviewLote(entry.lote || ""));
  const expiry = escapeHtml(formatDisplayDate(entry.expiration_date || ""));
  const barcode = escapeHtml(String(entry.product_barcode || "").trim());
  const cnNameLength = Array.from(cnNameRaw || "").length;
  const cnNameFontSize = cnNameLength <= 4 ? 16.5 : cnNameLength <= 5 ? 14.5 : cnNameLength <= 6 ? 12.5 : cnNameLength <= 7 ? 11 : cnNameLength <= 8 ? 10 : 9;
  const specLength = Array.from(specRaw || "").length;
  const specFontSize = specLength <= 8 ? 7.2 : specLength <= 12 ? 6.2 : 5.4;
  const complianceSvg = `
    <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="80" cy="45" rx="74" ry="38" fill="none" stroke="#111" stroke-width="2"/>
      <text x="80" y="26" text-anchor="middle" font-size="18" font-family="Arial, sans-serif" font-weight="400" fill="#111">ES</text>
      <text x="80" y="52" text-anchor="middle" font-size="20" font-family="Arial, sans-serif" font-weight="400" fill="#111">26.024118/M</text>
      <text x="80" y="76" text-anchor="middle" font-size="22" font-family="Arial, sans-serif" font-weight="400" fill="#111">CE</text>
    </svg>`;
  const alAzulSvg = `
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 8h72l32 32v72H8z" fill="none" stroke="#111" stroke-width="3"/>
      <path d="M80 8v32h32" fill="none" stroke="#111" stroke-width="3"/>
      <text x="17" y="31" font-size="17" font-family="Arial, sans-serif" font-weight="700" fill="#111">Al Azul</text>
      <path d="M24 90c0-15 4-26 8-35 2-4 5-6 10-6h16c2 0 4 2 4 4s-2 4-4 4H45c-2 0-4 1-5 3-3 8-6 17-6 27 0 5 3 7 7 7h22c3 0 5 2 5 5s-2 5-5 5H39c-9 0-15-6-15-14z" fill="#111"/>
      <circle cx="72" cy="57" r="8" fill="#111"/>
      <circle cx="97" cy="46" r="8.5" fill="#111"/>
      <path d="M89 57c5 0 8 3 10 9l6 24c1 3-1 6-4 7-3 1-6-1-7-4l-5-19-13 1c-3 1-6-1-6-4 0-3 2-5 5-6l14-2z" fill="#111"/>
      <path d="M86 61l-19 3c-3 0-5-2-5-4 0-3 2-5 4-5l19-3c3 0 5 2 5 4s-2 4-4 5z" fill="#111"/>
    </svg>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>\u751F\u4EA7\u6807\u7B7E</title>
<style>
  @page { size: 100mm 150mm; margin: 0; }
  html, body { margin: 0; padding: 0; width: 100mm; height: 150mm; background: #fff; font-family: Arial, "Microsoft YaHei", sans-serif; color: #000; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label { width: 100mm; height: 150mm; box-sizing: border-box; padding: 3mm 3.6mm 2.6mm; display: flex; flex-direction: column; gap: 1.6mm; overflow: hidden; }
  .hero { display: grid; grid-template-columns: 28mm 1fr; gap: 2.8mm; align-items: stretch; }
  .code-box { width: 28mm; min-width: 28mm; min-height: 28mm; border: 2.2px solid #111; border-radius: 50%; display:flex; align-items:center; justify-content:center; padding: 0.4mm; }
  .code-text { width: 100%; height: 100%; display:flex; align-items:center; justify-content:center; overflow:hidden; font-size: 24mm; line-height: 0.78; font-weight: 800; letter-spacing: -0.7mm; text-align: center; word-break: break-word; }
  .cn-box { min-height: 31mm; display:flex; align-items:center; overflow:hidden; min-width: 0; }
  .cn-row { width: 100%; display:flex; flex-direction:column; justify-content:center; gap: 1.2mm; min-width: 0; }
  .cn-text { width: 100%; min-width: 0; font-size: ${cnNameFontSize}mm; line-height: 0.9; font-weight: 800; letter-spacing: -0.35mm; white-space: nowrap; overflow: hidden; text-overflow: clip; }
  .spec-inline { width: 100%; font-size: ${specFontSize}mm; line-height: 1.05; font-weight: 700; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: clip; }
  .block { padding: 0; }
  .block-title { font-size: 11px; font-weight: 700; margin-bottom: 0; }
  .block-value { font-size: 13px; line-height: 1.32; word-break: break-word; white-space: normal; }
  .block-value.large { font-size: 15px; font-weight: 700; }
  .date-lines { display: flex; flex-direction: column; gap: 0.35mm; margin-top: 0.1mm; }
  .date-line { font-size: 14px; line-height: 1.12; font-weight: 700; word-break: break-word; }
  .date-line .date-value { font-size: 15px; font-weight: 800; }
  .date-line-lote { display:flex; align-items:flex-end; justify-content:space-between; gap: 2mm; }
  .date-line-text { flex: 1; min-width: 0; }
  .bottom-row { display:flex; align-items:flex-end; justify-content:space-between; gap: 2.4mm; margin-top: 0.1mm; }
  .barcode-left-mark { width: 18mm; flex: 0 0 auto; margin-left: auto; margin-right: 1.2mm; }
  .compliance-mark { width: 19mm; flex: 0 0 auto; margin-bottom: -2.2mm; }
  .mark-svg { width: 100%; height: auto; display:block; }
  .barcode-box { width: 31mm; padding: 0; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; margin-left: auto; }
  .barcode-svg { width: 100%; height: 10.5mm; display:block; }
  .barcode-text { margin-top: 0.8mm; font-size: 8px; line-height: 1; letter-spacing: 0.8px; text-align:center; }
  .plain-value { font-size: 15px; line-height: 1.28; word-break: break-word; white-space: normal; }
  .plain-value.name { font-size: 16px; font-weight: 700; }
  .plain-value.ingredients { font-size: 2.1mm; line-height: 1.12; }
  .plain-value.nutrition,
  .plain-value.allergens { font-size: 2.9mm; line-height: 1.16; white-space: pre-wrap; word-break: normal; font-family: "Courier New", Consolas, monospace; }
</style>
</head>
<body>
  <div class="label">
    <div class="hero">
      <div class="code-box">
        <div class="code-text">${productCode || "-"}</div>
      </div>
      <div class="cn-box">
        <div class="cn-row">
          <div class="cn-text">${cnName || "-"}</div>
          <div class="spec-inline">${spec || "-"}</div>
        </div>
      </div>
    </div>
    <div class="block">
      <div class="plain-value name">${productName || "-"}</div>
    </div>
    <div class="block">
      <div class="plain-value ingredients">${ingredients || "-"}</div>
    </div>
    <div class="block">
      <div class="plain-value nutrition">${nutrition || "-"}</div>
    </div>
    <div class="block">
      <div class="plain-value allergens">${allergens || "-"}</div>
    </div>
    <div class="date-lines">
      <div class="date-line date-line-lote">
        <div class="date-line-text">生产批次 Lote：<span class="date-value">${lote || "-"}</span></div>
        <div class="compliance-mark">${complianceSvg}</div>
      </div>
      <div class="date-line">保质期到：<span class="date-value">${expiry || "-"}</span></div>
    </div>
    <div class="bottom-row">
      <div class="barcode-left-mark">${alAzulSvg}</div>
      <div class="barcode-box">
        ${buildSimpleBarcodeSvg(barcode)}
        <div class="barcode-text">${barcode || "-"}</div>
      </div>
    </div>
  </div>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 200); };<\/script>
</body>
</html>`;
}
function buildProductionSmallLabelHtml(entry, totalCopies = 1) {
  const printNote = escapeHtml(String(entry.print_note || "").trim());
  const expiry = escapeHtml(formatDisplayDate(entry.expiration_date || "") || String(entry.expiration_date || "").trim() || "-");
  const lote = escapeHtml(formatProductionReviewLote(entry.lote || "") || String(entry.lote || "").trim() || "-");
  const copies = Math.max(1, parseInt(totalCopies, 10) || 1);
  const pages = Array.from({ length: copies }).map(() => `
    <div class="small-label">
      <div class="small-label-line small-label-header">
        ${printNote ? `<span class="small-label-note">${printNote}</span>` : ""}
        <span class="small-label-title">保质期到：</span>
      </div>
      <div class="small-label-line small-label-date">${expiry}</div>
      <div class="small-label-line small-label-lote">Lote：${lote}</div>
    </div>
  `).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>小标签打印</title>
<style>
  @page { size: 40mm 25mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, "Microsoft YaHei", sans-serif; color: #000; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .small-label {
    width: 40mm;
    height: 25mm;
    box-sizing: border-box;
    padding: 2.4mm 2.8mm;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1.2mm;
    page-break-after: always;
    overflow: hidden;
  }
  .small-label:last-child { page-break-after: auto; }
  .small-label-line {
    display: block;
    white-space: nowrap;
  }
  .small-label-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1.4mm;
  }
  .small-label-note {
    font-size: 3.6mm;
    line-height: 1.1;
    font-weight: 700;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .small-label-title {
    font-size: 4.1mm;
    line-height: 1.1;
    font-weight: 700;
    flex: 0 0 auto;
  }
  .small-label-date {
    font-size: 4.9mm;
    line-height: 1.1;
    font-weight: 800;
  }
  .small-label-lote {
    font-size: 4.9mm;
    line-height: 1.1;
    font-weight: 800;
  }
</style>
</head>
<body>
  ${pages}
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 200); };<\/script>
</body>
</html>`;
}
function openProductionPrintWindow(html, width, height) {
  const printWin = window.open("", "_blank", `width=${width},height=${height}`);
  if (!printWin || printWin.closed) {
    alert("\u6253\u5370\u7A97\u53E3\u88AB\u62E6\u622A");
    return false;
  }
  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
  return true;
}
function formatProductionPrintCountText(entry) {
  const source = entry && typeof entry === "object" ? entry : null;
  if (!source) return "打印0份";
  const boxCount = Math.max(0, parseInt(source.box_count, 10) || 0);
  const smallCopiesPerBox = source.print_small_label ? Math.max(1, parseInt(source.print_small_label_copies, 10) || 1) : 0;
  const largeCopiesPerBox = source.print_large_label ? Math.max(1, parseInt(source.print_large_label_copies, 10) || 1) : 0;
  const parts = [];
  if (smallCopiesPerBox > 0) parts.push(`小${boxCount * smallCopiesPerBox}份`);
  if (largeCopiesPerBox > 0) parts.push(`大${boxCount * largeCopiesPerBox}份`);
  return parts.join(" / ") || "打印0份";
}
function printProductionEntryLabels(entry, options = {}) {
  const source = entry && typeof entry === "object" ? entry : null;
  if (!source) return false;
  const singleCopy = options.singleCopy === true;
  const boxCount = Math.max(0, parseInt(source.box_count, 10) || 0);
  const smallCopiesPerBox = source.print_small_label ? Math.max(1, parseInt(source.print_small_label_copies, 10) || 1) : 0;
  const largeCopiesPerBox = source.print_large_label ? Math.max(1, parseInt(source.print_large_label_copies, 10) || 1) : 0;
  const totalSmallCopies = source.print_small_label ? singleCopy ? 1 : boxCount * smallCopiesPerBox : 0;
  const totalLargeCopies = source.print_large_label ? singleCopy ? 1 : boxCount * largeCopiesPerBox : 0;
  let printed = false;
  if (totalSmallCopies > 0) {
    printed = openProductionPrintWindow(buildProductionSmallLabelHtml(source, totalSmallCopies), 360, 280) || printed;
  }
  if (totalLargeCopies > 0) {
    printed = openProductionPrintWindow(buildProductionLabelHtml(source), 520, 420) || printed;
  }
  if (!printed && totalSmallCopies <= 0 && totalLargeCopies <= 0) {
    showAppToast("\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u52FE\u9009\u9700\u8981\u6253\u5370\u7684\u5C0F\u6807\u7B7E\u6216\u5927\u6807\u7B7E");
    return false;
  }
  if (printed) showAppToast("\u5DF2\u6253\u5F00\u6253\u5370\u673A\u9009\u62E9\u7A97\u53E3");
  return printed;
}
window.printProductionEntryLabels = function(id) {
  const entry = currentProductionEntryList.find((x) => Number(x.id) === Number(id));
  if (!entry) return;
  printProductionEntryLabels(entry, { singleCopy: true });
};
async function approveProductionEntry(id) {
  openConfirm("\u786E\u8BA4\u5BA1\u6838\u8FD9\u6761\u65B0\u751F\u4EA7\u8BB0\u5F55\u5417\uFF1F\u786E\u8BA4\u540E\u4F1A\u81EA\u52A8\u5165\u5E93\u5B58\uFF0C\u52FE\u9009\u4E86\u201C\u662F\u5426\u6253\u5370\u201D\u7684\u5546\u54C1\u624D\u4F1A\u89E6\u53D1\u6253\u5370\u3002", async () => {
    const res = await fetchWithAuth(`/api/production-entries/${id}/review`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" })
    });
    if (!res.ok) {
      return alert("\u5BA1\u6838\u5931\u8D25");
    }
    const data = await res.json();
    const entry = data.entry || currentProductionEntryList.find((x) => Number(x.id) === Number(id));
    const allowPrint = entry ? entry.print_label_enabled !== false : true;
    const printedAnything = allowPrint && entry ? printProductionEntryLabels(entry) : false;
    showAppToast(printedAnything ? "\u5BA1\u6838\u901A\u8FC7\uFF0C\u5DF2\u81EA\u52A8\u5165\u5E93\u5E76\u89E6\u53D1\u6253\u5370" : "\u5BA1\u6838\u901A\u8FC7\uFF0C\u5DF2\u81EA\u52A8\u5165\u5E93\u5E76\u8DF3\u8FC7\u6253\u5370");
    loadProductionEntries(productionReviewCurrentTab, null, 1);
    updateGlobalBadges();
  });
}
window.approveProductionEntry = approveProductionEntry;
async function rejectProductionEntry(id) {
  const reason = prompt("\u8BF7\u8F93\u5165\u9A73\u56DE\u539F\u56E0", "");
  if (reason === null) return;
  const res = await fetchWithAuth(`/api/production-entries/${id}/review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reject", reason: String(reason || "").trim() })
  });
  if (!res.ok) return alert("\u9A73\u56DE\u5931\u8D25");
  showAppToast("\u5DF2\u9A73\u56DE");
  loadProductionEntries(productionReviewCurrentTab, null, 1);
  updateGlobalBadges();
}
window.rejectProductionEntry = rejectProductionEntry;
async function loadKnowledgeBase(tab = "internal", btn = null, page = 1) {
  var _a2, _b2;
  knowledgeBaseCurrentTab = tab === "surrounding" ? "surrounding" : "internal";
  knowledgeBasePage = page;
  if (btn) {
    document.querySelectorAll("#page-knowledge-base .tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  } else {
    const tBtn = document.querySelector(`#page-knowledge-base .tab[data-tab="${knowledgeBaseCurrentTab}"]`);
    if (tBtn) {
      document.querySelectorAll("#page-knowledge-base .tab").forEach((b) => b.classList.remove("active"));
      tBtn.classList.add("active");
    }
  }
  const q = ((_b2 = (_a2 = document.getElementById("knowledge-base-search")) == null ? void 0 : _a2.value) == null ? void 0 : _b2.trim()) || "";
  const res = await fetchWithAuth(`/api/knowledge-base?category=${knowledgeBaseCurrentTab}&page=${knowledgeBasePage}&size=${knowledgeBasePageSize}&q=${encodeURIComponent(q)}&_t=${Date.now()}`);
  if (!res.ok) return;
  const data = await res.json();
  currentKnowledgeBaseList = data.list || [];
  knowledgeBaseTotal = data.total || 0;
  const tbody = document.getElementById("knowledge-base-rows");
  if (!tbody) return;
  if (!currentKnowledgeBaseList.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="6">\u6682\u65E0\u6570\u636E</td></tr>';
    renderKnowledgeBasePager();
    return;
  }
  tbody.innerHTML = currentKnowledgeBaseList.map((x, idx) => `
    <tr>
      <td>${knowledgeBaseTotal - (knowledgeBasePage - 1) * knowledgeBasePageSize - idx}</td>
      <td>${escapeHtml(x.title || "")}</td>
      <td style="white-space:pre-wrap; word-break:break-word">${escapeHtml(x.content || "")}</td>
      <td>${formatDateTime(Number(x.created_at || 0))}</td>
      <td>${escapeHtml(x.created_by || "")}</td>
      <td>
        <button class="btn-secondary" style="padding:4px 10px; font-size:12px" onclick="openKnowledgeBaseModal(${x.id})">\u7F16\u8F91</button>
      </td>
    </tr>
  `).join("");
  renderKnowledgeBasePager();
}
window.loadKnowledgeBase = loadKnowledgeBase;
function renderKnowledgeBasePager() {
  const pager = document.getElementById("knowledge-base-pager");
  if (!pager) return;
  if (knowledgeBaseTotal <= knowledgeBasePageSize) {
    pager.style.display = "none";
    pager.innerHTML = "";
    return;
  }
  const totalPages = Math.max(1, Math.ceil(knowledgeBaseTotal / knowledgeBasePageSize));
  pager.style.display = "flex";
  pager.innerHTML = `
    <button class="btn-secondary" ${knowledgeBasePage <= 1 ? "disabled" : ""} onclick="loadKnowledgeBase('${knowledgeBaseCurrentTab}', null, ${Math.max(1, knowledgeBasePage - 1)})">\u4E0A\u4E00\u9875</button>
    <span>\u7B2C ${knowledgeBasePage} / ${totalPages} \u9875</span>
    <button class="btn-secondary" ${knowledgeBasePage >= totalPages ? "disabled" : ""} onclick="loadKnowledgeBase('${knowledgeBaseCurrentTab}', null, ${Math.min(totalPages, knowledgeBasePage + 1)})">\u4E0B\u4E00\u9875</button>
  `;
}
function handleKnowledgeBaseSearchInput() {
  loadKnowledgeBase(knowledgeBaseCurrentTab, null, 1);
}
window.handleKnowledgeBaseSearchInput = handleKnowledgeBaseSearchInput;
function openKnowledgeBaseModal(id = null) {
  const modal = document.getElementById("knowledge-base-modal");
  const title = document.getElementById("knowledge-base-modal-title");
  const idInput = document.getElementById("knowledge-base-id");
  const titleInput = document.getElementById("knowledge-base-title-input");
  const contentInput = document.getElementById("knowledge-base-content-input");
  if (!modal || !title || !idInput || !titleInput || !contentInput) return;
  if (!id) {
    title.textContent = "\u6DFB\u52A0\u77E5\u8BC6\u5E93\u5185\u5BB9";
    idInput.value = "";
    titleInput.value = "";
    contentInput.value = "";
  } else {
    const item = currentKnowledgeBaseList.find((x) => Number(x.id) === Number(id));
    if (!item) return;
    title.textContent = "\u7F16\u8F91\u77E5\u8BC6\u5E93\u5185\u5BB9";
    idInput.value = String(item.id);
    titleInput.value = item.title || "";
    contentInput.value = item.content || "";
  }
  modal.style.display = "flex";
}
window.openKnowledgeBaseModal = openKnowledgeBaseModal;
function closeKnowledgeBaseModal() {
  const modal = document.getElementById("knowledge-base-modal");
  if (modal) modal.style.display = "none";
}
window.closeKnowledgeBaseModal = closeKnowledgeBaseModal;
async function saveKnowledgeBaseEntry() {
  var _a2, _b2, _c2, _d, _e;
  const id = Number(((_a2 = document.getElementById("knowledge-base-id")) == null ? void 0 : _a2.value) || 0);
  const title = ((_c2 = (_b2 = document.getElementById("knowledge-base-title-input")) == null ? void 0 : _b2.value) == null ? void 0 : _c2.trim()) || "";
  const content = ((_e = (_d = document.getElementById("knowledge-base-content-input")) == null ? void 0 : _d.value) == null ? void 0 : _e.trim()) || "";
  if (!title) return alert("\u8BF7\u8F93\u5165\u6807\u9898");
  if (!content) return alert("\u8BF7\u8F93\u5165\u5185\u5BB9");
  const payload = { title, content, category: knowledgeBaseCurrentTab };
  const res = await fetchWithAuth(id ? `/api/knowledge-base/${id}` : "/api/knowledge-base", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return alert("\u4FDD\u5B58\u5931\u8D25");
  closeKnowledgeBaseModal();
  showAppToast("\u4FDD\u5B58\u6210\u529F");
  loadKnowledgeBase(knowledgeBaseCurrentTab, null, 1);
}
window.saveKnowledgeBaseEntry = saveKnowledgeBaseEntry;
async function saveRawStock() {
  if (rsAddItems.length === 0) return alert("\u8BF7\u9009\u62E9\u539F\u6750\u6599");
  document.querySelectorAll(".rs-item-qty").forEach((el) => {
    if (rsAddItems[el.dataset.idx]) rsAddItems[el.dataset.idx].qty = el.value;
  });
  document.querySelectorAll(".rs-item-lote").forEach((el) => {
    if (rsAddItems[el.dataset.idx]) rsAddItems[el.dataset.idx].lote = normalizeRawStockLoteInput(el.value);
  });
  document.querySelectorAll(".rs-item-expiry").forEach((el) => {
    if (rsAddItems[el.dataset.idx]) rsAddItems[el.dataset.idx].expiry = el.value;
  });
  const invalid = rsAddItems.find((i) => !i.qty || Number(i.qty) <= 0 || !i.lote || !i.expiry);
  if (invalid) {
    return alert(`\u8BF7\u586B\u5199\u5B8C\u6574\u7684\u6570\u91CF\u3001Lote\u548C\u8FC7\u671F\u65F6\u95F4 (${invalid.name})`);
  }
  const res = await fetchWithAuth("/api/inventory/raw", {
    method: "POST",
    body: JSON.stringify({
      merchant_id: Number((rsSelectedMerchant == null ? void 0 : rsSelectedMerchant.id) || 0) || null,
      merchant_name: String((rsSelectedMerchant == null ? void 0 : rsSelectedMerchant.name) || "").trim(),
      category: String((rsCategorySelect == null ? void 0 : rsCategorySelect.value) || "其它").trim(),
      items: rsAddItems
    })
  });
  if (!res.ok) return alert("\u4FDD\u5B58\u5931\u8D25");
  document.getElementById("rs-add-modal").style.display = "none";
  rsAddItems = [];
  rsSelectedMerchant = { id: 0, name: "" };
  rsPendingMerchantSelection = { id: 0, name: "" };
  renderRawStockMerchantSelection();
  loadRawStock(rsPage);
  loadRawStockRecords(1);
  loadRawStockAdjustments(rsAdjustPage);
}
window.saveRawStock = saveRawStock;
function openRawStockAdjustment(encodedMaterial) {
  const m = typeof encodedMaterial === "string" ? JSON.parse(decodeURIComponent(encodedMaterial)) : encodedMaterial;
  if (!m) return;
  rsAdjustState = {
    materialId: m.id,
    name: m.name || "",
    batches: buildRawBatches(m.batches)
  };
  const defaultBatch = rsAdjustState.batches[0] || {};
  document.getElementById("rs-adjust-material-id").value = m.id;
  document.getElementById("rs-adjust-notes").value = "";
  document.getElementById("rs-adjust-tbody").innerHTML = `
    <tr>
      <td>${escapeHtml(m.name || "")}</td>
      <td><input id="rs-adjust-qty" type="number" step="0.01" style="width:100%" placeholder="\u53EF\u586B\u6B63\u8D1F\u6570"></td>
      <td>${rsAdjustState.batches.length ? `
        <select id="rs-adjust-expiry" style="width:100%">
          ${rsAdjustState.batches.map((b) => `<option value="${escapeHtml(b.expiry || "")}" ${String(b.expiry || "") === String(defaultBatch.expiry || "") ? "selected" : ""}>${escapeHtml(`${b.expiry || "\u65E0\u8FC7\u671F\u65F6\u95F4"} / \u5E93\u5B58:${b.qty}`)}</option>`).join("")}
        </select>
      ` : `
        <input id="rs-adjust-expiry" type="date" value="" style="width:100%">
      `}</td>
    </tr>
  `;
  document.getElementById("rs-adjust-modal").style.display = "flex";
}
window.openRawStockAdjustment = openRawStockAdjustment;
async function saveRawStockAdjustment() {
  const materialId = Number(document.getElementById("rs-adjust-material-id").value || 0);
  const qty = Number(document.getElementById("rs-adjust-qty").value || 0);
  const expiry = (document.getElementById("rs-adjust-expiry").value || "").trim();
  const notes = (document.getElementById("rs-adjust-notes").value || "").trim();
  if (!materialId || !Number.isFinite(qty) || qty === 0) return alert("\u8BF7\u586B\u5199\u6709\u6548\u6570\u91CF");
  if (!notes) return alert("\u8BF7\u586B\u5199\u5907\u6CE8");
  const res = await fetchWithAuth("/api/inventory/raw/adjust", {
    method: "PUT",
    body: JSON.stringify({ materialId, qty, expiry, notes })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alert(
      err.error === "bad_request" ? "\u8BF7\u586B\u5199\u5B8C\u6574\u8C03\u6574\u4FE1\u606F" : err.error === "not_found" ? "\u539F\u6750\u6599\u4E0D\u5B58\u5728" : err.error === "batch_not_found" ? "\u6240\u9009\u6279\u6B21\u4E0D\u5B58\u5728" : err.error === "insufficient_batch_stock" ? `\u6240\u9009\u6279\u6B21\u5E93\u5B58\u4E0D\u8DB3\uFF0C\u5F53\u524D\u53EF\u8C03\u6574 ${Number(err.availableQty || 0)}` : "\u4FDD\u5B58\u5931\u8D25"
    );
  }
  document.getElementById("rs-adjust-modal").style.display = "none";
  if (rsCurrentTab === "adjust") loadRawStockAdjustments(rsAdjustPage);
  loadRawStock(rsPage);
  loadRawStockRecords(1);
}
window.saveRawStockAdjustment = saveRawStockAdjustment;
window.toggleSidebar = function() {
  document.querySelector(".sidebar").classList.toggle("open");
  document.querySelector(".sidebar-overlay").classList.toggle("open");
};
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav a").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        document.querySelector(".sidebar").classList.remove("open");
        document.querySelector(".sidebar-overlay").classList.remove("open");
      }
    });
  });
});
async function updateGlobalBadges() {
  var _a2, _b2;
  if (!localStorage.getItem("authToken")) return;
  const requestSeq = ++globalBadgesRequestSeq;
  try {
    let taskCount = 0;
    try {
      const tRes = await fetchWithAuth(`/api/tasks?status=new&size=1&_t=${Date.now()}`);
      if (tRes.ok) {
        const tData = await tRes.json();
        taskCount = Number(((_a2 = tData.stats) == null ? void 0 : _a2.new_count) || 0) + Number(((_b2 = tData.stats) == null ? void 0 : _b2.review_count) || 0);
      }
    } catch (e) {
    }
    let orderCount = 0;
    try {
      const oRes = await fetchWithAuth(`/api/daily-orders/stats?_t=${Date.now()}`);
      if (oRes.ok) {
        const oStats = await oRes.json();
        orderCount = Number(oStats.new || 0);
      }
    } catch (e) {
    }
    let dailyOrderPendingOpsCount = 0;
    try {
      const orderActionData = await apiDailyOrderPendingOps();
      dailyOrderPendingOpsCount = Number((orderActionData == null ? void 0 : orderActionData.total) || 0) || 0;
    } catch (e) {
    }
    let eventRecordCount = 0;
    try {
      const eRes = await fetchWithAuth(`/api/event-records?status=ongoing&page=1&size=1&_t=${Date.now()}`);
      if (eRes.ok) {
        const eData = await eRes.json();
        eventRecordCount = Number(eData.total || 0);
      }
    } catch (e) {
    }
    let productionReviewCount = 0;
    try {
      if (typeof can !== "function" || can("production_review", "view")) {
        const pRes = await fetchWithAuth(`/api/production-entries?status=pending&page=1&size=1&_t=${Date.now()}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          productionReviewCount = Number(pData.total || 0);
        }
      }
    } catch (e) {
    }
    let logisticsOngoingCount = null;
    try {
      const r = await fetchWithAuth(`/api/logistics/records?status=ongoing&_t=${Date.now()}`);
      if (r.ok) {
        const list = await r.json().catch(() => []);
        logisticsOngoingCount = mergeLogisticsRecordsWithLocal("ongoing", list).length;
      } else if (r.status === 404) {
        const all = loadLocalLogisticsRecords();
        logisticsOngoingCount = (Array.isArray(all) ? all : []).filter((x) => getLogisticsRecordStatus(x) === "ongoing").length;
      }
    } catch (e) {
    }
    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = n;
        el.style.display = n > 0 ? "inline-block" : "none";
      }
    };
    if (requestSeq !== globalBadgesRequestSeq) return;
    updateNavTaskBadgeCount(taskCount);
    updateNavOrderBadgeCount(orderCount);
    if (logisticsOngoingCount !== null) {
      updateLogisticsOngoingBadgeCount(logisticsOngoingCount);
    }
    setBadge("tab-event-record-ongoing-badge", eventRecordCount);
    setBadge("fs-tab-review-badge", productionReviewCount);
    updateTopProductionReviewAlert(productionReviewCount);
    updateTopOrderActionAlert(dailyOrderPendingOpsCount);
  } catch (e) {
    console.error("Badge update failed", e);
  }
}
setInterval(updateGlobalBadges, 3e4);
if (navTaskBadgeCountCache !== null) updateNavTaskBadgeCount(navTaskBadgeCountCache);
if (navOrderBadgeCountCache !== null) updateNavOrderBadgeCount(navOrderBadgeCountCache);
if (logisticsOngoingBadgeCountCache !== null) updateLogisticsOngoingBadgeCount(logisticsOngoingBadgeCountCache);
updateNavDailyOpsBadgeCount();
if (localStorage.getItem("authToken")) {
  updateGlobalBadges();
}
window.addEventListener("focus", updateGlobalBadges);
window.addEventListener("pageshow", updateGlobalBadges);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") updateGlobalBadges();
});
window.addEventListener("online", updateGlobalBadges);
