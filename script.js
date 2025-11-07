import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firestore log level to Debug for better visibility
setLogLevel('Debug');

// --- Global Variables (Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : window.firebaseConfig;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

// --- Firebase/App State ---\
let app;
let db;
let auth;
let userId = null;
// Path for public/shared data: artifacts/{appId}/public/data/ledger_state/{docId}
const GAME_STATE_DOC_PATH = `artifacts/${appId}/public/data/ledger_state/ledger_data`; 
const GAME_STATE_DOC_ID = 'ledger_data';

let gameState = {
    // Default values for player names and titles (now editable)
    players: {
        keeper: { name: 'The Keeper', title: 'Keeper' },
        nightingale: { name: 'The Nightingale', title: 'Nightingale' }
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
 * Custom modal implementation for alerts and notices (replaces window.alert/confirm)
 */
function showModal(title, message, isPrompt = false, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').textContent = message;
        
        const input = document.getElementById('modal-input');
        const cancelBtn = document.getElementById('modal-cancel-btn');
        const confirmBtn = document.getElementById('modal-confirm-btn');

        if (isPrompt) {
            input.value = defaultValue;
            input.classList.remove('hidden');
            cancelBtn.classList.remove('hidden');
            confirmBtn.textContent = 'Save';
        } else {
            input.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            confirmBtn.textContent = 'OK';
        }

        const handleConfirm = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(isPrompt ? input.value : true);
        };

        const handleCancel = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(null); // Return null for prompt cancellation
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (isPrompt) input.focus();
    });
}

window.alert = function(message) {
    showModal("Notice", message);
}

// --- Firebase Initialization and Auth ---

async function initFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Initial authentication logic
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            // Fallback for standard web deployment without a custom token
            await signInAnonymously(auth);
        }

        // Wait for auth state to be resolved
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('current-user-id').textContent = userId;
                document.getElementById('current-app-id').textContent = appId;
                
                // Once authenticated, start listening to the shared ledger state
                document.getElementById('loading-screen').classList.add('hidden');
                document.getElementById('main-content').classList.remove('hidden');
                listenToGameState();
                
            } else {
                // If auth fails for any reason
                console.error("Authentication failed or user logged out.");
                document.getElementById('auth-error-message').textContent = 'Authentication failed. Please check environment configuration.';
            }
        });
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        document.getElementById('loading-screen').classList.remove('hidden');
        document.getElementById('auth-error-message').textContent = `Connection Error: ${error.message}.`;
    }
}

// --- Firestore Read/Write ---

function listenToGameState() {
    const docRef = doc(db, GAME_STATE_DOC_PATH);
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            // Merge existing state with fetched state to prevent overwriting missing fields
            const fetchedState = docSnap.data();
            gameState = { ...gameState, ...fetchedState };
            renderState();
        } else {
            // Document doesn't exist, create it with initial state
            updateGameState(gameState, "Initial Ledger Created");
        }
    }, (error) => {
        console.error("Error listening to Firestore state:", error);
        window.alert("Failed to connect to the shared ledger. See console for details.");
    });
}

async function updateGameState(newState, historyMessage) {
    if (!db) return;
    
    // Add history entry
    if (historyMessage) {
        newState.history.unshift({ 
            timestamp: new Date().toISOString(), 
            message: historyMessage 
        });
        // Keep history manageable (e.g., last 25 entries)
        newState.history = newState.history.slice(0, 25); 
    }

    // Update global state immediately
    gameState = newState; 

    try {
        await setDoc(doc(db, GAME_STATE_DOC_PATH), newState);
    } catch (e) {
        console.error("Error writing document: ", e);
        window.alert(`Failed to save state: ${e.message}`);
    }
}

// --- Rendering Functions ---

function renderState() {
    // Render Scores and Names
    ['keeper', 'nightingale'].forEach(key => {
        const player = gameState.players[key];
        const score = gameState.scores[key];

        document.getElementById(`player-name-${key}`).textContent = player.name;
        document.getElementById(`${key}-title`).textContent = `The ${player.title}`;
        document.getElementById(`score-${key}`).textContent = score;
    });

    // Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    if (gameState.habits.length === 0) {
        habitsList.innerHTML = '<p class="text-gray-500" id="habits-loading">No habits defined yet.</p>';
    } else {
        gameState.habits.forEach((habit, index) => {
            const player = gameState.players[habit.assignee];
            const name = player ? player.name : 'Unknown User';
            
            const habitItem = document.createElement('div');
            habitItem.className = 'card p-4 flex items-center justify-between border-b border-[#3c3c45] transition-all hover:bg-[#2a2a2c]';
            habitItem.innerHTML = `
                <div>
                    <p class="text-lg text-white font-semibold">${habit.description}</p>
                    <p class="text-sm text-gray-400">
                        <span class="${habit.assignee === 'keeper' ? 'text-red-400' : 'text-purple-400'}">(${habit.assignee.charAt(0).toUpperCase() + habit.assignee.slice(1)})</span>
                        &mdash; ${name} | ${habit.points} Points | ${habit.timesPerWeek}x Week
                    </p>
                </div>
                <div class="flex space-x-2">
                    <button onclick="window.completeHabit(${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-green-700 border-green-500">
                        <i class="fas fa-check"></i>
                    </button>
                    <button onclick="window.deleteItem('habit', ${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-red-700 border-red-500">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            habitsList.appendChild(habitItem);
        });
    }

    // Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    if (gameState.rewards.length === 0) {
        rewardsList.innerHTML = '<p class="text-gray-500 col-span-full" id="rewards-loading">No rewards defined yet.</p>';
    } else {
        gameState.rewards.forEach((reward, index) => {
            const rewardItem = document.createElement('div');
            rewardItem.className = 'card p-4 space-y-2 border-l-4 border-purple-500';
            rewardItem.innerHTML = `
                <div class="flex justify-between items-center">
                    <p class="text-xl text-purple-300 font-semibold">${reward.title}</p>
                    <span class="text-lg text-yellow-500 font-cinzel">${reward.cost} Pts</span>
                </div>
                <p class="text-sm text-gray-400">${reward.description}</p>
                <div class="flex space-x-2 pt-2">
                    <button onclick="window.claimReward(${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-green-700 border-green-500">
                        <i class="fas fa-gift"></i> Claim
                    </button>
                    <button onclick="window.deleteItem('reward', ${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-red-700 border-red-500">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            rewardsList.appendChild(rewardItem);
        });
    }

    // Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    if (gameState.punishments.length === 0) {
        punishmentsList.innerHTML = '<p class="text-gray-500 col-span-full" id="punishments-loading">No punishments defined yet.</p>';
    } else {
        gameState.punishments.forEach((punishment, index) => {
            const punishmentItem = document.createElement('div');
            punishmentItem.className = 'card p-4 space-y-2 border-l-4 border-red-500';
            punishmentItem.innerHTML = `
                <div class="flex justify-between items-center">
                    <p class="text-xl text-red-300 font-semibold">${punishment.title}</p>
                </div>
                <p class="text-sm text-gray-400">${punishment.description}</p>
                <div class="flex space-x-2 pt-2">
                    <button onclick="window.deleteItem('punishment', ${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-red-700 border-red-500">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            `;
            punishmentsList.appendChild(punishmentItem);
        });
    }

    // Render History
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    if (gameState.history.length === 0) {
        historyList.innerHTML = '<li class="text-gray-500" id="history-loading">Awaiting ledger entry...</li>';
    } else {
        gameState.history.forEach(item => {
            const date = new Date(item.timestamp).toLocaleTimeString();
            const historyItem = document.createElement('li');
            historyItem.className = 'text-sm text-gray-400 border-b border-[#3c3c45] pb-2';
            historyItem.innerHTML = `[${date}] ${item.message}`;
            historyList.appendChild(historyItem);
        });
    }

    // Ensure the correct tab is highlighted on render
    setActiveTab(window.activeTab || 'habits');
}

// --- Editing User Data ---

/**
 * Allows the user to edit their display name.
 * @param {('keeper'|'nightingale')} playerKey 
 */
window.editPlayerName = async function(playerKey) {
    const currentName = gameState.players[playerKey].name;
    const newName = await showModal(
        `Edit ${gameState.players[playerKey].title} Name`, 
        `Enter the new name for The ${gameState.players[playerKey].title}:`, 
        true, // isPrompt
        currentName
    );

    if (newName && newName.trim() && newName !== currentName) {
        const newState = JSON.parse(JSON.stringify(gameState));
        newState.players[playerKey].name = newName.trim();
        const historyMessage = `${currentName}'s name updated to ${newName.trim()}.`;
        updateGameState(newState, historyMessage);
    }
}

/**
 * Allows the user to edit the role title (e.g., Keeper, Nightingale).
 * @param {('keeper'|'nightingale')} playerKey 
 */
window.editPlayerTitle = async function(playerKey) {
    const currentTitle = gameState.players[playerKey].title;
    const newTitle = await showModal(
        `Edit ${currentTitle} Title`, 
        `Enter the new title for this role (e.g., 'Guardian', 'Muse'):`, 
        true, // isPrompt
        currentTitle
    );

    if (newTitle && newTitle.trim() && newTitle !== currentTitle) {
        const newState = JSON.parse(JSON.stringify(gameState));
        // Capitalize the new title for display consistency
        const formattedTitle = newTitle.trim().charAt(0).toUpperCase() + newTitle.trim().slice(1);
        newState.players[playerKey].title = formattedTitle;
        const historyMessage = `${currentTitle} title updated to ${formattedTitle}.`;
        updateGameState(newState, historyMessage);
    }
}


// --- Habit, Reward, Punishment CRUD ---

window.addNewHabit = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const times = parseInt(document.getElementById('new-habit-times').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points < 1 || isNaN(times) || times < 1 || times > 7 || !assignee) {
        window.alert("Please fill out all habit fields correctly (Points/Times must be valid numbers).");
        return;
    }

    const newState = JSON.parse(JSON.stringify(gameState));
    newState.habits.push({
        description: desc,
        points: points,
        timesPerWeek: times,
        assignee: assignee,
        // Optional: add a completion tracking field here later if needed
    });

    // Clear form
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = '';
    document.getElementById('new-habit-times').value = '';
    document.getElementById('new-habit-assignee').value = '';

    const title = newState.players[assignee].title;
    const historyMessage = `New Habit added for The ${title}: "${desc}" (${points} Pts).`;
    updateGameState(newState, historyMessage);
    window.toggleHabitForm(false);
}

window.addNewReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || isNaN(cost) || cost < 1 || !desc) {
        window.alert("Please fill out all reward fields correctly (Cost must be a valid number).");
        return;
    }

    const newState = JSON.parse(JSON.stringify(gameState));
    newState.rewards.push({
        title: title,
        cost: cost,
        description: desc,
    });

    // Clear form
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = '';
    document.getElementById('new-reward-desc').value = '';

    const historyMessage = `New Reward cataloged: "${title}" (${cost} Pts).`;
    updateGameState(newState, historyMessage);
    window.toggleRewardForm(false);
}

window.addNewPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        window.alert("Please fill out all punishment fields.");
        return;
    }

    const newState = JSON.parse(JSON.stringify(gameState));
    newState.punishments.push({
        title: title,
        description: desc,
    });

    // Clear form
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';

    const historyMessage = `New Punishment cataloged: "${title}".`;
    updateGameState(newState, historyMessage);
    window.togglePunishmentForm(false);
}

window.deleteItem = function(type, index) {
    const newState = JSON.parse(JSON.stringify(gameState));
    let historyMessage = '';

    if (type === 'habit') {
        const habit = newState.habits.splice(index, 1)[0];
        historyMessage = `Habit removed: "${habit.description}".`;
    } else if (type === 'reward') {
        const reward = newState.rewards.splice(index, 1)[0];
        historyMessage = `Reward removed from catalog: "${reward.title}".`;
    } else if (type === 'punishment') {
        const punishment = newState.punishments.splice(index, 1)[0];
        historyMessage = `Punishment removed: "${punishment.title}".`;
    }

    updateGameState(newState, historyMessage);
}

// --- Game/Scoring Logic ---

window.completeHabit = function(index) {
    const habit = gameState.habits[index];
    if (!habit) return;

    const player = habit.assignee; // 'keeper' or 'nightingale'
    const otherPlayer = player === 'keeper' ? 'nightingale' : 'keeper';
    const points = habit.points;

    const newState = JSON.parse(JSON.stringify(gameState));
    // Reward the *other* player, as they are the one benefiting/tracking this
    newState.scores[otherPlayer] += points; 
    
    // History message should reflect who gained the points
    const gainerTitle = newState.players[otherPlayer].title;
    const assigneeTitle = newState.players[player].title;
    const historyMessage = `The ${assigneeTitle} completed Habit: "${habit.description}". The ${gainerTitle} gained ${points} points.`;
    
    // Optionally delete or track completion (keeping simple for now: reward completion)
    // To make it repeatable, we don't delete. If tracking is needed, this is where it goes.

    updateGameState(newState, historyMessage);
}

window.claimReward = function(index) {
    const reward = gameState.rewards[index];
    if (!reward) return;

    // This prompt asks the user who is claiming it and who is fulfilling it.
    showModal("Claim Reward", "Which player is claiming this reward?", true, 'keeper/nightingale').then(claimerInput => {
        if (!claimerInput) return;
        
        const claimerKey = claimerInput.toLowerCase().trim();
        if (claimerKey !== 'keeper' && claimerKey !== 'nightingale') {
            window.alert("Invalid player name. Must be 'keeper' or 'nightingale'.");
            return;
        }

        const cost = reward.cost;
        const currentScore = gameState.scores[claimerKey];

        if (currentScore < cost) {
            window.alert(`The ${gameState.players[claimerKey].title} does not have enough points (Needed: ${cost}, Current: ${currentScore}).`);
            return;
        }

        const newState = JSON.parse(JSON.stringify(gameState));
        newState.scores[claimerKey] -= cost;

        // Optionally remove the reward from the list if it's a one-time reward
        // newState.rewards.splice(index, 1);

        const claimerTitle = newState.players[claimerKey].title;
        const historyMessage = `The ${claimerTitle} claimed Reward: "${reward.title}" for ${cost} points.`;
        
        updateGameState(newState, historyMessage);
    });
}

// --- UI / Example Functions ---

window.activeTab = 'habits';

window.setActiveTab = function(tabName) {
    window.activeTab = tabName;
    document.querySelectorAll('[id^="content-"]').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('border-red-500', 'border-purple-500', 'text-white');
        el.classList.add('border-transparent', 'text-gray-400');
    });

    document.getElementById(`content-${tabName}`).classList.remove('hidden');
    const tabBtn = document.getElementById(`tab-${tabName}`);
    tabBtn.classList.remove('border-transparent', 'text-gray-400');
    
    // Highlight based on content type
    if (tabName === 'habits' || tabName === 'punishments') {
        tabBtn.classList.add('border-red-500', 'text-white');
    } else if (tabName === 'rewards') {
        tabBtn.classList.add('border-purple-500', 'text-white');
    }
}

window.toggleHabitForm = function(forceShow = null) {
    const form = document.getElementById('habit-form');
    const isHidden = form.classList.contains('hidden');
    
    if (forceShow === true || (forceShow === null && isHidden)) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}

window.toggleRewardForm = function(forceShow = null) {
    const form = document.getElementById('reward-form');
    const isHidden = form.classList.contains('hidden');
    
    if (forceShow === true || (forceShow === null && isHidden)) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}

window.togglePunishmentForm = function(forceShow = null) {
    const form = document.getElementById('punishment-form');
    const isHidden = form.classList.contains('hidden');
    
    if (forceShow === true || (forceShow === null && isHidden)) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}

/**
 * Fills the Add New Habit form with random example data.
 * @param {('keeper'|'nightingale')} type - The role to assign the example to.
 */
window.fillHabitForm = function(type) {
    if (!window.EXAMPLE_DATABASE) {
        window.alert("Example database not loaded.");
        return;
    }
    const examples = EXAMPLE_DATABASE.habits.filter(h => h.type === type);
    if (examples.length === 0) return;

    const example = examples[Math.floor(Math.random() * examples.length)];
    
    document.getElementById('new-habit-desc').value = example.description;
    document.getElementById('new-habit-points').value = example.points;
    document.getElementById('new-habit-times').value = 1; // Default to 1
    document.getElementById('new-habit-assignee').value = example.type;
    
    // Check if form is hidden, show it
    if (document.getElementById('habit-form').classList.contains('hidden')) { window.toggleHabitForm(true); }
}

/**
 * Fills the Add New Reward form with random example data.
 */
window.fillRewardForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        window.alert("Example database not loaded.");
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
        window.alert("Example database not loaded.");
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

// --- Initialization ---

// Run initialization on load
window.onload = initFirebase;