const KEYS = {
  tasks: "punchlist_tasks_v1",
  entries: "punchlist_entries_v1",
  timers: "punchlist_active_timers_v1",
  user: "punchlist_local_user_v1",
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

const safeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const sampleTasks = () => {
  const now = Date.now();
  return [
    {
      id: uid(),
      title: "Stop the slow leak under the reception sink",
      description: "Water is collecting along the back of the cabinet. Shutoff is inside the left door.",
      priority: "urgent",
      trade: "Plumbing",
      zone: "Lobby",
      dueDate: new Date(now + 86400000).toISOString().slice(0, 10),
      assignedTo: "Morning crew",
      status: "open",
      createdByName: "Office team",
      createdAt: now - 25 * 60000,
      updatedAt: now - 25 * 60000,
    },
    {
      id: uid(),
      title: "Replace two flickering conference room lights",
      description: "Fixtures above the south end of the table. Matching lamps are in storage B12.",
      priority: "high",
      trade: "Electrical",
      zone: "Floor 3 · Juniper room",
      dueDate: new Date(now + 2 * 86400000).toISOString().slice(0, 10),
      assignedTo: "",
      status: "open",
      createdByName: "Office team",
      createdAt: now - 85 * 60000,
      updatedAt: now - 85 * 60000,
    },
    {
      id: uid(),
      title: "Touch up the loading dock door frame",
      description: "Sand the lower edge before applying the gray enamel kept in the maintenance cage.",
      priority: "medium",
      trade: "Painting",
      zone: "Loading dock",
      dueDate: "",
      assignedTo: "",
      status: "open",
      createdByName: "Office team",
      createdAt: now - 4 * 3600000,
      updatedAt: now - 4 * 3600000,
    },
    {
      id: uid(),
      title: "Secure the loose cabinet pull in the copy room",
      description: "Completed with a new machine screw and thread locker.",
      priority: "low",
      trade: "Carpentry",
      zone: "Floor 2 · Copy room",
      dueDate: "",
      assignedTo: "N. Flores",
      status: "done",
      completedByName: "N. Flores",
      completedAt: now - 2 * 3600000,
      createdByName: "Office team",
      createdAt: now - 28 * 3600000,
      updatedAt: now - 2 * 3600000,
    },
  ];
};

class LocalService {
  constructor() {
    this.mode = "local";
    this.userId = localStorage.getItem(KEYS.user) || uid();
    localStorage.setItem(KEYS.user, this.userId);
    this.listeners = { tasks: new Set(), entries: new Set(), timers: new Set() };
    this.channel = "BroadcastChannel" in window ? new BroadcastChannel("punchlist-local-sync") : null;
    this.channel?.addEventListener("message", () => this.emitAll());
    window.addEventListener("storage", () => this.emitAll());

    if (!localStorage.getItem(KEYS.tasks)) {
      localStorage.setItem(KEYS.tasks, JSON.stringify(sampleTasks()));
    }
  }

  read(key) {
    return safeParse(localStorage.getItem(key), []);
  }

  write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    this.channel?.postMessage({ key, time: Date.now() });
    this.emitAll();
  }

  emit(type) {
    const key = KEYS[type];
    const rows = this.read(key).sort((a, b) => (b.createdAt || b.startedAt || 0) - (a.createdAt || a.startedAt || 0));
    this.listeners[type].forEach((callback) => callback(rows));
  }

  emitAll() {
    this.emit("tasks");
    this.emit("entries");
    this.emit("timers");
  }

  subscribe(type, callback) {
    this.listeners[type].add(callback);
    queueMicrotask(() => this.emit(type));
    return () => this.listeners[type].delete(callback);
  }

  subscribeTasks(callback) { return this.subscribe("tasks", callback); }
  subscribeEntries(callback) { return this.subscribe("entries", callback); }
  subscribeTimers(callback) { return this.subscribe("timers", callback); }

  async addTask(task) {
    this.write(KEYS.tasks, [{ ...task, id: uid() }, ...this.read(KEYS.tasks)]);
  }

  async updateTask(id, changes) {
    this.write(KEYS.tasks, this.read(KEYS.tasks).map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  async addTimeEntry(entry) {
    this.write(KEYS.entries, [{ ...entry, id: uid() }, ...this.read(KEYS.entries)]);
  }

  async setActiveTimer(timer) {
    const otherTimers = this.read(KEYS.timers).filter((item) => item.userId !== this.userId);
    this.write(KEYS.timers, timer ? [{ ...timer, userId: this.userId }, ...otherTimers] : otherTimers);
  }
}

class FirebaseService {
  constructor(app, auth, db, firestore) {
    this.mode = "firebase";
    this.app = app;
    this.auth = auth;
    this.db = db;
    this.firestore = firestore;
    this.userId = auth.currentUser.uid;
  }

  subscribeTasks(callback, onError) {
    const { collection, limit, onSnapshot, orderBy, query } = this.firestore;
    return onSnapshot(
      query(collection(this.db, "tasks"), orderBy("createdAt", "desc"), limit(250)),
      (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      onError
    );
  }

  subscribeEntries(callback, onError) {
    const { collection, limit, onSnapshot, orderBy, query } = this.firestore;
    return onSnapshot(
      query(collection(this.db, "timeEntries"), orderBy("endedAt", "desc"), limit(250)),
      (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      onError
    );
  }

  subscribeTimers(callback, onError) {
    const { collection, limit, onSnapshot, orderBy, query } = this.firestore;
    return onSnapshot(
      query(collection(this.db, "activeTimers"), orderBy("startedAt", "desc"), limit(100)),
      (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      onError
    );
  }

  async addTask(task) {
    const { addDoc, collection } = this.firestore;
    await addDoc(collection(this.db, "tasks"), { ...task, createdBy: this.userId });
  }

  async updateTask(id, changes) {
    const { doc, updateDoc } = this.firestore;
    await updateDoc(doc(this.db, "tasks", id), changes);
  }

  async addTimeEntry(entry) {
    const { addDoc, collection } = this.firestore;
    await addDoc(collection(this.db, "timeEntries"), { ...entry, userId: this.userId });
  }

  async setActiveTimer(timer) {
    const { deleteDoc, doc, setDoc } = this.firestore;
    const timerRef = doc(this.db, "activeTimers", this.userId);
    if (timer) {
      await setDoc(timerRef, { ...timer, userId: this.userId });
    } else {
      await deleteDoc(timerRef);
    }
  }
}

export async function createDataService() {
  if (!isFirebaseConfigured) return new LocalService();

  try {
    const [{ initializeApp }, { getAuth, signInAnonymously }, firestore] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
      import("firebase/firestore"),
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    await signInAnonymously(auth);
    const db = firestore.getFirestore(app);
    return new FirebaseService(app, auth, db, firestore);
  } catch (error) {
    console.warn("Firebase could not start; using local demo mode.", error);
    const local = new LocalService();
    local.startupError = error;
    return local;
  }
}

export { isFirebaseConfigured };
