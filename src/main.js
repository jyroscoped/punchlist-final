import "./styles.css";
import "lenis/dist/lenis.css";
import "iconify-icon";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createDataService, isFirebaseConfigured } from "./data-service.js";

gsap.registerPlugin(ScrollTrigger);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const forcedReduce = new URLSearchParams(window.location.search).get("reduce") === "1";
const prefersReducedMotion = () => forcedReduce || reduceQuery.matches;

if (forcedReduce) document.documentElement.classList.add("force-reduced-motion");

const state = {
  service: null,
  tasks: [],
  entries: [],
  activeTimers: [],
  filter: "open",
  search: "",
  activeTimer: null,
  timerInterval: null,
  renderCount: 0,
};

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };
const TIMER_KEY = "punchlist_running_timer_v1";
const NAME_KEY = "punchlist_worker_name_v1";

const elements = {
  taskList: $("#task-list"),
  timeRows: $("#time-rows"),
  taskSelect: $("#timer-task"),
  timerDisplay: $("#timer-display"),
  timerToggle: $("#timer-toggle"),
  timerButtonLabel: $("#timer-button-label"),
  timerNote: $("#timer-note"),
  workerName: $("#worker-name"),
  activeCrew: $("#active-crew-count"),
  dialog: $("#task-dialog"),
  taskForm: $("#task-form"),
  modeBanner: $("#mode-banner"),
  modeTitle: $("#mode-title"),
  modeDetail: $("#mode-detail"),
  toastRegion: $("#toast-region"),
};

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseStoredTimer() {
  try {
    const timer = JSON.parse(localStorage.getItem(TIMER_KEY));
    return timer?.startedAt ? timer : null;
  } catch {
    return null;
  }
}

function formatDuration(totalSeconds, compact = false) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (compact) {
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatDate(value) {
  if (!value) return "No due date";
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }).format(date);
}

function showToast(message, icon = "solar:check-circle-linear") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<iconify-icon icon="${icon}" aria-hidden="true"></iconify-icon><span>${escapeHTML(message)}</span>`;
  elements.toastRegion.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 180);
  }, 3200);
}

function setModeBanner() {
  const live = state.service?.mode === "firebase";
  elements.modeBanner.classList.toggle("is-live", live);
  elements.modeBanner.classList.toggle("is-local", !live);
  elements.modeTitle.textContent = live ? "Live board connected" : "Local demo mode";
  elements.modeDetail.textContent = live
    ? "Realtime changes are shared with the whole crew"
    : state.service?.startupError
      ? "Firebase could not connect; changes stay on this device"
      : "Add Firebase settings to share this board worldwide";
}

function taskMatches(task) {
  const search = state.search.trim().toLowerCase();
  const haystack = [task.title, task.description, task.trade, task.zone, task.assignedTo].join(" ").toLowerCase();
  const searchMatch = !search || haystack.includes(search);
  const filterMatch =
    state.filter === "all" ||
    (state.filter === "open" && task.status !== "done") ||
    (state.filter === "done" && task.status === "done") ||
    (state.filter === "urgent" && task.status !== "done" && ["urgent", "high"].includes(task.priority));
  return searchMatch && filterMatch;
}

function sortedTasks() {
  return [...state.tasks]
    .filter(taskMatches)
    .sort((a, b) => {
      if ((a.status === "done") !== (b.status === "done")) return a.status === "done" ? 1 : -1;
      const priority = (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
      if (priority) return priority;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
}

function renderTaskSelect() {
  const current = elements.taskSelect.value;
  const options = state.tasks
    .filter((task) => task.status !== "done")
    .sort((a, b) => (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2))
    .map((task) => `<option value="${escapeHTML(task.id)}">${escapeHTML(task.title)}</option>`)
    .join("");
  elements.taskSelect.innerHTML = `<option value="">General office work</option>${options}`;
  if ($(`option[value="${CSS.escape(current)}"]`, elements.taskSelect)) elements.taskSelect.value = current;
  if (state.activeTimer) elements.taskSelect.value = state.activeTimer.taskId || "";
}

function renderSummary() {
  const open = state.tasks.filter((task) => task.status !== "done");
  const done = state.tasks.filter((task) => task.status === "done");
  const seconds = state.entries.reduce((sum, entry) => sum + Number(entry.durationSeconds || 0), 0);
  $("#summary-open").textContent = open.length;
  $("#summary-urgent").textContent = open.filter((task) => ["urgent", "high"].includes(task.priority)).length;
  $("#summary-done").textContent = done.length;
  $("#summary-hours").textContent = (seconds / 3600).toFixed(1);
}

function renderTasks() {
  const tasks = sortedTasks();
  elements.taskList.setAttribute("aria-busy", "false");
  if (!tasks.length) {
    const hasAny = state.tasks.length > 0;
    elements.taskList.innerHTML = `
      <div class="empty-state">
        <div>
          <iconify-icon icon="${hasAny ? "solar:filter-linear" : "solar:clipboard-add-linear"}" aria-hidden="true"></iconify-icon>
          <h3>${hasAny ? "Nothing matches this view" : "The board is clear"}</h3>
          <p>${hasAny ? "Try a different filter or search phrase." : "Add the first work order while the details are fresh."}</p>
        </div>
      </div>`;
    renderSummary();
    renderTaskSelect();
    return;
  }

  elements.taskList.innerHTML = tasks.map((task) => {
    const done = task.status === "done";
    return `
      <article class="task-card${done ? " is-done" : ""}" data-task-id="${escapeHTML(task.id)}" data-priority="${escapeHTML(task.priority)}">
        <button class="task-check" type="button" aria-label="${done ? "Reopen" : "Complete"} ${escapeHTML(task.title)}" aria-pressed="${done}">
          <iconify-icon icon="${done ? "solar:check-read-linear" : "solar:check-circle-linear"}" aria-hidden="true"></iconify-icon>
        </button>
        <div class="task-body">
          <h3>${escapeHTML(task.title)}</h3>
          ${task.description ? `<p>${escapeHTML(task.description)}</p>` : ""}
          <div class="task-meta">
            <span><iconify-icon icon="solar:map-point-linear" aria-hidden="true"></iconify-icon>${escapeHTML(task.zone || "Office")}</span>
            <span><iconify-icon icon="solar:case-linear" aria-hidden="true"></iconify-icon>${escapeHTML(task.trade || "General")}</span>
            <span><iconify-icon icon="solar:calendar-linear" aria-hidden="true"></iconify-icon>${escapeHTML(formatDate(task.dueDate))}</span>
            ${task.assignedTo ? `<span><iconify-icon icon="solar:user-check-linear" aria-hidden="true"></iconify-icon>${escapeHTML(task.assignedTo)}</span>` : ""}
          </div>
        </div>
        <span class="priority-chip priority-${escapeHTML(task.priority)}">${escapeHTML(task.priority?.[0]?.toUpperCase() + task.priority?.slice(1) || "Medium")}</span>
      </article>`;
  }).join("");

  if (!prefersReducedMotion() && state.renderCount > 0) {
    gsap.fromTo($$(".task-card", elements.taskList), { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.32, stagger: 0.025, ease: "power3.out", clearProps: "transform,opacity,visibility" });
  }
  state.renderCount += 1;
  renderSummary();
  renderTaskSelect();
}

function renderTimeEntries() {
  if (!state.entries.length) {
    elements.timeRows.innerHTML = `<div class="time-row"><span>No hours logged yet</span><strong>Start and stop the shift clock to create the first entry.</strong><span>—</span><span>0m</span></div>`;
    renderSummary();
    return;
  }
  elements.timeRows.innerHTML = state.entries.slice(0, 12).map((entry) => `
    <div class="time-row">
      <strong>${escapeHTML(entry.workerName || "Site crew")}</strong>
      <span>${escapeHTML(entry.taskTitle || "General office work")}</span>
      <span>${escapeHTML(formatDate(entry.endedAt))}</span>
      <span>${escapeHTML(formatDuration(entry.durationSeconds, true))}</span>
    </div>`).join("");
  renderSummary();
}

function updateTimerDisplay() {
  if (!state.activeTimer) {
    elements.timerDisplay.value = "00:00:00";
    elements.timerDisplay.textContent = "00:00:00";
    return;
  }
  const elapsed = Math.floor((Date.now() - state.activeTimer.startedAt) / 1000);
  const text = formatDuration(elapsed);
  elements.timerDisplay.value = text;
  elements.timerDisplay.textContent = text;
}

function setTimerUI() {
  const running = Boolean(state.activeTimer);
  elements.timerToggle.classList.toggle("is-running", running);
  elements.timerButtonLabel.textContent = running ? "Stop and log shift" : "Start shift";
  $("iconify-icon", elements.timerToggle).setAttribute("icon", running ? "solar:stop-bold" : "solar:play-bold");
  elements.taskSelect.disabled = running;
  elements.timerNote.textContent = running
    ? `Started ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(state.activeTimer.startedAt)}. The timer will survive a page refresh.`
    : "Your log stays attached to this device until you stop it.";
  clearInterval(state.timerInterval);
  state.timerInterval = running ? window.setInterval(updateTimerDisplay, 1000) : null;
  updateTimerDisplay();
}

async function startTimer() {
  const workerName = elements.workerName.value.trim();
  if (!workerName) {
    showToast("Add your name before starting the clock.", "solar:info-circle-linear");
    elements.workerName.focus();
    return;
  }
  const taskId = elements.taskSelect.value;
  const task = state.tasks.find((item) => item.id === taskId);
  const timer = {
    taskId,
    taskTitle: task?.title || "General office work",
    workerName,
    startedAt: Date.now(),
  };
  state.activeTimer = timer;
  localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  setTimerUI();
  try {
    await state.service.setActiveTimer(timer);
    showToast(`Shift started for ${timer.taskTitle}.`, "solar:play-circle-linear");
  } catch (error) {
    console.error(error);
    showToast("The clock is running here, but the live status could not update.", "solar:danger-triangle-linear");
  }
}

async function stopTimer() {
  const timer = state.activeTimer;
  if (!timer) return;
  const endedAt = Date.now();
  const durationSeconds = Math.max(1, Math.floor((endedAt - timer.startedAt) / 1000));
  try {
    await state.service.addTimeEntry({ ...timer, endedAt, durationSeconds, createdAt: endedAt });
    await state.service.setActiveTimer(null);
    state.activeTimer = null;
    localStorage.removeItem(TIMER_KEY);
    setTimerUI();
    showToast(`${formatDuration(durationSeconds, true)} added to the time log.`);
  } catch (error) {
    console.error(error);
    showToast("The time entry could not be saved. The clock is still running.", "solar:danger-triangle-linear");
  }
}

function openTaskDialog() {
  elements.dialog.showModal();
  document.body.classList.add("is-dialog-open");
  window.setTimeout(() => elements.taskForm.elements.title.focus(), 50);
}

function closeTaskDialog() {
  const finish = () => {
    elements.dialog.classList.remove("is-closing");
    elements.dialog.close();
    document.body.classList.remove("is-dialog-open");
  };
  if (prefersReducedMotion()) return finish();
  elements.dialog.classList.add("is-closing");
  window.setTimeout(finish, 175);
}

async function handleTaskSubmit(event) {
  event.preventDefault();
  const data = new FormData(elements.taskForm);
  const now = Date.now();
  const workerName = elements.workerName.value.trim() || "Office team";
  const task = {
    title: data.get("title").trim(),
    description: data.get("description").trim(),
    priority: data.get("priority"),
    trade: data.get("trade"),
    zone: data.get("zone").trim(),
    dueDate: data.get("dueDate") || "",
    assignedTo: data.get("assignedTo").trim(),
    status: "open",
    createdByName: workerName,
    createdAt: now,
    updatedAt: now,
  };
  const submit = $("button[type='submit']", elements.taskForm);
  submit.disabled = true;
  submit.textContent = "Adding…";
  try {
    await state.service.addTask(task);
    elements.taskForm.reset();
    closeTaskDialog();
    showToast("Work order added to the board.");
  } catch (error) {
    console.error(error);
    showToast("The work order could not be added.", "solar:danger-triangle-linear");
  } finally {
    submit.disabled = false;
    submit.textContent = "Add to the board";
  }
}

async function toggleTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const complete = task.status !== "done";
  const now = Date.now();
  try {
    await state.service.updateTask(taskId, {
      status: complete ? "done" : "open",
      completedAt: complete ? now : null,
      completedByName: complete ? (elements.workerName.value.trim() || "Site crew") : "",
      updatedAt: now,
    });
    showToast(complete ? "Work order marked complete." : "Work order reopened.", complete ? "solar:check-circle-bold" : "solar:restart-linear");
  } catch (error) {
    console.error(error);
    showToast("The work order could not be updated.", "solar:danger-triangle-linear");
  }
}

function bindInterface() {
  $$('[data-open-task]').forEach((button) => button.addEventListener("click", openTaskDialog));
  $$('[data-close-task]').forEach((button) => button.addEventListener("click", closeTaskDialog));
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) closeTaskDialog();
  });
  elements.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeTaskDialog();
  });
  elements.taskForm.addEventListener("submit", handleTaskSubmit);

  elements.taskList.addEventListener("click", (event) => {
    const button = event.target.closest(".task-check");
    if (!button) return;
    toggleTask(button.closest("[data-task-id]").dataset.taskId);
  });

  $$('[data-filter]').forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    $$('[data-filter]').forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderTasks();
  }));

  $("#task-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderTasks();
  });

  elements.workerName.value = localStorage.getItem(NAME_KEY) || "";
  elements.workerName.addEventListener("input", () => localStorage.setItem(NAME_KEY, elements.workerName.value));
  elements.timerToggle.addEventListener("click", () => state.activeTimer ? stopTimer() : startTimer());
}

function splitWords(element) {
  if (element.dataset.splitReady) return $$(".word-reveal__word", element);
  const text = element.textContent.trim();
  const parts = text.split(/(\s+)/);
  element.textContent = "";
  element.setAttribute("aria-label", text);
  parts.forEach((part, index) => {
    if (!part.trim()) {
      element.appendChild(document.createTextNode(part));
      return;
    }
    const word = document.createElement("span");
    word.className = "word-reveal__word";
    word.setAttribute("aria-hidden", "true");
    word.textContent = part;
    word.style.setProperty("--word-index", index);
    element.appendChild(word);
  });
  element.dataset.splitReady = "true";
  return $$(".word-reveal__word", element);
}

function setupMotion() {
  const heroTitle = $("#hero-title");
  const heroWords = splitWords(heroTitle);
  $$('[data-word-reveal]:not(#hero-title)').forEach(splitWords);

  if (forcedReduce) {
    gsap.set(".word-reveal__word, .site-header, .hero-lede, .hero-actions, .hero-proof, .hero-stage, .stage-ticket, .stage-clock", { clearProps: "all" });
    gsap.from(".hero-copy, .hero-stage", { autoAlpha: 0, duration: .15, stagger: .05 });
    return () => gsap.killTweensOf(".hero-copy, .hero-stage");
  }

  const motion = gsap.matchMedia();
  motion.add("(prefers-reduced-motion: no-preference)", () => {
    const intro = gsap.timeline({ defaults: { ease: "power4.out" } });
    intro
      .from(".site-header", { yPercent: -100, duration: .7 })
      .from(".hero .kicker", { y: 15, autoAlpha: 0, duration: .55 }, "-=.32")
      .from(heroWords, { y: 20, autoAlpha: 0, duration: .8, stagger: .055 }, "-=.28")
      .from(".hero-lede", { y: 18, autoAlpha: 0, duration: .65 }, "-=.48")
      .from(".hero-actions, .hero-proof", { y: 14, autoAlpha: 0, duration: .6, stagger: .1 }, "-=.42")
      .from(".hero-stage", { x: 34, autoAlpha: 0, duration: .9 }, "-=.75")
      .from(".stage-ticket, .stage-clock", { y: 22, autoAlpha: 0, duration: .7, stagger: .12 }, "-=.55");

    $$('[data-word-reveal]:not(#hero-title)').forEach((heading) => {
      const words = $$(".word-reveal__word", heading);
      gsap.from(words, {
        y: 20,
        autoAlpha: 0,
        duration: .8,
        ease: "power4.out",
        stagger: .055,
        scrollTrigger: { trigger: heading, start: "top 82%", once: true },
      });
    });

    const cards = $$(".story-card");
    gsap.timeline({
      scrollTrigger: {
        trigger: ".workflow-story",
        start: "top 18%",
        end: "bottom 72%",
        scrub: 1.05,
        invalidateOnRefresh: true,
      },
    })
      .to(cards[0], { autoAlpha: .28, x: -12, duration: 1, ease: "none" })
      .to(cards[1], { autoAlpha: 1, x: 0, duration: 1, ease: "none" }, "<")
      .to(cards[1], { autoAlpha: .28, x: -12, duration: 1, ease: "none" })
      .to(cards[2], { autoAlpha: 1, x: 0, duration: 1, ease: "none" }, "<")
      .to(".story-stamp", { autoAlpha: 1, scale: 1, rotation: -4, duration: .6, ease: "power3.out" });

    $$("[data-story-step]").forEach((step) => {
      ScrollTrigger.create({
        trigger: step,
        start: "top center",
        end: "bottom center",
        onToggle: ({ isActive }) => step.classList.toggle("is-active", isActive),
      });
    });

    $$(".magnetic").forEach((element) => {
      if (window.matchMedia("(pointer: coarse)").matches) return;
      const xTo = gsap.quickTo(element, "x", { duration: .42, ease: "power3.out" });
      const yTo = gsap.quickTo(element, "y", { duration: .42, ease: "power3.out" });
      const move = (event) => {
        const rect = element.getBoundingClientRect();
        xTo((event.clientX - rect.left - rect.width / 2) * .14);
        yTo((event.clientY - rect.top - rect.height / 2) * .14);
      };
      const leave = () => { xTo(0); yTo(0); };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerleave", leave);
    });

    return () => intro.kill();
  });

  motion.add("(prefers-reduced-motion: reduce)", () => {
    gsap.set(".word-reveal__word, .site-header, .hero-lede, .hero-actions, .hero-proof, .hero-stage, .stage-ticket, .stage-clock", { clearProps: "all" });
    gsap.from(".hero-copy, .hero-stage", { autoAlpha: 0, duration: .15, stagger: .05 });
  });

  window.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  return () => motion.revert();
}

let lenis = null;
const lenisTicker = (time) => lenis?.raf(time * 1000);

function updateSmoothScroll() {
  if (prefersReducedMotion()) {
    if (lenis) {
      gsap.ticker.remove(lenisTicker);
      lenis.destroy();
      lenis = null;
    }
    return;
  }
  if (lenis) return;
  lenis = new Lenis({ lerp: .085, smoothWheel: true, wheelMultiplier: .9, anchors: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(lenisTicker);
  gsap.ticker.lagSmoothing(0);
}

async function initData() {
  state.service = await createDataService();
  setModeBanner();
  const onError = (error) => {
    console.error(error);
    showToast("Live data stopped updating. Check the Firebase rules and connection.", "solar:danger-triangle-linear");
  };
  state.service.subscribeTasks((tasks) => { state.tasks = tasks; renderTasks(); }, onError);
  state.service.subscribeEntries((entries) => { state.entries = entries; renderTimeEntries(); }, onError);
  state.service.subscribeTimers((timers) => {
    state.activeTimers = timers;
    elements.activeCrew.textContent = `${timers.length} active`;
  }, onError);
}

async function init() {
  document.documentElement.classList.add("js");
  $("#footer-year").textContent = new Date().getFullYear();
  state.activeTimer = parseStoredTimer();
  bindInterface();
  setTimerUI();
  updateSmoothScroll();
  reduceQuery.addEventListener("change", updateSmoothScroll);
  const disposeMotion = setupMotion();
  const [{ initBlueprintScene }] = await Promise.all([
    import("./blueprint-scene.js"),
    initData(),
  ]);
  const disposeScene = initBlueprintScene($("#blueprint-canvas"), { forceReduced: forcedReduce });

  if (!isFirebaseConfigured) {
    console.info("Punchlist is running in local demo mode. Copy .env.example to .env and add Firebase values to enable shared realtime data.");
  }

  window.addEventListener("pagehide", () => {
    clearInterval(state.timerInterval);
    reduceQuery.removeEventListener("change", updateSmoothScroll);
    gsap.ticker.remove(lenisTicker);
    lenis?.destroy();
    disposeMotion();
    disposeScene();
    ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
  }, { once: true });
}

init();
