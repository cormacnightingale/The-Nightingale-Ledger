import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables ---

// Static ID for the shared data path in Firestore.
const appId = 'nightingale-ledger-v1';

// CRITICAL: Access 'firebaseConfig' directly from the global 'window' object.
const externalFirebaseConfig = window.firebaseConfig; 

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
// Path for public/shared data: artifacts/{appId}/public/data/ledger_state/{docId}
let GAME_STATE_PATH = null; 
const GAME_STATE_DOC_ID = 'ledger_data';

// Default profile structure for initial state
const defaultProfile = (name, color) => ({
    name: name,
    title: 'The Unassigned',
    color: color,
    image: 'https://placehold.co/100x100/3c3c45/d4d4dc?text=IMG', // Placeholder image
    status: 'Ready to begin the journey.',
});

let gameState = {
    // players now maps a unique role ('user1', 'user2') to a userId, 
    // which is needed for the legacy habit data that refers to 'keeper'/'nightingale' types.
    players: {
        user1: null, // Mapped to the first connected user's ID
        user2: null, // Mapped to the second connected user's ID
    },
    scores: {
        user1: 0,
        user2: 0
    },
    // New structure for dynamic user profiles keyed by their Firebase userId
    userProfiles: {
        // [userId_1]: { name: 'Alex', title: 'The Keeper', color: '#69a7b3', image: '...', status: '...' }
        // [userId_2]: { name: 'Jamie', title: 'The Nightingale', color: '#b05c6c', image: '...', status: '...' }
    },
    habits: [],
    rewards: [],
    punishments: [],
    history: []
};

// --- Utility Functions (Modal, Copy, etc.) ---

let modalResolver = null;
function showModal(title, message, isConfirm = false) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    
    const okButton = document.getElementById('modal-ok-btn');
    const cancelButton = document.getElementById('modal-cancel-btn');
    
    cancelButton.classList.toggle('hidden', !isConfirm);
    okButton.textContent = isConfirm ? 'Confirm' : 'OK';

    document.getElementById('custom-modal').classList.remove('hidden');

    if (isConfirm) {
        return new Promise(resolve => {
            modalResolver = resolve;
        });
    }
}

window.hideModal = function() {
    document.getElementById('custom-modal').classList.add('hidden');
    modalResolver = null;
}

window.handleModalAction = function(result) {
    if (modalResolver) {
        modalResolver(result);
    }
    window.hideModal();
}

window.copyToClipboard = function(elementId) {
    const copyText = document.getElementById(elementId).value;
    const textArea = document.createElement("textarea");
    textArea.value = copyText;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showModal("Copied!", "The Shared App ID has been copied to your clipboard.");
        } else {
            throw new Error("Copy command failed.");
        }
    } catch (err) {
        console.error('Error copying text:', err);
        showModal("Error", "Could not copy text automatically. Please select and copy manually.");
    }
    document.body.removeChild(textArea);
}

/**
 * Persists the current game state to Firestore.
 */
async function saveGameState() {
    if (!db || !GAME_STATE_PATH) return;

    try {
        const docRef = doc(db, GAME_STATE_PATH);
        // Use setDoc with { merge: true } to prevent overwriting the whole document
        await setDoc(docRef, gameState, { merge: true });
    } catch (e) {
        console.error("Error writing document: ", e);
        showModal("Save Error", "Failed to save data to the Ledger. Check console for details.");
    }
}

/**
 * Ensures the 'players' and 'userProfiles' state is synchronized when a new user joins.
 * @param {object} newGameState - The data received from Firestore.
 */
function synchronizeUsers(newGameState) {
    const profiles = newGameState.userProfiles || {};
    const existingIds = Object.keys(profiles);

    // 1. Identify which role ('user1' or 'user2') the current userId belongs to
    let userRole = existingIds.find(id => id === userId) ? existingIds.find(id => id === userId) : null;

    // 2. If the current user ID is not yet associated with a profile, assign one.
    if (!userRole) {
        // Check if user1 slot is empty (null or non-existent in profiles map)
        if (!newGameState.players.user1 || !profiles[newGameState.players.user1]) {
            gameState.players.user1 = userId;
            gameState.userProfiles[userId] = defaultProfile('User 1 (You)', '#69a7b3');
            gameState.scores.user1 = gameState.scores.user1 !== undefined ? gameState.scores.user1 : 0;
            userRole = 'user1';
            
            // If the user's ID wasn't in the scores, initialize it.
            if (gameState.scores.user1 === undefined) gameState.scores.user1 = 0;

        // Check if user2 slot is empty (null or non-existent in profiles map)
        } else if (!newGameState.players.user2 || !profiles[newGameState.players.user2]) {
            gameState.players.user2 = userId;
            gameState.userProfiles[userId] = defaultProfile('User 2 (You)', '#b05c6c');
            gameState.scores.user2 = gameState.scores.user2 !== undefined ? gameState.scores.user2 : 0;
            userRole = 'user2';

            // If the user's ID wasn't in the scores, initialize it.
            if (gameState.scores.user2 === undefined) gameState.scores.user2 = 0;
        
        } else {
            // All slots full. This user is a spectator or the third user. 
            // We just ensure their profile is in the list for display purposes.
            gameState.userProfiles[userId] = profiles[userId] || defaultProfile('Spectator', '#9ca3af');
            userRole = 'spectator';
        }

        // If a new profile was created, save it immediately.
        if (userRole && userRole !== 'spectator') {
            saveGameState();
        }
    }

    // 3. Ensure the local gameState is updated with the fetched data
    gameState.players = newGameState.players || gameState.players;
    gameState.scores = newGameState.scores || gameState.scores;
    gameState.userProfiles = newGameState.userProfiles || gameState.userProfiles;
}

/**
 * Subscribe to real-time updates from Firestore.
 */
function listenForUpdates() {
    if (!db || !GAME_STATE_PATH) return;

    const docRef = doc(db, GAME_STATE_PATH);

    onSnapshot(docRef, (doc) => {
        // Hide loading screen on first successful snapshot regardless of content
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('app-content').classList.remove('hidden');
        
        if (doc.exists()) {
            const newGameState = doc.data();
            
            // 1. Sync User Profiles and Slots (CRITICAL)
            synchronizeUsers(newGameState);

            // 2. Perform deep merge/update for all other arrays
            gameState = {
                ...gameState,
                ...newGameState,
                habits: newGameState.habits || [],
                rewards: newGameState.rewards || [],
                punishments: newGameState.punishments || [],
                history: newGameState.history || [],
            };

            // 3. Update the UI
            renderUI();
            
        } else {
            console.log("No initial data found, creating default state.");
            // Initialize the profile for the current user in the 'user1' slot
            gameState.players.user1 = userId;
            gameState.scores.user1 = 0;
            gameState.userProfiles[userId] = defaultProfile('User 1 (You)', '#69a7b3');

            saveGameState(); // Create the document if it doesn't exist
        }

    }, (error) => {
        console.error("Firestore Listen Error:", error);
        document.getElementById('auth-error-message').textContent = `Connection error: ${error.message}`;
    });
}

/**
 * Utility function to get the profile object based on the role ('user1' or 'user2').
 * @param {string} role - 'user1' or 'user2'.
 * @returns {object} The user profile or a fallback object.
 */
function getProfileByRole(role) {
    const profileId = gameState.players[role];
    return gameState.userProfiles[profileId] || { name: role, title: 'Unknown Player', color: '#555555', image: 'https://placehold.co/100x100/555555/d4d4dc?text=?' };
}

/**
 * Updates the entire application UI based on the current gameState.
 */
function renderUI() {
    
    // --- 1. Profile Forms ---
    // User 1
    const user1Profile = getProfileByRole('user1');
    document.getElementById('user1-label').textContent = `${user1Profile.name} (${user1Profile.title})`;
    document.getElementById('user1-label').style.color = user1Profile.color;
    document.getElementById('user1-name').value = user1Profile.name;
    document.getElementById('user1-title').value = user1Profile.title;
    document.getElementById('user1-status').value = user1Profile.status;
    document.getElementById('user1-image').value = user1Profile.image;
    document.getElementById('user1-color').value = user1Profile.color;
    
    // User 2
    const user2Profile = getProfileByRole('user2');
    document.getElementById('user2-label').textContent = `${user2Profile.name} (${user2Profile.title})`;
    document.getElementById('user2-label').style.color = user2Profile.color;
    document.getElementById('user2-name').value = user2Profile.name;
    document.getElementById('user2-title').value = user2Profile.title;
    document.getElementById('user2-status').value = user2Profile.status;
    document.getElementById('user2-image').value = user2Profile.image;
    document.getElementById('user2-color').value = user2Profile.color;
    
    // --- 2. Scoreboard ---
    const scoreboardSection = document.getElementById('scoreboard-section');
    scoreboardSection.innerHTML = '';
    
    ['user1', 'user2'].forEach(role => {
        const profile = getProfileByRole(role);
        const score = gameState.scores[role] || 0;
        
        const card = document.createElement('div');
        card.className = `card p-6 rounded-xl text-center border-b-4 card-hover`;
        card.style.borderColor = profile.color;
        
        card.innerHTML = `
            <div class="flex items-center justify-center mb-2">
                <img src="${profile.image}" onerror="this.onerror=null;this.src='https://placehold.co/100x100/3c3c45/d4d4dc?text=IMG'" class="w-16 h-16 rounded-full object-cover mr-4" alt="Profile Image">
                <div class="text-left">
                    <h2 class="text-3xl font-cinzel mb-0" style="color: ${profile.color};">${profile.name}</h2>
                    <p class="text-sm text-gray-400 font-sans italic">${profile.title}</p>
                </div>
            </div>
            <p class="text-xs text-gray-500 font-playfair italic mb-3">Status: ${profile.status}</p>
            <div class="border-t border-[#3c3c45] pt-3">
                <p class="text-6xl font-mono font-bold mt-2 text-white">${score}</p>
                <p class="text-gray-500 font-sans mt-1">Points</p>
            </div>
        `;
        scoreboardSection.appendChild(card);
    });

    // --- 3. Habit Forms Assignee Options ---
    const assigneeSelect = document.getElementById('new-habit-assignee');
    assigneeSelect.innerHTML = '';
    ['user1', 'user2'].forEach(role => {
        const profile = getProfileByRole(role);
        const option = document.createElement('option');
        option.value = role;
        option.textContent = `${profile.name} (${profile.title})`;
        assigneeSelect.appendChild(option);
    });


    // --- 4. Render Habits (Updated to use dynamic roles) ---
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    
    if (gameState.habits.length === 0) {
        habitsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No habits defined yet.</p>';
    } else {
        gameState.habits.forEach((habit, index) => {
            const profile = getProfileByRole(habit.assignee);
            const assigneeColor = profile.color;
            const assigneeName = profile.name;

            const card = document.createElement('div');
            card.className = `card p-4 rounded-xl shadow-lg border-l-4 flex justify-between items-start card-hover`;
            card.style.borderColor = assigneeColor;
            
            card.innerHTML = `
                <div>
                    <p class="text-sm font-sans uppercase font-semibold" style="color: ${assigneeColor}">${assigneeName}'s Task</p>
                    <p class="text-white font-playfair text-lg mb-2">${habit.description}</p>
                    <span class="text-xl font-bold font-mono" style="color: ${assigneeColor}">+${habit.points} Pts</span>
                </div>
                <div class="flex flex-col space-y-2">
                    <button onclick="window.completeHabit(${index})" class="text-green-400 hover:text-green-300 font-sans font-semibold text-lg p-2 rounded-full hover:bg-[#3c3c45] transition duration-200" title="Complete Habit">&#10003;</button>
                    <button onclick="window.removeHabit(${index})" class="text-gray-500 hover:text-red-400 font-sans text-lg p-2 rounded-full hover:bg-[#3c3c45] transition duration-200" title="Remove Habit">&times;</button>
                </div>
            `;
            habitsList.appendChild(card);
        });
    }
    
    // --- 5. Render Rewards ---
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';

    if (gameState.rewards.length === 0) {
        rewardsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic md:col-span-2">No rewards defined yet.</p>';
    } else {
        gameState.rewards.forEach((reward, index) => {
            const profile1 = getProfileByRole('user1');
            const profile2 = getProfileByRole('user2');

            const canAfford1 = (gameState.scores.user1 || 0) >= reward.cost;
            const canAfford2 = (gameState.scores.user2 || 0) >= reward.cost;

            const card = document.createElement('div');
            card.className = `card p-4 rounded-xl shadow-lg border-l-4 border-white flex flex-col card-hover`;
            card.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <h4 class="text-xl font-cinzel text-white">${reward.title}</h4>
                    <span class="text-xl font-bold text-green-400 font-mono">-${reward.cost} Pts</span>
                </div>
                <p class="text-sm text-gray-400 font-playfair mb-4">${reward.description}</p>
                <div class="flex space-x-2 mt-auto pt-3 border-t border-[#3c3c45]">
                    <button onclick="window.claimReward(${index}, 'user1')" 
                            class="flex-1 btn-secondary rounded-lg font-sans text-xs py-2 ${canAfford1 ? 'hover:bg-opacity-80' : 'opacity-50 cursor-not-allowed'}" 
                            style="${canAfford1 ? `background-color: ${profile1.color}; color: black;` : ''}"
                            ${canAfford1 ? '' : 'disabled'}>
                        ${profile1.name} Claim
                    </button>
                    <button onclick="window.claimReward(${index}, 'user2')" 
                            class="flex-1 btn-secondary rounded-lg font-sans text-xs py-2 ${canAfford2 ? 'hover:bg-opacity-80' : 'opacity-50 cursor-not-allowed'}" 
                            style="${canAfford2 ? `background-color: ${profile2.color}; color: black;` : ''}"
                            ${canAfford2 ? '' : 'disabled'}>
                        ${profile2.name} Claim
                    </button>
                </div>
            `;
            rewardsList.appendChild(card);
        });
    }

    // --- 6. Render Punishments ---
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    
    if (gameState.punishments.length === 0) {
        punishmentsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic md:col-span-3">No punishments defined yet.</p>';
    } else {
        gameState.punishments.forEach((punishment, index) => {
            const card = document.createElement('div');
            card.className = `card p-4 rounded-xl shadow-lg border-l-4 border-red-500 flex justify-between items-start card-hover`;
            card.innerHTML = `
                <div>
                    <h4 class="text-xl font-cinzel text-red-400">${punishment.title}</h4>
                    <p class="text-sm text-gray-400 font-playfair">${punishment.description}</p>
                </div>
                <button onclick="window.removePunishment(${index})" class="text-gray-500 hover:text-red-400 font-sans text-lg p-2 rounded-full hover:bg-[#3c3c45] transition duration-200" title="Remove Punishment">&times;</button>
            `;
            punishmentsList.appendChild(card);
        });
    }

    // --- 7. Render History ---
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';

    if (gameState.history.length === 0) {
        historyList.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No recent activity.</p>';
    } else {
        // Render in reverse chronological order
        gameState.history.slice().reverse().forEach(entry => {
            let roleClass = 'text-gray-300';
            let roleName = 'System';
            let roleColor = '#d4d4dc';

            if (entry.role === 'user1' || entry.role === 'user2') {
                const profile = getProfileByRole(entry.role);
                roleName = profile.name;
                roleColor = profile.color;
            } else if (entry.role === 'system') {
                roleColor = '#60a5fa'; // A nice system blue
            }
            
            const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const item = document.createElement('p');
            item.className = 'text-sm text-gray-400 border-b border-[#3c3c45] pb-2';
            item.innerHTML = `<span class="text-xs text-gray-500 mr-2">${time}</span> 
                              <span class="font-semibold" style="color: ${roleColor};">${roleName}</span>: ${entry.message}`;
            historyList.appendChild(item);
        });
    }

    // --- 8. Update Footer/Debug info
    document.getElementById('current-user-id').textContent = userId || 'N/A';
    document.getElementById('current-app-id').textContent = appId;
    document.getElementById('shared-app-id').value = appId;
}

// --- Profile Update Actions ---

window.saveUserProfiles = async function() {
    const user1Profile = {
        name: document.getElementById('user1-name').value.trim(),
        title: document.getElementById('user1-title').value.trim(),
        status: document.getElementById('user1-status').value.trim(),
        image: document.getElementById('user1-image').value.trim(),
        color: document.getElementById('user1-color').value,
    };
    
    const user2Profile = {
        name: document.getElementById('user2-name').value.trim(),
        title: document.getElementById('user2-title').value.trim(),
        status: document.getElementById('user2-status').value.trim(),
        image: document.getElementById('user2-image').value.trim(),
        color: document.getElementById('user2-color').value,
    };
    
    // Update profiles in gameState
    if (gameState.players.user1 && gameState.userProfiles[gameState.players.user1]) {
        gameState.userProfiles[gameState.players.user1] = user1Profile;
    } else if (!gameState.players.user1) {
         showModal("Error", "User 1 slot is unassigned. Please ensure both users have connected at least once.");
         return;
    }

    if (gameState.players.user2 && gameState.userProfiles[gameState.players.user2]) {
        gameState.userProfiles[gameState.players.user2] = user2Profile;
    } else if (!gameState.players.user2) {
        showModal("Error", "User 2 slot is unassigned. Please ensure both users have connected at least once.");
        return;
    }
    
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `Profile data updated.` 
    });

    await saveGameState();
    window.toggleProfileForm(true); // Close form
    showModal("Success", "User profiles have been saved!");
}

window.toggleProfileForm = function(forceHide = false) {
    const form = document.getElementById('profile-form');
    const button = document.getElementById('toggle-profile-btn');
    if (forceHide) {
        form.classList.add('hidden');
        button.textContent = 'Edit Profile';
    } else {
        form.classList.toggle('hidden');
        button.textContent = form.classList.contains('hidden') ? 'Edit Profile' : 'Hide Form';
    }
}

// --- Action Functions (Habits/Rewards/Punishments) ---

window.addHabit = async function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value; // 'user1' or 'user2'
    const profile = getProfileByRole(assignee);

    if (!desc || isNaN(points) || points <= 0 || !assignee) {
        showModal("Invalid Input", "Please provide a valid description, a positive point value, and select an assignee.");
        return;
    }

    gameState.habits.push({ description: desc, points: points, assignee: assignee, id: Date.now() });
    
    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `New Habit defined for ${profile.name}: "${desc}" for +${points} pts.` 
    });

    await saveGameState();
    // Clear form
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = 10;
    window.toggleHabitForm(true); // Close form
}

window.removeHabit = async function(index) {
    const habit = gameState.habits[index];
    const confirmed = await showModal("Confirm Removal", `Are you sure you want to remove the habit: "${habit.description}"?`, true);
    if (!confirmed) return;

    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `Habit removed: "${habit.description}"` 
    });

    gameState.habits.splice(index, 1);
    await saveGameState();
}

window.completeHabit = async function(index) {
    const habit = gameState.habits[index];
    const role = habit.assignee; // 'user1' or 'user2'
    const points = habit.points;
    const profile = getProfileByRole(role);

    const confirmed = await showModal("Confirm Completion", `Confirm that ${profile.name} completed the habit: "${habit.description}" and will receive +${points} points?`, true);
    if (!confirmed) return;

    // Score is stored by the role ('user1', 'user2')
    gameState.scores[role] = (gameState.scores[role] || 0) + points;
    
    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: role, 
        message: `Completed habit: "${habit.description}" (+${points} pts)` 
    });
    
    // The habit is considered done for now, so we remove it. 
    gameState.habits.splice(index, 1);
    
    await saveGameState();
}

window.claimReward = async function(index, role) {
    const reward = gameState.rewards[index];
    const profile = getProfileByRole(role);
    
    if ((gameState.scores[role] || 0) < reward.cost) {
        showModal("Cannot Afford", `${profile.name} does not have enough points (needs ${reward.cost}, has ${gameState.scores[role] || 0}).`);
        return;
    }

    const confirmed = await showModal("Confirm Claim", `Confirm that ${profile.name} is claiming the reward: "${reward.title}" for -${reward.cost} points?`, true);
    if (!confirmed) return;

    gameState.scores[role] -= reward.cost;
    
    // Log the action
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: role, 
        message: `Claimed reward: "${reward.title}" (-${reward.cost} pts)` 
    });
    
    await saveGameState();
}

// Existing Add/Remove Reward/Punishment functions remain largely the same, 
// just updating to use the new renderUI logic and removing old 'keeper'/'nightingale' references.

window.addReward = async function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const desc = document.getElementById('new-reward-desc').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a valid title, description, and a positive cost.");
        return;
    }

    gameState.rewards.push({ title: title, description: desc, cost: cost, id: Date.now() });
    
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `New Reward defined: "${title}" for ${cost} pts.` 
    });
    
    await saveGameState();
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-desc').value = '';
    document.getElementById('new-reward-cost').value = 50;
    window.toggleRewardForm(true);
}

window.addPunishment = async function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Invalid Input", "Please provide a valid title and description for the punishment.");
        return;
    }

    gameState.punishments.push({ title: title, description: desc, id: Date.now() });
    
    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `New Punishment defined: "${title}"` 
    });
    
    await saveGameState();
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    window.togglePunishmentForm(true);
}

window.removePunishment = async function(index) {
    const punishment = gameState.punishments[index];
    const confirmed = await showModal("Confirm Removal", `Are you sure you want to remove the punishment: "${punishment.title}"?`, true);
    if (!confirmed) return;

    gameState.history.push({ 
        timestamp: Date.now(), 
        role: 'system', 
        message: `Punishment removed: "${punishment.title}"` 
    });

    gameState.punishments.splice(index, 1);
    await saveGameState();
}


// --- Form Toggle Handlers ---

window.toggleHabitForm = function(forceHide = false) {
    const form = document.getElementById('habit-form');
    const button = document.getElementById('toggle-habit-btn');
    if (forceHide) {
        form.classList.add('hidden');
        button.textContent = 'Define New Habit +';
    } else {
        form.classList.toggle('hidden');
        button.textContent = form.classList.contains('hidden') ? 'Define New Habit +' : 'Hide Form -';
    }
}

window.toggleRewardForm = function(forceHide = false) {
    const form = document.getElementById('reward-form');
    const button = document.getElementById('toggle-reward-btn');
    if (forceHide) {
        form.classList.add('hidden');
        button.textContent = 'Define New Reward +';
    } else {
        form.classList.toggle('hidden');
        button.textContent = form.classList.contains('hidden') ? 'Define New Reward +' : 'Hide Form -';
    }
}

window.togglePunishmentForm = function(forceHide = false) {
    const form = document.getElementById('punishment-form');
    const button = document.getElementById('toggle-punishment-btn');
    if (forceHide) {
        form.classList.add('hidden');
        button.textContent = 'Define New Punishment +';
    } else {
        form.classList.toggle('hidden');
        button.textContent = form.classList.contains('hidden') ? 'Define New Punishment +' : 'Hide Form -';
    }
}

// Since native window.alert is forbidden, we map it to our custom modal
window.alert = function(message) {
    showModal("Notice", message);
}

/**
 * Inserts a random example habit, reward, or punishment into the form fields.
 * NOTE: The habit examples use 'keeper'/'nightingale' types, which map to 'user1'/'user2' roles.
 */
window.generateExample = function(type) {
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        showModal("Error", "Example data is not loaded correctly. Ensure examples.js loads first.");
        return;
    }
    
    const examples = EXAMPLE_DATABASE[type + 's'];
    const randomIndex = Math.floor(Math.random() * examples.length);
    const example = examples[randomIndex];

    if (type === 'habit') {
        document.getElementById('new-habit-desc').value = example.description;
        document.getElementById('new-habit-points').value = example.points;
        
        // Map old 'keeper'/'nightingale' type to 'user1'/'user2' role for assignment
        const assigneeRole = example.type === 'keeper' ? 'user1' : 'user2';
        document.getElementById('new-habit-assignee').value = assigneeRole;
        
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


// --- Initialization ---

/**
 * Initializes Firebase, authenticates, and starts the real-time listener.
 */
async function initFirebase() {
    if (typeof externalFirebaseConfig === 'undefined' || externalFirebaseConfig === null) {
        document.getElementById('auth-error-message').textContent = "FATAL: Firebase configuration is missing. Ensure firebase_config.js loaded correctly.";
        console.error("Firebase Config Error: 'firebaseConfig' not found on window. Ensure firebase_config.js loads before script.js.");
        return;
    }
    
    try {
        app = initializeApp(externalFirebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        setLogLevel('debug');
    } catch (e) {
        console.error("Firebase Initialization Failed:", e);
        document.getElementById('auth-error-message').textContent = `Initialization Error: ${e.message}`;
        return;
    }

    try {
        await signInAnonymously(auth);
    } catch (e) {
        console.error("Authentication Failed:", e);
        document.getElementById('auth-error-message').textContent = `Authentication Error: ${e.message}`;
        return;
    }
    
    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            GAME_STATE_PATH = `artifacts/${appId}/public/data/ledger_state/${GAME_STATE_DOC_ID}`;
            
            console.log("Authenticated. User ID:", userId, "Data Path:", GAME_STATE_PATH);

            listenForUpdates();

        } else {
            userId = null;
            document.getElementById('auth-error-message').textContent = "Authentication failed. Ledger features disabled.";
            document.getElementById('loading-screen').classList.remove('hidden');
            document.getElementById('app-content').classList.add('hidden');
        }
    });
}


// Run initialization on load
window.onload = initFirebase;