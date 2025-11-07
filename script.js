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

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
// Path for public/shared data: artifacts/{appId}/public/data/ledger_state/{docId}
const GAME_STATE_DOC_PATH = `artifacts/${appId}/public/data/ledger_state/ledger_data`; 
const GAME_STATE_DOC_ID = 'ledger_data';

let gameState = {
    // Default values for player scores and data collections
    nightingaleScore: 0,
    keeperScore: 0,
    habits: [],
    rewards: [],
    punishments: [],
};

// --- Core Ledger Data Management ---

/**
 * Initializes Firebase, performs authentication, and sets up the data listener.
 */
async function initializeAppAndAuth() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // 1. Initial Authentication
        // Use custom token if provided by the environment, otherwise sign in anonymously
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        // 2. Auth State Change Listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('current-user-id').textContent = userId;
                document.getElementById('current-app-id').textContent = appId; // Display App ID in Settings

                console.log(`User authenticated with ID: ${userId}. App ID: ${appId}`);
                
                // Once authenticated, start listening to the public game state
                setupLedgerListener();
            } else {
                // Should not happen in this environment, but good practice
                userId = null;
                document.getElementById('auth-error-message').textContent = "Authentication failed. Please check setup.";
            }
        });

    } catch (error) {
        console.error("Firebase Initialization or Authentication Error:", error);
        document.getElementById('auth-error-message').textContent = `Connection Error: ${error.message}`;
    }
}

/**
 * Sets up a real-time listener for the shared ledger data.
 */
function setupLedgerListener() {
    const docRef = doc(db, GAME_STATE_DOC_PATH);

    onSnapshot(docRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
            // Data exists, update gameState and render the ledger
            gameState = docSnapshot.data();
            console.log("Ledger state updated:", gameState);
            renderLedger();
            
            // Hide loading screen and show app content
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('app-content').classList.remove('hidden');

        } else {
            // Document does not exist, create the initial document with default state
            console.log("Ledger document does not exist. Creating default state.");
            setDoc(docRef, gameState)
                .then(() => console.log("Default ledger state created successfully."))
                .catch((error) => console.error("Error creating default ledger state:", error));
        }
    }, (error) => {
        console.error("Firestore Listener Error:", error);
        document.getElementById('auth-error-message').textContent = `Data Error: Could not load ledger. ${error.message}`;
    });
}

/**
 * Updates the entire gameState document in Firestore.
 */
async function updateGameState(updates) {
    if (!db) {
        console.error("Database not initialized.");
        return;
    }
    const docRef = doc(db, GAME_STATE_DOC_PATH);
    try {
        await updateDoc(docRef, updates);
    } catch (error) {
        // Attempt to create the document if it doesn't exist (can happen on first update)
        if (error.code === 'not-found') {
             await setDoc(docRef, { ...gameState, ...updates });
        } else {
            console.error("Error updating game state:", error);
        }
    }
}

// --- Rendering Functions (Bringing the "Ledger Code" back) ---

/**
 * Renders the entire ledger based on the current gameState.
 */
function renderLedger() {
    document.getElementById('nightingale-score').textContent = gameState.nightingaleScore || 0;
    document.getElementById('keeper-score').textContent = gameState.keeperScore || 0;
    
    renderHabits();
    renderRewards();
    renderPunishments();
}

/**
 * Renders the Habit list.
 */
function renderHabits() {
    const listEl = document.getElementById('habits-list');
    const habits = gameState.habits || [];
    
    if (habits.length === 0) {
        listEl.innerHTML = '<p class="p-4 text-center text-gray-500">No habits defined yet. Use the "Add New Habit" button above!</p>';
        return;
    }

    listEl.innerHTML = habits.map((habit, index) => {
        const playerClass = habit.type === 'nightingale' ? 'text-nightingale' : 'text-keeper';
        const playerLabel = habit.type === 'nightingale' ? 'Nightingale' : 'Keeper';

        return `
            <div class="list-item">
                <div class="flex-1 min-w-0 pr-4">
                    <p class="text-lg text-gray-200 truncate" title="${habit.description}">${habit.description}</p>
                    <p class="text-xs text-gray-500">
                        <span class="${playerClass} font-bold">${playerLabel}</span> | 
                        <span class="text-sm font-semibold text-white">${habit.points} Points</span>
                    </p>
                </div>
                <div class="flex space-x-2 items-center">
                    <button onclick="window.completeHabit('${index}')" class="btn-primary text-sm bg-green-700 hover:bg-green-600 p-2 leading-none" title="Complete Habit">
                        <i class="fas fa-check"></i>
                    </button>
                    <button onclick="window.deleteHabit('${index}')" class="text-gray-500 hover:text-error text-xl" title="Delete Habit">
                        &times;
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Renders the Reward list.
 */
function renderRewards() {
    const listEl = document.getElementById('rewards-list');
    const rewards = gameState.rewards || [];

    if (rewards.length === 0) {
        listEl.innerHTML = '<p class="p-4 text-center text-gray-500">No rewards defined yet. Time to add some incentives!</p>';
        return;
    }

    listEl.innerHTML = rewards.map((reward, index) => `
        <div class="list-item">
            <div class="flex-1 min-w-0 pr-4">
                <p class="text-lg font-cinzel text-nightingale truncate" title="${reward.title}">${reward.title}</p>
                <p class="text-xs text-gray-500 truncate" title="${reward.description}">${reward.description}</p>
            </div>
            <div class="flex space-x-2 items-center">
                <div class="text-sm font-bold text-nightingale mr-2">${reward.cost} Points</div>
                <button onclick="window.claimReward('${index}', ${reward.cost})" class="btn-primary text-sm bg-nightingale hover:bg-[#c06c7c] p-2 leading-none" title="Claim Reward">
                    <i class="fas fa-hand-holding-usd"></i>
                </button>
                <button onclick="window.deleteReward('${index}')" class="text-gray-500 hover:text-error text-xl" title="Delete Reward">
                    &times;
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * Renders the Punishment list.
 */
function renderPunishments() {
    const listEl = document.getElementById('punishments-list');
    const punishments = gameState.punishments || [];

    if (punishments.length === 0) {
        listEl.innerHTML = '<p class="p-4 text-center text-gray-500">No punishments defined yet. You\'re living on the edge!</p>';
        return;
    }

    listEl.innerHTML = punishments.map((punishment, index) => `
        <div class="list-item">
            <div class="flex-1 min-w-0 pr-4">
                <p class="text-lg font-cinzel text-keeper truncate" title="${punishment.title}">${punishment.title}</p>
                <p class="text-xs text-gray-500 truncate" title="${punishment.description}">${punishment.description}</p>
            </div>
            <div class="flex space-x-2 items-center">
                <!-- No points for punishments, just track and delete -->
                <button onclick="window.deletePunishment('${index}')" class="text-gray-500 hover:text-error text-xl" title="Remove Punishment">
                    &times;
                </button>
            </div>
        </div>
    `).join('');
}

// --- Action Functions ---

/**
 * Toggles the visibility of the Habit creation form.
 */
window.toggleHabitForm = function(show) {
    document.getElementById('habit-form').classList.toggle('hidden', !show);
}

/**
 * Toggles the visibility of the Reward creation form.
 */
window.toggleRewardForm = function(show) {
    document.getElementById('reward-form').classList.toggle('hidden', !show);
}

/**
 * Toggles the visibility of the Punishment creation form.
 */
window.togglePunishmentForm = function(show) {
    document.getElementById('punishment-form').classList.toggle('hidden', !show);
}

/**
 * Toggles the visibility of the Settings Panel (New for Options/Customization).
 */
window.toggleSettingsPanel = function(show) {
    document.getElementById('settings-panel').classList.toggle('hidden', !show);
    // Also toggle the visibility of the main content to keep focus on settings
    const appContent = document.getElementById('app-content');
    const settingsPanel = document.getElementById('settings-panel');
    
    // If showing settings, ensure main content scrolls, if hiding, ensure main content is visible
    if (show) {
        settingsPanel.scrollIntoView({ behavior: 'smooth' });
    }
}


/**
 * Completes a habit, adds points, and deletes the habit from the list.
 */
window.completeHabit = async function(index) {
    const habits = [...gameState.habits];
    const completedHabit = habits.splice(index, 1)[0];
    
    if (!completedHabit) return;

    let updates = { habits: habits };

    // Update the corresponding score
    if (completedHabit.type === 'nightingale') {
        updates.nightingaleScore = (gameState.nightingaleScore || 0) + completedHabit.points;
    } else if (completedHabit.type === 'keeper') {
        updates.keeperScore = (gameState.keeperScore || 0) + completedHabit.points;
    }

    await updateGameState(updates);
}

/**
 * Claims a reward, deducts points.
 */
window.claimReward = async function(index, cost) {
    const currentScore = gameState.nightingaleScore + gameState.keeperScore;
    if (currentScore < cost) {
        console.warn("Insufficient points to claim reward.");
        // Use a simple, non-alert message for the user instead of alert()
        document.getElementById('auth-error-message').textContent = `ERROR: You only have ${currentScore} total points. This reward costs ${cost}.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
        return;
    }
    
    const rewards = [...gameState.rewards];
    const claimedReward = rewards[index];

    // Determine which player gets the points deducted (This logic can be more complex, 
    // but for simplicity, we'll deduct from the Nightingale score until it hits zero, then Keeper)
    let nightingaleDeduction = Math.min(cost, gameState.nightingaleScore);
    let keeperDeduction = cost - nightingaleDeduction;

    let updates = {
        nightingaleScore: gameState.nightingaleScore - nightingaleDeduction,
        keeperScore: gameState.keeperScore - keeperDeduction
    };
    
    // Optionally delete the reward after claiming, or leave it for repeated use
    // rewards.splice(index, 1);
    // updates.rewards = rewards;

    console.log(`Reward claimed: ${claimedReward.title}. Total cost: ${cost}. Deduction: Nightingale -${nightingaleDeduction}, Keeper -${keeperDeduction}`);
    await updateGameState(updates);
}

/**
 * Saves a new habit from the form.
 */
window.saveNewHabit = async function(event) {
    event.preventDefault();
    const newHabit = {
        description: document.getElementById('new-habit-desc').value.trim(),
        points: parseInt(document.getElementById('new-habit-points').value, 10),
        type: document.getElementById('new-habit-type').value,
        id: crypto.randomUUID(),
    };

    if (newHabit.description && newHabit.points > 0) {
        const habits = [...gameState.habits, newHabit];
        await updateGameState({ habits });
        document.getElementById('new-habit-form').reset();
        window.toggleHabitForm(false);
    }
}

/**
 * Saves a new reward from the form.
 */
window.saveNewReward = async function(event) {
    event.preventDefault();
    const newReward = {
        title: document.getElementById('new-reward-title').value.trim(),
        cost: parseInt(document.getElementById('new-reward-cost').value, 10),
        description: document.getElementById('new-reward-desc').value.trim(),
        id: crypto.randomUUID(),
    };

    if (newReward.title && newReward.cost > 0) {
        const rewards = [...gameState.rewards, newReward];
        await updateGameState({ rewards });
        document.getElementById('new-reward-form').reset();
        window.toggleRewardForm(false);
    }
}

/**
 * Saves a new punishment from the form.
 */
window.saveNewPunishment = async function(event) {
    event.preventDefault();
    const newPunishment = {
        title: document.getElementById('new-punishment-title').value.trim(),
        description: document.getElementById('new-punishment-desc').value.trim(),
        id: crypto.randomUUID(),
    };

    if (newPunishment.title && newPunishment.description) {
        const punishments = [...gameState.punishments, newPunishment];
        await updateGameState({ punishments });
        document.getElementById('new-punishment-form').reset();
        window.togglePunishmentForm(false);
    }
}

// --- Deletion Functions (For administrative cleanup) ---

window.deleteHabit = async function(index) {
    if (confirm("Are you sure you want to delete this habit?")) {
        const habits = [...gameState.habits];
        habits.splice(index, 1);
        await updateGameState({ habits });
    }
}

window.deleteReward = async function(index) {
    if (confirm("Are you sure you want to delete this reward?")) {
        const rewards = [...gameState.rewards];
        rewards.splice(index, 1);
        await updateGameState({ rewards });
    }
}

window.deletePunishment = async function(index) {
    if (confirm("Are you sure you want to delete this punishment?")) {
        const punishments = [...gameState.punishments];
        punishments.splice(index, 1);
        await updateGameState({ punishments });
    }
}


// --- Example Fillers ---
// These functions are already in the original script.js snippet, ensuring they remain.

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
    document.getElementById('new-habit-type').value = example.type;
    
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

// --- Initialization ---

// Run initialization on load
window.onload = initializeAppAndAuth;