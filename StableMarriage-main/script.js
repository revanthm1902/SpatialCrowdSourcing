let supabaseClient;
let currentUser = null;
let currentRole = null;
let realtimeSubscription = null;

// Admin & Simulation State
let adminTasks = [];
let adminWorkers = [];
let adminUserEmails = {};
let adminTaskPreferences = {};
let adminWorkerPreferences = {};
let isAnimating = false;
let simulationSteps = [];
let currentStepIndex = 0;
let animationTimer = null;
let animationSpeed = 800;

// Request ID sequence guards
let requesterTasksReqId = 0;
let workerAssignedReqId = 0;

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const appContainer = document.getElementById('app-container');
const userInfo = document.getElementById('user-info');
const authError = document.getElementById('auth-error');
const API_URL = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('http'))
    ? window.location.origin
    : 'http://localhost:3000';
const SVG_NS = "http://www.w3.org/2000/svg";

const dashboards = {
    requester: document.getElementById('requester-dashboard'),
    worker: document.getElementById('worker-dashboard'),
    admin: document.getElementById('admin-dashboard')
};

// Utilities
function debounce(fn, delay = 100) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function calculateDistance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2)).toFixed(2);
}

function getTaskPos(t, i = 0) {
    return {
        x: Number.isFinite(t.lat) ? Number(t.lat) : (180 + (i % 3) * 200),
        y: Number.isFinite(t.lng) ? Number(t.lng) : (180 + Math.floor(i / 3) * 160)
    };
}

function getWorkerPos(w, i = 0) {
    return {
        x: Number.isFinite(w.current_lat) ? Number(w.current_lat) : (140 + (i % 4) * 160),
        y: Number.isFinite(w.current_lng) ? Number(w.current_lng) : (120 + (i % 2) * 200)
    };
}

window.toggleWorkerProfessionField = function(role) {
    const group = document.getElementById('worker-profession-group');
    if (group) {
        group.style.display = role === 'worker' ? 'block' : 'none';
    }
    const registerBtn = document.getElementById('btn-register');
    if (registerBtn) {
        registerBtn.style.display = role === 'admin' ? 'none' : '';
    }
};

// Event Listeners
document.getElementById('btn-login').addEventListener('click', handleLogin);
document.getElementById('btn-register').addEventListener('click', handleRegister);
document.getElementById('btn-logout').addEventListener('click', handleLogout);
const roleSelectEl = document.getElementById('role-select');
if (roleSelectEl) {
    roleSelectEl.addEventListener('change', (e) => toggleWorkerProfessionField(e.target.value));
    toggleWorkerProfessionField(roleSelectEl.value);
}

if (document.getElementById('btn-theme')) {
    document.getElementById('btn-theme').addEventListener('click', () => {
        const html = document.documentElement;
        html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
    });
}

document.getElementById('btn-create-task').addEventListener('click', handleCreateTask);
document.getElementById('btn-update-worker').addEventListener('click', handleUpdateWorkerProfile);

if (document.getElementById('btn-start')) document.getElementById('btn-start').addEventListener('click', () => startSimulation(false));
if (document.getElementById('btn-next-step')) {
    document.getElementById('btn-next-step').addEventListener('click', async () => {
        if (simulationSteps.length === 0) {
            await startSimulation(true);
        } else {
            stepSimulation();
        }
    });
}
if (document.getElementById('btn-clear-db')) document.getElementById('btn-clear-db').addEventListener('click', handleClearDB);
if (document.getElementById('btn-load-demo')) document.getElementById('btn-load-demo').addEventListener('click', handleLoadDemoScenario);

if (document.getElementById('btn-randomize-task')) document.getElementById('btn-randomize-task').addEventListener('click', randomizeTaskInputs);
if (document.getElementById('btn-randomize-worker')) document.getElementById('btn-randomize-worker').addEventListener('click', randomizeWorkerInputs);

const speedSlider = document.getElementById('speed-slider');
if (speedSlider) {
    speedSlider.addEventListener('input', (e) => {
        animationSpeed = parseInt(e.target.value);
        document.getElementById('speed-display').textContent = `${animationSpeed}ms`;
    });
}

if (document.getElementById('btn-close-summary')) {
    document.getElementById('btn-close-summary').addEventListener('click', () => {
        document.getElementById('completion-overlay').classList.add('hidden');
    });
}

// Star rating UI
document.querySelectorAll('.star-rating span').forEach(star => {
    star.addEventListener('click', function() {
        const val = this.getAttribute('data-val');
        document.getElementById('rating-val').value = val;
        document.querySelectorAll('.star-rating span').forEach(s => {
            s.classList.toggle('active', s.getAttribute('data-val') <= val);
        });
    });
});

function randomizeTaskInputs() {
    document.getElementById('task-x').value = Math.floor(Math.random() * 600) + 100;
    document.getElementById('task-y').value = Math.floor(Math.random() * 300) + 50;
}
function randomizeWorkerInputs() {
    document.getElementById('worker-x').value = Math.floor(Math.random() * 600) + 100;
    document.getElementById('worker-y').value = Math.floor(Math.random() * 300) + 50;
}

// ================= INITIALIZATION & AUTH =================

async function initializeApp() {
    try {
        const response = await fetch(API_URL + '/api/config');
        if (!response.ok) throw new Error('Config fetch failed');
        const config = await response.json();
        
        supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
        if (sessionStorage.getItem('fixedAdminUser') === 'true') {
            checkUserAndRoute();
        }
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') checkUserAndRoute();
        });
    } catch(e) {
        authError.textContent = "Cannot connect to server. Ensure 'node server.js' is running.";
    }
}
initializeApp();

async function handleLogin() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    authError.textContent = '';

    if (email.toLowerCase() === 'admin@gmail.com') {
        if (password === 'admin') {
            sessionStorage.setItem('fixedAdminUser', 'true');
            currentUser = { id: 'admin@gmail.com', email: 'admin@gmail.com' };
            currentRole = 'admin';
            userInfo.textContent = `User: admin (${currentRole})`;
            try {
                const emailRes = await fetch(API_URL + '/api/users');
                if (emailRes.ok) adminUserEmails = await emailRes.json();
            } catch(e){}
            showScreen('app', currentRole);
            initializeDashboard(currentRole);
            return;
        } else {
            authError.textContent = 'Login Error: Invalid login credentials';
            return;
        }
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) { authError.textContent = 'Login Error: ' + error.message; }
}

async function handleRegister() {
    const roleSelect = document.getElementById('role-select');
    if (roleSelect && !roleSelect.value) { authError.textContent = 'Please select a role.'; return; }
    const role = roleSelect.value;
    if (role === 'admin') {
        authError.textContent = 'Admin accounts cannot be registered here. New admins must be added into the backend directly.';
        return;
    }
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    
    let jobType = 'Plumber';
    if (role === 'worker') {
        const jobSelect = document.getElementById('worker-register-job-type');
        jobType = jobSelect ? jobSelect.value : 'Plumber';
        if (jobType === 'Other') {
            jobType = document.getElementById('worker-register-job-custom').value.trim() || 'Plumber';
        }
    }

    authError.textContent = 'Registering...';
    try {
        const response = await fetch(API_URL + '/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, role, job_type: jobType })
        });
        const data = await response.json();
        if (!response.ok) authError.textContent = 'Registration Error: ' + (data.error || 'Unknown error');
        else authError.textContent = `✓ Registered as ${role.toUpperCase()} (${role === 'worker' ? jobType : ''})! You can now login.`;
    } catch(e) {
        authError.textContent = "Registration failed.";
    }
}

async function handleLogout() {
    sessionStorage.removeItem('fixedAdminUser');
    if (supabaseClient) {
        await supabaseClient.auth.signOut();
    }
    currentUser = null;
    currentRole = null;
    if (realtimeSubscription) {
        supabaseClient.removeChannel(realtimeSubscription);
        realtimeSubscription = null;
    }
    showScreen('auth');
}

async function checkUserAndRoute() {
    if (sessionStorage.getItem('fixedAdminUser') === 'true') {
        currentUser = { id: 'admin@gmail.com', email: 'admin@gmail.com' };
        currentRole = 'admin';
        userInfo.textContent = `User: admin (${currentRole})`;
        
        try {
            const emailRes = await fetch(API_URL + '/api/users');
            if (emailRes.ok) adminUserEmails = await emailRes.json();
        } catch(e){}

        showScreen('app', currentRole);
        initializeDashboard(currentRole);
        return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        currentUser = user;
        const { data, error } = await supabaseClient.from('user_roles').select('role').eq('user_id', user.id).single();
        if (error || !data) {
            await supabaseClient.auth.signOut();
            showScreen('auth');
            return;
        }
        currentRole = data.role;
        userInfo.textContent = `User: ${user.email.split('@')[0]} (${currentRole})`;
        
        try {
            const emailRes = await fetch(API_URL + '/api/users');
            if (emailRes.ok) adminUserEmails = await emailRes.json();
        } catch(e){}

        showScreen('app', currentRole);
        initializeDashboard(currentRole);
    } else {
        showScreen('auth');
    }
}

function showScreen(screen, role = null) {
    authScreen.style.display = screen === 'auth' ? 'block' : 'none';
    appContainer.style.display = screen === 'app' ? 'flex' : 'none';
    if (screen === 'auth') {
        const roleSel = document.getElementById('role-select');
        if (roleSel) toggleWorkerProfessionField(roleSel.value);
    }
    if (screen === 'app' && role) {
        Object.keys(dashboards).forEach(r => { if(dashboards[r]) dashboards[r].classList.add('hidden'); });
        if(dashboards[role]) dashboards[role].classList.remove('hidden');
    }
}

const debouncedLoadRequesterTasks = debounce(loadRequesterTasks, 100);
const debouncedLoadWorkerTasks = debounce(() => { loadWorkerProfile(); loadWorkerEligibleTasks(); loadWorkerAssignedTask(); }, 100);
const debouncedLoadAdminData = debounce(loadAdminData, 100);

function initializeDashboard(role) {
    if (realtimeSubscription) {
        supabaseClient.removeChannel(realtimeSubscription);
        realtimeSubscription = null;
    }
    
    if (role === 'requester') {
        loadRequesterTasks();
        realtimeSubscription = supabaseClient.channel('requester-channel-' + currentUser.id)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => debouncedLoadRequesterTasks())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'task_offers' }, () => debouncedLoadRequesterTasks())
            .subscribe();
    } else if (role === 'worker') {
        loadWorkerProfile();
        loadWorkerEligibleTasks();
        loadWorkerAssignedTask();
        realtimeSubscription = supabaseClient.channel('worker-channel-' + currentUser.id)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => debouncedLoadWorkerTasks())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'task_offers' }, () => debouncedLoadWorkerTasks())
            .subscribe();
    } else if (role === 'admin') {
        loadAdminData();
        setupAdminRealtime();
    }
}

// ================= REQUESTER LOGIC =================

async function handleCreateTask() {
    const x = parseFloat(document.getElementById('task-x').value);
    const y = parseFloat(document.getElementById('task-y').value);
    let type = document.getElementById('task-type').value;
    if (type === 'Other') type = document.getElementById('task-type-custom').value.trim();
    const msg = document.getElementById('task-msg');
    
    if (isNaN(x) || isNaN(y) || !type) { msg.textContent = 'Please enter valid coordinates and profession.'; return; }

    const btn = document.getElementById('btn-create-task');
    if (btn) btn.disabled = true;

    const { data: created, error } = await supabaseClient.from('tasks').insert([{
        requester_id: currentUser.id,
        lat: x,
        lng: y,
        required_job_type: type,
        status: 'pending'
    }]).select('*');

    if (btn) btn.disabled = false;

    if (error) {
        msg.textContent = 'Error: ' + error.message;
    } else {
        msg.textContent = '✓ Service Task Created! Eligible workers are listed below.';
        document.getElementById('task-x').value = '';
        document.getElementById('task-y').value = '';
        debouncedLoadRequesterTasks();
    }
}

async function loadRequesterTasks() {
    const currentReqId = ++requesterTasksReqId;
    const { data: tasks, error } = await supabaseClient.from('tasks')
        .select('*')
        .eq('requester_id', currentUser.id)
        .order('created_at', { ascending: false });
    
    if (currentReqId !== requesterTasksReqId) return;
    if (error || !tasks) return;
    
    const activeList = document.getElementById('requester-tasks-list');
    const completedList = document.getElementById('requester-completed-tasks-list');
    if (!activeList || !completedList) return;
    
    let activeHtml = '';
    let completedHtml = '';
    
    for (const t of tasks) {
        if (t.status === 'completed') {
            completedHtml += `<li class="task-item" style="border-left-color:var(--accent-green)">
                <div><strong>${t.required_job_type}</strong> | Loc: (${t.lat}, ${t.lng}) | <span style="color:var(--accent-green);">★ Completed</span></div>
            </li>`;
            continue;
        }

        let eligibleWorkers = [];
        try {
            const wRes = await fetch(`${API_URL}/api/eligible_workers?job_type=${encodeURIComponent(t.required_job_type)}`);
            if (wRes.ok) eligibleWorkers = await wRes.json();
        } catch(e){}

        let savedPrefs = [];
        try {
            const pRes = await fetch(`${API_URL}/api/tasks/${t.id}/preferences`);
            if (pRes.ok) {
                const pData = await pRes.json();
                savedPrefs = pData.preferences || [];
            }
        } catch(e){}

        const orderedWorkers = [];
        savedPrefs.forEach(wId => {
            const found = eligibleWorkers.find(w => w.user_id === wId);
            if (found) orderedWorkers.push(found);
        });
        eligibleWorkers.forEach(w => {
            if (!orderedWorkers.some(ow => ow.user_id === w.user_id)) orderedWorkers.push(w);
        });

        let prefItemsHtml = '';
        if (orderedWorkers.length === 0) {
            prefItemsHtml = `<div style="font-size:0.8rem; color:var(--text-muted); padding:5px 0;">No available ${t.required_job_type} workers registered in system yet.</div>`;
        } else {
            orderedWorkers.forEach((w, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === orderedWorkers.length - 1;
                prefItemsHtml += `
                    <li class="pref-item" data-worker-id="${w.user_id}">
                        <div style="display:flex; align-items:center;">
                            <span class="pref-rank-badge">#${idx + 1}</span>
                            <div>
                                <strong>${w.email.split('@')[0]}</strong>
                                <span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px;">(★ ${Number(w.rating).toFixed(1)} | Exp: ${w.experience} jobs)</span>
                            </div>
                        </div>
                        <div class="pref-controls">
                            <button class="btn-reorder" onclick="reorderTaskWorkerPref('${t.id}', ${idx}, -1)" ${isFirst ? 'disabled' : ''} title="Move Up">▲</button>
                            <button class="btn-reorder" onclick="reorderTaskWorkerPref('${t.id}', ${idx}, 1)" ${isLast ? 'disabled' : ''} title="Move Down">▼</button>
                        </div>
                    </li>
                `;
            });
        }

        let actionHtml = '';
        if (t.status === 'assigned') {
            const assignedWorkerName = adminUserEmails[t.assigned_worker_id] ? adminUserEmails[t.assigned_worker_id].split('@')[0] : 'Worker';
            actionHtml = `
                <div style="background:rgba(52, 211, 153, 0.15); border-left:4px solid var(--accent-green); padding:8px 12px; border-radius:6px; margin:10px 0;">
                    <strong style="color:var(--accent-green);">✓ Gale-Shapley Match: Assigned to ${assignedWorkerName}</strong>
                    <button class="btn btn-primary" style="width:auto; padding:4px 10px; margin-left:10px; display:inline-block;" onclick="openRateModal('${t.id}', '${t.assigned_worker_id}')">Finish & Rate</button>
                </div>
            `;
        } else {
            actionHtml = `
                <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
                    <button class="btn btn-primary" style="width:auto; padding:5px 12px; font-size:0.75rem;" onclick="saveTaskWorkerPreferences('${t.id}')">💾 Save Worker Preferences</button>
                    <button class="btn btn-secondary" style="width:auto; padding:5px 10px; font-size:0.75rem;" onclick="deleteTask('${t.id}')">Delete Task</button>
                </div>
            `;
        }

        activeHtml += `
            <li class="task-item" style="border-left-color: ${t.status === 'assigned' ? 'var(--accent-green)' : 'var(--accent-purple)'}">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div>
                        <strong style="font-size:1rem; color:var(--text-primary);">${t.required_job_type} Task</strong> 
                        <span style="font-size:0.8rem; color:var(--text-muted); margin-left:6px;">Loc: (${t.lat}, ${t.lng})</span>
                    </div>
                    <span class="status-badge ${t.status === 'assigned' ? 'status-completed' : 'status-running'}">${t.status}</span>
                </div>

                ${actionHtml}

                <div class="pref-container">
                    <div class="pref-title">
                        <span>Your Preference Ranking for Eligible Workers:</span>
                        <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">(Top = highest priority)</span>
                    </div>
                    <ul id="task-pref-list-${t.id}" class="pref-list">${prefItemsHtml}</ul>
                </div>
            </li>
        `;
    }

    if (currentReqId === requesterTasksReqId) {
        activeList.innerHTML = activeHtml || '<li class="task-item" style="color:var(--text-muted); border-left:none;">No active tasks posted yet. Create one on the left!</li>';
        completedList.innerHTML = completedHtml || '<li class="task-item" style="color:var(--text-muted); border-left:none;">No completed tasks yet.</li>';
    }
}

window.reorderTaskWorkerPref = function(taskId, fromIndex, direction) {
    const list = document.getElementById(`task-pref-list-${taskId}`);
    if (!list) return;
    const items = Array.from(list.children);
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= items.length) return;

    const workerIds = items.map(el => el.getAttribute('data-worker-id'));
    const temp = workerIds[fromIndex];
    workerIds[fromIndex] = workerIds[toIndex];
    workerIds[toIndex] = temp;

    fetch(`${API_URL}/api/tasks/${taskId}/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: workerIds })
    }).then(() => loadRequesterTasks());
};

window.saveTaskWorkerPreferences = async function(taskId) {
    const list = document.getElementById(`task-pref-list-${taskId}`);
    if (!list) return;
    const items = Array.from(list.children);
    const workerIds = items.map(el => el.getAttribute('data-worker-id')).filter(Boolean);

    await fetch(`${API_URL}/api/tasks/${taskId}/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: workerIds })
    });
    alert('✓ Worker preference ranking saved for this task!');
    loadRequesterTasks();
};

window.deleteTask = async function(id) {
    if (!confirm('Are you sure you want to delete this task?')) return;
    await fetch(API_URL + '/api/tasks/' + id, { method: 'DELETE' });
    debouncedLoadRequesterTasks();
};

window.openRateModal = function(taskId, workerId) {
    document.getElementById('btn-submit-rating').onclick = async () => {
        const rating = document.getElementById('rating-val').value;
        await fetch(API_URL + '/api/tasks/rate_worker', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ task_id: taskId, worker_id: workerId, rating: parseInt(rating) })
        });
        document.getElementById('rate-worker-modal').classList.add('hidden');
        debouncedLoadRequesterTasks();
    };
    document.getElementById('rate-worker-modal').classList.remove('hidden');
};

// ================= WORKER LOGIC =================

async function loadWorkerProfile() {
    const { data } = await supabaseClient.from('worker_profiles').select('*').eq('user_id', currentUser.id).single();
    if (data) {
        document.getElementById('worker-x').value = data.current_lat || '';
        document.getElementById('worker-y').value = data.current_lng || '';
        document.getElementById('worker-available').checked = data.is_available;
        document.getElementById('worker-rating').textContent = Number(data.rating || 0).toFixed(1);
        document.getElementById('worker-experience').textContent = data.experience || 0;
        
        const jobSelect = document.getElementById('worker-job-type');
        let found = false;
        for (let i = 0; i < jobSelect.options.length; i++) {
            if (jobSelect.options[i].value === data.job_type) { jobSelect.selectedIndex = i; found = true; break; }
        }
        if (!found && data.job_type) {
            jobSelect.value = 'Other';
            document.getElementById('worker-job-custom').style.display = 'block';
            document.getElementById('worker-job-custom').value = data.job_type;
        }
    }
}

async function handleUpdateWorkerProfile() {
    const x = parseFloat(document.getElementById('worker-x').value);
    const y = parseFloat(document.getElementById('worker-y').value);
    const available = document.getElementById('worker-available').checked;
    let type = document.getElementById('worker-job-type').value;
    if (type === 'Other') type = document.getElementById('worker-job-custom').value.trim();
    
    if (isNaN(x) || isNaN(y)) return;
    
    await supabaseClient.from('worker_profiles').upsert({ user_id: currentUser.id, current_lat: x, current_lng: y, is_available: available, job_type: type });
    document.getElementById('worker-msg').textContent = '✓ Worker Profile & Profession Updated!';
    debouncedLoadWorkerTasks();
}

async function loadWorkerEligibleTasks() {
    const container = document.getElementById('worker-eligible-tasks-container');
    if (!container) return;

    try {
        const { data: profile } = await supabaseClient.from('worker_profiles').select('job_type').eq('user_id', currentUser.id).single();
        const jobType = profile ? profile.job_type : 'Plumber';

        const [tasksRes, prefsRes] = await Promise.all([
            fetch(`${API_URL}/api/eligible_tasks?job_type=${encodeURIComponent(jobType)}&worker_id=${currentUser.id}`),
            fetch(`${API_URL}/api/workers/${currentUser.id}/preferences`)
        ]);

        const tasks = tasksRes.ok ? await tasksRes.json() : [];
        const prefsData = prefsRes.ok ? await prefsRes.json() : { preferences: [] };
        const savedPrefs = prefsData.preferences || [];

        if (tasks.length === 0) {
            container.innerHTML = `<div style="color:var(--text-muted); padding:10px;">No pending ${jobType} tasks in the system right now.</div>`;
            return;
        }

        const orderedTasks = [];
        savedPrefs.forEach(tId => {
            const found = tasks.find(t => t.id === tId);
            if (found) orderedTasks.push(found);
        });
        tasks.forEach(t => {
            if (!orderedTasks.some(ot => ot.id === t.id)) orderedTasks.push(t);
        });

        let prefItemsHtml = '';
        orderedTasks.forEach((t, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === orderedTasks.length - 1;
            prefItemsHtml += `
                <li class="pref-item" data-task-id="${t.id}">
                    <div style="display:flex; align-items:center;">
                        <span class="pref-rank-badge" style="background:var(--accent-blue);">#${idx + 1}</span>
                        <div>
                            <strong>${t.required_job_type} Task (by ${t.requester_email.split('@')[0]})</strong>
                            <div style="font-size:0.75rem; color:var(--text-muted);">Location: (${t.lat}, ${t.lng}) | Status: ${t.status}</div>
                        </div>
                    </div>
                    <div class="pref-controls">
                        <button class="btn-reorder" onclick="reorderWorkerTaskPref(${idx}, -1)" ${isFirst ? 'disabled' : ''} title="Rank Higher">▲</button>
                        <button class="btn-reorder" onclick="reorderWorkerTaskPref(${idx}, 1)" ${isLast ? 'disabled' : ''} title="Rank Lower">▼</button>
                    </div>
                </li>
            `;
        });

        container.innerHTML = `
            <div class="pref-container" style="background:var(--bg-secondary);">
                <div class="pref-title" style="color:var(--accent-blue);">
                    <span>Your Task Preference Ranking (${jobType} Category):</span>
                </div>
                <ul id="worker-task-pref-list" class="pref-list">${prefItemsHtml}</ul>
                <button class="btn btn-primary" style="width:100%; justify-content:center; margin-top:10px;" onclick="saveWorkerTaskPreferences()">💾 Save Task Preferences</button>
            </div>
        `;
    } catch(e) {
        container.innerHTML = `<div style="color:var(--accent-red);">Error loading tasks: ${e.message}</div>`;
    }
}

window.reorderWorkerTaskPref = function(fromIndex, direction) {
    const list = document.getElementById('worker-task-pref-list');
    if (!list) return;
    const items = Array.from(list.children);
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= items.length) return;

    const taskIds = items.map(el => el.getAttribute('data-task-id'));
    const temp = taskIds[fromIndex];
    taskIds[fromIndex] = taskIds[toIndex];
    taskIds[toIndex] = temp;

    fetch(`${API_URL}/api/workers/${currentUser.id}/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: taskIds })
    }).then(() => loadWorkerEligibleTasks());
};

window.saveWorkerTaskPreferences = async function() {
    const list = document.getElementById('worker-task-pref-list');
    if (!list) return;
    const items = Array.from(list.children);
    const taskIds = items.map(el => el.getAttribute('data-task-id')).filter(Boolean);

    await fetch(`${API_URL}/api/workers/${currentUser.id}/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: taskIds })
    });
    alert('✓ Task preferences registered! Gale-Shapley will use this ranking during matching.');
    loadWorkerEligibleTasks();
};

async function loadWorkerAssignedTask() {
    const currentReqId = ++workerAssignedReqId;
    const div = document.getElementById('worker-assigned-task');
    const compDiv = document.getElementById('worker-completed-tasks-list');
    if (!div || !compDiv) return;
    
    try {
        const response = await fetch(`${API_URL}/api/worker_dashboard/${currentUser.id}`);
        const data = await response.json();
        
        if (currentReqId !== workerAssignedReqId) return;
        
        const tasks = data.tasks;
        let divHtml = '';
        let compDivHtml = '';
        let hasActive = false;
        
        if (tasks && tasks.length > 0) {
            tasks.forEach(t => {
                if (t.status === 'completed') {
                    compDivHtml += `<li class="task-item" style="border-left-color:var(--accent-green)">Type: ${t.required_job_type} | ID: ${t.id} - <strong>Completed</strong></li>`;
                } else if (t.status === 'assigned') {
                    hasActive = true;
                    divHtml += `
                        <div style="padding:15px; background:var(--bg-tertiary); border-radius:10px; border-left:4px solid var(--accent-green);">
                            <strong style="color:var(--accent-green); display:block; margin-bottom:8px; font-size:1rem;">✓ Final Stable Match: Task Assigned to You!</strong>
                            <div><strong>Category:</strong> ${t.required_job_type}</div>
                            <div><strong>Task Location:</strong> (${t.lat}, ${t.lng})</div>
                            <div style="margin-top:10px; font-size:0.85rem; color:var(--text-muted);">Please perform the task. The requester will mark it completed & submit rating.</div>
                        </div>`;
                }
            });
        }
        
        if (!hasActive) {
            divHtml = '<div style="color:var(--text-muted); padding: 10px; background:var(--bg-tertiary); border-radius:8px;">No task currently assigned. Rank your preferences below for the next simulation!</div>';
        }

        div.innerHTML = divHtml;
        compDiv.innerHTML = compDivHtml || '<li style="color:var(--text-muted); padding:10px 0;">No completed jobs yet.</li>';

    } catch(err) {
        if (currentReqId === workerAssignedReqId) {
            div.innerHTML = `<div style="color:var(--accent-red);">Error: ${err.message}</div>`;
        }
    }
}

// ================= ADMIN & SPATIAL VISUALIZER =================

async function handleClearDB() {
    if(!confirm('Are you sure you want to clear all simulation tasks, offers, and workers?')) return;
    try {
        await fetch(API_URL + '/api/clear', { method: 'POST' });
        resetSimulationState();
        loadAdminData();
    } catch(e) {
        alert('Failed to clear DB');
    }
}

async function handleLoadDemoScenario() {
    try {
        const res = await fetch(API_URL + '/api/demo/setup_scenario', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert('✓ 3 Tasks & 4 Workers demo scenario loaded with exact preference lists!');
            resetSimulationState();
            await loadAdminData();
        } else {
            alert('Failed to setup demo: ' + (data.error || 'Unknown'));
        }
    } catch(e) {
        alert('Error: ' + e.message);
    }
}

async function loadAdminData() {
    try {
        const res = await fetch(API_URL + '/api/simulation/environment');
        if (!res.ok) return;
        const env = await res.json();

        adminTasks = env.tasks || [];
        adminWorkers = env.workers || [];
        adminUserEmails = env.userMap || {};
        adminTaskPreferences = env.taskPreferences || {};
        adminWorkerPreferences = env.workerPreferences || {};

        document.getElementById('stat-workers').textContent = adminWorkers.length;
        document.getElementById('stat-tasks').textContent = adminTasks.length;

        renderAdminPreferencesMatrix();
        renderSpatialVisualization();
        if (!isAnimating) updateRightPanelState();

    } catch(e) {
        console.error('Error loading admin data:', e);
    }
}

function renderAdminPreferencesMatrix() {
    const container = document.getElementById('admin-preferences-matrix');
    if (!container) return;

    if (adminTasks.length === 0 && adminWorkers.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);">No entities loaded. Add tasks and workers to begin.</div>';
        return;
    }

    let html = '<div style="margin-bottom:8px;"><strong style="color:var(--accent-orange); font-size:0.75rem;">Tasks Preferences (Requesters):</strong><br>';
    adminTasks.forEach((t, i) => {
        const reqName = adminUserEmails[t.requester_id] ? adminUserEmails[t.requester_id].split('@')[0] : `Req ${i + 1}`;
        const prefs = adminTaskPreferences[t.id] || [];
        const prefLabels = prefs.map(wId => {
            const idx = adminWorkers.findIndex(w => w.user_id === wId);
            return idx !== -1 ? `W${idx + 1}` : 'W?';
        });
        const prefStr = prefLabels.length > 0 ? prefLabels.join(' &succ; ') : 'Distance-based';
        html += `<div style="padding:2px 0; color:var(--text-primary); font-size:0.72rem;"><strong>T${i + 1} (${reqName}):</strong> ${prefStr}</div>`;
    });
    html += '</div>';

    html += '<div><strong style="color:var(--accent-blue); font-size:0.75rem;">Workers Preferences:</strong><br>';
    adminWorkers.forEach((w, i) => {
        const workerName = adminUserEmails[w.user_id] ? adminUserEmails[w.user_id].split('@')[0] : `W${i + 1}`;
        const prefs = adminWorkerPreferences[w.user_id] || [];
        const prefLabels = prefs.map(tId => {
            const idx = adminTasks.findIndex(t => t.id === tId);
            return idx !== -1 ? `T${idx + 1}` : 'T?';
        });
        const prefStr = prefLabels.length > 0 ? prefLabels.join(' &succ; ') : 'Distance-based';
        html += `<div style="padding:2px 0; color:var(--text-primary); font-size:0.72rem;"><strong>W${i + 1} (${workerName}):</strong> ${prefStr}</div>`;
    });
    html += '</div>';

    container.innerHTML = html;
}

window.inspectAdminEntity = function(type, id) {
    const inspector = document.getElementById('preference-inspector');
    const header = document.getElementById('pref-inspector-header');
    const list = document.getElementById('pref-inspector-list');
    const entityInfo = document.getElementById('entity-info');
    if (!inspector || !header || !list) return;

    if (type === 'worker') {
        const idx = adminWorkers.findIndex(w => w.user_id === id);
        const w = adminWorkers[idx];
        if (!w) return;
        const name = adminUserEmails[w.user_id] ? adminUserEmails[w.user_id].split('@')[0] : `Worker ${idx + 1}`;
        header.innerHTML = `<span style="color:var(--accent-blue);">W${idx + 1} (${name})</span> — Preferences`;
        
        const prefs = adminWorkerPreferences[w.user_id] || [];
        let itemsHtml = '';
        if (prefs.length === 0) {
            itemsHtml = '<div style="color:var(--text-muted); font-size:0.75rem;">No explicit preferences set (Spatial distance order)</div>';
        } else {
            prefs.forEach((tId, rank) => {
                const tIdx = adminTasks.findIndex(t => t.id === tId);
                const tObj = adminTasks[tIdx];
                const tName = tIdx !== -1 ? `T${tIdx + 1} (${tObj.required_job_type})` : 'Task';
                itemsHtml += `<div style="padding:3px 6px; margin-bottom:2px; background:var(--bg-tertiary); border-radius:4px; font-size:0.75rem;">#${rank + 1}: <strong>${tName}</strong></div>`;
            });
        }
        list.innerHTML = itemsHtml;
        inspector.classList.remove('hidden');
        if (entityInfo) entityInfo.textContent = `Inspecting Worker W${idx + 1} (${w.job_type || 'Plumber'})`;
    } else {
        const idx = adminTasks.findIndex(t => t.id === id);
        const t = adminTasks[idx];
        if (!t) return;
        const reqName = adminUserEmails[t.requester_id] ? adminUserEmails[t.requester_id].split('@')[0] : `Requester ${idx + 1}`;
        header.innerHTML = `<span style="color:var(--accent-orange);">T${idx + 1} (${t.required_job_type} Task)</span> — Preferences`;
        
        const prefs = adminTaskPreferences[t.id] || [];
        let itemsHtml = '';
        if (prefs.length === 0) {
            itemsHtml = '<div style="color:var(--text-muted); font-size:0.75rem;">No explicit preferences set (Spatial distance order)</div>';
        } else {
            prefs.forEach((wId, rank) => {
                const wIdx = adminWorkers.findIndex(w => w.user_id === wId);
                const wObj = adminWorkers[wIdx];
                const wName = wIdx !== -1 ? `W${wIdx + 1} (${wObj.job_type || 'Worker'})` : 'Worker';
                itemsHtml += `<div style="padding:3px 6px; margin-bottom:2px; background:var(--bg-tertiary); border-radius:4px; font-size:0.75rem;">#${rank + 1}: <strong>${wName}</strong></div>`;
            });
        }
        list.innerHTML = itemsHtml;
        inspector.classList.remove('hidden');
        if (entityInfo) entityInfo.textContent = `Inspecting Task T${idx + 1} (Requester: ${reqName})`;
    }
};

function setupAdminRealtime() {
    realtimeSubscription = supabaseClient.channel('admin-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
            if (!isAnimating) debouncedLoadAdminData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_profiles' }, () => {
            if (!isAnimating) debouncedLoadAdminData();
        })
        .subscribe();
}

function updateRightPanelState(activeStep = null, currentMatches = [], unmatchedList = [], history = []) {
    const curStepDisplay = document.getElementById('current-step-display');
    const curPropDisplay = document.getElementById('current-proposal-display');
    const matchesTbody = document.getElementById('matches-tbody');
    const unmatchedDiv = document.getElementById('unmatched-list');
    const propHistory = document.getElementById('proposal-history');

    if (curStepDisplay) {
        curStepDisplay.textContent = activeStep ? `Step ${activeStep.step}` : 'Step 0';
    }

    if (curPropDisplay) {
        if (activeStep && activeStep.type === 'proposal') {
            curPropDisplay.innerHTML = `<span style="color:#a855f7; font-weight:600;">${activeStep.proposerLabel} → ${activeStep.targetLabel}</span>`;
        } else if (activeStep) {
            curPropDisplay.innerHTML = `<span style="color:#a855f7; font-weight:600;">${activeStep.proposerLabel} → ${activeStep.targetLabel}</span>`;
        } else {
            curPropDisplay.textContent = 'None';
        }
    }

    if (matchesTbody) {
        matchesTbody.innerHTML = '';
        if (currentMatches.length > 0) {
            currentMatches.forEach(m => {
                const tr = document.createElement('tr');
                const statusClass = m.isFinal ? 'status-matched' : 'status-pending';
                const statusText = m.isFinal ? 'Matched' : 'Pending';
                tr.innerHTML = `
                    <td><strong>${m.workerLabel}</strong></td>
                    <td><strong>${m.taskLabel}</strong></td>
                    <td>${m.distance}</td>
                    <td><span class="${statusClass}">${statusText}</span></td>
                `;
                matchesTbody.appendChild(tr);
            });
        } else {
            adminTasks.forEach((t, i) => {
                if (t.status === 'assigned') {
                    const wIdx = adminWorkers.findIndex(w => w.user_id === t.assigned_worker_id);
                    const w = adminWorkers[wIdx];
                    const wPos = w ? getWorkerPos(w, wIdx) : null;
                    const tPos = getTaskPos(t, i);
                    const dist = wPos ? calculateDistance(wPos.x, wPos.y, tPos.x, tPos.y) : '—';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>W${wIdx + 1}</strong></td>
                        <td><strong>T${i + 1}</strong></td>
                        <td>${dist}</td>
                        <td><span class="status-matched">Matched</span></td>
                    `;
                    matchesTbody.appendChild(tr);
                }
            });
        }
    }

    if (unmatchedDiv) {
        unmatchedDiv.innerHTML = '';
        if (unmatchedList.length > 0) {
            unmatchedList.forEach(u => {
                const span = document.createElement('span');
                span.className = 'unmatched-tag';
                span.textContent = u;
                unmatchedDiv.appendChild(span);
            });
        } else {
            unmatchedDiv.innerHTML = '<span class="unmatched-tag">None</span>';
        }
    }

    if (propHistory && history.length > 0) {
        propHistory.innerHTML = '';
        history.forEach(h => {
            const div = document.createElement('div');
            div.className = `history-entry ${h.result}`;
            div.innerHTML = `
                <span>${h.proposer} → ${h.target}</span>
                <span class="result-text ${h.result}">${h.result === 'accepted' ? '✓ Accepted' : '✗ Rejected'}</span>
            `;
            propHistory.appendChild(div);
        });
    }
}

function renderSpatialVisualization(activeProposal = null, currentMatches = [], activeNodeIds = {}) {
    const svg = document.getElementById('spatial-svg');
    if (!svg) return;
    svg.innerHTML = '';

    // 1. Defs: Grid & Markers
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" stroke-width="1"/>
        </pattern>
        <filter id="purple-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#a855f7" flood-opacity="0.8"/>
        </filter>
    `;
    svg.appendChild(defs);

    // 2. Background Grid
    const bgRect = document.createElementNS(SVG_NS, 'rect');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', 'url(#grid)');
    svg.appendChild(bgRect);

    // 3. Draw Accepted Match Lines (Solid Green)
    currentMatches.forEach(m => {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', m.wx);
        line.setAttribute('y1', m.wy);
        line.setAttribute('x2', m.tx);
        line.setAttribute('y2', m.ty);
        line.setAttribute('stroke', '#4ade80');
        line.setAttribute('stroke-width', '3.5');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
    });

    // 4. Draw Active Proposal Line (Purple Animated Dashed Line)
    if (activeProposal) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', activeProposal.x1);
        line.setAttribute('y1', activeProposal.y1);
        line.setAttribute('x2', activeProposal.x2);
        line.setAttribute('y2', activeProposal.y2);
        line.setAttribute('stroke', '#a855f7');
        line.setAttribute('stroke-width', '3.5');
        line.setAttribute('stroke-dasharray', '8,4');

        const animate = document.createElementNS(SVG_NS, 'animate');
        animate.setAttribute('attributeName', 'stroke-dashoffset');
        animate.setAttribute('from', '12');
        animate.setAttribute('to', '0');
        animate.setAttribute('dur', '0.5s');
        animate.setAttribute('repeatCount', 'indefinite');
        line.appendChild(animate);

        svg.appendChild(line);
    }

    // 5. Draw Tasks (45-degree Rotated Diamonds with Bronze/Orange)
    adminTasks.forEach((t, i) => {
        const pos = getTaskPos(t, i);
        const isMatched = activeNodeIds.matchedTaskIds && activeNodeIds.matchedTaskIds.includes(t.id);
        const isActiveTarget = activeNodeIds.targetId === t.id;
        const isActiveProposer = activeNodeIds.proposerId === t.id;
        const isActive = isActiveTarget || isActiveProposer;

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y}) rotate(45)`);
        g.style.cursor = 'pointer';
        g.onclick = () => inspectAdminEntity('task', t.id);

        // Outer Glow Halo if active proposer or target
        if (isActive) {
            const halo = document.createElementNS(SVG_NS, 'rect');
            halo.setAttribute('x', '-25');
            halo.setAttribute('y', '-25');
            halo.setAttribute('width', '50');
            halo.setAttribute('height', '50');
            halo.setAttribute('rx', '8');
            halo.setAttribute('fill', 'none');
            halo.setAttribute('stroke', isActiveProposer ? '#fbbf24' : '#a855f7');
            halo.setAttribute('stroke-width', '4');
            halo.setAttribute('filter', 'url(#purple-glow)');
            g.appendChild(halo);
        }

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', '-18');
        rect.setAttribute('y', '-18');
        rect.setAttribute('width', '36');
        rect.setAttribute('height', '36');
        rect.setAttribute('rx', '6');
        rect.setAttribute('fill', isMatched ? '#b45309' : (isActive ? '#b45309' : '#f59e0b'));
        rect.setAttribute('stroke', isActive ? (isActiveProposer ? '#fbbf24' : '#a855f7') : (isMatched ? '#78350f' : '#b45309'));
        rect.setAttribute('stroke-width', isActive ? '3' : '2');
        g.appendChild(rect);

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('transform', 'rotate(-45)');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dy', '4');
        text.setAttribute('fill', 'white');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('font-size', '12');
        text.textContent = `T${i + 1}`;
        g.appendChild(text);

        svg.appendChild(g);
    });

    // 6. Draw Workers (Blue Circles)
    adminWorkers.forEach((w, i) => {
        const pos = getWorkerPos(w, i);
        const isMatched = activeNodeIds.matchedWorkerIds && activeNodeIds.matchedWorkerIds.includes(w.user_id);
        const isActiveProposer = activeNodeIds.proposerId === w.user_id;
        const isActiveTarget = activeNodeIds.targetId === w.user_id;
        const isActive = isActiveProposer || isActiveTarget;

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
        g.style.cursor = 'pointer';
        g.onclick = () => inspectAdminEntity('worker', w.user_id);

        // Outer Glow Halo if active proposer or target
        if (isActive) {
            const halo = document.createElementNS(SVG_NS, 'circle');
            halo.setAttribute('r', '27');
            halo.setAttribute('fill', 'none');
            halo.setAttribute('stroke', isActiveProposer ? '#fbbf24' : '#a855f7');
            halo.setAttribute('stroke-width', '4');
            halo.setAttribute('filter', 'url(#purple-glow)');
            g.appendChild(halo);
        }

        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('r', '20');
        circle.setAttribute('fill', isMatched ? '#1e40af' : (isActive ? '#1e40af' : '#1d4ed8'));
        circle.setAttribute('stroke', isActive ? (isActiveProposer ? '#fbbf24' : '#a855f7') : '#1e3a8a');
        circle.setAttribute('stroke-width', isActive ? '3' : '2');
        g.appendChild(circle);

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dy', '5');
        text.setAttribute('fill', 'white');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('font-size', '12');
        text.textContent = `W${i + 1}`;
        g.appendChild(text);

        svg.appendChild(g);
    });
}

// ================= GALE-SHAPLEY SIMULATION RUNNER =================

function resetSimulationState() {
    if (animationTimer) clearInterval(animationTimer);
    isAnimating = false;
    simulationSteps = [];
    currentStepIndex = 0;
    updateRightPanelState(null, [], [], []);
    document.getElementById('step-explanation').textContent = 'Ready to start simulation.';
    document.getElementById('completion-overlay').classList.add('hidden');
    renderSpatialVisualization();
}

async function startSimulation(stepByStep = false) {
    const mode = document.getElementById('algorithm-mode').value;
    resetSimulationState();

    document.getElementById('step-explanation').textContent = 'Computing Gale-Shapley Stable Marriage simulation on server...';

    try {
        const res = await fetch(`${API_URL}/api/match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'Match failed');

        simulationSteps = result.steps || [];
        window.finalMatchesResult = result.matches || [];

        if (simulationSteps.length === 0) {
            document.getElementById('step-explanation').textContent = 'No available tasks or workers to match.';
            return;
        }

        isAnimating = true;

        if (stepByStep) {
            stepSimulation();
        } else {
            animationTimer = setInterval(() => {
                if (currentStepIndex < simulationSteps.length) {
                    stepSimulation();
                } else {
                    clearInterval(animationTimer);
                    finishSimulation();
                }
            }, animationSpeed);
        }

    } catch(e) {
        document.getElementById('step-explanation').textContent = 'Error: ' + e.message;
    }
}

function stepSimulation() {
    if (simulationSteps.length === 0) {
        document.getElementById('step-explanation').textContent = 'No simulation steps available. Add tasks and workers, then start the simulation.';
        return;
    }

    if (currentStepIndex >= simulationSteps.length) {
        finishSimulation();
        return;
    }

    const step = simulationSteps[currentStepIndex];
    currentStepIndex++;

    const isWorkerProposing = document.getElementById('algorithm-mode').value === 'worker';

    // Helper to get Label
    function getWorkerLabel(wId) {
        const idx = adminWorkers.findIndex(w => w.user_id === wId);
        return idx !== -1 ? `W${idx + 1}` : 'W';
    }
    function getTaskLabel(tId) {
        const idx = adminTasks.findIndex(t => t.id === tId);
        return idx !== -1 ? `T${idx + 1}` : 'T';
    }

    const proposerId = step.proposerId || (isWorkerProposing ? step.workerId : step.taskId);
    const targetId = step.targetId || (isWorkerProposing ? step.taskId : step.workerId);

    const pLabel = isWorkerProposing ? getWorkerLabel(proposerId) : getTaskLabel(proposerId);
    const rLabel = isWorkerProposing ? getTaskLabel(targetId) : getWorkerLabel(targetId);

    const stepData = {
        step: currentStepIndex,
        type: step.type,
        proposerLabel: pLabel,
        targetLabel: rLabel
    };

    document.getElementById('step-explanation').textContent = step.message;

    // Track active holds up to this step
    const taskHolds = {}; // taskId -> workerId
    const historyList = [];

    for (let i = 0; i < currentStepIndex; i++) {
        const s = simulationSteps[i];
        const sProposerId = s.proposerId || (isWorkerProposing ? s.workerId : s.taskId);
        const sTargetId = s.targetId || (isWorkerProposing ? s.taskId : s.workerId);
        const sPLabel = isWorkerProposing ? getWorkerLabel(sProposerId) : getTaskLabel(sProposerId);
        const sRLabel = isWorkerProposing ? getTaskLabel(sTargetId) : getWorkerLabel(sTargetId);

        if (s.type === 'accept' || s.type === 'replace') {
            if (s.replacedTaskId) {
                delete taskHolds[s.replacedTaskId];
            }
            taskHolds[s.taskId] = s.workerId;
            historyList.unshift({
                proposer: sPLabel,
                target: sRLabel,
                result: 'accepted'
            });
        } else if (s.type === 'reject') {
            historyList.unshift({
                proposer: sPLabel,
                target: sRLabel,
                result: 'rejected'
            });
        }
    }

    const currentMatches = [];
    const matchedTaskIds = [];
    const matchedWorkerIds = [];

    Object.keys(taskHolds).forEach(tId => {
        const wId = taskHolds[tId];
        const tIdx = adminTasks.findIndex(t => t.id === tId);
        const wIdx = adminWorkers.findIndex(w => w.user_id === wId);
        const tObj = adminTasks[tIdx];
        const wObj = adminWorkers[wIdx];

        if (tObj && wObj) {
            matchedTaskIds.push(tId);
            matchedWorkerIds.push(wId);

            const wPos = getWorkerPos(wObj, wIdx);
            const tPos = getTaskPos(tObj, tIdx);
            const dist = calculateDistance(wPos.x, wPos.y, tPos.x, tPos.y);

            currentMatches.push({
                workerLabel: `W${wIdx + 1}`,
                taskLabel: `T${tIdx + 1}`,
                distance: dist,
                isFinal: currentStepIndex === simulationSteps.length,
                wx: wPos.x,
                wy: wPos.y,
                tx: tPos.x,
                ty: tPos.y
            });
        }
    });

    // Unmatched entities based on current algorithm mode
    let unmatchedList = [];
    if (isWorkerProposing) {
        unmatchedList = adminWorkers.map((w, idx) => `W${idx + 1}`).filter((_, idx) => !matchedWorkerIds.includes(adminWorkers[idx].user_id));
    } else {
        unmatchedList = adminTasks.map((t, idx) => `T${idx + 1}`).filter((_, idx) => !matchedTaskIds.includes(adminTasks[idx].id));
    }

    // Active proposal line coordinates
    let activeProposal = null;
    if (step.type === 'proposal') {
        const wId = isWorkerProposing ? proposerId : targetId;
        const tId = isWorkerProposing ? targetId : proposerId;
        const wIdx = adminWorkers.findIndex(w => w.user_id === wId);
        const tIdx = adminTasks.findIndex(t => t.id === tId);
        const wObj = adminWorkers[wIdx];
        const tObj = adminTasks[tIdx];

        if (wObj && tObj) {
            const wPos = getWorkerPos(wObj, wIdx);
            const tPos = getTaskPos(tObj, tIdx);

            activeProposal = {
                x1: isWorkerProposing ? wPos.x : tPos.x,
                y1: isWorkerProposing ? wPos.y : tPos.y,
                x2: isWorkerProposing ? tPos.x : wPos.x,
                y2: isWorkerProposing ? tPos.y : wPos.y
            };
        }
    }

    const activeNodeIds = {
        proposerId,
        targetId,
        matchedTaskIds,
        matchedWorkerIds
    };

    updateRightPanelState(stepData, currentMatches, unmatchedList, historyList);
    renderSpatialVisualization(activeProposal, currentMatches, activeNodeIds);
}

function finishSimulation() {
    isAnimating = false;
    document.getElementById('current-step-display').textContent = `Step ${simulationSteps.length}`;
    document.getElementById('step-explanation').textContent = '✓ Gale-Shapley Stable Marriage converged! All assignments are stable with no blocking pairs.';

    const finalMatches = window.finalMatchesResult || [];
    document.getElementById('summary-matched').textContent = finalMatches.length;
    document.getElementById('summary-proposals').textContent = simulationSteps.filter(s => s.type === 'proposal').length;
    document.getElementById('completion-overlay').classList.remove('hidden');

    loadAdminData();
}
