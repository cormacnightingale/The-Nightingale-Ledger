import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js"; // Import needed for setLogLevel to avoid a separate file
// setLogLevel('Debug'); // Uncomment this for local debugging

// --- Firebase Configuration (Merged from firebase_config.js for self-contained setup) ---
const firebaseConfig = {
  apiKey: "AIzaSyAdmOIlbRx6uvgZiNat-BYI5GH-lvkiEqc", // Replace with your GitHub Pages public key
  authDomain: "nightingaleledger-4627.firebaseapp.com",
  projectId: "nightingaleledger-4627",
  storageBucket: "nightingaleledger-4627.firebasestorage.app",
  messagingSenderId: "299188208241",
  appId: "1:299188208241:web:7bb086293357f4ec4691d0",
  measurementId: "G-5WLM6RZQ0Y"
};

// --- App Path Configuration for GitHub Pages ---
// We use a fixed, public app ID for the Firestore path when hosted publicly,
// as the Canvas environment variables are not present.
const GITHUB_PAGES_APP_ID = 'nightingale-public-ledger';
const FIREBASE_COLLECTION_ROOT = `artifacts/${GITHUB_PAGES_APP_ID}/public/data`;

// --- Firebase/App State ---
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
    habits: [],
    rewards: [],
    punishments: [],
    ledger: []
};

// --- Utility Functions ---

/**
 * Custom modal replacement for alert/confirm.
 * @param {string} title
 * @param {string} message
 */
function showModal(title, message) {
    // A simple, non-blocking way to show messages for a GitHub Pages app
    console.warn(`[Modal: ${title}] ${message}`);

    const modal = document.getElementById('custom-modal');
    if (!modal) {
        console.error("Modal element not found.");
        return;
    }

    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    modal.classList.remove('hidden');
    // Simple auto-hide after 5 seconds
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 5000);
}

// Function to safely generate a UUID-like string for clients without crypto.randomUUID
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}


// --- Firebase Initialization and Auth for GitHub Pages ---

/**
 * Initializes Firebase and signs in anonymously for a public, shared ledger.
 */
async function initializeAndAuthenticate() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Use setLogLevel('debug') for debugging purposes
        // setLogLevel('debug'); 

        // Sign in anonymously for a simple, publicly accessible ledger
        await signInAnonymously(auth);

        onAuthStateChanged(auth, (user) => {
            if (user) {
                // User is signed in (anonymously or otherwise)
                userId = user.uid;
                
                // Set the path to the single, public game state document
                GAME_STATE_PATH = doc(db, `${FIREBASE_COLLECTION_ROOT}/gamestate`, GAME_STATE_DOC_ID);
                
                // Display debug info
                document.getElementById('current-user-id').textContent = userId;
                document.getElementById('current-app-id').textContent = GITHUB_PAGES_APP_ID;
                
                // Start listening for game state updates
                listenForGameState();
            } else {
                // User is signed out. This shouldn't happen after anonymous sign-in,
                // but good for logging.
                userId = 'Signed Out';
                document.getElementById('current-user-id').textContent = 'N/A';
                document.getElementById('current-app-id').textContent = GITHUB_PAGES_APP_ID;
                showModal("Connection Error", "User could not be authenticated.");
            }
        });
    } catch (error) {
        console.error("Firebase Initialization or Auth Error:", error);
        showModal("Setup Failed", `Could not connect to the ledger: ${error.message}`);
    }
}


/**
 * Sets up a real-time listener for the single game state document.
 */
function listenForGameState() {
    if (!db || !GAME_STATE_PATH) return;

    // Use onSnapshot for real-time updates
    const unsubscribe = onSnapshot(GAME_STATE_PATH, (docSnap) => {
        if (docSnap.exists()) {
            // Document exists, load the state
            const data = docSnap.data();
            // Important: Use deep copy to prevent mutation issues
            gameState = JSON.parse(JSON.stringify(data)); 
            
            // Render the UI based on the new state
            renderUI();
            
            // Remove loading placeholders
            document.getElementById('habits-loading').classList.add('hidden');
            document.getElementById('rewards-loading').classList.add('hidden');
            document.getElementById('punishments-loading').classList.add('hidden');
            document.getElementById('ledger-loading').classList.add('hidden');

            console.log("Game state updated from Firestore.");
        } else {
            // Document does not exist (first time running), create it
            console.log("No game state found. Creating initial state...");
            // Initial save is done below in saveGameState.
            saveGameState();
        }
    }, (error) => {
        console.error("Firestore listen failed:", error);
        showModal("Database Error", "Failed to retrieve real-time ledger data.");
    });

    // In a real app, you might expose 'unsubscribe' to stop listening when the component unmounts.
    // window.unsubscribeListener = unsubscribe;
}

/**
 * Writes the current gameState object to Firestore.
 */
async function saveGameState() {
    if (!GAME_STATE_PATH) {
        console.error("Cannot save: GAME_STATE_PATH is null.");
        return;
    }
    try {
        // Use setDoc to create or overwrite the document
        await setDoc(GAME_STATE_PATH, gameState, { merge: true });
        console.log("Game state saved successfully.");
    } catch (e) {
        console.error("Error saving document: ", e);
        showModal("Save Error", "Failed to save data to the ledger.");
    }
}

// --- Player Management ---

window.setPlayerName = function(playerType) {
    const inputId = `player-${playerType}-name`;
    const newName = document.getElementById(inputId).value.trim();
    
    if (!newName) {
        showModal("Input Required", "Player name cannot be empty.");
        return;
    }

    if (newName.length > 20) {
        showModal("Name Too Long", "Name must be 20 characters or less.");
        return;
    }

    // Update state and save
    gameState.players[playerType] = newName;
    saveGameState();
}


// --- Habit Management ---

window.toggleHabitForm = function() {
    document.getElementById('new-habit-form').classList.toggle('hidden');
}

window.addHabit = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const times = parseInt(document.getElementById('new-habit-times').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value; // 'keeper' or 'nightingale'

    if (!desc || isNaN(points) || points <= 0 || isNaN(times) || times <= 0 || !assignee) {
        showModal("Invalid Input", "Please provide a valid description, positive points, and positive times-per-week.");
        return;
    }

    const newHabit = {
        id: generateId(),
        description: desc,
        points: points,
        target_per_week: times,
        assignee: assignee,
        current_streak: 0,
        last_reset: Date.now(), // Used for tracking weekly resets
    };

    gameState.habits.push(newHabit);
    saveGameState();

    // Clear form
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = 10;
    document.getElementById('new-habit-times').value = 1;
    window.toggleHabitForm();
}

window.removeHabit = function(id) {
    gameState.habits = gameState.habits.filter(h => h.id !== id);
    saveGameState();
}

/**
 * Logs a habit completion and updates scores and ledger.
 * @param {string} habitId
 */
window.logHabitCompletion = async function(habitId) {
    if (!db || !GAME_STATE_PATH) return;

    const habitIndex = gameState.habits.findIndex(h => h.id === habitId);
    if (habitIndex === -1) {
        console.error("Habit not found.");
        return;
    }

    const habit = gameState.habits[habitIndex];
    const earningPlayer = habit.assignee === 'keeper' ? 'nightingale' : 'keeper';
    const pointsEarned = habit.points;

    // Use a transaction for safe score and ledger update
    try {
        await runTransaction(db, async (transaction) => {
            const docSnapshot = await transaction.get(GAME_STATE_PATH);

            if (!docSnapshot.exists()) {
                throw "Document does not exist!";
            }
            
            // Get current data from the transaction
            const currentData = docSnapshot.data();
            const newScores = currentData.scores;
            const newLedger = currentData.ledger || [];
            
            // 1. Update Score
            newScores[earningPlayer] = (newScores[earningPlayer] || 0) + pointsEarned;

            // 2. Add Ledger Entry
            const ledgerEntry = {
                id: generateId(),
                type: 'Earned',
                points: pointsEarned,
                description: `Completed Habit: ${habit.description}`,
                player: earningPlayer,
                timestamp: Date.now()
            };
            newLedger.unshift(ledgerEntry);

            // 3. Update the document within the transaction
            transaction.update(GAME_STATE_PATH, { 
                scores: newScores, 
                ledger: newLedger
            });
            
            // Since habits array is part of the game state, it is updated in the listener.
            // But we can update the streak here if needed, though it's not currently reflected in Firestore.
            // For now, only update scores and ledger via transaction to keep it simple.
        });
        showModal("Success", `${gameState.players[earningPlayer]} earned ${pointsEarned} points!`);
    } catch (e) {
        console.error("Transaction failed: ", e);
        showModal("Update Failed", "Failed to log habit completion.");
    }
}


// --- Reward Management ---

window.toggleRewardForm = function() {
    document.getElementById('new-reward-form').classList.toggle('hidden');
}

window.addReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a valid title, description, and positive cost.");
        return;
    }

    const newReward = {
        id: generateId(),
        title: title,
        cost: cost,
        description: desc
    };

    gameState.rewards.push(newReward);
    saveGameState();

    // Clear form
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = 50;
    document.getElementById('new-reward-desc').value = '';
    window.toggleRewardForm();
}

window.removeReward = function(id) {
    gameState.rewards = gameState.rewards.filter(r => r.id !== id);
    saveGameState();
}

/**
 * Purchases a reward and updates scores and ledger.
 * @param {string} rewardId
 * @param {string} playerType - 'keeper' or 'nightingale'
 */
window.purchaseReward = async function(rewardId, playerType) {
    if (!db || !GAME_STATE_PATH) return;
    
    const reward = gameState.rewards.find(r => r.id === rewardId);
    if (!reward) {
        console.error("Reward not found.");
        return;
    }

    const cost = reward.cost;
    const playerName = gameState.players[playerType];
    
    try {
        await runTransaction(db, async (transaction) => {
            const docSnapshot = await transaction.get(GAME_STATE_PATH);

            if (!docSnapshot.exists()) {
                throw "Document does not exist!";
            }
            
            const currentData = docSnapshot.data();
            const newScores = currentData.scores;
            const newLedger = currentData.ledger || [];

            // 1. Check if player has enough points
            if ((newScores[playerType] || 0) < cost) {
                // Must throw to abort the transaction
                throw new Error("Insufficient Points."); 
            }
            
            // 2. Update Score
            newScores[playerType] = newScores[playerType] - cost;

            // 3. Add Ledger Entry
            const ledgerEntry = {
                id: generateId(),
                type: 'Spent',
                points: cost,
                description: `Purchased Reward: ${reward.title}`,
                player: playerType,
                timestamp: Date.now()
            };
            newLedger.unshift(ledgerEntry);

            // 4. Update the document within the transaction
            transaction.update(GAME_STATE_PATH, { 
                scores: newScores, 
                ledger: newLedger
            });
        });
        showModal("Reward Claimed", `${playerName} claimed "${reward.title}" for ${cost} points!`);
    } catch (e) {
        if (e.message === "Insufficient Points.") {
             showModal("Cannot Purchase", `${playerName} does not have enough points (Cost: ${cost}).`);
        } else {
            console.error("Transaction failed: ", e);
            showModal("Update Failed", "Failed to purchase reward.");
        }
    }
}


// --- Punishment Management ---

window.togglePunishmentForm = function() {
    document.getElementById('new-punishment-form').classList.toggle('hidden');
}

window.addPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Invalid Input", "Please provide a valid title and description.");
        return;
    }

    const newPunishment = {
        id: generateId(),
        title: title,
        description: desc
    };

    gameState.punishments.push(newPunishment);
    saveGameState();

    // Clear form
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    window.togglePunishmentForm();
}

window.removePunishment = function(id) {
    gameState.punishments = gameState.punishments.filter(p => p.id !== id);
    saveGameState();
}

/**
 * Assigns a punishment to a player and adds a ledger entry.
 * NOTE: Punishments do not currently affect the score, they are tracked via the ledger.
 * @param {string} punishmentId
 * @param {string} playerType - 'keeper' or 'nightingale'
 */
window.assignPunishment = async function(punishmentId, playerType) {
    if (!db || !GAME_STATE_PATH) return;

    const punishment = gameState.punishments.find(p => p.id === punishmentId);
    if (!punishment) {
        console.error("Punishment not found.");
        return;
    }
    
    const playerName = gameState.players[playerType];
    
    try {
        await runTransaction(db, async (transaction) => {
            const docSnapshot = await transaction.get(GAME_STATE_PATH);

            if (!docSnapshot.exists()) {
                throw "Document does not exist!";
            }
            
            const currentData = docSnapshot.data();
            const newLedger = currentData.ledger || [];

            // 1. Add Ledger Entry
            const ledgerEntry = {
                id: generateId(),
                type: 'Punishment',
                points: 0, // Punishments are status entries, not score changes
                description: `Assigned Punishment: ${punishment.title}`,
                player: playerType,
                timestamp: Date.now()
            };
            newLedger.unshift(ledgerEntry);

            // 2. Update the document within the transaction
            transaction.update(GAME_STATE_PATH, { 
                ledger: newLedger
            });
        });
        showModal("Punishment Assigned", `Punishment "${punishment.title}" was assigned to ${playerName}.`);
    } catch (e) {
        console.error("Transaction failed: ", e);
        showModal("Update Failed", "Failed to assign punishment.");
    }
}


// --- UI Rendering ---

function renderHabits() {
    const container = document.getElementById('habits-list');
    container.innerHTML = '';
    
    // Sort habits: keeper's habits first, then nightingale's
    const sortedHabits = [...gameState.habits].sort((a, b) => {
        if (a.assignee === 'keeper' && b.assignee === 'nightingale') return -1;
        if (a.assignee === 'nightingale' && b.assignee === 'keeper') return 1;
        return 0;
    });

    if (sortedHabits.length === 0) {
        container.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No habits defined yet.</p>';
        return;
    }

    sortedHabits.forEach(habit => {
        // Player who *earns* the points when the habit is completed
        const earningPlayer = habit.assignee === 'keeper' ? 'nightingale' : 'keeper';
        
        container.innerHTML += `
            <div class="habit-card">
                <div class="flex-grow">
                    <p class="text-lg font-bold text-white">${habit.description}</p>
                    <p class="text-sm text-gray-400">
                        Target: <span class="text-pink-300 font-semibold">${habit.target_per_week} times/wk</span> | 
                        Points: <span class="text-green-400 font-semibold">+${habit.points} for ${gameState.players[earningPlayer]}</span>
                    </p>
                    <p class="text-xs text-gray-500 italic">
                        Assigned to: ${gameState.players[habit.assignee]}
                    </p>
                </div>
                <div class="flex space-x-2 items-center">
                    <button onclick="window.logHabitCompletion('${habit.id}')" class="btn-success">Log Completion</button>
                    <button onclick="window.removeHabit('${habit.id}')" class="text-gray-500 hover:text-red-500 p-2 transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3m-5 0h14"></path></svg>
                    </button>
                </div>
            </div>
        `;
    });
}

function renderRewards() {
    const container = document.getElementById('rewards-list');
    container.innerHTML = '';

    if (gameState.rewards.length === 0) {
        container.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No rewards defined yet.</p>';
        return;
    }

    gameState.rewards.forEach(reward => {
        // Check if the reward can be afforded by either player
        const keeperAffords = gameState.scores.keeper >= reward.cost;
        const nightingaleAffords = gameState.scores.nightingale >= reward.cost;

        container.innerHTML += `
            <div class="reward-card">
                <div class="flex-grow">
                    <h3 class="text-xl font-bold text-pink-300">${reward.title}</h3>
                    <p class="text-sm text-gray-400 mb-2">${reward.description}</p>
                    <p class="text-lg text-yellow-400 font-extrabold flex items-center">
                        <svg class="w-5 h-5 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm-3.5 9.5a1 1 0 112 0 1 1 0 01-2 0zm7 0a1 1 0 112 0 1 1 0 01-2 0zm-3.5-5a1 1 0 112 0 1 1 0 01-2 0z"></path></svg>
                        ${reward.cost} Points
                    </p>
                </div>
                <div class="flex flex-col space-y-2">
                    <button onclick="window.purchaseReward('${reward.id}', 'keeper')" 
                            class="${keeperAffords ? 'btn-purchase' : 'btn-disabled'}" 
                            ${!keeperAffords ? 'disabled' : ''}>
                        ${gameState.players.keeper} Purchase
                    </button>
                    <button onclick="window.purchaseReward('${reward.id}', 'nightingale')" 
                            class="${nightingaleAffords ? 'btn-purchase' : 'btn-disabled'}" 
                            ${!nightingaleAffords ? 'disabled' : ''}>
                        ${gameState.players.nightingale} Purchase
                    </button>
                    <button onclick="window.removeReward('${reward.id}')" class="text-gray-500 hover:text-red-500 p-1 transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3m-5 0h14"></path></svg>
                    </button>
                </div>
            </div>
        `;
    });
}

function renderPunishments() {
    const container = document.getElementById('punishments-list');
    container.innerHTML = '';

    if (gameState.punishments.length === 0) {
        container.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No punishments defined yet.</p>';
        return;
    }

    gameState.punishments.forEach(punishment => {
        container.innerHTML += `
            <div class="punishment-card">
                <div class="flex-grow">
                    <h3 class="text-xl font-bold text-red-400">${punishment.title}</h3>
                    <p class="text-sm text-gray-400 mb-2">${punishment.description}</p>
                </div>
                <div class="flex flex-col space-y-2">
                    <button onclick="window.assignPunishment('${punishment.id}', 'keeper')" class="btn-punish">
                        Assign to ${gameState.players.keeper}
                    </button>
                    <button onclick="window.assignPunishment('${punishment.id}', 'nightingale')" class="btn-punish">
                        Assign to ${gameState.players.nightingale}
                    </button>
                    <button onclick="window.removePunishment('${punishment.id}')" class="text-gray-500 hover:text-red-500 p-1 transition-colors">
                         <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3m-5 0h14"></path></svg>
                    </button>
                </div>
            </div>
        `;
    });
}

function renderScoreboard() {
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;
    
    // Update player names in the form sections
    document.getElementById('new-habit-assignee-keeper-name').textContent = gameState.players.keeper;
    document.getElementById('new-habit-assignee-nightingale-name').textContent = gameState.players.nightingale;
    
    // Update player names in the settings section
    document.getElementById('player-keeper-name').value = gameState.players.keeper;
    document.getElementById('player-nightingale-name').value = gameState.players.nightingale;
}

function renderLedger() {
    const container = document.getElementById('ledger-body');
    container.innerHTML = '';
    
    if (gameState.ledger.length === 0) {
        container.innerHTML = '<p class="text-center py-4 text-gray-500 italic" id="ledger-loading">No transactions recorded yet.</p>';
        return;
    }
    
    // Show only the last 20 entries for performance/readability
    const recentLedger = gameState.ledger.slice(0, 20);

    recentLedger.forEach(entry => {
        const date = new Date(entry.timestamp).toLocaleString();
        let colorClass = 'text-gray-400';
        let pointText = '';
        
        if (entry.type === 'Earned') {
            colorClass = 'text-green-400';
            pointText = `+${entry.points}`;
        } else if (entry.type === 'Spent') {
            colorClass = 'text-red-400';
            pointText = `-${entry.points}`;
        } else if (entry.type === 'Punishment') {
            colorClass = 'text-yellow-400';
            pointText = `STATUS`;
        }
        
        container.innerHTML += `
            <tr class="border-b border-[#3c3c45] hover:bg-[#1a1a1d] transition-colors">
                <td class="px-6 py-3 font-medium text-white">${gameState.players[entry.player]}</td>
                <td class="px-6 py-3 ${colorClass}">${pointText}</td>
                <td class="px-6 py-3 text-sm text-gray-400">${entry.description}</td>
                <td class="px-6 py-3 text-xs text-gray-500">${date}</td>
            </tr>
        `;
    });
}


function renderUI() {
    renderScoreboard();
    renderHabits();
    renderRewards();
    renderPunishments();
    renderLedger();
}

/**
 * Global function to generate example content, accessible from index.html.
 * This is the only global function that needs to be window-scoped.
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


// --- Kick off the application ---
// Start the Firebase initialization process when the script loads
initializeAndAuthenticate();