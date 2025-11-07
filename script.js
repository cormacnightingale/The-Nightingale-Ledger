import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firestore log level to Debug for better visibility
setLogLevel('Debug');

// --- Global Variables (Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
// Check window.firebaseConfig as a fallback if __firebase_config is not defined (for local testing)
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : (window.firebaseConfig || {});
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let userSlot = null; // 'nightingale' or 'keeper'
const GAME_STATE_DOC_PATH = `artifacts/${appId}/public/data/ledger_state/ledger_data`; 
const GAME_STATE_DOC_ID = 'ledger_data';

// Updated gameState structure for two-user lock and rich profiles
const defaultProfile = {
    name: 'New Partner',
    avatarUrl: '',
    status: 'Neutral'
};

const defaultGameState = {
    nightingaleScore: 0,
    keeperScore: 0,
    authorizedUsers: [], // Array of up to two user UIDs
    profiles: {},        // Map of {userId: {name, avatarUrl, status, slot}}
    habits: [],
    rewards: [],
    punishments: [],
};

let gameState = { ...defaultGameState }; // Start with defaults

// --- Core Ledger Data Management ---

/**
 * Hides the main app content and displays an error message on the loading screen.
 * Used for unauthorized access.
 */
function lockApp(message) {
    document.getElementById('app-content').classList.add('hidden');
    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('loading-message').innerHTML = `<p class="text-error font-bold">${message}</p>`;
}

/**
 * Initializes Firebase, performs authentication, and sets up the data listener.
 */
async function initializeAppAndAuth() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // 1. Initial Authentication
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        // 2. Auth State Change Listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                
                // Display User ID in header and modal (Login Status)
                document.getElementById('current-user-id').textContent = userId;
                document.getElementById('current-user-id-modal').textContent = userId;
                document.getElementById('current-app-id-modal').textContent = appId;

                console.log(`User authenticated with ID: ${userId}. App ID: ${appId}`);
                
                // Once authenticated, start listening to the public game state
                setupLedgerListener();
            } else {
                userId = null;
                lockApp("Authentication failed. Please check your connection and try refreshing.");
            }
        });

    } catch (error) {
        console.error("Firebase Initialization or Authentication Error:", error);
        lockApp(`Connection Error: ${error.message}`);
    }
}

/**
 * Sets up a real-time listener for the shared ledger data and manages the two-user lock.
 */
function setupLedgerListener() {
    const docRef = doc(db, GAME_STATE_DOC_PATH);

    onSnapshot(docRef, async (docSnapshot) => {
        if (docSnapshot.exists()) {
            const remoteState = docSnapshot.data();
            gameState = { ...defaultGameState, ...remoteState };
            
            // --- Two-User Lock Logic ---
            let users = gameState.authorizedUsers || [];
            let profiles = gameState.profiles || {};
            
            const isAuthorized = users.includes(userId);
            let requiresUpdate = false;
            
            if (!isAuthorized) {
                if (users.length < 2) {
                    // New user joining the ledger
                    users = [...users, userId];
                    const slot = users.length === 1 ? 'nightingale' : 'keeper';
                    const newProfile = { ...defaultProfile, name: slot.charAt(0).toUpperCase() + slot.slice(1), slot: slot };
                    profiles[userId] = newProfile;
                    
                    userSlot = slot;
                    requiresUpdate = true;
                    
                    console.log(`New user joining as: ${slot}`);
                } else {
                    // Third user attempting to join
                    lockApp(`ACCESS DENIED: The ledger is currently locked to two authorized users.`);
                    return; 
                }
            } else {
                // Authorized user, determine their slot
                userSlot = profiles[userId] ? profiles[userId].slot : (users[0] === userId ? 'nightingale' : 'keeper');
            }

            if (requiresUpdate) {
                // Update Firestore if we added a new authorized user
                await updateDoc(docRef, { authorizedUsers: users, profiles: profiles });
            }

            // Data loaded and user authorized, now render
            renderLedger();
            
            // Hide loading screen and show app content
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('app-content').classList.remove('hidden');

        } else {
            // Document does not exist, create the initial document with current user as Nightingale
            const initialSlot = 'nightingale';
            const initialProfile = { ...defaultProfile, name: 'Nightingale', slot: initialSlot };
            
            gameState.authorizedUsers = [userId];
            gameState.profiles[userId] = initialProfile;
            userSlot = initialSlot;

            console.log("Ledger document does not exist. Creating default state with user as Nightingale.");
            
            await setDoc(docRef, gameState)
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
        if (error.code === 'not-found') {
             await setDoc(docRef, { ...gameState, ...updates });
        } else {
            console.error("Error updating game state:", error);
        }
    }
}

// --- Rendering Functions ---

/**
 * Renders the entire ledger based on the current gameState.
 */
function renderLedger() {
    
    const nightingaleUser = gameState.authorizedUsers.find(uid => gameState.profiles[uid]?.slot === 'nightingale');
    const keeperUser = gameState.authorizedUsers.find(uid => gameState.profiles[uid]?.slot === 'keeper');

    const nightingaleProfile = nightingaleUser ? gameState.profiles[nightingaleUser] : { name: 'Nightingale', avatarUrl: '', status: 'Neutral' };
    const keeperProfile = keeperUser ? gameState.profiles[keeperUser] : { name: 'Keeper', avatarUrl: '', status: 'Neutral' };

    // 1. Update Scoreboard Names, Avatars, Statuses and Scores
    
    // Nightingale
    document.getElementById('nightingale-name-display').textContent = nightingaleProfile.name;
    document.getElementById('nightingale-status-display').textContent = nightingaleProfile.status;
    document.getElementById('nightingale-score').textContent = gameState.nightingaleScore || 0;
    document.getElementById('nightingale-avatar').src = nightingaleProfile.avatarUrl || `https://placehold.co/64x64/B05C6C/ffffff?text=${nightingaleProfile.name.charAt(0)}`;
    
    // Keeper
    document.getElementById('keeper-name-display').textContent = keeperProfile.name;
    document.getElementById('keeper-status-display').textContent = keeperProfile.status;
    document.getElementById('keeper-score').textContent = gameState.keeperScore || 0;
    document.getElementById('keeper-avatar').src = keeperProfile.avatarUrl || `https://placehold.co/64x64/5C8CB0/ffffff?text=${keeperProfile.name.charAt(0)}`;

    // Update forms with current names
    const nightingaleOption = document.querySelector('#new-habit-type option[value="nightingale"]');
    if (nightingaleOption) nightingaleOption.textContent = nightingaleProfile.name;
    
    const keeperOption = document.querySelector('#new-habit-type option[value="keeper"]');
    if (keeperOption) keeperOption.textContent = keeperProfile.name;

    // 2. Render lists
    renderHabits(nightingaleProfile, keeperProfile);
    renderRewards();
    renderPunishments();
}

/**
 * Renders the Habit list, using the custom player names.
 */
function renderHabits(nightingaleProfile, keeperProfile) {
    const listEl = document.getElementById('habits-list');
    const habits = gameState.habits || [];
    
    if (habits.length === 0) {
        listEl.innerHTML = '<p class="p-4 text-center text-gray-500">No habits defined yet. Use the "Add New Habit" button above!</p>';
        return;
    }

    listEl.innerHTML = habits.map((habit, index) => {
        const isNightingale = habit.type === 'nightingale';
        const playerClass = isNightingale ? 'text-nightingale' : 'text-keeper';
        const playerLabel = isNightingale ? nightingaleProfile.name : keeperProfile.name;

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
 * Renders the Reward list. (Render logic remains the same)
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
                <div class="text-sm font-bold text-yellow-400 mr-2">${reward.cost} Points</div>
                <button onclick="window.claimReward('${index}', ${reward.cost})" class="btn-primary text-sm bg-yellow-600 hover:bg-yellow-500 p-2 leading-none" title="Claim Reward">
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
 * Renders the Punishment list. (Render logic remains the same)
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
                <button onclick="window.deletePunishment('${index}')" class="text-gray-500 hover:text-error text-xl" title="Remove Punishment">
                    &times;
                </button>
            </div>
        </div>
    `).join('');
}

// --- Customization & Options Functions ---

/**
 * Toggles the visibility of the Edit Profile Modal.
 */
window.toggleEditProfileModal = function(show) {
    document.getElementById('edit-profile-modal').classList.toggle('hidden', !show);
}

/**
 * Pre-populates the Edit Profile Modal with the current user's data and opens it.
 */
window.openEditProfile = function(slot) {
    if (userSlot !== slot) {
        document.getElementById('auth-error-message').textContent = `ERROR: You can only edit your own profile (${userSlot}).`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
        return;
    }

    const currentProfile = gameState.profiles[userId] || defaultProfile;

    document.getElementById('edit-profile-slot').value = slot;
    document.getElementById('edit-profile-name').value = currentProfile.name;
    document.getElementById('edit-avatar-url').value = currentProfile.avatarUrl;
    document.getElementById('edit-status').value = currentProfile.status;

    window.toggleEditProfileModal(true);
}

/**
 * Saves changes from the Edit Profile Modal to Firestore.
 */
window.saveProfileChanges = async function(event) {
    event.preventDefault();

    const newName = document.getElementById('edit-profile-name').value.trim();
    const newAvatarUrl = document.getElementById('edit-avatar-url').value.trim();
    const newStatus = document.getElementById('edit-status').value;

    if (!newName) {
        document.getElementById('auth-error-message').textContent = `Name cannot be empty.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
        return;
    }

    const updatedProfile = {
        ...gameState.profiles[userId],
        name: newName,
        avatarUrl: newAvatarUrl,
        status: newStatus
    };
    
    // Create the update object for Firestore
    const updates = { 
        profiles: {
            ...gameState.profiles,
            [userId]: updatedProfile
        }
    };

    await updateGameState(updates);
    document.getElementById('auth-error-message').textContent = `Profile for ${newName} saved successfully!`;
    setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
    window.toggleEditProfileModal(false);
}


// --- Utility Functions (Keep Existing) ---

window.toggleCodesModal = function(show) {
    document.getElementById('codes-modal').classList.toggle('hidden', !show);
}

window.toggleSettingsPanel = function(show) {
    const panel = document.getElementById('settings-panel');
    panel.classList.toggle('hidden', !show);
    if (show) {
        panel.scrollIntoView({ behavior: 'smooth' });
    }
}

window.resetLedger = async function() {
    if (confirm("WARNING: This will erase ALL scores, habits, rewards, and punishments for both partners. Are you sure?")) {
        // Reset the document entirely, including authorized users and profiles
        const resetState = { 
            ...defaultGameState, 
            authorizedUsers: [userId], // Keep current user authorized
            profiles: { [userId]: { ...defaultProfile, name: userSlot.charAt(0).toUpperCase() + userSlot.slice(1), slot: userSlot } } 
        };
        const docRef = doc(db, GAME_STATE_DOC_PATH);
        try {
            await setDoc(docRef, resetState);
            document.getElementById('auth-error-message').textContent = "Ledger successfully reset!";
        } catch (error) {
            console.error("Error resetting ledger:", error);
            document.getElementById('auth-error-message').textContent = `Error resetting ledger: ${error.message}`;
        }
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 4000);
        window.toggleSettingsPanel(false);
    }
}

window.signOutUser = async function() {
    try {
        await signOut(auth);
        document.getElementById('app-content').classList.add('hidden');
        document.getElementById('loading-screen').classList.remove('hidden');
        document.getElementById('current-user-id').textContent = 'Signed Out';
        document.getElementById('loading-message').textContent = "Successfully signed out. Reloading session...";

        setTimeout(() => {
            window.location.reload(); 
        }, 1000);

    } catch (error) {
        console.error("Sign Out Error:", error);
        document.getElementById('auth-error-message').textContent = `Sign Out Error: ${error.message}`;
    }
}

window.copyToClipboard = function(elementId) {
    const textToCopy = document.getElementById(elementId).textContent;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            document.getElementById('auth-error-message').textContent = `Copied App ID to clipboard!`;
            setTimeout(() => document.getElementById('auth-error-message').textContent = '', 2000);
        }).catch(err => {
            const textArea = document.createElement("textarea");
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                document.getElementById('auth-error-message').textContent = `Copied App ID to clipboard!`;
            } catch (err) {
                document.getElementById('auth-error-message').textContent = `Copy failed. Manually select and copy: ${textToCopy}`;
            }
            document.body.removeChild(textArea);
            setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
        });
    } else {
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            document.getElementById('auth-error-message').textContent = `Copied App ID to clipboard!`;
        } catch (err) {
            document.getElementById('auth-error-message').textContent = `Copy failed. Manually select and copy: ${textToCopy}`;
        }
        document.body.removeChild(textArea);
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
    }
}


// --- Action Functions (Keep Existing) ---

window.toggleHabitForm = function(show) { document.getElementById('habit-form').classList.toggle('hidden', !show); }
window.toggleRewardForm = function(show) { document.getElementById('reward-form').classList.toggle('hidden', !show); }
window.togglePunishmentForm = function(show) { document.getElementById('punishment-form').classList.toggle('hidden', !show); }

window.completeHabit = async function(index) {
    const habits = [...gameState.habits];
    const completedHabit = habits.splice(index, 1)[0];
    
    if (!completedHabit) return;

    let updates = { habits: habits };

    if (completedHabit.type === 'nightingale') {
        updates.nightingaleScore = (gameState.nightingaleScore || 0) + completedHabit.points;
    } else if (completedHabit.type === 'keeper') {
        updates.keeperScore = (gameState.keeperScore || 0) + completedHabit.points;
    }

    await updateGameState(updates);
}

window.claimReward = async function(index, cost) {
    const totalScore = (gameState.nightingaleScore || 0) + (gameState.keeperScore || 0);
    if (totalScore < cost) {
        document.getElementById('auth-error-message').textContent = `ERROR: You only have ${totalScore} total points. This reward costs ${cost}.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 4000);
        return;
    }
    
    let nightingaleDeduction = Math.min(cost, gameState.nightingaleScore);
    let keeperDeduction = cost - nightingaleDeduction;

    let updates = {
        nightingaleScore: gameState.nightingaleScore - nightingaleDeduction,
        keeperScore: gameState.keeperScore - keeperDeduction
    };
    
    await updateGameState(updates);
}

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

// --- Deletion Functions (Keep Existing) ---

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

// --- Example Fillers (Keep Existing) ---

window.fillHabitForm = function() {
    if (!window.EXAMPLE_DATABASE) { console.error("Example database not loaded."); return; }
    const examples = EXAMPLE_DATABASE.habits;
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-habit-desc').value = example.description;
    document.getElementById('new-habit-points').value = example.points;
    document.getElementById('new-habit-type').value = example.type;
    if (document.getElementById('habit-form').classList.contains('hidden')) { window.toggleHabitForm(true); }
}

window.fillRewardForm = function() {
    if (!window.EXAMPLE_DATABASE) { console.error("Example database not loaded."); return; }
    const examples = EXAMPLE_DATABASE.rewards;
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-reward-title').value = example.title;
    document.getElementById('new-reward-cost').value = example.cost;
    document.getElementById('new-reward-desc').value = example.description;
    if (document.getElementById('reward-form').classList.contains('hidden')) { window.toggleRewardForm(true); }
}

window.fillPunishmentForm = function() {
    if (!window.EXAMPLE_DATABASE) { console.error("Example database not loaded."); return; }
    const examples = EXAMPLE_DATABASE.punishments;
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-punishment-title').value = example.title;
    document.getElementById('new-punishment-desc').value = example.description;
    if (document.getElementById('punishment-form').classList.contains('hidden')) { window.togglePunishmentForm(true); }
}

// --- Initialization ---

window.onload = initializeAppAndAuth;