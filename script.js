import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


// --- Firebase/App State (Global in Module Scope) ---
let app;
let db;
let auth;
let userId = null;
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
    habits: [], // Defined habit structures
    rewards: [], // Defined reward structures
    punishments: [], // Defined punishment structures
    // Log entries for the current week (Habit entries, Reward redemptions, Punishment logs)
    log: [] 
};


// --- UTILITY FUNCTIONS ATTACHED TO WINDOW (FIXES TypeError) ---

/**
 * Custom Modal for alerts (Replaces alert() and confirm())
 * @param {string} title 
 * @param {string} message 
 */
window.showModal = function(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('app-modal').classList.remove('hidden');
}

/**
 * Closes the custom modal.
 */
window.closeModal = function() {
    document.getElementById('app-modal').classList.add('hidden');
}

/**
 * Handles Tab Navigation for the main UI.
 * @param {string} tabName - 'ledger', 'definitions', or 'rewards'
 */
window.showTab = function(tabName) {
    // Hide all sections
    document.querySelectorAll('#tab-content section').forEach(section => {
        section.classList.add('hidden');
    });

    // Deactivate all buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show the selected section and activate the corresponding button
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.getElementById(`tab-${tabName}-btn`).classList.add('active');
}

/**
 * Generates an example habit, reward, or punishment into the form fields.
 */
window.generateExample = function(type) {
    // Access the global EXAMPLE_DATABASE defined in examples.js
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        window.showModal("Error", "Example data is not loaded correctly. Check examples.js.");
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
        window.toggleHabitForm(true); // Ensure visible
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        window.toggleRewardForm(true); // Ensure visible
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        window.togglePunishmentForm(true); // Ensure visible
    }
}

// --- FORM TOGGLE FUNCTIONS ---

window.toggleHabitForm = function(forceShow = false) {
    const form = document.getElementById('new-habit-form');
    if (forceShow || form.classList.contains('hidden')) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}

window.toggleRewardForm = function(forceShow = false) {
    const form = document.getElementById('new-reward-form');
    if (forceShow || form.classList.contains('hidden')) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}

window.togglePunishmentForm = function(forceShow = false) {
    const form = document.getElementById('new-punishment-form');
    if (forceShow || form.classList.contains('hidden')) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}


// --- FIREBASE AND APP CORE LOGIC ---

/**
 * Initializes Firebase and performs authentication.
 */
async function initFirebaseAndApp() {
    // 1. Get Environment Variables (FIXES ReferenceError)
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    // Accessing and parsing the environment config here
    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
    
    document.getElementById('current-app-id').textContent = appId;
    
    // Check for config availability
    if (!firebaseConfig) {
        window.showModal("Configuration Error", "Firebase configuration is missing. Cannot initialize application.");
        console.error("Firebase config is null or undefined.");
        return;
    }

    try {
        // 2. Initialize App and Services
        setLogLevel('Debug');
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // 3. Authentication
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            // Sign in anonymously if no token is provided
            await signInAnonymously(auth);
        }
        
        // 4. Set up Auth State Listener (Critical for user-specific data paths)
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                // Define the specific path for the current user's private data
                // This path uses the user's ID for private storage: /artifacts/{appId}/users/{userId}/ledger_data
                GAME_STATE_PATH = `/artifacts/${appId}/users/${userId}`;
                document.getElementById('current-user-id').textContent = userId;

                // 5. Start Real-time Listener for Game State
                listenForGameState();
            } else {
                // Fallback to anonymous state
                console.log("User signed out or failed to sign in.");
                document.getElementById('current-user-id').textContent = 'Unauthenticated';
                userId = crypto.randomUUID(); 
                GAME_STATE_PATH = `/artifacts/${appId}/users/${userId}`;
                window.showModal("Sign-In Required", "Authentication failed. Data persistence may not work.");
            }
        });

    } catch (error) {
        console.error("Error during Firebase initialization:", error);
        window.showModal("Initialization Failed", `Could not connect to the database. Error: ${error.message}`);
    }
}

/**
 * Sets up the real-time listener for the main ledger data.
 */
function listenForGameState() {
    if (!db || !GAME_STATE_PATH) {
        console.error("Database or Game State Path not ready.");
        return;
    }

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    // Set up the real-time listener
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            // Data received from Firestore
            gameState = docSnap.data();
            console.log("Game state updated:", gameState);
        } else {
            // Document does not exist, initialize a new one with defaults and save it
            console.log("No game state found. Creating default document.");
            saveGameState(); 
        }
        
        // Always render, even if it's the default state
        renderUI();

    }, (error) => {
        console.error("Error listening to game state:", error);
        window.showModal("Database Error", "Failed to load live ledger data. Check console for details.");
    });
}

/**
 * Saves the current gameState object back to Firestore.
 */
async function saveGameState() {
    if (!db || !GAME_STATE_PATH) {
        console.error("Cannot save state: Database or Path not ready.");
        return;
    }
    
    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        // Using setDoc with merge: true for safe updates
        await setDoc(docRef, gameState, { merge: true });
        // console.log("Game state saved successfully.");
    } catch (error) {
        console.error("Error saving game state:", error);
        window.showModal("Save Error", `Failed to save data. Error: ${error.message}`);
    }
}


// --- UI RENDERING ---

function renderUI() {
    // 1. Render Scoreboard
    document.getElementById('keeper-name-display').textContent = gameState.players.keeper;
    document.getElementById('nightingale-name-display').textContent = gameState.players.nightingale;
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;

    // 2. Render Player Name Inputs (Definitions Tab) - Ensure inputs reflect stored state
    document.getElementById('config-keeper-name').value = gameState.players.keeper;
    document.getElementById('config-nightingale-name').value = gameState.players.nightingale;

    // 3. Render Habit Definitions
    renderDefinitions('habits', 'habit-definitions-list');

    // 4. Render Rewards & Punishments Definitions
    renderDefinitions('rewards', 'rewards-list');
    renderDefinitions('punishments', 'punishments-list');
    
    // 5. Render Ledger Entries
    renderLedgerEntries();
}

/**
 * Renders the lists of defined habits, rewards, or punishments.
 * @param {string} type - 'habits', 'rewards', or 'punishments'
 * @param {string} containerId - The ID of the HTML container
 */
function renderDefinitions(type, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = ''; // Clear previous content

    const items = gameState[type] || [];
    
    if (items.length === 0) {
        container.innerHTML = `<p class="text-center py-4 text-gray-500 italic">No ${type} defined yet.</p>`;
        return;
    }

    items.forEach((item, index) => {
        let content;
        if (type === 'habits') {
            const assigneeName = gameState.players[item.assignee] || item.assignee;
            content = `
                <div class="p-3 bg-[#1a1a1d] rounded-lg border border-[#3c3c45] flex justify-between items-start">
                    <div>
                        <p class="font-semibold text-white">${item.description}</p>
                        <p class="text-sm text-[#9a9a9f]">
                            ${item.points} points | ${item.timesPerWeek}x/wk | Assigned to: ${assigneeName}
                        </p>
                    </div>
                    <button onclick="window.deleteDefinition('${type}', ${index})" class="text-red-400 hover:text-red-500 text-sm font-sans font-semibold ml-4">
                        Delete
                    </button>
                </div>
            `;
        } else if (type === 'rewards') {
            content = `
                <div class="p-3 bg-[#1a1a1d] rounded-lg border border-[#3c3c45] space-y-1">
                    <div class="flex justify-between items-center">
                        <p class="font-semibold text-white">${item.title}</p>
                        <span class="text-lg font-cinzel text-[#b05c6c]">${item.cost} Pts</span>
                    </div>
                    <p class="text-sm text-[#9a9a9f]">${item.description}</p>
                    <button onclick="window.deleteDefinition('${type}', ${index})" class="text-red-400 hover:text-red-500 text-xs font-sans font-semibold mt-2">
                        Remove
                    </button>
                </div>
            `;
        } else if (type === 'punishments') {
             content = `
                <div class="p-3 bg-[#1a1a1d] rounded-lg border border-[#3c3c45] space-y-1">
                    <p class="font-semibold text-white">${item.title}</p>
                    <p class="text-sm text-[#9a9a9f]">${item.description}</p>
                    <button onclick="window.deleteDefinition('${type}', ${index})" class="text-red-400 hover:text-red-500 text-xs font-sans font-semibold mt-2">
                        Remove
                    </button>
                </div>
            `;
        }
        container.insertAdjacentHTML('beforeend', content);
    });
}

function renderLedgerEntries() {
    const habitBody = document.getElementById('habit-entries-tbody');
    const rewardBody = document.getElementById('reward-log-tbody');
    const punishmentBody = document.getElementById('punishment-log-tbody');
    
    habitBody.innerHTML = '';
    rewardBody.innerHTML = '';
    punishmentBody.innerHTML = '';
    
    const habitEntries = (gameState.log || []).filter(entry => entry.type === 'habit');
    const rewardLog = (gameState.log || []).filter(entry => entry.type === 'reward');
    const punishmentLog = (gameState.log || []).filter(entry => entry.type === 'punishment');

    // Render Habit Entries
    if (habitEntries.length > 0) {
        habitEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort by newest first
        habitEntries.forEach((entry, index) => {
            const habit = gameState.habits[entry.habitIndex];
            if (!habit) return; // Skip if habit definition is missing
            
            const pointsDisplay = entry.isComplete ? `<span class="text-green-400">+${habit.points}</span>` : `<span class="text-red-400">0</span>`;
            const statusColor = entry.isComplete ? 'text-green-400' : 'text-yellow-400';

            habitBody.insertAdjacentHTML('beforeend', `
                <tr class="hover:bg-[#1a1a1d]">
                    <td>${habit.description}</td>
                    <td>${gameState.players[habit.assignee]}</td>
                    <td class="${statusColor} font-semibold">${entry.isComplete ? 'Completed' : 'Pending'}</td>
                    <td class="text-right">${pointsDisplay}</td>
                </tr>
            `);
        });
    } else {
        habitBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500 italic">No habits recorded this week.</td></tr>`;
    }
    
    // Render Reward Log
    if (rewardLog.length > 0) {
         rewardLog.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        rewardLog.forEach((entry) => {
            const reward = gameState.rewards[entry.rewardIndex];
            if (!reward) return;

            rewardBody.insertAdjacentHTML('beforeend', `
                <tr class="hover:bg-[#1a1a1d]">
                    <td>${reward.title} (${entry.redeemedBy === 'keeper' ? gameState.players.keeper : gameState.players.nightingale})</td>
                    <td class="text-right text-red-400">- ${reward.cost}</td>
                </tr>
            `);
        });
    } else {
        rewardBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-gray-500 italic">No rewards redeemed.</td></tr>`;
    }
    
    // Render Punishment Log
    if (punishmentLog.length > 0) {
         punishmentLog.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        punishmentLog.forEach((entry) => {
            const punishment = gameState.punishments[entry.punishmentIndex];
            if (!punishment) return;

            const statusText = entry.isComplete ? 'Completed' : 'Pending';
            const statusClass = entry.isComplete ? 'text-green-400' : 'text-red-400';

            punishmentBody.insertAdjacentHTML('beforeend', `
                <tr class="hover:bg-[#1a1a1d]">
                    <td>${punishment.title} (Applied to: ${entry.appliedTo === 'keeper' ? gameState.players.keeper : gameState.players.nightingale})</td>
                    <td class="text-right">
                        <span class="${statusClass} font-semibold">${statusText}</span>
                        <button onclick="window.togglePunishmentStatus('${entry.id}')" class="text-sm text-gray-400 hover:text-white ml-2">Toggle</button>
                    </td>
                </tr>
            `);
        });
    } else {
        punishmentBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-gray-500 italic">No punishments logged.</td></tr>`;
    }
}


// --- DATA MODIFICATION FUNCTIONS ---

/**
 * Updates the name of a player and saves the state.
 */
window.updatePlayerName = function(playerKey, newName) {
    // Only save if the name actually changed
    if (gameState.players[playerKey] !== newName.trim()) {
        gameState.players[playerKey] = newName.trim();
        saveGameState();
    }
}

/**
 * Adds a new Habit Definition.
 */
window.addHabitDefinition = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const timesPerWeek = parseInt(document.getElementById('new-habit-times').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value;
    
    if (!desc || isNaN(points) || points <= 0 || isNaN(timesPerWeek) || timesPerWeek <= 0 || !['keeper', 'nightingale'].includes(assignee)) {
        window.showModal("Invalid Input", "Please provide a description, valid points (>=1), and times per week (>=1).");
        return;
    }

    gameState.habits.push({
        id: crypto.randomUUID(),
        description: desc,
        points: points,
        timesPerWeek: timesPerWeek,
        assignee: assignee
    });

    saveGameState();
    window.toggleHabitForm();
    // Clear form fields
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = '10';
    document.getElementById('new-habit-times').value = '1';
}

/**
 * Adds a new Reward Definition.
 */
window.addReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const description = document.getElementById('new-reward-desc').value.trim();
    
    if (!title || isNaN(cost) || cost <= 0 || !description) {
        window.showModal("Invalid Input", "Please provide a title, a valid cost (>=1), and a description for the reward.");
        return;
    }

    gameState.rewards.push({
        id: crypto.randomUUID(),
        title: title,
        cost: cost,
        description: description,
    });

    saveGameState();
    window.toggleRewardForm();
    // Clear form fields
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = '50';
    document.getElementById('new-reward-desc').value = '';
}

/**
 * Adds a new Punishment Definition.
 */
window.addPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const description = document.getElementById('new-punishment-desc').value.trim();
    
    if (!title || !description) {
        window.showModal("Invalid Input", "Please provide a title and a description for the punishment.");
        return;
    }

    gameState.punishments.push({
        id: crypto.randomUUID(),
        title: title,
        description: description,
    });

    saveGameState();
    window.togglePunishmentForm();
    // Clear form fields
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
}

/**
 * Deletes a definition (Habit, Reward, or Punishment) by index.
 */
window.deleteDefinition = function(type, index) {
    if (!['habits', 'rewards', 'punishments'].includes(type) || index < 0 || index >= gameState[type].length) {
        console.error(`Invalid deletion request for type: ${type} at index: ${index}`);
        return;
    }

    // This is a dangerous operation, we'll skip the UI confirmation to avoid using confirm()
    gameState[type].splice(index, 1);
    saveGameState();
}


/**
 * Adds a new Habit Entry Log (e.g., a daily check-in).
 */
window.addHabitEntry = function() {
    if (gameState.habits.length === 0) {
        window.showModal("No Habits Defined", "Please define a habit in the 'Definitions' tab first.");
        return;
    }
    
    // Simple logic: use the first habit and assume completion
    const habitIndex = 0; 
    const habit = gameState.habits[habitIndex];

    if (!habit) {
        window.showModal("Error", "Habit definition is missing.");
        return;
    }

    // Add a new log entry for the completion
    gameState.log.push({
        id: crypto.randomUUID(), // Unique ID for log entry
        type: 'habit',
        timestamp: new Date().toISOString(),
        habitIndex: habitIndex,
        isComplete: true, 
    });
    
    // Update the score
    gameState.scores[habit.assignee] += habit.points;

    saveGameState();
    window.showModal("Habit Logged", `Completed Habit: ${habit.description}. +${habit.points} for ${gameState.players[habit.assignee]}.`);
}


/**
 * Adds a new Reward Redemption or Punishment Application log entry.
 */
window.addLogEntry = function(logType) {
    if (logType === 'reward') {
        if (gameState.rewards.length === 0) {
            window.showModal("No Rewards Defined", "Please define a reward in the 'Rewards' tab first.");
            return;
        }
        
        const rewardIndex = 0; // Use the first reward for simplest demo
        const reward = gameState.rewards[rewardIndex];
        
        // Simple logic: Keeper redeems
        const redeemer = 'keeper'; 
        
        if (gameState.scores[redeemer] < reward.cost) {
            window.showModal("Insufficient Points", `${gameState.players[redeemer]} only has ${gameState.scores[redeemer]} points. The reward costs ${reward.cost}.`);
            return;
        }

        // Subtract cost from score
        gameState.scores[redeemer] -= reward.cost;
        
        // Log the redemption
        gameState.log.push({
            id: crypto.randomUUID(),
            type: 'reward',
            timestamp: new Date().toISOString(),
            rewardIndex: rewardIndex,
            redeemedBy: redeemer,
        });
        
        saveGameState();
        window.showModal("Reward Redeemed!", `${gameState.players[redeemer]} redeemed "${reward.title}" for ${reward.cost} points.`);

    } else if (logType === 'punishment') {
        if (gameState.punishments.length === 0) {
            window.showModal("No Punishments Defined", "Please define a punishment in the 'Rewards' tab first.");
            return;
        }
        
        const punishmentIndex = 0; // Use the first punishment for simplest demo
        const punishment = gameState.punishments[punishmentIndex];
        
        // Simple logic: Punishment applied to the Nightingale
        const appliedTo = 'nightingale'; 

        // Log the punishment application
        gameState.log.push({
            id: crypto.randomUUID(),
            type: 'punishment',
            timestamp: new Date().toISOString(),
            punishmentIndex: punishmentIndex,
            appliedTo: appliedTo,
            isComplete: false,
        });
        
        saveGameState();
        window.showModal("Punishment Applied", `The punishment "${punishment.title}" was applied to ${gameState.players[appliedTo]}.`);
    }
}

/**
 * Toggles the completion status of a punishment log entry.
 */
window.togglePunishmentStatus = function(logEntryId) {
    const entry = (gameState.log || []).find(e => e.id === logEntryId && e.type === 'punishment');
    
    if (entry) {
        entry.isComplete = !entry.isComplete;
        window.showModal("Punishment Status Updated", `Punishment status for "${gameState.punishments[entry.punishmentIndex].title}" set to: ${entry.isComplete ? 'Completed' : 'Pending'}.`);
        saveGameState();
    }
}


// --- START APPLICATION ---

// Initialize the app when the script module loads
initFirebaseAndApp();
// Ensure the ledger tab is shown on load (this is only called once, on script load)
window.showTab('ledger');