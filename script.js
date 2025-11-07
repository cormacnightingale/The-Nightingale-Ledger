import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, 
    // Added imports for full authentication support
    createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firestore log level to Debug for better visibility
setLogLevel('Debug');

// --- Global Variables (Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : window.firebaseConfig;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let isAuthReady = false; // CRITICAL: Flag to ensure app logic waits for auth

// Path for public/shared data
const GAME_STATE_DOC_ID = 'ledger_data';

let gameState = {
    // Default values for player roles
    nightingale: {
        points: 0,
        rewardsPurchased: 0,
        punishmentsReceived: 0,
        id: null // User ID of the Nightingale
    },
    keeper: {
        points: 0,
        rewardsPurchased: 0,
        punishmentsReceived: 0,
        id: null // User ID of the Keeper
    },
    rewards: [],
    punishments: [],
    history: [],
    lastUpdated: new Date().toISOString(),
    // These roles track which user ID is assigned to which role in the ledger
    nightingaleId: null, 
    keeperId: null 
};

/**
 * --- CORE APP LOGIC ---
 */

/**
 * Determines the current authenticated user's role based on the gameState.
 * @returns {'nightingale'|'keeper'|'observer'|null}
 */
function getMyRole() {
    if (gameState.nightingaleId === userId) return 'nightingale';
    if (gameState.keeperId === userId) return 'keeper';
    if (gameState.nightingaleId && gameState.keeperId) return 'observer';
    return null;
}

/**
 * Attaches a real-time listener to the shared ledger document.
 * This MUST only be called after authentication is complete (i.e., when isAuthReady is true).
 */
function setupLedgerListener() {
    if (!db) {
        console.error("Firestore not initialized.");
        return;
    }
    
    // Use the explicit doc() function for clarity and reliability
    const ledgerRef = doc(db, 'artifacts', appId, 'public', 'data', 'ledger_state', GAME_STATE_DOC_ID);
    
    // onSnapshot call (The user must be authenticated at this point)
    onSnapshot(ledgerRef, (docSnap) => { 
        if (docSnap.exists()) {
            // Load and merge new data
            const newData = docSnap.data();
            
            // 1. Update gameState globally
            gameState = { ...gameState, ...newData };

            // 2. Identify the current user's role
            const myRole = getMyRole();
            
            // 3. Update UI based on new state
            updateAllUI(myRole);
            
            // CRITICAL: Check if this user needs to claim a role (only once)
            if (!gameState.nightingaleId || !gameState.keeperId) {
                 // If neither role is set, trigger role selection modal if not already visible
                const loginModalHidden = document.getElementById('login-modal')?.classList.contains('hidden');
                const roleModalVisible = !document.getElementById('role-selection-modal')?.classList.contains('hidden');

                if (loginModalHidden && !roleModalVisible) {
                     window.showRoleSelectionModal();
                }
            }


        } else {
            console.log("No ledger data found, creating initial document.");
            // If the document doesn't exist, create it with initial state
            setDoc(ledgerRef, gameState)
                .then(() => console.log("Initial ledger document created."))
                .catch(error => console.error("Error creating initial document:", error));
        }
    }, (error) => {
        // This is the error handler. The "Missing or insufficient permissions" error often lands here.
        console.error("Firestore Listener Error:", error); 
        // Display a more helpful message to the user
        window.showConnectionError("Access to the shared ledger failed. This usually means the system is not yet fully initialized or you need to sign in.");
    });
}

/**
 * Updates the Firestore document with the new gameState object.
 */
window.updateLedger = function() {
    if (!db || !isAuthReady) {
        console.error("Cannot update ledger: DB not ready or not authenticated.");
        return;
    }
    
    const ledgerRef = doc(db, 'artifacts', appId, 'public', 'data', 'ledger_state', GAME_STATE_DOC_ID);
    
    // Add last updated timestamp before writing
    gameState.lastUpdated = new Date().toISOString();
    
    setDoc(ledgerRef, gameState)
        .then(() => console.log("Ledger updated successfully."))
        .catch(error => console.error("Error updating ledger:", error));
}


/**
 * --- UI UPDATE FUNCTIONS ---
 */

window.showConnectionError = function(message) {
    document.getElementById('auth-error-message').textContent = message;
    document.getElementById('auth-error-message').classList.remove('hidden');
    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
}

function updateAllUI(myRole) {
    // 1. Update Debug Info
    document.getElementById('current-user-id').textContent = userId;
    document.getElementById('current-app-id').textContent = appId;
    document.getElementById('my-role-display').textContent = myRole ? `(${myRole.toUpperCase()})` : '(OBSERVER)';
    
    // 2. Update Points & Status (assuming functions exist)
    window.updatePointsDisplay(myRole); 
    window.renderHabits(gameState.rewards, 'keeper'); // Assuming existing functions
    window.renderPunishments(gameState.punishments, 'nightingale'); // Assuming existing functions
}

window.updatePointsDisplay = function(myRole) {
    const nPoints = document.getElementById('nightingale-points');
    if (nPoints) nPoints.textContent = gameState.nightingale.points;
    const kPoints = document.getElementById('keeper-points');
    if (kPoints) kPoints.textContent = gameState.keeper.points;
}
window.renderHabits = (habits, playerRole) => { 
    // Stub: Ensure placeholder is hidden and list is potentially rendered
    const loadingEl = document.getElementById('habits-loading');
    if (loadingEl) loadingEl.classList.add('hidden');
    // Implement actual habit rendering logic here...
}
window.renderPunishments = (punishments, playerRole) => { 
    // Stub: Ensure placeholder is hidden and list is potentially rendered
    const loadingEl = document.getElementById('punishments-loading');
    if (loadingEl) loadingEl.classList.add('hidden');
    // Implement actual punishment rendering logic here...
}
window.showRoleSelectionModal = () => { 
    // Stub: Assuming modal exists
    const modal = document.getElementById('role-selection-modal');
    if (modal) modal.classList.remove('hidden');
}
window.hideLoginModal = () => { 
    // Stub: Assuming modal exists
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.add('hidden');
}
window.showLoginModal = function() {
    // Stub: Assuming modal exists
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.remove('hidden');
}

window.showNotification = function(message) {
    // Use a custom modal/snackbar or log for compliance
    console.log("Notification:", message); 
}


/**
 * --- FIREBASE INITIALIZATION AND AUTHENTICATION ---
 */

async function initFirebaseAndAuth() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Use a persistent onAuthStateChanged listener to handle all auth states
        onAuthStateChanged(auth, (user) => {
            if (user) {
                // User is signed in.
                userId = user.uid;
                
                // CRITICAL FIX: Only call the listener AFTER the user is authenticated.
                if (!isAuthReady) {
                    isAuthReady = true;
                    console.log("Authentication complete. Setting up Ledger Listener.");
                    setupLedgerListener();
                    
                    // Update UI and hide loading screen
                    const myRole = getMyRole();
                    updateAllUI(myRole);
                    
                    document.getElementById('loading-screen').classList.add('hidden');
                    document.getElementById('app-container').classList.remove('hidden');
                    window.hideLoginModal(); 
                }

            } else {
                // User is signed out. 
                userId = null;
                isAuthReady = false;
                console.log("User signed out. Displaying Login Modal.");
                
                // Keep the app hidden and show the login modal
                document.getElementById('loading-screen').classList.add('hidden'); // Hide the generic loading screen
                document.getElementById('app-container').classList.add('hidden');
                window.showLoginModal();
            }
        });
        
        // Handle initial custom token sign-in if available (canvas environment)
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else if (!auth.currentUser) {
            // Safety: Try anonymous sign-in if no user is present and no custom token.
            await signInAnonymously(auth);
        }
        
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        window.showConnectionError(`A critical error occurred during initialization: ${error.message}. Please check your configuration.`);
    }
}


// --- Initialization ---

// Run initialization on window load
window.onload = function() {
    // Ensure the loading screen is visible initially
    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
    
    // Start Firebase initialization
    initFirebaseAndAuth();
}

/**
 * Fills the Add New Habit form with random example data.
 */
window.fillHabitForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        window.showNotification("Example database not loaded.");
        return;
    }
    const examples = EXAMPLE_DATABASE.habits;
    if (examples.length === 0) return;

    const example = examples[Math.floor(Math.random() * examples.length)];

    document.getElementById('new-habit-desc').value = example.description;
    document.getElementById('new-habit-points').value = example.points;
    document.getElementById('new-habit-type').value = example.type;
    
    // Check if form is hidden, show it
    const form = document.getElementById('habit-form');
    if (form && form.classList.contains('hidden')) { window.toggleHabitForm(true); }
}

/**
 * Fills the Add New Reward form with random example data.
 */
window.fillRewardForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        window.showNotification("Example database not loaded.");
        return;
    }
    const examples = EXAMPLE_DATABASE.rewards;
    if (examples.length === 0) return;

    const example = examples[Math.floor(Math.random() * examples.length)];

    document.getElementById('new-reward-title').value = example.title;
    document.getElementById('new-reward-cost').value = example.cost;
    document.getElementById('new-reward-desc').value = example.description;
    
    // Check if form is hidden, show it
    const form = document.getElementById('reward-form');
    if (form && form.classList.contains('hidden')) { window.toggleRewardForm(true); }
}

/**
 * Fills the Add New Punishment form with random example data.
 */
window.fillPunishmentForm = function() {
    if (!window.EXAMPLE_DATABASE) {
        window.showNotification("Example database not loaded.");
        return;
    }
    const examples = EXAMPLE_DATABASE.punishments;
    if (examples.length === 0) return;

    const example = examples[Math.floor(Math.random() * examples.length)];

    document.getElementById('new-punishment-title').value = example.title;
    document.getElementById('new-punishment-desc').value = example.description;
    
    // Check if form is hidden, show it
    const form = document.getElementById('punishment-form');
    if (form && form.classList.contains('hidden')) { window.togglePunishmentForm(true); }
}

// --- Stubs for assumed interaction functions (Required to prevent errors) ---

window.toggleHabitForm = function(show) {
    const form = document.getElementById('habit-form');
    if (form) form.classList.toggle('hidden', !show);
}
window.toggleRewardForm = function(show) {
    const form = document.getElementById('reward-form');
    if (form) form.classList.toggle('hidden', !show);
}
window.togglePunishmentForm = function(show) {
    const form = document.getElementById('punishment-form');
    if (form) form.classList.toggle('hidden', !show);
}


// --- Authentication Handlers ---

window.handleSignIn = async function(email, password) {
    if (!auth) return;
    try {
        await signInWithEmailAndPassword(auth, email, password);
        return { success: true };
    } catch (error) {
        console.error("Email/Password Sign In Error:", error);
        return { success: false, message: error.message };
    }
}

window.handleSignUp = async function(email, password) {
    if (!auth) return;
    try {
        await createUserWithEmailAndPassword(auth, email, password);
        return { success: true };
    } catch (error) {
        console.error("Email/Password Sign Up Error:", error);
        return { success: false, message: error.message };
    }
}

window.handleGoogleSignIn = async function() {
    if (!auth) return;
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        return { success: true };
    } catch (error) {
        console.error("Google Sign In Error:", error);
        return { success: false, message: error.message };
    }
}

window.handleSignOut = async function() {
    if (!auth) return;
    try {
        await signOut(auth);
        console.log("User signed out successfully.");
    } catch (error) {
        console.error("Sign Out Error:", error);
    }
}

window.claimRole = function(role) {
    if (!isAuthReady || !userId) {
        console.error("Cannot claim role: Not authenticated.");
        return;
    }
    
    const myRole = getMyRole();

    if (role === 'nightingale' && !gameState.nightingaleId) {
        gameState.nightingaleId = userId;
        gameState.nightingale.id = userId; // Redundant but good for safety
        window.updateLedger();
    } else if (role === 'keeper' && !gameState.keeperId) {
        gameState.keeperId = userId;
        gameState.keeper.id = userId; // Redundant but good for safety
        window.updateLedger();
    } else {
        // If the user tries to claim a role already taken by someone else
        if (myRole === null) {
            window.showNotification(`The ${role} role is already claimed by another user. You are an Observer.`);
        }
        console.warn(`Role ${role} is already claimed or invalid.`);
    }
    
    // Hide the modal after attempting to claim
    const modal = document.getElementById('role-selection-modal');
    if (modal) modal.classList.add('hidden');
}