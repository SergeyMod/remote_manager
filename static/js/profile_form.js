function showToast(message, type = 'info') {
    if (window.showToast) {
        window.showToast(message, type);
    } else {
        alert(`${type}: ${message}`);
    }
}

let savedParameters = [];
let allScripts = [];
let allMachines = [];

// Загрузка сохранённых параметров
async function loadSavedParameters() {
    try {
        const res = await fetch('/api/parameters');
        savedParameters = await res.json();
        updateParameterSelects();
    } catch (e) {
        console.error('Ошибка загрузки параметров:', e);
    }
}

function updateParameterSelects() {
    // Глобальные
    const globalSelect = document.getElementById('saved-parameters-select-global');
    if (globalSelect) {
        globalSelect.innerHTML = '<option value="">Выбрать сохранённый параметр...</option>';
        savedParameters.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} - ${p.value}`;
            globalSelect.appendChild(opt);
        });
    }

    // В шагах
    document.querySelectorAll('.saved-parameters-select-step').forEach(select => {
        select.innerHTML = '<option value="">Выбрать...</option>';
        savedParameters.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} - ${p.value}`;
            select.appendChild(opt);
        });
    });
}

// Загрузка сценариев и машин
async function loadScriptsAndMachines() {
    try {
        const [scriptsRes, machinesRes] = await Promise.all([
            fetch('/api/scripts'),
            fetch('/api/machines')
        ]);
        allScripts = await scriptsRes.json();
        allMachines = (await machinesRes.json()).filter(m => m.is_active);
    } catch (e) {
        console.error('Ошибка загрузки данных:', e);
    }
}

function addGlobalParameter(name = '', value = '') {
    const container = document.getElementById('global-parameters');
    const div = document.createElement('div');
    div.className = 'param-row';
    div.style.display = 'flex';
    div.style.gap = '0.5rem';
    div.style.marginBottom = '0.5rem';
    div.innerHTML = `
        <input type="text" placeholder="Имя" value="${name}" style="flex:1;" data-field="name">
        <input type="text" placeholder="Значение" value="${value}" style="flex:2;" data-field="value">
        <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
}

function loadSavedParameterGlobal() {
    const select = document.getElementById('saved-parameters-select-global');
    const selectedId = select.value;
    if (!selectedId) return;

    const param = savedParameters.find(p => p.id == selectedId);
    if (param) {
        addGlobalParameter(param.name, param.value);
    }
}

async function addProfileStep(scriptId = '', machineIds = [], params = [], isCollapsed = false) {
    const stepsContainer = document.getElementById('profile-steps');
    const stepIndex = stepsContainer.children.length + 1;
    const stepDiv = document.createElement('div');
    stepDiv.className = 'step-block';
    stepDiv.style.border = '1px solid #ddd';
    stepDiv.style.padding = '10px';
    stepDiv.style.marginTop = '10px';

    // Найдём имя сценария для заголовка
    let scriptName = 'Не выбран';
    if (scriptId) {
        const script = allScripts.find(s => s.id == scriptId);
        scriptName = script ? script.name : `Сценарий #${scriptId}`;
    }

    // Создаём HTML
    stepDiv.innerHTML = `
        <div class="step-header" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
            <strong>Шаг ${stepIndex}: ${scriptName}</strong>
            <span class="toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
        </div>
        <div class="step-content" style="${isCollapsed ? 'display:none;' : ''}">
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
                <label>Параметры сценария</label>
                <div class="step-params"></div>
                <div style="display:flex;gap:0.5rem;align-items:center;margin-top:5px;">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="addStepParameter(this)">+</button>
                    <select class="saved-parameters-select-step" style="padding:0.5rem;border:1px solid #cbd5e0;border-radius:5px;">
                        <option value="">Выбрать...</option>
                    </select>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="loadSavedParameterStep(this)">Загрузить</button>
                </div>
            </div>
            <button type="button" class="btn btn-danger btn-sm" style="margin-top:10px;" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;

    stepsContainer.appendChild(stepDiv);

    // Назначаем обработчик клика по заголовку
    stepDiv.querySelector('.step-header').addEventListener('click', () => {
        const content = stepDiv.querySelector('.step-content');
        const icon = stepDiv.querySelector('.toggle-icon');
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.textContent = '▼';
        } else {
            content.style.display = 'none';
            icon.textContent = '▶';
        }
    });

    // Заполняем сценарии
    const scriptSelect = stepDiv.querySelector('.script-select');
    allScripts.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        if (scriptId == s.id) opt.selected = true;
        scriptSelect.appendChild(opt);
    });

    // Обновляем название при изменении сценария
    scriptSelect.addEventListener('change', () => {
        const newScriptId = scriptSelect.value;
        const newScriptName = newScriptId 
            ? (allScripts.find(s => s.id == newScriptId)?.name || `Сценарий #${newScriptId}`)
            : 'Не выбран';
        stepDiv.querySelector('.step-header strong').textContent = `Шаг ${stepIndex}: ${newScriptName}`;
    });

    // Заполняем машины
    const machineSelect = stepDiv.querySelector('.machine-select');
    allMachines.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.address})`;
        if (machineIds.includes(m.id)) opt.selected = true;
        machineSelect.appendChild(opt);
    });

    // Заполняем параметры
    const paramsContainer = stepDiv.querySelector('.step-params');
    params.forEach(p => {
        addStepParameterToContainer(paramsContainer, p.name, p.value);
    });

    // Обновляем селекты параметров
    updateParameterSelects();
}

function addStepParameter(button) {
    const paramsContainer = button.closest('.step-block').querySelector('.step-params');
    addStepParameterToContainer(paramsContainer);
}

function addStepParameterToContainer(container, name = '', value = '') {
    const div = document.createElement('div');
    div.className = 'param-row';
    div.style.display = 'flex';
    div.style.gap = '0.5rem';
    div.style.marginBottom = '0.5rem';
    div.innerHTML = `
        <input type="text" placeholder="Имя" value="${name}" style="flex:1;" data-field="name">
        <input type="text" placeholder="Значение" value="${value}" style="flex:2;" data-field="value">
        <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
}

function loadSavedParameterStep(button) {
    const select = button.closest('.step-block').querySelector('.saved-parameters-select-step');
    const selectedId = select.value;
    if (!selectedId) return;

    const param = savedParameters.find(p => p.id == selectedId);
    if (param) {
        const paramsContainer = button.closest('.step-block').querySelector('.step-params');
        addStepParameterToContainer(paramsContainer, param.name, param.value);
    }
}

function collectParameters(container) {
    const params = [];
    container.querySelectorAll('.param-row').forEach(row => {
        const name = row.querySelector('[data-field="name"]')?.value.trim();
        const value = row.querySelector('[data-field="value"]')?.value.trim();
        if (name) params.push({ name, value });
    });
    return params;
}

// Изменение сценария
function changeScript(button) {
    const step = button.closest('.step-block');
    const currentId = step.querySelector('.script-id').value;
    
    let html = '<select class="script-select-temp" style="width:100%;">';
    html += '<option value="">Выберите сценарий</option>';
    allScripts.forEach(s => {
        html += `<option value="${s.id}" ${s.id == currentId ? 'selected' : ''}>${s.name}</option>`;
    });
    html += '</select>';
    html += '<button type="button" class="btn btn-success btn-sm" onclick="confirmScriptChange(this)">✓</button>';
    html += '<button type="button" class="btn btn-secondary btn-sm" onclick="cancelScriptChange(this)">×</button>';
    
    step.querySelector('.script-name-input').outerHTML = html;
}

function confirmScriptChange(button) {
    const select = button.previousElementSibling;
    const step = button.closest('.step-block');
    const scriptId = select.value;
    const scriptName = allScripts.find(s => s.id == scriptId)?.name || `Сценарий #${scriptId}`;
    
    step.querySelector('.script-id').value = scriptId;
    const inputHtml = `
        <input type="text" class="script-name-input" value="${scriptName}" readonly style="width:100%;background:#f5f5f5;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="changeScript(this)">Изменить</button>
    `;
    select.outerHTML = inputHtml;
}

function cancelScriptChange(button) {
    const step = button.closest('.step-block');
    const scriptId = step.querySelector('.script-id').value;
    const scriptName = allScripts.find(s => s.id == scriptId)?.name || `Сценарий #${scriptId}`;
    
    const inputHtml = `
        <input type="text" class="script-name-input" value="${scriptName}" readonly style="width:100%;background:#f5f5f5;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="changeScript(this)">Изменить</button>
    `;
    button.parentElement.outerHTML = inputHtml;
}

// Аналогично для машин (упрощённо)
function changeMachines(button) {
    const step = button.closest('.step-block');
    const currentIds = step.querySelector('.machine-ids').value.split(',').filter(id => id);
    
    let html = '<select multiple size="4" class="machine-select-temp" style="width:100%;">';
    allMachines.forEach(m => {
        const selected = currentIds.includes(String(m.id)) ? 'selected' : '';
        html += `<option value="${m.id}" ${selected}>${m.name} (${m.address})</option>`;
    });
    html += '</select>';
    html += '<button type="button" class="btn btn-success btn-sm" onclick="confirmMachinesChange(this)">✓</button>';
    html += '<button type="button" class="btn btn-secondary btn-sm" onclick="cancelMachinesChange(this)">×</button>';
    
    step.querySelector('.machine-names-display').outerHTML = html;
}

function confirmMachinesChange(button) {
    const select = button.previousElementSibling;
    const step = button.closest('.step-block');
    const machineIds = Array.from(select.selectedOptions).map(opt => opt.value);
    const machineNames = Array.from(select.selectedOptions).map(opt => opt.textContent);
    
    step.querySelector('.machine-ids').value = machineIds.join(',');
    const displayHtml = `
        <div class="machine-names-display" style="min-height:30px;background:#f5f5f5;padding:5px;border:1px solid #ddd;">
            ${machineNames.map(name => `<span style="display:inline-block;background:#e0e0e0;margin:2px;padding:2px;border-radius:3px;">${name}</span>`).join('')}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="changeMachines(this)">Изменить</button>
    `;
    select.outerHTML = displayHtml;
}

function cancelMachinesChange(button) {
    const step = button.closest('.step-block');
    const machineIds = step.querySelector('.machine-ids').value.split(',').filter(id => id);
    const machineNames = machineIds.map(id => {
        const machine = allMachines.find(m => m.id == id);
        return machine ? `${machine.name} (${machine.address})` : `Машина #${id}`;
    });
    
    const displayHtml = `
        <div class="machine-names-display" style="min-height:30px;background:#f5f5f5;padding:5px;border:1px solid #ddd;">
            ${machineNames.map(name => `<span style="display:inline-block;background:#e0e0e0;margin:2px;padding:2px;border-radius:3px;">${name}</span>`).join('')}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="changeMachines(this)">Изменить</button>
    `;
    button.parentElement.outerHTML = displayHtml;
}


document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const profileId = document.getElementById('profile-id').value;
    const name = document.getElementById('profile-name').value.trim();
    if (!name) {
        alert('Укажите название профиля');
        return;
    }

    // Глобальные параметры
    const globalParams = collectParameters(document.getElementById('global-parameters'));

    // Шаги
    const steps = [];
    document.querySelectorAll('#profile-steps > .step-block').forEach(step => {
        const scriptId = parseInt(step.querySelector('.script-select').value);
        if (!scriptId) {
            alert('Выберите сценарий в каждом шаге');
            throw new Error('Missing script');
        }

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
        alert('Добавьте хотя бы один шаг');
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
        if (profileId) {
            url = `/api/profiles/${profileId}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });

        if (res.ok) {
            alert(`Профиль ${profileId ? 'обновлён' : 'создан'}`);
            window.location.href = '/profiles';
        } else {
            const err = await res.json();
            alert(`Ошибка: ${err.detail}`);
        }
    } catch (e) {
        if (e.message !== 'Missing script') {
            console.error('Ошибка сохранения:', e);
            alert('Ошибка сохранения профиля');
        }
    }
});

// Инициализация режима редактирования
async function initEditMode() {
    const profileIdEl = document.getElementById('profile-id');
    if (!profileIdEl || !profileIdEl.value) return;

    try {
        const res = await fetch(`/api/profiles/${profileIdEl.value}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const profileData = await res.json();
        const stepsContainer = document.getElementById('profile-steps');
        if (!stepsContainer) return;

        stepsContainer.innerHTML = '';
        for (const ps of profileData.profile_scripts) {
            // Создаём шаги СВЁРНУТЫМИ (isCollapsed = true)
            await addProfileStep(
                ps.script_id,
                ps.machine_ids || [],
                ps.parameters || [],
                true // ← свёрнуто при загрузке
            );
        }
    } catch (e) {
        console.error('Ошибка загрузки профиля:', e);
        alert('Не удалось загрузить шаги профиля');
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadSavedParameters(),
        loadScriptsAndMachines()
    ]);
    
    await initEditMode();
});

