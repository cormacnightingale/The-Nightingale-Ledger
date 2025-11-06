import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment) ---
// Note: EXAMPLE_DATABASE is expected to be loaded via examples.js first.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
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
    // Tracking active assignments
    activeHabitIDs: {}, // { habitId: { keeper: assignedTime, nightingale: assignedTime } }
    activePunishmentIDs: {}, // { punishmentId: assignedTime }
    activeRewardIDs: {}, // { rewardId: assignedTime }
};

// --- Modal/UI Handlers ---

/**
 * Creates and shows a custom modal dialog (since alert() is forbidden).
 * @param {string} title The title of the modal.
 * @param {string} message The message body of the modal.
 * @param {function} [onConfirm] Optional function to run if confirmed. If present, shows 'Confirm' button.
 */
window.showModal = function(title, message, onConfirm = null) {
    let modal = document.getElementById('custom-modal');
    if (!modal) {
        // Create modal structure if it doesn't exist
        modal = document.createElement('div');
        modal.id = 'custom-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 transition-opacity duration-300 opacity-0 pointer-events-none';
        modal.innerHTML = `
            <div class="bg-[#242429] card p-6 w-96 max-w-[90%] transform transition-transform duration-300 scale-95 rounded-xl shadow-2xl">
                <h3 class="text-xl font-bold mb-4 text-[#b05c6c]" id="modal-title"></h3>
                <p class="text-gray-300 mb-6" id="modal-message"></p>
                <div class="flex justify-end space-x-3">
                    <button id="modal-cancel-btn" class="btn-secondary">Cancel</button>
                    <button id="modal-confirm-btn" class="btn-primary">Confirm</button>
                    <button id="modal-ok-btn" class="btn-primary">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;

    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const okBtn = document.getElementById('modal-ok-btn');

    if (onConfirm) {
        // Confirmation mode
        okBtn.style.display = 'none';
        confirmBtn.style.display = 'inline-flex';
        cancelBtn.style.display = 'inline-flex';

        confirmBtn.onclick = () => {
            onConfirm();
            window.hideModal();
        };
        cancelBtn.onclick = window.hideModal;
    } else {
        // Simple alert mode
        okBtn.style.display = 'inline-flex';
        confirmBtn.style.display = 'none';
        cancelBtn.style.display = 'none';

        okBtn.onclick = window.hideModal;
    }

    // Show modal
    setTimeout(() => {
        modal.classList.remove('opacity-0', 'pointer-events-none');
        modal.querySelector('.card').classList.remove('scale-95');
    }, 10); // Small delay for transition
};

window.hideModal = function() {
    const modal = document.getElementById('custom-modal');
    if (modal) {
        modal.classList.add('opacity-0', 'pointer-events-none');
        modal.querySelector('.card').classList.add('scale-95');
    }
};

// --- Firebase Initialization and Auth ---

async function initializeFirebase() {
    if (!firebaseConfig) {
        console.error("Firebase configuration is missing.");
        document.getElementById('loading-state').textContent = 'Error: Firebase configuration missing.';
        return;
    }

    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        // Enable Firestore Debug Logging
        setLogLevel('debug'); 
        auth = getAuth(app);

        // Handle initial authentication
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            // Sign in anonymously if no token is provided
            await signInAnonymously(auth);
        }

        // Wait for auth state to be confirmed
        await new Promise(resolve => {
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                if (user) {
                    userId = user.uid;
                    // Public path for collaborative games
                    GAME_STATE_PATH = `artifacts/${appId}/public/data/${GAME_STATE_DOC_ID}`;
                    console.log(`Authenticated. User ID: ${userId}, Data Path: ${GAME_STATE_PATH}`);
                    resolve();
                } else {
                    // This should not happen in this environment, but handle it.
                    console.warn("User not authenticated.");
                    resolve();
                }
                unsubscribe();
            });
        });

        // Start listening to the game state
        await subscribeToGameState();

    } catch (error) {
        console.error("Firebase initialization or authentication failed:", error);
        document.getElementById('loading-state').textContent = `Error: Initialization failed. ${error.message}`;
    }
}

// --- Firestore Subscriptions ---

/**
 * Subscribes to the single game state document for real-time updates.
 */
async function subscribeToGameState() {
    if (!db || !GAME_STATE_PATH) {
        console.warn("Database or path not ready for subscription.");
        return;
    }

    const docRef = doc(db, GAME_STATE_PATH);

    // Initial check: if the document doesn't exist, create it with initial state.
    try {
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            console.log("Game state document not found. Creating initial state...");
            await setDoc(docRef, gameState);
        }
    } catch (e) {
        console.error("Error checking or creating initial document:", e);
        showModal("Database Error", "Could not verify or create the initial game state document.");
        document.getElementById('loading-state').textContent = 'Error: Database connection issue.';
        return;
    }


    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            // Deep merge data to ensure all keys are present, especially if a new key is added later
            gameState = {
                ...gameState,
                ...data,
                players: { ...gameState.players, ...(data.players || {}) },
                scores: { ...gameState.scores, ...(data.scores || {}) },
            };
            
            // Render UI with the new state
            renderUI();
            
            document.getElementById('loading-state').style.display = 'none';
        } else {
            console.warn("No game state document found. This should have been created.");
            document.getElementById('loading-state').textContent = 'Error: Game state is missing.';
        }
    }, (error) => {
        console.error("Error listening to game state:", error);
        document.getElementById('loading-state').textContent = 'Error: Real-time update failed.';
    });
}

/**
 * Helper to update the game state in Firestore.
 * @param {Object} updates The fields to update in the document.
 */
async function updateGameState(updates) {
    if (!db || !GAME_STATE_PATH || !userId) {
        console.error("Cannot update state: DB/Path/User not ready.");
        return;
    }
    const docRef = doc(db, GAME_STATE_PATH);
    try {
        await updateDoc(docRef, updates);
    } catch (error) {
        console.error("Error updating game state:", error);
        showModal("Update Failed", `Could not save changes to the ledger. Error: ${error.message}`);
    }
}

// --- UI Rendering ---

function renderUI() {
    if (!gameState) return;

    // 1. Render App/User IDs
    document.getElementById('current-user-id').textContent = userId || 'N/A';
    document.getElementById('current-app-id').textContent = appId || 'N/A';

    // 2. Render Player Scores and Names
    document.getElementById('keeper-name').textContent = gameState.players.keeper;
    document.getElementById('nightingale-name').textContent = gameState.players.nightingale;
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;
    
    // Set the input names to the current state names for editing
    document.getElementById('keeper-name-input').value = gameState.players.keeper;
    document.getElementById('nightingale-name-input').value = gameState.players.nightingale;

    // 3. Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    if (gameState.habits.length === 0) {
        document.getElementById('habits-loading').style.display = 'block';
    } else {
        document.getElementById('habits-loading').style.display = 'none';
        gameState.habits.forEach(habit => {
            habitsList.appendChild(createHabitCard(habit));
        });
    }

    // 4. Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    if (gameState.rewards.length === 0) {
        document.getElementById('rewards-loading').style.display = 'block';
    } else {
        document.getElementById('rewards-loading').style.display = 'none';
        gameState.rewards.forEach(reward => {
            rewardsList.appendChild(createRewardCard(reward));
        });
    }

    // 5. Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    if (gameState.punishments.length === 0) {
        document.getElementById('punishments-loading').style.display = 'block';
    } else {
        document.getElementById('punishments-loading').style.display = 'none';
        gameState.punishments.forEach(punishment => {
            punishmentsList.appendChild(createPunishmentCard(punishment));
        });
    }
}

/**
 * Creates the HTML card for a single habit.
 * @param {object} habit The habit object.
 * @returns {HTMLElement} The card element.
 */
function createHabitCard(habit) {
    const isKeeperHabit = habit.assignee === 'keeper';
    const activeData = gameState.activeHabitIDs[habit.id] || {};
    const assignedTime = activeData[habit.assignee];
    const isActive = !!assignedTime;
    
    // Determine the color theme based on the assignee
    const colorClass = isKeeperHabit ? 'border-red-600' : 'border-blue-600';
    const textClass = isKeeperHabit ? 'text-red-400' : 'text-blue-400';
    const title = isKeeperHabit ? 'The Keeper\'s Habit' : 'The Nightingale\'s Habit';
    const assigneeName = isKeeperHabit ? gameState.players.keeper : gameState.players.nightingale;
    const oppositeRole = isKeeperHabit ? 'nightingale' : 'keeper';
    const oppositeName = isKeeperHabit ? gameState.players.nightingale : gameState.players.keeper;
    
    // Check if the current user is the "Opposite Role" (the one who assigns/tracks it)
    // NOTE: This logic assumes both partners use the same account to track/manage.
    // For simplicity, we allow both users to interact with all controls.

    const card = document.createElement('div');
    card.className = `p-4 card border-l-4 ${colorClass} transition duration-300 hover:shadow-lg`;
    card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <h4 class="text-lg font-bold ${textClass}">${title}</h4>
            <span class="text-sm font-semibold text-white bg-gray-700 px-3 py-1 rounded-full">${habit.points} Points</span>
        </div>
        <p class="text-sm text-gray-400 mb-2">Assigned to: <span class="font-semibold text-white">${assigneeName}</span></p>
        <p class="text-gray-300 mb-4">${habit.description} (${habit.targetTimes} times per day)</p>
        
        <div class="flex items-center space-x-3 text-sm">
            <button onclick="window.toggleHabitActive('${habit.id}', '${habit.assignee}')" class="flex-1 px-3 py-2 text-center rounded-lg font-semibold transition-colors duration-200 
                ${isActive ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}">
                ${isActive ? 'Mark Inactive' : 'Assign Today'}
            </button>
            
            <button onclick="window.showHabitCompletionModal('${habit.id}', '${oppositeRole}', '${oppositeName}')" 
                    class="flex-1 px-3 py-2 text-center rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">
                Mark Completed
            </button>
            
            <button onclick="window.removeHabit('${habit.id}')" class="text-red-500 hover:text-red-400 p-2 leading-none" title="Remove Habit">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        </div>
        ${isActive ? `<p class="mt-2 text-xs italic text-gray-500">Assigned: ${new Date(assignedTime).toLocaleDateString()} at ${new Date(assignedTime).toLocaleTimeString()}</p>` : ''}
    `;
    return card;
}

/**
 * Creates the HTML card for a single reward.
 * @param {object} reward The reward object.
 * @returns {HTMLElement} The card element.
 */
function createRewardCard(reward) {
    const isActive = !!gameState.activeRewardIDs[reward.id];
    
    const card = document.createElement('div');
    card.className = `p-4 card border-l-4 border-yellow-600 transition duration-300 hover:shadow-lg`;
    card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <h4 class="text-lg font-bold text-yellow-400">${reward.title}</h4>
            <span class="text-sm font-semibold text-black bg-yellow-400 px-3 py-1 rounded-full">${reward.cost} Points</span>
        </div>
        <p class="text-gray-300 mb-4">${reward.description}</p>
        
        <div class="flex items-center space-x-3 text-sm">
            <button onclick="window.redeemReward('${reward.id}', ${reward.cost})" 
                    class="flex-1 px-3 py-2 text-center rounded-lg font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                    id="redeem-btn-${reward.id}">
                Redeem Reward
            </button>
            
            <button onclick="window.toggleRewardActive('${reward.id}')" class="flex-1 px-3 py-2 text-center rounded-lg font-semibold transition-colors duration-200 
                ${isActive ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-600 hover:bg-gray-700 text-white'}">
                ${isActive ? 'Mark Redeemed' : 'Mark Available'}
            </button>
            
            <button onclick="window.removeReward('${reward.id}')" class="text-red-500 hover:text-red-400 p-2 leading-none" title="Remove Reward">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        </div>
        ${isActive ? `<p class="mt-2 text-xs italic text-gray-500">Active Since: ${new Date(gameState.activeRewardIDs[reward.id]).toLocaleDateString()}</p>` : ''}
    `;
    return card;
}

/**
 * Creates the HTML card for a single punishment.
 * @param {object} punishment The punishment object.
 * @returns {HTMLElement} The card element.
 */
function createPunishmentCard(punishment) {
    const isActive = !!gameState.activePunishmentIDs[punishment.id];
    
    const card = document.createElement('div');
    card.className = `p-4 card border-l-4 border-purple-600 transition duration-300 hover:shadow-lg`;
    card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <h4 class="text-lg font-bold text-purple-400">${punishment.title}</h4>
        </div>
        <p class="text-gray-300 mb-4">${punishment.description}</p>
        
        <div class="flex items-center space-x-3 text-sm">
            <button onclick="window.assignPunishment('${punishment.id}')" class="flex-1 px-3 py-2 text-center rounded-lg font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
                Assign Punishment
            </button>
            
            <button onclick="window.togglePunishmentActive('${punishment.id}')" class="flex-1 px-3 py-2 text-center rounded-lg font-semibold transition-colors duration-200 
                ${isActive ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 'bg-gray-600 hover:bg-gray-700 text-white'}">
                ${isActive ? 'Mark Complete' : 'Mark Available'}
            </button>
            
            <button onclick="window.removePunishment('${punishment.id}')" class="text-red-500 hover:text-red-400 p-2 leading-none" title="Remove Punishment">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        </div>
        ${isActive ? `<p class="mt-2 text-xs italic text-gray-500">Active Since: ${new Date(gameState.activePunishmentIDs[punishment.id]).toLocaleDateString()}</p>` : ''}
    `;
    return card;
}


// --- Form Visibility Toggles ---

window.toggleHabitForm = function(force = null) {
    const form = document.getElementById('new-habit-form');
    const isVisible = force !== null ? force : form.classList.contains('hidden');
    
    if (isVisible) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}

window.toggleRewardForm = function(force = null) {
    const form = document.getElementById('new-reward-form');
    const isVisible = force !== null ? force : form.classList.contains('hidden');
    
    if (isVisible) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}

window.togglePunishmentForm = function(force = null) {
    const form = document.getElementById('new-punishment-form');
    const isVisible = force !== null ? force : form.classList.contains('hidden');
    
    if (isVisible) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}


// --- Core Game Logic Functions ---

/**
 * Prompts the user to specify which role is performing the action (Keeper or Nightingale).
 * NOTE: This is a simplification; in a real app, the user would be authenticated as one role.
 * @param {string} action The action to confirm (e.g., 'addReward' or 'subtractReward').
 * @param {number} points The point value.
 * @param {string} item The name of the item (for display).
 * @param {string} [id] Optional ID for specific items (like rewards/punishments).
 */
window.promptRoleAction = function(action, points, item, id = null) {
    const message = `Which role is performing this action?`;

    window.showModal(
        "Select Role",
        message,
        () => {
            // This is just a placeholder confirm, we need a select box for the role
            // Since we can't create complex UI in the prompt, we'll simplify the confirm flow
            // and assume the user's intent. Let's add the role selection to the form itself.
            // For now, let's simplify the `redeemReward` to be a straight confirmation of points spent by the redeeming user.
            
            // Revert to a simpler confirmation for the reward flow
            if (action === 'redeemRewardConfirmed' && id) {
                // Determine who is spending the points.
                // Since this is a collaborative ledger, we have to ask who wants the reward.
                const roleChoiceMessage = `Which player is redeeming the reward: **${item}** for ${points} points?`;
                window.showModal(
                    "Redeem Reward",
                    roleChoiceMessage,
                    () => { window.redeemRewardConfirmed(id, points, 'keeper'); },
                    () => { window.redeemRewardConfirmed(id, points, 'nightingale'); }
                );
            }
        }
    );
};


/**
 * Sets the names for Keeper and Nightingale.
 */
window.setPlayerNames = function() {
    const keeperName = document.getElementById('keeper-name-input').value.trim();
    const nightingaleName = document.getElementById('nightingale-name-input').value.trim();
    
    if (!keeperName || !nightingaleName) {
        showModal("Input Required", "Please enter names for both The Keeper and The Nightingale.");
        return;
    }
    
    updateGameState({
        players: {
            keeper: keeperName,
            nightingale: nightingaleName
        }
    });
    
    showModal("Names Updated", "The Keeper and The Nightingale names have been saved.");
};

/**
 * Resets the scores for both roles to zero.
 */
window.resetScores = function() {
    showModal(
        "Confirm Reset",
        "Are you sure you want to reset all scores to zero? This action cannot be undone.",
        () => {
            updateGameState({
                scores: {
                    keeper: 0,
                    nightingale: 0
                }
            });
            showModal("Scores Reset", "All scores have been reset to zero.");
        }
    );
};


// --- CRUD Operations ---

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Adds a new habit to the ledger.
 */
window.addHabit = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value);
    const times = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || isNaN(times) || points <= 0 || times <= 0) {
        showModal("Invalid Input", "Please provide a valid description, positive points, and positive target times.");
        return;
    }

    const newHabit = {
        id: generateId(),
        description: desc,
        points: points,
        targetTimes: times,
        assignee: assignee
    };

    const newHabits = [...gameState.habits, newHabit];
    updateGameState({ habits: newHabits });
    
    // Clear form and hide
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = '';
    document.getElementById('new-habit-times').value = '1';
    window.toggleHabitForm(false);
    showModal("Habit Added", `New habit for ${gameState.players[assignee]} added successfully!`);
};

/**
 * Adds a new reward to the ledger.
 */
window.addReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a valid title, description, and positive point cost.");
        return;
    }

    const newReward = {
        id: generateId(),
        title: title,
        cost: cost,
        description: desc
    };

    const newRewards = [...gameState.rewards, newReward];
    updateGameState({ rewards: newRewards });
    
    // Clear form and hide
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = '';
    document.getElementById('new-reward-desc').value = '';
    window.toggleRewardForm(false);
    showModal("Reward Added", `New reward '${title}' added successfully!`);
};

/**
 * Adds a new punishment to the ledger.
 */
window.addPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Invalid Input", "Please provide a valid title and description for the punishment.");
        return;
    }

    const newPunishment = {
        id: generateId(),
        title: title,
        description: desc
    };

    const newPunishments = [...gameState.punishments, newPunishment];
    updateGameState({ punishments: newPunishments });
    
    // Clear form and hide
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    window.togglePunishmentForm(false);
    showModal("Punishment Added", `New punishment '${title}' added successfully!`);
};


/**
 * Removes a habit from the ledger.
 * @param {string} id Habit ID.
 */
window.removeHabit = function(id) {
    showModal(
        "Confirm Deletion",
        "Are you sure you want to remove this habit?",
        () => {
            const newHabits = gameState.habits.filter(h => h.id !== id);
            // Also clean up active assignments
            const newActiveHabitIDs = { ...gameState.activeHabitIDs };
            delete newActiveHabitIDs[id];
            
            updateGameState({ habits: newHabits, activeHabitIDs: newActiveHabitIDs });
            showModal("Habit Removed", "The habit has been removed from the ledger.");
        }
    );
};

/**
 * Removes a reward from the ledger.
 * @param {string} id Reward ID.
 */
window.removeReward = function(id) {
    showModal(
        "Confirm Deletion",
        "Are you sure you want to remove this reward?",
        () => {
            const newRewards = gameState.rewards.filter(r => r.id !== id);
            // Also clean up active assignments
            const newActiveRewardIDs = { ...gameState.activeRewardIDs };
            delete newActiveRewardIDs[id];
            
            updateGameState({ rewards: newRewards, activeRewardIDs: newActiveRewardIDs });
            showModal("Reward Removed", "The reward has been removed from the ledger.");
        }
    );
};

/**
 * Removes a punishment from the ledger.
 * @param {string} id Punishment ID.
 */
window.removePunishment = function(id) {
    showModal(
        "Confirm Deletion",
        "Are you sure you want to remove this punishment?",
        () => {
            const newPunishments = gameState.punishments.filter(p => p.id !== id);
            // Also clean up active assignments
            const newActivePunishmentIDs = { ...gameState.activePunishmentIDs };
            delete newActivePunishmentIDs[id];
            
            updateGameState({ punishments: newPunishments, activePunishmentIDs: newActivePunishmentIDs });
            showModal("Punishment Removed", "The punishment has been removed from the ledger.");
        }
    );
};


// --- Point and Assignment Logic ---

/**
 * Toggles a habit's active status, meaning it is currently assigned for the day.
 * @param {string} habitId The ID of the habit.
 * @param {string} assignee The role ('keeper' or 'nightingale') this habit is for.
 */
window.toggleHabitActive = function(habitId, assignee) {
    const activeData = gameState.activeHabitIDs[habitId] || {};
    const assignedTime = activeData[assignee];
    const newActiveHabitIDs = { ...gameState.activeHabitIDs };
    
    if (assignedTime) {
        // Mark Inactive/Unassign
        delete newActiveHabitIDs[habitId];
        showModal("Habit Unassigned", `${gameState.players[assignee]}'s habit is now marked as unassigned for the day.`);
    } else {
        // Mark Active/Assign
        newActiveHabitIDs[habitId] = { ...activeData, [assignee]: Date.now() };
        showModal("Habit Assigned", `${gameState.players[assignee]}'s habit has been assigned for tracking today.`);
    }
    
    updateGameState({ activeHabitIDs: newActiveHabitIDs });
};

/**
 * Shows a modal to mark a habit as completed and award points.
 * @param {string} habitId The ID of the habit.
 * @param {string} pointGiverRole The role who is giving the points (the partner).
 * @param {string} pointGiverName The name of the partner.
 */
window.showHabitCompletionModal = function(habitId, pointGiverRole, pointGiverName) {
    const habit = gameState.habits.find(h => h.id === habitId);
    if (!habit) return;

    const habitCompleterRole = habit.assignee;
    const habitCompleterName = gameState.players[habitCompleterRole];

    showModal(
        "Confirm Habit Completion",
        `Did **${habitCompleterName}** complete their habit, earning **${habit.points}** points for **${pointGiverName}**?`,
        () => {
            window.markHabitCompleted(habitId, habitCompleterRole, pointGiverRole, habit.points);
        }
    );
};

/**
 * Marks a habit as completed and updates scores.
 * @param {string} habitId The ID of the habit.
 * @param {string} habitCompleterRole The role ('keeper' or 'nightingale') who completed the habit.
 * @param {string} pointGiverRole The role who is being awarded the points (the partner).
 * @param {number} points The points to be awarded.
 */
window.markHabitCompleted = function(habitId, habitCompleterRole, pointGiverRole, points) {
    
    // 1. Update Score (Point Giver gets the points)
    const newScores = { ...gameState.scores };
    newScores[pointGiverRole] += points;
    
    // 2. Clear the habit from active assignments
    const newActiveHabitIDs = { ...gameState.activeHabitIDs };
    delete newActiveHabitIDs[habitId];
    
    updateGameState({ 
        scores: newScores,
        activeHabitIDs: newActiveHabitIDs
    });
    
    showModal("Success!", `Habit completed! ${gameState.players[pointGiverRole]} has been awarded ${points} points.`);
};


/**
 * Toggles a reward's active status, marking it as either available for use or redeemed.
 * @param {string} rewardId The ID of the reward.
 */
window.toggleRewardActive = function(rewardId) {
    const isActive = !!gameState.activeRewardIDs[rewardId];
    const newActiveRewardIDs = { ...gameState.activeRewardIDs };
    
    if (isActive) {
        // Mark Redeemed/Inactive
        delete newActiveRewardIDs[rewardId];
        showModal("Reward Redeemed", "This reward has been marked as redeemed and is now inactive.");
    } else {
        // Mark Available/Active
        newActiveRewardIDs[rewardId] = Date.now();
        showModal("Reward Activated", "This reward is now marked as available for redemption.");
    }
    
    updateGameState({ activeRewardIDs: newActiveRewardIDs });
};

/**
 * Initiates the reward redemption process by prompting the user for the redeeming role.
 * @param {string} rewardId The ID of the reward.
 * @param {number} cost The point cost.
 */
window.redeemReward = function(rewardId, cost) {
    const reward = gameState.rewards.find(r => r.id === rewardId);
    if (!reward) return;

    const message = `Which role is spending **${cost}** points to redeem the reward: **${reward.title}**?`;
    
    // Custom modal with buttons for role selection
    let roleSelectModal = document.getElementById('role-select-modal');
    if (!roleSelectModal) {
        roleSelectModal = document.createElement('div');
        roleSelectModal.id = 'role-select-modal';
        roleSelectModal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 transition-opacity duration-300 opacity-0 pointer-events-none';
        roleSelectModal.innerHTML = `
            <div class="bg-[#242429] card p-6 w-96 max-w-[90%] transform transition-transform duration-300 scale-95 rounded-xl shadow-2xl">
                <h3 class="text-xl font-bold mb-4 text-[#b05c6c]">Redeem Reward</h3>
                <p class="text-gray-300 mb-6" id="role-select-message"></p>
                <div class="flex justify-between space-x-3">
                    <button id="select-keeper" class="btn-primary flex-1 bg-red-600 hover:bg-red-700">${gameState.players.keeper} (Keeper)</button>
                    <button id="select-nightingale" class="btn-primary flex-1 bg-blue-600 hover:bg-blue-700">${gameState.players.nightingale} (Nightingale)</button>
                </div>
                <div class="flex justify-end mt-4">
                    <button id="role-select-cancel" class="btn-secondary">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(roleSelectModal);
    }

    document.getElementById('role-select-message').textContent = message;

    // Remove old listeners
    document.getElementById('select-keeper').replaceWith(document.getElementById('select-keeper').cloneNode(true));
    document.getElementById('select-nightingale').replaceWith(document.getElementById('select-nightingale').cloneNode(true));
    document.getElementById('role-select-cancel').replaceWith(document.getElementById('role-select-cancel').cloneNode(true));

    // Add new listeners
    document.getElementById('select-keeper').onclick = () => {
        window.redeemRewardConfirmed(rewardId, cost, 'keeper');
        window.hideRoleSelectModal();
    };
    document.getElementById('select-nightingale').onclick = () => {
        window.redeemRewardConfirmed(rewardId, cost, 'nightingale');
        window.hideRoleSelectModal();
    };
    document.getElementById('role-select-cancel').onclick = window.hideRoleSelectModal;

    // Show modal
    setTimeout(() => {
        roleSelectModal.classList.remove('opacity-0', 'pointer-events-none');
        roleSelectModal.querySelector('.card').classList.remove('scale-95');
    }, 10);
};

window.hideRoleSelectModal = function() {
    const modal = document.getElementById('role-select-modal');
    if (modal) {
        modal.classList.add('opacity-0', 'pointer-events-none');
        modal.querySelector('.card').classList.add('scale-95');
    }
}

/**
 * Final confirmation and execution of reward redemption.
 * @param {string} rewardId The ID of the reward.
 * @param {number} cost The point cost.
 * @param {string} redeemingRole The role ('keeper' or 'nightingale') redeeming the reward.
 */
window.redeemRewardConfirmed = function(rewardId, cost, redeemingRole) {
    
    // Check if player has enough points
    if (gameState.scores[redeemingRole] < cost) {
        showModal("Insufficient Points", `${gameState.players[redeemingRole]} (The ${redeemingRole === 'keeper' ? 'Keeper' : 'Nightingale'}) does not have enough points to redeem this reward.`);
        return;
    }

    const newScores = { ...gameState.scores };
    newScores[redeemingRole] -= cost;
    
    // Set the reward as Active/Redeemed (Toggling active status implies completion/redemption)
    const newActiveRewardIDs = { ...gameState.activeRewardIDs };
    newActiveRewardIDs[rewardId] = Date.now();
    
    updateGameState({ 
        scores: newScores,
        activeRewardIDs: newActiveRewardIDs 
    });
    
    showModal("Reward Redeemed!", `Reward successfully redeemed by ${gameState.players[redeemingRole]}! **${cost}** points deducted.`);
};

/**
 * Assigns a punishment to the *other* partner (whoever is not the one earning points).
 * Since the system is collaborative, we assume the user clicking is assigning it.
 * @param {string} punishmentId The ID of the punishment.
 */
window.assignPunishment = function(punishmentId) {
    const punishment = gameState.punishments.find(p => p.id === punishmentId);
    if (!punishment) return;

    // Simple confirmation for now.
    showModal(
        "Confirm Assignment",
        `Do you confirm assigning the punishment: **${punishment.title}**? This will be marked as active until completed.`,
        () => {
            const newActivePunishmentIDs = { ...gameState.activePunishmentIDs };
            newActivePunishmentIDs[punishmentId] = Date.now();
            updateGameState({ activePunishmentIDs: newActivePunishmentIDs });
            showModal("Punishment Assigned", `The punishment **${punishment.title}** has been assigned and is now active.`);
        }
    );
};

/**
 * Toggles a punishment's active status, marking it as either active or completed.
 * @param {string} punishmentId The ID of the punishment.
 */
window.togglePunishmentActive = function(punishmentId) {
    const isActive = !!gameState.activePunishmentIDs[punishmentId];
    const newActivePunishmentIDs = { ...gameState.activePunishmentIDs };
    
    if (isActive) {
        // Mark Completed
        delete newActivePunishmentIDs[punishmentId];
        showModal("Punishment Completed", "The assigned punishment has been marked as complete.");
    } else {
        // Mark Active
        newActivePunishmentIDs[punishmentId] = Date.now();
        showModal("Punishment Activated", "The punishment is now marked as active.");
    }
    
    updateGameState({ activePunishmentIDs: newActivePunishmentIDs });
};


// --- Example Data Generation ---

/**
 * Injects a random example habit, reward, or punishment into the form fields.
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
};

// --- Initial Setup ---

window.onload = initializeFirebase;