// --- Firebase Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    onSnapshot, 
    setDoc, 
    getDoc,
    addDoc // We will use addDoc for profile creation, but setDoc for ledgers
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firestore log level
setLogLevel('Debug');

// --- Global Variables (Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : window.firebaseConfig;
// We no longer use initialAuthToken, as we're doing full auth.

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let currentLedgerId = null;
let currentUserEmail = null;

// Firestore Listeners - we need to store them to unsubscribe on logout/switch
let ledgerUnsubscribe = null;
let userProfileUnsubscribe = null;

// --- Theme Color Presets ---
const PRESETS = {
    Nightingale: {
        colorBgStart: '#000000', colorBgEnd: '#1a1a1c', colorCardBg: '#1a1a1c',
        colorTextBase: '#e0e0e0', colorTextMuted: '#9ca3af', colorAccentPrimary: '#b05c6c',
        colorAccentSecondary: '#7f00ff', colorAccentSecondaryHover: '#4d0099', colorScore: '#ff9900',
        colorBorderLight: '#555555', colorBorderDark: '#3c3c45', colorInputBg: '#0d0d0f',
        colorShadowPrimary: 'rgba(176, 92, 108, 0.2)', colorShadowSecondary: 'rgba(127, 0, 255, 0.1)',
    },
    Daybreak: {
        colorBgStart: '#f3f4f6', colorBgEnd: '#e5e7eb', colorCardBg: '#ffffff',
        colorTextBase: '#1f2937', colorTextMuted: '#6b7280', colorAccentPrimary: '#4f46e5',
        colorAccentSecondary: '#4f46e5', colorAccentSecondaryHover: '#4338ca', colorScore: '#3730a3',
        colorBorderLight: '#e5e7eb', colorBorderDark: '#d1d5db', colorInputBg: '#f9fafb',
        colorShadowPrimary: 'rgba(0, 0, 0, 0.05)', colorShadowSecondary: 'rgba(0, 0, 0, 0.03)',
    },
    Grove: {
        colorBgStart: '#181c18', colorBgEnd: '#202620', colorCardBg: '#202620',
        colorTextBase: '#d4d4d8', colorTextMuted: '#a1a1aa', colorAccentPrimary: '#65a30d',
        colorAccentSecondary: '#84cc16', colorAccentSecondaryHover: '#65a30d', colorScore: '#a3e635',
        colorBorderLight: '#3f6212', colorBorderDark: '#365314', colorInputBg: '#1a201a',
        colorShadowPrimary: 'rgba(101, 163, 13, 0.2)', colorShadowSecondary: 'rgba(101, 163, 13, 0.1)',
    }
};

// --- Default Game State (for NEW ledgers) ---
const DEFAULT_GAME_STATE = {
    settings: {
        theme: 'Nightingale',
        colors: PRESETS.Nightingale
    },
    players: {
        keeper: { name: 'User 1', title: 'Keeper', color: '#b05c6c' },
        nightingale: { name: 'User 2', title: 'Nightingale', color: '#8a63d2' }
    },
    scores: { keeper: 0, nightingale: 0 },
    habits: [], rewards: [], punishments: [], history: []
};
let gameState = JSON.parse(JSON.stringify(DEFAULT_GAME_STATE)); // Local state cache

// --- Utility Functions ---
function showModal(title, message, isPrompt = false, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').textContent = message;
        const input = document.getElementById('modal-input');
        const cancelBtn = document.getElementById('modal-cancel-btn');
        const confirmBtn = document.getElementById('modal-confirm-btn');
        if (isPrompt) {
            input.value = defaultValue;
            input.classList.remove('hidden');
            cancelBtn.classList.remove('hidden');
            confirmBtn.textContent = 'Save';
        } else {
            input.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            confirmBtn.textContent = 'OK';
        }
        const handleConfirm = () => {
            modal.classList.add('hidden'); modal.classList.remove('flex');
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(isPrompt ? input.value : true);
        };
        const handleCancel = () => {
            modal.classList.add('hidden'); modal.classList.remove('flex');
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(null);
        };
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (isPrompt) input.focus();
    });
}
window.alert = function(message) { showModal("Notice", message); };

// Helper to manage screen visibility
function showScreen(screenId) {
    ['#loading-screen', '#auth-screen', '#ledger-select-screen', '#main-content'].forEach(id => {
        document.querySelector(id).classList.add('hidden');
    });
    document.querySelector(screenId).classList.remove('hidden');
}

// Helper for auth errors
function setAuthError(message) {
    const el = document.getElementById('auth-form-error');
    el.textContent = message;
    el.classList.toggle('hidden', !message);
}
// Helper for ledger errors
function setLedgerError(message) {
    const el = document.getElementById('ledger-form-error');
    el.textContent = message;
    el.classList.toggle('hidden', !message);
}

// --- Firebase Initialization ---
async function initFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        document.getElementById('current-app-id').textContent = appId;
        
        // This is the new "master" function
        onAuthStateChanged(auth, (user) => {
            // Detach any old listeners
            if (ledgerUnsubscribe) ledgerUnsubscribe();
            if (userProfileUnsubscribe) userProfileUnsubscribe();
            ledgerUnsubscribe = null;
            userProfileUnsubscribe = null;
            
            if (user) {
                // User is signed in
                userId = user.uid;
                currentUserEmail = user.email;
                document.getElementById('current-user-email').textContent = user.email || user.uid;
                
                // Now, we need to find their ledger
                loadUserProfile(user.uid);
                // We don't show a screen here; loadUserProfile will do it.
                document.getElementById('auth-error-message').textContent = 'Loading user profile...';
                showScreen('#loading-screen');

            } else {
                // User is signed out
                userId = null;
                currentUserEmail = null;
                currentLedgerId = null;
                gameState = JSON.parse(JSON.stringify(DEFAULT_GAME_STATE)); // Reset local state
                
                showScreen('#auth-screen'); // Show the login page
            }
        });
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        document.getElementById('auth-error-message').textContent = `Connection Error: ${error.message}.`;
    }
}
window.onload = initFirebase;

// --- Authentication Functions ---
window.signInWithGoogle = async () => {
    setAuthError('');
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        // onAuthStateChanged will handle the rest
    } catch (error) {
        console.error("Google Sign-In Error:", error);
        setAuthError(error.message);
    }
};

window.signInWithEmail = async () => {
    setAuthError('');
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-password').value;
    if (!email || !pass) {
        setAuthError("Please enter email and password.");
        return;
    }
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        // onAuthStateChanged will handle the rest
    } catch (error) {
        console.error("Email Sign-In Error:", error);
        setAuthError(error.message);
    }
};

window.createAccountWithEmail = async () => {
    setAuthError('');
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-password').value;
    if (!email || pass.length < 6) {
        setAuthError("Please enter a valid email and a password of 6+ characters.");
        return;
    }
    try {
        await createUserWithEmailAndPassword(auth, email, pass);
        // onAuthStateChanged will handle the rest
    } catch (error) {
        console.error("Email Creation Error:", error);
        setAuthError(error.message);
    }
};

window.doSignOut = async () => {
    await signOut(auth);
    // onAuthStateChanged will handle cleanup
};

// --- Profile & Ledger Management ---

/**
 * Loads the user's profile to find their last-used ledger.
 * @param {string} uid The user's Firebase UID
 */
function loadUserProfile(uid) {
    const userProfileRef = doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data');
    
    // Listen for changes to the user's profile (e.g., if they switch ledgers elsewhere)
    userProfileUnsubscribe = onSnapshot(userProfileRef, async (docSnap) => {
        if (docSnap.exists()) {
            // Profile exists
            const profileData = docSnap.data();
            const ledgerId = profileData.lastUsedLedgerId;
            
            if (ledgerId) {
                // User has a ledger, load it
                if (ledgerId !== currentLedgerId) {
                    currentLedgerId = ledgerId;
                    listenToGameState(ledgerId);
                }
                document.getElementById('current-ledger-id').textContent = ledgerId;
                showScreen('#main-content');
            } else {
                // User is logged in but has no ledger selected
                currentLedgerId = null;
                showScreen('#ledger-select-screen');
            }
        } else {
            // First-time login for this user, create their profile
            try {
                await setDoc(userProfileRef, { lastUsedLedgerId: null });
                // The snapshot will re-trigger and show the ledger-select-screen
            } catch (error) {
                console.error("Error creating user profile:", error);
                setLedgerError("Could not create your user profile.");
            }
        }
    }, (error) => {
        console.error("Error loading user profile:", error);
        alert("Could not load your user profile. " + error.message);
        showScreen('#auth-screen'); // Kick to login
    });
}

/**
 * Updates the user's profile to set their current ledger.
 * @param {string} ledgerId The ID/code of the ledger to use.
 */
async function updateUserLastLedger(ledgerId) {
    const userProfileRef = doc(db, 'artifacts', appId, 'users', userId, 'profile', 'data');
    try {
        await setDoc(userProfileRef, { lastUsedLedgerId: ledgerId }, { merge: true });
        // onSnapshot will see this change and call listenToGameState
    } catch (error) {
        console.error("Error updating user profile:", error);
        setLedgerError("Could not save your ledger choice.");
    }
}

/**
 * Host a new ledger using the provided code.
 */
window.hostLedger = async () => {
    setLedgerError('');
    const ledgerCode = document.getElementById('ledger-code-input').value.trim();
    if (ledgerCode.length < 4) {
        setLedgerError("Ledger Code must be at least 4 characters.");
        return;
    }

    const ledgerRef = doc(db, 'artifacts', appId, 'public', 'data', 'ledgers', ledgerCode);
    
    try {
        const docSnap = await getDoc(ledgerRef);
        if (docSnap.exists()) {
            // Document already exists
            setLedgerError("This Ledger Code is already taken. Try another.");
        } else {
            // Code is available, create the new ledger
            await setDoc(ledgerRef, DEFAULT_GAME_STATE);
            // Now, set this as the user's current ledger
            await updateUserLastLedger(ledgerCode);
            // The onSnapshot listener will then show the main app
        }
    } catch (error) {
        console.error("Error hosting ledger:", error);
        setLedgerError("Could not create ledger: " + error.message);
    }
};

/**
 * Join an existing ledger using the provided code.
 */
window.joinLedger = async () => {
    setLedgerError('');
    const ledgerCode = document.getElementById('ledger-code-input').value.trim();
    if (!ledgerCode) {
        setLedgerError("Please enter a Ledger Code.");
        return;
    }

    const ledgerRef = doc(db, 'artifacts', appId, 'public', 'data', 'ledgers', ledgerCode);
    
    try {
        const docSnap = await getDoc(ledgerRef);
        if (docSnap.exists()) {
            // Ledger found! Join it.
            await updateUserLastLedger(ledgerCode);
            // The onSnapshot listener will then show the main app
        } else {
            // Document does not exist
            setLedgerError("No ledger found with this code. Check for typos.");
        }
    } catch (error) {
        console.error("Error joining ledger:", error);
        setLedgerError("Could not join ledger: " + error.message);
    }
};


// --- Core Game Logic (Now uses dynamic ledger) ---

/**
 * Attaches the realtime listener to the selected ledger.
 * @param {string} ledgerId The ID/code of the ledger to listen to.
 */
function listenToGameState(ledgerId) {
    // Detach old listener if it exists
    if (ledgerUnsubscribe) ledgerUnsubscribe();

    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'ledgers', ledgerId);
    
    ledgerUnsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const fetchedState = docSnap.data();
            // Deep merge defaults with fetched state
            gameState = {
                ...DEFAULT_GAME_STATE,
                ...fetchedState,
                settings: {
                    ...DEFAULT_GAME_STATE.settings,
                    ...(fetchedState.settings || {}),
                    colors: { ...DEFAULT_GAME_STATE.settings.colors, ...(fetchedState.settings?.colors || {}) }
                },
                players: {
                    keeper: { ...DEFAULT_GAME_STATE.players.keeper, ...fetchedState.players?.keeper },
                    nightingale: { ...DEFAULT_GAME_STATE.players.nightingale, ...fetchedState.players?.nightingale }
                },
                scores: { ...DEFAULT_GAME_STATE.scores, ...fetchedState.scores },
                habits: fetchedState.habits || [],
                rewards: fetchedState.rewards || [],
                punishments: fetchedState.punishments || [],
                history: fetchedState.history || [],
            };
            renderState();
        } else {
            // This is bad - user is subscribed to a ledger that doesn't exist
            console.error("Current ledger does not exist!");
            // Clear the bad ledger ID from the user's profile
            updateUserLastLedger(null); // This will show the select screen
        }
    }, (error) => {
        console.error("Error listening to Firestore state:", error);
        window.alert("Failed to connect to the shared ledger. See console for details.");
    });
}

/**
 * Saves the entire game state to the *current* ledger.
 * @param {object} newState The new state object to save.
 * @param {string} historyMessage The message to add to the history.
 */
async function updateGameState(newState, historyMessage) {
    if (!db || !currentLedgerId) return;
    
    if (historyMessage) {
        if (!newState.history) newState.history = [];
        newState.history.unshift({ 
            timestamp: new Date().toISOString(), 
            message: historyMessage 
        });
        newState.history = newState.history.slice(0, 25); 
    }

    gameState = newState; // Optimistic local update

    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'ledgers', currentLedgerId);
    try {
        await setDoc(docRef, newState, { merge: false });
    } catch (e) {
        console.error("Error writing document: ", e);
        window.alert(`Failed to save state: ${e.message}`);
    }
    // No need to call renderState() here, onSnapshot will do it.
}


// --- Theme and Settings ---
function applyTheme(colors) {
    const root = document.documentElement;
    if (!colors) colors = PRESETS.Nightingale;
    const colorMap = {
        colorBgStart: '--color-bg-start', colorBgEnd: '--color-bg-end', colorCardBg: '--color-card-bg',
        colorTextBase: '--color-text-base', colorTextMuted: '--color-text-muted', colorAccentPrimary: '--color-accent-primary',
        colorAccentSecondary: '--color-accent-secondary', colorAccentSecondaryHover: '--color-accent-secondary-hover', colorScore: '--color-score',
        colorBorderLight: '--color-border-light', colorBorderDark: '--color-border-dark', colorInputBg: '--color-input-bg',
        colorShadowPrimary: '--color-shadow-primary', colorShadowSecondary: '--color-shadow-secondary',
    };
    for (const [key, cssVar] of Object.entries(colorMap)) {
        if (colors[key]) {
            root.style.setProperty(cssVar, colors[key]);
        }
    }
    root.setAttribute('data-theme', gameState.settings.theme);
}
function getColorsFromPickers() {
    return {
        colorBgStart: document.getElementById('color-bg-start').value,
        colorBgEnd: document.getElementById('color-bg-end').value,
        colorCardBg: document.getElementById('color-card-bg').value,
        colorTextBase: document.getElementById('color-text-base').value,
        colorAccentPrimary: document.getElementById('color-accent-primary').value,
        colorAccentSecondary: document.getElementById('color-accent-secondary').value,
        colorScore: document.getElementById('color-score').value,
        ...getNonPickerColors(document.getElementById('theme-preset-select').value)
    };
}
function setColorsInPickers(colors) {
    document.getElementById('color-bg-start').value = colors.colorBgStart;
    document.getElementById('color-bg-end').value = colors.colorBgEnd;
    document.getElementById('color-card-bg').value = colors.colorCardBg;
    document.getElementById('color-text-base').value = colors.colorTextBase;
    document.getElementById('color-accent-primary').value = colors.colorAccentPrimary;
    document.getElementById('color-accent-secondary').value = colors.colorAccentSecondary;
    document.getElementById('color-score').value = colors.colorScore;
}
function getNonPickerColors(presetName) {
    const preset = PRESETS[presetName] || PRESETS.Nightingale;
    return {
        colorTextMuted: preset.colorTextMuted, colorAccentSecondaryHover: preset.colorAccentSecondaryHover,
        colorBorderLight: preset.colorBorderLight, colorBorderDark: preset.colorBorderDark,
        colorInputBg: preset.colorInputBg, colorShadowPrimary: preset.colorShadowPrimary,
        colorShadowSecondary: preset.colorShadowSecondary,
    };
}
window.openSettingsModal = function() {
    const settings = gameState.settings;
    document.getElementById('theme-preset-select').value = settings.theme;
    setColorsInPickers(settings.colors);
    document.getElementById('settings-modal').classList.remove('hidden');
    document.getElementById('settings-modal').classList.add('flex');
}
window.closeSettingsModal = function() {
    document.getElementById('settings-modal').classList.add('hidden');
    document.getElementById('settings-modal').classList.remove('flex');
    applyTheme(gameState.settings.colors); // Re-apply saved theme
}
window.saveSettings = function() {
    const newState = JSON.parse(JSON.stringify(gameState));
    const newThemeName = document.getElementById('theme-preset-select').value;
    const pickerColors = getColorsFromPickers();
    const basePreset = PRESETS[newThemeName] || PRESETS.Nightingale;
    
    newState.settings.theme = newThemeName;
    newState.settings.colors = { ...basePreset, ...pickerColors };

    applyTheme(newState.settings.colors); // Apply locally
    updateGameState(newState, `Theme settings updated.`); // Save to FS
    window.closeSettingsModal();
}
window.handlePresetChange = function() {
    const presetName = document.getElementById('theme-preset-select').value;
    if (presetName !== 'Custom') {
        const presetColors = PRESETS[presetName];
        setColorsInPickers(presetColors);
        applyTheme(presetColors); // Live preview
    }
}
window.setPresetToCustom = function() {
    document.getElementById('theme-preset-select').value = 'Custom';
    const pickerColors = getColorsFromPickers();
    const basePreset = PRESETS[gameState.settings.theme] || PRESETS.Nightingale;
    applyTheme({ ...basePreset, ...pickerColors }); // Live preview
}


// --- Rendering Functions ---
function renderState() {
    // 1. Apply Theme
    if (gameState.settings && gameState.settings.colors) {
        applyTheme(gameState.settings.colors);
    } else {
        applyTheme(PRESETS.Nightingale);
    }

    // 2. Render Scores and Names
    ['keeper', 'nightingale'].forEach(key => {
        const player = gameState.players[key];
        const score = gameState.scores[key];
        const titleEl = document.getElementById(`${key}-title`);
        const nameEl = document.getElementById(`player-name-${key}`);
        const scoreEl = document.getElementById(`score-${key}`);
        const cardEl = document.getElementById(`${key}-card`);
        if (player) {
            nameEl.textContent = player.name;
            titleEl.textContent = `The ${player.title}`;
            titleEl.style.color = player.color;
            cardEl.style.borderColor = player.color; 
        }
        if (scoreEl) scoreEl.textContent = score;
    });

    // 3. Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    if (!gameState.habits || gameState.habits.length === 0) {
        habitsList.innerHTML = '<p class="text-gray-500" id="habits-loading">No habits defined yet.</p>';
    } else {
        gameState.habits.forEach((habit, index) => {
            const player = gameState.players[habit.assignee];
            const name = player ? player.name : 'Unknown User';
            const color = player ? player.color : '#9ca3af';
            const habitItem = document.createElement('div');
            habitItem.className = 'card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between sm:space-x-4 space-y-3 sm:space-y-0';
            habitItem.innerHTML = `
                <div class="flex-grow">
                    <p class="text-lg font-semibold">${habit.description}</p>
                    <p class="text-sm" style="color: var(--color-text-muted);">
                        <span style="color: ${color}; font-weight: bold;">(${habit.assignee.charAt(0).toUpperCase() + habit.assignee.slice(1)})</span>
                        &mdash; ${name} | ${habit.points} Points | ${habit.timesPerWeek}x Week
                    </p>
                </div>
                <div class="flex space-x-2 flex-shrink-0 w-full sm:w-auto">
                    <button onclick="window.completeHabit(${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-green-700 border-green-500 flex-1">
                        <i class="fas fa-check"></i>
                    </button>
                    <button onclick="window.deleteItem('habit', ${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-red-700 border-red-500 flex-1">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>`;
            habitsList.appendChild(habitItem);
        });
    }

    // 4. Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    if (!gameState.rewards || gameState.rewards.length === 0) {
        rewardsList.innerHTML = '<p class="text-gray-500 col-span-full" id="rewards-loading">No rewards defined yet.</p>';
    } else {
        gameState.rewards.forEach((reward, index) => {
            const rewardItem = document.createElement('div');
            rewardItem.className = 'card p-4 space-y-2 border-l-4';
            rewardItem.style.borderLeftColor = 'var(--color-accent-secondary)';
            rewardItem.innerHTML = `
                <div class="flex justify-between items-center">
                    <p class="text-xl font-semibold">${reward.title}</p>
                    <span class="text-lg font-cinzel" style="color: var(--color-score);">${reward.cost} Pts</span>
                </div>
                <p class="text-sm" style="color: var(--color-text-muted);">${reward.description}</p>
                <div class="flex space-x-2 pt-2">
                    <button onclick="window.claimReward(${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-green-700 border-green-500">
                        <i class="fas fa-gift"></i> Claim
                    </button>
                    <button onclick="window.deleteItem('reward', ${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-red-700 border-red-500">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>`;
            rewardsList.appendChild(rewardItem);
        });
    }

    // 5. Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    if (!gameState.punishments || gameState.punishments.length === 0) {
        punishmentsList.innerHTML = '<p class="text-gray-500 col-span-full" id="punishments-loading">No punishments defined yet.</p>';
    } else {
        gameState.punishments.forEach((punishment, index) => {
            const punishmentItem = document.createElement('div');
            punishmentItem.className = 'card p-4 space-y-2 border-l-4';
            punishmentItem.style.borderLeftColor = 'var(--color-accent-primary)';
            punishmentItem.innerHTML = `
                <div class="flex justify-between items-center">
                    <p class="text-xl font-semibold">${punishment.title}</p>
                </div>
                <p class="text-sm" style="color: var(--color-text-muted);">${punishment.description}</p>
                <div class="flex space-x-2 pt-2">
                    <button onclick="window.deleteItem('punishment', ${index})" class="glowing-btn px-3 py-1 rounded text-xs bg-red-700 border-red-500">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>`;
            punishmentsList.appendChild(punishmentItem);
        });
    }

    // 6. Render History
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    if (!gameState.history || gameState.history.length === 0) {
        historyList.innerHTML = '<li class="text-gray-500" id="history-loading">Awaiting ledger entry...</li>';
    } else {
        gameState.history.forEach(item => {
            const date = new Date(item.timestamp).toLocaleTimeString();
            const historyItem = document.createElement('li');
            historyItem.className = 'text-sm border-b pb-2';
            historyItem.style.borderColor = 'var(--color-border-dark)';
            historyItem.innerHTML = `[${date}] ${item.message}`;
            historyList.appendChild(historyItem);
        });
    }

    // Ensure the correct tab is highlighted
    setActiveTab(window.activeTab || 'habits');
}

// --- Editing User Data ---
window.openEditProfileModal = function(playerKey) {
    const player = gameState.players[playerKey];
    document.getElementById('profile-modal-title').textContent = `Edit ${player.title}'s Profile`;
    document.getElementById('profile-modal-player-key').value = playerKey;
    document.getElementById('profile-modal-name').value = player.name;
    document.getElementById('profile-modal-title').value = player.title;
    document.getElementById('profile-modal-color').value = player.color;
    document.getElementById('profile-modal').classList.remove('hidden');
    document.getElementById('profile-modal').classList.add('flex');
}
window.closeProfileModal = function() {
    document.getElementById('profile-modal').classList.add('hidden');
    document.getElementById('profile-modal').classList.remove('flex');
}
window.savePlayerProfile = function() {
    const playerKey = document.getElementById('profile-modal-player-key').value;
    const newName = document.getElementById('profile-modal-name').value.trim();
    const newTitle = document.getElementById('profile-modal-title').value.trim();
    const newColor = document.getElementById('profile-modal-color').value;
    if (!newName || !newTitle) {
        window.alert("Name and Title cannot be empty.");
        return;
    }
    const newState = JSON.parse(JSON.stringify(gameState));
    const formattedTitle = newTitle.charAt(0).toUpperCase() + newTitle.slice(1);
    newState.players[playerKey] = { name: newName, title: formattedTitle, color: newColor };
    updateGameState(newState, `${formattedTitle}'s profile was updated.`);
    window.closeProfileModal();
}

// --- Habit, Reward, Punishment CRUD ---
window.addNewHabit = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const times = parseInt(document.getElementById('new-habit-times').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value;
    if (!desc || isNaN(points) || points < 1 || isNaN(times) || times < 1 || times > 7 || !assignee) {
        window.alert("Please fill out all habit fields correctly.");
        return;
    }
    const newState = JSON.parse(JSON.stringify(gameState));
    newState.habits.push({ description: desc, points: points, timesPerWeek: times, assignee: assignee });
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = '';
    document.getElementById('new-habit-times').value = '';
    document.getElementById('new-habit-assignee').value = '';
    const title = newState.players[assignee].title;
    updateGameState(newState, `New Habit added for The ${title}: "${desc}" (${points} Pts).`);
    window.toggleHabitForm(false);
}
window.addNewReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const desc = document.getElementById('new-reward-desc').value.trim();
    if (!title || isNaN(cost) || cost < 1 || !desc) {
        window.alert("Please fill out all reward fields correctly.");
        return;
    }
    const newState = JSON.parse(JSON.stringify(gameState));
    newState.rewards.push({ title: title, cost: cost, description: desc });
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = '';
    document.getElementById('new-reward-desc').value = '';
    updateGameState(newState, `New Reward cataloged: "${title}" (${cost} Pts).`);
    window.toggleRewardForm(false);
}
window.addNewPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();
    if (!title || !desc) {
        window.alert("Please fill out all punishment fields.");
        return;
    }
    const newState = JSON.parse(JSON.stringify(gameState));
    newState.punishments.push({ title: title, description: desc });
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    updateGameState(newState, `New Punishment cataloged: "${title}".`);
    window.togglePunishmentForm(false);
}
window.deleteItem = function(type, index) {
    const newState = JSON.parse(JSON.stringify(gameState));
    let historyMessage = '';
    if (type === 'habit') {
        const habit = newState.habits.splice(index, 1)[0];
        historyMessage = `Habit removed: "${habit.description}".`;
    } else if (type === 'reward') {
        const reward = newState.rewards.splice(index, 1)[0];
        historyMessage = `Reward removed from catalog: "${reward.title}".`;
    } else if (type === 'punishment') {
        const punishment = newState.punishments.splice(index, 1)[0];
        historyMessage = `Punishment removed: "${punishment.title}".`;
    }
    updateGameState(newState, historyMessage);
}

// --- Game/Scoring Logic ---
window.completeHabit = function(index) {
    const habit = gameState.habits[index];
    if (!habit) return;
    const player = habit.assignee;
    const otherPlayer = player === 'keeper' ? 'nightingale' : 'keeper';
    const points = habit.points;
    const newState = JSON.parse(JSON.stringify(gameState));
    newState.scores[otherPlayer] += points; 
    const gainerTitle = newState.players[otherPlayer].title;
    const assigneeTitle = newState.players[player].title;
    const historyMessage = `The ${assigneeTitle} completed Habit: "${habit.description}". The ${gainerTitle} gained ${points} points.`;
    updateGameState(newState, historyMessage);
}
window.claimReward = function(index) {
    const reward = gameState.rewards[index];
    if (!reward) return;
    showModal("Claim Reward", "Which player is claiming this reward? (Enter 'keeper' or 'nightingale')", true, '').then(claimerInput => {
        if (!claimerInput) return;
        const claimerKey = claimerInput.toLowerCase().trim();
        if (claimerKey !== 'keeper' && claimerKey !== 'nightingale') {
            window.alert("Invalid player name. Must be 'keeper' or 'nightingale'.");
            return;
        }
        const cost = reward.cost;
        const currentScore = gameState.scores[claimerKey];
        if (currentScore < cost) {
            window.alert(`The ${gameState.players[claimerKey].title} does not have enough points (Needed: ${cost}, Current: ${currentScore}).`);
            return;
        }
        const newState = JSON.parse(JSON.stringify(gameState));
        newState.scores[claimerKey] -= cost;
        const claimerTitle = newState.players[claimerKey].title;
        const historyMessage = `The ${claimerTitle} claimed Reward: "${reward.title}" for ${cost} points.`;
        updateGameState(newState, historyMessage);
    });
}

// --- UI / Example Functions ---
window.activeTab = 'habits';
window.setActiveTab = function(tabName) {
    window.activeTab = tabName;
    document.querySelectorAll('[id^="content-"]').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('tab-active');
        el.classList.add('tab-inactive');
    });
    document.getElementById(`content-${tabName}`).classList.remove('hidden');
    const tabBtn = document.getElementById(`tab-${tabName}`);
    tabBtn.classList.remove('tab-inactive');
    tabBtn.classList.add('tab-active');
}
window.toggleHabitForm = function(forceShow = null) {
    const form = document.getElementById('habit-form');
    const isHidden = form.classList.contains('hidden');
    if (forceShow === true || (forceShow === null && isHidden)) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}
window.toggleRewardForm = function(forceShow = null) {
    const form = document.getElementById('reward-form');
    const isHidden = form.classList.contains('hidden');
    if (forceShow === true || (forceShow === null && isHidden)) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}
window.togglePunishmentForm = function(forceShow = null) {
    const form = document.getElementById('punishment-form');
    const isHidden = form.classList.contains('hidden');
    if (forceShow === true || (forceShow === null && isHidden)) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
}
window.fillHabitForm = function(type) {
    if (!window.EXAMPLE_DATABASE) {
        window.alert("Example database not loaded. Please check examples.js.");
        return;
    }
    const examples = EXAMPLE_DATABASE.habits.filter(h => h.type === type);
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-habit-desc').value = example.description;
    document.getElementById('new-habit-points').value = example.points;
    document.getElementById('new-habit-times').value = 1;
    document.getElementById('new-habit-assignee').value = example.type;
    if (document.getElementById('habit-form').classList.contains('hidden')) { window.toggleHabitForm(true); }
}
window.fillRewardForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        window.alert("Example database not loaded. Please check examples.js.");
        return;
    }
    const examples = EXAMPLE_DATABASE.rewards;
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-reward-title').value = example.title;
    document.getElementById('new-reward-cost').value = example.cost;
    document.getElementById('new-reward-desc').value = example.description;
    if (document.getElementById('reward-form').classList.contains('hidden')) { window.toggleRewardForm(true); }
}
window.fillPunishmentForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        window.alert("Example database not loaded. Please check examples.js.");
        return;
    }
    const examples = EXAMPLE_DATABASE.punishments;
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-punishment-title').value = example.title;
    document.getElementById('new-punishment-desc').value = example.description;
    if (document.getElementById('punishment-form').classList.contains('hidden')) { window.togglePunishmentForm(true); }
}