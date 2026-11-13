require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// In-Memory Preference Store (Task -> [Worker IDs in preference order], Worker -> [Task IDs in preference order])
let taskPreferencesStore = {};
let workerPreferencesStore = {};
let workerInterestStore = {}; // Worker -> [Task IDs worker expressed interest in]

app.get('/api/config', (req, res) => {
    res.json({ SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: anonKey });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, password, role, job_type } = req.body;
    try {
        const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { role, job_type: job_type || 'Plumber' }
        });
        if (error) return res.status(400).json({ error: error.message });
        
        const { error: roleError } = await supabase.from('user_roles').insert([{ user_id: data.user.id, role }]);
        if (roleError) return res.status(400).json({ error: roleError.message });
        
        try {
            await supabase.from('users').insert([{ id: data.user.id, email, password_hash: 'dummy', role }]);
        } catch(e){}
        
        if (role === 'worker') {
            const profession = job_type || 'Plumber';
            await supabase.from('worker_profiles').insert([{ user_id: data.user.id, job_type: profession, is_available: true }]);
        }
        
        res.json({ message: 'User created' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/clear', async (req, res) => {
    try {
        await supabase.from('task_offers').delete().not('id', 'is', null);
        await supabase.from('tasks').delete().not('id', 'is', null);
        await supabase.from('worker_profiles').delete().not('user_id', 'is', null);
        taskPreferencesStore = {};
        workerPreferencesStore = {};
        workerInterestStore = {};
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

function getDistance(lat1, lng1, lat2, lng2) {
    return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2));
}

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        delete taskPreferencesStore[id];
        const { error } = await supabase.from('tasks').delete().eq('id', id).eq('status', 'pending');
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const { data: { users }, error } = await supabase.auth.admin.listUsers();
        if (error) return res.status(400).json({ error: error.message });
        
        const userMap = {};
        users.forEach(u => userMap[u.id] = u.email);
        res.json(userMap);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ================= PREFERENCE & ELIGIBILITY ENDPOINTS =================

// 1. Get eligible workers for a given task/profession
app.get('/api/eligible_workers', async (req, res) => {
    const { job_type } = req.query;
    try {
        let query = supabase.from('worker_profiles').select('*');
        if (job_type) query = query.eq('job_type', job_type);
        const { data: workers, error } = await query;
        if (error) return res.status(400).json({ error: error.message });
        
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const userMap = {};
        (users || []).forEach(u => userMap[u.id] = u.email);
        
        const result = (workers || []).map(w => ({
            user_id: w.user_id,
            email: userMap[w.user_id] || 'Worker ' + w.user_id.slice(0, 4),
            job_type: w.job_type,
            rating: w.rating || 0,
            experience: w.experience || 0,
            is_available: w.is_available,
            current_lat: w.current_lat,
            current_lng: w.current_lng
        }));
        res.json(result);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Get & Save Task Preference Ranking (Requester's ranking of workers)
app.get('/api/tasks/:id/preferences', (req, res) => {
    const { id } = req.params;
    res.json({ preferences: taskPreferencesStore[id] || [] });
});

app.post('/api/tasks/:id/preferences', (req, res) => {
    const { id } = req.params;
    const { preferences } = req.body;
    taskPreferencesStore[id] = Array.isArray(preferences) ? preferences : [];
    res.json({ success: true, preferences: taskPreferencesStore[id] });
});

// 3. Get eligible tasks for a worker's profession
app.get('/api/eligible_tasks', async (req, res) => {
    const { job_type, worker_id } = req.query;
    try {
        let query = supabase.from('tasks').select('*').in('status', ['pending', 'pending_matching', 'offered']);
        if (job_type) query = query.eq('required_job_type', job_type);
        const { data: tasks, error } = await query.order('created_at', { ascending: true });
        if (error) return res.status(400).json({ error: error.message });
        
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const userMap = {};
        (users || []).forEach(u => userMap[u.id] = u.email);
        
        const result = (tasks || []).map(t => ({
            id: t.id,
            requester_id: t.requester_id,
            requester_email: userMap[t.requester_id] || 'Requester ' + (t.requester_id ? t.requester_id.slice(0, 4) : ''),
            required_job_type: t.required_job_type,
            lat: t.lat,
            lng: t.lng,
            status: t.status,
            created_at: t.created_at,
            interested: workerInterestStore[worker_id] ? workerInterestStore[worker_id].includes(t.id) : false
        }));
        res.json(result);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. Get & Save Worker Preference Ranking (Worker's ranking of tasks)
app.get('/api/workers/:id/preferences', (req, res) => {
    const { id } = req.params;
    res.json({ 
        preferences: workerPreferencesStore[id] || [],
        interestedTasks: workerInterestStore[id] || []
    });
});

app.post('/api/workers/:id/preferences', (req, res) => {
    const { id } = req.params;
    const { preferences, interestedTasks } = req.body;
    if (Array.isArray(preferences)) workerPreferencesStore[id] = preferences;
    if (Array.isArray(interestedTasks)) workerInterestStore[id] = interestedTasks;
    res.json({ 
        success: true, 
        preferences: workerPreferencesStore[id] || [],
        interestedTasks: workerInterestStore[id] || []
    });
});

// 5. Environment snapshot for Simulation / Admin
app.get('/api/simulation/environment', async (req, res) => {
    try {
        const [tasksRes, workersRes] = await Promise.all([
            supabase.from('tasks').select('*').in('status', ['pending', 'pending_matching', 'offered']),
            supabase.from('worker_profiles').select('*').eq('is_available', true)
        ]);
        
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const userMap = {};
        (users || []).forEach(u => userMap[u.id] = u.email);
        
        res.json({
            tasks: tasksRes.data || [],
            workers: workersRes.data || [],
            userMap,
            taskPreferences: taskPreferencesStore,
            workerPreferences: workerPreferencesStore,
            workerInterests: workerInterestStore
        });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// 6. Admin set preferences dynamically
app.post('/api/admin/set_preferences', (req, res) => {
    const { taskPreferences, workerPreferences } = req.body;
    if (taskPreferences) taskPreferencesStore = { ...taskPreferencesStore, ...taskPreferences };
    if (workerPreferences) workerPreferencesStore = { ...workerPreferencesStore, ...workerPreferences };
    res.json({ success: true, taskPreferences: taskPreferencesStore, workerPreferences: workerPreferencesStore });
});

// 7. Demo Scenario Setup (3 Tasks & 4 Workers with user-specified preferences)
app.post('/api/demo/setup_scenario', async (req, res) => {
    try {
        // Clear existing simulation tasks and offers
        await supabase.from('task_offers').delete().not('id', 'is', null);
        await supabase.from('tasks').delete().not('id', 'is', null);
        await supabase.from('worker_profiles').delete().not('user_id', 'is', null);

        // Fetch or create 3 Requesters and 4 Workers
        const { data: { users } } = await supabase.auth.admin.listUsers();
        
        // Helper to find or create user
        async function getOrCreate(email, role) {
            let u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
            if (!u) {
                const { data, error } = await supabase.auth.admin.createUser({
                    email,
                    password: 'password123',
                    email_confirm: true,
                    user_metadata: { role }
                });
                if (error) throw error;
                u = data.user;
                try {
                    await supabase.from('user_roles').insert([{ user_id: u.id, role }]);
                    await supabase.from('users').insert([{ id: u.id, email, password_hash: 'dummy', role }]);
                } catch(e){}
            }
            return u;
        }

        const reqA = await getOrCreate('requester_a@example.com', 'requester');
        const reqB = await getOrCreate('requester_b@example.com', 'requester');
        const reqC = await getOrCreate('requester_c@example.com', 'requester');

        const w1 = await getOrCreate('worker_1@example.com', 'worker');
        const w2 = await getOrCreate('worker_2@example.com', 'worker');
        const w3 = await getOrCreate('worker_3@example.com', 'worker');
        const w4 = await getOrCreate('worker_4@example.com', 'worker');

        // Create Worker Profiles (4 Plumbers)
        const workerProfiles = [
            { user_id: w1.id, job_type: 'Plumber', current_lat: 150, current_lng: 150, rating: 4.8, experience: 12, is_available: true },
            { user_id: w2.id, job_type: 'Plumber', current_lat: 250, current_lng: 350, rating: 4.9, experience: 18, is_available: true },
            { user_id: w3.id, job_type: 'Plumber', current_lat: 550, current_lng: 200, rating: 4.7, experience: 9, is_available: true },
            { user_id: w4.id, job_type: 'Plumber', current_lat: 650, current_lng: 400, rating: 4.6, experience: 7, is_available: true }
        ];
        await supabase.from('worker_profiles').upsert(workerProfiles);

        // Create 3 Plumbing Tasks
        const { data: createdTasks, error: tErr } = await supabase.from('tasks').insert([
            { requester_id: reqA.id, required_job_type: 'Plumber', lat: 200, lng: 180, status: 'pending' },
            { requester_id: reqB.id, required_job_type: 'Plumber', lat: 400, lng: 300, status: 'pending' },
            { requester_id: reqC.id, required_job_type: 'Plumber', lat: 600, lng: 250, status: 'pending' }
        ]).select('*');

        if (tErr) throw tErr;

        const taskA = createdTasks[0];
        const taskB = createdTasks[1];
        const taskC = createdTasks[2];

        // Set Scenario Preference Rankings:
        // Requester A: W2 > W1 > W4 > W3
        // Requester B: W3 > W4 > W1 > W2
        // Requester C: W1 > W2 > W3 > W4
        taskPreferencesStore = {
            [taskA.id]: [w2.id, w1.id, w4.id, w3.id],
            [taskB.id]: [w3.id, w4.id, w1.id, w2.id],
            [taskC.id]: [w1.id, w2.id, w3.id, w4.id]
        };

        // Worker Preferences:
        // Worker 1: Task B > Task A > Task C
        // Worker 2: Task A > Task C > Task B
        // Worker 3: Task C > Task B > Task A
        // Worker 4: Task B > Task C > Task A
        workerPreferencesStore = {
            [w1.id]: [taskB.id, taskA.id, taskC.id],
            [w2.id]: [taskA.id, taskC.id, taskB.id],
            [w3.id]: [taskC.id, taskB.id, taskA.id],
            [w4.id]: [taskB.id, taskC.id, taskA.id]
        };

        res.json({
            success: true,
            message: 'Scenario initialized: 3 Plumbing Tasks & 4 Plumbing Workers with custom preferences.',
            tasks: [taskA, taskB, taskC],
            workers: [w1, w2, w3, w4],
            taskPreferences: taskPreferencesStore,
            workerPreferences: workerPreferencesStore
        });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ================= GALE-SHAPLEY MATCHING ALGORITHM =================

app.post('/api/match', async (req, res) => {
    try {
        // Fetch pending/offered tasks
        const { data: tasks, error: tError } = await supabase
            .from('tasks')
            .select('*')
            .in('status', ['pending', 'pending_matching', 'offered']);
        
        // Fetch available workers
        const { data: workers, error: wError } = await supabase
            .from('worker_profiles')
            .select('*')
            .eq('is_available', true);

        if (tError || wError) return res.status(500).json({ error: 'Failed to fetch data' });

        const { data: { users } } = await supabase.auth.admin.listUsers();
        const userMap = {};
        (users || []).forEach(u => userMap[u.id] = u.email);

        const mode = req.body.mode || 'worker'; // 'worker' or 'task'
        const customTaskPrefs = req.body.taskPreferences || taskPreferencesStore;
        const customWorkerPrefs = req.body.workerPreferences || workerPreferencesStore;

        const steps = [];
        const finalMatches = []; // [{ task_id, worker_id, requester_email, worker_email }]
        const jobTypes = [...new Set([...tasks.map(t => t.required_job_type), ...workers.map(w => w.job_type)])];

        for (const job of jobTypes) {
            const jobTasks = tasks.filter(t => t.required_job_type === job).map(t => ({
                ...t,
                proposalIndex: 0,
                currentMatch: null, // worker assigned tentatively
                displayName: userMap[t.requester_id] ? userMap[t.requester_id].split('@')[0] : `Task ${t.id.slice(0, 4)}`
            }));
            
            const jobWorkers = workers.filter(w => w.job_type === job).map(w => ({
                ...w,
                proposalIndex: 0,
                currentMatch: null, // task assigned tentatively
                displayName: userMap[w.user_id] ? userMap[w.user_id].split('@')[0] : `Worker ${w.user_id.slice(0, 4)}`
            }));

            if (jobTasks.length === 0 || jobWorkers.length === 0) continue;

            // Build full preference list for each Task
            jobTasks.forEach(t => {
                const customList = customTaskPrefs[t.id] || [];
                const matchedInCustom = customList.map(wId => jobWorkers.find(w => w.user_id === wId)).filter(Boolean);
                const remaining = jobWorkers.filter(w => !customList.includes(w.user_id))
                    .sort((a, b) => getDistance(a.current_lat, a.current_lng, t.lat, t.lng) - getDistance(b.current_lat, b.current_lng, t.lat, t.lng));
                t.preferences = [...matchedInCustom, ...remaining];
            });

            // Build full preference list for each Worker
            jobWorkers.forEach(w => {
                const customList = customWorkerPrefs[w.user_id] || [];
                const matchedInCustom = customList.map(tId => jobTasks.find(t => t.id === tId)).filter(Boolean);
                const remaining = jobTasks.filter(t => !customList.includes(t.id))
                    .sort((a, b) => getDistance(w.current_lat, w.current_lng, a.lat, a.lng) - getDistance(w.current_lat, w.current_lng, b.lat, b.lng));
                w.preferences = [...matchedInCustom, ...remaining];
            });

            let round = 1;
            let hasUnmatched = true;

            if (mode === 'worker') {
                // ================= WORKER-PROPOSING GALE-SHAPLEY =================
                while (hasUnmatched) {
                    hasUnmatched = false;
                    for (const w of jobWorkers) {
                        // If worker is unassigned and has remaining tasks in preference list
                        if (w.currentMatch === null && w.proposalIndex < w.preferences.length) {
                            hasUnmatched = true;
                            const targetTask = w.preferences[w.proposalIndex++];
                            
                            const proposalStep = {
                                step: steps.length + 1,
                                round,
                                type: 'proposal',
                                proposer: 'worker',
                                proposerId: w.user_id,
                                proposerName: w.displayName,
                                targetId: targetTask.id,
                                targetName: targetTask.displayName,
                                job_type: job,
                                message: `${w.displayName} proposes to ${targetTask.displayName} (Preference #${w.proposalIndex})`
                            };
                            steps.push(proposalStep);

                            if (targetTask.currentMatch === null) {
                                // Task is free: Tentative engagement
                                targetTask.currentMatch = w;
                                w.currentMatch = targetTask;
                                steps.push({
                                    step: steps.length + 1,
                                    round,
                                    type: 'accept',
                                    proposer: 'worker',
                                    workerId: w.user_id,
                                    taskId: targetTask.id,
                                    replacedWorkerId: null,
                                    message: `${targetTask.displayName} is free and tentatively accepts ${w.displayName}.`
                                });
                            } else {
                                // Task is already engaged to currentWorker. Task compares w vs currentWorker
                                const currentW = targetTask.currentMatch;
                                const newRank = targetTask.preferences.findIndex(p => p.user_id === w.user_id);
                                const currentRank = targetTask.preferences.findIndex(p => p.user_id === currentW.user_id);

                                if (newRank !== -1 && (currentRank === -1 || newRank < currentRank)) {
                                    // Task prefers new worker: dumps currentWorker
                                    targetTask.currentMatch = w;
                                    w.currentMatch = targetTask;
                                    currentW.currentMatch = null;
                                    steps.push({
                                        step: steps.length + 1,
                                        round,
                                        type: 'replace',
                                        proposer: 'worker',
                                        workerId: w.user_id,
                                        taskId: targetTask.id,
                                        replacedWorkerId: currentW.user_id,
                                        replacedWorkerName: currentW.displayName,
                                        message: `${targetTask.displayName} prefers ${w.displayName} (Rank #${newRank + 1}) over ${currentW.displayName} (Rank #${currentRank + 1}). ${currentW.displayName} is bumped.`
                                    });
                                } else {
                                    // Task rejects new worker
                                    steps.push({
                                        step: steps.length + 1,
                                        round,
                                        type: 'reject',
                                        proposer: 'worker',
                                        workerId: w.user_id,
                                        taskId: targetTask.id,
                                        message: `${targetTask.displayName} prefers holding ${currentW.displayName} and rejects ${w.displayName}.`
                                    });
                                }
                            }
                            break; // Proceed step-by-step
                        }
                    }
                    round++;
                }

                // Collect final matches
                jobWorkers.forEach(w => {
                    if (w.currentMatch) {
                        finalMatches.push({
                            task_id: w.currentMatch.id,
                            worker_id: w.user_id,
                            requester_email: userMap[w.currentMatch.requester_id] || w.currentMatch.displayName,
                            worker_email: userMap[w.user_id] || w.displayName
                        });
                    }
                });

            } else {
                // ================= TASK-PROPOSING GALE-SHAPLEY =================
                while (hasUnmatched) {
                    hasUnmatched = false;
                    for (const t of jobTasks) {
                        if (t.currentMatch === null && t.proposalIndex < t.preferences.length) {
                            hasUnmatched = true;
                            const targetWorker = t.preferences[t.proposalIndex++];

                            const proposalStep = {
                                step: steps.length + 1,
                                round,
                                type: 'proposal',
                                proposer: 'task',
                                proposerId: t.id,
                                proposerName: t.displayName,
                                targetId: targetWorker.user_id,
                                targetName: targetWorker.displayName,
                                job_type: job,
                                message: `${t.displayName} proposes to ${targetWorker.displayName} (Preference #${t.proposalIndex})`
                            };
                            steps.push(proposalStep);

                            if (targetWorker.currentMatch === null) {
                                // Worker is free: Tentative engagement
                                targetWorker.currentMatch = t;
                                t.currentMatch = targetWorker;
                                steps.push({
                                    step: steps.length + 1,
                                    round,
                                    type: 'accept',
                                    proposer: 'task',
                                    workerId: targetWorker.user_id,
                                    taskId: t.id,
                                    replacedTaskId: null,
                                    message: `${targetWorker.displayName} is free and tentatively accepts ${t.displayName}.`
                                });
                            } else {
                                // Worker already holds currentTask. Worker compares t vs currentTask
                                const currentT = targetWorker.currentMatch;
                                const newRank = targetWorker.preferences.findIndex(p => p.id === t.id);
                                const currentRank = targetWorker.preferences.findIndex(p => p.id === currentT.id);

                                if (newRank !== -1 && (currentRank === -1 || newRank < currentRank)) {
                                    // Worker prefers new task: dumps currentTask
                                    targetWorker.currentMatch = t;
                                    t.currentMatch = targetWorker;
                                    currentT.currentMatch = null;
                                    steps.push({
                                        step: steps.length + 1,
                                        round,
                                        type: 'replace',
                                        proposer: 'task',
                                        workerId: targetWorker.user_id,
                                        taskId: t.id,
                                        replacedTaskId: currentT.id,
                                        replacedTaskName: currentT.displayName,
                                        message: `${targetWorker.displayName} prefers ${t.displayName} (Rank #${newRank + 1}) over ${currentT.displayName} (Rank #${currentRank + 1}). ${currentT.displayName} is bumped.`
                                    });
                                } else {
                                    // Worker rejects new task
                                    steps.push({
                                        step: steps.length + 1,
                                        round,
                                        type: 'reject',
                                        proposer: 'task',
                                        workerId: targetWorker.user_id,
                                        taskId: t.id,
                                        message: `${targetWorker.displayName} prefers holding ${currentT.displayName} and rejects ${t.displayName}.`
                                    });
                                }
                            }
                            break; // Proceed step-by-step
                        }
                    }
                    round++;
                }

                // Collect final matches
                jobTasks.forEach(t => {
                    if (t.currentMatch) {
                        finalMatches.push({
                            task_id: t.id,
                            worker_id: t.currentMatch.user_id,
                            requester_email: userMap[t.requester_id] || t.displayName,
                            worker_email: userMap[t.currentMatch.user_id] || t.currentMatch.displayName
                        });
                    }
                });
            }
        }

        // Apply final state changes to DB
        for (const match of finalMatches) {
            // Update task status to assigned
            await supabase.from('tasks').update({
                status: 'assigned',
                assigned_worker_id: match.worker_id
            }).eq('id', match.task_id);

            // Mark matched worker as unavailable
            await supabase.from('worker_profiles').update({
                is_available: false
            }).eq('user_id', match.worker_id);

            // Upsert task_offers as accepted
            try {
                await supabase.from('task_offers').upsert({
                    task_id: match.task_id,
                    worker_id: match.worker_id,
                    status: 'accepted_by_worker'
                }, { onConflict: 'task_id,worker_id' });
            } catch(e){}
        }

        res.json({
            success: true,
            message: 'Gale-Shapley Matching Completed Successfully',
            mode,
            matches: finalMatches,
            steps,
            isStable: true
        });

    } catch (err) {
        console.error('Match error:', err);
        res.status(500).json({ error: 'Server error during Gale-Shapley matching: ' + err.message });
    }
});

// Worker accepts offer
app.post('/api/task_offers/accept', async (req, res) => {
    try {
        const { task_id, worker_id } = req.body;
        await supabase.from('task_offers').update({ status: 'accepted_by_worker' })
            .eq('task_id', task_id).eq('worker_id', worker_id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Worker rejects offer
app.post('/api/task_offers/reject', async (req, res) => {
    try {
        const { task_id, worker_id } = req.body;
        await supabase.from('task_offers').update({ status: 'rejected_by_worker' })
            .eq('task_id', task_id).eq('worker_id', worker_id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Fetch worker dashboard data
app.get('/api/worker_dashboard/:worker_id', async (req, res) => {
    try {
        const { worker_id } = req.params;
        
        const { data: tasks } = await supabase.from('tasks')
            .select('*')
            .eq('assigned_worker_id', worker_id)
            .order('created_at', { ascending: false });
            
        const { data: offers } = await supabase.from('task_offers')
            .select('*, tasks(*)')
            .eq('worker_id', worker_id)
            .in('status', ['pending_worker', 'accepted_by_worker']);
            
        res.json({ tasks: tasks || [], offers: offers || [] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Requester approves worker
app.post('/api/tasks/approve_worker', async (req, res) => {
    try {
        const { task_id, worker_id } = req.body;
        
        await supabase.from('tasks').update({ 
            status: 'assigned', 
            assigned_worker_id: worker_id 
        }).eq('id', task_id);
        
        await supabase.from('worker_profiles').update({ is_available: false }).eq('user_id', worker_id);
        
        await supabase.from('task_offers')
            .update({ status: 'rejected_by_worker' })
            .eq('task_id', task_id)
            .neq('worker_id', worker_id);
            
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Requester rates worker and completes task
app.post('/api/tasks/rate_worker', async (req, res) => {
    try {
        const { task_id, worker_id, rating } = req.body;
        
        await supabase.from('tasks').update({ status: 'completed' }).eq('id', task_id);
        
        const { data: profile } = await supabase.from('worker_profiles').select('*').eq('user_id', worker_id).single();
        if (profile) {
            const currentTotalRatings = profile.total_ratings || 0;
            const currentRating = profile.rating || 0;
            const currentExperience = profile.experience || 0;
            
            const newTotalRatings = currentTotalRatings + 1;
            const newRating = ((currentRating * currentTotalRatings) + rating) / newTotalRatings;
            const newExperience = currentExperience + 1;
            
            await supabase.from('worker_profiles').update({
                rating: newRating,
                total_ratings: newTotalRatings,
                experience: newExperience,
                is_available: true
            }).eq('user_id', worker_id);
        }
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Production Matching Engine running on port ${PORT}`));
