# Spatial Crowdsourcing Simulation Platform (SCSMA)

An interactive, full-stack matching platform implementing the **Gale-Shapley Stable Marriage Algorithm** for Spatial Crowdsourcing task assignment. The system matches spatially-distributed workers with location-based tasks according to customizable preference lists and spatial proximity, guaranteeing mathematical stability (zero blocking pairs).

---

## 🌟 Key Features

- **Role-Based Access Control & Dashboards**:
  - **Requester Dashboard**: Post location-based service tasks (with coordinates and profession requirements), view eligible registered workers, reorder worker preferences, and rate completed tasks upon completion.
  - **Worker Dashboard**: Set availability, coordinates, and profession (e.g. Plumber, Electrician, Carpenter); dynamically browse eligible tasks matching their profession and reorder task preferences.
  - **Administrator Dashboard**: Centralized spatial crowdsourcing engine with interactive 2D SVG map, real-time preference matrices, proposal history, and algorithm control.
- **Dual-Mode Gale-Shapley Simulation**:
  - **Worker-Proposing Mode**: Yields worker-optimal stable matching.
  - **Task-Proposing Mode**: Yields requester/task-optimal stable matching.
  - **Mathematical Stability Verification**: Computes blocking pairs dynamically to prove that no worker and task prefer each other over their assigned matches.
- **Interactive Spatial Visualization**:
  - Step-by-step or automated animated simulation with customizable playback speed.
  - Color-coded glowing halos for active proposers and targets.
  - Animated proposal lines and solid engagement match lines.
  - Clickable nodes to inspect individual preference rankings.
- **Interactive Standalone Demo Sandbox (`demo.html`)**:
  - Zero-backend client-side sandbox to explore the Gale-Shapley algorithm.
  - Draggable worker and task nodes, customizable counts, preference generation, and real-time distance statistics (average, minimum, and maximum distances).
- **Real-Time Database Sync**:
  - Integrated with Supabase (Auth, Postgres DB, and Realtime WebSocket subscriptions) to synchronize task updates and profile changes instantly across clients.

---

## 📁 Project Structure

```
StableMarriage-main/
├── StableMarriage-main/             # Main application source
│   ├── .vscode/
│   │   └── launch.json              # VS Code debug configuration (Port 3000)
│   ├── .env.example                 # Template for required environment variables
│   ├── demo.css                     # Stylesheet for standalone sandbox
│   ├── demo.html                    # Standalone interactive demo sandbox
│   ├── demo.js                      # Logic and visualizer for standalone demo
│   ├── index.html                   # Main full-stack application (Requester / Worker / Admin)
│   ├── package.json                 # Project dependencies & start script
│   ├── schema.sql                   # Supabase database schema and RLS policies
│   ├── script.js                    # Frontend application logic & spatial visualizer
│   ├── server.js                    # Node.js/Express backend & Gale-Shapley engine
│   └── style.css                    # Design system & dark/light theme styling
├── .env.example                     # Root environment template
├── .gitignore                       # Git ignore configuration
├── package.json                     # Root shortcut runner
└── README.md                        # Documentation and setup guide
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v16.x or newer, v20+ recommended)
- **npm** (included with Node.js)
- A **Supabase** project (or access to the pre-configured project)

---

### 2. Installation

1. Clone or open the repository directory:
   ```bash
   cd StableMarriage-main
   ```

2. Install dependencies:
   ```bash
   cd StableMarriage-main
   npm install
   ```

---

### 3. Environment Configuration

1. In `StableMarriage-main/` (or project root), ensure a `.env` file exists with your Supabase credentials. A template is provided in `.env.example`:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_KEY=your-supabase-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   PORT=3000
   ```

2. If setting up a fresh Supabase database, execute `schema.sql` in the **Supabase SQL Editor** to establish the necessary tables (`tasks`, `worker_profiles`, `user_roles`, `task_offers`) and Row Level Security (RLS) policies.

---

### 4. Running the Application

Start the backend server using npm:
```bash
# From within StableMarriage-main/
npm start

# Or from the project root:
node StableMarriage-main/server.js
```

The matching engine and static server will start on port `3000`:
```
Production Matching Engine running on port 3000
```

---

### 5. Accessing the Application

- **Full-Stack Application**: Open [http://localhost:3000/index.html](http://localhost:3000/index.html) in your browser.
- **Standalone Demo Sandbox**: Open [http://localhost:3000/demo.html](http://localhost:3000/demo.html) directly or click **View Demo** from the app header.

---

## 📖 Usage Guide

### Standard Demo Scenario (Quickstart)
1. Open [http://localhost:3000](http://localhost:3000).
2. Log in with an Administrator account (or register with role **Administrator**).
3. Under **Simulation Controls**, click **⚡ Load 3 Tasks & 4 Workers Scenario**.
   - Automatically initializes 3 Plumbing Tasks (`Requester A`, `Requester B`, `Requester C`) and 4 Plumbers (`Worker 1` to `Worker 4`) with pre-configured preference lists.
4. Select the matching mode:
   - **Worker-Proposing**: Workers propose to tasks in order of preference.
   - **Task-Proposing**: Tasks propose to workers in order of preference.
5. Click **▶ Start Simulation** to watch automated step execution, or click **⏭ Next Step** to step through each proposal, acceptance, rejection, and replacement manually.
6. Once converged, the modal displays total proposals, verified stability, and 0 blocking pairs.

### Testing Requester & Worker Workflows
1. **Requester**:
   - Register an account with role **Requester**.
   - Input task coordinates (X, Y) or click **🎲 Randomize**, choose a profession category (e.g. *Plumber*), and click **Post Task**.
   - Reorder eligible workers under **Your Preference Ranking** using the ▲ / ▼ buttons and save preferences.
   - Once matched, click **Finish & Rate** to give the worker a star rating (1–5 stars) and complete the task.
2. **Worker**:
   - Register an account with role **Worker** and select your profession.
   - Update your coordinates (X, Y) and availability toggle.
   - View eligible tasks within your category, reorder your task preferences, and click **💾 Save Task Preferences**.
   - View active assigned matches and job history.

---

## 🛠️ Summary of Bug Fixes & Improvements

During the comprehensive audit, the following issues were identified and resolved:

1. **Server Environment Snapshot Bug**:
   - *Issue*: `/api/simulation/environment` queried tasks strictly with status `pending/offered` and workers with `is_available = true`. When Gale-Shapley matching completed, all tasks were updated to `assigned` and workers to `is_available = false`, causing the entire visualizer map to clear and disappear immediately.
   - *Fix*: Updated the environment endpoint to retain all active and assigned tasks (`in ('pending', 'pending_matching', 'offered', 'assigned')`) and all worker profiles so matches remain visible on the map.

2. **Task-Proposing Visualization Highlighting**:
   - *Issue*: `renderSpatialVisualization` in `script.js` assumed tasks could only ever be targets and workers could only ever be proposers. In Task-Proposing mode, neither the proposing task nor the targeted worker received active halos or stroke highlights.
   - *Fix*: Made highlighting symmetrical across modes for both tasks and workers.

3. **Task-Proposing Match State & Ghost Lines**:
   - *Issue*: In Task-Proposing mode, when a worker bumped an existing tentative task to accept a newly proposed one, `taskHolds[s.replacedTaskId]` was never removed in `script.js`, causing workers to retain ghost matches and multiple lines to different tasks.
   - *Fix*: Added `delete taskHolds[s.replacedTaskId]` on replacement steps.

4. **Coordinate Coercion (Zero Coordinate Bug)**:
   - *Issue*: `lat || 180` caused valid `0` coordinates to be overwritten with fallback values (`180`).
   - *Fix*: Refactored to `Number.isFinite(coord) ? Number(coord) : fallback` and unified coordinate helpers across the codebase.

5. **Leaked Prompt Junk in `style.css`**:
   - *Issue*: Raw prompt text (`</USER_REQUEST>`, `<ADDITIONAL_METADATA>`) was accidentally embedded in `style.css` around line 672, followed by duplicated blocks of `.screen` and `.auth-form`.
   - *Fix*: Cleaned out the invalid syntax and deduplicated the stylesheet.

6. **Squashed Task Card Layout**:
   - *Issue*: `ul#requester-tasks-list li` had `display: flex; justify-content: space-between; align-items: center;` without column orientation, squishing the task header, action buttons, and preference list onto a single horizontal line.
   - *Fix*: Configured flex direction to column with structured gap spacing.

7. **Malformed HTML Tag in `demo.js`**:
   - *Issue*: Line 489 had `<div="completion-stat-grid">` missing the `class` attribute name.
   - *Fix*: Corrected to `<div class="completion-stat-grid">`.

8. **Unsafe Index Check in `demo.js` `prefers()`**:
   - *Issue*: `indexOf()` returning `-1` caused unranked entities to take priority over ranked ones (`-1 < currentRank`).
   - *Fix*: Added explicit `-1` guard checks in preference comparisons.

9. **Premature Convergence Popup on "Next Step"**:
   - *Issue*: Clicking "Next Step" before simulation initialization triggered `finishSimulation()`, showing a convergence popup with 0 matches.
   - *Fix*: Added step initialization checks; clicking "Next Step" when uninitialized now launches step-by-step matching properly.

10. **Relative Path Resolution & Port Configuration**:
    - *Issue*: Running the server from outside `StableMarriage-main/` broke `.env` discovery and static file serving.
    - *Fix*: Used `path.resolve(__dirname, '.env')` and `express.static(__dirname)`. Corrected `launch.json` port from 3001 to 3000.

11. **Cleanup of 21+ Throwaway Scratch Scripts**:
    - Safely deleted one-off patch scripts (`add_container.js`, `add_play.js`, `append_css.js`, `extract.js`, `fix*.js`, `rebuild_css.js`, `update_*.js`, `wrap_*.js`, `user_light_css.css`, `_debug_repro.js`, `.cursor/debug-*.log`).

---

## 📜 License
This project is open-source and available under the MIT License.
