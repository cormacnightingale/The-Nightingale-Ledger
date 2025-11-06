import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc, runTransaction, query, where, getDocs, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment) ---
// Note: EXAMPLE_DATABASE is expected to be loaded via examples.js first.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// CRITICAL: Reference the global firebaseConfig variable exposed by firebase_config.js
// This relies on firebase_config.js being loaded BEFORE this module.
const firebaseConfig = typeof firebaseConfig !== 'undefined' ? firebaseConfig : null;

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let GAME_STATE_PATH = null; // The collection path: /artifacts/{appId}/public/data/{ledgerCode}
const GAME_STATE_DOC_ID = 'ledger_data'; // The document ID within the path
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
    lastAction: null, // Used for undo functionality
    lastActionTimestamp: null,
};
let unsubscribeSnapshot = null;
let currentTab = 'habits';

// --- Utility Functions ---

/**
 * Custom modal replacement for alert()/confirm()
 * @param {string} title
 * @param {string} message
 * @param {boolean} isConfirm - If true, shows cancel button and resolves/rejects promise.
 * @returns {Promise<boolean>} Resolves true on confirm, rejects/resolves false on cancel/close.
 */
function showModal(title, message, isConfirm = false) {
    const modalContainer = document.getElementById('modal-container');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalContainer.classList.remove('hidden');

    confirmBtn.textContent = isConfirm ? 'Confirm' : 'OK';
    if (isConfirm) {
        cancelBtn.classList.remove('hidden');
    } else {
        cancelBtn.classList.add('hidden');
    }

    return new Promise((resolve) => {
        const handleConfirm = () => {
            modalContainer.classList.add('hidden');
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleHandleCancel);
            resolve(true);
        };

        const handleHandleCancel = () => {
            modalContainer.classList.add('hidden');
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleHandleCancel);
            resolve(false);
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleHandleCancel);
    });
}

/**
 * Generates a unique 6-digit code for the ledger.
 * @returns {string} 6-character uppercase string.
 */
function generateLedgerCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Generates a simple unique ID for items (Habits/Rewards).
 * @returns {string} UUID-like string.
 */
function generateId() {
    return crypto.randomUUID().split('-')[0];
}

// --- App State Management ---

/**
 * Updates the local gameState and renders the UI.
 * @param {object} newState - The new state data from Firestore.
 */
function updateAppState(newState) {
    // Merge new state while preserving local defaults if fields are missing (e.g., on initial create)
    gameState = { ...gameState, ...newState };

    // Update Scores
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;

    // Update Player Names (in case they were changed on the remote side)
    document.getElementById('keeper-name').textContent = gameState.players.keeper.toUpperCase();
    document.getElementById('nightingale-name').textContent = gameState.players.nightingale.toUpperCase();

    // Render Lists
    renderList('habits', gameState.habits, renderHabitItem);
    renderList('rewards', gameState.rewards, renderRewardItem);
    renderList('punishments', gameState.punishments, renderPunishmentItem);

    // Update Undo Button Status
    const undoBtn = document.getElementById('undo-button');
    if (gameState.lastAction && gameState.lastAction.userId === userId && Date.now() - gameState.lastActionTimestamp < 60000) {
        undoBtn.disabled = false;
        undoBtn.textContent = `Undo Last Action (${gameState.lastAction.type})`;
    } else {
        undoBtn.disabled = true;
        undoBtn.textContent = 'Undo Last Action';
    }

    // Hide loading indicators
    document.getElementById('habits-loading').style.display = gameState.habits.length > 0 ? 'none' : 'block';
    document.getElementById('rewards-loading').style.display = gameState.rewards.length > 0 ? 'none' : 'block';
    document.getElementById('punishments-loading').style.display = gameState.punishments.length > 0 ? 'none' : 'block';
}

/**
 * Renders an array of items into a list container.
 * @param {string} listKey - 'habits', 'rewards', or 'punishments'.
 * @param {Array<object>} items - The items to render.
 * @param {function} renderer - Function to generate the HTML for a single item.
 */
function renderList(listKey, items, renderer) {
    const listContainer = document.getElementById(`${listKey}-list`);
    listContainer.innerHTML = '';
    
    // Sort items so recently added ones (highest timestamp) appear first
    const sortedItems = [...items].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    sortedItems.forEach(item => {
        listContainer.appendChild(renderer(item));
    });
}

// --- Item Renderers (Creates the list item HTML elements) ---

/**
 * Creates the HTML element for a single Habit item.
 */
function renderHabitItem(habit) {
    const el = document.createElement('div');
    el.className = 'list-item';
    const otherPlayer = habit.type === 'keeper' ? 'nightingale' : 'keeper';

    el.innerHTML = `
        <div class="flex flex-col flex-1 min-w-0">
            <p class="text-sm font-sans uppercase tracking-wider text-gray-400 mb-1">${gameState.players[habit.type]} earns ${habit.points} pts</p>
            <p class="font-bold text-base text-white truncate">${habit.description}</p>
        </div>
        <div class="flex space-x-2 ml-4">
            <button onclick="window.completeHabit('${habit.id}', '${habit.points}', '${habit.type}')" 
                    class="action-button bg-[#b05c6c] text-white p-2 rounded-full hover:bg-[#8c4251] transition-colors shadow-lg"
                    title="Mark as Complete (Earn Points)">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            </button>
            <button onclick="window.removeListItem('habits', '${habit.id}')" 
                    class="action-button bg-transparent text-gray-500 p-2 rounded-full hover:text-red-500 transition-colors"
                    title="Remove Habit">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
    `;
    return el;
}

/**
 * Creates the HTML element for a single Reward item.
 */
function renderRewardItem(reward) {
    const el = document.createElement('div');
    el.className = 'list-item';

    el.innerHTML = `
        <div class="flex flex-col flex-1 min-w-0">
            <p class="text-sm font-sans uppercase tracking-wider text-green-400 mb-1">Cost: ${reward.cost} points</p>
            <p class="font-bold text-base text-white truncate">${reward.title}</p>
            <p class="text-xs text-gray-500">${reward.description}</p>
        </div>
        <div class="flex space-x-2 ml-4">
            <button onclick="window.redeemReward('${reward.id}', '${reward.cost}', 'keeper')" 
                    class="action-button bg-purple-600 text-white text-xs p-2 rounded-lg hover:bg-purple-700 transition-colors shadow-lg disabled:opacity-50"
                    title="Redeem for Keeper" ${gameState.scores.keeper < reward.cost ? 'disabled' : ''}>
                ${gameState.players.keeper.substring(0, 1)}
            </button>
            <button onclick="window.redeemReward('${reward.id}', '${reward.cost}', 'nightingale')" 
                    class="action-button bg-purple-600 text-white text-xs p-2 rounded-lg hover:bg-purple-700 transition-colors shadow-lg disabled:opacity-50"
                    title="Redeem for Nightingale" ${gameState.scores.nightingale < reward.cost ? 'disabled' : ''}>
                ${gameState.players.nightingale.substring(0, 1)}
            </button>
            <button onclick="window.removeListItem('rewards', '${reward.id}')" 
                    class="action-button bg-transparent text-gray-500 p-2 rounded-full hover:text-red-500 transition-colors"
                    title="Remove Reward">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
    `;
    return el;
}

/**
 * Creates the HTML element for a single Punishment item.
 */
function renderPunishmentItem(punishment) {
    const el = document.createElement('div');
    el.className = 'list-item';

    el.innerHTML = `
        <div class="flex flex-col flex-1 min-w-0">
            <p class="text-sm font-sans uppercase tracking-wider text-red-400 mb-1">Punishment Title</p>
            <p class="font-bold text-base text-white truncate">${punishment.title}</p>
            <p class="text-xs text-gray-500">${punishment.description}</p>
        </div>
        <div class="flex space-x-2 ml-4">
            <button onclick="window.removeListItem('punishments', '${punishment.id}')" 
                    class="action-button bg-transparent text-gray-500 p-2 rounded-full hover:text-red-500 transition-colors"
                    title="Remove Punishment">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
    `;
    return el;
}

// --- Firebase Operations ---

/**
 * Initializes Firebase and sets up authentication.
 */
async function initializeFirebase() {
    // Set Firestore log level to Debug for better console information
    setLogLevel('Debug');
    
    if (!firebaseConfig) {
        console.error("Firebase config is missing or invalid.");
        showModal("Setup Error", "Firebase configuration is missing. The app cannot connect to the database. Ensure firebase_config.js is loaded.");
        return;
    }

    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Set persistence to session to maintain login across page refresh
        await setPersistence(auth, browserSessionPersistence);
        
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            // Fallback for non-canvas environments or if token is absent
            await signInAnonymously(auth);
        }
        
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('current-user-id').textContent = userId;
                document.getElementById('current-app-id').textContent = appId;
                
                // Check for existing ledger code in session storage
                const lastLedgerCode = sessionStorage.getItem('lastLedgerCode');
                if (lastLedgerCode) {
                    document.getElementById('ledger-code-input').value = lastLedgerCode;
                    joinLedger(lastLedgerCode);
                } else {
                    document.getElementById('setup-section').classList.remove('hidden');
                }
            } else {
                console.log("No user signed in.");
            }
        });
    } catch (error) {
        console.error("Error initializing Firebase or signing in:", error);
        // Display the specific error message to the user
        showModal("Auth Error", `Failed to sign in. Error: ${error.message}. Please check your API Key in firebase_config.js.`);
    }
}

/**
 * Sets up the real-time listener for the given ledger.
 * @param {string} code - The 6-digit ledger code.
 */
function setupLedgerListener(code) {
    if (unsubscribeSnapshot) {
        unsubscribeSnapshot(); // Unsubscribe from the old listener
    }

    // Set the full Firestore path for the public shared data
    // Path: /artifacts/{appId}/public/data/{ledgerCode}/ledger_data
    GAME_STATE_PATH = `artifacts/${appId}/public/data/${code}`;
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    
    // Set the code display in the dashboard
    document.getElementById('ledger-code-display').textContent = `Ledger Code: ${code}`;
    sessionStorage.setItem('lastLedgerCode', code);

    // Set up the new real-time listener
    unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            // Data exists, update app state
            updateAppState(docSnap.data());
            document.getElementById('setup-section').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
        } else {
            // Document does not exist (New Ledger)
            showModal("Ledger Not Found", `Ledger with code ${code} not found. Use 'Create Ledger' to start a new one or double check the code.`);
            document.getElementById('dashboard').classList.add('hidden');
            document.getElementById('setup-section').classList.remove('hidden');
        }
    }, (error) => {
        console.error("Firestore snapshot error:", error);
        showModal("Connection Error", "Failed to connect to the ledger. Check your network or console for details.");
    });
}

/**
 * Attempts to join a ledger with the code from the input field.
 * @param {string} [code] - Optional code to use (e.g., from session storage).
 */
window.joinLedger = function(code) {
    const ledgerCode = (code || document.getElementById('ledger-code-input').value).toUpperCase().trim();
    if (ledgerCode.length !== 6) {
        showModal("Invalid Code", "Please enter a 6-digit Ledger Code.");
        return;
    }
    setupLedgerListener(ledgerCode);
};

/**
 * Creates a new ledger with a random code and initializes it.
 */
window.createLedger = async function() {
    let newCode = generateLedgerCode();
    
    // Check if code already exists (unlikely, but good practice)
    const newDocRef = doc(db, `artifacts/${appId}/public/data/${newCode}`, GAME_STATE_DOC_ID);
    const docSnap = await getDoc(newDocRef);
    
    if (docSnap.exists()) {
        newCode = generateLedgerCode(); // Try again if the code already exists
    }

    // Confirmation before creating and overwriting an existing code
    const confirmed = await showModal("Confirm New Ledger", 
        `Are you sure you want to create a NEW ledger with code: ${newCode}? 
        You will be assigned as Keeper.`, true);
    
    if (!confirmed) return;

    // Initialize with a default state
    const initialState = {
        players: { keeper: 'The Keeper', nightingale: 'The Nightingale' },
        scores: { keeper: 0, nightingale: 0 },
        habits: [],
        rewards: [],
        punishments: [],
        lastAction: null,
        lastActionTimestamp: Date.now(),
    };

    try {
        await setDoc(newDocRef, initialState);
        document.getElementById('ledger-code-input').value = newCode;
        setupLedgerListener(newCode);
        showModal("Ledger Created!", `New Ledger created with code: ${newCode}.`);
    } catch (error) {
        console.error("Error creating document:", error);
        showModal("Error", "Failed to create new ledger. See console for details.");
    }
};

/**
 * Updates a score, stores an action for undo, and uses a transaction for safety.
 * @param {string} assignee - 'keeper' or 'nightingale'.
 * @param {number} points - The point change (positive for habits, negative for rewards).
 * @param {string} type - 'habit' or 'reward'.
 */
async function updateScoreAndLogAction(assignee, points, type, itemId) {
    if (!GAME_STATE_PATH) return showModal("Error", "Ledger not connected.");

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists()) {
                throw "Document does not exist!";
            }
            
            const currentData = docSnap.data();
            const currentScore = currentData.scores[assignee];
            const newScore = currentScore + points;

            if (newScore < 0) {
                // This check is primarily for reward redemption
                throw "Insufficient points to redeem this reward.";
            }

            // Prepare update payload
            const updatePayload = {
                scores: { ...currentData.scores, [assignee]: newScore },
                lastAction: {
                    type: type,
                    itemId: itemId,
                    assignee: assignee,
                    points: points, // The exact point value to be reversed
                    userId: userId,
                },
                lastActionTimestamp: Date.now(),
            };

            transaction.update(docRef, updatePayload);
        });

        // Success message (optional, as UI updates via snapshot)
        const actionText = points > 0 ? `Earned ${points} points for ${assignee}` : `Spent ${-points} points for ${assignee}`;
        console.log(`${actionText}. Transaction committed.`);

    } catch (error) {
        console.error("Transaction failed:", error);
        if (typeof error === 'string' && error.includes('Insufficient points')) {
            showModal("Action Failed", "You do not have enough points to redeem that reward!");
        } else {
            showModal("Error", `An error occurred during the transaction. See console.`);
        }
    }
}

/**
 * Undoes the last action if it was performed by the current user and is recent.
 */
window.undoLastAction = async function() {
    if (!GAME_STATE_PATH) return;

    const action = gameState.lastAction;
    if (!action || action.userId !== userId) {
        showModal("Undo Error", "Cannot undo: The last action was not performed by you or the undo window expired.");
        return;
    }

    const confirmed = await showModal("Confirm Undo", 
        `Are you sure you want to UNDO the last action (${action.type}: ${action.points} points for ${action.assignee})?`, 
        true);
    
    if (!confirmed) return;

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists()) {
                throw "Document does not exist!";
            }
            
            const currentData = docSnap.data();
            // Reverse the point change (add the negative of the original points)
            const newScore = currentData.scores[action.assignee] - action.points;

            // Prepare update payload
            const updatePayload = {
                scores: { ...currentData.scores, [action.assignee]: newScore },
                lastAction: null, // Clear the last action after undo
                lastActionTimestamp: Date.now(),
            };

            transaction.update(docRef, updatePayload);
        });

        showModal("Undo Successful", "The last action has been reversed.");

    } catch (error) {
        console.error("Undo transaction failed:", error);
        showModal("Undo Error", `Failed to undo the action. See console for details.`);
    }
};


// --- Action Handlers (Called by UI buttons) ---

window.switchTab = function(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.tab-button').forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('tab-active');
        } else {
            btn.classList.remove('tab-active');
        }
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
};

window.toggleHabitForm = function() { document.getElementById('habit-form').classList.toggle('hidden'); };
window.toggleRewardForm = function() { document.getElementById('reward-form').classList.toggle('hidden'); };
window.togglePunishmentForm = function() { document.getElementById('punishment-form').classList.toggle('hidden'); };


window.addHabit = async function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0 || !assignee) {
        showModal("Input Error", "Please provide a valid description, positive points, and an assignee.");
        return;
    }
    
    // Add item to the habits array and update the document
    const newHabit = {
        id: generateId(),
        description: desc,
        points: points,
        type: assignee,
        timestamp: Date.now() // Used for sorting and initial creation order
    };

    const newHabits = [...gameState.habits, newHabit];
    
    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, { 
            habits: newHabits,
            lastActionTimestamp: Date.now() // To force a state update even without a score change
        });
        document.getElementById('new-habit-desc').value = '';
        document.getElementById('new-habit-points').value = 10;
        window.toggleHabitForm();
    } catch (error) {
        console.error("Error adding habit:", error);
        showModal("Error", "Failed to add habit.");
    }
};

window.addReward = async function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Input Error", "Please provide a title, description, and positive point cost.");
        return;
    }

    const newReward = {
        id: generateId(),
        title: title,
        description: desc,
        cost: cost,
        timestamp: Date.now()
    };

    const newRewards = [...gameState.rewards, newReward];
    
    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, { 
            rewards: newRewards,
            lastActionTimestamp: Date.now()
        });
        document.getElementById('new-reward-title').value = '';
        document.getElementById('new-reward-cost').value = 50;
        document.getElementById('new-reward-desc').value = '';
        window.toggleRewardForm();
    } catch (error) {
        console.error("Error adding reward:", error);
        showModal("Error", "Failed to add reward.");
    }
};

window.addPunishment = async function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Input Error", "Please provide a title and description for the punishment.");
        return;
    }

    const newPunishment = {
        id: generateId(),
        title: title,
        description: desc,
        timestamp: Date.now()
    };

    const newPunishments = [...gameState.punishments, newPunishment];
    
    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, { 
            punishments: newPunishments,
            lastActionTimestamp: Date.now()
        });
        document.getElementById('new-punishment-title').value = '';
        document.getElementById('new-punishment-desc').value = '';
        window.togglePunishmentForm();
    } catch (error) {
        console.error("Error adding punishment:", error);
        showModal("Error", "Failed to add punishment.");
    }
};

window.completeHabit = async function(itemId, pointsStr, assignee) {
    const points = parseInt(pointsStr, 10);
    await updateScoreAndLogAction(assignee, points, 'habit', itemId);
    // Note: The habit item is intentionally not removed.
    // It's a recurring task, and the user can track its completion history manually 
    // or through the score change log.
};

window.redeemReward = async function(itemId, costStr, assignee) {
    const cost = -parseInt(costStr, 10); // Cost is negative points
    
    const confirmed = await showModal("Confirm Reward", 
        `Confirm ${gameState.players[assignee]} spends ${-cost} points to redeem this reward?`, 
        true);
    
    if (!confirmed) return;

    await updateScoreAndLogAction(assignee, cost, 'reward', itemId);
};

window.removeListItem = async function(listKey, itemId) {
    const confirmed = await showModal("Confirm Removal", 
        `Are you sure you want to permanently remove this item from the ${listKey} list?`, 
        true);
    
    if (!confirmed) return;

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    const updatedList = gameState[listKey].filter(item => item.id !== itemId);
    
    try {
        const updatePayload = {
            [listKey]: updatedList,
            lastActionTimestamp: Date.now()
        };
        await updateDoc(docRef, updatePayload);
    } catch (error) {
        console.error(`Error removing item from ${listKey}:`, error);
        showModal("Error", `Failed to remove item.`);
    }
};

/**
 * Inserts a random example habit, reward, or punishment into the form fields.
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
};

// --- Initialization ---

window.onload = initializeFirebase;