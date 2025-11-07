import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    onSnapshot, 
    setDoc, 
    updateDoc, 
    collection, 
    getDoc, 
    arrayUnion,
    deleteDoc,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firestore logging level to Debug for visibility in the console
setLogLevel('debug');

// --- Global Variables (Canvas Environment) ---

// Use provided globals, falling back to local defaults if undefined
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nightingale-ledger-v1';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : window.firebaseConfig;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

// --- Firebase/App State ---\
let app;
let db;
let auth;
let userId = null;
// Path for public/shared data: artifacts/{appId}/public/data/ledger_state/{docId}
let GAME_STATE_PATH = null; 
const GAME_STATE_DOC_ID = 'ledger_data';
let gameState = {
    players: {
        keeper: 'User 1',
        nightingale: 'User 2'
    },
    scores: {
        keeper: 0,
        nightingale: 0
    },
    habits: [],
    rewards: [],
    punishments: [],
    history: []
};

// --- Utility Functions ---

/**
 * Custom modal implementation for alerts and notices (replaces native window.alert/confirm)
 * @param {string} title - The title of the modal.
 * @param {string} message - The main message.
 * @param {boolean} isConfirm - If true, shows OK and Cancel buttons (confirm dialog).
 * @returns {Promise<boolean>} Resolves to true for OK, false/undefined for Cancel/Alert.
 */
function showModal(title, message, isConfirm = false) {
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const okBtn = document.getElementById('modal-ok-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    if (!modalOverlay || !modalTitle || !modalMessage || !okBtn || !cancelBtn) {
        console.error('Modal elements not found. Falling back to console log.');
        return isConfirm ? Promise.resolve(false) : Promise.resolve();
    }

    modalTitle.textContent = title;
    modalMessage.textContent = message;

    if (isConfirm) {
        cancelBtn.classList.remove('hidden');
    } else {
        cancelBtn.classList.add('hidden');
    }

    // Ensure it's visible
    modalOverlay.classList.remove('hidden');
    modalOverlay.classList.add('flex');

    return new Promise(resolve => {
        const resolveAndCleanup = (result) => {
            modalOverlay.classList.add('hidden');
            modalOverlay.classList.remove('flex');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(result);
        };

        okBtn.onclick = () => resolveAndCleanup(true);
        cancelBtn.onclick = () => resolveAndCleanup(false);
    });
}

/**
 * Generates a consistent Firestore document path for the shared ledger data.
 * @param {string} docId - The document ID (always 'ledger_data' here).
 * @returns {string} The full Firestore path.
 */
function getGameStateDocPath(docId) {
    // Public path: artifacts/{appId}/public/data/ledger_state/{docId}
    return `artifacts/${appId}/public/data/ledger_state/${docId}`;
}

/**
 * Formats a number with a sign prefix.
 * @param {number} num - The number.
 * @returns {string} The formatted string (e.g., "+10", "-5").
 */
function formatPoints(num) {
    return (num > 0 ? "+" : "") + num;
}

// --- Firebase Initialization & Authentication ---

async function initFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Set up the path now that we have the appId
        GAME_STATE_PATH = getGameStateDocPath(GAME_STATE_DOC_ID);
        
        // Use the initial auth token for sign-in, falling back to anonymous
        await new Promise((resolve) => {
            if (initialAuthToken) {
                signInWithCustomToken(auth, initialAuthToken)
                    .then(() => resolve())
                    .catch((error) => {
                        console.error("Custom Token Sign-In Failed, proceeding to anonymous sign-in.", error);
                        signInAnonymously(auth).then(() => resolve());
                    });
            } else {
                signInAnonymously(auth).then(() => resolve());
            }
        });

        // Listen for Auth State Changes
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('current-user-id').textContent = userId.substring(0, 8) + '...';
                document.getElementById('current-app-id').textContent = appId;
                
                // Set the player IDs in the UI for clarity
                const keeperIdEl = document.getElementById('keeper-user-id');
                if(keeperIdEl) keeperIdEl.textContent = gameState.players.keeper.substring(0, 8) + '...';
                const nightingaleIdEl = document.getElementById('nightingale-user-id');
                if(nightingaleIdEl) nightingaleIdEl.textContent = gameState.players.nightingale.substring(0, 8) + '...';

                // Setup the data listener
                setupDataListener();

                // Hide loading screen, show main content
                document.getElementById('loading-screen').classList.add('hidden');
                document.getElementById('main-content-wrapper').classList.remove('hidden');

            } else {
                console.log("User signed out or failed to sign in.");
                const authErrorEl = document.getElementById('auth-error-message');
                if (authErrorEl) authErrorEl.textContent = "Authentication failed. Please check setup.";
            }
        });

    } catch (e) {
        console.error("Firebase Initialization Error:", e);
        const authErrorEl = document.getElementById('auth-error-message');
        if (authErrorEl) authErrorEl.textContent = "Could not initialize Firebase. Check console for details.";
    }
}

// --- Firestore Data Listener ---

function setupDataListener() {
    const docRef = doc(db, GAME_STATE_PATH);

    // Initial check: if the document doesn't exist, create it with initial state
    getDoc(docRef).then(docSnap => {
        if (!docSnap.exists()) {
            console.log("No ledger data found, initializing new document.");
            setDoc(docRef, gameState);
        }
    }).catch(error => {
        console.error("Error checking initial document existence:", error);
    });

    // Setup real-time listener
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            // Overwrite existing game state with fresh data
            gameState = docSnap.data();
            console.log("Ledger data updated:", gameState);
            // Call the render function
            renderLedger();
        } else {
            // Should not happen if initial check worked, but good safeguard
            console.warn("Ledger document does not exist, awaiting creation...");
        }
    }, (error) => {
        console.error("Firestore onSnapshot error:", error);
        showModal("Data Error", "Failed to load real-time ledger data. Check console for network issues.");
    });
}

// --- Data Persistence ---

async function updateGameState(updates) {
    if (!db || !GAME_STATE_PATH) {
        console.error("Database not initialized.");
        showModal("Error", "Database connection not ready. Please wait.");
        return false;
    }
    try {
        const docRef = doc(db, GAME_STATE_PATH);
        await updateDoc(docRef, updates);
        return true;
    } catch (e) {
        console.error("Error updating ledger state:", e);
        showModal("Error", "Failed to update the ledger. Please check console for details.");
        return false;
    }
}

// --- Core Logic & Rendering (The Fix is HERE with Null Checks) ---

/**
 * Renders the entire ledger state to the UI.
 * This is called whenever the Firestore data changes.
 */
function renderLedger() {
    // 1. Update Scores
    const keeperScoreEl = document.getElementById('keeper-score');
    if(keeperScoreEl) keeperScoreEl.textContent = gameState.scores.keeper;
    
    const nightingaleScoreEl = document.getElementById('nightingale-score');
    if(nightingaleScoreEl) nightingaleScoreEl.textContent = gameState.scores.nightingale;
    
    // 2. Render Habits
    const habitsListEl = document.getElementById('habits-list');
    const habitsLoadingEl = document.getElementById('habits-loading');
    
    if (habitsListEl) {
        habitsListEl.innerHTML = ''; // Clear existing list
        if (gameState.habits && gameState.habits.length > 0) {
            gameState.habits.forEach((habit, index) => {
                const li = document.createElement('li');
                li.className = 'card p-3 rounded-lg flex justify-between items-center text-sm';
                li.innerHTML = `
                    <div>
                        <p class="font-bold">${habit.description}</p>
                        <p class="text-xs text-gray-500">Assignee: ${habit.assignee.charAt(0).toUpperCase() + habit.assignee.slice(1)} | Value: ${habit.points} pts | Daily Limit: ${habit.times}</p>
                    </div>
                    <div class="flex space-x-2">
                        <button onclick="window.completeHabit(${index})" class="btn-primary px-3 py-1 text-xs rounded-lg transition transform hover:scale-105">Done</button>
                        <button onclick="window.removeHabit(${index})" class="text-gray-500 hover:text-red-500 transition">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                `;
                habitsListEl.appendChild(li);
            });
            if(habitsLoadingEl) habitsLoadingEl.classList.add('hidden');
        } else {
            if(habitsLoadingEl) habitsLoadingEl.classList.remove('hidden');
        }
    }

    // 3. Render Rewards
    const rewardsListEl = document.getElementById('rewards-list');
    const rewardsLoadingEl = document.getElementById('rewards-loading');

    if (rewardsListEl) {
        rewardsListEl.innerHTML = '';
        if (gameState.rewards && gameState.rewards.length > 0) {
            gameState.rewards.forEach((reward, index) => {
                const li = document.createElement('li');
                li.className = 'card p-3 rounded-lg text-sm';
                li.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="font-bold">${reward.title} <span class="text-[#b05c6c] ml-2">(${reward.cost} pts)</span></p>
                            <p class="text-xs text-gray-400 mt-1">${reward.description}</p>
                        </div>
                        <div class="flex space-x-2 mt-1">
                            <button onclick="window.redeemReward(${index})" class="btn-primary px-3 py-1 text-xs rounded-lg transition transform hover:scale-105 whitespace-nowrap">Redeem</button>
                            <button onclick="window.removeReward(${index})" class="text-gray-500 hover:text-red-500 transition">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    </div>
                `;
                rewardsListEl.appendChild(li);
            });
            if(rewardsLoadingEl) rewardsLoadingEl.classList.add('hidden');
        } else {
            if(rewardsLoadingEl) rewardsLoadingEl.classList.remove('hidden');
        }
    }

    // 4. Render Punishments
    const punishmentsListEl = document.getElementById('punishments-list');
    const punishmentsLoadingEl = document.getElementById('punishments-loading');
    
    if (punishmentsListEl) {
        punishmentsListEl.innerHTML = '';
        if (gameState.punishments && gameState.punishments.length > 0) {
            gameState.punishments.forEach((punishment, index) => {
                const li = document.createElement('li');
                li.className = 'card p-3 rounded-lg text-sm';
                li.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="font-bold text-[#ff6b6b]">${punishment.title}</p>
                            <p class="text-xs text-gray-400 mt-1">${punishment.description}</p>
                        </div>
                        <div class="flex space-x-2 mt-1">
                            <button onclick="window.applyPunishment(${index})" class="btn-secondary px-3 py-1 text-xs rounded-lg bg-red-800 transition transform hover:scale-105 whitespace-nowrap">Apply</button>
                            <button onclick="window.removePunishment(${index})" class="text-gray-500 hover:text-red-500 transition">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    </div>
                `;
                punishmentsListEl.appendChild(li);
            });
            if(punishmentsLoadingEl) punishmentsLoadingEl.classList.add('hidden');
        } else {
            if(punishmentsLoadingEl) punishmentsLoadingEl.classList.remove('hidden');
        }
    }

    // 5. Render History Log
    const historyListEl = document.getElementById('history-list');
    const historyLoadingEl = document.getElementById('history-loading');
    
    // Line 243-ish logic (with the fix)
    if (historyListEl) {
        historyListEl.innerHTML = '';
        if (gameState.history && gameState.history.length > 0) {
            // Render history in reverse chronological order
            [...gameState.history].reverse().forEach(item => {
                const li = document.createElement('li');
                const date = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                let colorClass = '';
                
                if (item.type === 'habit_complete') colorClass = 'text-green-400';
                else if (item.type === 'reward_redeem') colorClass = 'text-yellow-400';
                else if (item.type === 'punishment_apply') colorClass = 'text-red-400';
                else colorClass = 'text-gray-400';

                li.className = 'border-b border-[#3c3c45] py-2 last:border-b-0';
                li.innerHTML = `<span class="text-xs text-gray-500 mr-2">${date}</span><span class="${colorClass}">${item.description}</span>`;
                historyListEl.appendChild(li);
            });
            if(historyLoadingEl) historyLoadingEl.classList.add('hidden');
        } else {
            if(historyLoadingEl) historyLoadingEl.classList.remove('hidden');
        }
    }
}


// --- Action Functions (Bound to window for HTML access) ---

window.toggleHabitForm = function() {
    const form = document.getElementById('habit-form');
    if (form) form.classList.toggle('hidden');
}

window.toggleRewardForm = function() {
    const form = document.getElementById('reward-form');
    if (form) form.classList.toggle('hidden');
}

window.togglePunishmentForm = function() {
    const form = document.getElementById('punishment-form');
    if (form) form.classList.toggle('hidden');
}

window.addHistoryEntry = async function(description, type, points = 0) {
    const historyEntry = {
        description,
        type,
        points,
        timestamp: Date.now()
    };

    return updateGameState({
        history: arrayUnion(historyEntry)
    });
}

window.addHabit = async function() {
    const description = document.getElementById('new-habit-desc').value;
    const points = parseInt(document.getElementById('new-habit-points').value);
    const times = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!description || isNaN(points) || points <= 0 || isNaN(times) || times <= 0) {
        showModal("Invalid Input", "Please provide a valid description, positive points, and a daily limit.");
        return;
    }

    const newHabit = {
        id: crypto.randomUUID(), // Unique ID for tracking
        description,
        points,
        times,
        assignee
    };

    const success = await updateGameState({
        habits: arrayUnion(newHabit)
    });

    if (success) {
        document.getElementById('new-habit-desc').value = '';
        // Keeping points/times/assignee default values
    }
}

window.removeHabit = async function(index) {
    const confirm = await showModal("Confirm Removal", "Are you sure you want to remove this habit?", true);
    if (!confirm) return;
    
    const newHabits = gameState.habits.filter((_, i) => i !== index);
    updateGameState({ habits: newHabits });
}

window.completeHabit = async function(index) {
    const habit = gameState.habits[index];
    if (!habit) return;

    const newScore = gameState.scores[habit.assignee] + habit.points;
    
    // Add history entry
    const historyDesc = `${habit.assignee.charAt(0).toUpperCase() + habit.assignee.slice(1)} gained ${habit.points} pts for: ${habit.description}`;
    
    await updateGameState({
        [`scores.${habit.assignee}`]: newScore
    });

    // Add history entry *after* score is updated
    window.addHistoryEntry(historyDesc, 'habit_complete', habit.points);
}

window.addReward = async function() {
    const title = document.getElementById('new-reward-title').value;
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const description = document.getElementById('new-reward-desc').value;

    if (!title || !description || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a title, description, and a positive point cost for the reward.");
        return;
    }

    const newReward = {
        id: crypto.randomUUID(),
        title,
        cost,
        description
    };

    const success = await updateGameState({
        rewards: arrayUnion(newReward)
    });

    if (success) {
        document.getElementById('new-reward-title').value = '';
        document.getElementById('new-reward-cost').value = '50';
        document.getElementById('new-reward-desc').value = '';
    }
}

window.removeReward = async function(index) {
    const confirm = await showModal("Confirm Removal", "Are you sure you want to remove this reward?", true);
    if (!confirm) return;
    
    const newRewards = gameState.rewards.filter((_, i) => i !== index);
    updateGameState({ rewards: newRewards });
}

window.redeemReward = async function(index) {
    const reward = gameState.rewards[index];
    if (!reward) return;
    
    // Nightingale is the one who redeems and spends points
    const playerToDebit = 'nightingale';

    if (gameState.scores[playerToDebit] < reward.cost) {
        showModal("Insufficient Points", `The Nightingale only has ${gameState.scores[playerToDebit]} points, but this reward costs ${reward.cost} points.`);
        return;
    }

    const confirm = await showModal("Redeem Reward", `Are you sure the Nightingale wants to redeem "${reward.title}" for ${reward.cost} points?`, true);
    if (!confirm) return;

    const newScore = gameState.scores[playerToDebit] - reward.cost;

    // Add history entry
    const historyDesc = `Nightingale redeemed "${reward.title}" for ${reward.cost} pts.`;

    await updateGameState({
        [`scores.${playerToDebit}`]: newScore
    });
    
    // Add history entry *after* score is updated
    window.addHistoryEntry(historyDesc, 'reward_redeem', -reward.cost);
}

window.addPunishment = async function() {
    const title = document.getElementById('new-punishment-title').value;
    const description = document.getElementById('new-punishment-desc').value;

    if (!title || !description) {
        showModal("Invalid Input", "Please provide a title and a description for the punishment.");
        return;
    }

    const newPunishment = {
        id: crypto.randomUUID(),
        title,
        description
    };

    const success = await updateGameState({
        punishments: arrayUnion(newPunishment)
    });

    if (success) {
        document.getElementById('new-punishment-title').value = '';
        document.getElementById('new-punishment-desc').value = '';
    }
}

window.removePunishment = async function(index) {
    const confirm = await showModal("Confirm Removal", "Are you sure you want to remove this punishment?", true);
    if (!confirm) return;
    
    const newPunishments = gameState.punishments.filter((_, i) => i !== index);
    updateGameState({ punishments: newPunishments });
}

window.applyPunishment = async function(index) {
    const punishment = gameState.punishments[index];
    if (!punishment) return;
    
    const confirm = await showModal("Apply Punishment", `Are you sure you want to confirm applying the punishment: "${punishment.title}"?`, true);
    if (!confirm) return;

    // Add history entry (Punishments don't affect score, but are logged)
    const historyDesc = `Punishment applied: "${punishment.title}". Description: ${punishment.description}`;
    
    window.addHistoryEntry(historyDesc, 'punishment_apply', 0);
}

// Global functions for generating example data (accessing the EXAMPLE_DATABASE)
window.generateExampleData = function(type) {
    if (typeof EXAMPLE_DATABASE === 'undefined') {
        showModal("Data Error", "Example data database is missing (examples.js).");
        return;
    }

    const examples = EXAMPLE_DATABASE[`${type}s`];
    if (!examples || examples.length === 0) return;

    // Select a random example
    const example = examples[Math.floor(Math.random() * examples.length)];

    if (type === 'habit') {
        const descEl = document.getElementById('new-habit-desc');
        const pointsEl = document.getElementById('new-habit-points');
        const timesEl = document.getElementById('new-habit-times');
        const assigneeEl = document.getElementById('new-habit-assignee');
        const formEl = document.getElementById('habit-form');

        if (descEl) descEl.value = example.description;
        if (pointsEl) pointsEl.value = example.points;
        if (timesEl) timesEl.value = 1; // Default to 1
        if (assigneeEl) assigneeEl.value = example.type;
        
        // Check if form is hidden, show it
        if (formEl && formEl.classList.contains('hidden')) { window.toggleHabitForm(); }
        
    } else if (type === 'reward') {
        const titleEl = document.getElementById('new-reward-title');
        const costEl = document.getElementById('new-reward-cost');
        const descEl = document.getElementById('new-reward-desc');
        const formEl = document.getElementById('reward-form');

        if (titleEl) titleEl.value = example.title;
        if (costEl) costEl.value = example.cost;
        if (descEl) descEl.value = example.description;
        
        // Check if form is hidden, show it
        if (formEl && formEl.classList.contains('hidden')) { window.toggleRewardForm(); }

    } else if (type === 'punishment') {
        const titleEl = document.getElementById('new-punishment-title');
        const descEl = document.getElementById('new-punishment-desc');
        const formEl = document.getElementById('punishment-form');

        if (titleEl) titleEl.value = example.title;
        if (descEl) descEl.value = example.description;
        
        // Check if form is hidden, show it
        if (formEl && formEl.classList.contains('hidden')) { window.togglePunishmentForm(); }
    }
}

// Since native window.alert is forbidden, we map it to our custom modal
window.alert = function(message) {
    showModal("Notice", message);
}

// --- Initialization ---

// Run initialization on load
window.onload = initFirebase;