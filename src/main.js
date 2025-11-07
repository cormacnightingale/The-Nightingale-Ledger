// Example: Render lists with filter for completed/repeated tasks

export function renderTaskList(tasks) {
  const active = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t => t.completed);
  return `
    <div class="task-list">
      ${active.map(t => `<div class="task">${t.name}</div>`).join('')}
    </div>
    <div class="completed-list">
      <h4>Completed Tasks</h4>
      ${completed.map(t => `<div class="task completed">${t.name}</div>`).join('')}
    </div>
  `;
}

// Theme selector logic
export function setTheme(themeName) {
  document.body.classList.remove('theme-dark-romantic', 'theme-goth');
  if (themeName) document.body.classList.add(themeName);
}