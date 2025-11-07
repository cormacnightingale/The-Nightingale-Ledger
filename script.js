import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Firebase Configuration (HARDCODED for standard web deployment) ---
const firebaseConfig = {
  // NOTE: If you deploy this, replace this with your actual Firebase config
  apiKey: "AIzaSyAdmOIlbRx6uvgZiNat-BYI5GH-lvkiEqc",
  authDomain: "nightingaleledger-4627.firebaseapp.com",
  projectId: "nightingaleledger-4627",
  storageBucket: "nightingaleledger-4627.firebasestorage.app",
  messagingSenderId: "299188208241",
  appId: "1:299188208241:web:7bb086293357f4ec4691d0",
  measurementId: "G-5WLM6RZQ0Y"
};

// --- App Constants (Static for standard deployment) ---
const appId = 'nightingale-ledger-v1'; 
const GAME_STATE_DOC_ID = 'ledger_data';

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let GAME_STATE_PATH = null; 

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
 * @param {string} title - The title of the modal.
 * @param {string} message - The message content.
 * @param {Function} [onConfirm] - Optional callback for confirmation actions.
 * @param {boolean} [showConfirm=false] - Whether to show the confirmation button.
 */
function showModal(title, message, onConfirm = null, showConfirm = false) {
    const modal = document.getElementById('custom-modal');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    
    document.getElementById('modal-title').textContent = title || "System Notice";
    document.getElementById('modal-message').textContent = message || "An unspecified error occurred.";

    // Always define the close handler first
    cancelBtn.onclick = () => {
        modal.classList.add('hidden');
    };
    
    // Handle confirmation vs. simple close
    if (showConfirm) {
        confirmBtn.classList.remove('hidden');
        cancelBtn.classList.remove('hidden');
        cancelBtn.textContent = 'Cancel';

        confirmBtn.onclick = () => {
            modal.classList.add('hidden');
            if (onConfirm) onConfirm();
        };
    } else {
        // Simple close mode
        confirmBtn.classList.add('hidden');
        cancelBtn.classList.remove('hidden'); 
        cancelBtn.textContent = 'Close';
    }

    modal.classList.remove('hidden');
}

/**
 * Ensures all scores are numbers and updates the display.
 */
function updateScoreDisplay() {
    const keeperScore = gameState.scores.keeper || 0;
    const nightingaleScore = gameState.scores.nightingale || 0;

    document.getElementById('keeper-score').textContent = keeperScore;
    document.getElementById('nightingale-score').textContent = nightingaleScore;
}


/**
 * Toggles the visibility of a form section.
 * @param {string} id - The ID of the form container element.
 */
function toggleForm(id) {
    const form = document.getElementById(id);
    const btn = document.getElementById(`${id.replace('-form', '')}-toggle-btn`);
    const name = id.replace('-form', '').charAt(0).toUpperCase() + id.replace('-form', '').slice(1);
    
    if (form.classList.contains('hidden')) {
        form.classList.remove('hidden');
        btn.textContent = `Hide ${name} Form`;
    } else {
        form.classList.add('hidden');
        btn.textContent = `Add New ${name}`;
    }
}

window.toggleHabitForm = () => toggleForm('habit-form');
window.toggleRewardForm = () => toggleForm('reward-form');
window.togglePunishmentForm = () => toggleForm('punishment-form');

// --- CRUD Functions (Logic remains the same) ---

/**
 * Renders the full list of habits, rewards, and punishments based on the current gameState.
 */
function renderLedger() {
    // Check if the main content is visible, if not, wait for auth to complete
    if (userId === null) return; 

    const habitList = document.getElementById('habits-list');
    const rewardList = document.getElementById('rewards-list');
    const punishmentList = document.getElementById('punishments-list');

    // Helper to clear and render items
    const renderItems = (container, items, type) => {
        container.innerHTML = '';
        if (items.length === 0) {
            container.innerHTML = `<p class="text-center py-4 text-gray-500 italic">No ${type}s defined yet.</p>`;
            return;
        }

        items.forEach((item, index) => {
            let html = '';
            let actionHtml = '';

            if (type === 'habit') {
                const assignedTo = item.type === 'keeper' ? gameState.players.keeper : gameState.players.nightingale;
                const pointsText = item.points * item.times > 1 ? `${item.points} x ${item.times} = ${item.points * item.times} pts` : `${item.points} pts`;
                
                html = `
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 card-content border-l-4 border-l-rose-700">
                        <div>
                            <p class="font-bold text-lg text-[#d4d4dc]">${item.description}</p>
                            <p class="text-sm text-gray-400 italic">Target: ${assignedTo} (${item.type})</p>
                            <p class="text-sm text-green-400">${pointsText}</p>
                        </div>
                `;
                actionHtml = `
                    <div class="flex space-x-2 mt-2 sm:mt-0">
                        <button onclick="window.applyHabit(${index})" class="btn-success text-xs py-1 px-3">Complete</button>
                        <button onclick="window.deleteItem('habits', ${index})" class="text-red-500 hover:text-red-400 text-xs">Delete</button>
                    </div>
                </div>
                `;
            } else if (type === 'reward') {
                html = `
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 card-content border-l-4 border-l-purple-700">
                        <div>
                            <p class="font-bold text-lg text-[#d4d4dc]">${item.title}</p>
                            <p class="text-sm text-gray-400">${item.description}</p>
                            <p class="text-sm text-yellow-400 font-semibold">${item.cost} Points</p>
                        </div>
                `;
                actionHtml = `
                    <div class="flex space-x-2 mt-2 sm:mt-0">
                        <select id="redeem-rewarder-${index}" class="bg-[#1a1a1d] border border-[#3c3c45] text-white text-sm rounded-lg p-1 mr-2">
                            <option value="keeper">${gameState.players.keeper} (Keeper)</option>
                            <option value="nightingale">${gameState.players.nightingale} (Nightingale)</option>
                        </select>
                        <button onclick="window.redeemReward(${index})" class="btn-primary text-xs py-1 px-3">Redeem</button>
                        <button onclick="window.deleteItem('rewards', ${index})" class="text-red-500 hover:text-red-400 text-xs">Delete</button>
                    </div>
                </div>
                `;
            } else if (type === 'punishment') {
                html = `
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 card-content border-l-4 border-l-yellow-700">
                        <div>
                            <p class="font-bold text-lg text-[#d4d4dc]">${item.title}</p>
                            <p class="text-sm text-gray-400">${item.description}</p>
                        </div>
                `;
                actionHtml = `
                    <div class="flex space-x-2 mt-2 sm:mt-0">
                        <select id="assign-punishment-${index}" class="bg-[#1a1a1d] border border-[#3c3c45] text-white text-sm rounded-lg p-1 mr-2">
                            <option value="keeper">${gameState.players.keeper} (Keeper)</option>
                            <option value="nightingale">${gameState.players.nightingale} (Nightingale)</option>
                        </select>
                        <button onclick="window.assignPunishment(${index})" class="btn-secondary text-xs py-1 px-3">Assign</button>
                        <button onclick="window.deleteItem('punishments', ${index})" class="text-red-500 hover:text-red-400 text-xs">Delete</button>
                    </div>
                </div>
                `;
            }

            container.innerHTML += html + actionHtml;
        });
    };

    renderItems(habitList, gameState.habits, 'habit');
    renderItems(rewardList, gameState.rewards, 'reward');
    renderItems(punishmentList, gameState.punishments, 'punishment');
    
    updateScoreDisplay();

    // Render History (simple list for now)
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    gameState.history.slice(-5).reverse().forEach(entry => {
        const entryClass = entry.points > 0 ? 'text-green-400' : (entry.points < 0 ? 'text-red-400' : 'text-gray-400');
        historyList.innerHTML += `<li class="text-sm border-b border-[#3c3c45] last:border-b-0 py-2">
            <span class="font-bold ${entryClass}">${entry.points > 0 ? '+' : ''}${entry.points}</span> 
            points: ${entry.message} 
            <span class="text-xs text-gray-500 float-right">${new Date(entry.timestamp).toLocaleTimeString()}</span>
        </li>`;
    });

    // Update player names in the header and footer
    document.getElementById('keeper-name-display').textContent = gameState.players.keeper;
    document.getElementById('nightingale-name-display').textContent = gameState.players.nightingale;
    document.getElementById('current-user-id').textContent = userId;
    document.getElementById('current-app-id').textContent = appId;
    
    // Hide loading screen and show main content
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
}

/**
 * Pushes the updated gameState object to Firestore.
 * @param {string} actionMessage - A message describing the action for the history log.
 * @param {number} [points=0] - Points gained or lost.
 */
async function updateGameState(actionMessage, points = 0) {
    if (!db || !userId) {
        showModal("Error", "Database connection or user ID is not available.");
        return;
    }
    
    // Add to history
    if (actionMessage) {
        gameState.history.push({
            message: actionMessage,
            points: points,
            timestamp: new Date().toISOString()
        });
        // Keep history size manageable (e.g., max 50 entries)
        if (gameState.history.length > 50) {
            gameState.history = gameState.history.slice(-50);
        }
    }

    try {
        const docRef = doc(db, GAME_STATE_PATH);
        await setDoc(docRef, gameState);
    } catch (error) {
        console.error("Error updating game state:", error);
        showModal("Firestore Error", `Could not save data: ${error.message}`);
    }
}

/**
 * Adds a new habit to the ledger.
 */
window.addHabit = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const times = parseInt(document.getElementById('new-habit-times').value, 10);
    const type = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0 || isNaN(times) || times <= 0) {
        showModal("Input Error", "Please provide a description, positive points, and a positive frequency (times per week).");
        return;
    }

    gameState.habits.push({ desc, points, times, type });
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = 10;
    document.getElementById('new-habit-times').value = 1;

    updateGameState(`Added new habit: ${desc}`);
    window.toggleHabitForm();
};

/**
 * Adds a new reward to the ledger.
 */
window.addReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || isNaN(cost) || cost <= 0 || !desc) {
        showModal("Input Error", "Please provide a title, a description, and a positive point cost for the reward.");
        return;
    }

    gameState.rewards.push({ title, cost, description: desc });
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = 100;
    document.getElementById('new-reward-desc').value = '';

    updateGameState(`Added new reward: ${title}`);
    window.toggleRewardForm();
};

/**
 * Adds a new punishment to the ledger.
 */
window.addPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Input Error", "Please provide a title and a description for the punishment.");
        return;
    }

    gameState.punishments.push({ title, description: desc });
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';

    updateGameState(`Added new punishment: ${title}`);
    window.togglePunishmentForm();
};

/**
 * Deletes an item from a list.
 * @param {string} listName - 'habits', 'rewards', or 'punishments'.
 * @param {number} index - Index of the item to delete.
 */
window.deleteItem = function(listName, index) {
    showModal("Confirm Deletion", `Are you sure you want to delete this ${listName.slice(0, -1)}?`, () => {
        const item = gameState[listName][index];
        const title = item.title || item.description;
        gameState[listName].splice(index, 1);
        updateGameState(`Removed ${listName.slice(0, -1)}: ${title}`);
    }, true);
};

/**
 * Handles habit completion (score gain).
 * @param {number} index - Index of the habit completed.
 */
window.applyHabit = function(index) {
    const habit = gameState.habits[index];
    const points = habit.points * habit.times;
    const playerRole = habit.type;
    const playerName = gameState.players[playerRole];

    gameState.scores[playerRole] = (gameState.scores[playerRole] || 0) + points;
    updateGameState(`${playerName} completed habit: ${habit.description}`, points);
};

/**
 * Handles reward redemption (score loss).
 * @param {number} index - Index of the reward redeemed.
 */
window.redeemReward = function(index) {
    const reward = gameState.rewards[index];
    const playerRole = document.getElementById(`redeem-rewarder-${index}`).value;
    const playerName = gameState.players[playerRole];
    const cost = reward.cost;

    if ((gameState.scores[playerRole] || 0) < cost) {
        showModal("Redemption Failed", `${playerName} does not have enough points (needs ${cost}, has ${gameState.scores[playerRole] || 0}).`);
        return;
    }

    showModal("Confirm Redemption", `Confirm ${playerName} is redeeming "${reward.title}" for ${cost} points?`, () => {
        gameState.scores[playerRole] = gameState.scores[playerRole] - cost;
        updateGameState(`${playerName} redeemed reward: ${reward.title}`, -cost);
    }, true);
};

/**
 * Handles punishment assignment (score loss).
 * @param {number} index - Index of the punishment assigned.
 */
window.assignPunishment = function(index) {
    const punishment = gameState.punishments[index];
    const playerRole = document.getElementById(`assign-punishment-${index}`).value;
    const playerName = gameState.players[playerRole];

    // Punishment does not affect scores directly in this version, it's a task.
    showModal("Assign Punishment", `Confirm assignment of "${punishment.title}" to ${playerName}?`, () => {
        // Log the assignment to history
        updateGameState(`${playerName} was assigned punishment: ${punishment.title}`, 0);
    }, true);
};

/**
 * Allows the user to change the display name for a player role.
 * @param {string} role - 'keeper' or 'nightingale'.
 */
window.changePlayerName = function(role) {
    const currentName = gameState.players[role];
    const newName = prompt(`Enter a new name for the ${role} (Current: ${currentName}):`);
    
    if (newName && newName.trim() !== currentName) {
        gameState.players[role] = newName.trim();
        updateGameState(`Player name for ${role} changed to: ${newName.trim()}`);
    }
}

/**
 * Allows the user to generate an example habit, reward, or punishment into the form fields.
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

// Since native window.alert is forbidden, we map it to our custom modal
window.alert = function(message) {
    showModal("Notice", message);
}


// --- Firebase Initialization & Listening ---

/**
 * Listens for real-time changes to the ledger data.
 */
function listenToGameState() {
    // STANDARD PUBLIC DATA PATH CONSTRUCTION: uses static appId
    // Path: artifacts/{appId}/public/data/ledger_state/ledger_data
    GAME_STATE_PATH = `artifacts/${appId}/public/data/ledger_state/${GAME_STATE_DOC_ID}`;

    // Set up a real-time listener for the shared document
    const docRef = doc(db, GAME_STATE_PATH);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            // Load existing data
            const data = docSnap.data();
            console.log("Loading Game State from Firestore:", data);
            
            // Merge existing data into local state, prioritizing firestore data
            gameState = { ...gameState, ...data };
        } else {
            // Document does not exist, initialize it with current local state (first time setup)
            console.log("No existing document found. Initializing new one.");
            updateGameState("Initial setup of ledger.");
        }
        renderLedger();
    }, (error) => {
        console.error("Firestore Listen Error:", error);
        document.getElementById('auth-error-message').textContent = `Connection Error: ${error.message}`;
        showModal("Connection Error", `Could not connect to the shared ledger. Please check your network. Details: ${error.message}`);
    });

    return unsubscribe; 
}


/**
 * Initializes Firebase, authenticates the user, and starts listening for data.
 */
async function initFirebase() {
    // 1. Check for configuration availability
    if (!firebaseConfig.apiKey) {
        document.getElementById('auth-error-message').textContent = "Fatal Error: Firebase config key is missing.";
        console.error("Fatal Error: Firebase config key is missing.");
        return;
    }

    try {
        // Set Firestore debug logging
        setLogLevel('debug');
        
        // 2. Initialize App and Services
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // 3. Authenticate User (STANDARD ANONYMOUS SIGN-IN)
        const userCredential = await signInAnonymously(auth);
        
        // 4. Set User ID 
        userId = userCredential.user.uid;
        console.log("Authenticated anonymously with User ID:", userId);

        // 5. Start Real-time Data Listener
        listenToGameState();

    } catch (error) {
        console.error("Firebase Initialization Failed:", error);
        // Display detailed error on the loading screen
        document.getElementById('auth-error-message').textContent = `Authentication Error: ${error.message}`;
        // Trigger the modal with a specific message
        showModal("Authentication Failed", `Could not sign in to Firebase. Please check your network and your Firestore Security Rules. Details: ${error.message}`);
    }
}

// Run initialization on load
window.onload = initFirebase;