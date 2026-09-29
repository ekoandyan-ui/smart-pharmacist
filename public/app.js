const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let pageRole = null;

function setRole(role) {
  pageRole = role;
}

function getToken(role = pageRole) {
  return role ? localStorage.getItem(`sp_token_${role}`) || "" : "";
}

function writeToken(role, token) {
  const key = `sp_token_${role}`;
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
}

async function api(u, m, b, withAuth = true) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (withAuth && token) headers.Authorization = "Bearer " + token;

  const r = await fetch(u, m ? {
    method: m,
    headers,
    body: JSON.stringify(b)
  } : (withAuth && token ? { headers } : undefined));

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (withAuth && r.status === 401 && pageRole) writeToken(pageRole, "");
    throw new Error(d.error || "Gagal");
  }
  return d;
}

const chatHtml = (c) =>
  c.map((x) => `<div><b>${esc(x.pengirim)}:</b> ${esc(x.pesan)}</div>`).join("") || '<span class="m">Belum ada pesan</span>';

function renderAuth(role) {
  const label = role === "apoteker" ? "Apoteker" : "Kurir";
  const panel = $("#panel");

  if (getToken(role)) {
    panel.innerHTML = `
      <div class="card">
        <div class="login-meta">
          <h2>${label}</h2>
          <button class="p secondary" onclick="logoutRole('${role}')">Logout</button>
        </div>
        <p class="m">Login aktif: ${label}</p>
      </div>
    `;
    return;
  }

  if (panel.querySelector(`#${role}-user`)) return;
  panel.innerHTML = `
    <div class="card">
      <h2>Login ${label}</h2>
      <div class="login-box">
        <input id="${role}-user" placeholder="Username" />
        <input id="${role}-pass" type="password" placeholder="Password" />
        <button class="p" onclick="loginRole('${role}')">Masuk</button>
        <p id="${role}-msg" class="m"></p>
      </div>
    </div>
  `;
}

async function loginRole(role) {
  const username = document.querySelector(`#${role}-user`)?.value.trim() || "";
  const password = document.querySelector(`#${role}-pass`)?.value || "";
  const msg = document.querySelector(`#${role}-msg`);

  try {
    const data = await api("/api/auth/login", "POST", { role, username, password }, false);
    writeToken(role, data.token);
    muat();
  } catch (e) {
    if (msg) msg.textContent = e.message;
  }
}

async function logoutRole(role) {
  try {
    await api("/api/auth/logout", "POST", {});
    writeToken(role, "");
    renderAuth(role);
  } catch (e) {
    alert(e.message);
    if (!getToken(role)) renderAuth(role);
  }
}
