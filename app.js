// ──────────────────────────────────────────────────────────────────────────────
// 2026 U.S. Open Pool — main app
//
// All state lives in module-scoped variables and Supabase tables. Every
// state change calls render() which redraws the active tab from scratch.
// ──────────────────────────────────────────────────────────────────────────────

const SALARY_CAP = 100;
const ROSTER_SIZE = 5;
const TIERS = {
  1: { label: "Stars" },
  2: { label: "Contenders" },
  3: { label: "Value" },
  4: { label: "Longshots" },
  5: { label: "Wildcards" },
};
const SCORING = [
  { finish: "Winner",      pts: 100 },
  { finish: "2nd",         pts: 60  },
  { finish: "3rd",         pts: 45  },
  { finish: "T4–5",        pts: 30  },
  { finish: "T6–10",       pts: 20  },
  { finish: "T11–20",      pts: 10  },
  { finish: "T21–30",      pts: 5   },
  { finish: "Made Cut",    pts: 2   },
  { finish: "Missed Cut",  pts: 0   },
];

let supa = null;
let golfers = [];
let participants = [];
let picks = [];
let results = [];
let settings = {};
let me = null;

let currentTab = "draft";
let filterTier = 0;
let searchQuery = "";

// ─── boot ──────────────────────────────────────────────────────────────────

(async function boot() {
  if (!window.CONFIG || window.CONFIG.SUPABASE_URL.includes("PASTE")) {
    document.getElementById("app").innerHTML = `
      <div class="max-w-md mx-auto p-8 text-center">
        <h1 class="text-2xl font-bold text-yellow-400 mb-3">⛳ Almost ready</h1>
        <p class="text-gray-400 text-sm">
          Open <code class="text-yellow-300">config.js</code> and paste your
          Supabase URL and anon key. Then refresh this page.
        </p>
      </div>`;
    return;
  }

  supa = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  try {
    const r = await fetch("golfers.json");
    golfers = await r.json();
  } catch (e) {
    document.getElementById("app").innerHTML = `<div class="p-8 text-red-400">Could not load golfers.json</div>`;
    return;
  }

  await refreshAll();

  // Realtime — any pick or result change anywhere triggers re-render
  supa.channel("pool")
    .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, async () => {
      picks = (await supa.from("picks").select("*")).data || [];
      render();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "results" }, async () => {
      results = (await supa.from("results").select("*")).data || [];
      render();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, async () => {
      participants = (await supa.from("participants").select("*").order("created_at")).data || [];
      render();
    })
    .subscribe();

  // Restore session from localStorage
  const savedId = localStorage.getItem("participant_id");
  const savedPasscode = localStorage.getItem("participant_passcode");
  if (savedId && savedPasscode) {
    const found = participants.find(p => p.id === savedId && p.passcode === savedPasscode);
    if (found) me = found;
    else { localStorage.removeItem("participant_id"); localStorage.removeItem("participant_passcode"); }
  }

  render();

  // Re-render every 30s so the cutoff banner stays current
  setInterval(render, 30000);
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

// ─── helpers ───────────────────────────────────────────────────────────────

function golfer(id) { return golfers.find(g => g.id === id); }
function myPicks() { return picks.filter(p => p.participant_id === me?.id); }
function mySpend() { return myPicks().reduce((s, p) => s + (golfer(p.golfer_id)?.cost || 0), 0); }
function pointsFor(golferId) { return results.find(r => r.golfer_id === golferId)?.points ?? null; }
function finishFor(golferId) { return results.find(r => r.golfer_id === golferId)?.finish ?? null; }
function scoreOf(participantId) {
  return picks.filter(p => p.participant_id === participantId)
    .reduce((s, p) => s + (pointsFor(p.golfer_id) || 0), 0);
}
function isClosed() {
  const cutoff = settings.draft_cutoff;
  if (!cutoff) return false;
  return new Date() >= new Date(cutoff);
}
function cutoffText() {
  const c = settings.draft_cutoff;
  if (!c) return "";
  const d = new Date(c);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ─── actions ───────────────────────────────────────────────────────────────

async function signIn() {
  const name = document.getElementById("signin-name").value.trim();
  const passcode = document.getElementById("signin-passcode").value.trim();
  if (!name) return alert("Enter your name.");
  if (!passcode || passcode.length < 3) return alert("Pick a passcode of at least 3 characters — you'll need it to come back later.");

  const existing = participants.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (existing.passcode !== passcode) {
      return alert("That name's already taken and the passcode doesn't match. If that's you, check your passcode. If not, pick a different name.");
    }
    me = existing;
  } else {
    const { data, error } = await supa.from("participants").insert({ name, passcode }).select().single();
    if (error) return alert("Could not sign in: " + error.message);
    me = data;
    await refreshAll();
  }
  localStorage.setItem("participant_id", me.id);
  localStorage.setItem("participant_passcode", me.passcode);
  render();
}

function signOut() {
  localStorage.removeItem("participant_id");
  localStorage.removeItem("participant_passcode");
  me = null;
  render();
}

async function draftGolfer(golferId) {
  if (isClosed()) return alert("Drafting is closed.");
  const g = golfer(golferId);
  if (!g) return;
  if (myPicks().length >= ROSTER_SIZE) return alert(`You already have ${ROSTER_SIZE} picks.`);
  if (mySpend() + g.cost > SALARY_CAP) return alert(`Too expensive — you only have $${SALARY_CAP - mySpend()}M left.`);
  if (myPicks().some(p => p.golfer_id === golferId)) return alert(`${g.name} is already in your roster.`);

  const { error } = await supa.from("picks").insert({ participant_id: me.id, golfer_id: golferId });
  if (error) alert("Could not pick: " + error.message);
  await refreshAll();
  render();
}

async function dropGolfer(golferId) {
  if (isClosed()) return alert("Drafting is closed.");
  const myPick = myPicks().find(p => p.golfer_id === golferId);
  if (!myPick) return;
  const g = golfer(golferId);
  if (!confirm(`Drop ${g.name}?`)) return;
  await supa.from("picks").delete().eq("id", myPick.id);
  await refreshAll();
  render();
}

function switchTab(tab) { currentTab = tab; render(); }
function setFilterTier(t) { filterTier = t; render(); }
function setSearch(v) { searchQuery = v; renderDraftTab(); }

// ─── rendering ─────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById("app");
  if (!me) { app.innerHTML = signInView(); return; }
  app.className = "";
  app.innerHTML = layout();
  renderActiveTab();
}

function signInView() {
  return `
    <div class="max-w-md mx-auto p-8 mt-12">
      <div class="text-center mb-8">
        <div class="text-5xl mb-2">⛳</div>
        <h1 class="text-2xl font-bold text-yellow-400">2026 U.S. Open Pool</h1>
        <p class="text-gray-400 text-sm mt-1">Shinnecock Hills · June 18–21</p>
      </div>
      <div class="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1">Your name</label>
        <input id="signin-name" type="text" autocomplete="off"
          class="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 mb-3 focus:border-yellow-400 focus:outline-none"
          placeholder="e.g. Dave">

        <label class="block text-xs uppercase tracking-wider text-gray-500 mb-1">Passcode</label>
        <input id="signin-passcode" type="text" autocomplete="off"
          class="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 mb-4 focus:border-yellow-400 focus:outline-none"
          placeholder="Pick any 3+ characters">

        <button onclick="signIn()"
          class="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm py-2.5 rounded-lg transition">
          Enter the pool
        </button>
        <p class="text-xs text-gray-500 mt-3 text-center">
          New here? Just pick a name and a passcode and you're in. Same name + passcode to come back later.
        </p>
      </div>
    </div>`;
}

function layout() {
  const closed = isClosed();
  return `
    <div class="border-b border-gray-800 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 px-4 py-4">
      <div class="max-w-3xl mx-auto flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-2xl">⛳</span>
            <h1 class="text-lg font-bold text-yellow-400">2026 U.S. Open Pool</h1>
          </div>
          <p class="text-gray-400 text-xs pl-9">Shinnecock Hills · June 18–21 · $100M cap</p>
        </div>
        <div class="text-right">
          <p class="text-xs text-gray-500">Signed in as</p>
          <p class="text-sm font-semibold">${escapeHtml(me.name)}
            <button onclick="signOut()" class="text-gray-500 hover:text-red-400 text-xs ml-2">sign out</button>
          </p>
        </div>
      </div>
      ${closed ? `
        <div class="max-w-3xl mx-auto mt-3 bg-red-900/40 border border-red-700/50 text-red-200 text-xs px-3 py-2 rounded-lg">
          🔒 Drafting is closed (cutoff was ${cutoffText()}). Rosters and the leaderboard are still live.
        </div>` : `
        <div class="max-w-3xl mx-auto mt-3 text-xs text-gray-500">
          Draft closes ${cutoffText()}
        </div>`}
    </div>

    <div class="border-b border-gray-800 px-4">
      <div class="max-w-3xl mx-auto flex">
        ${["draft", "rosters", "scoring", "leaderboard"].map(t => `
          <button onclick="switchTab('${t}')"
            class="px-4 py-3 text-sm font-medium capitalize transition border-b-2 ${
              currentTab === t ? "border-yellow-400 text-yellow-400" : "border-transparent text-gray-400 hover:text-gray-200"
            }">${t}</button>`).join("")}
      </div>
    </div>

    <div id="tab-content" class="max-w-3xl mx-auto px-4 py-5"></div>
  `;
}

function renderActiveTab() {
  if (currentTab === "draft") renderDraftTab();
  else if (currentTab === "rosters") renderRostersTab();
  else if (currentTab === "scoring") renderScoringTab();
  else if (currentTab === "leaderboard") renderLeaderboardTab();
}

// ─── DRAFT TAB ──────────────────────────────────────────────────────────────

function renderDraftTab() {
  const closed = isClosed();
  const mine = myPicks();
  const spent = mySpend();
  const remaining = SALARY_CAP - spent;

  let list = golfers;
  if (filterTier !== 0) list = list.filter(g => g.tier === filterTier);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(g => g.name.toLowerCase().includes(q) || g.country.toLowerCase().includes(q));
  }

  const rosterHtml = `
    <div class="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-5">
      <div class="flex items-center justify-between mb-3">
        <p class="font-semibold text-sm">
          Your roster
          <span class="ml-2 text-gray-400 font-normal">${mine.length}/${ROSTER_SIZE} picks</span>
        </p>
        <div class="text-right">
          <span class="text-sm font-bold ${remaining < 5 ? 'text-red-400' : 'text-yellow-400'}">$${remaining}M left</span>
          <span class="text-gray-500 text-xs"> / $${SALARY_CAP}M</span>
        </div>
      </div>
      <div class="w-full bg-gray-800 rounded-full h-1.5 mb-3">
        <div class="h-1.5 rounded-full bg-gradient-to-r from-green-500 to-yellow-400 transition-all"
             style="width: ${Math.min(100, (spent / SALARY_CAP) * 100)}%"></div>
      </div>
      ${mine.length === 0
        ? `<p class="text-gray-500 text-sm italic">No picks yet — draft 5 golfers below.</p>`
        : `<div class="flex flex-col gap-1.5">${mine.map(pk => {
            const g = golfer(pk.golfer_id);
            return `
              <div class="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-sm">
                  <span class="text-xs text-gray-400 mr-1">${g.country}</span>${escapeHtml(g.name)}
                </span>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-yellow-400 font-semibold">$${g.cost}M</span>
                  ${closed ? "" : `<button onclick="dropGolfer(${g.id})" class="text-gray-500 hover:text-red-400 text-xs">✕</button>`}
                </div>
              </div>`;
          }).join("")}</div>`}
    </div>`;

  const filtersHtml = `
    <div class="flex flex-col gap-2 mb-3">
      <input id="search-box" type="text" placeholder="Search golfers…" value="${escapeAttr(searchQuery)}"
        oninput="setSearch(this.value)"
        class="bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:border-yellow-400 focus:outline-none">
      <div class="flex gap-2 flex-wrap">
        ${[0,1,2,3,4,5].map(t => `
          <button onclick="setFilterTier(${t})"
            class="px-3 py-1 rounded-full text-xs font-medium transition ${
              filterTier === t ? "bg-yellow-400 text-gray-900" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }">${t === 0 ? "All" : TIERS[t].label}</button>`).join("")}
      </div>
    </div>`;

  const playersHtml = list.length === 0
    ? `<p class="text-gray-500 text-sm italic text-center py-8">No golfers match.</p>`
    : `<div class="flex flex-col gap-2">${list.map(g => {
        const mineHere = mine.some(p => p.golfer_id === g.id);
        const affordable = g.cost <= remaining;
        return `
          <div class="rounded-xl border px-3 py-2.5 flex items-center justify-between tier-${g.tier}">
            <div class="flex items-center gap-3 min-w-0">
              <span class="text-xs font-bold px-2 py-0.5 rounded-full tier-badge-${g.tier} flex-shrink-0">T${g.tier}</span>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-gray-900 truncate">
                  <span class="text-xs text-gray-500 mr-1">${g.country}</span>${escapeHtml(g.name)}
                </p>
                <p class="text-xs text-gray-500">${g.odds} odds</p>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0 ml-2">
              <span class="text-sm font-bold text-gray-700">$${g.cost}M</span>
              ${mineHere
                ? (closed ? `<span class="text-xs text-green-700 font-semibold px-2 py-1">Mine</span>` :
                   `<button onclick="dropGolfer(${g.id})" class="bg-red-500 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg font-semibold">Drop</button>`)
                : closed
                  ? `<span class="text-xs text-gray-400 italic px-2">Closed</span>`
                  : !affordable
                    ? `<button disabled class="text-xs px-3 py-1.5 rounded-lg bg-gray-200 text-gray-400 cursor-not-allowed">$$</button>`
                    : mine.length >= ROSTER_SIZE
                      ? `<button disabled class="text-xs px-3 py-1.5 rounded-lg bg-gray-200 text-gray-400 cursor-not-allowed">Full</button>`
                      : `<button onclick="draftGolfer(${g.id})" class="text-xs px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-700 text-white font-semibold">Pick</button>`}
            </div>
          </div>`;
      }).join("")}</div>`;

  document.getElementById("tab-content").innerHTML = rosterHtml + filtersHtml + playersHtml;

  // Restore focus on search box if it was focused (so typing doesn't lose focus on rerender)
  if (searchQuery) {
    const box = document.getElementById("search-box");
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }
}

// ─── ROSTERS TAB ────────────────────────────────────────────────────────────

function renderRostersTab() {
  if (participants.length === 0) {
    document.getElementById("tab-content").innerHTML = `<p class="text-gray-500 text-sm italic">No participants yet.</p>`;
    return;
  }
  const html = participants.map(p => {
    const theirPicks = picks.filter(pk => pk.participant_id === p.id);
    const spend = theirPicks.reduce((s, pk) => s + (golfer(pk.golfer_id)?.cost || 0), 0);
    const rows = theirPicks.length === 0
      ? `<p class="text-gray-600 text-sm italic">No picks yet</p>`
      : theirPicks.map(pk => {
          const g = golfer(pk.golfer_id);
          return `
            <div class="flex items-center justify-between rounded-lg px-3 py-2 tier-${g.tier}">
              <span class="text-sm text-gray-800">
                <span class="text-xs text-gray-500 mr-1">${g.country}</span>${escapeHtml(g.name)}
              </span>
              <span class="text-xs font-bold text-gray-700">$${g.cost}M</span>
            </div>`;
        }).join("");
    return `
      <div class="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <div class="flex items-center justify-between mb-3">
          <p class="font-semibold text-sm">${escapeHtml(p.name)}${p.id === me.id ? ' <span class="text-xs text-yellow-400">(you)</span>' : ""}</p>
          <span class="text-xs text-gray-500">$${spend}M of $${SALARY_CAP}M · ${theirPicks.length}/${ROSTER_SIZE} picks</span>
        </div>
        <div class="flex flex-col gap-1.5">${rows}</div>
      </div>`;
  }).join('<div class="h-3"></div>');
  document.getElementById("tab-content").innerHTML = html;
}

// ─── SCORING TAB ────────────────────────────────────────────────────────────

function renderScoringTab() {
  document.getElementById("tab-content").innerHTML = `
    <div class="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4">
      <h2 class="font-semibold text-sm mb-3 text-gray-300">Point system</h2>
      <div class="grid grid-cols-2 gap-1.5">
        ${SCORING.map(s => `
          <div class="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-1.5">
            <span class="text-sm text-gray-300">${s.finish}</span>
            <span class="text-sm font-bold text-yellow-400">${s.pts} pts</span>
          </div>`).join("")}
      </div>
    </div>
    <div class="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <h2 class="font-semibold text-sm mb-2 text-gray-300">Rules</h2>
      <ul class="text-sm text-gray-400 space-y-2 list-disc pl-5">
        <li>Each entrant builds a roster of <span class="text-white">${ROSTER_SIZE} golfers</span> within a <span class="text-white">$${SALARY_CAP}M</span> salary cap.</li>
        <li>Pick whichever golfers you like — two entrants can pick the same golfer.</li>
        <li>Picks lock at the cutoff time shown at the top of the page.</li>
        <li>Each golfer scores points based on their final finishing position.</li>
        <li>Your total = sum of your 5 golfers' points. Highest wins.</li>
      </ul>
    </div>`;
}

// ─── LEADERBOARD TAB ────────────────────────────────────────────────────────

function renderLeaderboardTab() {
  if (participants.length === 0) {
    document.getElementById("tab-content").innerHTML = `<p class="text-gray-500 text-sm italic">No participants yet.</p>`;
    return;
  }
  const board = participants
    .map(p => ({ ...p, score: scoreOf(p.id), picksCount: picks.filter(pk => pk.participant_id === p.id).length }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const anyResults = results.length > 0;

  const rows = board.map((p, i) => {
    const top = i === 0 && p.score > 0;
    const theirPicks = picks.filter(pk => pk.participant_id === p.id);
    const chips = theirPicks.map(pk => {
      const g = golfer(pk.golfer_id);
      const pts = pointsFor(pk.golfer_id);
      const finish = finishFor(pk.golfer_id);
      const bg = pts === null ? "bg-gray-800 text-gray-400"
              : pts > 0 ? "bg-green-900/60 text-green-300"
              : "bg-gray-800 text-gray-500";
      const tip = finish ? ` (${finish})` : "";
      return `<span class="text-xs px-2 py-0.5 rounded-full ${bg}" title="${escapeAttr(finish || "")}">${escapeHtml(g.name.split(" ").slice(-1)[0])}${pts !== null ? ` ${pts}` : ""}</span>`;
    }).join("");
    return `
      <div class="rounded-xl border px-4 py-3 ${top ? "bg-yellow-400/10 border-yellow-400/50" : "bg-gray-900 border-gray-800"}">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-3">
            <span class="text-lg font-black ${top ? "text-yellow-400" : "text-gray-500"}">${top ? "🏆" : `#${i + 1}`}</span>
            <span class="font-semibold">${escapeHtml(p.name)}${p.id === me.id ? ' <span class="text-xs text-yellow-400">(you)</span>' : ""}</span>
          </div>
          <span class="text-xl font-black ${top ? "text-yellow-400" : "text-white"}">${p.score} pts</span>
        </div>
        <div class="flex flex-wrap gap-1.5 pl-9">
          ${chips || `<span class="text-xs text-gray-600 italic">No roster yet</span>`}
        </div>
      </div>`;
  }).join('<div class="h-3"></div>');

  const note = !anyResults
    ? `<div class="mt-4 bg-gray-900 rounded-xl border border-gray-800 p-4">
         <p class="text-sm text-gray-400">No tournament results entered yet. Once the U.S. Open is underway, the admin will enter each golfer's finish on the admin page and points will appear here.</p>
       </div>`
    : "";

  document.getElementById("tab-content").innerHTML = rows + note;
}

// ─── utils ──────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// Expose action handlers to inline onclick attributes
window.signIn = signIn;
window.signOut = signOut;
window.switchTab = switchTab;
window.setFilterTier = setFilterTier;
window.setSearch = setSearch;
window.draftGolfer = draftGolfer;
window.dropGolfer = dropGolfer;
