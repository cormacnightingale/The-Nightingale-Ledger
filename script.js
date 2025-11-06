import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Standard Web Deployment) ---

// Use a static, consistent ID for this application instance across all deployments.
const appId = 'nightingale-ledger-v1';

// We assume firebaseConfig is available globally (loaded via ./firebase_config.js)
// The firebaseConfig object will be accessed directly.

// Initial auth token is null for a standard web deployment.
const initialAuthToken = null; 

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
 * Custom modal implementation for alerts and notices (replaces window.alert).
 * Uses the modal elements defined in index.html.
 */
window.showModal = function(title, message) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent = message;
    
    // Ensure the modal buttons are only 'Close' for a simple alert
    const actionsEl = document.getElementById('modal-actions');
    actionsEl.innerHTML = `
        <button onclick="window.closeModal()" class="btn-secondary rounded-lg font-sans font-semibold">Close</button>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

window.closeModal = function() {
    document.getElementById('custom-modal').classList.add('hidden');
    document.getElementById('custom-modal').classList.remove('flex');
}

/**
 * Custom function to display non-critical auth/connection errors on the loading screen.
 * @param {string} message - The error message to display.
 */
function displayAuthError(message) {
    const errorElement = document.getElementById('auth-error-message');
    if (errorElement) {
        errorElement.textContent = `Error: ${message}`;
        // Ensure the loading screen is visible if an auth error occurs
        document.getElementById('loading-screen').classList.remove('hidden');
        document.getElementById('main-content').classList.add('hidden');
    }
    console.error(`AUTH ERROR: ${message}`);
}


/**
 * Initializes Firebase, authenticates the user, and sets up the listener.
 */
async function initFirebase() {
    document.getElementById('current-app-id').textContent = appId;
    
    // 1. Check for global firebaseConfig (loaded from firebase_config.js)
    if (typeof firebaseConfig === 'undefined' || !firebaseConfig || !firebaseConfig.apiKey) {
        displayAuthError("Firebase config is missing or invalid. Please ensure firebase_config.js is loaded correctly.");
        document.getElementById('current-user-id').textContent = 'CONFIG MISSING';
        return;
    }
    
    try {
        // 2. Initialize Firebase app
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // 3. Standard web deployment: Sign in anonymously
        await signInAnonymously(auth);

        // 4. Set up Auth State Listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                // Use a PUBLIC path suitable for a GitHub Pages shared ledger.
                GAME_STATE_PATH = `artifacts/${appId}/public/data/ledger_state`;
                
                document.getElementById('current-user-id').textContent = userId;
                
                // Transition UI and start data listening
                document.getElementById('loading-screen').classList.add('hidden');
                document.getElementById('main-content').classList.remove('hidden');
                
                setupGameStateListener();
            } else {
                userId = null;
                document.getElementById('current-user-id').textContent = 'NOT AUTHED';
                displayAuthError("User session lost. Attempting re-authentication on refresh.");
            }
        });

    } catch (error) {
        displayAuthError(`Initialization failed: ${error.message}`);
    }
}

/**
 * Sets up the real-time listener for the shared game state.
 */
function setupGameStateListener() {
    if (!db || !GAME_STATE_PATH) return;

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    
    // onSnapshot listener for real-time updates
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            gameState = { 
                ...gameState, 
                ...data,
                // Ensure array fields default correctly if they are empty in DB
                habits: data.habits || [],
                rewards: data.rewards || [],
                punishments: data.punishments || [],
                history: data.history || []
            };
            renderState();
        } else {
            // Document doesn't exist, initialize it
            initializeGameState();
        }
    }, (error) => {
        console.error("Error listening to game state:", error);
        showModal("Database Error", "Failed to load real-time game state. Check console for details.");
    });
}


/**
 * Initializes the document if it doesn't exist.
 */
async function initializeGameState() {
    if (!db || !GAME_STATE_PATH) return;
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    
    try {
        await setDoc(docRef, gameState);
        console.log("Initial game state written successfully.");
    } catch (e) {
        console.error("Error initializing game state:", e);
    }
}

/**
 * Updates the game state in Firestore.
 */
async function updateGameState(updates) {
    if (!db || !GAME_STATE_PATH || !userId) {
        showModal("Error", "System not ready. Please wait for authentication.");
        return;
    }

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    
    try {
        const newState = { ...gameState, ...updates };
        await updateDoc(docRef, newState);
    } catch (e) {
        console.error("Error updating document:", e);
        showModal("Update Failed", `Could not save changes: ${e.message}`);
    }
}

// --- Main Render Logic ---

/**
 * Renders the entire application state based on the local 'gameState'.
 */
function renderState() {
    // 1. Render Scores
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;
    document.getElementById('keeper-name').value = gameState.players.keeper;
    document.getElementById('nightingale-name').value = gameState.players.nightingale;
    
    // 2. Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    const habitsLoading = document.getElementById('habits-loading');
    
    if (gameState.habits.length === 0) {
        if (habitsLoading) habitsLoading.classList.remove('hidden');
    } else {
        if (habitsLoading) habitsLoading.classList.add('hidden');
        gameState.habits.forEach((habit, index) => {
            habitsList.innerHTML += renderHabitCard(habit, index);
        });
    }

    // 3. Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    const rewardsLoading = document.getElementById('rewards-loading');
    
    if (gameState.rewards.length === 0) {
        if (rewardsLoading) rewardsLoading.classList.remove('hidden');
    } else {
        if (rewardsLoading) rewardsLoading.classList.add('hidden');
        gameState.rewards.forEach((reward, index) => {
            rewardsList.innerHTML += renderRewardCard(reward, index);
        });
    }

    // 4. Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    const punishmentsLoading = document.getElementById('punishments-loading');
    
    if (gameState.punishments.length === 0) {
        if (punishmentsLoading) punishmentsLoading.classList.remove('hidden');
    } else {
        if (punishmentsLoading) punishmentsLoading.classList.add('hidden');
        gameState.punishments.forEach((punishment, index) => {
            punishmentsList.innerHTML += renderPunishmentCard(punishment, index);
        });
    }
}

// --- Card Render Templates (Simplified HTML for better maintainability) ---

function renderHabitCard(habit, index) {
    const assigneeName = gameState.players[habit.assignee] || habit.assignee;
    const colorClass = habit.assignee === 'keeper' ? 'text-green-400' : 'text-red-400';
    
    return `
        <div class="card p-3 flex justify-between items-center bg-[#3c3c45]/50">
            <div class="flex-1 mr-4">
                <p class="font-semibold">${habit.description}</p>
                <p class="text-sm text-gray-400 italic">
                    <span class="${colorClass}">${assigneeName}</span> earns ${habit.points} points (Max: ${habit.times}x daily)
                </p>
            </div>
            <div class="flex space-x-2">
                <button onclick="window.completeHabit(${index})" class="text-green-500 hover:text-green-400 font-sans font-semibold text-sm">
                    Done (+${habit.points})
                </button>
                <button onclick="window.removeHabit(${index})" class="text-red-500 hover:text-red-400 font-sans font-semibold text-sm">
                    Remove
                </button>
            </div>
        </div>
    `;
}

function renderRewardCard(reward, index) {
    return `
        <div class="card p-3 bg-[#3c3c45]/50">
            <div class="flex justify-between items-center mb-2">
                <p class="text-xl font-cinzel text-yellow-400">${reward.title}</p>
                <span class="text-2xl font-bold text-yellow-300">${reward.cost}</span>
            </div>
            <p class="text-sm text-gray-400 mb-3">${reward.description}</p>
            <div class="flex justify-end space-x-2">
                <button onclick="window.redeemReward(${index})" class="text-blue-400 hover:text-blue-300 font-sans font-semibold text-sm">
                    Redeem (-${reward.cost})
                </button>
                <button onclick="window.removeReward(${index})" class="text-red-500 hover:text-red-400 font-sans font-semibold text-sm">
                    Remove
                </button>
            </div>
        </div>
    `;
}

function renderPunishmentCard(punishment, index) {
    return `
        <div class="card p-3 bg-[#3c3c45]/50">
            <p class="text-xl font-cinzel text-red-500 mb-1">${punishment.title}</p>
            <p class="text-sm text-gray-400 mb-3">${punishment.description}</p>
            <div class="flex justify-end space-x-2">
                <button onclick="window.removePunishment(${index})" class="text-red-500 hover:text-red-400 font-sans font-semibold text-sm">
                    Remove
                </button>
            </div>
        </div>
    `;
}


// --- Action Handlers (Form Toggles & Data) ---

window.toggleHabitForm = function() {
    document.getElementById('habit-form').classList.toggle('hidden');
};

window.toggleRewardForm = function() {
    document.getElementById('reward-form').classList.toggle('hidden');
};

window.togglePunishmentForm = function() {
    document.getElementById('punishment-form').classList.toggle('hidden');
};

/** Saves the player names from the input fields. */
window.savePlayerNames = function() {
    const keeperName = document.getElementById('keeper-name').value.trim();
    const nightingaleName = document.getElementById('nightingale-name').value.trim();
    
    if (keeperName && nightingaleName) {
        updateGameState({
            players: {
                keeper: keeperName,
                nightingale: nightingaleName
            }
        });
    } else {
        showModal("Input Error", "Please enter names for both Keeper and Nightingale.");
    }
};

/** Adds a new habit to the list. */
window.addHabit = function() {
    const description = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value);
    const times = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;
    
    if (description && !isNaN(points) && points > 0 && !isNaN(times) && times > 0 && assignee) {
        const newHabits = [...gameState.habits, { description, points, times, assignee }];
        updateGameState({ habits: newHabits });
        
        // Clear and hide form
        document.getElementById('new-habit-desc').value = '';
        document.getElementById('new-habit-points').value = 10;
        document.getElementById('new-habit-times').value = 1;
        window.toggleHabitForm();
    } else {
        showModal("Input Error", "Please ensure all habit fields are correctly filled.");
    }
};

/** Marks a habit as complete and updates the score. */
window.completeHabit = function(index) {
    if (index >= 0 && index < gameState.habits.length) {
        const habit = gameState.habits[index];
        const newScore = gameState.scores[habit.assignee] + habit.points;
        
        // Remove the habit after completion for simplicity
        const newHabits = gameState.habits.filter((_, i) => i !== index);
        
        updateGameState({ 
            scores: { ...gameState.scores, [habit.assignee]: newScore },
            habits: newHabits,
        });
    }
};

/** Removes a habit. (No confirm used, just a notice) */
window.removeHabit = function(index) {
    if (index >= 0 && index < gameState.habits.length) {
        const newHabits = gameState.habits.filter((_, i) => i !== index);
        updateGameState({ habits: newHabits });
        showModal("Habit Removed", "The habit was removed from the list.");
    }
};

/** Adds a new reward to the list. */
window.addReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const description = document.getElementById('new-reward-desc').value.trim();
    
    if (title && !isNaN(cost) && cost > 0 && description) {
        const newRewards = [...gameState.rewards, { title, cost, description }];
        updateGameState({ rewards: newRewards });
        
        // Clear and hide form
        document.getElementById('new-reward-title').value = '';
        document.getElementById('new-reward-cost').value = 100;
        document.getElementById('new-reward-desc').value = '';
        window.toggleRewardForm();
    } else {
        showModal("Input Error", "Please ensure all reward fields are correctly filled.");
    }
};

/** Redeems a reward and updates the score. */
window.redeemReward = function(index) {
    if (index >= 0 && index < gameState.rewards.length) {
        const reward = gameState.rewards[index];
        
        // Find the player with the higher score (who gets to redeem)
        const canRedeemRole = gameState.scores.keeper >= gameState.scores.nightingale ? 'keeper' : 'nightingale';
        const canRedeemName = gameState.players[canRedeemRole];

        if (gameState.scores[canRedeemRole] >= reward.cost) {
            
            // Deduct points and remove reward
            const newScore = gameState.scores[canRedeemRole] - reward.cost;
            const newRewards = gameState.rewards.filter((_, i) => i !== index);
            
            updateGameState({
                scores: { ...gameState.scores, [canRedeemRole]: newScore },
                rewards: newRewards
            });
            showModal("Reward Claimed!", `${canRedeemName} has successfully claimed the reward: "${reward.title}".`);
        } else {
            showModal("Not Enough Points", `${canRedeemName} only has ${gameState.scores[canRedeemRole]} points, which is less than the required ${reward.cost}.`);
        }
    }
};

/** Removes a reward. (No confirm used, just a notice) */
window.removeReward = function(index) {
    if (index >= 0 && index < gameState.rewards.length) {
        const newRewards = gameState.rewards.filter((_, i) => i !== index);
        updateGameState({ rewards: newRewards });
        showModal("Reward Removed", "The reward was removed from the list.");
    }
};

/** Adds a new punishment to the list. */
window.addPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const description = document.getElementById('new-punishment-desc').value.trim();
    
    if (title && description) {
        const newPunishments = [...gameState.punishments, { title, description }];
        updateGameState({ punishments: newPunishments });
        
        // Clear and hide form
        document.getElementById('new-punishment-title').value = '';
        document.getElementById('new-punishment-desc').value = '';
        window.togglePunishmentForm();
    } else {
        showModal("Input Error", "Please ensure both punishment title and description are filled.");
    }
};

/** Removes a punishment. (No confirm used, just a notice) */
window.removePunishment = function(index) {
    if (index >= 0 && index < gameState.punishments.length) {
        const newPunishments = gameState.punishments.filter((_, i) => i !== index);
        updateGameState({ punishments: newPunishments });
        showModal("Punishment Removed", "The punishment was removed from the list.");
    }
};

/**
 * Generates an example habit, reward, or punishment into the form fields.
 */
window.generateExample = function(type) {
    // Access the global EXAMPLE_DATABASE provided by the examples.js file
    const exampleDatabase = typeof EXAMPLE_DATABASE !== 'undefined' ? EXAMPLE_DATABASE : null;

    if (!exampleDatabase || !exampleDatabase[type + 's']) {
        showModal("Error", "Example data is not loaded correctly. Please ensure examples.js is loaded.");
        return;
    }
    
    const examples = exampleDatabase[type + 's'];
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

// --- Initialization ---

// Run initialization on load
window.onload = initFirebase;