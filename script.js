import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// Reduced imports to only necessary auth functions for anonymous/custom token sign-in
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firestore log level to Debug for better visibility
setLogLevel('Debug');

// --- Global Variables (Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : window.firebaseConfig;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
// Path for public/shared data: artifacts/{appId}/public/data/ledger_state/{docId}
const GAME_STATE_DOC_PATH = `artifacts/${appId}/public/data/ledger_state/ledger_data`; 
const GAME_STATE_DOC_ID = 'ledger_data';

let gameState = {
    // Default values for player and game state
    keeper: { name: 'Keeper', points: 0, habits: [] },
    nightingale: { name: 'Nightingale', points: 0, habits: [] },
    rewards: [],
    punishments: [],
    pending_rewards: [],
    pending_punishments: [],
    history: [] // Log of completed rewards and punishments
};

// --- Utility Functions ---

/**
 * Persists the current local gameState object to the Firestore document.
 * This is the main function for saving changes.
 */
async function saveGameState() {
    if (!db) {
        console.error("Database not initialized. Cannot save game state.");
        return;
    }
    try {
        // Use setDoc to create or overwrite the single shared document
        await setDoc(doc(db, GAME_STATE_DOC_PATH), gameState);
        console.log("Game state successfully saved to Firestore.");
    } catch (e) {
        console.error("Error writing document to Firestore: ", e);
        // This is often where the 'missing permissions' error originates
        document.getElementById('auth-error-message').textContent = 'Error saving data: Missing or insufficient permissions. Check Firestore rules.';
    }
}

/**
 * Updates the local gameState object with the data retrieved from Firestore.
 * This function handles merging incoming data with local defaults.
 * @param {Object} data - The data object received from Firestore snapshot.
 */
function updateLocalGameState(data) {
    // Merge new data over defaults. This ensures any missing fields from Firestore
    // still have a default value from the local gameState definition.
    gameState = {
        ...gameState,
        ...data,
        keeper: { ...gameState.keeper, ...data.keeper },
        nightingale: { ...gameState.nightingale, ...data.nightingale }
    };
    // Ensure history is an array, default if missing
    if (!gameState.history || !Array.isArray(gameState.history)) {
        gameState.history = [];
    }

    // Update the UI with the new state
    updateUI(); 
    document.getElementById('auth-error-message').textContent = ''; // Clear any previous error

    // Once data is loaded successfully, hide the loading screen
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');

    console.log("Local game state updated from Firestore.", gameState);
}

/**
 * Sets up a real-time listener for the public shared ledger document.
 */
function startPublicDataListener() {
    if (!db) {
        console.error("Database not initialized for listener.");
        return;
    }

    const docRef = doc(db, GAME_STATE_DOC_PATH);
    
    // Subscribe to real-time updates
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            // Document exists, update local state
            updateLocalGameState(docSnap.data());
        } else {
            // Document does not exist (first run). Create it with default state.
            console.log("No shared ledger document found. Creating default document.");
            saveGameState(); 
        }
    }, (error) => {
        // This callback handles errors, including permission errors
        console.error("Firestore Listener Error:", error);
        
        const errorMessage = "Could not load shared ledger data. Missing or insufficient permissions. Please check your Firebase Security Rules.";
        document.getElementById('auth-error-message').textContent = errorMessage;
        
        // Show the loading/error screen if we can't load data
        document.getElementById('loading-screen').classList.remove('hidden');
        document.getElementById('main-content').classList.add('hidden');
    });

    console.log("Public data listener started.");
}


// --- UI / State Management Functions ---

/**
 * Updates all UI elements based on the global gameState.
 */
function updateUI() {
    // 1. Update Player Info
    document.getElementById('keeper-name').textContent = gameState.keeper.name;
    document.getElementById('keeper-points').textContent = gameState.keeper.points;
    document.getElementById('nightingale-name').textContent = gameState.nightingale.name;
    document.getElementById('nightingale-points').textContent = gameState.nightingale.points;
    
    // 2. Update Habits (Combined List)
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    
    const allHabits = [
        ...gameState.keeper.habits.map(h => ({ ...h, player: 'keeper' })),
        ...gameState.nightingale.habits.map(h => ({ ...h, player: 'nightingale' }))
    ];

    if (allHabits.length === 0) {
        document.getElementById('habits-loading').classList.remove('hidden');
    } else {
        document.getElementById('habits-loading').classList.add('hidden');
        allHabits.forEach((habit, index) => {
            const el = createHabitElement(habit, index, habit.player);
            habitsList.appendChild(el);
        });
    }

    // 3. Update Rewards and Punishments (Similar rendering logic)
    renderRewards();
    renderPunishments();
    renderPendingItems();
    // 4. Update History
    renderHistory();
}

/**
 * Creates the HTML element for a single habit item.
 */
function createHabitElement(habit, index, playerType) {
    const isKeeper = playerType === 'keeper';
    const habitColor = isKeeper ? 'bg-[#5c4a4e]' : 'bg-[#555a68]';
    // Keeper: Feather (Nightingale), Nightingale: Key (Keeper/Lock)
    const playerIcon = isKeeper ? '<i class="fa-solid fa-key"></i>' : '<i class="fa-solid fa-feather-pointed"></i>'; 
    const playerName = isKeeper ? gameState.keeper.name : gameState.nightingale.name;

    const li = document.createElement('li');
    li.className = `${habitColor} p-4 rounded-lg shadow-md flex justify-between items-center mb-3 transition-all duration-300`;
    li.innerHTML = `
        <div>
            <p class="text-sm text-gray-300 mb-1">${playerIcon} ${playerName} gets (+${habit.points})</p>
            <p class="font-medium">${habit.description}</p>
        </div>
        <div class="flex items-center space-x-2">
            <!-- Mark Complete Button -->
            <button onclick="window.markHabitComplete(${index}, '${playerType}')" class="bg-emerald-600 hover:bg-emerald-700 text-white p-2 rounded-full w-10 h-10 flex items-center justify-center transition-colors shadow-lg" title="Mark Complete">
                <i class="fa-solid fa-check"></i>
            </button>
            <!-- Delete Button -->
            <button onclick="window.deleteHabit(${index}, '${playerType}')" class="bg-red-600 hover:bg-red-700 text-white p-2 rounded-full w-10 h-10 flex items-center justify-center transition-colors shadow-lg" title="Delete Habit">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
    return li;
}

/**
 * Renders the list of available rewards.
 */
function renderRewards() {
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';

    if (gameState.rewards.length === 0) {
        document.getElementById('rewards-loading').classList.remove('hidden');
    } else {
        document.getElementById('rewards-loading').classList.add('hidden');
        gameState.rewards.forEach((reward, index) => {
            rewardsList.appendChild(createRewardElement(reward, index));
        });
    }
}

/**
 * Creates the HTML element for a single reward item.
 */
function createRewardElement(reward, index) {
    const isPending = gameState.pending_rewards.some(p => p.rewardIndex === index);
    const costColor = isPending ? 'text-gray-500' : 'text-yellow-400';
    const buttonClass = isPending 
        ? 'bg-gray-700 cursor-not-allowed' 
        : 'bg-[#b05c6c] hover:bg-[#c06c7c] transition-colors';
    
    const li = document.createElement('li');
    li.className = `bg-[#24242e] p-4 rounded-xl shadow-lg mb-3 border-l-4 ${isPending ? 'border-gray-500 opacity-70' : 'border-[#b05c6c]'} flex justify-between items-start transition-all duration-300`;
    li.innerHTML = `
        <div class="flex-grow pr-4">
            <h4 class="text-xl font-cinzel text-[#e0e0e0] mb-1">${reward.title}</h4>
            <p class="text-gray-400 text-sm">${reward.description}</p>
        </div>
        <div class="text-right flex-shrink-0">
            <p class="${costColor} text-lg font-bold mb-2">
                <i class="fa-solid fa-gem mr-1"></i> ${reward.cost}
            </p>
            <button onclick="window.requestReward(${index})" class="${buttonClass} text-white font-semibold py-2 px-4 rounded-lg shadow-md text-sm" ${isPending ? 'disabled' : ''}>
                ${isPending ? 'Pending' : 'Request'}
            </button>
        </div>
    `;
    return li;
}


/**
 * Renders the list of available punishments.
 */
function renderPunishments() {
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';

    if (gameState.punishments.length === 0) {
        document.getElementById('punishments-loading').classList.remove('hidden');
    } else {
        document.getElementById('punishments-loading').classList.add('hidden');
        gameState.punishments.forEach((punishment, index) => {
            punishmentsList.appendChild(createPunishmentElement(punishment, index));
        });
    }
}

/**
 * Creates the HTML element for a single punishment item.
 */
function createPunishmentElement(punishment, index) {
    const isPending = gameState.pending_punishments.some(p => p.punishmentIndex === index);
    const buttonClass = isPending 
        ? 'bg-gray-700 cursor-not-allowed' 
        : 'bg-red-600 hover:bg-red-700 transition-colors';
    
    const li = document.createElement('li');
    li.className = `bg-[#24242e] p-4 rounded-xl shadow-lg mb-3 border-l-4 ${isPending ? 'border-gray-500 opacity-70' : 'border-red-600'} flex justify-between items-start transition-all duration-300`;
    li.innerHTML = `
        <div class="flex-grow pr-4">
            <h4 class="text-xl font-cinzel text-[#e0e0e0] mb-1">${punishment.title}</h4>
            <p class="text-gray-400 text-sm">${punishment.description}</p>
        </div>
        <div class="text-right flex-shrink-0">
            <button onclick="window.assignPunishment(${index})" class="${buttonClass} text-white font-semibold py-2 px-4 rounded-lg shadow-md text-sm" ${isPending ? 'disabled' : ''}>
                ${isPending ? 'Pending' : 'Assign'}
            </button>
        </div>
    `;
    return li;
}

/**
 * Renders the pending rewards and punishments sections.
 */
function renderPendingItems() {
    const pendingRewardsList = document.getElementById('pending-rewards-list');
    const pendingPunishmentsList = document.getElementById('pending-punishments-list');

    pendingRewardsList.innerHTML = '';
    pendingPunishmentsList.innerHTML = '';
    let hasPending = false;

    // Pending Rewards
    if (gameState.pending_rewards.length > 0) {
        document.getElementById('pending-rewards-section').classList.remove('hidden');
        hasPending = true;
        gameState.pending_rewards.forEach((req, index) => {
            const reward = gameState.rewards[req.rewardIndex];
            if (!reward) return; // safety check
            const li = document.createElement('li');
            li.className = 'bg-yellow-900/50 p-3 rounded-lg flex justify-between items-center mb-2';
            li.innerHTML = `
                <div class="flex-grow">
                    <p class="font-bold text-yellow-300">${reward.title} (${reward.cost} <i class="fa-solid fa-gem"></i>)</p>
                    <p class="text-sm text-yellow-200">Requested by ${req.requesterName}</p>
                </div>
                <div class="space-x-2">
                    <button onclick="window.approveReward(${index})" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-full text-xs" title="Approve">Approve</button>
                    <button onclick="window.rejectReward(${index})" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-full text-xs" title="Reject">Reject</button>
                </div>
            `;
            pendingRewardsList.appendChild(li);
        });
    } else {
        document.getElementById('pending-rewards-section').classList.add('hidden');
    }
    
    // Pending Punishments
    if (gameState.pending_punishments.length > 0) {
        document.getElementById('pending-punishments-section').classList.remove('hidden');
        hasPending = true;
        gameState.pending_punishments.forEach((req, index) => {
            const punishment = gameState.punishments[req.punishmentIndex];
            if (!punishment) return; // safety check
            const li = document.createElement('li');
            li.className = 'bg-red-900/50 p-3 rounded-lg flex justify-between items-center mb-2';
            li.innerHTML = `
                <div class="flex-grow">
                    <p class="font-bold text-red-300">${punishment.title}</p>
                    <p class="text-sm text-red-200">Assigned by ${req.assignerName}</p>
                </div>
                <div class="space-x-2">
                    <button onclick="window.completePunishment(${index})" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-full text-xs" title="Complete">Complete</button>
                    <button onclick="window.rejectPunishment(${index})" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-full text-xs" title="Reject">Remove</button>
                </div>
            `;
            pendingPunishmentsList.appendChild(li);
        });
    } else {
        document.getElementById('pending-punishments-section').classList.add('hidden');
    }

    // Toggle main pending loading message
    if (hasPending) {
        document.getElementById('pending-loading').classList.add('hidden');
    } else {
        document.getElementById('pending-loading').classList.remove('hidden');
    }
}

/**
 * Renders the history log.
 */
function renderHistory() {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    
    if (gameState.history.length === 0) {
        document.getElementById('history-loading').classList.remove('hidden');
        return;
    } else {
        document.getElementById('history-loading').classList.add('hidden');
    }

    // Iterate backwards so most recent is displayed first
    gameState.history.forEach(entry => {
        const el = createHistoryElement(entry);
        historyList.appendChild(el);
    });
}

/**
 * Creates the HTML element for a single history item.
 */
function createHistoryElement(entry) {
    const li = document.createElement('li');
    li.className = 'p-3 rounded-lg mb-2 text-sm transition-all duration-300';
    
    let icon = '';
    let text = '';
    let color = '';
    
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (entry.type === 'reward_approved') {
        icon = '<i class="fa-solid fa-trophy text-yellow-500 mr-2"></i>';
        color = 'bg-[#182a18] border-l-4 border-yellow-500';
        text = `Reward <strong>"${entry.details.rewardTitle}"</strong> purchased (Cost: ${entry.details.cost} <i class="fa-solid fa-gem"></i>).`;
    } else if (entry.type === 'punishment_assigned') {
        icon = '<i class="fa-solid fa-handcuffs text-red-500 mr-2"></i>';
        color = 'bg-[#2a1818] border-l-4 border-red-500';
        text = `Punishment <strong>"${entry.details.punishmentTitle}"</strong> assigned by ${entry.details.assigner}.`;
    } else if (entry.type === 'punishment_completed') {
        icon = '<i class="fa-solid fa-face-grimace text-gray-500 mr-2"></i>';
        color = 'bg-[#1c1c1c] border-l-4 border-gray-500';
        text = `Punishment <strong>"${entry.details.punishmentTitle}"</strong> completed.`;
    }

    li.className += ' ' + color;
    li.innerHTML = `
        <div class="flex justify-between items-start">
            <span class="font-playfair text-gray-200">${icon} ${text}</span>
            <span class="text-xs text-gray-400">${time}</span>
        </div>
    `;

    return li;
}


/**
 * Adds an event to the history log.
 * @param {('reward_approved'|'punishment_completed'|'punishment_assigned')} type 
 * @param {object} details 
 */
function logHistoryEntry(type, details) {
    gameState.history.unshift({ // unshift to add to the beginning (most recent first)
        id: Date.now() + Math.random().toString(36).substring(2),
        timestamp: new Date().toISOString(),
        type: type,
        details: details
    });
    // Keep history length manageable (e.g., last 50 entries)
    if (gameState.history.length > 50) {
        gameState.history.pop();
    }
}

// --- Action Handlers ---

/**
 * Marks a habit complete, adds points, and removes the habit.
 * @param {number} index - Index of the habit in the player's array.
 * @param {('keeper'|'nightingale')} playerType - The player who owns the habit.
 */
window.markHabitComplete = function(index, playerType) {
    const player = gameState[playerType];
    const habit = player.habits[index];

    if (habit) {
        // Add points to the OPPOSITE player (who gets the reward for the partner completing the habit)
        const recipientType = playerType === 'keeper' ? 'nightingale' : 'keeper';
        gameState[recipientType].points += habit.points;
        
        // Remove the habit
        player.habits.splice(index, 1);
        
        // Save the updated state
        saveGameState();
    }
}

/**
 * Deletes a habit from the player's list without awarding points.
 * @param {number} index - Index of the habit in the player's array.
 * @param {('keeper'|'nightingale')} playerType - The player who owns the habit.
 */
window.deleteHabit = function(index, playerType) {
    const player = gameState[playerType];
    
    if (player.habits[index]) {
        console.warn("Habit deletion initiated.");
        player.habits.splice(index, 1);
        saveGameState();
    }
}


/**
 * Requests a reward, checking if the requesting player has enough points.
 * @param {number} index - Index of the reward in the global rewards array.
 */
window.requestReward = function(index) {
    const reward = gameState.rewards[index];
    if (!reward) return;

    // Use a generic name for the requester since we're using anonymous auth
    const currentUserName = gameState.keeper.name === userId ? gameState.keeper.name : (gameState.nightingale.name === userId ? gameState.nightingale.name : (auth.currentUser?.uid || 'A User'));
    
    // Check if the reward is already pending
    const isPending = gameState.pending_rewards.some(p => p.rewardIndex === index);
    if (isPending) {
        document.getElementById('auth-error-message').textContent = `Reward "${reward.title}" is already pending approval.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 5000);
        return;
    }
    
    // Check if the cost is covered by the shared pool
    const currentPoints = gameState.keeper.points + gameState.nightingale.points;
    
    if (currentPoints < reward.cost) {
        document.getElementById('auth-error-message').textContent = `Not enough points! Total points required: ${reward.cost}.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 5000);
        return;
    }

    // Add to pending rewards
    gameState.pending_rewards.push({
        rewardIndex: index,
        requesterId: userId,
        requesterName: currentUserName
    });
    
    saveGameState();
}

/**
 * Approves a pending reward, deducts the points, and removes it from pending list.
 * @param {number} pendingIndex - Index in the pending_rewards array.
 */
window.approveReward = function(pendingIndex) {
    const pendingReq = gameState.pending_rewards[pendingIndex];
    if (!pendingReq) return;
    
    const reward = gameState.rewards[pendingReq.rewardIndex];
    if (!reward) return;
    
    // Deduct points from Keeper first, then Nightingale if Keeper doesn't have enough
    let pointsToDeduct = reward.cost;

    if (gameState.keeper.points >= pointsToDeduct) {
        gameState.keeper.points -= pointsToDeduct;
    } else {
        // If Keeper points are insufficient, use all of Keeper's points
        pointsToDeduct -= gameState.keeper.points;
        gameState.keeper.points = 0;
        
        // Deduct remaining from Nightingale 
        if (gameState.nightingale.points >= pointsToDeduct) {
            gameState.nightingale.points -= pointsToDeduct;
        } else {
            console.error("Critical Error: Insufficient points during approval deduction.");
            document.getElementById('auth-error-message').textContent = "ERROR: Insufficient points were detected during approval. Please refresh.";
            return;
        }
    }
    
    // Log the approval (PURCHASE)
    logHistoryEntry('reward_approved', {
        rewardTitle: reward.title,
        cost: reward.cost,
        requester: pendingReq.requesterName
    });


    // Remove from pending list
    gameState.pending_rewards.splice(pendingIndex, 1);
    
    saveGameState();
}

/**
 * Rejects a pending reward and removes it from the pending list.
 * This is NOT logged to history as it is a non-completed transaction.
 * @param {number} pendingIndex - Index in the pending_rewards array.
 */
window.rejectReward = function(pendingIndex) {
    gameState.pending_rewards.splice(pendingIndex, 1);
    saveGameState();
}


/**
 * Assigns a punishment, adding it to the pending punishments list.
 * @param {number} index - Index of the punishment in the global punishments array.
 */
window.assignPunishment = function(index) {
    const punishment = gameState.punishments[index];
    if (!punishment) return;
    
    // Check if the punishment is already pending
    const isPending = gameState.pending_punishments.some(p => p.punishmentIndex === index);
    if (isPending) {
        document.getElementById('auth-error-message').textContent = `Punishment "${punishment.title}" is already assigned.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 5000);
        return;
    }

    const currentUserName = gameState.keeper.name === userId ? gameState.keeper.name : (gameState.nightingale.name === userId ? gameState.nightingale.name : (auth.currentUser?.uid || 'A User'));

    gameState.pending_punishments.push({
        punishmentIndex: index,
        assignerId: userId,
        assignerName: currentUserName
    });
    
    // Log the assignment (PURCHASE/ASSIGNMENT)
    logHistoryEntry('punishment_assigned', {
        punishmentTitle: punishment.title,
        assigner: currentUserName
    });

    saveGameState();
}

/**
 * Marks a pending punishment as complete and removes it.
 * @param {number} pendingIndex - Index in the pending_punishments array.
 */
window.completePunishment = function(pendingIndex) {
    const pendingReq = gameState.pending_punishments[pendingIndex];
    if (!pendingReq) return;

    const punishment = gameState.punishments[pendingReq.punishmentIndex];
    
    // Log the completion (FINALIZATION)
    logHistoryEntry('punishment_completed', {
        punishmentTitle: punishment.title,
        assigner: pendingReq.assignerName,
        completedBy: auth.currentUser?.uid || 'Anonymous User'
    });
    
    gameState.pending_punishments.splice(pendingIndex, 1);
    saveGameState();
}

/**
 * Removes a pending punishment (reject/remove assignment).
 * This is NOT logged to history as it is a non-completed transaction.
 * @param {number} pendingIndex - Index in the pending_punishments array.
 */
window.rejectPunishment = function(pendingIndex) {
    gameState.pending_punishments.splice(pendingIndex, 1);
    saveGameState();
}

// --- Form Handlers ---

/**
 * Toggles visibility of a form and resets it.
 * @param {string} formId - ID of the form container.
 * @param {boolean} show - True to force show, false to toggle.
 */
function toggleForm(formId, show) {
    const formEl = document.getElementById(formId);
    const isHidden = formEl.classList.contains('hidden');
    
    if (show !== undefined ? show : isHidden) {
        formEl.classList.remove('hidden');
    } else {
        formEl.classList.add('hidden');
        // Reset form on close
        formEl.querySelector('form').reset();
    }
}

window.toggleHabitForm = () => toggleForm('habit-form');
window.toggleRewardForm = () => toggleForm('reward-form');
window.togglePunishmentForm = () => toggleForm('punishment-form');


/**
 * Submits the new habit form.
 */
window.submitNewHabit = function(event) {
    event.preventDefault();

    const description = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const playerType = document.getElementById('new-habit-player').value;

    if (description && points > 0 && gameState[playerType]) {
        gameState[playerType].habits.push({ description, points, type: playerType });
        saveGameState();
        document.getElementById('habit-form').querySelector('form').reset();
        window.toggleHabitForm();
    }
}

/**
 * Submits the new reward form.
 */
window.submitNewReward = function(event) {
    event.preventDefault();

    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const description = document.getElementById('new-reward-desc').value.trim();

    if (title && cost > 0 && description) {
        gameState.rewards.push({ title, cost, description });
        saveGameState();
        document.getElementById('reward-form').querySelector('form').reset();
        window.toggleRewardForm();
    }
}

/**
 * Submits the new punishment form.
 */
window.submitNewPunishment = function(event) {
    event.preventDefault();

    const title = document.getElementById('new-punishment-title').value.trim();
    const description = document.getElementById('new-punishment-desc').value.trim();

    if (title && description) {
        gameState.punishments.push({ title, description });
        saveGameState();
        document.getElementById('punishment-form').querySelector('form').reset();
        window.togglePunishmentForm();
    }
}

// --- Player Name Management ---
/**
 * Toggles the visibility of the player name edit form.
 * @param {('keeper'|'nightingale')} playerType - The player type to edit.
 */
window.toggleNameEdit = function(playerType) {
    const nameDisplay = document.getElementById(`${playerType}-name-display`);
    const nameEdit = document.getElementById(`${playerType}-name-edit`);
    const input = document.getElementById(`${playerType}-new-name`);

    nameDisplay.classList.toggle('hidden');
    nameEdit.classList.toggle('hidden');
    
    if (!nameEdit.classList.contains('hidden')) {
        input.value = gameState[playerType].name;
        input.focus();
    }
}

/**
 * Submits the new player name.
 * @param {('keeper'|'nightingale')} playerType - The player type to edit.
 */
window.submitNewName = function(playerType) {
    const newName = document.getElementById(`${playerType}-new-name`).value.trim();
    if (newName) {
        gameState[playerType].name = newName;
        saveGameState();
        window.toggleNameEdit(playerType);
    }
}

/**
 * Initializes the player name forms for submission on enter key.
 */
function initializeNameForms() {
    ['keeper', 'nightingale'].forEach(type => {
        const input = document.getElementById(`${type}-new-name`);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.submitNewName(type);
            }
        });
    });
}


// --- Example Data Loaders ---

/**
 * Fills the Add New Habit form with random example data.
 */
window.fillHabitForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        console.error("Example database not loaded.");
        return;
    }
    const examples = EXAMPLE_DATABASE.habits;
    if (examples.length === 0) return;

    const example = examples[Math.floor(Math.random() * examples.length)];

    document.getElementById('new-habit-desc').value = example.description;
    document.getElementById('new-habit-points').value = example.points;
    document.getElementById('new-habit-player').value = example.type;
    
    // Check if form is hidden, show it
    if (document.getElementById('habit-form').classList.contains('hidden')) { window.toggleHabitForm(true); }
}

/**
 * Fills the Add New Reward form with random example data.
 */
window.fillRewardForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        console.error("Example database not loaded.");
        return;
    }
    const examples = EXAMPLE_DATABASE.rewards;
    if (examples.length === 0) return;

    const example = examples[Math.floor(Math.random() * examples.length)];

    document.getElementById('new-reward-title').value = example.title;
    document.getElementById('new-reward-cost').value = example.cost;
    document.getElementById('new-reward-desc').value = example.description;
    
    // Check if form is hidden, show it
    if (document.getElementById('reward-form').classList.contains('hidden')) { window.toggleRewardForm(true); }
}

/**
 * Fills the Add New Punishment form with random example data.
 */
window.fillPunishmentForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        console.error("Example database not loaded.");
        return;
    }
    const examples = EXAMPLE_DATABASE.punishments;
    if (examples.length === 0) return;

    const example = examples[Math.floor(Math.random() * examples.length)];

    document.getElementById('new-punishment-title').value = example.title;
    document.getElementById('new-punishment-desc').value = example.description;
    
    // Check if form is hidden, show it
    if (document.getElementById('punishment-form').classList.contains('hidden')) { window.togglePunishmentForm(true); }
}


// --- Authentication & Initialization ---

/**
 * Initializes Firebase, authenticates the user, and starts data listening.
 */
async function initAuthAndDB() {
    // 1. Initialize Firebase
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    
    // Display the App ID for debugging
    document.getElementById('current-app-id').textContent = appId;
    
    let isInitialAuthResolved = false;

    // 2. Listen for Auth State Changes
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;
            console.log(`User authenticated. UID: ${userId}`);
            
            // Start listening to public data once authenticated
            startPublicDataListener(); 
        } else if (!isInitialAuthResolved) {
            // If the initial check finds no user, sign in anonymously or use custom token
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                    console.log("Signed in with custom token.");
                } else {
                    await signInAnonymously(auth);
                    console.log("Signed in anonymously.");
                }
            } catch (error) {
                console.error("Initial Authentication Error:", error);
                document.getElementById('auth-error-message').textContent = 'Initial connection failed. Please ensure Firebase configuration is valid.';
            }
        } else {
             // Fallback if auth state changes to null after successful login (e.g., user signs out)
            userId = crypto.randomUUID(); 
            startPublicDataListener();
        }
        
        // Update UI with current userId
        document.getElementById('current-user-id').textContent = userId;

        isInitialAuthResolved = true;
    });
}

// --- Initialization ---

// Run initialization on window load
window.onload = function() {
    initAuthAndDB();
    initializeNameForms();
    // Attach form submission handlers
    document.getElementById('habit-form').querySelector('form').onsubmit = window.submitNewHabit;
    document.getElementById('reward-form').querySelector('form').onsubmit = window.submitNewReward;
    document.getElementById('punishment-form').querySelector('form').onsubmit = window.submitNewPunishment;
}