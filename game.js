const SAVE_KEY = "strongman_forge_save_v1";

const upgradeDefs = [
  { id: "strength", name: "Strength", desc: "Raise faster with each input.", baseCost: 20, growth: 1.45, unlock: () => true, effect: l => 1 + l * 0.25 },
  { id: "grip", name: "Grip", desc: "Slows natural falling speed.", baseCost: 30, growth: 1.5, unlock: s => s.gains >= 20, effect: l => l * 0.06 },
  { id: "endurance", name: "Endurance", desc: "Reduces passive decay penalty.", baseCost: 45, growth: 1.5, unlock: s => s.gains >= 40, effect: l => l * 0.07 },
  { id: "support", name: "Support Stand", desc: "Raises passive stable hold level.", baseCost: 60, growth: 1.55, unlock: s => s.gains >= 75, effect: l => 0.08 + l * 0.04 },
  { id: "partner", name: "Training Partner", desc: "Improves passive income efficiency.", baseCost: 85, growth: 1.6, unlock: s => s.totalUpgrades >= 4, effect: l => 1 + l * 0.22 },
  { id: "focus", name: "Red Zone Focus", desc: "Improves red-zone combo scaling.", baseCost: 150, growth: 1.62, unlock: s => s.bestRedHold >= 3, effect: l => 1 + l * 0.2 },
  { id: "enchanted", name: "Enchanted Weight", desc: "Boost global gains multiplier.", baseCost: 260, growth: 1.68, unlock: s => s.gains >= 500, effect: l => 1 + l * 0.28 },
  { id: "autolifter", name: "Auto Lifter", desc: "Adds automatic lifting force.", baseCost: 500, growth: 1.75, unlock: s => s.totalUpgrades >= 9, effect: l => l * 0.03 }
];

const goals = [
  { text: "Reach 100 Gains", done: s => s.gains >= 100, reward: 40 },
  { text: "Hold red zone for 5 seconds", done: s => s.bestRedHold >= 5, reward: 100 },
  { text: "Reach 1,000 Gains", done: s => s.gains >= 1000, reward: 250 },
  { text: "Buy 10 total upgrades", done: s => s.totalUpgrades >= 10, reward: 450 },
  { text: "Reach passive stable level of 40%", done: s => getPassiveStableLevel(s) >= 0.4, reward: 800 },
  { text: "Hold red zone for 15 seconds", done: s => s.bestRedHold >= 15, reward: 2000 },
  { text: "Reach 10,000 Gains", done: s => s.gains >= 10000, reward: 5000 }
];

const state = {
  gains: 0, lift: 0.1, gps: 0, zone: "Low", isActive: false, holdInput: false,
  redHold: 0, bestRedHold: 0, combo: 1, totalPlaytime: 0, goalIndex: 0,
  totalUpgrades: 0, upgrades: {}, lastTick: performance.now(), lastSave: Date.now(), saveTimer: 0
};

const el = {};

function initGame() {
  cacheEls();
  loadGame();
  bindInput();
  renderUpgrades();
  render();
  requestAnimationFrame(loop);
}
function cacheEls() { ["gains","gps","liftPercent","zone","mode","bestRed","playtime","indicator","weight","redZone","maxBonus","liftBtn","resetBtn","goalText","goalReward","upgradeList","liftTarget","toastContainer","offlineModal","offlineText","closeOffline"].forEach(id=>el[id]=document.getElementById(id)); }
function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  upgradeDefs.forEach(u => state.upgrades[u.id] = 0);
  if (!raw) return;
  try {
    const save = JSON.parse(raw);
    Object.assign(state, save);
    state.lastTick = performance.now();
    calculateOfflineProgress(save.lastSave || Date.now());
  } catch {}
}
function saveGame() {
  state.lastSave = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    gains: state.gains, lift: state.lift, bestRedHold: state.bestRedHold, totalPlaytime: state.totalPlaytime,
    goalIndex: state.goalIndex, totalUpgrades: state.totalUpgrades, upgrades: state.upgrades, lastSave: state.lastSave
  }));
}
function resetGame() {
  if (!confirm("Reset all progress? This cannot be undone.")) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}
function bindInput() {
  const onDown = () => { state.holdInput = true; el.liftBtn.classList.add("active"); };
  const onUp = () => { state.holdInput = false; el.liftBtn.classList.remove("active"); };
  ["mousedown","touchstart","pointerdown"].forEach(evt => el.liftBtn.addEventListener(evt, onDown));
  ["mouseup","mouseleave","touchend","pointerup","pointercancel"].forEach(evt => el.liftBtn.addEventListener(evt, onUp));
  ["mousedown","touchstart","pointerdown"].forEach(evt => el.liftTarget.addEventListener(evt, () => quickLiftImpulse()));
  document.addEventListener("keydown", e => { if (e.code === "Space") { e.preventDefault(); state.holdInput = true; } });
  document.addEventListener("keyup", e => { if (e.code === "Space") state.holdInput = false; });
  el.resetBtn.addEventListener("click", resetGame);
  el.closeOffline.addEventListener("click", () => el.offlineModal.classList.add("hidden"));
}
function quickLiftImpulse() {
  const str = upgradeDefs.find(u=>u.id==="strength").effect(state.upgrades.strength);
  state.lift = Math.min(1, state.lift + 0.04 * str);
  state.isActive = true;
}
function handleLiftInput(dt) {
  const str = upgradeDefs.find(u=>u.id==="strength").effect(state.upgrades.strength);
  const auto = upgradeDefs.find(u=>u.id==="autolifter").effect(state.upgrades.autolifter);
  const liftingForce = (state.holdInput ? 0.52 * str : 0) + auto;
  const grip = upgradeDefs.find(u=>u.id==="grip").effect(state.upgrades.grip);
  const end = upgradeDefs.find(u=>u.id==="endurance").effect(state.upgrades.endurance);
  const passiveStable = getPassiveStableLevel(state);
  let fall = 0.22 * Math.max(0.2, 1 - grip - end);
  if (!state.holdInput && state.lift < passiveStable) fall *= 0.18;
  state.lift += (liftingForce - fall) * dt;
  state.lift = Math.max(0, Math.min(1, state.lift));
  state.isActive = state.holdInput || (auto > 0 && state.lift > passiveStable + 0.03);
}
function getZoneName(lift) { if (lift >= .9) return "Red"; if (lift >= .75) return "High"; if (lift >= .4) return "Mid"; return "Low"; }
function zoneMultiplier(lift) { if (lift >= .9) return 3; if (lift >= .75) return 1.5; if (lift >= .4) return .75; return .25; }
function getPassiveStableLevel(s) {
  const sup = upgradeDefs.find(u=>u.id==="support").effect(s.upgrades.support || 0);
  return Math.min(0.7, sup);
}
function calculateIncome(dt, overrideLift = state.lift, forcePassive = false) {
  const zMulti = zoneMultiplier(overrideLift);
  const activeMul = forcePassive ? 0.5 : (state.holdInput ? 1.5 : 0.5);
  const global = upgradeDefs.find(u=>u.id==="enchanted").effect(state.upgrades.enchanted);
  const passiveBonus = forcePassive ? upgradeDefs.find(u=>u.id==="partner").effect(state.upgrades.partner) : 1;
  let comboBonus = 1;
  if (overrideLift >= .9 && !forcePassive) comboBonus = state.combo * upgradeDefs.find(u=>u.id==="focus").effect(state.upgrades.focus);
  const perSec = 1 * overrideLift * zMulti * activeMul * global * passiveBonus * comboBonus;
  if (!forcePassive) state.gps = perSec;
  return perSec * dt;
}
function updateGoals() {
  const g = goals[state.goalIndex];
  if (!g || !g.done(state)) return;
  state.gains += g.reward;
  toast(`Goal complete: ${g.text} (+${formatNumber(g.reward)} Gains)`);
  floatText(`+${formatNumber(g.reward)} Gains`);
  state.goalIndex++;
}
function buyUpgrade(id) {
  const def = upgradeDefs.find(u => u.id === id);
  if (!def || !def.unlock(state)) return;
  const level = state.upgrades[id] || 0;
  const cost = getUpgradeCost(def, level);
  if (state.gains < cost) return;
  state.gains -= cost;
  state.upgrades[id] = level + 1;
  state.totalUpgrades++;
  saveGame();
  renderUpgrades();
}
function getUpgradeCost(def, level) { return Math.floor(def.baseCost * Math.pow(def.growth, level)); }
function renderUpgrades() {
  el.upgradeList.innerHTML = "";
  upgradeDefs.forEach(def => {
    const lvl = state.upgrades[def.id] || 0;
    const cost = getUpgradeCost(def, lvl);
    const unlocked = def.unlock(state);
    const card = document.createElement("div");
    card.className = `upgrade ${unlocked ? "" : "locked"}`;
    const lockText = unlocked ? "" : `<small>🔒 Unlock condition not met</small>`;
    card.innerHTML = `<h3>${def.name}</h3><small>${def.desc}</small><small>Level: ${lvl}</small><small>Effect: ${def.effect(lvl).toFixed(2)}</small><small>Cost: ${formatNumber(cost)} Gains</small>${lockText}<button ${(!unlocked || state.gains < cost) ? "disabled" : ""}>Buy</button>`;
    card.querySelector("button").addEventListener("click", () => buyUpgrade(def.id));
    el.upgradeList.appendChild(card);
  });
}
function updateGame(dt) {
  state.totalPlaytime += dt;
  handleLiftInput(dt);
  state.zone = getZoneName(state.lift);
  if (state.lift >= .9) {
    state.redHold += dt;
    state.bestRedHold = Math.max(state.bestRedHold, state.redHold);
    state.combo = 1 + state.redHold * 0.15;
    if (Math.floor(state.redHold) !== Math.floor(state.redHold - dt)) {
      const bonus = 8 * state.combo;
      state.gains += bonus;
      floatText(`+${formatNumber(bonus)} combo`);
    }
  } else {
    state.redHold = 0;
    state.combo = 1;
  }
  state.gains += calculateIncome(dt);
  updateGoals();
  state.saveTimer += dt;
  if (state.saveTimer >= 5) { saveGame(); state.saveTimer = 0; }
}
function render() {
  el.gains.textContent = formatNumber(state.gains);
  el.gps.textContent = formatNumber(state.gps);
  el.liftPercent.textContent = `${Math.round(state.lift * 100)}%`;
  el.zone.textContent = state.zone;
  el.mode.textContent = state.holdInput ? "Active" : "Passive";
  el.bestRed.textContent = `${state.bestRedHold.toFixed(1)}s`;
  el.playtime.textContent = formatTime(state.totalPlaytime);
  el.indicator.style.bottom = `${state.lift * 100}%`;
  el.weight.style.top = `${55 - state.lift * 40}%`;
  el.redZone.classList.toggle("glow", state.lift >= .9);
  el.maxBonus.classList.toggle("show", state.lift >= .9);
  el.weight.classList.toggle("red-pulse", state.lift >= .9);
  const goal = goals[state.goalIndex];
  el.goalText.textContent = goal ? goal.text : "All goals complete. Keep forging!";
  el.goalReward.textContent = goal ? `Reward: ${formatNumber(goal.reward)} Gains` : "";
  renderUpgrades();
}
function calculateOfflineProgress(lastSaveTs) {
  const now = Date.now();
  const sec = Math.min(8 * 3600, Math.max(0, (now - lastSaveTs) / 1000));
  if (sec < 2) return;
  const stable = getPassiveStableLevel(state);
  const gains = calculateIncome(sec, stable, true);
  state.gains += gains;
  el.offlineText.textContent = `While you were away (${formatTime(sec)}), your trainee kept holding the weight at ${Math.round(stable * 100)}% and earned ${formatNumber(gains)} Gains.`;
  el.offlineModal.classList.remove("hidden");
}
function formatNumber(n) {
  if (n < 1000) return n.toFixed(1);
  if (n < 1e6) return `${(n/1e3).toFixed(1)}K`;
  if (n < 1e9) return `${(n/1e6).toFixed(1)}M`;
  return `${(n/1e9).toFixed(1)}B`;
}
function formatTime(sec) {
  const s = Math.floor(sec % 60), m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
}
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; el.toastContainer.appendChild(t); setTimeout(() => t.remove(), 3500); }
function floatText(msg) { const f = document.createElement("div"); f.className = "float"; f.textContent = msg; f.style.left = `${40 + Math.random()*30}%`; f.style.top = `${55 + Math.random()*20}%`; el.liftTarget.appendChild(f); setTimeout(() => f.remove(), 950); }
function loop(ts) { const dt = Math.min(0.05, (ts - state.lastTick) / 1000); state.lastTick = ts; updateGame(dt); render(); requestAnimationFrame(loop); }

initGame();
