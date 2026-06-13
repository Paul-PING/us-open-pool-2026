// ──────────────────────────────────────────────────────────────────────────────
// Admin page — gated by the admin_passcode stored in the settings table.
//
// What the admin can do:
//   • Set each drafted golfer's finishing position (auto-saved)
//   • Edit the draft cutoff time
//   • Edit the admin passcode
//   • Reset all results (e.g. start over)
// ──────────────────────────────────────────────────────────────────────────────

const SCORING = [
  { finish: "Winner",     pts: 100 },
  { finish: "2nd",        pts: 60  },
  { finish: "3rd",        pts: 45  },
  { finish: "T4–5",       pts: 30  },
  { finish: "T6–10",      pts: 20  },
  { finish: "T11–20",     pts: 10  },
  { finish: "T21–30",     pts: 5   },
  { finish: "Made Cut",   pts: 2   },
  { finish: "Missed Cut", pts: 0   },
];

let supa = null;
let golfers = [];
let participants = [];
let picks = [];
let results = [];
let settings = {};
let authed = false;

(async function boot() {
  if (!window.CONFIG || window.CONFIG.SUPABASE_URL.includes("PASTE")) {
    document.getElementById("app").innerHTML = `
      <div class="max-w-md mx-auto p-8 text-center">
        <h1 class="text-2xl font-bold text-yellow-400 mb-3">⛳ Almost ready</h1>
        <p class="text-gray-400 text-sm">Edit <code class="text-yellow-300">config.js</code> first, then refresh.</p>
      </div>`;
    return;
  }
  supa = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  golfers = await (await fetch("golfers.json")).json();
  await refreshAll();

  // Restore previous admin session
  if (sessionStorage.getItem("admin_ok") === settings.admin_passcode) authed = true;

  render();
})();

async function refreshAll() {
  const [p, pk, r, s] = await Promise.all([
    supa.from("participants").select("*").order("created_at"),
    supa.from("picks").select("*"),
    supa.from("results").select("*"),
    supa.from("settings").select("*"),
  ]);
  participants = p.data || [];
  picks = pk.data || [];
  results = r.data || [];
  settings = Object.fromEntries((s.data || []).map(row => [row.key, row.value]));
}

function golfer(id) { return golfers.find(g => g.id === id); }
function pickersOf(golferId) {
  return picks
    .filter(p => p.golfer_id === golferId)
    .map(p => participants.find(x => x.id === p.participant_id)?.name)
    .filter(Boolean);
}

async function tryLogin() {
  const v = document.getElementById("admin-pw").value;
  if (v === settings.admin_passcode) {
    authed = true;
    sessionStorage.setItem("admin_ok", v);
    render();
  } else {
    alert("Wrong passcode.");
  }
}

function logout() {
  authed = false;
  sessionStorage.removeItem("admin_ok");
  render();
}

async function setResult(golferId, finish, points) {
  const existing = results.find(r => r.golfer_id === golferId);
  if (finish === "") {
    if (existing) {
      await supa.from("results").delete().eq("golfer_id", golferId);
    }
  } else {
    await supa.from("results").upsert({ golfer_id: golferId, finish, points });
  }
  await refreshAll();
  render();
}

async function setSetting(key, value) {
  await supa.from("settings").upsert({ key, value });
  await refreshAll();
  render();
}

async function saveCutoff() {
  const local = document.getElementById("cutoff-input").value;
  if (!local) return;
  const iso = new Date(local).toISOString();
  await setSetting("draft_cutoff", iso);
  alert("Cutoff updated.");
}

async function savePasscode() {
  const v = document.getElementById("new-pw").value.trim();
  if (!v || v.length < 4) return alert("Passcode must be at least 4 characters.");
  if (!confirm("Change the admin passcode? You'll need the new one next time.")) return;
  await setSetting("admin_passcode", v);
  sessionStorage.setItem("admin_ok", v);
  alert("Passcode updated.");
}

async function clearAllResults() {
  if (!confirm("Wipe ALL entered results? This can't be undone.")) return;
  await supa.from("results").delete().neq("golfer_id", -1);
  await refreshAll();
  render();
}

function render() {
  const app = document.getElementById("app");
  app.className = "";
  if (!authed) { app.innerHTML = loginView(); return; }
  app.innerHTML = adminView();
}

function loginView() {
  return `
    <div class="max-w-md mx-auto p-8 mt-12">
      <div class="text-center mb-8">
        <div class="text-5xl mb-2">🔒</div>
        <h1 class="text-2xl font-bold text-yellow-400">Admin</h1>
      </div>
      <div class="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1">Admin passcode</label>
        <input id="admin-pw" type="password" autocomplete="current-password"
          class="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 mb-4 focus:border-yellow-400 focus:outline-none">
        <button onclick="tryLogin()"
          class="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm py-2.5 rounded-lg">
          Enter
        </button>
        <p class="text-xs text-gray-500 mt-3 text-center">
          Default is <code class="text-yellow-300">changeme</code>. Set a real one once you're in.
        </p>
      </div>
      <p class="text-center mt-4">
        <a href="index.html" class="text-xs text-gray-500 hover:text-gray-300">← back to the pool</a>
      </p>
    </div>`;
}

function adminView() {
  const draftedIds = Array.from(new Set(picks.map(pk => pk.golfer_id)));
  const drafted = draftedIds.map(id => golfer(id)).filter(Boolean);
  drafted.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));

  const cutoffLocal = settings.draft_cutoff
    ? new Date(settings.draft_cutoff).toISOString().slice(0, 16)
    : "";

  const resultsRows = drafted.length === 0
    ? `<p class="text-gray-500 text-sm italic">No golfers have been picked yet.</p>`
    : drafted.map(g => {
        const r = results.find(x => x.golfer_id === g.id);
        const by = pickersOf(g.id);
        return `
          <div class="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
            <div class="min-w-0">
              <p class="text-sm font-semibold truncate">
                <span class="text-xs text-gray-500 mr-1">${g.country}</span>${escapeHtml(g.name)}
              </p>
              <p class="text-xs text-gray-500">$${g.cost}M · picked by ${escapeHtml(by.join(", ") || "?")}</p>
            </div>
            <select onchange="onResultChange(${g.id}, this)"
              class="bg-gray-800 text-white text-sm rounded-lg px-2 py-1 border border-gray-700 ml-3 flex-shrink-0">
              <option value="">— pick —</option>
              ${SCORING.map(s => `<option value="${s.finish}|${s.pts}" ${r?.finish === s.finish ? "selected" : ""}>${s.finish} (${s.pts} pts)</option>`).join("")}
            </select>
          </div>`;
      }).join('<div class="h-1.5"></div>');

  return `
    <div class="border-b border-gray-800 bg-gray-900 px-4 py-4">
      <div class="max-w-3xl mx-auto flex items-center justify-between">
        <h1 class="text-lg font-bold text-yellow-400">⛳ Admin</h1>
        <div class="flex items-center gap-3 text-xs">
          <a href="index.html" class="text-gray-400 hover:text-yellow-400">view pool →</a>
          <button onclick="logout()" class="text-gray-500 hover:text-red-400">sign out</button>
        </div>
      </div>
    </div>

    <div class="max-w-3xl mx-auto px-4 py-5 space-y-6">

      <section>
        <h2 class="text-sm font-semibold text-gray-300 mb-3">Enter finishing positions</h2>
        <p class="text-xs text-gray-500 mb-3">Auto-saves on change. Leaderboard updates live for everyone.</p>
        <div class="flex flex-col gap-1.5">${resultsRows}</div>
        ${drafted.length > 0 ? `
          <button onclick="clearAllResults()" class="mt-4 text-xs text-red-400 hover:text-red-300">Wipe all results</button>
        ` : ""}
      </section>

      <section class="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h2 class="text-sm font-semibold text-gray-300 mb-3">Draft cutoff</h2>
        <p class="text-xs text-gray-500 mb-3">
          Current: ${settings.draft_cutoff ? new Date(settings.draft_cutoff).toLocaleString() : "(not set)"}
        </p>
        <div class="flex gap-2">
          <input id="cutoff-input" type="datetime-local" value="${cutoffLocal}"
            class="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700">
          <button onclick="saveCutoff()" class="bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-sm font-semibold px-4 rounded-lg">Save</button>
        </div>
      </section>

      <section class="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <h2 class="text-sm font-semibold text-gray-300 mb-3">Admin passcode</h2>
        <div class="flex gap-2">
          <input id="new-pw" type="text" placeholder="New admin passcode"
            class="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700">
          <button onclick="savePasscode()" class="bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-sm font-semibold px-4 rounded-lg">Change</button>
        </div>
      </section>

    </div>`;
}

function onResultChange(golferId, sel) {
  const v = sel.value;
  if (!v) { setResult(golferId, "", 0); return; }
  const [finish, ptsStr] = v.split("|");
  setResult(golferId, finish, Number(ptsStr));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.tryLogin = tryLogin;
window.logout = logout;
window.onResultChange = onResultChange;
window.saveCutoff = saveCutoff;
window.savePasscode = savePasscode;
window.clearAllResults = clearAllResults;
