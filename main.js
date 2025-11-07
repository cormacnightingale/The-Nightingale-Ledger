export function setTheme(themeName) {
  document.body.classList.remove('theme-dark-romantic', 'theme-goth');
  if (themeName) document.body.classList.add(themeName);
}

// In your options menu rendering:
/*
<select onchange="setTheme(this.value)">
  <option value="">Default</option>
  <option value="theme-dark-romantic">Dark Romantic</option>
  <option value="theme-goth">Goth</option>
</select>
*/