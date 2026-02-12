function showToast(message, type = 'info') {
    if (window.showToast) {
        window.showToast(message, type);
    } else {
        alert(`${type}: ${message}`);
    }
}

// ======================
// ЗАГРУЗКА СПИСКА ПРОФИЛЕЙ
// ======================

async function loadProfiles() {
    const container = document.getElementById('profiles-container');
    try {
        const res = await fetch('/api/profiles');
        const profiles = await res.json();
        if (profiles.length === 0) {
            container.innerHTML = '<div class="loading">Нет профилей.</div>';
            return;
        }

        let html = `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Название</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        profiles.forEach(p => {
            html += `
                <tr>
                    <td>${p.id}</td>
                    <td>${p.name}</td>
                    <td>
                        <a href="/profiles/${p.id}/edit" class="btn btn-sm btn-secondary">Редактировать</a>
                        <button class="btn btn-sm btn-primary" onclick="executeProfile(${p.id})">Выполнить</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteProfile(${p.id})">Удалить</button>
                    </td>
                </tr>
            `;
        });
        html += `
                    </tbody>
                </table>
            </div>
        `;
        container.innerHTML = html;
    } catch (e) {
        console.error('Ошибка загрузки профилей:', e);
        container.innerHTML = '<div class="alert alert-error">Ошибка загрузки профилей</div>';
    }
}

// ======================
// ВЫПОЛНЕНИЕ И УДАЛЕНИЕ
// ======================

async function executeProfile(profileId) {
    if (!confirm('Вы уверены, что хотите выполнить профиль?')) return;
    
    try {
        const res = await fetch(`/api/profiles/${profileId}/execute`, {
            method: 'POST'
        });
        if (res.ok) {
            showToast('Профиль запущен', 'success');
        } else {
            const err = await res.json();
            showToast(`Ошибка: ${err.detail}`, 'error');
        }
    } catch (e) {
        console.error('Ошибка запуска профиля:', e);
        showToast('Ошибка запуска профиля', 'error');
    }
}

async function deleteProfile(profileId) {
    if (!confirm('Удалить профиль? Это действие нельзя отменить.')) return;
    
    try {
        const res = await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Профиль удалён', 'success');
            loadProfiles();
        } else {
            const err = await res.json();
            showToast(`Ошибка: ${err.detail}`, 'error');
        }
    } catch (e) {
        console.error('Ошибка удаления профиля:', e);
        showToast('Ошибка удаления профиля', 'error');
    }
}

// ======================
// ИНИЦИАЛИЗАЦИЯ
// ======================

document.addEventListener('DOMContentLoaded', () => {
    // Кнопка "Создать профиль" ведёт на новую страницу
    const createBtn = document.querySelector('#create-profile-btn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            window.location.href = '/profiles/new';
        });
    }

    loadProfiles();
});