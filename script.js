import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, query, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Standard Web Deployment) ---

// MANDATORY: Use __app_id and __firebase_config from the canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;

// Initial auth token is provided by the environment
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 


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
    const modal = document.getElementById('custom-modal');
    if (!modal) {
        console.error("Modal element 'custom-modal' not found.");
        return;
    }
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.add('opacity-100');
    }, 10);
}

window.closeModal = function() {
    const modal = document.getElementById('custom-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}


/**
 * Toggles the visibility of the new habit form.
 */
window.toggleHabitForm = function() {
    const form = document.getElementById('habit-form');
    const button = document.getElementById('add-habit-button');
    
    if (button) {
        button.classList.toggle('hidden'); 
    }
    if (form) {
        form.classList.toggle('hidden');
    }
};

/**
 * Toggles the visibility of the new reward form.
 */
window.toggleRewardForm = function() {
    const form = document.getElementById('reward-form');
    const button = document.getElementById('add-reward-button');

    if (button) {
        button.classList.toggle('hidden');
    }
    if (form) {
        form.classList.toggle('hidden');
    }
};

/**
 * Toggles the visibility of the new punishment form.
 */
window.togglePunishmentForm = function() {
    const form = document.getElementById('punishment-form');
    const button = document.getElementById('add-punishment-button');

    if (button) {
        button.classList.toggle('hidden');
    }
    if (form) {
        form.classList.toggle('hidden');
    }
};

/**
 * Safely switches the UI between loading screen and main content.
 * @param {boolean} showMain True to show main content, false to show loading screen.
 */
function updateLoadingScreen(showMain) {
    const loadingScreen = document.getElementById('loading-screen');
    const mainContent = document.getElementById('main-content');
    
    if (loadingScreen) {
        if (showMain) {
            loadingScreen.classList.add('hidden');
        } else {
            loadingScreen.classList.remove('hidden');
        }
    }
    if (mainContent) {
        if (showMain) {
            mainContent.classList.remove('hidden');
        } else {
            mainContent.classList.add('hidden');
        }
    }
}


/**
 * Renders the current game state to the UI.
 */
function renderApp(state) {
    gameState = state; // Update global state
    
    // 1. Render Scores
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;

    // 2. Render Player Names
    document.getElementById('keeper-name').textContent = gameState.players.keeper;
    document.getElementById('nightingale-name').textContent = gameState.players.nightingale;
    
    // 3. Render User ID (for debugging/sharing)
    const userIdDisplay = document.getElementById('current-user-id');
    if (userIdDisplay) {
        userIdDisplay.textContent = userId || 'N/A';
    }
    const appIdDisplay = document.getElementById('current-app-id');
    if (appIdDisplay) {
        appIdDisplay.textContent = appId;
    }

    // 4. Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = ''; // Clear previous content

    if (gameState.habits.length === 0) {
        habitsList.innerHTML = `<p class="text-gray-500 italic" id="habits-loading">No habits defined yet.</p>`;
    } else {
        gameState.habits.forEach(habit => {
            const el = document.createElement('div');
            el.className = 'card p-3 flex justify-between items-center space-x-4 mb-2';
            el.innerHTML = `
                <div>
                    <h4 class="text-lg font-cinzel text-[#d4d4dc]">${habit.description}</h4>
                    <p class="text-sm text-gray-400">
                        ${habit.points} pts | ${habit.times} time${habit.times > 1 ? 's' : ''} / ${habit.frequency}
                    </p>
                </div>
                <div class="flex items-center space-x-2">
                    <span class="text-sm font-bold badge badge-${habit.assignee}">
                        ${habit.assignee.charAt(0).toUpperCase() + habit.assignee.slice(1)}
                    </span>
                    <button onclick="recordHabit('${habit.id}', 1)" class="btn-success text-xs py-1 px-3">
                        Done
                    </button>
                    <button onclick="deleteItem('habits', '${habit.id}')" class="btn-danger text-xs py-1 px-3">
                        X
                    </button>
                </div>
            `;
            habitsList.appendChild(el);
        });
    }


    // 5. Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    
    if (gameState.rewards.length === 0) {
        rewardsList.innerHTML = `<p class="text-gray-500 italic" id="rewards-loading">No rewards defined yet.</p>`;
    } else {
        gameState.rewards.forEach(reward => {
            const el = document.createElement('div');
            el.className = 'card p-3 flex justify-between items-center space-x-4 mb-2';
            el.innerHTML = `
                <div>
                    <h4 class="text-lg font-cinzel text-[#d4d4dc]">${reward.title}</h4>
                    <p class="text-sm text-gray-400">${reward.description}</p>
                </div>
                <div class="flex items-center space-x-2">
                    <span class="text-sm font-bold badge badge-reward">${reward.cost} pts</span>
                    <button onclick="redeemReward('${reward.id}')" class="btn-primary text-xs py-1 px-3">
                        Redeem
                    </button>
                    <button onclick="deleteItem('rewards', '${reward.id}')" class="btn-danger text-xs py-1 px-3">
                        X
                    </button>
                </div>
            `;
            rewardsList.appendChild(el);
        });
    }

    // 6. Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    
    if (gameState.punishments.length === 0) {
        punishmentsList.innerHTML = `<p class="text-gray-500 italic" id="punishments-loading">No punishments defined yet.</p>`;
    } else {
        gameState.punishments.forEach(punishment => {
            const el = document.createElement('div');
            el.className = 'card p-3 flex justify-between items-center space-x-4 mb-2';
            el.innerHTML = `
                <div>
                    <h4 class="text-lg font-cinzel text-[#d4d4dc]">${punishment.title}</h4>
                    <p class="text-sm text-gray-400">${punishment.description}</p>
                </div>
                <div class="flex items-center space-x-2">
                    <button onclick="assignPunishment('${punishment.id}')" class="btn-warning text-xs py-1 px-3">
                        Assign
                    </button>
                    <button onclick="deleteItem('punishments', '${punishment.id}')" class="btn-danger text-xs py-1 px-3">
                        X
                    </button>
                </div>
            `;
            punishmentsList.appendChild(el);
        });
    }

    // 7. Render History (Simplified)
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    
    // Reverse history to show most recent first
    const recentHistory = [...gameState.history].reverse().slice(0, 5); 

    if (recentHistory.length === 0) {
        historyList.innerHTML = `<p class="text-gray-500 italic">No activity recorded yet.</p>`;
    } else {
        recentHistory.forEach(entry => {
            const date = new Date(entry.timestamp).toLocaleTimeString();
            let text = '';
            let colorClass = '';

            switch(entry.type) {
                case 'habit':
                    text = `${entry.player} earned ${entry.points} pts for completing "${entry.item.description}"`;
                    colorClass = 'text-green-400';
                    break;
                case 'reward':
                    text = `${entry.player} spent ${entry.cost} pts to redeem "${entry.item.title}"`;
                    colorClass = 'text-blue-400';
                    break;
                case 'punishment':
                    text = `${entry.player} was assigned the punishment: "${entry.item.title}"`;
                    colorClass = 'text-red-400';
                    break;
                default:
                    text = 'Ledger reset or initialization.';
                    colorClass = 'text-gray-400';
            }

            const el = document.createElement('li');
            el.className = 'text-sm mb-1';
            el.innerHTML = `<span class="text-gray-500 mr-2">[${date}]</span> <span class="${colorClass}">${text}</span>`;
            historyList.appendChild(el);
        });
    }

    // Hide loading screen and show main content
    updateLoadingScreen(true);
}

/**
 * Updates the Firestore document with the new game state.
 * @param {object} newState The full new state object.
 */
async function updateStateInFirestore(newState) {
    if (!db || !GAME_STATE_PATH) {
        console.error("Firestore not initialized or path is missing.");
        return;
    }
    try {
        await setDoc(doc(db, GAME_STATE_PATH), newState);
        // State update is handled by the onSnapshot listener, so no need to rerender here.
    } catch (error) {
        console.error("Error updating document: ", error);
        showModal("Update Error", `Failed to save changes: ${error.message}`);
    }
}

/**
 * Handles recording a completed habit.
 * @param {string} habitId 
 * @param {number} times
 */
window.recordHabit = async function(habitId, times = 1) {
    const habit = gameState.habits.find(h => h.id === habitId);
    if (!habit) {
        showModal("Error", "Habit not found.");
        return;
    }

    const playerRole = habit.assignee; // keeper or nightingale
    const pointsEarned = habit.points * times;

    const newScores = { ...gameState.scores };
    newScores[playerRole] += pointsEarned;

    // Create history entry
    const newHistoryEntry = {
        timestamp: Date.now(),
        type: 'habit',
        player: gameState.players[playerRole],
        points: pointsEarned,
        item: { description: habit.description }
    };

    const newHabits = gameState.habits.map(h => {
        if (h.id === habitId) {
            // Decrement remaining times if frequency is not 'daily' or 'any'
            if (h.frequency !== 'daily' && h.frequency !== 'any' && h.remainingTimes) {
                h.remainingTimes -= times;
            }
        }
        return h;
    });

    // Remove habit if it was limited and remainingTimes <= 0
    const finalHabits = newHabits.filter(h => 
        (h.frequency !== 'once' && h.remainingTimes === undefined) || h.remainingTimes > 0
    );


    const newState = {
        ...gameState,
        scores: newScores,
        habits: finalHabits,
        history: [...gameState.history, newHistoryEntry]
    };

    await updateStateInFirestore(newState);
};

/**
 * Handles redeeming a reward.
 * @param {string} rewardId 
 */
window.redeemReward = async function(rewardId) {
    const reward = gameState.rewards.find(r => r.id === rewardId);
    if (!reward) {
        showModal("Error", "Reward not found.");
        return;
    }

    // Check which player can afford this reward. It should be the *other* player who benefits.
    // Assuming 'Keeper' redeems for 'Nightingale' and vice-versa (or the person who performs the habit earns for self)
    // For simplicity, let's assume the user who is signed in is redeeming it for themselves.
    const playerToRedeem = prompt("Are you the 'keeper' or the 'nightingale'? (Case sensitive)");
    if (!playerToRedeem || (playerToRedeem !== 'keeper' && playerToRedeem !== 'nightingale')) {
        showModal("Redemption Failed", "Invalid player role entered.");
        return;
    }

    const playerRole = playerToRedeem; 
    const currentScore = gameState.scores[playerRole];

    if (currentScore < reward.cost) {
        showModal("Redemption Failed", `${gameState.players[playerRole]} only has ${currentScore} points, but this reward costs ${reward.cost} points.`);
        return;
    }

    const newScores = { ...gameState.scores };
    newScores[playerRole] -= reward.cost;

    // Create history entry
    const newHistoryEntry = {
        timestamp: Date.now(),
        type: 'reward',
        player: gameState.players[playerRole],
        cost: reward.cost,
        item: { title: reward.title }
    };

    // Rewards are one-time use, so remove it
    const newRewards = gameState.rewards.filter(r => r.id !== rewardId);

    const newState = {
        ...gameState,
        scores: newScores,
        rewards: newRewards,
        history: [...gameState.history, newHistoryEntry]
    };

    await updateStateInFirestore(newState);
};

/**
 * Handles assigning a punishment. No points change, just history.
 * @param {string} punishmentId 
 */
window.assignPunishment = async function(punishmentId) {
    const punishment = gameState.punishments.find(p => p.id === punishmentId);
    if (!punishment) {
        showModal("Error", "Punishment not found.");
        return;
    }

    // Ask which player is receiving the punishment
    const playerToPunish = prompt("Which player is receiving this punishment: 'keeper' or 'nightingale'? (Case sensitive)");
    if (!playerToPunish || (playerToPunish !== 'keeper' && playerToPunish !== 'nightingale')) {
        showModal("Assignment Failed", "Invalid player role entered.");
        return;
    }

    const newHistoryEntry = {
        timestamp: Date.now(),
        type: 'punishment',
        player: gameState.players[playerToPunish],
        item: { title: punishment.title }
    };

    const newState = {
        ...gameState,
        history: [...gameState.history, newHistoryEntry]
    };

    await updateStateInFirestore(newState);
};

/**
 * Handles creating a new item (Habit, Reward, or Punishment)
 * @param {string} type 'habit', 'reward', or 'punishment'
 */
window.createItem = async function(type) {
    let newItem = { id: crypto.randomUUID() };
    const historyEntry = { timestamp: Date.now(), type: 'config' };

    try {
        if (type === 'habit') {
            const desc = document.getElementById('new-habit-desc').value.trim();
            const points = parseInt(document.getElementById('new-habit-points').value, 10);
            const times = parseInt(document.getElementById('new-habit-times').value, 10);
            const freq = document.getElementById('new-habit-freq').value;
            const assignee = document.getElementById('new-habit-assignee').value;

            if (!desc || isNaN(points) || isNaN(times) || times <= 0) throw new Error("Please fill out all habit fields correctly.");

            newItem = {
                ...newItem,
                description: desc,
                points: points,
                times: times,
                frequency: freq,
                assignee: assignee,
                // Only track remainingTimes for 'once'
                remainingTimes: freq === 'once' ? times : undefined 
            };
            
            gameState.habits.push(newItem);
            historyEntry.message = `New Habit created: "${desc}" assigned to ${assignee}.`;
            window.toggleHabitForm(); // Hide form
        } 
        else if (type === 'reward') {
            const title = document.getElementById('new-reward-title').value.trim();
            const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
            const desc = document.getElementById('new-reward-desc').value.trim();

            if (!title || isNaN(cost) || cost <= 0) throw new Error("Please fill out all reward fields correctly.");

            newItem = { ...newItem, title: title, cost: cost, description: desc };
            gameState.rewards.push(newItem);
            historyEntry.message = `New Reward created: "${title}" for ${cost} pts.`;
            window.toggleRewardForm(); // Hide form
        } 
        else if (type === 'punishment') {
            const title = document.getElementById('new-punishment-title').value.trim();
            const desc = document.getElementById('new-punishment-desc').value.trim();

            if (!title || !desc) throw new Error("Please fill out all punishment fields correctly.");

            newItem = { ...newItem, title: title, description: desc };
            gameState.punishments.push(newItem);
            historyEntry.message = `New Punishment created: "${title}".`;
            window.togglePunishmentForm(); // Hide form
        }

        const newState = { ...gameState, history: [...gameState.history, historyEntry] };
        await updateStateInFirestore(newState);

        // Clear fields after successful submission (or let re-render handle it)
        document.querySelectorAll(`#${type}-form input, #${type}-form textarea`).forEach(el => el.value = '');

    } catch (error) {
        showModal("Creation Error", error.message);
        console.error("Creation Error:", error);
    }
};

/**
 * Handles deleting an item.
 * @param {string} collectionName 'habits', 'rewards', or 'punishments'
 * @param {string} itemId 
 */
window.deleteItem = async function(collectionName, itemId) {
    if (!confirm(`Are you sure you want to delete this ${collectionName.slice(0, -1)}?`)) return;

    const oldLength = gameState[collectionName].length;
    gameState[collectionName] = gameState[collectionName].filter(item => item.id !== itemId);
    const itemTitle = (oldLength > gameState[collectionName].length) ? 'Item' : 'Unknown Item'; // Simplistic title

    const newHistoryEntry = {
        timestamp: Date.now(),
        type: 'config',
        message: `${collectionName.slice(0, -1)} deleted: ${itemTitle}.`
    };

    const newState = { ...gameState, history: [...gameState.history, newHistoryEntry] };
    await updateStateInFirestore(newState);
};


/**
 * Populates form fields with an example from the global EXAMPLE_DATABASE.
 * NOTE: EXAMPLE_DATABASE is assumed to be loaded via <script src="./examples.js"></script>
 * @param {string} type 'habit', 'reward', or 'punishment'
 */
window.selectExample = function(type) {
    if (typeof EXAMPLE_DATABASE === 'undefined') {
        showModal("Error", "Example data is not available.");
        return;
    }
    
    let examples = EXAMPLE_DATABASE[`${type}s`];
    if (!examples || examples.length === 0) {
        showModal("Error", `No ${type} examples found.`);
        return;
    }

    // Select a random example
    const example = examples[Math.floor(Math.random() * examples.length)];

    if (type === 'habit') {
        document.getElementById('new-habit-desc').value = example.description;
        document.getElementById('new-habit-points').value = example.points;
        document.getElementById('new-habit-times').value = 1; // Default to 1
        document.getElementById('new-habit-assignee').value = example.type;
        // Check if form is hidden, show it
        const habitForm = document.getElementById('habit-form');
        if (habitForm && habitForm.classList.contains('hidden')) { window.toggleHabitForm(); }
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        // Check if form is hidden, show it
        const rewardForm = document.getElementById('reward-form');
        if (rewardForm && rewardForm.classList.contains('hidden')) { window.toggleRewardForm(); }
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        // Check if form is hidden, show it
        const punishmentForm = document.getElementById('punishment-form');
        if (punishmentForm && punishmentForm.classList.contains('hidden')) { window.togglePunishmentForm(); }
    }
}

// Since native window.alert is forbidden, we map it to our custom modal
window.alert = function(message) {
    showModal("Notice", message);
}

// --- Initialization ---

/**
 * Initializes Firebase, authenticates, and sets up the ledger listener.
 */
async function initFirebase() {
    try {
        if (!firebaseConfig) {
            throw new Error("Firebase configuration is missing.");
        }
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // 1. Authenticate user
        if (initialAuthToken) {
             // Use custom token for Canvas auth
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
             // Fallback to anonymous auth for standard web deployment
            await signInAnonymously(auth);
        }
        
        // 2. Wait for auth state to be established
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                // Define the document path for the shared ledger state
                GAME_STATE_PATH = `artifacts/${appId}/public/data/ledger_state/${GAME_STATE_DOC_ID}`;

                // 3. Set up Real-time Listener (onSnapshot)
                onSnapshot(doc(db, GAME_STATE_PATH), (docSnapshot) => {
                    if (docSnapshot.exists()) {
                        // Document exists, render the data
                        renderApp(docSnapshot.data());
                    } else {
                        // Document does not exist, initialize it
                        console.log("No ledger data found, initializing state...");
                        const initialHistoryEntry = {
                            timestamp: Date.now(),
                            type: 'config',
                            message: 'Ledger initialized.'
                        };
                        const initialState = {
                            ...gameState,
                            history: [initialHistoryEntry]
                        };
                        updateStateInFirestore(initialState);
                        // Render initial state while waiting for firestore to confirm
                        renderApp(initialState); 
                    }
                }, (error) => {
                    // Handle subscription errors
                    const msg = `Realtime data error: ${error.message}`;
                    console.error(msg, error);
                    document.getElementById('auth-error-message').textContent = msg;
                    updateLoadingScreen(false); // Show loading/error screen
                });

            } else {
                userId = null;
                const msg = "Authentication failed or sign-out occurred.";
                console.error(msg);
                document.getElementById('auth-error-message').textContent = msg;
                updateLoadingScreen(false);
            }
        });


    } catch (error) {
        const msg = `Connection Error: ${error.message}. Please check your Firebase configuration.`;
        console.error(msg, error);
        document.getElementById('auth-error-message').textContent = msg;
        updateLoadingScreen(false); // Ensure loading screen is visible to show the error
    }
}

// Run initialization on load
window.onload = initFirebase;