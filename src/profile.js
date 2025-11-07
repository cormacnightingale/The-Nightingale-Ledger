export function renderProfile(profile) {
  return `
    <div class="profile-card">
      <img src="${profile.avatarUrl}" alt="Avatar" class="profile-avatar"/>
      <div class="profile-info">
        <h2>${profile.name}</h2>
        <p>${profile.bio}</p>
        <button class="edit-profile-btn" data-id="${profile.id}">Edit</button>
      </div>
    </div>
  `;
}

// Optionally add modal popup and handler for edit