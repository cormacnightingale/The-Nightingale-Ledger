import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Standard Web Deployment - NO CANVAS DEPENDENCIES) ---

// Static ID for the shared data path in Firestore.
const appId = 'nightingale-ledger-v1';

// CRITICAL FIX: Access 'firebaseConfig' directly from the global 'window' object,
// as it was loaded by the non-module script './firebase_config.js'.
const externalFirebaseConfig = window.firebaseConfig; 

// --- Firebase/App State ---
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
 * Custom modal implementation for alerts and notices (replaces window.alert/confirm).
 * @param {string} title - The modal title.
 * @param {string} message - The modal body message.
 * @param {boolean} isConfirm - If true, shows a Cancel button and expects a promise.
 * @returns {Promise<boolean>|void}
 */
let modalResolver = null;
function showModal(title, message, isConfirm = false) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    
    const okButton = document.getElementById('modal-ok-btn');
    const cancelButton = document.getElementById('modal-cancel-btn');
    
    cancelButton.classList.toggle('hidden', !isConfirm);
    okButton.textContent = isConfirm ? 'Confirm' : 'OK';

    document.getElementById('custom-modal').classList.remove('hidden');

    if (isConfirm) {
        return new Promise(resolve => {
            modalResolver = resolve;
        });
    }
}

window.hideModal = function() {
    document.getElementById('custom-modal').classList.add('hidden');
    modalResolver = null;
}

window.handleModalAction = function(result) {
    if (modalResolver) {
        modalResolver(result);
    }
    window.hideModal();
}

/**
 * Copies the text content of a given element ID to the clipboard.
 * @param {string} elementId 
 */
window.copyToClipboard = function(elementId) {
    const copyText = document.getElementById(elementId).value;
    const textArea = document.createElement("textarea");
    textArea.value = copyText;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showModal("Copied!", "The Shared App ID has been copied to your clipboard.");
        } else {
            throw new Error("Copy command failed.");
        }
    } catch (err) {
        console.error('Error copying text:', err);
        showModal("Error", "Could not copy text automatically. Please select and copy manually.");
    }
    document.body.removeChild(textArea);
}

/**
 * Persists the current game state to Firestore.
 */
async function saveGameState() {
    if (!db || !GAME_STATE_PATH) return;

    try {
        const docRef = doc(db, GAME_STATE_PATH);
        // Use setDoc with { merge: true } to prevent overwriting the whole document
        await setDoc(docRef, gameState, { merge: true });
    } catch (e) {
        console.error("Error writing document: ", e);
        showModal("Save Error", "Failed to save data to the Ledger. Check console for details.");
    }
}

/**
 * Subscribe to real-time updates from Firestore.
 */
function listenForUpdates() {
    if (!db || !GAME_STATE_PATH) return;

    const docRef = doc(db, GAME_STATE_PATH);

    onSnapshot(docRef, (doc) => {
        // Hide loading screen on first successful snapshot regardless of content
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('app-content').classList.remove('hidden');
        
        if (doc.exists()) {
            // Update local state and redraw UI
            const newGameState = doc.data();
            
            // Perform deep merge to ensure all keys are present if they were missed
            gameState = {
                ...gameState,
                ...newGameState,
                players: { ...gameState.players, ...(newGameState.players || {}) },
                scores: { ...gameState.scores, ...(newGameState.scores || {}) },
                habits: newGameState.habits || [],
                rewards: newGameState.rewards || [],
                punishments: newGameState.punishments || [],
                history: newGameState.history || []
            };
            
            renderUI();
        } else {
            console.log("No initial data found, creating default state.");
            saveGameState(); // Create the document if it doesn't exist
        }

    }, (error) => {
        console.error("Firestore Listen Error:", error);
        document.getElementById('auth-error-message').textContent = `Connection error: ${error.message}`;
    });
}

/**
 * Updates the entire application UI based on the current gameState.
 */
function renderUI() {
    // 1. Update Scores
    document.getElementById('keeper-name').textContent = `${gameState.players.keeper} (Keeper)`;
    document.getElementById('nightingale-name').textContent = `${gameState.players.nightingale} (Nightingale)`;
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;

    // 2. Update Footer/Debug info
    document.getElementById('current-user-id').textContent = userId || 'N/A';
    document.getElementById('current-app-id').textContent = appId;
    document.getElementById('shared-app-id').value = appId;

    // 3. Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    
    if (gameState.habits.length === 0) {
        habitsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No habits defined yet.</p>';
    } else {
        gameState.habits.forEach((habit, index) => {
            const assigneeClass = habit.assignee === 'keeper' ? 'border-keeper' : 'border-nightingale';
            const textClass = habit.assignee === 'keeper' ? 'text-keeper' : 'text-nightingale';

            const card = document.createElement('div');
            card.className = `card p-4 rounded-xl shadow-lg border-l-4 ${assigneeClass} flex justify-between items-start card-hover`;
            card.innerHTML = `
                <div>
                    <p class="text-sm text-gray-400 font-sans uppercase font-semibold">${habit.assignee}</p>
                    <p class="text-white font-playfair text-lg mb-2">${habit.description}</p>
                    <span class="${textClass} text-xl font-bold font-mono">+${habit.points} Pts</span>
                </div>
                <div class="flex flex-col space-y-2">
                    <button onclick="window.completeHabit(${index})" class="text-green-400 hover:text-green-300 font-sans font-semibold text-lg p-2 rounded-full hover:bg-[#3c3c45] transition duration-200" title="Complete Habit">&#10003;</button>
                    <button onclick="window.removeHabit(${index})" class="text-gray-500 hover:text-red-400 font-sans text-lg p-2 rounded-full hover:bg-[#3c3c45] transition duration-200" title="Remove Habit">&times;</button>
                </div>
            `;
            habitsList.appendChild(card);
        });
    }
    
    // 4. Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';

    if (gameState.rewards.length === 0) {
        rewardsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic md:col-span-2">No rewards defined yet.</p>';
    } else {
        gameState.rewards.forEach((reward, index) => {
            const canAffordKeeper = gameState.scores.keeper >= reward.cost;
            const canAffordNightingale = gameState.scores.nightingale >= reward.cost;

            const card = document.createElement('div');
            card.className = `card p-4 rounded-xl shadow-lg border-l-4 border-white flex flex-col card-hover`;
            card.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <h4 class="text-xl font-cinzel text-white">${reward.title}</h4>
                    <span class="text-xl font-bold text-green-400 font-mono">-${reward.cost} Pts</span>
                </div>
                <p class="text-sm text-gray-400 font-playfair mb-4">${reward.description}</p>
                <div class="flex space-x-2 mt-auto pt-3 border-t border-[#3c3c45]">
                    <button onclick="window.claimReward(${index}, 'keeper')" 
                            class="flex-1 btn-secondary rounded-lg font-sans text-sm py-2 ${canAffordKeeper ? 'hover:bg-keeper hover:text-white' : 'opacity-50 cursor-not-allowed'}" 
                            ${canAffordKeeper ? '' : 'disabled'}>
                        Keeper Claim
                    </button>
                    <button onclick="window.claimReward(${index}, 'nightingale')" 
                            class="flex-1 btn-secondary rounded-lg font-sans text-sm py-2 ${canAffordNightingale ? 'hover:bg-nightingale hover:text-white' : 'opacity-50 cursor-not-allowed'}" 
                            ${canAffordNightingale ? '' : 'disabled'}>
                        Nightingale Claim
                    </button>
                </div>
            `;
            rewardsList.appendChild(card);
        });
    }

    // 5. Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    
    if (gameState.punishments.length === 0) {
        punishmentsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic md:col-span-3">No punishments defined yet.</p>';
    } else {
        gameState.punishments.forEach((punishment, index) => {
            const card = document.createElement('div');
            card.className = `card p-4 rounded-xl shadow-lg border-l-4 border-red-500 flex justify-between items-start card-hover`;
            card.innerHTML = `
                <div>
                    <h4 class="text-xl font-cinzel text-red-400">${punishment.title}</h4>
                    <p class="text-sm text-gray-400 font-playfair">${punishment.description}</p>
                </div>
                <button onclick="window.removePunishment(${index})" class="text-gray-500 hover:text-red-400 font-sans text-lg p-2 rounded-full hover:bg-[#3c3c45] transition duration-200" title="Remove Punishment">&times;</button>
            `;
            punishmentsList.appendChild(card);
        });
    }

    // 6. Render History
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';

    if (gameState.history.length === 0) {
        historyList.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No recent activity.</p>';
    } else {
        // Render in reverse chronological order
        gameState.history.slice().reverse().forEach(entry => {
            let roleClass = 'text-gray-300';
            let roleName = 'System';
            
            if (entry.role === 'keeper') {
                roleClass = 'text-keeper';
                roleName = gameState.players.keeper;
            } else if (entry.role === 'nightingale') {
                roleClass = 'text-nightingale';
                roleName = gameState.players.nightingale;
            }

            const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const item = document.createElement('p');
            item.className = 'text-sm text-gray-400 border-b border-[#3c3c45] pb-2';
            item.innerHTML = `<span class="text-xs text-gray-500 mr-2">${time}</span> 
                              <span class="${roleClass} font-semibold">${roleName}</span>: ${entry.message}`;
            historyList.appendChild(item);
        });
    }
}

// --- Action Functions (Called by UI) ---

window.addHabit = async function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0) {
        showModal("Invalid Input", "Please provide a valid description and a positive point value.");
        return;
    }

    gameState.habits.push({ description: desc, points: points, assignee: assignee, id: Date.now() });
    
    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `New Habit defined: "${desc}" for +${points} pts.` 
    });

    await saveGameState();
    // Clear form
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = 10;
    window.toggleHabitForm(true); // Close form
}

window.removeHabit = async function(index) {
    const habit = gameState.habits[index];
    const confirmed = await showModal("Confirm Removal", `Are you sure you want to remove the habit: "${habit.description}"?`, true);
    if (!confirmed) return;

    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `Habit removed: "${habit.description}"` 
    });

    gameState.habits.splice(index, 1);
    await saveGameState();
}


window.completeHabit = async function(index) {
    const habit = gameState.habits[index];
    const role = habit.assignee;
    const points = habit.points;
    const playerName = gameState.players[role];

    const confirmed = await showModal("Confirm Completion", `Confirm that ${playerName} completed the habit: "${habit.description}" and will receive +${points} points?`, true);
    if (!confirmed) return;

    gameState.scores[role] += points;
    
    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: role, 
        message: `Completed habit: "${habit.description}" (+${points} pts)` 
    });
    
    // The habit is considered done for now, so we remove it. 
    gameState.habits.splice(index, 1);
    
    await saveGameState();
}

window.addReward = async function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const desc = document.getElementById('new-reward-desc').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a valid title, description, and a positive cost.");
        return;
    }

    gameState.rewards.push({ title: title, description: desc, cost: cost, id: Date.now() });
    
    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `New Reward defined: "${title}" for ${cost} pts.` 
    });
    
    await saveGameState();
    // Clear form
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-desc').value = '';
    document.getElementById('new-reward-cost').value = 50;
    window.toggleRewardForm(true); // Close form
}

window.claimReward = async function(index, role) {
    const reward = gameState.rewards[index];
    const playerName = gameState.players[role];
    
    if (gameState.scores[role] < reward.cost) {
        showModal("Cannot Afford", `${playerName} does not have enough points (needs ${reward.cost}, has ${gameState.scores[role]}).`);
        return;
    }

    const confirmed = await showModal("Confirm Claim", `Confirm that ${playerName} is claiming the reward: "${reward.title}" for -${reward.cost} points?`, true);
    if (!confirmed) return;

    gameState.scores[role] -= reward.cost;
    
    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: role, 
        message: `Claimed reward: "${reward.title}" (-${reward.cost} pts)` 
    });
    
    await saveGameState();
}

window.addPunishment = async function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Invalid Input", "Please provide a valid title and description for the punishment.");
        return;
    }

    gameState.punishments.push({ title: title, description: desc, id: Date.now() });
    
    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `New Punishment defined: "${title}"` 
    });
    
    await saveGameState();
    // Clear form
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    window.togglePunishmentForm(true); // Close form
}

window.removePunishment = async function(index) {
    const punishment = gameState.punishments[index];
    const confirmed = await showModal("Confirm Removal", `Are you sure you want to remove the punishment: "${punishment.title}"?`, true);
    if (!confirmed) return;

    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `Punishment removed: "${punishment.title}"` 
    });

    gameState.punishments.splice(index, 1);
    await saveGameState();
}


// --- Form Toggle Handlers ---

window.toggleHabitForm = function(forceHide = false) {
    const form = document.getElementById('habit-form');
    const button = document.getElementById('toggle-habit-btn');
    if (forceHide) {
        form.classList.add('hidden');
        button.textContent = 'Define New Habit +';
    } else {
        form.classList.toggle('hidden');
        button.textContent = form.classList.contains('hidden') ? 'Define New Habit +' : 'Hide Form -';
    }
}

window.toggleRewardForm = function(forceHide = false) {
    const form = document.getElementById('reward-form');
    const button = document.getElementById('toggle-reward-btn');
    if (forceHide) {
        form.classList.add('hidden');
        button.textContent = 'Define New Reward +';
    } else {
        form.classList.toggle('hidden');
        button.textContent = form.classList.contains('hidden') ? 'Define New Reward +' : 'Hide Form -';
    }
}

window.togglePunishmentForm = function(forceHide = false) {
    const form = document.getElementById('punishment-form');
    const button = document.getElementById('toggle-punishment-btn');
    if (forceHide) {
        form.classList.add('hidden');
        button.textContent = 'Define New Punishment +';
    } else {
        form.classList.toggle('hidden');
        button.textContent = form.classList.contains('hidden') ? 'Define New Punishment +' : 'Hide Form -';
    }
}


// Since native window.alert is forbidden, we map it to our custom modal
window.alert = function(message) {
    showModal("Notice", message);
}

/**
 * Inserts a random example habit, reward, or punishment into the form fields.
 */
window.generateExample = function(type) {
    // CRITICAL CHECK: Access global EXAMPLE_DATABASE provided by examples.js
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        showModal("Error", "Example data is not loaded correctly. Ensure examples.js loads first.");
        return;
    }
    
    const examples = EXAMPLE_DATABASE[type + 's'];
    const randomIndex = Math.floor(Math.random() * examples.length);
    const example = examples[randomIndex];

    if (type === 'habit') {
        document.getElementById('new-habit-desc').value = example.description;
        document.getElementById('new-habit-points').value = example.points;
        document.getElementById('new-habit-assignee').value = example.type;
        // Check if form is hidden, show it
        if (document.getElementById('habit-form').classList.contains('hidden')) { window.toggleHabitForm(); }
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        // Check if form is hidden, show it
        if (document.getElementById('reward-form').classList.contains('hidden')) { window.toggleRewardForm(); }
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        // Check if form is hidden, show it
        if (document.getElementById('punishment-form').classList.contains('hidden')) { window.togglePunishmentForm(); }
    }
}


// --- Initialization ---

/**
 * Initializes Firebase, authenticates, and starts the real-time listener.
 */
async function initFirebase() {
    // 1. Check for global firebaseConfig (which should be provided by firebase_config.js)
    if (typeof externalFirebaseConfig === 'undefined' || externalFirebaseConfig === null) {
        document.getElementById('auth-error-message').textContent = "FATAL: Firebase configuration is missing. Ensure firebase_config.js loaded correctly.";
        console.error("Firebase Config Error: 'firebaseConfig' not found on window. Ensure firebase_config.js loads before script.js.");
        // Keep loading screen up if config is missing
        return;
    }
    
    // 2. Initialize App
    try {
        app = initializeApp(externalFirebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        setLogLevel('debug'); // Enable logging for debugging Firestore issues
    } catch (e) {
        console.error("Firebase Initialization Failed:", e);
        document.getElementById('auth-error-message').textContent = `Initialization Error: ${e.message}`;
        // Show error and stop initialization
        return;
    }

    // 3. Authentication: Use anonymous sign-in for standard web deployment
    try {
        await signInAnonymously(auth);
    } catch (e) {
        console.error("Authentication Failed:", e);
        document.getElementById('auth-error-message').textContent = `Authentication Error: ${e.message}`;
        // Show error and stop initialization
        return;
    }
    
    // 4. Auth State Changed Listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            
            // Set the path for the shared ledger document using the static appId.
            GAME_STATE_PATH = `artifacts/${appId}/public/data/ledger_state/${GAME_STATE_DOC_ID}`;
            
            console.log("Authenticated. User ID:", userId, "Data Path:", GAME_STATE_PATH);

            // 5. Start listening for real-time updates
            listenForUpdates();

        } else {
            userId = null;
            document.getElementById('auth-error-message').textContent = "Authentication failed. Ledger features disabled.";
            document.getElementById('loading-screen').classList.remove('hidden');
            document.getElementById('app-content').classList.add('hidden');
        }
    });
}


// Run initialization on load
window.onload = initFirebase;