/**
 * EXAMPLE_DATABASE
 * This object holds a large list of pre-defined suggestions for habits, rewards,
 * and punishments to be used by the "Generate Example" buttons in the Nightingale Ledger.
 * * CRITICAL FIX: Changed 'const' to 'window.EXAMPLE_DATABASE' to explicitly
 * attach it to the global scope, making it accessible to the 'script.js' module.
 */
window.EXAMPLE_DATABASE = {
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
        { description: "Ensure adequate 7+ hours of sleep (tracked by smart device).", points: 20, type: 'keeper' },
        
        // Domestic & Collaborative (Low Points)
        { description: "Take out all household recycling and trash before 8 PM.", points: 5, type: 'nightingale' },
        { description: "Perform a 15-minute 'power clean' of the main living area.", points: 10, type: 'keeper' },
        { description: "Send a sincere, personalized compliment or appreciation note to a friend/family member.", points: 15, type: 'nightingale' },
    ],

    // --- REWARDS (Title, Cost, Description) ---
    rewards: [
        // Personal Indulgences
        { title: "Long Bath/Shower", cost: 50, description: "A full hour of uninterrupted bathing/self-care time." },
        { title: "Digital Escape", cost: 80, description: "An hour of guilt-free time playing video games or watching streaming content." },
        { title: "Dessert Choice", cost: 30, description: "Partner must procure the claimant's favorite small dessert." },
        
        // Collaborative Rewards
        { title: "Takeout Night", cost: 150, description: "Skip cooking entirely; order delivery from a mutually approved restaurant." },
        { title: "Full Back Rub", cost: 100, description: "Receive a 20-minute, high-quality back and shoulder massage from the partner." },
        { title: "Chores Swap", cost: 60, description: "The partner must do the claimant's least favorite chore for the day." },
        
        // Financial/Tangible
        { title: "New Coffee", cost: 75, description: "Partner buys a small, pre-approved item (book, video game, etc.) under $20." },
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