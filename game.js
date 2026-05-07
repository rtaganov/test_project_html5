const SAVE_KEY = "strongman_forge_save_v1";
const DEBUG_FLAG = "strongman_debug";

const ASSETS = {
  character: "assets/images/character-placeholder.svg",
  weight: "assets/images/weight-placeholder.svg",
  background: "assets/images/background-placeholder.svg"
};

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

const CLICK_COOLDOWN_MS = 80;

const state = {
  gains: 0, lift: 0.1, gps: 0, zone: "Low", isActive: false, recentManualInputTimer: 0, lastLiftClickAt: -Infinity,
  redHold: 0, bestRedHold: 0, combo: 1, totalPlaytime: 0, goalIndex: 0,
  totalUpgrades: 0, upgrades: {}, lastTick: performance.now(), lastSave: Date.now(), saveTimer: 0,
  debug: false, debugTimeScale: 1, debugPassiveLift: null
};

const el = {};
let upgradesDirty = true;
let upgradeStateDirty = true;
let upgradeUiTimer = 0;
const UPGRADE_UI_UPDATE_INTERVAL = 0.35;
const upgradeButtons = {};
let lastUnlockedUpgradeIds = "";

function initGame() {
  cacheEls();
  setupDebugMode();
  loadGame();
  applyAssets();
  bindInput();
  renderUpgradesFull();
  updateUpgradeButtonStates();
  render();
  requestAnimationFrame(loop);
}
function cacheEls() { ["gains","gps","liftPercent","zone","bestRed","playtime","indicator","weight","character","redZone","maxBonus","resetBtn","goalText","goalReward","upgradeList","arena","liftTarget","toastContainer","offlineModal","offlineText","closeOffline"].forEach(id=>el[id]=document.getElementById(id)); }

function applyAssets() {
  if (el.weight) el.weight.src = ASSETS.weight;
  if (el.character) el.character.src = ASSETS.character;
  document.body.style.backgroundImage = `url("${ASSETS.background}")`;
}

function setupDebugMode() {
  const params = new URLSearchParams(window.location.search);
  state.debug = params.has("debug") || localStorage.getItem(DEBUG_FLAG) === "1";
  if (state.debug) {
    localStorage.setItem(DEBUG_FLAG, "1");
    window.debugGame = {
      setUpgrade: (id, level) => {
        if (!(id in state.upgrades)) return;
        state.upgrades[id] = Math.max(0, Math.floor(level));
        state.totalUpgrades = Object.values(state.upgrades).reduce((sum, v) => sum + v, 0);
        upgradesDirty = true;
        upgradeStateDirty = true;
      },
      addGains: amount => { state.gains += Number(amount) || 0; upgradesDirty = true; },
      setLift: value => { state.lift = Math.max(0, Math.min(1, Number(value) || 0)); },
      setTimeScale: value => { state.debugTimeScale = Math.max(0.1, Number(value) || 1); },
      setPassiveLift: value => {
        if (value == null) state.debugPassiveLift = null;
        else state.debugPassiveLift = Math.max(0, Math.min(1, Number(value) || 0));
      },
      snapshot: () => JSON.parse(JSON.stringify(state))
    };
    console.info("Debug mode enabled. window.debugGame helpers are available.");
  }
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  upgradeDefs.forEach(u => state.upgrades[u.id] = 0);
  if (!raw) return;
  try {
    const save = JSON.parse(raw);
    state.gains = Number(save.gains) || 0;
    state.lift = clamp01(save.lift ?? state.lift);
    state.bestRedHold = Math.max(0, Number(save.bestRedHold) || 0);
    state.totalPlaytime = Math.max(0, Number(save.totalPlaytime) || 0);
    state.goalIndex = Math.max(0, Math.min(goals.length, Number(save.goalIndex) || 0));
    for (const def of upgradeDefs) state.upgrades[def.id] = Math.max(0, Math.floor(save.upgrades?.[def.id] || 0));
    state.totalUpgrades = Object.values(state.upgrades).reduce((sum, v) => sum + v, 0);
    state.lastTick = performance.now();
    calculateOfflineProgress(Number(save.lastSave) || Date.now());
    upgradeStateDirty = true;
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
  const onLiftPointerDown = e => {
    e.preventDefault();
    const now = performance.now();
    if (now - state.lastLiftClickAt < CLICK_COOLDOWN_MS) return;
    state.lastLiftClickAt = now;
    state.recentManualInputTimer = 0.35;
    quickLiftImpulse();
  };

  el.liftTarget.addEventListener("pointerdown", onLiftPointerDown);
  document.addEventListener("visibilitychange", () => { if (document.hidden) state.recentManualInputTimer = 0; });
  window.addEventListener("blur", () => { state.recentManualInputTimer = 0; });

  el.resetBtn.addEventListener("click", resetGame);
  el.closeOffline.addEventListener("click", () => el.offlineModal.classList.add("hidden"));
}


function quickLiftImpulse() {
  const str = upgradeDefs.find(u=>u.id==="strength").effect(state.upgrades.strength);
  state.lift = clamp01(state.lift + 0.04 * str);
  state.isActive = true;
}

function getPassiveRecoverySpeed() {
  const grip = upgradeDefs.find(u=>u.id==="grip").effect(state.upgrades.grip);
  const end = upgradeDefs.find(u=>u.id==="endurance").effect(state.upgrades.endurance);
  return 0.035 + (grip + end) * 0.04;
}

function handleLiftInput(dt) {
  const auto = upgradeDefs.find(u=>u.id==="autolifter").effect(state.upgrades.autolifter);
  const grip = upgradeDefs.find(u=>u.id==="grip").effect(state.upgrades.grip);
  const end = upgradeDefs.find(u=>u.id==="endurance").effect(state.upgrades.endurance);
  const passiveStable = state.debugPassiveLift ?? getPassiveStableLevel(state);
  const fallSpeed = 0.22 * Math.max(0.2, 1 - grip - end);

  if (auto > 0) {
    state.lift += (auto - fallSpeed) * dt;
  } else if (state.lift > passiveStable) {
    state.lift = Math.max(passiveStable, state.lift - fallSpeed * dt);
  } else if (state.lift < passiveStable) {
    const recover = getPassiveRecoverySpeed();
    state.lift = Math.min(passiveStable, state.lift + recover * dt);
  }

  state.lift = clamp01(state.lift);
  state.isActive = state.recentManualInputTimer > 0 || (auto > 0 && state.lift > passiveStable + 0.03);
}

function getZoneName(lift) { if (lift >= .9) return "Red"; if (lift >= .75) return "High"; if (lift >= .4) return "Mid"; return "Low"; }
function zoneMultiplier(lift) { if (lift >= .9) return 3; if (lift >= .75) return 1.5; if (lift >= .4) return .75; return .25; }
function getPassiveStableLevel(s) {
  const sup = upgradeDefs.find(u=>u.id==="support").effect(s.upgrades.support || 0);
  return clamp01(Math.min(0.7, sup));
}
function calculateIncome(dt, overrideLift = state.lift, forcePassive = false) {
  const zMulti = zoneMultiplier(overrideLift);
  const manualActive = state.recentManualInputTimer > 0;
  const activeMul = forcePassive ? 0.5 : (manualActive ? 1.5 : 0.5);
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
  upgradesDirty = true;
  upgradeStateDirty = true;
  saveGame();
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
  upgradesDirty = true;
  upgradeStateDirty = true;
  saveGame();
}
function getUpgradeCost(def, level) { return Math.floor(def.baseCost * Math.pow(def.growth, level)); }
function getUnlockedUpgradeIds() {
  return upgradeDefs.filter(def => def.unlock(state)).map(def => def.id).join("|");
}
function renderUpgradesFull() {
  el.upgradeList.innerHTML = "";
  upgradeDefs.forEach(def => {
    const unlocked = def.unlock(state);
    const card = document.createElement("div");
    card.className = `upgrade ${unlocked ? "" : "locked"}`;
    const lockText = unlocked ? "" : `<small>🔒 Unlock condition not met</small>`;
    card.innerHTML = `<h3>${def.name}</h3><small>${def.desc}</small><small data-upgrade-level>Level: 0</small><small data-upgrade-effect>Effect: 0.00</small><small data-upgrade-cost>Cost: 0.0 Gains</small>${lockText}<button data-upgrade-buy>Buy</button>`;
    const btn = card.querySelector("[data-upgrade-buy]");
    btn.addEventListener("click", () => buyUpgrade(def.id));
    upgradeButtons[def.id] = { card, btn };
    el.upgradeList.appendChild(card);
  });
  lastUnlockedUpgradeIds = getUnlockedUpgradeIds();
  updateUpgradeButtonStates();
  upgradeStateDirty = false;
}
function updateUpgradeButtonStates() {
  upgradeDefs.forEach(def => {
    const refs = upgradeButtons[def.id];
    if (!refs) return;
    const lvl = state.upgrades[def.id] || 0;
    const cost = getUpgradeCost(def, lvl);
    const unlocked = def.unlock(state);
    refs.card.classList.toggle("locked", !unlocked);
    refs.card.querySelector("[data-upgrade-level]").textContent = `Level: ${lvl}`;
    refs.card.querySelector("[data-upgrade-effect]").textContent = `Effect: ${def.effect(lvl).toFixed(2)}`;
    refs.card.querySelector("[data-upgrade-cost]").textContent = `Cost: ${formatNumber(cost)} Gains`;
    refs.btn.disabled = !unlocked || state.gains < cost;
  });
  upgradesDirty = false;
}
function updateGame(dt) {
  state.totalPlaytime += dt;
  state.recentManualInputTimer = Math.max(0, state.recentManualInputTimer - dt);
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
      upgradesDirty = true;
    }
  } else {
    state.redHold = 0;
    state.combo = 1;
  }
  state.gains += calculateIncome(dt);
  updateGoals();
  state.saveTimer += dt;
  if (state.saveTimer >= 5) { saveGame(); state.saveTimer = 0; }
  const unlockedIds = getUnlockedUpgradeIds();
  if (unlockedIds !== lastUnlockedUpgradeIds) {
    lastUnlockedUpgradeIds = unlockedIds;
    upgradeStateDirty = true;
  }
  if (upgradeStateDirty) renderUpgradesFull();
  upgradeUiTimer += dt;
  if (upgradesDirty || upgradeUiTimer >= UPGRADE_UI_UPDATE_INTERVAL) {
    updateUpgradeButtonStates();
    upgradeUiTimer = 0;
  }
}
function render() {
  const passiveStable = state.debugPassiveLift ?? getPassiveStableLevel(state);
  const isLifting = state.recentManualInputTimer > 0;
  const isFalling = !isLifting && state.lift > passiveStable + 0.01;
  const isStable = !isLifting && Math.abs(state.lift - passiveStable) <= 0.01;
  const isRedZone = state.lift >= .9;

  el.gains.textContent = formatNumber(state.gains);
  el.gps.textContent = formatNumber(state.gps);
  el.liftPercent.textContent = `${Math.round(state.lift * 100)}%`;
  el.zone.textContent = state.zone;
  el.bestRed.textContent = `${state.bestRedHold.toFixed(1)}s`;
  el.playtime.textContent = formatTime(state.totalPlaytime);
  el.indicator.style.bottom = `${state.lift * 100}%`;
  el.weight.style.top = `${55 - state.lift * 40}%`;
  el.redZone.classList.toggle("glow", isRedZone);
  el.maxBonus.classList.toggle("show", isRedZone);
  el.weight.classList.toggle("red-pulse", isRedZone);
  el.liftTarget.classList.toggle("is-lifting", isLifting);
  el.liftTarget.classList.toggle("is-falling", isFalling);
  el.liftTarget.classList.toggle("is-stable", isStable);
  el.liftTarget.classList.toggle("is-red-zone", isRedZone);
  el.weight.classList.toggle("is-lifting", isLifting);
  el.weight.classList.toggle("is-falling", isFalling);
  el.weight.classList.toggle("is-stable", isStable);
  el.weight.classList.toggle("is-red-zone", isRedZone);
  el.arena.classList.toggle("is-lifting", isLifting);
  el.arena.classList.toggle("is-falling", isFalling);
  el.arena.classList.toggle("is-stable", isStable);
  el.arena.classList.toggle("is-red-zone", isRedZone);
  const goal = goals[state.goalIndex];
  el.goalText.textContent = goal ? goal.text : "All goals complete. Keep forging!";
  el.goalReward.textContent = goal ? `Reward: ${formatNumber(goal.reward)} Gains` : "";
}
function calculateOfflineProgress(lastSaveTs) {
  const now = Date.now();
  if (!Number.isFinite(lastSaveTs) || lastSaveTs > now) return;
  const sec = Math.min(8 * 3600, Math.max(0, (now - lastSaveTs) / 1000));
  if (sec < 2) return;
  const stable = state.debugPassiveLift ?? getPassiveStableLevel(state);
  const gains = calculateIncome(sec, stable, true);
  state.gains += gains;
  el.offlineText.textContent = `While you were away (${formatTime(sec)}), your trainee kept holding the weight at ${Math.round(stable * 100)}% and earned ${formatNumber(gains)} Gains.`;
  el.offlineModal.classList.remove("hidden");
  upgradesDirty = true;
  upgradeStateDirty = true;
  saveGame();
}
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
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
function loop(ts) {
  const delta = Math.min(0.05, (ts - state.lastTick) / 1000);
  state.lastTick = ts;
  const dt = delta * (state.debug ? state.debugTimeScale : 1);
  updateGame(dt);
  render();
  requestAnimationFrame(loop);
}

initGame();
