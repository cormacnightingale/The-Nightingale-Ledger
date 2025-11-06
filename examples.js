/**
 * EXAMPLE_DATABASE
 * This object holds a large list of pre-defined suggestions for habits, rewards,
 * and punishments to be used by the "Generate Example" buttons in the Nightingale Ledger.
 * This is loaded globally before script.js.
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

        // Relationship Focus (Lower Points)
        { description: "Initiate and complete a 15-minute, distraction-free conversation with partner.", points: 15, type: 'keeper' },
        { description: "Tidy and declutter one 'hot spot' area for 10 minutes.", points: 5, type: 'nightingale' },
    ],

    // --- REWARDS (Title, Cost, Description) ---\
    rewards: [
        // Instant Gratification
        { title: "Partner-made Coffee/Tea", cost: 10, description: "Partner makes and serves the requested drink (non-alcoholic)." },
        { title: "One Hour of Uninterrupted Play", cost: 20, description: "One hour dedicated to a leisure activity (gaming, reading) without interruption." },
        { title: "No Dishes Tonight", cost: 30, description: "Partner handles all dish duties for the evening." },

        // Medium Gratification
        { title: "A New Book/Game", cost: 75, description: "Partner buys a small, pre-approved item (book, video game, etc.) under $20." },
        { title: "A Chosen Takeout Meal", cost: 100, description: "Dinner of the recipient's choosing (up to a set limit) paid for by the partner." },

        // Large Gratification
        { title: "Full Massage", cost: 150, description: "A full 30-minute massage provided by the partner." },
        { title: "The 'Yes Day' Request", cost: 250, description: "Partner must agree to one reasonable, pre-approved request without argument." },
    ],

    // --- PUNISHMENTS (Title, Description) ---
    punishments: [
        // Domestic Tasks
        { title: "The Floor Detail", description: "Must meticulously sweep and mop every hard floor surface in the house." },
        { title: "Refrigerator Purge", description: "Required to empty, clean, and reorganize the entire refrigerator/freezer." },
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
