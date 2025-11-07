// Add a global toast & undo handler
let lastRemoved = null;
export function showToast(message, undoCallback) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${message}</span> <button class="undo-btn">Undo</button>`;
  document.body.appendChild(toast);
  toast.querySelector('.undo-btn').onclick = () => {
    undoCallback();
    document.body.removeChild(toast);
  };
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 4000);
}

export function removeTask(taskId, type = 'task') {
  const item = findTaskOrHabitOrReward(taskId); // implement for each type
  lastRemoved = item;
  // Remove from data
  showToast(`${type} removed.`, () => {
    restoreTaskOrHabitOrReward(lastRemoved);
  });
}