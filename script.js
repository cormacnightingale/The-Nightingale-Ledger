import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Standard Web Deployment) ---\n
// Use a static, consistent ID for this application instance across all deployments.
const appId = 'nightingale-ledger-v1';

// We assume firebaseConfig is available globally (loaded via ./firebase_config.js)
// The firebaseConfig object will be accessed directly.
// The initialAuthToken is null for a standard web deployment.
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
 * @param {string} title 
 * @param {string} message 
 */
function showModal(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('custom-modal').classList.remove('hidden');
}

/**
 * Closes the custom modal.
 */
window.closeModal = function() {
    document.getElementById('custom-modal').classList.add('hidden');
}

/**
 * Generates a unique ID for new documents/items.
 * @returns {string} A unique ID.
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * Formats a timestamp into a readable date/time string.
 * @param {number} timestamp - Unix timestamp.
 * @returns {string} Formatted date/time string.
 */
function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// --- Theme Management ---

const THEME_KEY = 'nightingale_theme';
const ALL_THEMES = ['default-theme', 'parchment-theme', 'forest-theme'];

/**
 * Toggles the visibility of the Options/Theme modal.
 */
window.toggleOptionsModal = function() {
    const modal = document.getElementById('options-modal');
    modal.classList.toggle('hidden');
    // Update active state of buttons when opening
    if (!modal.classList.contains('hidden')) {
        updateThemeButtons();
    }
}

/**
 * Applies the selected theme to the body and saves it to localStorage.
 * @param {string} themeName - The theme class to apply (e.g., 'default-theme').
 */
window.applyTheme = function(themeName) {
    if (!ALL_THEMES.includes(themeName)) {
        console.error("Invalid theme name:", themeName);
        return;
    }
    
    // 1. Remove all theme classes and add the new one
    document.body.classList.remove(...ALL_THEMES);
    document.body.classList.add(themeName);
    
    // 2. Save the preference
    localStorage.setItem(THEME_KEY, themeName);

    // 3. Update button active states
    updateThemeButtons();
    
    // 4. Show a quick confirmation
    const statusEl = document.getElementById('theme-status');
    // Get theme display name from the button data-theme attribute
    const themeButton = document.querySelector(`[data-theme="${themeName}"] span.font-semibold`);
    const themeDisplayName = themeButton ? themeButton.textContent : themeName.split('-')[0].charAt(0).toUpperCase() + themeName.split('-')[0].slice(1);
    
    statusEl.textContent = `Theme set to: ${themeDisplayName}.`;
    setTimeout(() => statusEl.textContent = '', 2000);

    // Re-render to ensure tab border color updates immediately
    if (db) renderLedger();
}

/**
 * Updates the visual active state of the theme buttons in the options modal.
 */
function updateThemeButtons() {
    const currentTheme = localStorage.getItem(THEME_KEY) || 'default-theme';
    const buttons = document.querySelectorAll('.theme-button');
    buttons.forEach(button => {
        const theme = button.getAttribute('data-theme');
        if (theme === currentTheme) {
            button.setAttribute('data-active', 'true');
        } else {
            button.setAttribute('data-active', 'false');
        }
    });
}

/**
 * Loads the saved theme from localStorage on startup.
 */
function loadTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme && ALL_THEMES.includes(savedTheme)) {
        window.applyTheme(savedTheme);
    } else {
        // Ensure default theme is explicitly set if nothing is saved
        window.applyTheme('default-theme');
    }
}


// --- Firebase Initialization ---

/**
 * Initializes Firebase App and Authentication.
 */
async function initFirebase() {
    try {
        // The firebaseConfig is available globally via the separate script file.
        // NOTE: The canvas environment may provide __firebase_config globally. 
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : window.firebaseConfig;
        
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Load theme as soon as possible for visual consistency
        loadTheme(); 
        
        // Authenticate user
        // The canvas environment provides __initial_auth_token.
        const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : initialAuthToken;

        if (token) {
            await auth.signInWithCustomToken(token);
        } else {
            // Sign in anonymously if no custom token is provided
            await signInAnonymously(auth);
        }

        // Wait for auth state to be resolved
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                // Path for shared data: /artifacts/{appId}/public/data/ledger_state/ledger_data
                const currentAppId = typeof __app_id !== 'undefined' ? __app_id : appId;
                GAME_STATE_PATH = `artifacts/${currentAppId}/public/data/ledger_state/${GAME_STATE_DOC_ID}`;
                
                // Display debug info
                document.getElementById('current-user-id').textContent = userId;
                document.getElementById('current-app-id').textContent = currentAppId;

                // Start listening to the ledger
                listenToLedger();

                // Hide loading screen and show app container
                document.getElementById('loading-screen').classList.add('hidden');
                document.getElementById('app-container').classList.remove('hidden');

            } else {
                // User is signed out (this should ideally not happen in the Canvas context)
                console.log("User signed out or auth failed.");
                document.getElementById('auth-error-message').textContent = "Authentication failed. Please check environment configuration.";
            }
        });

    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        document.getElementById('auth-error-message').textContent = `Connection Error: ${error.message}`;
    }
}


// --- Firestore Listeners and Updates (CRUD Operations) ---

/**
 * Sets up a real-time listener for the entire ledger state.
 */
function listenToLedger() {
    const docRef = doc(db, GAME_STATE_PATH);
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            // Document exists, load and update the state
            gameState = docSnap.data();
            console.log("Ledger updated:", gameState);
        } else {
            // Document does not exist, initialize it
            console.log("Ledger does not exist, initializing...");
            // Initialize with the default structure
            saveGameState(true); 
        }
        renderLedger();
    }, (error) => {
        console.error("Ledger snapshot error:", error);
        showModal("Connection Error", "Failed to connect to the shared ledger in real-time. Please check your network.");
    });
}

/**
 * Saves the current gameState object to Firestore.
 * @param {boolean} isInitial - True if this is the first save (use setDoc), false for updates (use updateDoc).
 */
async function saveGameState(isInitial = false) {
    if (!GAME_STATE_PATH) return;
    const docRef = doc(db, GAME_STATE_PATH);
    try {
        if (isInitial) {
            await setDoc(docRef, gameState);
        } else {
            // We use setDoc here to completely overwrite, which is simpler for the whole state object
            await setDoc(docRef, gameState); 
        }
    } catch (error) {
        console.error("Error writing document: ", error);
        showModal("Save Error", "Failed to save ledger data. Check console for details.");
    }
}

/**
 * Renders the current gameState to the DOM.
 */
function renderLedger() {
    // 1. Update Scores and Names
    document.getElementById('keeper-name').textContent = gameState.players.keeper;
    document.getElementById('nightingale-name').textContent = gameState.players.nightingale;
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;

    // 2. Render Habits
    const habitListEl = document.getElementById('habit-list');
    habitListEl.innerHTML = '';
    document.getElementById('habits-loading').classList.add('hidden');

    if (gameState.habits.length === 0) {
        document.getElementById('habits-loading').classList.remove('hidden');
    } else {
        // Sort habits by assignee and then points (descending)
        const sortedHabits = [...gameState.habits].sort((a, b) => {
            if (a.assignee !== b.assignee) {
                return a.assignee.localeCompare(b.assignee);
            }
            return b.points - a.points;
        });

        sortedHabits.forEach(habit => {
            const player = gameState.players[habit.assignee] || habit.assignee;
            const item = `
                <div class="p-4 rounded-lg border border-theme flex justify-between items-center bg-opacity-5">
                    <div class="flex-1">
                        <p class="font-semibold">${habit.description}</p>
                        <p class="text-sm text-secondary">
                            ${habit.points} pts | ${habit.timesPerWeek}x/week | Assigned: ${player}
                        </p>
                    </div>
                    <div class="flex space-x-2 ml-4">
                        <button onclick="window.completeHabit('${habit.id}')" class="button-primary text-xs py-1 px-2">Complete</button>
                        <button onclick="window.deleteItem('habit', '${habit.id}')" class="text-secondary hover:text-error transition duration-150">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
            habitListEl.insertAdjacentHTML('beforeend', item);
        });
    }

    // 3. Render Rewards
    const rewardListEl = document.getElementById('reward-list');
    rewardListEl.innerHTML = '';
    document.getElementById('rewards-loading').classList.add('hidden');
    
    if (gameState.rewards.length === 0) {
        document.getElementById('rewards-loading').classList.remove('hidden');
    } else {
        // Sort rewards by cost (ascending)
        const sortedRewards = [...gameState.rewards].sort((a, b) => a.cost - b.cost);

        sortedRewards.forEach(reward => {
            const item = `
                <div class="p-4 rounded-lg border border-theme flex justify-between items-center bg-opacity-5">
                    <div class="flex-1">
                        <p class="font-semibold">${reward.title}</p>
                        <p class="text-sm text-secondary">${reward.cost} pts: ${reward.description}</p>
                    </div>
                    <div class="flex space-x-2 ml-4">
                        <button onclick="window.redeemReward('${reward.id}')" class="button-primary text-xs py-1 px-2 bg-green-600 hover:bg-green-500">Redeem</button>
                        <button onclick="window.deleteItem('reward', '${reward.id}')" class="text-secondary hover:text-error transition duration-150">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
            rewardListEl.insertAdjacentHTML('beforeend', item);
        });
    }


    // 4. Render Punishments
    const punishmentListEl = document.getElementById('punishment-list');
    punishmentListEl.innerHTML = '';
    document.getElementById('punishments-loading').classList.add('hidden');

    if (gameState.punishments.length === 0) {
        document.getElementById('punishments-loading').classList.remove('hidden');
    } else {
        // Punishments are not sorted by any specific rule
        [...gameState.punishments].forEach(punishment => {
            const item = `
                <div class="p-4 rounded-lg border border-theme flex justify-between items-center bg-opacity-5">
                    <div class="flex-1">
                        <p class="font-semibold">${punishment.title}</p>
                        <p class="text-sm text-secondary">${punishment.description}</p>
                    </div>
                    <div class="flex space-x-2 ml-4">
                        <button onclick="window.assignPunishment('${punishment.id}')" class="button-primary text-xs py-1 px-2 bg-yellow-600 hover:bg-yellow-500 text-black">Assign</button>
                        <button onclick="window.deleteItem('punishment', '${punishment.id}')" class="text-secondary hover:text-error transition duration-150">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
            punishmentListEl.insertAdjacentHTML('beforeend', item);
        });
    }

    // 5. Render History
    const historyLogEl = document.getElementById('history-log');
    historyLogEl.innerHTML = '';
    document.getElementById('history-loading').classList.add('hidden');
    
    if (gameState.history.length === 0) {
        document.getElementById('history-loading').classList.remove('hidden');
    } else {
        // Sort history descending by timestamp
        const sortedHistory = [...gameState.history].sort((a, b) => b.timestamp - a.timestamp);

        sortedHistory.forEach(entry => {
            const playerName = gameState.players[entry.player] || entry.player;
            let icon = '';
            let colorClass = '';

            switch(entry.type) {
                case 'habit_complete':
                    icon = '✅'; colorClass = 'text-green-400';
                    break;
                case 'reward_redeem':
                    icon = '🎁'; colorClass = 'text-blue-400';
                    break;
                case 'punishment_assign':
                    icon = '⚠️'; colorClass = 'text-yellow-400';
                    break;
                case 'player_rename':
                    icon = '✍️'; colorClass = 'text-indigo-400';
                    break;
                case 'admin_add':
                    icon = '➕'; colorClass = 'text-gray-400';
                    break;
                case 'admin_delete':
                    icon = '❌'; colorClass = 'text-gray-400';
                    break;
                default:
                    icon = 'ℹ️'; colorClass = 'text-gray-400';
            }

            const item = `
                <div class="border-b border-theme pb-2">
                    <p class="font-semibold ${colorClass}">${icon} ${entry.message}</p>
                    <p class="text-xs text-secondary italic mt-0.5">
                        ${playerName} - ${formatTimestamp(entry.timestamp)}
                    </p>
                </div>
            `;
            historyLogEl.insertAdjacentHTML('beforeend', item);
        });
    }

    // Ensure the correct tab is displayed after a render
    showTab(document.getElementById('rewards-panel').classList.contains('hidden') ? 'punishments' : 'rewards');
}

/**
 * Adds an entry to the history log and saves the state.
 * @param {string} type - Type of event (e.g., 'habit_complete').
 * @param {string} player - 'keeper' or 'nightingale' or 'admin'.
 * @param {string} message - The message to display.
 */
function addHistoryEntry(type, player, message) {
    gameState.history.push({
        type: type,
        player: player,
        message: message,
        timestamp: Date.now()
    });
    // Limit history size to prevent massive document size
    if (gameState.history.length > 50) {
        // Keep the 50 most recent entries
        gameState.history.sort((a, b) => b.timestamp - a.timestamp);
        gameState.history = gameState.history.slice(0, 50);
    }
    saveGameState();
}


// --- Tab and Form Toggling ---

/**
 * Toggles visibility between Rewards and Punishments tabs.
 * @param {'rewards'|'punishments'} tab - The tab to show.
 */
window.showTab = function(tab) {
    const rewardsPanel = document.getElementById('rewards-panel');
    const punishmentsPanel = document.getElementById('punishments-panel');
    const rewardsButton = document.getElementById('rewards-tab-button');
    const punishmentsButton = document.getElementById('punishments-tab-button');

    // Get the dynamic color for the active tab border from a theme-dependent element (e.g., h1)
    // The h1's color is set by the current theme's H1/H2/H3 color rule.
    const activeColor = window.getComputedStyle(document.querySelector('h1')).color;

    // Reset border color styles 
    rewardsButton.style.borderBottomColor = 'transparent';
    punishmentsButton.style.borderBottomColor = 'transparent';
    
    
    if (tab === 'rewards') {
        rewardsPanel.classList.remove('hidden');
        punishmentsPanel.classList.add('hidden');
        rewardsButton.style.borderBottomColor = activeColor;
    } else {
        punishmentsPanel.classList.remove('hidden');
        rewardsPanel.classList.add('hidden');
        punishmentsButton.style.borderBottomColor = activeColor;
    }
}


/** Toggles visibility of the Habit creation form. */
window.toggleHabitForm = function() {
    document.getElementById('habit-form').classList.toggle('hidden');
}

/** Toggles visibility of the Reward creation form. */
window.toggleRewardForm = function() {
    document.getElementById('reward-form').classList.toggle('hidden');
}

/** Toggles visibility of the Punishment creation form. */
window.togglePunishmentForm = function() {
    document.getElementById('punishment-form').classList.toggle('hidden');
}

/** Shows the rename players modal. */
window.showRenameModal = function() {
    document.getElementById('new-keeper-name').value = gameState.players.keeper;
    document.getElementById('new-nightingale-name').value = gameState.players.nightingale;
    document.getElementById('rename-modal').classList.remove('hidden');
}

/** Hides the rename players modal. */
window.hideRenameModal = function() {
    document.getElementById('rename-modal').classList.add('hidden');
}


// --- Action Handlers ---

/**
 * Saves a new habit to the ledger.
 */
window.saveNewHabit = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value);
    const times = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0 || isNaN(times) || times <= 0) {
        showModal("Invalid Input", "Please provide a valid description, positive points, and times per week.");
        return;
    }

    gameState.habits.push({
        id: generateId(),
        description: desc,
        points: points,
        timesPerWeek: times,
        assignee: assignee,
        // Optional: tracked progress could go here, but keeping it simple for now
    });

    addHistoryEntry('admin_add', 'admin', `New Habit added: ${desc} for ${points} points.`);
    toggleHabitForm();
    // Clear form
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = '10';
    document.getElementById('new-habit-times').value = '1';
}

/**
 * Saves a new reward to the ledger.
 */
window.saveNewReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a valid title, description, and positive cost.");
        return;
    }

    gameState.rewards.push({
        id: generateId(),
        title: title,
        cost: cost,
        description: desc,
    });

    addHistoryEntry('admin_add', 'admin', `New Reward added: ${title} costing ${cost} points.`);
    toggleRewardForm();
    // Clear form
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = '100';
    document.getElementById('new-reward-desc').value = '';
}

/**
 * Saves a new punishment to the ledger.
 */
window.saveNewPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Invalid Input", "Please provide a valid title and description for the punishment.");
        return;
    }

    gameState.punishments.push({
        id: generateId(),
        title: title,
        description: desc,
    });

    addHistoryEntry('admin_add', 'admin', `New Punishment added: ${title}.`);
    togglePunishmentForm();
    // Clear form
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
}

/**
 * Marks a habit as complete, updates the score, and logs the action.
 * @param {string} habitId 
 */
window.completeHabit = function(habitId) {
    const habitIndex = gameState.habits.findIndex(h => h.id === habitId);

    if (habitIndex === -1) {
        showModal("Error", "Habit not found.");
        return;
    }

    const habit = gameState.habits[habitIndex];
    
    // Update score
    gameState.scores[habit.assignee] += habit.points;
    
    // Log history
    const playerName = gameState.players[habit.assignee];
    addHistoryEntry('habit_complete', habit.assignee, `${playerName} completed '${habit.description}' for ${habit.points} points.`);
    
    // Save state (render is called via snapshot listener)
    saveGameState();
}

/**
 * Redeems a reward, deducts the cost from the score, and logs the action.
 * @param {string} rewardId 
 */
window.redeemReward = function(rewardId) {
    const reward = gameState.rewards.find(r => r.id === rewardId);

    if (!reward) {
        showModal("Error", "Reward not found.");
        return;
    }
    
    // Prompt for who is redeeming the reward
    const redeemingPlayer = prompt(`Who is redeeming the reward "${reward.title}" (Cost: ${reward.cost} pts)?\n\nPlease enter the player's name (e.g., ${gameState.players.keeper} or ${gameState.players.nightingale}):`);
    
    if (redeemingPlayer === null) return;

    let redeemingRole = null;
    let payingRole = null;

    if (redeemingPlayer.toLowerCase() === gameState.players.keeper.toLowerCase()) {
        redeemingRole = 'keeper';
        payingRole = 'nightingale';
    } else if (redeemingPlayer.toLowerCase() === gameState.players.nightingale.toLowerCase()) {
        redeemingRole = 'nightingale';
        payingRole = 'keeper';
    } else {
        showModal("Invalid Input", "Please enter a valid player name (Keeper or Nightingale's name).");
        return;
    }

    if (gameState.scores[payingRole] < reward.cost) {
        showModal("Insufficient Points", `${gameState.players[payingRole]} only has ${gameState.scores[payingRole]} points, but the reward costs ${reward.cost}.`);
        return;
    }

    // Deduct score
    gameState.scores[payingRole] -= reward.cost;

    // Log history
    addHistoryEntry('reward_redeem', redeemingRole, `${gameState.players[redeemingRole]} redeemed '${reward.title}'. ${gameState.players[payingRole]}'s score was deducted by ${reward.cost} points.`);
    
    saveGameState();
}


/**
 * Assigns a punishment, deducts a penalty, and logs the action.
 * @param {string} punishmentId 
 */
window.assignPunishment = function(punishmentId) {
    const punishment = gameState.punishments.find(p => p.id === punishmentId);

    if (!punishment) {
        showModal("Error", "Punishment not found.");
        return;
    }
    
    // Prompt for who is receiving the punishment
    const receivingPlayer = prompt(`Who is RECEIVING this punishment: "${punishment.title}"?\n\nPlease enter the player's name (e.g., ${gameState.players.keeper} or ${gameState.players.nightingale}):`);
    
    if (receivingPlayer === null) return;

    let receivingRole = null;
    
    if (receivingPlayer.toLowerCase() === gameState.players.keeper.toLowerCase()) {
        receivingRole = 'keeper';
    } else if (receivingPlayer.toLowerCase() === gameState.players.nightingale.toLowerCase()) {
        receivingRole = 'nightingale';
    } else {
        showModal("Invalid Input", "Please enter a valid player name (Keeper or Nightingale's name).");
        return;
    }

    // Log history
    addHistoryEntry('punishment_assign', 'admin', `${gameState.players[receivingRole]} was assigned punishment: '${punishment.title}'.`);
    
    saveGameState();
}

/**
 * Deletes a habit, reward, or punishment item.
 * @param {'habit'|'reward'|'punishment'} type 
 * @param {string} itemId 
 */
window.deleteItem = function(type, itemId) {
    const collection = gameState[`${type}s`];
    const itemIndex = collection.findIndex(item => item.id === itemId);

    if (itemIndex === -1) {
        showModal("Error", `${type} not found.`);
        return;
    }
    
    const itemName = collection[itemIndex].description || collection[itemIndex].title;

    // Remove item
    collection.splice(itemIndex, 1);
    
    // Log history
    addHistoryEntry('admin_delete', 'admin', `${type.charAt(0).toUpperCase() + type.slice(1)} deleted: ${itemName}.`);

    saveGameState();
}


/**
 * Saves the new player names and updates the state.
 */
window.saveNewNames = function() {
    const newKeeper = document.getElementById('new-keeper-name').value.trim();
    const newNightingale = document.getElementById('new-nightingale-name').value.trim();

    if (!newKeeper || !newNightingale) {
        showModal("Invalid Input", "Both player names must be provided.");
        return;
    }

    const oldKeeper = gameState.players.keeper;
    const oldNightingale = gameState.players.nightingale;

    gameState.players.keeper = newKeeper;
    gameState.players.nightingale = newNightingale;

    addHistoryEntry('player_rename', 'admin', `Names updated: ${oldKeeper} -> ${newKeeper} and ${oldNightingale} -> ${newNightingale}.`);
    
    hideRenameModal();
    saveGameState();
}


/**
 * Populates a form with an example item from the EXAMPLE_DATABASE.
 * @param {'habit'|'reward'|'punishment'} type - The type of item to generate.
 */
window.populateExample = function(type) {
    if (typeof EXAMPLE_DATABASE === 'undefined') {
        showModal("Error", "Example database not loaded. Cannot generate example.");
        return;
    }

    const examples = EXAMPLE_DATABASE[`${type}s`];
    if (!examples || examples.length === 0) {
        showModal("Error", "No examples available for this item type.");
        return;
    }

    // Pick a random example
    const example = examples[Math.floor(Math.random() * examples.length)];

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