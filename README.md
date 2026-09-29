# Punchlist

Punchlist is a realtime office-maintenance board for distributed contractor teams. It tracks prioritized work orders, completions, active contractors, and time entries in one responsive interface.

## Run locally

```bash
npm install
npm run dev
```

Without Firebase settings, the app runs in a clearly labeled local demo mode. Data is saved in that browser with `localStorage` and synchronizes between tabs on the same origin.

## Enable worldwide shared data

GitHub Pages serves static files, so Punchlist uses Firebase Authentication and Cloud Firestore for multi-user realtime storage.

1. Create a Firebase project and register a web app.
2. Enable **Anonymous** sign-in under Firebase Authentication.
3. Create a Cloud Firestore database.
4. Copy `.env.example` to `.env` and add the web app configuration values.
5. Deploy `firestore.rules` with the Firebase CLI or paste those rules into the Firestore Rules console.
6. Restart the development server. The status strip should read **Live board connected**.

The browser-visible Firebase configuration values identify the project; they are not server secrets. Access control lives in `firestore.rules`. For a private office deployment, replace anonymous sign-in with a permanent provider such as Google sign-in and restrict rules to approved users or a company domain.

## Deploy to GitHub Pages

The included GitHub Actions workflow builds and deploys on every push to `main`.

1. In the GitHub repository, open **Settings → Pages** and select **GitHub Actions** as the source.
2. Under **Settings → Secrets and variables → Actions**, add the six `VITE_FIREBASE_*` secrets listed in `.env.example`.
3. Push to `main`, or run the **Deploy Punchlist to GitHub Pages** workflow manually.

`vite.config.js` uses relative asset paths, so the build works from a repository subpath such as `https://username.github.io/repository/`.

## Data model

- `tasks`: work-order details, priority, trade, location, assignee, and completion state.
- `timeEntries`: immutable stopped-shift records with contractor, task, timestamps, and duration.
- `activeTimers`: one live timer record per anonymous Firebase user.

## Motion and accessibility

GSAP and ScrollTrigger choreograph the introduction and workflow story. Lenis is the only smooth-scroll engine. The hero blueprint uses a small Three.js shader with capped pixel ratio, visibility pausing, reduced-motion freezing, and explicit GPU cleanup. `prefers-reduced-motion` disables smooth scroll, scrubbed depth, and continuous canvas motion while preserving concise opacity feedback and focus states.

Append `?reduce=1` to any local or deployed URL to exercise the same simplified JavaScript and WebGL path during visual QA.
