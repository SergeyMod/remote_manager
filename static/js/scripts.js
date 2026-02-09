// scripts.js — управление сценариями

let currentScriptId = null;

function showToast(message, type = 'info') {
    // Используем глобальный тостер из main.js (если доступен)
    if (window.showToast) {
        window.showToast(message, type);
    } else {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
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
            html += `
                <tr>
                    <td>${s.id}</td>
                    <td>${s.name}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary" onclick="editScript(${s.id})">Редактировать</button>
                        <button class="btn btn-sm btn-primary" onclick="showRunScriptModal(${s.id}, '${s.name}')">Выполнить</button>
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
// УПРАВЛЕНИЕ СЦЕНАРИЯМИ (СОЗДАНИЕ/РЕДАКТИРОВАНИЕ)
// ======================

function showAddScriptModal() {
    currentScriptId = null;
    document.getElementById('modal-script-title').textContent = 'Создать сценарий';
    document.getElementById('script-name').value = '';
    document.getElementById('script-content').value = '#!/bin/bash\n';
    document.getElementById('script-parameters').innerHTML = '';
    document.getElementById('script-modal').style.display = 'flex';
}

function closeScriptModal() {
    document.getElementById('script-modal').style.display = 'none';
}

function addScriptParameter(name = '', defaultValue = '', description = '') {
    const container = document.getElementById('script-parameters');
    const idx = container.children.length;
    const div = document.createElement('div');
    div.className = 'form-group';
    div.innerHTML = `
        <div style="display:flex;gap:0.5rem;align-items:end;">
            <div style="flex:1;">
                <label>Имя параметра</label>
                <input type="text" placeholder="DB_HOST" value="${name}" data-field="name">
            </div>
            <div style="flex:1;">
                <label>Значение по умолчанию</label>
                <input type="text" placeholder="localhost" value="${defaultValue}" data-field="default_value">
            </div>
            <div style="flex:2;">
                <label>Описание</label>
                <input type="text" placeholder="Адрес базы данных" value="${description}" data-field="description">
            </div>
            <button type="button" class="btn btn-danger btn-sm" style="height:38px;" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    container.appendChild(div);
}

async function editScript(scriptId) {
    try {
        const res = await fetch(`/api/scripts/${scriptId}`);
        const script = await res.json();
        currentScriptId = scriptId;
        document.getElementById('modal-script-title').textContent = 'Редактировать сценарий';
        document.getElementById('script-name').value = script.name;
        document.getElementById('script-content').value = script.content;
        const paramsContainer = document.getElementById('script-parameters');
        paramsContainer.innerHTML = '';
        script.parameters?.forEach(p => {
            addScriptParameter(p.name, p.default_value || '', p.description || '');
        });
        document.getElementById('script-modal').style.display = 'flex';
    } catch (e) {
        console.error('Ошибка загрузки сценария:', e);
        showToast('Ошибка загрузки сценария', 'error');
    }
}

async function saveScript() {
    const name = document.getElementById('script-name').value.trim();
    const content = document.getElementById('script-content').value.trim();
    if (!name || !content) {
        showToast('Заполните название и содержимое', 'error');
        return;
    }

    const params = [];
    document.querySelectorAll('#script-parameters > .form-group').forEach(group => {
        const nameField = group.querySelector('[data-field="name"]');
        const defField = group.querySelector('[data-field="default_value"]');
        const descField = group.querySelector('[data-field="description"]');
        const paramName = nameField?.value.trim();
        if (paramName) {
            params.push({
                name: paramName,
                default_value: defField?.value || '',
                description: descField?.value || ''
            });
        }
    });

    const scriptData = { name, content, params };

    try {
        let url = '/api/scripts';
        let method = 'POST';
        if (currentScriptId) {
            url = `/api/scripts/${currentScriptId}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scriptData)
        });

        if (res.ok) {
            showToast(`Сценарий ${currentScriptId ? 'обновлён' : 'создан'}`, 'success');
            closeScriptModal();
            loadScripts();
        } else {
            const err = await res.json();
            showToast(`Ошибка: ${err.detail}`, 'error');
        }
    } catch (e) {
        console.error('Ошибка сохранения:', e);
        showToast('Ошибка сохранения сценария', 'error');
    }
}

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

// ======================
// ЗАПУСК СЦЕНАРИЯ
// ======================

async function loadMachinesForRun() {
    try {
        const res = await fetch('/api/machines');
        const machines = await res.json();
        const select = document.getElementById('run-machine-select');
        select.innerHTML = '';
        machines
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
        <button type="button" class="btn btn-danger btn-sm" style="height:38px;" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
}

function collectRunParameters() {
    const params = [];
    document.querySelectorAll('#run-parameters-container > .form-group').forEach(group => {
        const name = group.querySelector('[data-field="name"]')?.value.trim();
        const value = group.querySelector('[data-field="value"]')?.value.trim();
        if (name) {
            params.push({ name, value, save: false });
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
// ИНИЦИАЛИЗАЦИЯ
// ======================

document.addEventListener('DOMContentLoaded', () => {
    loadScripts();
});