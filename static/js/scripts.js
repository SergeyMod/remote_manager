// scripts.js — управление списком сценариев

function showToast(message, type = 'info') {
    if (window.showToast) {
        window.showToast(message, type);
    } else {
        alert(`${type}: ${message}`);
    }
}

// ======================
// ЗАГРУЗКА СЦЕНАРИЕВ
// ======================

async function loadScripts() {
    const container = document.getElementById('scripts-container');
    try {
        const response = await fetch('/api/scripts');
        const scripts = await response.json();

        if (scripts.length === 0) {
            container.innerHTML = '<div class="loading">Нет сценариев.</div>';
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
        scripts.forEach(s => {
            // Экранируем имя для HTML
            const escapedName = s.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            html += `
                <tr>
                    <td>${s.id}</td>
                    <td>${s.name}</td>
                    <td>
                        <a href="/scripts/${s.id}/edit" class="btn btn-sm btn-secondary">Редактировать</a>
                        <button class="btn btn-sm btn-primary" onclick="showRunScriptModal(${s.id}, '${s.name.replace(/'/g, "\\'")}')">Выполнить</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteScript(${s.id})">Удалить</button>
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
        console.error('Ошибка загрузки сценариев:', e);
        container.innerHTML = '<div class="alert alert-error">Ошибка загрузки сценариев</div>';
    }
}

// ======================
// МОДАЛКА ЗАПУСКА СЦЕНАРИЯ
// ======================

let allMachines = [];

async function loadMachinesForRun() {
    try {
        const res = await fetch('/api/machines');
        allMachines = await res.json();
        const select = document.getElementById('run-machine-select');
        select.innerHTML = '';
        allMachines
            .filter(m => m.is_active)
            .forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = `${m.name} (${m.address})`;
                select.appendChild(opt);
            });
    } catch (e) {
        console.error('Не удалось загрузить машины:', e);
        showToast('Не удалось загрузить список машин', 'error');
    }
}

async function loadScriptParametersForRun(scriptId) {
    try {
        const res = await fetch(`/api/scripts/${scriptId}`);
        const script = await res.json();
        const container = document.getElementById('run-parameters-container');
        container.innerHTML = '';
        script.parameters?.forEach(p => {
            addRunParameter(p.name, p.default_value || '');
        });
    } catch (e) {
        console.warn('Не удалось загрузить параметры сценария для запуска:', e);
    }
}

function showRunScriptModal(scriptId, scriptName) {
    document.getElementById('run-script-id').value = scriptId;
    document.getElementById('run-script-name').textContent = scriptName;
    document.getElementById('run-parameters-container').innerHTML = '';
    loadMachinesForRun();
    loadScriptParametersForRun(scriptId);
    document.getElementById('run-script-modal').style.display = 'flex';
}

function closeRunScriptModal() {
    document.getElementById('run-script-modal').style.display = 'none';
}

function addRunParameter(name = '', value = '') {
    const container = document.getElementById('run-parameters-container');
    const div = document.createElement('div');
    div.className = 'form-group';
    div.style.display = 'flex';
    div.style.gap = '0.5rem';
    div.style.alignItems = 'end';
    div.innerHTML = `
        <input type="text" placeholder="Имя" value="${name}" style="flex:1;" data-field="name">
        <input type="text" placeholder="Значение" value="${value}" style="flex:2;" data-field="value">
        <label style="display:flex;align-items:center;gap:4px;">
            <input type="checkbox" data-field="save"> Сохранить
        </label>
        <button type="button" class="btn btn-danger btn-sm" style="height:38px;" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
}

function collectRunParameters() {
    const params = [];
    document.querySelectorAll('#run-parameters-container > .form-group').forEach(group => {
        const name = group.querySelector('[data-field="name"]')?.value.trim();
        const value = group.querySelector('[data-field="value"]')?.value.trim();
        const save = group.querySelector('[data-field="save"]')?.checked || false;
        if (name) {
            params.push({ name, value, save });
        }
    });
    return params;
}

async function executeScript() {
    const scriptId = document.getElementById('run-script-id').value;
    const machineSelect = document.getElementById('run-machine-select');
    const machineIds = Array.from(machineSelect.selectedOptions).map(o => parseInt(o.value));

    if (machineIds.length === 0) {
        showToast('Выберите хотя бы одну машину', 'error');
        return;
    }

    const params = collectRunParameters();

    try {
        const res = await fetch(`/api/scripts/${scriptId}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                machine_ids: machineIds,
                params: params
            })
        });

        if (res.ok) {
            showToast('Сценарий запущен', 'success');
            closeRunScriptModal();
        } else {
            const err = await res.json();
            showToast(`Ошибка: ${err.detail}`, 'error');
        }
    } catch (e) {
        console.error('Ошибка запуска:', e);
        showToast('Ошибка запуска сценария', 'error');
    }
}

// ======================
// УДАЛЕНИЕ СЦЕНАРИЯ
// ======================

async function deleteScript(id) {
    if (!confirm('Удалить сценарий?')) return;
    try {
        const res = await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Сценарий удалён', 'success');
            loadScripts();
        } else {
            const err = await res.json();
            showToast(`Ошибка: ${err.detail}`, 'error');
        }
    } catch (e) {
        console.error('Ошибка удаления:', e);
        showToast('Ошибка удаления сценария', 'error');
    }
}
function collectRunParameters() {
    const params = [];
    document.querySelectorAll('#run-parameters-container > .form-group').forEach(group => {
        const name = group.querySelector('[data-field="name"]')?.value.trim();
        const value = group.querySelector('[data-field="value"]')?.value.trim();
        const save = group.querySelector('[data-field="save"]')?.checked || false;
        if (name) {
            params.push({ name, value, save });
        }
    });
    return params;
}

// ======================
// ИНИЦИАЛИЗАЦИЯ
// ======================

document.addEventListener('DOMContentLoaded', () => {
    // Кнопка "Создать сценарий" ведёт на новую страницу
    const createBtn = document.querySelector('#create-script-btn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            window.location.href = '/scripts/new';
        });
    }

    loadScripts();
});