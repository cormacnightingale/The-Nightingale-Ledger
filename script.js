class Habit {
  constructor({ id, name, description, repeat = 'none', days = [], completed = false }) {
    this.id = id; this.name = name; this.description = description; this.repeat = repeat; this.days = days; this.completed = completed;
  }
  isDue(today) {
    if (this.repeat === 'none') return !this.completed;
    if (this.repeat === 'daily') return true;
    if (this.repeat === 'weekly') return today.getDay() === this.days[0];
    if (this.repeat === 'monthly') return today.getDate() === this.days[0];
    if (Array.isArray(this.days)) return this.days.includes(today.getDay());
    return false;
  }
}
class Task { constructor({ id, name, completed = false }) { this.id = id; this.name = name; this.completed = completed; } }
class Profile { constructor({ id, name, avatarUrl, bio }) { this.id = id; this.name = name; this.avatarUrl = avatarUrl; this.bio = bio; } }
let habits = [], tasks = [], profiles = [];
function renderHabit(habit, today = new Date()) {
  const due = habit.isDue(today);
  return `<div class="habit-card${habit.completed && due ? ' completed' : ''}">
    <div class="habit-title">${habit.name}</div>
    <div class="habit-desc">${habit.description}</div>
    <div class="habit-repeat">Repeat: ${habit.repeat === 'none' ? 'No' : habit.repeat}</div>
    ${habit.repeat === 'custom' ? `<div class="habit-days">Days: ${habit.days.join(', ')}</div>` : ''}
    <button class="complete-habit-btn" data-id="${habit.id}" ${!due ? 'disabled' : ''}>
      ${habit.completed && due ? 'Completed!' : 'Mark as Done'}
    </button>
  </div>`;
}
function renderProfile(profile) {
  return `<div class="profile-card">
    <img src="${profile.avatarUrl}" alt="Avatar" class="profile-avatar" style="width:80px;height:80px;border-radius:50%;"/>
    <div class="profile-info">
      <h2>${profile.name}</h2>
      <p>${profile.bio}</p>
      <button class="edit-profile-btn" data-id="${profile.id}">Edit</button>
    </div>
  </div>`;
}
function renderTaskList(tasks) {
  const active = tasks.filter(t => !t.completed); const completed = tasks.filter(t => t.completed);
  return `<div class="task-list">${active.map(t => `<div class="task">${t.name}</div>`).join('')}</div>
    <div class="completed-list"><h4>Completed Tasks</h4>${completed.map(t => `<div class="task completed">${t.name}</div>`).join('')}</div>`;
}
let lastRemoved = null;
function showToast(message, undoCallback) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${message}</span> <button class="undo-btn">Undo</button>`;
  document.body.appendChild(toast);
  toast.querySelector('.undo-btn').onclick = () => { undoCallback(); document.body.removeChild(toast); };
  setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 4000);
}
function setTheme(themeName) {
  document.body.classList.remove('theme-dark-romantic', 'theme-goth');
  if (themeName) document.body.classList.add(themeName);
}
function renderThemeSelector() {
  return `<select id="theme-selector">
    <option value="">Default</option>
    <option value="theme-dark-romantic">Dark Romantic</option>
    <option value="theme-goth">Goth</option>
  </select>`;
}
function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = `<div>${profiles.map(renderProfile).join('')}
    <br>
    <div><h3>Habits</h3>${habits.map(h => renderHabit(h)).join('')}</div><br>
    <div>${renderTaskList(tasks)}</div><hr>
    <label for="theme-selector">Theme:</label> ${renderThemeSelector()}
    </div>`;
  document.getElementById('theme-selector').onchange = e => setTheme(e.target.value);
  document.querySelectorAll('.edit-profile-btn').forEach(btn => {
    btn.onclick = () => showToast('Edit profile feature coming soon!', () => {});
  });
  document.querySelectorAll('.complete-habit-btn').forEach(btn => {
    btn.onclick = () => {
      const habit = habits.find(h => h.id === btn.getAttribute('data-id'));
      if (habit) {
        habit.completed = !habit.completed;
        showToast(habit.completed ? 'Habit marked as complete.' : 'Habit unmarked.', renderApp);
        renderApp();
      }
    };
  });
}
habits = [
  new Habit({ id: 'h1', name: 'Morning walk', description: 'Go for a walk', repeat: 'daily' }),
  new Habit({ id: 'h2', name: 'Date night', description: 'Something special', repeat: 'weekly', days: [5] })
];
profiles = [
  new Profile({ id: 'p1', name: 'Corbin', avatarUrl: 'favicon.png', bio: 'Hobbyist Developer' })
];
tasks = [
  new Task({ id: 't1', name: 'Finish report' }),
  new Task({ id: 't2', name: 'Pay bills', completed: true })
];
window.onload = renderApp;