import { initializeApp, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment) ---
// Note: EXAMPLE_DATABASE is expected to be loaded via examples.js first.

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// FIX: Check for the Canvas variable, and if it's null (running locally), 
// fall back to the global `firebaseConfig` object loaded from firebase_config.js using the window object.
const canvasConfig = typeof __firebase_config !== 'undefined' && __firebase_config !== null ? JSON.parse(__firebase_config) : null;
const localConfig = typeof window.firebaseConfig !== 'undefined' ? window.firebaseConfig : null;

const firebaseConfig = canvasConfig || localConfig; 

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;


// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let GAME_STATE_PATH = null;
const GAME_STATE_DOC_ID = 'ledger_data';
let gameState = {
    players: {
        keeper: 'The Keeper',
        nightingale: 'The Nightingale'
    },
    scores: {
        keeper: 0,
        nightingale: 0
    },
    habits: [],
    rewards: [],
    punishments: [],
    habit_log: [],
    reward_log: [],
    punishment_log: []
};

// --- Utility Functions ---

/**
 * Custom modal function to replace alert() and confirm()
 * @param {string} title
 * @param {string} message
 */
function showModal(title, message) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    document.getElementById('app-modal').classList.remove('hidden');
}

/**
 * Closes the custom modal.
 */
window.closeModal = function() {
    document.getElementById('app-modal').classList.add('hidden');
};

/**
 * Switches the active tab content and button styling.
 * @param {string} tabId - 'ledger', 'definitions', or 'rewards'
 */
window.showTab = function(tabId) {
    document.querySelectorAll('#tab-content section').forEach(section => {
        section.classList.add('hidden');
    });
    document.getElementById(`tab-${tabId}`).classList.remove('hidden');

    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    document.getElementById(`tab-${tabId}-btn`).classList.add('active');
};


// --- FIREBASE AND DATA MANAGEMENT ---

/**
 * Initializes Firebase, authenticates the user, and sets up the listener.
 */
async function initFirebaseAndApp() {
    // FIX: setLogLevel must be imported from firebase-app.js (already done in imports)
    setLogLevel('debug'); 

    if (!firebaseConfig) {
        showModal("Configuration Error", "Firebase configuration is missing. The app cannot initialize storage. Please ensure the environment variables are set or firebase_config.js is correctly loaded.");
        console.error("Firebase config is null or undefined.");
        return;
    }

    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Set persistence to local so the session persists across tabs/reloads
        await setPersistence(auth, browserLocalPersistence);

        // 1. Sign In
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            // Fallback for local testing or anonymous use
            await signInAnonymously(auth);
        }

        // 2. Auth State Change Listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                // Path for the shared game state: /artifacts/{appId}/public/data/nightingale_ledger/{docId}
                GAME_STATE_PATH = `artifacts/${appId}/public/data/nightingale_ledger/${GAME_STATE_DOC_ID}`;

                document.getElementById('current-user-id').innerText = userId;
                document.getElementById('current-app-id').innerText = appId;
                
                // 3. Set up Realtime Listener for Game State
                setupGameSnapshotListener();
            } else {
                console.log("No user signed in.");
                // Fallback for non-authenticated state if needed
            }
        });

    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        showModal("Connection Error", "Failed to connect to the ledger system. Check console for details.");
    }
}

/**
 * Sets up the onSnapshot listener for the main game state document.
 */
function setupGameSnapshotListener() {
    // Ensure db is initialized before trying to use it
    if (!db) {
        console.error("Firestore database instance is not initialized.");
        return;
    }
    
    const docRef = doc(db, GAME_STATE_PATH);

    onSnapshot(docRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            console.log("Realtime update received. Data:", data);

            // Merge data while ensuring structure integrity
            gameState = {
                ...gameState,
                ...data
            };
            // Ensure sub-arrays exist if they were empty in Firestore
            gameState.habits = gameState.habits || [];
            gameState.rewards = gameState.rewards || [];
            gameState.punishments = gameState.punishments || [];
            gameState.habit_log = gameState.habit_log || [];
            gameState.reward_log = gameState.reward_log || [];
            gameState.punishment_log = gameState.punishment_log || [];

            renderApp();
        } else {
            console.log("Game state document does not exist, creating initial state.");
            // Document doesn't exist, create it with initial data
            saveGameState(true); 
            renderApp();
        }
    }, (error) => {
        console.error("Error listening to document:", error);
        showModal("Data Error", "Failed to load real-time data from the ledger.");
    });
}

/**
 * Saves the current gameState object to Firestore.
 * @param {boolean} isInitial - If true, uses setDoc to create/overwrite; otherwise uses updateDoc.
 */
async function saveGameState(isInitial = false) {
    if (!db || !GAME_STATE_PATH) return;

    const docRef = doc(db, GAME_STATE_PATH);

    try {
        if (isInitial) {
            await setDoc(docRef, gameState);
            console.log("Initial state created successfully.");
        } else {
            await updateDoc(docRef, gameState);
            // console.log("Game state updated successfully."); // Too verbose for every change
        }
    } catch (error) {
        console.error("Error saving game state:", error);
        showModal("Save Error", "Failed to save data to the ledger. Check connection.");
    }
}

// --- RENDERING FUNCTIONS ---

/**
 * Main render function called after every state update.
 */
function renderApp() {
    // 1. Update Scores
    document.getElementById('keeper-score').innerText = gameState.scores.keeper;
    document.getElementById('nightingale-score').innerText = gameState.scores.nightingale;

    // 2. Update Player Names (Scoreboard and Config)
    document.getElementById('keeper-name-display').innerText = gameState.players.keeper;
    document.getElementById('nightingale-name-display').innerText = gameState.players.nightingale;
    document.getElementById('config-keeper-name').value = gameState.players.keeper;
    document.getElementById('config-nightingale-name').value = gameState.players.nightingale;

    // 3. Render Definitions Tabs
    renderHabitDefinitions();
    renderRewardDefinitions();
    renderPunishmentDefinitions();
    
    // 4. Render Ledger Logs
    renderHabitLog();
    renderRewardLog();
    renderPunishmentLog();
}

/**
 * Renders the Habit Definitions list on the 'Definitions' tab.
 */
function renderHabitDefinitions() {
    const listEl = document.getElementById('habit-definitions-list');
    listEl.innerHTML = ''; // Clear existing list

    if (gameState.habits.length === 0) {
        listEl.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No habits defined yet.</p>';
        return;
    }

    gameState.habits.forEach((habit, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'flex justify-between items-center p-4 bg-[#1a1a1d] border border-[#3c3c45] rounded-lg';
        
        itemEl.innerHTML = `
            <div>
                <p class="font-semibold text-white">${habit.description}</p>
                <p class="text-xs text-gray-400">
                    <span class="text-[#b05c6c] capitalize">${habit.assignee}</span> | 
                    ${habit.points} Points | 
                    ${habit.times_per_week} time${habit.times_per_week > 1 ? 's' : ''}/week
                </p>
            </div>
            <button onclick="window.removeDefinition('habit', ${index})" class="text-xs text-red-400 hover:text-red-500 ml-4">
                Remove
            </button>
        `;
        listEl.appendChild(itemEl);
    });
}

/**
 * Renders the Reward Definitions list on the 'Rewards' tab.
 */
function renderRewardDefinitions() {
    const listEl = document.getElementById('rewards-list');
    listEl.innerHTML = '';

    if (gameState.rewards.length === 0) {
        listEl.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No rewards defined yet.</p>';
        return;
    }

    gameState.rewards.forEach((reward, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'p-4 bg-[#1a1a1d] border border-[#3c3c45] rounded-lg';
        
        itemEl.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <p class="font-semibold text-white text-lg">${reward.title}</p>
                    <p class="text-sm text-gray-400 mt-1 mb-2">${reward.description}</p>
                </div>
                <div class="flex flex-col items-end ml-4">
                    <p class="font-bold text-lg text-[#b05c6c]">${reward.cost}</p>
                    <p class="text-xs text-gray-500 uppercase -mt-1">Points</p>
                    <button onclick="window.removeDefinition('reward', ${index})" class="text-xs text-red-400 hover:text-red-500 mt-2">
                        Remove
                    </button>
                </div>
            </div>
        `;
        listEl.appendChild(itemEl);
    });
}

/**
 * Renders the Punishment Definitions list on the 'Rewards' tab.
 */
function renderPunishmentDefinitions() {
    const listEl = document.getElementById('punishments-list');
    listEl.innerHTML = '';

    if (gameState.punishments.length === 0) {
        listEl.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No punishments defined yet.</p>';
        return;
    }

    gameState.punishments.forEach((punishment, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'p-4 bg-[#1a1a1d] border border-[#3c3c45] rounded-lg';
        
        itemEl.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <p class="font-semibold text-white text-lg">${punishment.title}</p>
                    <p class="text-sm text-gray-400 mt-1 mb-2">${punishment.description}</p>
                </div>
                <button onclick="window.removeDefinition('punishment', ${index})" class="text-xs text-red-400 hover:text-red-500 mt-2 ml-4">
                    Remove
                </button>
            </div>
        `;
        listEl.appendChild(itemEl);
    });
}

// --- LOG RENDERING ---

/**
 * Renders the Habit Log on the 'Current Ledger' tab.
 */
function renderHabitLog() {
    const tbody = document.getElementById('habit-entries-tbody');
    tbody.innerHTML = '';
    
    if (gameState.habit_log.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-3 text-gray-500 italic">No habit entries logged.</td></tr>`;
        return;
    }

    // Sort by timestamp descending
    const sortedLog = [...gameState.habit_log].sort((a, b) => b.timestamp - a.timestamp);

    sortedLog.slice(0, 10).forEach(entry => { // Show last 10 entries
        const player = gameState.players[entry.assignee] || 'Unknown';
        // Check if timestamp is a valid number before calling toLocaleDateString()
        const date = new Date(entry.timestamp).getTime() > 0 ? new Date(entry.timestamp).toLocaleDateString() : 'N/A';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${entry.habit_description}</td>
            <td class="capitalize">${player}</td>
            <td class="text-green-400 font-semibold">${date}</td>
            <td class="text-right text-green-400">+${entry.points}</td>
        `;
        tbody.appendChild(row);
    });
}

/**
 * Renders the Reward Log on the 'Current Ledger' tab.
 */
function renderRewardLog() {
    const tbody = document.getElementById('reward-log-tbody');
    tbody.innerHTML = '';

    if (gameState.reward_log.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" class="text-center py-3 text-gray-500 italic">No rewards redeemed.</td></tr>`;
        return;
    }
    
    const sortedLog = [...gameState.reward_log].sort((a, b) => b.timestamp - a.timestamp);

    sortedLog.slice(0, 5).forEach(entry => { // Show last 5 entries
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${entry.reward_title}</td>
            <td class="text-right text-red-400">- ${entry.cost}</td>
        `;
        tbody.appendChild(row);
    });
}

/**
 * Renders the Punishment Log on the 'Current Ledger' tab.
 */
function renderPunishmentLog() {
    const tbody = document.getElementById('punishment-log-tbody');
    tbody.innerHTML = '';

    if (gameState.punishment_log.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" class="text-center py-3 text-gray-500 italic">No punishments applied.</td></tr>`;
        return;
    }
    
    const sortedLog = [...gameState.punishment_log].sort((a, b) => b.timestamp - a.timestamp);
    
    sortedLog.slice(0, 5).forEach(entry => { // Show last 5 entries
        const statusClass = entry.status === 'Completed' ? 'text-green-400' : 'text-yellow-400';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${entry.punishment_title}</td>
            <td class="text-right ${statusClass} font-semibold">${entry.status}</td>
        `;
        tbody.appendChild(row);
    });
}

// --- ACTION HANDLERS (Mutators) ---

/**
 * Updates the name of a player and saves the state.
 * @param {string} playerKey - 'keeper' or 'nightingale'
 * @param {string} newName 
 */
window.updatePlayerName = function(playerKey, newName) {
    if (newName && newName.trim() !== gameState.players[playerKey]) {
        gameState.players[playerKey] = newName.trim();
        saveGameState();
    }
};

// --- Habit Definition Management ---

window.toggleHabitForm = function() {
    document.getElementById('new-habit-form').classList.toggle('hidden');
}

window.addHabitDefinition = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value);
    const times = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || points <= 0 || times <= 0) {
        showModal("Invalid Input", "Please provide a description, positive points, and positive times per week.");
        return;
    }

    gameState.habits.push({
        id: crypto.randomUUID(),
        description: desc,
        points: points,
        times_per_week: times,
        assignee: assignee
    });

    saveGameState();

    // Clear and hide form
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = '10';
    document.getElementById('new-habit-times').value = '1';
    window.toggleHabitForm();
};

// --- Reward Definition Management ---

window.toggleRewardForm = function() {
    document.getElementById('new-reward-form').classList.toggle('hidden');
}

window.addReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || cost <= 0 || !desc) {
        showModal("Invalid Input", "Please provide a title, a positive cost, and a description.");
        return;
    }

    gameState.rewards.push({
        id: crypto.randomUUID(),
        title: title,
        cost: cost,
        description: desc
    });

    saveGameState();

    // Clear and hide form
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = '50';
    document.getElementById('new-reward-desc').value = '';
    window.toggleRewardForm();
};

// --- Punishment Definition Management ---

window.togglePunishmentForm = function() {
    document.getElementById('new-punishment-form').classList.toggle('hidden');
}

window.addPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Invalid Input", "Please provide a title and a description for the punishment.");
        return;
    }

    gameState.punishments.push({
        id: crypto.randomUUID(),
        title: title,
        description: desc
    });

    saveGameState();
    
    // Clear and hide form
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    window.togglePunishmentForm();
};

/**
 * Removes a definition from the corresponding array.
 * @param {string} type - 'habit', 'reward', or 'punishment'
 * @param {number} index - Index in the array to remove.
 */
window.removeDefinition = function(type, index) {
    if (index >= 0 && index < gameState[type + 's'].length) {
        gameState[type + 's'].splice(index, 1);
        saveGameState();
    }
};

// --- Log Entry Management (Example Implementations for UI testing) ---

/**
 * Adds an example habit entry to the log and updates the score.
 */
window.addHabitEntry = function() {
    if (gameState.habits.length === 0) {
        showModal("No Habits Defined", "Please define a habit first on the 'Definitions' tab.");
        return;
    }
    
    // Use the first habit for simplicity
    const habit = gameState.habits[0];
    const playerKey = habit.assignee;
    
    // 1. Update Log
    gameState.habit_log.push({
        id: crypto.randomUUID(),
        habit_description: habit.description,
        points: habit.points,
        assignee: playerKey,
        timestamp: Date.now()
    });

    // 2. Update Score
    gameState.scores[playerKey] += habit.points;

    showModal("Habit Logged", `${gameState.players[playerKey]} gained ${habit.points} points for: ${habit.description}`);
    saveGameState();
};

/**
 * Adds an example log entry (Reward or Punishment) for UI testing.
 * @param {string} type - 'reward' or 'punishment'
 */
window.addLogEntry = function(type) {
    if (type === 'reward') {
        if (gameState.rewards.length === 0) {
            showModal("No Rewards Defined", "Please define a reward first on the 'Rewards' tab.");
            return;
        }
        const reward = gameState.rewards[0];
        
        // Check if current score can afford the reward (always check keeper score for simplicity)
        // Check the score of the other player ('nightingale') to afford the reward.
        // Assuming rewards are primarily for 'keeper' to be redeemed against points earned by 'nightingale', 
        // or vice versa. For simplicity, let's have the "Keeper" redeem it, using the Keeper's score.
        // In a real app, you'd need a UI to select who is redeeming. Sticking with keeper for now.
        if (gameState.scores.keeper < reward.cost) {
            showModal("Insufficient Points", `${gameState.players.keeper} needs ${reward.cost} points to redeem "${reward.title}", but only has ${gameState.scores.keeper}.`);
            return;
        }

        // 1. Update Log
        gameState.reward_log.push({
            id: crypto.randomUUID(),
            reward_title: reward.title,
            cost: reward.cost,
            timestamp: Date.now()
        });

        // 2. Update Score
        gameState.scores.keeper -= reward.cost;

        showModal("Reward Redeemed", `${gameState.players.keeper} redeemed "${reward.title}" for ${reward.cost} points.`);
    
    } else if (type === 'punishment') {
        if (gameState.punishments.length === 0) {
            showModal("No Punishments Defined", "Please define a punishment first on the 'Rewards' tab.");
            return;
        }
        const punishment = gameState.punishments[0];
        
        // 1. Update Log
        gameState.punishment_log.push({
            id: crypto.randomUUID(),
            punishment_title: punishment.title,
            status: 'Pending', // Punishments usually start as pending
            timestamp: Date.now()
        });

        showModal("Punishment Applied", `"${punishment.title}" has been applied to ${gameState.players.nightingale}.`);

    }
    
    saveGameState();
};


/**
 * Populates form fields with a random example habit, reward, or punishment into the form fields.
 */
window.generateExample = function(type) {
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        showModal("Error", "Example data is not loaded correctly.");
        return;
    }
    
    const examples = EXAMPLE_DATABASE[type + 's'];
    const randomIndex = Math.floor(Math.random() * examples.length);
    const example = examples[randomIndex];

    if (type === 'habit') {
        document.getElementById('new-habit-desc').value = example.description;
        document.getElementById('new-habit-points').value = example.points;
        document.getElementById('new-habit-times').value = 1; // Default to 1
        document.getElementById('new-habit-assignee').value = example.type;
        window.toggleHabitForm(); // Ensure visible
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        window.toggleRewardForm(); // Ensure visible
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        window.togglePunishmentForm(); // Ensure visible
    }
}

// --- INITIALIZATION ---
window.onload = function() {
    initFirebaseAndApp();
    renderApp(); // Initial render with default state while loading
};