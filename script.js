import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


/**
 * CRITICAL: Configuration Variables
 * 1. Replace these placeholder values with your actual Firebase project credentials.
 * 2. appId is used for Firestore pathing and must be consistent.
 */
const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE", 
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};
const appId = "nightingale-ledger-app"; // Used for Firestore Path: /artifacts/nightingale-ledger-app/users/{userId}/...


/**
 * EXAMPLE_DATABASE: Contains a list of pre-defined suggestions for habits, rewards,
 * and punishments.
 */
const EXAMPLE_DATABASE = {
    // --- HABITS (Description, Points, Type: 'keeper' or 'nightingale') ---
    habits: [
        // Daily Focus & Productivity (High Points)
        { description: "Complete the designated 'Deep Work' task for the day (min 90 minutes).", points: 30, type: 'keeper' },
        { description: "Review and organize the email inbox, reaching Inbox Zero.", points: 25, type: 'nightingale' },
        { description: "Adhere strictly to the meal plan (no unauthorized snacks/takeout).", points: 35, type: 'keeper' },
        { description: "Dedicate 60 minutes to learning a new professional skill (documented).", points: 40, type: 'nightingale' },
        
        // Health & Wellness (Medium Points)
        { description: "Engage in a moderate-intensity 45-minute exercise session.", points: 15, type: 'keeper' },
        { description: "Prepare lunch for the next day before 9 PM.", points: 10, type: 'nightingale' },
        { description: "Read a physical book for 20 minutes before bedtime.", points: 10, type: 'keeper' },
        { description: "Take all prescribed supplements/medication on time.", points: 5, type: 'nightingale' },
    ],

    // --- REWARDS (Title, Cost, Description) ---
    rewards: [
        // Indulgences
        { title: "The Dark Roast", cost: 20, description: "A high-quality, specialty coffee drink purchased from a preferred cafe." },
        { title: "Sweet Surrender", cost: 35, description: "One decadent dessert item of choice, no sharing required." },
        { title: "The Early Respite", cost: 50, description: "Allows one to retire to bed 30 minutes earlier than the usual schedule." },

        // Entertainment/Leisure
        { title: "A Chapter More", cost: 15, description: "An extra 30 minutes of undisturbed reading time." },
        { title: "An Hour of Gaming", cost: 40, description: "A full 60 minutes of uninterrupted screen time for gaming/movies." },
        { title: "A New Book/Game", cost: 75, description: "Partner buys a small, pre-approved item (book, video game, etc.) under $20." },
    ],

    // --- PUNISHMENTS (Title, Description) ---
    punishments: [
        // Domestic Tasks
        { title: "The Floor Detail", description: "Must meticulously sweep and mop every hard floor surface in the house." },
        { title: "Refrigerator Purge", description: "Required to empty, clean, and reorganize the entire refrigerator/frezeer." },
        { title: "Handwritten Apology", description: "Must write a 250-word, hand-written apology/explanation for the failure of compliance." },
        
        // Self-Discipline
        { title: "Digital Blackout", description: "Must relinquish all non-essential personal electronics (phone/tablet/gaming device) for 12 hours." },
        { title: "Mandatory Silence", description: "Must maintain complete silence (no speaking except for absolute necessity) for 2 hours." },
        { title: "No Sweeteners", description: "Restricted from consuming any added sugars or artificial sweeteners for a period of 48 hours." },
        
        // Collaborative
        { title: "Partner's Errand Run", description: "Must immediately run a spontaneous errand requested by the partner, no matter the distance or time." },
        { title: "The Early Morning Detail", description: "Must perform all the morning chores (coffee, dishes, tidying) alone, starting 30 minutes earlier than usual." },
    ],
};


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
};
let activeTab = 'habits'; // Default active tab


// --- Utility Functions ---

/** Shows a custom modal with a title and message. */
window.showModal = function(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('app-modal').classList.remove('hidden');
    document.getElementById('app-modal').classList.add('flex');
}

/** Handles errors by logging them and displaying a modal. */
function handleError(error, userMessage) {
    console.error(userMessage, error);
    // Only show a generic error message in the UI if the error is severe
    window.showModal("Error Occurred", `${userMessage}. Check the console for details.`);
}

/** Generates a new unique ID for database items. */
function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'id-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

// --- UI Logic (Attached to window for HTML access) ---

/** Changes the active tab displayed to the user. */
window.changeTab = function(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('button[id^="tab-"]').forEach(el => el.classList.remove('text-[#b05c6c]', 'border-b-[#b05c6c]'));
    document.querySelectorAll('button[id^="tab-"]').forEach(el => el.classList.add('text-gray-400', 'border-b-transparent'));

    document.getElementById(`${tabName}-content`).classList.remove('hidden');
    document.getElementById(`tab-${tabName}`).classList.add('text-[#b05c6c]', 'border-b-[#b05c6c]');
    document.getElementById(`tab-${tabName}`).classList.remove('text-gray-400', 'border-b-transparent');
}

window.toggleHabitForm = () => document.getElementById('habit-form').classList.toggle('hidden');
window.toggleRewardForm = () => document.getElementById('reward-form').classList.toggle('hidden');
window.togglePunishmentForm = () => document.getElementById('punishment-form').classList.toggle('hidden');

/** Generates a random example from the EXAMPLE_DATABASE into the form fields. */
window.generateExample = function(type) {
    if (!EXAMPLE_DATABASE[type + 's']) {
        window.showModal("Error", "Example data is not loaded correctly.");
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


// --- Render Functions ---

/** Renders the current game state to the UI. */
function renderGameState() {
    // Update Scores
    document.getElementById('score-keeper').textContent = gameState.scores.keeper;
    document.getElementById('score-nightingale').textContent = gameState.scores.nightingale;

    // Update User ID Display
    document.getElementById('user-id-display').textContent = `User ID: ${userId || 'Authenticating...'}`;

    // Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    document.getElementById('loading-habits')?.classList.add('hidden'); // Use optional chaining for robustness
    if (gameState.habits.length === 0) {
        habitsList.innerHTML = '<p class="text-gray-500 text-center py-4">No habits registered yet.</p>';
    } else {
        gameState.habits.forEach(habit => {
            habitsList.innerHTML += createHabitCard(habit);
        });
    }

    // Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    if (gameState.rewards.length === 0) {
        rewardsList.innerHTML = '<p class="text-gray-500 text-center py-4">No rewards registered yet.</p>';
    } else {
        gameState.rewards.forEach(reward => {
            rewardsList.innerHTML += createRewardCard(reward);
        });
    }

    // Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    if (gameState.punishments.length === 0) {
        punishmentsList.innerHTML = '<p class="text-gray-500 text-center py-4">No punishments registered yet.</p>';
    } else {
        gameState.punishments.forEach(punishment => {
            punishmentsList.innerHTML += createPunishmentCard(punishment);
        });
    }
}

function createHabitCard(habit) {
    const assigneeName = habit.assignee === 'keeper' ? 'The Keeper' : 'The Nightingale';
    const assigneeColor = habit.assignee === 'keeper' ? 'text-green-400' : 'text-purple-400';
    const canComplete = habit.timesCompleted < habit.dailyGoal;
    const completeButton = canComplete
        ? `<button class="btn-primary px-3 py-1 text-sm bg-green-700 hover:bg-green-600" onclick="completeHabit('${habit.id}', '${habit.assignee}', ${habit.points})">
            <i class="fas fa-check-circle text-lg mr-1"></i>Complete
           </button>`
        : `<button class="px-3 py-1 text-sm bg-gray-600 text-gray-400 cursor-not-allowed rounded-lg" disabled>
            Goal Met
           </button>`;

    return `
        <div class="card p-4 flex justify-between items-center">
            <div>
                <p class="text-lg font-bold ${assigneeColor}">${assigneeName}</p>
                <p class="text-md text-gray-300">${habit.description}</p>
                <p class="text-sm text-gray-400 mt-1">
                    <span class="font-cinzel text-red-400">+${habit.points} Points</span> | 
                    Completed: <span class="font-mono">${habit.timesCompleted}/${habit.dailyGoal}</span>
                </p>
            </div>
            <div class="flex space-x-2">
                ${completeButton}
                <button class="bg-red-700 hover:bg-red-600 text-white p-2 rounded-lg text-sm" onclick="deleteItem('habits', '${habit.id}')">
                    <i class="fas fa-trash-alt text-lg"></i>
                </button>
            </div>
        </div>
    `;
}

function createRewardCard(reward) {
    const canAffordKeeper = gameState.scores.keeper >= reward.cost;
    const canAffordNightingale = gameState.scores.nightingale >= reward.cost;

    const keeperButton = canAffordKeeper
        ? `<button class="btn-primary px-3 py-1 text-sm bg-green-700 hover:bg-green-600" onclick="claimReward('${reward.id}', 'keeper', ${reward.cost})">
            Keeper Claim
           </button>`
        : `<button class="px-3 py-1 text-sm bg-gray-600 text-gray-400 cursor-not-allowed rounded-lg" disabled>
            Keeper (Cost: ${reward.cost})
           </button>`;

    const nightingaleButton = canAffordNightingale
        ? `<button class="btn-primary px-3 py-1 text-sm bg-purple-700 hover:bg-purple-600" onclick="claimReward('${reward.id}', 'nightingale', ${reward.cost})">
            Nightingale Claim
           </button>`
        : `<button class="px-3 py-1 text-sm bg-gray-600 text-gray-400 cursor-not-allowed rounded-lg" disabled>
            Nightingale (Cost: ${reward.cost})
           </button>`;

    return `
        <div class="card p-4">
            <div class="flex justify-between items-start mb-2">
                <h4 class="text-xl font-cinzel text-yellow-400">${reward.title}</h4>
                <p class="text-2xl font-bold text-red-400 ml-4">${reward.cost}</p>
            </div>
            <p class="text-sm text-gray-400 mb-4">${reward.description}</p>
            <div class="flex space-x-2 justify-end">
                ${keeperButton}
                ${nightingaleButton}
                <button class="bg-red-700 hover:bg-red-600 text-white p-2 rounded-lg text-sm" onclick="deleteItem('rewards', '${reward.id}')">
                    <i class="fas fa-trash-alt text-lg"></i>
                </button>
            </div>
        </div>
    `;
}

function createPunishmentCard(punishment) {
    return `
        <div class="card p-4 flex justify-between items-center">
            <div>
                <h4 class="text-xl font-cinzel text-red-500">${punishment.title}</h4>
                <p class="text-sm text-gray-400">${punishment.description}</p>
            </div>
            <button class="bg-red-700 hover:bg-red-600 text-white p-2 rounded-lg text-sm" onclick="deleteItem('punishments', '${punishment.id}')">
                <i class="fas fa-trash-alt text-lg"></i>
            </button>
        </div>
    `;
}


// --- FIREBASE AND DATA MANAGEMENT ---

/**
 * Initializes Firebase, uses Anonymous Auth, and sets up the real-time listener.
 */
async function initializeFirebase() {
    try {
        setLogLevel('debug'); 

        if (!firebaseConfig || !firebaseConfig.projectId || !appId) {
            throw new Error("Firebase configuration is incomplete. Please ensure firebaseConfig is updated.");
        }

        // Initialize App and Services
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Authenticate Anonymously for public deployment
        const userCredential = await signInAnonymously(auth);
        userId = userCredential.user.uid;
        document.getElementById('user-id-display').textContent = `User ID: ${userId}`;
        
        // Define the Firestore path and set up the listener
        GAME_STATE_PATH = `/artifacts/${appId}/users/${userId}/game_data`;
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        
        // Ensure the initial document exists before listening
        await initializeDocument(docRef);

        // Set up real-time listener
        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                // Update global state with the latest data
                gameState = docSnap.data();
                renderGameState();
            } else {
                window.showModal("Data Missing", "The ledger document was deleted. Resetting state.");
                initializeDocument(docRef); // Re-initialize if missing
            }
        }, (error) => {
            handleError(error, "Error listening to ledger updates");
        });

    } catch (e) {
        handleError(e, "Cannot initialize Firebase");
        document.getElementById('loading-habits').textContent = "Initialization failed. Check console and ensure Firebase config is correct.";
    }
}

/** Ensures the initial game document exists in Firestore. */
async function initializeDocument(docRef) {
    try {
        // We use a safe check and creation pattern
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            await setDoc(docRef, gameState);
            console.log("Initial ledger document created.");
        }
    } catch (e) {
        handleError(e, "Failed to initialize game document in Firestore");
    }
}


// --- CRUD Operations (Attached to window for HTML access) ---

window.addHabit = async function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value);
    const goal = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0 || isNaN(goal) || goal <= 0) {
        window.showModal("Invalid Input", "Please provide a valid description, positive points, and a positive daily goal.");
        return;
    }

    const newHabit = {
        id: generateId(),
        description: desc,
        points: points,
        dailyGoal: goal,
        assignee: assignee,
        timesCompleted: 0,
    };

    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, {
            habits: [...gameState.habits, newHabit]
        });
        document.getElementById('new-habit-desc').value = '';
        document.getElementById('new-habit-points').value = '10';
        document.getElementById('new-habit-times').value = '1';
        window.toggleHabitForm();
        window.showModal("Success", "New habit registered!");
    } catch (e) {
        handleError(e, "Failed to add habit");
    }
}

window.addReward = async function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        window.showModal("Invalid Input", "Please provide a title, description, and positive point cost.");
        return;
    }

    const newReward = {
        id: generateId(),
        title: title,
        cost: cost,
        description: desc,
    };

    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, {
            rewards: [...gameState.rewards, newReward]
        });
        document.getElementById('new-reward-title').value = '';
        document.getElementById('new-reward-cost').value = '50';
        document.getElementById('new-reward-desc').value = '';
        window.toggleRewardForm();
        window.showModal("Success", "New reward registered!");
    } catch (e) {
        handleError(e, "Failed to add reward");
    }
}

window.addPunishment = async function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        window.showModal("Invalid Input", "Please provide a title and a description for the punishment.");
        return;
    }

    const newPunishment = {
        id: generateId(),
        title: title,
        description: desc,
    };

    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, {
            punishments: [...gameState.punishments, newPunishment]
        });
        document.getElementById('new-punishment-title').value = '';
        document.getElementById('new-punishment-desc').value = '';
        window.togglePunishmentForm();
        window.showModal("Success", "New punishment added!");
    } catch (e) {
        handleError(e, "Failed to add punishment");
    }
}

window.completeHabit = async function(habitId, assignee, points) {
    const updatedHabits = gameState.habits.map(habit => {
        if (habit.id === habitId && habit.timesCompleted < habit.dailyGoal) {
            return { ...habit, timesCompleted: habit.timesCompleted + 1 };
        }
        return habit;
    });

    const newScore = gameState.scores[assignee] + points;
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    try {
        await updateDoc(docRef, {
            habits: updatedHabits,
            [`scores.${assignee}`]: newScore
        });
        window.showModal("Habit Complete!", `${assignee} gains ${points} points.`);
    } catch (e) {
        handleError(e, "Failed to complete habit");
    }
}

window.claimReward = async function(rewardId, claimant, cost) {
    if (gameState.scores[claimant] < cost) {
        window.showModal("Insufficient Points", `The ${claimant} does not have enough points (Cost: ${cost}, Current: ${gameState.scores[claimant]}).`);
        return;
    }

    const newScore = gameState.scores[claimant] - cost;
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    try {
        await updateDoc(docRef, {
            [`scores.${claimant}`]: newScore
        });
        // We do not remove the reward from the list, as it's a permanent option.
        window.showModal("Reward Claimed!", `${claimant} claimed the reward for ${cost} points. Enjoy!`);
    } catch (e) {
        handleError(e, "Failed to claim reward");
    }
}

window.deleteItem = async function(collectionName, itemId) {
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    const currentItems = [...gameState[collectionName]];
    const updatedItems = currentItems.filter(item => item.id !== itemId);

    try {
        // Use a dynamic property name for the update
        const updatePayload = {};
        updatePayload[collectionName] = updatedItems;

        await updateDoc(docRef, updatePayload);
        window.showModal("Item Removed", `Item removed from ${collectionName}.`);
    } catch (e) {
        handleError(e, `Failed to remove item from ${collectionName}`);
    }
}


// Initialize on load
initializeFirebase();
