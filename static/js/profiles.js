let currentProfileId = null;

function showToast(message, type = 'info') {
    if (window.showToast) {
        window.showToast(message, type);
    } else {
        alert(`${type}: ${message}`);
    }
}

// ======================
// ПОЛЕЗНЫЕ ФУНКЦИИ
// ======================

function createParameterInput(name = '', value = '', label = 'Параметр') {
    const div = document.createElement('div');
    div.className = 'form-group';
    div.style.display = 'flex';
    div.style.gap = '0.5rem';
    div.style.alignItems = 'end';
    div.innerHTML = `
        <input type="text" placeholder="Имя" value="${name}" style="flex:1;" data-field="name">
        <input type="text" placeholder="Значение" value="${value}" style="flex:2;" data-field="value">
        <button type="button" class="btn btn-danger btn-sm" style="height:38px;" onclick="this.parentElement.remove()">×</button>
    `;
    return div;
}

// ======================
// ЗАГРУЗКА ДАННЫХ
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

        let html = '<div class="table-container"><table><thead><tr><th>ID</th><th>Название</th><th>Действия</th></tr></thead><tbody>';
        profiles.forEach(p => {
            html += `
                <tr>
                    <td>${p.id}</td>
                    <td>${p.name}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary" onclick="editProfile(${p.id})">Редактировать</button>
                        <button class="btn btn-sm btn-primary" onclick="executeProfile(${p.id})">Выполнить</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteProfile(${p.id})">Удалить</button>
                    </td>
                </tr>
            `;
        });
        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="alert alert-error">Ошибка загрузки</div>';
    }
}

async function loadScriptsForSelect() {
    const res = await fetch('/api/scripts');
    return await res.json();
}

async function loadMachinesForSelect() {
    const res = await fetch('/api/machines');
    const machines = await res.json();
    return machines.filter(m => m.is_active);
}

// ======================
// УПРАВЛЕНИЕ ПРОФИЛЕМ
// ======================

function showAddProfileModal() {
    currentProfileId = null;
    document.getElementById('modal-profile-title').textContent = 'Создать профиль';
    document.getElementById('profile-name').value = '';
    document.getElementById('global-parameters').innerHTML = '';
    document.getElementById('profile-steps').innerHTML = '';
    document.getElementById('profile-modal').style.display = 'flex';
}

function closeProfileModal() {
    document.getElementById('profile-modal').style.display = 'none';
}

function addGlobalParameter(name = '', value = '') {
    const container = document.getElementById('global-parameters');
    container.appendChild(createParameterInput(name, value));
}

function addProfileStep(scriptId = '', machineIds = [], params = []) {
    const stepsContainer = document.getElementById('profile-steps');
    const stepDiv = document.createElement('div');
    stepDiv.className = 'form-group';
    stepDiv.style.border = '1px solid #ddd';
    stepDiv.style.padding = '10px';
    stepDiv.style.marginTop = '10px';
    stepDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <strong>Шаг ${stepsContainer.children.length + 1}</strong>
            <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
        <div class="form-group">
            <label>Сценарий</label>
            <select class="script-select" style="width:100%;">
                <option value="">Выберите сценарий</option>
            </select>
        </div>
        <div class="form-group">
            <label>Машины</label>
            <select multiple size="4" class="machine-select" style="width:100%;"></select>
        </div>
        <div class="form-group">
            <label>Параметры сценария (переопределяют глобальные)</label>
            <div class="step-params"></div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="addStepParameter(this)">+</button>
        </div>
    `;
    stepsContainer.appendChild(stepDiv);

    // Загружаем данные в новый шаг
    const scriptSelect = stepDiv.querySelector('.script-select');
    const machineSelect = stepDiv.querySelector('.machine-select');

    // Заполняем сценарии
    loadScriptsForSelect().then(scripts => {
        scripts.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            if (scriptId == s.id) opt.selected = true;
            scriptSelect.appendChild(opt);
        });
    });

    // Заполняем машины
    loadMachinesForSelect().then(machines => {
        machines.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `${m.name} (${m.address})`;
            if (machineIds.includes(m.id)) opt.selected = true;
            machineSelect.appendChild(opt);
        });
    });

    // Заполняем параметры
    const paramsContainer = stepDiv.querySelector('.step-params');
    params.forEach(p => {
        paramsContainer.appendChild(createParameterInput(p.name, p.value));
    });
}

function addStepParameter(button) {
    const paramsContainer = button.previousElementSibling;
    paramsContainer.appendChild(createParameterInput());
}

// ======================
// РЕДАКТИРОВАНИЕ
// ======================

async function editProfile(profileId) {
    try {
        const res = await fetch(`/api/profiles/${profileId}`);
        const profile = await res.json();
        currentProfileId = profileId;
        document.getElementById('modal-profile-title').textContent = 'Редактировать профиль';
        document.getElementById('profile-name').value = profile.name;

        // Глобальные параметры
        const globalContainer = document.getElementById('global-parameters');
        globalContainer.innerHTML = '';
        profile.global_parameters?.forEach(p => {
            addGlobalParameter(p.name, p.value);
        });

        // Шаги
        const stepsContainer = document.getElementById('profile-steps');
        stepsContainer.innerHTML = '';
        profile.profile_scripts?.forEach(ps => {
            addProfileStep(
                ps.script_id,
                ps.machine_ids || [],
                ps.parameters || []
            );
        });

        document.getElementById('profile-modal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showToast('Ошибка загрузки профиля', 'error');
    }
}

// ======================
// СОХРАНЕНИЕ
// ======================

function collectParameters(container) {
    const params = [];
    container.querySelectorAll('.form-group').forEach(group => {
        const name = group.querySelector('[data-field="name"]')?.value.trim();
        const value = group.querySelector('[data-field="value"]')?.value.trim();
        if (name) params.push({ name, value });
    });
    return params;
}

async function saveProfile() {
    const name = document.getElementById('profile-name').value.trim();
    if (!name) {
        showToast('Укажите название профиля', 'error');
        return;
    }

    // Глобальные параметры
    const globalParams = collectParameters(document.getElementById('global-parameters'));

    // Шаги
    const steps = [];
    document.querySelectorAll('#profile-steps > .form-group').forEach(step => {
        const scriptId = parseInt(step.querySelector('.script-select').value);
        if (!scriptId) return;

        const machineIds = Array.from(step.querySelectorAll('.machine-select option:checked'))
            .map(opt => parseInt(opt.value));

        const params = collectParameters(step.querySelector('.step-params'));

        steps.push({
            script_id: scriptId,
            machine_ids: machineIds,
            params: params
        });
    });

    if (steps.length === 0) {
        showToast('Добавьте хотя бы один шаг', 'error');
        return;
    }

    const profileData = {
        name,
        global_parameters: globalParams,
        steps: steps
    };

    try {
        let url = '/api/profiles';
        let method = 'POST';
        if (currentProfileId) {
            url = `/api/profiles/${currentProfileId}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });

        if (res.ok) {
            showToast(`Профиль ${currentProfileId ? 'обновлён' : 'создан'}`, 'success');
            closeProfileModal();
            loadProfiles();
        } else {
            const err = await res.json();
            showToast(`Ошибка: ${err.detail}`, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Ошибка сохранения', 'error');
    }
}

// ======================
// ВЫПОЛНЕНИЕ И УДАЛЕНИЕ
// ======================

async function executeProfile(profileId) {
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
        console.error(e);
        showToast('Ошибка запуска', 'error');
    }
}

async function deleteProfile(id) {
    if (!confirm('Удалить профиль?')) return;
    try {
        const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Профиль удалён', 'success');
            loadProfiles();
        } else {
            const err = await res.json();
            showToast(`Ошибка: ${err.detail}`, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Ошибка удаления', 'error');
    }
}

// ======================
// ИНИЦИАЛИЗАЦИЯ
// ======================

document.addEventListener('DOMContentLoaded', () => {
    loadProfiles();
});