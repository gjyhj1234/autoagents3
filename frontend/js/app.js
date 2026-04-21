/**
 * 患者管理系统 — 前端逻辑
 * 依赖：无第三方库，纯原生 JavaScript（ES2020+）
 */

const API = "/api/patients";

// ─── 状态 ─────────────────────────────────────────────────────────────────────
let state = {
  page: 1,
  pageSize: 20,
  total: 0,
  filters: { name: "", gender: "", phone: "" },
  currentDetailId: null,
  deleteTargetId: null,
};

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showView(name) {
  ["list", "form", "detail"].forEach(v => {
    $(`view-${v}`).classList.toggle("hidden", v !== name);
  });
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const json = await res.json();
  return { status: res.status, ...json };
}

function formatDate(s) {
  if (!s) return "—";
  return s.replace("T", " ").slice(0, 19);
}

// ─── 列表页 ───────────────────────────────────────────────────────────────────

async function loadList() {
  const loading = $("loading");
  loading.classList.remove("hidden");

  const params = new URLSearchParams({
    page: state.page,
    page_size: state.pageSize,
  });
  if (state.filters.name)   params.append("name",   state.filters.name);
  if (state.filters.gender) params.append("gender", state.filters.gender);
  if (state.filters.phone)  params.append("phone",  state.filters.phone);

  try {
    const res = await fetch(`${API}?${params}`);
    const json = await res.json();
    if (json.code !== 0) { alert("加载失败：" + json.message); return; }

    state.total = json.data.total;
    renderTable(json.data.items);
    renderPagination();
  } catch (e) {
    alert("网络错误：" + e.message);
  } finally {
    loading.classList.add("hidden");
  }
}

function renderTable(items) {
  const tbody = $("patient-tbody");
  if (!items.length) {
    tbody.innerHTML = `<tr id="empty-row"><td colspan="6" class="empty-cell">暂无患者信息，点击右上角新增</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((p, idx) => {
    const rowNum = (state.page - 1) * state.pageSize + idx + 1;
    return `
      <tr>
        <td>${rowNum}</td>
        <td><button class="btn-link" onclick="openDetail(${p.id})">${escHtml(p.name)}</button></td>
        <td>${escHtml(p.gender)}</td>
        <td>${p.birth_date || "—"}</td>
        <td>${escHtml(p.phone)}</td>
        <td>
          <button class="btn-link" onclick="openDetail(${p.id})">查看</button>
          <button class="btn-link" onclick="openEdit(${p.id})">编辑</button>
          <button class="btn-link danger" onclick="confirmDelete(${p.id}, '${escAttr(p.name)}')">删除</button>
        </td>
      </tr>`;
  }).join("");
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escAttr(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function renderPagination() {
  const pg = $("pagination");
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (totalPages <= 1 && state.total <= state.pageSize) {
    pg.innerHTML = `<span class="page-info">共 ${state.total} 条</span>`;
    return;
  }
  pg.innerHTML = `
    <button class="btn btn-default btn-sm" onclick="goPage(${state.page - 1})" ${state.page <= 1 ? "disabled" : ""}>« 上一页</button>
    <span class="page-info">第 ${state.page} / ${totalPages} 页，共 ${state.total} 条</span>
    <button class="btn btn-default btn-sm" onclick="goPage(${state.page + 1})" ${state.page >= totalPages ? "disabled" : ""}>下一页 »</button>
  `;
}

function goPage(p) {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  state.page = Math.max(1, Math.min(p, totalPages));
  loadList();
}

// ─── 详情页 ───────────────────────────────────────────────────────────────────

async function openDetail(id) {
  const res = await api("GET", `/${id}`);
  if (res.code !== 0) { alert("获取失败：" + res.message); return; }
  const p = res.data;
  state.currentDetailId = id;

  const fields = [
    ["姓名",     p.name],
    ["性别",     p.gender],
    ["出生日期", p.birth_date],
    ["联系电话", p.phone],
    ["身份证号", p.id_card || "—"],
    ["地址",     p.address || "—"],
    ["过敏史",   p.allergy || "—"],
    ["备注",     p.remark  || "—"],
    ["创建时间", formatDate(p.created_at)],
    ["最后修改", formatDate(p.updated_at)],
  ];
  $("detail-tbody").innerHTML = fields
    .map(([k, v]) => `<tr><th>${escHtml(k)}</th><td>${escHtml(String(v))}</td></tr>`)
    .join("");

  showView("detail");
}

// ─── 新增 / 编辑表单 ──────────────────────────────────────────────────────────

function clearFormErrors() {
  ["name", "gender", "birth-date", "phone", "id-card"].forEach(f => {
    const el = $(`err-${f}`);
    if (el) el.textContent = "";
  });
  ["field-name", "field-birth-date", "field-phone", "field-id-card"].forEach(id => {
    const el = $(id);
    if (el) el.classList.remove("invalid");
  });
  $("form-error").classList.add("hidden");
  $("form-error").textContent = "";
}

function openNew() {
  $("form-title").textContent = "新增患者";
  $("field-id").value = "";
  $("field-name").value = "";
  document.querySelectorAll('input[name="gender"]').forEach(r => r.checked = false);
  $("field-birth-date").value = "";
  $("field-phone").value = "";
  $("field-id-card").value = "";
  $("field-address").value = "";
  $("field-allergy").value = "";
  $("field-remark").value = "";
  clearFormErrors();
  showView("form");
}

async function openEdit(id) {
  const res = await api("GET", `/${id}`);
  if (res.code !== 0) { alert("获取失败：" + res.message); return; }
  const p = res.data;

  $("form-title").textContent = "编辑患者";
  $("field-id").value = p.id;
  $("field-name").value = p.name || "";
  document.querySelectorAll('input[name="gender"]').forEach(r => {
    r.checked = r.value === p.gender;
  });
  $("field-birth-date").value = p.birth_date || "";
  $("field-phone").value = p.phone || "";
  $("field-id-card").value = p.id_card || "";
  $("field-address").value = p.address || "";
  $("field-allergy").value = p.allergy || "";
  $("field-remark").value = p.remark || "";
  clearFormErrors();
  showView("form");
}

// ─── 表单提交 ─────────────────────────────────────────────────────────────────

$("patient-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearFormErrors();

  const id       = $("field-id").value;
  const name     = $("field-name").value.trim();
  const gender   = (document.querySelector('input[name="gender"]:checked') || {}).value || "";
  const birthDate = $("field-birth-date").value;
  const phone    = $("field-phone").value.trim();
  const idCard   = $("field-id-card").value.trim();

  let valid = true;
  if (!name) {
    $("err-name").textContent = "姓名不能为空";
    $("field-name").classList.add("invalid");
    valid = false;
  }
  if (!gender) {
    $("err-gender").textContent = "请选择性别";
    valid = false;
  }
  if (!birthDate) {
    $("err-birth-date").textContent = "请选择出生日期";
    $("field-birth-date").classList.add("invalid");
    valid = false;
  }
  if (!/^\d{11}$/.test(phone)) {
    $("err-phone").textContent = "手机号须为 11 位数字";
    $("field-phone").classList.add("invalid");
    valid = false;
  }
  if (!valid) return;

  const body = {
    name,
    gender,
    birth_date: birthDate,
    phone,
    id_card:  idCard  || null,
    address:  $("field-address").value.trim()  || null,
    allergy:  $("field-allergy").value.trim()  || null,
    remark:   $("field-remark").value.trim()   || null,
  };

  const btn = $("btn-submit");
  btn.disabled = true;
  btn.textContent = "保存中…";

  try {
    let res;
    if (id) {
      res = await api("PUT", `/${id}`, body);
    } else {
      res = await api("POST", "", body);
    }

    if (res.code !== 0) {
      const errEl = $("form-error");
      errEl.textContent = res.message;
      errEl.classList.remove("hidden");
      return;
    }

    // 保存成功 → 跳详情
    await openDetail(res.data.id);
  } catch (ex) {
    const errEl = $("form-error");
    errEl.textContent = "网络错误：" + ex.message;
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "保存";
  }
});

// ─── 删除流程 ─────────────────────────────────────────────────────────────────

function confirmDelete(id, name) {
  state.deleteTargetId = id;
  $("modal-message").textContent = `确认删除患者「${name}」？此操作不可恢复。`;
  $("modal-overlay").classList.remove("hidden");
}

$("btn-modal-cancel").addEventListener("click", () => {
  $("modal-overlay").classList.add("hidden");
  state.deleteTargetId = null;
});

$("btn-modal-confirm").addEventListener("click", async () => {
  const id = state.deleteTargetId;
  $("modal-overlay").classList.add("hidden");
  state.deleteTargetId = null;
  if (!id) return;

  const res = await api("DELETE", `/${id}`);
  if (res.code !== 0) { alert("删除失败：" + res.message); return; }

  state.page = 1;
  showView("list");
  loadList();
});

// ─── 事件绑定 ─────────────────────────────────────────────────────────────────

$("btn-new").addEventListener("click", openNew);

$("btn-search").addEventListener("click", () => {
  state.filters.name   = $("filter-name").value.trim();
  state.filters.gender = $("filter-gender").value;
  state.filters.phone  = $("filter-phone").value.trim();
  state.page = 1;
  loadList();
});

$("btn-reset").addEventListener("click", () => {
  $("filter-name").value   = "";
  $("filter-gender").value = "";
  $("filter-phone").value  = "";
  state.filters = { name: "", gender: "", phone: "" };
  state.page = 1;
  loadList();
});

["filter-name", "filter-phone"].forEach(id => {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-search").click();
  });
});

$("btn-cancel-form").addEventListener("click", () => {
  showView("list");
  loadList();
});

$("btn-back-detail").addEventListener("click", () => {
  showView("list");
  loadList();
});

$("btn-edit-detail").addEventListener("click", () => {
  openEdit(state.currentDetailId);
});

// ─── 初始化 ───────────────────────────────────────────────────────────────────

loadList();
