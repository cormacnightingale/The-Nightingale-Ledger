// Habit Model updates
export class Habit {
  constructor({ id, name, description, repeat = 'none', days = [], completed = false }) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.repeat = repeat; // new: 'none', 'daily', 'weekly', 'monthly', or array for custom days
    this.days = days; // new: array of weekday indices if custom repeat (e.g., [1,3,5] for Mon/Wed/Fri)
    this.completed = completed;
  }

  isDue(today) {
    if (this.repeat === 'none') return !this.completed;
    if (this.repeat === 'daily') return true;
    if (this.repeat === 'weekly') return today.getDay() === this.days[0]; // first element: repeat weekday
    if (this.repeat === 'monthly') return today.getDate() === this.days[0]; // first element: repeat date
    if (Array.isArray(this.days)) return this.days.includes(today.getDay());
    return false;
  }
}

// Example usage in habit management code
export function renderHabit(habit, today = new Date()) {
  const due = habit.isDue(today);
  return `
    <div class="habit-card${habit.completed && due ? ' completed' : ''}">
      <div class="habit-title">${habit.name}</div>
      <div class="habit-desc">${habit.description}</div>
      <div class="habit-repeat">Repeat: ${habit.repeat === 'none' ? 'No' : habit.repeat}</div>
      ${habit.repeat === 'custom' ? `<div class="habit-days">Days: ${habit.days.join(', ')}</div>` : ''}
      <button class="complete-habit-btn" data-id="${habit.id}" ${!due ? 'disabled' : ''}>
        ${habit.completed && due ? 'Completed!' : 'Mark as Done'}
      </button>
    </div>
  `;
}

// Mark a habit completed/revert for today
export function toggleHabitCompletion(id) {
  // Implement habit lookup and state update
}