// SANVIC first-visit onboarding.
// Config lives in site_settings['entry_flow_v2'] so the Backoffice can add,
// edit and delete steps/options without a code deploy. No sign-in, no email.
(function () {
  "use strict";
  const KEY = "sanvic_entry_v1";
  const CONFIG_KEY = "entry_flow_v2";
  const VERSION = 3;

  const DEFAULT_CONFIG = {
    enabled: true,
    steps: [
      {
        id: "identity",
        type: "identity",
        eyebrow: "WELCOME TO SAN VICENTE",
        title: "Are you visiting or do you live here?",
        subtitle: "We’ll shape SANVIC around the way you know the coast.",
        note: "No email, no account — just this device. Shown to other travelers when you join a plan or share a photo.",
        skipLabel: "Skip for now",
        options: [
          { id: "visitor", label: "I’m visiting", note: "Beaches, stays, tours and the essentials.", value: "visitor", tags: [], icon: "luggage", nextAction: "discover:all" },
          { id: "local", label: "I live here", note: "Local events, new places and nearby moments.", value: "local", tags: [], icon: "house", nextAction: "discover:all" },
        ],
      },
      {
        id: "feels",
        type: "multi",
        eyebrow: "WELCOME TO SAN VICENTE",
        title: "What feels right today?",
        subtitle: "Choose one or more. There is no wrong kind of day.",
        min: 1,
        max: 4,
        options: [
          { id: "island", label: "Island hopping", note: "A day on the water.", value: "island", tags: ["island", "social", "pulse"], icon: "sailboat", nextAction: "discover:islands" },
          { id: "beach", label: "Beach and hammock", note: "Nothing urgent. Just the coast.", value: "beach", tags: ["quiet", "beach", "slow"], icon: "palmtree", nextAction: "discover:beaches" },
          { id: "food", label: "Eat somewhere special", note: "Fresh catches and tables worth finding.", value: "food", tags: ["food", "local"], icon: "utensils", nextAction: "discover:food" },
          { id: "localspots", label: "Explore local spots", note: "Find the places people return to.", value: "localspots", tags: ["explore", "hidden"], icon: "compass", nextAction: "discover:stops" },
          { id: "active", label: "Surf or get active", note: "Move with the water and the morning.", value: "active", tags: ["surf", "adventure", "sport"], icon: "waves", nextAction: "discover:sport" },
          { id: "tonight", label: "See what’s happening tonight", note: "Music, gatherings and shared tables.", value: "tonight", tags: ["social", "pulse", "nightlife"], icon: "music", nextAction: "pulse" },
        ],
      },
      {
        id: "begin",
        type: "single",
        eyebrow: "WELCOME TO SAN VICENTE",
        title: "Where should we begin?",
        subtitle: "Pick a starting point and we’ll take you there.",
        buttonLabel: "Show me San Vicente",
        options: [
          { id: "restos", label: "Best restaurants nearby", note: "Start with food close to you.", value: "restos", tags: ["food"], icon: "utensils", nextAction: "discover:food" },
          { id: "longbeach", label: "Local spots along Long Beach", note: "Follow the coast at your own pace.", value: "longbeach", tags: ["beach", "local"], icon: "map-pin", nextAction: "discover:beaches" },
          { id: "boats", label: "Islands and boat tours", note: "Find your way onto the water.", value: "boats", tags: ["island", "boat"], icon: "sailboat", nextAction: "discover:islands" },
          { id: "quiet", label: "Quiet beaches", note: "A softer stretch of sand.", value: "quiet", tags: ["quiet", "beach"], icon: "palmtree", nextAction: "discover:beaches" },
          { id: "cafes", label: "Cafés and sunset drinks", note: "Stay for the changing light.", value: "cafes", tags: ["food", "sunset"], icon: "coffee", nextAction: "discover:food" },
          { id: "surprise", label: "Surprise me", note: "Let curiosity choose the first stop.", value: "surprise", tags: ["explore"], icon: "sparkles", nextAction: "discover:all" },
        ],
      },
    ],
  };

  try { window.SANVIC_ENTRY_DEFAULTS = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); } catch (_) {}
  let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const state = { step: 0, nickname: "", answers: {} };
  let completed = false;
  let dialog = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function icon(name, size) {
    try { if (typeof lucideSvg === "function") return lucideSvg(name || "sparkles", size || 18); } catch (_) {}
    return "";
  }
  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } }
  function steps() { return Array.isArray(config.steps) ? config.steps : []; }
  function step() { return steps()[state.step] || null; }

  async function loadConfig() {
    try {
      if (typeof sb === "undefined") return;
      const { data, error } = await sb.from("site_settings").select("value").eq("key", CONFIG_KEY).maybeSingle();
      if (error || !data || !data.value) return;
      const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
      if (parsed && Array.isArray(parsed.steps) && parsed.steps.length) {
        config = { enabled: parsed.enabled !== false, steps: parsed.steps };
      }
    } catch (_) {}
  }

  function validProfile(p) {
    return p && p.profileVersion === VERSION && p.identity && p.begin;
  }
  function shouldShow() {
    const params = new URLSearchParams(location.search);
    if (params.get("resetEntry") === "1") {
      try { localStorage.removeItem(KEY); } catch (_) {}
      return true;
    }
    if (!config.enabled) return false;
    return !validProfile(saved());
  }

  function css() {
    if (document.getElementById("sanvicEntryCss")) return;
    const s = document.createElement("style");
    s.id = "sanvicEntryCss";
    s.textContent = `
      dialog.sanvic-entry{border:0;margin:auto;padding:0;max-width:none;max-height:none;background:transparent;color:inherit;overflow:visible}
      dialog.sanvic-entry::backdrop{background:radial-gradient(circle at 50% 8%,rgba(20,184,166,.14),transparent 30%),linear-gradient(180deg,rgba(2,14,38,.72),rgba(2,14,38,.94));overflow:hidden;overscroll-behavior:contain}
      dialog.sanvic-entry:modal{overscroll-behavior:contain}
      dialog.sanvic-entry[open]{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:18px}
      .sanvic-entry-card{width:min(100%,760px);max-height:calc(100dvh - 36px);border-radius:28px;background:linear-gradient(180deg,rgba(8,18,38,.9),rgba(4,12,30,.97));border:1px solid rgba(255,255,255,.09);box-shadow:0 28px 90px rgba(0,0,0,.5);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);overflow:hidden}
      .sanvic-entry-inner{padding:24px;display:flex;flex-direction:column;gap:14px;max-height:calc(100dvh - 36px);overflow-y:auto}
      .sanvic-entry-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
      .sanvic-entry-brand{font-family:var(--font-display,Georgia,serif);letter-spacing:.42em;font-size:.9rem;color:rgba(255,255,255,.86)}
      .entry-close{flex:0 0 auto;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#eafcff;cursor:pointer;display:grid;place-items:center}
      .entry-progress{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:2px 0 8px}
      .entry-progress span{height:3px;border-radius:99px;background:rgba(255,255,255,.14)}
      .entry-progress span[data-on="true"]{background:var(--sand,#e8dcc8)}
      .entry-kicker{font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;color:rgba(232,220,200,.78);font-weight:700;margin:0}
      .entry-title{font-family:var(--font-display,Georgia,serif);font-size:clamp(1.9rem,5vw,2.8rem);font-weight:400;line-height:1.05;letter-spacing:-.02em;margin:0;color:rgba(255,255,255,.96)}
      .entry-sub{font-size:.95rem;line-height:1.5;color:rgba(255,255,255,.62);margin:0}
      .entry-note{font-size:.78rem;line-height:1.5;color:rgba(255,255,255,.42);margin:0}
      .entry-label{font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(232,220,200,.8);font-weight:700}
      .entry-name{width:100%;min-height:54px;border-radius:16px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#f4f8ff;font:inherit;font-size:1rem;padding:0 15px;outline:0}
      .entry-name:focus-visible{outline:2px solid #65e1d1;outline-offset:2px}
      .entry-name:user-invalid{border-color:#fca5a5}
      .entry-error{color:#fca5a5;font-size:.8rem;min-height:1.1em}
      .entry-options{display:grid;grid-template-columns:1fr;gap:9px}
      .entry-option{position:relative;display:flex;align-items:center;gap:12px;min-height:60px;padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.045);cursor:pointer;color:rgba(255,255,255,.9)}
      .entry-option input{position:absolute;opacity:0;width:1px;height:1px}
      .entry-option .entry-ico{flex:0 0 auto;width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.07);color:rgba(232,220,200,.8)}
      .entry-option .entry-copy{min-width:0}
      .entry-option strong{display:block;font-family:var(--font-display,Georgia,serif);font-size:1.02rem;font-weight:400}
      .entry-option small{display:block;font-size:.76rem;color:rgba(255,255,255,.52);margin-top:2px}
      .entry-option:has(input:checked){border-color:rgba(20,184,166,.55);background:rgba(20,184,166,.14)}
      .entry-option:has(input:focus-visible){outline:2px solid #65e1d1;outline-offset:2px}
      .entry-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid rgba(255,255,255,.08);padding-top:14px}
      .entry-skip{border:0;background:transparent;color:rgba(255,255,255,.5);font:inherit;font-weight:600;cursor:pointer;padding:10px 4px;min-height:44px}
      .entry-next{border:0;border-radius:999px;min-height:48px;padding:0 24px;background:linear-gradient(135deg,var(--sand,#e8dcc8),var(--limestone,#c4a882));color:var(--charcoal-deep,#020e26);font:inherit;font-weight:700;cursor:pointer}
      .entry-next:disabled{opacity:.45;cursor:not-allowed}
      .entry-count{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.7);font-weight:700}
      @media(min-width:700px){.entry-options{grid-template-columns:1fr 1fr}.sanvic-entry-inner{padding:32px}}
    `;
    document.head.appendChild(s);
  }

  function mount() {
    if (dialog) return dialog;
    dialog = document.getElementById("sanvicEntry");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "sanvicEntry";
      dialog.className = "sanvic-entry";
      dialog.setAttribute("aria-labelledby", "entryTitle");
      dialog.innerHTML = '<div class="sanvic-entry-inner" id="sanvicEntryContent"></div>';
      document.body.appendChild(dialog);
    }
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue;
      dialog.returnValue = "";
      if (value !== "complete" && !completed) skip();
    });
    return dialog;
  }

  function reveal() {
    document.body.classList.remove("sanvic-entry-lock");
    const b = document.getElementById("bottomDock");
    if (b) b.classList.add("visible");
    const t = document.getElementById("talaOrbWrap");
    if (t) t.classList.remove("hidden");
  }

  function applyProfile(p) {
    const x = p || saved();
    if (!x) return;
    document.body.dataset.sanvicVibes = (x.vibeTags || []).join(" ");
    document.body.dataset.sanvicAudience = x.identity || "visitor";
    document.body.classList.toggle("sanvic-audience-resident", x.identity === "local");
    document.body.classList.toggle("sanvic-audience-traveler", x.identity !== "local");
    if (x.nickname) {
      document.body.dataset.sanvicNickname = x.nickname;
      const n = document.getElementById("pulseComposeName");
      if (n && !n.value) n.value = x.nickname;
    }
    document.body.classList.add("sanvic-profiled");
  }

  function runNextAction(action) {
    try {
      const a = String(action || "");
      if (!a) return;
      if (a.indexOf("discover:") === 0) {
        if (typeof dockNav === "function") dockNav("discover");
        const cat = a.slice("discover:".length);
        if (cat && cat !== "all" && typeof selectExploreCategory === "function") setTimeout(() => selectExploreCategory(cat), 180);
        return;
      }
      if (["map", "pulse", "hunt", "journey", "tala"].includes(a) && typeof dockNav === "function") dockNav(a);
    } catch (_) {}
  }

  function render() {
    const w = document.getElementById("sanvicEntryContent");
    const s = step();
    if (!w || !s) return;
    const opts = Array.isArray(s.options) ? s.options : [];
    const isFirst = state.step === 0;
    const isLast = state.step === steps().length - 1;
    const progress = steps().map((_, i) => `<span data-on="${i <= state.step ? "true" : "false"}"></span>`).join("");
    const nameBlock = s.type === "identity"
      ? `<div class="entry-field"><label class="entry-label" for="entryName">What should we call you?</label><input class="entry-name" id="entryName" name="nickname" autocomplete="nickname" maxlength="32" required aria-describedby="entryNameHelp entryNameError" placeholder="e.g. Dave" value="${esc(state.nickname)}"><div class="entry-error" id="entryNameError" aria-live="polite"></div><p class="entry-note" id="entryNameHelp">${esc(s.note || "No email, no account — just this device.")}</p></div>`
      : "";
    const choices = opts.map((o, i) => {
      const type = s.type === "multi" ? "checkbox" : "radio";
      const name = s.type === "multi" ? "feels" : s.type === "identity" ? "audience" : "begin";
      const checked = s.type === "identity" ? state.answers.identityValue === o.value
        : s.type === "multi" ? (state.answers.feels || []).includes(o.value)
        : state.answers.beginValue === o.value;
      return `<label class="entry-option"><input type="${type}" name="${name}" value="${esc(o.value || o.id)}" data-index="${i}" ${checked ? "checked" : ""}><span class="entry-ico" aria-hidden="true">${icon(o.icon)}</span><span class="entry-copy"><strong>${esc(o.label)}</strong>${o.note ? `<small>${esc(o.note)}</small>` : ""}</span></label>`;
    }).join("");
    const count = (state.answers.feels || []).length;
    const countLine = s.type === "multi"
      ? `<div class="entry-count" aria-live="polite">${count} selected · ${count >= (s.min || 1) ? "ready to continue" : "choose at least " + (s.min || 1)}</div>`
      : "";
    const submitLabel = isLast ? (s.buttonLabel || "Show me San Vicente") : "Continue";
    w.innerHTML = `
      <div class="sanvic-entry-top"><div class="sanvic-entry-brand">SANVIC</div><button type="button" class="entry-close" id="entryClose" aria-label="Close onboarding">${icon("x", 18)}</button></div>
      <div class="entry-progress" aria-hidden="true">${progress}</div>
      <form id="entryForm">
        ${s.eyebrow ? `<p class="entry-kicker">${esc(s.eyebrow)}</p>` : ""}
        <h1 class="entry-title" id="entryTitle">${esc(s.title)}</h1>
        ${s.subtitle ? `<p class="entry-sub">${esc(s.subtitle)}</p>` : ""}
        ${nameBlock}
        <fieldset style="border:0;padding:0;margin:0"><legend class="entry-label" style="margin-bottom:8px">${s.type === "identity" ? "Choose one" : s.type === "multi" ? "Choose one or more" : "Choose one"}</legend><div class="entry-options">${choices}</div></fieldset>
        ${countLine}
        <div class="entry-footer"><button type="button" class="entry-skip" id="entrySkip">${esc(s.skipLabel || "Skip for now")}</button><button type="submit" class="entry-next" id="entryNext">${esc(submitLabel)}</button></div>
      </form>`;

    document.getElementById("entryClose").onclick = () => { if (dialog) { dialog.returnValue = "skip"; dialog.close(); } };
    document.getElementById("entrySkip").onclick = () => { if (dialog) { dialog.returnValue = "skip"; dialog.close(); } };
    const form = document.getElementById("entryForm");
    const nameInput = document.getElementById("entryName");
    if (nameInput) {
      nameInput.addEventListener("input", () => { state.nickname = nameInput.value; const err = document.getElementById("entryNameError"); if (err) { err.textContent = ""; nameInput.removeAttribute("aria-invalid"); } });
      nameInput.addEventListener("blur", () => { if (!nameInput.value.trim()) { nameInput.setAttribute("aria-invalid", "true"); const err = document.getElementById("entryNameError"); if (err) err.textContent = "Please enter a name."; } });
    }
    form.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((el) => {
      el.addEventListener("change", () => {
        const idx = Number(el.dataset.index);
        const o = opts[idx];
        if (!o) return;
        const value = o.value || o.id;
        if (s.type === "identity") state.answers.identityValue = value;
        else if (s.type === "single") state.answers.beginValue = value;
        else {
          const arr = state.answers.feels || [];
          if (el.checked && !arr.includes(value)) arr.push(value);
          if (!el.checked) state.answers.feels = arr.filter((v) => v !== value);
          state.answers.feels = arr;
        }
        render();
      });
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const btn = document.getElementById("entryNext");
      if (btn) btn.disabled = true;
      if (s.type === "identity") {
        const name = nameInput ? nameInput.value.trim() : "";
        if (!name) {
          nameInput.setAttribute("aria-invalid", "true");
          const err = document.getElementById("entryNameError");
          if (err) err.textContent = "Please enter a name.";
          nameInput.focus();
          if (btn) btn.disabled = false;
          return;
        }
        state.nickname = name;
        if (!state.answers.identityValue) {
          const first = form.querySelector('input[name="audience"]');
          if (first) state.answers.identityValue = first.value;
        }
      }
      if (s.type === "multi" && (state.answers.feels || []).length < (s.min || 1)) {
        const err = document.querySelector(".entry-count");
        if (err) err.textContent = "Please choose at least " + (s.min || 1) + ".";
        if (btn) btn.disabled = false;
        return;
      }
      if (s.type === "single" && !state.answers.beginValue) {
        if (btn) btn.disabled = false;
        return;
      }
      if (isLast) complete();
      else { state.step += 1; render(); }
    });
  }

  function profileFromAnswers() {
    const feels = (state.answers.feels || []).map((v) => {
      for (const st of steps()) for (const o of (st.options || [])) if ((o.value || o.id) === v) return o;
      return null;
    }).filter(Boolean);
    const tags = [];
    feels.forEach((o) => (o.tags || []).forEach((t) => { if (!tags.includes(t)) tags.push(t); }));
    let begin = null;
    for (const st of steps()) for (const o of (st.options || [])) if ((o.value || o.id) === state.answers.beginValue) begin = o;
    const identity = state.answers.identityValue === "local" ? "local" : "visitor";
    return {
      profileVersion: VERSION,
      nickname: state.nickname.trim(),
      identity,
      audience: identity,
      feels: state.answers.feels || [],
      begin: state.answers.beginValue || "",
      vibeTags: tags,
      nextAction: (begin && begin.nextAction) || "discover:all",
      enteredAt: new Date().toISOString(),
    };
  }

  function saveProfile(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) {}
    if (p.nickname && typeof personSave === "function") {
      try { personSave(p.nickname, p.identity || p.audience); } catch (_) {}
    }
    if (p.identity && typeof setExploreAudience === "function") {
      try { localStorage.setItem("sanvic_explore_audience", p.identity); setExploreAudience(p.identity); } catch (_) {}
    }
    applyProfile(p);
  }

  function complete() {
    if (completed) return;
    completed = true;
    const p = profileFromAnswers();
    saveProfile(p);
    if (dialog) { dialog.returnValue = "complete"; dialog.close(); }
    reveal();
    try { window.dispatchEvent(new CustomEvent("sanvic:entry-complete", { detail: p })); } catch (_) {}
    runNextAction(p.nextAction);
  }

  function skip() {
    if (completed) return;
    completed = true;
    const p = Object.assign({}, saved() || {}, { profileVersion: VERSION, skipped: true, enteredAt: new Date().toISOString(), nextAction: "discover:all" });
    if (state.nickname) p.nickname = state.nickname.trim();
    if (state.answers.identityValue) p.identity = state.answers.identityValue;
    saveProfile(p);
    if (dialog && dialog.open) dialog.close();
    reveal();
  }

  function openWhenReady() {
    if (!shouldShow()) return;
    completed = false;
    state.step = 0;
    const previous = saved();
    state.nickname = previous && previous.nickname ? previous.nickname : "";
    state.answers = {};
    document.body.classList.add("sanvic-entry-lock");
    const d = mount();
    render();
    if (!d.open) d.showModal();
  }

  window.openSanvicWelcome = function () {
    try { localStorage.removeItem(KEY); } catch (_) {}
    openWhenReady();
  };

  async function init() {
    await loadConfig();
    css();
    if (!shouldShow()) {
      const previous = saved();
      if (previous && !previous.skipped) applyProfile(previous);
      reveal();
      return;
    }
    const hold = Number(window.SANVIC_SPLASH_HOLD || 2000);
    // The editorial welcome page opens at hold+180. Wait for it to be dismissed
    // before the questions appear, so the two never stack on top of each other.
    setTimeout(function () {
      if (window.SANVIC_WELCOME_OPEN) {
        window.addEventListener("sanvic:welcome-closed", function () {
          setTimeout(openWhenReady, 260);
        }, { once: true });
      } else {
        openWhenReady();
      }
    }, hold + 420);
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init);
})();
