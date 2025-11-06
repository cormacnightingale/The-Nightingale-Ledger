import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment or User File) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Local Storage Key for remembering the last connected ledger
const LAST_LEDGER_KEY = `nightingale_ledger_code_${appId}`;

// FIX: Check for the canvas string (__firebase_config) OR the global object (window.firebaseConfig)
// The global object is created when firebase_config.js is loaded in index.html
const configSource = typeof __firebase_config !== 'undefined' 
    ? JSON.parse(__firebase_config) 
    : (typeof window.firebaseConfig !== 'undefined' ? window.firebaseConfig : null);
const firebaseConfig = configSource;

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let isAuthReady = false; // Flag to ensure DB is initialized
const GAME_STATE_COLLECTION = 'ledgers'; // Collection where all ledger data is stored
const LEDGER_DOC_ID_LENGTH = 6; // Length of the random code/document ID

let gameState = {
    // Customization state
    customization: {
        keeperTitle: 'The Keeper',
        nightingaleTitle: 'The Nightingale',
        keeperName: 'User 1', // Placeholder for the actual user
        nightingaleName: 'User 2', // Placeholder for the actual user
        currentLayout: 'stacked', // 'stacked', 'condensed', 'tabbed'
        currentTab: 'habits',      // 'habits', 'rewards', 'punishments'
    },
    // NEW: Map user IDs to their roles
    users: {
        keeperId: null,
        nightingaleId: null
    },
    scores: {
        keeper: 0,
        nightingale: 0
    },
    habits: [],
    rewards: [],
    punishments: [],
    ledgerCode: null, // The 6-character code
    hostId: null,      // The ID of the user who created the ledger
};

// Tracks 'keeper', 'nightingale', or null for the current client.
// 'viewer' is reserved for a third party who has no assigned role.
let userRole = null; 

// --- Utility Functions ---

/**
 * Generates a random alphanumeric code of a specified length.
 * @param {number} length
 * @returns {string} The generated code.
 */
function generateLedgerCode(length = LEDGER_DOC_ID_LENGTH) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Returns the collection path for publicly shared ledgers.
 * @returns {string} The full Firestore path.
 */
function getLedgerCollectionPath() {
    // Public data for sharing with other users
    return `/artifacts/${appId}/public/data/${GAME_STATE_COLLECTION}`;
}

/**
 * Updates the UI display of the User ID and App ID in the footer.
 */
function updateDebugInfo() {
    document.getElementById('current-user-id').textContent = userId || 'N/A';
    document.getElementById('current-app-id').textContent = appId || 'N/A';
}

/**
 * Shows a custom modal dialog (instead of alert).
 * @param {string} title - The title of the modal.
 * @param {string} message - The content message.
 */
function showModal(title, message) {
    console.error(`[MODAL] ${title}: ${message}`);
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modal = document.getElementById('custom-modal');

    if (!modal || !modalTitle || !modalBody) return;

    modalTitle.textContent = title;
    modalBody.textContent = message;
    modal.classList.remove('hidden');

    const closeModal = () => {
        modal.classList.add('hidden');
        document.getElementById('modal-close-btn').onclick = null; // Clean up
    };

    document.getElementById('modal-close-btn').onclick = closeModal;
}

/**
 * Toggles the visibility of the Options Modal.
 */
window.showOptionsModal = function() {
    // Populate inputs with current state before showing
    document.getElementById('edit-keeper-name').value = gameState.customization.keeperName;
    document.getElementById('edit-nightingale-name').value = gameState.customization.nightingaleName;
    document.getElementById('edit-keeper-title').value = gameState.customization.keeperTitle;
    document.getElementById('edit-nightingale-title').value = gameState.customization.nightingaleTitle;
    
    // Highlight the current layout button
    document.querySelectorAll('#options-modal button[id^="layout-btn-"]').forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
    });
    const activeBtn = document.getElementById(`layout-btn-${gameState.customization.currentLayout}`);
    if (activeBtn) {
        activeBtn.classList.remove('btn-secondary');
        activeBtn.classList.add('btn-primary');
    }
    
    document.getElementById('options-modal').classList.remove('hidden');
}

window.hideOptionsModal = function() {
    document.getElementById('options-modal').classList.add('hidden');
}

/**
 * Enables the main Host/Join buttons and hides the initialization status.
 */
function enableAppUI() {
    // Get all buttons on the setup screen and remove 'disabled'
    document.getElementById('host-select-btn')?.removeAttribute('disabled');
    document.getElementById('join-select-btn')?.removeAttribute('disabled');
    
    // Update status message
    const appStatus = document.getElementById('app-status');
    if (appStatus) {
        appStatus.textContent = 'Ready to connect or host.';
        appStatus.classList.remove('bg-yellow-900/50', 'text-yellow-300');
        appStatus.classList.add('bg-green-900/50', 'text-green-300');
    }
    console.log("App UI enabled. Buttons are now clickable.");
}

/**
 * Attempts to automatically join the last saved ledger code from local storage.
 * This runs only on initial load.
 * @param {string} code - The ledger code to attempt to join.
 */
async function attemptAutoJoin(code) {
    // Temporarily update status message
    const appStatus = document.getElementById('app-status');
    if (appStatus) {
        appStatus.textContent = `Attempting to automatically join last ledger: ${code}...`;
        appStatus.classList.remove('bg-green-900/50', 'text-green-300');
        appStatus.classList.add('bg-yellow-900/50', 'text-yellow-300');
    }

    const joined = await window.joinLedger(code, true); // Pass true to skip modal on success
    
    if (joined) {
        if (appStatus) appStatus.textContent = 'Successfully reconnected.';
    } else {
        // If auto-join failed (e.g., ledger deleted), clear the stored code
        localStorage.removeItem(LAST_LEDGER_KEY);
        if (appStatus) appStatus.textContent = 'Ready to connect or host.';
    }
    
    // Re-enable UI regardless of outcome
    enableAppUI();
}

/**
 * Disconnects the user from the current ledger, clears local storage, and resets the app state.
 */
window.disconnectLedger = function() {
    if (!gameState.ledgerCode) return;

    showModal("Disconnected", `You have disconnected from ledger ${gameState.ledgerCode}. To rejoin, use the code on the setup screen.`);
    
    // Clear local storage and local state
    localStorage.removeItem(LAST_LEDGER_KEY);
    gameState.ledgerCode = null;
    userRole = null;
    
    // A simple page reload is the most reliable way to reset Firebase listeners and the entire app state
    window.location.reload(); 
}


// --- Firebase Interaction ---

/**
 * Updates the customization part of the remote ledger document.
 * @param {object} updates - An object containing fields to update in the 'customization' map.
 */
async function updateLedgerCustomization(updates) {
    if (!db || !gameState.ledgerCode) {
        showModal("Update Failed", "Not connected to a ledger. Cannot save customizations.");
        return;
    }

    const ledgerDocRef = doc(db, getLedgerCollectionPath(), gameState.ledgerCode);
    
    // Construct the update object to modify nested fields
    const updatePayload = {};
    for (const key in updates) {
        updatePayload[`customization.${key}`] = updates[key];
    }

    try {
        await updateDoc(ledgerDocRef, updatePayload);
        console.log("Customization updated successfully.");
        // The onSnapshot listener will handle the UI update
    } catch (error) {
        console.error("Error updating customization:", error);
        showModal("Save Error", `Failed to save customization changes. Error: ${error.message}`);
    }
}

/**
 * Updates the user assignment part of the remote ledger document.
 * @param {object} updates - An object containing fields to update in the 'users' map (e.g., 'keeperId').
 */
async function updateLedgerUsers(updates) {
    if (!db || !gameState.ledgerCode) {
        showModal("Update Failed", "Not connected to a ledger. Cannot assign roles.");
        return false;
    }

    const ledgerDocRef = doc(db, getLedgerCollectionPath(), gameState.ledgerCode);
    
    // Construct the update object to modify nested fields
    const updatePayload = {};
    for (const key in updates) {
        updatePayload[`users.${key}`] = updates[key];
    }

    try {
        await updateDoc(ledgerDocRef, updatePayload);
        console.log("User roles updated successfully.");
        return true;
    } catch (error) {
        console.error("Error updating user roles:", error);
        showModal("Role Assignment Error", `Failed to assign user role. Error: ${error.message}`);
        return false;
    }
}

/**
 * Attaches a real-time listener to the current ledger document.
 */
function listenToLedger() {
    if (!db || !gameState.ledgerCode) {
        console.error("Database or Ledger Code not ready for listening.");
        return;
    }

    const ledgerDocRef = doc(db, getLedgerCollectionPath(), gameState.ledgerCode);

    onSnapshot(ledgerDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const remoteData = docSnap.data();
            console.log("Current data:", remoteData);
            
            // Deep merge customization data
            if (remoteData.customization) {
                 gameState.customization = { ...gameState.customization, ...remoteData.customization };
            }
            // Deep merge user data
            if (remoteData.users) {
                 gameState.users = { ...gameState.users, ...remoteData.users };
            }
            // Shallow merge other top-level data
            Object.keys(remoteData).forEach(key => {
                if (key !== 'customization' && key !== 'users') {
                    gameState[key] = remoteData[key];
                }
            });

            // Check if the current user is assigned a role
            if (gameState.users.keeperId === userId) {
                userRole = 'keeper';
            } else if (gameState.users.nightingaleId === userId) {
                userRole = 'nightingale';
            } else {
                userRole = null;
            }

            // After state update, check if the current user needs to set their profile
            if (gameState.ledgerCode && userRole && 
                ((userRole === 'keeper' && gameState.customization.keeperName === 'User 1') || 
                 (userRole === 'nightingale' && gameState.customization.nightingaleName === 'User 2'))) {
                
                window.showProfileModal(userRole);
            } else {
                // If they are all set or not connected, hide the modal
                document.getElementById('user-profile-modal').classList.add('hidden');
            }


            // Re-render the UI based on the new gameState
            renderUI();
        } else {
            // Document not found or has been deleted
            console.warn("Ledger document does not exist or has been deleted.");
            showModal("Ledger Lost", "The shared ledger has been disconnected or deleted by the host.");
            // Force disconnection to clear state
            window.disconnectLedger();
        }
    }, (error) => {
        console.error("Error listening to ledger:", error);
        showModal("Connection Error", "Failed to maintain real-time connection to the ledger.");
    });
}

/**
 * Renders the UI based on the current gameState, including names, titles, and layout.
 */
function renderUI() {
    // --- 1. Screen Toggles ---
    const setupScreen = document.getElementById('setup-screen');
    const mainScreen = document.getElementById('main-dashboard');

    if (gameState.ledgerCode) {
        setupScreen.classList.add('hidden');
        mainScreen.classList.remove('hidden');
        document.getElementById('current-ledger-code').textContent = gameState.ledgerCode;
    } else {
        setupScreen.classList.remove('hidden');
        mainScreen.classList.add('hidden');
    }

    // --- 2. Score/Title Updates ---
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;
    
    // Update titles and names from customization state
    document.getElementById('keeper-title').textContent = gameState.customization.keeperTitle;
    document.getElementById('nightingale-title').textContent = gameState.customization.nightingaleTitle;
    document.getElementById('keeper-name').textContent = gameState.customization.keeperName;
    document.getElementById('nightingale-name').textContent = gameState.customization.nightingaleName;

    // --- 3. Layout Rendering ---
    const layouts = ['stacked', 'condensed', 'tabbed'];
    layouts.forEach(layout => {
        const el = document.getElementById(`layout-${layout}`);
        if (el) {
            el.classList.add('hidden');
        }
    });

    const currentLayoutEl = document.getElementById(`layout-${gameState.customization.currentLayout}`);
    if (currentLayoutEl) {
        currentLayoutEl.classList.remove('hidden');
    }
    
    // --- 4. Tabbed Layout Specifics ---
    if (gameState.customization.currentLayout === 'tabbed') {
        window.setTab(gameState.customization.currentTab, false); // Render the active tab content
    }
    
    // TODO: Implement habit/reward/punishment list rendering across all relevant lists (stacked, tabbed)

    // --- 5. Debug Info Update ---
    updateDebugInfo();
}

/**
 * Attempts to host a new ledger with a randomly generated code.
 */
window.hostNewLedger = async function() {
    // CRITICAL: Ensure DB is ready.
    if (!db || !isAuthReady) {
        showModal("Initialization Error", "The application is still initializing. Please wait until the app status shows 'Ready'.");
        return; 
    }

    const newCode = generateLedgerCode();
    // The collection path is constructed here
    const collectionPath = getLedgerCollectionPath(); 
    const ledgerDocRef = doc(db, collectionPath, newCode); 
    
    // Host is assigned as the Keeper
    const initialLedgerData = {
        customization: gameState.customization, 
        users: {
            keeperId: userId,
            nightingaleId: null
        },
        scores: { keeper: 0, nightingale: 0 }, 
        habits: [],
        rewards: [],
        punishments: [],
        ledgerCode: newCode,
        hostId: userId,
        createdAt: new Date().toISOString(),
        isHosted: true,
    };

    try {
        const docSnap = await getDoc(ledgerDocRef);
        if (docSnap.exists()) {
            console.warn("Hosting conflict detected. Retrying with new code.");
            showModal("Hosting Conflict", "A ledger with this code already exists. Retrying...");
            return hostNewLedger();
        }

        await setDoc(ledgerDocRef, initialLedgerData);

        // Success! Update local state and start listening
        gameState.ledgerCode = newCode;
        gameState.hostId = userId;
        userRole = 'keeper'; // Set local role
        localStorage.setItem(LAST_LEDGER_KEY, newCode); // Persist the code
        console.log(`Hosted new ledger successfully.`);
        showModal("Ledger Hosted!", `Your new shared ledger code is: ${newCode}. Share this with your partner!`);
        listenToLedger();
        
        // Immediately prompt the host (Keeper) to set their profile
        window.showProfileModal('keeper');

    } catch (error) {
        console.error("Error hosting new ledger:", error);
        showModal("Hosting Failed", `Could not create the ledger document. Error: ${error.message}`);
    }
}

/**
 * Attempts to join an existing ledger using a code.
 * @param {string} [codeOverride=null] - Optional code to join (used for auto-join).
 * @param {boolean} [silent=false] - If true, suppresses the success modal.
 * @returns {Promise<boolean>} True if joined successfully, false otherwise.
 */
window.joinLedger = async function(codeOverride = null, silent = false) {
    if (!db || !isAuthReady) {
        showModal("Initialization Error", "The application is still initializing. Please wait until the app status shows 'Ready'.");
        return false; 
    }

    const code = codeOverride || document.getElementById('join-code').value.toUpperCase().trim();

    if (code.length !== LEDGER_DOC_ID_LENGTH) {
        if (!silent) showModal("Invalid Code", `The ledger code must be exactly ${LEDGER_DOC_ID_LENGTH} characters long.`);
        return false;
    }

    const ledgerDocRef = doc(db, getLedgerCollectionPath(), code);

    try {
        const docSnap = await getDoc(ledgerDocRef);

        if (docSnap.exists()) {
            const remoteData = docSnap.data();
            
            // Check for existing assignment or available slot (Security Check)
            let assignedRole = null;
            let updates = {};
            
            const isCurrentUserKeeper = remoteData.users?.keeperId === userId;
            const isCurrentUserNightingale = remoteData.users?.nightingaleId === userId;
            const isKeeperTaken = !!remoteData.users?.keeperId;
            const isNightingaleTaken = !!remoteData.users?.nightingaleId;

            if (isCurrentUserKeeper) {
                 assignedRole = 'keeper'; // User is already the Keeper
            } else if (isCurrentUserNightingale) {
                 assignedRole = 'nightingale'; // User is already the Nightingale
            } else if (isKeeperTaken && isNightingaleTaken) {
                // Both primary roles are taken - prevents a 3rd user from officially joining
                showModal("Ledger Full", "This ledger already has both the Keeper and the Nightingale assigned. You can observe, but cannot take a role.");
                return false;
            } else if (!isKeeperTaken) {
                assignedRole = 'keeper';
                updates.keeperId = userId;
            } else if (!isNightingaleTaken) {
                assignedRole = 'nightingale';
                updates.nightingaleId = userId;
            } else {
                // This state should not be reachable if logic is sound
                showModal("Assignment Error", "Could not determine an open role. Ledger may be in an inconsistent state.");
                return false;
            }

            // Assign role in Firestore if needed
            if (Object.keys(updates).length > 0) {
                const updateSuccess = await updateLedgerUsers(updates);
                if (!updateSuccess) return false; 
            }
            
            // Success! Update local state and start listening
            gameState.ledgerCode = code;
            gameState.hostId = remoteData.hostId;
            userRole = assignedRole; // Set local role
            localStorage.setItem(LAST_LEDGER_KEY, code); // Persist the code

            if (!silent) {
                showModal("Joined Successfully", `Connected to ledger ${code}. You are the ${assignedRole.charAt(0).toUpperCase() + assignedRole.slice(1)}.`);
            }
            listenToLedger();
            
            // Prompt the user to set their profile if using default name
            if ((userRole === 'keeper' && remoteData.customization?.keeperName === 'User 1') || 
                (userRole === 'nightingale' && remoteData.customization?.nightingaleName === 'User 2')) {
                window.showProfileModal(userRole);
            }
            return true;

        } else {
            if (!silent) showModal("Code Not Found", `No active ledger found for code: ${code}. Please verify the code.`);
            return false;
        }
    } catch (error) {
        console.error("Error joining ledger:", error);
        if (!silent) showModal("Joining Failed", `Could not connect to the ledger. Error: ${error.message}`);
        return false;
    }
}


// --- User Profile & Customization Functions ---

/**
 * Shows the modal for the current user to set their name and title.
 * @param {'keeper'|'nightingale'} role - The role the user is setting up.
 */
window.showProfileModal = function(role) {
    // Only show if the profile modal is not already displayed AND we have a role
    const modal = document.getElementById('user-profile-modal');
    if (modal.classList.contains('hidden')) {
        const roleEl = document.getElementById('profile-modal-role');
        const roleName = role.charAt(0).toUpperCase() + role.slice(1);
        
        roleEl.textContent = roleName;
        roleEl.classList.remove('text-yellow-300', 'text-green-400', 'text-blue-400');
        roleEl.classList.add(role === 'keeper' ? 'text-green-400' : 'text-blue-400');
        
        // Set placeholder/default values
        const currentName = gameState.customization[`${role}Name`];
        const currentTitle = gameState.customization[`${role}Title`];
        
        document.getElementById('profile-name-input').value = currentName === `User ${role === 'keeper' ? '1' : '2'}` ? '' : currentName;
        document.getElementById('profile-title-input').value = currentTitle === `The ${roleName}` ? '' : currentTitle;


        modal.classList.remove('hidden');
    }
}

/**
 * Saves the current user's name and title to the ledger based on their assigned role.
 */
window.setMyProfile = function() {
    if (!userRole) {
        showModal("Error", "Your role is not defined. Please reconnect.");
        return;
    }
    
    const nameInput = document.getElementById('profile-name-input').value.trim();
    const titleInput = document.getElementById('profile-title-input').value.trim();

    const defaultName = userRole === 'keeper' ? 'User 1' : 'User 2';
    const defaultTitle = userRole === 'keeper' ? 'The Keeper' : 'The Nightingale';

    const newName = nameInput || defaultName;
    const newTitle = titleInput || defaultTitle;
    
    if (newName.length > 30 || newTitle.length > 30) {
        showModal("Input Too Long", "Name and Title must be 30 characters or less.");
        return;
    }

    const updates = {};
    updates[`${userRole}Name`] = newName;
    updates[`${userRole}Title`] = newTitle;
    
    updateLedgerCustomization(updates);
    document.getElementById('user-profile-modal').classList.add('hidden');
}


/**
 * Saves the user-defined names (User 1 / User 2 placeholders).
 */
window.setPlayerName = function() {
    const keeperName = document.getElementById('edit-keeper-name').value.trim() || 'User 1';
    const nightingaleName = document.getElementById('edit-nightingale-name').value.trim() || 'User 2';
    
    if (keeperName.length > 30 || nightingaleName.length > 30) {
        showModal("Name Too Long", "Names must be 30 characters or less.");
        return;
    }

    updateLedgerCustomization({
        keeperName: keeperName,
        nightingaleName: nightingaleName
    });
    window.hideOptionsModal();
}

/**
 * Saves the user-defined titles (Keeper / Nightingale).
 */
window.setPlayerTitle = function() {
    const keeperTitle = document.getElementById('edit-keeper-title').value.trim() || 'The Keeper';
    const nightingaleTitle = document.getElementById('edit-nightingale-title').value.trim() || 'The Nightingale';

    if (keeperTitle.length > 30 || nightingaleTitle.length > 30) {
        showModal("Title Too Long", "Titles must be 30 characters or less.");
        return;
    }

    updateLedgerCustomization({
        keeperTitle: keeperTitle,
        nightingaleTitle: nightingaleTitle
    });
    window.hideOptionsModal();
}

/**
 * Switches and saves the current layout view.
 * @param {'stacked'|'condensed'|'tabbed'} layout - The layout key.
 */
window.setLayout = function(layout) {
    if (gameState.customization.currentLayout === layout) return;
    
    updateLedgerCustomization({
        currentLayout: layout
    });

    // Update button styling locally immediately (will be corrected by renderUI if save fails)
    document.querySelectorAll('#options-modal button[id^="layout-btn-"]').forEach(btn => {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
    });
    const activeBtn = document.getElementById(`layout-btn-${layout}`);
    if (activeBtn) {
        activeBtn.classList.remove('btn-secondary');
        activeBtn.classList.add('btn-primary');
    }
}

/**
 * Switches the active tab in the 'tabbed' layout.
 * @param {'habits'|'rewards'|'punishments'} tab - The tab key.
 * @param {boolean} saveToDb - Whether to save the active tab preference to the database (default: true).
 */
window.setTab = function(tab, saveToDb = true) {
    if (saveToDb) {
         updateLedgerCustomization({ currentTab: tab });
         gameState.customization.currentTab = tab; // Optimistic local update
    }

    // Toggle tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`tab-${tab}`)?.classList.add('active');

    // Toggle tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    document.getElementById(`tab-content-${tab}`)?.classList.remove('hidden');
}


// --- Core Initialization ---

/**
 * Initializes Firebase, authenticates the user, and sets up the app.
 */
window.initApp = async function() {
    if (!firebaseConfig) {
        showModal("Configuration Error", "Firebase configuration is missing. Cannot start the application. Ensure firebase_config.js is loaded.");
        return;
    }

    try {
        // IMPORTANT: Set debug level for easier development
        setLogLevel('debug');
        
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app); // Synchronous initialization of DB instance
        console.log("1. Firebase App and Firestore instance (db) created.");
        
        // Authentication Handler
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
            } else {
                // If sign-in fails or is not complete, try anonymous sign-in
                try {
                    await signInAnonymously(auth);
                } catch (anonError) {
                    console.error("Anonymous sign-in failed:", anonError);
                }
            }

            // Authentication is complete, DB is ready
            isAuthReady = true;
            console.log("2. Authentication complete. User ID:", userId);
            
            // NEW: Auto-load the last used ledger if a code is saved
            const lastCode = localStorage.getItem(LAST_LEDGER_KEY);
            if (lastCode) {
                await attemptAutoJoin(lastCode);
            } else {
                // Only enable UI if no auto-join attempt was made (or if it failed, which is handled in attemptAutoJoin)
                enableAppUI(); 
            }
            
            renderUI();
        });

        // Use custom token if provided (for Canvas environment)
        if (initialAuthToken) {
            console.log("Attempting sign-in with custom token.");
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            // If no token, the onAuthStateChanged handler above will trigger anonymous sign-in
            console.log("No custom token provided. Relying on onAuthStateChanged for anonymous sign-in.");
        }

    } catch (error) {
        console.error("Failed to initialize Firebase:", error);
        showModal("Initialization Failure", "The application could not connect to Firebase services.");
    }
};


// --- Event Handlers & Local State Management (Placeholders) ---

window.addHabit = function() {
    if (!gameState.ledgerCode) {
        showModal("Not Connected", "Please host or join a ledger before defining habits.");
        return;
    }
    // TODO: Implement logic to get form data and update the remote document using updateDoc()
    showModal("Feature Not Implemented", "Habit addition logic is pending implementation.");
};

window.addReward = function() {
    if (!gameState.ledgerCode) {
        showModal("Not Connected", "Please host or join a ledger before defining rewards.");
        return;
    }
    // TODO: Implement logic to get form data and update the remote document using updateDoc()
    showModal("Feature Not Implemented", "Reward definition logic is pending implementation.");
};

window.addPunishment = function() {
    if (!gameState.ledgerCode) {
        showModal("Not Connected", "Please host or join a ledger before defining punishments.");
        return;
    }
    // TODO: Implement logic to get form data and update the remote document using updateDoc()
    showModal("Feature Not Implemented", "Punishment definition logic is pending implementation.");
};

// Helper functions for UI toggling 
window.toggleSetup = function(section) {
    const screens = ['host-ledger', 'join-ledger', 'define-rules', 'host-join-select'];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });
    const targetEl = document.getElementById(section);
    if (targetEl) targetEl.classList.remove('hidden');
}

// Placeholder for generating example data
window.generateExample = function(type) {
    // Note: The 'examples.js' file is assumed to load the EXAMPLE_DATABASE globally.
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        showModal("Error", "Example data is not loaded correctly. Ensure examples.js is present.");
        return;
    }

    const examples = EXAMPLE_DATABASE[type + 's'];
    const randomIndex = Math.floor(Math.random() * examples.length);
    const example = examples[randomIndex];

    // Determine which input fields to target based on the current layout
    let suffix = '';
    if (gameState.customization.currentLayout === 'tabbed') {
        suffix = '-tab';
    }

    if (type === 'habit') {
        document.getElementById('new-habit-desc' + suffix).value = example.description;
        document.getElementById('new-habit-points' + suffix).value = example.points;
        document.getElementById('new-habit-times' + suffix).value = 1;
        document.getElementById('new-habit-assignee' + suffix).value = example.type;
    } else if (type === 'reward') {
        document.getElementById('new-reward-title' + suffix).value = example.title;
        document.getElementById('new-reward-cost' + suffix).value = example.cost;
        document.getElementById('new-reward-desc' + suffix).value = example.description;
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title' + suffix).value = example.title;
        document.getElementById('new-punishment-desc' + suffix).value = example.description;
    }
}


// Start the application when the window loads
window.onload = initApp;