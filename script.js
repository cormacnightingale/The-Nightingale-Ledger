import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
let ledgerId = null; // New variable to hold the shared ledger code
const GAME_STATE_DOC_ID = 'ledger_data';
const INITIAL_GAME_STATE = {
    players: {
        keeper: 'Keeper',
        nightingale: 'Nightingale'
    },
    scores: {
        keeper: 0,
        nightingale: 0
    },
    habits: [],
    rewards: [],
    punishments: [],
};
let gameState = { ...INITIAL_GAME_STATE };
let unsubscribeSnapshot = null; // Stores the function to stop listening

// --- Utility Functions ---

/**
 * Creates a simple, 6-character alphanumeric code for the ledger ID.
 * @returns {string} The unique code.
 */
function generateLedgerCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Shows a custom modal/alert message.
 * @param {string} title The title of the alert.
 * @param {string} message The body message.
 */
window.showModal = function(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;
    document.getElementById('modal-container').classList.remove('hidden');
}

/**
 * Closes the custom modal/alert message.
 */
window.closeModal = function() {
    document.getElementById('modal-container').classList.add('hidden');
}

/**
 * Copies the text content of a given element ID to the clipboard.
 * @param {string} elementId The ID of the element whose text to copy.
 */
window.copyToClipboard = function(elementId) {
    const textToCopy = document.getElementById(elementId).textContent;
    // Use the older execCommand for better iframe compatibility
    const el = document.createElement('textarea');
    el.value = textToCopy;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    try {
        document.execCommand('copy');
        document.getElementById('new-ledger-info').classList.add('border-green-400');
        document.getElementById('new-ledger-info').classList.remove('border-[#b05c6c]');
        // Briefly show a success message
        document.getElementById('display-ledger-code').textContent = 'COPIED!';
        setTimeout(() => {
            document.getElementById('display-ledger-code').textContent = textToCopy;
            document.getElementById('new-ledger-info').classList.remove('border-green-400');
            document.getElementById('new-ledger-info').classList.add('border-[#b05c6c]');
        }, 1500);
    } catch (err) {
        console.error('Copy failed:', err);
    }
    document.body.removeChild(el);
};

/**
 * Updates the UI based on the current game state and ledger status.
 */
function updateUI() {
    // Hide/Show screens
    if (ledgerId) {
        document.getElementById('ledger-setup-screen').classList.add('hidden');
        document.getElementById('game-content').classList.remove('hidden');
        document.getElementById('current-ledger-id').textContent = ledgerId;
    } else {
        document.getElementById('ledger-setup-screen').classList.remove('hidden');
        document.getElementById('game-content').classList.add('hidden');
    }

    // Update scoreboard
    document.getElementById('keeper-name').textContent = gameState.players.keeper || 'Keeper';
    document.getElementById('nightingale-name').textContent = gameState.players.nightingale || 'Nightingale';
    document.getElementById('keeper-score').textContent = gameState.scores.keeper.toLocaleString();
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale.toLocaleString();

    // Update player name inputs
    document.getElementById('keeper-input').value = gameState.players.keeper || '';
    document.getElementById('nightingale-input').value = gameState.players.nightingale || '';

    // Update debug path
    const docPath = ledgerId ? `artifacts/${appId}/public/data/ledgers/${ledgerId}/${GAME_STATE_DOC_ID}` : 'N/A';
    document.getElementById('debug-doc-path').textContent = docPath;
    
    // Render all lists
    renderHabits();
    renderRewards();
    renderPunishments();
}

/**
 * Handles the logic for joining an existing ledger.
 */
window.joinLedger = function() {
    const inputCode = document.getElementById('ledger-code-input').value.trim().toUpperCase();
    const messageBox = document.getElementById('setup-message-box');

    if (inputCode.length !== 6) {
        messageBox.classList.remove('hidden', 'bg-green-600', 'bg-red-600');
        messageBox.classList.add('bg-red-600');
        messageBox.textContent = "Please enter a 6-character code.";
        return;
    }

    // Check if the ledger code exists before joining
    const LEDGER_DOC_PATH = `artifacts/${appId}/public/data/ledgers/${inputCode}`;
    const docRef = doc(db, LEDGER_DOC_PATH, GAME_STATE_DOC_ID);
    
    getDoc(docRef).then(docSnap => {
        if (docSnap.exists()) {
            ledgerId = inputCode;
            messageBox.classList.remove('hidden', 'bg-red-600');
            messageBox.classList.add('bg-green-600');
            messageBox.textContent = `Successfully joined ledger: ${ledgerId}`;
            loadLedgerData(true); // Start listening to the data
        } else {
            messageBox.classList.remove('hidden', 'bg-green-600');
            messageBox.classList.add('bg-red-600');
            messageBox.textContent = `Ledger code "${inputCode}" not found. Try hosting a new one.`;
        }
    }).catch(error => {
        console.error("Error checking ledger existence:", error);
        messageBox.classList.remove('hidden', 'bg-green-600');
        messageBox.classList.add('bg-red-600');
        messageBox.textContent = "Failed to connect to the database. Check console for details.";
    });
};

/**
 * Handles the logic for hosting a new ledger.
 */
window.hostNewLedger = function() {
    const newCode = generateLedgerCode();
    ledgerId = newCode;
    const messageBox = document.getElementById('setup-message-box');
    
    // Path for the new document
    const LEDGER_DOC_PATH = `artifacts/${appId}/public/data/ledgers/${ledgerId}`;
    const docRef = doc(db, LEDGER_DOC_PATH, GAME_STATE_DOC_ID);

    // Initial game state data
    const initialData = {
        ...INITIAL_GAME_STATE,
        // Add a timestamp for creation
        createdAt: new Date().toISOString(),
    };

    setDoc(docRef, initialData)
        .then(() => {
            messageBox.classList.remove('hidden', 'bg-red-600');
            messageBox.classList.add('bg-green-600');
            messageBox.textContent = "New Ledger Hosted! Share the code with your partner.";
            
            // Display the new code
            document.getElementById('display-ledger-code').textContent = ledgerId;
            document.getElementById('new-ledger-info').classList.remove('hidden');
            
            // Start listening to the new data
            loadLedgerData(true);
        })
        .catch(error => {
            console.error("Error hosting new ledger:", error);
            messageBox.classList.remove('hidden', 'bg-green-600');
            messageBox.classList.add('bg-red-600');
            messageBox.textContent = "Failed to host new ledger. Check console for details.";
        });
};


// --- Firebase Logic ---

/**
 * Sets up the real-time listener for the game state document.
 * This is the function that was failing due to missing/incorrect path/permissions.
 */
function setupGameSnapshotListener() {
    // Ensure previous listener is unsubscribed
    if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
    }
    
    if (!ledgerId) {
        console.error("Cannot set up snapshot listener: ledgerId is null.");
        return;
    }

    // **CRITICAL FIX**: Use the correct public path structure for shared data
    const LEDGER_DOC_PATH = `artifacts/${appId}/public/data/ledgers/${ledgerId}`;
    const docRef = doc(db, LEDGER_DOC_PATH, GAME_STATE_DOC_ID);

    console.log(`Listening to document: ${LEDGER_DOC_PATH}/${GAME_STATE_DOC_ID}`);
    document.getElementById('habits-loading').textContent = 'Loading data...';

    unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            gameState = docSnap.data();
            console.log("Real-time data received:", gameState);
            // Ensure lists are initialized if missing in Firestore document (e.g., initial state)
            gameState.habits = gameState.habits || [];
            gameState.rewards = gameState.rewards || [];
            gameState.punishments = gameState.punishments || [];
            updateUI();
        } else {
            console.warn("Ledger document does not exist yet. Using default state.");
            gameState = { ...INITIAL_GAME_STATE };
            updateUI();
        }
    }, (error) => {
        // This is the error handler that was logging the permission issue
        const errorMessage = `Error listening to document: ${error.message}`;
        console.error(errorMessage);
        document.getElementById('habits-loading').textContent = 'Data Error';
        showModal("Data Error", `Failed to load real-time data from the ledger.<br><br><code>${errorMessage}</code>`);
    });
}

/**
 * Tries to load existing data and sets up the real-time listener.
 * @param {boolean} forceStartListener If true, immediately sets up the listener.
 */
function loadLedgerData(forceStartListener = false) {
    if (ledgerId && forceStartListener) {
        setupGameSnapshotListener();
    }
}

/**
 * Initializes Firebase, performs authentication, and sets up the UI flow.
 */
async function initFirebaseAndUI() {
    if (!firebaseConfig) {
        showModal("Configuration Error", "Firebase configuration is missing. Cannot run application.");
        return;
    }
    
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Sign in using the custom token if available, otherwise sign in anonymously.
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        // Auth state observer to set the user ID once signed in
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('current-user-id').textContent = userId;
                document.getElementById('current-app-id').textContent = appId;
                console.log("Firebase initialized. User ID:", userId);
                
                // Now that we have a user, show the ledger setup screen by default
                // The ledger setup buttons will then call hostNewLedger or joinLedger
                updateUI();
            } else {
                // If not signed in (shouldn't happen with anonymous fallback, but safe check)
                userId = null;
                document.getElementById('current-user-id').textContent = 'Anonymous';
            }
        });

    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        showModal("Fatal Error", `Failed to initialize Firebase services. ${error.message}`);
    }
}

// --- Data Modification Functions ---

/**
 * Updates a simple top-level player name.
 * @param {'keeper'|'nightingale'} role 
 * @param {string} name 
 */
window.updatePlayerName = function(role, name) {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");
    const newPlayers = { ...gameState.players, [role]: name };
    updateGameState({ players: newPlayers });
}

/**
 * Commits changes to the Firestore document.
 * @param {object} updates An object containing fields to update.
 */
async function updateGameState(updates) {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");

    const LEDGER_DOC_PATH = `artifacts/${appId}/public/data/ledgers/${ledgerId}`;
    const docRef = doc(db, LEDGER_DOC_PATH, GAME_STATE_DOC_ID);
    
    try {
        await updateDoc(docRef, updates);
        // Success handled by the real-time snapshot listener
    } catch (error) {
        console.error("Error updating game state:", error);
        showModal("Save Error", `Failed to save changes: ${error.message}`);
    }
}

// --- Habit Management ---

window.toggleHabitForm = function() {
    document.getElementById('new-habit-form').classList.toggle('hidden');
}

window.addHabit = function() {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");
    const description = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const timesPerDay = parseInt(document.getElementById('new-habit-times').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!description || isNaN(points) || points <= 0 || isNaN(timesPerDay) || timesPerDay <= 0) {
        showModal("Input Error", "Please ensure the habit description, points, and times per day are valid.");
        return;
    }

    const newHabit = {
        id: crypto.randomUUID(),
        description,
        points,
        timesPerDay,
        assignee,
        completedToday: 0,
        lastCompleted: null
    };

    const newHabits = [...gameState.habits, newHabit];
    updateGameState({ habits: newHabits });

    // Clear form after submission
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = 10;
    document.getElementById('new-habit-times').value = 1;
    window.toggleHabitForm();
}

window.completeHabit = function(habitId) {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");

    const habitIndex = gameState.habits.findIndex(h => h.id === habitId);
    if (habitIndex === -1) return;

    const habitsCopy = [...gameState.habits];
    const habit = habitsCopy[habitIndex];

    const today = new Date().toDateString();
    
    // Check if the habit was completed today
    if (habit.lastCompleted === today && habit.completedToday >= habit.timesPerDay) {
        showModal("Limit Reached", `The habit "${habit.description}" has already been completed the maximum ${habit.timesPerDay} time(s) today.`);
        return;
    }

    // Reset count if it's a new day
    if (habit.lastCompleted !== today) {
        habit.completedToday = 0;
    }

    habit.completedToday += 1;
    habit.lastCompleted = today;

    // Update score
    const role = habit.assignee;
    const newScore = gameState.scores[role] + habit.points;
    const newScores = { ...gameState.scores, [role]: newScore };

    updateGameState({ habits: habitsCopy, scores: newScores });
}

window.deleteHabit = function(habitId) {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");

    const newHabits = gameState.habits.filter(h => h.id !== habitId);
    updateGameState({ habits: newHabits });
}

function renderHabits() {
    const listElement = document.getElementById('habits-list');
    listElement.innerHTML = '';
    document.getElementById('habit-count').textContent = ` (${gameState.habits.length} Total)`;

    if (gameState.habits.length === 0) {
        listElement.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No habits defined yet.</p>';
        return;
    }

    const today = new Date().toDateString();

    gameState.habits.forEach(habit => {
        // Calculate completion status
        const completed = habit.lastCompleted === today ? habit.completedToday : 0;
        const isComplete = completed >= habit.timesPerDay;

        const roleClass = habit.assignee === 'keeper' ? 'bg-green-700' : 'bg-blue-700';
        const roleText = habit.assignee === 'keeper' ? 'Keeper' : 'Nightingale';
        const progressColor = habit.assignee === 'keeper' ? 'text-green-400' : 'text-blue-400';
        
        // Disable button if max completions for today reached
        const buttonDisabled = isComplete ? 'opacity-50 cursor-not-allowed' : '';
        const completeAction = isComplete ? '' : `onclick="window.completeHabit('${habit.id}')"`;

        const habitItem = `
            <div class="card p-4 border ${roleClass} bg-opacity-30 flex items-center justify-between transition duration-200 hover:bg-opacity-50">
                <div class="flex-1 mr-4">
                    <p class="text-lg font-semibold">${habit.description}</p>
                    <p class="text-xs text-gray-400 font-sans mt-1">
                        Assigned to: <span class="font-bold">${roleText}</span> | 
                        Worth: <span class="font-bold text-white">${habit.points} pts</span>
                    </p>
                    <p class="text-sm ${progressColor} font-sans mt-2">
                        Progress: <span class="font-bold">${completed} / ${habit.timesPerDay}</span> completed today
                    </p>
                </div>
                <div class="flex space-x-2">
                    <button ${completeAction} class="btn-secondary rounded-full p-2 text-white text-xs font-sans ${buttonDisabled}">
                        ${isComplete ? 'DONE' : 'Complete +'}
                    </button>
                    <button onclick="window.deleteHabit('${habit.id}')" class="text-gray-500 hover:text-red-500 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5 0a1 1 0 10-2 0v6a1 1 0 102 0V8z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>
        `;
        listElement.innerHTML += habitItem;
    });
}

// --- Reward Management ---

window.toggleRewardForm = function() {
    document.getElementById('new-reward-form').classList.toggle('hidden');
}

window.addReward = function() {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const description = document.getElementById('new-reward-desc').value.trim();

    if (!title || !description || isNaN(cost) || cost <= 0) {
        showModal("Input Error", "Please ensure the reward title, description, and cost are valid.");
        return;
    }

    const newReward = {
        id: crypto.randomUUID(),
        title,
        cost,
        description,
        claimed: 0
    };

    const newRewards = [...gameState.rewards, newReward];
    updateGameState({ rewards: newRewards });

    // Clear form after submission
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = 50;
    document.getElementById('new-reward-desc').value = '';
    window.toggleRewardForm();
}

window.claimReward = function(rewardId) {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");

    const rewardIndex = gameState.rewards.findIndex(r => r.id === rewardId);
    if (rewardIndex === -1) return;

    const reward = gameState.rewards[rewardIndex];
    const nightingaleScore = gameState.scores.nightingale;

    if (nightingaleScore < reward.cost) {
        showModal("Insufficient Points", `Nightingale requires ${reward.cost} points but currently only has ${nightingaleScore} points.`);
        return;
    }

    const newScore = nightingaleScore - reward.cost;
    const newScores = { ...gameState.scores, nightingale: newScore };
    
    // Mark reward as claimed (optional, but good for tracking)
    const rewardsCopy = [...gameState.rewards];
    rewardsCopy[rewardIndex].claimed += 1;

    showModal("Reward Claimed!", `Nightingale has claimed "${reward.title}" for ${reward.cost} points. The reward must now be administered by the Keeper.`);

    updateGameState({ scores: newScores, rewards: rewardsCopy });
}

window.deleteReward = function(rewardId) {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");

    const newRewards = gameState.rewards.filter(r => r.id !== rewardId);
    updateGameState({ rewards: newRewards });
}

function renderRewards() {
    const listElement = document.getElementById('rewards-list');
    listElement.innerHTML = '';
    document.getElementById('reward-count').textContent = ` (${gameState.rewards.length} Total)`;

    if (gameState.rewards.length === 0) {
        listElement.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No rewards defined yet.</p>';
        return;
    }

    const nightingaleScore = gameState.scores.nightingale;

    gameState.rewards.forEach(reward => {
        const canAfford = nightingaleScore >= reward.cost;
        const buttonClass = canAfford ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed';
        const claimAction = canAfford ? `onclick="window.claimReward('${reward.id}')"` : '';

        const rewardItem = `
            <div class="card p-4 bg-[#1a1a1d] border border-gray-700 flex justify-between items-center">
                <div class="flex-1 mr-4">
                    <p class="text-lg font-semibold">${reward.title} <span class="text-xs font-sans text-gray-500">(${reward.claimed} claimed)</span></p>
                    <p class="text-sm text-gray-400 font-sans italic mt-1">${reward.description}</p>
                </div>
                <div class="text-right">
                    <p class="text-xl font-bold text-yellow-400 mb-2">${reward.cost} pts</p>
                    <div class="flex space-x-2">
                        <button ${claimAction} class="${buttonClass} rounded-lg p-2 text-xs font-sans">
                            Claim
                        </button>
                        <button onclick="window.deleteReward('${reward.id}')" class="text-gray-500 hover:text-red-500 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5 0a1 1 0 10-2 0v6a1 1 0 102 0V8z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
        listElement.innerHTML += rewardItem;
    });
}

// --- Punishment Management ---

window.togglePunishmentForm = function() {
    document.getElementById('new-punishment-form').classList.toggle('hidden');
}

window.addPunishment = function() {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");
    const title = document.getElementById('new-punishment-title').value.trim();
    const description = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !description) {
        showModal("Input Error", "Please ensure the punishment title and description are valid.");
        return;
    }

    const newPunishment = {
        id: crypto.randomUUID(),
        title,
        description,
        isOwed: false
    };

    const newPunishments = [...gameState.punishments, newPunishment];
    updateGameState({ punishments: newPunishments });

    // Clear form after submission
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    window.togglePunishmentForm();
}

window.assignPunishment = function(punishmentId, isOwed) {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");

    const punishmentIndex = gameState.punishments.findIndex(p => p.id === punishmentId);
    if (punishmentIndex === -1) return;

    const punishmentsCopy = [...gameState.punishments];
    punishmentsCopy[punishmentIndex].isOwed = isOwed;

    if (isOwed) {
        showModal("Punishment Assigned!", `The punishment "${punishmentsCopy[punishmentIndex].title}" has been assigned to Nightingale. Keep an eye on its completion!`);
    } else {
        showModal("Punishment Completed", `The punishment "${punishmentsCopy[punishmentIndex].title}" has been marked as completed.`);
    }

    updateGameState({ punishments: punishmentsCopy });
}

window.deletePunishment = function(punishmentId) {
    if (!ledgerId) return showModal("Action Required", "Please join or host a ledger first.");

    const newPunishments = gameState.punishments.filter(p => p.id !== punishmentId);
    updateGameState({ punishments: newPunishments });
}

function renderPunishments() {
    const listElement = document.getElementById('punishments-list');
    listElement.innerHTML = '';
    document.getElementById('punishment-count').textContent = ` (${gameState.punishments.length} Total)`;

    if (gameState.punishments.length === 0) {
        listElement.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No punishments defined yet.</p>';
        return;
    }

    gameState.punishments.forEach(punishment => {
        const statusText = punishment.isOwed ? 'OWED' : 'READY';
        const statusClass = punishment.isOwed ? 'bg-red-700' : 'bg-gray-600';
        const buttonText = punishment.isOwed ? 'Mark Complete' : 'Assign to Nightingale';
        const buttonAction = punishment.isOwed ? `onclick="window.assignPunishment('${punishment.id}', false)"` : `onclick="window.assignPunishment('${punishment.id}', true)"`;

        const punishmentItem = `
            <div class="card p-4 bg-[#1a1a1d] border border-gray-700 flex justify-between items-center">
                <div class="flex-1 mr-4">
                    <p class="text-lg font-semibold">${punishment.title}</p>
                    <p class="text-sm text-gray-400 font-sans italic mt-1">${punishment.description}</p>
                    <span class="text-xs font-sans mt-2 inline-block px-2 py-1 rounded ${statusClass}">${statusText}</span>
                </div>
                <div class="flex space-x-2">
                    <button ${buttonAction} class="btn-secondary rounded-lg p-2 text-xs font-sans">
                        ${buttonText}
                    </button>
                    <button onclick="window.deletePunishment('${punishment.id}')" class="text-gray-500 hover:text-red-500 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5 0a1 1 0 10-2 0v6a1 1 0 102 0V8z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>
        `;
        listElement.innerHTML += punishmentItem;
    });
}

// --- Example Generation (Existing Function) ---

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

// Start the application
initFirebaseAndUI();